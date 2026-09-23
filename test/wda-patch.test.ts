import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { ensureWdaCustomizations } from '../src/devices/wda/patch.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('reviewed modern WDA patch is checksum-pinned and contains every required endpoint', async () => {
    const manifest = JSON.parse(await readFile(path.join(root, 'Patches/appium-webdriveragent-16.12.9-dfarming.json'), 'utf8')) as {
        xcuitestDriverVersion: string; webDriverAgentVersion: string; patchFile: string; patchSha256: string;
    };
    assert.equal(manifest.xcuitestDriverVersion, '12.13.1');
    assert.equal(manifest.webDriverAgentVersion, '16.12.9');
    const patch = await readFile(path.join(root, manifest.patchFile));
    assert.equal(crypto.createHash('sha256').update(patch).digest('hex'), manifest.patchSha256);
    const text = patch.toString('utf8');
    assert.match(text, /\/wda\/absolute-actions/);
    assert.match(text, /\/wda\/import-media/);
    assert.match(text, /\/wda\/pressButton/);
    assert.match(text, /NSPhotoLibraryAddUsageDescription/);
});

test('WDA patcher fails closed when the installed driver/WDA versions drift', async (context) => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'dfarming-wda-patch-'));
    context.after(() => rm(directory, { recursive: true, force: true }));
    const driver = path.join(directory, 'driver');
    const wda = path.join(driver, 'node_modules', 'appium-webdriveragent');
    await mkdir(wda, { recursive: true });
    await writeFile(path.join(driver, 'package.json'), JSON.stringify({ version: '99.0.0' }));
    await writeFile(path.join(wda, 'package.json'), JSON.stringify({ version: '99.0.0' }));
    await assert.rejects(() => ensureWdaCustomizations({ driverPath: driver, root: directory }), /version mismatch/);
});
