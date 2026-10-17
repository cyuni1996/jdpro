'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const net = require('node:net');
const {createClient} = require('redis');
const {createRedisInitReplay} = require('./helpers/redis-init-replay');
const replay = createRedisInitReplay(fs.readFileSync(path.join(__dirname, '../function/krgetToken.js'), 'utf8'));

test('Redis initialization handles the connect promise rejection', async () => {
    const result = await replay({connectRejects: true});
    assert.equal(result.activeClient, false);
    assert.equal(result.catchRegistered, 1);
    assert.equal(result.rejectionHandled, 1);
    assert.deepEqual(result.connectArgumentTypes, []);
});

test('Redis initialization disables reconnection and offline queues with a bounded connection', async () => {
    const result = await replay();
    assert.deepEqual(result.clientOptions, {url: 'redis://synthetic.invalid/0',
        socket: {connectTimeout: 10000, reconnectStrategy: false}, disableOfflineQueue: true});
    assert.equal(result.timers[0].delay, 10000);
});

test('synchronous Redis initialization failure clears client and deadline', async () => {
    const result = await replay({connectThrows: true});
    assert.equal(result.activeClient, false);
    assert.equal(result.connectCalls, 1);
    assert.ok(result.timers.every(t => t.cleared));
});

test('a pending Redis handshake stops at the deadline even when disconnect fails', async () => {
    for (const failure of [{}, {disconnectThrows: true}, {disconnectRejects: true}]) {
        const result = await replay({connectPending: true, fireDeadline: true, ...failure});
        assert.equal(result.activeClient, false);
        assert.equal(result.disconnectCalls, 1);
        assert.equal(result.timers[0].delay, 10000);
        assert.ok(result.timers.every(t => t.cleared || t.fired));
    }
});

test('successful Redis initialization retains the client and cancels its deadline', async () => {
    const result = await replay();
    assert.equal(result.activeClient, true);
    assert.equal(result.connectCalls, 1);
    assert.deepEqual(result.connectArgumentTypes, []);
    assert.equal(result.timers.length, 1);
    assert.equal(result.timers[0].cleared, true);
    assert.equal(result.disconnectCalls, 0);
});

test('disabled, missing, failed creation and error-event paths keep Redis unavailable', async () => {
    for (const scenario of [{disabled: true}, {moduleMissing: true}, {createThrows: true}, {emitError: true}]) {
        const result = await replay(scenario);
        assert.equal(result.activeClient, false);
        if (!scenario.emitError) assert.equal(result.connectCalls, 0);
    }
});

test('the declared Redis client makes one connection to a failing dummy loopback server', async () => {
    const {clientOptions} = await replay();
    assert.equal(clientOptions.socket?.reconnectStrategy, false);
    let connections = 0, client;
    const sockets = new Set();
    const server = net.createServer(socket => {
        connections++; sockets.add(socket); socket.on('close', () => sockets.delete(socket)); socket.destroy();
    });
    try {
        await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
        client = createClient({...clientOptions, url: 'redis://127.0.0.1:' + server.address().port});
        client.on('error', () => {});
        await assert.rejects(client.connect());
        assert.equal(connections, 1);
        assert.equal(client.isOpen, false);
    } finally {
        if (client?.isOpen) await client.disconnect();
        for (const socket of sockets) socket.destroy();
        await new Promise(resolve => server.close(resolve));
    }
});
