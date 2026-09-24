import crypto from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, open, rm } from 'node:fs/promises';
import path from 'node:path';

import type { FastifyInstance, FastifyRequest } from 'fastify';

import { loadRegisteredDevices, redactDevice } from '../devices/registry.js';
import type { SchedulerRepository } from '../scheduler/repository.js';
import { internalWorkerAuthorized } from './http-security.js';

export interface MultipartAssetLimits {
    files?: number;
    fileSize?: number;
    allowedMimeTypes?: readonly string[];
}

const DEFAULT_ASSET_LIMITS: Required<MultipartAssetLimits> = {
    files: 20,
    fileSize: 2 * 1024 * 1024 * 1024,
    allowedMimeTypes: [],
};

export async function ingestMultipartAssets(
    request: FastifyRequest,
    scheduler: SchedulerRepository,
    options: MultipartAssetLimits & { source?: string } = {},
) {
    const limits = { ...DEFAULT_ASSET_LIMITS, ...options };
    const dataRoot = path.resolve(process.env.SCHEDULER_DATA_DIR ?? '.scheduler-data');
    const uploadDirectory = path.join(dataRoot, 'uploads');
    await mkdir(uploadDirectory, { recursive: true });
    const created: Array<{
        relativePath: string;
        originalName: string;
        mimeType: string;
        size: number;
        sha256: string;
    }> = [];
    try {
        for await (const part of request.files()) {
            if (created.length >= limits.files) throw new Error(`At most ${limits.files} asset files are allowed`);
            if (limits.allowedMimeTypes.length && !limits.allowedMimeTypes.includes(part.mimetype)) {
                throw new Error(`Asset type ${part.mimetype || 'unknown'} is not allowed`);
            }
            const id = crypto.randomUUID();
            const relativePath = path.join('uploads', id);
            const filePath = path.join(dataRoot, relativePath);
            const handle = await open(filePath, 'wx', 0o600);
            const hash = crypto.createHash('sha256');
            let size = 0;
            try {
                for await (const chunk of part.file) {
                    const buffer = Buffer.from(chunk);
                    size += buffer.length;
                    if (size > limits.fileSize) throw new Error(`Asset file exceeds ${limits.fileSize} bytes`);
                    hash.update(buffer);
                    await handle.write(buffer);
                }
            } catch (error) {
                await rm(filePath, { force: true }).catch(() => undefined);
                throw error;
            } finally {
                await handle.close().catch(() => undefined);
            }
            created.push({
                relativePath,
                originalName: part.filename,
                mimeType: part.mimetype,
                size,
                sha256: hash.digest('hex'),
            });
        }
        return await scheduler.registerAssets(created.map((file) => ({ ...file, source: options.source })));
    } catch (error) {
        for (const file of created) await rm(path.join(dataRoot, file.relativePath), { force: true }).catch(() => undefined);
        throw error;
    }
}

export function registerAssetRoutes(app: FastifyInstance, scheduler: SchedulerRepository): void {
    app.post('/api/assets', async (request, reply) => {
        return reply.code(201).send(await ingestMultipartAssets(request, scheduler));
    });

    app.delete<{ Body: { assetIds: string[] } }>('/api/assets', async (request, reply) => {
        await scheduler.deleteAssets(request.body.assetIds ?? []);
        return reply.code(204).send();
    });

    app.get<{ Params: { udid: string } }>('/api/internal/worker/devices/:udid', async (request, reply) => {
        if (!internalWorkerAuthorized(request)) {
            return reply.code(401).send({ error: 'Internal worker token required' });
        }
        const device = (await loadRegisteredDevices()).find(({ udid }) => udid === request.params.udid);
        return device ? redactDevice(device) : reply.code(404).send({ error: 'Device not found' });
    });

    app.get<{ Params: { id: string } }>('/api/internal/worker/assets/:id', async (request, reply) => {
        if (!internalWorkerAuthorized(request)) {
            return reply.code(401).send({ error: 'Internal worker token required' });
        }
        const asset = await scheduler.assetFile(request.params.id);
        if (!asset) return reply.code(404).send({ error: 'Asset not found' });
        reply.header('content-length', String(asset.size));
        reply.header('x-content-sha256', asset.sha256);
        reply.header('cache-control', 'private, no-store');
        return reply.type(asset.mimeType).send(createReadStream(asset.path));
    });

    app.delete<{ Params: { id: string } }>('/api/internal/worker/assets/:id', async (request, reply) => {
        if (!internalWorkerAuthorized(request)) {
            return reply.code(401).send({ error: 'Internal worker token required' });
        }
        await scheduler.deleteAssets([request.params.id]);
        return reply.code(204).send();
    });
}
