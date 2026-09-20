import type { DeviceCoordinateOverrides, DeviceProfileName } from './devices/coordinates.js';

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

export type MobilePlatform = 'ios' | 'android';
export type MobileDeviceKind = 'physical' | 'simulator' | 'emulator';
export type MobileAutomationBackend = 'wda' | 'appium';

export interface DeviceIdentity {
    udid: string;
    name: string;
    /** Legacy entries omit this and are interpreted as iOS. */
    platform?: MobilePlatform;
    /** Legacy entries omit this and are interpreted as physical devices. */
    kind?: MobileDeviceKind;
    /** Execution host/node that owns the device transport. */
    workerId?: string;
    osVersion?: string;
    productType?: string;
}

export interface RegisteredDevice extends DeviceIdentity {
    /** Legacy iPhone entries use WDA; generic runtimes use Appium. */
    automationBackend?: MobileAutomationBackend;
    wdaLocalPort?: number;
    mjpegLocalPort?: number;
    /** Compiled tap-layout key; canonical here, not in pluginData. */
    coordinateProfile?: DeviceProfileName;
    passcode?: string;
    /** TikTok single-tap overrides (legacy flat map). */
    coordinates?: DeviceCoordinateOverrides;
    /** Instagram single-tap overrides. */
    instagramCoordinates?: DeviceCoordinateOverrides;
    disabled?: boolean;
    /** Operator-defined labels used for search and allocation pools. */
    tags?: string[];
    pluginData: Record<string, JsonObject>;
}

export type ScheduleTiming =
    | { kind: 'now' }
    | { kind: 'once'; runAt: string }
    | { kind: 'daily'; localTime: string; timezone: string }
    | { kind: 'weekly'; localTime: string; timezone: string; weekdays: number[] }
    /** Repeating timer — useful for testing pipeline drains without waiting for clock slots. */
    | { kind: 'interval'; everyMinutes: number; startOffsetMinutes?: number };

export interface TaskEnvelope<TPayload extends JsonObject = JsonObject> {
    pluginId: string;
    taskType: string;
    taskVersion: number;
    payload: TPayload;
}

export interface CreateTaskInput<TPayload extends JsonObject = JsonObject> {
    deviceUdid: string;
    task: TaskEnvelope<TPayload>;
    timing: ScheduleTiming;
    runWindowMinutes?: number;
}

export interface StoredAsset {
    id: string;
    path: string;
    name: string;
    mimeType: string;
    size: number;
    sha256: string;
}

export interface PipelineClaim {
    id: string;
    caption: string | null;
    asset: StoredAsset;
}

export interface TaskExecutionResult {
    exitCode: number | null;
    stopped: boolean;
    error?: string;
}

export interface TaskRetryPolicy {
    retryLimit: number;
    retryDelaySeconds: number;
    retryBackoff: boolean;
}
