import type { RegisteredDevice } from '../types.js';
import { canonicalPluginId, INSTAGRAM_PLUGIN_ID, TIKTOK_PLUGIN_ID } from '../branding.js';

const WDA_ONLY_SOCIAL_PLUGINS = new Set([
    TIKTOK_PLUGIN_ID,
    INSTAGRAM_PLUGIN_ID,
]);

export function appiumTaskCompatibilityError(
    device: RegisteredDevice,
    pluginId: string,
): string | undefined {
    const platform = device.platform ?? 'ios';
    const kind = device.kind ?? 'physical';
    const backend = device.automationBackend
        ?? (platform === 'ios' && kind === 'physical' ? 'wda' : 'appium');
    if (backend === 'appium' && WDA_ONLY_SOCIAL_PLUGINS.has(canonicalPluginId(pluginId))) {
        return 'This social recipe is currently iOS/WDA-specific. Use a Portable Flow on Appium runtimes.';
    }
}
