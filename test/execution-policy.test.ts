import assert from 'node:assert/strict';
import test from 'node:test';

import { assertExecutionProfile, resolveTaskExecutionPolicy } from '../src/execution-policy.js';
import type { HostSnapshot } from '../src/hosts/capabilities.js';
import type { RegisteredDevice } from '../src/types.js';

const device: RegisteredDevice = {
    name: 'Phone A', udid: 'phone-a', platform: 'ios', kind: 'simulator', automationBackend: 'appium',
    workerId: 'studio', tags: ['creator', 'italy'], pluginData: {
        'com.git-agni.tiktok': {
            accounts: ['@owner'],
            accountPolicies: {
                '@owner': {
                    executionProfile: {
                        id: 'owner-primary', dedicatedDeviceUdid: 'phone-a',
                        requiredTags: ['creator'], networkRouteId: 'italy.private',
                    },
                },
            },
        },
    },
};

const host: HostSnapshot = {
    id: 'studio', hostname: 'studio', os: 'darwin', arch: 'arm64', online: true,
    observedAt: new Date(0).toISOString(), capabilities: ['ios.simulator'],
    networkRoutes: [{ id: 'italy.private', deviceUdids: ['phone-a'] }],
    tools: { appium: false, appiumRuntime: true, xcrun: true, adb: false, emulator: false, scrcpyVideo: false },
};

test('account execution profiles enforce dedicated device, tags, and worker route attestation', () => {
    assert.deepEqual(resolveTaskExecutionPolicy({
        deviceUdid: 'phone-a', timing: { kind: 'now' }, task: {
            pluginId: 'com.git-agni.tiktok', taskType: 'post', taskVersion: 1, payload: { account: '@owner' },
        },
    }, [device], [host]), {
        executionProfileId: 'owner-primary', networkRouteId: 'italy.private',
    });
    assert.throws(() => assertExecutionProfile({ id: 'x', dedicatedDeviceUdid: 'phone-b' }, device, [host]), /dedicated device/);
    assert.throws(() => assertExecutionProfile({ id: 'x', requiredTags: ['missing'] }, device, [host]), /requires device tags/);
    assert.throws(() => assertExecutionProfile({ id: 'x', networkRouteId: 'missing' }, device, [host]), /did not attest/);
});

test('tasks without an account execution profile remain unchanged', () => {
    assert.deepEqual(resolveTaskExecutionPolicy({
        deviceUdid: 'phone-a', timing: { kind: 'now' }, task: {
            pluginId: 'com.phone-farm.flow', taskType: 'flow', taskVersion: 1, payload: { name: 'safe', steps: [] },
        },
    }, [device], [host]), {});
});
