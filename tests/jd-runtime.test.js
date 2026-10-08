'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { classifyResponse, createRuntime } = require('../function/jd-runtime');

const response = (body, status = 200) => ({ status, text: async () => JSON.stringify(body) });
function harness(replies, config = {}) {
    let time = 0;
    const calls = [];
    const runtime = createRuntime({ now: () => time, sleep: async ms => { time += ms; },
        transport: async (url, options) => { calls.push({ time, url, options }); const reply = replies.shift(); if (reply instanceof Error) throw reply; return reply; }, ...config });
    return { runtime, calls };
}
const query = { url: 'https://api.m.jd.com/client.action', body: 'body={}' };

test('explicit success, empty, login, 403, risk and ended responses stay distinct', () => {
    assert.equal(classifyResponse(200, { code: '0', detailList: [] }).ok, true);
    for (const body of ['', null, 'html']) assert.equal(classifyResponse(200, body).ok, false);
    assert.equal(classifyResponse(200, { code: '3' }).category, '认证阻塞');
    assert.equal(classifyResponse(403, {}).category, '接口异常');
    assert.equal(classifyResponse(200, { code: 411, msg: '账号存在风险，风控' }).stop, true);
    assert.equal(classifyResponse(200, { code: 1, msg: '活动已结束' }).category, '活动结束');
    assert.notEqual(classifyResponse(200, { code: 1, msg: '权益已经发完' }).category, '活动结束');
    assert.equal(classifyResponse(200, { code: 0, success: false }).ok, false);
});

test('concurrent callers execute sequentially with a two second gap', async () => {
    const h = harness([response({ code: 0 }), response({ code: 0 }), response({ code: 0 })]);
    await Promise.all([h.runtime.request(query), h.runtime.request(query), h.runtime.request(query)]);
    assert.deepEqual(h.calls.map(c => c.time), [0, 2000, 4000]);
    assert.equal(h.calls[0].options.redirect, 'manual');
});

test('retry only one timeout or server error; auth and risk stop requests', async () => {
    const timeout = new Error('timeout'); timeout.name = 'TimeoutError';
    for (const first of [timeout, response({}, 503)]) {
        const h = harness([first, response({ code: 0 })]);
        assert.equal((await h.runtime.request(query)).ok, true);
        assert.equal(h.calls.length, 2);
    }
    for (const first of [response({}, 401), response({}, 403), response({ code: 411, msg: '环境异常' })]) {
        const h = harness([first, response({ code: 0 })]);
        await h.runtime.request(query); await h.runtime.request(query);
        assert.equal(h.calls.length, 1);
    }
    const h = harness([new Error('network'), response({ code: 0 })]);
    await h.runtime.request(query); assert.equal(h.calls.length, 1);
});

test('request and elapsed time budgets include retries and waiting', async () => {
    const h = harness([response({ code: 0 }), response({ code: 0 })], { maxRequests: 1 });
    await h.runtime.request(query);
    assert.equal((await h.runtime.request(query)).ok, false);
    assert.equal(h.calls.length, 1);
    const timed = harness([response({ code: 0 }), response({ code: 0 })], { maxDurationMs: 1000 });
    await timed.runtime.request(query); await timed.runtime.request(query);
    assert.equal(timed.calls.length, 1);
});

test('credentials never go to a third party, nonstandard port or redirect', async () => {
    const h = harness([response({ code: 0 })], { cookie: 'pt_key=test_cookie;pt_pin=test_user;' });
    for (const url of ['https://example.com/sign', 'https://api.m.jd.com:8443/', 'https://api.m.jd.com.example.com/', 'file:///etc/passwd']) {
        assert.equal((await h.runtime.request({ url })).ok, false);
    }
    assert.equal(h.calls.length, 0);
    await h.runtime.request({ url: 'http://api.m.jd.com/client.action' });
    assert.equal(h.calls[0].url.startsWith('https://'), true);
});
