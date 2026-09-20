import type { RegisteredDevice } from './registry.js';
import type { RemoteAction, RemoteControl, ScreenInfo } from './wda-remote.js';
import { normalizeAppiumPageSource } from '../semantic/appium-source.js';
import { remoteWithFetch, type Browser } from './appium-driver.js';

function driverBackend(device: RegisteredDevice): { platformName: 'iOS' | 'Android'; automationName: 'XCUITest' | 'UiAutomator2' } {
    if ((device.platform ?? 'ios') === 'android') return { platformName: 'Android', automationName: 'UiAutomator2' };
    return { platformName: 'iOS', automationName: 'XCUITest' };
}

export class AppiumRemoteControl implements RemoteControl {
    private driverPromise?: Promise<Browser>;
    readonly passcode: string | undefined = undefined;

    constructor(
        readonly device: RegisteredDevice,
        readonly appiumHost = process.env.APPIUM_RUNTIME_HOST ?? '127.0.0.1',
        readonly appiumPort = Number(process.env.APPIUM_RUNTIME_PORT ?? 4726),
        private readonly fetchImpl: typeof fetch = fetch,
    ) {}

    private assertTarget(udid: string): void {
        if (udid !== this.device.udid) throw new Error('Appium remote control is not configured for this device');
    }

    private async driver(): Promise<Browser> {
        const selected = driverBackend(this.device);
        this.driverPromise ??= remoteWithFetch({
            hostname: this.appiumHost,
            port: this.appiumPort,
            path: '/',
            connectionRetryCount: 2,
            connectionRetryTimeout: 120_000,
            capabilities: {
                platformName: selected.platformName,
                'appium:automationName': selected.automationName,
                'appium:udid': this.device.udid,
                'appium:noReset': true,
                'appium:newCommandTimeout': 300,
            },
        }, this.fetchImpl)
            .catch((error) => {
                this.driverPromise = undefined;
                throw error;
            });
        return this.driverPromise;
    }

    forget(): void {
        const current = this.driverPromise;
        this.driverPromise = undefined;
        if (current) void current.then((driver) => driver.deleteSession()).catch(() => undefined);
    }

    async activateApp(appId: string): Promise<void> {
        await (await this.driver()).activateApp(appId);
    }

    async terminateApp(appId: string): Promise<void> {
        await (await this.driver()).terminateApp(appId);
    }

    async getScreenInfo(udid: string): Promise<ScreenInfo> {
        this.assertTarget(udid);
        const size = await (await this.driver()).getWindowSize();
        return { screenSize: { width: size.width, height: size.height }, scale: 1 };
    }

    async getAccessibilityTree(udid: string): Promise<unknown> {
        this.assertTarget(udid);
        return normalizeAppiumPageSource(await (await this.driver()).getPageSource());
    }

    async getScreenshot(udid: string): Promise<Buffer> {
        this.assertTarget(udid);
        return Buffer.from(await (await this.driver()).takeScreenshot(), 'base64');
    }

    async getMjpegStream(udid: string, signal?: AbortSignal): Promise<Response> {
        this.assertTarget(udid);
        const boundary = 'MobileFarmFrame';
        const encoder = new TextEncoder();
        let cancelled = false;
        const stream = new ReadableStream<Uint8Array>({
            start: (controller) => {
                const loop = async () => {
                    while (!cancelled && !signal?.aborted) {
                        try {
                            const frame = await this.getScreenshot(udid);
                            controller.enqueue(encoder.encode(`--${boundary}\r\nContent-Type: image/png\r\nContent-Length: ${frame.length}\r\n\r\n`));
                            controller.enqueue(frame);
                            controller.enqueue(encoder.encode('\r\n'));
                        } catch (error) {
                            controller.error(error);
                            return;
                        }
                        await new Promise((resolve) => setTimeout(resolve, 750));
                    }
                    try { controller.close(); } catch { /* already closed */ }
                };
                void loop();
            },
            cancel: () => { cancelled = true; },
        });
        signal?.addEventListener('abort', () => { cancelled = true; }, { once: true });
        return new Response(stream, { headers: { 'content-type': `multipart/x-mixed-replace; boundary=${boundary}` } });
    }

    async performAction(udid: string, action: RemoteAction): Promise<void> {
        this.assertTarget(udid);
        const driver = await this.driver();
        const platform = this.device.platform ?? 'ios';
        if (action.type === 'tap' || action.type === 'swipe') {
            const actions = action.type === 'tap'
                ? [
                    { type: 'pointerMove', duration: 0, x: action.x, y: action.y, origin: 'viewport' },
                    { type: 'pointerDown', button: 0 }, { type: 'pause', duration: 80 }, { type: 'pointerUp', button: 0 },
                ]
                : [
                    { type: 'pointerMove', duration: 0, x: action.startX, y: action.startY, origin: 'viewport' },
                    { type: 'pointerDown', button: 0 }, { type: 'pause', duration: 80 },
                    { type: 'pointerMove', duration: action.durationMs, x: action.endX, y: action.endY, origin: 'viewport' },
                    { type: 'pointerUp', button: 0 },
                ];
            await driver.performActions([{ type: 'pointer', id: 'finger1', parameters: { pointerType: 'touch' }, actions }]);
            await driver.releaseActions();
            return;
        }
        if (action.type === 'type') {
            if (!action.text || action.text.length > 4_000) throw new Error('Text input must contain 1 to 4000 characters');
            await driver.keys(action.text);
            return;
        }
        if (action.type === 'lock') {
            await driver.lock();
            return;
        }
        if (action.type === 'unlock' || action.type === 'wake') {
            await driver.unlock();
            return;
        }
        if (platform === 'android') {
            const keycode = action.type === 'home' ? 3 : action.type === 'volumeUp' ? 24 : 25;
            await driver.execute('mobile: pressKey', { keycode });
            return;
        }
        const name = action.type === 'home' ? 'home' : action.type === 'volumeUp' ? 'volumeUp' : 'volumeDown';
        await driver.execute('mobile: pressButton', { name });
    }

    async isLocked(udid: string): Promise<boolean> {
        this.assertTarget(udid);
        return (await this.driver()).isLocked();
    }
}
