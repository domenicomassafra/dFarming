import type { FastifyInstance } from 'fastify';

import type { RuntimeDevice } from '../devices/runtime-discovery.js';
import type { VirtualRuntime, VirtualRuntimePlatform } from '../devices/virtual-runtime.js';

export interface RuntimeRouteOptions {
    runtimeCandidates?: () => Promise<Array<RuntimeDevice & { workerId?: string }>>;
    registerRuntime?: (workerId: string | undefined, udid: string, name?: string) => Promise<void>;
    virtualRuntimes?: () => Promise<Array<VirtualRuntime & { workerId?: string }>>;
    changeVirtualRuntimeState?: (
        workerId: string | undefined,
        platform: VirtualRuntimePlatform,
        id: string,
        action: 'boot' | 'shutdown',
    ) => Promise<void>;
}

export function registerRuntimeRoutes(app: FastifyInstance, options: RuntimeRouteOptions): void {
    app.get('/api/runtime-devices/discovered', async () => ({
        devices: await options.runtimeCandidates?.() ?? [],
    }));
    app.get('/api/virtual-runtimes', async () => ({
        runtimes: await options.virtualRuntimes?.() ?? [],
    }));
    app.post<{
        Params: { workerId: string; platform: VirtualRuntimePlatform; id: string; action: 'boot' | 'shutdown' };
    }>('/api/virtual-runtimes/:workerId/:platform/:id/:action', async (request, reply) => {
        if (!options.changeVirtualRuntimeState) {
            return reply.code(503).send({ error: 'Virtual runtime lifecycle is not configured' });
        }
        if (!['ios', 'android'].includes(request.params.platform) || !['boot', 'shutdown'].includes(request.params.action)) {
            return reply.code(400).send({ error: 'Unsupported virtual runtime action' });
        }
        await options.changeVirtualRuntimeState(
            request.params.workerId === 'local' ? undefined : request.params.workerId,
            request.params.platform,
            request.params.id,
            request.params.action,
        );
        return reply.code(202).send({ ok: true });
    });
    app.post<{ Body: { workerId?: string; udid?: string; name?: string } }>(
        '/api/runtime-devices',
        async (request, reply) => {
            if (!options.registerRuntime) {
                return reply.code(503).send({ error: 'Runtime registration is not configured' });
            }
            if (!request.body.udid?.trim()) {
                return reply.code(400).send({ error: 'Runtime device UDID is required' });
            }
            await options.registerRuntime(
                request.body.workerId,
                request.body.udid.trim(),
                request.body.name?.trim(),
            );
            return reply.code(201).send({ ok: true });
        },
    );
}
