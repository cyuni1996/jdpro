import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const status = JSON.parse(fs.readFileSync(path.join(root, 'maintenance/status.json'), 'utf8'));
const tasks = fs.readdirSync(root).filter(f => /^jd_.*\.js$/.test(f)).sort();
const recorded = status.tasks.map(t => t.file).sort();
if (JSON.stringify(tasks) !== JSON.stringify(recorded) || new Set(recorded).size !== recorded.length) throw new Error('任务清单缺少新增文件、重复记录或包含已删除文件');
const categories = new Set(['可用', '部分可用', '认证阻塞', '配置缺失', '接口异常', '活动结束', '未验证']);
for (const row of status.tasks) {
    if (!categories.has(row.category) || !row.reason || !row.next || !row.scope || !row.sourceReview) throw new Error(`${row.file}: 检查结果不完整`);
    if (row.category === '可用' && !row.businessVerified) throw new Error(`${row.file}: 没有业务证据不能标记可用`);
}
function walk(dir) {
    return fs.readdirSync(path.join(root, dir), { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? walk(dir + '/' + entry.name) : [dir + '/' + entry.name]);
}
const files = [...tasks, 'jd_sharecode.sh', ...fs.readdirSync(root).filter(f => (f.endsWith('.js') && !f.startsWith('jd_')) || f.endsWith('.py')), ...walk('function'), ...walk('utils')].sort();
const inventory = files.map(file => ({ file, kind: tasks.includes(file) ? 'task' : file === 'jd_sharecode.sh' ? 'sharecode-shell' : 'dependency',
    sha256: crypto.createHash('sha256').update(fs.readFileSync(path.join(root, file))).digest('hex'),
    validation: file === 'jd_sharecode.sh' ? 'bash -n；未执行缓存写入或清理' : tasks.includes(file) ? '见 status.json；语法及静态依赖检查' : '语法/静态依赖；运行路径需要对应任务证据' }));
const text = JSON.stringify({ taskCount: tasks.length, sourceCount: files.length, files: inventory }, null, 2) + '\n';
const destination = path.join(root, 'maintenance/inventory.json');
if (process.argv.includes('--check')) {
    if (!fs.existsSync(destination) || fs.readFileSync(destination, 'utf8') !== text) throw new Error('源码清单已变化：运行 npm run inventory 并重新检查');
} else fs.writeFileSync(destination, text);
console.log(`Inventory covers ${tasks.length} tasks, sharecode Shell and ${files.length - tasks.length - 1} dependencies.`);
