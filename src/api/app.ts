import cookie from '@fastify/cookie';
import formbody from '@fastify/formbody';
import multipart from '@fastify/multipart';
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import crypto from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';

import { discoverConnectedDevices, type Device } from '../devices/discovery.js';
import { loadRegisteredDevices, mutateRegisteredDevices, saveRegisteredDevices, redactDevice, type RegisteredDevice } from '../devices/registry.js';
import { RegistryWdaRemoteControl } from '../devices/registry-remote.js';
import type { DeviceRegistrationManager } from '../devices/registration.js';
import type { RemoteControl } from '../devices/wda-remote.js';
import type { DeviceConnectionStatus } from '../devices/connection-manager.js';
import type { AuthProvider, PluginNavLink } from '../plugin.js';
import type { PluginRegistry } from '../registry.js';
import { canonicalPluginId, INSTAGRAM_PLUGIN_ID, PORTABLE_FLOW_PLUGIN_ID, TIKTOK_PLUGIN_ID } from '../branding.js';
import { dfarmingEnv } from '../env.js';
import type { JsonObject } from '../types.js';
import type { SchedulerRepository } from '../scheduler/repository.js';
import {
    listFleetAccounts, pluginIdForPlatform, SOCIAL_ACCOUNT_PLATFORMS, validateAccountExecutionProfile, withAccountPolicy,
    type AccountAutomationPolicy, type SocialAccountPlatform,
} from '../accounts.js';
import { buildFleetHealth } from '../analytics.js';
import type { HostSnapshot } from '../hosts/capabilities.js';
import type { RuntimeDevice } from '../devices/runtime-discovery.js';
import type { VirtualRuntime, VirtualRuntimePlatform } from '../devices/virtual-runtime.js';
import { installAuthentication, installCsrfGuard } from './http-security.js';
import { registerRuntimeRoutes } from './runtime-routes.js';
import { registerDeviceRegistrationRoutes } from './device-registration-routes.js';
import { registerRemoteControlRoutes } from './remote-routes.js';
import { registerFlowRoutes } from './flow-routes.js';
import { registerCampaignRoutes } from './campaign-routes.js';
import { registerAllocationRoutes } from './allocation-routes.js';
import { registerScheduleRoutes } from './schedule-routes.js';
import { registerAssetRoutes } from './asset-routes.js';
import { registerDeviceRoutes } from './device-routes.js';
import { registerDCreatorRoutes } from './dcreator-routes.js';

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
// DFARMING_BRAND_URL; the text is fixed.
const FOOTER_HTML = `Built by <a href="${escapeHtml(dfarmingEnv('BRAND_URL') ?? '#')}" target="_blank" rel="noopener">kevbuilds apps</a> with love &#10084;&#65039;`;

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

    // The default loopback dashboard is still reachable from pages in the same
    // browser, so state-changing requests always need same-origin proof or a
    // non-empty Bearer credential.
    installCsrfGuard(app);
    await installAuthentication(app, options.authProvider);

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
            body.release = JSON.parse(await readFile(path.resolve(dfarmingEnv('RELEASE_FILE') ?? 'RELEASED'), 'utf8'));
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
        if (request.body.executionProfile !== undefined) {
            try { validateAccountExecutionProfile(request.body.executionProfile); }
            catch (error) { return reply.code(400).send({ error: errorMessage(error) }); }
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
    registerRuntimeRoutes(app, options);
    registerDeviceRegistrationRoutes(app, options.registrations);
    registerDeviceRoutes(app, {
        scheduler: options.scheduler,
        plugins: options.plugins,
        remote,
        discoverDevices,
        mutateDevices,
    });
    registerDCreatorRoutes(app, options.scheduler);

    registerRemoteControlRoutes(app, {
        remote,
        scheduler: options.scheduler,
        discoverDevices,
        semanticTraceRoot: options.semanticTraceRoot,
        requireStreamToken: options.requireStreamToken,
        streamTokenSecret: options.streamTokenSecret,
        connectionStatus: options.connectionStatus,
        reconnectDevice: options.reconnectDevice,
    });

    registerFlowRoutes(app, options.scheduler, options.plugins);
    registerCampaignRoutes(app, options.scheduler, options.plugins);
    registerAllocationRoutes(app, { scheduler: options.scheduler, discoverDevices });
    registerScheduleRoutes(app, { scheduler: options.scheduler, plugins: options.plugins, renderActivity });
    registerAssetRoutes(app, options.scheduler);

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
            const pluginName = (pluginId: string) => {
                const canonical = canonicalPluginId(pluginId);
                if (canonical === PORTABLE_FLOW_PLUGIN_ID) return 'Portable flow';
                if (canonical === INSTAGRAM_PLUGIN_ID) return 'Instagram';
                if (canonical === TIKTOK_PLUGIN_ID) return 'TikTok';
                return pluginId;
            };
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
        const controls = `<script>document.addEventListener('click',async function(e){var b=e.target.closest('button');if(!b)return;var url,body,method='POST';if(b.dataset.schedule){url='/api/schedules/'+b.dataset.schedule+'/status';body={status:b.dataset.status}}else if(b.dataset.stop){url='/api/executions/'+b.dataset.stop+'/stop'}else if(b.dataset.retry){if(!confirm('This automation may have partially completed. Check the device state before retrying.'))return;url='/api/executions/'+b.dataset.retry+'/retry';body={confirmSideEffects:true}}else if(b.dataset.remove){if(!confirm('Remove this device? Its schedules will be cancelled.'))return;url='/api/devices/'+encodeURIComponent(b.dataset.remove);method='DELETE'}else{return}b.disabled=true;var s=document.getElementById('fallback-action-status');if(s)s.textContent='Working…';var r=await fetch(url,{method:method,headers:{'content-type':'application/json'},body:body?JSON.stringify(body):'{}'});if(r.ok){location.href=b.dataset.remove?'/':location.href;if(!b.dataset.remove)location.reload()}else{b.disabled=false;var d=await r.json().catch(function(){return{}});if(s)s.textContent=d.error||'Request failed'}});</script>`;
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
