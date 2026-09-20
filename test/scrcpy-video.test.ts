import assert from 'node:assert/strict';
import test from 'node:test';

import { scrcpyVideoConfiguration } from '../src/devices/scrcpy-video.js';

test('scrcpy video remains opt-in and validates the matching server version', () => {
    assert.equal(scrcpyVideoConfiguration({}), null);
    assert.deepEqual(scrcpyVideoConfiguration({
        PHONE_FARM_SCRCPY_SERVER_JAR: '/tmp/scrcpy-server.jar',
        PHONE_FARM_SCRCPY_VERSION: '4.0',
        PHONE_FARM_SCRCPY_MAX_SIZE: '1080',
    }), { serverJar: '/tmp/scrcpy-server.jar', version: '4.0', maxSize: 1080 });
    assert.throws(() => scrcpyVideoConfiguration({
        PHONE_FARM_SCRCPY_SERVER_JAR: '/tmp/server.jar',
        PHONE_FARM_SCRCPY_VERSION: 'latest; rm -rf /',
    }), /must look like/);
});
