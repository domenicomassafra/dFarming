import crypto from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import type { RemoteControl, ScreenInfo } from '../devices/wda-remote.js';
import { SemanticSnapshotStore, type SemanticSnapshot, type SemanticSnapshotOptions } from './snapshot.js';

export interface SemanticFindOptions {
    timeoutMs?: number;
    pollMs?: number;
    type?: string;
    exact?: boolean;
}

export interface SemanticTrace {
    id: string;
    action: 'tap-ref' | 'type-text';
    deviceUdid: string;
    timestamp: string;
    generation?: number;
    ref?: string;
    elementType?: string;
    center?: { x: number; y: number };
    textLength?: number;
}

export class SemanticController {
    readonly store: SemanticSnapshotStore;

    constructor(
        readonly remote: RemoteControl,
        readonly traceRoot = path.resolve(process.env.SCHEDULER_DATA_DIR ?? '.scheduler-data', 'semantic-traces'),
        store = new SemanticSnapshotStore(),
    ) {
        this.store = store;
    }

    async snapshot(deviceUdid: string, options: SemanticSnapshotOptions = {}): Promise<SemanticSnapshot> {
        return (await this.snapshotWithScreen(deviceUdid, options)).snapshot;
    }

    async snapshotWithScreen(
        deviceUdid: string,
        options: SemanticSnapshotOptions = {},
    ): Promise<{ screen: ScreenInfo; snapshot: SemanticSnapshot }> {
        const [screen, tree] = await Promise.all([
            this.remote.getScreenInfo(deviceUdid),
            this.remote.getAccessibilityTree(deviceUdid),
        ]);
        return { screen, snapshot: this.store.build(deviceUdid, tree, screen.screenSize, options) };
    }

    invalidate(deviceUdid: string): number {
        return this.store.invalidate(deviceUdid);
    }

    async tapRef(deviceUdid: string, generation: number, ref: string): Promise<{ ok: true; traceId: string }> {
        const element = this.store.resolve(deviceUdid, generation, ref);
        if (!element.enabled) throw new Error(`Semantic element ${ref} is disabled`);
        await this.remote.performAction(deviceUdid, { type: 'tap', x: element.center.x, y: element.center.y });
        this.store.invalidate(deviceUdid);
        const trace = await this.writeTrace({
            action: 'tap-ref', deviceUdid, generation, ref, elementType: element.type, center: element.center,
        });
        return { ok: true, traceId: trace.id };
    }

    async typeText(deviceUdid: string, text: string): Promise<{ ok: true; traceId: string }> {
        if (!text || text.length > 4000) throw new Error('Semantic text input must contain 1 to 4000 characters');
        await this.remote.performAction(deviceUdid, { type: 'type', text });
        this.store.invalidate(deviceUdid);
        const trace = await this.writeTrace({ action: 'type-text', deviceUdid, textLength: text.length });
        return { ok: true, traceId: trace.id };
    }

    async waitForText(
        deviceUdid: string,
        text: string,
        options: SemanticFindOptions = {},
    ): Promise<{ snapshot: SemanticSnapshot; matches: ReturnType<SemanticSnapshotStore['find']> }> {
        const timeoutMs = Math.max(0, Math.min(30_000, options.timeoutMs ?? 10_000));
        const pollMs = Math.max(100, Math.min(2_000, options.pollMs ?? 500));
        const deadline = Date.now() + timeoutMs;
        let last = await this.snapshot(deviceUdid, { query: text });
        while (true) {
            const matches = this.matches(last, text, options);
            if (matches.length) return { snapshot: last, matches };
            if (Date.now() >= deadline) throw new Error(`Timed out waiting for ${JSON.stringify(text)}`);
            await new Promise((resolve) => setTimeout(resolve, pollMs));
            last = await this.snapshot(deviceUdid, { query: text });
        }
    }

    async waitForTextGone(deviceUdid: string, text: string, options: SemanticFindOptions = {}): Promise<void> {
        const timeoutMs = Math.max(0, Math.min(30_000, options.timeoutMs ?? 10_000));
        const pollMs = Math.max(100, Math.min(2_000, options.pollMs ?? 500));
        const deadline = Date.now() + timeoutMs;
        while (true) {
            const snapshot = await this.snapshot(deviceUdid, { query: text });
            if (this.matches(snapshot, text, options).length === 0) return;
            if (Date.now() >= deadline) throw new Error(`Timed out waiting for ${JSON.stringify(text)} to disappear`);
            await new Promise((resolve) => setTimeout(resolve, pollMs));
        }
    }

    async tapText(deviceUdid: string, text: string, options: SemanticFindOptions = {}): Promise<{ ok: true; traceId: string }> {
        const { snapshot, matches } = await this.waitForText(deviceUdid, text, options);
        const first = matches[0]!;
        return this.tapRef(deviceUdid, snapshot.generation, first.ref);
    }

    async inputText(deviceUdid: string, target: string, text: string, options: SemanticFindOptions = {}): Promise<void> {
        await this.tapText(deviceUdid, target, options);
        await this.typeText(deviceUdid, text);
    }

    private matches(snapshot: SemanticSnapshot, text: string, options: SemanticFindOptions) {
        const matches = this.store.find(snapshot, text, options.type);
        if (!options.exact) return matches;
        const wanted = text.trim().toLowerCase();
        return matches.filter((element) => (
            element.label.trim().toLowerCase() === wanted
            || element.value?.trim().toLowerCase() === wanted
            || element.identifier?.trim().toLowerCase() === wanted
        ));
    }

    private async writeTrace(input: Omit<SemanticTrace, 'id' | 'timestamp'>): Promise<SemanticTrace> {
        const trace: SemanticTrace = {
            id: `${Date.now()}-${crypto.randomBytes(4).toString('hex')}`,
            timestamp: new Date().toISOString(),
            ...input,
        };
        await mkdir(this.traceRoot, { recursive: true, mode: 0o700 });
        await writeFile(path.join(this.traceRoot, `${trace.id}.json`), `${JSON.stringify(trace, null, 2)}\n`, { mode: 0o600 });
        return trace;
    }
}
