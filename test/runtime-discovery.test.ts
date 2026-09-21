import assert from 'node:assert/strict';
import test from 'node:test';

import {
    androidRuntimeKind, filterRuntimeDevicesForWorker, parseAdbDevices, parseSimctlDevices, workerAllowsOperationalDevice,
} from '../src/devices/runtime-discovery.js';

test('parses available iOS simulators into Appium runtimes', () => {
    const devices = parseSimctlDevices(JSON.stringify({
        devices: {
            'com.apple.CoreSimulator.SimRuntime.iOS-26-0': [
                { name: 'iPhone 17', udid: 'SIM-1', state: 'Booted', isAvailable: true },
                { name: 'iPhone 17 Pro', udid: 'SIM-SHUTDOWN', state: 'Shutdown', isAvailable: true },
                { name: 'Unavailable', udid: 'SIM-2', isAvailable: false },
            ],
        },
    }));
    assert.deepEqual(devices, [{
        name: 'iPhone 17', osVersion: '26.0', udid: 'SIM-1', platform: 'ios', kind: 'simulator', automationBackend: 'appium',
    }]);
});

test('simulator-only workers never advertise a connected physical iPhone', () => {
    const devices = [
        { name: 'Physical', osVersion: '26.0', udid: 'PHONE-1', platform: 'ios' as const, kind: 'physical' as const, automationBackend: 'wda' as const },
        { name: 'Simulator', osVersion: '26.0', udid: 'SIM-1', platform: 'ios' as const, kind: 'simulator' as const, automationBackend: 'appium' as const },
        { name: 'Android', osVersion: '16', udid: 'ANDROID-1', platform: 'android' as const, kind: 'physical' as const, automationBackend: 'appium' as const },
    ];
    assert.deepEqual(filterRuntimeDevicesForWorker(devices, false).map(({ udid }) => udid), ['SIM-1', 'ANDROID-1']);
    assert.deepEqual(filterRuntimeDevicesForWorker(devices, true).map(({ udid }) => udid), ['PHONE-1', 'SIM-1', 'ANDROID-1']);
});

test('worker operational gates reject disabled devices and disabled physical lanes', () => {
    assert.equal(workerAllowsOperationalDevice({ platform: 'ios', kind: 'simulator' }, false), true);
    assert.equal(workerAllowsOperationalDevice({ platform: 'ios', kind: 'simulator', disabled: true }, false), false);
    assert.equal(workerAllowsOperationalDevice({ platform: 'ios', kind: 'physical' }, false), false);
    assert.equal(workerAllowsOperationalDevice({ platform: 'ios', kind: 'physical' }, true), true);
    assert.equal(workerAllowsOperationalDevice({ platform: 'android', kind: 'physical' }, false), true);
});

test('parses adb real devices and emulators while ignoring unavailable rows', () => {
    const rows = parseAdbDevices(`List of devices attached\nemulator-5554 device product:sdk model:Pixel_9 transport_id:1\nABC123 device model:Galaxy_S25 transport_id:2\nNOPE unauthorized usb:1-1\n`);
    assert.deepEqual(rows, [
        { serial: 'emulator-5554', modelHint: 'Pixel 9' },
        { serial: 'ABC123', modelHint: 'Galaxy S25' },
    ]);
});

test('classifies TCP-connected qemu runtimes as emulators', () => {
    assert.equal(androidRuntimeKind('emulator-5554', ''), 'emulator');
    assert.equal(androidRuntimeKind('localhost:5555', '1'), 'emulator');
    assert.equal(androidRuntimeKind('192.0.2.10:5555', '1'), 'emulator');
    assert.equal(androidRuntimeKind('ABC123', '0'), 'physical');
});
