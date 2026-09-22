import assert from 'node:assert/strict';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { renderLaunchAgent, renderLaunchAgents, serviceSpecs, servicesForRole } from '../src/service.js';

test('launchd supervision uses one process per farm responsibility and no shell wrapper', () => {
    const specs = serviceSpecs('/tmp/phone-farm', '/usr/local/bin/node');
    assert.equal(Object.keys(specs).length, 6);
    assert.match(specs.appium.args.join(' '), /node_modules\/appium-runtime\/index\.js/);
    assert.match(specs.appium.args.join(' '), /4725/);
    assert.equal(specs.appium.env?.APPIUM_HOME, '/tmp/phone-farm/.appium-runtime');
    assert.match(specs['appium-runtime'].args.join(' '), /node_modules\/appium-runtime\/index\.js/);
    assert.match(specs['appium-runtime'].args.join(' '), /4726/);
    assert.match(specs.appium.args.join(' '), /--log-level warn/);
    assert.match(specs['appium-runtime'].args.join(' '), /--log-level warn/);
    assert.match(specs.wda.args.join(' '), /wda-service\.ts/);
    assert.match(specs.worker.args.join(' '), /scheduler\/worker\.ts/);
    assert.match(specs['device-worker'].args.join(' '), /device-worker-server\.ts/);
    assert.match(specs.web.args.join(' '), /api\/server\.ts/);
    assert.equal(specs.worker.args.at(-1), '/tmp/phone-farm/src/scheduler/worker.ts');
    assert.equal(specs['device-worker'].args.at(-1), '/tmp/phone-farm/src/device-worker-server.ts');
    assert.equal(specs['appium-runtime'].args[1], '/tmp/phone-farm/node_modules/appium-runtime/index.js');

    const plist = renderLaunchAgent('web', '/tmp/phone&farm', '/usr/local/bin/node', '/Users/test');
    assert.match(plist, /com\.phone-farm\.web/);
    assert.match(plist, /\/tmp\/phone&amp;farm/);
    assert.doesNotMatch(plist, /\/bin\/sh/);
    assert.doesNotMatch(plist, /<key>ProcessType<\/key>/);
});

test('device-worker launchd role excludes the web control plane', () => {
    assert.deepEqual(servicesForRole('device-worker'), ['appium', 'appium-runtime', 'wda', 'worker', 'device-worker']);
    assert.deepEqual(servicesForRole('device-worker', false), ['appium-runtime', 'worker', 'device-worker']);
    assert.deepEqual(servicesForRole('control-plane'), []);
});

test('rendering a simulator-only worker removes stale physical launch agents', async (context) => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'phone-farm-launchd-'));
    context.after(() => rm(directory, { recursive: true, force: true }));

    await renderLaunchAgents(directory, servicesForRole('device-worker', true));
    assert.ok((await readdir(directory)).includes('com.phone-farm.wda.plist'));

    await renderLaunchAgents(directory, servicesForRole('device-worker', false));
    assert.deepEqual((await readdir(directory)).sort(), [
        'com.phone-farm.appium-runtime.plist',
        'com.phone-farm.device-worker.plist',
        'com.phone-farm.worker.plist',
    ]);
});
