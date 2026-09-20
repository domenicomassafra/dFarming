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
    if (words.some((word) => word.text.trim().toLowerCase().includes('switch'))) return true;
    const usernameLike = words.filter((word) => {
        const text = word.text.trim();
        if (text.startsWith('@') && text.length > 1) return true;
        return /^[A-Za-z0-9._]{3,30}$/.test(text);
    });
    return usernameLike.length >= 2;
}

export async function switchInstagramAccount(
    driver: Browser,
    remote: WdaRemoteControl,
    udid: string,
    targetHandle: string,
    coords: AccountSwitchCoords,
): Promise<void> {
    return switchAccount(driver, remote, udid, targetHandle, coords, {
        platformLabel: 'Instagram',
        switcherIsOpen,
    });
}
