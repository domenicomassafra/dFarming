import { inject } from './support.js';
import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const directory = await mkdtemp(path.join(os.tmpdir(), 'pf-accounts-api-'));
const configPath = path.join(directory, 'devices.json');
process.env.DEVICES_CONFIG_PATH = configPath;

test('GET /api/accounts exposes a redacted cross-device account inventory', async (context) => {
    await writeFile(configPath, JSON.stringify([{
        name: 'Phone A', udid: 'udid-a', passcode: '123456', pluginData: {
            'com.dfarming.tiktok': { accounts: ['@alpha'] },
            'com.dfarming.instagram': { accounts: ['@bravo'] },
        },
    }, {
        name: 'Phone B', udid: 'udid-b', disabled: true, pluginData: {
            'com.dfarming.tiktok': { accounts: ['@charlie'] },
        },
    }]));

    const { createApp } = await import('../src/api/app.js');
    const { PluginRegistry } = await import('../src/registry.js');
    type SchedulerRepository = import('../src/scheduler/repository.js').SchedulerRepository;
    const app = await createApp({
        plugins: new PluginRegistry([]),
        scheduler: { async activeExecution() { return null; } } as unknown as SchedulerRepository,
    });
    context.after(() => app.close());

    const response = await inject(app, { method: 'GET', url: '/api/accounts' });
    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.json().accounts.map((account: Record<string, unknown>) => ({
        platform: account.platform, handle: account.handle, deviceUdid: account.deviceUdid,
        deviceDisabled: account.deviceDisabled,
    })), [
        { platform: 'instagram', handle: '@bravo', deviceUdid: 'udid-a', deviceDisabled: false },
        { platform: 'tiktok', handle: '@alpha', deviceUdid: 'udid-a', deviceDisabled: false },
        { platform: 'tiktok', handle: '@charlie', deviceUdid: 'udid-b', deviceDisabled: true },
    ]);
    assert.equal(response.body.includes('123456'), false);

    const paused = await inject(app, {
        method: 'PATCH', url: '/api/devices/udid-a/accounts/tiktok/%40alpha/policy',
        payload: { paused: true, allowedTaskTypes: ['post'], note: 'manual review' },
    });
    assert.equal(paused.statusCode, 200);
    assert.deepEqual(paused.json().account.policy, {
        paused: true, allowedTaskTypes: ['post'], note: 'manual review',
    });

    const profile = await inject(app, {
        method: 'PATCH', url: '/api/devices/udid-a/accounts/tiktok/%40alpha/policy',
        payload: { executionProfile: { id: 'alpha-primary', dedicatedDeviceUdid: 'udid-a', requiredTags: ['creator'], networkRouteId: 'italy.private' } },
    });
    assert.equal(profile.statusCode, 200);
    assert.deepEqual(profile.json().account.policy.executionProfile, {
        id: 'alpha-primary', dedicatedDeviceUdid: 'udid-a', requiredTags: ['creator'], networkRouteId: 'italy.private',
    });

    const invalidProfile = await inject(app, {
        method: 'PATCH', url: '/api/devices/udid-a/accounts/tiktok/%40alpha/policy',
        payload: { executionProfile: { id: 'not valid!' } },
    });
    assert.equal(invalidProfile.statusCode, 400);

    const missing = await inject(app, {
        method: 'PATCH', url: '/api/devices/udid-a/accounts/tiktok/%40missing/policy',
        payload: { paused: true },
    });
    assert.equal(missing.statusCode, 404);
});
