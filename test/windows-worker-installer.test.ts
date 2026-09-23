import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('Windows Android packaging reuses canonical worker processes and Task Scheduler', async () => {
    const installer = await readFile(path.join(root, 'deploy', 'setup-windows-android-worker.ps1'), 'utf8');
    assert.match(installer, /src\\scheduler\\worker\.ts/);
    assert.match(installer, /src\\device-worker-server\.ts/);
    assert.match(installer, /node_modules\\appium-runtime\\index\.js/);
    assert.match(installer, /Register-ScheduledTask/);
    assert.match(installer, /New-ScheduledTaskTrigger -AtLogOn/);
    assert.match(installer, /DFARMING_DEVICE_WORKER_TOKEN/);
    assert.match(installer, /DFARMING_CONTROL_PLANE_URL/);
    assert.match(installer, /DATABASE_URL/);
    assert.match(installer, /doctor:device-worker/);
    assert.match(installer, /appium:runtime:sync/);
    assert.match(installer, /Wait-Http 'Appium runtime'/);
    assert.match(installer, /Wait-Http 'Device worker'/);
    assert.match(installer, /\$env:OS -ne 'Windows_NT'/);
    assert.doesNotMatch(installer, /\$IsWindows/);
    assert.match(installer, /\$env:ANDROID_HOME = \$androidRoot/);
    assert.doesNotMatch(installer, /Invoke-Expression|iex\b/i);
    assert.doesNotMatch(installer, /DFARMING_ROLE=control-plane/);
});
