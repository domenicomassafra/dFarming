import { bigint, index, integer, jsonb, pgSchema, primaryKey, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

import type { JsonObject, ScheduleTiming, TaskEnvelope } from '../types.js';
import type { CampaignTarget } from '../campaigns.js';

export const schedulerSchema = pgSchema('scheduler');
export const scheduleStatus = schedulerSchema.enum('schedule_status', ['active', 'paused', 'completed', 'cancelled']);
export const executionStatus = schedulerSchema.enum('execution_status', [
    'queued', 'running', 'succeeded', 'failed', 'cancelled', 'skipped', 'stopped',
]);
export const campaignStatus = schedulerSchema.enum('campaign_status', ['draft', 'active', 'cancelled']);

export const flowDefinitions = schedulerSchema.table('flow_definitions', {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    currentVersion: integer('current_version').notNull().default(1),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
}, (table) => [index('flow_definitions_updated_idx').on(table.updatedAt)]);

export const flowVersions = schedulerSchema.table('flow_versions', {
    flowId: uuid('flow_id').notNull().references(() => flowDefinitions.id, { onDelete: 'cascade' }),
    version: integer('version').notNull(),
    payload: jsonb('payload').$type<JsonObject>().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
}, (table) => [
    primaryKey({ columns: [table.flowId, table.version] }),
    index('flow_versions_flow_created_idx').on(table.flowId, table.createdAt),
]);

export const devicePools = schedulerSchema.table('device_pools', {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    selector: jsonb('selector').$type<JsonObject>().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
}, (table) => [
    uniqueIndex('device_pools_name_idx').on(table.name),
    index('device_pools_updated_idx').on(table.updatedAt),
]);

export const campaigns = schedulerSchema.table('campaigns', {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    status: campaignStatus('status').notNull().default('draft'),
    task: jsonb('task').$type<TaskEnvelope>().notNull(),
    timing: jsonb('timing').$type<ScheduleTiming>().notNull(),
    runWindowMinutes: integer('run_window_minutes').notNull().default(30),
    targets: jsonb('targets').$type<CampaignTarget[]>().notNull(),
    requiresFanOutConfirmation: integer('requires_fan_out_confirmation').notNull().default(0),
    requiresPublicActionConfirmation: integer('requires_public_action_confirmation').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    launchedAt: timestamp('launched_at', { withTimezone: true, mode: 'date' }),
}, (table) => [index('campaigns_status_created_idx').on(table.status, table.createdAt)]);

const taskColumns = {
    pluginId: text('plugin_id').notNull(),
    taskType: text('task_type').notNull(),
    taskVersion: integer('task_version').notNull(),
    payload: jsonb('payload').$type<JsonObject>().notNull(),
};

export const schedules = schedulerSchema.table('schedules', {
    id: uuid('id').primaryKey().defaultRandom(),
    campaignId: uuid('campaign_id').references(() => campaigns.id, { onDelete: 'set null' }),
    campaignAccount: text('campaign_account'),
    executionProfileId: text('execution_profile_id'),
    networkRouteId: text('network_route_id'),
    externalSource: text('external_source'),
    externalId: text('external_id'),
    externalRequestHash: text('external_request_hash'),
    deviceUdid: text('device_udid').notNull(), ...taskColumns,
    timing: jsonb('timing').$type<ScheduleTiming>().notNull(),
    status: scheduleStatus('status').notNull().default('active'),
    runWindowMinutes: integer('run_window_minutes').notNull().default(30),
    nextRunAt: timestamp('next_run_at', { withTimezone: true, mode: 'date' }),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
}, (table) => [
    index('schedules_due_idx').on(table.status, table.nextRunAt),
    index('schedules_device_idx').on(table.deviceUdid, table.createdAt),
    index('schedules_plugin_idx').on(table.pluginId, table.taskType, table.taskVersion),
    index('schedules_campaign_idx').on(table.campaignId),
    uniqueIndex('schedules_external_identity_idx').on(table.externalSource, table.externalId),
]);

export const executions = schedulerSchema.table('executions', {
    id: uuid('id').primaryKey().defaultRandom(),
    scheduleId: uuid('schedule_id').references(() => schedules.id, { onDelete: 'set null' }),
    campaignId: uuid('campaign_id').references(() => campaigns.id, { onDelete: 'set null' }),
    campaignAccount: text('campaign_account'),
    executionProfileId: text('execution_profile_id'),
    networkRouteId: text('network_route_id'),
    deviceUdid: text('device_udid').notNull(), ...taskColumns,
    scheduledFor: timestamp('scheduled_for', { withTimezone: true, mode: 'date' }).notNull(),
    deadlineAt: timestamp('deadline_at', { withTimezone: true, mode: 'date' }).notNull(),
    status: executionStatus('status').notNull().default('queued'), queueJobId: text('queue_job_id'),
    startedAt: timestamp('started_at', { withTimezone: true, mode: 'date' }),
    finishedAt: timestamp('finished_at', { withTimezone: true, mode: 'date' }), exitCode: integer('exit_code'),
    error: text('error'), stopRequestedAt: timestamp('stop_requested_at', { withTimezone: true, mode: 'date' }),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
}, (table) => [
    uniqueIndex('executions_schedule_occurrence_idx').on(table.scheduleId, table.scheduledFor),
    index('executions_device_status_idx').on(table.deviceUdid, table.status),
    index('executions_plugin_idx').on(table.pluginId, table.taskType, table.taskVersion),
    index('executions_campaign_idx').on(table.campaignId),
]);

export const executionAttempts = schedulerSchema.table('execution_attempts', {
    executionId: uuid('execution_id').notNull().references(() => executions.id, { onDelete: 'cascade' }),
    attempt: integer('attempt').notNull(),
    startedAt: timestamp('started_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    finishedAt: timestamp('finished_at', { withTimezone: true, mode: 'date' }), exitCode: integer('exit_code'), error: text('error'),
}, (table) => [primaryKey({ columns: [table.executionId, table.attempt] })]);

export const executionLogs = schedulerSchema.table('execution_logs', {
    id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
    executionId: uuid('execution_id').notNull().references(() => executions.id, { onDelete: 'cascade' }),
    attempt: integer('attempt').notNull(), line: text('line').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
}, (table) => [index('execution_logs_execution_idx').on(table.executionId, table.id)]);

export const assets = schedulerSchema.table('assets', {
    id: uuid('id').primaryKey().defaultRandom(),
    scheduleId: uuid('schedule_id').references(() => schedules.id, { onDelete: 'cascade' }),
    executionId: uuid('execution_id').references(() => executions.id, { onDelete: 'cascade' }),
    campaignId: uuid('campaign_id').references(() => campaigns.id, { onDelete: 'cascade' }),
    relativePath: text('relative_path').notNull().unique(), originalName: text('original_name').notNull(),
    mimeType: text('mime_type').notNull(), size: bigint('size', { mode: 'number' }).notNull(), sha256: text('sha256').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
}, (table) => [
    index('assets_schedule_idx').on(table.scheduleId), index('assets_execution_idx').on(table.executionId),
    index('assets_campaign_idx').on(table.campaignId),
]);

export const pipelineItemStatus = schedulerSchema.enum('pipeline_item_status', [
    'ready', 'publishing', 'published', 'failed', 'cancelled',
]);

/** Ready-to-post inbox: video + caption, drained at fixed EST check times. */
export const pipelineItems = schedulerSchema.table('pipeline_items', {
    id: uuid('id').primaryKey().defaultRandom(),
    deviceUdid: text('device_udid').notNull(),
    status: pipelineItemStatus('status').notNull().default('ready'),
    caption: text('caption'),
    assetId: uuid('asset_id').references(() => assets.id, { onDelete: 'restrict' }),
    executionId: uuid('execution_id').references(() => executions.id, { onDelete: 'set null' }),
    error: text('error'),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    publishedAt: timestamp('published_at', { withTimezone: true, mode: 'date' }),
}, (table) => [
    index('pipeline_items_device_status_idx').on(table.deviceUdid, table.status, table.createdAt),
    index('pipeline_items_asset_idx').on(table.assetId),
]);

export type ScheduleRow = typeof schedules.$inferSelect;
export type ExecutionRow = typeof executions.$inferSelect;
export type PipelineItemRow = typeof pipelineItems.$inferSelect;
export type CampaignRow = typeof campaigns.$inferSelect;
export type FlowDefinitionRow = typeof flowDefinitions.$inferSelect;
export type FlowVersionRow = typeof flowVersions.$inferSelect;
export type DevicePoolRow = typeof devicePools.$inferSelect;
