const W3C_ELEMENT_KEY = 'element-6066-11e4-a52e-4f735466cecf';

export type Capabilities = Record<string, unknown>;

export interface RemoteOptions {
    hostname: string;
    port: number;
    path?: string;
    logLevel?: string;
    connectionRetryCount?: number;
    connectionRetryTimeout?: number;
    capabilities: Capabilities;
}

interface WebDriverResponse {
    value?: unknown;
    sessionId?: string;
}

interface Locator {
    using: string;
    value: string;
}

export interface AppiumElement {
    readonly elementId?: string;
    click(): Promise<void>;
    isExisting(): Promise<boolean>;
    isDisplayed(): Promise<boolean>;
    getAttribute(name: string): Promise<string | null>;
    getText(): Promise<string>;
    getLocation(): Promise<{ x: number; y: number }>;
    getSize(): Promise<{ width: number; height: number }>;
    clearValue(): Promise<void>;
    setValue(value: string): Promise<void>;
    $$(selector: string): Promise<AppiumElement[]>;
}

export interface Browser {
    readonly sessionId: string;
    pause(ms: number): Promise<void>;
    deleteSession(): Promise<void>;
    activateApp(appId: string): Promise<void>;
    terminateApp(appId: string): Promise<void>;
    setOrientation(orientation: 'PORTRAIT' | 'LANDSCAPE'): Promise<void>;
    queryAppState(appId: string): Promise<number>;
    updateSettings(settings: Record<string, unknown>): Promise<void>;
    setTimeout(timeouts: { implicit?: number; script?: number; pageLoad?: number }): Promise<void>;
    hideKeyboard(): Promise<void>;
    keys(value: string | string[]): Promise<void>;
    execute<T = unknown>(script: string, args?: Record<string, unknown>): Promise<T>;
    performActions(actions: Array<Record<string, unknown>>): Promise<void>;
    releaseActions(): Promise<void>;
    $(selector: string): Promise<AppiumElement>;
    $$(selector: string): Promise<AppiumElement[]>;
    getWindowSize(): Promise<{ width: number; height: number }>;
    getPageSource(): Promise<string>;
    takeScreenshot(): Promise<string>;
    lock(): Promise<void>;
    unlock(): Promise<void>;
    isLocked(): Promise<boolean>;
}

class AppiumProtocolError extends Error {
    constructor(message: string, readonly code?: string, readonly status?: number) {
        super(message);
    }
}

export function isInvalidAppiumSessionError(error: unknown): boolean {
    if (!(error instanceof AppiumProtocolError)) return false;
    if (error.code === 'invalid session id') return true;
    return error.status === 404 && /(?:invalid|unknown|missing).*session|session.*(?:not found|does not exist)/i.test(error.message);
}

export function isRecoverableAppiumReadError(error: unknown): boolean {
    if (isInvalidAppiumSessionError(error)) return true;
    if (error instanceof AppiumProtocolError && error.status !== undefined && error.status >= 500) return true;
    return error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError');
}

function retryableSessionError(error: unknown): boolean {
    if (!(error instanceof AppiumProtocolError)) return true;
    return error.status === 408 || error.status === 429 || (error.status !== undefined && error.status >= 500);
}

function record(value: unknown): Record<string, unknown> | undefined {
    return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function responseValue<T>(body: WebDriverResponse): T {
    return body.value as T;
}

function locatorFor(selector: string): Locator {
    if (selector.startsWith('~')) return { using: 'accessibility id', value: selector.slice(1) };
    const prefixes: Array<[string, string]> = [
        ['-ios class chain:', '-ios class chain'],
        ['-ios predicate string:', '-ios predicate string'],
    ];
    for (const [prefix, using] of prefixes) {
        if (selector.startsWith(prefix)) return { using, value: selector.slice(prefix.length) };
    }
    if (selector.startsWith('//') || selector.startsWith('(//')) return { using: 'xpath', value: selector };
    throw new Error(`Unsupported Appium selector: ${selector}`);
}

function elementId(value: unknown): string | undefined {
    const source = record(value);
    const w3c = source?.[W3C_ELEMENT_KEY];
    if (typeof w3c === 'string') return w3c;
    const legacy = source?.ELEMENT;
    return typeof legacy === 'string' ? legacy : undefined;
}

class ElementClient implements AppiumElement {
    constructor(
        private readonly driver: AppiumDriver,
        readonly elementId?: string,
    ) {}

    private requireId(): string {
        if (!this.elementId) throw new AppiumProtocolError('Appium element does not exist', 'no such element');
        return encodeURIComponent(this.elementId);
    }

    async click(): Promise<void> {
        await this.driver.request('POST', `element/${this.requireId()}/click`, {});
    }

    async isExisting(): Promise<boolean> { return Boolean(this.elementId); }

    async isDisplayed(): Promise<boolean> {
        if (!this.elementId) return false;
        return Boolean(responseValue(await this.driver.request('GET', `element/${this.requireId()}/displayed`)));
    }

    async getAttribute(name: string): Promise<string | null> {
        const value = responseValue<unknown>(await this.driver.request('GET', `element/${this.requireId()}/attribute/${encodeURIComponent(name)}`));
        return value === null || value === undefined ? null : String(value);
    }

    async getText(): Promise<string> {
        const value = responseValue<unknown>(await this.driver.request('GET', `element/${this.requireId()}/text`));
        return value === null || value === undefined ? '' : String(value);
    }

    async getLocation(): Promise<{ x: number; y: number }> {
        const rect = responseValue<Record<string, unknown>>(await this.driver.request('GET', `element/${this.requireId()}/rect`));
        const x = Number(rect?.x);
        const y = Number(rect?.y);
        if (!Number.isFinite(x) || !Number.isFinite(y)) throw new Error('Appium returned an invalid element rect');
        return { x, y };
    }

    async getSize(): Promise<{ width: number; height: number }> {
        const rect = responseValue<Record<string, unknown>>(await this.driver.request('GET', `element/${this.requireId()}/rect`));
        const width = Number(rect?.width);
        const height = Number(rect?.height);
        if (!Number.isFinite(width) || !Number.isFinite(height)) throw new Error('Appium returned an invalid element rect');
        return { width, height };
    }

    async clearValue(): Promise<void> {
        await this.driver.request('POST', `element/${this.requireId()}/clear`, {});
    }

    async setValue(value: string): Promise<void> {
        await this.driver.request('POST', `element/${this.requireId()}/value`, { value: Array.from(value), text: value });
    }

    async $$(selector: string): Promise<AppiumElement[]> {
        return this.driver.findElements(selector, this.elementId);
    }
}

export class AppiumDriver implements Browser {
    private constructor(
        private readonly baseUrl: URL,
        readonly sessionId: string,
        private readonly fetchImpl: typeof fetch,
        private readonly defaultTimeoutMs: number,
    ) {}

    static async create(options: RemoteOptions, fetchImpl: typeof fetch = fetch): Promise<AppiumDriver> {
        if (!Number.isSafeInteger(options.port) || options.port < 1 || options.port > 65_535) {
            throw new Error(`Appium port must be a valid TCP port; received ${options.port}`);
        }
        const prefix = (options.path ?? '/').replace(/^\/+|\/+$/g, '');
        const baseUrl = new URL(`http://${options.hostname}:${options.port}/${prefix ? `${prefix}/` : ''}`);
        const timeoutMs = Math.max(1_000, options.connectionRetryTimeout ?? 120_000);
        const retries = Math.max(0, Math.min(5, Math.trunc(options.connectionRetryCount ?? 0)));
        let body: WebDriverResponse | undefined;
        for (let attempt = 0; attempt <= retries; attempt += 1) {
            try {
                body = await AppiumDriver.requestRaw(fetchImpl, baseUrl, 'POST', 'session', {
                    capabilities: { alwaysMatch: options.capabilities },
                }, timeoutMs);
                break;
            } catch (error) {
                if (attempt >= retries || !retryableSessionError(error)) throw error;
                await new Promise((resolve) => setTimeout(resolve, Math.min(1_000, 200 * (2 ** attempt))));
            }
        }
        if (!body) throw new Error('Appium session creation failed without an error');
        const value = record(body.value);
        const sessionId = typeof value?.sessionId === 'string' ? value.sessionId : body.sessionId;
        if (!sessionId) throw new Error('Appium created a session without returning a session id');
        return new AppiumDriver(baseUrl, sessionId, fetchImpl, timeoutMs);
    }

    private static async requestRaw(
        fetchImpl: typeof fetch,
        baseUrl: URL,
        method: string,
        pathname: string,
        body?: unknown,
        timeoutMs = 30_000,
    ): Promise<WebDriverResponse> {
        const response = await fetchImpl(new URL(pathname, baseUrl), {
            method,
            ...(body === undefined ? {} : {
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify(body),
            }),
            signal: AbortSignal.timeout(timeoutMs),
        });
        const text = await response.text();
        let parsed: WebDriverResponse = {};
        if (text) {
            try { parsed = JSON.parse(text) as WebDriverResponse; }
            catch {
                if (!response.ok) throw new AppiumProtocolError(`Appium returned HTTP ${response.status}: ${text.slice(0, 500)}`, undefined, response.status);
                throw new AppiumProtocolError(`Appium returned invalid JSON for ${method} /${pathname}`, undefined, response.status);
            }
        }
        if (!response.ok) {
            const value = record(parsed.value);
            const message = typeof value?.message === 'string' ? value.message : text.slice(0, 500);
            const code = typeof value?.error === 'string' ? value.error : undefined;
            throw new AppiumProtocolError(
                `Appium ${method} /${pathname} failed with HTTP ${response.status}${message ? `: ${message}` : ''}`,
                code,
                response.status,
            );
        }
        return parsed;
    }

    request(method: string, pathname: string, body?: unknown, timeoutMs = 30_000): Promise<WebDriverResponse> {
        return AppiumDriver.requestRaw(
            this.fetchImpl,
            this.baseUrl,
            method,
            `session/${encodeURIComponent(this.sessionId)}/${pathname}`,
            body,
            Math.min(Math.max(timeoutMs, 1_000), this.defaultTimeoutMs),
        );
    }

    async pause(ms: number): Promise<void> {
        await new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));
    }

    async deleteSession(): Promise<void> {
        await AppiumDriver.requestRaw(
            this.fetchImpl,
            this.baseUrl,
            'DELETE',
            `session/${encodeURIComponent(this.sessionId)}`,
            undefined,
            10_000,
        );
    }

    async activateApp(appId: string): Promise<void> {
        await this.request('POST', 'appium/device/activate_app', { appId, bundleId: appId });
    }

    async terminateApp(appId: string): Promise<void> {
        await this.request('POST', 'appium/device/terminate_app', { appId, bundleId: appId });
    }

    async setOrientation(orientation: 'PORTRAIT' | 'LANDSCAPE'): Promise<void> {
        await this.request('POST', 'orientation', { orientation });
    }

    async queryAppState(appId: string): Promise<number> {
        const value = Number(responseValue<unknown>(await this.request('POST', 'appium/device/app_state', { appId, bundleId: appId })));
        if (!Number.isFinite(value)) throw new Error('Appium returned an invalid application state');
        return value;
    }

    async updateSettings(settings: Record<string, unknown>): Promise<void> {
        await this.request('POST', 'appium/settings', { settings });
    }

    async setTimeout(timeouts: { implicit?: number; script?: number; pageLoad?: number }): Promise<void> {
        await this.request('POST', 'timeouts', timeouts);
    }

    async hideKeyboard(): Promise<void> {
        await this.request('POST', 'appium/device/hide_keyboard', {});
    }

    async keys(value: string | string[]): Promise<void> {
        const values = Array.isArray(value) ? value : Array.from(value);
        await this.request('POST', 'keys', { value: values });
    }

    async execute<T = unknown>(script: string, args?: Record<string, unknown>): Promise<T> {
        return responseValue<T>(await this.request('POST', 'execute/sync', { script, args: args === undefined ? [] : [args] }));
    }

    async performActions(actions: Array<Record<string, unknown>>): Promise<void> {
        await this.request('POST', 'actions', { actions });
    }

    async releaseActions(): Promise<void> {
        await this.request('DELETE', 'actions');
    }

    async findElements(selector: string, parentElementId?: string): Promise<AppiumElement[]> {
        const locator = locatorFor(selector);
        const pathname = parentElementId
            ? `element/${encodeURIComponent(parentElementId)}/elements`
            : 'elements';
        const values = responseValue<unknown>(await this.request('POST', pathname, locator));
        if (!Array.isArray(values)) return [];
        return values.flatMap((value) => {
            const id = elementId(value);
            return id ? [new ElementClient(this, id)] : [];
        });
    }

    async $(selector: string): Promise<AppiumElement> {
        const locator = locatorFor(selector);
        try {
            const value = responseValue<unknown>(await this.request('POST', 'element', locator));
            return new ElementClient(this, elementId(value));
        } catch (error) {
            if (error instanceof AppiumProtocolError && error.code === 'no such element') return new ElementClient(this);
            throw error;
        }
    }

    async $$(selector: string): Promise<AppiumElement[]> {
        return this.findElements(selector);
    }

    async getWindowSize(): Promise<{ width: number; height: number }> {
        const rect = responseValue<Record<string, unknown>>(await this.request('GET', 'window/rect'));
        const width = Number(rect?.width);
        const height = Number(rect?.height);
        if (!Number.isFinite(width) || !Number.isFinite(height)) throw new Error('Appium returned an invalid window rect');
        return { width, height };
    }

    async getPageSource(): Promise<string> {
        const source = responseValue<unknown>(await this.request('GET', 'source', undefined, 50_000));
        if (typeof source !== 'string') throw new Error('Appium returned an invalid page source');
        return source;
    }

    async takeScreenshot(): Promise<string> {
        const screenshot = responseValue<unknown>(await this.request('GET', 'screenshot', undefined, 30_000));
        if (typeof screenshot !== 'string') throw new Error('Appium returned an invalid screenshot');
        return screenshot;
    }

    async lock(): Promise<void> {
        await this.request('POST', 'appium/device/lock', {});
    }

    async unlock(): Promise<void> {
        await this.request('POST', 'appium/device/unlock', {});
    }

    async isLocked(): Promise<boolean> {
        return Boolean(responseValue<unknown>(await this.request('POST', 'appium/device/is_locked', {})));
    }
}

export function remote(options: RemoteOptions): Promise<Browser> {
    return AppiumDriver.create(options);
}

export function remoteWithFetch(options: RemoteOptions, fetchImpl: typeof fetch): Promise<Browser> {
    return AppiumDriver.create(options, fetchImpl);
}
