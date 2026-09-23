import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { canonicalizePluginData } from '../branding.js';
import { coordinatesForProfile, validateCoordinateOverrides } from './coordinates.js';
import type { RegisteredDevice } from '../types.js';

export type { RegisteredDevice } from '../types.js';

/** Devices the farm should actively supervise (everything except the disabled ones). */
export function activeDevices(devices: readonly RegisteredDevice[]): RegisteredDevice[] {
    return devices.filter((device) => !device.disabled);
}

export const PASSCODE_PATTERN = /^\d{4,}$/;
const TAG_PATTERN = /^[a-z0-9][a-z0-9._-]{0,31}$/;

export function normalizeDeviceTags(value: unknown): string[] {
    if (value === undefined || value === null) return [];
    if (!Array.isArray(value)) throw new Error('Device tags must be an array');
    if (value.length > 20) throw new Error('A device may have at most 20 tags');
    const tags = value.map((entry) => {
        if (typeof entry !== 'string') throw new Error('Device tags must be strings');
        const tag = entry.trim().toLowerCase();
        if (!TAG_PATTERN.test(tag)) throw new Error(`Invalid device tag: ${entry}`);
        return tag;
    });
    return [...new Set(tags)];
}

/** A device with its passcode removed and a boolean marker in its place — safe to serialize. */
export function redactDevice<T extends { passcode?: string }>(device: T): Omit<T, 'passcode'> & { hasPasscode: boolean } {
    const { passcode, ...rest } = device;
    return { ...rest, hasPasscode: Boolean(passcode) };
}

const defaultRegistryPath = path.resolve(process.env.DEVICES_CONFIG_PATH ?? 'devices.json');

export async function loadRegisteredDevices(registryPath = defaultRegistryPath): Promise<RegisteredDevice[]> {
    let raw: string;
    try {
        raw = await readFile(registryPath, 'utf8');
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
        throw error;
    }
    let devices: RegisteredDevice[];
    try {
        devices = JSON.parse(raw) as RegisteredDevice[];
    } catch (error) {
        throw new Error(`${registryPath} contains invalid JSON: ${error instanceof Error ? error.message : String(error)}`);
    }
    for (const device of devices) {
        const platform = device.platform ?? 'ios';
        const kind = device.kind ?? 'physical';
        const backend = device.automationBackend ?? (platform === 'ios' && kind === 'physical' ? 'wda' : 'appium');
        if (!['ios', 'android'].includes(platform)) throw new Error(`Device ${device.udid} has invalid platform ${platform}`);
        if (!['physical', 'simulator', 'emulator'].includes(kind)) throw new Error(`Device ${device.udid} has invalid kind ${kind}`);
        if (!['wda', 'appium'].includes(backend)) throw new Error(`Device ${device.udid} has invalid automation backend ${backend}`);
        if (device.tags !== undefined) {
            device.tags = normalizeDeviceTags(device.tags);
            if (!device.tags.length) delete device.tags;
        }
        if (platform === 'ios') {
            // Unknown profiles used to throw here and turn every PATCH (including
            // rename) into a generic 400. Fall back so the rest of the farm stays usable.
            try {
                coordinatesForProfile(device.coordinateProfile);
            } catch {
                delete device.coordinateProfile;
                coordinatesForProfile(device.coordinateProfile);
            }
        }
        device.pluginData = canonicalizePluginData(device.pluginData ?? {});
    }
    return devices;
}

export async function saveRegisteredDevices(devices: RegisteredDevice[], registryPath = defaultRegistryPath): Promise<void> {
    const unique = new Set<string>();
    for (const device of devices) {
        const platform = device.platform ?? 'ios';
        const kind = device.kind ?? 'physical';
        const backend = device.automationBackend ?? (platform === 'ios' && kind === 'physical' ? 'wda' : 'appium');
        if (!['ios', 'android'].includes(platform)) throw new Error(`Device ${device.udid} has invalid platform ${platform}`);
        if (!['physical', 'simulator', 'emulator'].includes(kind)) throw new Error(`Device ${device.udid} has invalid kind ${kind}`);
        if (!['wda', 'appium'].includes(backend)) throw new Error(`Device ${device.udid} has invalid automation backend ${backend}`);
        if (device.tags !== undefined) {
            device.tags = normalizeDeviceTags(device.tags);
            if (!device.tags.length) delete device.tags;
        }
        if (platform === 'ios') coordinatesForProfile(device.coordinateProfile);
        if (device.passcode !== undefined && !PASSCODE_PATTERN.test(device.passcode)) {
            throw new Error(`Device ${device.udid} passcode must contain at least four digits`);
        }
        if (platform === 'ios' && device.coordinates !== undefined) {
            device.coordinates = validateCoordinateOverrides(device.coordinates, device.coordinateProfile);
            if (Object.keys(device.coordinates).length === 0) delete device.coordinates;
        }
        if (platform === 'ios' && device.instagramCoordinates !== undefined) {
            device.instagramCoordinates = validateCoordinateOverrides(
                device.instagramCoordinates,
                device.coordinateProfile,
            );
            if (Object.keys(device.instagramCoordinates).length === 0) delete device.instagramCoordinates;
        }
        device.pluginData = canonicalizePluginData(device.pluginData ?? {});
        if (device.disabled !== true) delete device.disabled;
        if (unique.has(device.udid)) throw new Error(`Device ${device.udid} is already registered`);
        unique.add(device.udid);
    }
    await mkdir(path.dirname(registryPath), { recursive: true });
    const temporaryPath = `${registryPath}.${process.pid}.tmp`;
    await writeFile(temporaryPath, `${JSON.stringify(devices, null, 2)}\n`, { mode: 0o600 });
    await rename(temporaryPath, registryPath);
}

// Every load-modify-save of devices.json in one process must go through here,
// or two overlapping mutations (a passcode save racing a disable toggle) each
// read the same file and the second write clobbers the first.
let registryMutation: Promise<unknown> = Promise.resolve();

export function mutateRegisteredDevices<T>(
    mutate: (devices: RegisteredDevice[]) => T | Promise<T>,
    registryPath = defaultRegistryPath,
): Promise<T> {
    const run = registryMutation.then(async () => {
        const devices = await loadRegisteredDevices(registryPath);
        const result = await mutate(devices);
        await saveRegisteredDevices(devices, registryPath);
        return result;
    });
    registryMutation = run.catch(() => undefined);
    return run;
}
