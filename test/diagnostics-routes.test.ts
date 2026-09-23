import assert from 'node:assert/strict';
import test from 'node:test';

import Fastify from 'fastify';

import { registerRemoteControlRoutes } from '../src/api/remote-routes.js';
import type { RemoteControl } from '../src/devices/wda-remote.js';
import type { SchedulerRepository } from '../src/scheduler/repository.js';

const scheduler = { activeExecution: async () => undefined } as unknown as SchedulerRepository;

test('device diagnostics expose only the bounded adapter log snapshot', async () => {
    const app = Fastify();
    const seen: Array<{ lines?: number; sinceSeconds?: number }> = [];
    const remote: RemoteControl = {
        async getScreenInfo() { return { screenSize: { width: 100, height: 200 }, scale: 1 }; },
        async getAccessibilityTree() { return { type: 'Application', children: [] }; },
        async getScreenshot() { return Buffer.from('png'); },
        async getMjpegStream() { return new Response(new Uint8Array([1])); },
        async getRecentLogs(_udid, options) {
            seen.push(options ?? {});
            return { supported: true, source: 'adb', capturedAt: new Date(0).toISOString(), lines: ['I/demo'] };
        },
        async performAction() {},
        async isLocked() { return false; },
    };
    registerRemoteControlRoutes(app, { remote, scheduler, discoverDevices: async () => [] });
    const response = await app.inject({
        method: 'GET',
        url: '/api/devices/android-1/diagnostics/logs?lines=25&sinceSeconds=12',
    });
    assert.equal(response.statusCode, 200);
    assert.deepEqual(seen, [{ lines: 25, sinceSeconds: 12 }]);
    assert.deepEqual(response.json().lines, ['I/demo']);
    await app.close();
});

test('device diagnostics fail closed when the selected transport has no log adapter', async () => {
    const app = Fastify();
    const remote: RemoteControl = {
        async getScreenInfo() { return { screenSize: { width: 100, height: 200 }, scale: 1 }; },
        async getAccessibilityTree() { return { type: 'Application', children: [] }; },
        async getScreenshot() { return Buffer.from('png'); },
        async getMjpegStream() { return new Response(new Uint8Array([1])); },
        async performAction() {},
        async isLocked() { return false; },
    };
    registerRemoteControlRoutes(app, { remote, scheduler, discoverDevices: async () => [] });
    const response = await app.inject({ method: 'GET', url: '/api/devices/phone-1/diagnostics/logs' });
    assert.equal(response.statusCode, 200);
    assert.equal(response.json().supported, false);
    assert.equal(response.json().source, 'unavailable');
    await app.close();
});

test('device diagnostics surface adapter collection failures as service unavailable', async () => {
    const app = Fastify();
    const remote: RemoteControl = {
        async getScreenInfo() { return { screenSize: { width: 100, height: 200 }, scale: 1 }; },
        async getAccessibilityTree() { return { type: 'Application', children: [] }; },
        async getScreenshot() { return Buffer.from('png'); },
        async getMjpegStream() { return new Response(new Uint8Array([1])); },
        async getRecentLogs() { throw new Error('simctl log collection failed'); },
        async performAction() {},
        async isLocked() { return false; },
    };
    registerRemoteControlRoutes(app, { remote, scheduler, discoverDevices: async () => [] });
    const response = await app.inject({ method: 'GET', url: '/api/devices/ios-sim/diagnostics/logs' });
    assert.equal(response.statusCode, 503);
    assert.match(response.json().error, /simctl log collection failed/);
    await app.close();
});
