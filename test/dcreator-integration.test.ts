import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { dcreatorRequestHash, normalizeDCreatorJob } from '../src/integrations/dcreator.js';
import { inject } from './support.js';

test('dCreator job normalization is bounded and request hashing is canonical', () => {
    const a = normalizeDCreatorJob({
        schema: 'dfarming.dcreator-job/v1', externalId: 'creator:42', assetRefs: [], intent: 'inspect', accountRef: 'Owner.Primary',
        task: { pluginId: 'com.dfarming.tiktok', taskType: 'doomscroll', taskVersion: 1, payload: { b: 2, a: 1 } },
        constraints: { executionProfile: 'owner.primary', networkRoute: 'Italy.Private' },
    });
    const b = normalizeDCreatorJob({
        schema: 'dfarming.dcreator-job/v1', externalId: 'creator:42', assetRefs: [], intent: 'inspect', accountRef: 'owner.primary',
        task: { pluginId: 'com.dfarming.tiktok', taskType: 'doomscroll', taskVersion: 1, payload: { a: 1, b: 2 } },
        timing: { kind: 'now' }, constraints: { networkRoute: 'italy.private', executionProfile: 'owner.primary' },
    });
    assert.equal(dcreatorRequestHash(a), dcreatorRequestHash(b));
    assert.equal(a.accountRef, 'owner.primary');
    assert.equal(a.constraints.networkRoute, 'italy.private');
    assert.throws(() => normalizeDCreatorJob({ ...a, assetRefs: ['not-a-uuid'] }), /assetRefs/);
});

test('dCreator bridge requires the internal token and is idempotent by externalId', async (context) => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'dfarming-dcreator-'));
    const configPath = path.join(directory, 'devices.json');
    process.env.DEVICES_CONFIG_PATH = configPath;
    process.env.DFARMING_INTERNAL_TOKEN = 'bridge-secret';
    process.env.SCHEDULER_DATA_DIR = path.join(directory, 'scheduler-data');
    await writeFile(configPath, JSON.stringify([{
        name: 'Creator Phone', udid: 'creator-phone', platform: 'ios', kind: 'physical', automationBackend: 'wda',
        tags: ['creator'], pluginData: {
            'com.dfarming.tiktok': {
                accounts: ['@owner'], accountPolicies: {
                    '@owner': { executionProfile: { id: 'owner-primary', dedicatedDeviceUdid: 'creator-phone' } },
                },
            },
        },
    }]));

    const { createApp } = await import('../src/api/app.js');
    const { PluginRegistry } = await import('../src/registry.js');
    type ScheduleRow = import('../src/database/schema.js').ScheduleRow;
    type SchedulerRepository = import('../src/scheduler/repository.js').SchedulerRepository;
    const schedules = new Map<string, ScheduleRow>();
    let creates = 0;
    const scheduler = {
        async scheduleByExternal(_source: string, externalId: string) { return schedules.get(externalId) ?? null; },
        async latestExecutionForSchedule() { return null; },
        async devicePool() { return null; },
        async registerAssets(files: Array<{ originalName: string; mimeType: string; size: number; sha256: string; source?: string }>) {
            assert.deepEqual([...new Set(files.map((file) => file.source))], ['dcreator']);
            return files.map((file, index) => ({ id: `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`, name: file.originalName, mimeType: file.mimeType }));
        },
        async createTask(input: Record<string, any>, _pluginData: unknown, _now: Date, _assetIds: string[], metadata: Record<string, string>) {
            assert.equal(metadata.expectedAssetSource, 'dcreator');
            creates += 1;
            const row = {
                id: '00000000-0000-4000-8000-000000000042', campaignId: null, campaignAccount: null,
                executionProfileId: 'owner-primary', networkRouteId: null,
                externalSource: metadata.externalSource, externalId: metadata.externalId, externalRequestHash: metadata.externalRequestHash,
                deviceUdid: input.deviceUdid, pluginId: input.task.pluginId, taskType: input.task.taskType,
                taskVersion: input.task.taskVersion, payload: input.task.payload, timing: input.timing,
                status: 'active', runWindowMinutes: 30, nextRunAt: new Date(), createdAt: new Date(), updatedAt: new Date(),
            } as ScheduleRow;
            schedules.set(metadata.externalId!, row);
            return row;
        },
        async activeExecution() { return null; },
    } as unknown as SchedulerRepository;
    const app = await createApp({ plugins: new PluginRegistry([]), scheduler });
    context.after(async () => {
        await app.close();
        delete process.env.DFARMING_INTERNAL_TOKEN;
        delete process.env.SCHEDULER_DATA_DIR;
    });

    const boundary = '----dfarming-dcreator-test';
    const multipart = Buffer.from([
        `--${boundary}`,
        'Content-Disposition: form-data; name="file"; filename="clip.mp4"',
        'Content-Type: video/mp4', '', 'approved bytes', `--${boundary}--`, '',
    ].join('\r\n'));
    const assetUpload = await inject(app, {
        method: 'POST', url: '/api/internal/integrations/dcreator/assets',
        headers: { authorization: 'Bearer bridge-secret', 'content-type': `multipart/form-data; boundary=${boundary}` },
        payload: multipart,
    });
    assert.equal(assetUpload.statusCode, 201, assetUpload.body);
    assert.deepEqual(assetUpload.json().assetRefs, ['00000000-0000-4000-8000-000000000001']);

    const invalidAsset = Buffer.from([
        `--${boundary}`,
        'Content-Disposition: form-data; name="file"; filename="payload.exe"',
        'Content-Type: application/octet-stream', '', 'not allowed', `--${boundary}--`, '',
    ].join('\r\n'));
    const rejectedAsset = await inject(app, {
        method: 'POST', url: '/api/internal/integrations/dcreator/assets',
        headers: { authorization: 'Bearer bridge-secret', 'content-type': `multipart/form-data; boundary=${boundary}` },
        payload: invalidAsset,
    });
    assert.equal(rejectedAsset.statusCode, 400);
    assert.equal(rejectedAsset.json().error, 'dCreator request was refused by the execution service');

    const payload = {
        schema: 'dfarming.dcreator-job/v1', externalId: 'creator-job-42', assetRefs: [], intent: 'publish', accountRef: 'owner-primary',
        task: { pluginId: 'com.dfarming.tiktok', taskType: 'post', taskVersion: 1, payload: { destination: 'publish' } },
        timing: { kind: 'now' }, constraints: { executionProfile: 'owner-primary' },
    };
    const unauthenticated = await inject(app, { method: 'POST', url: '/api/internal/integrations/dcreator/jobs', payload });
    assert.equal(unauthenticated.statusCode, 401);

    const invalidToken = await inject(app, {
        method: 'POST', url: '/api/internal/integrations/dcreator/jobs',
        headers: { authorization: 'Bearer wrong-secret' }, payload,
    });
    assert.equal(invalidToken.statusCode, 401);
    assert.equal(creates, 0);

    const headers = { authorization: 'Bearer bridge-secret' };
    const first = await inject(app, { method: 'POST', url: '/api/internal/integrations/dcreator/jobs', headers, payload });
    assert.equal(first.statusCode, 201, first.body);
    assert.equal(first.json().receipt.status, 'queued');
    assert.equal(creates, 1);

    const retry = await inject(app, { method: 'POST', url: '/api/internal/integrations/dcreator/jobs', headers, payload });
    assert.equal(retry.statusCode, 200, retry.body);
    assert.equal(retry.json().receipt.scheduleId, first.json().receipt.scheduleId);
    assert.equal(creates, 1);

    const conflict = await inject(app, {
        method: 'POST', url: '/api/internal/integrations/dcreator/jobs', headers,
        payload: { ...payload, intent: 'inspect' },
    });
    assert.equal(conflict.statusCode, 409);
    assert.equal(conflict.json().receipt.status, 'refused');

    const status = await inject(app, { method: 'GET', url: '/api/internal/integrations/dcreator/jobs/creator-job-42', headers });
    assert.equal(status.statusCode, 200);
    assert.equal(status.json().receipt.externalId, 'creator-job-42');
});

test('dCreator intent cannot contradict or bypass the task side effect', async (context) => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'dfarming-dcreator-intent-'));
    const configPath = path.join(directory, 'devices.json');
    process.env.DEVICES_CONFIG_PATH = configPath;
    process.env.DFARMING_INTERNAL_TOKEN = 'bridge-secret';
    process.env.SCHEDULER_DATA_DIR = path.join(directory, 'scheduler-data');
    await writeFile(configPath, JSON.stringify([{
        name: 'Creator Phone', udid: 'creator-phone', platform: 'ios', kind: 'physical', automationBackend: 'wda',
        tags: ['creator'], pluginData: {
            'com.dfarming.tiktok': {
                accounts: ['@owner'], accountPolicies: {
                    '@owner': { executionProfile: { id: 'owner-primary', dedicatedDeviceUdid: 'creator-phone' } },
                },
            },
        },
    }]));

    const { createApp } = await import('../src/api/app.js');
    const { PluginRegistry } = await import('../src/registry.js');
    type SchedulerRepository = import('../src/scheduler/repository.js').SchedulerRepository;
    const scheduler = {
        async scheduleByExternal() { return null; },
        async latestExecutionForSchedule() { return null; },
        async devicePool() { return null; },
        async createTask() { throw new Error('validation must fail before persistence'); },
    } as unknown as SchedulerRepository;
    const app = await createApp({ plugins: new PluginRegistry([]), scheduler });
    context.after(async () => {
        await app.close();
        delete process.env.DFARMING_INTERNAL_TOKEN;
        delete process.env.SCHEDULER_DATA_DIR;
    });

    const headers = { authorization: 'Bearer bridge-secret' };
    const base = {
        schema: 'dfarming.dcreator-job/v1', externalId: 'intent-1', assetRefs: [], accountRef: 'owner-primary',
        task: { pluginId: 'com.dfarming.tiktok', taskType: 'post', taskVersion: 1, payload: { destination: 'publish' } },
        timing: { kind: 'now' }, constraints: { executionProfile: 'owner-primary' },
    };
    const draft = await inject(app, {
        method: 'POST', url: '/api/internal/integrations/dcreator/jobs', headers,
        payload: { ...base, externalId: 'intent-draft', intent: 'draft' },
    });
    assert.equal(draft.statusCode, 409);
    assert.match(draft.json().receipt.reason, /intent/);

    const inspect = await inject(app, {
        method: 'POST', url: '/api/internal/integrations/dcreator/jobs', headers,
        payload: {
            ...base, externalId: 'intent-inspect', intent: 'inspect',
            task: { ...base.task, taskType: 'pipeline-drain', payload: {} },
        },
    });
    assert.equal(inspect.statusCode, 409);
    assert.match(inspect.json().receipt.reason, /intent/);
});
