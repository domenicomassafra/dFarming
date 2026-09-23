import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';

import { dfarmingEnv } from '../env.js';

const execFileAsync = promisify(execFile);

export type VirtualRuntimePlatform = 'ios' | 'android';
export type VirtualRuntimeState = 'booted' | 'booting' | 'shutdown';

export interface VirtualRuntime {
    id: string;
    name: string;
    platform: VirtualRuntimePlatform;
    kind: 'simulator' | 'emulator';
    state: VirtualRuntimeState;
    osVersion?: string;
    serial?: string;
    provider?: 'simctl' | 'local-avd' | 'docker';
    containerName?: string;
}

function iosRuntimeVersion(runtime: string): string {
    const tail = runtime.split('.').at(-1) ?? runtime;
    return tail.replace(/^iOS-/, '').replaceAll('-', '.');
}

export function parseVirtualSimulators(stdout: string): VirtualRuntime[] {
    const body = JSON.parse(stdout) as {
        devices?: Record<string, Array<{ name?: string; udid?: string; state?: string; isAvailable?: boolean }>>;
    };
    return Object.entries(body.devices ?? {}).flatMap(([runtime, devices]) => devices.flatMap((device) => {
        if (!device.udid || device.isAvailable === false) return [];
        return [{
            id: device.udid,
            name: device.name ?? `iOS Simulator ${device.udid.slice(-6)}`,
            platform: 'ios' as const,
            kind: 'simulator' as const,
            state: device.state === 'Booted'
                ? 'booted' as const
                : device.state === 'Shutdown' ? 'shutdown' as const : 'booting' as const,
            osVersion: iosRuntimeVersion(runtime),
            provider: 'simctl' as const,
        }];
    }));
}

export function parseAvdNames(stdout: string): string[] {
    return stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
}

export interface DockerAndroidRuntimeDefinition {
    id: string;
    name: string;
    serial: string;
    running: boolean;
    containerName: string;
}

export function parseDockerAndroidRuntimeDefinitions(stdout: string): DockerAndroidRuntimeDefinition[] {
    if (!stdout.trim()) return [];
    const body = JSON.parse(stdout) as Array<{
        Name?: string;
        State?: { Running?: boolean };
        Config?: { Labels?: Record<string, string>; Image?: string };
        NetworkSettings?: { Ports?: Record<string, Array<{ HostIp?: string; HostPort?: string }> | null> };
        HostConfig?: { PortBindings?: Record<string, Array<{ HostIp?: string; HostPort?: string }> | null> };
    }>;
    return body.flatMap((container) => {
        if (container.Config?.Labels?.['com.dfarming.runtime'] !== 'android-emulator') return [];
        const containerName = container.Name?.replace(/^\/+/, '').trim();
        const hostPort = (
            container.NetworkSettings?.Ports?.['5555/tcp']?.[0]?.HostPort
            ?? container.HostConfig?.PortBindings?.['5555/tcp']?.[0]?.HostPort
        )?.trim();
        if (!containerName || !hostPort || !/^\d{1,5}$/.test(hostPort)) return [];
        return [{
            id: `docker:${containerName}`,
            name: container.Config?.Labels?.['com.dfarming.runtime.display-name']?.trim()
                || container.Config?.Labels?.['com.google.android.emulator.description']?.trim()
                || `Android Emulator (${containerName})`,
            serial: `127.0.0.1:${hostPort}`,
            running: container.State?.Running === true,
            containerName,
        }];
    });
}

async function iosVirtualRuntimes(): Promise<VirtualRuntime[]> {
    if (process.platform !== 'darwin') return [];
    try {
        const { stdout } = await execFileAsync('xcrun', ['simctl', 'list', 'devices', 'available', '--json'], {
            timeout: 8_000, maxBuffer: 8 * 1024 * 1024,
        });
        return parseVirtualSimulators(stdout);
    } catch {
        return [];
    }
}

async function runningAndroidAvds(): Promise<Map<string, string>> {
    const result = new Map<string, string>();
    try {
        const { stdout } = await execFileAsync('adb', ['devices'], { timeout: 5_000 });
        const serials = stdout.split(/\r?\n/).slice(1).map((line) => line.trim().split(/\s+/))
            .filter((parts) => parts[0]?.startsWith('emulator-') && parts[1] === 'device').map((parts) => parts[0]!);
        await Promise.all(serials.map(async (serial) => {
            try {
                const { stdout: avd } = await execFileAsync('adb', ['-s', serial, 'emu', 'avd', 'name'], { timeout: 3_000 });
                const name = avd.split(/\r?\n/).map((line) => line.trim()).find((line) => line && line !== 'OK');
                if (name) result.set(name, serial);
            } catch { /* emulator may be booting */ }
        }));
    } catch { /* adb unavailable */ }
    return result;
}

async function androidBootCompleted(serial: string): Promise<boolean> {
    try {
        const { stdout } = await execFileAsync('adb', ['-s', serial, 'shell', 'getprop', 'sys.boot_completed'], { timeout: 3_000 });
        return stdout.trim() === '1';
    } catch {
        return false;
    }
}

export interface AndroidBootWaitOptions {
    timeoutMs?: number;
    pollMs?: number;
    runningAvds?: () => Promise<Map<string, string>>;
    bootCompleted?: (serial: string) => Promise<boolean>;
    now?: () => number;
    sleep?: (milliseconds: number) => Promise<void>;
}

export async function waitForAndroidVirtualRuntime(
    name: string,
    options: AndroidBootWaitOptions = {},
): Promise<string> {
    const configuredTimeout = options.timeoutMs ?? Number(dfarmingEnv('ANDROID_EMULATOR_BOOT_TIMEOUT_MS') ?? 120_000);
    const timeoutMs = Number.isFinite(configuredTimeout)
        ? Math.max(10_000, Math.min(120_000, Math.round(configuredTimeout)))
        : 120_000;
    const pollMs = Math.max(100, Math.min(2_000, Math.round(options.pollMs ?? 1_000)));
    const running = options.runningAvds ?? runningAndroidAvds;
    const booted = options.bootCompleted ?? androidBootCompleted;
    const now = options.now ?? Date.now;
    const sleep = options.sleep ?? ((milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds)));
    const deadline = now() + timeoutMs;
    let lastSerial: string | undefined;
    while (true) {
        const serial = (await running()).get(name);
        if (serial) {
            lastSerial = serial;
            if (await booted(serial)) return serial;
        }
        if (now() >= deadline) break;
        await sleep(pollMs);
    }
    throw new Error(
        `Android emulator ${name} did not finish booting within ${timeoutMs}ms`
        + (lastSerial ? ` (last ADB serial: ${lastSerial})` : ' (no ADB serial appeared)'),
    );
}

async function androidVirtualRuntimes(): Promise<VirtualRuntime[]> {
    let avds: VirtualRuntime[] = [];
    try {
        const { stdout } = await execFileAsync('emulator', ['-list-avds'], { timeout: 5_000 });
        const running = await runningAndroidAvds();
        avds = await Promise.all(parseAvdNames(stdout).map(async (name) => {
            const serial = running.get(name);
            const state: VirtualRuntimeState = !serial
                ? 'shutdown'
                : await androidBootCompleted(serial) ? 'booted' : 'booting';
            return {
                id: name,
                name,
                platform: 'android' as const,
                kind: 'emulator' as const,
                state,
                ...(serial ? { serial } : {}),
                provider: 'local-avd' as const,
            };
        }));
    } catch { /* local emulator CLI may be absent on container-only workers */ }

    let containers: VirtualRuntime[] = [];
    if (process.platform === 'linux') {
        try {
            const { stdout: ids } = await execFileAsync(
                'docker',
                ['ps', '-aq', '--filter', 'label=com.dfarming.runtime=android-emulator'],
                { timeout: 5_000 },
            );
            const containerIds = ids.split(/\r?\n/).map((value) => value.trim()).filter(Boolean);
            if (containerIds.length) {
                const { stdout: inspect } = await execFileAsync('docker', ['inspect', ...containerIds], {
                    timeout: 8_000,
                    maxBuffer: 8 * 1024 * 1024,
                });
                containers = await Promise.all(parseDockerAndroidRuntimeDefinitions(inspect).map(async (definition) => ({
                    id: definition.id,
                    name: definition.name,
                    platform: 'android' as const,
                    kind: 'emulator' as const,
                    state: !definition.running
                        ? 'shutdown' as const
                        : await androidBootCompleted(definition.serial) ? 'booted' as const : 'booting' as const,
                    serial: definition.serial,
                    provider: 'docker' as const,
                    containerName: definition.containerName,
                })));
            }
        } catch { /* Docker is optional on ordinary Android workers */ }
    }
    return [...avds, ...containers];
}

export async function listVirtualRuntimes(): Promise<VirtualRuntime[]> {
    const [ios, android] = await Promise.all([iosVirtualRuntimes(), androidVirtualRuntimes()]);
    return [...ios, ...android];
}

async function requiredRuntime(platform: VirtualRuntimePlatform, id: string): Promise<VirtualRuntime> {
    const runtime = (await listVirtualRuntimes()).find((candidate) => candidate.platform === platform && candidate.id === id);
    if (!runtime) throw Object.assign(new Error(`Unknown ${platform} virtual runtime ${id}`), { statusCode: 404 });
    return runtime;
}

export async function changeVirtualRuntimeState(
    platform: VirtualRuntimePlatform,
    id: string,
    action: 'boot' | 'shutdown',
): Promise<void> {
    const runtime = await requiredRuntime(platform, id);
    if (platform === 'ios') {
        if (process.platform !== 'darwin') throw Object.assign(new Error('iOS simulators require a macOS worker'), { statusCode: 409 });
        if (action === 'boot') {
            if (runtime.state === 'booted') return;
            await execFileAsync('xcrun', ['simctl', 'boot', runtime.id], { timeout: 30_000 });
            await execFileAsync('xcrun', ['simctl', 'bootstatus', runtime.id, '-b'], { timeout: 120_000 });
        } else {
            if (runtime.state === 'shutdown') return;
            await execFileAsync('xcrun', ['simctl', 'shutdown', runtime.id], { timeout: 30_000 });
        }
        return;
    }
    if (runtime.provider === 'docker') {
        if (!runtime.containerName || !runtime.serial) {
            throw Object.assign(new Error('Docker Android runtime metadata is incomplete'), { statusCode: 409 });
        }
        if (action === 'shutdown') {
            if (runtime.state === 'shutdown') return;
            await execFileAsync('docker', ['stop', runtime.containerName], { timeout: 30_000 });
            return;
        }
        if (runtime.state === 'shutdown') {
            await execFileAsync('docker', ['start', runtime.containerName], { timeout: 30_000 });
        }
        const configuredTimeout = Number(dfarmingEnv('ANDROID_EMULATOR_BOOT_TIMEOUT_MS') ?? 120_000);
        const timeoutMs = Number.isFinite(configuredTimeout)
            ? Math.max(10_000, Math.min(120_000, Math.round(configuredTimeout)))
            : 120_000;
        const deadline = Date.now() + timeoutMs;
        while (true) {
            try { await execFileAsync('adb', ['connect', runtime.serial], { timeout: 3_000 }); } catch { /* retry below */ }
            if (await androidBootCompleted(runtime.serial)) return;
            if (Date.now() >= deadline) {
                throw new Error(`Android emulator container ${runtime.containerName} did not finish booting within ${timeoutMs}ms`);
            }
            await new Promise((resolve) => setTimeout(resolve, 1_000));
        }
    }
    if (action === 'boot') {
        if (runtime.state === 'booted') return;
        if (runtime.state === 'shutdown') {
            const args = ['-avd', runtime.id, '-no-snapshot-save', '-no-boot-anim'];
            if (dfarmingEnv('ANDROID_EMULATOR_HEADLESS') === 'true') args.push('-no-window');
            const child = spawn('emulator', args, { detached: true, stdio: 'ignore' });
            child.unref();
        }
        await waitForAndroidVirtualRuntime(runtime.id);
        return;
    }
    const serial = runtime.serial;
    if (!serial) return;
    await execFileAsync('adb', ['-s', serial, 'emu', 'kill'], { timeout: 10_000 });
}
