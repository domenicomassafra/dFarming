import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { validateAccountTaskPolicy, validateConfiguredAccount } from '../accounts.js';
import type { TaskDefinition, TaskExecutionContext } from '../plugin.js';
import type { JsonObject, JsonValue } from '../types.js';

export interface TikTokPluginConfiguration {
    doomscrollEntrypoint?: string;
    doomscrollFollowingEntrypoint?: string;
    workflowReplayEntrypoint?: string;
    postEntrypoint?: string;
    bundleId?: string;
}

type DoomscrollPayload = JsonObject & {
    durationMinutes: number;
    personality: 'skimmer' | 'casual' | 'engaged' | 'dialed';
    likeEnabled: boolean;
    saveEnabled: boolean;
    commentEnabled?: boolean;
    commentText?: string;
    account?: string;
};

type FollowingDoomscrollPayload = JsonObject & {
    durationMinutes: number;
    personality: 'skimmer' | 'casual' | 'engaged' | 'dialed';
    likeEnabled: boolean;
    saveEnabled: boolean;
    commentEnabled: boolean;
    commentText?: string;
    account?: string;
};

type WorkflowReplayPayload = JsonObject & {
    workflowId: string;
    durationMinutes?: number;
    loops?: number;
    commentText?: string;
};

type PostMedia = JsonObject & {
    assetId: string;
    name: string;
    mimeType: string;
};

type PostPayload = JsonObject & {
    media: PostMedia[];
    destination: 'draft' | 'publish';
    account?: string;
    caption?: string;
    musicUrl?: string;
    recurringPublishConfirmed?: boolean;
};

function createPipelineDrainTask(configuration: TikTokPluginConfiguration): TaskDefinition {
    return {
        type: 'pipeline-drain', version: 1, displayName: 'TikTok post pipeline',
        validate() {
            return {};
        },
        summarize: () => 'Post pipeline · check & publish',
        estimateDurationMs: () => 6 * 60_000,
        retryPolicy: () => ({ retryLimit: 0, retryDelaySeconds: 0, retryBackoff: false }),
        supportsStop: () => true,
        async execute(context: TaskExecutionContext) {
            const claimed = await context.claimPipelineItem();
            if (!claimed) {
                await context.log('Pipeline empty — skipping TikTok (no ready video+caption)');
                return { exitCode: 0, stopped: false };
            }
            if (!claimed.caption?.trim()) {
                await context.failPipelineItem(claimed.id, 'Pipeline item is missing a caption');
                await context.log('Skipped item without caption — will not publish random media');
                return { exitCode: 0, stopped: false };
            }
            await context.log(`Publishing pipeline item ${claimed.id} (${claimed.asset.name})`);
            try {
                const manifestPath = path.join(context.workspaceDirectory, 'manifest.json');
                await writeFile(manifestPath, JSON.stringify({
                    device: context.device,
                    files: [{ path: claimed.asset.path, name: claimed.asset.name, mimeType: claimed.asset.mimeType }],
                    destination: 'publish',
                    caption: claimed.caption.trim(),
                }));
                const result = await context.runProcess({
                    entrypoint: configuration.postEntrypoint ?? fileURLToPath(new URL('./tiktok/post.ts', import.meta.url)),
                    args: [manifestPath],
                });
                if (result.error || result.exitCode !== 0) {
                    const message = result.error ?? `Post exited with code ${result.exitCode}`;
                    await context.failPipelineItem(claimed.id, message);
                    return result;
                }
                await context.completePipelineItem(claimed.id);
                await context.log(`Published pipeline item ${claimed.id}`);
                return result;
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                await context.failPipelineItem(claimed.id, message);
                throw error;
            }
        },
    };
}

function objectPayload(value: JsonValue): Record<string, JsonValue> {
    if (!value || Array.isArray(value) || typeof value !== 'object') throw new Error('Payload must be an object');
    return value;
}

function optionalString(value: JsonValue | undefined, name: string): string | undefined {
    if (value === undefined) return;
    if (typeof value !== 'string') throw new Error(`${name} must be a string`);
    return value;
}

function createDoomscrollTask(configuration: TikTokPluginConfiguration): TaskDefinition<DoomscrollPayload> {
    return {
        type: 'doomscroll', version: 1, displayName: 'TikTok warmup',
        validate(value, context) {
            const input = objectPayload(value);
            const durationMinutes = input.durationMinutes;
            const personality = input.personality;
            if (!Number.isInteger(durationMinutes) || typeof durationMinutes !== 'number' || durationMinutes < 1 || durationMinutes > 180) {
                throw new Error('durationMinutes must be between 1 and 180');
            }
            if (personality !== 'skimmer' && personality !== 'casual' && personality !== 'engaged' && personality !== 'dialed') {
                throw new Error('Invalid personality');
            }
            if (typeof input.likeEnabled !== 'boolean' || typeof input.saveEnabled !== 'boolean') {
                throw new Error('Engagement settings must be boolean');
            }
            const commentEnabled = typeof input.commentEnabled === 'boolean' ? input.commentEnabled : false;
            const commentText = optionalString(input.commentText, 'commentText');
            if (commentEnabled && !commentText?.trim()) {
                throw new Error('commentText is required when commentEnabled is true');
            }
            const account = validateConfiguredAccount(
                optionalString(input.account, 'account'), context.devicePluginData, 'tiktok',
            );
            validateAccountTaskPolicy(account, 'doomscroll', context.devicePluginData, 'tiktok');
            return {
                durationMinutes, personality, likeEnabled: input.likeEnabled, saveEnabled: input.saveEnabled,
                commentEnabled,
                ...(commentText ? { commentText } : {}),
                ...(account ? { account } : {}),
            };
        },
        summarize: (payload) => `Warmup · ${payload.personality} · ${payload.durationMinutes} min`,
        estimateDurationMs: (payload) => payload.durationMinutes * 60_000,
        retryPolicy: () => ({ retryLimit: 2, retryDelaySeconds: 60, retryBackoff: true }),
        supportsStop: () => true,
        execute: (context, payload) => context.runProcess({
            entrypoint: configuration.doomscrollEntrypoint ?? fileURLToPath(new URL('./tiktok/doomscroll.ts', import.meta.url)),
            env: {
                IOS_UDID: context.device.udid,
                TIKTOK_BUNDLE_ID: configuration.bundleId ?? 'com.zhiliaoapp.musically',
                DOOMSCROLL_DURATION_MINUTES: String(payload.durationMinutes),
                DOOMSCROLL_PERSONALITY: payload.personality,
                DOOMSCROLL_LIKE_ENABLED: String(payload.likeEnabled),
                DOOMSCROLL_SAVE_ENABLED: String(payload.saveEnabled),
                DOOMSCROLL_COMMENT_ENABLED: String(payload.commentEnabled ?? false),
                ...(payload.commentText ? { DOOMSCROLL_COMMENT_TEXT: payload.commentText } : {}),
                ...(payload.account ? { TIKTOK_SWITCH_ACCOUNT: payload.account } : {}),
            },
        }),
    };
}

function createFollowingDoomscrollTask(configuration: TikTokPluginConfiguration): TaskDefinition<FollowingDoomscrollPayload> {
    return {
        type: 'doomscroll-following', version: 1, displayName: 'TikTok engagement',
        validate(value, context) {
            const input = objectPayload(value);
            const durationMinutes = input.durationMinutes;
            const personality = input.personality;
            if (!Number.isInteger(durationMinutes) || typeof durationMinutes !== 'number' || durationMinutes < 1 || durationMinutes > 180) {
                throw new Error('durationMinutes must be between 1 and 180');
            }
            if (personality !== 'skimmer' && personality !== 'casual' && personality !== 'engaged' && personality !== 'dialed') {
                throw new Error('Invalid personality');
            }
            if (typeof input.likeEnabled !== 'boolean' || typeof input.saveEnabled !== 'boolean') {
                throw new Error('Engagement settings must be boolean');
            }
            if (typeof input.commentEnabled !== 'boolean') {
                throw new Error('commentEnabled must be boolean');
            }
            const account = validateConfiguredAccount(
                optionalString(input.account, 'account'), context.devicePluginData, 'tiktok',
            );
            validateAccountTaskPolicy(account, 'doomscroll-following', context.devicePluginData, 'tiktok');
            const commentText = optionalString(input.commentText, 'commentText');
            if (commentText && commentText.length > 150) throw new Error('commentText must be 150 characters or fewer');
            if (input.commentEnabled && !commentText?.trim()) {
                throw new Error('commentText is required when commentEnabled is true');
            }
            return {
                durationMinutes, personality, likeEnabled: input.likeEnabled, saveEnabled: input.saveEnabled,
                commentEnabled: input.commentEnabled,
                ...(commentText ? { commentText } : {}),
                ...(account ? { account } : {}),
            };
        },
        summarize: (payload) => `Engagement · ${payload.personality} · ${payload.durationMinutes} min`,
        estimateDurationMs: (payload) => payload.durationMinutes * 60_000,
        retryPolicy: () => ({ retryLimit: 2, retryDelaySeconds: 60, retryBackoff: true }),
        supportsStop: () => true,
        execute: (context, payload) => context.runProcess({
            entrypoint: configuration.doomscrollFollowingEntrypoint
                ?? fileURLToPath(new URL('./tiktok/doomscroll-following.ts', import.meta.url)),
            env: {
                IOS_UDID: context.device.udid,
                TIKTOK_BUNDLE_ID: configuration.bundleId ?? 'com.zhiliaoapp.musically',
                DOOMSCROLL_DURATION_MINUTES: String(payload.durationMinutes),
                DOOMSCROLL_PERSONALITY: payload.personality,
                DOOMSCROLL_LIKE_ENABLED: String(payload.likeEnabled),
                DOOMSCROLL_SAVE_ENABLED: String(payload.saveEnabled),
                DOOMSCROLL_COMMENT_ENABLED: String(payload.commentEnabled),
                ...(payload.commentText ? { DOOMSCROLL_COMMENT_TEXT: payload.commentText } : {}),
                ...(payload.account ? { TIKTOK_SWITCH_ACCOUNT: payload.account } : {}),
            },
        }),
    };
}

function createWorkflowReplayTask(configuration: TikTokPluginConfiguration): TaskDefinition<WorkflowReplayPayload> {
    return {
        type: 'workflow-replay', version: 1, displayName: 'TikTok workflow replay',
        validate(value) {
            const input = objectPayload(value);
            if (typeof input.workflowId !== 'string' || !input.workflowId.trim()) {
                throw new Error('workflowId is required');
            }
            const durationMinutes = input.durationMinutes;
            const loops = input.loops;
            if (durationMinutes !== undefined) {
                if (!Number.isInteger(durationMinutes) || typeof durationMinutes !== 'number'
                    || durationMinutes < 1 || durationMinutes > 180) {
                    throw new Error('durationMinutes must be between 1 and 180');
                }
            }
            if (loops !== undefined) {
                if (!Number.isInteger(loops) || typeof loops !== 'number' || loops < 1 || loops > 500) {
                    throw new Error('loops must be between 1 and 500');
                }
            }
            if (durationMinutes === undefined && loops === undefined) {
                throw new Error('Provide durationMinutes or loops');
            }
            const commentText = optionalString(input.commentText, 'commentText');
            if (commentText && commentText.length > 150) throw new Error('commentText must be 150 characters or fewer');
            return {
                workflowId: input.workflowId.trim(),
                ...(durationMinutes !== undefined ? { durationMinutes } : {}),
                ...(loops !== undefined ? { loops } : {}),
                ...(commentText ? { commentText } : {}),
            };
        },
        summarize: (payload) => payload.durationMinutes
            ? `Replay · ${payload.durationMinutes} min`
            : `Replay · ${payload.loops} loops`,
        estimateDurationMs: (payload) => (payload.durationMinutes ?? Math.min(payload.loops ?? 1, 30)) * 60_000,
        retryPolicy: () => ({ retryLimit: 1, retryDelaySeconds: 30, retryBackoff: true }),
        supportsStop: () => true,
        execute: (context, payload) => context.runProcess({
            entrypoint: configuration.workflowReplayEntrypoint
                ?? fileURLToPath(new URL('./tiktok/workflow-replay.ts', import.meta.url)),
            env: {
                IOS_UDID: context.device.udid,
                TIKTOK_BUNDLE_ID: configuration.bundleId ?? 'com.zhiliaoapp.musically',
                WORKFLOW_ID: payload.workflowId,
                ...(payload.durationMinutes !== undefined
                    ? { WORKFLOW_DURATION_MINUTES: String(payload.durationMinutes) }
                    : {}),
                ...(payload.loops !== undefined ? { WORKFLOW_LOOPS: String(payload.loops) } : {}),
                ...(payload.commentText ? { WORKFLOW_COMMENT_TEXT: payload.commentText } : {}),
            },
        }),
    };
}

function createPostTask(configuration: TikTokPluginConfiguration): TaskDefinition<PostPayload> {
    return {
        type: 'post', version: 1, displayName: 'TikTok post',
        validate(value, context) {
            const input = objectPayload(value);
            if (!Array.isArray(input.media) || input.media.length < 1 || input.media.length > 3) {
                throw new Error('Choose one to three media files');
            }
            const media = input.media.map((item) => {
                const candidate = objectPayload(item);
                if (typeof candidate.assetId !== 'string' || typeof candidate.name !== 'string' || typeof candidate.mimeType !== 'string') {
                    throw new Error('Invalid media item');
                }
                return { assetId: candidate.assetId, name: candidate.name, mimeType: candidate.mimeType };
            });
            if (input.destination !== 'draft' && input.destination !== 'publish') throw new Error('Invalid post destination');
            const accountCandidate = optionalString(input.account, 'account');
            const caption = optionalString(input.caption, 'caption');
            if (caption && caption.length > 2200) throw new Error('Caption must be 2,200 characters or fewer');
            const musicUrl = optionalString(input.musicUrl, 'musicUrl');
            if (musicUrl) {
                const parsed = new URL(musicUrl);
                if (parsed.protocol !== 'https:' || !/(^|\.)tiktok\.com$/i.test(parsed.hostname)) {
                    throw new Error('Music URL must be an HTTPS TikTok URL');
                }
            }
            const recurring = context.timingKind === 'daily' || context.timingKind === 'weekly';
            if (recurring && input.destination === 'publish' && input.recurringPublishConfirmed !== true) {
                throw new Error('Recurring public posts require explicit confirmation');
            }
            const account = validateConfiguredAccount(accountCandidate, context.devicePluginData, 'tiktok');
            validateAccountTaskPolicy(account, 'post', context.devicePluginData, 'tiktok');
            return {
                media, destination: input.destination,
                ...(account ? { account } : {}),
                ...(caption ? { caption } : {}), ...(musicUrl ? { musicUrl } : {}),
                ...(input.recurringPublishConfirmed === true ? { recurringPublishConfirmed: true } : {}),
            };
        },
        summarize: (payload) => `Post · publish · ${payload.media.length} media`,
        estimateDurationMs: () => 6 * 60_000,
        retryPolicy: () => ({ retryLimit: 0, retryDelaySeconds: 0, retryBackoff: false }),
        supportsStop: () => true,
        async execute(context: TaskExecutionContext, payload) {
            const byId = new Map(context.assets.map((asset) => [asset.id, asset]));
            const files = payload.media.map((media) => {
                const asset = byId.get(media.assetId);
                if (!asset) throw new Error(`Scheduled media asset ${media.assetId} is missing`);
                return { path: asset.path, name: media.name, mimeType: media.mimeType };
            });
            const manifestPath = path.join(context.workspaceDirectory, 'manifest.json');
            await writeFile(manifestPath, JSON.stringify({
                device: context.device, files, destination: payload.destination,
                ...(payload.account ? { account: payload.account } : {}),
                ...(payload.caption ? { caption: payload.caption } : {}),
                ...(payload.musicUrl ? { musicUrl: payload.musicUrl } : {}),
            }));
            return context.runProcess({
                entrypoint: configuration.postEntrypoint ?? fileURLToPath(new URL('./tiktok/post.ts', import.meta.url)),
                args: [manifestPath],
            });
        },
    };
}

export function createTikTokTaskDefinitions(
    configuration: TikTokPluginConfiguration = {},
): TaskDefinition[] {
    return [
        createDoomscrollTask(configuration),
        createFollowingDoomscrollTask(configuration),
        createWorkflowReplayTask(configuration),
        createPostTask(configuration),
        createPipelineDrainTask(configuration),
    ];
}
