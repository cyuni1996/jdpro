'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const http = require('node:http');
const { parse } = require('acorn');
const got = require('got');

// Decode only the string prelude and evaluate the actual options expression.
// The token entrypoint, signer, cache, Redis and proxy setup never execute.
function tokenOptions() {
    const source = fs.readFileSync(path.join(__dirname, '../function/krgetToken.js'), 'utf8');
    const tree = parse(source, { ecmaVersion: 'latest' });
    let request;
    function walk(node) {
        if (!node || typeof node !== 'object') return;
        if (node.type === 'CallExpression' && node.arguments[0]?.value === 'https://api.m.jd.com/client.action?functionId=isvObfuscator') request = node;
        for (const value of Object.values(node)) {
            if (Array.isArray(value)) value.forEach(walk);
            else if (value && typeof value === 'object') walk(value);
        }
    }
    walk(tree); assert.ok(request);
    const main = tree.body.find(n => n.type === 'FunctionDeclaration' && n.id.name === 'IilIlI');
    const declarations = main.body.body.find(n => n.type === 'VariableDeclaration').declarations;
    const settings = declarations.find(n => n.id.name === 'IllI1l'); assert.ok(settings);
    const prelude = [];
    for (const node of tree.body) {
        if (node.type === 'FunctionDeclaration') continue;
        if (source.slice(node.start, node.end).includes('require(')) break;
        prelude.push(node);
    }
    const decoders = tree.body.filter(n => n.type === 'FunctionDeclaration' && ['iii1II', 'Iii11l'].includes(n.id.name));
    const context = vm.createContext(Object.create(null), { codeGeneration: { strings: false, wasm: false }, microtaskMode: 'afterEvaluate' });
    vm.runInContext(decoders.map(n => source.slice(n.start, n.end)).join('\n') + '\n' +
        prelude.map(n => source.slice(n.start, n.end)).join('\n'), context, { timeout: 1000 });
    return JSON.parse(vm.runInContext(`const iiili1 = lllll;
        const IllI1l = ${source.slice(settings.init.start, settings.init.end)};
        const i11I1l = 'dummy-cookie-for-loopback-only';
        const body = 'dummy-signature-body';
        JSON.stringify(${source.slice(request.arguments[1].start, request.arguments[1].end)});`, context, { timeout: 1000 }));
}

async function listen(server) {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    return 'http://127.0.0.1:' + server.address().port;
}
async function close(server) {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
}

test('reviewed token options keep the original request and never follow a redirect', async () => {
    const options = tokenOptions();
    assert.equal(options.headers.Host, 'api.m.jd.com');
    assert.equal(options.headers.Cookie, 'dummy-cookie-for-loopback-only');
    assert.equal(options.body, 'dummy-signature-body');
    assert.equal(options.timeout, 10000); assert.equal(options.retry.limit, 0);
    let initialRequests = 0, redirectedRequests = 0;
    const receiver = http.createServer((_req, res) => { redirectedRequests++; res.end('{}'); });
    const destination = await listen(receiver);
    const origin = http.createServer((_req, res) => {
        initialRequests++; res.writeHead(302, { location: destination + '/unexpected' }); res.end();
    });
    try {
        const entrance = await listen(origin);
        await got.post(entrance + '/mock-token', options).catch(error => {
            assert.equal(error.response.statusCode, 302);
        });
        assert.equal(initialRequests, 1); assert.equal(redirectedRequests, 0);
    } finally { await close(origin); await close(receiver); }
});

test('reviewed token request times out after ten seconds without a client retry', async () => {
    const options = tokenOptions();
    let requests = 0;
    const server = http.createServer(() => { requests++; });
    try {
        const entrance = await listen(server);
        await assert.rejects(got.post(entrance + '/mock-timeout', options), error => error.name === 'TimeoutError');
        assert.equal(requests, 1);
    } finally { await close(server); }
});
