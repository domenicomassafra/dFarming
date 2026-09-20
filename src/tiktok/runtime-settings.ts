import type { RegisteredDevice } from '../types.js';
import { socialCoordinateProfile, socialRegisteredAccounts } from '../social/runtime-settings.js';

export const TIKTOK_PLUGIN_ID = 'com.git-agni.tiktok';

export function coordinateProfile(device: RegisteredDevice | undefined): string {
    return socialCoordinateProfile(device, TIKTOK_PLUGIN_ID);
}

export function registeredAccounts(device: RegisteredDevice | undefined): string[] {
    return socialRegisteredAccounts(device, TIKTOK_PLUGIN_ID);
}
