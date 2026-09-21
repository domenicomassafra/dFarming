import { Readable } from 'node:stream';

import Fastify from 'fastify';

import { loadRegisteredDevices, mutateRegisteredDevices, normalizeDeviceTags, redactDevice, type RegisteredDevice } from './devices/registry.js';
import { RegistryWdaRemoteControl } from './devices/registry-remote.js';
import { requestWdaService } from './devices/wda-service-client.js';
import type { DeviceConnectionStatus } from './devices/connection-manager.js';
import type { RemoteAction } from './devices/wda-remote.js';
import type { JsonObject } from './types.js';
import { detectHostCapabilities } from './hosts/capabilities.js';
import {
    discoverRuntimeDevices, filterRuntimeDevicesForWorker, registerRuntimeDevice,
    workerAllowsOperationalDevice, workerAllowsRuntimeDevice,
} from './devices/runtime-discovery.js';
import { changeVirtualRuntimeState, listVirtualRuntimes, type VirtualRuntimePlatform } from './devices/virtual-runtime.js';
import { DEVICE_WORKER_PROTOCOL_VERSION } from './device-workers.js';
import { physicalIosLaneEnabled } from './runtime-options.js';
import { isEntrypoint } from './entrypoint.js';
import { bearerMatches } from './security/bearer.js';

async function localConnectionStatus(
    udid: string,
    known?: { registered: RegisteredDevice; connected: boolean },
): Promise<DeviceConnectionStatus> {
    try {
        const response = await requestWdaService('/devices', { timeoutMs: 2_000 });
        if (response.statusCode >= 200 && response.statusCode < 300) {
            const status = (JSON.parse(response.body) as { devices: DeviceConnectionStatus[] }).devices.find((entry) => entry.udid === udid);
            if (status) return status;
        }
    } catch { /* fall through to direct probes */ }
    const registered = known?.registered ?? await requireWorkerDevice(udid);
    const connected = known?.connected ?? (await discoverWorkerRuntimeDevices()).some((device) => device.udid === udid);
    const backend = registered.automationBackend
        ?? ((registered.platform ?? 'ios') === 'ios' && (registered.kind ?? 'physical') === 'physical' ? 'wda' : 'appium');
    const appiumHost = backend === 'appium'
        ? (process.env.APPIUM_RUNTIME_HOST ?? '127.0.0.1')
        : (process.env.APPIUM_HOST ?? '127.0.0.1');
    const appiumPort = backend === 'appium'
        ? Number(process.env.APPIUM_RUNTIME_PORT ?? 4726)
        : Number(process.env.APPIUM_PORT ?? 4725);
    const appiumReady = await fetch(`http://${appiumHost}:${appiumPort}/status`, {
        signal: AbortSignal.timeout(2_000),
    }).then((response) => response.ok).catch(() => false);
    if (backend === 'appium') {
        const ready = connected && appiumReady;
        return {
            udid,
            physical: connected ? 'connected' : 'disconnected',
            wda: ready ? 'ready' : connected ? 'connecting' : 'disconnected',
            appium: appiumReady ? 'ready' : 'unavailable',
            managed: false,
            message: ready ? 'Appium runtime is ready' : connected ? 'Waiting for Appium' : 'Start or reconnect this runtime',
            retryCount: 0,
            updatedAt: new Date().toISOString(),
        };
    }
    let wda = false;
    try {
        wda = (await fetch(`http://127.0.0.1:${registered.wdaLocalPort ?? 8100}/status`, { signal: AbortSignal.timeout(2_000) })).ok;
    } catch { /* unavailable */ }
    return {
        udid,
        physical: connected ? 'connected' : 'disconnected',
        wda: wda ? 'ready' : connected ? 'connecting' : 'disconnected',
        appium: appiumReady ? 'ready' : 'unavailable',
        managed: false,
        message: wda ? 'WDA is ready' : connected ? 'Waiting for WDA' : 'Reconnect the USB cable',
        retryCount: 0,
        updatedAt: new Date().toISOString(),
    };
}

async function discoverWorkerRuntimeDevices() {
    const allowPhysical = physicalIosLaneEnabled();
    return filterRuntimeDevicesForWorker(await discoverRuntimeDevices({ includePhysical: allowPhysical }), allowPhysical);
}

async function requireWorkerDevice(udid: string): Promise<RegisteredDevice> {
    const registered = (await loadRegisteredDevices()).find((device) => device.udid === udid);
    if (!registered || !workerAllowsRuntimeDevice(registered, physicalIosLaneEnabled())) {
        throw Object.assign(new Error('Device is unavailable on this worker'), { statusCode: 404 });
    }
    if (!workerAllowsOperationalDevice(registered, physicalIosLaneEnabled())) {
        throw Object.assign(new Error('Device is disabled on this worker'), { statusCode: 409 });
    }
    return registered;
}

export type WorkerDeviceConfigPatch = Partial<Pick<
    RegisteredDevice,
    'name' | 'tags' | 'coordinateProfile' | 'coordinates' | 'instagramCoordinates' | 'disabled'
>> & { pluginData?: Record<string, JsonObject> };

/**
 * Apply control-plane metadata without tearing down a live transport session
 * for ordinary/idempotent configuration syncs. Appium sessions do not depend
 * on names, tags, plugin metadata or coordinate calibration. WDA only needs a
 * rebuild when its passcode keypad profile changes. Disabling/enabling a
 * device is an explicit lifecycle transition and may release the transport.
 */
export function applyWorkerDeviceConfig(device: RegisteredDevice, patch: WorkerDeviceConfigPatch): boolean {
    const backend = device.automationBackend
        ?? ((device.platform ?? 'ios') === 'ios' && (device.kind ?? 'physical') === 'physical' ? 'wda' : 'appium');
    const previousProfile = device.coordinateProfile;
    const previouslyDisabled = device.disabled === true;

    if (patch.name !== undefined) device.name = patch.name;
    if (patch.tags !== undefined) {
        const tags = normalizeDeviceTags(patch.tags);
        if (tags.length) device.tags = tags;
        else delete device.tags;
    }
    if (patch.coordinateProfile !== undefined) device.coordinateProfile = patch.coordinateProfile;
    if (patch.coordinates !== undefined) device.coordinates = patch.coordinates;
    if (patch.instagramCoordinates !== undefined) device.instagramCoordinates = patch.instagramCoordinates;
    if (patch.pluginData !== undefined) device.pluginData = patch.pluginData;
    if (patch.disabled === true) device.disabled = true;
    else if (patch.disabled === false) delete device.disabled;

    const disabledChanged = previouslyDisabled !== (device.disabled === true);
    const wdaProfileChanged = backend === 'wda' && previousProfile !== device.coordinateProfile;
    return disabledChanged || wdaProfileChanged;
}

export interface StartDeviceWorkerServerOptions {
    host?: string;
    port?: number;
    token?: string;
    workerId?: string;
    logger?: boolean;
}

export async function startDeviceWorkerServer(options: StartDeviceWorkerServerOptions = {}) {
    const host = options.host ?? process.env.DEVICE_WORKER_HOST ?? '127.0.0.1';
    const port = options.port ?? Number(process.env.DEVICE_WORKER_PORT ?? 3010);
    const token = options.token ?? process.env.PHONE_FARM_DEVICE_WORKER_TOKEN;
    const workerId = options.workerId ?? process.env.PHONE_FARM_WORKER_ID ?? 'mac-worker';
    const nonLoopback = !['127.0.0.1', '::1', 'localhost'].includes(host);
    if (nonLoopback && !token) throw new Error('PHONE_FARM_DEVICE_WORKER_TOKEN is required when the device worker binds outside loopback');
    if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) throw new Error('DEVICE_WORKER_PORT must be a valid TCP port');

    const app = Fastify({ logger: options.logger ?? false, bodyLimit: 128 * 1024 });
    const remote = new RegistryWdaRemoteControl();
    app.addHook('onRequest', async (request, reply) => {
        if (!token) return;
        if (!bearerMatches(request.headers.authorization, token)) {
            return reply.code(401).send({ error: 'Device worker authentication required' });
        }
    });

    app.get('/health', async () => {
        const snapshot = await detectHostCapabilities({ id: workerId });
        const platforms: Array<'ios' | 'android'> = [];
        if (snapshot.capabilities.some((capability) => capability.startsWith('ios.'))) platforms.push('ios');
        if (snapshot.capabilities.some((capability) => capability.startsWith('android.'))) platforms.push('android');
        return {
            ok: true as const,
            role: 'device-worker' as const,
            workerId,
            protocolVersion: DEVICE_WORKER_PROTOCOL_VERSION,
            platforms,
        };
    });
    app.get('/v1/host', async () => detectHostCapabilities({ id: workerId }));
    app.get('/v1/runtime-devices', async () => ({ devices: await discoverWorkerRuntimeDevices() }));
    app.get('/v1/virtual-runtimes', async () => ({ runtimes: await listVirtualRuntimes() }));
    app.post<{ Params: { platform: VirtualRuntimePlatform; id: string; action: 'boot' | 'shutdown' } }>(
        '/v1/virtual-runtimes/:platform/:id/:action', async (request, reply) => {
            if (!['ios', 'android'].includes(request.params.platform) || !['boot', 'shutdown'].includes(request.params.action)) {
                return reply.code(400).send({ error: 'Unsupported virtual runtime action' });
            }
            await changeVirtualRuntimeState(request.params.platform, request.params.id, request.params.action);
            return reply.code(202).send({ ok: true });
        },
    );
    app.post<{ Params: { udid: string }; Body: { name?: string } }>('/v1/runtime-devices/:udid/register', async (request, reply) => {
        const device = await registerRuntimeDevice(request.params.udid, {
            name: request.body?.name,
            includePhysical: physicalIosLaneEnabled(),
        });
        return reply.code(201).send({ device: redactDevice(device) });
    });
    app.get('/v1/devices', async () => {
        const [allRegistered, connected] = await Promise.all([loadRegisteredDevices(), discoverWorkerRuntimeDevices()]);
        const registered = allRegistered.filter((device) => workerAllowsRuntimeDevice(device, physicalIosLaneEnabled()));
        const online = new Map(connected.map((device) => [device.udid, device]));
        const statuses = await Promise.all(registered.map(async (device) => {
            try {
                return await localConnectionStatus(device.udid, {
                    registered: device,
                    connected: !device.disabled && online.has(device.udid),
                });
            } catch { return undefined; }
        }));
        return {
            workerId,
            devices: registered.map((device, index) => ({
                registered: redactDevice(device),
                connected: device.disabled ? null : online.get(device.udid) ?? null,
                ...(statuses[index] ? { status: statuses[index] } : {}),
            })),
        };
    });

    app.get<{ Params: { udid: string } }>('/v1/devices/:udid/info', async (request, reply) => {
        await requireWorkerDevice(request.params.udid);
        const device = (await discoverWorkerRuntimeDevices()).find(({ udid }) => udid === request.params.udid);
        if (!device) return reply.code(404).send({ error: 'Device is not connected to this worker' });
        return remote.getScreenInfo(device.udid);
    });
    app.get<{ Params: { udid: string } }>('/v1/devices/:udid/source', async (request) => {
        await requireWorkerDevice(request.params.udid);
        return remote.getAccessibilityTree(request.params.udid);
    });
    app.get<{ Params: { udid: string } }>('/v1/devices/:udid/screenshot', async (request, reply) => {
        await requireWorkerDevice(request.params.udid);
        return reply.header('cache-control', 'no-store').type('image/png').send(await remote.getScreenshot(request.params.udid));
    });
    app.get<{ Params: { udid: string } }>('/v1/devices/:udid/stream', async (request, reply) => {
        await requireWorkerDevice(request.params.udid);
        const abort = new AbortController();
        request.raw.once('close', () => abort.abort());
        const upstream = await remote.getMjpegStream(request.params.udid, abort.signal);
        if (!upstream.body) return reply.code(503).send({ error: 'Device stream is unavailable' });
        return reply.header('cache-control', 'no-store, no-cache, must-revalidate')
            .type(upstream.headers.get('content-type') ?? 'multipart/x-mixed-replace; boundary=--BoundaryString')
            .send(Readable.from(upstream.body as AsyncIterable<Uint8Array>));
    });
    app.get<{ Params: { udid: string } }>('/v1/devices/:udid/h264', async (request, reply) => {
        if (!remote.getH264Stream) return reply.code(501).send({ error: 'Optimized H.264 transport is unavailable' });
        const abort = new AbortController();
        request.raw.once('close', () => abort.abort());
        try {
            const upstream = await remote.getH264Stream(request.params.udid, abort.signal);
            if (!upstream.body) return reply.code(503).send({ error: 'H.264 stream is unavailable' });
            return reply.header('cache-control', 'no-store, no-cache, must-revalidate')
                .header('x-mobile-farm-video-backend', upstream.headers.get('x-mobile-farm-video-backend') ?? 'h264')
                .type(upstream.headers.get('content-type') ?? 'video/h264')
                .send(Readable.from(upstream.body as AsyncIterable<Uint8Array>));
        } catch (error) {
            return reply.code(503).send({ error: error instanceof Error ? error.message : String(error) });
        }
    });
    app.post<{ Params: { udid: string }; Body: RemoteAction }>('/v1/devices/:udid/action', async (request) => {
        await requireWorkerDevice(request.params.udid);
        await remote.performAction(request.params.udid, request.body);
        return { ok: true };
    });
    app.get<{ Params: { udid: string } }>('/v1/devices/:udid/locked', async (request) => {
        await requireWorkerDevice(request.params.udid);
        return { locked: await remote.isLocked(request.params.udid) };
    });
    app.get<{ Params: { udid: string } }>('/v1/devices/:udid/connection', async (request) => localConnectionStatus(request.params.udid));
    app.post<{ Params: { udid: string } }>('/v1/devices/:udid/reconnect', async (request, reply) => {
        const registered = await requireWorkerDevice(request.params.udid);
        const backend = registered?.automationBackend
            ?? ((registered?.platform ?? 'ios') === 'ios' && (registered?.kind ?? 'physical') === 'physical' ? 'wda' : 'appium');
        if (backend === 'appium') {
            remote.forget(request.params.udid);
            return reply.code(202).send(await localConnectionStatus(request.params.udid));
        }
        try {
            const response = await requestWdaService(`/devices/${encodeURIComponent(request.params.udid)}/reconnect`, { method: 'POST', timeoutMs: 7_000 });
            if (response.statusCode === 404) return reply.code(404).send({ error: 'Device is not supervised on this worker' });
            return reply.code(response.statusCode).send(JSON.parse(response.body));
        } catch {
            remote.forget(request.params.udid);
            return reply.code(202).send(await localConnectionStatus(request.params.udid));
        }
    });
    app.patch<{
        Params: { udid: string };
        Body: WorkerDeviceConfigPatch;
    }>('/v1/devices/:udid/config', async (request, reply) => {
        let found = false;
        let resetTransport = false;
        await mutateRegisteredDevices((devices) => {
            const device = devices.find(({ udid }) => udid === request.params.udid);
            if (!device) return;
            found = true;
            resetTransport = applyWorkerDeviceConfig(device, request.body);
        });
        if (!found) return reply.code(404).send({ error: 'Device is not registered on this worker' });
        if (resetTransport) remote.forget(request.params.udid);
        return { ok: true };
    });

    await app.listen({ host, port });
    console.log(`dFarming device worker ${workerId} listening on http://${host}:${port}`);
    return app;
}

async function main(): Promise<void> {
    const app = await startDeviceWorkerServer({ logger: true });
    const shutdown = async () => { await app.close(); };
    process.once('SIGINT', () => void shutdown());
    process.once('SIGTERM', () => void shutdown());
}

if (isEntrypoint(import.meta.url)) await main();
