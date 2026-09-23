import assert from 'node:assert/strict';
import test from 'node:test';

import { AppiumRemoteControl } from '../src/devices/appium-remote.js';

interface SeenRequest {
    method: string;
    pathname: string;
    body?: unknown;
}

function appiumFixture(requests: SeenRequest[]): typeof fetch {
    return async (input, init) => {
        const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
        const method = String(init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase();
        const body = typeof init?.body === 'string' ? JSON.parse(init.body) as unknown : undefined;
        requests.push({ method, pathname: url.pathname, ...(body === undefined ? {} : { body }) });
        if (method === 'POST' && url.pathname === '/session') {
            return Response.json({ value: { sessionId: 'session-1', capabilities: {} } });
        }
        if (method === 'GET' && url.pathname.endsWith('/window/rect')) return Response.json({ value: { width: 390, height: 844, x: 0, y: 0 } });
        if (method === 'GET' && url.pathname.endsWith('/source')) {
            return Response.json({ value: '<AppiumAUT type="XCUIElementTypeApplication" x="0" y="0" width="390" height="844"><XCUIElementTypeButton type="XCUIElementTypeButton" label="Done" enabled="true" visible="true" x="20" y="50" width="80" height="44" /></AppiumAUT>' });
        }
        if (method === 'GET' && url.pathname.endsWith('/screenshot')) return Response.json({ value: Buffer.from('png-bytes').toString('base64') });
        if (method === 'POST' && url.pathname.endsWith('/appium/device/is_locked')) return Response.json({ value: true });
        return Response.json({ value: null });
    };
}

test('Appium remote uses the narrow W3C/Appium protocol without a third-party WebDriver client', async () => {
    const requests: SeenRequest[] = [];
    const remote = new AppiumRemoteControl({
        name: 'Simulator', udid: 'SIM-1', platform: 'ios', kind: 'simulator', automationBackend: 'appium', pluginData: {},
    }, 'appium.test', 4726, appiumFixture(requests));

    assert.deepEqual(await remote.getScreenInfo('SIM-1'), { screenSize: { width: 390, height: 844 }, scale: 1 });
    const tree = await remote.getAccessibilityTree('SIM-1') as { children?: Array<{ label?: string }> };
    assert.equal(tree.children?.[0]?.label, 'Done');
    assert.equal((await remote.getScreenshot('SIM-1')).toString(), 'png-bytes');
    await remote.activateApp('com.example.app');
    await remote.terminateApp('com.example.app');
    await remote.performAction('SIM-1', { type: 'tap', x: 25, y: 60 });
    await remote.performAction('SIM-1', { type: 'type', text: 'hello' });
    await remote.performAction('SIM-1', { type: 'home' });
    await remote.performAction('SIM-1', { type: 'lock' });
    await remote.performAction('SIM-1', { type: 'wake' });
    assert.equal(await remote.isLocked('SIM-1'), true);
    remote.forget();
    await new Promise((resolve) => setTimeout(resolve, 0));

    assert.equal(requests.filter(({ method, pathname }) => method === 'POST' && pathname === '/session').length, 1);
    const create = requests.find(({ method, pathname }) => method === 'POST' && pathname === '/session')?.body as {
        capabilities?: { alwaysMatch?: Record<string, unknown> };
    };
    assert.equal(create.capabilities?.alwaysMatch?.platformName, 'iOS');
    assert.equal(create.capabilities?.alwaysMatch?.['appium:automationName'], 'XCUITest');
    assert.equal(create.capabilities?.alwaysMatch?.['appium:udid'], 'SIM-1');

    const keys = requests.find(({ pathname }) => pathname.endsWith('/keys'))?.body as { value?: string[] };
    assert.deepEqual(keys.value, ['h', 'e', 'l', 'l', 'o']);
    const execute = requests.find(({ pathname }) => pathname.endsWith('/execute/sync'))?.body as { script?: string; args?: unknown[] };
    assert.equal(execute.script, 'mobile: pressButton');
    assert.deepEqual(execute.args, [{ name: 'home' }]);
    assert.equal(requests.some(({ method, pathname }) => method === 'DELETE' && pathname === '/session/session-1'), true);
});

test('Appium remote retries transient session creation failures within the same request', async () => {
    let attempts = 0;
    const fetchImpl: typeof fetch = async (input) => {
        const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
        if (url.pathname === '/session') {
            attempts += 1;
            if (attempts === 1) return Response.json({ value: { message: 'temporary startup failure' } }, { status: 500 });
            return Response.json({ value: { sessionId: 'session-2', capabilities: {} } });
        }
        if (url.pathname.endsWith('/window/rect')) return Response.json({ value: { width: 430, height: 932 } });
        return Response.json({ value: null });
    };
    const remote = new AppiumRemoteControl({
        name: 'Simulator', udid: 'SIM-RETRY', platform: 'ios', kind: 'simulator', automationBackend: 'appium', pluginData: {},
    }, 'appium.test', 4726, fetchImpl);
    assert.deepEqual(await remote.getScreenInfo('SIM-RETRY'), { screenSize: { width: 430, height: 932 }, scale: 1 });
    assert.equal(attempts, 2);
});

test('Appium remote recreates a stale session after the Appium server restarts', async () => {
    let sessions = 0;
    const requests: SeenRequest[] = [];
    const fetchImpl: typeof fetch = async (input, init) => {
        const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
        const method = String(init?.method ?? 'GET').toUpperCase();
        requests.push({ method, pathname: url.pathname });
        if (method === 'POST' && url.pathname === '/session') {
            sessions += 1;
            return Response.json({ value: { sessionId: `session-${sessions}`, capabilities: {} } });
        }
        if (url.pathname === '/session/session-1/screenshot') {
            return Response.json({
                value: { error: 'invalid session id', message: 'The session no longer exists' },
            }, { status: 404 });
        }
        if (url.pathname === '/session/session-2/screenshot') {
            return Response.json({ value: Buffer.from('fresh-png').toString('base64') });
        }
        return Response.json({ value: null });
    };
    const remote = new AppiumRemoteControl({
        name: 'Simulator', udid: 'SIM-STALE', platform: 'ios', kind: 'simulator', automationBackend: 'appium', pluginData: {},
    }, 'appium.test', 4726, fetchImpl);

    assert.equal((await remote.getScreenshot('SIM-STALE')).toString(), 'fresh-png');
    assert.equal(sessions, 2);
    assert.equal(requests.filter(({ method, pathname }) => method === 'POST' && pathname === '/session').length, 2);
});

test('Appium read-only operations recreate a session after a transport timeout without retrying actions', async () => {
    let sessions = 0;
    const requests: SeenRequest[] = [];
    const fetchImpl: typeof fetch = async (input, init) => {
        const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
        const method = String(init?.method ?? 'GET').toUpperCase();
        requests.push({ method, pathname: url.pathname });
        if (method === 'POST' && url.pathname === '/session') {
            sessions += 1;
            return Response.json({ value: { sessionId: `session-${sessions}`, capabilities: {} } });
        }
        if (url.pathname === '/session/session-1/screenshot') {
            throw new DOMException('The operation was aborted due to timeout', 'TimeoutError');
        }
        if (method === 'DELETE' && url.pathname === '/session/session-1') return Response.json({ value: null });
        if (url.pathname === '/session/session-2/screenshot') {
            return Response.json({ value: Buffer.from('recovered-png').toString('base64') });
        }
        return Response.json({ value: null });
    };
    const remote = new AppiumRemoteControl({
        name: 'Simulator', udid: 'SIM-TIMEOUT', platform: 'ios', kind: 'simulator', automationBackend: 'appium', pluginData: {},
    }, 'appium.test', 4726, fetchImpl);

    assert.equal((await remote.getScreenshot('SIM-TIMEOUT')).toString(), 'recovered-png');
    assert.equal(sessions, 2);
    assert.equal(requests.some(({ method, pathname }) => method === 'DELETE' && pathname === '/session/session-1'), true);
});

test('Appium read-only operations recreate a session when WDA disappears behind a live Appium session', async () => {
    let sessions = 0;
    const fetchImpl: typeof fetch = async (input, init) => {
        const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
        const method = String(init?.method ?? 'GET').toUpperCase();
        if (method === 'POST' && url.pathname === '/session') {
            sessions += 1;
            return Response.json({ value: { sessionId: `session-${sessions}`, capabilities: {} } });
        }
        if (url.pathname === '/session/session-1/screenshot') {
            return Response.json({
                value: { error: 'unknown error', message: 'Could not proxy command to WDA: connect ECONNREFUSED 127.0.0.1:8100' },
            }, { status: 500 });
        }
        if (method === 'DELETE' && url.pathname === '/session/session-1') return Response.json({ value: null });
        if (url.pathname === '/session/session-2/screenshot') {
            return Response.json({ value: Buffer.from('wda-recovered').toString('base64') });
        }
        return Response.json({ value: null });
    };
    const remote = new AppiumRemoteControl({
        name: 'Simulator', udid: 'SIM-WDA', platform: 'ios', kind: 'simulator', automationBackend: 'appium', pluginData: {},
    }, 'appium.test', 4726, fetchImpl);

    assert.equal((await remote.getScreenshot('SIM-WDA')).toString(), 'wda-recovered');
    assert.equal(sessions, 2);
});
