import assert from 'node:assert/strict';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { renderLaunchAgent, renderLaunchAgents, serviceSpecs, servicesForRole } from '../src/service.js';

test('launchd supervision uses one process per farm responsibility and no shell wrapper', () => {
    const specs = serviceSpecs('/tmp/dfarming', '/usr/local/bin/node');
    assert.equal(Object.keys(specs).length, 6);
    assert.match(specs.appium.args.join(' '), /node_modules\/appium-runtime\/index\.js/);
    assert.match(specs.appium.args.join(' '), /4725/);
    assert.equal(specs.appium.env?.APPIUM_HOME, '/tmp/dfarming/.appium-runtime');
    assert.match(specs['appium-runtime'].args.join(' '), /node_modules\/appium-runtime\/index\.js/);
    assert.match(specs['appium-runtime'].args.join(' '), /4726/);
    assert.match(specs.appium.args.join(' '), /--log-level warn/);
    assert.match(specs['appium-runtime'].args.join(' '), /--log-level warn/);
    assert.match(specs.wda.args.join(' '), /wda-service\.ts/);
    assert.match(specs.worker.args.join(' '), /scheduler\/worker\.ts/);
    assert.match(specs['device-worker'].args.join(' '), /device-worker-server\.ts/);
    assert.match(specs.web.args.join(' '), /api\/server\.ts/);
    assert.equal(specs.worker.args.at(-1), '/tmp/dfarming/src/scheduler/worker.ts');
    assert.equal(specs['device-worker'].args.at(-1), '/tmp/dfarming/src/device-worker-server.ts');
    assert.equal(specs['appium-runtime'].args[1], '/tmp/dfarming/node_modules/appium-runtime/index.js');

    const plist = renderLaunchAgent('web', '/tmp/dfarming&farm', '/usr/local/bin/node', '/Users/test');
    assert.match(plist, /com\.dfarming\.web/);
    assert.match(plist, /\/tmp\/dfarming&amp;farm/);
    assert.doesNotMatch(plist, /\/bin\/sh/);
    assert.doesNotMatch(plist, /<key>ProcessType<\/key>/);
});

test('device-worker launchd role excludes the web control plane', () => {
    assert.deepEqual(servicesForRole('device-worker'), ['appium', 'appium-runtime', 'wda', 'worker', 'device-worker']);
    assert.deepEqual(servicesForRole('device-worker', false), ['appium-runtime', 'worker', 'device-worker']);
    assert.deepEqual(servicesForRole('control-plane'), []);
});

test('rendering a simulator-only worker removes stale physical launch agents', async (context) => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'dfarming-launchd-'));
    context.after(() => rm(directory, { recursive: true, force: true }));

    await renderLaunchAgents(directory, servicesForRole('device-worker', true));
    assert.ok((await readdir(directory)).includes('com.dfarming.wda.plist'));

    await renderLaunchAgents(directory, servicesForRole('device-worker', false));
    assert.deepEqual((await readdir(directory)).sort(), [
        'com.dfarming.appium-runtime.plist',
        'com.dfarming.device-worker.plist',
        'com.dfarming.worker.plist',
    ]);
});
