import { dfarmingEnv } from './env.js';

const ROUTE_ID_PATTERN = /^[a-z0-9][a-z0-9._-]{0,63}$/;

export interface NetworkRouteAttestation {
    id: string;
    /** Optional scope: when present, this route may only be used by these registered devices. */
    deviceUdids?: string[];
}

export function normalizeNetworkRouteId(value: unknown): string {
    if (typeof value !== 'string') throw new Error('Network route id must be a string');
    const id = value.trim().toLowerCase();
    if (!ROUTE_ID_PATTERN.test(id)) {
        throw new Error('Network route id must contain lowercase letters, numbers, periods, underscores, and hyphens');
    }
    return id;
}

export function parseNetworkRouteAttestations(
    value: string | undefined = dfarmingEnv('NETWORK_ROUTES'),
): NetworkRouteAttestation[] {
    if (!value?.trim()) return [];
    const trimmed = value.trim();
    let raw: unknown;
    if (trimmed.startsWith('[')) {
        try { raw = JSON.parse(trimmed); }
        catch (error) { throw new Error(`DFARMING_NETWORK_ROUTES contains invalid JSON: ${error instanceof Error ? error.message : String(error)}`); }
    } else {
        raw = trimmed.split(',').map((id) => ({ id }));
    }
    if (!Array.isArray(raw)) throw new Error('DFARMING_NETWORK_ROUTES must be a JSON array or comma-separated route ids');
    if (raw.length > 64) throw new Error('DFARMING_NETWORK_ROUTES may define at most 64 routes');
    const seen = new Set<string>();
    return raw.map((entry) => {
        const record: Record<string, unknown> = entry && typeof entry === 'object' && !Array.isArray(entry)
            ? entry as Record<string, unknown> : { id: entry };
        const id = normalizeNetworkRouteId(record.id);
        if (seen.has(id)) throw new Error(`Duplicate network route id: ${id}`);
        seen.add(id);
        let deviceUdids: string[] | undefined;
        if (record.deviceUdids !== undefined) {
            if (!Array.isArray(record.deviceUdids) || record.deviceUdids.length > 100
                || record.deviceUdids.some((udid) => typeof udid !== 'string' || !udid.trim() || udid.length > 128)) {
                throw new Error(`Network route ${id} deviceUdids must contain at most 100 non-empty device ids`);
            }
            deviceUdids = [...new Set((record.deviceUdids as string[]).map((udid) => udid.trim()))];
            if (!deviceUdids.length) deviceUdids = undefined;
        }
        return { id, ...(deviceUdids ? { deviceUdids } : {}) };
    });
}

export function networkRouteAvailable(
    routes: readonly NetworkRouteAttestation[],
    routeId: string,
    deviceUdid?: string,
): boolean {
    const route = routes.find(({ id }) => id === routeId);
    if (!route) return false;
    return !route.deviceUdids?.length || (deviceUdid !== undefined && route.deviceUdids.includes(deviceUdid));
}
