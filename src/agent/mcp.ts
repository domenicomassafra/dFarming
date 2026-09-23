import { McpServer } from '@modelcontextprotocol/server';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import * as z from 'zod/v4';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { DFarmingAgentClient } from './client.js';

function result(value: unknown) {
    return { content: [{ type: 'text' as const, text: JSON.stringify(value) }] };
}

export function buildDFarmingMcpServer(client = new DFarmingAgentClient()): McpServer {
    const server = new McpServer({ name: 'dfarming', version: '0.2.0' }, { capabilities: { tools: {} } });
    server.registerTool('farm_health', {
        description: 'Read the dFarming health endpoint.',
        inputSchema: z.object({}),
        annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
    }, async () => result(await client.health()));
    server.registerTool('farm_accounts', {
        description: 'List configured owner-controlled social accounts and their device/policy state.',
        inputSchema: z.object({}),
        annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
    }, async () => result(await client.accounts()));
    server.registerTool('farm_snapshot', {
        description: 'Read a compact semantic accessibility snapshot for one registered iPhone. Use returned refs for actions.',
        inputSchema: z.object({
            udid: z.string().min(1), query: z.string().min(1).optional(), maxNodes: z.number().int().min(1).max(500).optional(),
        }),
        annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
    }, async ({ udid, query, maxNodes }) => result(await client.snapshot(udid, { query, maxNodes })));
    server.registerTool('farm_wait_text', {
        description: 'Wait for semantic UI text on one iPhone and return the matching current snapshot.',
        inputSchema: z.object({
            udid: z.string().min(1), text: z.string().min(1), type: z.string().optional(),
            timeoutMs: z.number().int().min(0).max(30_000).optional(), pollMs: z.number().int().min(100).max(2_000).optional(),
        }),
        annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
    }, async ({ udid, text, type, timeoutMs, pollMs }) => result(await client.waitForText(udid, text, { type, timeoutMs, pollMs })));
    server.registerTool('farm_tap_ref', {
        description: 'Tap a semantic element ref from the current snapshot generation. Refuses stale refs and active automation conflicts.',
        inputSchema: z.object({ udid: z.string().min(1), generation: z.number().int().min(1), ref: z.string().regex(/^e\d+$/) }),
        annotations: { readOnlyHint: false, idempotentHint: false, openWorldHint: false },
    }, async ({ udid, generation, ref }) => result(await client.tapRef(udid, generation, ref)));
    server.registerTool('farm_type_text', {
        description: 'Type text into the currently focused iPhone field. dFarming traces retain only text length, not content.',
        inputSchema: z.object({ udid: z.string().min(1), text: z.string().min(1).max(4000) }),
        annotations: { readOnlyHint: false, idempotentHint: false, openWorldHint: false },
    }, async ({ udid, text }) => result(await client.typeText(udid, text)));
    server.registerTool('dfarming_observe', {
        description: 'Read one structured dFarming device observation: runtime identity, screen, lock state, scheduler ownership and compact semantic UI.',
        inputSchema: z.object({
            udid: z.string().min(1),
            query: z.string().min(1).optional(),
            maxNodes: z.number().int().min(1).max(500).optional(),
        }),
        annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
    }, async ({ udid, query, maxNodes }) => result(await client.observe(udid, { query, maxNodes })));
    server.registerTool('dfarming_act', {
        description: 'Perform one policy-gated semantic/system/app action on a dFarming device. Prefer tapText/inputText over raw coordinates.',
        inputSchema: z.object({
            udid: z.string().min(1),
            action: z.discriminatedUnion('kind', [
                z.object({ kind: z.literal('tapRef'), generation: z.number().int().min(1), ref: z.string().regex(/^e\d+$/) }),
                z.object({
                    kind: z.literal('tapText'), text: z.string().min(1).max(240), type: z.string().max(80).optional(),
                    exact: z.boolean().optional(), timeoutMs: z.number().int().min(0).max(30_000).optional(),
                    pollMs: z.number().int().min(100).max(2_000).optional(),
                }),
                z.object({ kind: z.literal('type'), text: z.string().min(1).max(4_000) }),
                z.object({
                    kind: z.literal('inputText'), target: z.string().min(1).max(240), text: z.string().min(1).max(4_000),
                    type: z.string().max(80).optional(), exact: z.boolean().optional(),
                    timeoutMs: z.number().int().min(0).max(30_000).optional(), pollMs: z.number().int().min(100).max(2_000).optional(),
                }),
                z.object({ kind: z.literal('system'), action: z.enum(['home', 'lock', 'wake', 'unlock', 'volumeUp', 'volumeDown']) }),
                z.object({ kind: z.literal('app'), action: z.enum(['launch', 'terminate']), appId: z.string().min(2).max(255) }),
            ]),
        }),
        annotations: { readOnlyHint: false, idempotentHint: false, openWorldHint: false },
    }, async ({ udid, action }) => result(await client.act(udid, action)));
    return server;
}

const entrypoint = process.argv[1] ? path.resolve(process.argv[1]) : '';
if (entrypoint && fileURLToPath(import.meta.url) === entrypoint) {
    serveStdio(() => buildDFarmingMcpServer());
}

/** @deprecated Use buildDFarmingMcpServer. */
export const buildFarmMcpServer = buildDFarmingMcpServer;
