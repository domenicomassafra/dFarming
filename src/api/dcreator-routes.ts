import type { FastifyInstance, FastifyReply } from 'fastify';

import { listFleetAccounts } from '../accounts.js';
import { deviceMatchesAllocationSelector, type DeviceAllocationSelector } from '../allocation.js';
import { loadRegisteredDevices } from '../devices/registry.js';
import {
    DCREATOR_RECEIPT_SCHEMA, dcreatorRequestHash, normalizeDCreatorJob,
    type DCreatorExecutionReceipt, type DCreatorJobRequest,
} from '../integrations/dcreator.js';
import { normalizeNetworkRouteId } from '../network-routes.js';
import type { SchedulerRepository } from '../scheduler/repository.js';
import { internalWorkerAuthorized } from './http-security.js';
import { ingestMultipartAssets } from './asset-routes.js';

const DCREATOR_SOURCE = 'dcreator';

function errorMessage(error: unknown): string { return error instanceof Error ? error.message : String(error); }

function refused(externalId: string, reason: string): DCreatorExecutionReceipt {
    return { schema: DCREATOR_RECEIPT_SCHEMA, externalId, status: 'refused', evidenceRefs: [], reason };
}

function receiptStatus(scheduleStatus: string, executionStatus?: string): DCreatorExecutionReceipt['status'] {
    if (executionStatus === 'running') return 'running';
    if (executionStatus === 'queued') return 'queued';
    if (executionStatus === 'succeeded') return 'completed';
    if (executionStatus && ['failed', 'cancelled', 'skipped', 'stopped'].includes(executionStatus)) return 'failed';
    return scheduleStatus === 'cancelled' ? 'failed' : scheduleStatus === 'completed' ? 'completed' : 'queued';
}

async function scheduleReceipt(
    scheduler: SchedulerRepository,
    schedule: NonNullable<Awaited<ReturnType<SchedulerRepository['schedule']>>>,
): Promise<DCreatorExecutionReceipt> {
    const execution = await scheduler.latestExecutionForSchedule(schedule.id);
    return {
        schema: DCREATOR_RECEIPT_SCHEMA,
        externalId: schedule.externalId ?? '',
        scheduleId: schedule.id,
        ...(execution ? { executionId: execution.id } : {}),
        deviceUdid: schedule.deviceUdid,
        status: receiptStatus(schedule.status, execution?.status),
        evidenceRefs: execution ? [`execution:${execution.id}`] : [],
        ...(execution?.error ? { reason: execution.error } : {}),
    };
}

async function resolveDCreatorTask(request: DCreatorJobRequest, scheduler: SchedulerRepository) {
    const devices = await loadRegisteredDevices();
    const matchingAccounts = listFleetAccounts(devices).filter(({ policy }) => policy?.executionProfile?.id === request.accountRef);
    if (!matchingAccounts.length) throw Object.assign(new Error('accountRef does not resolve to an execution profile'), { statusCode: 404 });
    if (matchingAccounts.length > 1) throw Object.assign(new Error('accountRef is ambiguous across multiple fleet accounts'), { statusCode: 409 });
    const account = matchingAccounts[0]!;
    const device = devices.find(({ udid }) => udid === account.deviceUdid);
    if (!device) throw Object.assign(new Error('Execution-profile device is no longer registered'), { statusCode: 409 });
    if (device.disabled) throw Object.assign(new Error('Execution-profile device is disabled'), { statusCode: 409 });
    if (request.task.pluginId !== account.pluginId) {
        throw Object.assign(new Error('task.pluginId does not match the accountRef platform'), { statusCode: 409 });
    }
    const requestedAccount = request.task.payload.account;
    if (requestedAccount !== undefined && requestedAccount !== account.handle) {
        throw Object.assign(new Error('task.payload.account conflicts with accountRef'), { statusCode: 409 });
    }
    const profile = account.policy!.executionProfile!;
    if (request.constraints.executionProfile && request.constraints.executionProfile !== profile.id) {
        throw Object.assign(new Error('constraints.executionProfile conflicts with accountRef'), { statusCode: 409 });
    }
    if (request.constraints.platform && request.constraints.platform !== (device.platform ?? 'ios')) {
        throw Object.assign(new Error('constraints.platform does not match the execution-profile device'), { statusCode: 409 });
    }
    if (request.constraints.networkRoute) {
        const route = normalizeNetworkRouteId(request.constraints.networkRoute);
        if (route !== profile.networkRouteId) {
            throw Object.assign(new Error('constraints.networkRoute does not match the execution profile'), { statusCode: 409 });
        }
    }
    if (request.constraints.devicePool) {
        const pool = await scheduler.devicePool(request.constraints.devicePool);
        if (!pool) throw Object.assign(new Error('constraints.devicePool was not found'), { statusCode: 404 });
        if (!deviceMatchesAllocationSelector(device, pool.selector as unknown as DeviceAllocationSelector)) {
            throw Object.assign(new Error('Execution-profile device does not belong to constraints.devicePool'), { statusCode: 409 });
        }
    }
    return {
        device,
        task: { ...request.task, payload: { ...request.task.payload, account: account.handle } },
    };
}

export function registerDCreatorRoutes(app: FastifyInstance, scheduler: SchedulerRepository): void {
    const authorize = (request: Parameters<typeof internalWorkerAuthorized>[0], reply: FastifyReply) => {
        if (internalWorkerAuthorized(request)) return true;
        reply.code(401).send({ error: 'Internal integration token required' });
        return false;
    };

    app.post('/api/internal/integrations/dcreator/assets', async (request, reply) => {
        if (!authorize(request, reply)) return;
        try {
            const assets = await ingestMultipartAssets(request, scheduler);
            return reply.code(201).send({ assetRefs: assets.map(({ id }) => id), assets });
        } catch (error) {
            return reply.code(400).send({ error: errorMessage(error) });
        }
    });

    app.post<{ Body: unknown }>('/api/internal/integrations/dcreator/jobs', async (request, reply) => {
        if (!authorize(request, reply)) return;
        let job: DCreatorJobRequest;
        try { job = normalizeDCreatorJob(request.body); }
        catch (error) { return reply.code(400).send({ error: errorMessage(error) }); }
        const requestHash = dcreatorRequestHash(job);
        const existing = await scheduler.scheduleByExternal(DCREATOR_SOURCE, job.externalId);
        if (existing) {
            if (existing.externalRequestHash !== requestHash) {
                return reply.code(409).send({ receipt: refused(job.externalId, 'externalId already exists with different content') });
            }
            return { receipt: await scheduleReceipt(scheduler, existing) };
        }
        try {
            const resolved = await resolveDCreatorTask(job, scheduler);
            const schedule = await scheduler.createTask({
                deviceUdid: resolved.device.udid,
                task: resolved.task,
                timing: job.timing,
                ...(job.runWindowMinutes !== undefined ? { runWindowMinutes: job.runWindowMinutes } : {}),
            }, resolved.device.pluginData[job.task.pluginId] ?? {}, new Date(), job.assetRefs, {
                externalSource: DCREATOR_SOURCE,
                externalId: job.externalId,
                externalRequestHash: requestHash,
            });
            return reply.code(201).send({ receipt: await scheduleReceipt(scheduler, schedule) });
        } catch (error) {
            const statusCode = Number((error as { statusCode?: number }).statusCode ?? 409);
            return reply.code(statusCode >= 400 && statusCode < 500 ? statusCode : 409)
                .send({ receipt: refused(job.externalId, errorMessage(error)) });
        }
    });

    app.get<{ Params: { externalId: string } }>('/api/internal/integrations/dcreator/jobs/:externalId', async (request, reply) => {
        if (!authorize(request, reply)) return;
        const externalId = request.params.externalId.trim();
        if (!externalId || externalId.length > 160) return reply.code(400).send({ error: 'externalId is invalid' });
        const schedule = await scheduler.scheduleByExternal(DCREATOR_SOURCE, externalId);
        return schedule
            ? { receipt: await scheduleReceipt(scheduler, schedule) }
            : reply.code(404).send({ error: 'dCreator job not found' });
    });
}
