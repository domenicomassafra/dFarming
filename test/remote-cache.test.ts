import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

test('RegistryWdaRemoteControl caches a client per device and forget() rebuilds it', async () => {
    const configPath = path.join(await mkdtemp(path.join(os.tmpdir(), 'pf-remote-')), 'devices.json');
    process.env.DEVICES_CONFIG_PATH = configPath;
    const write = (passcode: string) => writeFile(configPath, JSON.stringify([
        { name: 'Phone', udid: 'u1', passcode, wdaLocalPort: 8100, mjpegLocalPort: 9100, pluginData: {} },
    ]));

    await write('1111');
    const { RegistryWdaRemoteControl } = await import('../src/devices/registry-remote.js');
    const remote = new RegistryWdaRemoteControl();

    const first = await remote.control('u1');
    assert.equal(await remote.control('u1'), first, 'same instance while cached');
    assert.equal(first.passcode, '1111');

    await write('2222');
    assert.equal(await remote.control('u1'), first, 'still the stale instance until forgotten');

    remote.forget('u1');
    const rebuilt = await remote.control('u1');
    assert.notEqual(rebuilt, first, 'rebuilt after forget()');
    assert.equal(rebuilt.passcode, '2222', 'picks up the new passcode');
});

test('RegistryWdaRemoteControl coalesces concurrent client construction per device', async () => {
    const configPath = path.join(await mkdtemp(path.join(os.tmpdir(), 'pf-remote-race-')), 'devices.json');
    process.env.DEVICES_CONFIG_PATH = configPath;
    await writeFile(configPath, JSON.stringify([
        { name: 'Phone', udid: 'race-1', passcode: '1111', wdaLocalPort: 8100, mjpegLocalPort: 9100, pluginData: {} },
    ]));

    const { RegistryWdaRemoteControl } = await import('../src/devices/registry-remote.js');
    const remote = new RegistryWdaRemoteControl();
    const controls = await Promise.all(Array.from({ length: 20 }, () => remote.control('race-1')));

    assert.equal(new Set(controls).size, 1, 'concurrent requests share one cached transport client');
});
