import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { remote, type Browser, type Capabilities } from '../devices/appium-driver.js';

import { loadRegisteredDevices } from '../devices/registry.js';
import { resolveDeviceCoordinates } from '../devices/coordinates.js';
import { WdaRemoteControl } from '../devices/wda-remote.js';
import type { PostManifest } from './post-manifest.js';
import { type InstagramCoordinates } from './coordinates.js';
import { coordinateProfile, registeredAccounts } from './runtime-settings.js';
import { switchInstagramAccount, tapCoordinate, dismissFeedTutorials } from './actions.js';
import { ensureRedCheckboxState, firstDisplayed, importWdaMedia, positiveInteger } from '../social/post-runtime.js';
import { recentPickerTargets } from './post-layout.js';

async function clickOne(driver: Browser, label: string, selectors: string[]): Promise<void> {
    const element = await firstDisplayed(driver, selectors);
    if (!element) throw new Error(`Instagram control not found: ${label}`);
    await element.click();
    console.log(`Tapped ${label}`);
}

async function openComposer(
    driver: Browser,
    remote: WdaRemoteControl,
    udid: string,
    coordinates: InstagramCoordinates['instagram'],
    screenSize: { width: number; height: number },
    musicUrl?: string,
): Promise<void> {
    if (musicUrl) {
        console.log(`Opening music URL: ${musicUrl}`);
        await driver.execute('mobile: deepLink', { url: musicUrl });
        await driver.pause(4000);
        await clickOne(driver, 'Use this sound', [
            '~Use this sound', '~Use sound', '-ios predicate string:(label CONTAINS[c] "Use this sound") OR (name CONTAINS[c] "Use this sound")',
        ]);
    } else {
        await driver.activateApp(process.env.INSTAGRAM_BUNDLE_ID ?? 'com.burbn.instagram');
        await driver.pause(3000);
        // Open app → Home feed (so Create chrome is visible) → Create (+) →
        // Post content (Post vs Story/Reel) → gallery Upload.
        console.log(`Opening Instagram Home at (${coordinates.homeTab.x}, ${coordinates.homeTab.y})`);
        await tapCoordinate(
            driver,
            coordinates.homeTab.x,
            coordinates.homeTab.y,
            'Home tab',
        );
        await driver.pause(1500);
        await dismissFeedTutorials(driver, remote, udid, screenSize);
        console.log(`Opening Create (+) at (${coordinates.create.x}, ${coordinates.create.y})`);
        await tapCoordinate(
            driver,
            coordinates.create.x,
            coordinates.create.y,
            'Create',
        );
        await driver.pause(1500);
        console.log(
            `Opening Post content at (${coordinates.postContent.x}, ${coordinates.postContent.y})`,
        );
        await tapCoordinate(
            driver,
            coordinates.postContent.x,
            coordinates.postContent.y,
            'Post content',
        );
        // Instagram's Post tile opens the gallery directly. Do NOT tap `upload`
        // here — that coordinate is a TikTok-style camera→gallery control, and
        // on this screen it lands on a bottom-row Recents cell (wrong file).
        await driver.pause(3000);
        return;
    }
    await driver.pause(2500);
    await tapCoordinate(driver, coordinates.upload.x, coordinates.upload.y, 'Upload');
    await driver.pause(2500);
}

async function chooseRecentMedia(
    driver: Browser, remote: WdaRemoteControl, udid: string, count: number, assetCount: number,
    coordinates: InstagramCoordinates['instagram'],
): Promise<void> {
    if (count > 1) {
        await ensureRedCheckboxState(driver, remote, udid, {
            x: coordinates.selectMultiple.x,
            y: coordinates.selectMultiple.y,
        }, 'Select multiple', true);
        const targets = recentPickerTargets(assetCount, count, {
            circleX: coordinates.picker.circleX,
            columnStep: coordinates.picker.columnStep,
            firstY: coordinates.picker.firstY,
            trayY: coordinates.picker.trayY,
            rowStep: coordinates.picker.rowStep,
        });
        for (const [selection, { x, y }] of targets.entries()) {
            await tapCoordinate(driver, x, y, `media ${selection + 1}/${count}`);
            await driver.pause(600);
        }
        await ensureRedCheckboxState(driver, remote, udid, {
            x: coordinates.useLayout.x,
            y: coordinates.useLayout.y,
        }, 'Use layout', false);
    } else {
        console.log(
            `Selecting newest import at (${coordinates.picker.cellX}, ${coordinates.picker.cellY}) `
            + `(library assetCount=${assetCount})`,
        );
        await tapCoordinate(driver, coordinates.picker.cellX, coordinates.picker.cellY, 'media 1/1');
        await driver.pause(1000);
    }
    await tapCoordinate(driver, coordinates.pickerNext.x, coordinates.pickerNext.y, 'picker Next');
    await driver.pause(3000);
    console.log(
        `Tapping timeline editor Next at (${coordinates.editorNext.x}, ${coordinates.editorNext.y})`,
    );
    await tapCoordinate(driver, coordinates.editorNext.x, coordinates.editorNext.y, 'editor Next');
    await driver.pause(3000);
}

async function addCaption(driver: Browser, coordinates: InstagramCoordinates['instagram'], caption?: string): Promise<void> {
    if (!caption) return;
    await tapCoordinate(driver, coordinates.caption.x, coordinates.caption.y, 'caption');
    const appiumHost = process.env.APPIUM_HOST ?? '127.0.0.1';
    const appiumPort = positiveInteger('APPIUM_PORT', 4725);
    const response = await fetch(`http://${appiumHost}:${appiumPort}/session/${driver.sessionId}/keys`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ value: [caption] }),
    });
    if (!response.ok) throw new Error(`Appium could not type the caption: ${await response.text()}`);
    await driver.pause(500);
    // On this Instagram screen, Back dismisses the keyboard without leaving the form.
    await tapCoordinate(driver, coordinates.keyboardBack.x, coordinates.keyboardBack.y, 'keyboard Back');
    console.log('Caption added');
}

const manifestPath = process.argv[2];
if (!manifestPath) throw new Error('A post manifest path is required');
const manifest = JSON.parse(await readFile(path.resolve(manifestPath), 'utf8')) as PostManifest;

const switchAccountName = manifest.account?.trim() || undefined;
const registeredDevice = (await loadRegisteredDevices()).find((device) => device.udid === manifest.device.udid);
const coordinates = resolveDeviceCoordinates(
    coordinateProfile(registeredDevice),
    registeredDevice?.instagramCoordinates,
    'instagram',
);
const instagramCoordinates = coordinates.instagram;
const accountSwitchCoords = {
    profileTabX: instagramCoordinates.profileTab.x,
    profileTabY: instagramCoordinates.profileTab.y,
    switcherTriggerX: instagramCoordinates.accountSwitcher.x,
    switcherTriggerY: instagramCoordinates.accountSwitcher.y,
};
// Fail fast, before unlocking or launching Instagram, if the requested account
// isn't one this device is registered for.
const allowedAccounts = switchAccountName
    ? registeredAccounts(registeredDevice)
    : [];
if (switchAccountName && !allowedAccounts.includes(switchAccountName)) {
    throw new Error(`Instagram account "${switchAccountName}" is not listed in devices.json for device ${manifest.device.udid}`);
}

const deviceRemote = new WdaRemoteControl({
    deviceUdid: manifest.device.udid,
    passcodeKeypadLayout: coordinates.passcodeKeypad,
});
console.log('Checking device lock state');
await deviceRemote.unlock(manifest.device.udid);

const assetCount = await importWdaMedia(manifest, { platformLabel: 'Instagram', settleMs: 3000 });

const bundleId = process.env.INSTAGRAM_BUNDLE_ID ?? 'com.burbn.instagram';
const capabilities: Capabilities = {
    platformName: 'iOS', 'appium:automationName': 'XCUITest', 'appium:udid': manifest.device.udid,
    'appium:bundleId': bundleId, 'appium:noReset': true, 'appium:forceAppLaunch': true,
    'appium:shouldTerminateApp': true, 'appium:newCommandTimeout': 180,
    'appium:waitForIdleTimeout': 0,
};
if (process.env.WDA_URL) {
    capabilities['appium:webDriverAgentUrl'] = process.env.WDA_URL;
    capabilities['appium:wdaRemotePort'] = positiveInteger('WDA_REMOTE_PORT', 8100);
}

// The composer/picker flow (up to the caption screen) is the fragile part —
// flaky picker checkboxes, transient tooltips, Instagram UI timing — so it gets
// retried with a fresh app relaunch on failure. Caption entry and the final
// Post/Drafts tap are NOT retried: retrying after that risks a duplicate
// post or draft, which is worse than a single clean failure.
const REACH_CAPTION_SCREEN_ATTEMPTS = 3;
let driver: Browser | undefined;
let reachedCaptionScreen = false;
let lastAttemptError: unknown;

for (let attempt = 1; attempt <= REACH_CAPTION_SCREEN_ATTEMPTS && !reachedCaptionScreen; attempt += 1) {
    if (attempt > 1) {
        console.log(`Retrying up to the caption screen (attempt ${attempt}/${REACH_CAPTION_SCREEN_ATTEMPTS})`);
    }
    try {
        driver = await remote({ hostname: process.env.APPIUM_HOST ?? '127.0.0.1', port: positiveInteger('APPIUM_PORT', 4725), path: '/', logLevel: 'info', connectionRetryCount: 0, connectionRetryTimeout: 180000, capabilities });
        await driver.updateSettings({ defaultActiveApplication: bundleId });
        if (switchAccountName) {
            console.log(`Switching to Instagram account "${switchAccountName}"`);
            await driver.pause(2000);
            try {
                await switchInstagramAccount(driver, deviceRemote, manifest.device.udid, switchAccountName, accountSwitchCoords);
            } catch (error) {
                console.warn(
                    `Account switch skipped (${error instanceof Error ? error.message : String(error)}). `
                    + 'Continuing with the currently signed-in Instagram account.',
                );
            }
        }
        await openComposer(
            driver,
            deviceRemote,
            manifest.device.udid,
            instagramCoordinates,
            coordinates.screenSize,
            manifest.musicUrl,
        );
        await chooseRecentMedia(driver, deviceRemote, manifest.device.udid, manifest.files.length, assetCount, instagramCoordinates);
        reachedCaptionScreen = true;
    } catch (error) {
        lastAttemptError = error;
        console.error(`Attempt ${attempt}/${REACH_CAPTION_SCREEN_ATTEMPTS} failed before reaching the caption screen: ${error instanceof Error ? error.message : String(error)}`);
        if (driver) {
            await driver.deleteSession().catch(() => {});
            driver = undefined;
        }
    }
}

if (!reachedCaptionScreen || !driver) {
    throw lastAttemptError instanceof Error
        ? lastAttemptError
        : new Error(`Could not finish the Instagram upload after ${REACH_CAPTION_SCREEN_ATTEMPTS} attempts`);
}

// Straight upload: stop once media is on the share/caption screen.
// Draft / public Share taps are more UI surface than we want to maintain right now.
console.log(
    'Instagram straight upload complete — share/caption screen reached '
    + `(destination=${manifest.destination}; not tapping Draft/Share).`,
);
await driver.pause(2000);
await driver.deleteSession();
