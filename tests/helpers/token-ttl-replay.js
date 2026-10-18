'use strict';
const vm = require('node:vm');
const { tokenFixture } = require('./token-replay');

function tokenTtlFixture(source) {
    const { parse } = require('acorn');
    const tree = parse(source, { ecmaVersion: 'latest' });
    const ttl = tree.body.flatMap(node => node.type === 'VariableDeclaration' ? node.declarations : [])
        .find(node => node.id.name === 'I11iIl');
    if (!ttl?.init) throw new Error('Reviewed token TTL initializer missing');
    return { ...tokenFixture(source), ttlRange: [ttl.init.start, ttl.init.end] };
}

function readTokenTtl(source, value, fixture = tokenTtlFixture(source)) {
    const context = vm.createContext(Object.create(null), { codeGeneration: { strings: false, wasm: false } });
    // Only the raw TTL expression is evaluated, with a synthetic environment
    // string. The module entry, cache files, signers and Redis never run here.
    return vm.runInContext(`const I1ilII = ${JSON.stringify(value)}; (${source.slice(...fixture.ttlRange)})`, context, { timeout: 100 });
}

module.exports = { tokenTtlFixture, readTokenTtl };
