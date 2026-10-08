/*
 * 京豆详情统计。基于原留存脚本的统计口径维护。
 * 原任务定时保留：2 20 14 12 * jd_bean_info.js
 * 仅查询；失败、分页不完整和风控均显示未知。
 */
'use strict';
const { createRuntime } = require('./function/jd-runtime');
const { collectBeanDetails, formatBeanIncome } = require('./function/bean-statistics');

async function run() {
    const cookies = Object.values(require('./jdCookie'));
    if (!cookies.length) { console.log('未配置 JD_COOKIE，停止统计。'); return; }
    const runtime = createRuntime({ maxRequests: 40, maxDurationMs: 180000 });
    const messages = [];
    let total = 0, knownAccounts = 0;
    for (let index = 0; index < cookies.length; index++) {
        const result = await collectBeanDetails(page => runtime.request({
            url: 'https://api.m.jd.com/client.action?functionId=getJingBeanBalanceDetail',
            body: new URLSearchParams({ body: JSON.stringify({ pageSize: '20', page: String(page) }), appid: 'ld' }).toString(),
            headers: { 'Content-Type': 'application/x-www-form-urlencoded', Cookie: cookies[index],
                'User-Agent': process.env.JD_USER_AGENT || require('./USER_AGENTS').USER_AGENT }
        }));
        messages.push(`【账号${index + 1} 京豆详情统计】\n${formatBeanIncome(result)}`);
        if (result.known) { total += result.todayIncome; knownAccounts++; }
    }
    messages.push(knownAccounts === cookies.length ? `今日全部账号收入：${total}个京豆` :
        `今日全部账号收入：未知（${cookies.length - knownAccounts}个账号查询不完整）`);
    const message = messages.join('\n\n');
    console.log(message);
    if (process.env.JD_MAINTENANCE_NOTIFY !== 'false') await require('./sendNotify').sendNotify('京豆详情统计', message);
}
if (require.main === module) run().catch(() => { console.log('统计未完成：未知（运行异常）'); process.exitCode = 1; });
module.exports = { run };
