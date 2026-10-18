'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createTokenReplay } = require('./helpers/token-replay');
const { tokenTtlFixture, readTokenTtl } = require('./helpers/token-ttl-replay');
const source = fs.readFileSync(path.join(__dirname, '../function/krgetToken.js'), 'utf8');
const fixture = tokenTtlFixture(source);
const replay = createTokenReplay(source, fixture);
const invalid = ['', ' ', '0', '-1', '1.5', '1.0', '1e2', '0x10', '+2', '2minutes', 'NaN', 'Infinity', '150119987580', '9'.repeat(400)];

test('positive integer token cache minutes retain their millisecond duration', () => {
    for (const [value, expected] of [['1', 60000], ['25', 1500000], [' 10 ', 600000], ['001', 60000], ['150119987579', 9007199254740000]]) {
        assert.equal(readTokenTtl(source, value, fixture), expected, value);
    }
});

test('invalid token cache minutes fall back to the documented 25 minutes', () => {
    for (const value of invalid) assert.equal(readTokenTtl(source, value, fixture), 1500000, value);
});

test('normalized TTL reaches both raw local and atomic Redis writes', async () => {
    for (const value of [...invalid, '2']) {
        const cacheTtlMs = readTokenTtl(source, value, fixture);
        const r = await replay({cacheTtlMs, redis: true, redisSubmit: true, body: '{"code":"0","token":"dummy-fresh-token"}'});
        assert.equal(r.token, 'dummy-fresh-token');
        assert.equal(r.requests.length, 1);
        assert.equal(r.cacheWrites.length, 1);
        assert.equal(r.cacheWrites[0].ttl, value === '2' ? 120000 : 1500000);
        assert.equal(r.redisCommands.length, 1);
        assert.equal(r.redisState['dummy-account'].ttlMs, r.cacheWrites[0].ttl);
    }
});

test('fallback TTL expires a newly cached token in the real cache source', () => {
    const ttl = readTokenTtl(source, 'invalid', fixture);
    const context = vm.createContext(Object.create(null), {codeGeneration: {strings: false, wasm: false}});
    vm.runInContext(`let clock = 1000; Date = class { getTime() { return clock; } };
        function DS() {} DS.prototype.save = function() {};
        function require(name) { if (name !== 'ds') throw new Error('Unreviewed module'); return DS; }
        const module = {exports: {}};`, context, {timeout: 100});
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../function/cache/index.js'), 'utf8'), context, {timeout: 1000});
    const result = JSON.parse(vm.runInContext(`(() => {
        const cache = new module.exports(${ttl}); cache.put('dummy', 'dummy-token');
        clock = 1500999; const before = cache.get('dummy');
        clock = 1501000; const after = cache.get('dummy');
        return JSON.stringify({before, after, removed: !Object.hasOwn(cache.data, 'dummy')});
    })()`, context, {timeout: 100}));
    assert.deepEqual(result, {before: 'dummy-token', after: null, removed: true});
});

test('normalized TTL does not make failures write tokens or bypass cache hits', async () => {
    const cacheTtlMs = readTokenTtl(source, 'invalid', fixture);
    for (const scenario of [{errorStatus: 403}, {timeout: true}, {body: '{"code":"1001"}'}, {body: '{"code":"1","msg":"活动太火爆"}'}]) {
        const r = await replay({...scenario, cacheTtlMs, redis: true, redisSubmit: true});
        assert.equal(r.token, ''); assert.deepEqual(r.cacheWrites, []); assert.deepEqual(r.redisCommands, []);
        assert.equal(r.requests.length, 1); assert.deepEqual(r.delays, []);
    }
    const hit = await replay({cached: 'dummy-hit', cacheTtlMs});
    assert.equal(hit.token, 'dummy-hit'); assert.deepEqual(hit.requests, []); assert.deepEqual(hit.cacheWrites, []);
});
