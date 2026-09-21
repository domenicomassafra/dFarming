import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('optional legacy and schema CLIs are isolated from the root worker dependency graph', async () => {
    const root = JSON.parse(await readFile('package.json', 'utf8')) as {
        devDependencies?: Record<string, string>;
        scripts?: Record<string, string>;
    };
    const legacy = JSON.parse(await readFile('toolchains/legacy-ios-appium/package.json', 'utf8')) as {
        dependencies?: Record<string, string>;
    };
    const database = JSON.parse(await readFile('toolchains/db-schema/package.json', 'utf8')) as {
        dependencies?: Record<string, string>;
    };
    const installer = await readFile('deploy/setup-device-worker.sh', 'utf8');

    assert.equal(root.devDependencies?.appium, undefined);
    assert.equal(root.devDependencies?.['drizzle-kit'], undefined);
    assert.equal(root.devDependencies?.['appium-runtime'], 'npm:appium@^3.7.0');
    assert.equal(legacy.dependencies?.appium, '2.19.0');
    assert.equal(database.dependencies?.['drizzle-kit'], '0.31.10');
    assert.match(root.scripts?.appium ?? '', /toolchains\/legacy-ios-appium\/node_modules\/appium\/index\.js/);
    assert.match(root.scripts?.['db:generate'] ?? '', /toolchains\/db-schema\/node_modules\/drizzle-kit\/bin\.cjs/);
    assert.match(installer, /if \[\[ "\$physical_ios_enabled" != "false" \]\]; then[\s\S]*npm run appium:legacy:install/);
});
