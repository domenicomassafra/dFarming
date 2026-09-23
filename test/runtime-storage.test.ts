import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, utimes, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
    cleanupRuntimeStorage,
    collectRuntimeStorageReport,
    DEFAULT_RUNTIME_DISK_BUDGET_GB,
    runtimeDiskBudgetBytes,
} from '../src/runtime-storage.js';

test('runtime storage report covers Appium, simulator, emulator and WDA footprints against a budget', async (context) => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'dfarming-storage-report-'));
    context.after(() => rm(root, { recursive: true, force: true }));
    const home = path.join(root, 'home');
    const cwd = path.join(root, 'repo');
    const appium = path.join(cwd, '.appium-runtime');
    const ios = path.join(home, 'Library/Developer/CoreSimulator/Devices');
    const android = path.join(home, '.android/avd');
    const derived = path.join(home, 'Library/Developer/Xcode/DerivedData/WebDriverAgent-test');
    await Promise.all([appium, ios, android, derived].map((directory) => mkdir(directory, { recursive: true })));
    await Promise.all([
        writeFile(path.join(appium, 'a'), Buffer.alloc(10)),
        writeFile(path.join(ios, 'b'), Buffer.alloc(20)),
        writeFile(path.join(android, 'c'), Buffer.alloc(30)),
        writeFile(path.join(derived, 'd'), Buffer.alloc(40)),
    ]);
    const report = await collectRuntimeStorageReport({ home, cwd, env: {}, budgetBytes: 99 });
    assert.equal(report.totalBytes, 100);
    assert.equal(report.overBudget, true);
    assert.deepEqual(report.entries.map(({ id, bytes }) => [id, bytes]), [
        ['appium-runtime', 10], ['ios-simulators', 20], ['android-avds', 30], ['wda-derived-data', 40],
    ]);
});

test('runtime storage cleanup removes only stale rebuildable caches and skips locked Android AVDs', async (context) => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'dfarming-storage-clean-'));
    context.after(() => rm(root, { recursive: true, force: true }));
    const home = path.join(root, 'home');
    const cwd = path.join(root, 'repo');
    const appiumCache = path.join(cwd, '.appium-runtime/node_modules/.cache/appium');
    const oldWda = path.join(home, 'Library/Developer/Xcode/DerivedData/WebDriverAgent-old');
    const newWda = path.join(home, 'Library/Developer/Xcode/DerivedData/WebDriverAgent-new');
    const idleAvd = path.join(home, '.android/avd/Idle.avd');
    const liveAvd = path.join(home, '.android/avd/Live.avd');
    await Promise.all([appiumCache, oldWda, newWda, idleAvd, liveAvd].map((directory) => mkdir(directory, { recursive: true })));
    const oldCache = path.join(idleAvd, 'cache.img');
    const liveCache = path.join(liveAvd, 'cache.img.qcow2');
    await Promise.all([
        writeFile(path.join(appiumCache, 'extensions.yaml'), 'stale'),
        writeFile(path.join(oldWda, 'build'), 'old'),
        writeFile(path.join(newWda, 'build'), 'new'),
        writeFile(oldCache, 'old-cache'),
        writeFile(liveCache, 'live-cache'),
        writeFile(path.join(liveAvd, 'hardware-qemu.ini.lock'), ''),
    ]);
    const now = Date.UTC(2026, 8, 23);
    const old = new Date(now - 30 * 24 * 60 * 60 * 1000);
    await Promise.all([utimes(oldWda, old, old), utimes(oldCache, old, old), utimes(liveCache, old, old)]);
    const commands: string[] = [];
    const cleanup = await cleanupRuntimeStorage({
        home, cwd, env: {}, platform: 'darwin', staleDays: 14, nowMs: now,
        runCommand: async (command, args) => { commands.push([command, ...args].join(' ')); },
    });
    assert.deepEqual(commands, ['xcrun simctl delete unavailable']);
    assert.equal(cleanup.appiumCacheCleared, true);
    assert.equal(cleanup.iosUnavailableSimulatorsPruned, true);
    assert.deepEqual(cleanup.removedAndroidCacheFiles, [oldCache]);
    assert.deepEqual(cleanup.removedWdaDerivedData, [oldWda]);
    await assert.rejects(() => readFile(path.join(appiumCache, 'extensions.yaml'), 'utf8'), /ENOENT/);
    await assert.rejects(() => readFile(oldCache, 'utf8'), /ENOENT/);
    await assert.rejects(() => readFile(path.join(oldWda, 'build'), 'utf8'), /ENOENT/);
    assert.equal(await readFile(liveCache, 'utf8'), 'live-cache');
    assert.equal(await readFile(path.join(newWda, 'build'), 'utf8'), 'new');
});

test('runtime disk budget is bounded and configurable', () => {
    assert.equal(runtimeDiskBudgetBytes(), DEFAULT_RUNTIME_DISK_BUDGET_GB * 1024 ** 3);
    assert.equal(runtimeDiskBudgetBytes('1.5'), 1.5 * 1024 ** 3);
    assert.throws(() => runtimeDiskBudgetBytes('0'), /positive number/);
});
