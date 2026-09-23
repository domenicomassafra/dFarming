import { coordinatesForProfile } from './coordinates.js';
import { loadRegisteredDevices } from './registry.js';
import {
    WdaRemoteControl,
    type RemoteAction,
    type RemoteControl,
    type RemoteVideoCapabilities,
    type ScreenInfo,
} from './wda-remote.js';
import { passcodeForDevice } from './secrets.js';
import { AppiumRemoteControl } from './appium-remote.js';
import { ScrcpyVideoSource } from './scrcpy-video.js';
import { collectRecentDeviceLogs } from './runtime-logs.js';

export class RegistryWdaRemoteControl implements RemoteControl {
    private readonly controls = new Map<string, WdaRemoteControl | AppiumRemoteControl>();
    private readonly builds = new Map<string, Promise<{
        control: WdaRemoteControl | AppiumRemoteControl;
        generation: number;
        cacheable: boolean;
    }>>();
    private readonly generations = new Map<string, number>();

    /** Forget the cached client so the next call rebuilds it from devices.json (passcode, ports, profile). */
    forget(udid: string): void {
        this.generations.set(udid, (this.generations.get(udid) ?? 0) + 1);
        const current = this.controls.get(udid);
        if (current instanceof AppiumRemoteControl) current.forget();
        this.controls.delete(udid);
    }

    async control(udid: string): Promise<WdaRemoteControl | AppiumRemoteControl> {
        for (;;) {
            const cached = this.controls.get(udid);
            if (cached) return cached;
            let build = this.builds.get(udid);
            if (!build) {
                const generation = this.generations.get(udid) ?? 0;
                build = this.buildControl(udid, generation);
                this.builds.set(udid, build);
            }
            const result = await build;
            if (this.builds.get(udid) === build) this.builds.delete(udid);
            if ((this.generations.get(udid) ?? 0) !== result.generation) {
                if (result.control instanceof AppiumRemoteControl) result.control.forget();
                continue;
            }
            if (!result.cacheable) return result.control;
            const winner = this.controls.get(udid);
            if (winner) {
                if (result.control instanceof AppiumRemoteControl && winner !== result.control) result.control.forget();
                return winner;
            }
            this.controls.set(udid, result.control);
            return result.control;
        }
    }

    private async buildControl(
        udid: string,
        generation: number,
    ): Promise<{
        control: WdaRemoteControl | AppiumRemoteControl;
        generation: number;
        cacheable: boolean;
    }> {
        const device = (await loadRegisteredDevices()).find((candidate) => candidate.udid === udid);
        if (!device) return { control: new WdaRemoteControl(), generation, cacheable: false };
        const backend = device.automationBackend
            ?? ((device.platform ?? 'ios') === 'ios' && (device.kind ?? 'physical') === 'physical' ? 'wda' : 'appium');
        if (backend === 'appium') {
            const control = new AppiumRemoteControl(device);
            return { control, generation, cacheable: true };
        }
        const control = new WdaRemoteControl({
            deviceUdid: udid,
            passcode: device.passcode ?? await passcodeForDevice(udid),
            passcodeKeypadLayout: coordinatesForProfile(device.coordinateProfile).passcodeKeypad,
            wdaUrl: `http://127.0.0.1:${device.wdaLocalPort ?? Number(process.env.WDA_LOCAL_PORT ?? 8100)}`,
            mjpegUrl: `http://127.0.0.1:${device.mjpegLocalPort ?? Number(process.env.MJPEG_LOCAL_PORT ?? 9100)}`,
        });
        return { control, generation, cacheable: true };
    }

    async getScreenInfo(udid: string): Promise<ScreenInfo> { return (await this.control(udid)).getScreenInfo(udid); }
    async getAccessibilityTree(udid: string): Promise<unknown> { return (await this.control(udid)).getAccessibilityTree(udid); }
    async getScreenshot(udid: string): Promise<Buffer> { return (await this.control(udid)).getScreenshot(udid); }
    async getMjpegStream(udid: string, signal?: AbortSignal): Promise<Response> { return (await this.control(udid)).getMjpegStream(udid, signal); }
    async getH264Stream(udid: string, signal?: AbortSignal): Promise<Response> {
        const device = (await loadRegisteredDevices()).find((candidate) => candidate.udid === udid);
        if (!device || (device.platform ?? 'ios') !== 'android') throw new Error('scrcpy H.264 is only available for registered Android devices');
        return new ScrcpyVideoSource().stream(udid, signal);
    }
    async getVideoCapabilities(udid: string): Promise<RemoteVideoCapabilities> {
        const control = await this.control(udid);
        const baseline = control.getVideoCapabilities
            ? await control.getVideoCapabilities(udid)
            : { transports: [] };
        const device = (await loadRegisteredDevices()).find((candidate) => candidate.udid === udid);
        if (!device || (device.platform ?? 'ios') !== 'android') return baseline;
        const scrcpy = new ScrcpyVideoSource();
        if (!await scrcpy.available()) return baseline;
        return {
            transports: [
                ...baseline.transports,
                { id: 'h264', backend: 'scrcpy-raw-h264', contentType: 'video/h264', optimized: true },
            ],
        };
    }
    async getRecentLogs(udid: string, options?: { lines?: number; sinceSeconds?: number }) {
        const device = (await loadRegisteredDevices()).find((candidate) => candidate.udid === udid);
        if (!device) throw new Error(`Device ${udid} is not registered`);
        return collectRecentDeviceLogs(device, options);
    }
    async performAction(udid: string, action: RemoteAction): Promise<void> { return (await this.control(udid)).performAction(udid, action); }
    async isLocked(udid: string): Promise<boolean> { return (await this.control(udid)).isLocked(udid); }
}
