import { McpServer } from '@modelcontextprotocol/server';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import * as z from 'zod/v4';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { FarmAgentClient } from './client.js';

function result(value: unknown) {
    return { content: [{ type: 'text' as const, text: JSON.stringify(value) }] };
}

export function buildFarmMcpServer(client = new FarmAgentClient()): McpServer {
    const server = new McpServer({ name: 'phone-farm', version: '0.1.0' }, { capabilities: { tools: {} } });
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
        description: 'Type text into the currently focused iPhone field. Farm traces retain only text length, not content.',
        inputSchema: z.object({ udid: z.string().min(1), text: z.string().min(1).max(4000) }),
        annotations: { readOnlyHint: false, idempotentHint: false, openWorldHint: false },
    }, async ({ udid, text }) => result(await client.typeText(udid, text)));
    return server;
}

const entrypoint = process.argv[1] ? path.resolve(process.argv[1]) : '';
if (entrypoint && fileURLToPath(import.meta.url) === entrypoint) {
    serveStdio(() => buildFarmMcpServer());
}
