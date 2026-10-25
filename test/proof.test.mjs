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

test('paired benchmark rows match the saved run, whole-run totals and derived estimates', () => {
  const benchmark = JSON.parse(fs.readFileSync(path.join(root, 'proof/benchmark.json'), 'utf8'));
  const proof = JSON.parse(fs.readFileSync(path.join(root, 'proof/results.json'), 'utf8'));
  assert.equal(benchmark.version, 1);
  assert.equal(benchmark.measured, '2026-10-25');
  assert.equal(benchmark.conditions.one_paired_run, true);
  const { plain, runner } = benchmark.arms;
  const cost = benchmark.cost_usd;
  const expected = {
    paired_step_tokens_plain: plain.step_tokens,
    paired_step_tokens_runner: runner.step_tokens,
    paired_step_ratio: Number((plain.step_tokens / runner.step_tokens).toFixed(2)),
    paired_task_tokens_plain: plain.task_tokens,
    paired_task_tokens_runner_arm: runner.task_tokens,
    paired_task_ratio: Number((plain.task_tokens / runner.task_tokens).toFixed(2)),
    paired_run_tokens_plain: plain.whole_run.context_total,
    paired_run_tokens_runner_arm: runner.whole_run.context_total,
    paired_run_ratio: Number((plain.whole_run.context_total / runner.whole_run.context_total).toFixed(2)),
    paired_break_even_steps: benchmark.derived.break_even_browser_steps,
    paired_small_run_tokens_plain: benchmark.small_task.test_a_native.context_total,
    paired_small_run_tokens_runner_arm: benchmark.small_task.test_b_package.context_total,
    paired_small_run_ratio: Number((benchmark.small_task.test_a_native.context_total / benchmark.small_task.test_b_package.context_total).toFixed(2)),
    paired_small_step_ratio: Number((benchmark.small_task.test_a_native.browser_steps.median / benchmark.small_task.test_b_package.browser_steps.runner_median).toFixed(2)),
    paired_cost_usd_plain: cost.run1.plain.total,
    paired_cost_usd_runner_arm: cost.run1.runner.total,
    paired_small_cost_usd_plain: cost.run2.plain.total,
    paired_small_cost_usd_runner_arm: cost.run2.runner.total,
    paired_cost_best_saving_percent: cost.derived.best_percent,
    paired_cost_pooled_saving_percent: -cost.derived.pooled_percent
  };
  assert.equal(cost.pricing_source, 'https://platform.claude.com/docs/en/about-claude/pricing');
  assert.equal(cost.pricing_read, '2026-10-25');
  assert.equal(cost.cache_write_assumed, '5m');
  assert.equal(cost.price_unit, 'usd_per_million_tokens');
  assert.deepEqual(cost.prices, {
    'claude-sonnet-5-5': { input: 2, cache_write_5m: 2.5, cache_read: 0.1, output: 10 },
    'claude-haiku-5-5': { input: 0.1, cache_write_5m: 0.125, cache_read: 0.01, output: 0.5, max_prompt_tokens: 100000 }
  });
  assert.deepEqual([cost.run1.plain.total, cost.run1.runner.total, cost.run2.plain.total, cost.run2.runner.total], [0.5975, 0.5787, 0.5779, 0.4319]);
  assert.deepEqual(cost.run1.runner.model_split, { 'claude-sonnet-5-5': 0.5629, 'claude-haiku-5-5': 0.0157 });
  assert.deepEqual(cost.run2.runner.model_split, { 'claude-sonnet-5-5': 0.4215, 'claude-haiku-5-5': 0.0104 });
  assert.deepEqual(cost.derived, { run1_percent: -3.15, run2_percent: -25.26, pooled_percent: -14.02, best_percent: 25.26 });
  for (const [i, run] of [cost.run1, cost.run2].entries()) {
    assert.deepEqual(run.plain.model_split, { 'claude-sonnet-5-5': run.plain.total });
    assert.equal(cost.derived[`run${i + 1}_percent`], Number(((run.runner.total / run.plain.total - 1) * 100).toFixed(2)));
  }
  assert.equal(cost.derived.best_percent, Math.max(Math.abs(cost.derived.run1_percent), Math.abs(cost.derived.run2_percent)));
  assert.equal(cost.derived.pooled_percent, Number((((cost.run1.runner.total + cost.run2.runner.total) / (cost.run1.plain.total + cost.run2.plain.total) - 1) * 100).toFixed(2)));
  const small = benchmark.small_task;
  assert.equal(small.test_b_package.context_total, small.test_b_package.main.context_total + small.test_b_package.runner.context_total);
  assert.equal(small.derived.whole_run_delta_percent, Number(((small.test_b_package.context_total / small.test_a_native.context_total - 1) * 100).toFixed(2)));
  assert.equal(benchmark.derived.whole_run_ratio, expected.paired_run_ratio);
  assert.equal(benchmark.derived.delta_percent, Number(((runner.whole_run.context_total / plain.whole_run.context_total - 1) * 100).toFixed(2)));
  assert.equal(benchmark.derived.break_even_browser_steps, 15.54);
  assert.equal(benchmark.derived.estimate, true);
  for (const arm of [plain, runner]) {
    const run = arm.whole_run;
    if ([run.fresh_input, run.cache_creation, run.cache_read].every(Number.isInteger)) assert.equal(run.context_total, run.fresh_input + run.cache_creation + run.cache_read);
  }
  const rows = proof.rows.filter(r => r.id.startsWith('paired_'));
  assert.equal(rows.length, 20);
  for (const [id, value] of Object.entries(expected)) {
    const row = rows.find(r => r.id === id);
    assert.ok(row, id); assert.equal(row.value, value, id);
    assert.equal(row.unit, id.includes('_usd_') ? 'usd' : id.endsWith('_percent') ? 'percent' : id.endsWith('_ratio') ? 'ratio' : id === 'paired_break_even_steps' ? 'steps' : 'tokens', id);
    assert.equal(row.measured, benchmark.measured, id);
    assert.equal(row.how, 'see docs/benchmark.md', id);
    assert.ok(!Object.hasOwn(row, 'expires'), id);
    if (id === 'paired_break_even_steps') assert.match(row.claim, /estimat/i);
    if (id.startsWith('paired_task_')) assert.match(row.claim, /browser-step tokens/);
  }
});

test('docs/benchmark.md states the recorded whole-run totals and carries no unsupplied-data text', () => {
  const benchmark = JSON.parse(fs.readFileSync(path.join(root, 'proof/benchmark.json'), 'utf8'));
  const doc = fs.readFileSync(path.join(root, 'docs/benchmark.md'), 'utf8');
  const totals = [benchmark.arms.plain.whole_run.context_total, benchmark.arms.runner.whole_run.context_total, benchmark.small_task.test_a_native.context_total, benchmark.small_task.test_b_package.context_total];
  for (const n of totals) assert.ok(doc.includes(n.toLocaleString('en-US')), String(n));
  assert.ok(doc.indexOf('## What it cost in dollars') < doc.indexOf('## What was measured'));
  for (const run of [benchmark.cost_usd.run1, benchmark.cost_usd.run2]) {
    for (const arm of [run.plain, run.runner]) assert.ok(doc.includes(`$${arm.total.toFixed(4)}`));
  }
  assert.ok(doc.includes(benchmark.cost_usd.pricing_source));
  assert.match(doc, /five-minute cache writes assumed/);
  assert.match(doc, /Each model call is priced/);
  assert.match(doc, /two runs on one setup/);
  assert.match(doc, /Flat-rate subscriptions pay no per-token price/);
  assert.doesNotMatch(doc, /Unavailable|were not supplied|not supplied/);
  assert.equal(JSON.stringify(benchmark).includes('null'), false);
});
