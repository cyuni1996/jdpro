'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createTokenReplay } = require('./helpers/token-replay');
const replay = createTokenReplay(fs.readFileSync(path.join(__dirname, '../function/krgetToken.js'), 'utf8'));
const success = {body: '{"code":"0","token":"dummy-fresh-token"}'};

test('invalid local token cache entries cannot be returned as authenticated tokens', async () => {
    for (const cached of ['  ', 7, {}, [], true]) {
        const result = await replay({...success, cached});
        assert.equal(result.token, 'dummy-fresh-token');
        assert.equal(result.requests.length, 1);
        assert.equal(result.cacheWrites.length, 1);
    }
});

test('invalid Redis token cache entries fall through to one official request', async () => {
    for (const redisCached of ['  ', 7, {}, [], true]) {
        const result = await replay({...success, redis: true, redisCached});
        assert.equal(result.token, 'dummy-fresh-token');
        assert.equal(result.redisReads.length, 1);
        assert.equal(result.requests.length, 1);
    }
    const cached = await replay({redis: true, redisCached: 'dummy-redis-token'});
    assert.equal(cached.token, 'dummy-redis-token');
    assert.equal(cached.redisReads.length, 1);
    assert.deepEqual(cached.signatureCalls, []);
    assert.deepEqual(cached.requests, []);
    assert.deepEqual(cached.cacheWrites, []);
});

test('a Redis read rejection does not abort official token handling', async () => {
    const result = await replay({...success, redis: true, redisGetFailure: true});
    assert.equal(result.token, 'dummy-fresh-token');
    assert.equal(result.redisReads.length, 1);
    assert.equal(result.signatureCalls.length, 1);
    assert.equal(result.requests.length, 1);
});

test('invalid cache entries and a rejected Redis read do not disguise HTTP 403', async () => {
    const result = await replay({cached: {}, redis: true, redisGetFailure: true, errorStatus: 403});
    assert.equal(result.token, '');
    assert.equal(result.redisReads.length, 1);
    assert.equal(result.requests.length, 1);
    assert.deepEqual(result.cacheWrites, []);
    assert.deepEqual(result.delays, []);
    assert.deepEqual(result.cache, {unrelated: 'keep-existing-value'});
});
