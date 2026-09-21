import assert from 'node:assert/strict';
import test from 'node:test';

import { acceptancePreflightErrors } from '../src/acceptance-live.js';
import type { DoctorReport } from '../src/doctor.js';

function doctor(overrides: Partial<DoctorReport> = {}): DoctorReport {
    return {
        role: 'control-plane',
        ok: true,
        sourceReady: true,
        runtimeReady: true,
        realDeviceReady: false,
        checks: [],
        ...overrides,
    };
}

test('control-plane acceptance allows a connected virtual runtime on a healthy worker', () => {
    assert.deepEqual(acceptancePreflightErrors(
        doctor(),
        { udid: 'sim-1', name: 'Simulator', kind: 'simulator', workerId: 'studio', connected: {} },
        { id: 'studio', online: true },
    ), []);
});

test('control-plane acceptance blocks virtual runtimes whose owning worker is offline', () => {
    assert.match(acceptancePreflightErrors(
        doctor(),
        { udid: 'emu-1', name: 'Emulator', kind: 'emulator', workerId: 'linux', connected: {} },
        { id: 'linux', online: false },
    ).join('\n'), /offline/);
});

test('device-worker acceptance still requires real-device readiness for physical devices', () => {
    assert.match(acceptancePreflightErrors(
        doctor({ role: 'device-worker', realDeviceReady: false }),
        { udid: 'phone-1', name: 'Phone', kind: 'physical', connected: {} },
    ).join('\n'), /Real-device preflight is blocked/);
});

test('all acceptance targets require a connected device', () => {
    assert.match(acceptancePreflightErrors(
        doctor(),
        { udid: 'sim-1', name: 'Simulator', kind: 'simulator', workerId: 'studio' },
        { id: 'studio', online: true },
    ).join('\n'), /not connected/);
});
