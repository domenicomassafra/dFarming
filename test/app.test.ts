import { inject } from './support.js';
import assert from 'node:assert/strict';
import test from 'node:test';

import { createApp } from '../src/api/app.js';
import { defaultDashboardTheme } from '../src/dashboard-theme.js';
import type { DeviceRegistrationManager, RegistrationSnapshot } from '../src/devices/registration.js';
import { PluginRegistry } from '../src/registry.js';
import type { SchedulerRepository } from '../src/scheduler/repository.js';
import { portableFlowPlugin } from '../src/flow-plugin.js';

const device = { name: 'Test iPhone', osVersion: '16.7', udid: 'test-device', productType: 'iPhone10,1' };

function snapshot(): RegistrationSnapshot {
    const passed = { state: 'passed' as const, message: 'Ready', updatedAt: new Date(0).toISOString() };
    return {
        id: device.udid, device, name: device.name, coordinateProfile: 'iphone8',
        availableProfiles: [{ name: 'iphone8', displayName: 'iPhone 8', screenSize: { width: 375, height: 667 } }],
        recommendedProfile: 'iphone8', wdaLocalPort: 8100, mjpegLocalPort: 9100,
        tiktokAccounts: [], instagramAccounts: [], hasPasscode: false, busy: false,
        checks: {
            host: passed, connection: passed, signing: passed, developer: passed, wda: passed,
            appium: passed, video: passed, touch: passed, tiktok: passed, instagram: passed, accounts: passed,
        },
        logs: [], canFinalize: true, finalized: false,
    };
}

function registrations(): DeviceRegistrationManager {
    let current = snapshot();
    return {
        async start() {}, async close() {},
        async candidates() { return [device]; },
        async create() { return current; },
        async get() { return current; },
        async update(_id, input) { current = { ...current, name: input.name ?? current.name }; return current; },
        async run(_id, action) {
            if (action === 'finalize') current = { ...current, finalized: true };
            return current;
        },
        async cancel() {},
    };
}

test('a configured auth provider adds a Log out link to the nav', async (context) => {
    const app = await createApp({
        plugins: new PluginRegistry([]),
        scheduler: {} as SchedulerRepository,
        registrations: registrations(),
        dashboardTheme: defaultDashboardTheme,
        authProvider: {
            id: 'test', logoutPath: '/auth/logout',
            registerRoutes() {},
            async authenticate() { return { id: 'u', roles: [] }; },
            isPublicPath() { return false; },
        },
    });
    context.after(() => app.close());

    for (const url of ['/', '/tasks', '/devices/register']) {
        const res = await inject(app, { method: 'GET', url });
        assert.equal(res.statusCode, 200, url);
        assert.match(res.body, /href="\/auth\/logout"[^>]*>Log out</, url);
        assert.doesNotMatch(res.body, /__AUTH_NAV__/, url);
        assert.match(res.body, /\/assets\/styles\.css\?v=[\w-]+/, url);
    }

    const css = await inject(app, { method: 'GET', url: '/assets/styles.css?v=x' });
    assert.match(String(css.headers['cache-control']), /immutable/);
    const cssBare = await inject(app, { method: 'GET', url: '/assets/styles.css' });
    assert.match(String(cssBare.headers['cache-control']), /no-cache/);
});

test('a plugin can contribute nav links and register its own routes', async (context) => {
    const app = await createApp({
        plugins: new PluginRegistry([{
            id: 'com.example.stats', version: '1.0.0', displayName: 'Stats', tasks: [],
            navLinks: [{ label: 'Stats', href: '/stats' }],
            registerRoutes({ app: instance }) {
                instance.get('/stats', async (_request, reply) => reply.type('text/html').send('<h1>stats</h1>'));
            },
        }]),
        scheduler: {} as SchedulerRepository,
        registrations: registrations(),
        dashboardTheme: defaultDashboardTheme,
    });
    context.after(() => app.close());

    for (const url of ['/', '/tasks', '/devices/register']) {
        const res = await inject(app, { method: 'GET', url });
        assert.equal(res.statusCode, 200, url);
        assert.match(res.body, /href="\/stats"[^>]*>Stats</, url);
        assert.doesNotMatch(res.body, /__PLUGIN_NAV__/, url);
    }

    const stats = await inject(app, { method: 'GET', url: '/stats' });
    assert.equal(stats.statusCode, 200);
    assert.match(stats.body, /<h1>stats<\/h1>/);
});

test('the CSRF guard rejects cross-origin writes even with no auth provider', async (context) => {
    const app = await createApp({
        plugins: new PluginRegistry([]),
        scheduler: {} as SchedulerRepository,
        registrations: registrations(),
        dashboardTheme: defaultDashboardTheme,
    });
    context.after(() => app.close());

    // no Origin at all — a classic form-POST CSRF shape
    const noOrigin = await app.inject({ method: 'POST', url: '/api/device-registrations', payload: { udid: device.udid } });
    assert.equal(noOrigin.statusCode, 403);

    // a foreign Origin
    const foreign = await app.inject({
        method: 'POST', url: '/api/device-registrations',
        headers: { origin: 'https://evil.example' }, payload: { udid: device.udid },
    });
    assert.equal(foreign.statusCode, 403);

    // same-origin (what the dashboard sends) goes through
    const same = await app.inject({
        method: 'POST', url: '/api/device-registrations',
        headers: { origin: 'http://localhost:80' }, payload: { udid: device.udid },
    });
    assert.equal(same.statusCode, 201);

    // a Bearer client is a real API caller, not a browser form
    const bearer = await app.inject({
        method: 'POST', url: '/api/device-registrations',
        headers: { authorization: 'Bearer x' }, payload: { udid: device.udid },
    });
    assert.notEqual(bearer.statusCode, 403);
});

test('serves and drives the public registration wizard', async (context) => {
    const app = await createApp({
        plugins: new PluginRegistry([]),
        scheduler: {} as SchedulerRepository,
        registrations: registrations(),
        dashboardTheme: defaultDashboardTheme,
    });
    context.after(() => app.close());

    const page = await inject(app, { method: 'GET', url: '/devices/register' });
    assert.equal(page.statusCode, 200);
    assert.match(page.body.replace(/<[^>]+>/g, ' '), /Register\s+an?\s+(?:iOS\s+)?device/i);
    assert.match(page.body, /id="onboarding-status"/);
    assert.match(page.body, /id="onboarding-host-count"/);
    assert.match(page.body, /id="onboarding-runtime-count"/);
    assert.match(page.body, /id="onboarding-iphone-count"/);
    assert.match(page.body, /Fast attach · Appium 3/);
    assert.match(page.body, /Physical iPhone · isolated WDA/);
    assert.match(page.body, /id="refresh-runtimes"[^>]*>Scan hosts</);

    const candidates = await inject(app, { method: 'GET', url: '/api/device-registrations/candidates' });
    assert.equal(candidates.statusCode, 200);
    assert.deepEqual(candidates.json().devices, [device]);

    const created = await inject(app, { method: 'POST', url: '/api/device-registrations', payload: { udid: device.udid } });
    assert.equal(created.statusCode, 201);
    assert.equal(created.json().id, device.udid);

    const finalized = await inject(app, {
        method: 'POST', url: `/api/device-registrations/${device.udid}/actions/finalize`, payload: {},
    });
    assert.equal(finalized.statusCode, 200);
    assert.equal(finalized.json().finalized, true);
});

test('serves a live fleet wall instead of the old mock fleet demo', async (context) => {
    const app = await createApp({
        plugins: new PluginRegistry([]),
        scheduler: {} as SchedulerRepository,
        registrations: registrations(),
        dashboardTheme: defaultDashboardTheme,
    });
    context.after(() => app.close());
    const response = await app.inject({ method: 'GET', url: '/fleet' });
    assert.equal(response.statusCode, 200);
    assert.match(response.body, /Live device wall/i);
    assert.match(response.body, /assets\/fleet\.js/);
    assert.match(response.body, /id="fleet-notice"/);
    assert.match(response.body, /id="fleet-status"/);
    assert.match(response.body, /id="fleet-platform"/);
    assert.match(response.body, /id="fleet-kind"/);
    assert.match(response.body, /id="fleet-group"[^>]*>[\s\S]*Group by host/);
    assert.match(response.body, /id="fleet-auto-refresh"/);
    assert.match(response.body, /id="fleet-focus-retry"/);
    assert.match(response.body, /id="fleet-focus-still"/);
    assert.match(response.body, /Review & apply/);
    assert.doesNotMatch(response.body, /mock fleet of 20 seats/i);

    const fleetAsset = await app.inject({ method: 'GET', url: '/assets/fleet.js' });
    assert.equal(fleetAsset.statusCode, 200);
    assert.match(fleetAsset.body, /disconnected/);
    assert.match(fleetAsset.body, /Only this focused device is streaming live/);
    assert.match(fleetAsset.body, /Switching focused stream/);
    assert.match(fleetAsset.body, /focusGeneration/);
    assert.match(fleetAsset.body, /stream-token\?scope=fleet/);
    assert.match(fleetAsset.body, /Clear queued work and request stop/);

    const legacy = await app.inject({ method: 'GET', url: '/demo/devices' });
    assert.equal(legacy.statusCode, 200);
    assert.match(legacy.body, /Live device wall/i);
});

test('overview control center exposes the major product surfaces instead of hiding them behind navigation', async (context) => {
    const scheduler = {
        async listFlowDefinitions() { return [{ id: 'flow-1' }]; },
        async listDevicePools() { return [{ id: 'pool-1' }, { id: 'pool-2' }]; },
        async listSchedules() { return [{ status: 'active' }, { status: 'paused' }]; },
        async listExecutions() {
            return [
                { status: 'running', pluginId: 'com.dfarming.flow', taskType: 'flow', deviceUdid: 'sim-1', scheduledFor: new Date(0) },
                { status: 'queued', pluginId: 'com.dfarming.instagram', taskType: 'doomscroll', deviceUdid: 'iphone-1', scheduledFor: new Date(1) },
            ];
        },
    } as unknown as SchedulerRepository;
    const app = await createApp({
        plugins: new PluginRegistry([]), scheduler, registrations: registrations(), dashboardTheme: defaultDashboardTheme,
        listHosts: () => [{
            id: 'macstudio', hostname: 'studio', os: 'darwin', arch: 'arm64', online: true,
            observedAt: new Date(0).toISOString(), capabilities: ['ios.physical'],
            tools: { appium: true, appiumRuntime: true, xcrun: true, adb: false, emulator: false, scrcpyVideo: false },
            error: 'ignored unsupported worker advertisement',
        }],
    });
    context.after(() => app.close());

    const page = await inject(app, { method: 'GET', url: '/' });
    assert.equal(page.statusCode, 200);
    assert.match(page.body, /id="control-center"/);
    assert.match(page.body, /id="overview-rename-dialog"/);
    assert.match(page.body, /id="device-list-search"/);
    assert.match(page.body, /id="device-list-status"/);
    assert.match(page.body, /id="device-list-platform"/);
    assert.match(page.body, /id="device-list-sort"/);
    assert.match(page.body, /data-device-view="grid"/);
    assert.match(page.body, /data-device-view="compact"/);
    assert.match(page.body, /assets\/overview\.js\?v=/);
    assert.match(page.body, /Build a flow/);
    assert.match(page.body, /aria-label="Primary"/);
    assert.match(page.body, /href="\/" aria-current="page"/);

    const overviewAsset = await inject(app, { method: 'GET', url: '/assets/overview.js' });
    assert.equal(overviewAsset.statusCode, 200);
    assert.match(overviewAsset.headers['content-type'] ?? '', /text\/javascript/);
    assert.match(overviewAsset.body, /device-list-search/);
    assert.match(overviewAsset.body, /device-list-sort/);
    assert.match(overviewAsset.body, /mobile-farm\.device-list-view/);
    assert.match(overviewAsset.body, /MutationObserver/);
    assert.match(overviewAsset.body, /htmx:afterSettle/);
    assert.match(overviewAsset.body, /detail\?\.elt/);

    const fragment = await inject(app, { method: 'GET', url: '/api/fragments/control-center' });
    assert.equal(fragment.statusCode, 200);
    assert.match(fragment.body, /Automation Studio/);
    assert.match(fragment.body, /1 saved flow/);
    assert.match(fragment.body, /2 reusable pools/);
    assert.match(fragment.body, /1 active schedule/);
    assert.match(fragment.body, /0\/1 healthy/);
    assert.match(fragment.body, /1 execution host degraded/);
    assert.match(fragment.body, /Semantic cross-platform flows/i);
    assert.match(fragment.body, /Recent runs/);
    assert.match(fragment.body, /Portable flow/);
    // The app intentionally reads the operator registry from the working tree.
    // CI has no devices, while a live development checkout may already contain
    // a registered-but-offline runtime. Both states must surface an attention
    // alert without making this product-surface test environment-dependent.
    assert.match(fragment.body, /(No devices registered|All devices offline)/);

    const hosts = await inject(app, { method: 'GET', url: '/api/fragments/hosts' });
    assert.equal(hosts.statusCode, 200);
    assert.match(hosts.body, /degraded/);
    assert.match(hosts.body, /0\/1 healthy/);
    assert.match(hosts.body, /ignored unsupported worker advertisement/);
    assert.doesNotMatch(hosts.body, /connection-chip ready">online/);

    const automations = await inject(app, { method: 'GET', url: '/automations' });
    assert.equal(automations.statusCode, 200);
    assert.match(automations.body, /automation-mode-bar/);
    assert.match(automations.body, /id="flow-pool-name"/);
    assert.match(automations.body, /id="flow-duplicate-dialog"/);
    assert.match(automations.body, /class="automation-journey"/);
    assert.match(automations.body, /data-flow-stage="target"/);
    assert.match(automations.body, /data-flow-stage="flow"/);
    assert.match(automations.body, /data-flow-stage="schedule"/);
    assert.match(automations.body, /data-flow-stage="run"/);
    assert.match(automations.body, /class="flow-secondary-panel flow-actions-panel"/);
    assert.doesNotMatch(automations.body, /Schedule &amp; run/);
    assert.doesNotMatch(automations.body, /Create a post/);
    const automationStyles = await inject(app, { method: 'GET', url: '/assets/styles.css' });
    assert.equal(automationStyles.statusCode, 200);
    assert.match(automationStyles.body, /\.flow-schedule-bar > \[hidden\]/);
    assert.match(automationStyles.body, /\.flow-version-actions > \[hidden\]/);
    assert.match(automationStyles.body, /--surface:\s*var\(--panel\)/);
    assert.match(automationStyles.body, /--line:\s*var\(--border\)/);
    assert.match(automationStyles.body, /prefers-reduced-motion:\s*reduce/);
    assert.match(automationStyles.body, /button:focus-visible/);

    const runs = await inject(app, { method: 'GET', url: '/tasks' });
    assert.equal(runs.statusCode, 200);
    assert.match(runs.body, /Runs · dFarming/);
    assert.match(runs.body, /id="runs-search"/);
    assert.match(runs.body, /id="runs-device"/);
    assert.match(runs.body, /id="runs-flow"/);
    assert.match(runs.body, /id="runs-live-refresh"/);
    assert.match(runs.body, /id="runs-kpi-attention"/);
    assert.match(runs.body, /Recent runs/);
    assert.match(runs.body, /Execution history/);
    assert.match(runs.body, /Upcoming &amp; recurring/);
    assert.match(runs.body, /id="runs-action-status"/);
    assert.match(runs.body, /id="schedule-edit-dialog"/);
    assert.match(runs.body, /id="execution-detail-dialog"/);
    assert.match(runs.body, /id="execution-detail-links"/);
    assert.match(runs.body, /id="execution-detail-error-section"/);
    assert.doesNotMatch(runs.body, /brand-name">IOS AGENTS/);

    const tasksAsset = await inject(app, { method: 'GET', url: '/assets/tasks.js' });
    assert.equal(tasksAsset.statusCode, 200);
    assert.match(tasksAsset.body, /runs-device/);
    assert.match(tasksAsset.body, /runs-flow/);
    assert.match(tasksAsset.body, /sourceFlowId/);
    assert.match(tasksAsset.body, /Live refresh|runs-live-refresh/);
    const runsStyles = await inject(app, { method: 'GET', url: '/assets/styles.css' });
    assert.match(runsStyles.body, /\.schedule-editor-grid > \[hidden\]/);
});

test('device pool API normalizes selectors and rejects duplicate names', async (context) => {
    type Pool = { id: string; name: string; selector: Record<string, unknown>; createdAt: Date; updatedAt: Date };
    let pools: Pool[] = [];
    let sequence = 0;
    const scheduler = {
        async listDevicePools() { return pools; },
        async devicePool(id: string) { return pools.find((pool) => pool.id === id) ?? null; },
        async createDevicePool(name: string, selector: Record<string, unknown>) {
            const now = new Date(0);
            const pool = { id: `pool-${++sequence}`, name, selector, createdAt: now, updatedAt: now };
            pools.push(pool);
            return pool;
        },
        async updateDevicePool(id: string, name: string, selector: Record<string, unknown>) {
            const index = pools.findIndex((pool) => pool.id === id);
            if (index < 0) return null;
            const pool = { ...pools[index]!, name, selector, updatedAt: new Date(1) };
            pools[index] = pool;
            return pool;
        },
        async deleteDevicePool(id: string) {
            const before = pools.length;
            pools = pools.filter((pool) => pool.id !== id);
            return pools.length !== before;
        },
    } as unknown as SchedulerRepository;
    const app = await createApp({
        plugins: new PluginRegistry([]), scheduler, registrations: registrations(), dashboardTheme: defaultDashboardTheme,
    });
    context.after(() => app.close());

    const created = await inject(app, {
        method: 'POST', url: '/api/pools', payload: {
            name: 'Android staging', selector: { platform: 'android', tags: ['Staging', 'pixel', 'pixel'], requireIdle: true },
        },
    });
    assert.equal(created.statusCode, 201);
    assert.deepEqual(created.json().pool.selector.tags, ['staging', 'pixel']);

    const duplicate = await inject(app, {
        method: 'POST', url: '/api/pools', payload: { name: 'android STAGING', selector: {} },
    });
    assert.equal(duplicate.statusCode, 409);

    const invalid = await inject(app, {
        method: 'PUT', url: '/api/pools/pool-1', payload: { name: 'Android staging', selector: { tags: ['bad tag'] } },
    });
    assert.equal(invalid.statusCode, 400);

    const listed = await inject(app, { method: 'GET', url: '/api/pools' });
    assert.equal(listed.statusCode, 200);
    assert.equal(listed.json().pools.length, 1);

    const deleted = await inject(app, { method: 'DELETE', url: '/api/pools/pool-1' });
    assert.equal(deleted.statusCode, 204);
    assert.equal(pools.length, 0);
});

test('flow library API validates, versions and exports portable flows through the scheduler repository contract', async (context) => {
    const stored = new Map<string, {
        id: string; name: string; currentVersion: number; payload: Record<string, unknown>; versions: Array<{ version: number; createdAt: Date }>;
    }>();
    const scheduler = {
        async listFlowDefinitions() { return [...stored.values()]; },
        async createFlowDefinition(payload: Record<string, unknown>) {
            const id = '11111111-1111-4111-8111-111111111111';
            const flow = { id, name: String(payload.name), currentVersion: 1, payload, versions: [{ version: 1, createdAt: new Date(0) }], createdAt: new Date(0), updatedAt: new Date(0) };
            stored.set(id, flow);
            return flow;
        },
        async flowDefinition(id: string) { return stored.get(id) ?? null; },
        async saveFlowVersion(id: string, payload: Record<string, unknown>) {
            const current = stored.get(id);
            if (!current) return null;
            const version = current.currentVersion + 1;
            const next = { ...current, name: String(payload.name), currentVersion: version, payload, versions: [{ version, createdAt: new Date(1) }, ...current.versions] };
            stored.set(id, next);
            return next;
        },
        async duplicateFlowDefinition() { return null; }, async restoreFlowVersion() { return null; }, async deleteFlowDefinition() { return true; },
    } as unknown as SchedulerRepository;
    const app = await createApp({ plugins: new PluginRegistry([portableFlowPlugin]), scheduler, dashboardTheme: defaultDashboardTheme });
    context.after(() => app.close());
    const headers = { authorization: 'Bearer test' };

    const created = await app.inject({
        method: 'POST', url: '/api/flows', headers,
        payload: { name: 'Login', steps: [{ action: 'launch', appId: 'com.example.app' }, { action: 'tapText', text: 'Continue' }] },
    });
    assert.equal(created.statusCode, 201);
    assert.equal(created.json().flow.currentVersion, 1);

    const updated = await app.inject({
        method: 'PUT', url: '/api/flows/11111111-1111-4111-8111-111111111111', headers,
        payload: { name: 'Login', steps: [{ action: 'launch', appId: 'com.example.app' }, { action: 'assertVisible', text: 'Welcome' }] },
    });
    assert.equal(updated.statusCode, 200);
    assert.equal(updated.json().flow.currentVersion, 2);

    const exported = await app.inject({ method: 'GET', url: '/api/flows/11111111-1111-4111-8111-111111111111/export' });
    assert.equal(exported.statusCode, 200);
    assert.equal(exported.json().format, 'dfarming-flow@1');
    assert.equal(exported.json().flow.name, 'Login');
});
