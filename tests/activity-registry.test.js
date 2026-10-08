'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { evaluateActivity, deduplicateActivities } = require('../function/activity-registry');
const now = Date.parse('2026-10-08T10:00:00+08:00');
const old = { name: '翻倍挑战', activityId: '2MsVcneB4n8Nf77eHN1DPNcMurkx', url: 'https://h5.m.jd.com/pb/013640630/2MsVcneB4n8Nf77eHN1DPNcMurkx/index.html', start: '2023-12-26T00:00:00+08:00', end: '2024-12-31T23:59:59+08:00' };
test('still-accessible old official rules never become a new activity', () => {
    assert.equal(evaluateActivity(old, now).state, '活动结束');
    assert.equal(evaluateActivity({ ...old, start: undefined }, now).state, '未验证');
});
test('deduplicate by name, canonical entrance and ID; verified new scripts remain disabled', () => {
    assert.equal(deduplicateActivities([old, { ...old, url: old.url + '?source=test#rule' }]).length, 1);
    const fresh = { ...old, start: '2026-10-01T00:00:00+08:00', end: '2026-10-31T23:59:59+08:00' };
    assert.equal(evaluateActivity(fresh, now).state, '未验证');
    assert.deepEqual(evaluateActivity({ ...fresh, freeDaily: true, eligibilityVerified: true, liveSuccess: true }, now), { state: '可用', reason: '规则及单账号业务成功已验证；新脚本默认关闭', enabled: false });
});
