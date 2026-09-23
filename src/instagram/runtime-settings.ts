import type { RegisteredDevice } from '../types.js';
import { INSTAGRAM_PLUGIN_ID } from '../branding.js';
import { socialCoordinateProfile, socialRegisteredAccounts } from '../social/runtime-settings.js';

export function coordinateProfile(device: RegisteredDevice | undefined): string {
    return socialCoordinateProfile(device, INSTAGRAM_PLUGIN_ID);
}

export function registeredAccounts(device: RegisteredDevice | undefined): string[] {
    return socialRegisteredAccounts(device, INSTAGRAM_PLUGIN_ID);
}
