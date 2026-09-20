import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { collectDoctorReport, type DoctorCommandRunner } from '../src/doctor.js';

function runner(fixtures: Record<string, { status?: number; stdout?: string; stderr?: string }>): DoctorCommandRunner {
    return (command, args) => {
        const key = `${command} ${args.join(' ')}`.trim();
        const fixture = fixtures[key] ?? { status: 127, stderr: 'missing fixture' };
        return { status: fixture.status ?? 0, stdout: fixture.stdout ?? '', stderr: fixture.stderr ?? '' };
    };
}

function doctorCwd(context: test.TestContext): string {
    const cwd = mkdtempSync(path.join(os.tmpdir(), 'phone-farm-doctor-'));
    context.after(() => rmSync(cwd, { recursive: true, force: true }));
    const appium = path.join(cwd, 'node_modules', 'appium');
    const appiumRuntime = path.join(cwd, 'node_modules', 'appium-runtime');
    mkdirSync(appium, { recursive: true });
    mkdirSync(appiumRuntime, { recursive: true });
    writeFileSync(path.join(appium, 'index.js'), '');
    writeFileSync(path.join(appiumRuntime, 'index.js'), '');
    return cwd;
}

function addAndroidRuntime(cwd: string): void {
    mkdirSync(path.join(cwd, '.appium-runtime', 'node_modules', 'appium-uiautomator2-driver'), { recursive: true });
}

function addAndroidSdk(cwd: string): string {
    const sdk = path.join(cwd, 'android-sdk');
    mkdirSync(path.join(sdk, 'platform-tools'), { recursive: true });
    mkdirSync(path.join(sdk, 'build-tools', '37.0.0'), { recursive: true });
    writeFileSync(path.join(sdk, 'platform-tools', 'adb'), '');
    writeFileSync(path.join(sdk, 'build-tools', '37.0.0', 'aapt2'), '');
    writeFileSync(path.join(sdk, 'build-tools', '37.0.0', 'apksigner'), '');
    return sdk;
}

test('doctor reports a missing full Xcode as a real-device blocker without blocking source readiness', (context) => {
    const report = collectDoctorReport(runner({
        'xcode-select -p': { stdout: '/Library/Developer/CommandLineTools\n' },
        'docker --version': { status: 127, stderr: 'not found' },
    }), {}, doctorCwd(context), 'darwin');
    assert.equal(report.sourceReady, true);
    assert.equal(report.realDeviceReady, false);
    assert.equal(report.checks.find(({ id }) => id === 'xcode')?.status, 'fail');
});

test('doctor recognizes full Xcode and a visible physical device', (context) => {
    const report = collectDoctorReport(runner({
        'xcode-select -p': { stdout: '/Applications/Xcode.app/Contents/Developer\n' },
        'xcodebuild -version': { stdout: 'Xcode 26.1\nBuild version 17B55' },
        'docker --version': { stdout: 'Docker version 28.0.0' },
        'xcrun xctrace list devices': { stdout: '== Devices ==\nDodo iPhone (26.0) (0000-AAAA)\nDodo Mac (26.0) (MAC)\n\n== Simulators ==\niPhone 17 (26.0) (SIM)\n' },
        'security find-identity -v -p codesigning': { stdout: '  1) ABCDEF "Apple Development"\n     1 valid identities found\n' },
    }), { XCODE_ORG_ID: 'TEAM123', WDA_BUNDLE_ID: 'com.example.owner.WebDriverAgentRunner' }, doctorCwd(context), 'darwin');
    assert.equal(report.realDeviceReady, true);
    assert.match(report.checks.find(({ id }) => id === 'iphone')?.summary ?? '', /1 physical/);
});

test('device-worker runtime can be ready without a physical iPhone and does not count the host Mac as one', (context) => {
    const cwd = doctorCwd(context);
    const report = collectDoctorReport(runner({
        'xcode-select -p': { stdout: '/Applications/Xcode.app/Contents/Developer\n' },
        'xcodebuild -version': { stdout: 'Xcode 27.0\nBuild version 27A266a' },
        'xcrun xctrace list devices': { stdout: '== Devices ==\nMac Studio Dodo (47E01785-0016-5835-8977-860F1D589104)\n\n== Simulators ==\n' },
    }), {
        PHONE_FARM_ROLE: 'device-worker',
        PHONE_FARM_WORKER_ID: 'macstudio',
        DATABASE_URL: 'postgresql://phone_farm:secret@minipc:55432/phone_farm',
    }, cwd, 'darwin');
    assert.equal(report.checks.find(({ id }) => id === 'iphone')?.status, 'fail');
    assert.equal(report.runtimeReady, true);
    assert.equal(report.realDeviceReady, false);
});

test('simulator-only device worker is runtime-ready without physical signing', (context) => {
    const cwd = doctorCwd(context);
    const report = collectDoctorReport(runner({
        'xcode-select -p': { stdout: '/Applications/Xcode.app/Contents/Developer\n' },
        'xcodebuild -version': { stdout: 'Xcode 27.0\nBuild version 27A266a' },
    }), {
        PHONE_FARM_ROLE: 'device-worker',
        PHONE_FARM_WORKER_ID: 'macstudio',
        PHONE_FARM_ENABLE_PHYSICAL_IOS: 'false',
        DATABASE_URL: 'postgresql://phone_farm:secret@minipc:55432/phone_farm',
    }, cwd, 'darwin');
    assert.equal(report.runtimeReady, true);
    assert.equal(report.realDeviceReady, false);
    assert.equal(report.checks.find(({ id }) => id === 'signing')?.status, 'warn');
});

test('control-plane doctor does not require Xcode and requires Docker/database configuration', () => {
    const report = collectDoctorReport(runner({
        'docker --version': { stdout: 'Docker version 28.0.0' },
    }), {
        PHONE_FARM_ROLE: 'control-plane',
        DATABASE_URL: 'postgresql://phone_farm:secret@127.0.0.1:5432/phone_farm',
        PHONE_FARM_DEVICE_WORKERS: 'macstudio=http://macstudio:3010',
        PHONE_FARM_DEVICE_WORKER_TOKEN: 'worker-secret',
        PHONE_FARM_INTERNAL_TOKEN: 'internal-secret',
    }, process.cwd());
    assert.equal(report.runtimeReady, true);
    assert.equal(report.realDeviceReady, false);
    assert.equal(report.checks.some(({ id }) => id === 'xcode'), false);
    assert.equal(report.checks.find(({ id }) => id === 'database-runtime')?.status, 'pass');
});

test('Linux Android device worker requires ADB and UiAutomator2 but never Xcode', (context) => {
    const cwd = doctorCwd(context);
    addAndroidRuntime(cwd);
    const sdk = addAndroidSdk(cwd);
    const report = collectDoctorReport(runner({
        'adb version': { stdout: 'Android Debug Bridge version 1.0.41\n' },
        'adb devices -l': { stdout: 'List of devices attached\nABC123 device model:Pixel_9 transport_id:1\n' },
        'java -version': { stderr: 'openjdk version "21.0.12"\n' },
    }), {
        PHONE_FARM_ROLE: 'device-worker',
        PHONE_FARM_WORKER_ID: 'android-linux',
        DATABASE_URL: 'postgresql://phone_farm:secret@minipc:55432/phone_farm',
        ANDROID_HOME: sdk,
        ANDROID_SDK_ROOT: sdk,
    }, cwd, 'linux');
    assert.equal(report.runtimeReady, true);
    assert.equal(report.realDeviceReady, true);
    assert.equal(report.checks.some(({ id }) => id === 'xcode'), false);
    assert.equal(report.checks.find(({ id }) => id === 'adb')?.status, 'pass');
    assert.equal(report.checks.find(({ id }) => id === 'uiautomator2')?.status, 'pass');
    assert.equal(report.checks.find(({ id }) => id === 'android-sdk')?.status, 'pass');
    assert.equal(report.checks.find(({ id }) => id === 'java')?.status, 'pass');
    assert.equal(report.checks.find(({ id }) => id === 'android-device')?.status, 'pass');
});

test('Linux Android worker is not runtime-ready with adb alone and no SDK root', (context) => {
    const cwd = doctorCwd(context);
    addAndroidRuntime(cwd);
    const report = collectDoctorReport(runner({
        'adb version': { stdout: 'Android Debug Bridge version 1.0.41\n' },
        'adb devices -l': { stdout: 'List of devices attached\n' },
        'java -version': { stderr: 'openjdk version "21.0.12"\n' },
    }), {
        PHONE_FARM_ROLE: 'device-worker',
        PHONE_FARM_WORKER_ID: 'android-linux',
        DATABASE_URL: 'postgresql://phone_farm:secret@minipc:55432/phone_farm',
    }, cwd, 'linux');
    assert.equal(report.runtimeReady, false);
    assert.equal(report.checks.find(({ id }) => id === 'android-sdk')?.status, 'fail');
});
