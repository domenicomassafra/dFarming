import assert from 'node:assert/strict';
import test from 'node:test';

import { dfarmingEnv } from '../src/env.js';

test('DFARMING_* is canonical and wins over the legacy PHONE_FARM_* alias', () => {
    const env = { DFARMING_ROLE: 'control-plane', PHONE_FARM_ROLE: 'device-worker' };
    assert.equal(dfarmingEnv('ROLE', env), 'control-plane');
});

test('legacy PHONE_FARM_* configuration remains readable during migration', () => {
    const env = { PHONE_FARM_WORKER_ID: 'legacy-worker' };
    assert.equal(dfarmingEnv('WORKER_ID', env), 'legacy-worker');
});
