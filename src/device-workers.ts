import type { DeviceConnectionStatus } from './devices/connection-manager.js';
import type { Device } from './devices/discovery.js';
import { loadRegisteredDevices, mutateRegisteredDevices, normalizeDeviceTags, type RegisteredDevice } from './devices/registry.js';
import { coordinatesForProfile, validateCoordinateOverrides } from './devices/coordinates.js';
import type { RemoteAction, RemoteControl, ScreenInfo } from './devices/wda-remote.js';
import type { HostCapability, HostSnapshot } from './hosts/capabilities.js';
import type { RuntimeDevice } from './devices/runtime-discovery.js';
import type { VirtualRuntime, VirtualRuntimePlatform } from './devices/virtual-runtime.js';
import { dfarmingEnv } from './env.js';
import { normalizeNetworkRouteId, type NetworkRouteAttestation } from './network-routes.js';

export const DEVICE_WORKER_PROTOCOL_VERSION = 1;
export const DEVICE_WORKER_REMOTE_OPERATION_TIMEOUT_MS = 130_000;

interface DeviceWorkerHealth {
    ok: true;
    role: 'device-worker';
    workerId: string;
    protocolVersion: number;
    platforms: Array<'ios' | 'android'>;
}

export interface DeviceWorkerDescriptor {
    id: string;
    url: URL;
    token?: string;
}

export interface DeviceWorkerDevice {
    registered: Omit<RegisteredDevice, 'passcode'> & { hasPasscode: boolean };
    connected: Device | null;
    status?: DeviceConnectionStatus;
}

const HOST_CAPABILITIES = new Set<HostCapability>([
    'ios.physical', 'ios.simulator',
    'android.physical', 'android.emulator', 'android.h264',
    'appium', 'wda', 'simctl', 'adb',
]);

function record(value: unknown): Record<string, unknown> | undefined {
    return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function nonEmptyString(value: unknown): string | undefined {
    return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function finiteNumber(value: unknown): number | undefined {
    return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function sanitizedWorkerDevice(value: unknown): { device?: DeviceWorkerDevice; warning?: string } {
    const snapshot = record(value);
    const source = record(snapshot?.registered);
    const udid = nonEmptyString(source?.udid);
    const name = nonEmptyString(source?.name);
    if (!snapshot || !source || !udid || !name) return { warning: 'ignored malformed device advertisement' };
    const rawPlatform = source.platform ?? 'ios';
    const rawKind = source.kind ?? 'physical';
    const rawAutomationBackend = source.automationBackend
        ?? (rawPlatform === 'ios' && rawKind === 'physical' ? 'wda' : 'appium');
    if (rawPlatform !== 'ios' && rawPlatform !== 'android') {
        return { warning: `ignored unsupported device ${udid}: platform ${String(rawPlatform)}` };
    }
    const platform: 'ios' | 'android' = rawPlatform;
    const validKind = platform === 'ios'
        ? rawKind === 'physical' || rawKind === 'simulator'
        : rawKind === 'physical' || rawKind === 'emulator';
    if (!validKind) return { warning: `ignored unsupported device ${udid}: kind ${String(rawKind)} for ${platform}` };
    const kind = rawKind as 'physical' | 'simulator' | 'emulator';
    if (rawAutomationBackend !== 'wda' && rawAutomationBackend !== 'appium') {
        return { warning: `ignored unsupported device ${udid}: backend ${String(rawAutomationBackend)}` };
    }
    const automationBackend: 'wda' | 'appium' = rawAutomationBackend;
    if (platform === 'android' && automationBackend !== 'appium') {
        return { warning: `ignored unsupported device ${udid}: Android requires Appium/UiAutomator2` };
    }
    let tags: string[] = [];
    try { tags = normalizeDeviceTags(source.tags); }
    catch (error) {
        return { warning: `ignored malformed device ${udid}: ${error instanceof Error ? error.message : String(error)}` };
    }
    let coordinateProfile: RegisteredDevice['coordinateProfile'];
    if (platform === 'ios' && source.coordinateProfile !== undefined) {
        if (typeof source.coordinateProfile !== 'string') return { warning: `ignored malformed device ${udid}: coordinate profile must be a string` };
        try {
            coordinatesForProfile(source.coordinateProfile);
            coordinateProfile = source.coordinateProfile as RegisteredDevice['coordinateProfile'];
        } catch {
            return { warning: `ignored malformed device ${udid}: unknown coordinate profile ${source.coordinateProfile}` };
        }
    }
    let coordinates: RegisteredDevice['coordinates'];
    let instagramCoordinates: RegisteredDevice['instagramCoordinates'];
    try {
        if (platform === 'ios' && source.coordinates !== undefined) coordinates = validateCoordinateOverrides(source.coordinates, coordinateProfile);
        if (platform === 'ios' && source.instagramCoordinates !== undefined) instagramCoordinates = validateCoordinateOverrides(source.instagramCoordinates, coordinateProfile);
    } catch (error) {
        return { warning: `ignored malformed device ${udid}: ${error instanceof Error ? error.message : String(error)}` };
    }
    const pluginData = record(source.pluginData) ?? {};
    const registered: DeviceWorkerDevice['registered'] = {
        name,
        udid,
        platform,
        kind,
        automationBackend,
        hasPasscode: source.hasPasscode === true,
        pluginData: pluginData as RegisteredDevice['pluginData'],
        ...(nonEmptyString(source.osVersion) ? { osVersion: nonEmptyString(source.osVersion) } : {}),
        ...(nonEmptyString(source.productType) ? { productType: nonEmptyString(source.productType) } : {}),
        ...(tags.length ? { tags } : {}),
        ...(coordinateProfile ? { coordinateProfile } : {}),
        ...(coordinates && Object.keys(coordinates).length ? { coordinates } : {}),
        ...(instagramCoordinates && Object.keys(instagramCoordinates).length ? { instagramCoordinates } : {}),
    };
    const connectedSource = snapshot.connected === null ? null : record(snapshot.connected);
    let connected: Device | null = null;
    if (connectedSource) {
        const connectedUdid = nonEmptyString(connectedSource.udid);
        const connectedName = nonEmptyString(connectedSource.name);
        const osVersion = nonEmptyString(connectedSource.osVersion);
        const connectedPlatform = connectedSource.platform ?? 'ios';
        const connectedKind = connectedSource.kind ?? kind;
        const connectedKindValid = connectedPlatform === 'ios'
            ? connectedKind === 'physical' || connectedKind === 'simulator'
            : connectedPlatform === 'android'
                ? connectedKind === 'physical' || connectedKind === 'emulator'
                : false;
        if (connectedUdid !== udid || !connectedName || !osVersion || !connectedKindValid
            || connectedPlatform !== platform || connectedKind !== kind) {
            return { warning: `ignored malformed connected-state advertisement for ${udid}` };
        }
        connected = {
            name: connectedName,
            osVersion,
            udid,
            platform,
            kind: connectedKind as 'physical' | 'simulator' | 'emulator',
            ...(nonEmptyString(connectedSource.productType) ? { productType: nonEmptyString(connectedSource.productType) } : {}),
            ...(nonEmptyString(connectedSource.hardwareModel) ? { hardwareModel: nonEmptyString(connectedSource.hardwareModel) } : {}),
            ...(nonEmptyString(connectedSource.modelName) ? { modelName: nonEmptyString(connectedSource.modelName) } : {}),
        };
    } else if (snapshot.connected !== null && snapshot.connected !== undefined) {
        return { warning: `ignored malformed connected-state advertisement for ${udid}` };
    }
    return { device: { registered, connected } };
}

function sanitizedHostSnapshot(value: unknown, descriptor: DeviceWorkerDescriptor): HostSnapshot {
    const source = record(value);
    if (!source) throw new Error(`Device worker ${descriptor.id} returned an invalid host payload`);
    const hostname = nonEmptyString(source.hostname) ?? descriptor.url.hostname;
    const os = nonEmptyString(source.os);
    const arch = nonEmptyString(source.arch) ?? 'unknown';
    const rawCapabilities = Array.isArray(source.capabilities) ? source.capabilities : [];
    const unsupportedCapabilities = rawCapabilities.filter((capability) => typeof capability !== 'string' || !HOST_CAPABILITIES.has(capability as HostCapability));
    const capabilities = rawCapabilities.filter((capability): capability is HostCapability => (
        typeof capability === 'string' && HOST_CAPABILITIES.has(capability as HostCapability)
    ));
    const toolsSource = record(source.tools);
    const metricsSource = record(source.metrics);
    const metrics = metricsSource ? {
        uptimeSeconds: finiteNumber(metricsSource.uptimeSeconds) ?? 0,
        load1: finiteNumber(metricsSource.load1) ?? 0,
        cpuCount: finiteNumber(metricsSource.cpuCount) ?? 0,
        totalMemoryBytes: finiteNumber(metricsSource.totalMemoryBytes) ?? 0,
        freeMemoryBytes: finiteNumber(metricsSource.freeMemoryBytes) ?? 0,
    } : undefined;
    const warnings = [
        nonEmptyString(source.error),
        unsupportedCapabilities.length ? `ignored unsupported capabilities: ${unsupportedCapabilities.map(String).join(', ')}` : undefined,
    ].filter(Boolean) as string[];
    const networkRoutes: NetworkRouteAttestation[] = [];
    if (Array.isArray(source.networkRoutes)) {
        for (const candidate of source.networkRoutes.slice(0, 64)) {
            const route = record(candidate);
            try {
                const id = normalizeNetworkRouteId(route?.id);
                const deviceUdids = Array.isArray(route?.deviceUdids)
                    ? [...new Set(route.deviceUdids.filter((value): value is string => typeof value === 'string' && Boolean(value.trim())).map((value) => value.trim()).slice(0, 100))]
                    : undefined;
                networkRoutes.push({ id, ...(deviceUdids?.length ? { deviceUdids } : {}) });
            } catch { warnings.push('ignored malformed network route attestation'); }
        }
    }
    return {
        id: descriptor.id,
        hostname,
        os: os === 'darwin' || os === 'linux' || os === 'win32' ? os : 'unknown',
        arch,
        online: source.online !== false,
        observedAt: nonEmptyString(source.observedAt) ?? new Date().toISOString(),
        ...(warnings.length ? { error: warnings.join('; ') } : {}),
        capabilities,
        ...(networkRoutes.length ? { networkRoutes } : {}),
        tools: {
            appium: toolsSource?.appium === true,
            appiumRuntime: toolsSource?.appiumRuntime === true,
            xcrun: toolsSource?.xcrun === true,
            adb: toolsSource?.adb === true,
            emulator: toolsSource?.emulator === true,
            scrcpyVideo: toolsSource?.scrcpyVideo === true,
        },
        ...(metrics ? { metrics } : {}),
    };
}

function sanitizedRuntimeDevice(value: unknown): RuntimeDevice | undefined {
    const source = record(value);
    const name = nonEmptyString(source?.name);
    const osVersion = nonEmptyString(source?.osVersion);
    const udid = nonEmptyString(source?.udid);
    if (!source || !name || !osVersion || !udid || (source.platform !== 'ios' && source.platform !== 'android')) return;
    const validKind = source.platform === 'ios'
        ? source.kind === 'physical' || source.kind === 'simulator'
        : source.kind === 'physical' || source.kind === 'emulator';
    if (!validKind) return;
    if (source.automationBackend !== 'wda' && source.automationBackend !== 'appium') return;
    if (source.platform === 'android' && source.automationBackend !== 'appium') return;
    return {
        name,
        osVersion,
        udid,
        platform: source.platform,
        kind: source.kind as 'physical' | 'simulator' | 'emulator',
        automationBackend: source.automationBackend,
        ...(nonEmptyString(source.productType) ? { productType: nonEmptyString(source.productType) } : {}),
        ...(nonEmptyString(source.hardwareModel) ? { hardwareModel: nonEmptyString(source.hardwareModel) } : {}),
        ...(nonEmptyString(source.modelName) ? { modelName: nonEmptyString(source.modelName) } : {}),
    };
}

function sanitizedVirtualRuntime(value: unknown): VirtualRuntime | undefined {
    const source = record(value);
    const id = nonEmptyString(source?.id);
    const name = nonEmptyString(source?.name);
    if (!source || !id || !name || (source.platform !== 'ios' && source.platform !== 'android')) return;
    if (source.platform === 'ios' ? source.kind !== 'simulator' : source.kind !== 'emulator') return;
    if (source.state !== 'booted' && source.state !== 'shutdown') return;
    return {
        id,
        name,
        platform: source.platform,
        kind: source.kind as 'simulator' | 'emulator',
        state: source.state,
        ...(nonEmptyString(source.osVersion) ? { osVersion: nonEmptyString(source.osVersion) } : {}),
        ...(nonEmptyString(source.serial) ? { serial: nonEmptyString(source.serial) } : {}),
    };
}

function appendHostWarning(host: HostSnapshot, warning: string): HostSnapshot {
    return { ...host, error: [host.error, warning].filter(Boolean).join('; ') };
}

export function configuredDeviceWorkers(
    value = dfarmingEnv('DEVICE_WORKERS') ?? '',
    token = dfarmingEnv('DEVICE_WORKER_TOKEN'),
): DeviceWorkerDescriptor[] {
    if (!value.trim()) return [];
    const seen = new Set<string>();
    return value.split(',').map((entry) => {
        const separator = entry.indexOf('=');
        if (separator <= 0) throw new Error('DFARMING_DEVICE_WORKERS must use id=http(s)://host:port entries');
        const id = entry.slice(0, separator).trim();
        const rawUrl = entry.slice(separator + 1).trim();
        if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/.test(id)) throw new Error(`Invalid device worker id: ${id}`);
        if (seen.has(id)) throw new Error(`Duplicate device worker id: ${id}`);
        seen.add(id);
        const url = new URL(rawUrl);
        if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
            throw new Error(`Invalid URL for device worker ${id}`);
        }
        url.pathname = url.pathname.replace(/\/+$/, '') || '/';
        return { id, url, ...(token ? { token } : {}) };
    });
}

export class DeviceWorkerClient {
    constructor(
        readonly descriptor: DeviceWorkerDescriptor,
        private readonly fetchImpl: typeof fetch = fetch,
    ) {}

    private url(pathname: string): URL {
        return new URL(pathname.replace(/^\//, ''), this.descriptor.url.href.endsWith('/') ? this.descriptor.url : new URL(`${this.descriptor.url.href}/`));
    }

    private async request(pathname: string, init: RequestInit = {}, timeoutMs = 15_000): Promise<Response> {
        const headers = new Headers(init.headers);
        if (this.descriptor.token) headers.set('authorization', `Bearer ${this.descriptor.token}`);
        const response = await this.fetchImpl(this.url(pathname), {
            ...init,
            headers,
            signal: init.signal
                ? AbortSignal.any([init.signal, AbortSignal.timeout(timeoutMs)])
                : AbortSignal.timeout(timeoutMs),
        });
        if (!response.ok) {
            const detail = (await response.text()).slice(0, 500);
            throw new Error(`Device worker ${this.descriptor.id} returned ${response.status}${detail ? `: ${detail}` : ''}`);
        }
        return response;
    }

    async health(): Promise<DeviceWorkerHealth> {
        const body = await (await this.request('/health', {}, 5_000)).json() as Partial<DeviceWorkerHealth>;
        if (body.ok !== true || body.role !== 'device-worker') throw new Error(`Device worker ${this.descriptor.id} returned an invalid health payload`);
        if (body.workerId !== this.descriptor.id) {
            throw new Error(`Device worker identity mismatch: configured ${this.descriptor.id}, reported ${String(body.workerId)}`);
        }
        if (body.protocolVersion !== DEVICE_WORKER_PROTOCOL_VERSION) {
            throw new Error(`Device worker ${this.descriptor.id} protocol ${String(body.protocolVersion)} is incompatible with control-plane protocol ${DEVICE_WORKER_PROTOCOL_VERSION}`);
        }
        if (!Array.isArray(body.platforms)
            || body.platforms.some((platform) => platform !== 'ios' && platform !== 'android')
            || new Set(body.platforms).size !== body.platforms.length) {
            throw new Error(`Device worker ${this.descriptor.id} returned an invalid platform declaration`);
        }
        return body as DeviceWorkerHealth;
    }

    async devices(): Promise<{ devices: DeviceWorkerDevice[]; warnings: string[] }> {
        const response = await this.request('/v1/devices');
        const body = record(await response.json());
        if (!Array.isArray(body?.devices)) throw new Error(`Device worker ${this.descriptor.id} returned an invalid device inventory`);
        const warnings: string[] = [];
        const devices = body.devices.flatMap((value) => {
            const result = sanitizedWorkerDevice(value);
            if (result.warning) warnings.push(result.warning);
            return result.device ? [result.device] : [];
        });
        return { devices, warnings };
    }

    async host(): Promise<HostSnapshot> {
        return sanitizedHostSnapshot(await (await this.request('/v1/host')).json(), this.descriptor);
    }

    async runtimeDevices(): Promise<RuntimeDevice[]> {
        const body = record(await (await this.request('/v1/runtime-devices')).json());
        if (!Array.isArray(body?.devices)) throw new Error(`Device worker ${this.descriptor.id} returned an invalid runtime inventory`);
        return body.devices.flatMap((value) => {
            const device = sanitizedRuntimeDevice(value);
            if (!device) console.warn(`Device worker ${this.descriptor.id}: ignored unsupported runtime advertisement`);
            return device ? [device] : [];
        });
    }

    async registerRuntimeDevice(udid: string, name?: string): Promise<void> {
        await this.request(`/v1/runtime-devices/${encodeURIComponent(udid)}/register`, {
            method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...(name ? { name } : {}) }),
        });
    }

    async virtualRuntimes(): Promise<VirtualRuntime[]> {
        const body = record(await (await this.request('/v1/virtual-runtimes')).json());
        if (!Array.isArray(body?.runtimes)) throw new Error(`Device worker ${this.descriptor.id} returned an invalid virtual-runtime inventory`);
        return body.runtimes.flatMap((value) => {
            const runtime = sanitizedVirtualRuntime(value);
            if (!runtime) console.warn(`Device worker ${this.descriptor.id}: ignored unsupported virtual-runtime advertisement`);
            return runtime ? [runtime] : [];
        });
    }

    async changeVirtualRuntimeState(platform: VirtualRuntimePlatform, id: string, action: 'boot' | 'shutdown'): Promise<void> {
        await this.request(`/v1/virtual-runtimes/${encodeURIComponent(platform)}/${encodeURIComponent(id)}/${action}`, { method: 'POST' }, 130_000);
    }

    async getScreenInfo(udid: string): Promise<ScreenInfo> {
        return await (await this.request(
            `/v1/devices/${encodeURIComponent(udid)}/info`,
            {},
            DEVICE_WORKER_REMOTE_OPERATION_TIMEOUT_MS,
        )).json() as ScreenInfo;
    }

    async getAccessibilityTree(udid: string): Promise<unknown> {
        return await (await this.request(
            `/v1/devices/${encodeURIComponent(udid)}/source`,
            {},
            DEVICE_WORKER_REMOTE_OPERATION_TIMEOUT_MS,
        )).json();
    }

    async getScreenshot(udid: string): Promise<Buffer> {
        const response = await this.request(
            `/v1/devices/${encodeURIComponent(udid)}/screenshot`,
            {},
            DEVICE_WORKER_REMOTE_OPERATION_TIMEOUT_MS,
        );
        return Buffer.from(await response.arrayBuffer());
    }

    async getMjpegStream(udid: string, signal?: AbortSignal): Promise<Response> {
        return this.request(
            `/v1/devices/${encodeURIComponent(udid)}/stream`,
            { signal },
            DEVICE_WORKER_REMOTE_OPERATION_TIMEOUT_MS,
        );
    }

    async getH264Stream(udid: string, signal?: AbortSignal): Promise<Response> {
        return this.request(
            `/v1/devices/${encodeURIComponent(udid)}/h264`,
            { signal },
            DEVICE_WORKER_REMOTE_OPERATION_TIMEOUT_MS,
        );
    }

    async performAction(udid: string, action: RemoteAction): Promise<void> {
        await this.request(`/v1/devices/${encodeURIComponent(udid)}/action`, {
            method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(action),
        }, DEVICE_WORKER_REMOTE_OPERATION_TIMEOUT_MS);
    }

    async isLocked(udid: string): Promise<boolean> {
        const body = await (await this.request(
            `/v1/devices/${encodeURIComponent(udid)}/locked`,
            {},
            DEVICE_WORKER_REMOTE_OPERATION_TIMEOUT_MS,
        )).json() as { locked: boolean };
        return body.locked;
    }

    async connection(udid: string): Promise<DeviceConnectionStatus> {
        return await (await this.request(`/v1/devices/${encodeURIComponent(udid)}/connection`)).json() as DeviceConnectionStatus;
    }

    async reconnect(udid: string): Promise<DeviceConnectionStatus | undefined> {
        const response = await this.request(`/v1/devices/${encodeURIComponent(udid)}/reconnect`, { method: 'POST' });
        return await response.json() as DeviceConnectionStatus | undefined;
    }

    async updateConfig(device: RegisteredDevice): Promise<void> {
        const body = {
            name: device.name,
            tags: device.tags ?? [],
            ...(device.coordinateProfile ? { coordinateProfile: device.coordinateProfile } : {}),
            ...(device.coordinates ? { coordinates: device.coordinates } : {}),
            ...(device.instagramCoordinates ? { instagramCoordinates: device.instagramCoordinates } : {}),
            ...(device.disabled === true ? { disabled: true } : { disabled: false }),
            pluginData: device.pluginData,
        };
        await this.request(`/v1/devices/${encodeURIComponent(device.udid)}/config`, {
            method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
        });
    }
}

export class DeviceWorkerFleet implements RemoteControl {
    private readonly clients: Map<string, DeviceWorkerClient>;
    private readonly ownership = new Map<string, string>();
    private readonly workerLogStates = new Map<string, string>();
    private snapshots: DeviceWorkerDevice[] = [];
    private hostSnapshots: HostSnapshot[] = [];

    constructor(
        descriptors: readonly DeviceWorkerDescriptor[],
        fetchImpl: typeof fetch = fetch,
        private readonly registryPath?: string,
        private readonly logger: Pick<Console, 'info' | 'warn'> = console,
    ) {
        this.clients = new Map(descriptors.map((descriptor) => [descriptor.id, new DeviceWorkerClient(descriptor, fetchImpl)]));
    }

    private logWorkerTransition(host: HostSnapshot): void {
        const state = host.online === false
            ? `offline:${host.error ?? ''}`
            : host.error
                ? `degraded:${host.error}`
                : 'healthy';
        const previous = this.workerLogStates.get(host.id);
        if (previous === state) return;
        this.workerLogStates.set(host.id, state);
        if (host.online === false) {
            this.logger.warn(`Device worker ${host.id} is unavailable${host.error ? `: ${host.error}` : ''}`);
            return;
        }
        if (host.error) {
            this.logger.warn(`Device worker ${host.id} is degraded: ${host.error}`);
            return;
        }
        if (previous && previous !== 'healthy') this.logger.info(`Device worker ${host.id} recovered`);
    }

    private unavailableHost(id: string, client: DeviceWorkerClient, error: unknown, online: boolean): HostSnapshot {
        return {
            id,
            hostname: client.descriptor.url.hostname,
            os: 'unknown',
            arch: 'unknown',
            online,
            observedAt: new Date().toISOString(),
            error: error instanceof Error ? error.message.slice(0, 300) : String(error).slice(0, 300),
            capabilities: [],
            tools: { appium: false, appiumRuntime: false, xcrun: false, adb: false, emulator: false, scrcpyVideo: false },
        };
    }

    async refresh(): Promise<DeviceWorkerDevice[]> {
        const batches = await Promise.all(Array.from(this.clients.entries(), async ([id, client]) => {
            try {
                await client.health();
                const inventory = await client.devices();
                let host = await client.host().catch((error) => this.unavailableHost(id, client, error, true));
                if (inventory.warnings.length) host = appendHostWarning(host, inventory.warnings.join('; '));
                const devices = inventory.devices;
                return { id, devices, host };
            } catch (error) {
                return { id, devices: [] as DeviceWorkerDevice[], host: this.unavailableHost(id, client, error, false) };
            }
        }));
        const hostById = new Map(batches.map(({ id, host }) => [id, host]));
        const advertisers = new Map<string, string[]>();
        for (const batch of batches) {
            for (const snapshot of batch.devices) {
                const ids = advertisers.get(snapshot.registered.udid) ?? [];
                ids.push(batch.id);
                advertisers.set(snapshot.registered.udid, ids);
            }
        }
        const duplicateUdids = new Set(Array.from(advertisers.entries()).filter(([, ids]) => new Set(ids).size > 1).map(([udid]) => udid));
        for (const udid of duplicateUdids) {
            const ids = [...new Set(advertisers.get(udid) ?? [])];
            for (const id of ids) {
                const host = hostById.get(id);
                if (host) hostById.set(id, appendHostWarning(host, `quarantined duplicate device ${udid} advertised by ${ids.join(', ')}`));
            }
        }
        this.hostSnapshots = batches.map(({ id, host }) => hostById.get(id) ?? host);
        this.hostSnapshots.forEach((host) => this.logWorkerTransition(host));
        const ownership = new Map<string, string>();
        const snapshots: DeviceWorkerDevice[] = [];
        for (const batch of batches) {
            for (const snapshot of batch.devices) {
                if (duplicateUdids.has(snapshot.registered.udid)) continue;
                ownership.set(snapshot.registered.udid, batch.id);
                snapshots.push(snapshot);
            }
        }
        await mutateRegisteredDevices((registered) => {
            for (const snapshot of snapshots) {
                const workerId = ownership.get(snapshot.registered.udid)!;
                const existing = registered.find(({ udid }) => udid === snapshot.registered.udid);
                if (existing) {
                    existing.workerId = workerId;
                    existing.name = snapshot.registered.name;
                    existing.osVersion = snapshot.registered.osVersion;
                    existing.productType = snapshot.registered.productType;
                    existing.platform = snapshot.registered.platform;
                    existing.kind = snapshot.registered.kind;
                    existing.automationBackend = snapshot.registered.automationBackend;
                    existing.tags = snapshot.registered.tags;
                    if (!existing.tags?.length) delete existing.tags;
                    if (!existing.coordinateProfile && snapshot.registered.coordinateProfile) existing.coordinateProfile = snapshot.registered.coordinateProfile;
                    continue;
                }
                registered.push({
                    name: snapshot.registered.name,
                    udid: snapshot.registered.udid,
                    workerId,
                    ...(snapshot.registered.osVersion ? { osVersion: snapshot.registered.osVersion } : {}),
                    ...(snapshot.registered.productType ? { productType: snapshot.registered.productType } : {}),
                    ...(snapshot.registered.platform ? { platform: snapshot.registered.platform } : {}),
                    ...(snapshot.registered.kind ? { kind: snapshot.registered.kind } : {}),
                    ...(snapshot.registered.automationBackend ? { automationBackend: snapshot.registered.automationBackend } : {}),
                    ...(snapshot.registered.tags?.length ? { tags: snapshot.registered.tags } : {}),
                    ...(snapshot.registered.coordinateProfile ? { coordinateProfile: snapshot.registered.coordinateProfile } : {}),
                    ...(snapshot.registered.coordinates ? { coordinates: snapshot.registered.coordinates } : {}),
                    ...(snapshot.registered.instagramCoordinates ? { instagramCoordinates: snapshot.registered.instagramCoordinates } : {}),
                    pluginData: snapshot.registered.pluginData ?? {},
                });
            }
        }, this.registryPath);
        this.ownership.clear();
        for (const [udid, id] of ownership) this.ownership.set(udid, id);
        this.snapshots = snapshots;
        const authoritative = await loadRegisteredDevices(this.registryPath);
        const syncResults = await Promise.allSettled(authoritative
            .filter(({ workerId }) => Boolean(workerId) && this.clients.has(workerId!))
            .map((device) => this.syncDeviceConfiguration(device)));
        syncResults.forEach((result) => {
            if (result.status === 'rejected') {
                this.logger.warn(`Device-worker configuration sync failed: ${result.reason instanceof Error ? result.reason.message : String(result.reason)}`);
            }
        });
        return snapshots;
    }

    hosts(): HostSnapshot[] { return this.hostSnapshots.map((host) => structuredClone(host)); }

    async runtimeCandidates(): Promise<Array<RuntimeDevice & { workerId: string }>> {
        const batches = await Promise.all(Array.from(this.clients.entries(), async ([workerId, client]) => {
            try { return (await client.runtimeDevices()).map((device) => ({ ...device, workerId })); }
            catch { return [] as Array<RuntimeDevice & { workerId: string }>; }
        }));
        return batches.flat();
    }

    async virtualRuntimes(): Promise<Array<VirtualRuntime & { workerId: string }>> {
        const batches = await Promise.all(Array.from(this.clients.entries(), async ([workerId, client]) => {
            try { return (await client.virtualRuntimes()).map((runtime) => ({ ...runtime, workerId })); }
            catch { return [] as Array<VirtualRuntime & { workerId: string }>; }
        }));
        return batches.flat();
    }

    async changeVirtualRuntimeState(workerId: string, platform: VirtualRuntimePlatform, id: string, action: 'boot' | 'shutdown'): Promise<void> {
        const client = this.clients.get(workerId);
        if (!client) throw Object.assign(new Error(`Unknown device worker ${workerId}`), { statusCode: 404 });
        await client.changeVirtualRuntimeState(platform, id, action);
    }

    async registerRuntime(workerId: string, udid: string, name?: string): Promise<void> {
        const client = this.clients.get(workerId);
        if (!client) throw Object.assign(new Error(`Unknown device worker ${workerId}`), { statusCode: 404 });
        await client.registerRuntimeDevice(udid, name);
        await this.refresh();
    }

    async discoverDevices(): Promise<Device[]> {
        return this.snapshots.flatMap(({ connected }) => connected ? [connected] : []);
    }

    forget(udid: string): void { this.ownership.delete(udid); }

    private async clientFor(udid: string): Promise<DeviceWorkerClient> {
        let workerId = this.ownership.get(udid);
        if (!workerId) workerId = (await loadRegisteredDevices(this.registryPath)).find((device) => device.udid === udid)?.workerId;
        const client = workerId ? this.clients.get(workerId) : undefined;
        if (!client) throw new Error(`No device worker is configured for ${udid}`);
        return client;
    }

    async getScreenInfo(udid: string): Promise<ScreenInfo> { return (await this.clientFor(udid)).getScreenInfo(udid); }
    async getAccessibilityTree(udid: string): Promise<unknown> { return (await this.clientFor(udid)).getAccessibilityTree(udid); }
    async getScreenshot(udid: string): Promise<Buffer> { return (await this.clientFor(udid)).getScreenshot(udid); }
    async getMjpegStream(udid: string, signal?: AbortSignal): Promise<Response> { return (await this.clientFor(udid)).getMjpegStream(udid, signal); }
    async getH264Stream(udid: string, signal?: AbortSignal): Promise<Response> { return (await this.clientFor(udid)).getH264Stream(udid, signal); }
    async performAction(udid: string, action: RemoteAction): Promise<void> { return (await this.clientFor(udid)).performAction(udid, action); }
    async isLocked(udid: string): Promise<boolean> { return (await this.clientFor(udid)).isLocked(udid); }
    async connectionStatus(udid: string): Promise<DeviceConnectionStatus> { return (await this.clientFor(udid)).connection(udid); }
    async reconnectDevice(udid: string): Promise<DeviceConnectionStatus | undefined> { return (await this.clientFor(udid)).reconnect(udid); }
    async syncDeviceConfiguration(device: RegisteredDevice): Promise<void> {
        if (!device.workerId) return;
        const client = this.clients.get(device.workerId);
        if (!client) throw new Error(`No device worker named ${device.workerId} is configured`);
        await client.updateConfig(device);
    }
}
