'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');

test('daily validator acts only on an explicit sign-in and requires state transition evidence', async () => {
    const { validateJoySign } = await import('../tools/run-daily-jd.mjs');
    const calls = [], task = { id: 5, taskType: 'SIGN', taskFinished: false };
    const replies = [{ ok: true, data: { data: [task] } }, { ok: true }, { ok: true, data: { data: [{ ...task, taskFinished: true }] } }];
    const r = await validateJoySign('test', { request: async options => { calls.push(options); return replies.shift(); } });
    assert.equal(r.businessVerified, true); assert.equal(r.rewardVerified, false);
    assert.equal(calls.length, 3);
    assert.equal(JSON.parse(new URLSearchParams(calls[1].body).get('body')).taskType, 'SIGN');
    for (const type of ['EXCHANGE', 'FOLLOW_SHOP', 'DRAW', 'BUY', 'UNKNOWN']) {
        let count = 0;
        const result = await validateJoySign('test', { request: async () => { count++; return { ok: true, data: { data: [{ ...task, taskType: type }] } }; } });
        assert.equal(count, 1); assert.equal(result.businessVerified, false);
    }
});

test('daily validator stops immediately on 403 or auth failure without claiming sign-in success', async () => {
    const { validateJoySign } = await import('../tools/run-daily-jd.mjs');
    let count = 0;
    const result = await validateJoySign('test', { request: async () => { count++; return count === 1 ? { ok: true, data: { data: [{ id: 5, taskType: 'SIGN', taskFinished: false }] } } : { ok: false, category: '接口异常', status: 403, reason: 'HTTP 403' }; } });
    assert.equal(count, 2); assert.equal(result.businessVerified, false);
});
