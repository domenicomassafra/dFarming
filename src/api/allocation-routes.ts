import type { FastifyInstance } from 'fastify';

import { rankAllocationCandidates, type DeviceAllocationSelector } from '../allocation.js';
import type { Device } from '../devices/discovery.js';
import { loadRegisteredDevices, normalizeDeviceTags } from '../devices/registry.js';
import type { SchedulerRepository } from '../scheduler/repository.js';
import type { CreateTaskInput, JsonObject } from '../types.js';
import { appiumTaskCompatibilityError } from './task-compatibility.js';

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

function httpError(statusCode: number, message: string): Error & { statusCode: number } {
    return Object.assign(new Error(message), { statusCode });
}

function validatedAllocationSelector(selector: DeviceAllocationSelector | undefined): DeviceAllocationSelector {
    const value = selector ?? {};
    if (value.platform !== undefined && !['ios', 'android'].includes(value.platform)) {
        throw httpError(400, 'target.platform must be ios or android');
    }
    if (value.kind !== undefined && !['physical', 'simulator', 'emulator'].includes(value.kind)) {
        throw httpError(400, 'target.kind is invalid');
    }
    if (value.preferredKinds !== undefined && (
        !Array.isArray(value.preferredKinds)
        || value.preferredKinds.length > 3
        || value.preferredKinds.some((kind) => !['physical', 'simulator', 'emulator'].includes(kind))
    )) {
        throw httpError(400, 'target.preferredKinds must contain valid device kinds');
    }
    if (value.kind !== undefined && value.preferredKinds?.length) {
        throw httpError(400, 'target.kind and target.preferredKinds cannot be combined');
    }
    if (value.workerId !== undefined && !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/.test(value.workerId)) {
        throw httpError(400, 'target.workerId is invalid');
    }
    if (value.requireIdle !== undefined && typeof value.requireIdle !== 'boolean') {
        throw httpError(400, 'target.requireIdle must be boolean');
    }
    if (value.deviceUdids !== undefined && (
        !Array.isArray(value.deviceUdids)
        || value.deviceUdids.length > 100
        || value.deviceUdids.some((udid) => typeof udid !== 'string' || !udid.trim())
    )) {
        throw httpError(400, 'target.deviceUdids must contain at most 100 non-empty ids');
    }
    let tags: string[] | undefined;
    try {
        tags = value.tags === undefined ? undefined : normalizeDeviceTags(value.tags);
    } catch (error) {
        throw httpError(400, errorMessage(error));
    }
    return {
        ...(value.platform ? { platform: value.platform } : {}),
        ...(value.kind ? { kind: value.kind } : {}),
        ...(value.preferredKinds?.length ? { preferredKinds: [...new Set(value.preferredKinds)] } : {}),
        ...(value.workerId ? { workerId: value.workerId } : {}),
        ...(value.deviceUdids ? {
            deviceUdids: [...new Set(value.deviceUdids.map((udid) => udid.trim()))],
        } : {}),
        ...(tags?.length ? { tags } : {}),
        ...(value.requireIdle !== undefined ? { requireIdle: value.requireIdle } : {}),
    };
}

function poolName(value: unknown): string {
    if (typeof value !== 'string') throw httpError(400, 'Pool name is required');
    const name = value.replace(/\s+/g, ' ').trim();
    if (!name || name.length > 80) throw httpError(400, 'Pool name must contain 1 to 80 characters');
    return name;
}

function selectorJson(selector: DeviceAllocationSelector): JsonObject {
    return structuredClone(selector) as unknown as JsonObject;
}

export interface AllocationRouteOptions {
    scheduler: SchedulerRepository;
    discoverDevices: () => Promise<Device[]>;
}

export function registerAllocationRoutes(app: FastifyInstance, options: AllocationRouteOptions): void {
    const { scheduler, discoverDevices } = options;

    const assertUniquePoolName = async (name: string, excludeId?: string): Promise<void> => {
        const normalized = name.toLocaleLowerCase();
        const duplicate = (await scheduler.listDevicePools(500))
            .find((pool) => pool.id !== excludeId && pool.name.toLocaleLowerCase() === normalized);
        if (duplicate) throw httpError(409, `A device pool named “${name}” already exists`);
    };

    const resolveAllocationSelector = async (
        input: { poolId?: string; target?: DeviceAllocationSelector },
    ): Promise<DeviceAllocationSelector> => {
        if (input.poolId) {
            if (input.target && Object.keys(input.target).length) {
                throw httpError(400, 'Use either poolId or target, not both');
            }
            const pool = await scheduler.devicePool(input.poolId);
            if (!pool) throw httpError(404, 'Device pool not found');
            return validatedAllocationSelector(pool.selector as unknown as DeviceAllocationSelector);
        }
        return validatedAllocationSelector(input.target);
    };

    const allocationCandidates = async (selector: DeviceAllocationSelector) => {
        const [registered, connected, executions, schedules] = await Promise.all([
            loadRegisteredDevices(),
            discoverDevices(),
            scheduler.listExecutions(500),
            scheduler.listSchedules(500),
        ]);
        return rankAllocationCandidates(
            registered,
            new Set(connected.map(({ udid }) => udid)),
            executions,
            schedules,
            selector,
        );
    };

    app.get('/api/pools', async () => ({ pools: await scheduler.listDevicePools(200) }));

    app.post<{ Body: { name?: string; selector?: DeviceAllocationSelector } }>(
        '/api/pools',
        async (request, reply) => {
            const selector = validatedAllocationSelector(request.body.selector);
            const name = poolName(request.body.name);
            await assertUniquePoolName(name);
            const pool = await scheduler.createDevicePool(name, selectorJson(selector));
            return reply.code(201).send({ pool });
        },
    );

    app.get<{ Params: { id: string } }>('/api/pools/:id', async (request, reply) => {
        const pool = await scheduler.devicePool(request.params.id);
        return pool ? { pool } : reply.code(404).send({ error: 'Device pool not found' });
    });

    app.put<{ Params: { id: string }; Body: { name?: string; selector?: DeviceAllocationSelector } }>(
        '/api/pools/:id',
        async (request, reply) => {
            const selector = validatedAllocationSelector(request.body.selector);
            const name = poolName(request.body.name);
            await assertUniquePoolName(name, request.params.id);
            const pool = await scheduler.updateDevicePool(request.params.id, name, selectorJson(selector));
            return pool ? { pool } : reply.code(404).send({ error: 'Device pool not found' });
        },
    );

    app.delete<{ Params: { id: string } }>('/api/pools/:id', async (request, reply) => (
        await scheduler.deleteDevicePool(request.params.id)
            ? reply.code(204).send()
            : reply.code(404).send({ error: 'Device pool not found' })
    ));

    app.post<{ Body: { target?: DeviceAllocationSelector; poolId?: string } }>(
        '/api/allocation/preview',
        async (request) => ({
            candidates: await allocationCandidates(await resolveAllocationSelector(request.body)),
        }),
    );

    app.post<{
        Body: Omit<CreateTaskInput, 'deviceUdid'> & {
            target?: DeviceAllocationSelector;
            poolId?: string;
            assetIds?: string[];
        };
    }>('/api/schedules/allocate', async (request, reply) => {
        const selector = await resolveAllocationSelector(request.body);
        const candidate = (await allocationCandidates(selector))[0];
        if (!candidate) {
            return reply.code(409).send({ error: 'No connected device matches this allocation target' });
        }
        const device = (await loadRegisteredDevices()).find(({ udid }) => udid === candidate.udid);
        if (!device || device.disabled) {
            return reply.code(409).send({ error: 'Allocated device is no longer available' });
        }
        const incompatible = appiumTaskCompatibilityError(device, request.body.task.pluginId);
        if (incompatible) return reply.code(409).send({ error: incompatible });

        const input: CreateTaskInput = {
            deviceUdid: candidate.udid,
            task: request.body.task,
            timing: request.body.timing,
            ...(request.body.runWindowMinutes !== undefined
                ? { runWindowMinutes: request.body.runWindowMinutes }
                : {}),
        };
        const schedule = await scheduler.createTask(
            input,
            device.pluginData[input.task.pluginId] ?? {},
            new Date(),
            request.body.assetIds ?? [],
        );
        return reply.code(201).send({ schedule, allocation: candidate });
    });
}
