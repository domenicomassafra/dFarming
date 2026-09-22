import { and, desc, eq, inArray, isNull, lt, or, sql } from 'drizzle-orm';
import { fromDrizzle, type PgBoss } from 'pg-boss';
import { access, rm } from 'node:fs/promises';
import path from 'node:path';

import type { DatabaseConnection } from '../database/client.js';
import {
    assets, campaigns, devicePools, executionAttempts, executionLogs, executions, flowDefinitions, flowVersions, pipelineItems, schedules,
    type CampaignRow, type DevicePoolRow, type ExecutionRow, type FlowDefinitionRow, type FlowVersionRow, type PipelineItemRow, type ScheduleRow,
} from '../database/schema.js';
import type { PluginRegistry } from '../registry.js';
import type { CreateTaskInput, JsonObject, PipelineClaim, ScheduleTiming, StoredAsset, TaskEnvelope } from '../types.js';
import type { PlannedCampaign } from '../campaigns.js';
import { ensureDeviceQueue, queueNameForDevice } from './queue.js';
import { initialRunAt, latestDueOccurrence } from './recurrence.js';
import { DEFAULT_MIN_SCHEDULE_GAP_MINUTES, estimatedTaskWindow, validateTaskInput, windowsTooClose } from './validation.js';
import { materializeAssetFile, purgeRemoteAsset } from './asset-cache.js';
import { PipelineRepository } from './pipeline-repository.js';

export interface ExecutionPolicySnapshot {
    executionProfileId?: string;
    networkRouteId?: string;
}
export type ExecutionPolicyResolver = (input: CreateTaskInput) => Promise<ExecutionPolicySnapshot> | ExecutionPolicySnapshot;
export interface CreateTaskMetadata {
    externalSource?: string;
    externalId?: string;
    externalRequestHash?: string;
}

export interface ExecutionDetail extends ExecutionRow { logs: string[] }
export interface FlowDefinitionDetail extends FlowDefinitionRow {
    payload: JsonObject;
    versions: Array<Pick<FlowVersionRow, 'version' | 'createdAt'>>;
}

/** Thrown by setScheduleStatus for a disallowed status change (e.g. resuming a completed schedule). */
export class ScheduleTransitionError extends Error {}

/**
 * Schedule status state machine. A completed or cancelled schedule can only be
 * cancelled — never resumed, which would recompute nextRunAt and re-fire a
 * one-shot (a duplicate public post).
 */
export function scheduleTransitionAllowed(from: string, to: 'active' | 'paused' | 'cancelled'): boolean {
    if (from === to) return true;
    const allowed: Record<string, Array<typeof to>> = {
        active: ['paused', 'cancelled'],
        paused: ['active', 'cancelled'],
        completed: ['cancelled'],
        cancelled: [],
    };
    return (allowed[from] ?? []).includes(to);
}

export function manualRetryIdentity(
    source: Pick<ExecutionRow, 'executionProfileId' | 'networkRouteId' | 'scheduledFor' | 'deadlineAt'>,
    now: Date,
): Pick<ExecutionRow, 'executionProfileId' | 'networkRouteId' | 'scheduledFor' | 'deadlineAt'> {
    const windowMs = source.deadlineAt.getTime() - source.scheduledFor.getTime();
    if (!Number.isSafeInteger(windowMs) || windowMs < 60_000 || windowMs > 1_440 * 60_000) {
        throw new Error('Cannot retry execution with an invalid run window');
    }
    return {
        executionProfileId: source.executionProfileId,
        networkRouteId: source.networkRouteId,
        scheduledFor: now,
        deadlineAt: new Date(now.getTime() + windowMs),
    };
}

function taskEnvelope(row: Pick<ScheduleRow, 'pluginId' | 'taskType' | 'taskVersion' | 'payload'>): TaskEnvelope {
    return { pluginId: row.pluginId, taskType: row.taskType, taskVersion: row.taskVersion, payload: row.payload };
}

export class SchedulerRepository {
    private readonly pipeline: PipelineRepository;
    private executionPolicyResolver?: ExecutionPolicyResolver;

    constructor(
        readonly connection: DatabaseConnection,
        readonly boss: PgBoss,
        readonly plugins: PluginRegistry,
    ) {
        this.pipeline = new PipelineRepository(connection, (assetIds) => this.purgeAssetIds(assetIds));
    }

    setExecutionPolicyResolver(resolver: ExecutionPolicyResolver | undefined): void {
        this.executionPolicyResolver = resolver;
    }

    private async executionPolicy(input: CreateTaskInput): Promise<ExecutionPolicySnapshot> {
        return this.executionPolicyResolver ? await this.executionPolicyResolver(input) : {};
    }

    async listDevicePools(limit = 100): Promise<DevicePoolRow[]> {
        return this.connection.db.select().from(devicePools)
            .orderBy(desc(devicePools.updatedAt))
            .limit(Math.max(1, Math.min(500, limit)));
    }

    async devicePool(id: string): Promise<DevicePoolRow | null> {
        const [row] = await this.connection.db.select().from(devicePools).where(eq(devicePools.id, id)).limit(1);
        return row ?? null;
    }

    async createDevicePool(name: string, selector: JsonObject, now = new Date()): Promise<DevicePoolRow> {
        const [row] = await this.connection.db.insert(devicePools).values({ name, selector, createdAt: now, updatedAt: now }).returning();
        if (!row) throw new Error('Unable to create device pool');
        return row;
    }

    async updateDevicePool(id: string, name: string, selector: JsonObject, now = new Date()): Promise<DevicePoolRow | null> {
        const [row] = await this.connection.db.update(devicePools).set({ name, selector, updatedAt: now })
            .where(eq(devicePools.id, id)).returning();
        return row ?? null;
    }

    async deleteDevicePool(id: string): Promise<boolean> {
        const removed = await this.connection.db.delete(devicePools).where(eq(devicePools.id, id)).returning({ id: devicePools.id });
        return removed.length > 0;
    }

    async listFlowDefinitions(limit = 100): Promise<Array<FlowDefinitionRow & { payload: JsonObject }>> {
        const rows = await this.connection.db.select({
            definition: flowDefinitions,
            payload: flowVersions.payload,
        }).from(flowDefinitions)
            .innerJoin(flowVersions, and(
                eq(flowVersions.flowId, flowDefinitions.id),
                eq(flowVersions.version, flowDefinitions.currentVersion),
            ))
            .orderBy(desc(flowDefinitions.updatedAt))
            .limit(Math.max(1, Math.min(500, limit)));
        return rows.map(({ definition, payload }) => ({ ...definition, payload }));
    }

    async flowDefinition(id: string, version?: number): Promise<FlowDefinitionDetail | null> {
        const [definition] = await this.connection.db.select().from(flowDefinitions).where(eq(flowDefinitions.id, id)).limit(1);
        if (!definition) return null;
        const selectedVersion = version ?? definition.currentVersion;
        const [selected] = await this.connection.db.select().from(flowVersions).where(and(
            eq(flowVersions.flowId, id), eq(flowVersions.version, selectedVersion),
        )).limit(1);
        if (!selected) return null;
        const versions = await this.connection.db.select({
            version: flowVersions.version, createdAt: flowVersions.createdAt,
        }).from(flowVersions).where(eq(flowVersions.flowId, id)).orderBy(desc(flowVersions.version));
        return { ...definition, currentVersion: selectedVersion, payload: selected.payload, versions };
    }

    async createFlowDefinition(payload: JsonObject, now = new Date()): Promise<FlowDefinitionDetail> {
        const name = typeof payload.name === 'string' ? payload.name.trim() : '';
        if (!name) throw new Error('Flow name is required');
        let id = '';
        await this.connection.db.transaction(async (tx) => {
            const [definition] = await tx.insert(flowDefinitions).values({ name, createdAt: now, updatedAt: now }).returning();
            if (!definition) throw new Error('Unable to create flow definition');
            id = definition.id;
            await tx.insert(flowVersions).values({ flowId: id, version: 1, payload, createdAt: now });
        });
        return (await this.flowDefinition(id))!;
    }

    async saveFlowVersion(id: string, payload: JsonObject, now = new Date()): Promise<FlowDefinitionDetail | null> {
        const name = typeof payload.name === 'string' ? payload.name.trim() : '';
        if (!name) throw new Error('Flow name is required');
        let nextVersion: number | undefined;
        await this.connection.db.transaction(async (tx) => {
            const [locked] = await tx.execute(sql`
                select id, current_version from scheduler.flow_definitions where id = ${id}::uuid for update
            `).then((result) => result.rows as unknown as Array<{ id: string; current_version: number }>);
            if (!locked) return;
            nextVersion = locked.current_version + 1;
            await tx.insert(flowVersions).values({ flowId: id, version: nextVersion, payload, createdAt: now });
            await tx.update(flowDefinitions).set({ name, currentVersion: nextVersion, updatedAt: now })
                .where(eq(flowDefinitions.id, id));
        });
        if (!nextVersion) return null;
        return this.flowDefinition(id);
    }

    async duplicateFlowDefinition(id: string, name?: string): Promise<FlowDefinitionDetail | null> {
        const source = await this.flowDefinition(id);
        if (!source) return null;
        return this.createFlowDefinition({ ...source.payload, name: name?.trim() || `${source.name} copy` });
    }

    async restoreFlowVersion(id: string, version: number, now = new Date()): Promise<FlowDefinitionDetail | null> {
        const source = await this.flowDefinition(id, version);
        if (!source) return null;
        return this.saveFlowVersion(id, source.payload, now);
    }

    async deleteFlowDefinition(id: string): Promise<boolean> {
        const removed = await this.connection.db.delete(flowDefinitions).where(eq(flowDefinitions.id, id)).returning({ id: flowDefinitions.id });
        return removed.length > 0;
    }

    async createTask(
        input: CreateTaskInput,
        devicePluginData: JsonObject = {},
        now = new Date(),
        assetIds: string[] = [],
        metadata: CreateTaskMetadata = {},
    ): Promise<ScheduleRow> {
        const externalSource = metadata.externalSource?.trim() || undefined;
        const externalId = metadata.externalId?.trim() || undefined;
        const externalRequestHash = metadata.externalRequestHash?.trim() || undefined;
        if ((externalSource || externalId || externalRequestHash) && (!externalSource || !externalId || !externalRequestHash)) {
            throw new Error('External task metadata requires source, id, and request hash together');
        }
        if (externalSource && (!/^[a-z][a-z0-9.-]{0,63}$/.test(externalSource) || externalId!.length > 160
            || !/^[a-f0-9]{64}$/.test(externalRequestHash!))) {
            throw new Error('External task metadata is invalid');
        }
        if (externalSource) {
            const existing = await this.scheduleByExternal(externalSource, externalId!);
            if (existing) {
                if (existing.externalRequestHash !== externalRequestHash) {
                    throw new Error(`External request ${externalSource}/${externalId} already exists with different content`);
                }
                return existing;
            }
        }
        const validated = validateTaskInput(this.plugins, input, devicePluginData, now);
        const executionPolicy = await this.executionPolicy(validated);
        const nextRunAt = initialRunAt(validated.timing, now);
        try {
            await this.assertNoScheduleConflict(validated.deviceUdid, validated.task, nextRunAt);
        } catch (error) {
            if (externalSource) {
                const existing = await this.scheduleByExternal(externalSource, externalId!);
                if (existing && existing.externalRequestHash === externalRequestHash) return existing;
            }
            throw error;
        }
        await ensureDeviceQueue(this.boss, validated.deviceUdid);
        const uniqueAssetIds = [...new Set(assetIds)];
        if (uniqueAssetIds.length !== assetIds.length) throw new Error('assetIds must not contain duplicates');
        let schedule!: ScheduleRow;
        let created = false;
        await this.connection.db.transaction(async (tx) => {
            const values = {
                deviceUdid: validated.deviceUdid,
                pluginId: validated.task.pluginId,
                taskType: validated.task.taskType,
                taskVersion: validated.task.taskVersion,
                payload: validated.task.payload,
                executionProfileId: executionPolicy.executionProfileId ?? null,
                networkRouteId: executionPolicy.networkRouteId ?? null,
                ...(externalSource ? {
                    externalSource, externalId: externalId!, externalRequestHash: externalRequestHash!,
                } : {}),
                timing: validated.timing,
                runWindowMinutes: validated.runWindowMinutes ?? Number(process.env.SCHEDULER_RUN_WINDOW_MINUTES ?? 30),
                nextRunAt,
            };
            const [inserted] = externalSource
                ? await tx.insert(schedules).values(values).onConflictDoNothing().returning()
                : await tx.insert(schedules).values(values).returning();
            if (!inserted) {
                const [existing] = await tx.select().from(schedules).where(and(
                    eq(schedules.externalSource, externalSource!), eq(schedules.externalId, externalId!),
                )).limit(1);
                if (!existing) throw new Error('Unable to create schedule');
                if (existing.externalRequestHash !== externalRequestHash) {
                    throw new Error(`External request ${externalSource}/${externalId} already exists with different content`);
                }
                schedule = existing;
                return;
            }
            schedule = inserted;
            created = true;
            if (uniqueAssetIds.length) {
                const attached = await tx.update(assets).set({ scheduleId: schedule.id }).where(and(
                    inArray(assets.id, uniqueAssetIds),
                    isNull(assets.scheduleId), isNull(assets.executionId), isNull(assets.campaignId),
                )).returning({ id: assets.id });
                if (attached.length !== uniqueAssetIds.length) {
                    throw new Error('One or more schedule assets are missing or already attached');
                }
            }
        });
        if (created && schedule.nextRunAt && schedule.nextRunAt <= now) await this.materializeDue(now, schedule.id);
        return schedule;
    }

    async scheduleByExternal(source: string, externalId: string): Promise<ScheduleRow | null> {
        const [row] = await this.connection.db.select().from(schedules).where(and(
            eq(schedules.externalSource, source), eq(schedules.externalId, externalId),
        )).limit(1);
        return row ?? null;
    }

    async latestExecutionForSchedule(scheduleId: string): Promise<ExecutionRow | null> {
        const [row] = await this.connection.db.select().from(executions).where(eq(executions.scheduleId, scheduleId))
            .orderBy(desc(executions.createdAt)).limit(1);
        return row ?? null;
    }

    async createCampaign(plan: PlannedCampaign, now = new Date()): Promise<CampaignRow> {
        return this.connection.db.transaction(async (tx) => {
            const [campaign] = await tx.insert(campaigns).values({
                name: plan.name,
                task: plan.task,
                timing: plan.timing,
                runWindowMinutes: plan.runWindowMinutes ?? Number(process.env.SCHEDULER_RUN_WINDOW_MINUTES ?? 30),
                targets: plan.targets,
                requiresFanOutConfirmation: plan.requiresFanOutConfirmation ? 1 : 0,
                requiresPublicActionConfirmation: plan.requiresPublicActionConfirmation ? 1 : 0,
                createdAt: now,
                updatedAt: now,
            }).returning();
            if (!campaign) throw new Error('Unable to create campaign');
            if (plan.assetIds.length) {
                const attached = await tx.update(assets).set({ campaignId: campaign.id }).where(and(
                    inArray(assets.id, plan.assetIds), isNull(assets.scheduleId), isNull(assets.executionId), isNull(assets.campaignId),
                )).returning({ id: assets.id });
                if (attached.length !== plan.assetIds.length) {
                    throw new Error('One or more campaign assets are missing or already attached');
                }
            }
            return campaign;
        });
    }

    async listCampaigns(limit = 100): Promise<CampaignRow[]> {
        return this.connection.db.select().from(campaigns).orderBy(desc(campaigns.createdAt)).limit(limit);
    }

    async campaign(id: string): Promise<CampaignRow | null> {
        const [row] = await this.connection.db.select().from(campaigns).where(eq(campaigns.id, id)).limit(1);
        return row ?? null;
    }

    async launchCampaign(
        id: string,
        plan: PlannedCampaign,
        confirmations: { fanOut?: boolean; publicActions?: boolean },
        now = new Date(),
    ): Promise<{ campaign: CampaignRow; schedules: ScheduleRow[] }> {
        const current = await this.campaign(id);
        if (!current) throw new Error('Campaign not found');
        if (current.status !== 'draft') throw new Error(`Campaign is already ${current.status}`);
        if (plan.requiresFanOutConfirmation && confirmations.fanOut !== true) {
            throw new Error('Multi-target campaign launch requires explicit fan-out confirmation');
        }
        if (plan.requiresPublicActionConfirmation && confirmations.publicActions !== true) {
            throw new Error('Campaign contains public/send actions and requires explicit confirmation');
        }

        const starts = plan.tasks.map((task) => initialRunAt(task.timing, now));
        for (let index = 0; index < plan.tasks.length; index++) {
            const task = plan.tasks[index]!;
            await this.assertNoScheduleConflict(task.deviceUdid, task.task, starts[index]!);
            await ensureDeviceQueue(this.boss, task.deviceUdid);
        }

        let created: ScheduleRow[] = [];
        const executionPolicies = await Promise.all(plan.tasks.map((task) => this.executionPolicy(task)));
        let launched: CampaignRow | undefined;
        await this.connection.db.transaction(async (tx) => {
            const [locked] = await tx.update(campaigns).set({
                status: 'active', launchedAt: now, updatedAt: now,
            }).where(and(eq(campaigns.id, id), eq(campaigns.status, 'draft'))).returning();
            if (!locked) throw new Error('Campaign was launched or cancelled concurrently');
            launched = locked;

            const rows = plan.tasks.map((task, index) => ({
                campaignId: id,
                campaignAccount: plan.targets[index]?.account ?? null,
                executionProfileId: executionPolicies[index]?.executionProfileId ?? null,
                networkRouteId: executionPolicies[index]?.networkRouteId ?? null,
                deviceUdid: task.deviceUdid,
                pluginId: task.task.pluginId,
                taskType: task.task.taskType,
                taskVersion: task.task.taskVersion,
                payload: task.task.payload,
                timing: task.timing,
                runWindowMinutes: task.runWindowMinutes ?? Number(process.env.SCHEDULER_RUN_WINDOW_MINUTES ?? 30),
                nextRunAt: starts[index]!,
                createdAt: now,
                updatedAt: now,
            }));
            created = await tx.insert(schedules).values(rows).returning();
            if (created.length !== rows.length) throw new Error('Unable to materialize every campaign target');
        });
        for (const schedule of created) {
            if (schedule.nextRunAt && schedule.nextRunAt <= now) await this.materializeDue(now, schedule.id);
        }
        return { campaign: launched!, schedules: created };
    }

    async cancelCampaign(id: string, now = new Date()): Promise<CampaignRow | null> {
        const current = await this.campaign(id);
        if (!current) return null;
        if (current.status === 'cancelled') return current;
        for (const schedule of await this.connection.db.select().from(schedules).where(eq(schedules.campaignId, id))) {
            if (!['cancelled', 'completed'].includes(schedule.status)) await this.setScheduleStatus(schedule.id, 'cancelled', now);
        }
        const [updated] = await this.connection.db.update(campaigns).set({ status: 'cancelled', updatedAt: now })
            .where(eq(campaigns.id, id)).returning();
        return updated ?? null;
    }

    private async assertNoScheduleConflict(deviceUdid: string, task: TaskEnvelope, start: Date, excludeId?: string): Promise<void> {
        const gap = Number(process.env.SCHEDULER_MIN_TASK_GAP_MINUTES ?? DEFAULT_MIN_SCHEDULE_GAP_MINUTES);
        if (gap <= 0) return;
        const candidate = estimatedTaskWindow(this.plugins, task, start);
        const others = await this.connection.db.select().from(schedules).where(and(
            eq(schedules.deviceUdid, deviceUdid), eq(schedules.status, 'active'),
        ));
        for (const other of others) {
            if (other.id === excludeId || !other.nextRunAt) continue;
            const otherWindow = estimatedTaskWindow(this.plugins, taskEnvelope(other), other.nextRunAt);
            if (windowsTooClose(candidate, otherWindow, gap)) {
                throw new Error(`This schedule is within ${gap} minutes of another schedule on this device`);
            }
        }
    }

    async registerAssets(files: Array<{
        relativePath: string; originalName: string; mimeType: string; size: number; sha256: string;
    }>): Promise<Array<{ id: string; name: string; mimeType: string }>> {
        if (!files.length) return [];
        const rows = await this.connection.db.insert(assets).values(files).returning();
        return rows.map((asset) => ({ id: asset.id, name: asset.originalName, mimeType: asset.mimeType }));
    }

    async deleteAssets(assetIds: string[]): Promise<void> { await this.purgeAssetIds(assetIds); }

    async listSchedules(limit = 100, deviceUdid?: string): Promise<ScheduleRow[]> {
        const query = this.connection.db.select().from(schedules);
        return deviceUdid
            ? query.where(eq(schedules.deviceUdid, deviceUdid)).orderBy(desc(schedules.createdAt)).limit(limit)
            : query.orderBy(desc(schedules.createdAt)).limit(limit);
    }

    async schedule(id: string): Promise<ScheduleRow | null> {
        const [row] = await this.connection.db.select().from(schedules).where(eq(schedules.id, id)).limit(1);
        return row ?? null;
    }

    async listExecutions(limit = 100, deviceUdid?: string): Promise<ExecutionRow[]> {
        const query = this.connection.db.select().from(executions);
        return deviceUdid
            ? query.where(eq(executions.deviceUdid, deviceUdid)).orderBy(desc(executions.createdAt)).limit(limit)
            : query.orderBy(desc(executions.createdAt)).limit(limit);
    }

    async execution(id: string): Promise<ExecutionDetail | null> {
        const [row] = await this.connection.db.select().from(executions).where(eq(executions.id, id)).limit(1);
        if (!row) return null;
        const logs = await this.connection.db.select({ line: executionLogs.line }).from(executionLogs)
            .where(eq(executionLogs.executionId, id)).orderBy(executionLogs.id);
        return { ...row, logs: logs.map(({ line }) => line) };
    }

    async executionAssets(execution: ExecutionRow): Promise<StoredAsset[]> {
        const rows = await this.connection.db.select().from(assets).where(or(
            eq(assets.executionId, execution.id),
            ...(execution.scheduleId ? [eq(assets.scheduleId, execution.scheduleId)] : []),
            ...(execution.campaignId ? [eq(assets.campaignId, execution.campaignId)] : []),
        ));
        return Promise.all(rows.map(async (asset) => ({
            id: asset.id, path: await materializeAssetFile(asset), name: asset.originalName,
            mimeType: asset.mimeType, size: asset.size, sha256: asset.sha256,
        })));
    }

    async assetFile(id: string): Promise<StoredAsset | null> {
        const [asset] = await this.connection.db.select().from(assets).where(eq(assets.id, id)).limit(1);
        if (!asset) return null;
        const root = path.resolve(process.env.SCHEDULER_DATA_DIR ?? '.scheduler-data');
        const filePath = path.resolve(root, asset.relativePath);
        if (!filePath.startsWith(`${root}${path.sep}`)) throw new Error('Asset path escapes scheduler data root');
        try { await access(filePath); } catch { return null; }
        return {
            id: asset.id,
            path: filePath,
            name: asset.originalName,
            mimeType: asset.mimeType,
            size: asset.size,
            sha256: asset.sha256,
        };
    }

    async activeExecution(deviceUdid: string): Promise<ExecutionRow | null> {
        const [row] = await this.connection.db.select().from(executions).where(and(
            eq(executions.deviceUdid, deviceUdid), inArray(executions.status, ['queued', 'running']),
        )).orderBy(desc(executions.createdAt)).limit(1);
        return row ?? null;
    }

    async updateSchedule(
        id: string,
        changes: { timing?: ScheduleTiming; task?: TaskEnvelope; runWindowMinutes?: number },
        devicePluginData: JsonObject = {},
        now = new Date(),
    ): Promise<ScheduleRow | null> {
        const [current] = await this.connection.db.select().from(schedules).where(eq(schedules.id, id)).limit(1);
        if (!current || current.status === 'cancelled' || current.status === 'completed') return null;
        const input = validateTaskInput(this.plugins, {
            deviceUdid: current.deviceUdid,
            task: changes.task ?? taskEnvelope(current),
            timing: changes.timing ?? current.timing,
            runWindowMinutes: changes.runWindowMinutes ?? current.runWindowMinutes,
        }, devicePluginData, now);
        const executionPolicy = await this.executionPolicy(input);
        const nextRunAt = changes.timing ? initialRunAt(input.timing, now) : current.nextRunAt;
        if (nextRunAt) await this.assertNoScheduleConflict(input.deviceUdid, input.task, nextRunAt, id);
        const [updated] = await this.connection.db.update(schedules).set({
            pluginId: input.task.pluginId, taskType: input.task.taskType, taskVersion: input.task.taskVersion,
            payload: input.task.payload, timing: input.timing, runWindowMinutes: input.runWindowMinutes,
            executionProfileId: executionPolicy.executionProfileId ?? null,
            networkRouteId: executionPolicy.networkRouteId ?? null,
            nextRunAt, updatedAt: now,
        }).where(eq(schedules.id, id)).returning();
        return updated ?? null;
    }

    async setScheduleStatus(id: string, status: 'active' | 'paused' | 'cancelled', now = new Date()): Promise<ScheduleRow | null> {
        const [current] = await this.connection.db.select().from(schedules).where(eq(schedules.id, id)).limit(1);
        if (!current) return null;
        if (!scheduleTransitionAllowed(current.status, status)) {
            throw new ScheduleTransitionError(`Cannot change a ${current.status} schedule to ${status}`);
        }
        const executionPolicy = status === 'active'
            ? await this.executionPolicy({
                deviceUdid: current.deviceUdid,
                task: taskEnvelope(current),
                timing: current.timing,
                runWindowMinutes: current.runWindowMinutes,
            })
            : { executionProfileId: current.executionProfileId ?? undefined, networkRouteId: current.networkRouteId ?? undefined };
        const [updated] = await this.connection.db.update(schedules).set({
            status, nextRunAt: status === 'active' ? initialRunAt(current.timing, now) : current.nextRunAt,
            executionProfileId: executionPolicy.executionProfileId ?? null,
            networkRouteId: executionPolicy.networkRouteId ?? null,
            updatedAt: now,
        }).where(eq(schedules.id, id)).returning();
        if (status === 'cancelled') {
            const queued = await this.connection.db.select().from(executions).where(and(
                eq(executions.scheduleId, id), eq(executions.status, 'queued'),
            ));
            for (const execution of queued) await this.cancelQueuedJob(execution);
            await this.connection.db.update(executions).set({ status: 'cancelled', finishedAt: now, updatedAt: now })
                .where(and(eq(executions.scheduleId, id), eq(executions.status, 'queued')));
            await this.purgeScheduleAssetsIfIdle(id);
        }
        return updated ?? null;
    }

    async materializeDue(now = new Date(), onlyScheduleId?: string): Promise<number> {
        let count = 0;
        await this.connection.db.transaction(async (tx) => {
            const conditions = onlyScheduleId
                ? sql`status = 'active' and next_run_at <= ${now} and id = ${onlyScheduleId}::uuid`
                : sql`status = 'active' and next_run_at <= ${now}`;
            interface DueRow {
                id: string; device_udid: string; plugin_id: string; task_type: string; task_version: number;
                payload: JsonObject; timing: ScheduleTiming; run_window_minutes: number; next_run_at: Date;
                campaign_id: string | null; campaign_account: string | null;
                execution_profile_id: string | null; network_route_id: string | null;
            }
            const result = await tx.execute(sql`select id, campaign_id, campaign_account, execution_profile_id, network_route_id, device_udid, plugin_id, task_type, task_version, payload,
                timing, run_window_minutes, next_run_at from scheduler.schedules where ${conditions}
                order by next_run_at for update skip locked limit 100`);
            for (const row of result.rows as unknown as DueRow[]) {
                const occurrence = latestDueOccurrence(row.timing, new Date(row.next_run_at), now);
                if (!occurrence) continue;
                const task: TaskEnvelope = {
                    pluginId: row.plugin_id, taskType: row.task_type, taskVersion: row.task_version, payload: row.payload,
                };
                const definition = this.plugins.task(task);
                const policy = definition.retryPolicy(task.payload);
                const [execution] = await tx.insert(executions).values({
                    scheduleId: row.id, campaignId: row.campaign_id, campaignAccount: row.campaign_account,
                    executionProfileId: row.execution_profile_id, networkRouteId: row.network_route_id,
                    deviceUdid: row.device_udid,
                    pluginId: row.plugin_id, taskType: row.task_type, taskVersion: row.task_version, payload: row.payload,
                    scheduledFor: occurrence.scheduledFor,
                    deadlineAt: new Date(occurrence.scheduledFor.getTime() + row.run_window_minutes * 60_000),
                }).onConflictDoNothing().returning();
                await tx.update(schedules).set({
                    nextRunAt: occurrence.nextRunAt, status: occurrence.nextRunAt ? 'active' : 'completed', updatedAt: now,
                }).where(eq(schedules.id, row.id));
                if (!execution) continue;
                const queueJobId = await this.boss.send(queueNameForDevice(row.device_udid), { executionId: execution.id }, {
                    db: fromDrizzle(tx, sql), retryLimit: policy.retryLimit,
                    retryDelay: policy.retryDelaySeconds, retryBackoff: policy.retryBackoff,
                    expireInSeconds: Math.max(900, Math.ceil(definition.estimateDurationMs(task.payload) / 1000) + 600),
                });
                if (!queueJobId) throw new Error('Queue rejected an execution job');
                await tx.update(executions).set({ queueJobId }).where(eq(executions.id, execution.id));
                count++;
            }
        });
        return count;
    }

    async startAttempt(id: string, attempt: number, now = new Date()): Promise<ExecutionRow | null> {
        const [row] = await this.connection.db.update(executions).set({
            status: 'running', startedAt: now, updatedAt: now, error: null,
        }).where(and(eq(executions.id, id), inArray(executions.status, ['queued', 'running']))).returning();
        if (!row) return null;
        await this.connection.db.insert(executionAttempts).values({ executionId: id, attempt }).onConflictDoNothing();
        return row;
    }

    async appendLogs(id: string, attempt: number, lines: string[]): Promise<void> {
        if (!lines.length) return;
        await this.connection.db.insert(executionLogs).values(lines.map((line) => ({ executionId: id, attempt, line })));
        // Heartbeat so reconcile does not treat a healthy long post as a zombie.
        await this.connection.db.update(executions).set({ updatedAt: new Date() })
            .where(and(eq(executions.id, id), eq(executions.status, 'running')));
    }

    async finishAttempt(id: string, attempt: number, exitCode: number | null, error?: string): Promise<void> {
        await this.connection.db.update(executionAttempts).set({ finishedAt: new Date(), exitCode, error })
            .where(and(eq(executionAttempts.executionId, id), eq(executionAttempts.attempt, attempt)));
    }

    async finishExecution(id: string, status: 'succeeded' | 'failed' | 'cancelled' | 'stopped', exitCode: number | null, error?: string): Promise<void> {
        await this.connection.db.update(executions).set({
            status, exitCode, error: error ?? null, finishedAt: new Date(), updatedAt: new Date(),
        }).where(eq(executions.id, id));
        await this.syncPipelineItemsForExecution(id, status, error);
        // Keep the media for retryable outcomes — the dashboard Retry button
        // accepts failed/stopped and would otherwise hit "asset is missing".
        // failed/stopped media is reclaimed by cleanup() once it ages out.
        if (status === 'succeeded' || status === 'cancelled') await this.purgeTerminalAssets(id);
    }

    async resetForRetry(id: string, error: string): Promise<void> {
        await this.connection.db.update(executions).set({ status: 'queued', error, updatedAt: new Date() }).where(eq(executions.id, id));
    }

    async stopRequested(id: string): Promise<boolean> {
        const [row] = await this.connection.db.select({ requested: executions.stopRequestedAt }).from(executions)
            .where(eq(executions.id, id)).limit(1);
        return Boolean(row?.requested);
    }

    async requestStop(id: string): Promise<'queued' | 'running' | 'not-found' | 'unsupported'> {
        const [execution] = await this.connection.db.select().from(executions).where(eq(executions.id, id)).limit(1);
        if (!execution) return 'not-found';
        if (execution.status === 'queued') {
            await this.cancelQueuedJob(execution);
            await this.finishExecution(id, 'cancelled', null, 'Cancelled before execution');
            return 'queued';
        }
        if (execution.status !== 'running') return 'unsupported';
        // If the plugin was uninstalled, still let the operator request a stop —
        // a running execution nobody can inspect is exactly what needs stopping.
        let supportsStop = true;
        try {
            supportsStop = this.plugins.task(taskEnvelope(execution)).supportsStop(execution.payload);
        } catch { /* plugin unavailable */ }
        if (!supportsStop) return 'unsupported';
        await this.connection.db.update(executions).set({ stopRequestedAt: new Date(), updatedAt: new Date() })
            .where(eq(executions.id, id));
        return 'running';
    }

    /**
     * Cancel every queued job for a device and request stop on every running one.
     * Used by the device-page Clear queue control so operators are not stuck
     * cancelling one-by-one while Start silently stacks behind a backlog.
     */
    async clearDeviceQueue(
        deviceUdid: string,
        filter: { pluginId?: string; taskType?: string; onlyQueued?: boolean } = {},
    ): Promise<{ cancelled: number; stopping: number }> {
        const pending = await this.connection.db.select().from(executions).where(and(
            eq(executions.deviceUdid, deviceUdid),
            inArray(executions.status, filter.onlyQueued ? ['queued'] : ['queued', 'running']),
        ));
        let cancelled = 0;
        let stopping = 0;
        for (const execution of pending) {
            if (filter.pluginId && execution.pluginId !== filter.pluginId) continue;
            if (filter.taskType && execution.taskType !== filter.taskType) continue;
            if (execution.status === 'queued') {
                await this.cancelQueuedJob(execution);
                await this.finishExecution(execution.id, 'cancelled', null, 'Cleared from device queue');
                cancelled += 1;
                continue;
            }
            const result = await this.requestStop(execution.id);
            if (result === 'running') stopping += 1;
            else if (result === 'queued') cancelled += 1;
        }
        return { cancelled, stopping };
    }

    private async cancelQueuedJob(execution: ExecutionRow): Promise<void> {
        if (!execution.queueJobId) return;
        try {
            await this.boss.cancel(queueNameForDevice(execution.deviceUdid), execution.queueJobId);
        } catch (error) {
            console.error(
                `pg-boss cancel failed for ${execution.id}:`,
                error instanceof Error ? error.message : error,
            );
        }
    }

    async retryExecution(id: string, now = new Date()): Promise<ExecutionRow | null> {
        const [source] = await this.connection.db.select().from(executions).where(eq(executions.id, id)).limit(1);
        if (!source || !['failed', 'stopped'].includes(source.status)) return null;
        await ensureDeviceQueue(this.boss, source.deviceUdid);
        const definition = this.plugins.task(taskEnvelope(source));
        const policy = definition.retryPolicy(source.payload);
        let created: ExecutionRow | undefined;
        await this.connection.db.transaction(async (tx) => {
            [created] = await tx.insert(executions).values({
                scheduleId: source.scheduleId, campaignId: source.campaignId, campaignAccount: source.campaignAccount,
                ...manualRetryIdentity(source, now),
                deviceUdid: source.deviceUdid,
                pluginId: source.pluginId, taskType: source.taskType, taskVersion: source.taskVersion, payload: source.payload,
            }).returning();
            if (!created) throw new Error('Unable to create retry execution');
            const jobId = await this.boss.send(queueNameForDevice(source.deviceUdid), { executionId: created.id }, {
                db: fromDrizzle(tx, sql), retryLimit: policy.retryLimit,
                retryDelay: policy.retryDelaySeconds, retryBackoff: policy.retryBackoff,
                // Match materializeDue — a retried multi-hour task must not be
                // expired by pg-boss's ~15-minute default while it's still running.
                expireInSeconds: Math.max(900, Math.ceil(definition.estimateDurationMs(source.payload) / 1000) + 600),
            });
            if (!jobId) throw new Error('Unable to enqueue retry execution');
            await tx.update(executions).set({ queueJobId: jobId }).where(eq(executions.id, created.id));
            created = { ...created, queueJobId: jobId };
        });
        return created ?? null;
    }

    async reconcileQueueStates(): Promise<number> {
        const pending = await this.connection.db.select().from(executions).where(inArray(executions.status, ['queued', 'running']));
        let changed = 0;
        for (const execution of pending) {
            const queue = queueNameForDevice(execution.deviceUdid);
            let job: { id: string; state?: string } | undefined;
            if (execution.queueJobId) {
                try {
                    const found = await this.boss.findJobs(queue, { id: execution.queueJobId });
                    job = found[0] as { id: string; state?: string } | undefined;
                } catch {
                    job = undefined;
                }
            }

            const ageMs = Date.now() - new Date(execution.updatedAt).getTime();
            const abandonAfterMs = this.runningAbandonGraceMs(execution);

            if (execution.status === 'running') {
                if (job?.state === 'retry') {
                    await this.resetForRetry(execution.id, 'Worker attempt interrupted; waiting for retry');
                    changed += 1;
                } else if (!job || job.state === 'failed' || job.state === 'cancelled' || job.state === 'completed') {
                    await this.finishExecution(
                        execution.id,
                        job?.state === 'cancelled' || execution.stopRequestedAt ? 'stopped' : 'failed',
                        null,
                        job ? `Queue job ${job.state}` : 'Queue job missing after worker restart',
                    );
                    changed += 1;
                } else if (
                    job.state === 'active'
                    && (ageMs > abandonAfterMs || (execution.stopRequestedAt && ageMs > 5_000))
                ) {
                    // Worker SIGTERM leaves the job "active" and blocks the singleton
                    // device queue forever — same class of ghost as queued orphans.
                    // Grace is task-duration based so long TikTok posts are not killed
                    // while still logging heartbeats.
                    await this.boss.cancel(queue, job.id).catch(() => {});
                    await this.finishExecution(
                        execution.id,
                        execution.stopRequestedAt ? 'stopped' : 'failed',
                        null,
                        'Abandoned active queue job after worker restart',
                    );
                    changed += 1;
                    console.log(`Finalized zombie running execution ${execution.id} (no heartbeat for ${Math.round(ageMs / 1000)}s)`);
                }
                continue;
            }

            // queued — re-enqueue when the pg-boss job is gone, finished, or left
            // "active" without ever flipping the execution to running (zombie after
            // a worker SIGTERM). Singleton device queues otherwise block forever.
            const missingOrDead = !job || job.state === 'failed' || job.state === 'cancelled' || job.state === 'completed';
            const zombieActive = job?.state === 'active' && ageMs > 45_000;
            if (!missingOrDead && !zombieActive) continue;
            try {
                if (job && (job.state === 'active' || job.state === 'created')) {
                    await this.boss.cancel(queue, job.id).catch(() => {});
                }
                await this.requeueQueuedExecution(execution);
                changed += 1;
                console.log(`Requeued orphaned execution ${execution.id} (was job state=${job?.state ?? 'missing'})`);
            } catch (error) {
                console.error(`Failed to requeue ${execution.id}:`, error);
            }
        }
        changed += await this.releaseOrphanedPublishingItems();
        return changed;
    }

    /** How long a running job may go without an updatedAt heartbeat before reconcile abandons it. */
    private runningAbandonGraceMs(execution: ExecutionRow): number {
        const configured = Number(process.env.SCHEDULER_RUNNING_ABANDON_MS);
        if (Number.isFinite(configured) && configured >= 60_000) return configured;
        let estimate = 60_000;
        try {
            estimate = this.plugins.task(taskEnvelope(execution)).estimateDurationMs(execution.payload);
        } catch { /* plugin unavailable */ }
        // Posts routinely run 2–5+ minutes; keep a floor so short estimates never
        // recreate the old 45s false-abandon.
        return Math.min(15 * 60_000, Math.max(5 * 60_000, estimate + 2 * 60_000));
    }

    /**
     * If a drain/post dies outside task.execute (reconcile abandon, SIGTERM),
     * pipeline items can be left in publishing forever. Release them back to ready.
     */
    private async syncPipelineItemsForExecution(
        executionId: string,
        status: 'succeeded' | 'failed' | 'cancelled' | 'stopped',
        error?: string,
    ): Promise<void> {
        if (status === 'succeeded') {
            await this.connection.db.update(pipelineItems).set({
                status: 'published', publishedAt: new Date(), updatedAt: new Date(), error: null, assetId: null,
            }).where(and(eq(pipelineItems.executionId, executionId), eq(pipelineItems.status, 'publishing')));
            return;
        }
        const message = error?.trim() || `Execution ${status}`;
        // Do not auto-requeue — a half-finished TikTok post must not silently retry
        // and risk publishing the wrong camera-roll clip.
        await this.connection.db.update(pipelineItems).set({
            status: 'failed',
            error: message,
            updatedAt: new Date(),
        }).where(and(eq(pipelineItems.executionId, executionId), eq(pipelineItems.status, 'publishing')));
    }

    /** Catch publishing rows whose execution already finished but never synced. */
    private async releaseOrphanedPublishingItems(): Promise<number> {
        const published = await this.connection.db.execute(sql`
            update scheduler.pipeline_items as p
            set status = 'published',
                published_at = coalesce(p.published_at, now()),
                asset_id = null,
                error = null,
                updated_at = now()
            from scheduler.executions as e
            where p.execution_id = e.id
              and p.status = 'publishing'
              and e.status = 'succeeded'
            returning p.id
        `);
        const failed = await this.connection.db.execute(sql`
            update scheduler.pipeline_items as p
            set status = 'failed',
                error = coalesce(e.error, 'Released after execution ended'),
                updated_at = now()
            from scheduler.executions as e
            where p.execution_id = e.id
              and p.status = 'publishing'
              and e.status in ('failed', 'cancelled', 'stopped', 'skipped')
            returning p.id
        `);
        return (published.rows as unknown[]).length + (failed.rows as unknown[]).length;
    }

    /** Send a fresh pg-boss job for an execution that is still marked queued. */
    private async requeueQueuedExecution(execution: ExecutionRow): Promise<void> {
        const task = taskEnvelope(execution);
        const definition = this.plugins.task(task);
        const policy = definition.retryPolicy(execution.payload);
        await ensureDeviceQueue(this.boss, execution.deviceUdid);
        const queueJobId = await this.boss.send(queueNameForDevice(execution.deviceUdid), { executionId: execution.id }, {
            retryLimit: policy.retryLimit,
            retryDelay: policy.retryDelaySeconds,
            retryBackoff: policy.retryBackoff,
            expireInSeconds: Math.max(900, Math.ceil(definition.estimateDurationMs(execution.payload) / 1000) + 600),
        });
        if (!queueJobId) throw new Error(`Queue rejected requeue for ${execution.id}`);
        await this.connection.db.update(executions).set({
            queueJobId,
            error: null,
            updatedAt: new Date(),
        }).where(and(eq(executions.id, execution.id), eq(executions.status, 'queued')));
    }

    async cleanup(historyDays = Number(process.env.SCHEDULER_HISTORY_DAYS ?? 30)): Promise<number> {
        const cutoff = new Date(Date.now() - historyDays * 86_400_000);
        const expired = await this.connection.db.select().from(executions).where(and(
            lt(executions.finishedAt, cutoff), inArray(executions.status, ['succeeded', 'failed', 'cancelled', 'skipped', 'stopped']),
        ));
        for (const execution of expired) await this.purgeTerminalAssets(execution.id);
        const removed = await this.connection.db.delete(executions).where(and(
            lt(executions.finishedAt, cutoff), inArray(executions.status, ['succeeded', 'failed', 'cancelled', 'skipped', 'stopped']),
        )).returning({ id: executions.id });
        return removed.length;
    }

    /** Media uploaded via POST /api/assets but never attached to a schedule (abandoned post form). */
    async sweepOrphanedAssets(olderThanHours = Number(process.env.SCHEDULER_ORPHAN_ASSET_HOURS)): Promise<number> {
        // A destructive job — an empty/NaN env must not collapse the window to 0.
        const hours = Number.isFinite(olderThanHours) && olderThanHours >= 1 ? olderThanHours : 24;
        const cutoff = new Date(Date.now() - hours * 3_600_000);
        const rows = await this.connection.db.select({ id: assets.id }).from(assets).where(and(
            isNull(assets.scheduleId), isNull(assets.executionId), lt(assets.createdAt, cutoff),
            sql`not exists (
                select 1 from scheduler.pipeline_items p
                where p.asset_id = ${assets.id}
                  and p.status in ('ready', 'publishing', 'failed')
            )`,
        ));
        await this.purgeAssetIds(rows.map(({ id }) => id));
        return rows.length;
    }

    async enqueuePipelineItem(input: {
        deviceUdid: string;
        assetId: string;
        caption?: string;
    }): Promise<PipelineItemRow> {
        return this.pipeline.enqueue(input);
    }

    async listPipelineItems(
        deviceUdid: string,
        limit = 50,
    ): Promise<Array<PipelineItemRow & { assetName: string | null; mimeType: string | null }>> {
        return this.pipeline.list(deviceUdid, limit);
    }

    async cancelPipelineItem(id: string, deviceUdid: string): Promise<PipelineItemRow | null> {
        return this.pipeline.cancel(id, deviceUdid);
    }

    async claimNextPipelineItem(deviceUdid: string, executionId: string): Promise<PipelineClaim | null> {
        return this.pipeline.claimNext(deviceUdid, executionId);
    }

    async completePipelineItem(id: string): Promise<void> {
        return this.pipeline.complete(id);
    }

    async failPipelineItem(id: string, error: string): Promise<void> {
        return this.pipeline.fail(id, error);
    }

    private async purgeTerminalAssets(executionId: string): Promise<void> {
        const [execution] = await this.connection.db.select().from(executions).where(eq(executions.id, executionId)).limit(1);
        if (!execution) return;
        if (execution.scheduleId) {
            const [schedule] = await this.connection.db.select().from(schedules).where(eq(schedules.id, execution.scheduleId)).limit(1);
            if (schedule && ['daily', 'weekly', 'interval'].includes(schedule.timing.kind) && schedule.status !== 'cancelled') return;
        }
        const rows = await this.connection.db.select({ id: assets.id }).from(assets).where(or(
            eq(assets.executionId, executionId),
            ...(execution.scheduleId ? [eq(assets.scheduleId, execution.scheduleId)] : []),
        ));
        await this.purgeAssetIds(rows.map(({ id }) => id));
    }

    private async purgeScheduleAssetsIfIdle(scheduleId: string): Promise<void> {
        const [running] = await this.connection.db.select({ id: executions.id }).from(executions).where(and(
            eq(executions.scheduleId, scheduleId), eq(executions.status, 'running'),
        )).limit(1);
        if (running) return;
        const rows = await this.connection.db.select({ id: assets.id }).from(assets).where(eq(assets.scheduleId, scheduleId));
        await this.purgeAssetIds(rows.map(({ id }) => id));
    }

    private async purgeAssetIds(ids: string[]): Promise<void> {
        if (!ids.length) return;
        const rows = await this.connection.db.select().from(assets).where(inArray(assets.id, ids));
        if ((process.env.PHONE_FARM_ROLE ?? 'standalone') === 'device-worker' && process.env.PHONE_FARM_CONTROL_PLANE_URL) {
            for (const asset of rows) await purgeRemoteAsset(asset.id);
            return;
        }
        const root = path.resolve(process.env.SCHEDULER_DATA_DIR ?? '.scheduler-data');
        for (const asset of rows) {
            const file = path.resolve(root, asset.relativePath);
            if (file.startsWith(`${root}${path.sep}`)) await rm(file, { force: true });
        }
        await this.connection.db.delete(assets).where(inArray(assets.id, ids));
    }
}
