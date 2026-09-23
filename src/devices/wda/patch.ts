import { execFile } from 'node:child_process';
import crypto from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { isEntrypoint } from '../../entrypoint.js';

const execFileAsync = promisify(execFile);
const packageRoot = fileURLToPath(new URL('../../../', import.meta.url));
const manifestPath = path.join(packageRoot, 'Patches/appium-webdriveragent-16.12.9-dfarming.json');

interface WdaPatchManifest {
    schemaVersion: 1;
    xcuitestDriverVersion: string;
    webDriverAgentVersion: string;
    patchFile: string;
    patchSha256: string;
}

async function jsonFile<T>(file: string): Promise<T> {
    return JSON.parse(await readFile(file, 'utf8')) as T;
}

export function defaultXcuitestDriverPath(root = process.cwd()): string {
    return path.resolve(root, '.appium-runtime/node_modules/appium-xcuitest-driver');
}

export async function ensureWdaCustomizations(options: {
    driverPath?: string;
    root?: string;
} = {}): Promise<{ driverVersion: string; wdaVersion: string; alreadyApplied: boolean }> {
    const root = options.root ?? process.cwd();
    const driverPath = path.resolve(options.driverPath ?? process.env.XCUITEST_DRIVER_PATH ?? defaultXcuitestDriverPath(root));
    const wdaRoot = path.join(driverPath, 'node_modules/appium-webdriveragent');
    const manifest = await jsonFile<WdaPatchManifest>(manifestPath);
    if (manifest.schemaVersion !== 1) throw new Error(`Unsupported WDA patch manifest schema ${manifest.schemaVersion}`);

    const driverPackage = await jsonFile<{ version: string }>(path.join(driverPath, 'package.json'));
    const wdaPackage = await jsonFile<{ version: string }>(path.join(wdaRoot, 'package.json'));
    if (driverPackage.version !== manifest.xcuitestDriverVersion || wdaPackage.version !== manifest.webDriverAgentVersion) {
        throw new Error(
            `WDA customization version mismatch: expected XCUITest ${manifest.xcuitestDriverVersion} / WDA ${manifest.webDriverAgentVersion}, `
            + `found ${driverPackage.version} / ${wdaPackage.version}. Review and port the patch before changing the pinned driver.`,
        );
    }

    const patchPath = path.join(packageRoot, manifest.patchFile);
    const patchBytes = await readFile(patchPath);
    const patchSha256 = crypto.createHash('sha256').update(patchBytes).digest('hex');
    if (patchSha256 !== manifest.patchSha256) {
        throw new Error(`WDA patch checksum mismatch: expected ${manifest.patchSha256}, got ${patchSha256}`);
    }

    const touchPath = path.join(wdaRoot, 'WebDriverAgentLib/Commands/FBTouchActionCommands.m');
    const customPath = path.join(wdaRoot, 'WebDriverAgentLib/Commands/FBCustomCommands.m');
    const plistPath = path.join(wdaRoot, 'WebDriverAgentRunner/Info.plist');
    const [touch, custom, plist] = await Promise.all([
        readFile(touchPath, 'utf8'), readFile(customPath, 'utf8'), readFile(plistPath, 'utf8'),
    ]);
    const markers = [
        touch.includes('/wda/absolute-actions') && touch.includes('/wda/import-media') && touch.includes('FBImportMedia'),
        custom.includes('[[FBRoute POST:@"/wda/pressButton"].withoutSession'),
        plist.includes('NSPhotoLibraryAddUsageDescription'),
    ];
    if (markers.every(Boolean)) {
        return { driverVersion: driverPackage.version, wdaVersion: wdaPackage.version, alreadyApplied: true };
    }
    if (markers.some(Boolean)) {
        throw new Error('WDA customization is only partially applied. Reinstall the pinned XCUITest driver, then run wda:patch again.');
    }

    try {
        await execFileAsync('/usr/bin/patch', ['-p1', '--forward', '--batch', '-i', patchPath], {
            cwd: wdaRoot,
            timeout: 30_000,
            maxBuffer: 2 * 1024 * 1024,
        });
    } catch (error) {
        const detail = error as Error & { stdout?: string; stderr?: string };
        throw new Error(`Unable to apply the reviewed WDA patch: ${detail.stderr?.trim() || detail.stdout?.trim() || detail.message}`);
    }

    const [patchedTouch, patchedCustom, patchedPlist] = await Promise.all([
        readFile(touchPath, 'utf8'), readFile(customPath, 'utf8'), readFile(plistPath, 'utf8'),
    ]);
    if (!patchedTouch.includes('/wda/absolute-actions') || !patchedTouch.includes('/wda/import-media')
        || !patchedCustom.includes('[[FBRoute POST:@"/wda/pressButton"].withoutSession')
        || !patchedPlist.includes('NSPhotoLibraryAddUsageDescription')) {
        throw new Error('WDA patch command returned but required customization markers are incomplete');
    }
    return { driverVersion: driverPackage.version, wdaVersion: wdaPackage.version, alreadyApplied: false };
}

async function main(): Promise<void> {
    const result = await ensureWdaCustomizations();
    console.log(`WDA customizations ${result.alreadyApplied ? 'already applied' : 'applied'} (XCUITest ${result.driverVersion}, WDA ${result.wdaVersion})`);
}

if (isEntrypoint(import.meta.url)) await main();
