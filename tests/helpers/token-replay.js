'use strict';
const vm = require('node:vm');

function tokenFixture(source) {
    const { parse } = require('acorn');
    const tree = parse(source, { ecmaVersion: 'latest' });
    const main = tree.body.find(n => n.type === 'FunctionDeclaration' && n.id.name === 'IilIlI');
    if (!main) throw new Error('Reviewed token function missing');
    const prelude = [];
    for (const node of tree.body) {
        if (node.type === 'FunctionDeclaration') continue;
        if (source.slice(node.start, node.end).includes('require(')) break;
        prelude.push(node);
    }
    const decoders = tree.body.filter(n => n.type === 'FunctionDeclaration' && ['iii1II', 'Iii11l'].includes(n.id.name));
    const range = n => [n.start, n.end];
    return { decoderRanges: decoders.map(range), preludeRanges: prelude.map(range), mainRange: range(main) };
}

function createTokenReplay(source, fixture = tokenFixture(source)) {
    return async scenario => {
        // All substitutes are created inside the realm. No host functions,
        // modules, filesystem, network, credentials or notifications enter it.
        const context = vm.createContext(Object.create(null), { codeGeneration: { strings: false, wasm: false } });
        vm.runInContext(`
            const scenario = ${JSON.stringify(scenario)};
            const requests = [], signatureCalls = [], delays = [], cacheWrites = [], redisReads = [], redisCommands = [];
            const cache = {unrelated: 'keep-existing-value'};
            const redisState = {unrelated: {value: 'keep-redis-existing-value', ttlMs: 1000}};
            const console = {log() {}};
            function setTimeout(callback, milliseconds) { delays.push(milliseconds); callback(); return 1; }
            function lilIi(cookie, expression) { return cookie.match(expression)?.[0] || ''; }
            function l1l11I() { return 'dummy-activity-cache-key'; }
            const IilIil = {
                get() { return scenario.cached; },
                put(key, value, ttl) { cacheWrites.push({key, value, ttl}); cache[key] = value; }
            };
            const l1iIIi = scenario.redis ? {async get(key) {
                redisReads.push(key);
                if (scenario.redisGetFailure) throw new Error('synthetic Redis read failure');
                return scenario.redisCached;
            }, async set(key, value, options) {
                redisCommands.push({command: 'SET', key, value, options});
                if (scenario.redisSetFailure) throw new Error('synthetic Redis write failure');
                redisState[key] = {value, ttlMs: options?.PX ?? null};
                return 'OK';
            }, async EXPIREAT(key, timestamp) {
                redisCommands.push({command: 'EXPIREAT', key, timestamp});
                if (scenario.redisExpireFailure) throw new Error('synthetic Redis expiry failure');
                if (redisState[key]) redisState[key].ttlMs = timestamp * 1000 - Date.now();
                return 1;
            }} : null;
            const IilIl1 = Boolean(scenario.redisSubmit), lIII1l = false, l11i11 = '';
            const I11iIl = scenario.cacheTtlMs === undefined ? 1000 : Number(scenario.cacheTtlMs);
            const illIll = Boolean(scenario.customSigner), l1iIIl = '30', iiilll = String(scenario.successInterval || 0);
            async function I11iIi(functionId, input) {
                signatureCalls.push({functionId, input});
                if (scenario.signatureMissing) return null;
                return {body: 'dummy-signature', data: {convertUrl: 'dummy-signature'}};
            }
            const lIIill = {async post(url, options) {
                requests.push({url, options});
                if (scenario.errorStatus) {
                    const error = new Error('synthetic HTTP failure');
                    error.response = {statusCode: scenario.errorStatus, statusMessage: 'synthetic'};
                    throw error;
                }
                if (scenario.timeout) { const error = new Error('synthetic timeout'); error.name = 'TimeoutError'; throw error; }
                return {body: scenario.body};
            }};
        `, context, { timeout: 100 });
        const ranges = [...fixture.decoderRanges, ...fixture.preludeRanges, fixture.mainRange];
        vm.runInContext(ranges.map(range => source.slice(...range)).join('\n'), context, { timeout: 1000 });
        const result = await vm.runInContext(`IilIlI('pt_pin=dummy-account; pt_key=dummy-key;', 'https://activity.example.invalid/')
            .then(token => JSON.stringify({token, requests, signatureCalls, delays, cacheWrites, cache, redisReads, redisCommands, redisState}));`, context, { timeout: 100 });
        return JSON.parse(result);
    };
}
module.exports = { tokenFixture, createTokenReplay };
