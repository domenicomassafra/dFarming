const candidatePanel = document.querySelector('#candidate-panel');
const candidateList = document.querySelector('#candidate-list');
const runtimeList = document.querySelector('#runtime-list');
const registrationPanel = document.querySelector('#registration-panel');
const hostCount = document.querySelector('#onboarding-host-count');
const hostNote = document.querySelector('#onboarding-host-note');
const runtimeCount = document.querySelector('#onboarding-runtime-count');
const iphoneCount = document.querySelector('#onboarding-iphone-count');
const title = document.querySelector('#registration-title');
const busy = document.querySelector('#registration-busy');
const errorBox = document.querySelector('#registration-error');
const form = document.querySelector('#registration-details');
const nameInput = document.querySelector('#registration-name');
const profileInput = document.querySelector('#registration-profile');
const accountsInput = document.querySelector('#registration-accounts');
const instagramAccountsInput = document.querySelector('#registration-instagram-accounts');
const passcodeInput = document.querySelector('#registration-passcode');
const ports = document.querySelector('#registration-ports');
const checks = document.querySelector('#registration-checks');
const logs = document.querySelector('#registration-logs');
const authorize = document.querySelector('#authorize-registration');
const finalizeButton = document.querySelector('#action-finalize');
let currentId;
let poll;
let discoveredRuntimeCount = 0;
let discoveredIphoneCount = 0;
async function request(url, options) {
    const response = await fetch(url, options);
    if (response.status === 204)
        return undefined;
    const body = await response.json();
    if (!response.ok)
        throw new Error(body.error ?? `Request failed (${response.status})`);
    return body;
}
function showError(error) {
    errorBox.hidden = !error;
    errorBox.textContent = error ? (error instanceof Error ? error.message : String(error)) : '';
}
function countLabel(count, singular, plural = `${singular}s`) {
    return `${count} ${count === 1 ? singular : plural}`;
}
async function hostStatus() {
    hostCount.textContent = 'Checking…';
    hostNote.textContent = 'Reading worker state';
    try {
        const data = await request('/api/hosts');
        const hosts = data.hosts ?? [];
        const online = hosts.filter(({ online }) => online);
        hostCount.textContent = `${online.length}/${hosts.length} online`;
        if (!hosts.length) {
            hostNote.textContent = 'No execution host configured';
            return;
        }
        const appium = online.filter(({ capabilities }) => capabilities.includes('appium')).length;
        hostNote.textContent = appium
            ? `${countLabel(appium, 'Appium host')} ready`
            : online.length ? 'Online hosts lack Appium capability' : 'Reconnect an execution host';
    }
    catch (error) {
        hostCount.textContent = 'Unavailable';
        hostNote.textContent = error instanceof Error ? error.message : String(error);
    }
}
async function candidates() {
    showError();
    candidateList.textContent = 'Checking connected devices…';
    try {
        const data = await request('/api/device-registrations/candidates');
        discoveredIphoneCount = data.devices.length;
        iphoneCount.textContent = countLabel(discoveredIphoneCount, 'detected', 'detected');
        if (!data.devices.length) {
            candidateList.innerHTML = '<div class="empty-state registration-empty"><span class="empty-state-kicker">WDA lane</span><h3>No unregistered iPhone detected</h3><p>Connect by USB, unlock it, accept Trust This Computer, then recheck USB.</p><div class="empty-state-actions"><button class="button secondary" type="button" data-recheck-iphone>Recheck USB</button></div></div>';
            candidateList.querySelector('[data-recheck-iphone]')?.addEventListener('click', () => void candidates());
            return;
        }
        candidateList.replaceChildren(...data.devices.map((device) => {
            const card = document.createElement('article');
            card.className = 'candidate-card';
            const copy = document.createElement('div');
            const heading = document.createElement('h3');
            heading.textContent = device.name;
            const meta = document.createElement('p');
            meta.textContent = `iOS ${device.osVersion} · ${device.udid}`;
            copy.append(heading, meta);
            const button = document.createElement('button');
            button.className = 'button primary';
            button.type = 'button';
            button.textContent = 'Set up this device';
            button.addEventListener('click', () => void create(device.udid));
            card.append(copy, button);
            return card;
        }));
    }
    catch (error) {
        discoveredIphoneCount = 0;
        iphoneCount.textContent = 'Unavailable';
        candidateList.textContent = '';
        showError(error);
    }
}
async function runtimeCandidates() {
    runtimeList.textContent = 'Scanning execution hosts…';
    try {
        const data = await request('/api/runtime-devices/discovered');
        const devices = (data.devices ?? []).filter((device) => !(device.platform === 'ios' && device.kind === 'physical'));
        discoveredRuntimeCount = devices.length;
        runtimeCount.textContent = countLabel(discoveredRuntimeCount, 'attachable', 'attachable');
        if (!devices.length) {
            runtimeList.innerHTML = '<div class="empty-state registration-empty"><span class="empty-state-kicker">Appium 3 lane</span><h3>No attachable runtime detected</h3><p>Boot an iOS Simulator or Android Emulator, or reconnect an authorized Android phone on an online execution host.</p><div class="empty-state-actions"><a class="button secondary" href="/#host-list">Open execution layer</a><button class="button secondary" type="button" data-rescan-runtime>Scan again</button></div></div>';
            runtimeList.querySelector('[data-rescan-runtime]')?.addEventListener('click', () => void scanHosts());
            return;
        }
        runtimeList.replaceChildren(...devices.map((device) => {
            const card = document.createElement('article');
            card.className = 'candidate-card';
            const copy = document.createElement('div');
            const heading = document.createElement('h3');
            heading.textContent = device.name;
            const meta = document.createElement('p');
            meta.textContent = `${device.platform} · ${device.kind} · ${device.osVersion || 'unknown OS'}${device.workerId ? ` · ${device.workerId}` : ''}`;
            const chips = document.createElement('div');
            chips.className = 'registration-runtime-chips';
            for (const value of [device.platform === 'ios' ? 'iOS' : 'Android', device.kind, device.workerId].filter(Boolean)) {
                const chip = document.createElement('span');
                chip.className = 'connection-chip';
                chip.textContent = value;
                chips.append(chip);
            }
            copy.append(heading, meta, chips);
            const button = document.createElement('button');
            button.className = 'button primary';
            button.type = 'button';
            button.textContent = 'Attach to farm';
            button.addEventListener('click', async () => {
                button.disabled = true;
                button.textContent = 'Attaching…';
                try {
                    await request('/api/runtime-devices', {
                        method: 'POST', headers: { 'content-type': 'application/json' },
                        body: JSON.stringify({ workerId: device.workerId, udid: device.udid, name: device.name }),
                    });
                    window.location.assign(`/devices/${encodeURIComponent(device.udid)}`);
                }
                catch (error) {
                    button.disabled = false;
                    button.textContent = 'Attach to farm';
                    showError(error);
                }
            });
            card.append(copy, button);
            return card;
        }));
    }
    catch (error) {
        discoveredRuntimeCount = 0;
        runtimeCount.textContent = 'Unavailable';
        runtimeList.textContent = error instanceof Error ? error.message : String(error);
    }
}
async function scanHosts() {
    await Promise.all([hostStatus(), runtimeCandidates()]);
}
async function create(udid) {
    const snapshot = await request('/api/device-registrations', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ udid }),
    });
    currentId = snapshot.id;
    candidatePanel.hidden = true;
    registrationPanel.hidden = false;
    render(snapshot);
    poll = window.setInterval(() => void refreshSnapshot(), 2_000);
}
function render(snapshot) {
    title.textContent = `${snapshot.name} · iOS ${snapshot.device.osVersion}`;
    busy.hidden = !snapshot.busy;
    if (document.activeElement !== nameInput)
        nameInput.value = snapshot.name;
    if (document.activeElement !== profileInput) {
        const previous = profileInput.value;
        profileInput.replaceChildren(new Option('Choose a coordinate profile', ''));
        for (const profile of snapshot.availableProfiles) {
            const recommended = profile.name === snapshot.recommendedProfile ? ' · recommended for this model' : '';
            profileInput.add(new Option(`${profile.displayName} (${profile.name}) · ${profile.screenSize.width}×${profile.screenSize.height}${recommended}`, profile.name));
        }
        profileInput.value = snapshot.coordinateProfile ?? (snapshot.availableProfiles.some(({ name }) => name === previous) ? previous : '');
    }
    if (document.activeElement !== accountsInput)
        accountsInput.value = snapshot.tiktokAccounts.join(', ');
    if (document.activeElement !== instagramAccountsInput)
        instagramAccountsInput.value = (snapshot.instagramAccounts ?? []).join(', ');
    passcodeInput.placeholder = snapshot.hasPasscode ? 'Passcode saved in this setup session' : 'Optional numeric passcode';
    ports.textContent = `WDA ${snapshot.wdaLocalPort} · video ${snapshot.mjpegLocalPort}`;
    checks.replaceChildren(...Object.entries(snapshot.checks).map(([key, value]) => {
        const row = document.createElement('article');
        row.className = `registration-check ${value.state}`;
        const state = document.createElement('span');
        state.className = `check-mark ${value.state}`;
        state.textContent = value.state === 'passed' ? '✓' : value.state === 'checking' ? '…' : '!';
        const copy = document.createElement('div');
        const heading = document.createElement('h3');
        heading.textContent = key.replace(/^./, (letter) => letter.toUpperCase());
        const message = document.createElement('p');
        message.textContent = value.message;
        copy.append(heading, message);
        row.append(state, copy);
        return row;
    }));
    logs.textContent = snapshot.logs.length ? snapshot.logs.join('\n') : 'No setup output yet.';
    finalizeButton.disabled = !snapshot.canFinalize || snapshot.busy;
    for (const element of registrationPanel.querySelectorAll('button')) {
        if (element.id !== 'action-cancel')
            element.disabled = snapshot.busy || (element.id === 'action-finalize' && !snapshot.canFinalize);
    }
    if (snapshot.finalized) {
        if (poll)
            window.clearInterval(poll);
        window.location.assign(`/devices/${encodeURIComponent(snapshot.device.udid)}`);
    }
}
async function refreshSnapshot() {
    if (!currentId)
        return;
    try {
        render(await request(`/api/device-registrations/${encodeURIComponent(currentId)}`));
    }
    catch (error) {
        showError(error);
    }
}
async function action(name) {
    if (!currentId)
        return;
    showError();
    try {
        const snapshot = await request(`/api/device-registrations/${encodeURIComponent(currentId)}/actions/${name}`, {
            method: 'POST', headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ authorizeTeamRegistration: authorize.checked }),
        });
        render(snapshot);
    }
    catch (error) {
        showError(error);
    }
}
document.querySelector('#refresh-candidates').addEventListener('click', () => void candidates());
document.querySelector('#refresh-runtimes').addEventListener('click', () => void scanHosts());
document.querySelector('#action-refresh').addEventListener('click', () => void action('refresh'));
document.querySelector('#action-prepare').addEventListener('click', () => {
    if (!authorize.checked && !window.confirm('Continue without allowing automatic Apple Developer team device registration? Xcode may ask you to register it manually.'))
        return;
    void action('prepare');
});
document.querySelector('#action-verify').addEventListener('click', () => void action('verify'));
finalizeButton.addEventListener('click', () => void action('finalize'));
document.querySelector('#action-cancel').addEventListener('click', async () => {
    if (!currentId || !window.confirm('Cancel this setup? Apple Developer registration or an installed WDA app cannot be undone automatically.'))
        return;
    await request(`/api/device-registrations/${encodeURIComponent(currentId)}`, { method: 'DELETE' });
    if (poll)
        window.clearInterval(poll);
    currentId = undefined;
    registrationPanel.hidden = true;
    candidatePanel.hidden = false;
    await candidates();
});
form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!currentId)
        return;
    showError();
    try {
        const snapshot = await request(`/api/device-registrations/${encodeURIComponent(currentId)}`, {
            method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({
                name: nameInput.value, coordinateProfile: profileInput.value,
                tiktokAccounts: accountsInput.value.split(','),
                instagramAccounts: instagramAccountsInput.value.split(','),
                passcode: passcodeInput.value || undefined,
            }),
        });
        passcodeInput.value = '';
        render(snapshot);
    }
    catch (error) {
        showError(error);
    }
});
void (async () => {
    await Promise.all([candidates(), scanHosts()]);
    const requestedUdid = new URLSearchParams(window.location.search).get('udid');
    if (requestedUdid)
        await create(requestedUdid).catch(showError);
})();
export {};
