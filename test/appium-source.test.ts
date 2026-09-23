import assert from 'node:assert/strict';
import test from 'node:test';

import { normalizeAppiumPageSource } from '../src/semantic/appium-source.js';
import { SemanticSnapshotStore } from '../src/semantic/snapshot.js';

test('normalizes Android UiAutomator XML into semantic refs', () => {
    const tree = normalizeAppiumPageSource(`<?xml version="1.0" encoding="UTF-8"?>
      <hierarchy rotation="0">
        <android.widget.FrameLayout class="android.widget.FrameLayout" bounds="[0,0][1080,2400]" enabled="true">
          <android.widget.Button class="android.widget.Button" resource-id="com.example:id/continue" text="Continue" clickable="true" enabled="true" bounds="[60,300][420,450]" />
          <android.widget.EditText class="android.widget.EditText" text="Email" enabled="true" bounds="[60,500][900,650]" />
        </android.widget.FrameLayout>
      </hierarchy>`);
    const snapshot = new SemanticSnapshotStore().build('android-1', tree, { width: 1080, height: 2400 });
    assert.equal(snapshot.count, 2);
    assert.match(snapshot.text, /Button.*Continue/);
    assert.equal(snapshot.elements[0]?.identifier, 'com.example:id/continue');
    const identifierSnapshot = new SemanticSnapshotStore().build(
        'android-ids', tree, { width: 1080, height: 2400 }, { query: 'com.example:id/continue' },
    );
    assert.equal(identifierSnapshot.count, 1);
    assert.equal(snapshot.elements[1]?.type, 'TextField');
});

test('normalizes XCUITest XML attributes into the same semantic model', () => {
    const tree = normalizeAppiumPageSource(`<AppiumAUT type="XCUIElementTypeApplication" x="0" y="0" width="390" height="844">
      <XCUIElementTypeButton type="XCUIElementTypeButton" name="done_button" label="Done" enabled="true" visible="true" x="20" y="50" width="80" height="44" />
    </AppiumAUT>`);
    const snapshot = new SemanticSnapshotStore().build('sim-1', tree, { width: 390, height: 844 });
    assert.equal(snapshot.count, 1);
    assert.equal(snapshot.elements[0]?.label, 'Done');
    assert.equal(snapshot.elements[0]?.identifier, 'done_button');
});
