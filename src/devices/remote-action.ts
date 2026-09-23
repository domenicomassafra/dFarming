import type { RemoteAction } from './wda-remote.js';

const APP_ID = /^[A-Za-z0-9._-]{2,255}$/;
const SYSTEM_ACTIONS = new Set(['home', 'lock', 'wake', 'unlock', 'volumeUp', 'volumeDown']);

function record(value: unknown): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Remote action must be an object');
    return value as Record<string, unknown>;
}

function finite(value: unknown, name: string, min: number, max: number): number {
    const number = Number(value);
    if (!Number.isFinite(number) || number < min || number > max) {
        throw new Error(`${name} must be between ${min} and ${max}`);
    }
    return number;
}

export function parseRemoteAction(value: unknown): RemoteAction {
    const input = record(value);
    const type = input.type;
    if (typeof type !== 'string') throw new Error('Remote action type is required');
    if (type === 'tap') {
        return { type, x: finite(input.x, 'x', 0, 100_000), y: finite(input.y, 'y', 0, 100_000) };
    }
    if (type === 'swipe') {
        return {
            type,
            startX: finite(input.startX, 'startX', 0, 100_000),
            startY: finite(input.startY, 'startY', 0, 100_000),
            endX: finite(input.endX, 'endX', 0, 100_000),
            endY: finite(input.endY, 'endY', 0, 100_000),
            durationMs: Math.round(finite(input.durationMs, 'durationMs', 50, 5_000)),
        };
    }
    if (type === 'type') {
        if (typeof input.text !== 'string' || input.text.length < 1 || input.text.length > 4_000) {
            throw new Error('Remote text must contain 1 to 4000 characters');
        }
        return { type, text: input.text };
    }
    if (type === 'launch' || type === 'terminate') {
        if (typeof input.appId !== 'string' || !APP_ID.test(input.appId)) throw new Error('Remote appId is invalid');
        return { type, appId: input.appId };
    }
    if (type === 'orientation') {
        if (input.orientation !== 'portrait' && input.orientation !== 'landscape') {
            throw new Error('Remote orientation must be portrait or landscape');
        }
        return { type, orientation: input.orientation };
    }
    if (SYSTEM_ACTIONS.has(type)) return { type: type as Extract<RemoteAction, { type: string }>['type'] } as RemoteAction;
    throw new Error(`Unsupported remote action ${JSON.stringify(type)}`);
}
