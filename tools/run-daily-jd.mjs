// Manual controlled daily-task validation; not a scheduled QingLong task.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import runtimeModule from '../function/jd-runtime.js';
import cookieModule from '../function/cookie.js';

export async function validateJoySign(cookie, runtime = runtimeModule.createRuntime({ cookie, maxRequests: 3, maxDurationMs: 60000 })) {
    const request = (functionId, body) => runtime.request({ url: `https://api.m.jd.com/client.action?functionId=${functionId}`,
        body: new URLSearchParams({ functionId, body: JSON.stringify(body), appid: 'activities_platform' }).toString(),
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', Referer: 'https://joypark.jd.com/',
            'User-Agent': 'Mozilla/5.0 (Linux; Android 12) AppleWebKit/537.36 Mobile Safari/537.36' } });
    const common = { channel: 4, linkId: '99DZNpaCTAv8f4TuKXr0Ew' };
    const list = await request('apTaskList', common);
    if (!list.ok || !Array.isArray(list.data?.data)) return { category: list.category, reason: list.reason, businessVerified: false };
    // Query fields must explicitly identify an unfinished sign-in. Never infer an
    // action from a name, and never execute purchases, follows, draws or exchange.
    const task = list.data.data.find(t => t.taskType === 'SIGN' && t.taskFinished === false && Number.isSafeInteger(t.id));
    if (!task) return { category: '未验证', reason: '没有待执行签到任务', businessVerified: false };
    const result = await request('apDoTask', { ...common, taskId: task.id, taskType: 'SIGN', itemId: '' });
    if (!result.ok) return { category: result.category, reason: result.reason, status: result.status || null, code: result.code || null, businessVerified: false };
    // Completion requires a second state query; a successful task endpoint alone
    // does not prove that the task finished or that any reward was credited.
    const after = await request('apTaskList', common);
    const finished = after.ok && Array.isArray(after.data?.data) && after.data.data.some(t => t.id === task.id && t.taskFinished === true);
    return { category: finished ? '部分可用' : '未验证', reason: finished ? '签到状态由未完成变为完成；未验证奖励到账' : '签到接口响应成功，但状态未确认', businessVerified: Boolean(finished), rewardVerified: false };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    const args = process.argv.slice(2);
    if (!args.includes('--execute')) console.log('默认关闭。人工验证：--execute joy-sign --cookie-file <本地私密文件>');
    else {
        if (args[args.indexOf('--execute') + 1] !== 'joy-sign') throw new Error('只允许已审阅的 joy-sign 操作');
        const flag = args.indexOf('--cookie-file');
        const cookie = flag >= 0 ? fs.readFileSync(args[flag + 1], 'utf8').trim() : runtimeModule.firstCookie();
        if (cookieModule.parseCookies(cookie).length !== 1 || !cookieModule.cookiePin(cookie)) throw new Error('需要单账号凭据；内容已隐藏');
        console.log(JSON.stringify({ time: new Date().toISOString(), script: 'jd_joypark_task.js', scope: '单账号签到验证', ...await validateJoySign(cookie) }));
    }
}
