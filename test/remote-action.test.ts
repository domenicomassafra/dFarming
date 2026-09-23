import assert from 'node:assert/strict';
import test from 'node:test';

import { parseRemoteAction } from '../src/devices/remote-action.js';

test('remote actions accept the bounded cross-platform action vocabulary', () => {
    assert.deepEqual(parseRemoteAction({ type: 'tap', x: 12, y: 34 }), { type: 'tap', x: 12, y: 34 });
    assert.deepEqual(parseRemoteAction({ type: 'orientation', orientation: 'landscape' }), {
        type: 'orientation', orientation: 'landscape',
    });
    assert.deepEqual(parseRemoteAction({ type: 'launch', appId: 'com.example.app' }), {
        type: 'launch', appId: 'com.example.app',
    });
    assert.deepEqual(parseRemoteAction({ type: 'home' }), { type: 'home' });
});

test('remote actions fail closed for unknown types and malformed arguments', () => {
    assert.throws(() => parseRemoteAction({ type: 'shell', command: 'id' }), /Unsupported remote action/);
    assert.throws(() => parseRemoteAction({ type: 'orientation', orientation: 'upside-down' }), /orientation/);
    assert.throws(() => parseRemoteAction({ type: 'launch', appId: '../bad' }), /appId/);
    assert.throws(() => parseRemoteAction({ type: 'type', text: '' }), /1 to 4000/);
    assert.throws(() => parseRemoteAction({ type: 'swipe', startX: 0, startY: 0, endX: 1, endY: 1, durationMs: 1 }), /durationMs/);
});
