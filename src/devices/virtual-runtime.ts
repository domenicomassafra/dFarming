import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export type VirtualRuntimePlatform = 'ios' | 'android';
export type VirtualRuntimeState = 'booted' | 'shutdown';

export interface VirtualRuntime {
    id: string;
    name: string;
    platform: VirtualRuntimePlatform;
    kind: 'simulator' | 'emulator';
    state: VirtualRuntimeState;
    osVersion?: string;
    serial?: string;
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
            state: device.state === 'Booted' ? 'booted' as const : 'shutdown' as const,
            osVersion: iosRuntimeVersion(runtime),
        }];
    }));
}

export function parseAvdNames(stdout: string): string[] {
    return stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
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

async function androidVirtualRuntimes(): Promise<VirtualRuntime[]> {
    try {
        const { stdout } = await execFileAsync('emulator', ['-list-avds'], { timeout: 5_000 });
        const running = await runningAndroidAvds();
        return parseAvdNames(stdout).map((name) => ({
            id: name,
            name,
            platform: 'android' as const,
            kind: 'emulator' as const,
            state: running.has(name) ? 'booted' as const : 'shutdown' as const,
            ...(running.get(name) ? { serial: running.get(name) } : {}),
        }));
    } catch {
        return [];
    }
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
    if (action === 'boot') {
        if (runtime.state === 'booted') return;
        const args = ['-avd', runtime.id, '-no-snapshot-save', '-no-boot-anim'];
        if (process.env.PHONE_FARM_ANDROID_EMULATOR_HEADLESS === 'true') args.push('-no-window');
        const child = spawn('emulator', args, { detached: true, stdio: 'ignore' });
        child.unref();
        return;
    }
    const serial = runtime.serial;
    if (!serial) return;
    await execFileAsync('adb', ['-s', serial, 'emu', 'kill'], { timeout: 10_000 });
}
