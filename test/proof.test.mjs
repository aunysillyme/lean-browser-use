import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { root } from './helpers.mjs';

test('proof rows measure this package and carry dates and commands', t => {
  const file = path.join(root, 'proof/results.json');
  if (!fs.existsSync(file)) return t.skip('Proof generation pending.');
  const proof = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (process.env.LBU_PROOF_RUNNING && proof.rows.length === 1) return t.skip('Bootstrapping the first complete proof.');
  assert.equal(proof.version, 1);
  for (const id of ['runtime_dependencies', 'tests_passing', 'guard_rules', 'guard_ms_median', 'install_ms', 'tarball_bytes', 'tarball_files']) assert.ok(proof.rows.some(r => r.id === id), id);
  for (const row of proof.rows) {
    assert.deepEqual(Object.keys(row), ['id', 'claim', 'value', 'unit', 'measured', 'expires', 'how']);
    assert.equal(row.measured, '2026-10-25'); assert.equal(row.expires, '2027-01-25');
    assert.ok(row.how.length); assert.ok(!/saving|ratio/i.test(row.claim));
  }
  const times = proof.rows.find(r => r.id === 'guard_ms_median').value;
  for (const name of ['pick-guard', 'retry-guard', 'batch-nudge']) assert.ok(Number.isFinite(times[name]) && times[name] >= 0);
});
