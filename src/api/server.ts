import type { AddressInfo } from 'node:net';

import type { AuthProvider, DFarmingPlugin } from '../plugin.js';
import { dfarmingEnv } from '../env.js';
import { loadAuthProvider } from '../loader.js';
import { PluginRegistry } from '../registry.js';
import { createSchedulerRuntime } from '../scheduler/runtime.js';
import { assertSafeBind, isLoopbackHost } from '../security.js';
import { defaultPlugins } from '../default-plugins.js';
import { defaultDashboardTheme } from '../dashboard-theme.js';
import { DeviceRegistrationService } from '../devices/registration.js';
import { configuredDeviceWorkers, DeviceWorkerFleet } from '../device-workers.js';
import { createApp, type DashboardTheme } from './app.js';
import { detectHostCapabilities } from '../hosts/capabilities.js';
import { discoverRuntimeDevices, registerRuntimeDevice } from '../devices/runtime-discovery.js';
import { changeVirtualRuntimeState, listVirtualRuntimes } from '../devices/virtual-runtime.js';
import { isEntrypoint } from '../entrypoint.js';
import { loadRegisteredDevices } from '../devices/registry.js';
import { resolveTaskExecutionPolicy } from '../execution-policy.js';

export interface StartServerOptions {
    plugins?: readonly DFarmingPlugin[];
    authProvider?: AuthProvider | null;
    host?: string;
    port?: number;
    dashboardTheme?: DashboardTheme;
}

export async function startServer(options: StartServerOptions = {}) {
    const loadedPlugins = options.plugins ?? await defaultPlugins();
    const authProvider = options.authProvider === undefined
        ? await loadAuthProvider(dfarmingEnv('AUTH_PLUGIN'))
        : options.authProvider;
    const host = options.host ?? process.env.WEB_HOST ?? '127.0.0.1';
    const port = options.port ?? Number(process.env.WEB_PORT ?? 3000);
    assertSafeBind(host, authProvider);
    const plugins = new PluginRegistry(loadedPlugins);
    const scheduler = await createSchedulerRuntime(plugins);
    const role = dfarmingEnv('ROLE') ?? 'standalone';
    if (!['standalone', 'control-plane'].includes(role)) {
        throw new Error(`DFARMING_ROLE must be standalone or control-plane for the web process; received ${role}`);
    }
    const registrations = role === 'standalone' ? new DeviceRegistrationService() : undefined;
    await registrations?.start();
    const workerFleet = role === 'control-plane' ? new DeviceWorkerFleet(configuredDeviceWorkers()) : undefined;
    if (workerFleet) await workerFleet.refresh();
    scheduler.repository.setExecutionPolicyResolver(async (input) => resolveTaskExecutionPolicy(
        input,
        await loadRegisteredDevices(),
        workerFleet ? workerFleet.hosts() : [await detectHostCapabilities({ id: dfarmingEnv('WORKER_ID') ?? 'local' })],
    ));
    const refreshMs = Math.max(2_000, Number(dfarmingEnv('WORKER_REFRESH_MS') ?? 10_000));
    const workerRefreshTimer = workerFleet
        ? setInterval(() => void workerFleet.refresh().catch((error) => console.error('Device worker refresh failed:', error)), refreshMs)
        : undefined;
    const app = await createApp({
        plugins, scheduler: scheduler.repository, authProvider,
        dashboardTheme: options.dashboardTheme ?? defaultDashboardTheme, registrations, logger: true,
        requireStreamToken: dfarmingEnv('REQUIRE_STREAM_TOKEN') === 'true' || !isLoopbackHost(host),
        ...(workerFleet ? {
            remote: workerFleet,
            discoverDevices: () => workerFleet.discoverDevices(),
            listHosts: () => workerFleet.hosts(),
            runtimeCandidates: () => workerFleet.runtimeCandidates(),
            virtualRuntimes: () => workerFleet.virtualRuntimes(),
            changeVirtualRuntimeState: (workerId, platform, id, action) => {
                if (!workerId) throw Object.assign(new Error('Choose an execution worker for this runtime'), { statusCode: 400 });
                return workerFleet.changeVirtualRuntimeState(workerId, platform, id, action);
            },
            registerRuntime: (workerId, udid, name) => {
                if (!workerId) throw Object.assign(new Error('Choose an execution worker for this runtime'), { statusCode: 400 });
                return workerFleet.registerRuntime(workerId, udid, name);
            },
            connectionStatus: (udid: string) => workerFleet.connectionStatus(udid),
            reconnectDevice: (udid: string) => workerFleet.reconnectDevice(udid),
            syncDeviceConfiguration: (device) => workerFleet.syncDeviceConfiguration(device),
        } : {
            listHosts: async () => [await detectHostCapabilities({ id: dfarmingEnv('WORKER_ID') ?? 'local' })],
            discoverDevices: discoverRuntimeDevices,
            runtimeCandidates: discoverRuntimeDevices,
            virtualRuntimes: async () => (await listVirtualRuntimes()).map((runtime) => ({ ...runtime, workerId: 'local' })),
            changeVirtualRuntimeState: async (_workerId, platform, id, action) => changeVirtualRuntimeState(platform, id, action),
            registerRuntime: async (_workerId, udid, name) => { await registerRuntimeDevice(udid, { name }); },
        }),
    });
    await app.listen({ host, port });
    const address = app.server.address() as AddressInfo;
    console.log(`dFarming listening on http://${host}:${address.port}`);
    return {
        app, plugins,
        async close() {
            if (workerRefreshTimer) clearInterval(workerRefreshTimer);
            await app.close();
            await registrations?.close();
            await scheduler.close();
        },
    };
}

async function main(): Promise<void> {
    const runtime = await startServer();
    const shutdown = async () => runtime.close();
    process.once('SIGINT', () => void shutdown());
    process.once('SIGTERM', () => void shutdown());
}

if (isEntrypoint(import.meta.url)) await main();
