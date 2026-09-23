import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
    APPIUM_MORGAN_VERSION,
    hardenAppiumRuntimeHome,
    hardenedAppiumHomePackage,
    invalidateAppiumExtensionCache,
    pinAppiumRuntimeHome,
    remediateBundledMorgan,
    UIAUTOMATOR2_DRIVER_VERSION,
    XCUITEST_DRIVER_VERSION,
} from '../src/appium-runtime-hardening.js';

test('Appium home hardening pins both drivers and the bounded morgan remediation', () => {
    assert.deepEqual(hardenedAppiumHomePackage({
        devDependencies: {
            other: '1.0.0',
            'appium-uiautomator2-driver': '^8.7.0',
            'appium-xcuitest-driver': '^12.13.1',
        },
    }), {
        devDependencies: {
            other: '1.0.0',
            'appium-uiautomator2-driver': UIAUTOMATOR2_DRIVER_VERSION,
            'appium-xcuitest-driver': XCUITEST_DRIVER_VERSION,
            morgan: APPIUM_MORGAN_VERSION,
        },
        overrides: { morgan: APPIUM_MORGAN_VERSION },
    });
});

test('Appium home hardening refuses driver drift before rewriting the manifest', async (context) => {
    const home = await mkdtemp(path.join(os.tmpdir(), 'dfarming-appium-home-'));
    context.after(() => rm(home, { recursive: true, force: true }));
    await mkdir(path.join(home, 'node_modules/appium-xcuitest-driver'), { recursive: true });
    await mkdir(path.join(home, 'node_modules/appium-uiautomator2-driver'), { recursive: true });
    await writeFile(path.join(home, 'package.json'), JSON.stringify({
        devDependencies: {
            'appium-uiautomator2-driver': UIAUTOMATOR2_DRIVER_VERSION,
            'appium-xcuitest-driver': XCUITEST_DRIVER_VERSION,
        },
    }));
    await writeFile(path.join(home, 'node_modules/appium-xcuitest-driver/package.json'), JSON.stringify({ version: '99.0.0' }));
    await writeFile(path.join(home, 'node_modules/appium-uiautomator2-driver/package.json'), JSON.stringify({ version: UIAUTOMATOR2_DRIVER_VERSION }));
    await assert.rejects(() => hardenAppiumRuntimeHome(home), /version drift/);
    assert.doesNotMatch(await readFile(path.join(home, 'package.json'), 'utf8'), /overrides/);
});

test('Appium runtime synchronization can advance a stale declared driver pin before install', async (context) => {
    const home = await mkdtemp(path.join(os.tmpdir(), 'dfarming-appium-sync-'));
    context.after(() => rm(home, { recursive: true, force: true }));
    await writeFile(path.join(home, 'package.json'), JSON.stringify({
        devDependencies: { 'appium-uiautomator2-driver': '8.6.4' },
    }));
    await pinAppiumRuntimeHome(home);
    const manifest = JSON.parse(await readFile(path.join(home, 'package.json'), 'utf8'));
    assert.equal(manifest.devDependencies['appium-uiautomator2-driver'], UIAUTOMATOR2_DRIVER_VERSION);
    assert.equal(manifest.devDependencies.morgan, APPIUM_MORGAN_VERSION);
    assert.equal(manifest.devDependencies['appium-xcuitest-driver'], undefined);
});

test('Appium runtime repair invalidates stale extension metadata after a driver upgrade', async (context) => {
    const home = await mkdtemp(path.join(os.tmpdir(), 'dfarming-appium-cache-'));
    context.after(() => rm(home, { recursive: true, force: true }));
    const cache = path.join(home, 'node_modules', '.cache', 'appium');
    await mkdir(cache, { recursive: true });
    await writeFile(path.join(cache, 'extensions.yaml'), 'version: 8.6.4\n');
    await invalidateAppiumExtensionCache(home);
    await assert.rejects(() => readFile(path.join(cache, 'extensions.yaml'), 'utf8'), /ENOENT/);
});

test('Android-only Appium homes are hardened without adding the Apple driver', () => {
    assert.deepEqual(hardenedAppiumHomePackage({
        devDependencies: { 'appium-uiautomator2-driver': '^8.7.0' },
    }), {
        devDependencies: {
            'appium-uiautomator2-driver': UIAUTOMATOR2_DRIVER_VERSION,
            morgan: APPIUM_MORGAN_VERSION,
        },
        overrides: { morgan: APPIUM_MORGAN_VERSION },
    });
});

test('bundled Appium base-driver morgan copies are remediated without changing driver versions', async (context) => {
    const home = await mkdtemp(path.join(os.tmpdir(), 'dfarming-appium-bundle-'));
    context.after(() => rm(home, { recursive: true, force: true }));
    const source = path.join(home, 'node_modules', 'morgan');
    const driver = path.join(home, 'node_modules', 'appium-xcuitest-driver');
    const base = path.join(driver, 'node_modules', '@appium', 'base-driver');
    const bundled = path.join(driver, 'node_modules', 'morgan');
    await mkdir(source, { recursive: true });
    await mkdir(base, { recursive: true });
    await mkdir(bundled, { recursive: true });
    await writeFile(path.join(source, 'package.json'), JSON.stringify({ version: APPIUM_MORGAN_VERSION }));
    await writeFile(path.join(source, 'index.js'), 'secure');
    await writeFile(path.join(driver, 'package.json'), JSON.stringify({ version: XCUITEST_DRIVER_VERSION }));
    await writeFile(path.join(base, 'package.json'), JSON.stringify({ version: '10.8.0', dependencies: { morgan: '1.11.0' } }));
    await writeFile(path.join(bundled, 'package.json'), JSON.stringify({ version: '1.11.0' }));
    await writeFile(path.join(home, 'package-lock.json'), JSON.stringify({
        lockfileVersion: 3,
        packages: {
            '': { devDependencies: { 'appium-xcuitest-driver': XCUITEST_DRIVER_VERSION } },
            'node_modules/morgan': { version: APPIUM_MORGAN_VERSION, integrity: 'sha512-test', dev: true },
            'node_modules/appium-xcuitest-driver/node_modules/morgan': { version: '1.11.0', dev: true, inBundle: true },
            'node_modules/appium-xcuitest-driver/node_modules/@appium/base-driver': { dependencies: { morgan: '1.11.0' } },
        },
    }));
    assert.equal(await remediateBundledMorgan(home), 1);
    assert.equal(JSON.parse(await readFile(path.join(bundled, 'package.json'), 'utf8')).version, APPIUM_MORGAN_VERSION);
    assert.equal(JSON.parse(await readFile(path.join(base, 'package.json'), 'utf8')).dependencies.morgan, APPIUM_MORGAN_VERSION);
    const lock = JSON.parse(await readFile(path.join(home, 'package-lock.json'), 'utf8'));
    assert.equal(lock.packages['node_modules/appium-xcuitest-driver/node_modules/morgan'].version, APPIUM_MORGAN_VERSION);
    assert.equal(lock.packages['node_modules/appium-xcuitest-driver/node_modules/@appium/base-driver'].dependencies.morgan, APPIUM_MORGAN_VERSION);
});
