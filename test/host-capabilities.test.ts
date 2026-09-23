import assert from 'node:assert/strict';
import test from 'node:test';

import { detectHostCapabilities } from '../src/hosts/capabilities.js';

test('mac hosts advertise iOS physical and simulator only when the matching tools exist', async () => {
    const host = await detectHostCapabilities({
        id: 'studio', hostname: 'studio.test', platform: 'darwin', arch: 'arm64',
        appiumEntry: '/definitely/not/appium',
        appiumRuntimeEntry: '/definitely/not/appium-runtime',
        commandAvailable: async (command) => command === 'xcrun',
    });
    assert.equal(host.id, 'studio');
    assert.equal(host.online, true);
    assert.ok(host.metrics && host.metrics.cpuCount > 0);
    assert.ok(host.metrics && host.metrics.totalMemoryBytes >= host.metrics.freeMemoryBytes);
    assert.deepEqual(host.capabilities.sort(), ['ios.physical', 'ios.simulator', 'simctl'].sort());
});

test('a simulator-only Mac does not advertise physical iOS or WDA capabilities', async () => {
    const host = await detectHostCapabilities({
        id: 'studio', hostname: 'studio.test', platform: 'darwin', arch: 'arm64',
        physicalIosEnabled: false,
        appiumEntry: '/definitely/not/appium',
        appiumRuntimeEntry: '/definitely/not/appium-runtime',
        commandAvailable: async (command) => command === 'xcrun',
    });
    assert.deepEqual(host.capabilities.sort(), ['ios.simulator', 'simctl'].sort());
});

test('adb alone enables physical Android but does not falsely advertise emulator hosting', async () => {
    const host = await detectHostCapabilities({
        id: 'linux', platform: 'linux', arch: 'x64', appiumEntry: '/definitely/not/appium',
        appiumRuntimeEntry: '/definitely/not/appium-runtime',
        commandAvailable: async (command) => command === 'adb',
    });
    assert.deepEqual(host.capabilities.sort(), ['adb', 'android.physical'].sort());
    assert.equal(host.tools.emulator, false);
});

test('Android emulator hosting requires both adb and emulator binaries', async () => {
    const host = await detectHostCapabilities({
        id: 'linux', platform: 'linux', arch: 'x64', appiumEntry: '/definitely/not/appium',
        appiumRuntimeEntry: '/definitely/not/appium-runtime',
        commandAvailable: async (command) => command === 'adb' || command === 'emulator',
    });
    assert.deepEqual(host.capabilities.sort(), ['adb', 'android.emulator', 'android.physical'].sort());
    assert.equal(host.tools.emulator, true);
});

test('verified scrcpy server advertises optional Android H.264 without replacing ADB control', async () => {
    const host = await detectHostCapabilities({
        id: 'linux', platform: 'linux', arch: 'x64',
        appiumEntry: '/definitely/not/appium', appiumRuntimeEntry: '/definitely/not/appium-runtime',
        scrcpyServerJar: new URL(import.meta.url).pathname,
        commandAvailable: async (command) => command === 'adb',
    });
    assert.ok(host.capabilities.includes('android.h264'));
    assert.equal(host.tools.scrcpyVideo, true);
    assert.ok(host.capabilities.includes('adb'));
});

test('workers advertise only named network route ids and device scope', async () => {
    const host = await detectHostCapabilities({
        id: 'linux', platform: 'linux', arch: 'x64', appiumEntry: '/definitely/not/appium',
        appiumRuntimeEntry: '/definitely/not/appium-runtime', commandAvailable: async () => false,
        networkRoutesValue: '[{"id":"italy.private","deviceUdids":["phone-a"]},{"id":"testing"}]',
    });
    assert.deepEqual(host.networkRoutes, [
        { id: 'italy.private', deviceUdids: ['phone-a'] }, { id: 'testing' },
    ]);
});
