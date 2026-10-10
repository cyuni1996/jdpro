import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const escape = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Metadata remains local. Match the whole task folder, since plantBean_* also
// includes plantBean_help_204. Hashes detect an active log growing at the same path.
export function indexTaskLogs(logRoot, tasks, baseline = [], prefix = '6dylan6_jdpro') {
    const directories = fs.readdirSync(logRoot, { withFileTypes: true }).filter(entry => entry.isDirectory());
    const before = new Map(baseline.map(row => [row.file, row]));
    return tasks.map(({ file, name }) => {
        if (!/^jd_[\w-]+\.(?:js|sh|py)$/.test(file)) throw new Error('Invalid task filename');
        const stem = file.replace(/\.(?:js|sh|py)$/, '');
        const folder = new RegExp(`^${escape(prefix)}_${escape(stem)}_\\d+$`);
        const logs = directories.filter(entry => folder.test(entry.name)).flatMap(entry =>
            fs.readdirSync(path.join(logRoot, entry.name), { withFileTypes: true })
                .filter(item => item.isFile() && /^\d{4}(?:-\d{2}){5}-\d{3}\.log$/.test(item.name))
                .map(item => ({ filename: item.name, path: path.join(logRoot, entry.name, item.name) }))
        ).sort((a, b) => a.filename.localeCompare(b.filename) || a.path.localeCompare(b.path));
        if (!logs.length) return { file, name, logs: 0, path: null, changed: false };
        const latest = logs.at(-1), body = fs.readFileSync(latest.path);
        const sha256 = crypto.createHash('sha256').update(body).digest('hex');
        const old = before.get(file);
        return { file, name, logs: logs.length, path: latest.path, date: latest.filename.slice(0, 19),
            bytes: body.length, sha256, changed: old?.path !== latest.path || old?.sha256 !== sha256 };
    });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    const args = process.argv.slice(2);
    const flag = name => { const index = args.indexOf(name); return index < 0 ? null : args[index + 1]; };
    const logRoot = flag('--log-root'), output = flag('--output');
    if (!logRoot || !output) {
        console.log('Usage: node tools/log-index.mjs --log-root /private/qinglong/log --output /private/log-index.json [--baseline /private/log-index.json]');
    } else {
        const destination = path.resolve(output);
        const parent = fs.realpathSync(path.dirname(destination));
        const resolved = fs.existsSync(destination) ? fs.realpathSync(destination) : path.join(parent, path.basename(destination));
        if (resolved === root || resolved.startsWith(root + path.sep)) throw new Error('日志索引必须保存在公开仓库之外');
        if (fs.existsSync(destination) && fs.lstatSync(destination).isSymbolicLink()) throw new Error('Output cannot be a symlink');
        const tasks = JSON.parse(fs.readFileSync(path.join(root, 'maintenance/status.json'), 'utf8')).tasks;
        const baselineFile = flag('--baseline');
        const baseline = baselineFile ? JSON.parse(fs.readFileSync(baselineFile, 'utf8')) : [];
        const index = indexTaskLogs(logRoot, [...tasks, { file: 'jd_sharecode.sh', name: '互助 Shell' }], baseline);
        fs.writeFileSync(destination, JSON.stringify(index, null, 2) + '\n', { mode: 0o600 });
        fs.chmodSync(destination, 0o600);
        console.log(JSON.stringify({ tasks: tasks.length, withLogs: index.filter(row => row.path).length,
            changed: index.filter(row => row.changed).length, rawLogContentPrinted: false }));
    }
}
