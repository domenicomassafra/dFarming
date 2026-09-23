const search = document.querySelector('#device-list-search');
const statusFilter = document.querySelector('#device-list-status');
const platformFilter = document.querySelector('#device-list-platform');
const sortFilter = document.querySelector('#device-list-sort');
const reset = document.querySelector('#device-list-reset');
const summary = document.querySelector('#device-list-summary');
const actionStatus = document.querySelector('#device-list-action-status');
const filterEmpty = document.querySelector('#device-filter-empty');
const filterEmptyReset = document.querySelector('#device-filter-empty-reset');
const viewButtons = Array.from(document.querySelectorAll('[data-device-view]'));
const dialog = document.querySelector('#overview-rename-dialog');
const form = document.querySelector('#overview-rename-form');
const input = document.querySelector('#overview-rename-name');
const result = document.querySelector('#overview-rename-result');
const close = document.querySelector('#overview-rename-close');
const VIEW_STORAGE_KEY = 'dfarming.device-list-view';
const LEGACY_VIEW_STORAGE_KEY = 'mobile-farm.device-list-view';
let renameUdid = '';
let currentView = (() => {
    try {
        const current = localStorage.getItem(VIEW_STORAGE_KEY);
        const legacy = localStorage.getItem(LEGACY_VIEW_STORAGE_KEY);
        const value = current ?? legacy;
        if (current === null && legacy !== null) {
            localStorage.setItem(VIEW_STORAGE_KEY, legacy);
            localStorage.removeItem(LEGACY_VIEW_STORAGE_KEY);
        }
        return value === 'compact' ? 'compact' : 'grid';
    }
    catch {
        return 'grid';
    }
})();
function refreshDevices() {
    actionStatus.textContent = '';
    if (window.htmx) {
        window.htmx.ajax('GET', '/api/fragments/devices', { target: '#device-list', swap: 'outerHTML' });
        return;
    }
    location.reload();
}
function clearFilters() {
    search.value = '';
    statusFilter.value = '';
    platformFilter.value = '';
    applyFilters();
    search.focus();
}
function normalized(value) { return (value ?? '').toLowerCase(); }
function statusRank(value) {
    if (value === 'online')
        return 0;
    if (value === 'offline')
        return 1;
    return 2;
}
function compareEntries(left, right, mode) {
    const nameCompare = normalized(left.dataset.name).localeCompare(normalized(right.dataset.name));
    if (mode === 'name')
        return nameCompare;
    if (mode === 'status')
        return statusRank(left.dataset.status) - statusRank(right.dataset.status) || nameCompare;
    if (mode === 'platform') {
        return normalized(left.dataset.platform).localeCompare(normalized(right.dataset.platform))
            || normalized(left.dataset.kind).localeCompare(normalized(right.dataset.kind)) || nameCompare;
    }
    return normalized(left.dataset.worker || 'zzzz').localeCompare(normalized(right.dataset.worker || 'zzzz')) || nameCompare;
}
function sortEntries(list) {
    const mode = sortFilter.value;
    const disabledPanel = list.querySelector(':scope > .disabled-devices');
    const activeCards = Array.from(list.querySelectorAll(':scope > .device-card[data-device-entry]'))
        .sort((a, b) => compareEntries(a, b, mode));
    for (const card of activeCards)
        list.insertBefore(card, disabledPanel ?? null);
    const disabledList = disabledPanel?.querySelector('ul');
    if (disabledList) {
        const rows = Array.from(disabledList.querySelectorAll(':scope > li[data-device-entry]'))
            .sort((a, b) => compareEntries(a, b, mode));
        for (const row of rows)
            disabledList.append(row);
    }
}
function applyView(list = document.querySelector('#device-list')) {
    if (!list)
        return;
    list.classList.toggle('is-compact', currentView === 'compact');
    for (const button of viewButtons) {
        const active = button.dataset.deviceView === currentView;
        button.classList.toggle('is-active', active);
        button.setAttribute('aria-pressed', String(active));
    }
}
function setView(view) {
    currentView = view;
    try {
        localStorage.setItem(VIEW_STORAGE_KEY, view);
    }
    catch { /* storage may be unavailable */ }
    applyView();
}
function applyFilters() {
    const list = document.querySelector('#device-list');
    if (!list)
        return;
    sortEntries(list);
    applyView(list);
    const query = search.value.trim().toLowerCase();
    const wantedStatus = statusFilter.value;
    const wantedPlatform = platformFilter.value;
    const entries = Array.from(list.querySelectorAll('[data-device-entry]'));
    let shown = 0;
    let shownDisabled = 0;
    for (const entry of entries) {
        const matchesQuery = !query || (entry.dataset.search ?? '').includes(query);
        const matchesStatus = !wantedStatus || entry.dataset.status === wantedStatus;
        const matchesPlatform = !wantedPlatform || entry.dataset.platform === wantedPlatform;
        const visible = matchesQuery && matchesStatus && matchesPlatform;
        entry.hidden = !visible;
        if (visible) {
            shown += 1;
            if (entry.dataset.status === 'disabled')
                shownDisabled += 1;
        }
    }
    const disabledPanel = list.querySelector('.disabled-devices');
    if (disabledPanel) {
        disabledPanel.hidden = shownDisabled === 0;
        if (shownDisabled && (query || wantedStatus === 'disabled' || wantedPlatform))
            disabledPanel.open = true;
    }
    const baseEmpty = list.querySelector('[data-device-base-empty]');
    if (baseEmpty)
        baseEmpty.hidden = Boolean(query || wantedStatus || wantedPlatform);
    const filtered = entries.length > 0 && shown === 0;
    filterEmpty.hidden = !filtered;
    summary.textContent = entries.length
        ? (shown === entries.length ? `${entries.length} device${entries.length === 1 ? '' : 's'}` : `${shown} shown · ${entries.length} total`)
        : '0 devices';
}
async function patchDevice(udid, body) {
    const response = await fetch(`/api/devices/${encodeURIComponent(udid)}`, {
        method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
    });
    if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload.error ?? `Request failed (${response.status})`);
    }
}
document.addEventListener('click', (event) => {
    const target = event.target instanceof Element ? event.target : null;
    const rename = target?.closest('[data-rename-device]');
    if (rename) {
        event.preventDefault();
        rename.closest('details')?.removeAttribute('open');
        const root = rename.closest('.device-card, li') ?? rename.parentElement;
        renameUdid = rename.dataset.renameDevice ?? '';
        input.value = (root?.querySelector('.device-name')?.textContent ?? '').replace(/\s+/g, ' ').trim();
        result.textContent = '';
        dialog.showModal();
        input.focus();
        input.select();
        return;
    }
    const toggle = target?.closest('[data-toggle-device]');
    if (!toggle)
        return;
    event.preventDefault();
    toggle.closest('details')?.removeAttribute('open');
    toggle.disabled = true;
    actionStatus.textContent = toggle.dataset.disabled === 'true' ? 'Disconnecting…' : 'Reconnecting…';
    void patchDevice(toggle.dataset.toggleDevice ?? '', { disabled: toggle.dataset.disabled === 'true' })
        .then(refreshDevices)
        .catch((error) => {
        toggle.disabled = false;
        actionStatus.textContent = error instanceof Error ? error.message : String(error);
    });
});
close.addEventListener('click', () => dialog.close());
form.addEventListener('submit', (event) => {
    event.preventDefault();
    const name = input.value.replace(/\s+/g, ' ').trim();
    if (!renameUdid || !name) {
        result.textContent = 'Device name is required.';
        return;
    }
    const submit = form.querySelector('button[type="submit"]');
    submit.disabled = true;
    result.textContent = 'Saving…';
    void patchDevice(renameUdid, { name })
        .then(() => { dialog.close(); refreshDevices(); })
        .catch((error) => { result.textContent = error instanceof Error ? error.message : String(error); })
        .finally(() => { submit.disabled = false; });
});
search.addEventListener('input', applyFilters);
statusFilter.addEventListener('change', applyFilters);
platformFilter.addEventListener('change', applyFilters);
sortFilter.addEventListener('change', applyFilters);
reset.addEventListener('click', clearFilters);
filterEmptyReset.addEventListener('click', clearFilters);
for (const button of viewButtons)
    button.addEventListener('click', () => setView(button.dataset.deviceView === 'compact' ? 'compact' : 'grid'));
function handleDeviceListSwap(event) {
    const detail = event.detail;
    const target = detail?.elt ?? detail?.target ?? (event.target instanceof Element ? event.target : undefined);
    if (target?.id === 'device-list')
        applyFilters();
}
document.body.addEventListener('htmx:afterSwap', handleDeviceListSwap);
document.body.addEventListener('htmx:afterSettle', handleDeviceListSwap);
const main = document.querySelector('main');
if (main) {
    new MutationObserver((records) => {
        const replaced = records.some(({ addedNodes }) => Array.from(addedNodes)
            .some((node) => node instanceof HTMLElement && node.id === 'device-list'));
        if (replaced)
            queueMicrotask(applyFilters);
    }).observe(main, { childList: true });
}
applyFilters();
export {};
