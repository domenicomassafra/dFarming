import { execFile, spawn } from 'node:child_process';
import { access } from 'node:fs/promises';
import net from 'node:net';
import { Readable } from 'node:stream';
import { promisify } from 'node:util';

import { dfarmingEnv } from '../env.js';

const execFileAsync = promisify(execFile);
const VERSION = /^\d+\.\d+(?:\.\d+)?$/;
const SERIAL = /^[A-Za-z0-9._:-]{1,128}$/;
const pushed = new Set<string>();

export interface ScrcpyVideoConfiguration {
    serverJar: string;
    version: string;
    maxSize: number;
}

export function scrcpyVideoConfiguration(env: NodeJS.ProcessEnv = process.env): ScrcpyVideoConfiguration | null {
    const serverJar = dfarmingEnv('SCRCPY_SERVER_JAR', env)?.trim();
    const version = dfarmingEnv('SCRCPY_VERSION', env)?.trim();
    if (!serverJar || !version) return null;
    if (!VERSION.test(version)) throw new Error('DFARMING_SCRCPY_VERSION must look like 4.0 or 4.0.1');
    const configured = Number(dfarmingEnv('SCRCPY_MAX_SIZE', env) ?? 1920);
    const maxSize = Number.isFinite(configured) ? Math.max(320, Math.min(4096, Math.round(configured))) : 1920;
    return { serverJar, version, maxSize };
}

async function waitForSocket(port: number, signal?: AbortSignal): Promise<net.Socket> {
    const deadline = Date.now() + 8_000;
    let lastError: unknown;
    while (Date.now() < deadline && !signal?.aborted) {
        try {
            return await new Promise<net.Socket>((resolve, reject) => {
                const socket = net.connect({ host: '127.0.0.1', port });
                const timer = setTimeout(() => {
                    socket.destroy();
                    reject(new Error('scrcpy socket connect timeout'));
                }, 700);
                socket.once('connect', () => { clearTimeout(timer); resolve(socket); });
                socket.once('error', (error) => { clearTimeout(timer); reject(error); });
            });
        } catch (error) {
            lastError = error;
            await new Promise((resolve) => setTimeout(resolve, 150));
        }
    }
    if (signal?.aborted) throw signal.reason ?? new Error('scrcpy stream aborted');
    throw new Error(`scrcpy H.264 socket did not become ready: ${lastError instanceof Error ? lastError.message : String(lastError ?? 'unknown error')}`);
}

export class ScrcpyVideoSource {
    constructor(readonly configuration = scrcpyVideoConfiguration()) {}

    async available(): Promise<boolean> {
        if (!this.configuration) return false;
        try { await access(this.configuration.serverJar); return true; } catch { return false; }
    }

    async stream(udid: string, signal?: AbortSignal): Promise<Response> {
        if (!SERIAL.test(udid)) throw new Error('Android device serial is invalid');
        const config = this.configuration;
        if (!config) throw new Error('scrcpy H.264 is not configured on this worker');
        await access(config.serverJar);

        const remoteJar = '/data/local/tmp/dfarming-scrcpy-server.jar';
        const cacheKey = `${udid}\0${config.serverJar}`;
        if (!pushed.has(cacheKey)) {
            await execFileAsync('adb', ['-s', udid, 'push', config.serverJar, remoteJar], { timeout: 30_000, maxBuffer: 1024 * 1024 });
            pushed.add(cacheKey);
        }
        const { stdout } = await execFileAsync('adb', ['-s', udid, 'forward', 'tcp:0', 'localabstract:scrcpy'], { timeout: 5_000 });
        const port = Number(stdout.trim());
        if (!Number.isInteger(port) || port < 1 || port > 65_535) throw new Error(`adb did not allocate a scrcpy forward port: ${stdout.trim()}`);

        const command = [
            `CLASSPATH=${remoteJar}`,
            'app_process / com.genymobile.scrcpy.Server',
            config.version,
            'tunnel_forward=true',
            'audio=false',
            'control=false',
            'cleanup=true',
            'raw_stream=true',
            `max_size=${config.maxSize}`,
        ].join(' ');
        const server = spawn('adb', ['-s', udid, 'shell', command], { stdio: ['ignore', 'ignore', 'pipe'] });
        let stderr = '';
        server.stderr?.on('data', (chunk: Buffer | string) => { stderr = `${stderr}${chunk}`.slice(-2_000); });

        const cleanup = async () => {
            if (server.exitCode === null && !server.killed) server.kill('SIGTERM');
            await execFileAsync('adb', ['-s', udid, 'forward', '--remove', `tcp:${port}`], { timeout: 3_000 }).catch(() => undefined);
        };
        signal?.addEventListener('abort', () => void cleanup(), { once: true });
        server.once('exit', () => {
            if (stderr.trim()) console.warn(`scrcpy server ${udid}: ${stderr.trim()}`);
        });

        try {
            const socket = await waitForSocket(port, signal);
            socket.once('close', () => void cleanup());
            signal?.addEventListener('abort', () => socket.destroy(), { once: true });
            return new Response(Readable.toWeb(socket) as ReadableStream<Uint8Array>, {
                headers: {
                    'content-type': 'video/h264',
                    'cache-control': 'no-store, no-cache, must-revalidate',
                    'x-dfarming-video-backend': 'scrcpy-raw-h264',
                },
            });
        } catch (error) {
            await cleanup();
            throw error;
        }
    }
}
