export {};

declare global {
    interface Window {
        htmx?: { ajax(method: string, url: string, options: { target: string; swap: string }): unknown };
    }
}

type DeviceView = 'grid' | 'compact';
type DeviceSort = 'status' | 'name' | 'platform' | 'worker';

const search = document.querySelector<HTMLInputElement>('#device-list-search')!;
const statusFilter = document.querySelector<HTMLSelectElement>('#device-list-status')!;
const platformFilter = document.querySelector<HTMLSelectElement>('#device-list-platform')!;
const sortFilter = document.querySelector<HTMLSelectElement>('#device-list-sort')!;
const reset = document.querySelector<HTMLButtonElement>('#device-list-reset')!;
const summary = document.querySelector<HTMLElement>('#device-list-summary')!;
const actionStatus = document.querySelector<HTMLElement>('#device-list-action-status')!;
const filterEmpty = document.querySelector<HTMLElement>('#device-filter-empty')!;
const filterEmptyReset = document.querySelector<HTMLButtonElement>('#device-filter-empty-reset')!;
const viewButtons = Array.from(document.querySelectorAll<HTMLButtonElement>('[data-device-view]'));
const dialog = document.querySelector<HTMLDialogElement>('#overview-rename-dialog')!;
const form = document.querySelector<HTMLFormElement>('#overview-rename-form')!;
const input = document.querySelector<HTMLInputElement>('#overview-rename-name')!;
const result = document.querySelector<HTMLElement>('#overview-rename-result')!;
const close = document.querySelector<HTMLButtonElement>('#overview-rename-close')!;
const VIEW_STORAGE_KEY = 'dfarming.device-list-view';
const LEGACY_VIEW_STORAGE_KEY = 'mobile-farm.device-list-view';
let renameUdid = '';
let currentView: DeviceView = (() => {
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
    catch { return 'grid'; }
})();

function refreshDevices(): void {
    actionStatus.textContent = '';
    if (window.htmx) {
        window.htmx.ajax('GET', '/api/fragments/devices', { target: '#device-list', swap: 'outerHTML' });
        return;
    }
    location.reload();
}

function clearFilters(): void {
    search.value = '';
    statusFilter.value = '';
    platformFilter.value = '';
    applyFilters();
    search.focus();
}

function normalized(value: string | undefined): string { return (value ?? '').toLowerCase(); }
function statusRank(value: string | undefined): number {
    if (value === 'online') return 0;
    if (value === 'offline') return 1;
    return 2;
}

function compareEntries(left: HTMLElement, right: HTMLElement, mode: DeviceSort): number {
    const nameCompare = normalized(left.dataset.name).localeCompare(normalized(right.dataset.name));
    if (mode === 'name') return nameCompare;
    if (mode === 'status') return statusRank(left.dataset.status) - statusRank(right.dataset.status) || nameCompare;
    if (mode === 'platform') {
        return normalized(left.dataset.platform).localeCompare(normalized(right.dataset.platform))
            || normalized(left.dataset.kind).localeCompare(normalized(right.dataset.kind)) || nameCompare;
    }
    return normalized(left.dataset.worker || 'zzzz').localeCompare(normalized(right.dataset.worker || 'zzzz')) || nameCompare;
}

function sortEntries(list: HTMLElement): void {
    const mode = sortFilter.value as DeviceSort;
    const disabledPanel = list.querySelector<HTMLDetailsElement>(':scope > .disabled-devices');
    const activeCards = Array.from(list.querySelectorAll<HTMLElement>(':scope > .device-card[data-device-entry]'))
        .sort((a, b) => compareEntries(a, b, mode));
    for (const card of activeCards) list.insertBefore(card, disabledPanel ?? null);
    const disabledList = disabledPanel?.querySelector('ul');
    if (disabledList) {
        const rows = Array.from(disabledList.querySelectorAll<HTMLElement>(':scope > li[data-device-entry]'))
            .sort((a, b) => compareEntries(a, b, mode));
        for (const row of rows) disabledList.append(row);
    }
}

function applyView(list = document.querySelector<HTMLElement>('#device-list')): void {
    if (!list) return;
    list.classList.toggle('is-compact', currentView === 'compact');
    for (const button of viewButtons) {
        const active = button.dataset.deviceView === currentView;
        button.classList.toggle('is-active', active);
        button.setAttribute('aria-pressed', String(active));
    }
}

function setView(view: DeviceView): void {
    currentView = view;
    try { localStorage.setItem(VIEW_STORAGE_KEY, view); } catch { /* storage may be unavailable */ }
    applyView();
}

function applyFilters(): void {
    const list = document.querySelector<HTMLElement>('#device-list');
    if (!list) return;
    sortEntries(list);
    applyView(list);
    const query = search.value.trim().toLowerCase();
    const wantedStatus = statusFilter.value;
    const wantedPlatform = platformFilter.value;
    const entries = Array.from(list.querySelectorAll<HTMLElement>('[data-device-entry]'));
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
            if (entry.dataset.status === 'disabled') shownDisabled += 1;
        }
    }
    const disabledPanel = list.querySelector<HTMLDetailsElement>('.disabled-devices');
    if (disabledPanel) {
        disabledPanel.hidden = shownDisabled === 0;
        if (shownDisabled && (query || wantedStatus === 'disabled' || wantedPlatform)) disabledPanel.open = true;
    }
    const baseEmpty = list.querySelector<HTMLElement>('[data-device-base-empty]');
    if (baseEmpty) baseEmpty.hidden = Boolean(query || wantedStatus || wantedPlatform);
    const filtered = entries.length > 0 && shown === 0;
    filterEmpty.hidden = !filtered;
    summary.textContent = entries.length
        ? (shown === entries.length ? `${entries.length} device${entries.length === 1 ? '' : 's'}` : `${shown} shown · ${entries.length} total`)
        : '0 devices';
}

async function patchDevice(udid: string, body: Record<string, unknown>): Promise<void> {
    const response = await fetch(`/api/devices/${encodeURIComponent(udid)}`, {
        method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
    });
    if (!response.ok) {
        const payload = await response.json().catch(() => ({})) as { error?: string };
        throw new Error(payload.error ?? `Request failed (${response.status})`);
    }
}

document.addEventListener('click', (event) => {
    const target = event.target instanceof Element ? event.target : null;
    const rename = target?.closest<HTMLButtonElement>('[data-rename-device]');
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
    const toggle = target?.closest<HTMLButtonElement>('[data-toggle-device]');
    if (!toggle) return;
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
    if (!renameUdid || !name) { result.textContent = 'Device name is required.'; return; }
    const submit = form.querySelector<HTMLButtonElement>('button[type="submit"]')!;
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
for (const button of viewButtons) button.addEventListener('click', () => setView(button.dataset.deviceView === 'compact' ? 'compact' : 'grid'));
function handleDeviceListSwap(event: Event): void {
    const detail = (event as CustomEvent<{ elt?: Element; target?: Element }>).detail;
    const target = detail?.elt ?? detail?.target ?? (event.target instanceof Element ? event.target : undefined);
    if (target?.id === 'device-list') applyFilters();
}
document.body.addEventListener('htmx:afterSwap', handleDeviceListSwap);
document.body.addEventListener('htmx:afterSettle', handleDeviceListSwap);
const main = document.querySelector('main');
if (main) {
    new MutationObserver((records) => {
        const replaced = records.some(({ addedNodes }) => Array.from(addedNodes)
            .some((node) => node instanceof HTMLElement && node.id === 'device-list'));
        if (replaced) queueMicrotask(applyFilters);
    }).observe(main, { childList: true });
}
applyFilters();
