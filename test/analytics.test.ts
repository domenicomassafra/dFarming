import assert from 'node:assert/strict';
import test from 'node:test';

import { buildFleetHealth } from '../src/analytics.js';
import type { ExecutionRow, ScheduleRow } from '../src/database/schema.js';

test('fleet health aggregates readiness, queue latency, and account outcomes without secrets', () => {
    const base = new Date('2026-09-13T18:00:00Z');
    const schedules = [{
        id: 's1', campaignId: null, campaignAccount: null, deviceUdid: 'a', pluginId: 'p', taskType: 'post', taskVersion: 1,
        payload: { account: '@alpha' }, timing: { kind: 'now' }, status: 'active', runWindowMinutes: 30,
        executionProfileId: null, networkRouteId: null,
        externalSource: null, externalId: null, externalRequestHash: null,
        nextRunAt: base, createdAt: base, updatedAt: base,
    }] as ScheduleRow[];
    const executions = [{
        id: 'e1', scheduleId: 's1', campaignId: null, campaignAccount: '@alpha', deviceUdid: 'a', pluginId: 'p',
        taskType: 'post', taskVersion: 1, payload: { account: '@alpha' }, scheduledFor: base,
        executionProfileId: null, networkRouteId: null,
        deadlineAt: new Date(base.getTime() + 60_000), status: 'succeeded', queueJobId: 'j',
        startedAt: new Date(base.getTime() + 1_000), finishedAt: new Date(base.getTime() + 2_000),
        exitCode: 0, error: null, stopRequestedAt: null, createdAt: base, updatedAt: base,
    }] as ExecutionRow[];
    const report = buildFleetHealth(
        [{ udid: 'a', name: 'Phone A', connected: { transport: 'usb' } }, { udid: 'b', name: 'Phone B', disabled: true }],
        [{ platform: 'tiktok', pluginId: 'p', handle: '@alpha', deviceUdid: 'a', deviceName: 'Phone A', deviceDisabled: false }],
        schedules, executions, base,
    );
    assert.equal(report.summary.readyDevices, 1);
    assert.equal(report.summary.disabledDevices, 1);
    assert.equal(report.summary.recentSuccessRate, 1);
    assert.equal(report.summary.averageQueueLatencyMs, 1000);
    assert.equal(report.accounts[0]?.succeeded, 1);
    assert.equal(JSON.stringify(report).includes('passcode'), false);
});
