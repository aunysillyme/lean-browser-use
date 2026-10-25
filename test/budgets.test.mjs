import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { root, cli, temp, firstPack } from './helpers.mjs';
import { walk, captured } from '../src/util.mjs';

test('package metadata and zero dependencies', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  assert.equal(pkg.name, 'lean-browser-use'); assert.equal(pkg.version, '0.1.0'); assert.equal(pkg.type, 'module'); assert.equal(pkg.license, 'MIT'); assert.equal(pkg.engines.node, '>=20');
  assert.equal(pkg.description, 'Cut browser use cost by up to 25% for AI agents: fresh runner subagent, bulk reads, three guards and a token meter. One npx command');
  assert.ok(pkg.description.length <= 160);
  assert.equal(pkg.dependencies, undefined); assert.equal(pkg.devDependencies, undefined);
});
test('packed tarball is within its size budget', t => {
  const dir = temp(t);
  const result = captured('npm', ['pack', '--dry-run', '--json'], { cwd: root, timeout: 15000, env: { ...process.env, npm_config_cache: path.join(dir, 'npm-cache') } });
  assert.equal(result.status, 0, result.stderr);
  const pack = firstPack(JSON.parse(result.stdout)); assert.ok(pack.size < 400000, String(pack.size));
  assert.ok(pack.files.some(f => f.path === 'bin/lean-browser-use.mjs'));
  assert.ok(!pack.files.some(f => f.path.startsWith('test/') || f.path.startsWith('.repo-build/') || f.path.includes('__pycache__') || f.path.endsWith('.pyc')));
});
test('install finishes inside its wall-clock budget', t => {
  if (!fs.existsSync(path.join(root, 'agents/aun-browser-runner.md'))) return t.skip('Writer B install assets pending.');
  const dir = temp(t); const start = performance.now(); const result = cli(['--claude-dir', path.join(dir, 'cfg'), '--yes']);
  assert.equal(result.status, 0, result.stderr); assert.ok(performance.now() - start < 5000);
});
test('source and hooks use built-ins and local modules only', () => {
  for (const folder of ['src', 'hooks']) for (const file of walk(path.join(root, folder)).filter(f => f.endsWith('.mjs'))) {
    const text = fs.readFileSync(file, 'utf8');
    for (const match of text.matchAll(/(?:from\s+|import\s*\(?\s*)['"]([^'"]+)['"]/g)) assert.ok(match[1].startsWith('node:') || match[1].startsWith('./') || match[1].startsWith('../'), `${file}: external module`);
  }
});
