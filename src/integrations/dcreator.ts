import crypto from 'node:crypto';

import { normalizeNetworkRouteId } from '../network-routes.js';
import type { JsonObject, ScheduleTiming, TaskEnvelope } from '../types.js';

export const DCREATOR_JOB_SCHEMA = 'dfarming.dcreator-job/v1' as const;
export const DCREATOR_RECEIPT_SCHEMA = 'dfarming.execution-receipt/v1' as const;
export type DCreatorIntent = 'publish' | 'draft' | 'inspect';
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface DCreatorJobConstraints {
    platform?: 'ios' | 'android';
    devicePool?: string;
    executionProfile?: string;
    networkRoute?: string;
}

export interface DCreatorJobRequest {
    schema: typeof DCREATOR_JOB_SCHEMA;
    externalId: string;
    assetRefs: string[];
    intent: DCreatorIntent;
    accountRef: string;
    task: TaskEnvelope;
    timing: ScheduleTiming;
    runWindowMinutes?: number;
    constraints: DCreatorJobConstraints;
}

export interface DCreatorExecutionReceipt {
    schema: typeof DCREATOR_RECEIPT_SCHEMA;
    externalId: string;
    scheduleId?: string;
    executionId?: string;
    deviceUdid?: string;
    status: 'queued' | 'running' | 'completed' | 'failed' | 'refused';
    evidenceRefs: string[];
    reason?: string;
}

function record(value: unknown): Record<string, unknown> | undefined {
    return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function identifier(value: unknown, label: string, maxLength = 160): string {
    if (typeof value !== 'string') throw new Error(`${label} must be a string`);
    const normalized = value.trim();
    if (!normalized || normalized.length > maxLength || !/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(normalized)) {
        throw new Error(`${label} is invalid`);
    }
    return normalized;
}

function profileId(value: unknown, label: string): string {
    const normalized = identifier(value, label, 64).toLowerCase();
    if (!/^[a-z0-9][a-z0-9._-]*$/.test(normalized)) throw new Error(`${label} is invalid`);
    return normalized;
}

function normalizeTask(value: unknown): TaskEnvelope {
    const task = record(value);
    if (!task || typeof task.pluginId !== 'string' || typeof task.taskType !== 'string'
        || !Number.isInteger(task.taskVersion) || Number(task.taskVersion) < 1) {
        throw new Error('task must contain pluginId, taskType, and a positive taskVersion');
    }
    if (!/^[a-z][a-z0-9.-]*$/.test(task.pluginId.trim()) || !/^[a-z][a-z0-9.-]*$/.test(task.taskType.trim())) {
        throw new Error('task pluginId/taskType identifiers are invalid');
    }
    const payload = record(task.payload);
    if (!payload) throw new Error('task.payload must be an object');
    return {
        pluginId: task.pluginId.trim(),
        taskType: task.taskType.trim(),
        taskVersion: Number(task.taskVersion),
        payload: structuredClone(payload) as JsonObject,
    };
}

function normalizeTiming(value: unknown): ScheduleTiming {
    if (value === undefined) return { kind: 'now' };
    const timing = record(value);
    if (!timing || typeof timing.kind !== 'string') throw new Error('timing must be a scheduler timing object');
    return structuredClone(timing) as unknown as ScheduleTiming;
}

export function normalizeDCreatorJob(value: unknown): DCreatorJobRequest {
    const input = record(value);
    if (!input || input.schema !== DCREATOR_JOB_SCHEMA) throw new Error(`schema must be ${DCREATOR_JOB_SCHEMA}`);
    const intent = input.intent;
    if (intent !== 'publish' && intent !== 'draft' && intent !== 'inspect') throw new Error('intent is invalid');
    const externalId = identifier(input.externalId, 'externalId');
    const accountRef = profileId(input.accountRef, 'accountRef');
    const assetRefsRaw = input.assetRefs ?? [];
    if (!Array.isArray(assetRefsRaw) || assetRefsRaw.length > 100
        || assetRefsRaw.some((asset) => typeof asset !== 'string' || !UUID_PATTERN.test(asset))) {
        throw new Error('assetRefs must contain at most 100 dFarming asset UUIDs');
    }
    const assetRefs = [...new Set(assetRefsRaw as string[])];
    if (assetRefs.length !== assetRefsRaw.length) throw new Error('assetRefs must not contain duplicates');
    const constraintsRaw = input.constraints === undefined ? {} : record(input.constraints);
    if (!constraintsRaw) throw new Error('constraints must be an object');
    let platform: 'ios' | 'android' | undefined;
    if (constraintsRaw.platform !== undefined) {
        if (constraintsRaw.platform !== 'ios' && constraintsRaw.platform !== 'android') throw new Error('constraints.platform must be ios or android');
        platform = constraintsRaw.platform;
    }
    const devicePool = constraintsRaw.devicePool === undefined ? undefined : identifier(constraintsRaw.devicePool, 'constraints.devicePool', 100);
    if (devicePool && !UUID_PATTERN.test(devicePool)) throw new Error('constraints.devicePool must be a dFarming pool UUID');
    const executionProfile = constraintsRaw.executionProfile === undefined
        ? undefined : profileId(constraintsRaw.executionProfile, 'constraints.executionProfile');
    const networkRoute = constraintsRaw.networkRoute === undefined
        ? undefined : normalizeNetworkRouteId(constraintsRaw.networkRoute);
    const runWindowMinutes = input.runWindowMinutes;
    if (runWindowMinutes !== undefined && (!Number.isInteger(runWindowMinutes) || Number(runWindowMinutes) < 1 || Number(runWindowMinutes) > 1440)) {
        throw new Error('runWindowMinutes must be between 1 and 1440');
    }
    return {
        schema: DCREATOR_JOB_SCHEMA,
        externalId,
        assetRefs,
        intent,
        accountRef,
        task: normalizeTask(input.task),
        timing: normalizeTiming(input.timing),
        ...(runWindowMinutes !== undefined ? { runWindowMinutes: Number(runWindowMinutes) } : {}),
        constraints: {
            ...(platform ? { platform } : {}),
            ...(devicePool ? { devicePool } : {}),
            ...(executionProfile ? { executionProfile } : {}),
            ...(networkRoute ? { networkRoute } : {}),
        },
    };
}

function canonicalJson(value: unknown): string {
    if (value === null || typeof value !== 'object') return JSON.stringify(value);
    if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
    const object = value as Record<string, unknown>;
    return `{${Object.keys(object).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(object[key])}`).join(',')}}`;
}

export function dcreatorRequestHash(request: DCreatorJobRequest): string {
    return crypto.createHash('sha256').update(canonicalJson(request)).digest('hex');
}
