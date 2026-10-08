import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { builtinModules } from 'node:module';
import { spawnSync } from 'node:child_process';
import { parse } from 'acorn';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const declared = new Set(Object.keys({ ...pkg.dependencies, ...pkg.optionalDependencies, ...pkg.devDependencies }));
// These imports are guarded upstream or supplied by the QingLong host.
const optionalLocal = new Set(['./user', './resolve-local-redacted-path', '../utils/isStandaloneExecutable']);
const optionalHost = new Set(['@redacted/enterprise-plugin', '@redacted/components/package', '@redacted/enterprise-plugin/package']);
const errors = [];
const files = [];
let js = 0, dynamicRequires = 0, guardedImports = 0;

function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (['.git', 'node_modules', '__pycache__'].includes(entry.name)) continue;
        const file = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(file);
        else if (entry.isFile()) files.push(file);
    }
}
walk(root);

function inspect(node, file) {
    if (!node || typeof node !== 'object') return;
    if (node.type === 'CallExpression' && node.callee.type === 'Identifier' && node.callee.name === 'require') {
        const arg = node.arguments[0];
        if (arg?.type === 'Literal' && typeof arg.value === 'string') {
            const spec = arg.value;
            if (spec.startsWith('.')) {
                const target = path.resolve(path.dirname(file), spec);
                if (!target.startsWith(root + path.sep) || optionalLocal.has(spec)) guardedImports++;
                else if (!['', '.js', '.json', '/index.js'].some(ext => fs.existsSync(target + ext))) {
                    errors.push(`${path.relative(root, file)}: missing local import ${spec}`);
                }
            } else if (optionalHost.has(spec) || spec.startsWith('/')) guardedImports++;
            else if (!builtinModules.includes(spec) && !spec.startsWith('node:')) {
                const name = spec.startsWith('@') ? spec.split('/').slice(0, 2).join('/') : spec.split('/')[0];
                if (!declared.has(name)) errors.push(`${path.relative(root, file)}: undeclared package ${name}`);
            }
        } else dynamicRequires++;
    }
    for (const value of Object.values(node)) {
        if (Array.isArray(value)) value.forEach(child => inspect(child, file));
        else if (value && typeof value === 'object') inspect(value, file);
    }
}

const secrets = [
    ['JD cookie', /pt_key=(?!test_|EXAMPLE|YOUR_|xxx|XXX)[A-Za-z0-9_%.-]{12,};/],
    ['GitHub token', /(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,})/],
    ['private key', /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/],
    ['Telegram token', /\b\d{7,12}:[A-Za-z0-9_-]{30,}/],
    ['WxPusher UID', /UID_[A-Za-z0-9]{20,}/],
];
for (const file of files) {
    const rel = path.relative(root, file).replaceAll(path.sep, '/');
    if (/(^|\/)(BeanCache|box\.dat|auth\.json|keyv\.sqlite|CK_WxPusherUid\.json|user\.js)(\/|$)|\.sqlite(?:-|$)|helpcode|\.pyc$|\.log$|(^|\/)\.env(?:\.|$)/i.test(rel)) {
        errors.push(`${rel}: private runtime data must not be included`);
    }
    const text = fs.readFileSync(file, 'utf8');
    for (const [name, pattern] of secrets) {
        if (pattern.test(text)) errors.push(`${rel}: potential ${name}; value suppressed`);
    }
    if (file.endsWith('.js') || file.endsWith('.mjs')) {
        try {
            const tree = parse(text, { ecmaVersion: 'latest', sourceType: file.endsWith('.mjs') ? 'module' : 'script', allowHashBang: true });
            inspect(tree, file); js++;
        } catch (error) { errors.push(`${rel}: ${error.message}`); }
    }
    if (file.endsWith('.json')) {
        try { JSON.parse(text); } catch { errors.push(`${rel}: invalid JSON`); }
    }
    if (file.endsWith('.sh')) {
        const result = spawnSync('bash', ['-n', file], { encoding: 'utf8' });
        if (result.status !== 0) errors.push(`${rel}: shell syntax check failed`);
    }
}
const python = spawnSync('python3', ['-c', 'import ast,pathlib,sys; root=pathlib.Path(sys.argv[1]); [ast.parse(p.read_text(encoding="utf-8"), filename=str(p)) for p in root.rglob("*.py") if "node_modules" not in p.parts and ".git" not in p.parts]', root], { encoding: 'utf8' });
if (python.status !== 0) errors.push('Python syntax check failed or python3 is unavailable');
if (errors.length) {
    console.error([...new Set(errors)].join('\n')); process.exitCode = 1;
} else {
    console.log(`Checked ${files.length} files, ${js} JavaScript sources; Python, Shell, JSON, local imports and release data checks passed.`);
    console.log(`Legacy limits: ${dynamicRequires} dynamic require calls and ${guardedImports} optional/host imports need runtime verification when their paths are used.`);
}
