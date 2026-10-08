'use strict';

const { parseCookies, filterCookies } = require('./cookie');

// Credentialed requests are restricted to reviewed, first-party JD services.
const JD_HOSTS = new Set(['api.m.jd.com', 'me-api.jd.com', 'wq.jd.com', 'wqs.jd.com',
    'joypark.jd.com', 'cactus.jd.com', 'lop-proxy.jd.com']);
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

async function defaultTransport(url, options) {
    // got uses Node's existing proxy agents/bootstrap, preserving QingLong's
    // reviewed proxy configuration. Its built-in retries are explicitly disabled.
    const got = require('got');
    const response = await got(url, { method: options.method, headers: options.headers,
        body: options.body, signal: options.signal, agent: options.agent,
        followRedirect: false, throwHttpErrors: false, retry: { limit: 0 } });
    return { status: response.statusCode, text: async () => response.body };
}

function firstCookie(env = process.env) {
    return filterCookies(parseCookies(env.JD_COOKIE), env, 'maintenance')[0] || '';
}

function classifyResponse(status, body) {
    if (status === 401) return { ok: false, category: '认证阻塞', reason: 'HTTP 401' };
    if (status === 403) return { ok: false, category: '接口异常', reason: 'HTTP 403；不能据此判断活动结束' };
    if (status < 200 || status >= 300) return { ok: false, category: '接口异常', reason: `HTTP ${status}` };
    let data;
    try { data = typeof body === 'string' ? JSON.parse(body) : body; }
    catch { return { ok: false, category: '接口异常', reason: '非 JSON 响应' }; }
    if (!data || typeof data !== 'object') return { ok: false, category: '接口异常', reason: '空响应' };
    const message = [data.errMsg, data.message, data.msg, data.errorMessage, data.subCodeMsg].filter(v => typeof v === 'string').join(' ');
    const code = String(data.code ?? data.retcode ?? data.resultCode ?? '');
    if (/风控|风险|环境异常|火爆|频繁|验证|risk/i.test(message)) return { ok: false, category: '接口异常', reason: '风控或环境限制', code, data, stop: true };
    if (/未登录|未登陆|请.*登录|cookie.*(?:失效|过期)|not.?login/i.test(message) || ['3', '13', '1001', '201', 'F10002'].includes(code)) {
        return { ok: false, category: '认证阻塞', reason: '接口明确返回未登录', code, data, stop: true };
    }
    if (/活动(?:已|已经)?(?:结束|下线)|活动已过期|activity.{0,10}(?:ended|expired)/i.test(message)) {
        return { ok: false, category: '活动结束', reason: '接口明确返回活动结束', code, data, stop: true };
    }
    const ok = data.success !== false && (data.success === true || ['0', '200'].includes(code));
    return { ok, category: ok ? '未验证' : '接口异常', reason: ok ? '接口响应成功；业务结果另行验证' : '接口未返回成功状态', code, data };
}

function createRuntime({ cookie = '', transport = defaultTransport, sleep = pause, now = Date.now,
    intervalMs = 2000, timeoutMs = 10000, maxRequests = 40, maxDurationMs = 180000 } = {}) {
    let requests = 0, lastStarted = -Infinity, stopped = false;
    const started = now();
    let queue = Promise.resolve();
    const fail = reason => ({ ok: false, category: '未验证', reason });
    async function perform(options) {
        if (stopped) return fail('认证、风控或活动结束后停止本次验证');
        let url;
        try { url = new URL(options.url); } catch { return fail('无效请求地址'); }
        const headers = { ...options.headers };
        const credential = cookie || Object.entries(headers).find(([k]) => k.toLowerCase() === 'cookie')?.[1];
        for (const key of Object.keys(headers)) if (key.toLowerCase() === 'cookie') delete headers[key];
        // Upgrade upstream HTTP endpoints before attaching a credential.
        if (JD_HOSTS.has(url.hostname) && url.protocol === 'http:') url.protocol = 'https:';
        if (url.protocol !== 'https:' || url.username || url.password || url.port || !JD_HOSTS.has(url.hostname)) return fail('地址未通过京东官方域名白名单；未发送请求');
        if (credential) headers.Cookie = credential;
        for (let attempt = 0; attempt < 2; attempt++) {
            if (requests >= maxRequests || now() - started >= maxDurationMs) return fail('达到请求次数或时间上限');
            const wait = Math.max(0, intervalMs - (now() - lastStarted));
            if (now() + wait - started >= maxDurationMs) return fail('达到时间上限');
            if (wait) await sleep(wait);
            lastStarted = now(); requests++;
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), Math.min(timeoutMs, maxDurationMs - (now() - started)));
            try {
                const response = await transport(url.href, { method: options.method || 'POST', headers,
                    body: options.body, agent: options.agent, redirect: 'manual', signal: controller.signal });
                const body = await response.text();
                if (response.status >= 500 && response.status < 600 && attempt === 0) continue;
                const result = classifyResponse(response.status, body);
                if (result.stop || response.status === 401 || response.status === 403) stopped = true;
                return { ...result, status: response.status, body, requests };
            } catch (error) {
                const timedOut = controller.signal.aborted || ['AbortError', 'TimeoutError'].includes(error.name) || error.code === 'ETIMEDOUT';
                if (timedOut && attempt === 0) continue;
                return { ok: false, category: '接口异常', reason: timedOut ? '请求超时' : '网络请求失败', requests };
            } finally { clearTimeout(timer); }
        }
        return fail('请求未完成');
    }
    return { request(options) { const result = queue.then(() => perform(options)); queue = result.then(() => {}, () => {}); return result; },
        state: () => ({ requests, elapsedMs: now() - started, stopped }) };
}

// Adapter for reviewed legacy tasks. New code uses createRuntime directly.
function attachLegacy(env, { statistics = false, requireData = false, maxRequests = 40, maxDurationMs = 180000, transport } = {}) {
    const runtime = createRuntime({ maxRequests, maxDurationMs, ...(transport ? { transport } : {}) });
    const adapter = method => (options, callback = () => {}) => {
        if (typeof options === 'string') options = { url: options };
        runtime.request({ ...options, method }).then(result => {
            if (requireData && result.ok && result.data?.data == null) {
                result.ok = false; result.reason = '业务数据为空';
            }
            if (statistics && result.ok) {
                const data = result.data;
                const payloads = [data?.data, data?.base, data?.rs, data?.result, data?.detailList, data?.jingDetailList];
                if (!payloads.some(p => Array.isArray(p) || (p && typeof p === 'object' && Object.keys(p).length))) {
                    result.ok = false; result.reason = '统计响应缺少数据字段';
                }
            }
            if (!result.ok) { env.maintenanceUnknown = true; env.maintenanceReason = result.reason; }
            const data = result.body || JSON.stringify({ success: false, code: 'MAINTENANCE_STOP', data: null });
            Promise.resolve(callback(result.ok ? null : result.reason, { statusCode: result.status || 0, status: result.status || 0, body: data }, data))
                .catch(() => { env.maintenanceUnknown = true; env.maintenanceReason = '旧任务响应处理异常'; });
        }).catch(() => { env.maintenanceUnknown = true; callback('维护请求失败', {}, '{}'); });
    };
    for (const [key, method] of [['get', 'GET'], ['post', 'POST'], ['dget', 'GET'], ['dpost', 'POST']]) {
        Object.defineProperty(env, key, { configurable: true, get: () => adapter(method), set: () => {} });
    }
    // Legacy loops can ignore failed callbacks. Bound the entire process too.
    const watchdog = setTimeout(() => { console.log('维护保护：达到运行时间上限，停止本次任务。'); process.exit(2); }, maxDurationMs);
    watchdog.unref();
    const done = env.done.bind(env);
    env.done = (...args) => { clearTimeout(watchdog); return done(...args); };
    env.maintenanceRuntime = runtime;
    env.maintenanceStatistics = statistics;
    return runtime;
}

module.exports = { JD_HOSTS, firstCookie, classifyResponse, createRuntime, attachLegacy };
