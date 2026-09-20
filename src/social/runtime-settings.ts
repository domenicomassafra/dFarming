import type { JsonObject, RegisteredDevice } from '../types.js';

function settings(device: RegisteredDevice | undefined, pluginId: string): JsonObject {
    return device?.pluginData[pluginId] ?? {};
}

export function socialCoordinateProfile(device: RegisteredDevice | undefined, pluginId: string): string {
    // The top-level devices.json field is canonical. pluginData keeps backward
    // compatibility with older registrations that stored the profile per app.
    if (typeof device?.coordinateProfile === 'string') return device.coordinateProfile;
    const legacy = settings(device, pluginId).coordinateProfile;
    return typeof legacy === 'string' ? legacy : 'iphone8';
}

export function socialRegisteredAccounts(device: RegisteredDevice | undefined, pluginId: string): string[] {
    const value = settings(device, pluginId).accounts;
    return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : [];
}
