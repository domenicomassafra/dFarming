import { coordinatesForProfile } from './coordinates.js';
import { loadRegisteredDevices } from './registry.js';
import { WdaRemoteControl, type RemoteAction, type RemoteControl, type ScreenInfo } from './wda-remote.js';
import { passcodeForDevice } from './secrets.js';
import { AppiumRemoteControl } from './appium-remote.js';
import { ScrcpyVideoSource } from './scrcpy-video.js';

export class RegistryWdaRemoteControl implements RemoteControl {
    private readonly controls = new Map<string, WdaRemoteControl | AppiumRemoteControl>();

    /** Forget the cached client so the next call rebuilds it from devices.json (passcode, ports, profile). */
    forget(udid: string): void {
        const current = this.controls.get(udid);
        if (current instanceof AppiumRemoteControl) current.forget();
        this.controls.delete(udid);
    }

    async control(udid: string): Promise<WdaRemoteControl | AppiumRemoteControl> {
        const cached = this.controls.get(udid);
        if (cached) return cached;
        const device = (await loadRegisteredDevices()).find((candidate) => candidate.udid === udid);
        if (!device) return new WdaRemoteControl();
        const backend = device.automationBackend
            ?? ((device.platform ?? 'ios') === 'ios' && (device.kind ?? 'physical') === 'physical' ? 'wda' : 'appium');
        if (backend === 'appium') {
            const control = new AppiumRemoteControl(device);
            this.controls.set(udid, control);
            return control;
        }
        const control = new WdaRemoteControl({
            deviceUdid: udid,
            passcode: device.passcode ?? await passcodeForDevice(udid),
            passcodeKeypadLayout: coordinatesForProfile(device.coordinateProfile).passcodeKeypad,
            wdaUrl: `http://127.0.0.1:${device.wdaLocalPort ?? Number(process.env.WDA_LOCAL_PORT ?? 8100)}`,
            mjpegUrl: `http://127.0.0.1:${device.mjpegLocalPort ?? Number(process.env.MJPEG_LOCAL_PORT ?? 9100)}`,
        });
        this.controls.set(udid, control);
        return control;
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
    async performAction(udid: string, action: RemoteAction): Promise<void> { return (await this.control(udid)).performAction(udid, action); }
    async isLocked(udid: string): Promise<boolean> { return (await this.control(udid)).isLocked(udid); }
}
