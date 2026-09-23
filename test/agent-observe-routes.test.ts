import assert from 'node:assert/strict';
import test from 'node:test';

import Fastify from 'fastify';

import { registerRemoteControlRoutes } from '../src/api/remote-routes.js';
import type { RemoteControl } from '../src/devices/wda-remote.js';
import type { SchedulerRepository } from '../src/scheduler/repository.js';

const tree = {
    type: 'Application',
    rect: { x: 0, y: 0, width: 390, height: 844 },
    visible: true,
    children: [{ type: 'Button', label: 'Continue', rect: { x: 20, y: 100, width: 120, height: 44 }, visible: true }],
};

test('agent observe probes screen only once and returns the healthy structured observation', async () => {
    const app = Fastify();
    let screenProbes = 0;
    const remote: RemoteControl = {
        async getScreenInfo() { screenProbes += 1; return { screenSize: { width: 390, height: 844 }, scale: 1 }; },
        async getAccessibilityTree() { return tree; },
        async getScreenshot() { return Buffer.from('png'); },
        async getMjpegStream() { return new Response(new Uint8Array([1])); },
        async performAction() {},
        async isLocked() { return false; },
    };
    registerRemoteControlRoutes(app, {
        remote,
        scheduler: { activeExecution: async () => undefined } as unknown as SchedulerRepository,
        discoverDevices: async () => [{ name: 'Simulator', osVersion: '27.0', udid: 'SIM-1', platform: 'ios', kind: 'simulator' }],
        connectionStatus: async () => ({
            udid: 'SIM-1', physical: 'connected', wda: 'ready', appium: 'ready', managed: false,
            message: 'ready', retryCount: 0, updatedAt: new Date(0).toISOString(),
        }),
    });
    const response = await app.inject({ method: 'GET', url: '/api/devices/SIM-1/agent/observe' });
    assert.equal(response.statusCode, 200);
    const body = response.json();
    assert.equal(screenProbes, 1);
    assert.equal(body.screen.screenSize.width, 390);
    assert.equal(body.semantic.elements[0].label, 'Continue');
    assert.equal(body.locked, false);
    assert.equal(body.activeExecution, false);
    assert.equal(body.errors, undefined);
    await app.close();
});

test('agent observe returns partial state and bounded section errors when one probe fails', async () => {
    const app = Fastify();
    const remote: RemoteControl = {
        async getScreenInfo() { return { screenSize: { width: 390, height: 844 }, scale: 1 }; },
        async getAccessibilityTree() { return tree; },
        async getScreenshot() { return Buffer.from('png'); },
        async getMjpegStream() { return new Response(new Uint8Array([1])); },
        async performAction() {},
        async isLocked() { throw new Error('lock probe unavailable ' + 'x'.repeat(500)); },
    };
    registerRemoteControlRoutes(app, {
        remote,
        scheduler: { activeExecution: async () => ({ id: 'execution-1' }) } as unknown as SchedulerRepository,
        discoverDevices: async () => [{ name: 'Android', osVersion: '11', udid: 'ANDROID-1', platform: 'android', kind: 'emulator' }],
        connectionStatus: async () => { throw new Error('worker status unavailable'); },
    });
    const response = await app.inject({ method: 'GET', url: '/api/devices/ANDROID-1/agent/observe?maxNodes=20' });
    assert.equal(response.statusCode, 200);
    const body = response.json();
    assert.equal(body.semantic.count, 1);
    assert.equal(body.activeExecution, true);
    assert.equal(body.locked, null);
    assert.equal(body.connection, undefined);
    assert.deepEqual(body.errors.map(({ section }: { section: string }) => section), ['lock', 'connection']);
    assert.ok(body.errors[0].message.length <= 300);
    await app.close();
});
