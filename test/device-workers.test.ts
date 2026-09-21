import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
    configuredDeviceWorkers,
    DEVICE_WORKER_PROTOCOL_VERSION,
    DEVICE_WORKER_REMOTE_OPERATION_TIMEOUT_MS,
    DeviceWorkerClient,
    DeviceWorkerFleet,
} from '../src/device-workers.js';

test('device worker descriptors are explicit, unique, and share the configured bearer token', () => {
    const workers = configuredDeviceWorkers(
        'macstudio=http://macstudio:3010,air=https://air.example.test/worker/',
        'shared-secret',
    );
    assert.deepEqual(workers.map(({ id }) => id), ['macstudio', 'air']);
    assert.equal(workers[0]?.url.href, 'http://macstudio:3010/');
    assert.equal(workers[1]?.token, 'shared-secret');
    assert.throws(() => configuredDeviceWorkers('same=http://one:1,same=http://two:2'), /Duplicate/);
});

test('remote worker operations allow enough time for a cold Appium/XCUITest session', () => {
    assert.equal(DEVICE_WORKER_REMOTE_OPERATION_TIMEOUT_MS, 130_000);
    assert.ok(DEVICE_WORKER_REMOTE_OPERATION_TIMEOUT_MS > 120_000);
});

test('device worker client authenticates and proxies screen/action calls without exposing WDA directly', async () => {
    const requests: Request[] = [];
    const fetchImpl: typeof fetch = async (input, init) => {
        const request = new Request(input, init);
        requests.push(request);
        if (request.url.endsWith('/v1/host')) {
            return Response.json({ id: 'macstudio', hostname: 'studio', os: 'darwin', arch: 'arm64', online: true, observedAt: new Date(0).toISOString(), capabilities: ['ios.physical'], tools: { appium: true, appiumRuntime: true, xcrun: true, adb: false, scrcpyVideo: false } });
        }
        if (request.url.endsWith('/info')) {
            return Response.json({ screenSize: { width: 390, height: 844 }, scale: 3 });
        }
        return Response.json({ ok: true });
    };
    const client = new DeviceWorkerClient({ id: 'macstudio', url: new URL('http://macstudio:3010/'), token: 'secret' }, fetchImpl);
    const info = await client.getScreenInfo('udid / 1');
    const host = await client.host();
    await client.performAction('udid / 1', { type: 'home' });
    await client.updateConfig({
        name: 'Phone', udid: 'udid / 1', workerId: 'macstudio', passcode: '1234',
        wdaLocalPort: 8101, mjpegLocalPort: 9101, tags: ['staging', 'ios-real'], pluginData: { social: { accounts: ['@one'] } },
    });
    assert.equal(info.screenSize.width, 390);
    assert.equal(host.hostname, 'studio');
    assert.equal(requests.length, 4);
    assert.equal(requests.every((request) => request.headers.get('authorization') === 'Bearer secret'), true);
    assert.match(requests[0]!.url, /\/v1\/devices\/udid%20%2F%201\/info$/);
    assert.match(requests[1]!.url, /\/v1\/host$/);
    assert.equal(await requests[2]!.clone().json().then((body) => body.type), 'home');
    const config = await requests[3]!.clone().json() as Record<string, unknown>;
    assert.equal(config.name, 'Phone');
    assert.equal('passcode' in config, false);
    assert.equal('wdaLocalPort' in config, false);
    assert.equal('mjpegLocalPort' in config, false);
    assert.deepEqual(config.tags, ['staging', 'ios-real']);
});

test('configured workers remain visible as offline and log only on state transitions', async () => {
    const fetchImpl: typeof fetch = async () => { throw new Error('connect ECONNREFUSED'); };
    const warnings: string[] = [];
    const infos: string[] = [];
    const fleet = new DeviceWorkerFleet([
        { id: 'sleeping-mac', url: new URL('http://sleeping-mac:3010/'), token: 'secret' },
    ], fetchImpl, undefined, {
        warn: (message?: unknown) => warnings.push(String(message)),
        info: (message?: unknown) => infos.push(String(message)),
    });
    await fleet.refresh();
    await fleet.refresh();
    const [host] = fleet.hosts();
    assert.equal(host?.id, 'sleeping-mac');
    assert.equal(host?.hostname, 'sleeping-mac');
    assert.equal(host?.online, false);
    assert.match(host?.error ?? '', /ECONNREFUSED/);
    assert.deepEqual(host?.capabilities, []);
    assert.equal(warnings.length, 1);
    assert.match(warnings[0] ?? '', /sleeping-mac.*ECONNREFUSED/);
    assert.deepEqual(infos, []);
});

test('worker protocol handshake rejects stale gateways before they can publish device state', async () => {
    const requests: string[] = [];
    const fetchImpl: typeof fetch = async (input) => {
        const request = new Request(input);
        requests.push(new URL(request.url).pathname);
        if (request.url.endsWith('/health')) return new Response('not found', { status: 404 });
        throw new Error('stale worker inventory must not be queried after health failure');
    };
    const fleet = new DeviceWorkerFleet([
        { id: 'stale-mac', url: new URL('http://stale-mac:3010/'), token: 'secret' },
    ], fetchImpl);
    assert.deepEqual(await fleet.refresh(), []);
    assert.deepEqual(requests, ['/health']);
    const [host] = fleet.hosts();
    assert.equal(host?.online, false);
    assert.match(host?.error ?? '', /404/);
});

test('worker recovery emits one recovery transition after an outage', async (context) => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'phone-farm-recovery-'));
    const registryPath = path.join(directory, 'devices.json');
    context.after(() => rm(directory, { recursive: true, force: true }));
    let available = false;
    const fetchImpl: typeof fetch = async (input) => {
        if (!available) throw new Error('connect ECONNREFUSED');
        const pathname = new URL(new Request(input).url).pathname;
        if (pathname === '/health') return Response.json({
            ok: true, role: 'device-worker', workerId: 'recovering-mac',
            protocolVersion: DEVICE_WORKER_PROTOCOL_VERSION, platforms: ['ios'],
        });
        if (pathname === '/v1/devices') return Response.json({ devices: [] });
        if (pathname === '/v1/host') return Response.json({
            id: 'recovering-mac', hostname: 'recovering-mac', os: 'darwin', arch: 'arm64', online: true,
            observedAt: new Date(0).toISOString(), capabilities: ['ios.physical'],
            tools: { appium: true, appiumRuntime: true, xcrun: true },
        });
        throw new Error(`Unexpected request ${pathname}`);
    };
    const warnings: string[] = [];
    const infos: string[] = [];
    const fleet = new DeviceWorkerFleet([
        { id: 'recovering-mac', url: new URL('http://recovering-mac:3010/'), token: 'secret' },
    ], fetchImpl, registryPath, {
        warn: (message?: unknown) => warnings.push(String(message)),
        info: (message?: unknown) => infos.push(String(message)),
    });
    await fleet.refresh();
    available = true;
    await fleet.refresh();
    await fleet.refresh();
    assert.equal(warnings.length, 1);
    assert.match(warnings[0] ?? '', /unavailable/);
    assert.deepEqual(infos, ['Device worker recovering-mac recovered']);
    assert.equal(fleet.hosts()[0]?.online, true);
    assert.equal(fleet.hosts()[0]?.error, undefined);
});

test('cross-platform control plane quarantines malformed worker devices without poisoning its registry', async (context) => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'phone-farm-worker-'));
    const registryPath = path.join(directory, 'devices.json');
    context.after(() => rm(directory, { recursive: true, force: true }));
    const fetchImpl: typeof fetch = async (input) => {
        const pathname = new URL(new Request(input).url).pathname;
        if (pathname === '/health') return Response.json({
            ok: true, role: 'device-worker', workerId: 'macstudio',
            protocolVersion: DEVICE_WORKER_PROTOCOL_VERSION, platforms: ['ios', 'android'],
        });
        if (pathname === '/v1/devices') return Response.json({ devices: [{
            registered: {
                name: 'unsupported fixture', udid: 'WINDOWS-STALE', platform: 'windows', kind: 'physical',
                automationBackend: 'appium', hasPasscode: false, pluginData: {},
            },
            connected: null,
        }] });
        if (pathname === '/v1/host') return Response.json({
            id: 'wrong-id', hostname: 'studio', os: 'darwin', arch: 'arm64', online: true,
            observedAt: new Date(0).toISOString(), capabilities: ['ios.physical', 'android.emulator', 'windows.device'],
            networkRoutes: [{ id: 'Italy.Private', deviceUdids: ['PHONE-1'] }, { id: 'bad route!' }],
            tools: { appium: true, appiumRuntime: true, xcrun: true, adb: true, scrcpyVideo: false },
        });
        throw new Error(`Unexpected request ${pathname}`);
    };
    const fleet = new DeviceWorkerFleet([
        { id: 'macstudio', url: new URL('http://macstudio:3010/'), token: 'secret' },
    ], fetchImpl, registryPath);
    assert.deepEqual(await fleet.refresh(), []);
    assert.deepEqual(JSON.parse(await readFile(registryPath, 'utf8')), []);
    const [host] = fleet.hosts();
    assert.equal(host?.id, 'macstudio');
    assert.equal(host?.online, true);
    assert.deepEqual(host?.capabilities, ['ios.physical', 'android.emulator']);
    assert.deepEqual(host?.networkRoutes, [{ id: 'italy.private', deviceUdids: ['PHONE-1'] }]);
    assert.match(host?.error ?? '', /unsupported device WINDOWS-STALE/);
    assert.match(host?.error ?? '', /unsupported capabilities: windows\.device/);
    assert.match(host?.error ?? '', /malformed network route/);
});

test('duplicate UDIDs from two workers are quarantined instead of choosing an arbitrary owner', async (context) => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'phone-farm-duplicate-'));
    const registryPath = path.join(directory, 'devices.json');
    context.after(() => rm(directory, { recursive: true, force: true }));
    const fetchImpl: typeof fetch = async (input) => {
        const request = new Request(input);
        const url = new URL(request.url);
        const id = url.hostname;
        if (url.pathname === '/health') return Response.json({
            ok: true, role: 'device-worker', workerId: id,
            protocolVersion: DEVICE_WORKER_PROTOCOL_VERSION, platforms: ['ios'],
        });
        if (url.pathname === '/v1/devices') return Response.json({ devices: [{
            registered: {
                name: 'Same iPhone', udid: 'DUPLICATE-UDID', platform: 'ios', kind: 'physical',
                automationBackend: 'wda', hasPasscode: false, pluginData: {},
            },
            connected: { name: 'Same iPhone', udid: 'DUPLICATE-UDID', osVersion: '26.0', platform: 'ios', kind: 'physical' },
        }] });
        if (url.pathname === '/v1/host') return Response.json({
            id, hostname: id, os: 'darwin', arch: 'arm64', online: true,
            observedAt: new Date(0).toISOString(), capabilities: ['ios.physical'],
            tools: { appium: true, appiumRuntime: true, xcrun: true },
        });
        if (url.pathname.endsWith('/config')) return Response.json({ ok: true });
        throw new Error(`Unexpected request ${url.pathname}`);
    };
    const fleet = new DeviceWorkerFleet([
        { id: 'mac-one', url: new URL('http://mac-one:3010/'), token: 'secret' },
        { id: 'mac-two', url: new URL('http://mac-two:3010/'), token: 'secret' },
    ], fetchImpl, registryPath);
    assert.deepEqual(await fleet.refresh(), []);
    assert.deepEqual(JSON.parse(await readFile(registryPath, 'utf8')), []);
    const hosts = fleet.hosts();
    assert.equal(hosts.length, 2);
    assert.equal(hosts.every((host) => /quarantined duplicate device DUPLICATE-UDID/.test(host.error ?? '')), true);
});
