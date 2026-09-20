import cookie from '@fastify/cookie';
import formbody from '@fastify/formbody';
import multipart from '@fastify/multipart';
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import crypto from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, open, readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { Readable } from 'node:stream';

import { discoverConnectedDevices, type Device } from '../devices/discovery.js';
import { loadRegisteredDevices, mutateRegisteredDevices, normalizeDeviceTags, saveRegisteredDevices, redactDevice, PASSCODE_PATTERN, type RegisteredDevice } from '../devices/registry.js';
import {
    CALIBRATABLE_POINTS, labelsForApp, coordinatesForProfile, resolveDeviceCoordinates,
    validateCoordinateOverrides, parseSocialApp,
} from '../devices/coordinates.js';
import { RegistryWdaRemoteControl } from '../devices/registry-remote.js';
import type {
    DeviceRegistrationManager, RegistrationAction, RegistrationUpdate,
} from '../devices/registration.js';
import { type RemoteAction, type RemoteControl } from '../devices/wda-remote.js';
import { requestWdaService } from '../devices/wda-service-client.js';
import type { DeviceConnectionStatus } from '../devices/connection-manager.js';
import type { AuthProvider, PluginNavLink } from '../plugin.js';
import type { PluginRegistry } from '../registry.js';
import type { CreateTaskInput, JsonObject, JsonValue, ScheduleTiming } from '../types.js';
import { ScheduleTransitionError, type SchedulerRepository } from '../scheduler/repository.js';
import {
    listFleetAccounts, pluginIdForPlatform, SOCIAL_ACCOUNT_PLATFORMS, withAccountPolicy,
    type AccountAutomationPolicy, type SocialAccountPlatform,
} from '../accounts.js';
import { SemanticController } from '../semantic/controller.js';
import { planCampaign, type CreateCampaignInput } from '../campaigns.js';
import { buildFleetHealth } from '../analytics.js';
import { rankAllocationCandidates, type DeviceAllocationSelector } from '../allocation.js';
import { StreamTokenService } from '../security/stream-token.js';
import type { HostSnapshot } from '../hosts/capabilities.js';
import type { RuntimeDevice } from '../devices/runtime-discovery.js';
import type { VirtualRuntime, VirtualRuntimePlatform } from '../devices/virtual-runtime.js';
import { exportMaestroFlow, importMaestroFlow } from '../flows/maestro.js';
import type { PortableFlowPayload } from '../flow-plugin.js';

export interface CreateAppOptions {
    plugins: PluginRegistry;
    scheduler: SchedulerRepository;
    authProvider?: AuthProvider | null;
    dashboardTheme?: DashboardTheme;
    registrations?: DeviceRegistrationManager;
    logger?: boolean;
    remote?: RemoteControl;
    semanticTraceRoot?: string;
    requireStreamToken?: boolean;
    streamTokenSecret?: string;
    /** Physical discovery source. Control-plane deployments point this at remote Mac workers. */
    discoverDevices?: () => Promise<Device[]>;
    connectionStatus?: (udid: string) => Promise<DeviceConnectionStatus | undefined>;
    reconnectDevice?: (udid: string) => Promise<DeviceConnectionStatus | undefined>;
    syncDeviceConfiguration?: (device: RegisteredDevice) => Promise<void>;
    listHosts?: () => Promise<HostSnapshot[]> | HostSnapshot[];
    runtimeCandidates?: () => Promise<Array<RuntimeDevice & { workerId?: string }>>;
    registerRuntime?: (workerId: string | undefined, udid: string, name?: string) => Promise<void>;
    virtualRuntimes?: () => Promise<Array<VirtualRuntime & { workerId?: string }>>;
    changeVirtualRuntimeState?: (workerId: string | undefined, platform: VirtualRuntimePlatform, id: string, action: 'boot' | 'shutdown') => Promise<void>;
}

export interface DashboardTheme {
    rootDirectory: string;
    renderDevice?(template: string, device: RegisteredDevice): string;
}

interface LoadedDashboardTheme {
    indexHtml: string;
    deviceHtml: string;
    tasksHtml: string;
    automationsHtml: string;
    devicesDemoHtml: string;
    styles: string;
    overviewScript: string;
    deviceScript: string;
    tasksScript: string;
    automationsScript: string;
    registerDeviceHtml: string;
    registerDeviceScript: string;
    fleetScript: string;
    htmx: string;
}

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

/** Thrown inside route bodies / registry mutations; mapped to its status by setErrorHandler. */
function httpError(statusCode: number, message: string): Error & { statusCode: number } {
    return Object.assign(new Error(message), { statusCode });
}

function csrfBlocked(reply: FastifyReply): FastifyReply {
    return reply.code(403).send({
        error: 'Cross-origin write blocked. Send an Authorization: Bearer token for API clients, '
            + 'or add the origin to PHONE_FARM_TRUSTED_ORIGINS.',
    });
}

function internalWorkerAuthorized(request: FastifyRequest): boolean {
    const expected = process.env.PHONE_FARM_INTERNAL_TOKEN;
    if (!expected) return false;
    const header = request.headers.authorization;
    if (!header?.startsWith('Bearer ')) return false;
    const supplied = header.slice('Bearer '.length);
    const a = Buffer.from(expected);
    const b = Buffer.from(supplied);
    return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/** Farm-facing label stored in devices.json — independent of the iOS device name. */
function normalizeDeviceName(value: unknown): string {
    if (typeof value !== 'string') throw httpError(400, 'Device name must be a string');
    const name = value.replace(/\s+/g, ' ').trim().slice(0, 100);
    if (!name) throw httpError(400, 'Device name cannot be empty');
    return name;
}

function escapeHtml(value: unknown): string {
    return String(value ?? '').replace(/[&<>"']/g, (character) => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    })[character] ?? character);
}

function formatClock(ms: number): string {
    const totalSeconds = Math.max(0, Math.floor(ms / 1000));
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

function automationTimerHtml(execution: {
    status: string;
    startedAt: Date | null;
    finishedAt: Date | null;
    payload: JsonObject;
}): string {
    const durationMinutes = Number(execution.payload.durationMinutes);
    const hasDuration = Number.isFinite(durationMinutes) && durationMinutes > 0;
    const plannedMs = hasDuration ? durationMinutes * 60_000 : null;

    if (execution.status === 'running' && execution.startedAt) {
        const elapsedMs = Date.now() - execution.startedAt.getTime();
        if (plannedMs != null) {
            const remainingMs = Math.max(0, plannedMs - elapsedMs);
            const overtime = elapsedMs > plannedMs;
            return `<div class="run-timer" aria-live="polite"><span class="timer-label">Session timer</span><span class="timer-values">${escapeHtml(formatClock(elapsedMs))} elapsed · ${overtime ? 'past planned end' : `${escapeHtml(formatClock(remainingMs))} left`} · ${escapeHtml(String(durationMinutes))} min planned</span></div>`;
        }
        return `<div class="run-timer" aria-live="polite"><span class="timer-label">Session timer</span><span class="timer-values">${escapeHtml(formatClock(elapsedMs))} elapsed</span></div>`;
    }

    if (execution.status === 'queued' && plannedMs != null) {
        return `<div class="run-timer"><span class="timer-label">Session timer</span><span class="timer-values">Waiting to start · ${escapeHtml(String(durationMinutes))} min planned</span></div>`;
    }

    if (execution.startedAt && execution.finishedAt) {
        const elapsedMs = execution.finishedAt.getTime() - execution.startedAt.getTime();
        const planned = plannedMs != null ? ` · ${escapeHtml(String(durationMinutes))} min planned` : '';
        return `<div class="run-timer"><span class="timer-label">Session timer</span><span class="timer-values">Ran ${escapeHtml(formatClock(elapsedMs))}${planned}</span></div>`;
    }

    return '';
}

// Shown at the foot of every dashboard page. Override the link with
// PHONE_FARM_BRAND_URL; the text is fixed.
const FOOTER_HTML = `Built by <a href="${escapeHtml(process.env.PHONE_FARM_BRAND_URL ?? '#')}" target="_blank" rel="noopener">kevbuilds apps</a> with love &#10084;&#65039;`;

function page(title: string, body: string, logoutPath?: string, navLinks: readonly PluginNavLink[] = []): string {
    const logout = logoutPath ? `<a href="${escapeHtml(logoutPath)}" style="float:right;margin-right:0">Log out</a>` : '';
    const extra = navLinks.map((link) => `<a href="${escapeHtml(link.href)}">${escapeHtml(link.label)}</a>`).join('');
    return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(title)}</title><style>
:root{color-scheme:dark}body{font:15px Outfit,system-ui,sans-serif;margin:0;background:#000;color:#f7f7f8}nav{display:flex;flex-wrap:wrap;gap:14px;align-items:center;padding:14px 24px;background:#0c0c0e;border-bottom:1px solid rgb(255 255 255 / 10%)}nav a{color:#f7f7f8;text-decoration:none;font-weight:650}main{max-width:1100px;margin:24px auto;padding:0 20px}.card{background:#0c0c0e;border:1px solid rgb(255 255 255 / 10%);border-radius:14px;padding:18px;margin:14px 0}table{width:100%;border-collapse:collapse}th,td{text-align:left;padding:9px;border-bottom:1px solid rgb(255 255 255 / 8%)}code{font-size:12px}.muted{color:#8a8a93}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:14px}button,.button{background:linear-gradient(105deg,#ff4b2b,#ff416c);color:white;border:0;border-radius:999px;padding:8px 14px;text-decoration:none;cursor:pointer;font-weight:700}input,select,textarea{padding:8px;border:1px solid rgb(255 255 255 / 14%);border-radius:10px;background:#070708;color:#f7f7f8}</style></head>
<body><nav><a href="/">Devices</a><a href="/automations">Automations</a><a href="/tasks">Tasks</a><a href="/docs">API</a>${extra}${logout}</nav><main>${body}</main><footer style="max-width:1100px;margin:24px auto;padding:16px 20px;color:#5c5c66;font-size:12px">${FOOTER_HTML}</footer></body></html>`;
}

async function registeredWithStatus(discoverDevices: () => Promise<Device[]> = discoverConnectedDevices) {
    const [registered, connected] = await Promise.all([loadRegisteredDevices(), discoverDevices()]);
    const online = new Map(connected.map((device) => [device.udid, device]));
    return registered.map((device) => ({
        ...redactDevice(device),
        connected: device.disabled ? null : online.get(device.udid) ?? null,
    }));
}

export async function createApp(options: CreateAppOptions): Promise<FastifyInstance> {
    const app = Fastify({ logger: options.logger ?? false, bodyLimit: 50 * 1024 * 1024 });
    await app.register(formbody);
    await app.register(cookie);
    await app.register(multipart, { limits: { fileSize: 2 * 1024 * 1024 * 1024, files: 20 } });

    // Server-rendered HTML must never be cached — a stale page + fresh assets
    // (or vice versa) breaks the dashboard after a deploy.
    app.addHook('onSend', async (_request, reply) => {
        const type = reply.getHeader('content-type');
        if (typeof type === 'string' && type.includes('text/html') && !reply.hasHeader('cache-control')) {
            reply.header('cache-control', 'no-cache');
        }
    });

    // CSRF guard — runs for every deployment, auth or not. The default loopback
    // dashboard is otherwise open to form-encoded POSTs from any page the
    // operator has open in the same browser (tap the phone, stop executions,
    // launch tasks). A Bearer token means a real API client, not a browser form.
    app.addHook('onRequest', async (request, reply) => {
        if (['GET', 'HEAD', 'OPTIONS'].includes(request.method)) return;
        if (request.headers.authorization?.startsWith('Bearer ')) return;
        const origin = request.headers.origin;
        if (!origin) return csrfBlocked(reply);
        const configured = [process.env.PUBLIC_ORIGIN, ...(process.env.PHONE_FARM_TRUSTED_ORIGINS ?? '').split(',')]
            .map((value) => value?.trim().replace(/\/+$/, '')).filter((value): value is string => Boolean(value));
        if (configured.length) {
            if (!configured.includes(origin.replace(/\/+$/, ''))) return csrfBlocked(reply);
            return;
        }
        // Nothing configured: same-origin only, compared by host (ignoring
        // scheme) so a TLS-terminating proxy that doesn't forward
        // x-forwarded-proto still passes. URL normalises default ports, so
        // compare the Origin's host against the request Host under both schemes.
        // Set PHONE_FARM_TRUSTED_ORIGINS if the proxy also rewrites Host.
        let originHost: string;
        try { originHost = new URL(origin).host; } catch { return csrfBlocked(reply); }
        const hostMatches = ['http', 'https'].some((scheme) => {
            try { return new URL(`${scheme}://${request.headers.host}`).host === originHost; } catch { return false; }
        });
        if (!hostMatches) return csrfBlocked(reply);
    });

    if (options.authProvider) {
        await options.authProvider.registerRoutes(app);
        app.addHook('onRequest', async (request, reply) => {
            if (request.url.startsWith('/api/internal/worker/') && internalWorkerAuthorized(request)) return;
            if (options.authProvider?.isPublicPath(request.url.split('?')[0] ?? request.url)) return;
            const user = await options.authProvider?.authenticate(request, reply);
            if (!user && !reply.sent) await reply.code(401).send({ error: 'Authentication required' });
        });
    }

    const remote = options.remote ?? new RegistryWdaRemoteControl();
    const discoverDevices = options.discoverDevices ?? discoverConnectedDevices;
    const mutateDevices = async <T>(mutate: (devices: RegisteredDevice[]) => T | Promise<T>): Promise<T> => {
        const result = await mutateRegisteredDevices(mutate);
        if (options.syncDeviceConfiguration) {
            const devices = await loadRegisteredDevices();
            const outcomes = await Promise.allSettled(devices
                .filter(({ workerId }) => Boolean(workerId))
                .map((device) => options.syncDeviceConfiguration!(device)));
            outcomes.forEach((outcome) => {
                if (outcome.status === 'rejected') console.warn('Device-worker config sync failed:', errorMessage(outcome.reason));
            });
        }
        return result;
    };
    const semantic = new SemanticController(remote, options.semanticTraceRoot);
    const streamTokens = new StreamTokenService(options.streamTokenSecret ?? process.env.PHONE_FARM_STREAM_SECRET ?? crypto.randomBytes(32));
    const logoutPath = options.authProvider?.logoutPath;
    const authNavHtml = logoutPath
        ? `<a class="button secondary app-logout" href="${escapeHtml(logoutPath)}">Log out</a>` : '';
    const navLinks: PluginNavLink[] = options.plugins.list()
        .flatMap((plugin) => plugin.navLinks ?? [])
        .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    const pluginNavHtml = navLinks
        .map((link) => `<a class="button secondary" href="${escapeHtml(link.href)}">${escapeHtml(link.label)}</a>`)
        .join('');
    const renderPage = (title: string, body: string) => page(title, body, logoutPath, navLinks);
    const assetHash = (body: string) => crypto.createHash('sha1').update(body).digest('base64url').slice(0, 10);

    let themed: LoadedDashboardTheme | null = null;
    if (options.dashboardTheme) {
        const root = options.dashboardTheme.rootDirectory;
        const require = createRequire(import.meta.url);
        const [indexHtml, deviceHtml, tasksHtml, automationsHtml, registerDeviceHtml, devicesDemoHtml, styles, overviewScript, deviceScript, tasksScript, automationsScript, registerDeviceScript, fleetScript, htmx] = await Promise.all([
            readFile(path.join(root, 'templates/index.html'), 'utf8'),
            readFile(path.join(root, 'templates/device.html'), 'utf8'),
            readFile(path.join(root, 'templates/tasks.html'), 'utf8'),
            readFile(path.join(root, 'templates/automations.html'), 'utf8'),
            readFile(path.join(root, 'templates/register-device.html'), 'utf8'),
            readFile(path.join(root, 'templates/devices-demo.html'), 'utf8'),
            readFile(path.join(root, 'styles.css'), 'utf8'),
            readFile(path.join(root, 'assets/overview.js'), 'utf8'),
            readFile(path.join(root, 'assets/device.js'), 'utf8'),
            readFile(path.join(root, 'assets/tasks.js'), 'utf8'),
            readFile(path.join(root, 'assets/automations.js'), 'utf8'),
            readFile(path.join(root, 'assets/register-device.js'), 'utf8'),
            readFile(path.join(root, 'assets/fleet.js'), 'utf8'),
            readFile(require.resolve('htmx.org/dist/htmx.min.js'), 'utf8'),
        ]);
        // Content-hash every asset URL in the templates so a changed file gets a
        // fresh URL that no browser or CDN can serve stale.
        const versions: Record<string, string> = {
            'styles.css': assetHash(styles), 'overview.js': assetHash(overviewScript), 'device.js': assetHash(deviceScript),
            'tasks.js': assetHash(tasksScript), 'automations.js': assetHash(automationsScript),
            'register-device.js': assetHash(registerDeviceScript),
            'fleet.js': assetHash(fleetScript),
            'htmx.min.js': assetHash(htmx),
        };
        const finalize = (html: string) => {
            let out = html.replaceAll('__AUTH_NAV__', authNavHtml).replaceAll('__PLUGIN_NAV__', pluginNavHtml)
                .replaceAll('__FOOTER__', FOOTER_HTML);
            for (const [name, v] of Object.entries(versions)) out = out.replaceAll(`/assets/${name}`, `/assets/${name}?v=${v}`);
            return out;
        };
        themed = {
            indexHtml: finalize(indexHtml), deviceHtml: finalize(deviceHtml),
            tasksHtml: finalize(tasksHtml), automationsHtml: finalize(automationsHtml),
            registerDeviceHtml: finalize(registerDeviceHtml),
            devicesDemoHtml: finalize(devicesDemoHtml),
            styles, overviewScript, deviceScript, tasksScript, automationsScript, registerDeviceScript, fleetScript, htmx,
        };
    }

    const renderActivity = async (deviceUdid: string, message?: string): Promise<string> => {
        const executions = await options.scheduler.listExecutions(50, deviceUdid);
        const running = executions.filter(({ status }) => status === 'running');
        const queued = executions.filter(({ status }) => status === 'queued');
        const execution = running[0] ?? queued[0] ?? executions[0];
        const queueSummary = [
            running.length ? `${running.length} running` : null,
            queued.length ? `${queued.length} queued` : null,
        ].filter(Boolean).join(' · ') || 'idle';
        const clearQueue = (running.length + queued.length) > 0
            ? `<form class="queue-clear-form" hx-post="/api/devices/${encodeURIComponent(deviceUdid)}/queue/clear" hx-target="#device-activity" hx-swap="outerHTML"><button class="button danger" type="submit">Clear queue</button></form>`
            : '';
        if (!execution) {
            return `<section id="device-activity" class="run-panel"><div class="run-heading"><span class="status idle"><span class="dot"></span>idle</span><span class="run-meta">No automation has run on this device yet.</span></div>${message ? `<p class="run-error">${escapeHtml(message)}</p>` : ''}<pre>Waiting for output…</pre></section>`;
        }
        const detail = await options.scheduler.execution(execution.id);
        // A plugin (or task version) can be uninstalled while old executions
        // still reference it — degrade instead of throwing out of the fragment.
        let definition: { summarize(payload: JsonObject): string; supportsStop(payload: JsonObject): boolean } | undefined;
        try {
            definition = options.plugins.task({
                pluginId: execution.pluginId, taskType: execution.taskType,
                taskVersion: execution.taskVersion, payload: execution.payload,
            });
        } catch { /* plugin unavailable */ }
        const summary = definition
            ? definition.summarize(execution.payload)
            : `${execution.pluginId}/${execution.taskType}@${execution.taskVersion} (plugin not installed)`;
        const canStop = execution.status === 'queued' || (execution.status === 'running' && (definition?.supportsStop(execution.payload) ?? true));
        const stop = canStop
            ? `<form hx-post="/api/executions/${execution.id}/stop" hx-target="#device-activity" hx-swap="outerHTML"><button class="button secondary" type="submit">Stop current</button></form>` : '';
        const timer = automationTimerHtml(execution);
        return `<section id="device-activity" class="run-panel" hx-get="/api/devices/${encodeURIComponent(deviceUdid)}/fragments/activity" hx-trigger="every 1s" hx-swap="outerHTML"><div class="run-heading"><span class="status ${escapeHtml(execution.status)}"><span class="dot"></span>${escapeHtml(execution.status)}</span><span class="run-meta">${escapeHtml(summary)} · ${escapeHtml(execution.scheduledFor.toISOString())}</span></div>${timer}<div class="queue-bar"><span class="queue-summary"><span class="status ${queued.length || running.length ? 'queued' : 'idle'}"><span class="dot"></span></span>Queue: ${escapeHtml(queueSummary)}</span><div class="inline-actions">${clearQueue}${stop}</div></div>${message ? `<p class="run-error">${escapeHtml(message)}</p>` : ''}<pre>${detail?.logs.length ? detail.logs.map(escapeHtml).join('\n') : escapeHtml(execution.error ?? 'Waiting for worker output…')}</pre></section>`;
    };

    app.get('/health', async () => {
        const body: Record<string, unknown> = {
            ok: true,
            plugins: options.plugins.list().map(({ id, version }) => ({ id, version })),
        };
        // Deploy tooling writes a RELEASED file (sha, subject, deployedAt) into the
        // working directory; surface it so "what's live" is answerable over HTTP.
        try {
            body.release = JSON.parse(await readFile(path.resolve(process.env.PHONE_FARM_RELEASE_FILE ?? 'RELEASED'), 'utf8'));
        } catch { /* no release marker — fine */ }
        return body;
    });
    app.get('/api/plugins', async () => options.plugins.list().map((plugin) => ({
        id: plugin.id, version: plugin.version, displayName: plugin.displayName,
        tasks: plugin.tasks.map(({ type, version, displayName }) => ({ type, version, displayName })),
    })));
    app.get('/api/devices', async () => registeredWithStatus(discoverDevices));
    app.get('/api/hosts', async () => ({ hosts: await options.listHosts?.() ?? [] }));
    app.get('/api/accounts', async () => ({ accounts: listFleetAccounts(await loadRegisteredDevices()) }));
    app.get('/api/fleet/health', async () => {
        const [devices, registered, schedules, executions] = await Promise.all([
            registeredWithStatus(discoverDevices),
            loadRegisteredDevices(),
            options.scheduler.listSchedules(500),
            options.scheduler.listExecutions(500),
        ]);
        return buildFleetHealth(devices, listFleetAccounts(registered), schedules, executions);
    });
    app.patch<{
        Params: { udid: string; platform: string; handle: string };
        Body: AccountAutomationPolicy;
    }>('/api/devices/:udid/accounts/:platform/:handle/policy', async (request, reply) => {
        if (!(SOCIAL_ACCOUNT_PLATFORMS as readonly string[]).includes(request.params.platform)) {
            return reply.code(400).send({ error: 'Unsupported account platform' });
        }
        const platform = request.params.platform as SocialAccountPlatform;
        if (request.body.paused !== undefined && typeof request.body.paused !== 'boolean') {
            return reply.code(400).send({ error: 'paused must be boolean' });
        }
        if (request.body.allowedTaskTypes !== undefined && (!Array.isArray(request.body.allowedTaskTypes)
            || request.body.allowedTaskTypes.some((value) => typeof value !== 'string' || !/^[a-z][a-z0-9.-]*$/.test(value)))) {
            return reply.code(400).send({ error: 'allowedTaskTypes must contain task identifiers' });
        }
        if (request.body.note !== undefined && (typeof request.body.note !== 'string' || request.body.note.length > 240)) {
            return reply.code(400).send({ error: 'note must be at most 240 characters' });
        }
        const pluginId = pluginIdForPlatform(platform);
        let updated = false;
        await mutateDevices((devices) => {
            const device = devices.find(({ udid }) => udid === request.params.udid);
            if (!device) return;
            const data = device.pluginData[pluginId] ?? {};
            const accounts = Array.isArray(data.accounts) ? data.accounts.filter((value): value is string => typeof value === 'string') : [];
            const normalized = request.params.handle.startsWith('@') ? request.params.handle : `@${request.params.handle}`;
            if (!accounts.some((value) => (value.startsWith('@') ? value : `@${value}`) === normalized)) return;
            device.pluginData = {
                ...device.pluginData,
                [pluginId]: withAccountPolicy(data, normalized, platform, request.body),
            };
            updated = true;
        });
        if (!updated) return reply.code(404).send({ error: 'Configured account not found on this device' });
        const account = listFleetAccounts(await loadRegisteredDevices()).find((candidate) => (
            candidate.deviceUdid === request.params.udid && candidate.platform === platform
            && candidate.handle === (request.params.handle.startsWith('@') ? request.params.handle : `@${request.params.handle}`)
        ));
        return { account };
    });
    app.get('/api/devices/discovered', async () => discoverDevices());
    app.post<{
        Body: { deviceUdids?: string[]; action?: 'enable' | 'disable' | 'reconnect' | 'clear-queue' };
    }>('/api/fleet/actions', async (request, reply) => {
        const action = request.body.action;
        const deviceUdids = [...new Set((request.body.deviceUdids ?? []).filter((value): value is string => (
            typeof value === 'string' && value.trim().length > 0
        )).map((value) => value.trim()))];
        if (!action || !['enable', 'disable', 'reconnect', 'clear-queue'].includes(action)) {
            return reply.code(400).send({ error: 'Unsupported fleet action' });
        }
        if (!deviceUdids.length || deviceUdids.length > 100) {
            return reply.code(400).send({ error: 'Choose between 1 and 100 devices' });
        }
        const registered = await loadRegisteredDevices();
        const known = new Set(registered.map(({ udid }) => udid));
        const missing = deviceUdids.filter((udid) => !known.has(udid));
        if (missing.length) return reply.code(404).send({ error: `Unknown devices: ${missing.join(', ')}` });

        if (action === 'enable' || action === 'disable') {
            const disabled = action === 'disable';
            const blocked = new Set<string>();
            if (disabled) {
                for (const udid of deviceUdids) {
                    if (await options.scheduler.activeExecution(udid)) blocked.add(udid);
                }
            }
            await mutateDevices((devices) => {
                for (const device of devices) {
                    if (!deviceUdids.includes(device.udid) || blocked.has(device.udid)) continue;
                    if (disabled) device.disabled = true;
                    else delete device.disabled;
                }
            });
            const results = deviceUdids.map((udid) => blocked.has(udid)
                ? { udid, ok: false, message: 'automation is running; clear queue / stop before disabling' }
                : { udid, ok: true, message: disabled ? 'disabled' : 'enabled' });
            return { ok: results.every(({ ok }) => ok), action, affected: results.filter(({ ok }) => ok).length, results };
        }

        const results: Array<{ udid: string; ok: boolean; message: string }> = [];
        for (const udid of deviceUdids) {
            try {
                if (action === 'clear-queue') {
                    const cleared = await options.scheduler.clearDeviceQueue(udid);
                    results.push({ udid, ok: true, message: `cancelled ${cleared.cancelled}, stopping ${cleared.stopping}` });
                    continue;
                }
                if (await options.scheduler.activeExecution(udid)) {
                    results.push({ udid, ok: false, message: 'automation is running' });
                    continue;
                }
                remote.forget?.(udid);
                if (options.reconnectDevice) await options.reconnectDevice(udid);
                results.push({ udid, ok: true, message: 'reconnect requested' });
            } catch (error) {
                results.push({ udid, ok: false, message: errorMessage(error) });
            }
        }
        return { ok: results.every(({ ok }) => ok), action, results };
    });
    app.get('/api/runtime-devices/discovered', async () => ({ devices: await options.runtimeCandidates?.() ?? [] }));
    app.get('/api/virtual-runtimes', async () => ({ runtimes: await options.virtualRuntimes?.() ?? [] }));
    app.post<{
        Params: { workerId: string; platform: VirtualRuntimePlatform; id: string; action: 'boot' | 'shutdown' };
    }>('/api/virtual-runtimes/:workerId/:platform/:id/:action', async (request, reply) => {
        if (!options.changeVirtualRuntimeState) return reply.code(503).send({ error: 'Virtual runtime lifecycle is not configured' });
        if (!['ios', 'android'].includes(request.params.platform) || !['boot', 'shutdown'].includes(request.params.action)) {
            return reply.code(400).send({ error: 'Unsupported virtual runtime action' });
        }
        await options.changeVirtualRuntimeState(request.params.workerId === 'local' ? undefined : request.params.workerId,
            request.params.platform, request.params.id, request.params.action);
        return reply.code(202).send({ ok: true });
    });
    app.post<{ Body: { workerId?: string; udid?: string; name?: string } }>('/api/runtime-devices', async (request, reply) => {
        if (!options.registerRuntime) return reply.code(503).send({ error: 'Runtime registration is not configured' });
        if (!request.body.udid?.trim()) return reply.code(400).send({ error: 'Runtime device UDID is required' });
        await options.registerRuntime(request.body.workerId, request.body.udid.trim(), request.body.name?.trim());
        return reply.code(201).send({ ok: true });
    });
    app.get('/api/device-registrations/candidates', async (_request, reply) => {
        if (!options.registrations) return reply.code(503).send({ error: 'Device registration is not configured' });
        return { devices: await options.registrations.candidates() };
    });
    app.post<{ Body: { udid?: string } }>('/api/device-registrations', async (request, reply) => {
        if (!options.registrations) return reply.code(503).send({ error: 'Device registration is not configured' });
        if (!request.body.udid?.trim()) return reply.code(400).send({ error: 'Device UDID is required' });
        return reply.code(201).send(await options.registrations.create(request.body.udid.trim()));
    });
    app.get<{ Params: { id: string } }>('/api/device-registrations/:id', async (request, reply) => {
        if (!options.registrations) return reply.code(503).send({ error: 'Device registration is not configured' });
        return await options.registrations.get(request.params.id)
            ?? reply.code(404).send({ error: 'Registration draft not found' });
    });
    app.patch<{ Params: { id: string }; Body: RegistrationUpdate }>('/api/device-registrations/:id', async (request, reply) => {
        if (!options.registrations) return reply.code(503).send({ error: 'Device registration is not configured' });
        return options.registrations.update(request.params.id, request.body);
    });
    app.post<{ Params: { id: string; action: RegistrationAction }; Body: { authorizeTeamRegistration?: boolean } }>(
        '/api/device-registrations/:id/actions/:action', async (request, reply) => {
            if (!options.registrations) return reply.code(503).send({ error: 'Device registration is not configured' });
            if (!['refresh', 'prepare', 'verify', 'finalize'].includes(request.params.action)) {
                return reply.code(404).send({ error: 'Unknown registration action' });
            }
            return options.registrations.run(request.params.id, request.params.action, {
                authorizeTeamRegistration: request.body?.authorizeTeamRegistration === true,
            });
        },
    );
    app.delete<{ Params: { id: string } }>('/api/device-registrations/:id', async (request, reply) => {
        if (!options.registrations) return reply.code(503).send({ error: 'Device registration is not configured' });
        await options.registrations.cancel(request.params.id);
        return reply.code(204).send();
    });
    app.post<{ Body: { name?: string; udid?: string; tags?: string[]; wdaLocalPort?: number; mjpegLocalPort?: number; passcode?: string; coordinateProfile?: string; pluginData?: Record<string, JsonObject> } }>(
        '/api/devices', async (request, reply) => {
            const { name, udid, tags, wdaLocalPort, mjpegLocalPort, passcode, coordinateProfile, pluginData } = request.body;
            if (!udid) return reply.code(400).send({ error: 'A device UDID is required' });
            if (passcode !== undefined && !PASSCODE_PATTERN.test(passcode)) {
                return reply.code(400).send({ error: 'Device passcode must contain at least four digits' });
            }
            const created = await mutateDevices((devices) => {
                if (devices.some((device) => device.udid === udid)) throw httpError(409, 'A device with this UDID is already registered');
                // Explicit whitelist — never mass-assign arbitrary body keys into devices.json.
                const device: RegisteredDevice = {
                    name: name ?? udid, udid, pluginData: pluginData ?? {},
                    ...(tags !== undefined && normalizeDeviceTags(tags).length ? { tags: normalizeDeviceTags(tags) } : {}),
                    ...(wdaLocalPort !== undefined ? { wdaLocalPort } : {}),
                    ...(mjpegLocalPort !== undefined ? { mjpegLocalPort } : {}),
                    ...(coordinateProfile !== undefined ? { coordinateProfile: coordinateProfile as RegisteredDevice['coordinateProfile'] } : {}),
                    ...(passcode !== undefined ? { passcode } : {}),
                };
                devices.push(device);
                return device;
            });
            return reply.code(201).send(redactDevice(created));
        },
    );
    app.patch<{ Params: { udid: string }; Body: { name?: string; tags?: string[]; wdaLocalPort?: number; mjpegLocalPort?: number; passcode?: string; coordinates?: unknown; instagramCoordinates?: unknown; disabled?: boolean; coordinateProfile?: string; pluginData?: Record<string, JsonObject> } }>(
        '/api/devices/:udid', async (request, reply) => {
            const { passcode, coordinates, instagramCoordinates, name, tags, wdaLocalPort, mjpegLocalPort, disabled, coordinateProfile, pluginData } = request.body ?? {};
            if (passcode !== undefined && passcode !== '' && !PASSCODE_PATTERN.test(passcode)) {
                return reply.code(400).send({ error: 'Device passcode must contain at least four digits' });
            }
            if (disabled === true && await options.scheduler.activeExecution(request.params.udid)) {
                return reply.code(409).send({ error: 'Stop the running automation before disconnecting this device' });
            }
            const updated = await mutateDevices((devices) => {
                const device = devices.find((entry) => entry.udid === request.params.udid);
                if (!device) throw httpError(404, 'Device not found');
                if (name !== undefined) device.name = normalizeDeviceName(name);
                if (tags !== undefined) {
                    const normalized = normalizeDeviceTags(tags);
                    if (normalized.length) device.tags = normalized;
                    else delete device.tags;
                }
                if (wdaLocalPort !== undefined) device.wdaLocalPort = wdaLocalPort;
                if (mjpegLocalPort !== undefined) device.mjpegLocalPort = mjpegLocalPort;
                if (coordinateProfile !== undefined) device.coordinateProfile = coordinateProfile as RegisteredDevice['coordinateProfile'];
                if (pluginData !== undefined) device.pluginData = pluginData;
                if (disabled === true) device.disabled = true;
                else if (disabled === false) delete device.disabled;
                // passcode: a value sets it, '' clears it, omitting it leaves it
                if (passcode === '') delete device.passcode;
                else if (passcode !== undefined) device.passcode = passcode;
                // coordinates / instagramCoordinates: merge into the existing
                // override map so a TikTok save never clobbers Instagram (and
                // vice versa). Send {} to clear that app's overrides.
                if (coordinates !== undefined) {
                    const incoming = validateCoordinateOverrides(coordinates, device.coordinateProfile);
                    if (Object.keys(coordinates as object).length === 0) {
                        delete device.coordinates;
                    } else {
                        device.coordinates = { ...device.coordinates, ...incoming };
                    }
                }
                if (instagramCoordinates !== undefined) {
                    const incoming = validateCoordinateOverrides(instagramCoordinates, device.coordinateProfile);
                    if (Object.keys(instagramCoordinates as object).length === 0) {
                        delete device.instagramCoordinates;
                    } else {
                        device.instagramCoordinates = { ...device.instagramCoordinates, ...incoming };
                    }
                }
                return device;
            });
            remote.forget?.(request.params.udid);
            return redactDevice(updated);
        },
    );
    app.get<{ Params: { udid: string }; Querystring: { app?: string } }>('/api/devices/:udid/coordinates', async (request, reply) => {
        const device = (await loadRegisteredDevices()).find(({ udid }) => udid === request.params.udid);
        if (!device) return reply.code(404).send({ error: 'Device not found' });
        const app = parseSocialApp(request.query.app);
        const overrides = app === 'instagram' ? device.instagramCoordinates : device.coordinates;
        const base = coordinatesForProfile(device.coordinateProfile)[app];
        const effective = resolveDeviceCoordinates(device.coordinateProfile, overrides, app)[app];
        const labels = labelsForApp(app);
        return {
            app,
            profile: device.coordinateProfile ?? 'iphone8',
            screenSize: coordinatesForProfile(device.coordinateProfile).screenSize,
            points: CALIBRATABLE_POINTS.map((name) => ({
                name, label: labels[name],
                default: base[name], current: effective[name],
                overridden: Boolean(overrides?.[name]),
            })),
        };
    });
    app.delete<{ Params: { udid: string } }>('/api/devices/:udid', async (request, reply) => {
        const exists = (await loadRegisteredDevices()).some(({ udid }) => udid === request.params.udid);
        if (!exists) return reply.code(404).send({ error: 'Device not found' });
        if (await options.scheduler.activeExecution(request.params.udid)) {
            return reply.code(409).send({ error: 'Stop the running automation before removing this device' });
        }
        for (const schedule of await options.scheduler.listSchedules(500, request.params.udid)) {
            if (!['cancelled', 'completed'].includes(schedule.status)) {
                await options.scheduler.setScheduleStatus(schedule.id, 'cancelled');
            }
        }
        await mutateDevices((devices) => {
            const index = devices.findIndex(({ udid }) => udid === request.params.udid);
            if (index >= 0) devices.splice(index, 1);
        });
        remote.forget?.(request.params.udid);
        return reply.code(204).send();
    });
    app.post<{ Params: { udid: string } }>('/api/devices/:udid/checks', async (request, reply) => {
        const device = (await loadRegisteredDevices()).find(({ udid }) => udid === request.params.udid);
        if (!device) return reply.code(404).send({ error: 'Device not found' });
        const identity = (await discoverDevices()).find(({ udid }) => udid === device.udid) ?? device;
        const results = [];
        for (const plugin of options.plugins.list()) {
            for (const check of plugin.registrationChecks ?? []) {
                results.push({ pluginId: plugin.id, checkId: check.id, ...(await check.run(identity, device.pluginData[plugin.id] ?? {})) });
            }
        }
        return results;
    });

    // NB: /remote/screenshot and /remote/action below are the canonical
    // endpoints — they carry the activeExecution guard and the cached
    // per-device client. The old unprefixed /screenshot and /actions twins
    // that bypassed both were removed.
    app.get<{ Params: { udid: string } }>('/api/devices/:udid/remote/info', async (request, reply) => {
        const device = (await discoverDevices()).find(({ udid }) => udid === request.params.udid);
        if (!device) return reply.code(404).send({ error: 'Device is not connected' });
        return { device, screen: await remote.getScreenInfo(device.udid) };
    });
    app.get<{ Params: { udid: string } }>('/api/devices/:udid/remote/screenshot', async (request, reply) => {
        try {
            return reply.header('cache-control', 'no-store').type('image/png').send(await remote.getScreenshot(request.params.udid));
        } catch {
            // A flapping device shouldn't spew 500s into the log every 5s from the grid poll.
            return reply.code(503).header('cache-control', 'no-store').send();
        }
    });
    type FleetStreamLease = { abort: AbortController; done: Promise<void>; stop: () => Promise<void> };
    let fleetStreamLease: FleetStreamLease | undefined;
    app.post<{ Params: { udid: string }; Querystring: { scope?: string } }>('/api/devices/:udid/remote/stream-token', async (request) => {
        const base = `/api/devices/${encodeURIComponent(request.params.udid)}/remote/stream`;
        const scope = request.query.scope === 'fleet' ? 'fleet' : undefined;
        if (!options.requireStreamToken) {
            const query = new URLSearchParams({ t: String(Date.now()), ...(scope ? { scope } : {}) });
            return { url: `${base}?${query}`, expiresAt: null };
        }
        const capability = streamTokens.issue(request.params.udid);
        const query = new URLSearchParams({ exp: String(capability.expiresAt), sig: capability.signature, ...(scope ? { scope } : {}) });
        return { url: `${base}?${query}`, expiresAt: new Date(capability.expiresAt).toISOString() };
    });
    app.get<{
        Params: { udid: string };
        Querystring: { exp?: string; sig?: string; scope?: string };
    }>('/api/devices/:udid/remote/stream', async (request, reply) => {
        if (options.requireStreamToken) {
            const expiresAt = Number(request.query.exp);
            const signature = request.query.sig ?? '';
            if (!streamTokens.verify(request.params.udid, expiresAt, signature)) {
                return reply.code(403).send({ error: 'Stream capability is missing, invalid, or expired' });
            }
        }
        // Fleet has a stronger invariant than an ordinary device viewer: only
        // one focused upstream stream may exist at a time. `done` is tied to
        // the upstream fetch reader (not merely the downstream browser reply),
        // so the next focus cannot open until the worker connection has been
        // cancelled and given a short quiescence window to release its socket.
        if (request.query.scope === 'fleet' && fleetStreamLease) {
            const previous = fleetStreamLease;
            const stopped = await Promise.race([
                previous.stop().then(() => true),
                new Promise<false>((resolve) => setTimeout(() => resolve(false), 2_000)),
            ]);
            if (!stopped) return reply.code(409).send({ error: 'Previous focused fleet stream is still closing; retry live.' });
            if (fleetStreamLease === previous) fleetStreamLease = undefined;
        }

        const abort = new AbortController();
        let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
        let resolveDone!: () => void;
        let doneResolved = false;
        const done = new Promise<void>((resolve) => { resolveDone = resolve; });
        const finishUpstream = async () => {
            if (doneResolved) return;
            doneResolved = true;
            try { await reader?.cancel(); } catch { /* already aborted/closed */ }
            // Undici/Node may resolve reader.cancel() before the remote HTTP
            // peer observes the FIN. One frame interval is enough for the
            // worker to observe cancellation before another Fleet stream is
            // permitted, avoiding transient double-stream CPU/network load.
            await new Promise<void>((resolve) => setTimeout(resolve, 350));
            resolveDone();
        };
        let stopPromise: Promise<void> | undefined;
        const stop = () => {
            if (!stopPromise) {
                stopPromise = (async () => {
                    abort.abort();
                    try { await reader?.cancel(); } catch { /* reader may already be closed */ }
                    await done;
                })();
            }
            return stopPromise;
        };
        const isFleetStream = request.query.scope === 'fleet';
        const lease: FleetStreamLease = { abort, done, stop };
        if (isFleetStream) {
            fleetStreamLease = lease;
            reply.raw.once('close', () => { void stop(); });
        } else {
            // Ordinary single-device viewers do not share the Fleet lease but
            // still cancel their upstream fetch as soon as the browser leaves.
            request.raw.once('close', () => abort.abort());
        }
        try {
            const upstream = await remote.getMjpegStream(request.params.udid, abort.signal);
            if (!upstream.body) {
                await finishUpstream();
                if (fleetStreamLease === lease) fleetStreamLease = undefined;
                return reply.code(503).send({ error: 'Device stream is unavailable' });
            }
            reader = upstream.body.getReader();
            const streamBody = async function* () {
                try {
                    while (true) {
                        const chunk = await reader!.read();
                        if (chunk.done) break;
                        if (chunk.value) yield chunk.value;
                    }
                } finally {
                    await finishUpstream();
                    if (fleetStreamLease === lease) fleetStreamLease = undefined;
                }
            };
            return reply.header('cache-control', 'no-store, no-cache, must-revalidate')
                .type(upstream.headers.get('content-type') ?? 'multipart/x-mixed-replace; boundary=--BoundaryString')
                .send(Readable.from(streamBody()));
        } catch (error) {
            await finishUpstream();
            if (fleetStreamLease === lease) fleetStreamLease = undefined;
            throw error;
        }
    });
    app.post<{ Params: { udid: string } }>('/api/devices/:udid/remote/h264-token', async (request, reply) => {
        if (!remote.getH264Stream) return reply.code(501).send({ error: 'Optimized H.264 transport is unavailable' });
        const base = `/api/devices/${encodeURIComponent(request.params.udid)}/remote/h264`;
        if (!options.requireStreamToken) return { url: `${base}?t=${Date.now()}`, expiresAt: null };
        const capability = streamTokens.issue(request.params.udid);
        const query = new URLSearchParams({ exp: String(capability.expiresAt), sig: capability.signature });
        return { url: `${base}?${query}`, expiresAt: new Date(capability.expiresAt).toISOString() };
    });
    app.get<{
        Params: { udid: string };
        Querystring: { exp?: string; sig?: string };
    }>('/api/devices/:udid/remote/h264', async (request, reply) => {
        if (!remote.getH264Stream) return reply.code(501).send({ error: 'Optimized H.264 transport is unavailable' });
        if (options.requireStreamToken) {
            const expiresAt = Number(request.query.exp);
            const signature = request.query.sig ?? '';
            if (!streamTokens.verify(request.params.udid, expiresAt, signature)) {
                return reply.code(403).send({ error: 'Stream capability is missing, invalid, or expired' });
            }
        }
        const abort = new AbortController();
        request.raw.once('close', () => abort.abort());
        try {
            const upstream = await remote.getH264Stream(request.params.udid, abort.signal);
            if (!upstream.body) return reply.code(503).send({ error: 'H.264 stream is unavailable' });
            return reply.header('cache-control', 'no-store, no-cache, must-revalidate')
                .header('x-mobile-farm-video-backend', upstream.headers.get('x-mobile-farm-video-backend') ?? 'h264')
                .type(upstream.headers.get('content-type') ?? 'video/h264')
                .send(Readable.from(upstream.body as AsyncIterable<Uint8Array>));
        } catch (error) {
            return reply.code(503).send({ error: errorMessage(error) });
        }
    });
    app.post<{ Params: { udid: string }; Body: RemoteAction }>('/api/devices/:udid/remote/action', async (request, reply) => {
        if (await options.scheduler.activeExecution(request.params.udid)) {
            return reply.code(409).send({ error: 'Remote input is disabled while automation is running' });
        }
        await remote.performAction(request.params.udid, request.body);
        return { ok: true };
    });
    app.get<{
        Params: { udid: string };
        Querystring: { query?: string; maxNodes?: string };
    }>('/api/devices/:udid/semantic/snapshot', async (request) => semantic.snapshot(request.params.udid, {
        ...(request.query.query ? { query: request.query.query } : {}),
        ...(request.query.maxNodes ? { maxNodes: Number(request.query.maxNodes) } : {}),
    }));
    app.post<{
        Params: { udid: string };
        Body: { generation: number; ref: string };
    }>('/api/devices/:udid/semantic/tap', async (request, reply) => {
        if (await options.scheduler.activeExecution(request.params.udid)) {
            return reply.code(409).send({ error: 'Semantic input is disabled while automation is running' });
        }
        return semantic.tapRef(request.params.udid, request.body.generation, request.body.ref);
    });
    app.post<{
        Params: { udid: string };
        Body: { text: string };
    }>('/api/devices/:udid/semantic/type', async (request, reply) => {
        if (await options.scheduler.activeExecution(request.params.udid)) {
            return reply.code(409).send({ error: 'Semantic input is disabled while automation is running' });
        }
        return semantic.typeText(request.params.udid, request.body.text);
    });
    app.post<{
        Params: { udid: string };
        Body: { text: string; type?: string; timeoutMs?: number; pollMs?: number };
    }>('/api/devices/:udid/semantic/wait', async (request) => semantic.waitForText(request.params.udid, request.body.text, {
        ...(request.body.type ? { type: request.body.type } : {}),
        ...(request.body.timeoutMs !== undefined ? { timeoutMs: request.body.timeoutMs } : {}),
        ...(request.body.pollMs !== undefined ? { pollMs: request.body.pollMs } : {}),
    }));
    app.get<{ Params: { udid: string } }>('/api/devices/:udid/connection', async (request, reply) => {
        const registered = (await loadRegisteredDevices()).find(({ udid }) => udid === request.params.udid);
        if (!registered) return reply.code(404).send({ error: 'Device is not registered' });
        if (options.connectionStatus) {
            const status = await options.connectionStatus(registered.udid);
            return status ?? reply.code(503).send({ error: 'Owning device worker is unavailable' });
        }
        // Prefer the real per-device state the wda-service supervisor tracks
        // (physical, wda, appium, retryCount, message).
        try {
            const response = await requestWdaService('/devices', { timeoutMs: 2_000 });
            if (response.statusCode >= 200 && response.statusCode < 300) {
                const status = (JSON.parse(response.body).devices as DeviceConnectionStatus[])
                    .find((entry) => entry.udid === registered.udid);
                if (status) return status;
            }
        } catch { /* supervisor socket unavailable — fall back to a probe */ }
        const connected = (await discoverDevices()).some(({ udid }) => udid === registered.udid);
        let wda = false;
        try {
            wda = (await fetch(`http://127.0.0.1:${registered.wdaLocalPort ?? 8100}/status`, { signal: AbortSignal.timeout(2_000) })).ok;
        } catch { /* WDA not up */ }
        const fallback: DeviceConnectionStatus = {
            udid: registered.udid, physical: connected ? 'connected' : 'disconnected',
            wda: wda ? 'ready' : connected ? 'connecting' : 'disconnected', appium: 'unavailable',
            managed: false, message: wda ? 'WDA is ready' : connected ? 'Waiting for WDA' : 'Reconnect the USB cable',
            retryCount: 0, updatedAt: new Date().toISOString(),
        };
        return fallback;
    });
    app.post<{ Params: { udid: string } }>('/api/devices/:udid/reconnect', async (request, reply) => {
        if (await options.scheduler.activeExecution(request.params.udid)) {
            return reply.code(409).send({ error: 'Cannot reconnect while automation is running' });
        }
        remote.forget?.(request.params.udid);
        if (options.reconnectDevice) {
            const status = await options.reconnectDevice(request.params.udid);
            return reply.code(202).send(status ?? { ok: true, message: 'Reconnect requested on device worker' });
        }
        return reply.code(202).send({ ok: true, message: 'The shared WDA supervisor will reconnect automatically' });
    });

    app.get<{ Querystring: { deviceUdid?: string } }>('/api/schedules', async (request) => ({
        schedules: await options.scheduler.listSchedules(200, request.query.deviceUdid),
    }));
    const validatedFlowPayload = (value: JsonValue): JsonObject => {
        const definition = options.plugins.task({
            pluginId: 'com.phone-farm.flow', taskType: 'flow', taskVersion: 1, payload: {},
        });
        return definition.validate(value, { timingKind: 'now', devicePluginData: {} });
    };
    app.get('/api/flows', async () => ({ flows: await options.scheduler.listFlowDefinitions(200) }));
    app.post<{ Body: JsonObject }>('/api/flows', async (request, reply) => {
        const flow = await options.scheduler.createFlowDefinition(validatedFlowPayload(request.body));
        return reply.code(201).send({ flow });
    });
    app.post<{ Body: { format?: string; flow?: JsonValue } }>('/api/flows/import', async (request, reply) => {
        if (request.body.format !== 'mobile-farm-flow@1' || !request.body.flow) {
            return reply.code(400).send({ error: 'Expected a mobile-farm-flow@1 export' });
        }
        const flow = await options.scheduler.createFlowDefinition(validatedFlowPayload(request.body.flow));
        return reply.code(201).send({ flow });
    });
    app.post<{ Body: { yaml?: string; name?: string } }>('/api/flows/import/maestro', async (request, reply) => {
        if (typeof request.body.yaml !== 'string') return reply.code(400).send({ error: 'yaml is required' });
        if (request.body.name !== undefined && (typeof request.body.name !== 'string' || request.body.name.length > 120)) {
            return reply.code(400).send({ error: 'name must be at most 120 characters' });
        }
        const imported = importMaestroFlow(request.body.yaml, request.body.name);
        const flow = await options.scheduler.createFlowDefinition(validatedFlowPayload(imported));
        return reply.code(201).send({ flow });
    });
    app.get<{ Params: { id: string }; Querystring: { version?: string } }>('/api/flows/:id', async (request, reply) => {
        const version = request.query.version === undefined ? undefined : Number(request.query.version);
        if (version !== undefined && (!Number.isInteger(version) || version < 1)) {
            return reply.code(400).send({ error: 'version must be a positive integer' });
        }
        const flow = await options.scheduler.flowDefinition(request.params.id, version);
        return flow ? { flow } : reply.code(404).send({ error: 'Flow not found' });
    });
    app.put<{ Params: { id: string }; Body: JsonObject }>('/api/flows/:id', async (request, reply) => {
        const flow = await options.scheduler.saveFlowVersion(request.params.id, validatedFlowPayload(request.body));
        return flow ? { flow } : reply.code(404).send({ error: 'Flow not found' });
    });
    app.post<{ Params: { id: string }; Body: { name?: string } }>('/api/flows/:id/duplicate', async (request, reply) => {
        if (request.body.name !== undefined && (typeof request.body.name !== 'string' || request.body.name.trim().length > 120)) {
            return reply.code(400).send({ error: 'name must contain at most 120 characters' });
        }
        const flow = await options.scheduler.duplicateFlowDefinition(request.params.id, request.body.name);
        return flow ? reply.code(201).send({ flow }) : reply.code(404).send({ error: 'Flow not found' });
    });
    app.post<{ Params: { id: string }; Body: { version?: number } }>('/api/flows/:id/restore', async (request, reply) => {
        if (!Number.isInteger(request.body.version) || Number(request.body.version) < 1) {
            return reply.code(400).send({ error: 'version must be a positive integer' });
        }
        const flow = await options.scheduler.restoreFlowVersion(request.params.id, Number(request.body.version));
        return flow ? { flow } : reply.code(404).send({ error: 'Flow/version not found' });
    });
    app.get<{ Params: { id: string } }>('/api/flows/:id/export', async (request, reply) => {
        const flow = await options.scheduler.flowDefinition(request.params.id);
        if (!flow) return reply.code(404).send({ error: 'Flow not found' });
        const safeName = flow.name.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'flow';
        return reply.header('content-disposition', `attachment; filename="${safeName}.mobile-flow.json"`)
            .send({ format: 'mobile-farm-flow@1', exportedAt: new Date().toISOString(), flow: flow.payload });
    });
    app.get<{ Params: { id: string } }>('/api/flows/:id/export/maestro', async (request, reply) => {
        const flow = await options.scheduler.flowDefinition(request.params.id);
        if (!flow) return reply.code(404).send({ error: 'Flow not found' });
        const yaml = exportMaestroFlow(flow.payload as PortableFlowPayload);
        const safeName = flow.name.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'flow';
        return reply.header('content-disposition', `attachment; filename="${safeName}.maestro.yaml"`)
            .type('application/yaml; charset=utf-8').send(yaml);
    });
    app.delete<{ Params: { id: string } }>('/api/flows/:id', async (request, reply) => (
        await options.scheduler.deleteFlowDefinition(request.params.id)
            ? reply.code(204).send()
            : reply.code(404).send({ error: 'Flow not found' })
    ));
    app.get('/api/campaigns', async () => ({ campaigns: await options.scheduler.listCampaigns(200) }));
    app.post<{ Body: CreateCampaignInput }>('/api/campaigns', async (request, reply) => {
        const devices = await loadRegisteredDevices();
        const pluginDataByDevice = new Map(devices.map((device) => [
            device.udid, device.pluginData[request.body.task.pluginId] ?? {},
        ]));
        const plan = planCampaign(options.plugins, request.body, pluginDataByDevice);
        if (plan.targets.some((target) => devices.find(({ udid }) => udid === target.deviceUdid)?.disabled)) {
            return reply.code(409).send({ error: 'Campaign targets include a disabled device' });
        }
        const campaign = await options.scheduler.createCampaign(plan);
        return reply.code(201).send({ campaign, plan: {
            targetCount: plan.targets.length,
            requiresFanOutConfirmation: plan.requiresFanOutConfirmation,
            requiresPublicActionConfirmation: plan.requiresPublicActionConfirmation,
        } });
    });
    app.post<{
        Params: { id: string };
        Body: { confirmFanOut?: boolean; confirmPublicActions?: boolean };
    }>('/api/campaigns/:id/launch', async (request, reply) => {
        const campaign = await options.scheduler.campaign(request.params.id);
        if (!campaign) return reply.code(404).send({ error: 'Campaign not found' });
        const devices = await loadRegisteredDevices();
        const pluginDataByDevice = new Map(devices.map((device) => [
            device.udid, device.pluginData[campaign.task.pluginId] ?? {},
        ]));
        const plan = planCampaign(options.plugins, {
            name: campaign.name,
            task: campaign.task,
            timing: campaign.timing,
            runWindowMinutes: campaign.runWindowMinutes,
            targets: campaign.targets,
        }, pluginDataByDevice);
        if (plan.targets.some((target) => devices.find(({ udid }) => udid === target.deviceUdid)?.disabled)) {
            return reply.code(409).send({ error: 'Campaign targets include a disabled device' });
        }
        try {
            return await options.scheduler.launchCampaign(request.params.id, plan, {
                fanOut: request.body.confirmFanOut,
                publicActions: request.body.confirmPublicActions,
            });
        } catch (error) {
            return reply.code(409).send({ error: errorMessage(error) });
        }
    });
    app.post<{ Params: { id: string } }>('/api/campaigns/:id/cancel', async (request, reply) => {
        const campaign = await options.scheduler.cancelCampaign(request.params.id);
        return campaign ?? reply.code(404).send({ error: 'Campaign not found' });
    });
    app.get<{ Querystring: { deviceUdid?: string } }>('/api/executions', async (request) => ({
        executions: await options.scheduler.listExecutions(200, request.query.deviceUdid),
    }));
    app.get<{ Params: { id: string } }>('/api/executions/:id', async (request, reply) => {
        const execution = await options.scheduler.execution(request.params.id);
        return execution ?? reply.code(404).send({ error: 'Execution not found' });
    });
    const validatedAllocationSelector = (selector: DeviceAllocationSelector | undefined): DeviceAllocationSelector => {
        const value = selector ?? {};
        if (value.platform !== undefined && !['ios', 'android'].includes(value.platform)) throw httpError(400, 'target.platform must be ios or android');
        if (value.kind !== undefined && !['physical', 'simulator', 'emulator'].includes(value.kind)) throw httpError(400, 'target.kind is invalid');
        if (value.workerId !== undefined && !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/.test(value.workerId)) throw httpError(400, 'target.workerId is invalid');
        if (value.requireIdle !== undefined && typeof value.requireIdle !== 'boolean') throw httpError(400, 'target.requireIdle must be boolean');
        if (value.deviceUdids !== undefined && (!Array.isArray(value.deviceUdids) || value.deviceUdids.length > 100
            || value.deviceUdids.some((udid) => typeof udid !== 'string' || !udid.trim()))) {
            throw httpError(400, 'target.deviceUdids must contain at most 100 non-empty ids');
        }
        let tags: string[] | undefined;
        try { tags = value.tags === undefined ? undefined : normalizeDeviceTags(value.tags); }
        catch (error) { throw httpError(400, errorMessage(error)); }
        return {
            ...(value.platform ? { platform: value.platform } : {}),
            ...(value.kind ? { kind: value.kind } : {}),
            ...(value.workerId ? { workerId: value.workerId } : {}),
            ...(value.deviceUdids ? { deviceUdids: [...new Set(value.deviceUdids.map((udid) => udid.trim()))] } : {}),
            ...(tags?.length ? { tags } : {}),
            ...(value.requireIdle !== undefined ? { requireIdle: value.requireIdle } : {}),
        };
    };
    const poolName = (value: unknown): string => {
        if (typeof value !== 'string') throw httpError(400, 'Pool name is required');
        const name = value.replace(/\s+/g, ' ').trim();
        if (!name || name.length > 80) throw httpError(400, 'Pool name must contain 1 to 80 characters');
        return name;
    };
    const selectorJson = (selector: DeviceAllocationSelector): JsonObject => structuredClone(selector) as unknown as JsonObject;
    const assertUniquePoolName = async (name: string, excludeId?: string): Promise<void> => {
        const normalized = name.toLocaleLowerCase();
        const duplicate = (await options.scheduler.listDevicePools(500))
            .find((pool) => pool.id !== excludeId && pool.name.toLocaleLowerCase() === normalized);
        if (duplicate) throw httpError(409, `A device pool named “${name}” already exists`);
    };
    const resolveAllocationSelector = async (input: { poolId?: string; target?: DeviceAllocationSelector }): Promise<DeviceAllocationSelector> => {
        if (input.poolId) {
            if (input.target && Object.keys(input.target).length) throw httpError(400, 'Use either poolId or target, not both');
            const pool = await options.scheduler.devicePool(input.poolId);
            if (!pool) throw httpError(404, 'Device pool not found');
            return validatedAllocationSelector(pool.selector as unknown as DeviceAllocationSelector);
        }
        return validatedAllocationSelector(input.target);
    };
    app.get('/api/pools', async () => ({ pools: await options.scheduler.listDevicePools(200) }));
    app.post<{ Body: { name?: string; selector?: DeviceAllocationSelector } }>('/api/pools', async (request, reply) => {
        const selector = validatedAllocationSelector(request.body.selector);
        const name = poolName(request.body.name);
        await assertUniquePoolName(name);
        const pool = await options.scheduler.createDevicePool(name, selectorJson(selector));
        return reply.code(201).send({ pool });
    });
    app.get<{ Params: { id: string } }>('/api/pools/:id', async (request, reply) => {
        const pool = await options.scheduler.devicePool(request.params.id);
        return pool ? { pool } : reply.code(404).send({ error: 'Device pool not found' });
    });
    app.put<{ Params: { id: string }; Body: { name?: string; selector?: DeviceAllocationSelector } }>('/api/pools/:id', async (request, reply) => {
        const selector = validatedAllocationSelector(request.body.selector);
        const name = poolName(request.body.name);
        await assertUniquePoolName(name, request.params.id);
        const pool = await options.scheduler.updateDevicePool(request.params.id, name, selectorJson(selector));
        return pool ? { pool } : reply.code(404).send({ error: 'Device pool not found' });
    });
    app.delete<{ Params: { id: string } }>('/api/pools/:id', async (request, reply) => (
        await options.scheduler.deleteDevicePool(request.params.id)
            ? reply.code(204).send()
            : reply.code(404).send({ error: 'Device pool not found' })
    ));
    const allocationCandidates = async (selector: DeviceAllocationSelector) => {
        const [registered, connected, executions, schedules] = await Promise.all([
            loadRegisteredDevices(), discoverDevices(), options.scheduler.listExecutions(500), options.scheduler.listSchedules(500),
        ]);
        return rankAllocationCandidates(
            registered, new Set(connected.map(({ udid }) => udid)), executions, schedules, selector,
        );
    };
    app.post<{ Body: { target?: DeviceAllocationSelector; poolId?: string } }>('/api/allocation/preview', async (request) => ({
        candidates: await allocationCandidates(await resolveAllocationSelector(request.body)),
    }));
    app.post<{
        Body: Omit<CreateTaskInput, 'deviceUdid'> & { target?: DeviceAllocationSelector; poolId?: string; assetIds?: string[] };
    }>('/api/schedules/allocate', async (request, reply) => {
        const selector = await resolveAllocationSelector(request.body);
        const candidate = (await allocationCandidates(selector))[0];
        if (!candidate) return reply.code(409).send({ error: 'No connected device matches this allocation target' });
        const device = (await loadRegisteredDevices()).find(({ udid }) => udid === candidate.udid);
        if (!device || device.disabled) return reply.code(409).send({ error: 'Allocated device is no longer available' });
        const backend = device.automationBackend
            ?? ((device.platform ?? 'ios') === 'ios' && (device.kind ?? 'physical') === 'physical' ? 'wda' : 'appium');
        if (backend === 'appium' && ['com.git-agni.tiktok', 'com.git-agni.instagram'].includes(request.body.task.pluginId)) {
            return reply.code(409).send({ error: 'This social recipe is currently iOS/WDA-specific. Use a Portable Flow on Appium runtimes.' });
        }
        const input: CreateTaskInput = {
            deviceUdid: candidate.udid,
            task: request.body.task,
            timing: request.body.timing,
            ...(request.body.runWindowMinutes !== undefined ? { runWindowMinutes: request.body.runWindowMinutes } : {}),
        };
        const schedule = await options.scheduler.createTask(
            input, device.pluginData[input.task.pluginId] ?? {}, new Date(), request.body.assetIds ?? [],
        );
        return reply.code(201).send({ schedule, allocation: candidate });
    });
    app.post<{ Body: CreateTaskInput & { assetIds?: string[] } }>('/api/schedules', async (request, reply) => {
        const device = (await loadRegisteredDevices()).find(({ udid }) => udid === request.body.deviceUdid);
        if (!device) return reply.code(404).send({ error: 'Device not found' });
        if (device.disabled) return reply.code(409).send({ error: 'This device is disabled — activate it before scheduling automation' });
        const backend = device.automationBackend
            ?? ((device.platform ?? 'ios') === 'ios' && (device.kind ?? 'physical') === 'physical' ? 'wda' : 'appium');
        if (backend === 'appium' && ['com.git-agni.tiktok', 'com.git-agni.instagram'].includes(request.body.task.pluginId)) {
            return reply.code(409).send({ error: 'This social recipe is currently iOS/WDA-specific. Use a Portable Flow on Appium runtimes.' });
        }
        const schedule = await options.scheduler.createTask(
            request.body, device.pluginData[request.body.task.pluginId] ?? {}, new Date(), request.body.assetIds ?? [],
        );
        return reply.code(201).send(schedule);
    });
    app.patch<{
        Params: { id: string };
        Body: { timing?: ScheduleTiming; runWindowMinutes?: number; recurringPublishConfirmed?: boolean };
    }>('/api/schedules/:id', async (request, reply) => {
        const current = await options.scheduler.schedule(request.params.id);
        if (!current) return reply.code(404).send({ error: 'Schedule not found' });
        const device = (await loadRegisteredDevices()).find(({ udid }) => udid === current.deviceUdid);
        if (!device) return reply.code(404).send({ error: 'Scheduled device is not registered' });
        const payload = request.body.recurringPublishConfirmed === undefined
            ? current.payload
            : { ...current.payload, recurringPublishConfirmed: request.body.recurringPublishConfirmed };
        const schedule = await options.scheduler.updateSchedule(request.params.id, {
            ...(request.body.timing ? { timing: request.body.timing } : {}),
            ...(request.body.runWindowMinutes !== undefined ? { runWindowMinutes: request.body.runWindowMinutes } : {}),
            task: {
                pluginId: current.pluginId, taskType: current.taskType,
                taskVersion: current.taskVersion, payload,
            },
        }, device.pluginData[current.pluginId] ?? {});
        return schedule ?? reply.code(409).send({ error: 'Completed or cancelled schedules cannot be edited' });
    });
    const changeStatus = async (id: string, status: 'active' | 'paused' | 'cancelled', reply: FastifyReply) => {
        try {
            const schedule = await options.scheduler.setScheduleStatus(id, status);
            return schedule ?? reply.code(404).send({ error: 'Schedule not found' });
        } catch (error) {
            if (error instanceof ScheduleTransitionError) return reply.code(409).send({ error: errorMessage(error) });
            throw error;
        }
    };
    app.post<{ Params: { id: string }; Body: { status: 'active' | 'paused' | 'cancelled' } }>('/api/schedules/:id/status',
        (request, reply) => changeStatus(request.params.id, request.body.status, reply));
    for (const action of ['pause', 'resume', 'cancel'] as const) {
        const status = action === 'pause' ? 'paused' : action === 'resume' ? 'active' : 'cancelled';
        app.post<{ Params: { id: string } }>(`/api/schedules/:id/${action}`,
            (request, reply) => changeStatus(request.params.id, status, reply));
    }
    app.post<{ Params: { id: string } }>('/api/executions/:id/stop', async (request, reply) => {
        const result = await options.scheduler.requestStop(request.params.id);
        if (result === 'not-found') return reply.code(404).send({ error: 'Execution not found' });
        if (request.headers['hx-request']) {
            const execution = await options.scheduler.execution(request.params.id);
            return reply.type('text/html').send(await renderActivity(execution?.deviceUdid ?? ''));
        }
        return { result };
    });
    app.post<{ Params: { udid: string } }>('/api/devices/:udid/queue/clear', async (request, reply) => {
        const result = await options.scheduler.clearDeviceQueue(request.params.udid);
        const note = result.cancelled || result.stopping
            ? `Cleared ${result.cancelled} queued · stopping ${result.stopping} running`
            : 'Queue already empty';
        if (request.headers['hx-request']) {
            return reply.type('text/html').send(await renderActivity(request.params.udid, note));
        }
        return result;
    });
    app.post<{ Params: { id: string } }>('/api/executions/:id/retry', async (request, reply) => {
        const execution = await options.scheduler.retryExecution(request.params.id);
        return execution ?? reply.code(409).send({ error: 'Execution is not retryable' });
    });

    app.post('/api/assets', async (request, reply) => {
        const dataRoot = path.resolve(process.env.SCHEDULER_DATA_DIR ?? '.scheduler-data');
        const uploadDirectory = path.join(dataRoot, 'uploads');
        await mkdir(uploadDirectory, { recursive: true });
        const created: Array<{ relativePath: string; originalName: string; mimeType: string; size: number; sha256: string }> = [];
        for await (const part of request.files()) {
            const id = crypto.randomUUID();
            const relativePath = path.join('uploads', id);
            const handle = await open(path.join(dataRoot, relativePath), 'wx', 0o600);
            const hash = crypto.createHash('sha256');
            let size = 0;
            try {
                for await (const chunk of part.file) {
                    const buffer = Buffer.from(chunk);
                    size += buffer.length;
                    hash.update(buffer);
                    await handle.write(buffer);
                }
            } finally {
                await handle.close();
            }
            created.push({ relativePath, originalName: part.filename, mimeType: part.mimetype, size, sha256: hash.digest('hex') });
        }
        return reply.code(201).send(await options.scheduler.registerAssets(created));
    });
    app.delete<{ Body: { assetIds: string[] } }>('/api/assets', async (request, reply) => {
        await options.scheduler.deleteAssets(request.body.assetIds ?? []);
        return reply.code(204).send();
    });

    app.get<{ Params: { udid: string } }>('/api/internal/worker/devices/:udid', async (request, reply) => {
        if (!internalWorkerAuthorized(request)) return reply.code(401).send({ error: 'Internal worker token required' });
        const device = (await loadRegisteredDevices()).find(({ udid }) => udid === request.params.udid);
        return device ? redactDevice(device) : reply.code(404).send({ error: 'Device not found' });
    });
    app.get<{ Params: { id: string } }>('/api/internal/worker/assets/:id', async (request, reply) => {
        if (!internalWorkerAuthorized(request)) return reply.code(401).send({ error: 'Internal worker token required' });
        const asset = await options.scheduler.assetFile(request.params.id);
        if (!asset) return reply.code(404).send({ error: 'Asset not found' });
        reply.header('content-length', String(asset.size));
        reply.header('x-content-sha256', asset.sha256);
        reply.header('cache-control', 'private, no-store');
        return reply.type(asset.mimeType).send(createReadStream(asset.path));
    });
    app.delete<{ Params: { id: string } }>('/api/internal/worker/assets/:id', async (request, reply) => {
        if (!internalWorkerAuthorized(request)) return reply.code(401).send({ error: 'Internal worker token required' });
        await options.scheduler.deleteAssets([request.params.id]);
        return reply.code(204).send();
    });

    for (const plugin of options.plugins.list()) {
        if (plugin.registerRoutes) await plugin.registerRoutes({
            app, routePrefix: `/plugins/${plugin.id}`, scheduler: options.scheduler, remote,
            loadDevices: loadRegisteredDevices, saveDevices: saveRegisteredDevices, mutateDevices, renderActivity,
        });
    }

    if (themed) {
        const theme = themed;
        // Templates request these with a ?v=<contenthash>. A versioned request is
        // safe to cache forever; a bare one (bookmark) must revalidate via ETag.
        const asset = (contentType: string, body: string) => {
            const etag = `"${crypto.createHash('sha1').update(body).digest('base64url')}"`;
            return async (request: FastifyRequest, reply: FastifyReply) => {
                const versioned = Boolean((request.query as { v?: string }).v);
                reply.header('cache-control', versioned ? 'public, max-age=31536000, immutable' : 'no-cache')
                    .header('etag', etag);
                if (request.headers['if-none-match'] === etag) return reply.code(304).send();
                return reply.type(contentType).send(body);
            };
        };
        app.get('/assets/styles.css', asset('text/css', theme.styles));
        app.get('/assets/overview.js', asset('text/javascript', theme.overviewScript));
        app.get('/assets/device.js', asset('text/javascript', theme.deviceScript));
        app.get('/assets/tasks.js', asset('text/javascript', theme.tasksScript));
        app.get('/assets/automations.js', asset('text/javascript', theme.automationsScript));
        app.get('/assets/register-device.js', asset('text/javascript', theme.registerDeviceScript));
        app.get('/assets/fleet.js', asset('text/javascript', theme.fleetScript));
        app.get('/assets/htmx.min.js', asset('text/javascript', theme.htmx));
        app.get('/api/fragments/control-center', async (_request, reply) => {
            const [devices, flows, pools, schedules, executions, hosts] = await Promise.all([
                registeredWithStatus(discoverDevices),
                options.scheduler.listFlowDefinitions(500),
                options.scheduler.listDevicePools(500),
                options.scheduler.listSchedules(500),
                options.scheduler.listExecutions(500),
                Promise.resolve(options.listHosts?.() ?? []),
            ]);
            const onlineDevices = devices.filter((device) => Boolean(device.connected) && !device.disabled).length;
            const healthyHosts = hosts.filter((host) => host.online !== false && !host.error).length;
            const offlineHosts = hosts.filter((host) => host.online === false).length;
            const degradedHosts = hosts.filter((host) => host.online !== false && Boolean(host.error)).length;
            const activeSchedules = schedules.filter(({ status }) => status === 'active').length;
            const running = executions.filter(({ status }) => status === 'running').length;
            const queued = executions.filter(({ status }) => status === 'queued').length;
            const recentExecutions = executions.slice(0, 6);
            const recentFailures = executions.slice(0, 20).filter(({ status }) => status === 'failed').length;
            const attention: Array<{ title: string; copy: string; href: string }> = [];
            if (!devices.length) attention.push({
                title: 'No devices registered', copy: 'Attach a phone, simulator or emulator before scheduling automation.', href: '/devices/register',
            });
            else if (onlineDevices === 0) attention.push({
                title: 'All devices offline', copy: 'Check execution hosts or boot a virtual runtime from the execution layer.', href: '/fleet',
            });
            if (offlineHosts) attention.push({
                title: `${offlineHosts} execution host${offlineHosts === 1 ? '' : 's'} offline`,
                copy: 'Configured hosts remain visible and devices will return automatically when workers reconnect.', href: '#host-list',
            });
            if (degradedHosts) attention.push({
                title: `${degradedHosts} execution host${degradedHosts === 1 ? '' : 's'} degraded`,
                copy: 'The worker is reachable but reported an incompatible or quarantined capability/device state.', href: '#host-list',
            });
            if (recentFailures) attention.push({
                title: `${recentFailures} recent failure${recentFailures === 1 ? '' : 's'}`,
                copy: 'Inspect execution history before retrying failed or interrupted work.', href: '/tasks',
            });
            const cards = [
                {
                    href: '/fleet', eyebrow: 'Fleet', title: `${onlineDevices}/${devices.length} online`,
                    copy: 'Live wall, device search, grouping, focus streaming and safe bulk operations.',
                    meta: `${devices.filter(({ kind }) => (kind ?? 'physical') !== 'physical').length} virtual runtime${devices.filter(({ kind }) => (kind ?? 'physical') !== 'physical').length === 1 ? '' : 's'}`,
                },
                {
                    href: '/automations?template=flow', eyebrow: 'Automation Studio', title: `${flows.length} saved flow${flows.length === 1 ? '' : 's'}`,
                    copy: 'Build semantic cross-platform flows, inspect live accessibility and keep immutable revisions.',
                    meta: 'JSON + Maestro YAML',
                },
                {
                    href: '/automations?template=flow', eyebrow: 'Device pools', title: `${pools.length} reusable pool${pools.length === 1 ? '' : 's'}`,
                    copy: 'Allocate by platform, runtime kind, execution host and operator-defined device tags.',
                    meta: 'Least-loaded idle allocation',
                },
                {
                    href: '/tasks', eyebrow: 'Scheduler', title: `${activeSchedules} active schedule${activeSchedules === 1 ? '' : 's'}`,
                    copy: 'Now, once, daily, weekly and interval execution through the canonical per-device queues.',
                    meta: `${running} running · ${queued} queued`,
                },
                {
                    href: '/', eyebrow: 'Execution hosts', title: `${healthyHosts}/${hosts.length} healthy`,
                    copy: 'Worker health, CPU/load/RAM/uptime and virtual-runtime lifecycle stay visible even when a node drops.',
                    meta: hosts.length ? hosts.map(({ id }) => id).join(' · ') : 'No hosts configured',
                },
                {
                    href: '/devices/register', eyebrow: 'Runtime matrix', title: 'iOS + Android',
                    copy: 'Physical devices, iOS Simulator and Android Emulator share one control plane with isolated transports.',
                    meta: 'WDA · Appium · optional scrcpy H.264',
                },
            ].map((card) => `<a class="command-card" href="${card.href}"><span class="command-card-eyebrow">${escapeHtml(card.eyebrow)}</span><strong>${escapeHtml(card.title)}</strong><p>${escapeHtml(card.copy)}</p><span class="command-card-meta">${escapeHtml(card.meta)} <span aria-hidden="true">→</span></span></a>`).join('');
            const healthState = attention.length
                ? `<div class="control-alerts">${attention.map((item) => `<a class="control-alert" href="${item.href}"><span class="control-alert-mark"></span><span><strong>${escapeHtml(item.title)}</strong><small>${escapeHtml(item.copy)}</small></span><span aria-hidden="true">→</span></a>`).join('')}</div>`
                : '<div class="control-alert healthy"><span class="control-alert-mark"></span><span><strong>Control plane healthy</strong><small>No device, host or recent execution failures require attention.</small></span></div>';
            const pluginName = (pluginId: string) => pluginId === 'com.phone-farm.flow'
                ? 'Portable flow'
                : pluginId === 'com.git-agni.instagram' ? 'Instagram' : pluginId === 'com.git-agni.tiktok' ? 'TikTok' : pluginId;
            const recent = recentExecutions.length
                ? recentExecutions.map((execution) => `<a class="recent-run" href="/tasks"><span class="status ${escapeHtml(execution.status)}">${escapeHtml(execution.status)}</span><span class="recent-run-copy"><strong>${escapeHtml(pluginName(execution.pluginId))} · ${escapeHtml(execution.taskType)}</strong><small>${escapeHtml(execution.deviceUdid)} · ${escapeHtml(execution.scheduledFor.toISOString())}</small></span><span aria-hidden="true">→</span></a>`).join('')
                : '<div class="empty-state-inline">No executions yet. Build a flow to create the first scheduler run.</div>';
            return reply.type('text/html').send(`<section id="control-center" class="control-center" hx-get="/api/fragments/control-center" hx-trigger="every 15s" hx-swap="outerHTML"><div class="overview-section-head"><div><span class="eyebrow">Workspace</span><h2>Control center</h2></div><span class="control-center-live ${attention.length ? 'attention' : ''}"><span></span>${attention.length ? `${attention.length} attention` : 'healthy'}</span></div>${healthState}<div class="command-grid">${cards}</div><div class="recent-runs"><div class="recent-runs-head"><div><span class="eyebrow">Scheduler</span><h3>Recent runs</h3></div><a href="/tasks">View all →</a></div><div class="recent-run-list">${recent}</div></div></section>`);
        });
        app.get('/api/fragments/devices', async (_request, reply) => {
            const devices = await registeredWithStatus(discoverDevices);
            const active = devices.filter((device) => !device.disabled);
            const disabled = devices.filter((device) => device.disabled);
            const toggleButton = (udid: string, label: string, next: boolean, className = 'button secondary device-toggle') =>
                `<button type="button" class="${className}" data-toggle-device="${encodeURIComponent(udid)}" data-disabled="${next}">${label}</button>`;
            const renameButton = (udid: string, className = 'button secondary device-rename') =>
                `<button type="button" class="${className}" data-rename-device="${encodeURIComponent(udid)}">Rename</button>`;
            const secondaryMenu = (udid: string, toggle?: { label: string; next: boolean }) =>
                `<details class="device-actions-menu"><summary aria-label="More device actions" title="More actions">•••</summary><div class="device-actions-popover">${renameButton(udid, 'device-menu-action device-rename')}${toggle ? toggleButton(udid, toggle.label, toggle.next, 'device-menu-action device-toggle') : ''}</div></details>`;
            const cards = active.map((device) => {
                const platform = device.platform ?? 'ios';
                const kind = device.kind ?? 'physical';
                const runtime = `${platform === 'ios' ? 'iOS' : 'Android'} · ${kind}`;
                const host = device.workerId ? ` · ${device.workerId}` : '';
                const deviceTags = device.tags ?? [];
                const tags = deviceTags.map((tag) => `<span class="connection-chip tag">#${escapeHtml(tag)}</span>`).join('');
                const accounts = Object.values(device.pluginData).flatMap((value) => {
                    const candidate = value.accounts;
                    return Array.isArray(candidate) ? candidate.filter((entry) => typeof entry === 'string') : [];
                });
                const status = device.connected ? 'online' : 'offline';
                const searchText = [device.name, device.udid, platform, kind, device.workerId ?? '', ...deviceTags, ...accounts]
                    .join(' ').toLowerCase();
                // A still screenshot that refreshes with the 5s fragment poll —
                // not a live MJPEG stream. Streaming every device's screen through
                // the tunnel at once is what made the grid crawl.
                const preview = device.connected
                    ? `<div class="device-preview-frame"><img class="device-preview" src="/api/devices/${encodeURIComponent(device.udid)}/remote/screenshot?t=${Date.now()}" alt="Screen of ${escapeHtml(device.name)}" draggable="false" onerror="this.style.visibility='hidden'"></div>`
                    : '<div class="device-preview-frame unavailable" aria-hidden="true"><div class="device-icon"></div></div>';
                return `<article class="device-card" data-device-entry data-search="${escapeHtml(searchText)}" data-name="${escapeHtml(device.name.toLowerCase())}" data-status="${status}" data-platform="${escapeHtml(platform)}" data-kind="${escapeHtml(kind)}" data-worker="${escapeHtml(device.workerId ?? '')}">${preview}<div class="device-copy"><div class="device-card-title"><h2 class="device-name">${escapeHtml(device.name)}</h2><span class="device-state ${status}"><span></span>${device.connected ? 'Online' : 'Offline'}</span></div><p class="device-meta">${escapeHtml(runtime)}${device.connected ? ` · ${escapeHtml(device.connected.osVersion)}` : ''}${escapeHtml(host)}</p><div class="connection-chips"><span class="connection-chip">${escapeHtml(platform)}</span><span class="connection-chip">${escapeHtml(kind)}</span>${device.workerId ? `<span class="connection-chip">${escapeHtml(device.workerId)}</span>` : ''}${tags}</div>${accounts.length ? `<p class="accounts">${accounts.map(escapeHtml).join(', ')}</p>` : ''}</div><div class="device-card-actions"><a class="button primary" href="/devices/${encodeURIComponent(device.udid)}">Open <span aria-hidden="true">→</span></a><a class="button secondary device-automate" href="/automations?template=flow&device=${encodeURIComponent(device.udid)}">Automate</a>${secondaryMenu(device.udid, { label: 'Disconnect', next: true })}</div></article>`;
            }).join('');
            const disabledPanel = disabled.length
                ? `<details class="disabled-devices"><summary>Disconnected devices (${disabled.length})</summary><ul>${disabled.map((device) => {
                    const platform = device.platform ?? 'ios';
                    const kind = device.kind ?? 'physical';
                    const searchText = [device.name, device.udid, platform, kind, device.workerId ?? '', ...(device.tags ?? [])].join(' ').toLowerCase();
                    return `<li data-device-entry data-search="${escapeHtml(searchText)}" data-name="${escapeHtml(device.name.toLowerCase())}" data-status="disabled" data-platform="${escapeHtml(platform)}" data-kind="${escapeHtml(kind)}" data-worker="${escapeHtml(device.workerId ?? '')}"><span><strong class="device-name">${escapeHtml(device.name)}</strong><small>${escapeHtml(platform)} · ${escapeHtml(kind)}${device.workerId ? ` · ${escapeHtml(device.workerId)}` : ''}</small></span><span class="inline-actions">${toggleButton(device.udid, 'Reconnect', false)}${secondaryMenu(device.udid)}</span></li>`;
                }).join('')}</ul></details>`
                : '';
            const emptyDevices = '<div class="empty-state" data-device-base-empty><span class="empty-state-kicker">Device layer</span><h2>No active devices</h2><p>Attach a real phone, simulator or emulator, or reconnect a disabled device below.</p><div class="empty-state-actions"><a class="button primary" href="/devices/register">Add device</a><a class="button secondary" href="/automations?template=flow">Open Automation Studio</a></div></div>';
            return reply.type('text/html').send(`<section id="device-list" class="device-list" hx-get="/api/fragments/devices" hx-trigger="every 5s" hx-swap="outerHTML" aria-live="polite">${cards || emptyDevices}${disabledPanel}</section>`);
        });
        app.get('/api/fragments/hosts', async (_request, reply) => {
            const [hosts, runtimes] = await Promise.all([
                Promise.resolve(options.listHosts?.() ?? []),
                options.virtualRuntimes?.() ?? Promise.resolve([]),
            ]);
            const cards = hosts.map((host) => {
                const online = host.online !== false;
                const degraded = online && Boolean(host.error);
                const capabilities = host.capabilities.map((capability) => `<span class="connection-chip ${online && !degraded ? 'ready' : 'unavailable'}">${escapeHtml(capability)}</span>`).join('');
                const hostRuntimes = runtimes.filter((runtime) => (runtime.workerId ?? 'local') === host.id);
                const metrics = host.metrics;
                const metricHtml = metrics ? (() => {
                    const gib = (bytes: number) => (bytes / 1024 / 1024 / 1024).toFixed(1);
                    const used = metrics.totalMemoryBytes > 0
                        ? Math.round(((metrics.totalMemoryBytes - metrics.freeMemoryBytes) / metrics.totalMemoryBytes) * 100)
                        : 0;
                    const uptimeHours = metrics.uptimeSeconds / 3600;
                    const uptime = uptimeHours < 48 ? `${uptimeHours.toFixed(1)}h` : `${(uptimeHours / 24).toFixed(1)}d`;
                    return `<div class="host-metrics"><span><strong>${metrics.load1.toFixed(2)}</strong> load</span><span><strong>${used}%</strong> RAM · ${gib(metrics.freeMemoryBytes)}G free</span><span><strong>${metrics.cpuCount}</strong> CPU</span><span><strong>${uptime}</strong> uptime</span></div>`;
                })() : '';
                const runtimeRows = hostRuntimes.map((runtime) => {
                    const action = runtime.state === 'booted' ? 'shutdown' : 'boot';
                    const label = runtime.state === 'booted' ? 'Stop' : 'Boot';
                    const workerId = runtime.workerId ?? 'local';
                    const url = `/api/virtual-runtimes/${encodeURIComponent(workerId)}/${encodeURIComponent(runtime.platform)}/${encodeURIComponent(runtime.id)}/${action}`;
                    const stateClass = runtime.state === 'booted' ? 'ready' : 'unavailable';
                    return `<div class="host-runtime"><div><strong>${escapeHtml(runtime.name)}</strong><span>${escapeHtml(runtime.platform)} · ${escapeHtml(runtime.kind)}${runtime.osVersion ? ` · ${escapeHtml(runtime.osVersion)}` : ''}</span></div><div class="inline-actions"><span class="connection-chip ${stateClass}">${escapeHtml(runtime.state)}</span><button class="button secondary runtime-action" type="button" hx-post="${url}" hx-swap="none" hx-on::after-request="setTimeout(function(){htmx.ajax('GET','/api/fragments/hosts',{target:'#host-list',swap:'outerHTML'})},1200)">${label}</button></div></div>`;
                }).join('');
                const status = `<span class="connection-chip ${online && !degraded ? 'ready' : 'unavailable'}">${degraded ? 'degraded' : online ? 'online' : 'offline'}</span>`;
                const error = host.error ? `<p class="host-error">${escapeHtml(host.error)}</p>` : '';
                const empty = online
                    ? '<p class="host-runtime-empty">No simulator/emulator definitions detected on this host.</p>'
                    : '<p class="host-runtime-empty">Worker is configured but unreachable. Its devices stay registered and will return when the node reconnects.</p>';
                return `<article class="host-card${online ? degraded ? ' degraded' : '' : ' offline'}"><div class="host-card-head"><div><span class="eyebrow">Execution host</span><h3>${escapeHtml(host.id)}</h3><p>${escapeHtml(host.hostname)} · ${escapeHtml(host.os)} ${escapeHtml(host.arch)}</p></div>${status}</div>${metricHtml}<div class="connection-chips">${capabilities || '<span class="connection-chip unavailable">capabilities unavailable</span>'}</div>${error}${hostRuntimes.length ? `<div class="host-runtime-list"><div class="host-runtime-head"><strong>Virtual runtimes</strong><span>${hostRuntimes.filter(({ state }) => state === 'booted').length}/${hostRuntimes.length} running</span></div>${runtimeRows}</div>` : empty}</article>`;
            }).join('');
            const healthyHosts = hosts.filter((host) => host.online !== false && !host.error).length;
            return reply.type('text/html').send(`<section id="host-list" class="host-panel" hx-get="/api/fragments/hosts" hx-trigger="every 15s" hx-swap="outerHTML"><div class="fleet-health-head"><h2>Execution hosts</h2><p>${healthyHosts}/${hosts.length} healthy</p></div><div class="host-grid">${cards || '<div class="empty-state"><span class="empty-state-kicker">Execution layer</span><h2>No execution hosts configured</h2><p>Pair a Mac/PC worker with the control plane to expose physical devices and virtual runtimes.</p><div class="empty-state-actions"><a class="button primary" href="/devices/register">Open device setup</a></div></div>'}</div></section>`);
        });
        app.get('/api/fragments/fleet-health', async (_request, reply) => {
            const [devices, registered, schedules, executions, campaignRows] = await Promise.all([
                registeredWithStatus(discoverDevices),
                loadRegisteredDevices(),
                options.scheduler.listSchedules(500),
                options.scheduler.listExecutions(500),
                options.scheduler.listCampaigns(100),
            ]);
            const accounts = listFleetAccounts(registered);
            const health = buildFleetHealth(devices, accounts, schedules, executions);
            const rate = health.summary.recentSuccessRate === null
                ? '—' : `${Math.round(health.summary.recentSuccessRate * 100)}%`;
            const latency = health.summary.averageQueueLatencyMs === null
                ? '—' : health.summary.averageQueueLatencyMs < 1000
                    ? `${health.summary.averageQueueLatencyMs}ms`
                    : `${(health.summary.averageQueueLatencyMs / 1000).toFixed(1)}s`;
            const activeCampaigns = campaignRows.filter(({ status }) => status === 'active').length;
            const drafts = campaignRows.filter(({ status }) => status === 'draft').length;
            const kpis = [
                [`${health.summary.readyDevices}/${health.summary.devices}`, 'devices ready'],
                [String(health.summary.accounts), `${health.summary.pausedAccounts} accounts paused`],
                [String(health.summary.activeSchedules), 'active schedules'],
                [String(health.summary.queuedExecutions + health.summary.runningExecutions), 'queued + running'],
                [rate, 'recent success'],
                [latency, 'avg queue latency'],
                [`${activeCampaigns}/${drafts}`, 'active / draft campaigns'],
            ].map(([value, label]) => `<div class="fleet-kpi"><strong>${escapeHtml(value)}</strong><span>${escapeHtml(label)}</span></div>`).join('');
            const chips = accounts.map((account) => {
                const device = devices.find(({ udid }) => udid === account.deviceUdid);
                const classes = ['fleet-account-chip'];
                if (account.policy?.paused) classes.push('paused');
                if (!device?.connected || device.disabled) classes.push('offline');
                return `<span class="${classes.join(' ')}" title="${escapeHtml(account.deviceName)}">${escapeHtml(account.platform)} · ${escapeHtml(account.handle)}</span>`;
            }).join('');
            return reply.type('text/html').send(`<section id="fleet-health" class="fleet-health-panel" hx-get="/api/fragments/fleet-health" hx-trigger="every 10s" hx-swap="outerHTML" aria-live="polite"><div class="fleet-health-head"><h2>Control plane</h2><p>${escapeHtml(health.generatedAt)}</p></div><div class="fleet-kpis">${kpis}</div>${chips ? `<div class="fleet-account-strip">${chips}</div>` : ''}</section>`);
        });
        app.get<{ Params: { udid: string } }>('/api/devices/:udid/fragments/summary', async (request, reply) => {
            const [registered, connected] = await Promise.all([
                loadRegisteredDevices().then((devices) => devices.find(({ udid }) => udid === request.params.udid)),
                discoverDevices().then((devices) => devices.find(({ udid }) => udid === request.params.udid)),
            ]);
            if (!registered && !connected) {
                return reply.type('text/html').send('<section id="device-summary" class="device-summary error"><div><h2>Device disconnected</h2></div></section>');
            }
            const platform = registered?.platform ?? connected?.platform ?? 'ios';
            const kind = registered?.kind ?? connected?.kind ?? 'physical';
            const backend = registered?.automationBackend ?? (platform === 'ios' && kind === 'physical' ? 'wda' : 'appium');
            const disabled = registered?.disabled === true;
            const tags = (registered?.tags ?? []).map((tag) => `<span class="connection-chip tag">#${escapeHtml(tag)}</span>`).join('');
            const chips = `<div class="connection-chips"><span class="connection-chip">${escapeHtml(platform)}</span><span class="connection-chip">${escapeHtml(kind)}</span><span class="connection-chip">${escapeHtml(backend)}</span>${tags}</div>`;
            if (!connected) {
                const state = disabled ? 'disabled' : 'offline';
                const label = disabled ? 'Disabled' : 'Offline';
                const guidance = disabled ? 'enable the device to resume automation' : platform === 'ios' && kind === 'physical' ? 'reconnect USB' : 'start or reconnect the runtime';
                return reply.type('text/html').send(`<section id="device-summary" class="device-summary" data-device-disabled="${disabled}" data-device-connected="false"><div class="device-summary-main"><span class="eyebrow">Registered ${escapeHtml(kind)}</span><div class="device-title-row"><h1 class="device-name">${escapeHtml(registered?.name ?? request.params.udid)}</h1><span class="device-state ${state}"><span></span>${label}</span></div><p class="device-meta">${escapeHtml(guidance)}</p>${chips}</div><code>${escapeHtml(request.params.udid)}</code></section>`);
            }
            const displayName = registered?.name ?? connected.name;
            const screen = await remote.getScreenInfo(connected.udid);
            const state = disabled ? 'disabled' : 'online';
            const label = disabled ? 'Disabled' : 'Online';
            return reply.type('text/html').send(`<section id="device-summary" class="device-summary" data-device-disabled="${disabled}" data-device-connected="true" data-screen-width="${screen.screenSize.width}" data-screen-height="${screen.screenSize.height}"><div class="device-summary-main"><span class="eyebrow">${escapeHtml(kind)} runtime</span><div class="device-title-row"><h1 class="device-name">${escapeHtml(displayName)}</h1><span class="device-state ${state}"><span></span>${label}</span></div><p class="device-meta">${platform === 'ios' ? 'iOS' : 'Android'} ${escapeHtml(connected.osVersion)} · ${screen.screenSize.width} × ${screen.screenSize.height}</p>${chips}</div><code>${escapeHtml(connected.udid)}</code></section>`);
        });
        app.get<{ Params: { udid: string } }>('/api/devices/:udid/fragments/activity', async (request, reply) => {
            return reply.type('text/html').send(await renderActivity(request.params.udid));
        });
    }

    app.get('/', async (_request, reply) => {
        if (themed) return reply.type('text/html').send(themed.indexHtml);
        const devices = await registeredWithStatus(discoverDevices);
        const cards = devices.map((device) => {
            const platform = (device.platform ?? device.connected?.platform ?? 'ios') === 'android' ? 'Android' : 'iOS';
            return `<div class="card"><h2>${escapeHtml(device.name)}</h2><p class="muted"><code>${escapeHtml(device.udid)}</code></p><p>${device.disabled ? 'Disconnected' : device.connected ? `Online · ${platform} ${escapeHtml(device.connected.osVersion)}` : 'Offline'}</p><a class="button" href="/devices/${encodeURIComponent(device.udid)}">Open device</a></div>`;
        }).join('');
        const connected = await discoverDevices();
        const registeredIds = new Set(devices.map(({ udid }) => udid));
        const candidates = connected.filter(({ udid }) => !registeredIds.has(udid)).map((device) => `<option value="${escapeHtml(device.udid)}" data-name="${escapeHtml(device.name)}">${escapeHtml(device.name)} · ${escapeHtml(device.osVersion)}</option>`).join('');
        const registration = candidates ? `<section class="card"><h2>Register connected device</h2><form id="register-device"><select name="udid">${candidates}</select> <button>Register</button></form><p id="register-result" class="muted"></p><script>document.getElementById('register-device').addEventListener('submit',async function(e){e.preventDefault();var s=e.currentTarget.udid;var o=s.options[s.selectedIndex];var r=await fetch('/api/devices',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({udid:o.value,name:o.dataset.name,pluginData:{}})});document.getElementById('register-result').textContent=r.ok?'Registered. Reloading…':(await r.json()).error;if(r.ok)setTimeout(function(){location.reload()},500)});</script></section>` : '';
        return reply.type('text/html').send(renderPage('Devices', `<h1>Devices</h1>${registration}<div class="grid">${cards || '<p>No devices registered.</p>'}</div>`));
    });
    const renderFleet = async (_request: unknown, reply: FastifyReply) => {
        if (!themed) return reply.type('text/html').send(renderPage('Fleet view', '<h1>Fleet view</h1><p>Enable the dashboard theme to use the live device wall.</p>'));
        return reply.type('text/html').send(themed.devicesDemoHtml);
    };
    app.get('/fleet', renderFleet);
    app.get('/demo/devices', renderFleet);
    app.get('/devices/register', async (_request, reply) => {
        if (!themed) return reply.type('text/html').send(renderPage('Register device', '<h1>Register device</h1><p>Use <code>POST /api/device-registrations</code> to start device setup.</p>'));
        return reply.type('text/html').send(themed.registerDeviceHtml);
    });
    app.get<{ Params: { udid: string } }>('/devices/:udid', async (request, reply) => {
        const device = (await loadRegisteredDevices()).find(({ udid }) => udid === request.params.udid);
        if (!device) return reply.code(404).type('text/html').send(renderPage('Not found', '<h1>Device not found</h1>'));
        if (themed) {
            const rendered = options.dashboardTheme?.renderDevice
                ? options.dashboardTheme.renderDevice(themed.deviceHtml, device) : themed.deviceHtml;
            return reply.type('text/html').send(rendered.replaceAll('__DEVICE_UDID__', encodeURIComponent(device.udid)));
        }
        const schedules = await options.scheduler.listSchedules(50, device.udid);
        const executions = await options.scheduler.listExecutions(50, device.udid);
        const panels: string[] = [];
        for (const plugin of options.plugins.list()) {
            for (const panel of [...(plugin.devicePanels ?? [])].sort((a, b) => (a.order ?? 0) - (b.order ?? 0))) {
                try {
                    panels.push(`<section class="card" data-plugin="${escapeHtml(plugin.id)}"><h2>${escapeHtml(panel.title)}</h2>${await readFile(panel.fragmentPath, 'utf8')}</section>`);
                } catch (error) {
                    panels.push(`<section class="card"><h2>${escapeHtml(panel.title)}</h2><p>Panel unavailable: ${escapeHtml(errorMessage(error))}</p></section>`);
                }
            }
        }
        const scheduleRows = schedules.map((item) => `<tr><td>${escapeHtml(item.pluginId)}/${escapeHtml(item.taskType)}</td><td>${escapeHtml(JSON.stringify(item.timing))}<br><span class="muted">Next: ${escapeHtml(item.nextRunAt?.toISOString() ?? '—')}</span></td><td>${escapeHtml(item.status)}</td><td>${item.status === 'active' ? `<button data-schedule="${item.id}" data-status="paused">Pause</button>` : item.status === 'paused' ? `<button data-schedule="${item.id}" data-status="active">Resume</button>` : ''} ${!['cancelled', 'completed'].includes(item.status) ? `<button data-schedule="${item.id}" data-status="cancelled">Cancel</button>` : ''}</td></tr>`).join('');
        const executionRows = executions.map((item) => `<tr><td>${escapeHtml(item.pluginId)}/${escapeHtml(item.taskType)}</td><td>${escapeHtml(item.status)}<br><span class="muted">${escapeHtml(item.scheduledFor.toISOString())}</span></td><td><a href="/api/executions/${item.id}"><code>${escapeHtml(item.id)}</code></a></td><td>${['queued', 'running'].includes(item.status) ? `<button data-stop="${item.id}">Stop</button>` : ['failed', 'stopped'].includes(item.status) ? `<button data-retry="${item.id}">Retry</button>` : ''}</td></tr>`).join('');
        const udidJs = encodeURIComponent(device.udid);
        const passcodeCard = `<section class="card"><h2>Unlock passcode</h2><p class="muted">${device.passcode ? 'A passcode is set.' : 'No passcode set.'} Stored in devices.json, never shown.</p><form id="pc"><input id="pcv" type="password" inputmode="numeric" placeholder="4+ digits" autocomplete="new-password"> <button class="button secondary">Save</button> <button type="button" id="pcc" class="button secondary">Clear</button> <span id="pcr" class="muted"></span></form></section><script>(function(){var f=document.getElementById('pc'),v=document.getElementById('pcv'),r=document.getElementById('pcr');async function set(p){r.textContent='…';var x=await fetch('/api/devices/${udidJs}',{method:'PATCH',headers:{'content-type':'application/json'},body:JSON.stringify({passcode:p})});if(x.ok){r.textContent=p?'Saved.':'Cleared.';v.value=''}else{r.textContent=((await x.json().catch(function(){return{}})).error)||'Failed'}}f.addEventListener('submit',function(e){e.preventDefault();if(!/^\\d{4,}$/.test(v.value.trim())){r.textContent='4+ digits';return}set(v.value.trim())});document.getElementById('pcc').addEventListener('click',function(){if(confirm('Clear passcode?'))set('')})})();</script>`;
        const controls = `<script>document.addEventListener('click',async function(e){var b=e.target.closest('button');if(!b)return;var url,body,method='POST';if(b.dataset.schedule){url='/api/schedules/'+b.dataset.schedule+'/status';body={status:b.dataset.status}}else if(b.dataset.stop){url='/api/executions/'+b.dataset.stop+'/stop'}else if(b.dataset.retry){url='/api/executions/'+b.dataset.retry+'/retry'}else if(b.dataset.remove){if(!confirm('Remove this device? Its schedules will be cancelled.'))return;url='/api/devices/'+encodeURIComponent(b.dataset.remove);method='DELETE'}else{return}b.disabled=true;var s=document.getElementById('fallback-action-status');if(s)s.textContent='Working…';var r=await fetch(url,{method:method,headers:{'content-type':'application/json'},body:body?JSON.stringify(body):'{}'});if(r.ok){location.href=b.dataset.remove?'/':location.href;if(!b.dataset.remove)location.reload()}else{b.disabled=false;var d=await r.json().catch(function(){return{}});if(s)s.textContent=d.error||'Request failed'}});</script>`;
        return reply.type('text/html').send(renderPage(device.name, `<h1>${escapeHtml(device.name)}</h1><p><code>${escapeHtml(device.udid)}</code></p>${panels.join('')}<section class="card"><h2>Scheduled and recurring jobs</h2><table><tr><th>Task</th><th>Timing</th><th>Status</th><th>Actions</th></tr>${scheduleRows || '<tr><td colspan="4">No schedules.</td></tr>'}</table></section><section class="card"><h2>Execution history</h2><table><tr><th>Task</th><th>Status</th><th>ID/logs</th><th>Actions</th></tr>${executionRows || '<tr><td colspan="4">No executions.</td></tr>'}</table></section>${passcodeCard}<p id="fallback-action-status" class="muted" aria-live="polite"></p><section class="card"><h2>Danger zone</h2><p class="muted">Removing a device cancels its schedules and forgets its configuration. WebDriverAgent stays installed on the phone.</p><button data-remove="${escapeHtml(device.udid)}" class="button secondary">Remove device</button></section>${controls}`));
    });
    app.get('/tasks', async (_request, reply) => reply.type('text/html').send(
        themed?.tasksHtml ?? renderPage('Tasks', '<h1>Tasks</h1><p>The JSON API exposes schedules and execution history. Installed plugins add task forms to each device page.</p>'),
    ));
    app.get('/automations', async (_request, reply) => reply.type('text/html').send(
        themed?.automationsHtml ?? renderPage('Automations', '<h1>Automations</h1><p>Pre-made templates are available when the dashboard theme is enabled.</p>'),
    ));
    app.get('/docs', async (_request, reply) => reply.type('text/html').send(renderPage('API', '<h1>API</h1><p>Use <code>/api/plugins</code>, <code>/api/devices</code>, <code>/api/schedules</code>, and <code>/api/executions</code>. This route follows the configured authentication policy.</p>')));

    app.setErrorHandler((error, request, reply) => {
        request.log.error(error);
        const failure = error as Error & { statusCode?: number };
        void reply.code(failure.statusCode && failure.statusCode >= 400 ? failure.statusCode : 400)
            .send({ error: failure.message });
    });
    return app;
}
