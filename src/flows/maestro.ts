import { parseAllDocuments, stringify } from 'yaml';

import type { FlowStep, PortableFlowPayload } from '../flow-plugin.js';

type MaestroCommand = string | Record<string, unknown>;

function semanticSelector(value: unknown, command: string): { text: string; exact?: boolean } {
    if (typeof value === 'string' && value.trim()) return { text: value.trim() };
    if (value && typeof value === 'object' && !Array.isArray(value)) {
        const selector = value as { text?: unknown; id?: unknown };
        if (typeof selector.text === 'string' && selector.text.trim()) return { text: selector.text.trim() };
        if (typeof selector.id === 'string' && selector.id.trim()) return { text: selector.id.trim(), exact: true };
    }
    throw new Error(`Maestro ${command} requires a text or id selector`);
}

function timeout(value: unknown): number | undefined {
    if (value === undefined) return undefined;
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed < 0 || parsed > 30_000) throw new Error('Maestro timeout must be between 0 and 30000ms');
    return Math.round(parsed);
}

function commandStep(command: MaestroCommand, appId: string): FlowStep[] {
    if (command === 'launchApp') return [{ action: 'launch', appId }];
    if (command === 'stopApp') return [{ action: 'terminate', appId }];
    if (!command || typeof command !== 'object' || Array.isArray(command)) {
        throw new Error(`Unsupported Maestro command: ${String(command)}`);
    }
    const entries = Object.entries(command);
    if (entries.length !== 1) throw new Error('Each Maestro flow step must contain exactly one command');
    const [name, value] = entries[0]!;
    if (name === 'launchApp') {
        if (typeof value === 'string' && value.trim()) return [{ action: 'launch', appId: value.trim() }];
        return [{ action: 'launch', appId }];
    }
    if (name === 'setOrientation') {
        const orientation = typeof value === 'string' ? value.toUpperCase() : '';
        if (orientation === 'PORTRAIT') return [{ action: 'setOrientation', orientation: 'portrait' }];
        if (orientation === 'LANDSCAPE_LEFT' || orientation === 'LANDSCAPE') {
            return [{ action: 'setOrientation', orientation: 'landscape' }];
        }
        throw new Error(
            `Unsupported Maestro setOrientation ${JSON.stringify(value)}; `
            + 'dFarming keeps only the lossless cross-platform portrait/landscape subset',
        );
    }
    if (name === 'tapOn') return [{ action: 'tapText', ...semanticSelector(value, name), timeoutMs: 10_000 }];
    if (name === 'assertVisible') return [{ action: 'assertVisible', ...semanticSelector(value, name), timeoutMs: 1_000 }];
    if (name === 'assertNotVisible') return [{ action: 'waitGone', ...semanticSelector(value, name), timeoutMs: 1_000 }];
    if (name === 'inputText') {
        if (typeof value !== 'string' || !value.length) throw new Error('Maestro inputText requires text');
        return [{ action: 'type', text: value }];
    }
    if (name === 'extendedWaitUntil') {
        if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Maestro extendedWaitUntil must be an object');
        const wait = value as { visible?: unknown; notVisible?: unknown; timeout?: unknown };
        if (wait.visible !== undefined) return [{ action: 'waitVisible', ...semanticSelector(wait.visible, name), timeoutMs: timeout(wait.timeout) ?? 10_000 }];
        if (wait.notVisible !== undefined) return [{ action: 'waitGone', ...semanticSelector(wait.notVisible, name), timeoutMs: timeout(wait.timeout) ?? 10_000 }];
        throw new Error('Maestro extendedWaitUntil must specify visible or notVisible');
    }
    if (name === 'pressKey') {
        const key = typeof value === 'string' ? value.toUpperCase() : '';
        if (key === 'HOME') return [{ action: 'home' }];
        if (key === 'VOLUME_UP') return [{ action: 'volumeUp' }];
        if (key === 'VOLUME_DOWN') return [{ action: 'volumeDown' }];
        throw new Error(`Unsupported Maestro pressKey ${JSON.stringify(value)}`);
    }
    throw new Error(`Unsupported Maestro command ${name}`);
}

export function importMaestroFlow(source: string, overrideName?: string): PortableFlowPayload {
    if (!source.trim() || source.length > 512_000) throw new Error('Maestro YAML must contain 1 to 512000 characters');
    const documents = parseAllDocuments(source);
    const errors = documents.flatMap((document) => document.errors);
    if (errors.length) throw new Error(`Invalid Maestro YAML: ${errors[0]!.message}`);
    const values = documents.map((document) => document.toJSON() as unknown);
    const config = (values[0] && typeof values[0] === 'object' && !Array.isArray(values[0])) ? values[0] as Record<string, unknown> : {};
    const commands = Array.isArray(values[1]) ? values[1] as MaestroCommand[] : Array.isArray(values[0]) ? values[0] as MaestroCommand[] : [];
    const appId = typeof config.appId === 'string' ? config.appId.trim() : '';
    if (!appId) throw new Error('Maestro import requires top-level appId');
    if (!commands.length) throw new Error('Maestro import contains no commands');
    const steps = commands.flatMap((command) => commandStep(command, appId));
    const name = overrideName?.trim() || (typeof config.name === 'string' && config.name.trim()) || `Maestro · ${appId}`;
    return { name: name.slice(0, 120), steps };
}

export function exportMaestroFlow(payload: PortableFlowPayload): string {
    const launches = payload.steps.filter((step): step is Extract<FlowStep, { action: 'launch' }> => step.action === 'launch');
    const appId = launches[0]?.appId;
    if (!appId) throw new Error('Maestro export requires at least one launch step');
    if (launches.some((step) => step.appId !== appId)) throw new Error('Maestro export does not support multiple app ids in one flow');

    const commands: MaestroCommand[] = [];
    for (const step of payload.steps) {
        if (step.action === 'launch') { commands.push('launchApp'); continue; }
        if (step.action === 'terminate') {
            if (step.appId !== appId) throw new Error('Maestro export does not support terminating a different app id');
            commands.push('stopApp');
            continue;
        }
        if (step.action === 'setOrientation') {
            commands.push({ setOrientation: step.orientation === 'portrait' ? 'PORTRAIT' : 'LANDSCAPE_LEFT' });
            continue;
        }
        if (step.action === 'tapText') { commands.push({ tapOn: step.text }); continue; }
        if (step.action === 'assertVisible') { commands.push({ assertVisible: step.text }); continue; }
        if (step.action === 'waitVisible') {
            commands.push({ extendedWaitUntil: { visible: step.text, timeout: step.timeoutMs ?? 10_000 } });
            continue;
        }
        if (step.action === 'waitGone') {
            commands.push({ extendedWaitUntil: { notVisible: step.text, timeout: step.timeoutMs ?? 10_000 } });
            continue;
        }
        if (step.action === 'inputText') {
            commands.push({ tapOn: step.target }, { inputText: step.text });
            continue;
        }
        if (step.action === 'type') { commands.push({ inputText: step.text }); continue; }
        if (step.action === 'home') { commands.push({ pressKey: 'HOME' }); continue; }
        if (step.action === 'volumeUp') { commands.push({ pressKey: 'VOLUME_UP' }); continue; }
        if (step.action === 'volumeDown') { commands.push({ pressKey: 'VOLUME_DOWN' }); continue; }
        throw new Error(`Flow step ${step.action} has no lossless Maestro mapping`);
    }
    return `${stringify({ appId, name: payload.name }).trim()}\n---\n${stringify(commands).trim()}\n`;
}
