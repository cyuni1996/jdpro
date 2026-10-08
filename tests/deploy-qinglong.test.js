'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const deploy = path.join(root, 'tools/deploy_qinglong.py');

test('deployment preserves account caches and user configuration and is idempotent', (t) => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'jdpro-deploy-'));
  t.after(() => fs.rmSync(temporary, { recursive: true, force: true }));
  const target = path.join(temporary, 'scripts', 'legacy_jdpro');
  fs.mkdirSync(path.join(target, 'BeanCache'), { recursive: true });
  fs.mkdirSync(path.join(target, 'function'), { recursive: true });
  fs.writeFileSync(path.join(target, 'BeanCache', 'account.json'), 'private cache');
  fs.writeFileSync(path.join(target, 'function', 'user.js'), 'local configuration');
  fs.writeFileSync(path.join(target, 'jdCookie.js'), 'old source');
  const run = () => spawnSync('python3', [deploy, target], { encoding: 'utf8' });
  const first = run();
  assert.equal(first.status, 0, first.stderr);
  for (const name of ['jdCookie.js', 'function/cookie.js', 'package.json', 'package-lock.json', 'requirements.txt']) {
    assert.deepEqual(fs.readFileSync(path.join(target, name)), fs.readFileSync(path.join(root, name)));
  }
  assert.equal(fs.readFileSync(path.join(target, 'BeanCache/account.json'), 'utf8'), 'private cache');
  assert.equal(fs.readFileSync(path.join(target, 'function/user.js'), 'utf8'), 'local configuration');
  for (const directory of ['tools', 'tests', 'docs', 'docker', '.git', '.github']) {
    assert.equal(fs.existsSync(path.join(target, directory)), false, directory);
  }
  const before = fs.statSync(path.join(target, 'jdCookie.js')).mtimeMs;
  const second = run();
  assert.equal(second.status, 0, second.stderr);
  assert.match(second.stdout, /\(0 updated\)/);
  assert.equal(fs.statSync(path.join(target, 'jdCookie.js')).mtimeMs, before);
  const marker = JSON.parse(fs.readFileSync(path.join(target, '.jdpro-deployment.json'), 'utf8'));
  assert.match(marker.commit, /^[0-9a-f]{40}$/);
  assert.ok(marker.files['function/jd-runtime.js']);
});

test('deployment rejects an unrelated destination before creating files', (t) => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'jdpro-deploy-'));
  t.after(() => fs.rmSync(temporary, { recursive: true, force: true }));
  const target = path.join(temporary, 'unrelated', 'account');
  const result = spawnSync('python3', [deploy, target], { encoding: 'utf8' });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /directly under scripts/);
  assert.equal(fs.existsSync(target), false);
});

test('failed dependency installation does not record a successful lock', (t) => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'jdpro-deploy-'));
  t.after(() => fs.rmSync(temporary, { recursive: true, force: true }));
  const target = path.join(temporary, 'scripts', 'legacy_jdpro');
  const bin = path.join(temporary, 'bin');
  fs.mkdirSync(path.join(target, 'node_modules'), { recursive: true });
  fs.writeFileSync(path.join(target, 'jdCookie.js'), 'previous source');
  fs.writeFileSync(path.join(target, 'node_modules/previous-runtime'), 'previous dependency');
  fs.mkdirSync(bin);
  fs.writeFileSync(path.join(bin, 'npm'), '#!/bin/sh\nexit 17\n', { mode: 0o755 });
  const result = spawnSync('python3', [deploy, target, '--install-deps'], {
    encoding: 'utf8', env: { ...process.env, PATH: `${bin}:${process.env.PATH}` },
  });
  assert.equal(result.status, 17, result.stderr);
  assert.match(result.stderr, /Deployment failed/);
  assert.equal(fs.existsSync(path.join(target, 'node_modules/.jdpro-lock.sha256')), false);
  assert.equal(fs.readFileSync(path.join(target, 'jdCookie.js'), 'utf8'), 'previous source');
  assert.equal(fs.readFileSync(path.join(target, 'node_modules/previous-runtime'), 'utf8'), 'previous dependency');
  assert.equal(fs.existsSync(path.join(target, 'function/jd-runtime.js')), false);
});
