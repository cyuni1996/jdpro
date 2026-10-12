'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// Run the reviewed cache source in a realm with a memory-only DS implementation.
// No host modules, credentials, filesystem writes or networking are available.
function realm() {
    const context = vm.createContext(Object.create(null), {
        codeGeneration: { strings: false, wasm: false }, microtaskMode: 'afterEvaluate',
    });
    vm.runInContext(`
        let clock = 1000;
        Date = class { getTime() { return clock; } };
        const saves = [];
        function DS() {}
        DS.prototype.save = function(filename) {
            saves.push({filename, data: JSON.parse(JSON.stringify(this))});
        };
        function require(name) {
            if (name !== 'ds') throw new Error('Unreviewed module: ' + name);
            return DS;
        }
        const module = {exports: {}};
    `, context, { timeout: 100 });
    const source = fs.readFileSync(path.join(__dirname, '../function/cache/index.js'), 'utf8');
    vm.runInContext(source, context, { timeout: 1000 });
    return code => JSON.parse(vm.runInContext('JSON.stringify((() => {' + code + '})())', context, { timeout: 100 }));
}

test('legacy local cache expires values and keeps replacement/delete callback results', () => {
    const run = realm();
    const result = run(`
        const cache = new module.exports(10, 'memory-only.json');
        const callbacks = [];
        const missing = cache.get('missing');
        const first = cache.put('key', 'first', 0, previous => callbacks.push(previous));
        const second = cache.put('key', 'second', 5, previous => callbacks.push(previous));
        const current = cache.get('key');
        clock = 1005;
        const expired = cache.get('key');
        const removed = !Object.prototype.hasOwnProperty.call(cache.data, 'key');
        cache.put('key', 'third');
        const deleted = cache.del('key', previous => callbacks.push(previous));
        return {missing, first, second, current, expired, removed, deleted, callbacks,
            savePaths: [...new Set(saves.map(s => s.filename))]};
    `);
    assert.deepEqual(result, { missing: null, first: null, second: 'first', current: 'second',
        expired: null, removed: true, deleted: 'third', callbacks: [null, 'first', 'third'],
        savePaths: ['memory-only.json'] });
});

test('legacy zero-TTL cache without a configured save path does not persist or expire values', () => {
    const result = realm()(`
        const cache = new module.exports();
        cache.put('key', 'fake-token');
        clock = 999999;
        let callbackValue;
        const value = cache.get('key', v => {callbackValue = v;});
        return {value, callbackValue, saves: saves.length};
    `);
    assert.deepEqual(result, { value: 'fake-token', callbackValue: 'fake-token', saves: 0 });
});
