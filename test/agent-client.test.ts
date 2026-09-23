import assert from 'node:assert/strict';
import test from 'node:test';

import { DFarmingAgentClient } from '../src/agent/client.js';

test('agent client refuses unauthenticated non-loopback farm URLs', () => {
    assert.throws(() => new DFarmingAgentClient({ baseUrl: 'https://farm.example' }), /TOKEN is required/);
});

test('agent client uses semantic endpoints and bearer auth without raw-coordinate helpers', async () => {
    const requests: Array<{ url: string; method: string; authorization: string | null; body?: string }> = [];
    const fetchImpl: typeof fetch = async (input, init) => {
        const request = new Request(input, init);
        requests.push({
            url: request.url, method: request.method, authorization: request.headers.get('authorization'),
            ...(init?.body ? { body: String(init.body) } : {}),
        });
        return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'content-type': 'application/json' } });
    };
    const client = new DFarmingAgentClient({ baseUrl: 'https://farm.example/base/', token: 'secret-token', fetchImpl });
    await client.snapshot('udid / one', { query: 'Continue', maxNodes: 42 });
    await client.tapRef('udid / one', 3, 'e2');
    await client.typeText('udid / one', 'secret body');
    await client.observe('udid / one', { query: 'Done', maxNodes: 20 });
    await client.videoCapabilities('udid / one');
    await client.act('udid / one', { kind: 'tapText', text: 'continue_button', exact: true });
    await client.act('udid / one', { kind: 'app', action: 'launch', appId: 'com.example.app' });
    assert.match(requests[0]!.url, /\/api\/devices\/udid%20%2F%20one\/semantic\/snapshot\?query=Continue&maxNodes=42$/);
    assert.equal(requests.every(({ authorization }) => authorization === 'Bearer secret-token'), true);
    assert.deepEqual(JSON.parse(requests[1]!.body ?? '{}'), { generation: 3, ref: 'e2' });
    assert.match(requests[3]!.url, /\/api\/devices\/udid%20%2F%20one\/agent\/observe\?query=Done&maxNodes=20$/);
    assert.match(requests[4]!.url, /\/api\/devices\/udid%20%2F%20one\/remote\/video-capabilities$/);
    assert.deepEqual(JSON.parse(requests[5]!.body ?? '{}'), { text: 'continue_button', exact: true });
    assert.deepEqual(JSON.parse(requests[6]!.body ?? '{}'), { type: 'launch', appId: 'com.example.app' });
});

test('agent client surfaces farm refusals instead of bypassing them', async () => {
    const client = new DFarmingAgentClient({
        fetchImpl: async () => new Response(JSON.stringify({ error: 'Semantic input is disabled while automation is running' }), {
            status: 409, headers: { 'content-type': 'application/json' },
        }),
    });
    await assert.rejects(client.tapRef('udid', 1, 'e1'), /409.*disabled while automation is running/);
});
