import assert from 'node:assert/strict';
import test from 'node:test';

import {
    parseAvdNames,
    parseDockerAndroidRuntimeDefinitions,
    parseVirtualSimulators,
    waitForAndroidVirtualRuntime,
} from '../src/devices/virtual-runtime.js';

test('parses available iOS simulator definitions and preserves boot state', () => {
    const runtimes = parseVirtualSimulators(JSON.stringify({
        devices: {
            'com.apple.CoreSimulator.SimRuntime.iOS-26-0': [
                { name: 'iPhone 17 Pro', udid: 'SIM-1', state: 'Booted', isAvailable: true },
                { name: 'iPhone Air', udid: 'SIM-2', state: 'Shutdown', isAvailable: true },
                { name: 'iPhone Booting', udid: 'SIM-4', state: 'Creating', isAvailable: true },
                { name: 'Unavailable', udid: 'SIM-3', state: 'Shutdown', isAvailable: false },
            ],
        },
    }));
    assert.deepEqual(runtimes.map(({ id, state, osVersion }) => ({ id, state, osVersion })), [
        { id: 'SIM-1', state: 'booted', osVersion: '26.0' },
        { id: 'SIM-2', state: 'shutdown', osVersion: '26.0' },
        { id: 'SIM-4', state: 'booting', osVersion: '26.0' },
    ]);
});

test('parses Android AVD definitions without shell interpretation', () => {
    assert.deepEqual(parseAvdNames('Pixel_9_API_36\nTablet_API_35\n\n'), ['Pixel_9_API_36', 'Tablet_API_35']);
});

test('parses labeled Android emulator containers into first-class virtual runtime definitions', () => {
    const definitions = parseDockerAndroidRuntimeDefinitions(JSON.stringify([
        {
            Name: '/dfarming-android-emulator-api30',
            State: { Running: true },
            Config: {
                Labels: {
                    'com.dfarming.runtime': 'android-emulator',
                    'com.dfarming.runtime.display-name': 'Google Android Emulator API 30',
                },
            },
            NetworkSettings: { Ports: { '5555/tcp': [{ HostIp: '127.0.0.1', HostPort: '5555' }] } },
        },
        {
            Name: '/unrelated',
            State: { Running: true },
            Config: { Labels: {} },
            NetworkSettings: { Ports: { '5555/tcp': [{ HostPort: '5556' }] } },
        },
    ]));
    assert.deepEqual(definitions, [{
        id: 'docker:dfarming-android-emulator-api30',
        name: 'Google Android Emulator API 30',
        serial: '127.0.0.1:5555',
        running: true,
        containerName: 'dfarming-android-emulator-api30',
    }]);
});

test('stopped Android emulator containers stay discoverable from persistent Docker port bindings', () => {
    const definitions = parseDockerAndroidRuntimeDefinitions(JSON.stringify([
        {
            Name: '/dfarming-android-emulator-api30',
            State: { Running: false },
            Config: {
                Labels: {
                    'com.dfarming.runtime': 'android-emulator',
                    'com.google.android.emulator.description': 'Pixel 2 Emulator, running API 30',
                },
            },
            NetworkSettings: { Ports: {} },
            HostConfig: { PortBindings: { '5555/tcp': [{ HostIp: '127.0.0.1', HostPort: '5555' }] } },
        },
    ]));
    assert.deepEqual(definitions, [{
        id: 'docker:dfarming-android-emulator-api30',
        name: 'Pixel 2 Emulator, running API 30',
        serial: '127.0.0.1:5555',
        running: false,
        containerName: 'dfarming-android-emulator-api30',
    }]);
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
