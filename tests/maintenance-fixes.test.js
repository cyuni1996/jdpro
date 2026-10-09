'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { parse } = require('acorn');
const { collectBeanDetails, formatBeanIncome } = require('../function/bean-statistics');
const { taskItems, pendingTasks, validatedTasks, selectTaskItemId, assignWorkers } = require('../function/joy-safe');
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

test('Joy selects only a valid item and skips empty or malformed detail responses', async () => {
    const valid = [{ pipeExt: { itemId: 'first' } }, { pipeExt: { itemId: 'second' } }];
    assert.equal(await selectTaskItemId({ taskItemList: valid }, { random: () => 0.9 }), 'second');
    assert.equal(await selectTaskItemId({}, { details: async () => valid, random: () => 0 }), 'first');
    let calls = 0;
    assert.equal(await selectTaskItemId({ taskSourceUrl: 'https://joypark.jd.com/' }, { details: async () => { calls++; } }), 'https://joypark.jd.com/');
    for (const items of [[], null, {}, [null, {}, { pipeExt: null }, { pipeExt: {} }, { pipeExt: { itemId: '' } }]]) {
        assert.equal(await selectTaskItemId({}, { details: async () => items }), null);
    }
    assert.equal(await selectTaskItemId({ taskItemList: [] }, { details: async () => { calls++; } }), null);
    assert.equal(await selectTaskItemId({}, { details: async () => { throw new Error('timeout'); } }), null);
    assert.equal(calls, 0);
});

test('Joy does not reuse detail items after an authentication, 403, risk or ended response', async () => {
    for (const body of [{ code: 1001 }, { status: 403 }, { msg: '活动太火爆' }, { msg: '活动已结束' }, null]) {
        let stopped = false, calls = 0;
        const runtime = { state: () => ({ stopped }) };
        const id = await selectTaskItemId({}, { runtime, details: async () => { calls++; stopped = true; return taskItems(body); } });
        assert.equal(id, null); assert.equal(calls, 1);
        assert.equal(await selectTaskItemId({ taskSourceUrl: 'stale' }, { runtime, details: async () => { calls++; } }), null);
        assert.equal(calls, 1);
    }
});

test('legacy Joy replays a 403 detail response without reading pipeExt or making another request', async () => {
    const source = fs.readFileSync(path.join(__dirname, '../jd_joypark_task.js'), 'utf8');
    const tree = parse(source, { ecmaVersion: 'latest' });
    const detail = tree.body.find(n => n.type === 'FunctionDeclaration' && n.id.name === 'vt4onL');
    let requests = 0;
    const env = { done() {}, taskDetailList: [{ pipeExt: { itemId: 'stale' } }] };
    attachLegacy(env, { transport: async () => { requests++; return { status: 403, text: async () => '{}' }; } });
    const context = vm.createContext({ $: env, URLSearchParams, require: p => { assert.equal(p, './function/joy-safe'); return require('../function/joy-safe'); },
        PVdgdI: () => ({ url: 'https://api.m.jd.com/client.action' }) });
    vm.runInContext(source.slice(detail.start, detail.end), context, { timeout: 100 });
    const result = await selectTaskItemId({}, { details: () => context.vt4onL(1, 'BROWSE'), runtime: env.maintenanceRuntime });
    assert.equal(result, null); assert.equal(env.taskDetailList.length, 0); assert.equal(requests, 1);
    await context.vt4onL(2, 'BROWSE');
    assert.equal(requests, 1);
    env.done();
});

test('legacy Joy task loop exits before processing the next task when the request path is stopped', async () => {
    const source = fs.readFileSync(path.join(__dirname, '../jd_joypark_task.js'), 'utf8');
    const tree = parse(source, { ecmaVersion: 'latest' });
    let loop;
    function walk(n) { if (!n || typeof n !== 'object') return; if (n.type === 'ForOfStatement' && n.left.declarations?.[0]?.id.name === 'FYc_ay') loop = n;
        for (const v of Object.values(n)) { if (Array.isArray(v)) v.forEach(walk); else if (v && typeof v === 'object') walk(v); } }
    walk(tree); assert.ok(loop);
    const messages = [];
    const context = vm.createContext({ $: { taskList: [{ id: 1 }, { id: 2 }], maintenanceRuntime: { state: () => ({ stopped: true }) } },
        yOhx3Hg: [], lBW52K: () => 'taskList', console: { log: s => messages.push(s) } });
    await vm.runInContext('(async () => {' + source.slice(loop.start, loop.end) + '})()', context, { timeout: 100 });
    assert.equal(messages.length, 1); assert.match(messages[0], /结束剩余庄园任务/);
});

test('legacy Joy reports unknown after a failed query; only a known empty task list reports completion', () => {
    const source = fs.readFileSync(path.join(__dirname, '../jd_joypark_task.js'), 'utf8');
    const tree = parse(source, { ecmaVersion: 'latest' });
    let loop;
    function walk(n) { if (!n || typeof n !== 'object') return;
        if (n.type === 'DoWhileStatement' && source.slice(n.start, n.end).includes('await VpcL9D')) loop = n;
        for (const v of Object.values(n)) { if (Array.isArray(v)) v.forEach(walk); else if (v && typeof v === 'object') walk(v); } }
    walk(tree); assert.ok(loop);
    const guard = loop.body.body.find(n => n.type === 'IfStatement' && source.slice(n.start, n.end).includes('任务状态未知'));
    const complete = loop.body.body.find(n => n.type === 'IfStatement' && source.slice(n.start, n.end).includes('console.log("全部任务已完成！")'));
    const query = loop.body.body.find(n => n.type === 'ExpressionStatement' && source.slice(n.start, n.end).includes('await VpcL9D'));
    assert.ok(query.end < guard.start && guard.end < complete.start);
    for (const [unknown, stopped, tasks, expected] of [[true, false, [], '未知'], [false, true, [], '未知'], [false, false, null, '未知'], [false, false, [], '全部任务已完成'], [false, false, [{ id: 1 }], '待执行']]) {
        const messages = [];
        const context = vm.createContext({ $: { maintenanceUnknown: unknown, maintenanceReason: 'HTTP 403', taskList: tasks,
            maintenanceRuntime: { state: () => ({ stopped }) } }, console: { log: v => messages.push(v) } });
        vm.runInContext('do {' + source.slice(guard.start, guard.end) + source.slice(complete.start, complete.end) + 'console.log("待执行");} while(false)', context, { timeout: 100 });
        assert.equal(messages.length, 1); assert.match(messages[0], new RegExp(expected));
        if (expected === '未知') assert.doesNotMatch(messages[0], /^全部任务已完成/);
    }
});

test('Joy keeps missing or malformed list data unknown while accepting a successful complete empty list', () => {
    for (const response of [null, {}, { success: true, data: null }, { success: true, data: [null] }, { success: true, data: [{}] }, { success: false, data: [] }]) {
        const env = {};
        assert.deepEqual(validatedTasks(env, response), []);
        assert.equal(env.maintenanceUnknown, true);
    }
    const env = {};
    assert.deepEqual(validatedTasks(env, { success: true, data: [] }), []);
    assert.equal(env.maintenanceUnknown, undefined);
    assert.equal(validatedTasks(env, { success: true, data: [{ id: 1, taskFinished: false }] }).length, 1);
});

test('legacy Joy does not re-enter its query loop after request protection or an unknown response', () => {
    const source = fs.readFileSync(path.join(__dirname, '../jd_joypark_task.js'), 'utf8');
    const tree = parse(source, { ecmaVersion: 'latest' });
    let condition;
    function walk(n) { if (!n || typeof n !== 'object') return;
        if (n.type === 'DoWhileStatement' && source.slice(n.start, n.end).includes('await VpcL9D')) condition = n.test;
        for (const v of Object.values(n)) { if (Array.isArray(v)) v.forEach(walk); else if (v && typeof v === 'object') walk(v); } }
    walk(tree); assert.ok(condition);
    for (const [unknown, stopped] of [[true, false], [false, true]]) {
        const context = vm.createContext({ $: { maintenanceUnknown: unknown, maintenanceRuntime: { state: () => ({ stopped }) } } });
        assert.equal(vm.runInContext(source.slice(condition.start, condition.end), context, { timeout: 100 }), false);
    }
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
