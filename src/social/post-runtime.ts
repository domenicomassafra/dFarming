import { readFile } from 'node:fs/promises';

import type { Browser } from '../devices/appium-driver.js';
import type { WdaRemoteControl } from '../devices/wda-remote.js';
import { tapCoordinate } from './actions.js';
import { isRedCheckboxChecked } from './pixel.js';

export interface ImportablePostManifest {
    files: Array<{ name: string; path: string; mimeType: string }>;
}

export function positiveInteger(name: string, fallback: number): number {
    const raw = process.env[name] ?? String(fallback);
    const value = Number.parseInt(raw, 10);
    if (!Number.isSafeInteger(value) || value <= 0) {
        throw new Error(`${name} must be a positive integer`);
    }
    return value;
}

export async function importWdaMedia(
    manifest: ImportablePostManifest,
    options: { platformLabel: string; settleMs: number; wdaUrl?: string },
): Promise<number> {
    const wdaUrl = options.wdaUrl ?? process.env.WDA_URL ?? 'http://127.0.0.1:8100';
    let assetCount = 0;

    // Photos Recents is newest-first. Reverse import makes cell 0 the user's first item.
    for (const [index, file] of [...manifest.files].reverse().entries()) {
        console.log(`Importing media ${manifest.files.length - index}/${manifest.files.length}: ${file.name}`);
        const data = await readFile(file.path);
        // /wda/import-media base64-encodes the whole file into JSON. Refuse well
        // below Node's maximum string size to avoid a second huge allocation.
        if (data.length > 350 * 1024 * 1024) {
            throw new Error(
                `${file.name} is ${(data.length / 1_048_576).toFixed(0)} MB — `
                + `the ${options.platformLabel} media import limit is 350 MB`,
            );
        }
        const response = await fetch(`${wdaUrl}/wda/import-media`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
                name: file.name,
                mimeType: file.mimeType,
                data: data.toString('base64'),
            }),
        });
        const result = await response.json() as {
            value?: { error?: unknown; assetCount?: number };
        };
        if (!response.ok || (result.value && typeof result.value === 'object' && 'error' in result.value)) {
            throw new Error(`WDA could not import ${file.name}: ${JSON.stringify(result)}`);
        }
        assetCount = result.value?.assetCount ?? 0;
    }

    if (!assetCount) throw new Error('WDA did not return the Photos asset count');
    await new Promise((resolve) => setTimeout(resolve, options.settleMs));
    return assetCount;
}

export async function firstDisplayed(driver: Browser, selectors: string[]) {
    for (const selector of selectors) {
        const candidate = await driver.$(selector);
        if (await candidate.isExisting() && await candidate.isDisplayed()) return candidate;
    }
    return undefined;
}

export async function ensureRedCheckboxState(
    driver: Browser,
    remote: WdaRemoteControl,
    udid: string,
    point: { x: number; y: number },
    label: string,
    desired: boolean,
    attempts = 3,
): Promise<void> {
    const { scale } = await remote.getScreenInfo(udid);
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
        const checked = await isRedCheckboxChecked(await remote.getScreenshot(udid), point, scale);
        if (checked === desired) {
            console.log(`"${label}" confirmed ${desired ? 'on' : 'off'}`);
            return;
        }
        await tapCoordinate(driver, point.x, point.y, `${label} (attempt ${attempt})`);
        await driver.pause(1000);
    }
    throw new Error(
        `Could not get "${label}" into the ${desired ? 'on' : 'off'} state after ${attempts} attempts`,
    );
}
