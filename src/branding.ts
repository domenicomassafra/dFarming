import type { JsonObject } from './types.js';

export const DFARMING_NAME = 'dFarming';

export const PORTABLE_FLOW_PLUGIN_ID = 'com.dfarming.flow';
export const LEGACY_PORTABLE_FLOW_PLUGIN_ID = 'com.phone-farm.flow';
export const TIKTOK_PLUGIN_ID = 'com.dfarming.tiktok';
export const LEGACY_TIKTOK_PLUGIN_ID = 'com.git-agni.tiktok';
export const INSTAGRAM_PLUGIN_ID = 'com.dfarming.instagram';
export const LEGACY_INSTAGRAM_PLUGIN_ID = 'com.git-agni.instagram';
export const EXAMPLE_PLUGIN_ID = 'org.dfarming.example';
export const LEGACY_EXAMPLE_PLUGIN_ID = 'org.phone-farm.example';

export const PORTABLE_FLOW_FORMAT = 'dfarming-flow@1';
export const LEGACY_PORTABLE_FLOW_FORMAT = 'mobile-farm-flow@1';

export function canonicalPluginId(pluginId: string): string {
    if (pluginId === LEGACY_PORTABLE_FLOW_PLUGIN_ID) return PORTABLE_FLOW_PLUGIN_ID;
    if (pluginId === LEGACY_TIKTOK_PLUGIN_ID) return TIKTOK_PLUGIN_ID;
    if (pluginId === LEGACY_INSTAGRAM_PLUGIN_ID) return INSTAGRAM_PLUGIN_ID;
    if (pluginId === LEGACY_EXAMPLE_PLUGIN_ID) return EXAMPLE_PLUGIN_ID;
    return pluginId;
}

export function isPortableFlowPluginId(pluginId: string): boolean {
    return canonicalPluginId(pluginId) === PORTABLE_FLOW_PLUGIN_ID;
}

const PLUGIN_ID_ALIASES = [
    [LEGACY_PORTABLE_FLOW_PLUGIN_ID, PORTABLE_FLOW_PLUGIN_ID],
    [LEGACY_TIKTOK_PLUGIN_ID, TIKTOK_PLUGIN_ID],
    [LEGACY_INSTAGRAM_PLUGIN_ID, INSTAGRAM_PLUGIN_ID],
    [LEGACY_EXAMPLE_PLUGIN_ID, EXAMPLE_PLUGIN_ID],
] as const;

export function canonicalizePluginData(pluginData: Record<string, JsonObject>): Record<string, JsonObject> {
    const next: Record<string, JsonObject> = { ...pluginData };
    for (const [legacyId, canonicalId] of PLUGIN_ID_ALIASES) {
        if (next[canonicalId] === undefined && next[legacyId] !== undefined) next[canonicalId] = next[legacyId];
        delete next[legacyId];
    }
    return next;
}
