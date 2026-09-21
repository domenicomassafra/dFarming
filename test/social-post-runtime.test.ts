import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { importWdaMedia, positiveInteger } from '../src/social/post-runtime.js';

test('positiveInteger accepts positive integer env values and rejects invalid ones', () => {
    const key = 'DFARMING_TEST_POSITIVE_INTEGER';
    const previous = process.env[key];
    try {
        delete process.env[key];
        assert.equal(positiveInteger(key, 7), 7);
        process.env[key] = '12';
        assert.equal(positiveInteger(key, 7), 12);
        process.env[key] = '0';
        assert.throws(() => positiveInteger(key, 7), /positive integer/);
        process.env[key] = 'not-a-number';
        assert.throws(() => positiveInteger(key, 7), /positive integer/);
    } finally {
        if (previous === undefined) delete process.env[key];
        else process.env[key] = previous;
    }
});

test('importWdaMedia imports newest-first while preserving manifest order in Photos', async (context) => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'dfarming-post-runtime-'));
    context.after(() => rm(root, { recursive: true, force: true }));
    const one = path.join(root, 'one.bin');
    const two = path.join(root, 'two.bin');
    await writeFile(one, Buffer.from('one'));
    await writeFile(two, Buffer.from('two'));

    const originalFetch = globalThis.fetch;
    const seen: string[] = [];
    try {
        globalThis.fetch = async (_input, init) => {
            const body = JSON.parse(String(init?.body)) as { name: string; data: string };
            seen.push(body.name);
            assert.ok(Buffer.from(body.data, 'base64').length > 0);
            return new Response(JSON.stringify({ value: { assetCount: seen.length } }), {
                status: 200,
                headers: { 'content-type': 'application/json' },
            });
        };
        const count = await importWdaMedia({
            files: [
                { name: 'one.bin', path: one, mimeType: 'application/octet-stream' },
                { name: 'two.bin', path: two, mimeType: 'application/octet-stream' },
            ],
        }, { platformLabel: 'Test', settleMs: 0, wdaUrl: 'http://wda.test' });
        assert.equal(count, 2);
        assert.deepEqual(seen, ['two.bin', 'one.bin']);
    } finally {
        globalThis.fetch = originalFetch;
    }
});
