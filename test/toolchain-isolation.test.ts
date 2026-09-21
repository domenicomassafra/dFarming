import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('runtime and schema toolchains stay explicit without the retired Appium 2 tree', async () => {
    const root = JSON.parse(await readFile('package.json', 'utf8')) as {
        dependencies?: Record<string, string>;
        devDependencies?: Record<string, string>;
        scripts?: Record<string, string>;
    };
    const database = JSON.parse(await readFile('toolchains/db-schema/package.json', 'utf8')) as {
        dependencies?: Record<string, string>;
        overrides?: Record<string, string>;
    };
    const installer = await readFile('deploy/setup-device-worker.sh', 'utf8');

    assert.equal(root.devDependencies?.appium, undefined);
    assert.equal(root.devDependencies?.['drizzle-kit'], undefined);
    assert.equal(root.dependencies?.['node-native-ocr'], undefined);
    assert.equal(root.devDependencies?.['appium-runtime'], 'npm:appium@^3.7.0');
    assert.equal(root.devDependencies?.['node-native-ocr'], '^0.4.18');
    assert.equal(database.dependencies?.['drizzle-kit'], '0.31.10');
    assert.equal(database.overrides?.esbuild, '0.25.12');
    assert.match(root.scripts?.appium ?? '', /node_modules\/appium-runtime\/index\.js/);
    assert.match(root.scripts?.appium ?? '', /\.appium-runtime/);
    assert.match(root.scripts?.['appium:runtime:harden'] ?? '', /appium-runtime-hardening\.ts repair/);
    assert.match(root.scripts?.['appium:runtime:harden'] ?? '', /audit:appium-runtime/);
    assert.match(root.scripts?.['audit:appium-runtime'] ?? '', /--audit-level=low/);
    assert.match(root.scripts?.['db:generate'] ?? '', /toolchains\/db-schema\/node_modules\/drizzle-kit\/bin\.cjs/);
    assert.match(installer, /npm run wda:patch/);
    assert.doesNotMatch(installer, /appium:legacy:install|legacy-ios-appium|\.appium2/);
    assert.equal(root.scripts?.['appium:legacy:install'], undefined);
    assert.equal(root.scripts?.['audit:legacy-ios'], undefined);
});
