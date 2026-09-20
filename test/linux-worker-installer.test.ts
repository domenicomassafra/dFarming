import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('Linux Android worker pins Appium home and waits for service readiness', async () => {
    const installer = await readFile(path.join(root, 'deploy', 'setup-linux-android-worker.sh'), 'utf8');
    assert.match(installer, /Environment=APPIUM_HOME=\$repo\/\.appium-runtime/);
    assert.equal((installer.match(/EnvironmentFile=-\$repo\/\.env\n/g) ?? []).length, 3);
    assert.equal((installer.match(/EnvironmentFile=-\$repo\/\.env\.devices\n/g) ?? []).length, 3);
    assert.doesNotMatch(installer, /ExecStart=.*--env-file-if-exists/);
    assert.match(installer, /wait_for_http "Appium runtime"/);
    assert.match(installer, /wait_for_http "Device worker"/);
    assert.doesNotMatch(installer, /curl -fsS[^\n]+3010[^\n]*\n(?:echo|$)/);
});
