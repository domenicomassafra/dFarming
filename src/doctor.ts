import { existsSync, readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { physicalIosLaneEnabled } from './runtime-options.js';

export type DoctorStatus = 'pass' | 'warn' | 'fail';

export interface DoctorCheck {
    id: string;
    status: DoctorStatus;
    summary: string;
    detail?: string;
}

export interface DoctorReport {
    role: 'standalone' | 'control-plane' | 'device-worker';
    ok: boolean;
    sourceReady: boolean;
    runtimeReady: boolean;
    realDeviceReady: boolean;
    checks: DoctorCheck[];
}

export interface CommandResult {
    status: number;
    stdout: string;
    stderr: string;
}

export type DoctorCommandRunner = (command: string, args: readonly string[]) => CommandResult;

export const systemCommandRunner: DoctorCommandRunner = (command, args) => {
    const result = spawnSync(command, [...args], { encoding: 'utf8' });
    return {
        status: result.status ?? 127,
        stdout: result.stdout ?? '',
        stderr: result.stderr ?? result.error?.message ?? '',
    };
};

function command(runner: DoctorCommandRunner, name: string, args: readonly string[] = []): CommandResult {
    try {
        return runner(name, args);
    } catch (error) {
        return { status: 127, stdout: '', stderr: error instanceof Error ? error.message : String(error) };
    }
}

function major(version: string): number {
    const match = version.match(/^(?:v)?(\d+)/);
    return match ? Number(match[1]) : 0;
}

function physicalDeviceLines(output: string): string[] {
    const section = output.split('== Simulators ==')[0] ?? output;
    return section.split('\n')
        .map((line) => line.trim())
        .filter((line) => line && !line.startsWith('==')
            && !/(?:\bMac \(|\bMacBook\b|\bMac mini\b|\bMac Studio\b|\bMac Pro\b)/i.test(line));
}

function androidDeviceLines(output: string): string[] {
    return output.split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line && !line.startsWith('List of devices attached'))
        .filter((line) => /\sdevice(?:\s|$)/.test(line));
}

function androidSdkHasBuildTools(sdkRoot: string): boolean {
    const root = path.join(sdkRoot, 'build-tools');
    if (!existsSync(root)) return false;
    try {
        return readdirSync(root, { withFileTypes: true }).some((entry) => (
            entry.isDirectory()
            && existsSync(path.join(root, entry.name, 'aapt2'))
            && existsSync(path.join(root, entry.name, 'apksigner'))
        ));
    } catch {
        return false;
    }
}

export function collectDoctorReport(
    runner: DoctorCommandRunner = systemCommandRunner,
    env: NodeJS.ProcessEnv = process.env,
    cwd = process.cwd(),
    platform: NodeJS.Platform = process.platform,
): DoctorReport {
    const checks: DoctorCheck[] = [];
    const role = (env.PHONE_FARM_ROLE ?? 'standalone') as DoctorReport['role'];
    const physicalIosEnabled = physicalIosLaneEnabled(env);
    if (!['standalone', 'control-plane', 'device-worker'].includes(role)) {
        checks.push({ id: 'role', status: 'fail', summary: `Unknown PHONE_FARM_ROLE: ${role}` });
    } else {
        checks.push({ id: 'role', status: 'pass', summary: `Runtime role: ${role}` });
    }

    const nodeVersion = process.version;
    checks.push(major(nodeVersion) >= 22
        ? { id: 'node', status: 'pass', summary: `Node ${nodeVersion}` }
        : { id: 'node', status: 'fail', summary: `Node ${nodeVersion}`, detail: 'Node 22 or newer is required.' });

    const appleWorker = role !== 'control-plane' && platform === 'darwin';
    const androidOnlyWorker = role === 'device-worker' && platform !== 'darwin';
    let fullXcode = false;
    if (role !== 'control-plane') {
        if (appleWorker) {
            const xcodeSelect = command(runner, 'xcode-select', ['-p']);
            const developerDir = xcodeSelect.stdout.trim();
            fullXcode = xcodeSelect.status === 0 && /Xcode\.app\/Contents\/Developer$/.test(developerDir);
            if (!fullXcode) {
                checks.push({
                    id: 'xcode', status: 'fail', summary: 'Full Xcode is not selected',
                    detail: developerDir
                        ? `xcode-select points to ${developerDir}; select /Applications/Xcode.app/Contents/Developer.`
                        : (xcodeSelect.stderr.trim() || 'Install and select full Xcode.'),
                });
            } else {
                const xcodebuild = command(runner, 'xcodebuild', ['-version']);
                checks.push(xcodebuild.status === 0
                    ? { id: 'xcode', status: 'pass', summary: xcodebuild.stdout.trim().replace(/\n/g, ' · ') }
                    : { id: 'xcode', status: 'fail', summary: 'xcodebuild is unavailable', detail: xcodebuild.stderr.trim() });
            }
        }

        const appiumRuntimePath = path.resolve(cwd, 'node_modules/appium-runtime/index.js');
        checks.push(existsSync(appiumRuntimePath)
            ? { id: 'appium-runtime', status: 'pass', summary: 'Modern Appium runtime sidecar is installed' }
            : { id: 'appium-runtime', status: 'fail', summary: 'Modern Appium runtime sidecar is missing', detail: 'Run npm ci to enable iOS Simulator and Android runtimes.' });

        const runtimeXcuitest = path.resolve(cwd, '.appium-runtime/node_modules/appium-xcuitest-driver');
        const runtimeAndroid = path.resolve(cwd, '.appium-runtime/node_modules/appium-uiautomator2-driver');
        if (appleWorker) {
            checks.push(existsSync(runtimeXcuitest)
                ? { id: 'xcuitest-runtime', status: 'pass', summary: 'Modern XCUITest runtime driver is installed' }
                : {
                    id: 'xcuitest-runtime', status: physicalIosEnabled ? 'fail' : 'warn',
                    summary: 'Modern XCUITest runtime driver is not prepared', detail: 'Run npm run appium:runtime:install-ios.',
                });
        }
        checks.push(existsSync(runtimeAndroid)
            ? { id: 'uiautomator2', status: 'pass', summary: 'UiAutomator2 runtime driver is installed' }
            : {
                id: 'uiautomator2',
                status: androidOnlyWorker ? 'fail' : 'warn',
                summary: 'UiAutomator2 runtime driver is not prepared',
                detail: 'Run npm run appium:runtime:install-android.',
            });

        const adb = command(runner, 'adb', ['version']);
        checks.push(adb.status === 0
            ? { id: 'adb', status: 'pass', summary: adb.stdout.trim().split(/\r?\n/)[0] || 'ADB is available' }
            : {
                id: 'adb',
                status: androidOnlyWorker ? 'fail' : 'warn',
                summary: 'ADB is unavailable',
                detail: androidOnlyWorker ? 'Install Android platform-tools for this Android worker.' : 'Install Android platform-tools to enable Android devices.',
            });
        if (androidOnlyWorker) {
            const sdkRoot = env.ANDROID_HOME?.trim() || env.ANDROID_SDK_ROOT?.trim();
            const sdkReady = Boolean(
                sdkRoot
                && existsSync(path.join(sdkRoot, 'platform-tools', 'adb'))
                && androidSdkHasBuildTools(sdkRoot),
            );
            checks.push(sdkReady
                ? { id: 'android-sdk', status: 'pass', summary: `Android SDK toolchain: ${sdkRoot}` }
                : {
                    id: 'android-sdk',
                    status: 'fail',
                    summary: 'Android SDK toolchain is incomplete',
                    detail: 'Set ANDROID_HOME/ANDROID_SDK_ROOT to an SDK containing platform-tools/adb plus build-tools with aapt2 and apksigner.',
                });
            const java = command(runner, 'java', ['-version']);
            checks.push(java.status === 0
                ? { id: 'java', status: 'pass', summary: (java.stderr || java.stdout).trim().split(/\r?\n/)[0] || 'Java is available' }
                : { id: 'java', status: 'fail', summary: 'Java is unavailable', detail: 'Install a supported JDK for UiAutomator2/Appium.' });
        }
    }

    const insideControlPlaneContainer = role === 'control-plane' && env.PHONE_FARM_CONTAINER === 'true';
    const docker = insideControlPlaneContainer
        ? { status: 0, stdout: 'Container runtime supplied by host', stderr: '' }
        : command(runner, 'docker', ['--version']);
    if (role !== 'device-worker') {
        checks.push(docker.status === 0
            ? { id: 'database-runtime', status: 'pass', summary: docker.stdout.trim() || 'Docker is available' }
            : {
                id: 'database-runtime', status: role === 'control-plane' ? 'fail' : 'warn',
                summary: 'Docker is unavailable',
                detail: 'The bundled PostgreSQL/control plane cannot start; install Docker or provide an external deployment.',
            });
    }

    if (role === 'control-plane') {
        checks.push(env.DATABASE_URL && !env.DATABASE_URL.includes('CHANGE_ME')
            ? { id: 'database-url', status: 'pass', summary: 'DATABASE_URL is configured' }
            : { id: 'database-url', status: 'fail', summary: 'DATABASE_URL is not configured for the control plane' });
        checks.push(env.PHONE_FARM_DEVICE_WORKERS?.trim()
            ? { id: 'device-workers', status: 'pass', summary: 'At least one remote device worker is configured' }
            : { id: 'device-workers', status: 'warn', summary: 'No remote device workers are configured yet' });
        if (env.PHONE_FARM_DEVICE_WORKERS?.trim()) {
            checks.push(env.PHONE_FARM_DEVICE_WORKER_TOKEN
                ? { id: 'worker-token', status: 'pass', summary: 'Device-worker bearer token is configured' }
                : { id: 'worker-token', status: 'fail', summary: 'PHONE_FARM_DEVICE_WORKER_TOKEN is required for remote workers' });
            checks.push(env.PHONE_FARM_INTERNAL_TOKEN
                ? { id: 'internal-token', status: 'pass', summary: 'Internal worker asset/config token is configured' }
                : { id: 'internal-token', status: 'fail', summary: 'PHONE_FARM_INTERNAL_TOKEN is required for distributed execution' });
        }
    }

    if (role === 'device-worker') {
        checks.push(env.DATABASE_URL && !env.DATABASE_URL.includes('CHANGE_ME')
            ? { id: 'control-database', status: 'pass', summary: 'Control-plane PostgreSQL URL is configured' }
            : { id: 'control-database', status: 'fail', summary: 'DATABASE_URL must point at the MiniPC PostgreSQL instance' });
        checks.push(env.PHONE_FARM_WORKER_ID?.trim()
            ? { id: 'worker-id', status: 'pass', summary: `Worker id: ${env.PHONE_FARM_WORKER_ID}` }
            : { id: 'worker-id', status: 'warn', summary: 'PHONE_FARM_WORKER_ID is not set; mac-worker will be used' });
    }

    const envPath = path.resolve(cwd, '.env');
    if (insideControlPlaneContainer) {
        checks.push({ id: 'configuration', status: 'pass', summary: 'Configuration is injected by the container environment' });
    } else {
        checks.push(existsSync(envPath)
            ? { id: 'configuration', status: 'pass', summary: '.env exists' }
            : { id: 'configuration', status: 'warn', summary: '.env is not configured', detail: 'Copy the role-appropriate env example before a live run.' });
    }

    if (appleWorker && !physicalIosEnabled) {
        checks.push({
            id: 'iphone', status: 'warn', summary: 'Physical iPhone lane is disabled',
            detail: 'Set PHONE_FARM_ENABLE_PHYSICAL_IOS=true after configuring Apple Development signing.',
        });
    } else if (appleWorker && fullXcode) {
        const devices = command(runner, 'xcrun', ['xctrace', 'list', 'devices']);
        const physical = devices.status === 0 ? physicalDeviceLines(devices.stdout) : [];
        checks.push(physical.length
            ? { id: 'iphone', status: 'pass', summary: `${physical.length} physical iOS device${physical.length === 1 ? '' : 's'} visible`, detail: physical.join(' · ') }
            : { id: 'iphone', status: 'fail', summary: 'No physical iPhone is visible', detail: devices.stderr.trim() || 'Connect, unlock, trust, and enable Developer Mode on an iPhone.' });
    } else if (appleWorker) {
        checks.push({ id: 'iphone', status: 'fail', summary: 'iPhone discovery is blocked by the Xcode prerequisite' });
    }

    if (appleWorker && physicalIosEnabled) {
        const teamId = env.XCODE_ORG_ID?.trim();
        const bundleId = env.WDA_BUNDLE_ID?.trim();
        const configured = Boolean(teamId && !teamId.includes('replace-')
            && bundleId && bundleId !== 'com.example.WebDriverAgentRunner');
        const identities = command(runner, 'security', ['find-identity', '-v', '-p', 'codesigning']);
        const identityCount = Number(identities.stdout.match(/(\d+) valid identities found/)?.[1] ?? 0);
        checks.push(configured && identities.status === 0 && identityCount > 0
            ? { id: 'signing', status: 'pass', summary: `${identityCount} Apple code-signing identit${identityCount === 1 ? 'y' : 'ies'} available` }
            : {
                id: 'signing', status: 'fail', summary: 'Physical-iPhone signing is not ready',
                detail: !configured
                    ? 'Configure XCODE_ORG_ID and a unique WDA_BUNDLE_ID.'
                    : 'Add a valid Apple Development signing identity in Xcode.',
            });
    } else if (appleWorker) {
        checks.push({ id: 'signing', status: 'warn', summary: 'Physical-iPhone signing is disabled with the physical lane' });
    }

    if (androidOnlyWorker) {
        const devices = command(runner, 'adb', ['devices', '-l']);
        const physical = devices.status === 0
            ? androidDeviceLines(devices.stdout).filter((line) => {
                const serial = line.split(/\s+/)[0] ?? '';
                if (!serial || serial.startsWith('emulator-')) return false;
                const qemu = command(runner, 'adb', ['-s', serial, 'shell', 'getprop', 'ro.kernel.qemu']);
                return qemu.status !== 0 || qemu.stdout.trim() !== '1';
            })
            : [];
        checks.push(physical.length
            ? { id: 'android-device', status: 'pass', summary: `${physical.length} physical Android device${physical.length === 1 ? '' : 's'} visible`, detail: physical.join(' · ') }
            : { id: 'android-device', status: 'warn', summary: 'No physical Android device is attached', detail: 'Emulators can still be used; connect an authorized ADB device for real-device acceptance.' });
    }

    const sourceRequired = role === 'control-plane' ? ['node'] : ['node', 'appium-runtime'];
    const runtimeRequired = role === 'control-plane'
        ? ['node', 'database-runtime', 'database-url', ...(env.PHONE_FARM_DEVICE_WORKERS?.trim() ? ['worker-token', 'internal-token'] : [])]
        : role === 'device-worker'
            ? androidOnlyWorker
                ? ['node', 'appium-runtime', 'uiautomator2', 'adb', 'android-sdk', 'java', 'control-database']
                : ['node', 'appium-runtime', 'xcode', 'control-database']
            : ['node', 'appium-runtime', 'xcode', 'iphone'];
    const realDeviceRequired = role === 'control-plane'
        ? []
        : androidOnlyWorker
            ? ['node', 'appium-runtime', 'uiautomator2', 'adb', 'android-sdk', 'java', 'android-device']
            : ['node', 'appium-runtime', 'xcuitest-runtime', 'xcode', 'iphone', 'signing'];
    const failed = (ids: string[]) => checks.some((check) => ids.includes(check.id) && check.status === 'fail');
    return {
        role,
        ok: !checks.some((check) => check.status === 'fail'),
        sourceReady: !failed(sourceRequired),
        runtimeReady: !failed(runtimeRequired),
        // A control-plane host never owns a physical iPhone itself; consumers
        // should use runtimeReady plus fleet/device health for that role.
        realDeviceReady: role === 'control-plane'
            ? false
            : androidOnlyWorker
                ? !failed(realDeviceRequired) && checks.find(({ id }) => id === 'android-device')?.status === 'pass'
                : physicalIosEnabled && !failed(realDeviceRequired),
        checks,
    };
}

function renderHuman(report: DoctorReport): string {
    const icon: Record<DoctorStatus, string> = { pass: '✓', warn: '!', fail: '✗' };
    const lines = report.checks.map((check) => `${icon[check.status]} ${check.summary}${check.detail ? `\n  ${check.detail}` : ''}`);
    lines.push('', `Role: ${report.role}`);
    lines.push(`Source readiness: ${report.sourceReady ? 'ready' : 'blocked'}`);
    lines.push(`Runtime readiness: ${report.runtimeReady ? 'ready' : 'blocked'}`);
    if (report.role !== 'control-plane') lines.push(`Real-device readiness: ${report.realDeviceReady ? 'ready' : 'blocked'}`);
    return lines.join('\n');
}

async function main(): Promise<void> {
    const report = collectDoctorReport();
    if (process.argv.includes('--json')) console.log(JSON.stringify(report, null, 2));
    else console.log(renderHuman(report));
    process.exitCode = report.runtimeReady ? 0 : 1;
}

const entrypoint = process.argv[1] ? path.resolve(process.argv[1]) : '';
if (entrypoint && fileURLToPath(import.meta.url) === entrypoint) await main();
