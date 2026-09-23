import assert from 'node:assert/strict';
import test from 'node:test';

import { defaultPlugins } from '../src/default-plugins.js';
import { examplePlugin } from '../src/example-plugin.js';
import { PluginRegistry } from '../src/registry.js';
import { assertSafeBind } from '../src/security.js';

test('control-plane and workers share every built-in executable plugin', async () => {
    const ids = new Set((await defaultPlugins()).map(({ id }) => id));
    assert.ok(ids.has('com.dfarming.flow'));
    assert.ok(ids.has('com.dfarming.tiktok'));
    assert.ok(ids.has('com.dfarming.instagram'));
});

test('registers and validates a versioned plugin task', () => {
    const registry = new PluginRegistry([examplePlugin]);
    const input = registry.validate({
        deviceUdid: 'device-12345678',
        task: {
            pluginId: examplePlugin.id,
            taskType: 'open-app',
            taskVersion: 1,
            payload: { bundleId: 'com.example.demo', waitSeconds: 10 },
        },
        timing: { kind: 'now' },
    });
    assert.equal(input.task.payload.bundleId, 'com.example.demo');
    assert.equal(registry.task(input.task).summarize(input.task.payload), 'Open com.example.demo for 10 seconds');
});

test('legacy plugin ids are accepted but new state is canonicalized to dFarming ids', async () => {
    const registry = new PluginRegistry(await defaultPlugins());
    const legacy = registry.validate({
        deviceUdid: 'device-12345678',
        task: {
            pluginId: 'com.phone-farm.flow',
            taskType: 'flow',
            taskVersion: 1,
            payload: { name: 'Legacy flow', steps: [{ action: 'wait', milliseconds: 50 }] },
        },
        timing: { kind: 'now' },
    });
    assert.equal(legacy.task.pluginId, 'com.dfarming.flow');
    assert.equal(registry.plugin('com.phone-farm.flow').id, 'com.dfarming.flow');
});

test('rejects unavailable plugin tasks and duplicate plugins', () => {
    const registry = new PluginRegistry([examplePlugin]);
    assert.throws(() => registry.register(examplePlugin), /already registered/);
    assert.throws(() => registry.task({
        pluginId: 'missing.plugin', taskType: 'unknown', taskVersion: 1, payload: {},
    }), /unavailable/);
});

test('requires authentication when binding outside loopback', () => {
    assert.doesNotThrow(() => assertSafeBind('127.0.0.1', null));
    assert.throws(() => assertSafeBind('0.0.0.0', null), /authentication plugin is required/i);
});
