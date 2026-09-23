import { portableFlowPlugin } from './flow-plugin.js';
import { createInstagramPlugin } from './instagram-plugin.js';
import { configuredPluginModules, loadPlugins } from './loader.js';
import type { DFarmingPlugin } from './plugin.js';
import { createTikTokPlugin } from './tiktok-plugin.js';

/**
 * Canonical plugin set shared by the control plane and execution workers.
 * Keeping this construction in one place prevents schedules from being
 * accepted by web/API and then rejected by a worker with a divergent registry.
 */
export async function defaultPlugins(): Promise<DFarmingPlugin[]> {
    return [
        portableFlowPlugin,
        createTikTokPlugin({ bundleId: process.env.TIKTOK_BUNDLE_ID }),
        createInstagramPlugin({ bundleId: process.env.INSTAGRAM_BUNDLE_ID }),
        ...await loadPlugins(configuredPluginModules()),
    ];
}
