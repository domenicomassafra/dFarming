import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { FarmAgentClient } from './agent/client.js';

export interface StreamBenchmarkResult {
    name: string;
    durationMs: number;
    timeToFirstByteMs: number | null;
    bytes: number;
    controlSamples: number;
    controlErrors: number;
    controlP50Ms: number | null;
    controlP95Ms: number | null;
}

export function percentile(values: readonly number[], fraction: number): number | null {
    if (!values.length) return null;
    const sorted = [...values].sort((a, b) => a - b);
    const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(fraction * sorted.length) - 1));
    return sorted[index]!;
}

async function benchmark(
    name: string,
    streamUrl: URL | null,
    controlUrl: URL,
    headers: Headers,
    durationMs: number,
): Promise<StreamBenchmarkResult> {
    const started = performance.now();
    let timeToFirstByteMs: number | null = null;
    let bytes = 0;
    let streamReader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    const controller = new AbortController();
    if (streamUrl) {
        const response = await fetch(streamUrl, { signal: controller.signal, headers });
        if (!response.ok || !response.body) throw new Error(`${name} stream failed (${response.status})`);
        streamReader = response.body.getReader();
    }

    const latencies: number[] = [];
    let controlErrors = 0;
    const end = Date.now() + durationMs;
    try {
        while (Date.now() < end) {
            if (streamReader) {
                const read = await Promise.race([
                    streamReader.read(),
                    new Promise<{ done: false; value: Uint8Array }>((resolve) => setTimeout(() => resolve({ done: false, value: new Uint8Array() }), 50)),
                ]);
                if (read.value?.length) {
                    if (timeToFirstByteMs === null) timeToFirstByteMs = performance.now() - started;
                    bytes += read.value.length;
                }
            }
            const sampleStart = performance.now();
            try {
                const response = await fetch(controlUrl, { headers, signal: AbortSignal.timeout(10_000) });
                if (!response.ok) throw new Error(String(response.status));
                await response.arrayBuffer();
                latencies.push(performance.now() - sampleStart);
            } catch {
                controlErrors++;
            }
            await new Promise((resolve) => setTimeout(resolve, 250));
        }
    } finally {
        controller.abort();
    }
    return {
        name,
        durationMs: Math.round(performance.now() - started),
        timeToFirstByteMs: timeToFirstByteMs === null ? null : Math.round(timeToFirstByteMs),
        bytes,
        controlSamples: latencies.length,
        controlErrors,
        controlP50Ms: percentile(latencies, 0.5) === null ? null : Math.round(percentile(latencies, 0.5)!),
        controlP95Ms: percentile(latencies, 0.95) === null ? null : Math.round(percentile(latencies, 0.95)!),
    };
}

export async function runVideoBenchmark(): Promise<Record<string, unknown>> {
    const args = process.argv.slice(2);
    const option = (name: string) => {
        const index = args.indexOf(name);
        return index >= 0 ? args[index + 1] : undefined;
    };
    const udid = option('--udid');
    if (!udid) throw new Error('--udid is required');
    const durationMs = Math.max(2_000, Math.min(60_000, Number(option('--duration-ms') ?? 10_000)));
    const client = new FarmAgentClient();
    const headers = new Headers();
    if (client.token) headers.set('authorization', `Bearer ${client.token}`);
    const controlUrl = new URL(`/api/devices/${encodeURIComponent(udid)}/remote/screenshot`, client.baseUrl);
    const baseline = await benchmark('control-baseline-no-stream', null, controlUrl, headers, durationMs);

    const capabilityResponse = await fetch(new URL(`/api/devices/${encodeURIComponent(udid)}/remote/stream-token`, client.baseUrl), {
        method: 'POST', headers,
    });
    if (!capabilityResponse.ok) throw new Error(`Unable to mint WDA stream capability (${capabilityResponse.status})`);
    const capability = await capabilityResponse.json() as { url: string };
    const wda = await benchmark('wda-mjpeg', new URL(capability.url, client.baseUrl), controlUrl, headers, durationMs);

    const qvhUrl = option('--qvh-url') ?? process.env.PHONE_FARM_QVH_URL;
    const qvh = qvhUrl ? await benchmark('qvh-h264', new URL(qvhUrl), controlUrl, headers, durationMs) : null;
    let scrcpy: StreamBenchmarkResult | null = null;
    try {
        const response = await fetch(new URL(`/api/devices/${encodeURIComponent(udid)}/remote/h264-token`, client.baseUrl), {
            method: 'POST', headers,
        });
        if (response.ok) {
            const capability = await response.json() as { url: string };
            scrcpy = await benchmark('scrcpy-raw-h264', new URL(capability.url, client.baseUrl), controlUrl, headers, durationMs);
        }
    } catch { /* optimized video is optional */ }
    return {
        deviceUdid: udid,
        capturedAt: new Date().toISOString(),
        baseline,
        wda,
        qvh,
        scrcpy,
        comparison: {
            wdaP95ControlOverheadMs: baseline.controlP95Ms !== null && wda.controlP95Ms !== null ? wda.controlP95Ms - baseline.controlP95Ms : null,
            qvhP95ControlOverheadMs: qvh && baseline.controlP95Ms !== null && qvh.controlP95Ms !== null ? qvh.controlP95Ms - baseline.controlP95Ms : null,
            scrcpyP95ControlOverheadMs: scrcpy && baseline.controlP95Ms !== null && scrcpy.controlP95Ms !== null ? scrcpy.controlP95Ms - baseline.controlP95Ms : null,
        },
    };
}

async function main(): Promise<void> {
    try { console.log(JSON.stringify(await runVideoBenchmark(), null, 2)); }
    catch (error) { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; }
}

const entrypoint = process.argv[1] ? path.resolve(process.argv[1]) : '';
if (entrypoint && fileURLToPath(import.meta.url) === entrypoint) await main();
