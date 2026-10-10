'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

function fixture(t) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'jdpro-log-index-'));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const write = (folder, filename, value = 'private account data') => {
        fs.mkdirSync(path.join(root, folder), { recursive: true });
        const file = path.join(root, folder, filename); fs.writeFileSync(file, value); return file;
    };
    return { root, write };
}

test('plantBean task never consumes plantBean_help logs or lookalike folders', async t => {
    const { indexTaskLogs } = await import('../tools/log-index.mjs');
    const { root, write } = fixture(t);
    const own = write('6dylan6_jdpro_jd_plantBean_203', '2026-10-10-09-21-01-385.log');
    const help = write('6dylan6_jdpro_jd_plantBean_help_204', '2026-10-10-10-22-01-199.log');
    write('6dylan6_jdpro_jd_plantBean_203_old', '2026-10-11-09-21-01-385.log');
    const rows = indexTaskLogs(root, [{ file: 'jd_plantBean.js' }, { file: 'jd_plantBean_help.js' }]);
    assert.equal(rows[0].path, own); assert.equal(rows[0].logs, 1);
    assert.equal(rows[1].path, help); assert.equal(rows[1].logs, 1);
    assert.ok(!JSON.stringify(rows).includes('private account data'));
});

test('changed content in the same running log is detected without repeating unchanged logs', async t => {
    const { indexTaskLogs } = await import('../tools/log-index.mjs');
    const { root, write } = fixture(t);
    const filename = write('6dylan6_jdpro_jd_hssign_1', '2026-10-10-08-15-01-123.log');
    write('6dylan6_jdpro_jd_hssign_1', '9999-invalid.log');
    const tasks = [{ file: 'jd_hssign.js' }, { file: 'jd_unseen.js' }];
    const baseline = indexTaskLogs(root, tasks);
    assert.equal(indexTaskLogs(root, tasks, baseline)[0].changed, false);
    fs.appendFileSync(filename, '\nnew response');
    const updated = indexTaskLogs(root, tasks, baseline);
    assert.equal(updated[0].changed, true); assert.equal(updated[0].logs, 1);
    assert.equal(updated[1].path, null); assert.equal(updated[1].changed, false);
    assert.throws(() => indexTaskLogs(root, [{ file: '../JD_COOKIE.txt' }]), /Invalid task/);
});
