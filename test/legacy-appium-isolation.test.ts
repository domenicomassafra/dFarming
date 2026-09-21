import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('legacy Appium 2 is isolated from the root worker dependency graph', async () => {
    const root = JSON.parse(await readFile('package.json', 'utf8')) as {
        devDependencies?: Record<string, string>;
        scripts?: Record<string, string>;
    };
    const legacy = JSON.parse(await readFile('toolchains/legacy-ios-appium/package.json', 'utf8')) as {
        dependencies?: Record<string, string>;
    };
    const installer = await readFile('deploy/setup-device-worker.sh', 'utf8');

    assert.equal(root.devDependencies?.appium, undefined);
    assert.equal(root.devDependencies?.['appium-runtime'], 'npm:appium@^3.7.0');
    assert.equal(legacy.dependencies?.appium, '2.19.0');
    assert.match(root.scripts?.appium ?? '', /toolchains\/legacy-ios-appium\/node_modules\/appium\/index\.js/);
    assert.match(installer, /if \[\[ "\$physical_ios_enabled" != "false" \]\]; then[\s\S]*npm run appium:legacy:install/);
});
