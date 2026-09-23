import assert from 'node:assert/strict';
import test from 'node:test';

import Fastify from 'fastify';

import { registerRemoteControlRoutes } from '../src/api/remote-routes.js';
import type { RemoteControl } from '../src/devices/wda-remote.js';
import type { SchedulerRepository } from '../src/scheduler/repository.js';

function remote(transports: Awaited<ReturnType<NonNullable<RemoteControl['getVideoCapabilities']>>>['transports']): RemoteControl {
    return {
        async getScreenInfo() { return { screenSize: { width: 100, height: 200 }, scale: 1 }; },
        async getAccessibilityTree() { return { type: 'Application', children: [] }; },
        async getScreenshot() { return Buffer.from('png'); },
        async getMjpegStream() { return new Response(new Uint8Array([1])); },
        async getH264Stream() { return new Response(new Uint8Array([2]), { headers: { 'content-type': 'video/h264' } }); },
        async getVideoCapabilities() { return { transports }; },
        async performAction() {},
        async isLocked() { return false; },
    };
}

function scheduler(): SchedulerRepository {
    return { activeExecution: async () => undefined } as unknown as SchedulerRepository;
}

test('H264 capability tokens are refused when the selected device only has MJPEG', async () => {
    const app = Fastify();
    registerRemoteControlRoutes(app, {
        remote: remote([{ id: 'mjpeg', backend: 'appium-screenshot-mjpeg', contentType: 'multipart/x-mixed-replace', optimized: false }]),
        scheduler: scheduler(),
        discoverDevices: async () => [],
    });
    const response = await app.inject({ method: 'POST', url: '/api/devices/ios-sim/remote/h264-token' });
    assert.equal(response.statusCode, 501);
    assert.match(response.json().error, /unavailable for this device/);
    await app.close();
});

test('video capability endpoint and H264 token agree for an optimized Android transport', async () => {
    const app = Fastify();
    registerRemoteControlRoutes(app, {
        remote: remote([
            { id: 'mjpeg', backend: 'appium-screenshot-mjpeg', contentType: 'multipart/x-mixed-replace', optimized: false },
            { id: 'h264', backend: 'scrcpy-raw-h264', contentType: 'video/h264', optimized: true },
        ]),
        scheduler: scheduler(),
        discoverDevices: async () => [],
    });
    const capabilities = await app.inject({ method: 'GET', url: '/api/devices/android-1/remote/video-capabilities' });
    assert.equal(capabilities.statusCode, 200);
    assert.equal(capabilities.json().transports[1].backend, 'scrcpy-raw-h264');
    const token = await app.inject({ method: 'POST', url: '/api/devices/android-1/remote/h264-token' });
    assert.equal(token.statusCode, 200);
    assert.match(token.json().url, /\/remote\/h264\?/);
    await app.close();
});
