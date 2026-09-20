import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import type { Browser } from '../devices/appium-driver.js';
import type { WdaRemoteControl } from '../devices/wda-remote.js';
import { findHandleMatch, pointFromWord, recognizeWords, type OcrWord } from './ocr.js';

export async function tapCoordinate(driver: Browser, x: number, y: number, label: string): Promise<void> {
    await driver.performActions([{
        type: 'pointer',
        id: 'finger',
        parameters: { pointerType: 'touch' },
        actions: [
            { type: 'pointerMove', duration: 0, x, y },
            { type: 'pointerDown', button: 0 },
            { type: 'pause', duration: 100 },
            { type: 'pointerUp', button: 0 },
        ],
    }]);
    await driver.releaseActions();
    console.log(`Tapped ${label} at (${x}, ${y})`);
}

const FEED_TUTORIAL_HINTS = [
    'skip',
    'got it',
    'gotit',
    'double tap',
    'doubletap',
    'double-tap',
    'press and hold',
    'hold to record',
    'try it',
    'tryit',
    'new feature',
    "what's new",
    'whats new',
    'learn more',
    'learnmore',
    'not now',
    'notnow',
    'next tip',
    'nexttip',
    'tap here',
    'taphere',
    'tutorial',
    'coach mark',
    'coachmark',
] as const;

export function looksLikeFeedTutorial(words: OcrWord[]): boolean {
    const joined = words.map((word) => word.text.toLowerCase()).join(' ');
    const compact = words.map((word) => word.text.toLowerCase().replace(/[^a-z0-9]/g, '')).join(' ');
    return FEED_TUTORIAL_HINTS.some((hint) => {
        const spaced = hint.toLowerCase();
        const mashed = spaced.replace(/\s+/g, '');
        return joined.includes(spaced) || compact.includes(mashed);
    });
}

export async function dismissFeedTutorials(
    driver: Browser,
    remote: WdaRemoteControl,
    udid: string,
    screenSize: { width: number; height: number },
    options: { maxTaps?: number } = {},
): Promise<void> {
    const maxTaps = options.maxTaps ?? 6;
    const midX = Math.round(screenSize.width / 2);
    const midY = Math.round(screenSize.height / 2);

    for (let attempt = 1; attempt <= maxTaps; attempt += 1) {
        const words = await recognizeWords(await remote.getScreenshot(udid));
        if (!looksLikeFeedTutorial(words)) {
            if (attempt > 1) console.log('Feed tutorial overlay cleared');
            return;
        }
        const hint = words.map((word) => word.text).filter(Boolean).slice(0, 12).join(', ');
        console.log(`Feed tutorial detected (attempt ${attempt}/${maxTaps}); tapping screen center. OCR: ${hint || '(empty)'}`);
        await tapCoordinate(driver, midX, midY, `Dismiss tutorial (center ${attempt})`);
        await driver.pause(900);
    }
    console.warn(`Feed tutorial still present after ${maxTaps} center taps — continuing anyway`);
}

/**
 * Insert preset text in one shot. Prefer pasteboard paste; fall back to the
 * Appium /keys endpoint with the complete string, never soft-keyboard
 * letter-by-letter typing.
 */
export async function typeText(driver: Browser, text: string): Promise<void> {
    try {
        await driver.execute('mobile: setPasteboard', { content: text, encoding: 'utf8' });
        await driver.execute('mobile: paste');
        console.log(`Pasted preset text (${text.length} chars)`);
        return;
    } catch (error) {
        console.log(`Paste unavailable (${error instanceof Error ? error.message : String(error)}); injecting full string`);
    }

    const appiumHost = process.env.APPIUM_HOST ?? '127.0.0.1';
    const appiumPort = Number.parseInt(process.env.APPIUM_PORT ?? '4725', 10);
    if (!Number.isSafeInteger(appiumPort) || appiumPort <= 0) {
        throw new Error(`APPIUM_PORT must be a positive integer; received ${process.env.APPIUM_PORT}`);
    }
    const response = await fetch(`http://${appiumHost}:${appiumPort}/session/${driver.sessionId}/keys`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ value: [text] }),
    });
    if (!response.ok) throw new Error(`Appium could not insert text: ${await response.text()}`);
    console.log(`Inserted preset text (${text.length} chars)`);
}

export interface AccountSwitchCoords {
    profileTabX: number;
    profileTabY: number;
    switcherTriggerX: number;
    switcherTriggerY: number;
}

export interface AccountSwitchOptions {
    platformLabel: string;
    switcherIsOpen(words: OcrWord[]): boolean;
    maxOpenAttempts?: number;
}

export async function switchAccount(
    driver: Browser,
    remote: WdaRemoteControl,
    udid: string,
    targetHandle: string,
    coords: AccountSwitchCoords,
    options: AccountSwitchOptions,
): Promise<void> {
    await tapCoordinate(driver, coords.profileTabX, coords.profileTabY, 'Profile tab');
    // Fresh launches can show transient profile-header prompts. Give them time
    // to appear/clear before repeatedly opening the switcher.
    await driver.pause(2000);

    const { scale } = await remote.getScreenInfo(udid);
    const profileWords = await recognizeWords(await remote.getScreenshot(udid));
    if (findHandleMatch(profileWords, targetHandle)) {
        console.log(`Already on ${options.platformLabel} account ${targetHandle}`);
        return;
    }

    const maxOpenAttempts = options.maxOpenAttempts ?? 4;
    let switcherWords: OcrWord[] = [];
    let opened = false;
    for (let attempt = 1; attempt <= maxOpenAttempts && !opened; attempt += 1) {
        await tapCoordinate(driver, coords.switcherTriggerX, coords.switcherTriggerY, `Account switcher (attempt ${attempt})`);
        await driver.pause(1500);
        switcherWords = await recognizeWords(await remote.getScreenshot(udid));
        opened = options.switcherIsOpen(switcherWords);
    }
    if (!opened) {
        const seen = switcherWords.map((word) => word.text).join(', ') || '(nothing recognized)';
        throw new Error(`Could not open the ${options.platformLabel} account switcher after ${maxOpenAttempts} attempts. OCR saw: ${seen}`);
    }

    const targetMatch = findHandleMatch(switcherWords, targetHandle);
    if (!targetMatch) {
        const seen = switcherWords.map((word) => word.text).join(', ') || '(nothing recognized)';
        throw new Error(`Could not find ${options.platformLabel} account "${targetHandle}" in the account switcher. OCR saw: ${seen}`);
    }
    const targetPoint = pointFromWord(targetMatch, scale);
    await tapCoordinate(driver, targetPoint.x, targetPoint.y, `Account row for ${targetHandle}`);
    await driver.pause(4000);

    await tapCoordinate(driver, coords.profileTabX, coords.profileTabY, 'Profile tab (verify)');
    await driver.pause(1000);

    const verifyWords = await recognizeWords(await remote.getScreenshot(udid));
    if (!findHandleMatch(verifyWords, targetHandle)) {
        const screenshotPath = path.resolve('.wda', `account-switch-failed-${udid}.png`);
        await mkdir(path.dirname(screenshotPath), { recursive: true });
        await writeFile(screenshotPath, await remote.getScreenshot(udid));
        throw new Error(`Switched but could not confirm ${options.platformLabel} account "${targetHandle}" is active afterward. Screenshot saved to ${screenshotPath}`);
    }
    console.log(`Confirmed active ${options.platformLabel} account: ${targetHandle}`);
}
