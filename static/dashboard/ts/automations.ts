export {};

interface DeviceRow {
    udid: string;
    name: string;
    disabled?: boolean;
    platform?: 'ios' | 'android';
    kind?: 'physical' | 'simulator' | 'emulator';
    workerId?: string;
    tags?: string[];
}

interface DevicePoolRow {
    id: string;
    name: string;
    selector: {
        platform?: 'ios' | 'android';
        kind?: 'physical' | 'simulator' | 'emulator';
        preferredKinds?: Array<'physical' | 'simulator' | 'emulator'>;
        workerId?: string;
        tags?: string[];
        requireIdle?: boolean;
    };
    updatedAt: string;
}

type FlowStep =
    | { action: 'launch' | 'terminate'; appId: string }
    | { action: 'wait'; milliseconds: number }
    | { action: 'tap'; x: number; y: number }
    | { action: 'swipe'; startX: number; startY: number; endX: number; endY: number; durationMs: number }
    | { action: 'type'; text: string }
    | { action: 'tapText' | 'waitVisible' | 'assertVisible' | 'waitGone'; text: string; type?: string; exact?: boolean; timeoutMs?: number }
    | { action: 'inputText'; target: string; text: string; type?: string; exact?: boolean; timeoutMs?: number }
    | { action: 'home' | 'lock' | 'wake' | 'unlock' | 'volumeUp' | 'volumeDown' | 'screenshot' };

interface PipelineItem {
    id: string;
    status: string;
    caption: string | null;
    assetName: string | null;
    mimeType: string | null;
    error: string | null;
    createdAt: string;
    publishedAt: string | null;
}

interface FleetPreviewRow {
    udid: string;
    name: string;
    farmIndex: number;
    staggerMinutes: number;
    order: number;
}

interface PipelineState {
    enabled: boolean;
    frequency?: string;
    frequencyLabel?: string;
    fleet?: boolean;
    staggerMinutes?: number;
    farmIndex?: number;
    checkTimes: Array<{ localTime?: string; timezone?: string; everyMinutes?: number; label?: string }>;
    fleetPreview?: FleetPreviewRow[];
    items: PipelineItem[];
}

interface FlowLibraryRow {
    id: string;
    name: string;
    currentVersion: number;
    updatedAt: string;
    payload: { name: string; steps: FlowStep[] };
}

interface FlowDetail extends FlowLibraryRow {
    versions: Array<{ version: number; createdAt: string }>;
}

const params = new URLSearchParams(location.search);
const elements = {
    templates: Array.from(document.querySelectorAll<HTMLButtonElement>('.automation-template[data-template]')),
    workspace: document.querySelector<HTMLElement>('#pipeline-workspace')!,
    flowWorkspace: document.querySelector<HTMLElement>('#flow-workspace')!,
    flowTargetMode: document.querySelector<HTMLSelectElement>('#flow-target-mode')!,
    flowDeviceField: document.querySelector<HTMLElement>('#flow-device-field')!,
    flowDevice: document.querySelector<HTMLSelectElement>('#flow-device')!,
    flowPoolFields: document.querySelector<HTMLElement>('#flow-pool-fields')!,
    flowPoolPlatform: document.querySelector<HTMLSelectElement>('#flow-pool-platform')!,
    flowPoolKind: document.querySelector<HTMLSelectElement>('#flow-pool-kind')!,
    flowPoolPreference: document.querySelector<HTMLSelectElement>('#flow-pool-preference')!,
    flowPoolWorker: document.querySelector<HTMLSelectElement>('#flow-pool-worker')!,
    flowSavedPool: document.querySelector<HTMLSelectElement>('#flow-saved-pool')!,
    flowPoolName: document.querySelector<HTMLInputElement>('#flow-pool-name')!,
    flowPoolTags: document.querySelector<HTMLInputElement>('#flow-pool-tags')!,
    flowPoolSave: document.querySelector<HTMLButtonElement>('#flow-pool-save')!,
    flowPoolDelete: document.querySelector<HTMLButtonElement>('#flow-pool-delete')!,
    flowAllocationHint: document.querySelector<HTMLElement>('#flow-allocation-hint')!,
    flowInspectorQuery: document.querySelector<HTMLInputElement>('#flow-inspector-query')!,
    flowInspectorRefresh: document.querySelector<HTMLButtonElement>('#flow-inspector-refresh')!,
    flowInspectorMeta: document.querySelector<HTMLElement>('#flow-inspector-meta')!,
    flowInspectorList: document.querySelector<HTMLElement>('#flow-inspector-list')!,
    flowName: document.querySelector<HTMLInputElement>('#flow-name')!,
    flowAdd: document.querySelector<HTMLButtonElement>('#flow-add')!,
    flowSteps: document.querySelector<HTMLElement>('#flow-steps')!,
    flowRun: document.querySelector<HTMLButtonElement>('#flow-run')!,
    flowResult: document.querySelector<HTMLElement>('#flow-result')!,
    flowTimingKind: document.querySelector<HTMLSelectElement>('#flow-timing-kind')!,
    flowOnceField: document.querySelector<HTMLElement>('#flow-once-field')!,
    flowRunAt: document.querySelector<HTMLInputElement>('#flow-run-at')!,
    flowTimeField: document.querySelector<HTMLElement>('#flow-time-field')!,
    flowLocalTime: document.querySelector<HTMLInputElement>('#flow-local-time')!,
    flowTimezoneField: document.querySelector<HTMLElement>('#flow-timezone-field')!,
    flowTimezone: document.querySelector<HTMLInputElement>('#flow-timezone')!,
    flowIntervalField: document.querySelector<HTMLElement>('#flow-interval-field')!,
    flowIntervalMinutes: document.querySelector<HTMLInputElement>('#flow-interval-minutes')!,
    flowWeekdays: document.querySelector<HTMLElement>('#flow-weekdays')!,
    flowWeekdayInputs: Array.from(document.querySelectorAll<HTMLInputElement>('#flow-weekdays input[type="checkbox"]')),
    flowScheduleHint: document.querySelector<HTMLElement>('#flow-schedule-hint')!,
    flowLibrary: document.querySelector<HTMLElement>('#flow-library')!,
    flowNew: document.querySelector<HTMLButtonElement>('#flow-new')!,
    flowSave: document.querySelector<HTMLButtonElement>('#flow-save')!,
    flowSaveState: document.querySelector<HTMLElement>('#flow-save-state')!,
    flowDuplicate: document.querySelector<HTMLButtonElement>('#flow-duplicate')!,
    flowDuplicateDialog: document.querySelector<HTMLDialogElement>('#flow-duplicate-dialog')!,
    flowDuplicateForm: document.querySelector<HTMLFormElement>('#flow-duplicate-form')!,
    flowDuplicateName: document.querySelector<HTMLInputElement>('#flow-duplicate-name')!,
    flowDuplicateResult: document.querySelector<HTMLElement>('#flow-duplicate-result')!,
    flowDuplicateClose: document.querySelector<HTMLButtonElement>('#flow-duplicate-close')!,
    flowDelete: document.querySelector<HTMLButtonElement>('#flow-delete')!,
    flowExport: document.querySelector<HTMLButtonElement>('#flow-export')!,
    flowExportMaestro: document.querySelector<HTMLButtonElement>('#flow-export-maestro')!,
    flowImport: document.querySelector<HTMLButtonElement>('#flow-import')!,
    flowImportFile: document.querySelector<HTMLInputElement>('#flow-import-file')!,
    flowVersion: document.querySelector<HTMLSelectElement>('#flow-version')!,
    flowVersionField: document.querySelector<HTMLElement>('#flow-version-field')!,
    flowRestore: document.querySelector<HTMLButtonElement>('#flow-restore')!,
    device: document.querySelector<HTMLSelectElement>('#pipeline-device')!,
    fleet: document.querySelector<HTMLInputElement>('#pipeline-fleet')!,
    fleetHint: document.querySelector<HTMLElement>('#pipeline-fleet-hint')!,
    form: document.querySelector<HTMLFormElement>('#pipeline-form')!,
    video: document.querySelector<HTMLInputElement>('#pipeline-video')!,
    caption: document.querySelector<HTMLTextAreaElement>('#pipeline-caption')!,
    addResult: document.querySelector<HTMLElement>('#pipeline-add-result')!,
    submit: document.querySelector<HTMLButtonElement>('#pipeline-submit')!,
    auto: document.querySelector<HTMLInputElement>('#pipeline-auto')!,
    frequency: document.querySelector<HTMLSelectElement>('#pipeline-frequency')!,
    checkNow: document.querySelector<HTMLButtonElement>('#pipeline-check-now')!,
    refresh: document.querySelector<HTMLButtonElement>('#pipeline-refresh')!,
    status: document.querySelector<HTMLElement>('#pipeline-status')!,
    list: document.querySelector<HTMLElement>('#pipeline-list')!,
};

let devicesCache: DeviceRow[] = [];
let fleetPreview: FleetPreviewRow[] = [];
let flowSteps: FlowStep[] = [
    { action: 'launch', appId: 'com.apple.Preferences' },
    { action: 'wait', milliseconds: 1000 },
];
let flowLibrary: FlowLibraryRow[] = [];
let devicePools: DevicePoolRow[] = [];
let currentFlowId: string | undefined;
let currentFlowVersion: number | undefined;
let allocationPreviewUdid = '';
let selectedPoolDirty = false;

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

async function jsonRequest(url: string, init?: RequestInit): Promise<unknown> {
    const response = await fetch(url, init);
    const body = await response.json().catch(() => ({})) as { error?: string };
    if (!response.ok) throw new Error(body.error || `Request failed (${response.status})`);
    return body;
}

function selectedUdid(): string {
    if (elements.fleet.checked) {
        return devicesCache.find((device) => !device.disabled)?.udid
            ?? elements.device.value
            ?? '';
    }
    return elements.device.value;
}

function updateFleetHint(): void {
    const on = elements.fleet.checked;
    elements.device.disabled = on;
    elements.submit.textContent = on ? 'Add to all device queues' : 'Add to queue';
    elements.checkNow.disabled = on;
    if (!on) {
        elements.fleetHint.hidden = true;
        elements.fleetHint.textContent = '';
        return;
    }
    const rows = fleetPreview.length
        ? fleetPreview
        : devicesCache.filter((device) => !device.disabled).map((device, index) => ({
            udid: device.udid,
            name: device.name,
            farmIndex: index + 1,
            staggerMinutes: index * 5,
            order: index + 1,
        }));
    elements.fleetHint.hidden = false;
    elements.fleetHint.textContent = rows.length
        ? `Stagger: ${rows.map((row) => `${row.name} +${row.staggerMinutes}m`).join(' · ')}`
        : 'No active devices for fleet mode.';
}

function selectTemplate(id: string, options: { refresh?: boolean } = {}): void {
    for (const button of elements.templates) {
        const active = button.dataset.template === id;
        button.setAttribute('aria-pressed', String(active));
        button.classList.toggle('is-active', active);
    }
    elements.workspace.hidden = id !== 'pipeline';
    elements.flowWorkspace.hidden = id !== 'flow';
    if (id === 'pipeline') {
        const next = new URL(location.href);
        next.searchParams.set('template', 'pipeline');
        history.replaceState(null, '', next);
        if (options.refresh !== false) void refreshPipeline();
    }
    if (id === 'flow') {
        const next = new URL(location.href);
        next.searchParams.set('template', 'flow');
        history.replaceState(null, '', next);
        renderFlowSteps();
    }
}

async function loadDevices(): Promise<void> {
    devicesCache = (await jsonRequest('/api/devices') as DeviceRow[]).filter((entry) => !entry.disabled);
    const preferred = params.get('device') ?? '';
    elements.device.innerHTML = '<option value="">Select an iPhone…</option>';
    elements.flowDevice.innerHTML = '<option value="">Select a device…</option>';
    elements.flowPoolWorker.innerHTML = '<option value="">Any host</option>';
    const workers = new Set<string>();
    for (const device of devicesCache) {
        elements.device.add(new Option(device.name, device.udid));
        const platform = device.platform ?? 'ios';
        const kind = device.kind ?? 'physical';
        const host = device.workerId ? ` · ${device.workerId}` : '';
        elements.flowDevice.add(new Option(`${device.name} · ${platform}/${kind}${host}`, device.udid));
        if (device.workerId) workers.add(device.workerId);
    }
    for (const worker of [...workers].sort()) elements.flowPoolWorker.add(new Option(worker, worker));
    if (preferred && [...elements.device.options].some((option) => option.value === preferred)) {
        elements.device.value = preferred;
    } else if (devicesCache[0]) {
        elements.device.value = devicesCache[0].udid;
    }
    if (preferred && [...elements.flowDevice.options].some((option) => option.value === preferred)) {
        elements.flowDevice.value = preferred;
    } else if (devicesCache[0]) {
        elements.flowDevice.value = devicesCache[0].udid;
    }
    updateFleetHint();
    await refreshAllocationPreview().catch(() => undefined);
}

function allocationTarget(): Record<string, unknown> {
    const tags = [...new Set(elements.flowPoolTags.value.split(',').map((tag) => tag.trim().toLowerCase()).filter(Boolean))];
    const platform = elements.flowPoolPlatform.value;
    const exactKind = elements.flowPoolKind.value;
    const preference = elements.flowPoolPreference.value;
    const preferredKinds = !exactKind && preference === 'physical-first'
        ? (platform === 'ios' ? ['physical', 'simulator'] : platform === 'android' ? ['physical', 'emulator'] : ['physical', 'simulator', 'emulator'])
        : !exactKind && preference === 'virtual-first'
            ? (platform === 'ios' ? ['simulator', 'physical'] : platform === 'android' ? ['emulator', 'physical'] : ['simulator', 'emulator', 'physical'])
            : undefined;
    return {
        ...(platform ? { platform } : {}),
        ...(exactKind ? { kind: exactKind } : {}),
        ...(preferredKinds ? { preferredKinds } : {}),
        ...(elements.flowPoolWorker.value ? { workerId: elements.flowPoolWorker.value } : {}),
        ...(tags.length ? { tags } : {}),
        requireIdle: true,
    };
}

function allocationRequest(): { poolId?: string; target?: Record<string, unknown> } {
    return elements.flowSavedPool.value && !selectedPoolDirty
        ? { poolId: elements.flowSavedPool.value }
        : { target: allocationTarget() };
}

function renderSavedPools(): void {
    const selected = elements.flowSavedPool.value;
    elements.flowSavedPool.replaceChildren(new Option('Custom target', ''));
    for (const pool of devicePools) elements.flowSavedPool.add(new Option(pool.name, pool.id));
    if (selected && devicePools.some(({ id }) => id === selected)) elements.flowSavedPool.value = selected;
    elements.flowPoolDelete.disabled = !elements.flowSavedPool.value;
    elements.flowPoolSave.textContent = elements.flowSavedPool.value
        ? (selectedPoolDirty ? 'Save changes' : 'Update pool')
        : 'Save pool';
}

async function refreshDevicePools(): Promise<void> {
    const data = await jsonRequest('/api/pools') as { pools: DevicePoolRow[] };
    devicePools = data.pools;
    const knownWorkers = new Set([...elements.flowPoolWorker.options].map((option) => option.value));
    for (const workerId of devicePools.map(({ selector }) => selector.workerId).filter((value): value is string => Boolean(value))) {
        if (!knownWorkers.has(workerId)) {
            elements.flowPoolWorker.add(new Option(`${workerId} · offline/unseen`, workerId));
            knownWorkers.add(workerId);
        }
    }
    renderSavedPools();
}

function applySelectedPool(): void {
    const pool = devicePools.find(({ id }) => id === elements.flowSavedPool.value);
    if (!pool) {
        elements.flowPoolName.value = '';
        selectedPoolDirty = false;
        elements.flowPoolDelete.disabled = true;
        elements.flowPoolSave.textContent = 'Save pool';
        return;
    }
    elements.flowPoolName.value = pool.name;
    elements.flowPoolPlatform.value = pool.selector.platform ?? '';
    elements.flowPoolKind.value = pool.selector.kind ?? '';
    const firstPreference = pool.selector.preferredKinds?.[0];
    elements.flowPoolPreference.value = firstPreference === 'physical'
        ? 'physical-first'
        : firstPreference === 'simulator' || firstPreference === 'emulator'
            ? 'virtual-first'
            : '';
    elements.flowPoolPreference.disabled = Boolean(elements.flowPoolKind.value);
    elements.flowPoolWorker.value = pool.selector.workerId ?? '';
    elements.flowPoolTags.value = pool.selector.tags?.join(', ') ?? '';
    selectedPoolDirty = false;
    elements.flowPoolDelete.disabled = false;
    elements.flowPoolSave.textContent = 'Update pool';
}

function markSelectedPoolDirty(): void {
    if (!elements.flowSavedPool.value) return;
    selectedPoolDirty = true;
    elements.flowPoolSave.textContent = 'Save changes';
}

async function refreshAllocationPreview(): Promise<void> {
    const allocating = elements.flowTargetMode.value === 'allocate';
    elements.flowDeviceField.hidden = allocating;
    elements.flowPoolFields.hidden = !allocating;
    elements.flowAllocationHint.hidden = !allocating;
    if (!allocating) { allocationPreviewUdid = ''; return; }
    elements.flowAllocationHint.textContent = selectedPoolDirty
        ? 'Previewing unsaved pool changes…'
        : 'Finding an idle matching device…';
    const data = await jsonRequest('/api/allocation/preview', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(allocationRequest()),
    }) as { candidates: Array<{ name: string; platform: string; kind: string; workerId?: string; activeSchedules: number }> };
    const candidate = data.candidates[0];
    allocationPreviewUdid = (candidate as { udid?: string } | undefined)?.udid ?? '';
    const dirtyPrefix = selectedPoolDirty ? 'Unsaved pool changes · ' : '';
    elements.flowAllocationHint.textContent = candidate
        ? `${dirtyPrefix}Next allocation: ${candidate.name} · ${candidate.platform}/${candidate.kind}${candidate.workerId ? ` · ${candidate.workerId}` : ''} · ${candidate.activeSchedules} active schedule${candidate.activeSchedules === 1 ? '' : 's'}`
        : `${dirtyPrefix}No idle connected device currently matches this target.`;
}

interface InspectorElement {
    ref: string;
    type: string;
    label: string;
    value?: string;
    enabled: boolean;
    scrollable: boolean;
}

function inspectorTargetUdid(): string {
    return elements.flowTargetMode.value === 'allocate' ? allocationPreviewUdid : elements.flowDevice.value;
}

function addInspectorStep(action: 'tapText' | 'waitVisible' | 'assertVisible' | 'inputText', element: InspectorElement): void {
    const selector = element.label || element.value || '';
    if (!selector) return;
    if (action === 'inputText') {
        flowSteps.push({ action, target: selector, text: '', type: element.type, exact: true, timeoutMs: 10_000 });
    } else {
        flowSteps.push({ action, text: selector, type: element.type, exact: true, timeoutMs: action === 'assertVisible' ? 1_000 : 10_000 });
    }
    renderFlowSteps();
    elements.flowResult.textContent = `Added ${action} for ${selector}`;
}

function renderInspectorElements(elementsList: InspectorElement[]): void {
    elements.flowInspectorList.innerHTML = '';
    if (!elementsList.length) {
        elements.flowInspectorList.innerHTML = '<p class="empty-state-inline">No visible semantic elements match this filter.</p>';
        return;
    }
    for (const item of elementsList) {
        const selector = item.label || item.value || '';
        const row = document.createElement('article');
        row.className = 'flow-inspector-row';
        const copy = document.createElement('div');
        copy.className = 'flow-inspector-copy';
        const title = document.createElement('strong');
        title.textContent = selector || '(unlabelled element)';
        const meta = document.createElement('span');
        meta.textContent = `${item.ref} · ${item.type}${item.value && item.value !== item.label ? ` · ${item.value}` : ''}${item.enabled ? '' : ' · disabled'}`;
        copy.append(title, meta);
        const actions = document.createElement('div');
        actions.className = 'flow-inspector-actions';
        for (const [action, label] of [['tapText', 'Tap'], ['waitVisible', 'Wait'], ['assertVisible', 'Assert']] as const) {
            const button = document.createElement('button');
            button.type = 'button'; button.className = 'icon-button'; button.textContent = `+ ${label}`; button.disabled = !selector;
            button.addEventListener('click', () => addInspectorStep(action, item));
            actions.append(button);
        }
        if (['TextField', 'SecureTextField', 'SearchField', 'TextView'].includes(item.type)) {
            const input = document.createElement('button');
            input.type = 'button'; input.className = 'icon-button'; input.textContent = '+ Input'; input.disabled = !selector;
            input.addEventListener('click', () => addInspectorStep('inputText', item));
            actions.append(input);
        }
        row.append(copy, actions);
        elements.flowInspectorList.append(row);
    }
}

async function refreshSemanticInspector(): Promise<void> {
    const udid = inspectorTargetUdid();
    if (!udid) throw new Error('Choose a connected device or matching allocation target first.');
    elements.flowInspectorRefresh.disabled = true;
    elements.flowInspectorMeta.textContent = 'Reading accessibility tree…';
    try {
        const query = new URLSearchParams({ maxNodes: '150' });
        if (elements.flowInspectorQuery.value.trim()) query.set('query', elements.flowInspectorQuery.value.trim());
        const snapshot = await jsonRequest(`/api/devices/${encodeURIComponent(udid)}/semantic/snapshot?${query}`) as {
            generation: number; count: number; offscreen: number; truncated: boolean; elements: InspectorElement[];
        };
        elements.flowInspectorMeta.textContent = `${snapshot.count} elements · generation ${snapshot.generation}${snapshot.truncated ? ' · truncated' : ''}`;
        renderInspectorElements(snapshot.elements);
    } finally {
        elements.flowInspectorRefresh.disabled = false;
    }
}

const FLOW_ACTIONS: FlowStep['action'][] = [
    'launch', 'terminate', 'wait', 'tapText', 'inputText', 'waitVisible', 'assertVisible', 'waitGone', 'tap', 'swipe', 'type',
    'home', 'lock', 'wake', 'unlock', 'volumeUp', 'volumeDown', 'screenshot',
];

function defaultFlowStep(action: FlowStep['action']): FlowStep {
    if (action === 'launch' || action === 'terminate') return { action, appId: '' };
    if (action === 'wait') return { action, milliseconds: 1000 };
    if (action === 'tap') return { action, x: 100, y: 100 };
    if (action === 'swipe') return { action, startX: 200, startY: 600, endX: 200, endY: 200, durationMs: 350 };
    if (action === 'type') return { action, text: '' };
    if (action === 'tapText' || action === 'waitVisible' || action === 'assertVisible' || action === 'waitGone') {
        return { action, text: '', timeoutMs: action === 'assertVisible' ? 1000 : 10000 };
    }
    if (action === 'inputText') return { action, target: '', text: '', timeoutMs: 10000 };
    return { action };
}

function flowParamInput(step: Record<string, unknown>, key: string, type: 'number' | 'text' = 'number'): HTMLInputElement {
    const input = document.createElement('input');
    input.type = type;
    input.placeholder = key;
    input.title = key;
    input.value = String(step[key] ?? '');
    if (type === 'number') input.step = '1';
    input.addEventListener('input', () => {
        step[key] = type === 'number' ? Number(input.value) : input.value;
    });
    return input;
}

function flowParams(step: FlowStep): HTMLElement {
    const box = document.createElement('div');
    box.className = 'flow-step-params';
    const values = step as unknown as Record<string, unknown>;
    if (step.action === 'launch' || step.action === 'terminate') box.append(flowParamInput(values, 'appId', 'text'));
    else if (step.action === 'wait') box.append(flowParamInput(values, 'milliseconds'));
    else if (step.action === 'tap') box.append(flowParamInput(values, 'x'), flowParamInput(values, 'y'));
    else if (step.action === 'swipe') box.append(
        flowParamInput(values, 'startX'), flowParamInput(values, 'startY'), flowParamInput(values, 'endX'),
        flowParamInput(values, 'endY'), flowParamInput(values, 'durationMs'),
    );
    else if (step.action === 'type') box.append(flowParamInput(values, 'text', 'text'));
    else if (step.action === 'tapText' || step.action === 'waitVisible' || step.action === 'assertVisible' || step.action === 'waitGone') {
        box.append(
            flowParamInput(values, 'text', 'text'),
            flowParamInput(values, 'type', 'text'),
            flowParamInput(values, 'timeoutMs'),
        );
        const exact = document.createElement('label');
        exact.className = 'flow-inline-check';
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.checked = step.exact === true;
        checkbox.addEventListener('change', () => { values.exact = checkbox.checked; });
        exact.append(checkbox, document.createTextNode(' exact'));
        box.append(exact);
    }
    else if (step.action === 'inputText') {
        box.append(
            flowParamInput(values, 'target', 'text'),
            flowParamInput(values, 'text', 'text'),
            flowParamInput(values, 'type', 'text'),
            flowParamInput(values, 'timeoutMs'),
        );
        const exact = document.createElement('label');
        exact.className = 'flow-inline-check';
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.checked = step.exact === true;
        checkbox.addEventListener('change', () => { values.exact = checkbox.checked; });
        exact.append(checkbox, document.createTextNode(' exact'));
        box.append(exact);
    }
    else {
        const hint = document.createElement('span');
        hint.className = 'run-meta';
        hint.textContent = 'No parameters';
        box.append(hint);
    }
    return box;
}

function renderFlowSteps(): void {
    elements.flowSteps.innerHTML = '';
    flowSteps.forEach((step, index) => {
        const row = document.createElement('article');
        row.className = 'flow-step';
        const badge = document.createElement('span');
        badge.className = 'flow-step-index';
        badge.textContent = String(index + 1);
        const action = document.createElement('select');
        for (const name of FLOW_ACTIONS) action.add(new Option(name, name));
        action.value = step.action;
        action.addEventListener('change', () => {
            flowSteps[index] = defaultFlowStep(action.value as FlowStep['action']);
            renderFlowSteps();
        });
        const actions = document.createElement('div');
        actions.className = 'flow-step-actions';
        const up = document.createElement('button');
        up.type = 'button'; up.className = 'icon-button'; up.textContent = '↑'; up.disabled = index === 0;
        up.addEventListener('click', () => {
            [flowSteps[index - 1], flowSteps[index]] = [flowSteps[index]!, flowSteps[index - 1]!];
            renderFlowSteps();
        });
        const down = document.createElement('button');
        down.type = 'button'; down.className = 'icon-button'; down.textContent = '↓'; down.disabled = index === flowSteps.length - 1;
        down.addEventListener('click', () => {
            [flowSteps[index], flowSteps[index + 1]] = [flowSteps[index + 1]!, flowSteps[index]!];
            renderFlowSteps();
        });
        const remove = document.createElement('button');
        remove.type = 'button'; remove.className = 'icon-button'; remove.textContent = '×'; remove.disabled = flowSteps.length === 1;
        remove.addEventListener('click', () => { flowSteps.splice(index, 1); renderFlowSteps(); });
        actions.append(up, down, remove);
        row.append(badge, action, flowParams(step), actions);
        elements.flowSteps.append(row);
    });
}

function currentFlowPayload(): { name: string; steps: FlowStep[] } {
    const name = elements.flowName.value.trim();
    if (!name) throw new Error('Give the flow a name.');
    return { name, steps: structuredClone(flowSteps) };
}

type FlowTiming =
    | { kind: 'now' }
    | { kind: 'once'; runAt: string }
    | { kind: 'daily'; localTime: string; timezone: string }
    | { kind: 'weekly'; localTime: string; timezone: string; weekdays: number[] }
    | { kind: 'interval'; everyMinutes: number };

function selectedFlowTiming(): FlowTiming {
    const kind = elements.flowTimingKind.value;
    if (kind === 'now') return { kind: 'now' };
    if (kind === 'once') {
        if (!elements.flowRunAt.value) throw new Error('Choose when the flow should run.');
        const runAt = new Date(elements.flowRunAt.value);
        if (!Number.isFinite(runAt.getTime()) || runAt.getTime() <= Date.now()) throw new Error('Run-at time must be in the future.');
        return { kind: 'once', runAt: runAt.toISOString() };
    }
    if (kind === 'interval') {
        const everyMinutes = Number(elements.flowIntervalMinutes.value);
        if (!Number.isInteger(everyMinutes) || everyMinutes < 1 || everyMinutes > 10080) throw new Error('Interval must be between 1 and 10080 minutes.');
        return { kind: 'interval', everyMinutes };
    }
    const localTime = elements.flowLocalTime.value;
    const timezone = elements.flowTimezone.value.trim();
    if (!/^\d{2}:\d{2}$/.test(localTime)) throw new Error('Choose a local time.');
    if (!timezone) throw new Error('Timezone is required.');
    if (kind === 'daily') return { kind: 'daily', localTime, timezone };
    const weekdays = elements.flowWeekdayInputs.filter(({ checked }) => checked).map(({ value }) => Number(value));
    if (!weekdays.length) throw new Error('Choose at least one weekday.');
    return { kind: 'weekly', localTime, timezone, weekdays };
}

function updateFlowTimingUi(): void {
    const kind = elements.flowTimingKind.value;
    elements.flowOnceField.hidden = kind !== 'once';
    elements.flowTimeField.hidden = !['daily', 'weekly'].includes(kind);
    elements.flowTimezoneField.hidden = !['daily', 'weekly'].includes(kind);
    elements.flowWeekdays.hidden = kind !== 'weekly';
    elements.flowIntervalField.hidden = kind !== 'interval';
    elements.flowRun.textContent = kind === 'now' ? 'Run now' : 'Schedule flow';
    const allocation = elements.flowTargetMode.value === 'allocate';
    elements.flowScheduleHint.textContent = kind === 'now'
        ? 'Runs immediately through the normal device queue.'
        : allocation
            ? 'The matching idle device is chosen when you create this schedule; recurring runs remain bound to that audited device.'
            : 'Creates a normal versioned schedule on the selected device.';
}

function updateFlowLibraryActions(detail?: FlowDetail): void {
    const saved = Boolean(currentFlowId);
    elements.flowDuplicate.disabled = !saved;
    elements.flowDelete.disabled = !saved;
    elements.flowExport.disabled = !saved;
    elements.flowExportMaestro.disabled = !saved;
    elements.flowVersionField.hidden = !saved;
    elements.flowRestore.hidden = !saved;
    elements.flowSave.textContent = saved ? 'Save new version' : 'Save to library';
    elements.flowSaveState.textContent = saved
        ? `Saved · v${currentFlowVersion ?? detail?.currentVersion ?? 1}`
        : 'Unsaved flow';
    if (detail) {
        elements.flowVersion.replaceChildren(...detail.versions.map(({ version, createdAt }) => (
            new Option(`v${version} · ${new Date(createdAt).toLocaleString()}`, String(version), false, version === detail.currentVersion)
        )));
    } else elements.flowVersion.replaceChildren();
}

function newFlow(): void {
    currentFlowId = undefined;
    currentFlowVersion = undefined;
    elements.flowName.value = 'My mobile flow';
    flowSteps = [{ action: 'launch', appId: '' }, { action: 'waitVisible', text: '', timeoutMs: 10000 }];
    renderFlowSteps();
    updateFlowLibraryActions();
    renderFlowLibrary();
}

function renderFlowLibrary(): void {
    elements.flowLibrary.innerHTML = '';
    if (!flowLibrary.length) {
        elements.flowLibrary.innerHTML = '<p class="empty-state-inline">No saved flows yet.</p>';
        return;
    }
    for (const flow of flowLibrary) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = `flow-library-item${flow.id === currentFlowId ? ' is-active' : ''}`;
        button.innerHTML = `<strong>${escapeHtml(flow.name)}</strong><span>v${flow.currentVersion} · ${flow.payload.steps.length} steps · ${new Date(flow.updatedAt).toLocaleDateString()}</span>`;
        button.addEventListener('click', () => void loadSavedFlow(flow.id));
        elements.flowLibrary.append(button);
    }
}

async function refreshFlowLibrary(): Promise<void> {
    const data = await jsonRequest('/api/flows') as { flows: FlowLibraryRow[] };
    flowLibrary = data.flows;
    renderFlowLibrary();
}

async function loadSavedFlow(id: string, version?: number): Promise<void> {
    const suffix = version ? `?version=${encodeURIComponent(String(version))}` : '';
    const data = await jsonRequest(`/api/flows/${encodeURIComponent(id)}${suffix}`) as { flow: FlowDetail };
    currentFlowId = data.flow.id;
    currentFlowVersion = data.flow.currentVersion;
    elements.flowName.value = data.flow.payload.name;
    flowSteps = structuredClone(data.flow.payload.steps);
    renderFlowSteps();
    updateFlowLibraryActions(data.flow);
    renderFlowLibrary();
}

async function saveFlow(): Promise<void> {
    const payload = currentFlowPayload();
    const data = await jsonRequest(currentFlowId ? `/api/flows/${encodeURIComponent(currentFlowId)}` : '/api/flows', {
        method: currentFlowId ? 'PUT' : 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
    }) as { flow: FlowDetail };
    currentFlowId = data.flow.id;
    currentFlowVersion = data.flow.currentVersion;
    await refreshFlowLibrary();
    await loadSavedFlow(data.flow.id);
}

async function runPortableFlow(): Promise<{ id?: string; schedule?: { id?: string }; allocation?: { name?: string; udid?: string } }> {
    const allocating = elements.flowTargetMode.value === 'allocate';
    const deviceUdid = elements.flowDevice.value;
    const payload = {
        ...currentFlowPayload(),
        ...(currentFlowId && currentFlowVersion ? { sourceFlowId: currentFlowId, sourceFlowVersion: currentFlowVersion } : {}),
    };
    if (!allocating && !deviceUdid) throw new Error('Choose a device first.');
    if (allocating && elements.flowSavedPool.value && selectedPoolDirty) {
        throw new Error('Save the device pool changes before scheduling from this saved pool.');
    }
    const timing = selectedFlowTiming();
    const common = {
        task: { pluginId: 'com.phone-farm.flow', taskType: 'flow', taskVersion: 1, payload },
        timing,
        runWindowMinutes: 30,
    };
    return await jsonRequest(allocating ? '/api/schedules/allocate' : '/api/schedules', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(allocating ? { ...common, ...allocationRequest() } : { ...common, deviceUdid }),
    }) as { id?: string; schedule?: { id?: string }; allocation?: { name?: string; udid?: string } };
}

function statusLabel(status: string): string {
    if (status === 'ready') return 'Ready';
    if (status === 'publishing') return 'Publishing';
    if (status === 'published') return 'Published';
    if (status === 'failed') return 'Failed';
    return status;
}

function escapeHtml(value: string): string {
    return value.replace(/[&<>"']/g, (character) => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[character] ?? character));
}

function renderItems(items: PipelineItem[], udid: string): void {
    elements.list.classList.remove('loading-card');
    elements.list.innerHTML = '';
    if (items.length === 0) {
        const empty = document.createElement('p');
        empty.className = 'empty-state-inline';
        empty.textContent = 'Queue is empty — next tick will skip TikTok (no random posts).';
        elements.list.append(empty);
        return;
    }
    for (const item of items) {
        const row = document.createElement('article');
        row.className = 'pipeline-item';
        const title = item.caption?.trim() || '(no caption)';
        const media = item.assetName ?? 'Published media removed';
        row.innerHTML = `
            <div>
                <strong>${escapeHtml(title)}</strong>
                <div class="run-meta">${escapeHtml(media)} · ${escapeHtml(statusLabel(item.status))} · ${new Date(item.createdAt).toLocaleString()}</div>
                ${item.error ? `<div class="run-error">${escapeHtml(item.error)}</div>` : ''}
            </div>
        `;
        if (item.status === 'ready' || item.status === 'failed') {
            const remove = document.createElement('button');
            remove.type = 'button';
            remove.className = 'button secondary';
            remove.textContent = 'Remove';
            remove.addEventListener('click', async () => {
                try {
                    await jsonRequest(`/api/devices/${encodeURIComponent(udid)}/tiktok/pipeline/items/${encodeURIComponent(item.id)}`, {
                        method: 'DELETE',
                    });
                    await refreshPipeline();
                } catch (error) {
                    elements.status.textContent = errorMessage(error);
                }
            });
            row.append(remove);
        }
        elements.list.append(row);
    }
}

async function refreshPipeline(): Promise<void> {
    const udid = selectedUdid();
    if (!udid) {
        elements.list.classList.remove('loading-card');
        elements.list.textContent = 'Select a device…';
        elements.auto.checked = false;
        elements.status.textContent = '';
        return;
    }
    elements.list.classList.add('loading-card');
    elements.list.innerHTML = '<span class="spinner" aria-hidden="true"></span>Loading queue…';
    try {
        if (elements.fleet.checked) {
            const states = await Promise.all(devicesCache.map(async (device) => {
                const state = await jsonRequest(`/api/devices/${encodeURIComponent(device.udid)}/tiktok/pipeline`) as PipelineState;
                return { device, state };
            }));
            const anchor = states[0]?.state;
            if (anchor?.fleetPreview) fleetPreview = anchor.fleetPreview;
            elements.auto.checked = states.every(({ state }) => state.enabled);
            if (anchor?.frequency) elements.frequency.value = anchor.frequency;
            elements.fleet.checked = true;
            updateFleetHint();
            const ready = states.reduce((sum, row) => sum + row.state.items.filter((item) => item.status === 'ready').length, 0);
            elements.status.textContent = elements.auto.checked
                ? `Fleet auto on · ${anchor?.frequencyLabel ?? 'cadence'} · ${ready} ready across ${states.length} phones`
                : `Fleet auto off · ${ready} ready across ${states.length} phones`;
            elements.list.classList.remove('loading-card');
            elements.list.innerHTML = '';
            for (const { device, state } of states) {
                const heading = document.createElement('h4');
                heading.className = 'pipeline-queue-heading';
                const stagger = state.staggerMinutes ?? 0;
                heading.textContent = `${device.name} · +${stagger}m · ${state.items.filter((i) => i.status === 'ready').length} ready`;
                elements.list.append(heading);
                renderItems(state.items, device.udid);
            }
            return;
        }

        const state = await jsonRequest(`/api/devices/${encodeURIComponent(udid)}/tiktok/pipeline`) as PipelineState;
        if (state.fleetPreview) fleetPreview = state.fleetPreview;
        elements.auto.checked = state.enabled;
        elements.fleet.checked = state.fleet === true;
        if (state.frequency) elements.frequency.value = state.frequency;
        updateFleetHint();
        const label = state.frequencyLabel
            ?? state.checkTimes.map((entry) => entry.label ?? entry.localTime).filter(Boolean).join(', ');
        const stagger = state.staggerMinutes ? ` · stagger +${state.staggerMinutes}m` : '';
        elements.status.textContent = state.enabled
            ? `Auto on · ${label}${stagger}`
            : `Auto off · ${label || 'production'}${stagger} — enable auto or use Check now.`;
        renderItems(state.items, udid);
        const next = new URL(location.href);
        next.searchParams.set('template', 'pipeline');
        next.searchParams.set('device', udid);
        history.replaceState(null, '', next);
    } catch (error) {
        elements.list.classList.remove('loading-card');
        elements.list.textContent = errorMessage(error);
    }
}

async function saveAutoSettings(enabled: boolean): Promise<void> {
    const udid = selectedUdid();
    if (!udid) throw new Error('Select a device first.');
    await jsonRequest(`/api/devices/${encodeURIComponent(udid)}/tiktok/pipeline/auto`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
            enabled,
            frequency: elements.frequency.value,
            fleet: elements.fleet.checked,
        }),
    });
}

for (const button of elements.templates) {
    button.addEventListener('click', () => selectTemplate(button.dataset.template ?? 'pipeline'));
}

elements.flowAdd.addEventListener('click', () => {
    flowSteps.push(defaultFlowStep('tap'));
    renderFlowSteps();
});
elements.flowTargetMode.addEventListener('change', () => void refreshAllocationPreview().catch((error) => {
    elements.flowAllocationHint.textContent = errorMessage(error);
}));
elements.flowDevice.addEventListener('change', () => {
    elements.flowInspectorMeta.textContent = '';
    elements.flowInspectorList.innerHTML = '<p class="empty-state-inline">Target changed — inspect again to refresh semantic elements.</p>';
});
elements.flowInspectorRefresh.addEventListener('click', () => void refreshSemanticInspector().catch((error) => {
    elements.flowInspectorMeta.textContent = errorMessage(error);
}));
elements.flowInspectorQuery.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
        event.preventDefault();
        void refreshSemanticInspector().catch((error) => { elements.flowInspectorMeta.textContent = errorMessage(error); });
    }
});
elements.flowTargetMode.addEventListener('change', updateFlowTimingUi);
elements.flowTimingKind.addEventListener('change', updateFlowTimingUi);
for (const field of [elements.flowPoolPlatform, elements.flowPoolKind, elements.flowPoolPreference, elements.flowPoolWorker]) {
    field.addEventListener('change', () => {
        if (field === elements.flowPoolKind) elements.flowPoolPreference.disabled = Boolean(elements.flowPoolKind.value);
        markSelectedPoolDirty();
        void refreshAllocationPreview().catch((error) => { elements.flowAllocationHint.textContent = errorMessage(error); });
    });
}
elements.flowPoolTags.addEventListener('change', () => {
    markSelectedPoolDirty();
    void refreshAllocationPreview().catch((error) => { elements.flowAllocationHint.textContent = errorMessage(error); });
});
elements.flowPoolName.addEventListener('input', markSelectedPoolDirty);
elements.flowSavedPool.addEventListener('change', () => {
    applySelectedPool();
    void refreshAllocationPreview().catch((error) => { elements.flowAllocationHint.textContent = errorMessage(error); });
});
elements.flowPoolSave.addEventListener('click', async () => {
    const existing = devicePools.find(({ id }) => id === elements.flowSavedPool.value);
    const name = elements.flowPoolName.value.replace(/\s+/g, ' ').trim();
    if (!name) {
        elements.flowAllocationHint.hidden = false;
        elements.flowAllocationHint.textContent = 'Give this reusable device pool a name before saving it.';
        elements.flowPoolName.focus();
        return;
    }
    elements.flowPoolSave.disabled = true;
    try {
        const data = await jsonRequest(existing ? `/api/pools/${encodeURIComponent(existing.id)}` : '/api/pools', {
            method: existing ? 'PUT' : 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ name, selector: allocationTarget() }),
        }) as { pool: DevicePoolRow };
        await refreshDevicePools();
        elements.flowSavedPool.value = data.pool.id;
        applySelectedPool();
        elements.flowResult.textContent = existing ? `Updated pool ${data.pool.name}.` : `Saved pool ${data.pool.name}.`;
        await refreshAllocationPreview();
    } catch (error) {
        elements.flowResult.textContent = errorMessage(error);
    } finally {
        elements.flowPoolSave.disabled = false;
    }
});
elements.flowPoolDelete.addEventListener('click', async () => {
    const pool = devicePools.find(({ id }) => id === elements.flowSavedPool.value);
    if (!pool || !window.confirm(`Delete device pool “${pool.name}”? Existing schedules keep their concrete device assignment.`)) return;
    elements.flowPoolDelete.disabled = true;
    try {
        await jsonRequest(`/api/pools/${encodeURIComponent(pool.id)}`, { method: 'DELETE' });
        elements.flowSavedPool.value = '';
        applySelectedPool();
        await refreshDevicePools();
        elements.flowResult.textContent = `Deleted pool ${pool.name}.`;
        await refreshAllocationPreview();
    } catch (error) {
        elements.flowResult.textContent = errorMessage(error);
    }
});
elements.flowNew.addEventListener('click', newFlow);
elements.flowSave.addEventListener('click', async () => {
    elements.flowSave.disabled = true;
    elements.flowResult.textContent = 'Saving flow…';
    try { await saveFlow(); elements.flowResult.textContent = `Saved · v${currentFlowVersion}`; }
    catch (error) { elements.flowResult.textContent = errorMessage(error); }
    finally { elements.flowSave.disabled = false; }
});
elements.flowDuplicate.addEventListener('click', () => {
    if (!currentFlowId) return;
    elements.flowDuplicateName.value = `${elements.flowName.value.trim() || 'Untitled flow'} copy`;
    elements.flowDuplicateResult.textContent = '';
    elements.flowDuplicateDialog.showModal();
});
elements.flowDuplicateClose.addEventListener('click', () => elements.flowDuplicateDialog.close());
elements.flowDuplicateForm.addEventListener('submit', (event) => {
    event.preventDefault();
    void (async () => {
        if (!currentFlowId) return;
        const name = elements.flowDuplicateName.value.replace(/\s+/g, ' ').trim();
        if (!name) {
            elements.flowDuplicateResult.textContent = 'Flow name is required.';
            elements.flowDuplicateName.focus();
            return;
        }
        const submit = elements.flowDuplicateForm.querySelector<HTMLButtonElement>('button[type="submit"]')!;
        submit.disabled = true;
        elements.flowDuplicateResult.textContent = 'Duplicating…';
        try {
            const data = await jsonRequest(`/api/flows/${encodeURIComponent(currentFlowId)}/duplicate`, {
                method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name }),
            }) as { flow: FlowDetail };
            elements.flowDuplicateDialog.close();
            await refreshFlowLibrary();
            await loadSavedFlow(data.flow.id);
            elements.flowResult.textContent = `Duplicated as ${data.flow.name}.`;
        } catch (error) {
            elements.flowDuplicateResult.textContent = errorMessage(error);
        } finally {
            submit.disabled = false;
        }
    })();
});
elements.flowDelete.addEventListener('click', async () => {
    if (!currentFlowId || !window.confirm(`Delete ${elements.flowName.value} and all of its saved versions?`)) return;
    try {
        await jsonRequest(`/api/flows/${encodeURIComponent(currentFlowId)}`, { method: 'DELETE' });
        newFlow();
        await refreshFlowLibrary();
        elements.flowResult.textContent = 'Flow deleted.';
    } catch (error) { elements.flowResult.textContent = errorMessage(error); }
});
elements.flowExport.addEventListener('click', async () => {
    if (!currentFlowId) return;
    try {
        const response = await fetch(`/api/flows/${encodeURIComponent(currentFlowId)}/export`);
        if (!response.ok) throw new Error(`Export failed (${response.status})`);
        const blob = await response.blob();
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `${elements.flowName.value.replace(/[^a-z0-9._-]+/gi, '-') || 'flow'}.mobile-flow.json`;
        link.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) { elements.flowResult.textContent = errorMessage(error); }
});
elements.flowExportMaestro.addEventListener('click', async () => {
    if (!currentFlowId) return;
    try {
        const response = await fetch(`/api/flows/${encodeURIComponent(currentFlowId)}/export/maestro`);
        if (!response.ok) {
            const body = await response.json().catch(() => ({})) as { error?: string };
            throw new Error(body.error || `Maestro export failed (${response.status})`);
        }
        const blob = await response.blob();
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `${elements.flowName.value.replace(/[^a-z0-9._-]+/gi, '-') || 'flow'}.maestro.yaml`;
        link.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) { elements.flowResult.textContent = errorMessage(error); }
});
elements.flowRestore.addEventListener('click', async () => {
    if (!currentFlowId) return;
    const version = Number(elements.flowVersion.value);
    if (!Number.isInteger(version)) return;
    if (!window.confirm(`Restore v${version} as a new current version?`)) return;
    try {
        const data = await jsonRequest(`/api/flows/${encodeURIComponent(currentFlowId)}/restore`, {
            method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ version }),
        }) as { flow: FlowDetail };
        await refreshFlowLibrary();
        await loadSavedFlow(data.flow.id);
        elements.flowResult.textContent = `Restored v${version} into v${data.flow.currentVersion}.`;
    } catch (error) { elements.flowResult.textContent = errorMessage(error); }
});
elements.flowImport.addEventListener('click', async () => {
    const file = elements.flowImportFile.files?.[0];
    if (!file) { elements.flowResult.textContent = 'Choose a Mobile Farm JSON export first.'; return; }
    try {
        const text = await file.text();
        const maestro = /\.ya?ml$/i.test(file.name) || file.type.includes('yaml');
        const data = maestro
            ? await jsonRequest('/api/flows/import/maestro', {
                method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ yaml: text }),
            }) as { flow: FlowDetail }
            : await jsonRequest('/api/flows/import', {
                method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(JSON.parse(text) as unknown),
            }) as { flow: FlowDetail };
        elements.flowImportFile.value = '';
        await refreshFlowLibrary();
        await loadSavedFlow(data.flow.id);
        elements.flowResult.textContent = 'Imported into the library.';
    } catch (error) { elements.flowResult.textContent = errorMessage(error); }
});
elements.flowRun.addEventListener('click', async () => {
    elements.flowRun.disabled = true;
    elements.flowResult.textContent = 'Queuing flow…';
    try {
        const schedule = await runPortableFlow();
        const id = schedule.schedule?.id ?? schedule.id ?? 'ready to run';
        elements.flowResult.textContent = schedule.allocation?.name
            ? `Allocated to ${schedule.allocation.name} · queued ${id}`
            : `Queued · ${id}`;
        await refreshAllocationPreview().catch(() => undefined);
    } catch (error) {
        elements.flowResult.textContent = errorMessage(error);
    } finally {
        elements.flowRun.disabled = false;
    }
});

elements.device.addEventListener('change', () => void refreshPipeline());
elements.fleet.addEventListener('change', () => {
    updateFleetHint();
    void refreshPipeline();
});
elements.refresh.addEventListener('click', () => void refreshPipeline());

elements.form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const udid = selectedUdid();
    if (!udid) { elements.addResult.textContent = 'Select a device first.'; return; }
    const file = elements.video.files?.[0];
    if (!file) { elements.addResult.textContent = 'Choose a video.'; return; }
    const caption = elements.caption.value.trim();
    if (!caption) { elements.addResult.textContent = 'Add a title / caption.'; return; }
    const form = new FormData();
    form.append('media', file, file.name);
    form.append('caption', caption);
    if (elements.fleet.checked) form.append('fleet', 'true');
    elements.addResult.textContent = elements.fleet.checked ? 'Uploading to all devices…' : 'Uploading…';
    try {
        await jsonRequest(`/api/devices/${encodeURIComponent(udid)}/tiktok/pipeline/items`, { method: 'POST', body: form });
        elements.video.value = '';
        elements.caption.value = '';
        elements.addResult.textContent = elements.fleet.checked ? 'Added to every device queue.' : 'Added to queue.';
        await refreshPipeline();
    } catch (error) {
        elements.addResult.textContent = errorMessage(error);
    }
});

elements.auto.addEventListener('change', async () => {
    const previous = !elements.auto.checked;
    if (!selectedUdid()) {
        elements.auto.checked = false;
        elements.status.textContent = 'Select a device first.';
        return;
    }
    elements.status.textContent = 'Saving…';
    try {
        await saveAutoSettings(elements.auto.checked);
        await refreshPipeline();
    } catch (error) {
        elements.auto.checked = previous;
        elements.status.textContent = errorMessage(error);
    }
});

elements.frequency.addEventListener('change', async () => {
    if (!selectedUdid()) {
        elements.status.textContent = 'Select a device first.';
        return;
    }
    elements.status.textContent = 'Updating frequency…';
    try {
        await saveAutoSettings(elements.auto.checked);
        await refreshPipeline();
    } catch (error) {
        elements.status.textContent = errorMessage(error);
        await refreshPipeline().catch(() => undefined);
    }
});

elements.checkNow.addEventListener('click', async () => {
    const udid = selectedUdid();
    if (!udid || elements.fleet.checked) {
        elements.status.textContent = elements.fleet.checked
            ? 'Check now is per-device — uncheck fleet or open a single phone.'
            : 'Select a device first.';
        return;
    }
    elements.status.textContent = 'Queuing check…';
    try {
        await jsonRequest(`/api/devices/${encodeURIComponent(udid)}/tiktok/pipeline/check-now`, { method: 'POST' });
        elements.status.textContent = 'Check queued — empty queues skip TikTok.';
        await refreshPipeline();
    } catch (error) {
        elements.status.textContent = errorMessage(error);
    }
});

const requestedTemplate = params.get('template');
selectTemplate(
    requestedTemplate === 'pipeline' || params.has('device') ? 'pipeline' : 'flow',
    { refresh: false },
);
renderFlowSteps();
updateFlowLibraryActions();
elements.flowTimezone.value = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
updateFlowTimingUi();
void loadDevices().then(() => {
    if (!elements.workspace.hidden) return refreshPipeline();
}).catch((error) => {
    elements.status.textContent = errorMessage(error);
});
void refreshFlowLibrary().catch((error) => { elements.flowLibrary.textContent = errorMessage(error); });
void refreshDevicePools().catch((error) => { elements.flowResult.textContent = errorMessage(error); });
