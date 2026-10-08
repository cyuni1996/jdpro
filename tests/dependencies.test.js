'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { spawnSync } = require('node:child_process');
const request = require('request');

test('the maintained request fork keeps callback, JSON, form, defaults, redirect and cookie APIs', async t => {
    const server = http.createServer((req, res) => {
        if (req.url === '/redirect') { res.writeHead(302, { Location: '/result' }); res.end(); return; }
        let body = '';
        req.on('data', chunk => { body += chunk; });
        req.on('end', () => {
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ method: req.method, url: req.url, body, cookie: req.headers.cookie, testHeader: req.headers['x-test'] }));
        });
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    t.after(() => new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())));
    const base = `http://127.0.0.1:${server.address().port}`;
    const invoke = (client, options) => new Promise((resolve, reject) => client({ proxy: null, timeout: 2000, ...options }, (error, response, body) => error ? reject(error) : resolve({ response, body })));
    const jar = request.jar(); jar.setCookie('fixture=value', base);
    const client = request.defaults({ jar, headers: { 'X-Test': 'local-fixture' } });
    const get = await invoke(client, { url: `${base}/result`, qs: { a: '中文' }, json: true });
    assert.equal(get.response.statusCode, 200);
    assert.equal(new URL(get.body.url, base).searchParams.get('a'), '中文');
    assert.equal(get.body.cookie, 'fixture=value');
    assert.equal(get.body.testHeader, 'local-fixture');
    const post = await invoke(client, { method: 'POST', url: `${base}/result`, form: { a: 'b c' }, json: true });
    assert.equal(post.body.method, 'POST');
    assert.equal(new URLSearchParams(post.body.body).get('a'), 'b c');
    const redirect = await invoke(client, { url: `${base}/redirect`, json: true });
    assert.equal(redirect.body.url, '/result');
    assert.equal(require('request/package.json').name, '@cypress/request');
});

test('proxy bootstrap initializes the existing GLOBAL_AGENT interface', () => {
    const child = spawnSync(process.execPath, ['-e', 'require("global-agent").bootstrap(); global.GLOBAL_AGENT.HTTP_PROXY="http://127.0.0.1:8888"; console.log(global.GLOBAL_AGENT.HTTP_PROXY)'], {
        cwd: require('node:path').resolve(__dirname, '..'), encoding: 'utf8', timeout: 5000,
    });
    assert.equal(child.status, 0, child.stderr);
    assert.equal(child.stdout.trim(), 'http://127.0.0.1:8888');
});

test('notification mail creation works with the updated local JSON transport', async () => {
    const transport = require('nodemailer').createTransport({ jsonTransport: true });
    const result = await transport.sendMail({ from: 'test@example.invalid', to: 'test@example.invalid', subject: 'local test', text: 'fixture' });
    const message = JSON.parse(result.message);
    assert.equal(message.subject, 'local test');
    assert.equal(message.text, 'fixture');
});

test('legacy HTTP, date and storage module entry points remain available', () => {
    assert.equal(typeof require('got'), 'function');
    assert.equal(typeof require('moment'), 'function');
    assert.equal(typeof require('date-fns').format, 'function');
    assert.equal(typeof require('ds'), 'function');
    assert.equal(typeof require('https-proxy-agent').HttpsProxyAgent, 'function');
    assert.equal(typeof require('socks-proxy-agent').SocksProxyAgent, 'function');
});

test('the DOM dependency keeps window, document and script evaluation behavior', () => {
    const { JSDOM } = require('jsdom');
    const dom = new JSDOM('<!doctype html><p id="test">fixture</p>', {
        url: 'https://example.invalid/', runScripts: 'outside-only',
    });
    try {
        assert.equal(dom.window.document.querySelector('#test').textContent, 'fixture');
        assert.equal(dom.window.location.origin, 'https://example.invalid');
        assert.equal(dom.window.eval('JSON.stringify({ value: 2 + 3 })'), '{"value":5}');
        assert.equal(typeof dom.window.navigator.userAgent, 'string');
    } finally { dom.window.close(); }
});
