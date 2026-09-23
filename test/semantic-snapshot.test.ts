import assert from 'node:assert/strict';
import test from 'node:test';

import { SemanticSnapshotStore } from '../src/semantic/snapshot.js';

const tree = {
    type: 'XCUIElementTypeApplication', label: 'Demo', rect: { x: 0, y: 0, width: 390, height: 844 }, visible: true,
    children: [
        { type: 'XCUIElementTypeButton', label: 'Continue', rect: { x: 20, y: 100, width: 120, height: 44 }, visible: true, enabled: true },
        { type: 'XCUIElementTypeStaticText', label: 'Welcome', rect: { x: 20, y: 160, width: 100, height: 30 }, visible: true },
        { type: 'XCUIElementTypeTextField', label: 'Email', value: 'Email', rect: { x: 20, y: 210, width: 200, height: 44 }, visible: true },
        { type: 'XCUIElementTypeButton', label: 'Below', rect: { x: 20, y: 900, width: 120, height: 44 }, visible: true },
    ],
};

test('semantic snapshots are compact, ref-addressed, and count offscreen elements', () => {
    const store = new SemanticSnapshotStore();
    const snapshot = store.build('udid-a', tree, { width: 390, height: 844 });
    assert.equal(snapshot.generation, 1);
    assert.equal(snapshot.count, 3);
    assert.equal(snapshot.offscreen, 1);
    assert.match(snapshot.text, /\[e1\].*Continue/);
    assert.equal(store.resolve('udid-a', 1, 'e1').center.x, 80);
    assert.equal(store.find(snapshot, 'email')[0]?.type, 'TextField');
});

test('refs are scoped to device and invalidated by the next generation', () => {
    const store = new SemanticSnapshotStore();
    store.build('udid-a', tree, { width: 390, height: 844 });
    store.build('udid-a', tree, { width: 390, height: 844 });
    assert.throws(() => store.resolve('udid-a', 1, 'e1'), /stale/);
    assert.throws(() => store.resolve('udid-b', 1, 'e1'), /No semantic snapshot/);
});

test('explicit invalidation makes refs stale before the next observation', () => {
    const store = new SemanticSnapshotStore();
    const snapshot = store.build('udid-a', tree, { width: 390, height: 844 });
    assert.equal(store.invalidate('udid-a'), 2);
    assert.throws(() => store.resolve('udid-a', snapshot.generation, 'e1'), /stale/);
    assert.equal(store.build('udid-a', tree, { width: 390, height: 844 }).generation, 3);
});
