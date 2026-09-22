import { execFileSync } from 'node:child_process';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { physicalIosLaneEnabled } from './runtime-options.js';

export type ServiceName = 'appium' | 'appium-runtime' | 'wda' | 'worker' | 'device-worker' | 'web';

const SERVICES: ServiceName[] = ['appium', 'appium-runtime', 'wda', 'worker', 'device-worker', 'web'];

export function servicesForRole(
    role = process.env.PHONE_FARM_ROLE ?? 'standalone',
    physicalIosEnabled = physicalIosLaneEnabled(),
): ServiceName[] {
    if (role === 'device-worker') {
        return physicalIosEnabled
            ? ['appium', 'appium-runtime', 'wda', 'worker', 'device-worker']
            : ['appium-runtime', 'worker', 'device-worker'];
    }
    if (role === 'standalone') {
        return physicalIosEnabled
            ? ['appium', 'appium-runtime', 'wda', 'worker', 'web']
            : ['appium-runtime', 'worker', 'web'];
    }
    if (role === 'control-plane') return [];
    throw new Error(`Unknown PHONE_FARM_ROLE: ${role}`);
}

interface ServiceSpec {
    label: string;
    args: string[];
    env?: Record<string, string>;
}

function xml(value: string): string {
    return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
}

export function serviceSpecs(root = process.cwd(), node = process.execPath): Record<ServiceName, ServiceSpec> {
    const common = ['--env-file-if-exists=.env', '--env-file-if-exists=.env.devices', '--import', 'tsx'];
    const fromRoot = (...segments: string[]) => path.join(root, ...segments);
    return {
        appium: {
            label: 'com.phone-farm.appium',
            args: [node, fromRoot('node_modules', 'appium-runtime', 'index.js'), '--address', '127.0.0.1', '--base-path', '/', '--port', '4725', '--log-level', 'warn'],
            env: { APPIUM_HOME: path.join(root, '.appium-runtime') },
        },
        'appium-runtime': {
            label: 'com.phone-farm.appium-runtime',
            args: [node, fromRoot('node_modules', 'appium-runtime', 'index.js'), '--address', '127.0.0.1', '--base-path', '/', '--port', '4726', '--log-level', 'warn'],
            env: { APPIUM_HOME: path.join(root, '.appium-runtime') },
        },
        wda: { label: 'com.phone-farm.wda', args: [node, ...common, fromRoot('src', 'devices', 'wda-service.ts')] },
        worker: { label: 'com.phone-farm.worker', args: [node, ...common, fromRoot('src', 'scheduler', 'worker.ts')] },
        'device-worker': { label: 'com.phone-farm.device-worker', args: [node, ...common, fromRoot('src', 'device-worker-server.ts')] },
        web: { label: 'com.phone-farm.web', args: [node, ...common, fromRoot('src', 'api', 'server.ts')] },
    };
}

export function renderLaunchAgent(
    service: ServiceName,
    root = process.cwd(),
    node = process.execPath,
    home = os.homedir(),
): string {
    const spec = serviceSpecs(root, node)[service];
    const logs = path.join(root, '.runtime', 'logs');
    const env = {
        PATH: '/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin',
        HOME: home,
        ...(spec.env ?? {}),
    };
    const args = spec.args.map((arg) => `      <string>${xml(arg)}</string>`).join('\n');
    const envXml = Object.entries(env).map(([key, value]) => `      <key>${xml(key)}</key>\n      <string>${xml(value)}</string>`).join('\n');
    return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${spec.label}</string>
  <key>ProgramArguments</key>
  <array>
${args}
  </array>
  <key>WorkingDirectory</key><string>${xml(root)}</string>
  <key>EnvironmentVariables</key>
  <dict>
${envXml}
  </dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>5</integer>
  <key>StandardOutPath</key><string>${xml(path.join(logs, `${service}.out.log`))}</string>
  <key>StandardErrorPath</key><string>${xml(path.join(logs, `${service}.err.log`))}</string>
</dict>
</plist>
`;
}

export async function renderLaunchAgents(
    outputDirectory = path.resolve('.runtime/launchd'),
    services: readonly ServiceName[] = servicesForRole(),
): Promise<string[]> {
    await mkdir(outputDirectory, { recursive: true, mode: 0o700 });
    await mkdir(path.resolve('.runtime/logs'), { recursive: true, mode: 0o700 });
    // The render directory is reused across standalone/device-worker roles.
    // Remove known stale generated plists so its contents match the selected role.
    for (const service of SERVICES) {
        await rm(path.join(outputDirectory, `${serviceSpecs()[service].label}.plist`), { force: true });
    }
    const files: string[] = [];
    for (const service of services) {
        const file = path.join(outputDirectory, `${serviceSpecs()[service].label}.plist`);
        await writeFile(file, renderLaunchAgent(service), { mode: 0o600 });
        files.push(file);
    }
    return files;
}

function launchctl(args: string[], stdio: 'inherit' | 'pipe' = 'inherit'): string {
    return execFileSync('/bin/launchctl', args, { encoding: 'utf8', stdio }) ?? '';
}

function launchctlAsUser(uid: number, args: string[], stdio: 'inherit' | 'pipe' = 'inherit'): string {
    return launchctl(['asuser', String(uid), '/bin/launchctl', ...args], stdio);
}

function launchAgentLoaded(domain: string, label: string): boolean {
    try {
        launchctl(['print', `${domain}/${label}`], 'pipe');
        return true;
    } catch {
        return false;
    }
}

async function waitForLaunchAgentUnloaded(domain: string, label: string, timeoutMs = 15_000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        if (!launchAgentLoaded(domain, label)) return;
        await new Promise<void>((resolve) => setTimeout(resolve, 250));
    }
    throw new Error(`launchd did not finish unloading ${label} within ${timeoutMs}ms`);
}

async function bootstrapLaunchAgent(uid: number, domain: string, destination: string, label: string): Promise<void> {
    let lastError: unknown;
    for (let attempt = 1; attempt <= 6; attempt += 1) {
        try {
            launchctlAsUser(uid, ['bootstrap', domain, destination], 'pipe');
            return;
        } catch (error) {
            lastError = error;
            if (attempt < 6) await new Promise<void>((resolve) => setTimeout(resolve, attempt * 200));
        }
    }
    throw lastError ?? new Error(`Could not bootstrap ${label}`);
}

export async function installLaunchAgents(): Promise<void> {
    if (process.platform !== 'darwin') throw new Error('launchd supervision is supported only on macOS');
    const rendered = await renderLaunchAgents();
    const target = path.join(os.homedir(), 'Library', 'LaunchAgents');
    await mkdir(target, { recursive: true });
    const uid = process.getuid?.() ?? 0;
    const domain = `gui/${uid}`;
    const selectedLabels = new Set(rendered.map((source) => path.basename(source, '.plist')));
    for (const service of SERVICES) {
        const label = serviceSpecs()[service].label;
        if (selectedLabels.has(label)) continue;
        try { launchctlAsUser(uid, ['bootout', `${domain}/${label}`], 'pipe'); } catch { /* already unloaded */ }
        await waitForLaunchAgentUnloaded(domain, label);
        await rm(path.join(target, `${label}.plist`), { force: true });
    }
    for (const source of rendered) {
        const destination = path.join(target, path.basename(source));
        await writeFile(destination, await readFile(source), { mode: 0o600 });
        const label = path.basename(destination, '.plist');
        try { launchctlAsUser(uid, ['bootout', `${domain}/${label}`], 'pipe'); } catch { /* not loaded */ }
        await waitForLaunchAgentUnloaded(domain, label);
        await bootstrapLaunchAgent(uid, domain, destination, label);
    }
}

export async function uninstallLaunchAgents(): Promise<void> {
    if (process.platform !== 'darwin') throw new Error('launchd supervision is supported only on macOS');
    const target = path.join(os.homedir(), 'Library', 'LaunchAgents');
    const domain = `gui/${process.getuid?.() ?? 0}`;
    for (const service of SERVICES) {
        const label = serviceSpecs()[service].label;
        try { launchctl(['bootout', `${domain}/${label}`], 'pipe'); } catch { /* already unloaded */ }
        await rm(path.join(target, `${label}.plist`), { force: true });
    }
}

export function launchdStatus(): Array<{ service: ServiceName; label: string; loaded: boolean; detail?: string }> {
    if (process.platform !== 'darwin') return SERVICES.map((service) => ({ service, label: serviceSpecs()[service].label, loaded: false }));
    const domain = `gui/${process.getuid?.() ?? 0}`;
    return SERVICES.map((service) => {
        const label = serviceSpecs()[service].label;
        try {
            const detail = launchctl(['print', `${domain}/${label}`], 'pipe');
            return { service, label, loaded: true, detail: detail.split('\n').slice(0, 12).join('\n') };
        } catch {
            return { service, label, loaded: false };
        }
    });
}

async function main(): Promise<void> {
    const command = process.argv[2] ?? 'status';
    if (command === 'render') console.log((await renderLaunchAgents()).join('\n'));
    else if (command === 'install') await installLaunchAgents();
    else if (command === 'uninstall') await uninstallLaunchAgents();
    else if (command === 'status') console.log(JSON.stringify(launchdStatus(), null, 2));
    else throw new Error('Usage: service <render|install|uninstall|status>');
}

const entrypoint = process.argv[1] ? path.resolve(process.argv[1]) : '';
if (entrypoint && fileURLToPath(import.meta.url) === entrypoint) await main();
