import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { cli, temp, root } from './helpers.mjs';

test('doctor stable object, capabilities are optional, broken installed file fails', t => {
  if (!fs.existsSync(path.join(root, 'agents/aun-browser-runner.md'))) return t.skip('Writer B install assets pending.');
  const cfg = temp(t); const install = cli(['--claude-dir', cfg, '--yes']); assert.equal(install.status, 0, install.stderr);
  const run = () => cli(['doctor', '--claude-dir', cfg, '--json']);
  const result = run(); assert.equal(result.status, 0, result.stdout);
  const report = JSON.parse(result.stdout); assert.deepEqual(Object.keys(report), ['ok', 'checks']); assert.ok(report.ok);
  assert.ok(report.checks.filter(c => c.id.startsWith('capability:')).every(c => c.status === 'optional'));
  fs.appendFileSync(path.join(cfg, 'agents/aun-browser-runner.md'), '\nEdited\n');
  assert.equal(run().status, 1); assert.ok(JSON.parse(run().stdout).checks.some(c => c.detail === 'edited'));
  fs.chmodSync(path.join(cfg, 'lean-browser-use/hooks/pick-guard.sh'), 0o644);
  assert.ok(JSON.parse(run().stdout).checks.some(c => c.id === 'hook:pick-guard' && c.status === 'error'));
});
test('doctor detects removed registration and missing manifest', t => {
  const cfg = temp(t); assert.equal(cli(['doctor', '--claude-dir', cfg, '--json']).status, 1);
  if (!fs.existsSync(path.join(root, 'agents/aun-browser-runner.md'))) return t.skip('Writer B install assets pending.');
  assert.equal(cli(['--claude-dir', cfg, '--yes']).status, 0);
  fs.writeFileSync(path.join(cfg, 'settings.json'), '{}');
  const result = cli(['doctor', '--claude-dir', cfg, '--json']); assert.equal(result.status, 1);
  assert.ok(JSON.parse(result.stdout).checks.some(c => c.id.startsWith('registration:') && c.status === 'error'));
});
