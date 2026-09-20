import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('Google emulator packaging is pinned, no-metrics and reconnects ADB persistently', async () => {
    const installer = await readFile(path.join(root, 'deploy', 'setup-google-android-emulator.sh'), 'utf8');
    assert.match(installer, /30-google-x64-no-metrics:30\.1\.2/);
    assert.match(installer, /--device \/dev\/kvm/);
    assert.match(installer, /--restart unless-stopped/);
    assert.match(installer, /127\.0\.0\.1:\$\{adb_port\}:5555/);
    assert.match(installer, /dfarming-android-emulator-connect\.timer/);
    assert.match(installer, /connect 127\.0\.0\.1:\$\{adb_port\}/);
    assert.doesNotMatch(installer, /\s\+\s+--/);
    assert.equal(spawnSync('bash', ['-n', path.join(root, 'deploy', 'setup-google-android-emulator.sh')]).status, 0);
});
