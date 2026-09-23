import type { JsonObject } from './types.js';
import {
    canonicalPluginId,
    INSTAGRAM_PLUGIN_ID,
    TIKTOK_PLUGIN_ID,
} from './branding.js';
import type { RegisteredDevice } from './devices/registry.js';
import { normalizeDeviceTags } from './devices/registry.js';
import { normalizeNetworkRouteId } from './network-routes.js';

export const SOCIAL_ACCOUNT_PLATFORMS = ['tiktok', 'instagram'] as const;
export type SocialAccountPlatform = (typeof SOCIAL_ACCOUNT_PLATFORMS)[number];

const PLATFORM_PLUGIN_IDS: Record<SocialAccountPlatform, string> = {
    tiktok: TIKTOK_PLUGIN_ID,
    instagram: INSTAGRAM_PLUGIN_ID,
};

const HANDLE_PATTERN = /^@[A-Za-z0-9._]{1,64}$/;

export interface FleetAccount {
    platform: SocialAccountPlatform;
    pluginId: string;
    handle: string;
    deviceUdid: string;
    deviceName: string;
    deviceDisabled: boolean;
    policy?: AccountAutomationPolicy;
}

export interface AccountAutomationPolicy {
    paused?: boolean;
    allowedTaskTypes?: string[];
    note?: string;
    executionProfile?: AccountExecutionProfile;
}

export interface AccountExecutionProfile {
    id: string;
    dedicatedDeviceUdid?: string;
    requiredTags?: string[];
    networkRouteId?: string;
}

export function pluginIdForPlatform(platform: SocialAccountPlatform): string {
    return PLATFORM_PLUGIN_IDS[platform];
}

export function socialPlatformForPluginId(pluginId: string): SocialAccountPlatform | undefined {
    const canonical = canonicalPluginId(pluginId);
    return SOCIAL_ACCOUNT_PLATFORMS.find((platform) => PLATFORM_PLUGIN_IDS[platform] === canonical);
}

function parsedExecutionProfile(value: unknown): AccountExecutionProfile | undefined {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return;
    const record = value as Record<string, unknown>;
    if (typeof record.id !== 'string' || !/^[a-z0-9][a-z0-9._-]{0,63}$/.test(record.id.trim().toLowerCase())) return;
    const id = record.id.trim().toLowerCase();
    const dedicatedDeviceUdid = typeof record.dedicatedDeviceUdid === 'string' && record.dedicatedDeviceUdid.trim()
        ? record.dedicatedDeviceUdid.trim().slice(0, 128) : undefined;
    let requiredTags: string[] | undefined;
    try {
        requiredTags = record.requiredTags === undefined ? undefined : normalizeDeviceTags(record.requiredTags);
    } catch { return; }
    let networkRouteId: string | undefined;
    try {
        networkRouteId = record.networkRouteId === undefined ? undefined : normalizeNetworkRouteId(record.networkRouteId);
    } catch { return; }
    return {
        id,
        ...(dedicatedDeviceUdid ? { dedicatedDeviceUdid } : {}),
        ...(requiredTags?.length ? { requiredTags } : {}),
        ...(networkRouteId ? { networkRouteId } : {}),
    };
}

export function validateAccountExecutionProfile(value: unknown): AccountExecutionProfile {
    const profile = parsedExecutionProfile(value);
    if (!profile) {
        throw new Error('executionProfile must contain a valid id and optional dedicatedDeviceUdid, requiredTags, and networkRouteId');
    }
    return profile;
}

export function normalizeSocialHandle(value: string, platform: SocialAccountPlatform): string {
    const handle = value.trim().startsWith('@') ? value.trim() : `@${value.trim()}`;
    if (!HANDLE_PATTERN.test(handle)) {
        throw new Error(`${platformLabel(platform)} handles may contain letters, numbers, periods, and underscores`);
    }
    return handle;
}

export function configuredAccounts(pluginData: JsonObject, platform: SocialAccountPlatform): string[] {
    const raw = pluginData.accounts;
    if (!Array.isArray(raw)) return [];
    const unique = new Set<string>();
    for (const value of raw) {
        if (typeof value !== 'string' || !value.trim()) continue;
        try {
            unique.add(normalizeSocialHandle(value, platform));
        } catch {
            // Keep malformed legacy config visible to the registration/editor flow,
            // but never treat it as an authorized task target.
        }
    }
    return [...unique];
}

export function validateConfiguredAccount(
    value: string | undefined,
    pluginData: JsonObject,
    platform: SocialAccountPlatform,
): string | undefined {
    if (value === undefined || !value.trim()) return undefined;
    const handle = normalizeSocialHandle(value, platform);
    const accounts = configuredAccounts(pluginData, platform);
    if (!accounts.includes(handle)) {
        throw new Error(`${handle} is not configured for ${platformLabel(platform)} on this device`);
    }
    return handle;
}

export function accountPolicy(
    pluginData: JsonObject,
    handle: string,
    platform: SocialAccountPlatform,
): AccountAutomationPolicy {
    const normalized = normalizeSocialHandle(handle, platform);
    const rawPolicies = pluginData.accountPolicies;
    if (!rawPolicies || typeof rawPolicies !== 'object' || Array.isArray(rawPolicies)) return {};
    const raw = (rawPolicies as Record<string, unknown>)[normalized];
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
    const record = raw as Record<string, unknown>;
    const allowedTaskTypes = Array.isArray(record.allowedTaskTypes)
        ? record.allowedTaskTypes.filter((value): value is string => typeof value === 'string' && /^[a-z][a-z0-9.-]*$/.test(value))
        : undefined;
    const profile = parsedExecutionProfile(record.executionProfile);
    return {
        ...(record.paused === true ? { paused: true } : {}),
        ...(allowedTaskTypes?.length ? { allowedTaskTypes: [...new Set(allowedTaskTypes)] } : {}),
        ...(typeof record.note === 'string' && record.note.trim() ? { note: record.note.trim().slice(0, 240) } : {}),
        ...(profile ? { executionProfile: profile } : {}),
    };
}

export function validateAccountTaskPolicy(
    handle: string | undefined,
    taskType: string,
    pluginData: JsonObject,
    platform: SocialAccountPlatform,
): void {
    if (!handle) return;
    const policy = accountPolicy(pluginData, handle, platform);
    if (policy.paused) {
        throw new Error(`${handle} automation is paused${policy.note ? `: ${policy.note}` : ''}`);
    }
    if (policy.allowedTaskTypes?.length && !policy.allowedTaskTypes.includes(taskType)) {
        throw new Error(`${handle} does not allow ${taskType} automation`);
    }
}

export function withAccountPolicy(
    pluginData: JsonObject,
    handle: string,
    platform: SocialAccountPlatform,
    input: AccountAutomationPolicy,
): JsonObject {
    const normalized = normalizeSocialHandle(handle, platform);
    const currentRaw = pluginData.accountPolicies;
    const policies: Record<string, unknown> = currentRaw && typeof currentRaw === 'object' && !Array.isArray(currentRaw)
        ? { ...(currentRaw as Record<string, unknown>) }
        : {};
    const allowedTaskTypes = Array.isArray(input.allowedTaskTypes)
        ? [...new Set(input.allowedTaskTypes.filter((value) => /^[a-z][a-z0-9.-]*$/.test(value)))]
        : undefined;
    const clean: AccountAutomationPolicy = {
        ...(input.paused === true ? { paused: true } : {}),
        ...(allowedTaskTypes?.length ? { allowedTaskTypes } : {}),
        ...(typeof input.note === 'string' && input.note.trim() ? { note: input.note.trim().slice(0, 240) } : {}),
        ...(input.executionProfile !== undefined ? { executionProfile: validateAccountExecutionProfile(input.executionProfile) } : {}),
    };
    if (Object.keys(clean).length) policies[normalized] = clean;
    else delete policies[normalized];
    const next = { ...pluginData };
    if (Object.keys(policies).length) next.accountPolicies = policies as JsonObject;
    else delete next.accountPolicies;
    return next;
}

export function listFleetAccounts(devices: readonly RegisteredDevice[]): FleetAccount[] {
    const accounts: FleetAccount[] = [];
    for (const device of devices) {
        for (const platform of SOCIAL_ACCOUNT_PLATFORMS) {
            const pluginId = pluginIdForPlatform(platform);
            for (const handle of configuredAccounts(device.pluginData[pluginId] ?? {}, platform)) {
                const policy = accountPolicy(device.pluginData[pluginId] ?? {}, handle, platform);
                accounts.push({
                    platform,
                    pluginId,
                    handle,
                    deviceUdid: device.udid,
                    deviceName: device.name,
                    deviceDisabled: device.disabled === true,
                    ...(Object.keys(policy).length ? { policy } : {}),
                });
            }
        }
    }
    return accounts.sort((a, b) => (
        a.platform.localeCompare(b.platform)
        || a.handle.localeCompare(b.handle)
        || a.deviceName.localeCompare(b.deviceName)
    ));
}

function platformLabel(platform: SocialAccountPlatform): string {
    return platform === 'tiktok' ? 'TikTok' : 'Instagram';
}
