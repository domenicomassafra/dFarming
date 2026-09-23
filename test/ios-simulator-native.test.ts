import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { captureIosSimulatorScreenshot } from '../src/devices/ios-simulator-native.js';

const png = Buffer.from('89504e470d0a1a0a00000000', 'hex');

test('native Simulator screenshot uses bounded simctl io and returns PNG bytes', async (context) => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'dfarming-native-shot-test-'));
    context.after(() => rm(root, { recursive: true, force: true }));
    const calls: Array<{ executable: string; args: string[] }> = [];
    const image = await captureIosSimulatorScreenshot('SIM-1', {
        temporaryRoot: root,
        run: async (executable, args) => {
            calls.push({ executable, args });
            await writeFile(args.at(-1)!, png);
        },
    });
    assert.deepEqual(image, png);
    assert.equal(calls[0]?.executable, 'xcrun');
    assert.deepEqual(calls[0]?.args.slice(0, 5), ['simctl', 'io', 'SIM-1', 'screenshot', '--type=png']);
});

test('native Simulator screenshot rejects non-PNG output and cleans its temp directory', async (context) => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'dfarming-native-shot-invalid-'));
    context.after(() => rm(root, { recursive: true, force: true }));
    await assert.rejects(captureIosSimulatorScreenshot('SIM-BAD', {
        temporaryRoot: root,
        run: async (_executable, args) => { await writeFile(args.at(-1)!, 'not-png'); },
    }), /invalid PNG/);
});
