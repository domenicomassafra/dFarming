import os from 'node:os';
import path from 'node:path';
import { access } from 'node:fs/promises';

import { physicalIosLaneEnabled } from '../runtime-options.js';
import { parseNetworkRouteAttestations, type NetworkRouteAttestation } from '../network-routes.js';
import { dfarmingEnv } from '../env.js';
import { listVirtualRuntimes, type VirtualRuntime } from '../devices/virtual-runtime.js';

export type HostCapability =
    | 'ios.physical'
    | 'ios.simulator'
    | 'android.physical'
    | 'android.emulator'
    | 'android.h264'
    | 'appium'
    | 'wda'
    | 'simctl'
    | 'adb';

export interface HostSnapshot {
    id: string;
    hostname: string;
    os: NodeJS.Platform | 'unknown';
    arch: string;
    online: boolean;
    observedAt: string;
    error?: string;
    capabilities: HostCapability[];
    networkRoutes?: NetworkRouteAttestation[];
    tools: {
        appium: boolean;
        appiumRuntime: boolean;
        xcrun: boolean;
        adb: boolean;
        emulator: boolean;
        scrcpyVideo: boolean;
    };
    metrics?: {
        uptimeSeconds: number;
        load1: number;
        cpuCount: number;
        totalMemoryBytes: number;
        freeMemoryBytes: number;
    };
}

async function exists(file: string): Promise<boolean> {
    try { await access(file); return true; } catch { return false; }
}

async function commandAvailable(command: string, envPath = process.env.PATH ?? ''): Promise<boolean> {
    for (const directory of envPath.split(path.delimiter).filter(Boolean)) {
        if (await exists(path.join(directory, command))) return true;
    }
    return false;
}

export async function detectHostCapabilities(options: {
    id?: string;
    hostname?: string;
    platform?: NodeJS.Platform;
    arch?: string;
    envPath?: string;
    appiumEntry?: string;
    appiumRuntimeEntry?: string;
    physicalIosEnabled?: boolean;
    scrcpyServerJar?: string;
    networkRoutesValue?: string;
    commandAvailable?: (command: string) => Promise<boolean>;
    virtualRuntimes?: () => Promise<Array<Pick<VirtualRuntime, 'platform' | 'kind'>>>;
} = {}): Promise<HostSnapshot> {
    const platform = options.platform ?? process.platform;
    const probe = options.commandAvailable ?? ((command: string) => commandAvailable(command, options.envPath));
    const [xcrun, adb, emulator, appium, appiumRuntime, scrcpyVideo] = await Promise.all([
        probe('xcrun'),
        probe('adb'),
        probe('emulator'),
        exists(options.appiumEntry ?? path.resolve('node_modules/appium-runtime/index.js')),
        exists(options.appiumRuntimeEntry ?? path.resolve('node_modules/appium-runtime/index.js')),
        options.scrcpyServerJar || dfarmingEnv('SCRCPY_SERVER_JAR')
            ? exists(options.scrcpyServerJar ?? dfarmingEnv('SCRCPY_SERVER_JAR')!)
            : Promise.resolve(false),
    ]);
    const capabilities: HostCapability[] = [];
    const networkRoutes = parseNetworkRouteAttestations(options.networkRoutesValue);
    const physicalIosEnabled = options.physicalIosEnabled ?? physicalIosLaneEnabled();
    const hostedVirtualRuntimes = platform === 'linux'
        ? await (options.virtualRuntimes ?? listVirtualRuntimes)().catch(() => [])
        : [];
    const dockerOrLocalAndroidEmulator = hostedVirtualRuntimes.some(
        (runtime) => runtime.platform === 'android' && runtime.kind === 'emulator',
    );
    if (appium || appiumRuntime) capabilities.push('appium');
    if (xcrun) capabilities.push('simctl');
    if (adb) capabilities.push('adb');
    if (platform === 'darwin') {
        if (physicalIosEnabled) capabilities.push('ios.physical');
        if (xcrun) capabilities.push('ios.simulator');
        if (physicalIosEnabled && xcrun && appium) capabilities.push('wda');
    }
    if (adb) capabilities.push('android.physical');
    if (adb && (emulator || dockerOrLocalAndroidEmulator)) capabilities.push('android.emulator');
    if (adb && scrcpyVideo) capabilities.push('android.h264');
    return {
        id: options.id ?? dfarmingEnv('WORKER_ID') ?? 'local',
        hostname: options.hostname ?? os.hostname(),
        os: platform,
        arch: options.arch ?? process.arch,
        online: true,
        observedAt: new Date().toISOString(),
        capabilities,
        ...(networkRoutes.length ? { networkRoutes } : {}),
        tools: { appium, appiumRuntime, xcrun, adb, emulator, scrcpyVideo },
        metrics: {
            uptimeSeconds: Math.max(0, Math.round(os.uptime())),
            load1: Number((os.loadavg()[0] ?? 0).toFixed(2)),
            cpuCount: os.cpus().length,
            totalMemoryBytes: os.totalmem(),
            freeMemoryBytes: os.freemem(),
        },
    };
}
