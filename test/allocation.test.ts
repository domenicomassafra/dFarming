import assert from 'node:assert/strict';
import test from 'node:test';

import { rankAllocationCandidates, selectAllocationCandidate } from '../src/allocation.js';
import type { ExecutionRow, ScheduleRow } from '../src/database/schema.js';
import type { RegisteredDevice } from '../src/devices/registry.js';

const devices: RegisteredDevice[] = [
    { name: 'Android A', udid: 'a', platform: 'android', kind: 'emulator', workerId: 'linux1', tags: ['staging', 'pixel'], pluginData: {} },
    { name: 'Android B', udid: 'b', platform: 'android', kind: 'emulator', workerId: 'linux2', tags: ['production'], pluginData: {} },
    { name: 'iOS Sim', udid: 'c', platform: 'ios', kind: 'simulator', workerId: 'mac1', pluginData: {} },
    { name: 'Disabled', udid: 'd', platform: 'android', kind: 'emulator', disabled: true, pluginData: {} },
];

test('allocator filters by runtime capability and prefers the least loaded connected device', () => {
    const executions = [{ deviceUdid: 'a', status: 'running' }] as ExecutionRow[];
    const schedules = [{ deviceUdid: 'b', status: 'active' }] as ScheduleRow[];
    const connected = new Set(['a', 'b', 'c', 'd']);
    assert.equal(selectAllocationCandidate(devices, connected, executions, schedules, {
        platform: 'android', kind: 'emulator', requireIdle: true,
    })?.udid, 'b');
    assert.equal(selectAllocationCandidate(devices, connected, executions, schedules, {
        platform: 'android', kind: 'emulator', workerId: 'linux1', requireIdle: true,
    }), null);
    assert.deepEqual(rankAllocationCandidates(devices, connected, executions, schedules, {
        platform: 'android', requireIdle: false,
    }).map(({ udid }) => udid), ['b', 'a']);
});

test('allocator never selects disconnected, disabled or out-of-pool devices', () => {
    const picked = selectAllocationCandidate(devices, new Set(['a', 'd']), [], [], {
        platform: 'ios', deviceUdids: ['c', 'd'],
    });
    assert.equal(picked, null);
});

test('allocator requires every requested device tag', () => {
    const connected = new Set(['a', 'b']);
    assert.equal(selectAllocationCandidate(devices, connected, [], [], {
        platform: 'android', tags: ['staging', 'pixel'],
    })?.udid, 'a');
    assert.equal(selectAllocationCandidate(devices, connected, [], [], {
        platform: 'android', tags: ['staging', 'production'],
    }), null);
});
