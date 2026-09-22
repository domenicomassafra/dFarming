import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { executionDeviceAvailable, runPluginProcess } from '../src/scheduler/executor.js';

test('Appium execution requires the registered runtime to be actually connected', async () => {
    const registered = {
        name: 'Simulator', udid: 'SIM-OFFLINE', platform: 'ios' as const, kind: 'simulator' as const,
        automationBackend: 'appium' as const, pluginData: {},
    };
    assert.equal(await executionDeviceAvailable(registered, async () => []), undefined);
    const connected = await executionDeviceAvailable(registered, async () => [{
        name: 'Simulator', udid: 'SIM-OFFLINE', osVersion: '26.0', platform: 'ios', kind: 'simulator',
    }]);
    assert.equal(connected?.udid, 'SIM-OFFLINE');
});

test('plugin subprocess cancellation escalates when SIGTERM is ignored', async (context) => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'dfarming-child-stop-'));
    context.after(() => rm(directory, { recursive: true, force: true }));
    const script = path.join(directory, 'ignore-term.js');
    await writeFile(script, [
        "process.on('SIGTERM', () => {});",
        'setInterval(() => {}, 1000);',
    ].join('\n'));
    const controller = new AbortController();
    const startedAt = Date.now();
    const running = runPluginProcess({ entrypoint: script }, process.env, controller.signal, async () => {}, 75);
    await new Promise((resolve) => setTimeout(resolve, 250));
    controller.abort(new Error('test stop'));
    const result = await running;
    assert.equal(result.stopped, true);
    assert.match(result.error ?? '', /SIGKILL|SIGTERM/);
    assert.ok(Date.now() - startedAt < 2_000, 'cancelled child must not hang indefinitely');
});
