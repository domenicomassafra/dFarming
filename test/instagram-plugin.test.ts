import assert from 'node:assert/strict';
import test from 'node:test';

import { PluginRegistry } from '../src/registry.js';
import { createInstagramPlugin } from '../src/instagram-plugin.js';

const plugin = createInstagramPlugin({ doomscrollEntrypoint: '/example/doomscroll.js', postEntrypoint: '/example/post.js' });

test('built-in Instagram plugin validates versioned doomscroll tasks', () => {
    assert.equal(plugin.id, 'com.git-agni.instagram');
    const registry = new PluginRegistry([plugin]);
    const value = registry.validate({
        deviceUdid: 'device-12345678',
        task: {
            pluginId: plugin.id, taskType: 'doomscroll', taskVersion: 1,
            payload: { durationMinutes: 5, personality: 'casual', likeEnabled: true, commentEnabled: false },
        },
        timing: { kind: 'daily', localTime: '09:00', timezone: 'Asia/Kolkata' },
    }, { accounts: ['@test'] });
    assert.equal(value.task.payload.durationMinutes, 5);
    const task = plugin.tasks.find((entry) => entry.type === 'doomscroll' && entry.version === 1)!;
    assert.equal(task.summarize(value.task.payload as never), 'Warmup · casual · 5 min');
});

test('Instagram engagement disables automatic retries while read-only scrolling may retry', () => {
    const task = plugin.tasks.find((entry) => entry.type === 'doomscroll')!;
    assert.equal(task.retryPolicy({
        durationMinutes: 5, personality: 'casual', likeEnabled: false, commentEnabled: false,
    }).retryLimit, 2);
    assert.equal(task.retryPolicy({
        durationMinutes: 5, personality: 'casual', likeEnabled: true, commentEnabled: false,
    }).retryLimit, 0);
});

test('Instagram doomscroll requires commentText when commenting', () => {
    const registry = new PluginRegistry([plugin]);
    assert.throws(() => registry.validate({
        deviceUdid: 'device-12345678',
        task: {
            pluginId: plugin.id, taskType: 'doomscroll', taskVersion: 1,
            payload: {
                durationMinutes: 5, personality: 'dialed', likeEnabled: true, commentEnabled: true,
            },
        },
        timing: { kind: 'now' },
    }, { accounts: ['@test'] }), /commentText/);
    const ok = registry.validate({
        deviceUdid: 'device-12345678',
        task: {
            pluginId: plugin.id, taskType: 'doomscroll', taskVersion: 1,
            payload: {
                durationMinutes: 5, personality: 'dialed', likeEnabled: true,
                commentEnabled: true, commentText: '🔥',
            },
        },
        timing: { kind: 'now' },
    }, { accounts: ['@test'] });
    assert.equal(ok.task.payload.commentEnabled, true);
    assert.equal(ok.task.payload.commentText, '🔥');
});

test('Instagram engage following validates like versioned tasks', () => {
    const registry = new PluginRegistry([plugin]);
    const value = registry.validate({
        deviceUdid: 'device-12345678',
        task: {
            pluginId: plugin.id, taskType: 'doomscroll-following', taskVersion: 1,
            payload: {
                durationMinutes: 3, personality: 'dialed', likeEnabled: true,
                commentEnabled: true, commentText: '🔥',
            },
        },
        timing: { kind: 'now' },
    }, { accounts: ['@test'] });
    assert.equal(value.task.taskType, 'doomscroll-following');
    const task = plugin.tasks.find((entry) => entry.type === 'doomscroll-following' && entry.version === 1)!;
    assert.equal(task.summarize(value.task.payload as never), 'Engage following · dialed · 3 min');
});

test('Instagram recurring public posts require confirmation', () => {
    const registry = new PluginRegistry([plugin]);
    assert.throws(() => registry.validate({
        deviceUdid: 'device-12345678',
        task: {
            pluginId: plugin.id, taskType: 'post', taskVersion: 1,
            payload: {
                media: [{ assetId: 'asset-1', name: 'x.jpg', mimeType: 'image/jpeg' }],
                destination: 'publish', account: '@test',
            },
        },
        timing: { kind: 'daily', localTime: '10:00', timezone: 'Asia/Kolkata' },
    }, { accounts: ['@test'] }), /explicit confirmation/);
    const ok = registry.validate({
        deviceUdid: 'device-12345678',
        task: {
            pluginId: plugin.id, taskType: 'post', taskVersion: 1,
            payload: {
                media: [{ assetId: 'asset-1', name: 'x.jpg', mimeType: 'image/jpeg' }],
                destination: 'publish', account: '@test', recurringPublishConfirmed: true,
            },
        },
        timing: { kind: 'daily', localTime: '10:00', timezone: 'Asia/Kolkata' },
    }, { accounts: ['@test'] });
    assert.equal(ok.task.payload.destination, 'publish');
});

test('Instagram rejects an account target that is not configured on the device', () => {
    const registry = new PluginRegistry([plugin]);
    assert.throws(() => registry.validate({
        deviceUdid: 'device-12345678',
        task: {
            pluginId: plugin.id, taskType: 'doomscroll', taskVersion: 1,
            payload: {
                durationMinutes: 5, personality: 'casual', likeEnabled: false,
                commentEnabled: false, account: '@wrong',
            },
        },
        timing: { kind: 'now' },
    }, { accounts: ['@owner'] }), /not configured/);
});
