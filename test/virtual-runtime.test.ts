import assert from 'node:assert/strict';
import test from 'node:test';

import { parseAvdNames, parseVirtualSimulators, waitForAndroidVirtualRuntime } from '../src/devices/virtual-runtime.js';

test('parses available iOS simulator definitions and preserves boot state', () => {
    const runtimes = parseVirtualSimulators(JSON.stringify({
        devices: {
            'com.apple.CoreSimulator.SimRuntime.iOS-26-0': [
                { name: 'iPhone 17 Pro', udid: 'SIM-1', state: 'Booted', isAvailable: true },
                { name: 'iPhone Air', udid: 'SIM-2', state: 'Shutdown', isAvailable: true },
                { name: 'Unavailable', udid: 'SIM-3', state: 'Shutdown', isAvailable: false },
            ],
        },
    }));
    assert.deepEqual(runtimes.map(({ id, state, osVersion }) => ({ id, state, osVersion })), [
        { id: 'SIM-1', state: 'booted', osVersion: '26.0' },
        { id: 'SIM-2', state: 'shutdown', osVersion: '26.0' },
    ]);
});

test('parses Android AVD definitions without shell interpretation', () => {
    assert.deepEqual(parseAvdNames('Pixel_9_API_36\nTablet_API_35\n\n'), ['Pixel_9_API_36', 'Tablet_API_35']);
});

test('Android virtual runtime readiness waits for both ADB identity and completed boot', async () => {
    let now = 0;
    let probe = 0;
    const serial = await waitForAndroidVirtualRuntime('Pixel_9_API_36', {
        timeoutMs: 10_000,
        pollMs: 100,
        now: () => now,
        sleep: async (milliseconds) => { now += milliseconds; },
        runningAvds: async () => new Map(probe++ === 0 ? [] : [['Pixel_9_API_36', 'emulator-5554']]),
        bootCompleted: async () => probe >= 4,
    });
    assert.equal(serial, 'emulator-5554');
    assert.ok(probe >= 4);
});

test('Android virtual runtime readiness fails closed when boot never completes', async () => {
    let now = 0;
    await assert.rejects(waitForAndroidVirtualRuntime('Pixel_Broken', {
        timeoutMs: 10_000,
        pollMs: 2_000,
        now: () => now,
        sleep: async (milliseconds) => { now += milliseconds; },
        runningAvds: async () => new Map([['Pixel_Broken', 'emulator-5556']]),
        bootCompleted: async () => false,
    }), /did not finish booting.*emulator-5556/);
});
