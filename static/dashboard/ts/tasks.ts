export {};

type ScheduleTiming =
    | { kind: 'now' }
    | { kind: 'once'; runAt: string }
    | { kind: 'daily'; localTime: string; timezone: string }
    | { kind: 'weekly'; localTime: string; timezone: string; weekdays: number[] }
    | { kind: 'interval'; everyMinutes: number; startOffsetMinutes?: number };

interface Schedule {
    id: string;
    deviceUdid: string;
    pluginId: string;
    taskType: string;
    status: 'active' | 'paused' | 'completed' | 'cancelled';
    timing: ScheduleTiming;
    nextRunAt: string | null;
    runWindowMinutes: number;
    payload: { type?: string; destination?: string; name?: string; sourceFlowId?: string; sourceFlowVersion?: number };
}

interface Execution {
    id: string;
    deviceUdid: string;
    pluginId: string;
    taskType: string;
    status: string;
    scheduledFor: string;
    startedAt: string | null;
    finishedAt: string | null;
    error: string | null;
    exitCode?: number | null;
    scheduleId?: string | null;
    payload: { name?: string; sourceFlowId?: string; sourceFlowVersion?: number; [key: string]: unknown };
}

interface ExecutionDetail extends Execution {
    logs: string[];
    exitCode?: number | null;
    deadlineAt?: string;
}

const schedulesElement = document.querySelector<HTMLElement>('#schedules')!;
const executionsElement = document.querySelector<HTMLElement>('#executions')!;
const refresh = document.querySelector<HTMLButtonElement>('#refresh-tasks')!;
const search = document.querySelector<HTMLInputElement>('#runs-search')!;
const deviceFilter = document.querySelector<HTMLSelectElement>('#runs-device')!;
const flowFilter = document.querySelector<HTMLSelectElement>('#runs-flow')!;
const statusFilter = document.querySelector<HTMLSelectElement>('#runs-status')!;
const liveRefresh = document.querySelector<HTMLInputElement>('#runs-live-refresh')!;
const lastUpdated = document.querySelector<HTMLElement>('#runs-last-updated')!;
const summary = document.querySelector<HTMLElement>('#runs-summary')!;
const executionCount = document.querySelector<HTMLElement>('#execution-count')!;
const scheduleCount = document.querySelector<HTMLElement>('#schedule-count')!;
const kpiRecent = document.querySelector<HTMLElement>('#runs-kpi-recent')!;
const kpiActive = document.querySelector<HTMLElement>('#runs-kpi-active')!;
const kpiSuccess = document.querySelector<HTMLElement>('#runs-kpi-success')!;
const kpiAttention = document.querySelector<HTMLElement>('#runs-kpi-attention')!;
const actionStatus = document.querySelector<HTMLElement>('#runs-action-status')!;
const scheduleDialog = document.querySelector<HTMLDialogElement>('#schedule-edit-dialog')!;
const scheduleForm = document.querySelector<HTMLFormElement>('#schedule-edit-form')!;
const scheduleClose = document.querySelector<HTMLButtonElement>('#schedule-edit-close')!;
const scheduleMeta = document.querySelector<HTMLElement>('#schedule-edit-meta')!;
const scheduleKind = document.querySelector<HTMLSelectElement>('#schedule-edit-kind')!;
const scheduleWindow = document.querySelector<HTMLInputElement>('#schedule-edit-window')!;
const scheduleOnceField = document.querySelector<HTMLElement>('#schedule-edit-once-field')!;
const scheduleRunAt = document.querySelector<HTMLInputElement>('#schedule-edit-run-at')!;
const scheduleTimeField = document.querySelector<HTMLElement>('#schedule-edit-time-field')!;
const scheduleLocalTime = document.querySelector<HTMLInputElement>('#schedule-edit-local-time')!;
const scheduleTimezoneField = document.querySelector<HTMLElement>('#schedule-edit-timezone-field')!;
const scheduleTimezone = document.querySelector<HTMLInputElement>('#schedule-edit-timezone')!;
const scheduleIntervalField = document.querySelector<HTMLElement>('#schedule-edit-interval-field')!;
const scheduleEveryMinutes = document.querySelector<HTMLInputElement>('#schedule-edit-every-minutes')!;
const scheduleOffsetField = document.querySelector<HTMLElement>('#schedule-edit-offset-field')!;
const scheduleStartOffset = document.querySelector<HTMLInputElement>('#schedule-edit-start-offset')!;
const scheduleWeekdays = document.querySelector<HTMLElement>('#schedule-edit-weekdays')!;
const scheduleWeekdayInputs = Array.from(scheduleWeekdays.querySelectorAll<HTMLInputElement>('input[type="checkbox"]'));
const scheduleResult = document.querySelector<HTMLElement>('#schedule-edit-result')!;
const executionDialog = document.querySelector<HTMLDialogElement>('#execution-detail-dialog')!;
const executionClose = document.querySelector<HTMLButtonElement>('#execution-detail-close')!;
const executionTitle = document.querySelector<HTMLElement>('#execution-detail-title')!;
const executionLinks = document.querySelector<HTMLElement>('#execution-detail-links')!;
const executionMeta = document.querySelector<HTMLElement>('#execution-detail-meta')!;
const executionErrorSection = document.querySelector<HTMLElement>('#execution-detail-error-section')!;
const executionError = document.querySelector<HTMLElement>('#execution-detail-error')!;
const executionLogCount = document.querySelector<HTMLElement>('#execution-detail-log-count')!;
const executionLogs = document.querySelector<HTMLElement>('#execution-detail-logs')!;
let schedulesCache: Schedule[] = [];
let executionsCache: Execution[] = [];
let deviceNames = new Map<string, string>();
let editingSchedule: Schedule | undefined;

function shortDevice(udid: string): string {
    return udid.length > 20 ? `${udid.slice(0, 8)}…${udid.slice(-6)}` : udid;
}

function deviceLabel(udid: string): string {
    return deviceNames.get(udid) ?? shortDevice(udid);
}

function date(value: string | null): string {
    return value ? new Date(value).toLocaleString() : '—';
}

function pluginLabel(pluginId: string): string {
    if (pluginId === 'com.dfarming.flow' || pluginId === 'com.phone-farm.flow') return 'Portable flow';
    if (pluginId === 'com.dfarming.instagram' || pluginId === 'com.git-agni.instagram') return 'Instagram';
    if (pluginId === 'com.dfarming.tiktok' || pluginId === 'com.git-agni.tiktok') return 'TikTok';
    return pluginId.replace(/^com\.(?:dfarming\.|git-agni\.|phone-farm\.)/, '');
}

function taskLabel(pluginId: string, taskType: string): string {
    if ((pluginId === 'com.dfarming.flow' || pluginId === 'com.phone-farm.flow') && taskType === 'flow') return 'Portable flow';
    return `${pluginLabel(pluginId)} ${taskType}`;
}

function flowName(item: Pick<Execution, 'pluginId' | 'taskType' | 'payload'> | Pick<Schedule, 'pluginId' | 'taskType' | 'payload'>): string | undefined {
    if (!['com.dfarming.flow', 'com.phone-farm.flow'].includes(item.pluginId) || item.taskType !== 'flow') return undefined;
    const name = item.payload?.name;
    return typeof name === 'string' && name.trim() ? name.trim() : 'Portable flow';
}

function flowKey(item: Pick<Execution, 'pluginId' | 'taskType' | 'payload'> | Pick<Schedule, 'pluginId' | 'taskType' | 'payload'>): string | undefined {
    const name = flowName(item);
    if (!name) return undefined;
    return typeof item.payload.sourceFlowId === 'string' && item.payload.sourceFlowId
        ? `id:${item.payload.sourceFlowId}` : `name:${name.toLowerCase()}`;
}

function runTitle(item: Pick<Execution, 'pluginId' | 'taskType' | 'payload'> | Pick<Schedule, 'pluginId' | 'taskType' | 'payload'>): string {
    return flowName(item) ?? taskLabel(item.pluginId, item.taskType);
}

function timingLabel(timing: Schedule['timing']): string {
    if (timing.kind === 'interval' && timing.everyMinutes) return `every ${timing.everyMinutes}m`;
    if ((timing.kind === 'daily' || timing.kind === 'weekly') && timing.localTime) return `${timing.kind} · ${timing.localTime}`;
    if (timing.kind === 'once' && timing.runAt) return `once · ${date(timing.runAt)}`;
    return timing.kind;
}

function localDatetimeValue(value?: string): string {
    if (!value) return '';
    const time = new Date(value);
    if (Number.isNaN(time.getTime())) return '';
    return new Date(time.getTime() - time.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

function updateScheduleEditorFields(): void {
    const kind = scheduleKind.value;
    scheduleOnceField.hidden = kind !== 'once';
    scheduleTimeField.hidden = kind !== 'daily' && kind !== 'weekly';
    scheduleTimezoneField.hidden = kind !== 'daily' && kind !== 'weekly';
    scheduleWeekdays.hidden = kind !== 'weekly';
    scheduleIntervalField.hidden = kind !== 'interval';
    scheduleOffsetField.hidden = kind !== 'interval';
}

function openScheduleEditor(schedule: Schedule): void {
    editingSchedule = schedule;
    scheduleMeta.textContent = `${taskLabel(schedule.pluginId, schedule.taskType)} · ${deviceLabel(schedule.deviceUdid)} · ${schedule.status}`;
    scheduleKind.value = schedule.timing.kind;
    scheduleWindow.value = String(schedule.runWindowMinutes);
    scheduleRunAt.value = schedule.timing.kind === 'once' ? localDatetimeValue(schedule.timing.runAt) : '';
    scheduleLocalTime.value = schedule.timing.kind === 'daily' || schedule.timing.kind === 'weekly' ? schedule.timing.localTime : '09:00';
    scheduleTimezone.value = schedule.timing.kind === 'daily' || schedule.timing.kind === 'weekly'
        ? schedule.timing.timezone
        : (Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC');
    scheduleEveryMinutes.value = schedule.timing.kind === 'interval' ? String(schedule.timing.everyMinutes) : '60';
    scheduleStartOffset.value = schedule.timing.kind === 'interval' ? String(schedule.timing.startOffsetMinutes ?? 0) : '0';
    const weekdays = new Set(schedule.timing.kind === 'weekly' ? schedule.timing.weekdays : [1, 2, 3, 4, 5]);
    for (const input of scheduleWeekdayInputs) input.checked = weekdays.has(Number(input.value));
    scheduleResult.textContent = '';
    updateScheduleEditorFields();
    scheduleDialog.showModal();
}

function timingFromEditor(): ScheduleTiming {
    const kind = scheduleKind.value;
    if (kind === 'now') return { kind: 'now' };
    if (kind === 'once') {
        if (!scheduleRunAt.value) throw new Error('Choose when this schedule should run.');
        const runAt = new Date(scheduleRunAt.value);
        if (Number.isNaN(runAt.getTime())) throw new Error('Run-at time is invalid.');
        return { kind: 'once', runAt: runAt.toISOString() };
    }
    if (kind === 'daily' || kind === 'weekly') {
        const localTime = scheduleLocalTime.value;
        const timezone = scheduleTimezone.value.trim();
        if (!/^\d{2}:\d{2}$/.test(localTime)) throw new Error('Choose a valid local time.');
        if (!timezone) throw new Error('Timezone is required.');
        if (kind === 'daily') return { kind, localTime, timezone };
        const weekdays = scheduleWeekdayInputs.filter((input) => input.checked).map((input) => Number(input.value));
        if (!weekdays.length) throw new Error('Choose at least one weekday.');
        return { kind, localTime, timezone, weekdays };
    }
    if (kind === 'interval') {
        const everyMinutes = Number(scheduleEveryMinutes.value);
        const startOffsetMinutes = Number(scheduleStartOffset.value || 0);
        if (!Number.isInteger(everyMinutes) || everyMinutes < 1 || everyMinutes > 1440) throw new Error('Interval must be between 1 and 1440 minutes.');
        if (!Number.isInteger(startOffsetMinutes) || startOffsetMinutes < 0 || startOffsetMinutes > 1440) throw new Error('Start offset must be between 0 and 1440 minutes.');
        return { kind, everyMinutes, ...(startOffsetMinutes ? { startOffsetMinutes } : {}) };
    }
    throw new Error('Unsupported schedule timing.');
}

function detailField(label: string, value: string): HTMLElement {
    const field = document.createElement('div');
    const name = document.createElement('span'); name.textContent = label;
    const content = document.createElement('strong'); content.textContent = value;
    field.append(name, content);
    return field;
}

function detailLink(label: string, href: string): HTMLAnchorElement {
    const link = document.createElement('a');
    link.className = 'execution-context-link';
    link.href = href;
    const kicker = document.createElement('span'); kicker.textContent = label;
    const value = document.createElement('strong'); value.textContent = label === 'Device' ? 'Open device' : 'Open flow source';
    link.append(kicker, value);
    return link;
}

async function openExecutionDetail(id: string): Promise<void> {
    executionTitle.textContent = 'Run details';
    executionLinks.replaceChildren();
    executionMeta.replaceChildren();
    executionErrorSection.hidden = true;
    executionLogs.textContent = 'Loading…';
    executionLogCount.textContent = '';
    executionDialog.showModal();
    try {
        const execution = await request<ExecutionDetail>(`/api/executions/${encodeURIComponent(id)}`);
        executionTitle.textContent = `${runTitle(execution)} · ${deviceLabel(execution.deviceUdid)}`;
        const links: HTMLAnchorElement[] = [
            detailLink('Device', `/devices/${encodeURIComponent(execution.deviceUdid)}`),
        ];
        if (['com.dfarming.flow', 'com.phone-farm.flow'].includes(execution.pluginId) && execution.taskType === 'flow') {
            const sourceFlowId = typeof execution.payload.sourceFlowId === 'string' ? execution.payload.sourceFlowId : undefined;
            links.push(detailLink(
                sourceFlowId ? 'Saved flow' : 'Flow workspace',
                sourceFlowId ? `/api/flows/${encodeURIComponent(sourceFlowId)}` : `/automations?template=flow&device=${encodeURIComponent(execution.deviceUdid)}`,
            ));
        }
        executionLinks.replaceChildren(...links);
        executionMeta.replaceChildren(
            detailField('Status', execution.status),
            detailField('Device', `${deviceLabel(execution.deviceUdid)} · ${shortDevice(execution.deviceUdid)}`),
            detailField('Run ID', execution.id),
            detailField('Scheduled', date(execution.scheduledFor)),
            detailField('Started', date(execution.startedAt)),
            detailField('Finished', date(execution.finishedAt)),
            detailField('Exit code', execution.exitCode === null || execution.exitCode === undefined ? '—' : String(execution.exitCode)),
            detailField('Schedule', execution.scheduleId ?? 'ad-hoc'),
            ...(flowName(execution) ? [detailField('Flow', `${flowName(execution)}${execution.payload.sourceFlowVersion ? ` · v${execution.payload.sourceFlowVersion}` : ''}`)] : []),
        );
        executionErrorSection.hidden = !execution.error;
        executionError.textContent = execution.error ?? '';
        executionLogCount.textContent = `${execution.logs.length} line${execution.logs.length === 1 ? '' : 's'}`;
        executionLogs.textContent = execution.logs.length ? execution.logs.join('\n') : 'No logs recorded for this execution.';
    } catch (error) {
        executionLogs.textContent = error instanceof Error ? error.message : String(error);
    }
}

function queryMatch(values: string[]): boolean {
    const query = search.value.trim().toLowerCase();
    return !query || values.some((value) => value.toLowerCase().includes(query));
}

function filteredSchedules(): Schedule[] {
    const wanted = statusFilter.value;
    const wantedDevice = deviceFilter.value;
    const wantedFlow = flowFilter.value;
    return schedulesCache.filter((schedule) => (!wanted || schedule.status === wanted)
        && (!wantedDevice || schedule.deviceUdid === wantedDevice)
        && (!wantedFlow || flowKey(schedule) === wantedFlow)
        && queryMatch([deviceLabel(schedule.deviceUdid), schedule.deviceUdid, flowName(schedule) ?? '', schedule.pluginId, pluginLabel(schedule.pluginId), schedule.taskType, taskLabel(schedule.pluginId, schedule.taskType)]));
}

function filteredExecutions(): Execution[] {
    const wanted = statusFilter.value;
    const wantedDevice = deviceFilter.value;
    const wantedFlow = flowFilter.value;
    return executionsCache.filter((execution) => (!wanted || execution.status === wanted)
        && (!wantedDevice || execution.deviceUdid === wantedDevice)
        && (!wantedFlow || flowKey(execution) === wantedFlow)
        && queryMatch([deviceLabel(execution.deviceUdid), execution.deviceUdid, flowName(execution) ?? '', execution.pluginId, pluginLabel(execution.pluginId), execution.taskType, taskLabel(execution.pluginId, execution.taskType)]));
}

function syncFilters(): void {
    const selectedDevice = deviceFilter.value;
    const allDeviceIds = new Set([...deviceNames.keys(), ...schedulesCache.map(({ deviceUdid }) => deviceUdid), ...executionsCache.map(({ deviceUdid }) => deviceUdid)]);
    const devices = [...allDeviceIds].map((udid) => [udid, deviceLabel(udid)] as const).sort((a, b) => a[1].localeCompare(b[1]));
    deviceFilter.replaceChildren(new Option('All devices', ''), ...devices.map(([udid, name]) => new Option(name, udid)));
    if (selectedDevice && allDeviceIds.has(selectedDevice)) deviceFilter.value = selectedDevice;

    const selectedFlow = flowFilter.value;
    const flows = new Map<string, string>();
    for (const item of [...executionsCache, ...schedulesCache]) {
        const key = flowKey(item);
        const name = flowName(item);
        if (key && name) flows.set(key, name);
    }
    const options = [...flows.entries()].sort((a, b) => a[1].localeCompare(b[1])).map(([key, name]) => new Option(name, key));
    flowFilter.replaceChildren(new Option('All flows', ''), ...options);
    if (selectedFlow && flows.has(selectedFlow)) flowFilter.value = selectedFlow;
}

async function request<T>(url: string, options?: RequestInit): Promise<T> {
    const response = await fetch(url, options);
    const body = await response.json() as T & { error?: string };
    if (!response.ok) throw new Error(body.error ?? `Request failed (${response.status})`);
    return body;
}

function button(label: string, action: () => Promise<void>, quietSuccess = false): HTMLButtonElement {
    const value = document.createElement('button');
    value.className = 'icon-button'; value.type = 'button'; value.textContent = label;
    value.addEventListener('click', () => {
        value.disabled = true;
        actionStatus.hidden = false;
        actionStatus.classList.remove('error');
        actionStatus.textContent = `${label}…`;
        void action().then(() => {
            if (quietSuccess) {
                actionStatus.hidden = true;
                actionStatus.textContent = '';
            } else actionStatus.textContent = `${label} complete.`;
        }).catch((error) => {
            actionStatus.classList.add('error');
            actionStatus.textContent = error instanceof Error ? error.message : String(error);
        }).finally(() => { value.disabled = false; });
    });
    return value;
}

function renderSchedules(items: Schedule[]): void {
    if (!items.length) {
        schedulesElement.className = 'task-list empty-state';
        schedulesElement.innerHTML = `<h3>${schedulesCache.length ? 'No schedules match this filter' : 'No schedules yet'}</h3><p>${schedulesCache.length ? 'Change the search or status filter.' : 'Create a portable flow or app automation to schedule work.'}</p>`;
        return;
    }
    schedulesElement.className = 'task-list';
    schedulesElement.replaceChildren(...items.map((schedule) => {
        const row = document.createElement('article'); row.className = 'task-row schedule-row';
        const copy = document.createElement('div');
        const title = document.createElement('h3'); title.textContent = `${runTitle(schedule)} · ${deviceLabel(schedule.deviceUdid)}`;
        const meta = document.createElement('p'); meta.textContent = `${shortDevice(schedule.deviceUdid)} · ${timingLabel(schedule.timing)} · next ${date(schedule.nextRunAt)}`;
        copy.append(title, meta);
        const state = document.createElement('span'); state.className = `status ${schedule.status}`; state.textContent = schedule.status;
        const actions = document.createElement('div'); actions.className = 'inline-actions';
        if (schedule.status === 'active' || schedule.status === 'paused') {
            actions.append(button('Edit', async () => { openScheduleEditor(schedule); }, true));
        }
        if (schedule.status === 'active') actions.append(button('Pause', async () => { await request(`/api/schedules/${schedule.id}/pause`, { method: 'POST' }); await load(); }));
        if (schedule.status === 'paused') actions.append(button('Resume', async () => { await request(`/api/schedules/${schedule.id}/resume`, { method: 'POST' }); await load(); }));
        if (schedule.status !== 'cancelled' && schedule.status !== 'completed') actions.append(button('Cancel', async () => { await request(`/api/schedules/${schedule.id}/cancel`, { method: 'POST' }); await load(); }));
        row.append(copy, state, actions); return row;
    }));
}

function renderExecutions(items: Execution[]): void {
    if (!items.length) {
        executionsElement.className = 'task-list empty-state';
        executionsElement.innerHTML = `<h3>${executionsCache.length ? 'No executions match this filter' : 'No executions yet'}</h3><p>${executionsCache.length ? 'Change the search or status filter.' : 'Runs appear here as soon as an automation enters the scheduler.'}</p>`;
        return;
    }
    executionsElement.className = 'task-list';
    executionsElement.replaceChildren(...items.map((execution) => {
        const row = document.createElement('article'); row.className = `task-row run-card${execution.error ? ' has-error' : ''}`;
        const copy = document.createElement('div'); copy.className = 'run-card-copy';
        const context = document.createElement('div'); context.className = 'run-card-context';
        const device = document.createElement('a'); device.href = `/devices/${encodeURIComponent(execution.deviceUdid)}`; device.textContent = deviceLabel(execution.deviceUdid);
        const flow = flowName(execution);
        if (flow) {
            const source = typeof execution.payload.sourceFlowId === 'string' ? execution.payload.sourceFlowId : undefined;
            const flowLink = document.createElement('a'); flowLink.href = source ? `/api/flows/${encodeURIComponent(source)}` : `/automations?template=flow&device=${encodeURIComponent(execution.deviceUdid)}`; flowLink.textContent = flow;
            context.append(device, flowLink);
        } else context.append(device);
        const title = document.createElement('h3'); title.textContent = runTitle(execution);
        const meta = document.createElement('p'); meta.textContent = `${date(execution.scheduledFor)} · ${shortDevice(execution.deviceUdid)}${execution.exitCode !== null && execution.exitCode !== undefined ? ` · exit ${execution.exitCode}` : ''}`;
        copy.append(context, title, meta);
        if (execution.error) {
            const error = document.createElement('p'); error.className = 'run-card-error'; error.textContent = execution.error;
            copy.append(error);
        }
        const state = document.createElement('span'); state.className = `status ${execution.status}`; state.textContent = execution.status;
        const actions = document.createElement('div'); actions.className = 'inline-actions';
        actions.append(button('Details', async () => { await openExecutionDetail(execution.id); }, true));
        if (execution.status === 'queued' || (execution.status === 'running' && execution.taskType === 'doomscroll')) {
            actions.append(button(execution.status === 'queued' ? 'Cancel' : 'Stop', async () => {
                await request(`/api/executions/${execution.id}/stop`, { method: 'POST' }); await load();
            }));
        }
        if (execution.status === 'failed' || execution.status === 'stopped') {
            actions.append(button('Retry', async () => {
                if (!window.confirm('This automation may have partially completed. Check the device state before retrying.')) return;
                await request(`/api/executions/${execution.id}/retry`, {
                    method: 'POST',
                    headers: { 'content-type': 'application/json' },
                    body: JSON.stringify({ confirmSideEffects: true }),
                });
                await load();
            }));
        }
        row.append(copy, state, actions); return row;
    }));
}

async function load(): Promise<void> {
    refresh.disabled = true;
    try {
        const [scheduleData, executionData, devices] = await Promise.all([
            request<{ schedules: Schedule[] }>('/api/schedules'),
            request<{ executions: Execution[] }>('/api/executions'),
            request<Array<{ udid: string; name: string }>>('/api/devices'),
        ]);
        deviceNames = new Map(devices.map((device) => [device.udid, device.name]));
        schedulesCache = scheduleData.schedules;
        executionsCache = executionData.executions;
        syncFilters();
        render();
        lastUpdated.textContent = `Updated ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}`;
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        schedulesElement.textContent = message; executionsElement.textContent = message;
    } finally { refresh.disabled = false; }
}

function render(): void {
    const schedules = filteredSchedules();
    const executions = filteredExecutions();
    renderSchedules(schedules);
    renderExecutions(executions);
    const queued = executionsCache.filter(({ status }) => status === 'queued').length;
    const running = executionsCache.filter(({ status }) => status === 'running').length;
    const failed = executionsCache.filter(({ status }) => status === 'failed').length;
    const stopped = executionsCache.filter(({ status }) => status === 'stopped').length;
    const dayAgo = Date.now() - 24 * 60 * 60_000;
    const recentItems = executionsCache.filter(({ scheduledFor }) => new Date(scheduledFor).getTime() >= dayAgo);
    const recent = recentItems.length;
    const succeeded = recentItems.filter(({ status }) => status === 'succeeded').length;
    const recentAttention = recentItems.filter(({ status }) => status === 'failed' || status === 'stopped').length;
    kpiRecent.textContent = String(recent);
    kpiActive.textContent = String(running + queued);
    kpiSuccess.textContent = String(succeeded);
    kpiAttention.textContent = String(recentAttention);
    executionCount.textContent = `${executions.length} shown · ${executionsCache.length} total`;
    scheduleCount.textContent = `${schedules.length} shown · ${schedulesCache.length} total`;
    summary.textContent = `${running} running · ${queued} queued${failed ? ` · ${failed} failed` : ''}`;
}

refresh.addEventListener('click', () => void load());
search.addEventListener('input', render);
deviceFilter.addEventListener('change', render);
flowFilter.addEventListener('change', render);
statusFilter.addEventListener('change', render);
scheduleKind.addEventListener('change', updateScheduleEditorFields);
scheduleClose.addEventListener('click', () => {
    editingSchedule = undefined;
    scheduleDialog.close();
});
scheduleDialog.addEventListener('close', () => { editingSchedule = undefined; });
executionClose.addEventListener('click', () => executionDialog.close());
scheduleForm.addEventListener('submit', (event) => {
    event.preventDefault();
    void (async () => {
        if (!editingSchedule) return;
        const submit = scheduleForm.querySelector<HTMLButtonElement>('button[type="submit"]')!;
        submit.disabled = true;
        scheduleResult.textContent = 'Saving schedule…';
        try {
            const timing = timingFromEditor();
            const runWindowMinutes = Number(scheduleWindow.value);
            if (!Number.isInteger(runWindowMinutes) || runWindowMinutes < 1 || runWindowMinutes > 1440) {
                throw new Error('Run window must be between 1 and 1440 minutes.');
            }
            const recurringPublish = editingSchedule.payload.type === 'post'
                && editingSchedule.payload.destination === 'publish'
                && (timing.kind === 'daily' || timing.kind === 'weekly');
            if (recurringPublish && !window.confirm('Confirm that this recurring schedule may publish publicly without confirmation on each occurrence.')) return;
            await request(`/api/schedules/${encodeURIComponent(editingSchedule.id)}`, {
                method: 'PATCH', headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ timing, runWindowMinutes, recurringPublishConfirmed: recurringPublish }),
            });
            scheduleDialog.close();
            editingSchedule = undefined;
            await load();
        } catch (error) {
            scheduleResult.textContent = error instanceof Error ? error.message : String(error);
        } finally {
            submit.disabled = false;
        }
    })();
});
void load();
setInterval(() => {
    if (liveRefresh.checked && !document.hidden) void load();
}, 5_000);
