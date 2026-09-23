import assert from 'node:assert/strict';
import test from 'node:test';

import {
    accountPolicy,
    configuredAccounts,
    listFleetAccounts,
    normalizeSocialHandle,
    validateAccountTaskPolicy,
    validateConfiguredAccount,
    withAccountPolicy,
} from '../src/accounts.js';

test('social handles normalize and invalid configured values are ignored', () => {
    assert.equal(normalizeSocialHandle('alpha.one', 'tiktok'), '@alpha.one');
    assert.deepEqual(configuredAccounts({ accounts: ['alpha', '@alpha', '@beta.two', 'bad handle'] }, 'tiktok'), [
        '@alpha', '@beta.two',
    ]);
});

test('account policies can pause a handle or allow-list task types', () => {
    const paused = withAccountPolicy({ accounts: ['@owner'] }, '@owner', 'tiktok', { paused: true, note: 'manual review' });
    assert.deepEqual(accountPolicy(paused, '@owner', 'tiktok'), { paused: true, note: 'manual review' });
    assert.throws(() => validateAccountTaskPolicy('@owner', 'post', paused, 'tiktok'), /paused: manual review/);

    const restricted = withAccountPolicy({ accounts: ['@owner'] }, '@owner', 'tiktok', { allowedTaskTypes: ['post'] });
    validateAccountTaskPolicy('@owner', 'post', restricted, 'tiktok');
    assert.throws(() => validateAccountTaskPolicy('@owner', 'doomscroll', restricted, 'tiktok'), /does not allow doomscroll/);
});

test('account policies persist a validated execution profile identity and constraints', () => {
    const configured = withAccountPolicy({ accounts: ['@owner'] }, '@owner', 'tiktok', {
        executionProfile: {
            id: 'Owner.Primary', dedicatedDeviceUdid: 'phone-a',
            requiredTags: ['Creator', 'creator'], networkRouteId: 'Italy.Private',
        },
    });
    assert.deepEqual(accountPolicy(configured, '@owner', 'tiktok'), {
        executionProfile: {
            id: 'owner.primary', dedicatedDeviceUdid: 'phone-a',
            requiredTags: ['creator'], networkRouteId: 'italy.private',
        },
    });
    assert.throws(() => withAccountPolicy({ accounts: ['@owner'] }, '@owner', 'tiktok', {
        executionProfile: { id: 'bad id' },
    }), /executionProfile/);
});

test('task account targets must belong to the device plugin configuration', () => {
    const data = { accounts: ['@owner', '@second'] };
    assert.equal(validateConfiguredAccount('owner', data, 'instagram'), '@owner');
    assert.throws(() => validateConfiguredAccount('@missing', data, 'instagram'), /not configured/);
});

test('fleet account inventory is redacted and carries device availability', () => {
    const result = listFleetAccounts([{
        name: 'Phone A', udid: 'udid-a', disabled: true, passcode: '123456',
        pluginData: {
            'com.dfarming.tiktok': { accounts: ['@alpha'] },
            'com.dfarming.instagram': { accounts: ['@bravo'] },
        },
    }]);
    assert.deepEqual(result, [
        {
            platform: 'instagram', pluginId: 'com.dfarming.instagram', handle: '@bravo',
            deviceUdid: 'udid-a', deviceName: 'Phone A', deviceDisabled: true,
        },
        {
            platform: 'tiktok', pluginId: 'com.dfarming.tiktok', handle: '@alpha',
            deviceUdid: 'udid-a', deviceName: 'Phone A', deviceDisabled: true,
        },
    ]);
    assert.equal(JSON.stringify(result).includes('123456'), false);
});
