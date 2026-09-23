import type { FastifyInstance } from 'fastify';

import {
    LEGACY_PORTABLE_FLOW_FORMAT,
    PORTABLE_FLOW_FORMAT,
    PORTABLE_FLOW_PLUGIN_ID,
} from '../branding.js';
import type { PortableFlowPayload } from '../flow-plugin.js';
import { exportMaestroFlow, importMaestroFlow } from '../flows/maestro.js';
import type { PluginRegistry } from '../registry.js';
import type { SchedulerRepository } from '../scheduler/repository.js';
import type { JsonObject, JsonValue } from '../types.js';

function safeExportName(name: string): string {
    return name.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'flow';
}

export function registerFlowRoutes(
    app: FastifyInstance,
    scheduler: SchedulerRepository,
    plugins: PluginRegistry,
): void {
    const validatedFlowPayload = (value: JsonValue): JsonObject => {
        const definition = plugins.task({
            pluginId: PORTABLE_FLOW_PLUGIN_ID,
            taskType: 'flow',
            taskVersion: 1,
            payload: {},
        });
        return definition.validate(value, { timingKind: 'now', devicePluginData: {} });
    };

    app.get('/api/flows', async () => ({ flows: await scheduler.listFlowDefinitions(200) }));

    app.post<{ Body: JsonObject }>('/api/flows', async (request, reply) => {
        const flow = await scheduler.createFlowDefinition(validatedFlowPayload(request.body));
        return reply.code(201).send({ flow });
    });

    app.post<{ Body: { format?: string; flow?: JsonValue } }>('/api/flows/import', async (request, reply) => {
        if (![PORTABLE_FLOW_FORMAT, LEGACY_PORTABLE_FLOW_FORMAT].includes(request.body.format ?? '') || !request.body.flow) {
            return reply.code(400).send({ error: `Expected a ${PORTABLE_FLOW_FORMAT} export` });
        }
        const flow = await scheduler.createFlowDefinition(validatedFlowPayload(request.body.flow));
        return reply.code(201).send({ flow });
    });

    app.post<{ Body: { yaml?: string; name?: string } }>('/api/flows/import/maestro', async (request, reply) => {
        if (typeof request.body.yaml !== 'string') return reply.code(400).send({ error: 'yaml is required' });
        if (request.body.name !== undefined && (typeof request.body.name !== 'string' || request.body.name.length > 120)) {
            return reply.code(400).send({ error: 'name must be at most 120 characters' });
        }
        const imported = importMaestroFlow(request.body.yaml, request.body.name);
        const flow = await scheduler.createFlowDefinition(validatedFlowPayload(imported));
        return reply.code(201).send({ flow });
    });

    app.get<{ Params: { id: string }; Querystring: { version?: string } }>('/api/flows/:id', async (request, reply) => {
        const version = request.query.version === undefined ? undefined : Number(request.query.version);
        if (version !== undefined && (!Number.isInteger(version) || version < 1)) {
            return reply.code(400).send({ error: 'version must be a positive integer' });
        }
        const flow = await scheduler.flowDefinition(request.params.id, version);
        return flow ? { flow } : reply.code(404).send({ error: 'Flow not found' });
    });

    app.put<{ Params: { id: string }; Body: JsonObject }>('/api/flows/:id', async (request, reply) => {
        const flow = await scheduler.saveFlowVersion(request.params.id, validatedFlowPayload(request.body));
        return flow ? { flow } : reply.code(404).send({ error: 'Flow not found' });
    });

    app.post<{ Params: { id: string }; Body: { name?: string } }>('/api/flows/:id/duplicate', async (request, reply) => {
        if (request.body.name !== undefined && (typeof request.body.name !== 'string' || request.body.name.trim().length > 120)) {
            return reply.code(400).send({ error: 'name must contain at most 120 characters' });
        }
        const flow = await scheduler.duplicateFlowDefinition(request.params.id, request.body.name);
        return flow ? reply.code(201).send({ flow }) : reply.code(404).send({ error: 'Flow not found' });
    });

    app.post<{ Params: { id: string }; Body: { version?: number } }>('/api/flows/:id/restore', async (request, reply) => {
        if (!Number.isInteger(request.body.version) || Number(request.body.version) < 1) {
            return reply.code(400).send({ error: 'version must be a positive integer' });
        }
        const flow = await scheduler.restoreFlowVersion(request.params.id, Number(request.body.version));
        return flow ? { flow } : reply.code(404).send({ error: 'Flow/version not found' });
    });

    app.get<{ Params: { id: string } }>('/api/flows/:id/export', async (request, reply) => {
        const flow = await scheduler.flowDefinition(request.params.id);
        if (!flow) return reply.code(404).send({ error: 'Flow not found' });
        return reply.header('content-disposition', `attachment; filename="${safeExportName(flow.name)}.dfarming-flow.json"`)
            .send({ format: PORTABLE_FLOW_FORMAT, exportedAt: new Date().toISOString(), flow: flow.payload });
    });

    app.get<{ Params: { id: string } }>('/api/flows/:id/export/maestro', async (request, reply) => {
        const flow = await scheduler.flowDefinition(request.params.id);
        if (!flow) return reply.code(404).send({ error: 'Flow not found' });
        const yaml = exportMaestroFlow(flow.payload as PortableFlowPayload);
        return reply.header('content-disposition', `attachment; filename="${safeExportName(flow.name)}.maestro.yaml"`)
            .type('application/yaml; charset=utf-8')
            .send(yaml);
    });

    app.delete<{ Params: { id: string } }>('/api/flows/:id', async (request, reply) => (
        await scheduler.deleteFlowDefinition(request.params.id)
            ? reply.code(204).send()
            : reply.code(404).send({ error: 'Flow not found' })
    ));
}
