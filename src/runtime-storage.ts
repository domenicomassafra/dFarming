import { execFile } from 'node:child_process';
import { lstat, readdir, rm, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

import { invalidateAppiumExtensionCache } from './appium-runtime-hardening.js';
import { dfarmingEnv } from './env.js';
import { isEntrypoint } from './entrypoint.js';

const execFileAsync = promisify(execFile);
const GIB = 1024 ** 3;

export const DEFAULT_RUNTIME_DISK_BUDGET_GB = 20;
export const DEFAULT_RUNTIME_STALE_DAYS = 14;

export interface RuntimeStorageEntry {
    id: 'appium-runtime' | 'ios-simulators' | 'android-avds' | 'wda-derived-data';
    path: string;
    bytes: number;
}

export interface RuntimeStorageReport {
    budgetBytes: number;
    totalBytes: number;
    overBudget: boolean;
    entries: RuntimeStorageEntry[];
}

export interface RuntimeStorageCleanupResult {
    appiumCacheCleared: boolean;
    iosUnavailableSimulatorsPruned: boolean;
    removedAndroidCacheFiles: string[];
    removedWdaDerivedData: string[];
}

async function pathSize(target: string): Promise<number> {
    const info = await lstat(target).catch(() => undefined);
    if (!info) return 0;
    if (info.isSymbolicLink()) return 0;
    if (!info.isDirectory()) return info.size;
    const entries = await readdir(target, { withFileTypes: true }).catch(() => []);
    let total = 0;
    for (const entry of entries) total += await pathSize(path.join(target, entry.name));
    return total;
}

async function matchingDirectorySize(parent: string, prefix: string): Promise<number> {
    const entries = await readdir(parent, { withFileTypes: true }).catch(() => []);
    let total = 0;
    for (const entry of entries) {
        if (!entry.isDirectory() || !entry.name.startsWith(prefix)) continue;
        total += await pathSize(path.join(parent, entry.name));
    }
    return total;
}

export function runtimeDiskBudgetBytes(value = dfarmingEnv('RUNTIME_DISK_BUDGET_GB')): number {
    const parsed = value === undefined || value.trim() === '' ? DEFAULT_RUNTIME_DISK_BUDGET_GB : Number(value);
    if (!Number.isFinite(parsed) || parsed <= 0) {
        throw new Error('DFARMING_RUNTIME_DISK_BUDGET_GB must be a positive number');
    }
    return Math.round(parsed * GIB);
}

export function runtimeStaleDays(value = dfarmingEnv('RUNTIME_STALE_DAYS')): number {
    const parsed = value === undefined || value.trim() === '' ? DEFAULT_RUNTIME_STALE_DAYS : Number(value);
    if (!Number.isFinite(parsed) || parsed < 0) {
        throw new Error('DFARMING_RUNTIME_STALE_DAYS must be a non-negative number');
    }
    return parsed;
}

export function runtimeStorageLocations(options: {
    home?: string;
    cwd?: string;
    env?: NodeJS.ProcessEnv;
} = {}) {
    const home = options.home ?? homedir();
    const cwd = options.cwd ?? process.cwd();
    const env = options.env ?? process.env;
    return {
        appiumHome: path.resolve(cwd, env.APPIUM_HOME ?? '.appium-runtime'),
        iosSimulatorRoot: path.join(home, 'Library', 'Developer', 'CoreSimulator', 'Devices'),
        androidAvdRoot: path.resolve(env.ANDROID_AVD_HOME ?? path.join(home, '.android', 'avd')),
        xcodeDerivedDataRoot: path.join(home, 'Library', 'Developer', 'Xcode', 'DerivedData'),
    };
}

export async function collectRuntimeStorageReport(options: {
    home?: string;
    cwd?: string;
    env?: NodeJS.ProcessEnv;
    budgetBytes?: number;
} = {}): Promise<RuntimeStorageReport> {
    const locations = runtimeStorageLocations(options);
    const entries: RuntimeStorageEntry[] = [
        { id: 'appium-runtime', path: locations.appiumHome, bytes: await pathSize(locations.appiumHome) },
        { id: 'ios-simulators', path: locations.iosSimulatorRoot, bytes: await pathSize(locations.iosSimulatorRoot) },
        { id: 'android-avds', path: locations.androidAvdRoot, bytes: await pathSize(locations.androidAvdRoot) },
        { id: 'wda-derived-data', path: locations.xcodeDerivedDataRoot, bytes: await matchingDirectorySize(locations.xcodeDerivedDataRoot, 'WebDriverAgent-') },
    ];
    const totalBytes = entries.reduce((sum, entry) => sum + entry.bytes, 0);
    const budgetBytes = options.budgetBytes ?? runtimeDiskBudgetBytes(dfarmingEnv('RUNTIME_DISK_BUDGET_GB', options.env));
    return { budgetBytes, totalBytes, overBudget: totalBytes > budgetBytes, entries };
}

async function directoryIsLocked(directory: string): Promise<boolean> {
    const entries = await readdir(directory).catch(() => []);
    return entries.some((name) => name.endsWith('.lock'));
}

async function removeStaleAndroidCaches(root: string, cutoffMs: number): Promise<string[]> {
    const entries = await readdir(root, { withFileTypes: true }).catch(() => []);
    const removed: string[] = [];
    for (const entry of entries) {
        if (!entry.isDirectory() || !entry.name.endsWith('.avd')) continue;
        const avd = path.join(root, entry.name);
        if (await directoryIsLocked(avd)) continue;
        const children = await readdir(avd, { withFileTypes: true }).catch(() => []);
        for (const child of children) {
            if (!child.isFile() || !/^cache\.img(?:\.qcow2)?$/.test(child.name)) continue;
            const file = path.join(avd, child.name);
            const info = await stat(file).catch(() => undefined);
            if (!info || info.mtimeMs > cutoffMs) continue;
            await rm(file, { force: true });
            removed.push(file);
        }
    }
    return removed;
}

async function removeStaleWdaDerivedData(root: string, cutoffMs: number): Promise<string[]> {
    const entries = await readdir(root, { withFileTypes: true }).catch(() => []);
    const removed: string[] = [];
    for (const entry of entries) {
        if (!entry.isDirectory() || !entry.name.startsWith('WebDriverAgent-')) continue;
        const directory = path.join(root, entry.name);
        const info = await stat(directory).catch(() => undefined);
        if (!info || info.mtimeMs > cutoffMs) continue;
        await rm(directory, { recursive: true, force: true });
        removed.push(directory);
    }
    return removed;
}

export async function cleanupRuntimeStorage(options: {
    home?: string;
    cwd?: string;
    env?: NodeJS.ProcessEnv;
    platform?: NodeJS.Platform;
    staleDays?: number;
    nowMs?: number;
    runCommand?: (command: string, args: string[]) => Promise<void>;
} = {}): Promise<RuntimeStorageCleanupResult> {
    const locations = runtimeStorageLocations(options);
    const staleDays = options.staleDays ?? runtimeStaleDays(dfarmingEnv('RUNTIME_STALE_DAYS', options.env));
    const cutoffMs = (options.nowMs ?? Date.now()) - staleDays * 24 * 60 * 60 * 1000;
    await invalidateAppiumExtensionCache(locations.appiumHome);

    let iosUnavailableSimulatorsPruned = false;
    if ((options.platform ?? process.platform) === 'darwin') {
        try {
            const runCommand = options.runCommand ?? (async (command: string, args: string[]) => {
                await execFileAsync(command, args, { timeout: 60_000 });
            });
            await runCommand('xcrun', ['simctl', 'delete', 'unavailable']);
            iosUnavailableSimulatorsPruned = true;
        } catch { /* Xcode/simctl may be unavailable on Android-only workers. */ }
    }

    const [removedAndroidCacheFiles, removedWdaDerivedData] = await Promise.all([
        removeStaleAndroidCaches(locations.androidAvdRoot, cutoffMs),
        removeStaleWdaDerivedData(locations.xcodeDerivedDataRoot, cutoffMs),
    ]);
    return {
        appiumCacheCleared: true,
        iosUnavailableSimulatorsPruned,
        removedAndroidCacheFiles,
        removedWdaDerivedData,
    };
}

function formatGiB(bytes: number): string { return `${(bytes / GIB).toFixed(2)} GiB`; }

async function main(): Promise<void> {
    const action = process.argv[2] ?? 'report';
    if (action === 'cleanup') {
        console.log(JSON.stringify(await cleanupRuntimeStorage(), null, 2));
    } else if (action !== 'report') {
        throw new Error('Usage: runtime-storage <report|cleanup>');
    }
    const report = await collectRuntimeStorageReport();
    for (const entry of report.entries) console.log(`${entry.id}: ${formatGiB(entry.bytes)} (${entry.path})`);
    console.log(`runtime total: ${formatGiB(report.totalBytes)} / budget ${formatGiB(report.budgetBytes)}${report.overBudget ? ' OVER BUDGET' : ''}`);
    if (report.overBudget) process.exitCode = 2;
}

if (isEntrypoint(import.meta.url)) await main();
