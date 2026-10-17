'use strict';
const vm = require('node:vm');
const { tokenFixture } = require('./token-replay');

function redisInitFixture(source) {
    const { parse } = require('acorn');
    const tree = parse(source, {ecmaVersion: 'latest'});
    const initialization = tree.body.find(n => n.type === 'IfStatement' && n.test.type === 'Identifier' && n.test.name === 'lIII1i');
    if (!initialization) throw new Error('Reviewed Redis initialization missing');
    return {...tokenFixture(source), initializationRange: [initialization.start, initialization.end]};
}

function createRedisInitReplay(source, fixture = redisInitFixture(source)) {
    return async (scenario = {}) => {
        // Only the reviewed initialization and pure decoders execute. Package,
        // client, promises and deadlines live entirely inside this realm.
        const context = vm.createContext(Object.create(null), {codeGeneration: {strings: false, wasm: false}});
        vm.runInContext(`
            const scenario = ${JSON.stringify(scenario)};
            const console = {log() {}};
            const lIII1i = scenario.disabled ? '' : 'redis://synthetic.invalid/0';
            let l1iIIi = null, clientOptions = null, connectCalls = 0, catchRegistered = 0;
            let rejectionHandled = 0, disconnectCalls = 0, connectArgumentTypes = [], rejectConnection;
            const handlers = {}, timers = [];
            function setTimeout(callback, delay) { timers.push({callback, delay, cleared: false, fired: false}); return timers.length; }
            function clearTimeout(id) { if (timers[id - 1]) timers[id - 1].cleared = true; }
            const client = {
                on(name, callback) { handlers[name] = callback; return this; },
                connect(...args) {
                    connectCalls++; connectArgumentTypes = args.map(value => typeof value);
                    if (scenario.connectThrows) throw new Error('synthetic synchronous connect failure');
                    const connection = new Promise((resolve, reject) => {
                        rejectConnection = reject;
                        if (scenario.connectRejects) reject(new Error('synthetic connection rejection'));
                        else if (!scenario.connectPending) resolve(client);
                    });
                    // The test-only observer keeps the broken baseline from
                    // producing a process-level unhandled rejection. The
                    // production handler is observed separately below.
                    Promise.prototype.catch.call(connection, () => {});
                    connection.catch = callback => {
                        catchRegistered++;
                        return Promise.prototype.catch.call(connection, error => { rejectionHandled++; return callback(error); });
                    };
                    return connection;
                },
                disconnect() {
                    disconnectCalls++;
                    if (scenario.disconnectThrows) throw new Error('synthetic disconnect failure');
                    if (rejectConnection) rejectConnection(new Error('synthetic connection cancelled'));
                    return scenario.disconnectRejects ? Promise.reject(new Error('synthetic rejected disconnect')) : Promise.resolve();
                }
            };
            function require(name) {
                if (name !== 'redis' || scenario.moduleMissing) throw new Error('synthetic package unavailable');
                return {createClient(options) {
                    clientOptions = options;
                    if (scenario.createThrows) throw new Error('synthetic client creation failure');
                    return client;
                }};
            }
        `, context, {timeout: 100});
        vm.runInContext([...fixture.decoderRanges, ...fixture.preludeRanges].map(r => source.slice(...r)).join('\n'), context, {timeout: 1000});
        vm.runInContext(source.slice(...fixture.initializationRange), context, {timeout: 100});
        const result = await vm.runInContext(`(async () => {
            for (let i = 0; i < 6; i++) await Promise.resolve();
            if (scenario.emitError && handlers.error) handlers.error(new Error('synthetic error event'));
            if (scenario.fireDeadline) for (const timer of timers) if (!timer.cleared && !timer.fired) {timer.fired = true; timer.callback();}
            for (let i = 0; i < 6; i++) await Promise.resolve();
            return JSON.stringify({activeClient: l1iIIi !== null, clientOptions, connectCalls, catchRegistered,
                rejectionHandled, disconnectCalls, connectArgumentTypes,
                errorHandlerRegistered: Boolean(handlers.error), timers: timers.map(({delay,cleared,fired}) => ({delay,cleared,fired}))});
        })();`, context, {timeout: 100});
        return JSON.parse(result);
    };
}
module.exports = {redisInitFixture, createRedisInitReplay};
