import type { RegisteredDevice } from '../types.js';
import { socialCoordinateProfile, socialRegisteredAccounts } from '../social/runtime-settings.js';

export const INSTAGRAM_PLUGIN_ID = 'com.git-agni.instagram';

export function coordinateProfile(device: RegisteredDevice | undefined): string {
    return socialCoordinateProfile(device, INSTAGRAM_PLUGIN_ID);
}

export function registeredAccounts(device: RegisteredDevice | undefined): string[] {
    return socialRegisteredAccounts(device, INSTAGRAM_PLUGIN_ID);
}
