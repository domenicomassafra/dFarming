import assert from 'node:assert/strict';
import test from 'node:test';

import { bearerMatches, bearerToken } from '../src/security/bearer.js';
import { sameOriginAllowed, trustedOrigins } from '../src/api/http-security.js';

test('Bearer parsing rejects empty credentials and compares configured tokens', () => {
    assert.equal(bearerToken(undefined), undefined);
    assert.equal(bearerToken('Basic x'), undefined);
    assert.equal(bearerToken('Bearer '), undefined);
    assert.equal(bearerToken('Bearer   '), undefined);
    assert.equal(bearerToken('Bearer secret'), 'secret');
    assert.equal(bearerMatches('Bearer secret', 'secret'), true);
    assert.equal(bearerMatches('Bearer other', 'secret'), false);
});

test('same-origin host comparison tolerates TLS termination but not host rewrites', () => {
    assert.equal(sameOriginAllowed('http://127.0.0.1:4050', '127.0.0.1:4050'), true);
    assert.equal(sameOriginAllowed('https://example.test', 'example.test'), true);
    assert.equal(sameOriginAllowed('https://example.test:18443', 'example.test:18443'), true);
    assert.equal(sameOriginAllowed('https://evil.test', 'example.test'), false);
    assert.equal(sameOriginAllowed('not a url', 'example.test'), false);
});

test('trusted origin configuration is trimmed, normalized and empty-safe', () => {
    assert.deepEqual(
        trustedOrigins(' https://one.example/ ', 'https://two.example/, ,https://three.example///'),
        ['https://one.example', 'https://two.example', 'https://three.example'],
    );
});
