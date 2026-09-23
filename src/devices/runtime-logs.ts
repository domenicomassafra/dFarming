import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import type { RegisteredDevice } from './registry.js';
import type { DeviceLogSnapshot } from './wda-remote.js';

const execFileAsync = promisify(execFile);

export interface DeviceLogOptions {
    lines?: number;
    sinceSeconds?: number;
}

type CommandRunner = (
    executable: string,
    args: string[],
    options: { timeout: number; maxBuffer: number },
) => Promise<{ stdout: string | Buffer }>;

function boundedInteger(value: number | undefined, fallback: number, min: number, max: number): number {
    if (!Number.isFinite(value)) return fallback;
    return Math.max(min, Math.min(max, Math.round(value!)));
}

export function redactRuntimeLogLine(line: string): string {
    return line
        .replace(/(authorization\s*[:=]\s*bearer\s+)[^\s,;]+/ig, '$1[REDACTED]')
        .replace(/\b(token|password|passwd|secret|api[_-]?key)\s*[:=]\s*([^\s,;]+)/ig, '$1=[REDACTED]')
        .slice(0, 2_000);
}

function tailLines(stdout: string, count: number): string[] {
    return stdout.split(/\r?\n/)
        .map((line) => redactRuntimeLogLine(line.trimEnd()))
        .filter(Boolean)
        .slice(-count);
}

export async function collectRecentDeviceLogs(
    device: Pick<RegisteredDevice, 'udid' | 'platform' | 'kind'>,
    options: DeviceLogOptions = {},
    run: CommandRunner = execFileAsync as CommandRunner,
): Promise<DeviceLogSnapshot> {
    const lines = boundedInteger(options.lines, 120, 1, 500);
    const sinceSeconds = boundedInteger(options.sinceSeconds, 30, 1, 300);
    const capturedAt = new Date().toISOString();
    const platform = device.platform ?? 'ios';
    const kind = device.kind ?? 'physical';

    if (platform === 'ios' && kind === 'simulator') {
        const { stdout } = await run('xcrun', [
            'simctl', 'spawn', device.udid, 'log', 'show',
            '--last', `${sinceSeconds}s`, '--style', 'compact',
        ], { timeout: 15_000, maxBuffer: 2 * 1024 * 1024 });
        return { supported: true, source: 'simctl', capturedAt, lines: tailLines(String(stdout), lines) };
    }

    if (platform === 'android') {
        const { stdout } = await run('adb', [
            '-s', device.udid, 'logcat', '-d', '-t', String(lines), '-v', 'brief',
        ], { timeout: 15_000, maxBuffer: 2 * 1024 * 1024 });
        return { supported: true, source: 'adb', capturedAt, lines: tailLines(String(stdout), lines) };
    }

    return {
        supported: false,
        source: 'unavailable',
        capturedAt,
        lines: [],
        warning: 'Recent bounded logs are currently available for iOS Simulator and Android runtimes only',
    };
}
