// Reviewed read-only probes. This tool never runs legacy task entrypoints.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import runtimeModule from '../function/jd-runtime.js';
import cookies from '../function/cookie.js';

export const probes = [
    { id: 'userinfo', url: 'https://me-api.jd.com/user_new/info/GetJDUserInfoUnion', method: 'GET', scripts: ['jd_CheckCK.js', 'jd_bean_change.js'], purpose: '只读账号信息；不能推广为所有活动认证结论' },
    { id: 'bean-details', functionId: 'getJingBeanBalanceDetail', body: { pageSize: '20', page: '1' }, appid: 'ld', scripts: ['jd_bean_info.js'], purpose: '只读京豆明细首页；不是完整统计或领豆证据' },
    { id: 'farm-home', functionId: 'initForFarm', body: { version: 4, channel: 1 }, appid: 'wh5', scripts: ['jd_fruit_new.js'], purpose: '只读农场入口；不浇水、不领奖' },
    { id: 'plant-home', functionId: 'plantBeanIndex', body: {}, appid: 'ld', scripts: ['jd_plantBean.js', 'jd_plantBean_help.js'], purpose: '只读种豆入口；不助力、不领取' },
    { id: 'joy-tasks', functionId: 'apTaskList', body: { channel: 4, linkId: '99DZNpaCTAv8f4TuKXr0Ew' }, appid: 'activities_platform', scripts: ['jd_joypark_task.js'], purpose: '只读庄园任务列表；不做任务、不兑换' },
];

export async function runProbes(cookie, { outputDir, transport, sleep = ms => new Promise(resolve => setTimeout(resolve, ms)) } = {}) {
    if (cookies.parseCookies(cookie).length !== 1 || !/pt_key=[^;]+/.test(cookie) || !cookies.cookiePin(cookie)) throw new Error('需要单账号 pt_key / pt_pin；凭据值已隐藏');
    const rows = [];
    for (const probe of probes) {
        // A failure in one activity is not a universal cookie verdict. Each probe
        // has its own stop state, while an explicit gap covers separate probes.
        if (rows.length) await sleep(2000);
        const runtime = runtimeModule.createRuntime({ cookie, ...(transport ? { transport } : {}), maxRequests: 2, maxDurationMs: 25000 });
        const options = { url: probe.url || `https://api.m.jd.com/client.action?functionId=${probe.functionId}`,
            method: probe.method || 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded',
                Referer: 'https://m.jd.com/', 'User-Agent': 'Mozilla/5.0 (Linux; Android 12) AppleWebKit/537.36 Mobile Safari/537.36' } };
        if (probe.functionId) options.body = new URLSearchParams({ body: JSON.stringify(probe.body), appid: probe.appid }).toString();
        const result = await runtime.request(options);
        const row = { id: probe.id, scripts: probe.scripts, scope: probe.purpose, time: new Date().toISOString(),
            category: result.category, reason: result.reason, status: result.status || null, code: result.code || null,
            businessVerified: false, requestIssued: runtime.state().requests > 0 };
        if (outputDir) {
            fs.writeFileSync(path.join(outputDir, `${probe.id}.json`), JSON.stringify({ ...row, response: result.data ?? result.body ?? null }, null, 2), { mode: 0o600 });
        }
        rows.push(row);
        console.log(JSON.stringify(row));
    }
    return rows;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    const args = process.argv.slice(2);
    if (!args.includes('--run')) { console.log('只读探针清单：' + probes.map(p => p.id).join(', ') + '；带 --run 才发送请求。'); }
    else {
        const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
        const outputFlag = args.indexOf('--output-dir');
        const outputDir = path.resolve(outputFlag >= 0 ? args[outputFlag + 1] : path.join(os.homedir(), '.local/share/jdpro-private/probes'));
        if (outputDir === root || outputDir.startsWith(root + path.sep)) throw new Error('原始响应必须保存在公开仓库之外');
        fs.mkdirSync(outputDir, { recursive: true, mode: 0o700 }); fs.chmodSync(outputDir, 0o700);
        const flag = args.indexOf('--cookie-file');
        const cookie = flag >= 0 ? fs.readFileSync(args[flag + 1], 'utf8').trim() : runtimeModule.firstCookie();
        const rows = await runProbes(cookie, { outputDir });
        fs.writeFileSync(path.join(outputDir, 'summary.json'), JSON.stringify(rows, null, 2), { mode: 0o600 });
    }
}
