import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { root } from './helpers.mjs';

test('proof rows measure this package and carry dates and commands', t => {
  const file = path.join(root, 'proof/results.json');
  if (!fs.existsSync(file)) return t.skip('Proof generation pending.');
  const proof = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (process.env.LBU_PROOF_RUNNING && !proof.rows.some(r => r.id === 'guard_ms_median')) return t.skip('Bootstrapping the first complete proof.');
  assert.equal(proof.version, 1);
  for (const id of ['runtime_dependencies', 'tests_passing', 'guard_rules', 'guard_ms_median', 'install_ms', 'tarball_bytes', 'tarball_files']) assert.ok(proof.rows.some(r => r.id === id), id);
  for (const row of proof.rows) {
    const benchmark = row.id.startsWith('paired_');
    assert.deepEqual(Object.keys(row), ['id', 'claim', 'value', 'unit', 'measured', ...(benchmark ? [] : ['expires']), 'how']);
    assert.equal(row.measured, '2026-10-25');
    if (benchmark) assert.equal(row.how, 'see docs/benchmark.md');
    else { assert.equal(row.expires, '2027-01-25'); assert.ok(!/saving|ratio/i.test(row.claim)); }
    assert.ok(row.claim.length); assert.ok(row.how.length);
  }
  const times = proof.rows.find(r => r.id === 'guard_ms_median').value;
  for (const name of ['pick-guard', 'retry-guard', 'batch-nudge']) assert.ok(Number.isFinite(times[name]) && times[name] >= 0);
});

test('paired benchmark rows match the saved run and derived ratios', () => {
  const benchmark = JSON.parse(fs.readFileSync(path.join(root, 'proof/benchmark.json'), 'utf8'));
  const proof = JSON.parse(fs.readFileSync(path.join(root, 'proof/results.json'), 'utf8'));
  assert.equal(benchmark.version, 1);
  assert.equal(benchmark.measured, '2026-10-25');
  assert.equal(benchmark.conditions.one_paired_run, true);
  const { plain, runner } = benchmark.arms;
  const expected = {
    paired_step_tokens_plain: plain.step_tokens,
    paired_step_tokens_runner: runner.step_tokens,
    paired_step_ratio: Number((plain.step_tokens / runner.step_tokens).toFixed(2)),
    paired_task_tokens_plain: plain.task_tokens,
    paired_task_tokens_runner_arm: runner.task_tokens,
    paired_task_ratio: Number((plain.task_tokens / runner.task_tokens).toFixed(2))
  };
  const rows = proof.rows.filter(r => r.id.startsWith('paired_'));
  assert.equal(rows.length, 6);
  for (const [id, value] of Object.entries(expected)) {
    const row = rows.find(r => r.id === id);
    assert.ok(row, id); assert.equal(row.value, value, id);
    assert.equal(row.unit, id.endsWith('_ratio') ? 'ratio' : 'tokens', id);
    assert.equal(row.measured, benchmark.measured, id);
    assert.equal(row.how, 'see docs/benchmark.md', id);
    assert.ok(!Object.hasOwn(row, 'expires'), id);
  }
});
