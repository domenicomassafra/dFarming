import assert from 'node:assert/strict';
import test from 'node:test';

import { collectRecentDeviceLogs, redactRuntimeLogLine } from '../src/devices/runtime-logs.js';

test('iOS Simulator diagnostics use bounded simctl log snapshots', async () => {
    const calls: Array<{ executable: string; args: string[] }> = [];
    const result = await collectRecentDeviceLogs(
        { udid: 'SIM-1', platform: 'ios', kind: 'simulator' },
        { lines: 2, sinceSeconds: 12 },
        async (executable, args) => {
            calls.push({ executable, args });
            return { stdout: 'one\ntwo\nthree\n' };
        },
    );
    assert.equal(result.supported, true);
    assert.equal(result.source, 'simctl');
    assert.deepEqual(result.lines, ['two', 'three']);
    assert.deepEqual(calls, [{
        executable: 'xcrun',
        args: [
            'simctl', 'spawn', 'SIM-1', 'log', 'show', '--last', '12s', '--style', 'compact', '--predicate',
            'processImagePath CONTAINS[c] "/Containers/Bundle/Application/" OR senderImagePath CONTAINS[c] "/Containers/Bundle/Application/"',
        ],
    }]);
});

test('Android diagnostics use adb logcat and clamp requested line count', async () => {
    const calls: Array<{ executable: string; args: string[] }> = [];
    const result = await collectRecentDeviceLogs(
        { udid: '127.0.0.1:5555', platform: 'android', kind: 'emulator' },
        { lines: 10_000 },
        async (executable, args) => {
            calls.push({ executable, args });
            return { stdout: 'I/one\nW/two\n' };
        },
    );
    assert.equal(result.source, 'adb');
    assert.deepEqual(calls[0], {
        executable: 'adb',
        args: ['-s', '127.0.0.1:5555', 'logcat', '-d', '-t', '500', '-v', 'brief'],
    });
});

test('physical iPhone diagnostics fail closed without invoking a subprocess', async () => {
    let invoked = false;
    const result = await collectRecentDeviceLogs(
        { udid: 'PHONE-1', platform: 'ios', kind: 'physical' },
        {},
        async () => {
            invoked = true;
            return { stdout: '' };
        },
    );
    assert.equal(invoked, false);
    assert.equal(result.supported, false);
    assert.equal(result.source, 'unavailable');
    assert.match(result.warning ?? '', /Simulator and Android/);
});

test('runtime diagnostics redact common credential patterns and cap long lines', () => {
    const redacted = redactRuntimeLogLine(
        'Authorization: Bearer abc123 token=sensitive password=hunter2 API_KEY=xyz ' + 'x'.repeat(3_000),
    );
    assert.doesNotMatch(redacted, /abc123|sensitive|hunter2|xyz/);
    assert.match(redacted, /Bearer \[REDACTED\]/);
    assert.ok(redacted.length <= 2_000);
});
