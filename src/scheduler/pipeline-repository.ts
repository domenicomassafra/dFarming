import { and, desc, eq, inArray, sql } from 'drizzle-orm';

import type { DatabaseConnection } from '../database/client.js';
import { assets, pipelineItems, type PipelineItemRow } from '../database/schema.js';
import type { PipelineClaim } from '../types.js';
import { materializeAssetFile } from './asset-cache.js';

export class PipelineRepository {
    constructor(
        private readonly connection: DatabaseConnection,
        private readonly purgeAssets: (assetIds: string[]) => Promise<void>,
    ) {}

    async enqueue(input: {
        deviceUdid: string;
        assetId: string;
        caption?: string;
    }): Promise<PipelineItemRow> {
        const [row] = await this.connection.db.insert(pipelineItems).values({
            deviceUdid: input.deviceUdid,
            assetId: input.assetId,
            caption: input.caption?.trim() || null,
            status: 'ready',
        }).returning();
        if (!row) throw new Error('Unable to enqueue pipeline item');
        return row;
    }

    async list(
        deviceUdid: string,
        limit = 50,
    ): Promise<Array<PipelineItemRow & { assetName: string | null; mimeType: string | null }>> {
        const rows = await this.connection.db.select({
            item: pipelineItems,
            assetName: assets.originalName,
            mimeType: assets.mimeType,
        }).from(pipelineItems)
            .leftJoin(assets, eq(pipelineItems.assetId, assets.id))
            .where(eq(pipelineItems.deviceUdid, deviceUdid))
            .orderBy(desc(pipelineItems.createdAt))
            .limit(limit);
        return rows.map(({ item, assetName, mimeType }) => ({ ...item, assetName, mimeType }));
    }

    async cancel(id: string, deviceUdid: string): Promise<PipelineItemRow | null> {
        const [row] = await this.connection.db.select().from(pipelineItems).where(and(
            eq(pipelineItems.id, id),
            eq(pipelineItems.deviceUdid, deviceUdid),
            inArray(pipelineItems.status, ['ready', 'failed']),
        )).limit(1);
        if (!row) return null;
        const assetId = row.assetId;
        await this.connection.db.delete(pipelineItems).where(eq(pipelineItems.id, id));
        if (assetId) await this.purgeAssets([assetId]);
        return { ...row, status: 'cancelled', updatedAt: new Date() };
    }

    async claimNext(deviceUdid: string, executionId: string): Promise<PipelineClaim | null> {
        const claimed = await this.connection.db.transaction(async (tx) => {
            const result = await tx.execute(sql`
                update scheduler.pipeline_items
                set status = 'publishing', execution_id = ${executionId}::uuid, updated_at = now(), error = null
                where id = (
                    select id from scheduler.pipeline_items
                    where device_udid = ${deviceUdid} and status = 'ready' and asset_id is not null
                    order by created_at asc
                    for update skip locked
                    limit 1
                )
                returning id, caption, asset_id
            `);
            const row = (result.rows as Array<{
                id: string;
                caption: string | null;
                asset_id: string | null;
            }>)[0];
            if (!row?.asset_id) return null;
            await tx.update(assets).set({ executionId }).where(eq(assets.id, row.asset_id));
            return row as { id: string; caption: string | null; asset_id: string };
        });
        if (!claimed) return null;

        const [assetRow] = await this.connection.db.select()
            .from(assets)
            .where(eq(assets.id, claimed.asset_id))
            .limit(1);
        if (!assetRow) {
            await this.fail(claimed.id, `Pipeline media asset ${claimed.asset_id} is missing`);
            return null;
        }
        try {
            const filePath = await materializeAssetFile(assetRow);
            return {
                id: claimed.id,
                caption: claimed.caption,
                asset: {
                    id: assetRow.id,
                    path: filePath,
                    name: assetRow.originalName,
                    mimeType: assetRow.mimeType,
                    size: assetRow.size,
                    sha256: assetRow.sha256,
                },
            };
        } catch {
            await this.fail(
                claimed.id,
                `Pipeline media file is missing on disk (${assetRow.originalName})`,
            );
            return null;
        }
    }

    async complete(id: string): Promise<void> {
        await this.connection.db.update(pipelineItems).set({
            status: 'published',
            publishedAt: new Date(),
            updatedAt: new Date(),
            error: null,
            assetId: null,
        }).where(eq(pipelineItems.id, id));
    }

    async fail(id: string, error: string): Promise<void> {
        await this.connection.db.update(pipelineItems).set({
            status: 'failed',
            error,
            updatedAt: new Date(),
        }).where(eq(pipelineItems.id, id));
    }
}
