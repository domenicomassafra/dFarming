import assert from 'node:assert/strict';
import test from 'node:test';

import { DFarmingAgentClient } from '../src/agent/client.js';
import { runAgentCli } from '../src/agent/cli.js';

test('agent CLI exposes bounded cross-platform observe and act commands', async () => {
    const requests: Array<{ pathname: string; method: string; body?: unknown }> = [];
    const client = new DFarmingAgentClient({
        fetchImpl: async (input, init) => {
            const request = new Request(input, init);
            requests.push({
                pathname: new URL(request.url).pathname + new URL(request.url).search,
                method: request.method,
                ...(init?.body ? { body: JSON.parse(String(init.body)) as unknown } : {}),
            });
            return Response.json({ ok: true });
        },
    });

    await runAgentCli(['devices'], client);
    await runAgentCli(['observe', '--udid', 'SIM 1', '--query', 'Done', '--max-nodes', '50'], client);
    await runAgentCli(['tap-text', '--udid', 'SIM 1', '--text', 'done_button', '--exact'], client);
    await runAgentCli(['system', '--udid', 'SIM 1', '--action', 'home'], client);
    await runAgentCli(['app', '--udid', 'SIM 1', '--action', 'launch', '--app-id', 'com.example.app'], client);

    assert.equal(requests[0]?.pathname, '/api/devices');
    assert.equal(requests[1]?.pathname, '/api/devices/SIM%201/agent/observe?query=Done&maxNodes=50');
    assert.deepEqual(requests[2]?.body, { text: 'done_button', exact: true });
    assert.deepEqual(requests[3]?.body, { type: 'home' });
    assert.deepEqual(requests[4]?.body, { type: 'launch', appId: 'com.example.app' });
});

test('agent CLI rejects unsupported direct actions', async () => {
    const client = new DFarmingAgentClient({ fetchImpl: async () => Response.json({ ok: true }) });
    await assert.rejects(runAgentCli(['system', '--udid', 'x', '--action', 'shell'], client), /--action must be/);
    await assert.rejects(runAgentCli(['app', '--udid', 'x', '--action', 'clear', '--app-id', 'com.example'], client), /--action must be/);
});
