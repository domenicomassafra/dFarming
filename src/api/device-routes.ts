import type { FastifyInstance } from 'fastify';

import {
    CALIBRATABLE_POINTS,
    labelsForApp,
    coordinatesForProfile,
    resolveDeviceCoordinates,
    validateCoordinateOverrides,
    parseSocialApp,
} from '../devices/coordinates.js';
import type { Device } from '../devices/discovery.js';
import {
    loadRegisteredDevices,
    normalizeDeviceTags,
    redactDevice,
    PASSCODE_PATTERN,
    type RegisteredDevice,
} from '../devices/registry.js';
import type { RemoteControl } from '../devices/wda-remote.js';
import type { PluginRegistry } from '../registry.js';
import type { SchedulerRepository } from '../scheduler/repository.js';
import type { JsonObject } from '../types.js';

function httpError(statusCode: number, message: string): Error & { statusCode: number } {
    return Object.assign(new Error(message), { statusCode });
}

function normalizeDeviceName(value: unknown): string {
    if (typeof value !== 'string') throw httpError(400, 'Device name must be a string');
    const name = value.replace(/\s+/g, ' ').trim().slice(0, 100);
    if (!name) throw httpError(400, 'Device name cannot be empty');
    return name;
}

export interface DeviceRouteOptions {
    scheduler: SchedulerRepository;
    plugins: PluginRegistry;
    remote: RemoteControl;
    discoverDevices: () => Promise<Device[]>;
    mutateDevices: <T>(mutate: (devices: RegisteredDevice[]) => T | Promise<T>) => Promise<T>;
}

export function registerDeviceRoutes(app: FastifyInstance, options: DeviceRouteOptions): void {
    const { scheduler, plugins, remote, discoverDevices, mutateDevices } = options;

    app.post<{
        Body: {
            name?: string;
            udid?: string;
            tags?: string[];
            wdaLocalPort?: number;
            mjpegLocalPort?: number;
            passcode?: string;
            coordinateProfile?: string;
            pluginData?: Record<string, JsonObject>;
        };
    }>('/api/devices', async (request, reply) => {
        const {
            name,
            udid,
            tags,
            wdaLocalPort,
            mjpegLocalPort,
            passcode,
            coordinateProfile,
            pluginData,
        } = request.body;
        if (!udid) return reply.code(400).send({ error: 'A device UDID is required' });
        if (passcode !== undefined && !PASSCODE_PATTERN.test(passcode)) {
            return reply.code(400).send({ error: 'Device passcode must contain at least four digits' });
        }
        const created = await mutateDevices((devices) => {
            if (devices.some((device) => device.udid === udid)) {
                throw httpError(409, 'A device with this UDID is already registered');
            }
            const normalizedTags = tags === undefined ? [] : normalizeDeviceTags(tags);
            const device: RegisteredDevice = {
                name: name ?? udid,
                udid,
                pluginData: pluginData ?? {},
                ...(normalizedTags.length ? { tags: normalizedTags } : {}),
                ...(wdaLocalPort !== undefined ? { wdaLocalPort } : {}),
                ...(mjpegLocalPort !== undefined ? { mjpegLocalPort } : {}),
                ...(coordinateProfile !== undefined
                    ? { coordinateProfile: coordinateProfile as RegisteredDevice['coordinateProfile'] }
                    : {}),
                ...(passcode !== undefined ? { passcode } : {}),
            };
            devices.push(device);
            return device;
        });
        return reply.code(201).send(redactDevice(created));
    });

    app.patch<{
        Params: { udid: string };
        Body: {
            name?: string;
            tags?: string[];
            wdaLocalPort?: number;
            mjpegLocalPort?: number;
            passcode?: string;
            coordinates?: unknown;
            instagramCoordinates?: unknown;
            disabled?: boolean;
            coordinateProfile?: string;
            pluginData?: Record<string, JsonObject>;
        };
    }>('/api/devices/:udid', async (request, reply) => {
        const {
            passcode,
            coordinates,
            instagramCoordinates,
            name,
            tags,
            wdaLocalPort,
            mjpegLocalPort,
            disabled,
            coordinateProfile,
            pluginData,
        } = request.body ?? {};
        if (passcode !== undefined && passcode !== '' && !PASSCODE_PATTERN.test(passcode)) {
            return reply.code(400).send({ error: 'Device passcode must contain at least four digits' });
        }
        if (disabled === true && await scheduler.activeExecution(request.params.udid)) {
            return reply.code(409).send({ error: 'Stop the running automation before disconnecting this device' });
        }
        const updated = await mutateDevices((devices) => {
            const device = devices.find((entry) => entry.udid === request.params.udid);
            if (!device) throw httpError(404, 'Device not found');
            if (name !== undefined) device.name = normalizeDeviceName(name);
            if (tags !== undefined) {
                const normalized = normalizeDeviceTags(tags);
                if (normalized.length) device.tags = normalized;
                else delete device.tags;
            }
            if (wdaLocalPort !== undefined) device.wdaLocalPort = wdaLocalPort;
            if (mjpegLocalPort !== undefined) device.mjpegLocalPort = mjpegLocalPort;
            if (coordinateProfile !== undefined) {
                device.coordinateProfile = coordinateProfile as RegisteredDevice['coordinateProfile'];
            }
            if (pluginData !== undefined) device.pluginData = pluginData;
            if (disabled === true) device.disabled = true;
            else if (disabled === false) delete device.disabled;

            if (passcode === '') delete device.passcode;
            else if (passcode !== undefined) device.passcode = passcode;

            if (coordinates !== undefined) {
                const incoming = validateCoordinateOverrides(coordinates, device.coordinateProfile);
                if (Object.keys(coordinates as object).length === 0) delete device.coordinates;
                else device.coordinates = { ...device.coordinates, ...incoming };
            }
            if (instagramCoordinates !== undefined) {
                const incoming = validateCoordinateOverrides(instagramCoordinates, device.coordinateProfile);
                if (Object.keys(instagramCoordinates as object).length === 0) delete device.instagramCoordinates;
                else device.instagramCoordinates = { ...device.instagramCoordinates, ...incoming };
            }
            return device;
        });
        remote.forget?.(request.params.udid);
        return redactDevice(updated);
    });

    app.get<{ Params: { udid: string }; Querystring: { app?: string } }>(
        '/api/devices/:udid/coordinates',
        async (request, reply) => {
            const device = (await loadRegisteredDevices()).find(({ udid }) => udid === request.params.udid);
            if (!device) return reply.code(404).send({ error: 'Device not found' });
            const appName = parseSocialApp(request.query.app);
            const overrides = appName === 'instagram' ? device.instagramCoordinates : device.coordinates;
            const base = coordinatesForProfile(device.coordinateProfile)[appName];
            const effective = resolveDeviceCoordinates(device.coordinateProfile, overrides, appName)[appName];
            const labels = labelsForApp(appName);
            return {
                app: appName,
                profile: device.coordinateProfile ?? 'iphone8',
                screenSize: coordinatesForProfile(device.coordinateProfile).screenSize,
                points: CALIBRATABLE_POINTS.map((pointName) => ({
                    name: pointName,
                    label: labels[pointName],
                    default: base[pointName],
                    current: effective[pointName],
                    overridden: Boolean(overrides?.[pointName]),
                })),
            };
        },
    );

    app.delete<{ Params: { udid: string } }>('/api/devices/:udid', async (request, reply) => {
        const exists = (await loadRegisteredDevices()).some(({ udid }) => udid === request.params.udid);
        if (!exists) return reply.code(404).send({ error: 'Device not found' });
        if (await scheduler.activeExecution(request.params.udid)) {
            return reply.code(409).send({ error: 'Stop the running automation before removing this device' });
        }
        for (const schedule of await scheduler.listSchedules(500, request.params.udid)) {
            if (!['cancelled', 'completed'].includes(schedule.status)) {
                await scheduler.setScheduleStatus(schedule.id, 'cancelled');
            }
        }
        await mutateDevices((devices) => {
            const index = devices.findIndex(({ udid }) => udid === request.params.udid);
            if (index >= 0) devices.splice(index, 1);
        });
        remote.forget?.(request.params.udid);
        return reply.code(204).send();
    });

    app.post<{ Params: { udid: string } }>('/api/devices/:udid/checks', async (request, reply) => {
        const device = (await loadRegisteredDevices()).find(({ udid }) => udid === request.params.udid);
        if (!device) return reply.code(404).send({ error: 'Device not found' });
        const identity = (await discoverDevices()).find(({ udid }) => udid === device.udid) ?? device;
        const results = [];
        for (const plugin of plugins.list()) {
            for (const check of plugin.registrationChecks ?? []) {
                results.push({
                    pluginId: plugin.id,
                    checkId: check.id,
                    ...(await check.run(identity, device.pluginData[plugin.id] ?? {})),
                });
            }
        }
        return results;
    });
}
