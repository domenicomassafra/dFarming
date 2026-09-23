import { fileURLToPath } from 'node:url';

import { INSTAGRAM_PLUGIN_ID, TIKTOK_PLUGIN_ID } from './branding.js';
import type { DashboardTheme } from './api/app.js';
import type { RegisteredDevice } from './devices/registry.js';

function accounts(device: RegisteredDevice, pluginId: string): string[] {
    const value = device.pluginData[pluginId]?.accounts;
    return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : [];
}

function escapeHtml(value: string): string {
    return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;').replaceAll("'", '&#39;');
}

function accountOptions(configured: string[]): string {
    return configured.map((account) => `<option value="${escapeHtml(account)}">${escapeHtml(account)}</option>`).join('');
}

export const defaultDashboardTheme: DashboardTheme = {
    rootDirectory: fileURLToPath(new URL('../static/dashboard/', import.meta.url)),
    renderDevice(template, device) {
        const tiktok = accounts(device, TIKTOK_PLUGIN_ID);
        const instagram = accounts(device, INSTAGRAM_PLUGIN_ID);
        const platform = device.platform ?? 'ios';
        const kind = device.kind ?? 'physical';
        const backend = device.automationBackend ?? (platform === 'ios' && kind === 'physical' ? 'wda' : 'appium');
        return template
            .replaceAll('__DEVICE_PLATFORM__', escapeHtml(platform))
            .replaceAll('__DEVICE_KIND__', escapeHtml(kind))
            .replaceAll('__DEVICE_BACKEND__', escapeHtml(backend))
            .replaceAll('__DEVICE_DISABLED__', device.disabled === true ? 'true' : 'false')
            .replaceAll('__TIKTOK_ACCOUNT_OPTIONS__', accountOptions(tiktok))
            .replaceAll('__TIKTOK_ACCOUNTS_VALUE__', escapeHtml(tiktok.join(', ')))
            .replaceAll('__INSTAGRAM_ACCOUNT_OPTIONS__', accountOptions(instagram))
            .replaceAll('__INSTAGRAM_ACCOUNTS_VALUE__', escapeHtml(instagram.join(', ')))
            .replaceAll('__DEVICE_HASPASSCODE__', device.passcode ? '· set' : '· not set');
    },
};
