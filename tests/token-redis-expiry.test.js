'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const net = require('node:net');
const { createClient } = require('redis');
const { createTokenReplay } = require('./helpers/token-replay');
const replay = createTokenReplay(fs.readFileSync(path.join(__dirname, '../function/krgetToken.js'), 'utf8'));
const success = {redis: true, redisSubmit: true, body: '{"code":"0","token":"dummy-fresh-token"}'};

test('a separate expiry failure cannot leave a newly written token without an expiry', async () => {
    const result = await replay({...success, redisExpireFailure: true});
    assert.equal(result.token, 'dummy-fresh-token');
    assert.equal(result.redisState['dummy-account'].ttlMs, 1000);
    assert.deepEqual(result.redisCommands.map(c => c.command), ['SET']);
});

test('token and configured positive TTL use a single supported SET PX command', async () => {
    for (const cacheTtlMs of [1, 1000, 1500000]) {
        const result = await replay({...success, cacheTtlMs});
        assert.equal(result.redisCommands.length, 1);
        const command = result.redisCommands[0];
        assert.deepEqual(command, {command: 'SET', key: 'dummy-account',
            value: 'dummy-fresh-token', options: {PX: cacheTtlMs}});
        assert.equal(result.redisState['dummy-account'].ttlMs, cacheTtlMs);
        assert.equal(result.requests.length, 1);
    }
});

test('the declared Redis client encodes token SET PX as one command on a dummy loopback server', async () => {
    const commands = [], sockets = new Set();
    const server = net.createServer(socket => {
        sockets.add(socket); socket.on('close', () => sockets.delete(socket));
        let pending = '';
        socket.on('data', chunk => {
            pending += chunk.toString();
            while (pending) {
                const headerEnd = pending.indexOf('\r\n');
                if (headerEnd < 0) return;
                const count = Number(pending.slice(1, headerEnd));
                const command = []; let offset = headerEnd + 2;
                for (let i = 0; i < count; i++) {
                    const sizeEnd = pending.indexOf('\r\n', offset);
                    if (sizeEnd < 0) return;
                    const size = Number(pending.slice(offset + 1, sizeEnd));
                    if (pending.length < sizeEnd + 2 + size + 2) return;
                    command.push(pending.slice(sizeEnd + 2, sizeEnd + 2 + size));
                    offset = sizeEnd + 2 + size + 2;
                }
                pending = pending.slice(offset); commands.push(command); socket.write('+OK\r\n');
            }
        });
    });
    let client;
    try {
        await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
        client = createClient({url: 'redis://127.0.0.1:' + server.address().port,
            socket: {connectTimeout: 1000, reconnectStrategy: false}, disableOfflineQueue: true});
        client.on('error', () => {});
        await client.connect();
        const result = await replay(success), command = result.redisCommands[0];
        await client.set(command.key, command.value, command.options);
        assert.deepEqual(commands.filter(c => c[0] === 'SET'),
            [['SET', 'dummy-account', 'dummy-fresh-token', 'PX', '1000']]);
    } finally {
        if (client?.isOpen) await client.disconnect();
        for (const socket of sockets) socket.destroy();
        await new Promise(resolve => server.close(resolve));
    }
});

test('invalid Redis TTL skips the write while preserving the fetched token', async () => {
    for (const cacheTtlMs of [0, -1, 'NaN', 'Infinity', 1.5]) {
        const result = await replay({...success, cacheTtlMs});
        assert.equal(result.token, 'dummy-fresh-token');
        assert.deepEqual(result.redisCommands, []);
        assert.deepEqual(result.redisState, {unrelated: {value: 'keep-redis-existing-value', ttlMs: 1000}});
    }
});

test('a rejected atomic write preserves existing Redis data and the fetched token', async () => {
    const result = await replay({...success, redisSetFailure: true});
    assert.equal(result.token, 'dummy-fresh-token');
    assert.equal(result.redisCommands.length, 1);
    assert.deepEqual(result.redisState, {unrelated: {value: 'keep-redis-existing-value', ttlMs: 1000}});
    assert.equal(result.requests.length, 1);
});

test('disabled submission or failed official responses never write Redis', async () => {
    for (const scenario of [{redisSubmit: false}, {errorStatus: 403}, {errorStatus: 503}, {timeout: true}, {body: '{"code":"1001"}'}]) {
        const result = await replay({...success, ...scenario});
        assert.deepEqual(result.redisCommands, []);
        assert.deepEqual(result.redisState, {unrelated: {value: 'keep-redis-existing-value', ttlMs: 1000}});
        assert.equal(result.requests.length, 1);
    }
});
