import assert from 'node:assert/strict';
import test from 'node:test';

import { physicalIosLaneEnabled } from '../src/runtime-options.js';

test('physical iOS lane has one default and one explicit disable switch', () => {
    assert.equal(physicalIosLaneEnabled({}), true);
    assert.equal(physicalIosLaneEnabled({ DFARMING_ENABLE_PHYSICAL_IOS: 'true' }), true);
    assert.equal(physicalIosLaneEnabled({ DFARMING_ENABLE_PHYSICAL_IOS: 'false' }), false);
});
