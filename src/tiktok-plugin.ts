import { createReadStream, createWriteStream } from 'node:fs';
import { copyFile, mkdir, mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pipeline } from 'node:stream/promises';

import { TIKTOK_PLUGIN_ID } from './branding.js';
import type { DFarmingPlugin } from './plugin.js';
import type { JsonObject, ScheduleTiming } from './types.js';
import {
    resolveDeviceCoordinates,
} from './devices/coordinates.js';
import { farmOrderIndex, farmStaggerSlot, shiftLocalTime } from './devices/farm-order.js';
import type { RegisteredDevice } from './devices/registry.js';
import {
    createWorkflowPattern,
    listWorkflowsFromPluginData,
    parseRecordedEvents,
    parseWorkflowPattern,
    parseWorkflowStep,
    replaceWorkflowsInPluginData,
    type WorkflowPattern,
    type WorkflowTimedStep,
} from './tiktok/workflows.js';
import { createTikTokTaskDefinitions, type TikTokPluginConfiguration } from './tiktok/task-definitions.js';

export type { TikTokPluginConfiguration } from './tiktok/task-definitions.js';


/** 12 / 3 / 6 / 9 PM America/New_York — drain one ready pipeline item each tick. */
const PIPELINE_CHECK_TIMES = ['12:00', '15:00', '18:00', '21:00'] as const;
const PIPELINE_TIMEZONE = 'America/New_York';
const PIPELINE_FREQUENCIES = ['production', '60', '15', '5', '1'] as const;
const PIPELINE_STAGGER_MINUTES = 5;
type PipelineFrequency = (typeof PIPELINE_FREQUENCIES)[number];

type PostPipelinePluginData = {
    enabled?: boolean;
    scheduleIds?: string[];
    frequency?: PipelineFrequency;
    fleet?: boolean;
    staggerMinutes?: number;
};

function parsePipelineFrequency(value: unknown): PipelineFrequency {
    if (typeof value === 'string' && (PIPELINE_FREQUENCIES as readonly string[]).includes(value)) {
        return value as PipelineFrequency;
    }
    return 'production';
}

function pipelineFrequencyLabel(frequency: PipelineFrequency): string {
    if (frequency === 'production') return '12 / 3 / 6 / 9 PM Eastern';
    if (frequency === '60') return 'every hour';
    if (frequency === '15') return 'every 15 minutes';
    if (frequency === '5') return 'every 5 minutes';
    return 'every minute';
}

function pipelineCheckSummary(
    frequency: PipelineFrequency,
    staggerMinutes = 0,
): Array<{ localTime?: string; timezone?: string; everyMinutes?: number; startOffsetMinutes?: number; label: string }> {
    if (frequency === 'production') {
        return PIPELINE_CHECK_TIMES.map((localTime) => {
            const shifted = shiftLocalTime(localTime, staggerMinutes);
            return {
                localTime: shifted,
                timezone: PIPELINE_TIMEZONE,
                label: staggerMinutes
                    ? `${shifted} ${PIPELINE_TIMEZONE} (+${staggerMinutes}m stagger)`
                    : `${shifted} ${PIPELINE_TIMEZONE}`,
            };
        });
    }
    const everyMinutes = Number(frequency);
    return [{
        everyMinutes,
        startOffsetMinutes: staggerMinutes,
        label: staggerMinutes
            ? `${pipelineFrequencyLabel(frequency)} · starts +${staggerMinutes}m`
            : pipelineFrequencyLabel(frequency),
    }];
}

function postPipelineFromPluginData(data: JsonObject): PostPipelinePluginData {
    const raw = data.postPipeline;
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
    const obj = raw as Record<string, unknown>;
    return {
        enabled: obj.enabled === true,
        scheduleIds: Array.isArray(obj.scheduleIds)
            ? obj.scheduleIds.filter((id): id is string => typeof id === 'string')
            : [],
        frequency: parsePipelineFrequency(obj.frequency),
        fleet: obj.fleet === true,
        staggerMinutes: typeof obj.staggerMinutes === 'number' ? obj.staggerMinutes : undefined,
    };
}

function withPostPipeline(data: JsonObject, pipeline: PostPipelinePluginData): JsonObject {
    return { ...data, postPipeline: pipeline as unknown as JsonObject };
}

function pipelineTimingsForDevice(frequency: PipelineFrequency, staggerMinutes: number): ScheduleTiming[] {
    if (frequency === 'production') {
        return PIPELINE_CHECK_TIMES.map((localTime) => ({
            kind: 'daily' as const,
            localTime: shiftLocalTime(localTime, staggerMinutes),
            timezone: PIPELINE_TIMEZONE,
        }));
    }
    return [{
        kind: 'interval',
        everyMinutes: Number(frequency),
        ...(staggerMinutes > 0 ? { startOffsetMinutes: staggerMinutes } : {}),
    }];
}

function activeDFarmingDevices(devices: RegisteredDevice[]): RegisteredDevice[] {
    return devices
        .filter((device) => !device.disabled)
        .sort((a, b) => {
            const diff = farmOrderIndex(a.name) - farmOrderIndex(b.name);
            return diff !== 0 ? diff : a.name.localeCompare(b.name);
        });
}

async function hashFile(filePath: string): Promise<string> {
    return new Promise((resolve, reject) => {
        const hash = crypto.createHash('sha256');
        createReadStream(filePath).on('data', (chunk) => hash.update(chunk)).once('error', reject).once('end', () => resolve(hash.digest('hex')));
    });
}


export function createTikTokPlugin(configuration: TikTokPluginConfiguration = {}): DFarmingPlugin {
    return {
        id: TIKTOK_PLUGIN_ID,
        version: '0.1.0',
        displayName: 'TikTok automation',
        tasks: createTikTokTaskDefinitions(configuration),
        devicePanels: [{
            id: 'tiktok-controls', title: 'TikTok',
            fragmentPath: fileURLToPath(new URL('../static/tiktok/device-panel.html', import.meta.url)), order: 100,
        }],
        async registerRoutes(context) {
            const deviceData = async (udid: string) => (await context.loadDevices()).find((device) => device.udid === udid);
            const tiktokPluginData = (device: { pluginData: Record<string, JsonObject | undefined> }) => (
                device.pluginData['com.dfarming.tiktok'] ?? {}
            );

            context.app.get<{ Params: { udid: string } }>('/api/devices/:udid/tiktok/workflows', async (request, reply) => {
                const device = await deviceData(request.params.udid);
                if (!device) return reply.code(404).send({ error: 'Device is not registered' });
                return { workflows: listWorkflowsFromPluginData(tiktokPluginData(device) as Record<string, unknown>) };
            });

            context.app.post<{
                Params: { udid: string };
                Body: { name?: string; events?: unknown; steps?: unknown; meta?: WorkflowPattern['meta'] };
            }>('/api/devices/:udid/tiktok/workflows', async (request, reply) => {
                const device = await deviceData(request.params.udid);
                if (!device) return reply.code(404).send({ error: 'Device is not registered' });
                try {
                    const coords = resolveDeviceCoordinates(
                        device.coordinateProfile,
                        device.coordinates,
                    ).tiktok;
                    const body = request.body;
                    const name = typeof body.name === 'string' ? body.name : '';
                    let pattern: WorkflowPattern;
                    if (Array.isArray(body.steps)) {
                        const steps = body.steps.map((item, index) => {
                            if (!item || typeof item !== 'object' || Array.isArray(item)) {
                                throw new Error(`steps[${index}] must be an object`);
                            }
                            const timed = item as Record<string, unknown>;
                            if (typeof timed.t !== 'number') throw new Error(`steps[${index}].t must be a number`);
                            return { t: Math.round(timed.t), step: parseWorkflowStep(timed.step) };
                        }) as WorkflowTimedStep[];
                        pattern = createWorkflowPattern({ name, events: [], coords, steps, meta: body.meta });
                    } else {
                        pattern = createWorkflowPattern({
                            name,
                            events: parseRecordedEvents(body.events),
                            coords,
                            meta: body.meta,
                        });
                    }
                    await context.mutateDevices((devices) => {
                        const target = devices.find(({ udid }) => udid === request.params.udid);
                        if (!target) return false;
                        const current = listWorkflowsFromPluginData(
                            (target.pluginData['com.dfarming.tiktok'] ?? {}) as Record<string, unknown>,
                        );
                        target.pluginData = {
                            ...target.pluginData,
                            'com.dfarming.tiktok': replaceWorkflowsInPluginData(
                                target.pluginData['com.dfarming.tiktok'] as Record<string, unknown> | undefined,
                                [...current, pattern],
                            ) as JsonObject,
                        };
                        return true;
                    });
                    return reply.code(201).send(pattern);
                } catch (error) {
                    return reply.code(400).send({ error: error instanceof Error ? error.message : String(error) });
                }
            });

            context.app.get<{ Params: { udid: string; id: string } }>(
                '/api/devices/:udid/tiktok/workflows/:id',
                async (request, reply) => {
                    const device = await deviceData(request.params.udid);
                    if (!device) return reply.code(404).send({ error: 'Device is not registered' });
                    const workflow = listWorkflowsFromPluginData(tiktokPluginData(device) as Record<string, unknown>)
                        .find(({ id }) => id === request.params.id);
                    if (!workflow) return reply.code(404).send({ error: 'Workflow not found' });
                    return workflow;
                },
            );

            context.app.patch<{
                Params: { udid: string; id: string };
                Body: { name?: string; steps?: unknown; meta?: WorkflowPattern['meta'] };
            }>('/api/devices/:udid/tiktok/workflows/:id', async (request, reply) => {
                const device = await deviceData(request.params.udid);
                if (!device) return reply.code(404).send({ error: 'Device is not registered' });
                try {
                    let updated: WorkflowPattern | undefined;
                    const found = await context.mutateDevices((devices) => {
                        const target = devices.find(({ udid }) => udid === request.params.udid);
                        if (!target) return false;
                        const current = listWorkflowsFromPluginData(
                            (target.pluginData['com.dfarming.tiktok'] ?? {}) as Record<string, unknown>,
                        );
                        const index = current.findIndex(({ id }) => id === request.params.id);
                        if (index < 0) return false;
                        const existing = current[index]!;
                        const name = request.body.name !== undefined
                            ? String(request.body.name).trim()
                            : existing.name;
                        if (!name) throw new Error('Workflow name is required');
                        const steps = request.body.steps !== undefined
                            ? (request.body.steps as unknown[]).map((item, i) => {
                                if (!item || typeof item !== 'object' || Array.isArray(item)) {
                                    throw new Error(`steps[${i}] must be an object`);
                                }
                                const timed = item as Record<string, unknown>;
                                if (typeof timed.t !== 'number') throw new Error(`steps[${i}].t must be a number`);
                                return { t: Math.round(timed.t), step: parseWorkflowStep(timed.step) };
                            })
                            : existing.steps;
                        updated = parseWorkflowPattern({
                            ...existing,
                            name,
                            steps,
                            ...(request.body.meta !== undefined ? { meta: request.body.meta } : {}),
                        });
                        const next = [...current];
                        next[index] = updated;
                        target.pluginData = {
                            ...target.pluginData,
                            'com.dfarming.tiktok': replaceWorkflowsInPluginData(
                                target.pluginData['com.dfarming.tiktok'] as Record<string, unknown> | undefined,
                                next,
                            ) as JsonObject,
                        };
                        return true;
                    });
                    if (!found || !updated) return reply.code(404).send({ error: 'Workflow not found' });
                    return updated;
                } catch (error) {
                    return reply.code(400).send({ error: error instanceof Error ? error.message : String(error) });
                }
            });

            context.app.delete<{ Params: { udid: string; id: string } }>(
                '/api/devices/:udid/tiktok/workflows/:id',
                async (request, reply) => {
                    const found = await context.mutateDevices((devices) => {
                        const target = devices.find(({ udid }) => udid === request.params.udid);
                        if (!target) return false;
                        const current = listWorkflowsFromPluginData(
                            (target.pluginData['com.dfarming.tiktok'] ?? {}) as Record<string, unknown>,
                        );
                        const next = current.filter(({ id }) => id !== request.params.id);
                        if (next.length === current.length) return false;
                        target.pluginData = {
                            ...target.pluginData,
                            'com.dfarming.tiktok': replaceWorkflowsInPluginData(
                                target.pluginData['com.dfarming.tiktok'] as Record<string, unknown> | undefined,
                                next,
                            ) as JsonObject,
                        };
                        return true;
                    });
                    if (!found) return reply.code(404).send({ error: 'Workflow not found' });
                    return reply.code(204).send();
                },
            );

            context.app.post<{ Params: { udid: string }; Body: Record<string, string> }>(
                '/api/devices/:udid/fragments/following-scroll-run', async (request, reply) => {
                    const device = await deviceData(request.params.udid);
                    if (!device) return reply.code(404).send({ error: 'Device is not registered' });
                    if (device.disabled) {
                        return reply.code(409).send({ error: 'This device is disconnected — reconnect it before scheduling automation' });
                    }
                    const body = request.body;
                    const kind = body.scheduleKind ?? 'now';
                    const timing: ScheduleTiming = kind === 'now' ? { kind: 'now' }
                        : kind === 'once' ? { kind: 'once', runAt: body.runAt ?? '' }
                            : kind === 'daily' ? { kind: 'daily', localTime: body.localTime ?? '', timezone: body.timezone ?? 'UTC' }
                                : { kind: 'weekly', localTime: body.localTime ?? '', timezone: body.timezone ?? 'UTC', weekdays: (body.weekdays ?? '').split(',').filter(Boolean).map(Number) };
                    try {
                        if (kind === 'now') {
                            const recent = await context.scheduler.listExecutions(50, device.udid);
                            const mine = recent.filter(({ pluginId, taskType }) => (
                                pluginId === 'com.dfarming.tiktok' && taskType === 'doomscroll-following'
                            ));
                            if (mine.some(({ status }) => status === 'running')) {
                                throw new Error('An engagement session is already running on this device. Stop it from Activity, then start again.');
                            }
                            await context.scheduler.clearDeviceQueue(device.udid, {
                                pluginId: 'com.dfarming.tiktok',
                                taskType: 'doomscroll-following',
                                onlyQueued: true,
                            });
                        }
                        await context.scheduler.createTask({
                            deviceUdid: device.udid,
                            task: {
                                pluginId: 'com.dfarming.tiktok', taskType: 'doomscroll-following', taskVersion: 1,
                                payload: {
                                    durationMinutes: Number(body.durationMinutes),
                                    personality: body.personality,
                                    likeEnabled: body.likeEnabled === 'on',
                                    saveEnabled: body.saveEnabled === 'on',
                                    commentEnabled: body.commentEnabled === 'on',
                                    ...(body.commentText?.trim() ? { commentText: body.commentText.trim() } : {}),
                                    ...(body.account?.trim() ? { account: body.account.trim() } : {}),
                                },
                            },
                            timing,
                            runWindowMinutes: body.runWindowMinutes ? Number(body.runWindowMinutes) : undefined,
                        }, device.pluginData['com.dfarming.tiktok'] ?? {});
                        return reply.code(202).type('text/html').send(await context.renderActivity(device.udid));
                    } catch (error) {
                        const message = error instanceof Error ? error.message : String(error);
                        return reply.code(409).type('text/html').send(await context.renderActivity(device.udid, message));
                    }
                },
            );

            context.app.post<{ Params: { udid: string }; Body: Record<string, string> }>(
                '/api/devices/:udid/fragments/workflow-replay-run', async (request, reply) => {
                    const device = await deviceData(request.params.udid);
                    if (!device) return reply.code(404).send({ error: 'Device is not registered' });
                    if (device.disabled) {
                        return reply.code(409).send({ error: 'This device is disconnected — reconnect it before scheduling automation' });
                    }
                    const body = request.body;
                    try {
                        await context.scheduler.createTask({
                            deviceUdid: device.udid,
                            task: {
                                pluginId: 'com.dfarming.tiktok', taskType: 'workflow-replay', taskVersion: 1,
                                payload: {
                                    workflowId: body.workflowId ?? '',
                                    ...(body.durationMinutes ? { durationMinutes: Number(body.durationMinutes) } : {}),
                                    ...(body.loops ? { loops: Number(body.loops) } : {}),
                                    ...(body.commentText?.trim() ? { commentText: body.commentText.trim() } : {}),
                                },
                            },
                            timing: { kind: 'now' },
                        }, device.pluginData['com.dfarming.tiktok'] ?? {});
                        return reply.code(202).type('text/html').send(await context.renderActivity(device.udid));
                    } catch (error) {
                        const message = error instanceof Error ? error.message : String(error);
                        return reply.code(409).type('text/html').send(await context.renderActivity(device.udid, message));
                    }
                },
            );

            context.app.patch<{ Params: { udid: string }; Body: { accounts?: string[] } }>('/api/devices/:udid/accounts', async (request, reply) => {
                if (!Array.isArray(request.body.accounts)) return reply.code(400).send({ error: 'accounts must be an array' });
                const accounts = [...new Set(request.body.accounts.map((value) => value.trim()).filter(Boolean)
                    .map((value) => value.startsWith('@') ? value : `@${value}`))];
                if (accounts.some((value) => !/^@[A-Za-z0-9._]{1,64}$/.test(value))) {
                    return reply.code(400).send({ error: 'TikTok handles may contain letters, numbers, periods, and underscores' });
                }
                const found = await context.mutateDevices((devices) => {
                    const device = devices.find(({ udid }) => udid === request.params.udid);
                    if (!device) return false;
                    device.pluginData = { ...device.pluginData, 'com.dfarming.tiktok': { ...device.pluginData['com.dfarming.tiktok'], accounts } };
                    return true;
                });
                if (!found) return reply.code(404).send({ error: 'Device is not registered' });
                return { accounts };
            });

            context.app.post<{ Params: { udid: string }; Body: Record<string, string> }>(
                '/api/devices/:udid/fragments/scroll-run', async (request, reply) => {
                    const device = await deviceData(request.params.udid);
                    if (!device) return reply.code(404).send({ error: 'Device is not registered' });
                    if (device.disabled) return reply.code(409).send({ error: 'This device is disconnected — reconnect it before scheduling automation' });
                    const body = request.body;
                    const kind = body.scheduleKind ?? 'now';
                    const timing: ScheduleTiming = kind === 'now' ? { kind: 'now' }
                        : kind === 'once' ? { kind: 'once', runAt: body.runAt ?? '' }
                            : kind === 'daily' ? { kind: 'daily', localTime: body.localTime ?? '', timezone: body.timezone ?? 'UTC' }
                                : { kind: 'weekly', localTime: body.localTime ?? '', timezone: body.timezone ?? 'UTC', weekdays: (body.weekdays ?? '').split(',').filter(Boolean).map(Number) };
                    try {
                        if (kind === 'now') {
                            const recent = await context.scheduler.listExecutions(50, device.udid);
                            const mine = recent.filter(({ pluginId, taskType }) => (
                                pluginId === 'com.dfarming.tiktok' && taskType === 'doomscroll'
                            ));
                            if (mine.some(({ status }) => status === 'running')) {
                                throw new Error('A warmup session is already running on this device. Stop it from Activity, then start again.');
                            }
                            await context.scheduler.clearDeviceQueue(device.udid, {
                                pluginId: 'com.dfarming.tiktok',
                                taskType: 'doomscroll',
                                onlyQueued: true,
                            });
                        }
                        await context.scheduler.createTask({
                            deviceUdid: device.udid,
                            task: {
                                pluginId: 'com.dfarming.tiktok', taskType: 'doomscroll', taskVersion: 1,
                                payload: {
                                    durationMinutes: Number(body.durationMinutes), personality: body.personality,
                                    likeEnabled: body.likeEnabled === 'on', saveEnabled: body.saveEnabled === 'on',
                                    commentEnabled: body.commentEnabled === 'on',
                                    ...(body.commentText?.trim() ? { commentText: body.commentText.trim() } : {}),
                                    ...(body.account?.trim() ? { account: body.account.trim() } : {}),
                                },
                            },
                            timing,
                            runWindowMinutes: body.runWindowMinutes ? Number(body.runWindowMinutes) : undefined,
                        }, device.pluginData['com.dfarming.tiktok'] ?? {});
                        return reply.code(202).type('text/html').send(await context.renderActivity(device.udid));
                    } catch (error) {
                        const message = error instanceof Error ? error.message : String(error);
                        return reply.code(409).type('text/html').send(await context.renderActivity(device.udid, message));
                    }
                },
            );

            context.app.get<{ Params: { udid: string } }>('/api/devices/:udid/posts/current', async (request) => {
                const latest = (await context.scheduler.listExecutions(25, request.params.udid))
                    .find(({ pluginId, taskType }) => pluginId === 'com.dfarming.tiktok' && taskType === 'post');
                if (!latest) return { status: 'idle', logs: [] };
                const detail = await context.scheduler.execution(latest.id);
                return { ...latest, destination: latest.payload.destination ?? null, logs: detail?.logs ?? [] };
            });

            context.app.post<{ Params: { udid: string } }>('/api/devices/:udid/posts', async (request, reply) => {
                const device = await deviceData(request.params.udid);
                if (!device) return reply.code(404).send({ error: 'Device is not registered' });
                if (device.disabled) return reply.code(409).send({ error: 'This device is disconnected — reconnect it before posting' });
                const dataRoot = path.resolve(process.env.SCHEDULER_DATA_DIR ?? '.scheduler-data');
                const assetRoot = path.join(dataRoot, 'assets');
                await mkdir(assetRoot, { recursive: true });
                const directory = await mkdtemp(path.join(assetRoot, 'post-'));
                const files: Array<{ path: string; name: string; mimeType: string }> = [];
                const fields = new Map<string, string>();
                let assetIds: string[] = [];
                try {
                    for await (const part of request.parts()) {
                        if (part.type === 'field') { fields.set(part.fieldname, String(part.value)); continue; }
                        if (part.fieldname !== 'media') continue;
                        const name = path.basename(part.filename || `upload-${files.length + 1}`).replace(/[^a-zA-Z0-9._-]/g, '_');
                        const filePath = path.join(directory, `${String(files.length).padStart(2, '0')}-${name}`);
                        await pipeline(part.file, createWriteStream(filePath, { flags: 'wx' }));
                        if (part.file.truncated) throw new Error(`${name} exceeds the upload limit`);
                        files.push({ path: filePath, name, mimeType: part.mimetype });
                    }
                    if (files.length < 1 || files.length > 3) throw new Error('Choose one to three media files');
                    const videos = files.filter(({ mimeType }) => mimeType.startsWith('video/'));
                    const images = files.filter(({ mimeType }) => mimeType.startsWith('image/'));
                    if (!((videos.length === 1 && files.length === 1) || images.length === files.length)) {
                        throw new Error('Upload exactly one video, or upload only slideshow images');
                    }
                    const destination = fields.get('destination');
                    if (destination !== 'draft' && destination !== 'publish') throw new Error('Choose Draft or Post');
                    const account = fields.get('account')?.trim() || undefined;
                    const timing = fields.has('timing') ? JSON.parse(fields.get('timing')!) as ScheduleTiming : { kind: 'now' } as const;
                    const stored = await context.scheduler.registerAssets(await Promise.all(files.map(async (file) => ({
                        relativePath: path.relative(dataRoot, file.path), originalName: file.name, mimeType: file.mimeType,
                        size: (await stat(file.path)).size,
                        sha256: await hashFile(file.path),
                    }))));
                    assetIds = stored.map(({ id }) => id);
                    const schedule = await context.scheduler.createTask({
                        deviceUdid: device.udid,
                        task: {
                            pluginId: 'com.dfarming.tiktok', taskType: 'post', taskVersion: 1,
                            payload: {
                                media: stored.map(({ id, name, mimeType }) => ({ assetId: id, name, mimeType })),
                                destination,
                                ...(account ? { account } : {}),
                                ...(fields.get('caption')?.trim() ? { caption: fields.get('caption')!.trim() } : {}),
                                ...(fields.get('musicUrl')?.trim() ? { musicUrl: fields.get('musicUrl')!.trim() } : {}),
                                ...(fields.get('recurringPublishConfirmed') === 'true' ? { recurringPublishConfirmed: true } : {}),
                            },
                        },
                        timing,
                        runWindowMinutes: fields.get('runWindowMinutes') ? Number(fields.get('runWindowMinutes')) : undefined,
                    }, device.pluginData['com.dfarming.tiktok'] ?? {}, new Date(), assetIds);
                    return reply.code(202).send(schedule);
                } catch (error) {
                    if (assetIds.length) await context.scheduler.deleteAssets(assetIds);
                    await rm(directory, { recursive: true, force: true });
                    return reply.code(400).send({ error: error instanceof Error ? error.message : String(error) });
                }
            });

            context.app.get<{ Params: { udid: string } }>('/api/devices/:udid/tiktok/pipeline', async (request, reply) => {
                const device = await deviceData(request.params.udid);
                if (!device) return reply.code(404).send({ error: 'Device is not registered' });
                const pipeline = postPipelineFromPluginData(tiktokPluginData(device));
                const frequency = pipeline.frequency ?? 'production';
                const staggerMinutes = pipeline.staggerMinutes ?? 0;
                const items = await context.scheduler.listPipelineItems(device.udid);
                const fleet = activeDFarmingDevices(await context.loadDevices());
                return {
                    enabled: pipeline.enabled === true,
                    frequency,
                    frequencyLabel: pipelineFrequencyLabel(frequency),
                    fleet: pipeline.fleet === true,
                    staggerMinutes,
                    farmIndex: farmOrderIndex(device.name),
                    checkTimes: pipelineCheckSummary(frequency, staggerMinutes),
                    scheduleIds: pipeline.scheduleIds ?? [],
                    items,
                    fleetPreview: fleet.map((entry, order) => {
                        const slot = farmStaggerSlot(entry.name, fleet.map((d) => d.name));
                        return {
                            udid: entry.udid,
                            name: entry.name,
                            farmIndex: farmOrderIndex(entry.name),
                            staggerMinutes: slot * PIPELINE_STAGGER_MINUTES,
                            order: order + 1,
                        };
                    }),
                };
            });

            context.app.post<{ Params: { udid: string } }>('/api/devices/:udid/tiktok/pipeline/items', async (request, reply) => {
                const device = await deviceData(request.params.udid);
                if (!device) return reply.code(404).send({ error: 'Device is not registered' });
                if (device.disabled) return reply.code(409).send({ error: 'This device is disconnected — reconnect it before queuing' });
                const dataRoot = path.resolve(process.env.SCHEDULER_DATA_DIR ?? '.scheduler-data');
                const assetRoot = path.join(dataRoot, 'assets');
                await mkdir(assetRoot, { recursive: true });
                const directory = await mkdtemp(path.join(assetRoot, 'pipeline-'));
                let assetIds: string[] = [];
                try {
                    const fields = new Map<string, string>();
                    let video: { path: string; name: string; mimeType: string } | undefined;
                    for await (const part of request.parts()) {
                        if (part.type === 'field') { fields.set(part.fieldname, String(part.value)); continue; }
                        if (part.fieldname !== 'media' && part.fieldname !== 'video') continue;
                        if (video) throw new Error('Upload exactly one video');
                        const name = path.basename(part.filename || 'upload.mp4').replace(/[^a-zA-Z0-9._-]/g, '_');
                        const filePath = path.join(directory, name);
                        await pipeline(part.file, createWriteStream(filePath, { flags: 'wx' }));
                        if (part.file.truncated) throw new Error(`${name} exceeds the upload limit`);
                        if (!part.mimetype.startsWith('video/')) throw new Error('Pipeline accepts video only for now');
                        video = { path: filePath, name, mimeType: part.mimetype };
                    }
                    if (!video) throw new Error('Choose a video file');
                    const caption = fields.get('caption')?.trim() || fields.get('title')?.trim() || '';
                    if (!caption) throw new Error('Add a title / caption');
                    if (caption.length > 2200) throw new Error('Caption must be 2,200 characters or fewer');
                    const fleet = fields.get('fleet') === 'true' || fields.get('scope') === 'fleet';
                    const targets = fleet
                        ? activeDFarmingDevices(await context.loadDevices())
                        : [device];
                    if (!targets.length) throw new Error('No connected devices available for the pipeline');
                    const created = [];
                    for (const target of targets) {
                        const targetDir = await mkdtemp(path.join(assetRoot, 'pipeline-'));
                        const targetPath = path.join(targetDir, video.name);
                        await copyFile(video.path, targetPath);
                        const stored = await context.scheduler.registerAssets([{
                            relativePath: path.relative(dataRoot, targetPath),
                            originalName: video.name,
                            mimeType: video.mimeType,
                            size: (await stat(targetPath)).size,
                            sha256: await hashFile(targetPath),
                        }]);
                        assetIds.push(...stored.map(({ id }) => id));
                        created.push(await context.scheduler.enqueuePipelineItem({
                            deviceUdid: target.udid,
                            assetId: stored[0]!.id,
                            caption,
                        }));
                    }
                    await rm(directory, { recursive: true, force: true });
                    return reply.code(201).send(fleet ? { fleet: true, items: created } : created[0]);
                } catch (error) {
                    if (assetIds.length) await context.scheduler.deleteAssets(assetIds);
                    await rm(directory, { recursive: true, force: true });
                    return reply.code(400).send({ error: error instanceof Error ? error.message : String(error) });
                }
            });

            context.app.delete<{ Params: { udid: string; id: string } }>('/api/devices/:udid/tiktok/pipeline/items/:id', async (request, reply) => {
                const device = await deviceData(request.params.udid);
                if (!device) return reply.code(404).send({ error: 'Device is not registered' });
                const item = await context.scheduler.cancelPipelineItem(request.params.id, device.udid);
                if (!item) return reply.code(404).send({ error: 'Pipeline item not found or already in flight' });
                return { ok: true, item };
            });

            const applyPipelineAuto = async (
                targets: RegisteredDevice[],
                enabled: boolean,
                frequency: PipelineFrequency,
                fleet: boolean,
            ) => {
                const createdByDevice: Array<{
                    udid: string; name: string; staggerMinutes: number; scheduleIds: string[];
                }> = [];
                const allCreated: string[] = [];
                const names = targets.map((entry) => entry.name);
                try {
                    for (const target of targets) {
                        const pluginData = tiktokPluginData(target);
                        const current = postPipelineFromPluginData(pluginData);
                        for (const id of current.scheduleIds ?? []) {
                            try { await context.scheduler.setScheduleStatus(id, 'cancelled'); } catch { /* already gone */ }
                        }
                        const slot = farmStaggerSlot(target.name, names);
                        const staggerMinutes = fleet ? slot * PIPELINE_STAGGER_MINUTES : 0;
                        const createdIds: string[] = [];
                        if (enabled) {
                            for (const timing of pipelineTimingsForDevice(frequency, staggerMinutes)) {
                                const schedule = await context.scheduler.createTask({
                                    deviceUdid: target.udid,
                                    task: {
                                        pluginId: 'com.dfarming.tiktok',
                                        taskType: 'pipeline-drain',
                                        taskVersion: 1,
                                        payload: {},
                                    },
                                    timing,
                                    runWindowMinutes: frequency === 'production' ? 45 : Math.max(5, Number(frequency) + 2),
                                }, pluginData);
                                createdIds.push(schedule.id);
                                allCreated.push(schedule.id);
                            }
                        }
                        const next = withPostPipeline(pluginData, {
                            enabled, frequency, fleet, staggerMinutes, scheduleIds: createdIds,
                        });
                        await context.mutateDevices((devices) => {
                            const row = devices.find((entry) => entry.udid === target.udid);
                            if (!row) throw new Error(`Device ${target.name} disappeared while updating pipeline`);
                            row.pluginData['com.dfarming.tiktok'] = next;
                        });
                        createdByDevice.push({
                            udid: target.udid, name: target.name, staggerMinutes, scheduleIds: createdIds,
                        });
                    }
                    return {
                        enabled,
                        frequency,
                        frequencyLabel: pipelineFrequencyLabel(frequency),
                        fleet,
                        staggerStepMinutes: PIPELINE_STAGGER_MINUTES,
                        devices: createdByDevice,
                    };
                } catch (error) {
                    for (const id of allCreated) {
                        try { await context.scheduler.setScheduleStatus(id, 'cancelled'); } catch { /* ignore */ }
                    }
                    throw error;
                }
            };

            context.app.post<{
                Params: { udid: string };
                Body: { enabled?: boolean; frequency?: string; scope?: string; fleet?: boolean };
            }>('/api/devices/:udid/tiktok/pipeline/auto', async (request, reply) => {
                const device = await deviceData(request.params.udid);
                if (!device) return reply.code(404).send({ error: 'Device is not registered' });
                if (device.disabled) return reply.code(409).send({ error: 'This device is disconnected' });
                const enabled = request.body?.enabled === true;
                const frequency = parsePipelineFrequency(request.body?.frequency);
                const fleet = request.body?.fleet === true || request.body?.scope === 'fleet';
                try {
                    const targets = fleet
                        ? activeDFarmingDevices(await context.loadDevices())
                        : [device];
                    if (!targets.length) return reply.code(409).send({ error: 'No active devices for fleet pipeline' });
                    const result = await applyPipelineAuto(targets, enabled, frequency, fleet);
                    const self = result.devices.find((entry) => entry.udid === device.udid) ?? result.devices[0]!;
                    return {
                        ...result,
                        staggerMinutes: self.staggerMinutes,
                        checkTimes: pipelineCheckSummary(frequency, self.staggerMinutes),
                        scheduleIds: self.scheduleIds,
                    };
                } catch (error) {
                    return reply.code(400).send({ error: error instanceof Error ? error.message : String(error) });
                }
            });

            context.app.post<{ Params: { udid: string } }>('/api/devices/:udid/tiktok/pipeline/check-now', async (request, reply) => {
                const device = await deviceData(request.params.udid);
                if (!device) return reply.code(404).send({ error: 'Device is not registered' });
                if (device.disabled) return reply.code(409).send({ error: 'This device is disconnected' });
                try {
                    const schedule = await context.scheduler.createTask({
                        deviceUdid: device.udid,
                        task: {
                            pluginId: 'com.dfarming.tiktok',
                            taskType: 'pipeline-drain',
                            taskVersion: 1,
                            payload: {},
                        },
                        timing: { kind: 'now' },
                        runWindowMinutes: 45,
                    }, device.pluginData['com.dfarming.tiktok'] ?? {});
                    return reply.code(202).send(schedule);
                } catch (error) {
                    return reply.code(400).send({ error: error instanceof Error ? error.message : String(error) });
                }
            });
        },
    };
}
