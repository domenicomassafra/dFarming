import type { Browser } from '../devices/appium-driver.js';
import type { WdaRemoteControl } from '../devices/wda-remote.js';
import {
    switchAccount,
    type AccountSwitchCoords,
} from '../social/actions.js';
import type { OcrWord } from './ocr.js';

export {
    dismissFeedTutorials,
    looksLikeFeedTutorial,
    tapCoordinate,
    typeText,
    type AccountSwitchCoords,
} from '../social/actions.js';

function switcherIsOpen(words: OcrWord[]): boolean {
    return words.some((word) => word.text.trim().toLowerCase() === 'switch');
}

export async function switchTikTokAccount(
    driver: Browser,
    remote: WdaRemoteControl,
    udid: string,
    targetHandle: string,
    coords: AccountSwitchCoords,
): Promise<void> {
    return switchAccount(driver, remote, udid, targetHandle, coords, {
        platformLabel: 'TikTok',
        switcherIsOpen,
    });
}
