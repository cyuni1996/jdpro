'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createTokenReplay } = require('./helpers/token-replay');
const source = fs.readFileSync(path.join(__dirname, '../function/krgetToken.js'), 'utf8');
const replay = createTokenReplay(source);

test('token failures return empty without waiting, retrying or changing cache', async () => {
    const scenarios = [
        {errorStatus: 401}, {errorStatus: 403}, {errorStatus: 503}, {timeout: true},
        {body: ''}, {body: 'not JSON'}, {body: '{}'},
        {body: '{"code":"3","errcode":264}'}, {body: '{"code":"1001","msg":"未登录"}'},
        {body: '{"code":"1","msg":"活动太火爆"}'}, {body: '{"code":"1","msg":"活动已结束"}'},
    ];
    for (const scenario of scenarios) {
        const result = await replay(scenario);
        assert.equal(result.token, ''); assert.equal(result.requests.length, 1);
        assert.equal(result.signatureCalls.length, 1); assert.deepEqual(result.delays, []);
        assert.deepEqual(result.cacheWrites, []); assert.deepEqual(result.cache, {unrelated: 'keep-existing-value'});
    }
});

test('a nominal token success without a nonempty string never writes cache', async () => {
    for (const token of [undefined, null, '', '  ', 7, {}, [], false]) {
        const result = await replay({body: JSON.stringify({code: '0', token})});
        assert.equal(result.token, ''); assert.equal(result.requests.length, 1);
        assert.deepEqual(result.cacheWrites, []); assert.deepEqual(result.delays, []);
        assert.deepEqual(result.cache, {unrelated: 'keep-existing-value'});
    }
});

test('valid synthetic tokens preserve caching and the configured success interval', async () => {
    for (const successInterval of [0, 2]) {
        const result = await replay({body: '{"code":"0","token":"dummy-isv-token"}', successInterval, customSigner: successInterval > 0});
        assert.equal(result.token, 'dummy-isv-token'); assert.equal(result.requests.length, 1);
        assert.equal(result.cacheWrites.length, 1); assert.equal(result.cacheWrites[0].value, 'dummy-isv-token');
        assert.deepEqual(result.delays, [successInterval * 1000]);
        assert.equal(result.requests[0].options.followRedirect, false);
        assert.equal(result.requests[0].options.timeout, 10000);
        assert.equal(result.requests[0].options.retry.limit, 0);
    }
    const cached = await replay({cached: 'dummy-cached-token'});
    assert.equal(cached.token, 'dummy-cached-token'); assert.deepEqual(cached.requests, []);
    assert.deepEqual(cached.signatureCalls, []); assert.deepEqual(cached.cacheWrites, []);
});
