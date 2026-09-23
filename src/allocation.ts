import type { ExecutionRow, ScheduleRow } from './database/schema.js';
import type { RegisteredDevice } from './devices/registry.js';
import type { MobileDeviceKind, MobilePlatform } from './types.js';

export interface DeviceAllocationSelector {
    platform?: MobilePlatform;
    kind?: MobileDeviceKind;
    /** Soft ordering used only after current execution/schedule load. Exact `kind` remains a hard filter. */
    preferredKinds?: MobileDeviceKind[];
    workerId?: string;
    deviceUdids?: string[];
    /** Every requested tag must exist on the candidate device. */
    tags?: string[];
    /** Default true: do not place new work on a device with queued/running execution. */
    requireIdle?: boolean;
}

export interface DeviceAllocationCandidate {
    udid: string;
    name: string;
    platform: MobilePlatform;
    kind: MobileDeviceKind;
    workerId?: string;
    queuedOrRunning: number;
    activeSchedules: number;
    preferenceRank: number;
    score: number;
}

function normalizedPlatform(device: RegisteredDevice): MobilePlatform { return device.platform ?? 'ios'; }
function normalizedKind(device: RegisteredDevice): MobileDeviceKind { return device.kind ?? 'physical'; }

export function deviceMatchesAllocationSelector(
    device: RegisteredDevice,
    selector: DeviceAllocationSelector = {},
): boolean {
    const platform = normalizedPlatform(device);
    const kind = normalizedKind(device);
    const allowedIds = selector.deviceUdids?.length ? new Set(selector.deviceUdids) : undefined;
    if (selector.platform && selector.platform !== platform) return false;
    if (selector.kind && selector.kind !== kind) return false;
    if (selector.workerId && selector.workerId !== device.workerId) return false;
    if (allowedIds && !allowedIds.has(device.udid)) return false;
    if (selector.tags?.length) {
        const tags = new Set(device.tags ?? []);
        if (selector.tags.some((tag) => !tags.has(tag))) return false;
    }
    return true;
}

export function rankAllocationCandidates(
    registered: readonly RegisteredDevice[],
    connectedUdids: ReadonlySet<string>,
    executions: readonly ExecutionRow[],
    schedules: readonly ScheduleRow[],
    selector: DeviceAllocationSelector = {},
): DeviceAllocationCandidate[] {
    const requireIdle = selector.requireIdle !== false;
    const preferredKinds = selector.preferredKinds ?? [];
    const activeExecutionCount = new Map<string, number>();
    const activeScheduleCount = new Map<string, number>();
    for (const execution of executions) {
        if (!['queued', 'running'].includes(execution.status)) continue;
        activeExecutionCount.set(execution.deviceUdid, (activeExecutionCount.get(execution.deviceUdid) ?? 0) + 1);
    }
    for (const schedule of schedules) {
        if (schedule.status !== 'active') continue;
        activeScheduleCount.set(schedule.deviceUdid, (activeScheduleCount.get(schedule.deviceUdid) ?? 0) + 1);
    }

    return registered.flatMap((device): DeviceAllocationCandidate[] => {
        const platform = normalizedPlatform(device);
        const kind = normalizedKind(device);
        const queuedOrRunning = activeExecutionCount.get(device.udid) ?? 0;
        if (device.disabled || !connectedUdids.has(device.udid)) return [];
        if (!deviceMatchesAllocationSelector(device, selector)) return [];
        if (requireIdle && queuedOrRunning > 0) return [];
        const activeSchedules = activeScheduleCount.get(device.udid) ?? 0;
        const preferenceIndex = preferredKinds.indexOf(kind);
        const preferenceRank = preferenceIndex === -1 ? preferredKinds.length : preferenceIndex;
        return [{
            udid: device.udid,
            name: device.name,
            platform,
            kind,
            ...(device.workerId ? { workerId: device.workerId } : {}),
            queuedOrRunning,
            activeSchedules,
            preferenceRank,
            // Load dominates preference: mixed pools can prefer physical/virtual without pinning work there.
            score: queuedOrRunning * 1000 + activeSchedules * 10 + preferenceRank,
        }];
    }).sort((left, right) => left.score - right.score
        || left.activeSchedules - right.activeSchedules
        || left.name.localeCompare(right.name)
        || left.udid.localeCompare(right.udid));
}

export function selectAllocationCandidate(
    registered: readonly RegisteredDevice[],
    connectedUdids: ReadonlySet<string>,
    executions: readonly ExecutionRow[],
    schedules: readonly ScheduleRow[],
    selector: DeviceAllocationSelector = {},
): DeviceAllocationCandidate | null {
    return rankAllocationCandidates(registered, connectedUdids, executions, schedules, selector)[0] ?? null;
}
