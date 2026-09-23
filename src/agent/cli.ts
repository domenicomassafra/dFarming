import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { DFarmingAgentClient } from './client.js';

function option(args: string[], name: string): string | undefined {
    const index = args.indexOf(name);
    return index >= 0 ? args[index + 1] : undefined;
}

function required(args: string[], name: string): string {
    const value = option(args, name);
    if (!value) throw new Error(`${name} is required`);
    return value;
}

function present(args: string[], name: string): boolean {
    return args.includes(name);
}

function semanticOptions(args: string[]): { type?: string; exact?: boolean; timeoutMs?: number; pollMs?: number } {
    return {
        ...(option(args, '--type') ? { type: option(args, '--type') } : {}),
        ...(present(args, '--exact') ? { exact: true } : {}),
        ...(option(args, '--timeout-ms') ? { timeoutMs: Number(option(args, '--timeout-ms')) } : {}),
        ...(option(args, '--poll-ms') ? { pollMs: Number(option(args, '--poll-ms')) } : {}),
    };
}

async function readStdin(): Promise<string> {
    const chunks: Buffer[] = [];
    for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
    return Buffer.concat(chunks).toString('utf8').replace(/\r?\n$/, '');
}

export async function runAgentCli(args = process.argv.slice(2), client = new DFarmingAgentClient()): Promise<unknown> {
    const [command] = args;
    if (command === 'health') return client.health();
    if (command === 'accounts') return client.accounts();
    if (command === 'devices') return client.devices();
    if (command === 'observe') {
        return client.observe(required(args, '--udid'), {
            ...(option(args, '--query') ? { query: option(args, '--query') } : {}),
            ...(option(args, '--max-nodes') ? { maxNodes: Number(option(args, '--max-nodes')) } : {}),
        });
    }
    if (command === 'snapshot') {
        return client.snapshot(required(args, '--udid'), {
            ...(option(args, '--query') ? { query: option(args, '--query') } : {}),
            ...(option(args, '--max-nodes') ? { maxNodes: Number(option(args, '--max-nodes')) } : {}),
        });
    }
    if (command === 'tap') {
        const generation = Number(required(args, '--generation'));
        if (!Number.isInteger(generation) || generation < 1) throw new Error('--generation must be a positive integer');
        return client.tapRef(required(args, '--udid'), generation, required(args, '--ref'));
    }
    if (command === 'wait') {
        return client.waitForText(required(args, '--udid'), required(args, '--text'), semanticOptions(args));
    }
    if (command === 'wait-gone') {
        return client.waitForTextGone(required(args, '--udid'), required(args, '--text'), semanticOptions(args));
    }
    if (command === 'tap-text') {
        return client.tapText(required(args, '--udid'), required(args, '--text'), semanticOptions(args));
    }
    if (command === 'type') {
        const text = await readStdin();
        if (!text) throw new Error('type reads sensitive text from stdin; provide 1–4000 characters');
        return client.typeText(required(args, '--udid'), text);
    }
    if (command === 'input') {
        const text = await readStdin();
        if (!text) throw new Error('input reads sensitive text from stdin; provide 1–4000 characters');
        return client.inputText(required(args, '--udid'), required(args, '--target'), text, semanticOptions(args));
    }
    if (command === 'system') {
        const action = required(args, '--action');
        if (!['home', 'lock', 'wake', 'unlock', 'volumeUp', 'volumeDown'].includes(action)) {
            throw new Error('--action must be home, lock, wake, unlock, volumeUp, or volumeDown');
        }
        return client.system(
            required(args, '--udid'),
            action as 'home' | 'lock' | 'wake' | 'unlock' | 'volumeUp' | 'volumeDown',
        );
    }
    if (command === 'app') {
        const action = required(args, '--action');
        if (action !== 'launch' && action !== 'terminate') throw new Error('--action must be launch or terminate');
        return client.app(required(args, '--udid'), action, required(args, '--app-id'));
    }
    throw new Error(
        'Usage: agent:client <health|accounts|devices|observe|snapshot|tap|tap-text|wait|wait-gone|type|input|system|app> [options]. '
        + '`type` and `input` read sensitive text from stdin.',
    );
}

async function main(): Promise<void> {
    try {
        console.log(JSON.stringify(await runAgentCli(), null, 2));
    } catch (error) {
        console.error(error instanceof Error ? error.message : String(error));
        process.exitCode = 1;
    }
}

const entrypoint = process.argv[1] ? path.resolve(process.argv[1]) : '';
if (entrypoint && fileURLToPath(import.meta.url) === entrypoint) await main();
