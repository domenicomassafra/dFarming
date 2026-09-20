import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { discoverConnectedDevices, type Device } from './discovery.js';
import { mutateRegisteredDevices, type RegisteredDevice } from './registry.js';

const execFileAsync = promisify(execFile);

export interface RuntimeDevice extends Device {
    platform: 'ios' | 'android';
    kind: 'physical' | 'simulator' | 'emulator';
    automationBackend: 'wda' | 'appium';
}

export function workerAllowsRuntimeDevice(
    device: Pick<RegisteredDevice, 'platform' | 'kind'>,
    physicalIosEnabled: boolean,
): boolean {
    const platform = device.platform ?? 'ios';
    const kind = device.kind ?? 'physical';
    return platform !== 'ios' || kind !== 'physical' || physicalIosEnabled;
}

export function workerAllowsOperationalDevice(
    device: Pick<RegisteredDevice, 'platform' | 'kind' | 'disabled'>,
    physicalIosEnabled: boolean,
): boolean {
    return device.disabled !== true && workerAllowsRuntimeDevice(device, physicalIosEnabled);
}

export function filterRuntimeDevicesForWorker(
    devices: readonly RuntimeDevice[],
    physicalIosEnabled: boolean,
): RuntimeDevice[] {
    return devices.filter((device) => workerAllowsRuntimeDevice(device, physicalIosEnabled));
}

function iosRuntimeVersion(runtime: string): string {
    const tail = runtime.split('.').at(-1) ?? runtime;
    return tail.replace(/^iOS-/, '').replaceAll('-', '.');
}

export function parseSimctlDevices(stdout: string): RuntimeDevice[] {
    const body = JSON.parse(stdout) as { devices?: Record<string, Array<{ name?: string; udid?: string; state?: string; isAvailable?: boolean }>> };
    return Object.entries(body.devices ?? {}).flatMap(([runtime, devices]) => devices.flatMap((device) => {
        if (!device.udid || device.isAvailable === false) return [];
        return [{
            name: device.name ?? `iOS Simulator ${device.udid.slice(-6)}`,
            osVersion: iosRuntimeVersion(runtime),
            udid: device.udid,
            platform: 'ios' as const,
            kind: 'simulator' as const,
            automationBackend: 'appium' as const,
        }];
    }));
}

export async function discoverIosSimulators(): Promise<RuntimeDevice[]> {
    if (process.platform !== 'darwin') return [];
    try {
        const { stdout } = await execFileAsync('xcrun', ['simctl', 'list', 'devices', 'available', '--json'], { maxBuffer: 8 * 1024 * 1024 });
        return parseSimctlDevices(stdout);
    } catch {
        return [];
    }
}

export async function discoverRuntimeDevices(
    options: { includePhysical?: boolean } = {},
): Promise<RuntimeDevice[]> {
    const includePhysical = options.includePhysical ?? true;
    const [iosPhysical, iosSimulators, android] = await Promise.all([
        includePhysical && process.platform === 'darwin' ? discoverConnectedDevices().catch(() => []) : Promise.resolve([]),
        discoverIosSimulators(),
        discoverAndroidDevices(),
    ]);
    return [
        ...iosPhysical.map((device) => ({ ...device, platform: 'ios' as const, kind: 'physical' as const, automationBackend: 'wda' as const })),
        ...iosSimulators,
        ...android,
    ];
}

async function adbProperty(serial: string, property: string): Promise<string> {
    try {
        const { stdout } = await execFileAsync('adb', ['-s', serial, 'shell', 'getprop', property], { timeout: 4_000 });
        return stdout.trim();
    } catch {
        return '';
    }
}

export function parseAdbDevices(stdout: string): Array<{ serial: string; modelHint?: string }> {
    return stdout.split(/\r?\n/).slice(1).map((line) => line.trim()).filter(Boolean)
        .map((line) => line.split(/\s+/))
        .filter((parts) => parts[1] === 'device')
        .map((parts) => {
            const modelHint = parts.find((value) => value.startsWith('model:'))?.slice('model:'.length).replaceAll('_', ' ');
            return { serial: parts[0]!, ...(modelHint ? { modelHint } : {}) };
        });
}

export function androidRuntimeKind(serial: string, qemuFlag: string): 'physical' | 'emulator' {
    return serial.startsWith('emulator-') || qemuFlag.trim() === '1' ? 'emulator' : 'physical';
}

export async function discoverAndroidDevices(): Promise<RuntimeDevice[]> {
    try {
        const { stdout } = await execFileAsync('adb', ['devices', '-l'], { timeout: 5_000 });
        const serials = parseAdbDevices(stdout);
        return await Promise.all(serials.map(async ({ serial, modelHint }) => {
            const [model, version, qemuFlag] = await Promise.all([
                modelHint ? Promise.resolve(modelHint) : adbProperty(serial, 'ro.product.model'),
                adbProperty(serial, 'ro.build.version.release'),
                adbProperty(serial, 'ro.kernel.qemu'),
            ]);
            const kind = androidRuntimeKind(serial, qemuFlag);
            return {
                name: model || (kind === 'emulator' ? `Android Emulator ${serial}` : `Android ${serial.slice(-6)}`),
                osVersion: version || 'unknown',
                udid: serial,
                platform: 'android' as const,
                kind,
                automationBackend: 'appium' as const,
            };
        }));
    } catch {
        return [];
    }
}

export async function registerRuntimeDevice(
    udid: string,
    options: { name?: string; includePhysical?: boolean } = {},
): Promise<RegisteredDevice> {
    const runtime = (await discoverRuntimeDevices({ includePhysical: options.includePhysical })).find((device) => device.udid === udid);
    if (!runtime) throw Object.assign(new Error('Runtime device is not currently discoverable on this worker'), { statusCode: 404 });
    if (runtime.platform === 'ios' && runtime.kind === 'physical') {
        throw Object.assign(new Error('Physical iPhones use the guided WDA registration flow'), { statusCode: 409 });
    }
    let result!: RegisteredDevice;
    await mutateRegisteredDevices((devices) => {
        const existing = devices.find((device) => device.udid === runtime.udid);
        if (existing) {
            result = existing;
            return;
        }
        result = {
            name: options.name?.trim().slice(0, 100) || runtime.name,
            udid: runtime.udid,
            osVersion: runtime.osVersion,
            productType: runtime.productType,
            platform: runtime.platform,
            kind: runtime.kind,
            automationBackend: 'appium',
            pluginData: {},
        };
        devices.push(result);
    });
    return result;
}
