import type { FastifyInstance, FastifyReply } from 'fastify';

import { loadRegisteredDevices } from '../devices/registry.js';
import { ScheduleTransitionError, type SchedulerRepository } from '../scheduler/repository.js';
import type { CreateTaskInput, ScheduleTiming } from '../types.js';
import { appiumTaskCompatibilityError } from './task-compatibility.js';

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

export interface ScheduleRouteOptions {
    scheduler: SchedulerRepository;
    renderActivity: (deviceUdid: string, message?: string) => Promise<string>;
}

export function registerScheduleRoutes(app: FastifyInstance, options: ScheduleRouteOptions): void {
    const { scheduler, renderActivity } = options;

    app.get<{ Querystring: { deviceUdid?: string } }>('/api/schedules', async (request) => ({
        schedules: await scheduler.listSchedules(200, request.query.deviceUdid),
    }));

    app.get<{ Querystring: { deviceUdid?: string } }>('/api/executions', async (request) => ({
        executions: await scheduler.listExecutions(200, request.query.deviceUdid),
    }));

    app.get<{ Params: { id: string } }>('/api/executions/:id', async (request, reply) => {
        const execution = await scheduler.execution(request.params.id);
        return execution ?? reply.code(404).send({ error: 'Execution not found' });
    });

    app.post<{ Body: CreateTaskInput & { assetIds?: string[] } }>('/api/schedules', async (request, reply) => {
        const device = (await loadRegisteredDevices()).find(({ udid }) => udid === request.body.deviceUdid);
        if (!device) return reply.code(404).send({ error: 'Device not found' });
        if (device.disabled) {
            return reply.code(409).send({
                error: 'This device is disabled — activate it before scheduling automation',
            });
        }
        const incompatible = appiumTaskCompatibilityError(device, request.body.task.pluginId);
        if (incompatible) return reply.code(409).send({ error: incompatible });

        const schedule = await scheduler.createTask(
            request.body,
            device.pluginData[request.body.task.pluginId] ?? {},
            new Date(),
            request.body.assetIds ?? [],
        );
        return reply.code(201).send(schedule);
    });

    app.patch<{
        Params: { id: string };
        Body: { timing?: ScheduleTiming; runWindowMinutes?: number; recurringPublishConfirmed?: boolean };
    }>('/api/schedules/:id', async (request, reply) => {
        const current = await scheduler.schedule(request.params.id);
        if (!current) return reply.code(404).send({ error: 'Schedule not found' });
        const device = (await loadRegisteredDevices()).find(({ udid }) => udid === current.deviceUdid);
        if (!device) return reply.code(404).send({ error: 'Scheduled device is not registered' });
        const payload = request.body.recurringPublishConfirmed === undefined
            ? current.payload
            : { ...current.payload, recurringPublishConfirmed: request.body.recurringPublishConfirmed };
        const schedule = await scheduler.updateSchedule(request.params.id, {
            ...(request.body.timing ? { timing: request.body.timing } : {}),
            ...(request.body.runWindowMinutes !== undefined
                ? { runWindowMinutes: request.body.runWindowMinutes }
                : {}),
            task: {
                pluginId: current.pluginId,
                taskType: current.taskType,
                taskVersion: current.taskVersion,
                payload,
            },
        }, device.pluginData[current.pluginId] ?? {});
        return schedule ?? reply.code(409).send({ error: 'Completed or cancelled schedules cannot be edited' });
    });

    const changeStatus = async (
        id: string,
        status: 'active' | 'paused' | 'cancelled',
        reply: FastifyReply,
    ) => {
        try {
            const schedule = await scheduler.setScheduleStatus(id, status);
            return schedule ?? reply.code(404).send({ error: 'Schedule not found' });
        } catch (error) {
            if (error instanceof ScheduleTransitionError) {
                return reply.code(409).send({ error: errorMessage(error) });
            }
            throw error;
        }
    };

    app.post<{
        Params: { id: string };
        Body: { status: 'active' | 'paused' | 'cancelled' };
    }>('/api/schedules/:id/status', (request, reply) => (
        changeStatus(request.params.id, request.body.status, reply)
    ));

    for (const action of ['pause', 'resume', 'cancel'] as const) {
        const status = action === 'pause' ? 'paused' : action === 'resume' ? 'active' : 'cancelled';
        app.post<{ Params: { id: string } }>(
            `/api/schedules/:id/${action}`,
            (request, reply) => changeStatus(request.params.id, status, reply),
        );
    }

    app.post<{ Params: { id: string } }>('/api/executions/:id/stop', async (request, reply) => {
        const result = await scheduler.requestStop(request.params.id);
        if (result === 'not-found') return reply.code(404).send({ error: 'Execution not found' });
        if (request.headers['hx-request']) {
            const execution = await scheduler.execution(request.params.id);
            return reply.type('text/html').send(await renderActivity(execution?.deviceUdid ?? ''));
        }
        return { result };
    });

    app.post<{ Params: { udid: string } }>('/api/devices/:udid/queue/clear', async (request, reply) => {
        const result = await scheduler.clearDeviceQueue(request.params.udid);
        const note = result.cancelled || result.stopping
            ? `Cleared ${result.cancelled} queued · stopping ${result.stopping} running`
            : 'Queue already empty';
        if (request.headers['hx-request']) {
            return reply.type('text/html').send(await renderActivity(request.params.udid, note));
        }
        return result;
    });

    app.post<{ Params: { id: string } }>('/api/executions/:id/retry', async (request, reply) => {
        const execution = await scheduler.retryExecution(request.params.id);
        return execution ?? reply.code(409).send({ error: 'Execution is not retryable' });
    });
}
