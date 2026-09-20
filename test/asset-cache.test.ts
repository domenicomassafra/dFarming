import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { materializeAssetFile, resolveAssetPath } from '../src/scheduler/asset-cache.js';

test('asset cache confines scheduler-relative paths to the data root', () => {
    const root = path.resolve('/tmp/dfarming-assets');
    assert.equal(resolveAssetPath(root, 'assets/item.bin'), path.join(root, 'assets/item.bin'));
    assert.throws(() => resolveAssetPath(root, '../outside.bin'), /escapes scheduler data root/);
    assert.throws(() => resolveAssetPath(root, '/tmp/outside.bin'), /escapes scheduler data root/);
});

test('asset cache returns an existing canonical local file without network access', async (context) => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'dfarming-asset-local-'));
    context.after(() => rm(root, { recursive: true, force: true }));
    const relativePath = 'assets/local.bin';
    const target = path.join(root, relativePath);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, 'local');
    let fetched = false;
    const result = await materializeAssetFile({
        id: 'local-1',
        relativePath,
        originalName: 'local.bin',
        size: 5,
        sha256: crypto.createHash('sha256').update('local').digest('hex'),
    }, {
        dataRoot: root,
        fetchImpl: async () => {
            fetched = true;
            throw new Error('should not fetch');
        },
    });
    assert.equal(result, target);
    assert.equal(fetched, false);
});

test('asset cache verifies remote bytes and coalesces concurrent downloads', async (context) => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'dfarming-asset-remote-'));
    context.after(() => rm(root, { recursive: true, force: true }));
    const body = Buffer.from('canonical bytes');
    const asset = {
        id: 'remote-1',
        relativePath: 'assets/missing.bin',
        originalName: 'remote.bin',
        size: body.length,
        sha256: crypto.createHash('sha256').update(body).digest('hex'),
    };
    let fetches = 0;
    const fetchImpl: typeof fetch = async (_input, init) => {
        fetches += 1;
        assert.equal(new Headers(init?.headers).get('authorization'), 'Bearer secret');
        await new Promise((resolve) => setTimeout(resolve, 20));
        return new Response(body, { status: 200 });
    };
    const paths = await Promise.all(Array.from({ length: 12 }, () => materializeAssetFile(asset, {
        dataRoot: root,
        controlPlaneUrl: 'http://control.test:4050/',
        internalToken: 'secret',
        fetchImpl,
    })));
    assert.equal(new Set(paths).size, 1);
    assert.equal(fetches, 1);
    assert.deepEqual(await readFile(paths[0]!), body);
});

test('asset cache rejects a remote payload that fails integrity verification', async (context) => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'dfarming-asset-bad-'));
    context.after(() => rm(root, { recursive: true, force: true }));
    await assert.rejects(() => materializeAssetFile({
        id: 'bad-1',
        relativePath: 'assets/missing.bin',
        originalName: 'bad.bin',
        size: 4,
        sha256: crypto.createHash('sha256').update('good').digest('hex'),
    }, {
        dataRoot: root,
        controlPlaneUrl: 'http://control.test/',
        internalToken: 'secret',
        fetchImpl: async () => new Response('evil', { status: 200 }),
    }), /integrity check failed/);
});

test('asset cache cleanup deletes the control-plane copy and local worker cache', async (context) => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'dfarming-asset-purge-'));
    context.after(() => rm(root, { recursive: true, force: true }));
    const cached = path.join(root, 'remote-cache', 'asset-1');
    await mkdir(path.dirname(cached), { recursive: true });
    await writeFile(cached, 'cached');
    const { purgeRemoteAsset } = await import('../src/scheduler/asset-cache.js');
    let request: Request | undefined;
    await purgeRemoteAsset('asset-1', {
        dataRoot: root,
        controlPlaneUrl: 'http://control.test:4050/',
        internalToken: 'secret',
        fetchImpl: async (input, init) => {
            request = new Request(input, init);
            return new Response(null, { status: 204 });
        },
    });
    assert.equal(request?.method, 'DELETE');
    assert.equal(request?.headers.get('authorization'), 'Bearer secret');
    await assert.rejects(() => readFile(cached), /ENOENT/);
});
