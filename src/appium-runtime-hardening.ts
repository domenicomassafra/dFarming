import { cp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { isEntrypoint } from './entrypoint.js';

export const XCUITEST_DRIVER_VERSION = '12.13.1';
export const UIAUTOMATOR2_DRIVER_VERSION = '8.7.0';
export const APPIUM_MORGAN_VERSION = '1.12.1';

interface AppiumHomePackage {
    devDependencies?: Record<string, string>;
    overrides?: Record<string, string>;
    [key: string]: unknown;
}

export function hardenedAppiumHomePackage(input: AppiumHomePackage): AppiumHomePackage {
    const dependencies = { ...(input.devDependencies ?? {}) };
    if ('appium-uiautomator2-driver' in dependencies) {
        dependencies['appium-uiautomator2-driver'] = UIAUTOMATOR2_DRIVER_VERSION;
    }
    if ('appium-xcuitest-driver' in dependencies) {
        dependencies['appium-xcuitest-driver'] = XCUITEST_DRIVER_VERSION;
    }
    return {
        ...input,
        devDependencies: { ...dependencies, morgan: APPIUM_MORGAN_VERSION },
        overrides: {
            ...(input.overrides ?? {}),
            morgan: APPIUM_MORGAN_VERSION,
        },
    };
}

export async function pinAppiumRuntimeHome(
    home = path.resolve(process.env.APPIUM_HOME ?? '.appium-runtime'),
): Promise<void> {
    const packagePath = path.join(home, 'package.json');
    const current = JSON.parse(await readFile(packagePath, 'utf8')) as AppiumHomePackage;
    const dependencies = current.devDependencies ?? {};
    if (!('appium-xcuitest-driver' in dependencies) && !('appium-uiautomator2-driver' in dependencies)) {
        throw new Error('Appium runtime home contains no managed XCUITest or UiAutomator2 driver');
    }
    await writeFile(packagePath, `${JSON.stringify(hardenedAppiumHomePackage(current), null, 2)}\n`, { mode: 0o600 });
}

async function directoriesNamed(root: string, name: string, found: string[] = []): Promise<string[]> {
    for (const entry of await readdir(root, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        const child = path.join(root, entry.name);
        if (entry.name === name) {
            found.push(child);
            continue;
        }
        await directoriesNamed(child, name, found);
    }
    return found;
}

async function packageVersion(file: string): Promise<string> {
    const value = JSON.parse(await readFile(file, 'utf8')) as { version?: unknown };
    if (typeof value.version !== 'string') throw new Error(`Package ${file} has no version`);
    return value.version;
}

export async function hardenAppiumRuntimeHome(home = path.resolve(process.env.APPIUM_HOME ?? '.appium-runtime')): Promise<void> {
    const packagePath = path.join(home, 'package.json');
    const current = JSON.parse(await readFile(packagePath, 'utf8')) as AppiumHomePackage;
    const dependencies = current.devDependencies ?? {};
    const checks: Array<Promise<void>> = [];
    if (dependencies['appium-xcuitest-driver'] !== undefined) {
        checks.push(packageVersion(path.join(home, 'node_modules/appium-xcuitest-driver/package.json')).then((version) => {
            if (version !== XCUITEST_DRIVER_VERSION) {
                throw new Error(`Appium driver version drift: expected XCUITest ${XCUITEST_DRIVER_VERSION}, found ${version}`);
            }
        }));
    }
    if (dependencies['appium-uiautomator2-driver'] !== undefined) {
        checks.push(packageVersion(path.join(home, 'node_modules/appium-uiautomator2-driver/package.json')).then((version) => {
            if (version !== UIAUTOMATOR2_DRIVER_VERSION) {
                throw new Error(`Appium driver version drift: expected UiAutomator2 ${UIAUTOMATOR2_DRIVER_VERSION}, found ${version}`);
            }
        }));
    }
    if (!checks.length) throw new Error('Appium runtime home contains no managed XCUITest or UiAutomator2 driver');
    await Promise.all(checks);
    await pinAppiumRuntimeHome(home);
}

export async function remediateBundledMorgan(home = path.resolve(process.env.APPIUM_HOME ?? '.appium-runtime')): Promise<number> {
    const source = path.join(home, 'node_modules/morgan');
    if (await packageVersion(path.join(source, 'package.json')) !== APPIUM_MORGAN_VERSION) {
        throw new Error(`Appium home morgan must be ${APPIUM_MORGAN_VERSION} before bundled remediation`);
    }
    const lockPath = path.join(home, 'package-lock.json');
    const lock = JSON.parse(await readFile(lockPath, 'utf8')) as {
        packages?: Record<string, { dependencies?: Record<string, string>; [key: string]: unknown }>;
    };
    const packages = lock.packages;
    if (!packages?.['node_modules/morgan']) throw new Error('Appium package lock is missing the canonical morgan entry');
    const sourceLock = packages['node_modules/morgan'];
    if (packages['']) {
        packages[''].devDependencies = {
            ...(packages[''].devDependencies ?? {}), morgan: APPIUM_MORGAN_VERSION,
        };
    }

    let remediated = 0;
    for (const driver of ['appium-xcuitest-driver', 'appium-uiautomator2-driver']) {
        const driverRoot = path.join(home, 'node_modules', driver);
        let driverVersion: string;
        try { driverVersion = await packageVersion(path.join(driverRoot, 'package.json')); }
        catch { continue; }
        if (driver === 'appium-xcuitest-driver' && driverVersion !== XCUITEST_DRIVER_VERSION) {
            throw new Error(`Appium driver version drift: expected XCUITest ${XCUITEST_DRIVER_VERSION}, found ${driverVersion}`);
        }
        if (driver === 'appium-uiautomator2-driver' && driverVersion !== UIAUTOMATOR2_DRIVER_VERSION) {
            throw new Error(`Appium driver version drift: expected UiAutomator2 ${UIAUTOMATOR2_DRIVER_VERSION}, found ${driverVersion}`);
        }

        for (const baseDriver of await directoriesNamed(driverRoot, 'base-driver')) {
            if (path.basename(path.dirname(baseDriver)) !== '@appium') continue;
            const packagePath = path.join(baseDriver, 'package.json');
            const value = JSON.parse(await readFile(packagePath, 'utf8')) as AppiumHomePackage & { dependencies?: Record<string, string> };
            if (value.dependencies?.morgan !== APPIUM_MORGAN_VERSION) {
                value.dependencies = { ...(value.dependencies ?? {}), morgan: APPIUM_MORGAN_VERSION };
                await writeFile(packagePath, `${JSON.stringify(value, null, 2)}\n`);
            }
        }

        for (const morganDirectory of await directoriesNamed(driverRoot, 'morgan')) {
            const installed = await packageVersion(path.join(morganDirectory, 'package.json'));
            if (installed === APPIUM_MORGAN_VERSION) continue;
            await rm(morganDirectory, { recursive: true, force: true });
            await cp(source, morganDirectory, { recursive: true });
            remediated += 1;
        }

        const keyPrefix = `node_modules/${driver}/`;
        for (const [key, value] of Object.entries(packages)) {
            if (!key.startsWith(keyPrefix)) continue;
            if (key.endsWith('/node_modules/morgan')) {
                const { peer: _peer, ...canonical } = sourceLock as Record<string, unknown>;
                packages[key] = { ...canonical, dev: true, inBundle: true };
            }
            if (key.endsWith('/node_modules/@appium/base-driver') && value.dependencies) {
                value.dependencies.morgan = APPIUM_MORGAN_VERSION;
            }
        }
    }
    await writeFile(lockPath, `${JSON.stringify(lock, null, 2)}\n`, { mode: 0o600 });
    return remediated;
}

if (isEntrypoint(import.meta.url)) {
    const action = process.argv[2] ?? 'prepare';
    if (action === 'prepare') {
        await hardenAppiumRuntimeHome();
        console.log(`Pinned Appium runtime drivers and morgan ${APPIUM_MORGAN_VERSION} override`);
    } else if (action === 'sync') {
        await pinAppiumRuntimeHome();
        console.log(`Prepared Appium runtime driver synchronization with morgan ${APPIUM_MORGAN_VERSION} override`);
    } else if (action === 'repair') {
        const remediated = await remediateBundledMorgan();
        console.log(`Remediated ${remediated} bundled morgan cop${remediated === 1 ? 'y' : 'ies'} to ${APPIUM_MORGAN_VERSION}`);
    } else {
        throw new Error('Usage: appium-runtime-hardening <prepare|sync|repair>');
    }
}
