'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { parse } = require('acorn');
const { collectBeanDetails, formatBeanIncome } = require('../function/bean-statistics');
const { taskItems, pendingTasks, assignWorkers } = require('../function/joy-safe');
const { attachLegacy } = require('../function/jd-runtime');
const now = () => Date.parse('2026-10-08T12:00:00+08:00');
const row = (date, amount, eventMassage = '签到') => ({ date, amount, eventMassage });
const ok = detailList => ({ ok: true, data: { detailList } });

test('complete details sum income and exclude refunds/logistics', async () => {
    const pages = [ok([row('2026-10-08 11:00:00', '4'), row('2026-10-08 10:00:00', '2'), row('2026-10-08 09:00:00', '50', '物流补偿'), row('2026-10-07 21:00:00', '-2'), row('2026-10-06 23:59:59', '9')])];
    const r = await collectBeanDetails(async () => pages.shift(), { now });
    assert.equal(r.known, true); assert.equal(r.todayIncome, 6); assert.equal(r.yesterdayExpense, 2); assert.equal(r.events.签到, 6);
});

test('valid empty list is zero; failed or partial queries are unknown', async () => {
    const empty = await collectBeanDetails(async () => ok([]), { now });
    assert.equal(empty.known, true); assert.equal(empty.todayIncome, 0);
    for (const reason of ['未登录', 'HTTP 403', '风控', '活动已结束', '请求超时', '空响应']) {
        const pages = [ok([row('2026-10-08 11:00:00', '5')]), { ok: false, reason }];
        const result = await collectBeanDetails(async () => pages.shift(), { now });
        assert.equal(result.known, false); assert.match(formatBeanIncome(result), /未知/); assert.equal(result.todayIncome, undefined);
    }
});

test('malformed, unsorted and excessive pages do not produce totals', async () => {
    for (const list of [[row('bad', 5)], [row('2026-10-08 10:00:00', 1), row('2026-10-08 11:00:00', 2)], [row('2026-10-08 11:00:00', '')]]) {
        assert.equal((await collectBeanDetails(async () => ok(list), { now })).known, false);
    }
    let calls = 0;
    assert.equal((await collectBeanDetails(async () => { calls++; return ok([row('2026-10-08 11:00:00', 1)]); }, { now, maxPages: 2 })).known, false);
    assert.equal(calls, 2);
});

test('Joy missing data resolves an empty task list and never assigns a worker', async () => {
    for (const body of [null, {}, { success: false }, { success: true, data: null }]) assert.deepEqual(taskItems(body), []);
    let calls = 0;
    const r = await assignWorkers(null, null, { assign: async () => { calls++; }, refresh: async () => null });
    assert.equal(calls, 0); assert.match(r.reason, /缺失/);
    assert.deepEqual(pendingTasks(null), []);
    assert.deepEqual(pendingTasks([null, { taskFinished: true }, { taskFinished: false, id: 2 }, { taskFinished: true, canDrawAwardNum: 1, id: 3 }]).map(t => t.id), [2, 3]);
});

test('Joy stops unchanged states, unsuccessful moves and request budgets', async () => {
    const joys = [{ id: 1, level: 3 }], workers = [{ unlock: true, joyDTO: null, location: 1 }];
    let calls = 0;
    const r = await assignWorkers(joys, workers, { assign: async () => { calls++; return { success: true }; }, refresh: async () => ({ activityJoyList: joys, workJoyInfoList: workers }) });
    assert.equal(calls, 1); assert.match(r.reason, /状态未变化/);
    assert.match((await assignWorkers(joys, workers, { assign: async () => ({ code: 403 }), refresh: async () => null })).reason, /未明确成功/);
    assert.match((await assignWorkers(joys, workers, { maxAssignments: 0, assign: async () => {}, refresh: async () => null })).reason, /上限/);
});

test('legacy asset report suppresses initialized zeroes and does not overwrite cache after query failure', () => {
    const source = fs.readFileSync(path.join(__dirname, '../jd_bean_change.js'), 'utf8');
    const tree = parse(source, { ecmaVersion: 'latest' });
    const report = tree.body.find(n => n.type === 'FunctionDeclaration' && n.id.name === 'KanCXAx');
    const output = [];
    const context = vm.createContext({ $: { maintenanceUnknown: true, maintenanceReason: 'HTTP 403' }, KehRW5e: '', console: { log: v => output.push(v) } });
    vm.runInContext(source.slice(report.start, report.end) + '; KanCXAx();', context, { timeout: 100 });
    assert.match(output.join(''), /未知/); assert.doesNotMatch(output.join(''), /0豆/);
    let cache, writes = 0;
    function walk(n) { if (!n || typeof n !== 'object') return; if (n.type === 'ConditionalExpression' && n.test.type === 'MemberExpression' && n.test.property.name === 'maintenanceUnknown' && n.alternate.type === 'CallExpression' && n.alternate.callee.object?.name === 'eS8cy0') cache = n; for (const v of Object.values(n)) { if (Array.isArray(v)) v.forEach(walk); else if (v && typeof v === 'object') walk(v); } }
    walk(tree);
    assert.ok(cache);
    const cacheContext = vm.createContext({ $: { maintenanceUnknown: true }, console: { log() {} }, eS8cy0: { writeFile: () => { writes++; } }, rrEUgQ_: 'cache', gwKKaf0: '', HBPWW4t: () => 'writeFile' });
    vm.runInContext(source.slice(cache.start, cache.end), cacheContext, { timeout: 100 });
    assert.equal(writes, 0);
});

test('legacy statistics adapter treats a nominal success without metric data as unknown', async () => {
    const env = { done() {} };
    attachLegacy(env, { statistics: true, transport: async () => ({ status: 200, text: async () => '{"code":0}' }) });
    const error = await new Promise(resolve => env.post({ url: 'https://api.m.jd.com/client.action' }, resolve));
    assert.match(error, /缺少数据/); assert.equal(env.maintenanceUnknown, true);
    env.done();
});
