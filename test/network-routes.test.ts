import assert from 'node:assert/strict';
import test from 'node:test';

import { networkRouteAvailable, parseNetworkRouteAttestations } from '../src/network-routes.js';

test('network route attestations expose ids and optional device scope without secrets', () => {
    const routes = parseNetworkRouteAttestations(JSON.stringify([
        { id: 'Italy.Private', deviceUdids: ['phone-a', 'phone-a'] },
        { id: 'testing-us' },
    ]));
    assert.deepEqual(routes, [
        { id: 'italy.private', deviceUdids: ['phone-a'] },
        { id: 'testing-us' },
    ]);
    assert.equal(networkRouteAvailable(routes, 'italy.private', 'phone-a'), true);
    assert.equal(networkRouteAvailable(routes, 'italy.private', 'phone-b'), false);
    assert.equal(networkRouteAvailable(routes, 'testing-us', 'phone-b'), true);
    assert.equal(JSON.stringify(routes).includes('password'), false);
});

test('network route shorthand accepts comma-separated ids and rejects duplicates', () => {
    assert.deepEqual(parseNetworkRouteAttestations('direct, staging-eu'), [{ id: 'direct' }, { id: 'staging-eu' }]);
    assert.throws(() => parseNetworkRouteAttestations('direct,direct'), /Duplicate/);
});
