import assert from 'node:assert/strict';
import test from 'node:test';

import { PluginRegistry } from '../src/registry.js';
import { createTikTokPlugin } from '../src/tiktok-plugin.js';

const plugin = createTikTokPlugin({ doomscrollEntrypoint: '/example/doomscroll.js', postEntrypoint: '/example/post.js' });

test('built-in TikTok plugin validates versioned doomscroll tasks', () => {
    const registry = new PluginRegistry([plugin]);
    const value = registry.validate({
        deviceUdid: 'device-12345678',
        task: {
            pluginId: plugin.id, taskType: 'doomscroll', taskVersion: 1,
            payload: { durationMinutes: 5, personality: 'casual', likeEnabled: true, saveEnabled: false },
        },
        timing: { kind: 'daily', localTime: '09:00', timezone: 'Asia/Kolkata' },
    }, { accounts: ['@internal'] });
    assert.equal(value.task.payload.durationMinutes, 5);
});

test('TikTok engagement and arbitrary workflows never auto-retry side effects', () => {
    const doomscroll = plugin.tasks.find((entry) => entry.type === 'doomscroll')!;
    assert.equal(doomscroll.retryPolicy({
        durationMinutes: 5, personality: 'casual', likeEnabled: false, saveEnabled: false, commentEnabled: false,
    }).retryLimit, 2);
    assert.equal(doomscroll.retryPolicy({
        durationMinutes: 5, personality: 'casual', likeEnabled: true, saveEnabled: false, commentEnabled: false,
    }).retryLimit, 0);
    const workflow = plugin.tasks.find((entry) => entry.type === 'workflow-replay')!;
    assert.equal(workflow.retryPolicy({ workflowId: 'wf-1', loops: 2 }).retryLimit, 0);
});

test('TikTok rejects an account target that is not configured on the device', () => {
    const registry = new PluginRegistry([plugin]);
    assert.throws(() => registry.validate({
        deviceUdid: 'device-12345678',
        task: {
            pluginId: plugin.id, taskType: 'doomscroll', taskVersion: 1,
            payload: { durationMinutes: 5, personality: 'casual', likeEnabled: true, saveEnabled: false, account: '@other' },
        },
        timing: { kind: 'now' },
    }, { accounts: ['@owner'] }), /not configured/);
});

test('TikTok honors per-account pause policy before scheduling', () => {
    const registry = new PluginRegistry([plugin]);
    assert.throws(() => registry.validate({
        deviceUdid: 'device-12345678',
        task: {
            pluginId: plugin.id, taskType: 'doomscroll', taskVersion: 1,
            payload: { durationMinutes: 5, personality: 'casual', likeEnabled: false, saveEnabled: false, account: '@owner' },
        },
        timing: { kind: 'now' },
    }, { accounts: ['@owner'], accountPolicies: { '@owner': { paused: true, note: 'review' } } }), /paused: review/);
});

test('recurring public posts require confirmation', () => {
    const registry = new PluginRegistry([plugin]);
    assert.throws(() => registry.validate({
        deviceUdid: 'device-12345678',
        task: {
            pluginId: plugin.id, taskType: 'post', taskVersion: 1,
            payload: {
                media: [{ assetId: 'asset-1', name: 'video.mp4', mimeType: 'video/mp4' }],
                destination: 'publish', account: '@internal',
            },
        },
        timing: { kind: 'weekly', localTime: '10:00', timezone: 'Asia/Kolkata', weekdays: [1] },
    }, { accounts: ['@internal'] }), /explicit confirmation/);
});
