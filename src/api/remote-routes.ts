import crypto from 'node:crypto';
import { Readable } from 'node:stream';

import type { FastifyInstance } from 'fastify';

import type { DeviceConnectionStatus } from '../devices/connection-manager.js';
import { dfarmingEnv } from '../env.js';
import type { Device } from '../devices/discovery.js';
import { loadRegisteredDevices } from '../devices/registry.js';
import type { RemoteAction, RemoteControl } from '../devices/wda-remote.js';
import { requestWdaService } from '../devices/wda-service-client.js';
import type { SchedulerRepository } from '../scheduler/repository.js';
import { SemanticController } from '../semantic/controller.js';
import { StreamTokenService } from '../security/stream-token.js';

export interface RemoteRouteOptions {
    remote: RemoteControl;
    scheduler: SchedulerRepository;
    discoverDevices: () => Promise<Device[]>;
    semanticTraceRoot?: string;
    requireStreamToken?: boolean;
    streamTokenSecret?: string;
    connectionStatus?: (udid: string) => Promise<DeviceConnectionStatus | undefined>;
    reconnectDevice?: (udid: string) => Promise<DeviceConnectionStatus | undefined>;
}

type FleetStreamLease = {
    abort: AbortController;
    done: Promise<void>;
    stop: () => Promise<void>;
};

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

export function registerRemoteControlRoutes(app: FastifyInstance, options: RemoteRouteOptions): void {
    const { remote, scheduler, discoverDevices } = options;
    const semantic = new SemanticController(remote, options.semanticTraceRoot);
    const streamTokens = new StreamTokenService(
        options.streamTokenSecret ?? dfarmingEnv('STREAM_SECRET') ?? crypto.randomBytes(32),
    );
    let fleetStreamLease: FleetStreamLease | undefined;

    app.get<{ Params: { udid: string } }>('/api/devices/:udid/remote/info', async (request, reply) => {
        const device = (await discoverDevices()).find(({ udid }) => udid === request.params.udid);
        if (!device) return reply.code(404).send({ error: 'Device is not connected' });
        return { device, screen: await remote.getScreenInfo(device.udid) };
    });

    app.get<{ Params: { udid: string } }>('/api/devices/:udid/remote/screenshot', async (request, reply) => {
        try {
            return reply.header('cache-control', 'no-store').type('image/png')
                .send(await remote.getScreenshot(request.params.udid));
        } catch {
            return reply.code(503).header('cache-control', 'no-store').send();
        }
    });

    app.post<{ Params: { udid: string }; Querystring: { scope?: string } }>(
        '/api/devices/:udid/remote/stream-token',
        async (request) => {
            const base = `/api/devices/${encodeURIComponent(request.params.udid)}/remote/stream`;
            const scope = request.query.scope === 'fleet' ? 'fleet' : undefined;
            if (!options.requireStreamToken) {
                const query = new URLSearchParams({ t: String(Date.now()), ...(scope ? { scope } : {}) });
                return { url: `${base}?${query}`, expiresAt: null };
            }
            const capability = streamTokens.issue(request.params.udid);
            const query = new URLSearchParams({
                exp: String(capability.expiresAt),
                sig: capability.signature,
                ...(scope ? { scope } : {}),
            });
            return { url: `${base}?${query}`, expiresAt: new Date(capability.expiresAt).toISOString() };
        },
    );

    app.get<{
        Params: { udid: string };
        Querystring: { exp?: string; sig?: string; scope?: string };
    }>('/api/devices/:udid/remote/stream', async (request, reply) => {
        if (options.requireStreamToken) {
            const expiresAt = Number(request.query.exp);
            const signature = request.query.sig ?? '';
            if (!streamTokens.verify(request.params.udid, expiresAt, signature)) {
                return reply.code(403).send({ error: 'Stream capability is missing, invalid, or expired' });
            }
        }

        if (request.query.scope === 'fleet' && fleetStreamLease) {
            const previous = fleetStreamLease;
            const stopped = await Promise.race([
                previous.stop().then(() => true),
                new Promise<false>((resolve) => setTimeout(() => resolve(false), 2_000)),
            ]);
            if (!stopped) {
                return reply.code(409).send({ error: 'Previous focused fleet stream is still closing; retry live.' });
            }
            if (fleetStreamLease === previous) fleetStreamLease = undefined;
        }

        const abort = new AbortController();
        let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
        let resolveDone!: () => void;
        let doneResolved = false;
        const done = new Promise<void>((resolve) => { resolveDone = resolve; });

        const finishUpstream = async () => {
            if (doneResolved) return;
            doneResolved = true;
            try { await reader?.cancel(); } catch { /* already aborted/closed */ }
            await new Promise<void>((resolve) => setTimeout(resolve, 350));
            resolveDone();
        };

        let stopPromise: Promise<void> | undefined;
        const stop = () => {
            if (!stopPromise) {
                stopPromise = (async () => {
                    abort.abort();
                    try { await reader?.cancel(); } catch { /* already closed */ }
                    await done;
                })();
            }
            return stopPromise;
        };

        const isFleetStream = request.query.scope === 'fleet';
        const lease: FleetStreamLease = { abort, done, stop };
        if (isFleetStream) {
            fleetStreamLease = lease;
            reply.raw.once('close', () => { void stop(); });
        } else {
            request.raw.once('close', () => abort.abort());
        }

        try {
            const upstream = await remote.getMjpegStream(request.params.udid, abort.signal);
            if (!upstream.body) {
                await finishUpstream();
                if (fleetStreamLease === lease) fleetStreamLease = undefined;
                return reply.code(503).send({ error: 'Device stream is unavailable' });
            }
            reader = upstream.body.getReader();
            const streamBody = async function* () {
                try {
                    while (true) {
                        const chunk = await reader!.read();
                        if (chunk.done) break;
                        if (chunk.value) yield chunk.value;
                    }
                } finally {
                    await finishUpstream();
                    if (fleetStreamLease === lease) fleetStreamLease = undefined;
                }
            };
            return reply.header('cache-control', 'no-store, no-cache, must-revalidate')
                .type(upstream.headers.get('content-type') ?? 'multipart/x-mixed-replace; boundary=--BoundaryString')
                .send(Readable.from(streamBody()));
        } catch (error) {
            await finishUpstream();
            if (fleetStreamLease === lease) fleetStreamLease = undefined;
            throw error;
        }
    });

    app.post<{ Params: { udid: string } }>('/api/devices/:udid/remote/h264-token', async (request, reply) => {
        if (!remote.getH264Stream) return reply.code(501).send({ error: 'Optimized H.264 transport is unavailable' });
        const base = `/api/devices/${encodeURIComponent(request.params.udid)}/remote/h264`;
        if (!options.requireStreamToken) return { url: `${base}?t=${Date.now()}`, expiresAt: null };
        const capability = streamTokens.issue(request.params.udid);
        const query = new URLSearchParams({ exp: String(capability.expiresAt), sig: capability.signature });
        return { url: `${base}?${query}`, expiresAt: new Date(capability.expiresAt).toISOString() };
    });

    app.get<{
        Params: { udid: string };
        Querystring: { exp?: string; sig?: string };
    }>('/api/devices/:udid/remote/h264', async (request, reply) => {
        if (!remote.getH264Stream) return reply.code(501).send({ error: 'Optimized H.264 transport is unavailable' });
        if (options.requireStreamToken) {
            const expiresAt = Number(request.query.exp);
            const signature = request.query.sig ?? '';
            if (!streamTokens.verify(request.params.udid, expiresAt, signature)) {
                return reply.code(403).send({ error: 'Stream capability is missing, invalid, or expired' });
            }
        }
        const abort = new AbortController();
        request.raw.once('close', () => abort.abort());
        try {
            const upstream = await remote.getH264Stream(request.params.udid, abort.signal);
            if (!upstream.body) return reply.code(503).send({ error: 'H.264 stream is unavailable' });
            return reply.header('cache-control', 'no-store, no-cache, must-revalidate')
                .header(
                    'x-dfarming-video-backend',
                    upstream.headers.get('x-dfarming-video-backend')
                        ?? upstream.headers.get('x-mobile-farm-video-backend')
                        ?? 'h264',
                )
                .type(upstream.headers.get('content-type') ?? 'video/h264')
                .send(Readable.from(upstream.body as AsyncIterable<Uint8Array>));
        } catch (error) {
            return reply.code(503).send({ error: errorMessage(error) });
        }
    });

    app.post<{ Params: { udid: string }; Body: RemoteAction }>('/api/devices/:udid/remote/action', async (request, reply) => {
        if (await scheduler.activeExecution(request.params.udid)) {
            return reply.code(409).send({ error: 'Remote input is disabled while automation is running' });
        }
        await remote.performAction(request.params.udid, request.body);
        return { ok: true };
    });

    app.get<{
        Params: { udid: string };
        Querystring: { query?: string; maxNodes?: string };
    }>('/api/devices/:udid/semantic/snapshot', async (request) => semantic.snapshot(request.params.udid, {
        ...(request.query.query ? { query: request.query.query } : {}),
        ...(request.query.maxNodes ? { maxNodes: Number(request.query.maxNodes) } : {}),
    }));

    app.post<{
        Params: { udid: string };
        Body: { generation: number; ref: string };
    }>('/api/devices/:udid/semantic/tap', async (request, reply) => {
        if (await scheduler.activeExecution(request.params.udid)) {
            return reply.code(409).send({ error: 'Semantic input is disabled while automation is running' });
        }
        return semantic.tapRef(request.params.udid, request.body.generation, request.body.ref);
    });

    app.post<{
        Params: { udid: string };
        Body: { text: string };
    }>('/api/devices/:udid/semantic/type', async (request, reply) => {
        if (await scheduler.activeExecution(request.params.udid)) {
            return reply.code(409).send({ error: 'Semantic input is disabled while automation is running' });
        }
        return semantic.typeText(request.params.udid, request.body.text);
    });

    app.post<{
        Params: { udid: string };
        Body: { text: string; type?: string; timeoutMs?: number; pollMs?: number };
    }>('/api/devices/:udid/semantic/wait', async (request) => semantic.waitForText(request.params.udid, request.body.text, {
        ...(request.body.type ? { type: request.body.type } : {}),
        ...(request.body.timeoutMs !== undefined ? { timeoutMs: request.body.timeoutMs } : {}),
        ...(request.body.pollMs !== undefined ? { pollMs: request.body.pollMs } : {}),
    }));

    app.get<{ Params: { udid: string } }>('/api/devices/:udid/connection', async (request, reply) => {
        const registered = (await loadRegisteredDevices()).find(({ udid }) => udid === request.params.udid);
        if (!registered) return reply.code(404).send({ error: 'Device is not registered' });
        if (options.connectionStatus) {
            const status = await options.connectionStatus(registered.udid);
            return status ?? reply.code(503).send({ error: 'Owning device worker is unavailable' });
        }

        try {
            const response = await requestWdaService('/devices', { timeoutMs: 2_000 });
            if (response.statusCode >= 200 && response.statusCode < 300) {
                const status = (JSON.parse(response.body).devices as DeviceConnectionStatus[])
                    .find((entry) => entry.udid === registered.udid);
                if (status) return status;
            }
        } catch { /* supervisor socket unavailable — fall back to a probe */ }

        const connected = (await discoverDevices()).some(({ udid }) => udid === registered.udid);
        let wda = false;
        try {
            wda = (await fetch(`http://127.0.0.1:${registered.wdaLocalPort ?? 8100}/status`, {
                signal: AbortSignal.timeout(2_000),
            })).ok;
        } catch { /* WDA not up */ }

        const fallback: DeviceConnectionStatus = {
            udid: registered.udid,
            physical: connected ? 'connected' : 'disconnected',
            wda: wda ? 'ready' : connected ? 'connecting' : 'disconnected',
            appium: 'unavailable',
            managed: false,
            message: wda ? 'WDA is ready' : connected ? 'Waiting for WDA' : 'Reconnect the USB cable',
            retryCount: 0,
            updatedAt: new Date().toISOString(),
        };
        return fallback;
    });

    app.post<{ Params: { udid: string } }>('/api/devices/:udid/reconnect', async (request, reply) => {
        if (await scheduler.activeExecution(request.params.udid)) {
            return reply.code(409).send({ error: 'Cannot reconnect while automation is running' });
        }
        remote.forget?.(request.params.udid);
        if (options.reconnectDevice) {
            const status = await options.reconnectDevice(request.params.udid);
            return reply.code(202).send(status ?? { ok: true, message: 'Reconnect requested on device worker' });
        }
        return reply.code(202).send({ ok: true, message: 'The shared WDA supervisor will reconnect automatically' });
    });
}
