const grid = document.querySelector('#fleet-grid');
const count = document.querySelector('#fleet-visible-count');
const refresh = document.querySelector('#fleet-refresh');
const reset = document.querySelector('#fleet-reset');
const search = document.querySelector('#fleet-search');
const statusFilter = document.querySelector('#fleet-status');
const platformFilter = document.querySelector('#fleet-platform');
const kindFilter = document.querySelector('#fleet-kind');
const notice = document.querySelector('#fleet-notice');
const groupBy = document.querySelector('#fleet-group');
const autoRefresh = document.querySelector('#fleet-auto-refresh');
const lastUpdated = document.querySelector('#fleet-last-updated');
const bulk = document.querySelector('#fleet-bulk');
const selectedCount = document.querySelector('#fleet-selected-count');
const selectVisible = document.querySelector('#fleet-select-visible');
const clearSelection = document.querySelector('#fleet-clear-selection');
const bulkAction = document.querySelector('#fleet-bulk-action');
const bulkApply = document.querySelector('#fleet-bulk-apply');
const bulkStatus = document.querySelector('#fleet-bulk-status');
const focus = document.querySelector('#fleet-focus');
const focusName = document.querySelector('#fleet-focus-name');
const focusMeta = document.querySelector('#fleet-focus-meta');
const focusScreen = document.querySelector('#fleet-focus-screen');
const focusMode = document.querySelector('#fleet-focus-mode');
const focusStatus = document.querySelector('#fleet-focus-status');
const focusOpen = document.querySelector('#fleet-focus-open');
const focusClose = document.querySelector('#fleet-focus-close');
const focusRetry = document.querySelector('#fleet-focus-retry');
const focusStill = document.querySelector('#fleet-focus-still');
const stats = {
    total: document.querySelector('#fleet-total'),
    online: document.querySelector('#fleet-online'),
    offline: document.querySelector('#fleet-offline'),
    disconnected: document.querySelector('#fleet-disconnected'),
};
let devices = [];
let running = new Map();
let focusedUdid = '';
let focusFallbackActive = false;
let focusGeneration = 0;
let grouping = 'host';
const selected = new Set();
const EMPTY_FOCUS_FRAME = 'data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=';
function escapeHtml(value) {
    return value.replace(/[&<>"']/g, (character) => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[character] ?? character));
}
async function json(url, init) {
    const response = await fetch(url, init);
    const body = await response.json().catch(() => ({}));
    if (!response.ok)
        throw new Error(body.error ?? `Request failed (${response.status})`);
    return body;
}
function connectivity(device) {
    if (device.disabled)
        return 'disconnected';
    return device.connected ? 'online' : 'offline';
}
function stateRank(device) {
    const state = connectivity(device);
    return state === 'online' ? 0 : state === 'offline' ? 1 : 2;
}
function sorted(rows) {
    return [...rows].sort((left, right) => stateRank(left) - stateRank(right)
        || left.name.localeCompare(right.name, undefined, { sensitivity: 'base' })
        || left.udid.localeCompare(right.udid));
}
function matches(device) {
    const platform = device.platform ?? 'ios';
    const kind = device.kind ?? 'physical';
    if (statusFilter.value && connectivity(device) !== statusFilter.value)
        return false;
    if (platformFilter.value && platform !== platformFilter.value)
        return false;
    if (kindFilter.value && kind !== kindFilter.value)
        return false;
    const query = search.value.trim().toLowerCase();
    if (!query)
        return true;
    return [device.name, device.udid, device.workerId ?? '', platform, kind, connectivity(device), ...(device.tags ?? [])]
        .some((value) => value.toLowerCase().includes(query));
}
function screenshotUrl(udid) {
    return `/api/devices/${encodeURIComponent(udid)}/remote/screenshot?t=${Date.now()}`;
}
function stateLabel(state) {
    return state === 'disconnected' ? 'Disconnected' : state[0].toUpperCase() + state.slice(1);
}
function tile(device) {
    const platform = device.platform ?? 'ios';
    const kind = device.kind ?? 'physical';
    const state = connectivity(device);
    const online = state === 'online';
    const execution = running.get(device.udid);
    const worker = device.workerId ? ` · ${escapeHtml(device.workerId)}` : ' · unassigned';
    const tags = (device.tags ?? []).map((tag) => `<span class="connection-chip tag">#${escapeHtml(tag)}</span>`).join('');
    const preview = online
        ? `<div class="fleet-preview-frame"><img class="fleet-still-preview" src="${screenshotUrl(device.udid)}" alt="Still preview of ${escapeHtml(device.name)}" draggable="false"><div class="fleet-preview-unavailable" hidden>Preview unavailable</div><span class="fleet-preview-badge">Still · 8s</span></div>`
        : `<div class="mock-screen mock-offline"><div class="mock-offline-mark"></div><span class="mock-offline-label">${stateLabel(state)}</span></div>`;
    return `<article class="fleet-tile${focusedUdid === device.udid ? ' is-focused' : ''}${selected.has(device.udid) ? ' is-selected' : ''}" data-udid="${escapeHtml(device.udid)}" data-status="${state}">
        <label class="fleet-select"><input type="checkbox" data-select="${escapeHtml(device.udid)}" ${selected.has(device.udid) ? 'checked' : ''}><span>Select</span></label>
        <button class="fleet-tile-focus" type="button" data-focus="${escapeHtml(device.udid)}" ${online ? '' : 'disabled'} aria-label="${online ? `Focus live stream for ${escapeHtml(device.name)}` : `${stateLabel(state)} device ${escapeHtml(device.name)}`}">
            <div class="fleet-phone"><div class="fleet-bezel">${preview}</div></div>
        </button>
        <div class="fleet-copy"><div class="fleet-copy-title"><h2>${escapeHtml(device.name)}</h2><span class="connection-chip ${state}">${stateLabel(state)}</span></div><p>${escapeHtml(platform)} · ${escapeHtml(kind)}${device.connected?.osVersion ? ` · ${escapeHtml(device.connected.osVersion)}` : ''}${worker}</p>
            <div class="fleet-chips">${execution ? `<span class="connection-chip running">Running · ${escapeHtml(execution.taskType)}</span>` : '<span class="connection-chip">Idle</span>'}${tags}</div>
        </div>
        <a class="button secondary fleet-open" href="/devices/${encodeURIComponent(device.udid)}">Open workspace</a>
    </article>`;
}
function groupKey(device) {
    if (grouping === 'host')
        return device.workerId || 'Local / unassigned';
    if (grouping === 'platform')
        return device.platform ?? 'ios';
    if (grouping === 'kind')
        return device.kind ?? 'physical';
    return '';
}
function groupLabel(key) {
    if (grouping === 'platform')
        return key === 'ios' ? 'iOS' : key === 'android' ? 'Android' : key;
    if (grouping === 'kind')
        return key[0].toUpperCase() + key.slice(1);
    return key;
}
function groupSummary(rows) {
    const online = rows.filter((device) => connectivity(device) === 'online').length;
    const offline = rows.filter((device) => connectivity(device) === 'offline').length;
    const disconnected = rows.filter((device) => connectivity(device) === 'disconnected').length;
    return `${rows.length} device${rows.length === 1 ? '' : 's'} · ${online} online${offline ? ` · ${offline} offline` : ''}${disconnected ? ` · ${disconnected} disconnected` : ''}`;
}
function groupedHtml(visible) {
    if (grouping === 'none')
        return sorted(visible).map(tile).join('');
    const groups = new Map();
    for (const device of visible) {
        const key = groupKey(device);
        groups.set(key, [...(groups.get(key) ?? []), device]);
    }
    return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([key, rows]) => `
        <section class="fleet-group" data-fleet-group="${escapeHtml(key)}">
            <div class="fleet-group-heading"><div><span class="eyebrow">${escapeHtml(grouping === 'host' ? 'Execution host' : grouping)}</span><h2>${escapeHtml(groupLabel(key))}</h2></div><span>${escapeHtml(groupSummary(rows))}</span></div>
            <div class="fleet-grid fleet-grid-group">${sorted(rows).map(tile).join('')}</div>
        </section>`).join('');
}
function updateBulkBar() {
    bulk.hidden = selected.size === 0;
    selectedCount.textContent = `${selected.size} selected`;
}
function render() {
    const visible = devices.filter(matches);
    const stateCounts = {
        online: devices.filter((device) => connectivity(device) === 'online').length,
        offline: devices.filter((device) => connectivity(device) === 'offline').length,
        disconnected: devices.filter((device) => connectivity(device) === 'disconnected').length,
    };
    stats.total.textContent = String(devices.length);
    stats.online.textContent = String(stateCounts.online);
    stats.offline.textContent = String(stateCounts.offline);
    stats.disconnected.textContent = String(stateCounts.disconnected);
    count.textContent = devices.length === visible.length ? `${devices.length} device${devices.length === 1 ? '' : 's'}` : `${visible.length} shown · ${devices.length} total`;
    notice.className = `fleet-notice${devices.length === 0 || stateCounts.online === 0 ? ' needs-attention' : ''}`;
    notice.innerHTML = devices.length === 0
        ? '<div><strong>No devices registered.</strong><span>Add a phone or attach a simulator/emulator to build the wall.</span></div><div class="inline-actions"><a class="button primary" href="/devices/register">Add device</a><a class="button secondary" href="/#host-list">Execution hosts</a></div>'
        : stateCounts.online === 0
            ? `<div><strong>No devices are online.</strong><span>${stateCounts.offline} offline · ${stateCounts.disconnected} disconnected. Check hosts or re-enable devices.</span></div><a class="button secondary" href="/#host-list">Execution hosts</a>`
            : `<div><strong>${stateCounts.online}/${devices.length} devices online.</strong><span>${stateCounts.offline} offline · ${stateCounts.disconnected} disconnected · ${running.size} running. Tiles are still previews; only the focused device streams live.</span></div>`;
    for (const udid of [...selected])
        if (!devices.some((device) => device.udid === udid))
            selected.delete(udid);
    grid.innerHTML = visible.length ? groupedHtml(visible)
        : devices.length
            ? '<div class="empty-state"><span class="empty-state-kicker">Fleet filters</span><h2>No devices match</h2><p>Clear the current search or connectivity/platform/kind filters.</p><button class="button secondary" type="button" data-reset-fleet>Reset filters</button></div>'
            : '<div class="empty-state"><span class="empty-state-kicker">Device wall</span><h2>Your fleet is empty</h2><p>Add a physical phone or attach a simulator/emulator. Execution hosts stay visible on Overview while the farm is empty.</p><div class="empty-state-actions"><a class="button primary" href="/devices/register">Add device</a><a class="button secondary" href="/#host-list">Execution hosts</a></div></div>';
    updateBulkBar();
}
function closeFocus() {
    focusGeneration += 1;
    focusedUdid = '';
    focusFallbackActive = false;
    focusScreen.src = EMPTY_FOCUS_FRAME;
    focus.hidden = true;
    focusMode.className = 'connection-chip';
    focusMode.textContent = 'Idle';
    render();
}
async function load() {
    refresh.disabled = true;
    try {
        const [deviceRows, executionRows] = await Promise.all([
            json('/api/devices'),
            json('/api/executions'),
        ]);
        devices = deviceRows;
        running = new Map(executionRows.executions.filter(({ status }) => status === 'running')
            .map((execution) => [execution.deviceUdid, execution]));
        const focused = devices.find((device) => device.udid === focusedUdid);
        if (focusedUdid && (!focused || connectivity(focused) !== 'online'))
            closeFocus();
        else
            render();
        lastUpdated.textContent = `Updated ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}`;
    }
    catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        notice.className = 'fleet-notice needs-attention';
        notice.innerHTML = `<div><strong>Fleet refresh failed.</strong><span>${escapeHtml(message)}</span></div>`;
        grid.innerHTML = `<div class="empty-state"><h2>Fleet unavailable</h2><p>${escapeHtml(message)}</p><button class="button secondary" type="button" data-retry-fleet>Retry</button></div>`;
        lastUpdated.textContent = 'Refresh failed';
    }
    finally {
        refresh.disabled = false;
    }
}
async function liveStreamUrl(udid) {
    const result = await json(`/api/devices/${encodeURIComponent(udid)}/remote/stream-token?scope=fleet`, { method: 'POST' });
    return result.url;
}
function setFocusMode(mode, text) {
    focusMode.className = `connection-chip ${mode === 'live' ? 'online' : mode === 'still' ? 'offline' : 'disconnected'}`;
    focusMode.textContent = mode === 'live' ? 'Live' : mode === 'still' ? 'Still preview' : 'Unavailable';
    focusStatus.textContent = text;
}
function showStill(udid, message = 'Still preview refreshed') {
    focusGeneration += 1;
    focusFallbackActive = true;
    focusScreen.src = screenshotUrl(udid);
    setFocusMode('still', message);
}
async function connectLive(udid) {
    const generation = ++focusGeneration;
    focusFallbackActive = false;
    // Replacing the src with a local frame first forces Chromium to tear down
    // the existing multipart request before we ask the control plane for the
    // next device stream. The generation guard also prevents fast A→B clicks
    // from allowing an older token request to win the race.
    focusScreen.src = EMPTY_FOCUS_FRAME;
    setFocusMode('live', 'Switching focused stream…');
    await new Promise((resolve) => window.setTimeout(resolve, 180));
    if (generation !== focusGeneration || focusedUdid !== udid)
        return;
    setFocusMode('live', 'Connecting live stream…');
    try {
        const url = await liveStreamUrl(udid);
        if (generation !== focusGeneration || focusedUdid !== udid)
            return;
        focusScreen.src = url;
        setFocusMode('live', 'Only this focused device is streaming live');
    }
    catch (error) {
        showStill(udid, error instanceof Error ? `${error.message} · showing still preview` : 'Live unavailable · showing still preview');
    }
}
async function focusDevice(udid) {
    const device = devices.find((candidate) => candidate.udid === udid);
    if (!device || connectivity(device) !== 'online')
        return;
    focusedUdid = udid;
    render();
    focus.hidden = false;
    focusName.textContent = device.name;
    focusMeta.textContent = `${device.platform ?? 'ios'} · ${device.kind ?? 'physical'}${device.workerId ? ` · ${device.workerId}` : ' · unassigned'}${device.tags?.length ? ` · ${device.tags.map((tag) => `#${tag}`).join(' ')}` : ''}`;
    focusOpen.href = `/devices/${encodeURIComponent(udid)}`;
    await connectLive(udid);
}
function clearFilters() {
    search.value = '';
    statusFilter.value = '';
    platformFilter.value = '';
    kindFilter.value = '';
    grouping = 'host';
    groupBy.value = grouping;
    render();
    search.focus();
}
function confirmation(action, amount) {
    if (action === 'clear-queue')
        return `Clear queued work and request stop for running automation on ${amount} selected device${amount === 1 ? '' : 's'}?`;
    if (action === 'disable')
        return `Disconnect / disable ${amount} selected device${amount === 1 ? '' : 's'}? Devices with active automation will be refused until Clear queue + stop is completed.`;
    if (action === 'enable')
        return `Enable ${amount} selected device${amount === 1 ? '' : 's'} so they can receive automation again?`;
    return `Request reconnect for ${amount} selected device${amount === 1 ? '' : 's'}? Devices with active automation may refuse the reconnect.`;
}
grid.addEventListener('click', (event) => {
    const target = event.target;
    if (target.closest('[data-reset-fleet]')) {
        clearFilters();
        return;
    }
    if (target.closest('[data-retry-fleet]')) {
        void load();
        return;
    }
    const selector = target.closest('[data-select]');
    if (selector?.dataset.select) {
        if (selector.checked)
            selected.add(selector.dataset.select);
        else
            selected.delete(selector.dataset.select);
        updateBulkBar();
        selector.closest('.fleet-tile')?.classList.toggle('is-selected', selector.checked);
        return;
    }
    const button = target.closest('[data-focus]');
    if (button?.dataset.focus)
        void focusDevice(button.dataset.focus);
});
grid.addEventListener('error', (event) => {
    const image = event.target;
    if (!(image instanceof HTMLImageElement) || !image.classList.contains('fleet-still-preview'))
        return;
    image.hidden = true;
    const fallback = image.parentElement?.querySelector('.fleet-preview-unavailable');
    if (fallback)
        fallback.hidden = false;
}, true);
search.addEventListener('input', render);
statusFilter.addEventListener('change', render);
platformFilter.addEventListener('change', render);
kindFilter.addEventListener('change', render);
reset.addEventListener('click', clearFilters);
refresh.addEventListener('click', () => void load());
groupBy.addEventListener('change', () => {
    grouping = groupBy.value;
    render();
});
selectVisible.addEventListener('click', () => {
    devices.filter(matches).forEach((device) => selected.add(device.udid));
    render();
});
clearSelection.addEventListener('click', () => {
    selected.clear();
    bulkStatus.textContent = '';
    bulkStatus.classList.remove('error');
    render();
});
bulkApply.addEventListener('click', async () => {
    const action = bulkAction.value;
    if (!action || !selected.size)
        return;
    if (!window.confirm(confirmation(action, selected.size)))
        return;
    bulkApply.disabled = true;
    bulkStatus.classList.remove('error');
    bulkStatus.textContent = 'Applying confirmed action…';
    try {
        const result = await json('/api/fleet/actions', {
            method: 'POST', headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ deviceUdids: [...selected], action }),
        });
        const failures = result.results?.filter(({ ok }) => !ok) ?? [];
        const successes = result.results?.filter(({ ok }) => ok).length ?? result.affected ?? selected.size;
        if (failures.length) {
            bulkStatus.classList.add('error');
            bulkStatus.textContent = `${successes} completed · ${failures.length} blocked: ${failures.map(({ udid, message }) => `${udid} (${message})`).join('; ')}`;
            selected.clear();
            failures.forEach(({ udid }) => selected.add(udid));
        }
        else {
            bulkStatus.textContent = `${successes} device${successes === 1 ? '' : 's'} · ${action} complete.`;
            selected.clear();
            bulkAction.value = '';
        }
        await load();
    }
    catch (error) {
        bulkStatus.classList.add('error');
        bulkStatus.textContent = error instanceof Error ? error.message : String(error);
    }
    finally {
        bulkApply.disabled = false;
    }
});
focusClose.addEventListener('click', closeFocus);
focusRetry.addEventListener('click', () => { if (focusedUdid)
    void connectLive(focusedUdid); });
focusStill.addEventListener('click', () => { if (focusedUdid)
    showStill(focusedUdid); });
focusScreen.addEventListener('error', () => {
    if (!focusedUdid)
        return;
    if (focusFallbackActive) {
        focusScreen.removeAttribute('src');
        setFocusMode('unavailable', 'Device preview unavailable');
        return;
    }
    showStill(focusedUdid, 'Stream interrupted · showing still preview');
});
void load();
window.setInterval(() => { if (autoRefresh.checked)
    void load(); }, 8_000);
export {};
