import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { performance } from 'node:perf_hooks';
import { root } from '../src/paths.mjs';
import { captured, readJSON } from '../src/util.mjs';

const measured = '2026-10-25', expires = '2027-01-25';
const rows = [];
const record = (id, claim, value, unit, how) => rows.push({ id, claim, value, unit, measured, expires, how });
function recordBenchmark() {
  const benchmark = readJSON(path.join(root, 'proof/benchmark.json'));
  const { plain, runner } = benchmark.arms;
  const values = [
    ['paired_step_tokens_plain', 'Plain session median input-context tokens per browser step', plain.step_tokens, 'tokens'],
    ['paired_step_tokens_runner', 'Runner median input-context tokens per browser step', runner.step_tokens, 'tokens'],
    ['paired_step_ratio', 'Plain-to-runner median browser-step token ratio', Number((plain.step_tokens / runner.step_tokens).toFixed(2)), 'ratio'],
    ['paired_task_tokens_plain', 'Plain arm total browser-step input-context tokens', plain.task_tokens, 'tokens'],
    ['paired_task_tokens_runner_arm', 'Runner arm total browser-step input-context tokens', runner.task_tokens, 'tokens'],
    ['paired_task_ratio', 'Plain-to-runner arm total browser-step token ratio', Number((plain.task_tokens / runner.task_tokens).toFixed(2)), 'ratio']
  ];
  for (const [id, claim, value, unit] of values) rows.push({ id, claim, value, unit, measured: benchmark.measured, how: 'see docs/benchmark.md' });
}
const proofPath = path.join(root, 'proof/results.json');
const mode = process.argv[2];
function command(program, args, options = {}) {
  const result = captured(program, args, { cwd: root, timeout: 120000, ...options });
  if (result.error || result.status !== 0) throw new Error(`${program} check failed: ${result.stderr || result.stdout || result.error?.message}`);
  return result.stdout;
}
const temp = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'lbu-proof-'));
try {
  const pkg = readJSON(path.join(root, 'package.json'));
  record('runtime_dependencies', 'Runtime dependencies', Object.keys(pkg.dependencies || {}).length, 'dependencies', 'node scripts/proof.mjs');
  if (mode === '--bootstrap') {
    recordBenchmark();
    fs.mkdirSync(path.dirname(proofPath), { recursive: true });
    fs.writeFileSync(proofPath, `${JSON.stringify({ version: 1, rows }, null, 2)}\n`);
    console.log('Wrote dependency proof; run node scripts/proof.mjs for all measurements.');
  } else {
    const isolation = process.env.LBU_TEST_ISOLATION;
    let args = ['--test', ...(isolation === 'none' ? ['--experimental-test-isolation=none', ...fs.readdirSync(path.join(root, 'test')).filter(f => f.endsWith('.test.mjs')).sort().map(f => `test/${f}`)] : ['test/'])];
    let tests = captured(process.execPath, args, { cwd: root, timeout: 120000, env: { ...process.env, LBU_PROOF_RUNNING: '1' } });
    if (tests.error) throw tests.error;
    if (!/^ok \d+ - guard rule: /m.test(tests.stdout) && Number(process.versions.node.split('.')[0]) >= 22 && isolation !== 'none') {
      args = ['--test', '--experimental-test-isolation=none', ...fs.readdirSync(path.join(root, 'test')).filter(f => f.endsWith('.test.mjs')).sort().map(f => `test/${f}`)];
      tests = captured(process.execPath, args, { cwd: root, timeout: 120000, env: { ...process.env, LBU_PROOF_RUNNING: '1' } });
      if (tests.error) throw tests.error;
    }
    const result = tests.stdout;
    const passing = Number(result.match(/^# pass (\d+)$/m)?.[1]);
    if (!Number.isFinite(passing) || !passing) throw new Error('Test count missing from TAP.');
    record('tests_passing', 'Passing Node tests, including Python suite checks', passing, 'tests', `node ${args.join(' ')}`);
    const failed = Number(result.match(/^# fail (\d+)$/m)?.[1]);
    record('tests_failing', 'Failing Node tests at measurement time', failed, 'tests', `node ${args.join(' ')}`);
    const ruleTests = [...result.matchAll(/^ok \d+ - guard rule: /gm)].length;
    if (!ruleTests) throw new Error('Guard rule results missing from TAP; use LBU_TEST_ISOLATION=none when the sandbox restricts worker pipes.');
    record('guard_rules', 'Blocking guard rules verified by the suite', ruleTests, 'rules', `node ${args.join(' ')}`);
    const medians = {};
    for (const name of ['pick-guard', 'retry-guard', 'batch-nudge']) {
      const samples = [];
      for (let i = 0; i < 50; i++) {
        const start = performance.now();
        command('sh', [path.join(root, 'hooks', `${name}.sh`)], { input: JSON.stringify({ session_id: 'proof', hook_event_name: 'PostToolUse', tool_name: 'mcp__claude-in-chrome__list_tabs', tool_input: {} }), env: { ...process.env, LBU_STATE_DIR: path.join(temp, 'state') } });
        samples.push(performance.now() - start);
      }
      samples.sort((a, b) => a - b);
      medians[name] = Number(((samples[24] + samples[25]) / 2).toFixed(3));
    }
    record('guard_ms_median', 'Median wall time per guard via its shim over 50 calls', medians, 'ms', 'node scripts/proof.mjs');
    const start = performance.now();
    command(process.execPath, ['bin/lean-browser-use.mjs', 'install', '--claude-dir', path.join(temp, 'config'), '--yes']);
    record('install_ms', 'Install wall time into a new temporary config directory', Number((performance.now() - start).toFixed(3)), 'ms', 'node scripts/proof.mjs');
    const parsed = JSON.parse(command('npm', ['pack', '--dry-run', '--json'], { env: { ...process.env, npm_config_cache: path.join(temp, 'npm-cache') } })); const pack = Array.isArray(parsed) ? parsed[0] : Object.values(parsed)[0];
    record('tarball_bytes', 'Packed tarball size reported before this proof refresh', pack.size, 'bytes', 'npm pack --dry-run --json');
    record('tarball_files', 'Files in the packed tarball', pack.files.length, 'files', 'npm pack --dry-run --json');
    recordBenchmark();
    fs.mkdirSync(path.dirname(proofPath), { recursive: true });
    fs.writeFileSync(proofPath, `${JSON.stringify({ version: 1, rows }, null, 2)}\n`);
    console.log(JSON.stringify({ version: 1, rows }, null, 2));
    if (tests.status !== 0) { console.error('Proof written with failing tests recorded; review the full test output.'); process.exitCode = 1; }
  }
} catch (error) { console.error(error.message); process.exitCode = 1; }
finally { fs.rmSync(temp, { recursive: true, force: true }); }
