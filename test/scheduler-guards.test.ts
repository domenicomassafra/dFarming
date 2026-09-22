import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { manualRetryIdentity, scheduleTransitionAllowed } from '../src/scheduler/repository.js';
import { mutateRegisteredDevices } from '../src/devices/registry.js';
import { executionRetryRequiresConfirmation } from '../src/api/schedule-routes.js';
import { PluginRegistry } from '../src/registry.js';
import { createTikTokPlugin } from '../src/tiktok-plugin.js';

test('scheduleTransitionAllowed blocks resuming a finished schedule', () => {
    assert.equal(scheduleTransitionAllowed('active', 'paused'), true);
    assert.equal(scheduleTransitionAllowed('paused', 'active'), true);
    assert.equal(scheduleTransitionAllowed('active', 'cancelled'), true);
    assert.equal(scheduleTransitionAllowed('completed', 'cancelled'), true);
    assert.equal(scheduleTransitionAllowed('completed', 'active'), false);
    assert.equal(scheduleTransitionAllowed('cancelled', 'active'), false);
    assert.equal(scheduleTransitionAllowed('cancelled', 'paused'), false);
});

test('manual retries preserve execution policy identity and the original run window', () => {
    const scheduledFor = new Date('2026-09-22T12:00:00Z');
    const deadlineAt = new Date('2026-09-22T12:45:00Z');
    const now = new Date('2026-09-22T13:00:00Z');
    assert.deepEqual(manualRetryIdentity({
        executionProfileId: 'owner-primary',
        networkRouteId: 'italy.private',
        scheduledFor,
        deadlineAt,
    }, now), {
        executionProfileId: 'owner-primary',
        networkRouteId: 'italy.private',
        scheduledFor: now,
        deadlineAt: new Date('2026-09-22T13:45:00Z'),
    });
    assert.throws(() => manualRetryIdentity({
        executionProfileId: null,
        networkRouteId: null,
        scheduledFor,
        deadlineAt: scheduledFor,
    }, now), /invalid run window/);
});

test('manual retry requires confirmation when automatic retry is disabled for side effects', () => {
    const plugins = new PluginRegistry([createTikTokPlugin()]);
    const base = {
        pluginId: 'com.git-agni.tiktok', taskType: 'doomscroll', taskVersion: 1,
    };
    assert.equal(executionRetryRequiresConfirmation(plugins, {
        ...base,
        payload: { durationMinutes: 5, personality: 'casual', likeEnabled: false, saveEnabled: false, commentEnabled: false },
    }), false);
    assert.equal(executionRetryRequiresConfirmation(plugins, {
        ...base,
        payload: { durationMinutes: 5, personality: 'casual', likeEnabled: true, saveEnabled: false, commentEnabled: false },
    }), true);
    assert.equal(executionRetryRequiresConfirmation(plugins, {
        pluginId: 'com.git-agni.tiktok', taskType: 'post', taskVersion: 1,
        payload: { media: [{ assetId: 'x', name: 'x.mp4', mimeType: 'video/mp4' }], destination: 'publish' },
    }), true);
});

test('mutateRegisteredDevices serializes overlapping writes', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'pf-registry-lock-'));
    const configPath = path.join(dir, 'devices.json');

    // fire 20 concurrent independent mutations; each appends one entry
    await Promise.all(
        Array.from({ length: 20 }, (_, i) => mutateRegisteredDevices(
            (devices) => { devices.push({ name: `d${i}`, udid: `udid-${i}`, pluginData: {} }); },
            configPath,
        )),
    );

    const saved = JSON.parse(await readFile(configPath, 'utf8')) as Array<{ udid: string }>;
    assert.equal(saved.length, 20, 'no write was lost to a race');
    assert.equal(new Set(saved.map((d) => d.udid)).size, 20);
});
