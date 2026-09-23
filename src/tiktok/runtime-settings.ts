import type { RegisteredDevice } from '../types.js';
import { TIKTOK_PLUGIN_ID } from '../branding.js';
import { socialCoordinateProfile, socialRegisteredAccounts } from '../social/runtime-settings.js';

export function coordinateProfile(device: RegisteredDevice | undefined): string {
    return socialCoordinateProfile(device, TIKTOK_PLUGIN_ID);
}

export function registeredAccounts(device: RegisteredDevice | undefined): string[] {
    return socialRegisteredAccounts(device, TIKTOK_PLUGIN_ID);
}
