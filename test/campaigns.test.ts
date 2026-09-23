import assert from 'node:assert/strict';
import test from 'node:test';

import { planCampaign } from '../src/campaigns.js';
import { PluginRegistry } from '../src/registry.js';
import { createTikTokPlugin } from '../src/tiktok-plugin.js';

const registry = new PluginRegistry([createTikTokPlugin({ postEntrypoint: '/tmp/post.js' })]);

test('campaign planner binds each target to an account actually configured on that device', () => {
    const plan = planCampaign(registry, {
        name: 'Launch batch A',
        task: {
            pluginId: 'com.dfarming.tiktok', taskType: 'post', taskVersion: 1,
            payload: {
                media: [{ assetId: 'asset-1', name: 'video.mp4', mimeType: 'video/mp4' }],
                destination: 'draft',
            },
        },
        timing: { kind: 'once', runAt: new Date(Date.now() + 60_000).toISOString() },
        targets: [
            { deviceUdid: 'phone-a', account: '@alpha' },
            { deviceUdid: 'phone-b', account: '@bravo' },
        ],
    }, new Map([
        ['phone-a', { accounts: ['@alpha'] }],
        ['phone-b', { accounts: ['@bravo'] }],
    ]));
    assert.equal(plan.tasks.length, 2);
    assert.equal(plan.tasks[0]!.task.payload.account, '@alpha');
    assert.equal(plan.tasks[1]!.task.payload.account, '@bravo');
    assert.equal(plan.requiresFanOutConfirmation, true);
    assert.equal(plan.requiresPublicActionConfirmation, false);
});

test('campaign planner refuses unconfigured accounts and marks public publishing as high impact', () => {
    const input = {
        name: 'Publish wave',
        task: {
            pluginId: 'com.dfarming.tiktok', taskType: 'post', taskVersion: 1,
            payload: {
                media: [{ assetId: 'asset-1', name: 'video.mp4', mimeType: 'video/mp4' }],
                destination: 'publish', recurringPublishConfirmed: true,
            },
        },
        timing: { kind: 'daily' as const, localTime: '10:00', timezone: 'Europe/Rome' },
        targets: [{ deviceUdid: 'phone-a', account: '@alpha' }],
    };
    const plan = planCampaign(registry, input, new Map([['phone-a', { accounts: ['@alpha'] }]]));
    assert.equal(plan.requiresPublicActionConfirmation, true);
    assert.throws(() => planCampaign(registry, {
        ...input, targets: [{ deviceUdid: 'phone-a', account: '@wrong' }],
    }, new Map([['phone-a', { accounts: ['@alpha'] }]])), /not configured/);
});

test('campaign planner caps fan-out and rejects duplicate targets', () => {
    const base = {
        name: 'Warmup',
        task: {
            pluginId: 'com.dfarming.tiktok', taskType: 'doomscroll', taskVersion: 1,
            payload: { durationMinutes: 5, personality: 'casual', likeEnabled: false, saveEnabled: false },
        },
        timing: { kind: 'now' as const },
    };
    assert.throws(() => planCampaign(registry, {
        ...base, targets: [{ deviceUdid: 'phone-a' }, { deviceUdid: 'phone-a' }],
    }, new Map([['phone-a', {}]])), /unique/);
});
