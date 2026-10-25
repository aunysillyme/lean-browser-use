import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { root, temp } from './helpers.mjs';
import { captured } from '../src/util.mjs';

test('packed artifact installs, diagnoses and measures without an npm install', t => {
  if (!fs.existsSync(path.join(root, 'agents/aun-browser-runner.md'))) return t.skip('Writer B install assets pending.');
  const dir = temp(t);
  const pack = captured('npm', ['pack', '--json', '--pack-destination', dir], { cwd: root, timeout: 15000, env: { ...process.env, npm_config_cache: path.join(dir, 'cache') } });
  assert.equal(pack.status, 0, pack.stderr);
  const tarball = path.join(dir, JSON.parse(pack.stdout)[0].filename);
  const extracted = captured('tar', ['-xzf', tarball, '-C', dir], { timeout: 5000 });
  assert.equal(extracted.status, 0, extracted.stderr);
  const bin = path.join(dir, 'package/bin/lean-browser-use.mjs');
  const cfg = path.join(dir, 'config');
  const call = args => captured(process.execPath, [bin, ...args], { timeout: 10000 });
  assert.equal(call(['install', '--claude-dir', cfg, '--yes', '--with-reader']).status, 0);
  const doctor = call(['doctor', '--claude-dir', cfg, '--json']);
  assert.equal(doctor.status, 0, doctor.stdout); assert.equal(JSON.parse(doctor.stdout).ok, true);
  const measure = call(['measure', '--dir', path.join(root, 'test/fixtures/transcripts'), '--json']);
  assert.equal(measure.status, 0); assert.equal(JSON.parse(measure.stdout).main.steps, 3);
  assert.equal(call(['uninstall', '--claude-dir', cfg]).status, 0);
});
