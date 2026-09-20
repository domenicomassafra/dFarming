import type { FastifyInstance } from 'fastify';

import type {
    DeviceRegistrationManager,
    RegistrationAction,
    RegistrationUpdate,
} from '../devices/registration.js';

export function registerDeviceRegistrationRoutes(
    app: FastifyInstance,
    registrations: DeviceRegistrationManager | undefined,
): void {
    app.get('/api/device-registrations/candidates', async (_request, reply) => {
        if (!registrations) return reply.code(503).send({ error: 'Device registration is not configured' });
        return { devices: await registrations.candidates() };
    });
    app.post<{ Body: { udid?: string } }>('/api/device-registrations', async (request, reply) => {
        if (!registrations) return reply.code(503).send({ error: 'Device registration is not configured' });
        if (!request.body.udid?.trim()) return reply.code(400).send({ error: 'Device UDID is required' });
        return reply.code(201).send(await registrations.create(request.body.udid.trim()));
    });
    app.get<{ Params: { id: string } }>('/api/device-registrations/:id', async (request, reply) => {
        if (!registrations) return reply.code(503).send({ error: 'Device registration is not configured' });
        return await registrations.get(request.params.id)
            ?? reply.code(404).send({ error: 'Registration draft not found' });
    });
    app.patch<{ Params: { id: string }; Body: RegistrationUpdate }>('/api/device-registrations/:id', async (request, reply) => {
        if (!registrations) return reply.code(503).send({ error: 'Device registration is not configured' });
        return registrations.update(request.params.id, request.body);
    });
    app.post<{ Params: { id: string; action: RegistrationAction }; Body: { authorizeTeamRegistration?: boolean } }>(
        '/api/device-registrations/:id/actions/:action',
        async (request, reply) => {
            if (!registrations) return reply.code(503).send({ error: 'Device registration is not configured' });
            if (!['refresh', 'prepare', 'verify', 'finalize'].includes(request.params.action)) {
                return reply.code(404).send({ error: 'Unknown registration action' });
            }
            return registrations.run(request.params.id, request.params.action, {
                authorizeTeamRegistration: request.body?.authorizeTeamRegistration === true,
            });
        },
    );
    app.delete<{ Params: { id: string } }>('/api/device-registrations/:id', async (request, reply) => {
        if (!registrations) return reply.code(503).send({ error: 'Device registration is not configured' });
        await registrations.cancel(request.params.id);
        return reply.code(204).send();
    });
}
