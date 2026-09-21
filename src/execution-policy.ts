import {
    accountPolicy, socialPlatformForPluginId,
    type AccountExecutionProfile,
} from './accounts.js';
import type { HostSnapshot } from './hosts/capabilities.js';
import { networkRouteAvailable } from './network-routes.js';
import type { RegisteredDevice } from './devices/registry.js';
import type { CreateTaskInput } from './types.js';

export interface ExecutionPolicySnapshot {
    executionProfileId?: string;
    networkRouteId?: string;
}

function missingTags(device: RegisteredDevice, required: readonly string[]): string[] {
    const tags = new Set(device.tags ?? []);
    return required.filter((tag) => !tags.has(tag));
}

export function assertExecutionProfile(
    profile: AccountExecutionProfile,
    device: RegisteredDevice,
    hosts: readonly HostSnapshot[],
): ExecutionPolicySnapshot {
    if (profile.dedicatedDeviceUdid && profile.dedicatedDeviceUdid !== device.udid) {
        throw new Error(`Execution profile ${profile.id} requires dedicated device ${profile.dedicatedDeviceUdid}`);
    }
    const missing = missingTags(device, profile.requiredTags ?? []);
    if (missing.length) throw new Error(`Execution profile ${profile.id} requires device tags: ${missing.join(', ')}`);
    if (profile.networkRouteId) {
        const workerId = device.workerId ?? 'local';
        const host = hosts.find(({ id }) => id === workerId);
        if (!host || host.online === false || !networkRouteAvailable(host.networkRoutes ?? [], profile.networkRouteId, device.udid)) {
            throw new Error(`Execution profile ${profile.id} requires network route ${profile.networkRouteId}, but worker ${workerId} did not attest it for this device`);
        }
    }
    return {
        executionProfileId: profile.id,
        ...(profile.networkRouteId ? { networkRouteId: profile.networkRouteId } : {}),
    };
}

export function resolveTaskExecutionPolicy(
    input: CreateTaskInput,
    devices: readonly RegisteredDevice[],
    hosts: readonly HostSnapshot[],
): ExecutionPolicySnapshot {
    const platform = socialPlatformForPluginId(input.task.pluginId);
    const account = typeof input.task.payload.account === 'string' ? input.task.payload.account.trim() : '';
    if (!platform || !account) return {};
    const device = devices.find(({ udid }) => udid === input.deviceUdid);
    if (!device) throw new Error(`Device ${input.deviceUdid} is not registered`);
    const policy = accountPolicy(device.pluginData[input.task.pluginId] ?? {}, account, platform);
    return policy.executionProfile ? assertExecutionProfile(policy.executionProfile, device, hosts) : {};
}
