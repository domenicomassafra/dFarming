import { dfarmingEnv } from '../env.js';

export interface DFarmingAgentClientOptions {
    baseUrl?: string;
    token?: string;
    fetchImpl?: typeof fetch;
}

export class DFarmingAgentClient {
    readonly baseUrl: URL;
    readonly token?: string;
    readonly fetch: typeof fetch;

    constructor(options: DFarmingAgentClientOptions = {}) {
        this.baseUrl = new URL(options.baseUrl ?? dfarmingEnv('URL') ?? 'http://127.0.0.1:3000');
        this.token = options.token ?? dfarmingEnv('TOKEN');
        this.fetch = options.fetchImpl ?? fetch;
        if (!isLoopback(this.baseUrl.hostname) && !this.token) {
            throw new Error('DFARMING_TOKEN is required when DFARMING_URL is not loopback');
        }
    }

    health(): Promise<unknown> { return this.request('GET', '/health'); }
    accounts(): Promise<unknown> { return this.request('GET', '/api/accounts'); }

    snapshot(udid: string, options: { query?: string; maxNodes?: number } = {}): Promise<unknown> {
        const query = new URLSearchParams();
        if (options.query) query.set('query', options.query);
        if (options.maxNodes !== undefined) query.set('maxNodes', String(options.maxNodes));
        return this.request('GET', `/api/devices/${encodeURIComponent(udid)}/semantic/snapshot${query.size ? `?${query}` : ''}`);
    }

    tapRef(udid: string, generation: number, ref: string): Promise<unknown> {
        return this.request('POST', `/api/devices/${encodeURIComponent(udid)}/semantic/tap`, { generation, ref });
    }

    typeText(udid: string, text: string): Promise<unknown> {
        return this.request('POST', `/api/devices/${encodeURIComponent(udid)}/semantic/type`, { text });
    }

    waitForText(
        udid: string,
        text: string,
        options: { type?: string; timeoutMs?: number; pollMs?: number } = {},
    ): Promise<unknown> {
        return this.request('POST', `/api/devices/${encodeURIComponent(udid)}/semantic/wait`, { text, ...options });
    }

    private async request(method: 'GET' | 'POST', pathname: string, body?: unknown): Promise<unknown> {
        const url = new URL(pathname, this.baseUrl);
        const headers = new Headers({ accept: 'application/json' });
        if (body !== undefined) headers.set('content-type', 'application/json');
        if (this.token) headers.set('authorization', `Bearer ${this.token}`);
        let response: Response;
        try {
            response = await this.fetch(url, {
                method,
                headers,
                ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
                signal: AbortSignal.timeout(35_000),
            });
        } catch (error) {
            throw new Error(`dFarming is unavailable at ${this.baseUrl.origin}: ${error instanceof Error ? error.message : String(error)}`);
        }
        const text = await response.text();
        let payload: unknown = text;
        if (text) {
            try { payload = JSON.parse(text); } catch { /* preserve text */ }
        }
        if (!response.ok) {
            const detail = payload && typeof payload === 'object' && !Array.isArray(payload)
                && 'error' in payload && typeof (payload as { error?: unknown }).error === 'string'
                ? (payload as { error: string }).error
                : text.slice(0, 500);
            throw new Error(`dFarming ${method} ${url.pathname} returned ${response.status}${detail ? `: ${detail}` : ''}`);
        }
        return payload;
    }
}

/** @deprecated Use DFarmingAgentClientOptions. */
export type FarmAgentClientOptions = DFarmingAgentClientOptions;
/** @deprecated Use DFarmingAgentClient. */
export { DFarmingAgentClient as FarmAgentClient };

function isLoopback(hostname: string): boolean {
    return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1' || hostname === '[::1]';
}
