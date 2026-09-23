import assert from 'node:assert/strict';
import test from 'node:test';

import { portableFlowPlugin } from '../src/flow-plugin.js';
import { PluginRegistry } from '../src/registry.js';
import type { TaskExecutionContext } from '../src/plugin.js';

test('portable flows validate bounded mobile steps', () => {
    const registry = new PluginRegistry([portableFlowPlugin]);
    const input = registry.validate({
        deviceUdid: 'device-1', timing: { kind: 'now' },
        task: {
            pluginId: portableFlowPlugin.id, taskType: 'flow', taskVersion: 1,
            payload: { name: 'smoke', steps: [{ action: 'tap', x: 10, y: 20 }, { action: 'wait', milliseconds: 250 }] },
        },
    });
    assert.equal(input.task.payload.name, 'smoke');
    assert.throws(() => registry.validate({
        deviceUdid: 'device-1', timing: { kind: 'now' },
        task: {
            pluginId: portableFlowPlugin.id, taskType: 'flow', taskVersion: 1,
            payload: { name: 'bad', steps: [{ action: 'unknown-step' }] },
        },
    }), /unsupported/);
});

test('saved-flow attribution is preserved only as a complete immutable revision reference', () => {
    const registry = new PluginRegistry([portableFlowPlugin]);
    const input = registry.validate({
        deviceUdid: 'device-1', timing: { kind: 'now' },
        task: {
            pluginId: portableFlowPlugin.id, taskType: 'flow', taskVersion: 1,
            payload: {
                name: 'library run', steps: [{ action: 'wait', milliseconds: 100 }],
                sourceFlowId: '11111111-1111-4111-8111-111111111111', sourceFlowVersion: 7,
            },
        },
    });
    assert.equal(input.task.payload.sourceFlowId, '11111111-1111-4111-8111-111111111111');
    assert.equal(input.task.payload.sourceFlowVersion, 7);
    assert.throws(() => registry.validate({
        deviceUdid: 'device-1', timing: { kind: 'now' },
        task: {
            pluginId: portableFlowPlugin.id, taskType: 'flow', taskVersion: 1,
            payload: { name: 'broken source', steps: [{ action: 'wait', milliseconds: 100 }], sourceFlowVersion: 2 },
        },
    }), /supplied together/);
});

test('portable flow executes shared automation primitives in order', async () => {
    const registry = new PluginRegistry([portableFlowPlugin]);
    const task = registry.task({ pluginId: portableFlowPlugin.id, taskType: 'flow', taskVersion: 1, payload: {} });
    const calls: string[] = [];
    const context = {
        executionId: 'e1', attempt: 1, workspaceDirectory: '/tmp/mobile-flow',
        device: { udid: 'd1', name: 'device' }, devicePluginData: {}, assets: [],
        signal: new AbortController().signal,
        log: async (line: string) => { calls.push(`log:${line}`); },
        runProcess: async () => ({ exitCode: 0, stopped: false }),
        claimPipelineItem: async () => null,
        completePipelineItem: async () => {},
        failPipelineItem: async () => {},
        automation: {
            activateApp: async (id: string) => { calls.push(`launch:${id}`); },
            terminateApp: async (id: string) => { calls.push(`terminate:${id}`); },
            setOrientation: async (orientation: 'portrait' | 'landscape') => { calls.push(`orientation:${orientation}`); },
            pause: async (ms: number) => { calls.push(`wait:${ms}`); },
            screenshot: async () => { calls.push('screenshot'); return Buffer.from('x'); },
            tap: async (x: number, y: number) => { calls.push(`tap:${x},${y}`); },
            swipe: async () => { calls.push('swipe'); },
            typeText: async (text: string) => { calls.push(`type:${text}`); },
            waitForText: async (text: string) => { calls.push(`waitText:${text}`); },
            tapText: async (text: string) => { calls.push(`tapText:${text}`); },
            inputText: async (target: string, text: string) => { calls.push(`inputText:${target}:${text}`); },
            assertText: async (text: string) => { calls.push(`assertText:${text}`); },
            waitForTextGone: async (text: string) => { calls.push(`waitGone:${text}`); },
            system: async (action: string) => { calls.push(`system:${action}`); },
        },
    } satisfies TaskExecutionContext;
    const payload = task.validate({
        name: 'demo',
        steps: [
            { action: 'launch', appId: 'com.example.app' },
            { action: 'setOrientation', orientation: 'landscape' },
            { action: 'tap', x: 10, y: 20 },
            { action: 'type', text: 'hello' },
            { action: 'home' },
            { action: 'screenshot' },
        ],
    }, { timingKind: 'now', devicePluginData: {} });
    const result = await task.execute(context, payload);
    assert.equal(result.exitCode, 0);
    assert.deepEqual(calls.filter((call) => !call.startsWith('log:')), [
        'launch:com.example.app', 'orientation:landscape', 'tap:10,20', 'type:hello', 'system:home', 'screenshot',
    ]);
});

test('portable flows execute semantic accessibility-first steps', async () => {
    const registry = new PluginRegistry([portableFlowPlugin]);
    const task = registry.task({ pluginId: portableFlowPlugin.id, taskType: 'flow', taskVersion: 1, payload: {} });
    const calls: string[] = [];
    const context = {
        executionId: 'e2', attempt: 1, workspaceDirectory: '/tmp/mobile-flow-semantic',
        device: { udid: 'd1', name: 'device' }, devicePluginData: {}, assets: [],
        signal: new AbortController().signal,
        log: async () => {},
        runProcess: async () => ({ exitCode: 0, stopped: false }),
        claimPipelineItem: async () => null,
        completePipelineItem: async () => {},
        failPipelineItem: async () => {},
        automation: {
            activateApp: async () => {}, terminateApp: async () => {}, setOrientation: async () => {}, pause: async () => {},
            screenshot: async () => Buffer.from('x'), tap: async () => {}, swipe: async () => {}, typeText: async () => {},
            waitForText: async (text: string) => { calls.push(`wait:${text}`); },
            tapText: async (text: string) => { calls.push(`tap:${text}`); },
            inputText: async (target: string, text: string) => { calls.push(`input:${target}:${text}`); },
            assertText: async (text: string) => { calls.push(`assert:${text}`); },
            waitForTextGone: async (text: string) => { calls.push(`gone:${text}`); },
            system: async () => {},
        },
    } satisfies TaskExecutionContext;
    const payload = task.validate({
        name: 'semantic', steps: [
            { action: 'waitVisible', text: 'Email', type: 'TextField', timeoutMs: 5000 },
            { action: 'tapText', text: 'Email', exact: true },
            { action: 'inputText', target: 'Email', text: 'hello@example.com' },
            { action: 'assertVisible', text: 'Continue' },
            { action: 'waitGone', text: 'Loading' },
        ],
    }, { timingKind: 'now', devicePluginData: {} });
    const result = await task.execute(context, payload);
    assert.equal(result.exitCode, 0);
    assert.deepEqual(calls, [
        'wait:Email', 'tap:Email', 'input:Email:hello@example.com', 'assert:Continue', 'gone:Loading',
    ]);
});
