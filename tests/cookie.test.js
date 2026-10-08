'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const { parseCookies, filterCookies } = require('../function/cookie');
const a = 'pt_key=test_key_a;pt_pin=account_a;';
const b = 'pt_key=test_key_b;pt_pin=account_ab;';
const cn = 'pt_key=test_key_c;pt_pin=%E6%B5%8B%E8%AF%95;';

test('mixed separators, whitespace and duplicate cookies', () => {
    assert.deepEqual(parseCookies(`  ${a}&${b}\r\n${cn}\n${a}\n  `), [a, b, cn]);
});
test('an unmatched allowlist runs no accounts', () => {
    assert.deepEqual(filterCookies([a, b], { ALLOWPIN: 'missing' }), []);
});
test('pins match exactly instead of matching account name prefixes', () => {
    assert.deepEqual(filterCookies([a, b], { BANPIN: 'account_a' }), [b]);
    assert.deepEqual(filterCookies([a, b], { ALLOWPIN: 'account_a' }), [a]);
});
test('rules apply only to their selected tasks', () => {
    assert.deepEqual(filterCookies([a, b], { ALLOWPIN: 'fruit@missing' }, 'jd_plantBean.js'), [a, b]);
    assert.deepEqual(filterCookies([a, b], { ALLOWPIN: 'fruit|plant@missing' }, 'jd_fruit.js'), []);
});
test('multiple task groups preserve allowlist ordering and respect bans', () => {
    assert.deepEqual(filterCookies([a, b, cn], {
        ALLOWPIN: 'fruit@account_ab,account_a&fruit@测试', BANPIN: 'account_a',
    }, 'jd_fruit.js'), [b, cn]);
});
test('encoded and decoded Chinese pins match the same account', () => {
    assert.deepEqual(filterCookies([cn], { ALLOWPIN: '测试' }), [cn]);
    assert.deepEqual(filterCookies([cn], { BANPIN: '%E6%B5%8B%E8%AF%95' }), []);
});
test('a malformed pin does not prevent processing other accounts', () => {
    const bad = 'pt_key=test_key_d;pt_pin=%invalid;';
    assert.deepEqual(filterCookies([a, bad], { BANPIN: '%invalid' }), [a]);
});
test('empty matching allowlist stays closed', () => {
    assert.deepEqual(filterCookies([a], { ALLOWPIN: 'fruit@' }, 'jd_fruit.js'), []);
});
test('the exported CookieJD names remain compatible and no credentials are logged', () => {
    const secret = 'test_secret_must_not_be_logged';
    const env = { ...process.env, JD_COOKIE: `pt_key=${secret};pt_pin=account_a\n${b}`, JD_DEBUG: 'true' };
    for (const key of ['ALLOWPIN', 'BANPIN', 'DP_POOL', 'PERMIT_JS', 'ShareCodeConfigChineseName', 'ShareCodeConfigName', 'ShareCodeEnvName']) delete env[key];
    const child = spawnSync(process.execPath, ['-e', 'const ck=require("./jdCookie"); console.log(JSON.stringify(Object.keys(ck)))'], {
        cwd: path.resolve(__dirname, '..'), env, encoding: 'utf8', timeout: 5000,
    });
    assert.equal(child.status, 0, child.stderr);
    assert.ok(child.stdout.includes('["CookieJD","CookieJD2"]'));
    assert.ok(!child.stdout.includes(secret));
    assert.ok(!child.stdout.includes('test_key_b'));
});
test('an empty PERMIT_JS enables the documented proxy pool default', () => {
    const fs = require('node:fs');
    const vm = require('node:vm');
    const calls = [];
    const context = {
        exports: {}, global: {}, console: { log() {} },
        process: { env: { DP_POOL: 'http://127.0.0.1:8888' }, argv: ['node', 'jd_test.js'] },
        require(name) {
            if (name === './function/cookie') return require('../function/cookie');
            if (name === 'global-agent') return { bootstrap() {
                calls.push(name); context.global.GLOBAL_AGENT = {};
            } };
            throw new Error(`Unexpected module: ${name}`);
        },
    };
    // Only the maintained, readable cookie loader is evaluated; legacy task code is never run.
    vm.runInNewContext(fs.readFileSync(path.resolve(__dirname, '../jdCookie.js'), 'utf8'), context, { timeout: 1000 });
    assert.deepEqual(calls, ['global-agent']);
    assert.equal(context.global.GLOBAL_AGENT.HTTP_PROXY, 'http://127.0.0.1:8888');
});
