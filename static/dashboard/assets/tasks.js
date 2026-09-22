const schedulesElement = document.querySelector('#schedules');
const executionsElement = document.querySelector('#executions');
const refresh = document.querySelector('#refresh-tasks');
const search = document.querySelector('#runs-search');
const deviceFilter = document.querySelector('#runs-device');
const flowFilter = document.querySelector('#runs-flow');
const statusFilter = document.querySelector('#runs-status');
const liveRefresh = document.querySelector('#runs-live-refresh');
const lastUpdated = document.querySelector('#runs-last-updated');
const summary = document.querySelector('#runs-summary');
const executionCount = document.querySelector('#execution-count');
const scheduleCount = document.querySelector('#schedule-count');
const kpiRecent = document.querySelector('#runs-kpi-recent');
const kpiActive = document.querySelector('#runs-kpi-active');
const kpiSuccess = document.querySelector('#runs-kpi-success');
const kpiAttention = document.querySelector('#runs-kpi-attention');
const actionStatus = document.querySelector('#runs-action-status');
const scheduleDialog = document.querySelector('#schedule-edit-dialog');
const scheduleForm = document.querySelector('#schedule-edit-form');
const scheduleClose = document.querySelector('#schedule-edit-close');
const scheduleMeta = document.querySelector('#schedule-edit-meta');
const scheduleKind = document.querySelector('#schedule-edit-kind');
const scheduleWindow = document.querySelector('#schedule-edit-window');
const scheduleOnceField = document.querySelector('#schedule-edit-once-field');
const scheduleRunAt = document.querySelector('#schedule-edit-run-at');
const scheduleTimeField = document.querySelector('#schedule-edit-time-field');
const scheduleLocalTime = document.querySelector('#schedule-edit-local-time');
const scheduleTimezoneField = document.querySelector('#schedule-edit-timezone-field');
const scheduleTimezone = document.querySelector('#schedule-edit-timezone');
const scheduleIntervalField = document.querySelector('#schedule-edit-interval-field');
const scheduleEveryMinutes = document.querySelector('#schedule-edit-every-minutes');
const scheduleOffsetField = document.querySelector('#schedule-edit-offset-field');
const scheduleStartOffset = document.querySelector('#schedule-edit-start-offset');
const scheduleWeekdays = document.querySelector('#schedule-edit-weekdays');
const scheduleWeekdayInputs = Array.from(scheduleWeekdays.querySelectorAll('input[type="checkbox"]'));
const scheduleResult = document.querySelector('#schedule-edit-result');
const executionDialog = document.querySelector('#execution-detail-dialog');
const executionClose = document.querySelector('#execution-detail-close');
const executionTitle = document.querySelector('#execution-detail-title');
const executionLinks = document.querySelector('#execution-detail-links');
const executionMeta = document.querySelector('#execution-detail-meta');
const executionErrorSection = document.querySelector('#execution-detail-error-section');
const executionError = document.querySelector('#execution-detail-error');
const executionLogCount = document.querySelector('#execution-detail-log-count');
const executionLogs = document.querySelector('#execution-detail-logs');
let schedulesCache = [];
let executionsCache = [];
let deviceNames = new Map();
let editingSchedule;
function shortDevice(udid) {
    return udid.length > 20 ? `${udid.slice(0, 8)}…${udid.slice(-6)}` : udid;
}
function deviceLabel(udid) {
    return deviceNames.get(udid) ?? shortDevice(udid);
}
function date(value) {
    return value ? new Date(value).toLocaleString() : '—';
}
function pluginLabel(pluginId) {
    if (pluginId === 'com.phone-farm.flow')
        return 'Portable flow';
    if (pluginId === 'com.git-agni.instagram')
        return 'Instagram';
    if (pluginId === 'com.git-agni.tiktok')
        return 'TikTok';
    return pluginId.replace(/^com\.(?:git-agni\.|phone-farm\.)/, '');
}
function taskLabel(pluginId, taskType) {
    if (pluginId === 'com.phone-farm.flow' && taskType === 'flow')
        return 'Portable flow';
    return `${pluginLabel(pluginId)} ${taskType}`;
}
function flowName(item) {
    if (item.pluginId !== 'com.phone-farm.flow' || item.taskType !== 'flow')
        return undefined;
    const name = item.payload?.name;
    return typeof name === 'string' && name.trim() ? name.trim() : 'Portable flow';
}
function flowKey(item) {
    const name = flowName(item);
    if (!name)
        return undefined;
    return typeof item.payload.sourceFlowId === 'string' && item.payload.sourceFlowId
        ? `id:${item.payload.sourceFlowId}` : `name:${name.toLowerCase()}`;
}
function runTitle(item) {
    return flowName(item) ?? taskLabel(item.pluginId, item.taskType);
}
function timingLabel(timing) {
    if (timing.kind === 'interval' && timing.everyMinutes)
        return `every ${timing.everyMinutes}m`;
    if ((timing.kind === 'daily' || timing.kind === 'weekly') && timing.localTime)
        return `${timing.kind} · ${timing.localTime}`;
    if (timing.kind === 'once' && timing.runAt)
        return `once · ${date(timing.runAt)}`;
    return timing.kind;
}
function localDatetimeValue(value) {
    if (!value)
        return '';
    const time = new Date(value);
    if (Number.isNaN(time.getTime()))
        return '';
    return new Date(time.getTime() - time.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}
function updateScheduleEditorFields() {
    const kind = scheduleKind.value;
    scheduleOnceField.hidden = kind !== 'once';
    scheduleTimeField.hidden = kind !== 'daily' && kind !== 'weekly';
    scheduleTimezoneField.hidden = kind !== 'daily' && kind !== 'weekly';
    scheduleWeekdays.hidden = kind !== 'weekly';
    scheduleIntervalField.hidden = kind !== 'interval';
    scheduleOffsetField.hidden = kind !== 'interval';
}
function openScheduleEditor(schedule) {
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
    for (const input of scheduleWeekdayInputs)
        input.checked = weekdays.has(Number(input.value));
    scheduleResult.textContent = '';
    updateScheduleEditorFields();
    scheduleDialog.showModal();
}
function timingFromEditor() {
    const kind = scheduleKind.value;
    if (kind === 'now')
        return { kind: 'now' };
    if (kind === 'once') {
        if (!scheduleRunAt.value)
            throw new Error('Choose when this schedule should run.');
        const runAt = new Date(scheduleRunAt.value);
        if (Number.isNaN(runAt.getTime()))
            throw new Error('Run-at time is invalid.');
        return { kind: 'once', runAt: runAt.toISOString() };
    }
    if (kind === 'daily' || kind === 'weekly') {
        const localTime = scheduleLocalTime.value;
        const timezone = scheduleTimezone.value.trim();
        if (!/^\d{2}:\d{2}$/.test(localTime))
            throw new Error('Choose a valid local time.');
        if (!timezone)
            throw new Error('Timezone is required.');
        if (kind === 'daily')
            return { kind, localTime, timezone };
        const weekdays = scheduleWeekdayInputs.filter((input) => input.checked).map((input) => Number(input.value));
        if (!weekdays.length)
            throw new Error('Choose at least one weekday.');
        return { kind, localTime, timezone, weekdays };
    }
    if (kind === 'interval') {
        const everyMinutes = Number(scheduleEveryMinutes.value);
        const startOffsetMinutes = Number(scheduleStartOffset.value || 0);
        if (!Number.isInteger(everyMinutes) || everyMinutes < 1 || everyMinutes > 1440)
            throw new Error('Interval must be between 1 and 1440 minutes.');
        if (!Number.isInteger(startOffsetMinutes) || startOffsetMinutes < 0 || startOffsetMinutes > 1440)
            throw new Error('Start offset must be between 0 and 1440 minutes.');
        return { kind, everyMinutes, ...(startOffsetMinutes ? { startOffsetMinutes } : {}) };
    }
    throw new Error('Unsupported schedule timing.');
}
function detailField(label, value) {
    const field = document.createElement('div');
    const name = document.createElement('span');
    name.textContent = label;
    const content = document.createElement('strong');
    content.textContent = value;
    field.append(name, content);
    return field;
}
function detailLink(label, href) {
    const link = document.createElement('a');
    link.className = 'execution-context-link';
    link.href = href;
    const kicker = document.createElement('span');
    kicker.textContent = label;
    const value = document.createElement('strong');
    value.textContent = label === 'Device' ? 'Open device' : 'Open flow source';
    link.append(kicker, value);
    return link;
}
async function openExecutionDetail(id) {
    executionTitle.textContent = 'Run details';
    executionLinks.replaceChildren();
    executionMeta.replaceChildren();
    executionErrorSection.hidden = true;
    executionLogs.textContent = 'Loading…';
    executionLogCount.textContent = '';
    executionDialog.showModal();
    try {
        const execution = await request(`/api/executions/${encodeURIComponent(id)}`);
        executionTitle.textContent = `${runTitle(execution)} · ${deviceLabel(execution.deviceUdid)}`;
        const links = [
            detailLink('Device', `/devices/${encodeURIComponent(execution.deviceUdid)}`),
        ];
        if (execution.pluginId === 'com.phone-farm.flow' && execution.taskType === 'flow') {
            const sourceFlowId = typeof execution.payload.sourceFlowId === 'string' ? execution.payload.sourceFlowId : undefined;
            links.push(detailLink(sourceFlowId ? 'Saved flow' : 'Flow workspace', sourceFlowId ? `/api/flows/${encodeURIComponent(sourceFlowId)}` : `/automations?template=flow&device=${encodeURIComponent(execution.deviceUdid)}`));
        }
        executionLinks.replaceChildren(...links);
        executionMeta.replaceChildren(detailField('Status', execution.status), detailField('Device', `${deviceLabel(execution.deviceUdid)} · ${shortDevice(execution.deviceUdid)}`), detailField('Run ID', execution.id), detailField('Scheduled', date(execution.scheduledFor)), detailField('Started', date(execution.startedAt)), detailField('Finished', date(execution.finishedAt)), detailField('Exit code', execution.exitCode === null || execution.exitCode === undefined ? '—' : String(execution.exitCode)), detailField('Schedule', execution.scheduleId ?? 'ad-hoc'), ...(flowName(execution) ? [detailField('Flow', `${flowName(execution)}${execution.payload.sourceFlowVersion ? ` · v${execution.payload.sourceFlowVersion}` : ''}`)] : []));
        executionErrorSection.hidden = !execution.error;
        executionError.textContent = execution.error ?? '';
        executionLogCount.textContent = `${execution.logs.length} line${execution.logs.length === 1 ? '' : 's'}`;
        executionLogs.textContent = execution.logs.length ? execution.logs.join('\n') : 'No logs recorded for this execution.';
    }
    catch (error) {
        executionLogs.textContent = error instanceof Error ? error.message : String(error);
    }
}
function queryMatch(values) {
    const query = search.value.trim().toLowerCase();
    return !query || values.some((value) => value.toLowerCase().includes(query));
}
function filteredSchedules() {
    const wanted = statusFilter.value;
    const wantedDevice = deviceFilter.value;
    const wantedFlow = flowFilter.value;
    return schedulesCache.filter((schedule) => (!wanted || schedule.status === wanted)
        && (!wantedDevice || schedule.deviceUdid === wantedDevice)
        && (!wantedFlow || flowKey(schedule) === wantedFlow)
        && queryMatch([deviceLabel(schedule.deviceUdid), schedule.deviceUdid, flowName(schedule) ?? '', schedule.pluginId, pluginLabel(schedule.pluginId), schedule.taskType, taskLabel(schedule.pluginId, schedule.taskType)]));
}
function filteredExecutions() {
    const wanted = statusFilter.value;
    const wantedDevice = deviceFilter.value;
    const wantedFlow = flowFilter.value;
    return executionsCache.filter((execution) => (!wanted || execution.status === wanted)
        && (!wantedDevice || execution.deviceUdid === wantedDevice)
        && (!wantedFlow || flowKey(execution) === wantedFlow)
        && queryMatch([deviceLabel(execution.deviceUdid), execution.deviceUdid, flowName(execution) ?? '', execution.pluginId, pluginLabel(execution.pluginId), execution.taskType, taskLabel(execution.pluginId, execution.taskType)]));
}
function syncFilters() {
    const selectedDevice = deviceFilter.value;
    const allDeviceIds = new Set([...deviceNames.keys(), ...schedulesCache.map(({ deviceUdid }) => deviceUdid), ...executionsCache.map(({ deviceUdid }) => deviceUdid)]);
    const devices = [...allDeviceIds].map((udid) => [udid, deviceLabel(udid)]).sort((a, b) => a[1].localeCompare(b[1]));
    deviceFilter.replaceChildren(new Option('All devices', ''), ...devices.map(([udid, name]) => new Option(name, udid)));
    if (selectedDevice && allDeviceIds.has(selectedDevice))
        deviceFilter.value = selectedDevice;
    const selectedFlow = flowFilter.value;
    const flows = new Map();
    for (const item of [...executionsCache, ...schedulesCache]) {
        const key = flowKey(item);
        const name = flowName(item);
        if (key && name)
            flows.set(key, name);
    }
    const options = [...flows.entries()].sort((a, b) => a[1].localeCompare(b[1])).map(([key, name]) => new Option(name, key));
    flowFilter.replaceChildren(new Option('All flows', ''), ...options);
    if (selectedFlow && flows.has(selectedFlow))
        flowFilter.value = selectedFlow;
}
async function request(url, options) {
    const response = await fetch(url, options);
    const body = await response.json();
    if (!response.ok)
        throw new Error(body.error ?? `Request failed (${response.status})`);
    return body;
}
function button(label, action, quietSuccess = false) {
    const value = document.createElement('button');
    value.className = 'icon-button';
    value.type = 'button';
    value.textContent = label;
    value.addEventListener('click', () => {
        value.disabled = true;
        actionStatus.hidden = false;
        actionStatus.classList.remove('error');
        actionStatus.textContent = `${label}…`;
        void action().then(() => {
            if (quietSuccess) {
                actionStatus.hidden = true;
                actionStatus.textContent = '';
            }
            else
                actionStatus.textContent = `${label} complete.`;
        }).catch((error) => {
            actionStatus.classList.add('error');
            actionStatus.textContent = error instanceof Error ? error.message : String(error);
        }).finally(() => { value.disabled = false; });
    });
    return value;
}
function renderSchedules(items) {
    if (!items.length) {
        schedulesElement.className = 'task-list empty-state';
        schedulesElement.innerHTML = `<h3>${schedulesCache.length ? 'No schedules match this filter' : 'No schedules yet'}</h3><p>${schedulesCache.length ? 'Change the search or status filter.' : 'Create a portable flow or app automation to schedule work.'}</p>`;
        return;
    }
    schedulesElement.className = 'task-list';
    schedulesElement.replaceChildren(...items.map((schedule) => {
        const row = document.createElement('article');
        row.className = 'task-row schedule-row';
        const copy = document.createElement('div');
        const title = document.createElement('h3');
        title.textContent = `${runTitle(schedule)} · ${deviceLabel(schedule.deviceUdid)}`;
        const meta = document.createElement('p');
        meta.textContent = `${shortDevice(schedule.deviceUdid)} · ${timingLabel(schedule.timing)} · next ${date(schedule.nextRunAt)}`;
        copy.append(title, meta);
        const state = document.createElement('span');
        state.className = `status ${schedule.status}`;
        state.textContent = schedule.status;
        const actions = document.createElement('div');
        actions.className = 'inline-actions';
        if (schedule.status === 'active' || schedule.status === 'paused') {
            actions.append(button('Edit', async () => { openScheduleEditor(schedule); }, true));
        }
        if (schedule.status === 'active')
            actions.append(button('Pause', async () => { await request(`/api/schedules/${schedule.id}/pause`, { method: 'POST' }); await load(); }));
        if (schedule.status === 'paused')
            actions.append(button('Resume', async () => { await request(`/api/schedules/${schedule.id}/resume`, { method: 'POST' }); await load(); }));
        if (schedule.status !== 'cancelled' && schedule.status !== 'completed')
            actions.append(button('Cancel', async () => { await request(`/api/schedules/${schedule.id}/cancel`, { method: 'POST' }); await load(); }));
        row.append(copy, state, actions);
        return row;
    }));
}
function renderExecutions(items) {
    if (!items.length) {
        executionsElement.className = 'task-list empty-state';
        executionsElement.innerHTML = `<h3>${executionsCache.length ? 'No executions match this filter' : 'No executions yet'}</h3><p>${executionsCache.length ? 'Change the search or status filter.' : 'Runs appear here as soon as an automation enters the scheduler.'}</p>`;
        return;
    }
    executionsElement.className = 'task-list';
    executionsElement.replaceChildren(...items.map((execution) => {
        const row = document.createElement('article');
        row.className = `task-row run-card${execution.error ? ' has-error' : ''}`;
        const copy = document.createElement('div');
        copy.className = 'run-card-copy';
        const context = document.createElement('div');
        context.className = 'run-card-context';
        const device = document.createElement('a');
        device.href = `/devices/${encodeURIComponent(execution.deviceUdid)}`;
        device.textContent = deviceLabel(execution.deviceUdid);
        const flow = flowName(execution);
        if (flow) {
            const source = typeof execution.payload.sourceFlowId === 'string' ? execution.payload.sourceFlowId : undefined;
            const flowLink = document.createElement('a');
            flowLink.href = source ? `/api/flows/${encodeURIComponent(source)}` : `/automations?template=flow&device=${encodeURIComponent(execution.deviceUdid)}`;
            flowLink.textContent = flow;
            context.append(device, flowLink);
        }
        else
            context.append(device);
        const title = document.createElement('h3');
        title.textContent = runTitle(execution);
        const meta = document.createElement('p');
        meta.textContent = `${date(execution.scheduledFor)} · ${shortDevice(execution.deviceUdid)}${execution.exitCode !== null && execution.exitCode !== undefined ? ` · exit ${execution.exitCode}` : ''}`;
        copy.append(context, title, meta);
        if (execution.error) {
            const error = document.createElement('p');
            error.className = 'run-card-error';
            error.textContent = execution.error;
            copy.append(error);
        }
        const state = document.createElement('span');
        state.className = `status ${execution.status}`;
        state.textContent = execution.status;
        const actions = document.createElement('div');
        actions.className = 'inline-actions';
        actions.append(button('Details', async () => { await openExecutionDetail(execution.id); }, true));
        if (execution.status === 'queued' || (execution.status === 'running' && execution.taskType === 'doomscroll')) {
            actions.append(button(execution.status === 'queued' ? 'Cancel' : 'Stop', async () => {
                await request(`/api/executions/${execution.id}/stop`, { method: 'POST' });
                await load();
            }));
        }
        if (execution.status === 'failed' || execution.status === 'stopped') {
            actions.append(button('Retry', async () => {
                if (!window.confirm('This automation may have partially completed. Check the device state before retrying.'))
                    return;
                await request(`/api/executions/${execution.id}/retry`, {
                    method: 'POST',
                    headers: { 'content-type': 'application/json' },
                    body: JSON.stringify({ confirmSideEffects: true }),
                });
                await load();
            }));
        }
        row.append(copy, state, actions);
        return row;
    }));
}
async function load() {
    refresh.disabled = true;
    try {
        const [scheduleData, executionData, devices] = await Promise.all([
            request('/api/schedules'),
            request('/api/executions'),
            request('/api/devices'),
        ]);
        deviceNames = new Map(devices.map((device) => [device.udid, device.name]));
        schedulesCache = scheduleData.schedules;
        executionsCache = executionData.executions;
        syncFilters();
        render();
        lastUpdated.textContent = `Updated ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}`;
    }
    catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        schedulesElement.textContent = message;
        executionsElement.textContent = message;
    }
    finally {
        refresh.disabled = false;
    }
}
function render() {
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
        if (!editingSchedule)
            return;
        const submit = scheduleForm.querySelector('button[type="submit"]');
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
            if (recurringPublish && !window.confirm('Confirm that this recurring schedule may publish publicly without confirmation on each occurrence.'))
                return;
            await request(`/api/schedules/${encodeURIComponent(editingSchedule.id)}`, {
                method: 'PATCH', headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ timing, runWindowMinutes, recurringPublishConfirmed: recurringPublish }),
            });
            scheduleDialog.close();
            editingSchedule = undefined;
            await load();
        }
        catch (error) {
            scheduleResult.textContent = error instanceof Error ? error.message : String(error);
        }
        finally {
            submit.disabled = false;
        }
    })();
});
void load();
setInterval(() => {
    if (liveRefresh.checked && !document.hidden)
        void load();
}, 5_000);
export {};
