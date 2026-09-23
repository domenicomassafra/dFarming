import crypto from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { DFarmingAgentClient } from './agent/client.js';
import { collectDoctorReport, type DoctorReport } from './doctor.js';
import { dfarmingEnv } from './env.js';
import type { CreateTaskInput } from './types.js';

const TERMINAL = new Set(['succeeded', 'failed', 'cancelled', 'skipped', 'stopped']);

export interface AcceptanceDevice {
    udid: string;
    name: string;
    kind?: 'physical' | 'simulator' | 'emulator';
    workerId?: string;
    disabled?: boolean;
    connected?: unknown;
}

export interface AcceptanceHost {
    id: string;
    online?: boolean;
    error?: string;
}

export function acceptanceReceiptDirectory(env: NodeJS.ProcessEnv = process.env): string {
    const configured = dfarmingEnv('ACCEPTANCE_DIR', env);
    if (configured?.trim()) return path.resolve(configured.trim());
    if (env.SCHEDULER_DATA_DIR?.trim()) return path.resolve(env.SCHEDULER_DATA_DIR.trim(), 'acceptance');
    return path.resolve('.runtime/acceptance');
}

export function acceptancePreflightErrors(
    doctor: DoctorReport,
    device: AcceptanceDevice,
    host?: AcceptanceHost,
): string[] {
    const errors: string[] = [];
    const virtual = device.kind === 'simulator' || device.kind === 'emulator';

    if (!doctor.runtimeReady) {
        const failures = doctor.checks
            .filter(({ status }) => status === 'fail')
            .map(({ summary, detail }) => `${summary}${detail ? `: ${detail}` : ''}`)
            .join('; ');
        errors.push(`Runtime preflight is blocked${failures ? `: ${failures}` : ''}`);
    }
    if (!virtual && doctor.role !== 'control-plane' && !doctor.realDeviceReady) {
        const failures = doctor.checks
            .filter(({ status }) => status === 'fail')
            .map(({ summary, detail }) => `${summary}${detail ? `: ${detail}` : ''}`)
            .join('; ');
        errors.push(`Real-device preflight is blocked${failures ? `: ${failures}` : ''}`);
    }
    if (!device.connected) errors.push(`Device ${device.udid} is not connected`);
    if (device.workerId && doctor.role === 'control-plane') {
        if (!host) errors.push(`Owning worker ${device.workerId} is not present in fleet health`);
        else if (host.online === false) errors.push(`Owning worker ${device.workerId} is offline`);
        else if (host.error) errors.push(`Owning worker ${device.workerId} is degraded: ${host.error}`);
    }
    return errors;
}

function arg(name: string): string | undefined {
    const index = process.argv.indexOf(name);
    return index >= 0 ? process.argv[index + 1] : undefined;
}

function has(name: string): boolean { return process.argv.includes(name); }

export function acceptanceRequestHeaders(base: URL, body?: unknown): Headers {
    const headers = new Headers({ accept: 'application/json' });
    if (body !== undefined) headers.set('content-type', 'application/json');
    const token = dfarmingEnv('TOKEN');
    if (token) headers.set('authorization', `Bearer ${token}`);
    else headers.set('origin', base.origin);
    return headers;
}

async function api(base: URL, method: string, pathname: string, body?: unknown): Promise<Response> {
    const headers = acceptanceRequestHeaders(base, body);
    const response = await fetch(new URL(pathname, base), {
        method, headers, ...(body !== undefined ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(35_000),
    });
    if (!response.ok) throw new Error(`${method} ${pathname} failed (${response.status}): ${(await response.text()).slice(0, 500)}`);
    return response;
}

function isPublicAction(input: CreateTaskInput): boolean {
    return input.task.taskType === 'cold-dms'
        || (input.task.taskType === 'post' && input.task.payload.destination === 'publish');
}

export async function runLiveAcceptance(): Promise<Record<string, unknown>> {
    const udid = arg('--udid');
    if (!udid) throw new Error('--udid is required');

    const doctor = collectDoctorReport();
    const client = new DFarmingAgentClient();
    const base = client.baseUrl;
    const startedAt = new Date();
    const health = await client.health();
    const accounts = await client.accounts();
    const devices = await (await api(base, 'GET', '/api/devices')).json() as AcceptanceDevice[];
    const device = devices.find((candidate) => candidate.udid === udid);
    if (!device) throw new Error(`Device ${udid} is not registered in dFarming`);
    if (device.disabled) throw new Error(`Device ${udid} is disabled`);

    let host: AcceptanceHost | undefined;
    if (device.workerId && doctor.role === 'control-plane') {
        const fleet = await (await api(base, 'GET', '/api/hosts')).json() as { hosts: AcceptanceHost[] };
        host = fleet.hosts.find(({ id }) => id === device.workerId);
    }
    const preflightErrors = acceptancePreflightErrors(doctor, device, host);
    if (preflightErrors.length) throw new Error(preflightErrors.join('\n'));

    const screenshot = await api(base, 'GET', `/api/devices/${encodeURIComponent(udid)}/remote/screenshot`);
    const screenshotBytes = Buffer.from(await screenshot.arrayBuffer());
    if (screenshotBytes.length < 100) throw new Error('Device screenshot proof is unexpectedly small');
    const snapshot = await client.snapshot(udid, { maxNodes: 80 }) as { generation?: number; count?: number; text?: string };
    if (!snapshot.count) throw new Error('Semantic snapshot found no actionable/text elements');

    const streamCapability = await (await api(base, 'POST', `/api/devices/${encodeURIComponent(udid)}/remote/stream-token`)).json() as { url: string };
    const streamController = new AbortController();
    const streamResponse = await fetch(new URL(streamCapability.url, base), { signal: streamController.signal });
    if (!streamResponse.ok || !streamResponse.body) throw new Error(`Video stream proof failed (${streamResponse.status})`);
    const reader = streamResponse.body.getReader();
    const firstChunk = await Promise.race([
        reader.read(),
        new Promise<never>((_resolve, reject) => setTimeout(() => reject(new Error('Video stream produced no bytes within 5 seconds')), 5_000)),
    ]);
    streamController.abort();
    if (!firstChunk.value?.length) throw new Error('Video stream produced an empty first chunk');

    let inputProof: unknown = 'not-requested';
    if (has('--allow-input')) {
        inputProof = await (await api(base, 'POST', `/api/devices/${encodeURIComponent(udid)}/remote/action`, { type: 'home' })).json();
    }

    let taskProof: unknown = 'not-requested';
    const taskFile = arg('--task-file');
    if (taskFile) {
        const task = JSON.parse(await readFile(path.resolve(taskFile), 'utf8')) as CreateTaskInput;
        if (task.deviceUdid !== udid) throw new Error('The task-file deviceUdid must match --udid');
        if (isPublicAction(task) && !has('--confirm-public-actions')) {
            throw new Error('The task file contains a public/send action; pass --confirm-public-actions to execute it');
        }
        const schedule = await (await api(base, 'POST', '/api/schedules', task)).json() as { id: string };
        const deadline = Date.now() + Number(arg('--task-timeout-ms') ?? 180_000);
        let execution: { id: string; scheduleId?: string; status: string; error?: string | null } | undefined;
        while (Date.now() < deadline) {
            const rows = await (await api(base, 'GET', `/api/executions?deviceUdid=${encodeURIComponent(udid)}`)).json() as { executions: typeof execution[] };
            execution = rows.executions.find((candidate) => candidate?.scheduleId === schedule.id);
            if (execution && TERMINAL.has(execution.status)) break;
            await new Promise((resolve) => setTimeout(resolve, 1_000));
        }
        if (!execution || !TERMINAL.has(execution.status)) throw new Error('Acceptance task did not reach a terminal state before timeout');
        if (execution.status !== 'succeeded') throw new Error(`Acceptance task ended ${execution.status}${execution.error ? `: ${execution.error}` : ''}`);
        taskProof = { scheduleId: schedule.id, executionId: execution.id, status: execution.status };
    }

    const receipt = {
        kind: 'dfarming-live-acceptance',
        startedAt: startedAt.toISOString(),
        finishedAt: new Date().toISOString(),
        device: { udid, name: device.name },
        doctor,
        health,
        accounts,
        screenshot: { bytes: screenshotBytes.length, sha256: crypto.createHash('sha256').update(screenshotBytes).digest('hex') },
        semantic: { generation: snapshot.generation, count: snapshot.count },
        stream: { firstChunkBytes: firstChunk.value.length, contentType: streamResponse.headers.get('content-type') },
        inputProof,
        taskProof,
    };
    const receiptDirectory = acceptanceReceiptDirectory();
    await mkdir(receiptDirectory, { recursive: true, mode: 0o700 });
    const receiptPath = path.join(receiptDirectory, `${startedAt.toISOString().replace(/[:.]/g, '-')}-${udid.replace(/[^A-Za-z0-9._-]/g, '_')}.json`);
    await writeFile(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`, { mode: 0o600 });
    return { ...receipt, receiptPath };
}

async function main(): Promise<void> {
    try { console.log(JSON.stringify(await runLiveAcceptance(), null, 2)); }
    catch (error) { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; }
}

const entrypoint = process.argv[1] ? path.resolve(process.argv[1]) : '';
if (entrypoint && fileURLToPath(import.meta.url) === entrypoint) await main();
