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

async function readStdin(): Promise<string> {
    const chunks: Buffer[] = [];
    for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
    return Buffer.concat(chunks).toString('utf8').replace(/\r?\n$/, '');
}

export async function runAgentCli(args = process.argv.slice(2), client = new DFarmingAgentClient()): Promise<unknown> {
    const [command] = args;
    if (command === 'health') return client.health();
    if (command === 'accounts') return client.accounts();
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
        return client.waitForText(required(args, '--udid'), required(args, '--text'), {
            ...(option(args, '--type') ? { type: option(args, '--type') } : {}),
            ...(option(args, '--timeout-ms') ? { timeoutMs: Number(option(args, '--timeout-ms')) } : {}),
        });
    }
    if (command === 'type') {
        const text = await readStdin();
        if (!text) throw new Error('type reads sensitive text from stdin; provide 1–4000 characters');
        return client.typeText(required(args, '--udid'), text);
    }
    throw new Error('Usage: agent:client <health|accounts|snapshot|tap|wait|type> [options]. `type` reads text from stdin.');
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
