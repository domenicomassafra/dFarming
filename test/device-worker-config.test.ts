import assert from 'node:assert/strict';
import test from 'node:test';

import { applyWorkerDeviceConfig } from '../src/device-worker-server.js';
import type { RegisteredDevice } from '../src/types.js';

function androidDevice(): RegisteredDevice {
    return {
        name: 'Android emulator',
        udid: '127.0.0.1:5555',
        platform: 'android',
        kind: 'emulator',
        automationBackend: 'appium',
        pluginData: {},
    };
}

test('worker config metadata sync preserves an Appium transport session', () => {
    const device = androidDevice();
    const reset = applyWorkerDeviceConfig(device, {
        name: 'API 30',
        tags: [' Staging ', 'staging'],
        pluginData: { social: { lane: 'test' } },
    });

    assert.equal(reset, false);
    assert.equal(device.name, 'API 30');
    assert.deepEqual(device.tags, ['staging']);
    assert.deepEqual(device.pluginData, { social: { lane: 'test' } });
});

test('worker config lifecycle changes invalidate the cached transport', () => {
    const appium = androidDevice();
    assert.equal(applyWorkerDeviceConfig(appium, { disabled: true }), true);
    assert.equal(appium.disabled, true);

    const wda: RegisteredDevice = {
        name: 'iPhone',
        udid: 'ios-1',
        platform: 'ios',
        kind: 'physical',
        automationBackend: 'wda',
        coordinateProfile: 'iphone8',
        pluginData: {},
    };
    assert.equal(applyWorkerDeviceConfig(wda, { coordinateProfile: 'iphoneX' }), true);
    assert.equal(wda.coordinateProfile, 'iphoneX');
});
