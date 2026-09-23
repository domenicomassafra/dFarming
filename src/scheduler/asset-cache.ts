import crypto from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { access, mkdir, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';

import { dfarmingEnv } from '../env.js';

export interface MaterializableAsset {
    id: string;
    relativePath: string;
    originalName: string;
    size: number;
    sha256: string;
}

export interface AssetCacheOptions {
    dataRoot?: string;
    controlPlaneUrl?: string;
    internalToken?: string;
    fetchImpl?: typeof fetch;
    timeoutMs?: number;
}

const inFlight = new Map<string, Promise<string>>();

export function resolveAssetPath(root: string, relativePath: string): string {
    const resolvedRoot = path.resolve(root);
    const target = path.resolve(resolvedRoot, relativePath);
    if (!target.startsWith(`${resolvedRoot}${path.sep}`)) {
        throw new Error('Asset path escapes scheduler data root');
    }
    return target;
}

function controlPlaneAssetUrl(base: string | undefined, assetId: string): URL | undefined {
    const trimmed = base?.trim();
    if (!trimmed) return;
    return new URL(
        `api/internal/worker/assets/${encodeURIComponent(assetId)}`,
        trimmed.endsWith('/') ? trimmed : `${trimmed}/`,
    );
}

function internalWorkerHeaders(token: string | undefined): Headers {
    if (!token) throw new Error('DFARMING_INTERNAL_TOKEN is required for distributed worker asset access');
    return new Headers({ authorization: `Bearer ${token}` });
}

async function materialize(
    asset: MaterializableAsset,
    options: AssetCacheOptions,
    root: string,
    target: string,
): Promise<string> {
    const localPath = resolveAssetPath(root, asset.relativePath);
    try {
        await access(localPath);
        return localPath;
    } catch { /* distributed workers may need the canonical control-plane copy */ }

    try {
        await access(target);
        return target;
    } catch { /* fetch the canonical copy below */ }

    const url = controlPlaneAssetUrl(
        options.controlPlaneUrl ?? dfarmingEnv('CONTROL_PLANE_URL'),
        asset.id,
    );
    if (!url) throw new Error(`Asset file is missing on this execution node (${asset.originalName})`);

    const fetchImpl = options.fetchImpl ?? fetch;
    const response = await fetchImpl(url, {
        headers: internalWorkerHeaders(options.internalToken ?? dfarmingEnv('INTERNAL_TOKEN')),
        signal: AbortSignal.timeout(options.timeoutMs ?? 120_000),
    });
    if (!response.ok || !response.body) {
        throw new Error(`Unable to fetch asset ${asset.originalName} from control plane (${response.status})`);
    }

    const cacheDirectory = path.dirname(target);
    await mkdir(cacheDirectory, { recursive: true, mode: 0o700 });
    const temporary = `${target}.${process.pid}.${crypto.randomUUID()}.tmp`;
    const hash = crypto.createHash('sha256');
    let size = 0;
    const verifier = new Transform({
        transform(chunk: Buffer, _encoding, callback) {
            size += chunk.length;
            hash.update(chunk);
            callback(null, chunk);
        },
    });

    try {
        await pipeline(
            Readable.from(response.body as AsyncIterable<Uint8Array>),
            verifier,
            createWriteStream(temporary, { flags: 'wx', mode: 0o600 }),
        );
        const digest = hash.digest('hex');
        if (size !== asset.size || digest !== asset.sha256) {
            throw new Error(`Asset integrity check failed for ${asset.originalName}`);
        }
        try {
            await rename(temporary, target);
        } catch (error) {
            try {
                await access(target);
                await rm(temporary, { force: true });
            } catch {
                throw error;
            }
        }
        return target;
    } catch (error) {
        await rm(temporary, { force: true });
        throw error;
    }
}

export async function materializeAssetFile(
    asset: MaterializableAsset,
    options: AssetCacheOptions = {},
): Promise<string> {
    const root = path.resolve(options.dataRoot ?? process.env.SCHEDULER_DATA_DIR ?? '.scheduler-data');
    const localPath = resolveAssetPath(root, asset.relativePath);
    try {
        await access(localPath);
        return localPath;
    } catch { /* continue to remote cache */ }

    const target = path.join(root, 'remote-cache', asset.id);
    const key = `${target}\n${asset.sha256}\n${asset.size}`;
    let current = inFlight.get(key);
    if (!current) {
        current = materialize(asset, options, root, target);
        inFlight.set(key, current);
        current.finally(() => {
            if (inFlight.get(key) === current) inFlight.delete(key);
        }).catch(() => undefined);
    }
    return current;
}

export async function purgeRemoteAsset(
    assetId: string,
    options: AssetCacheOptions = {},
): Promise<void> {
    const root = path.resolve(options.dataRoot ?? process.env.SCHEDULER_DATA_DIR ?? '.scheduler-data');
    const url = controlPlaneAssetUrl(
        options.controlPlaneUrl ?? dfarmingEnv('CONTROL_PLANE_URL'),
        assetId,
    );
    if (!url) throw new Error('DFARMING_CONTROL_PLANE_URL is required for distributed worker asset cleanup');
    const fetchImpl = options.fetchImpl ?? fetch;
    const response = await fetchImpl(url, {
        method: 'DELETE',
        headers: internalWorkerHeaders(options.internalToken ?? dfarmingEnv('INTERNAL_TOKEN')),
        signal: AbortSignal.timeout(options.timeoutMs ?? 30_000),
    });
    if (!response.ok && response.status !== 404) {
        throw new Error(`Control plane refused asset cleanup for ${assetId} (${response.status})`);
    }
    await rm(resolveAssetPath(root, path.join('remote-cache', assetId)), { force: true });
}
