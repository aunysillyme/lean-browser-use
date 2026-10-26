import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { root, temp, cli, run } from './helpers.mjs';
import { psTable, writeLease, readLeases } from '../hooks/lease.mjs';
import { captured } from '../src/util.mjs';

const SLEEP = ['-e', 'setTimeout(()=>{},120000)', '--'];
const alive = pid => { const row = psTable().get(pid); return !!row && !row.stat.startsWith('Z'); };
const waitFor = async (check, ms = 5000) => { const end = Date.now() + ms; while (Date.now() < end) { if (check()) return true; await new Promise(r => setTimeout(r, 50)); } return false; };

// A sandbox per test: private HOME, lease directory, fake browser executables, and cleanup of every pid started.
function lab(t) {
  const dir = temp(t); const home = path.join(dir, 'home'); const bin = path.join(dir, 'bin'); const profile = path.join(dir, 'profile');
  fs.mkdirSync(home); fs.mkdirSync(bin);
  for (const name of ['chrome', 'Google Chrome', 'node-helper']) fs.symlinkSync(process.execPath, path.join(bin, name));
  const vars = { HOME: home, LBU_LEASE_DIR: path.join(dir, 'leases'), CLAUDE_CODE_SESSION_ID: '' };
  const leaseDir = vars.LBU_LEASE_DIR;
  const pids = new Set();
  t.after(() => {
    for (const lease of readLeases(leaseDir).leases) pids.add(lease.pid);
    for (const pid of pids) try { process.kill(pid, 'SIGKILL'); } catch { /* gone */ }
  });
  const withVars = extra => ({ env: { ...process.env, ...vars, ...extra } });
  const lease = (args, extra = {}) => cli(['spawn', ...args], withVars(extra));
  const clean = (args = [], extra = {}) => cli(['cleanup', ...args], { ...withVars(extra), timeout: 20000 });
  // Start a fake automation process directly (no lease): the package never saw it.
  const start = (exe, flags, code = SLEEP) => {
    const child = spawn(path.join(bin, exe), [...code, ...flags], { stdio: 'ignore', detached: true }); child.unref(); pids.add(child.pid); return child.pid;
  };
  const chrome = (extra = []) => [path.join(bin, 'chrome'), ...SLEEP, '--headless', `--user-data-dir=${profile}`, ...extra];
  const leased = (session = 'S1', command = chrome(), extra = {}) => {
    const r = lease(['--session', session, '--', ...command], extra);
    assert.equal(r.status, 0, r.stderr);
    const pid = Number(/pid=(\d+)/.exec(r.stdout)[1]); pids.add(pid); return pid;
  };
  return { dir, home, bin, profile, vars, leaseDir, withVars, lease, clean, start, chrome, leased, pids };
}

test('spawn writes a private lease and cleanup ends the leased process', t => {
  const L = lab(t); const pid = L.leased();
  assert.ok(alive(pid));
  const files = fs.readdirSync(L.leaseDir);
  assert.equal(files.length, 1); assert.match(files[0], /^[0-9a-f]{16}\.json$/);
  assert.equal(fs.statSync(path.join(L.leaseDir, files[0])).mode & 0o777, 0o600);
  assert.equal(fs.statSync(L.leaseDir).mode & 0o777, 0o700);
  const lease = JSON.parse(fs.readFileSync(path.join(L.leaseDir, files[0]), 'utf8'));
  assert.equal(lease.pid, pid); assert.equal(lease.session, 'S1'); assert.equal(lease.kind, 'chrome');
  const r = L.clean(['--apply', '--all']);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout.trim(), /^cleanup: tabs_closed=0 ended=chrome:1 left=0$/);
  assert.equal(r.stdout.trim().split('\n').length, 1);
  assert.ok(!alive(pid)); assert.deepEqual(fs.readdirSync(L.leaseDir), []);
});

test('dry run is the default and ends nothing', t => {
  const L = lab(t); const pid = L.leased();
  const r = L.clean(['--all']);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /candidate chrome pid=\d+ processes=1/); assert.match(r.stdout, /cleanup \(dry run\): would_end=chrome:1/);
  assert.ok(alive(pid)); assert.equal(fs.readdirSync(L.leaseDir).length, 1);
  assert.equal(JSON.parse(L.clean(['--all', '--json']).stdout).apply, false);
  assert.ok(alive(pid));
});

test('real-profile-shaped, unleased and non-automation processes survive', t => {
  const L = lab(t);
  const macProfile = path.join(L.home, 'Library/Application Support/Google/Chrome');
  const linuxProfile = path.join(L.home, '.config/google-chrome');
  const exe = path.join(L.bin, 'chrome');
  // The package refuses to lease these shapes in the first place.
  const bad = [
    [exe, ...SLEEP, '--headless', `--user-data-dir=${macProfile}`],
    [exe, ...SLEEP, '--headless', `--user-data-dir=${linuxProfile}/Default`],
    [exe, ...SLEEP, '--headless', `--user-data-dir=${L.home}`],
    [exe, ...SLEEP, '--headless', `--user-data-dir=${path.dirname(macProfile)}`],
    [exe, ...SLEEP, '--headless'],
    [exe, ...SLEEP, '--headless', '--user-data-dir', L.profile],
    [exe, ...SLEEP, '--headless', '--user-data-dir=relative/dir'],
    [exe, ...SLEEP, `--user-data-dir=${L.profile}`],
    [path.join(L.bin, 'Google Chrome'), ...SLEEP]
  ];
  for (const command of bad) { const r = L.lease(['--', ...command]); assert.equal(r.status, 2, command.join(' ')); assert.match(r.stderr, /Refused/); }
  assert.deepEqual(fs.existsSync(L.leaseDir) ? fs.readdirSync(L.leaseDir) : [], []);
  // A process the package never started, even with a perfect signature, has no lease and survives.
  const unleased = L.start('chrome', ['--headless', `--user-data-dir=${L.profile}`]);
  const realLike = L.start('chrome', ['--headless', `--user-data-dir=${macProfile}`]);
  const plain = L.start('Google Chrome', []);
  // A forged lease for a live real-profile-shaped process is refused and the process survives.
  const row = psTable().get(realLike);
  writeLease({ pid: realLike, kind: 'chrome', start: row.start, command: row.command, argv: row.command.split(' '), session: 'S1', run: '', created: new Date().toISOString() }, L.leaseDir);
  const r = L.clean(['--apply', '--all']);
  assert.equal(r.status, 1, r.stdout);
  assert.match(r.stdout, /refused=1/); assert.match(r.stderr, /running command line/);
  for (const pid of [unleased, realLike, plain]) assert.ok(alive(pid), `pid ${pid}`);
});

test('pid reuse guard: a lease that no longer matches its process is stale', t => {
  const L = lab(t);
  const pid = L.start('node-helper', ['keep']); const row = psTable().get(pid);
  const base = { pid, kind: 'helper', session: 'S1', run: '', created: new Date().toISOString() };
  writeLease({ ...base, start: 'Mon Jan  1 00:00:00 2001', command: row.command, argv: row.command.split(' ') }, L.leaseDir);
  writeLease({ ...base, start: row.start, command: `${row.command} other`, argv: `${row.command} other`.split(' ') }, L.leaseDir);
  const r = L.clean(['--apply', '--all']);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /ended=none left=0 stale_leases=2/);
  assert.ok(alive(pid)); assert.deepEqual(fs.readdirSync(L.leaseDir), []);
});

test('a process that ignores SIGTERM gets SIGKILL after three seconds', t => {
  const L = lab(t);
  const code = ['-e', "process.on('SIGTERM',()=>{});setTimeout(()=>{},120000)", '--'];
  const pid = L.leased('S1', [path.join(L.bin, 'node-helper'), ...code]);
  const started = Date.now(); const r = L.clean(['--apply', '--all']); const took = Date.now() - started;
  assert.equal(r.status, 0, r.stdout + r.stderr); assert.match(r.stdout, /ended=node-helper:1 left=0/);
  assert.ok(took >= 2800, `took ${took} ms`); assert.ok(!alive(pid));
});

test('children end with their leased parent and another Chrome under the child stays', async t => {
  const L = lab(t); const out = path.join(L.dir, 'pids.json'); const real = path.join(L.home, 'Library/Application Support/Google/Chrome');
  const script = path.join(L.dir, 'helper.cjs');
  fs.writeFileSync(script, `const {spawn}=require('node:child_process');const fs=require('node:fs');
const a=spawn(process.execPath,['-e','setTimeout(()=>{},120000)'],{stdio:'ignore'});
const b=spawn(${JSON.stringify(path.join(L.bin, 'chrome'))},['-e','setTimeout(()=>{},120000)','--','--user-data-dir=${real}'],{stdio:'ignore'});
fs.writeFileSync(${JSON.stringify(out)},JSON.stringify([a.pid,b.pid]));setTimeout(()=>{},120000);`);
  const parent = L.leased('S1', [path.join(L.bin, 'node-helper'), script]);
  assert.ok(await waitFor(() => fs.existsSync(out)));
  const [child, userChrome] = JSON.parse(fs.readFileSync(out, 'utf8')); L.pids.add(child); L.pids.add(userChrome);
  assert.ok(alive(child) && alive(userChrome));
  const r = L.clean(['--apply', '--all']);
  assert.equal(r.status, 0, r.stdout + r.stderr); assert.match(r.stdout, /ended=node-helper:2 left=0 kept_other_chrome=1/);
  assert.ok(!alive(parent)); assert.ok(!alive(child)); assert.ok(alive(userChrome));
});

test('cleanup refuses to end a leased ancestor of itself', async t => {
  const L = lab(t); const out = path.join(L.dir, 'result.json'); const script = path.join(L.dir, 'self.cjs');
  fs.writeFileSync(script, `const {spawnSync}=require('node:child_process');const fs=require('node:fs');
const r=spawnSync(process.execPath,[${JSON.stringify(path.join(root, 'bin/lean-browser-use.mjs'))},'cleanup','--apply','--all'],{encoding:'utf8'});
fs.writeFileSync(${JSON.stringify(out)},JSON.stringify({status:r.status,stdout:r.stdout,stderr:r.stderr}));setTimeout(()=>{},120000);`);
  const pid = L.leased('S1', [path.join(L.bin, 'node-helper'), script]);
  assert.ok(await waitFor(() => fs.existsSync(out)));
  const result = JSON.parse(fs.readFileSync(out, 'utf8'));
  assert.equal(result.status, 1); assert.match(result.stderr, /ancestor of this cleanup run/); assert.match(result.stdout, /refused=1/);
  assert.ok(alive(pid));
});

test('session scope: only the named session is ended; the default follows the environment', t => {
  const L = lab(t); const a = L.leased('A'); const b = L.leased('B', [path.join(L.bin, 'chrome'), ...SLEEP, '--headless', `--user-data-dir=${L.profile}-b`]);
  assert.equal(L.clean(['--apply', '--session', 'A']).status, 0);
  assert.ok(!alive(a)); assert.ok(alive(b));
  const r = L.clean(['--apply'], { CLAUDE_CODE_SESSION_ID: 'other' });
  assert.match(r.stdout, /ended=none/); assert.ok(alive(b));
  assert.equal(L.clean(['--apply'], { CLAUDE_CODE_SESSION_ID: 'B' }).status, 0); assert.ok(!alive(b));
});

const hookRun = (L, payload, shim = false) => {
  const input = typeof payload === 'string' ? payload : JSON.stringify(payload);
  return shim ? captured('sh', [path.join(root, 'hooks/cleanup.sh')], { input, ...L.withVars(), timeout: 20000 }) : run('hooks/cleanup.mjs', [], { input, ...L.withVars(), timeout: 20000 });
};
test('hooks: Stop, SessionEnd and SubagentStop end the session leases and always exit 0', t => {
  const L = lab(t);
  const ev = (name, extra = {}) => ({ session_id: 'S1', hook_event_name: name, ...extra });
  let pid = L.leased('S1');
  let r = hookRun(L, ev('SubagentStop', { agent_type: 'Explore' })); assert.equal(r.status, 0); assert.ok(alive(pid));
  r = hookRun(L, ev('Stop', { background_tasks: [{ type: 'subagent', status: 'running' }] })); assert.equal(r.status, 0); assert.ok(alive(pid));
  r = hookRun(L, { ...ev('SessionEnd'), session_id: 'S2' }); assert.equal(r.status, 0); assert.ok(alive(pid));
  r = hookRun(L, ev('SubagentStop', { agent_type: 'aun-browser-runner' }), true); assert.equal(r.status, 0); assert.equal(r.stdout, ''); assert.ok(!alive(pid));
  for (const name of ['Stop', 'SessionEnd']) { pid = L.leased('S1'); r = hookRun(L, ev(name, { background_tasks: [] })); assert.equal(r.status, 0); assert.equal(r.stdout, ''); assert.ok(!alive(pid), name); }
  pid = L.leased('S1'); r = hookRun(L, ev('PreToolUse')); assert.equal(r.status, 0); assert.ok(alive(pid));
});

test('hooks: malformed or hostile payloads exit 0 and touch nothing', t => {
  const L = lab(t); const pid = L.leased('S1');
  for (const bad of ['{malformed', '', '[]', 'null', '{"session_id":5,"hook_event_name":"Stop"}', '{"hook_event_name":"Stop"}', '{"session_id":"","hook_event_name":"Stop"}', `{"session_id":"${'x'.repeat(500)}","hook_event_name":"Stop"}`]) {
    for (const shim of [false, true]) { const r = hookRun(L, bad, shim); assert.equal(r.status, 0, bad); assert.equal(r.stdout, ''); }
  }
  assert.ok(alive(pid));
  const noNode = captured('/bin/sh', [path.join(root, 'hooks/cleanup.sh')], { input: '{}', env: { ...process.env, ...L.vars, PATH: '/nonexistent' } });
  assert.equal(noNode.status, 0);
});

test('invalid and unsafe lease files are ignored, never obeyed', t => {
  const L = lab(t); const pid = L.start('node-helper', ['keep']);
  fs.mkdirSync(L.leaseDir, { recursive: true, mode: 0o700 });
  fs.writeFileSync(path.join(L.leaseDir, '0123456789abcdef.json'), '{broken');
  fs.writeFileSync(path.join(L.leaseDir, 'ffffffffffffffff.json'), JSON.stringify({ v: 1, id: 'ffffffffffffffff', pid, kind: 'helper' }));
  fs.writeFileSync(path.join(L.leaseDir, 'notes.txt'), 'x');
  const r = L.clean(['--apply', '--all']);
  assert.equal(r.status, 0, r.stdout + r.stderr); assert.ok(alive(pid));
  const link = path.join(L.dir, 'link');
  try { fs.symlinkSync(L.leaseDir, link, 'dir'); } catch { return; }
  assert.match(L.clean(['--apply', '--all'], { LBU_LEASE_DIR: link }).stdout, /ended=none/);
});

test('spawn refuses unsafe commands and a missing command', t => {
  const L = lab(t);
  assert.equal(L.lease([]).status, 2); assert.equal(L.lease(['--']).status, 2); assert.equal(L.lease(['--bogus', '--', 'true']).status, 2);
  const app = L.lease(['--', '/Applications/Calculator.app/Contents/MacOS/Calculator']); assert.equal(app.status, 2); assert.match(app.stderr, /desktop app/);
  assert.equal(L.lease(['--', path.join(L.bin, 'no-such-program')]).status, 2);
  assert.equal(L.lease(['--', 'firefox', '--headless']).status, 2);
});

test('doctor reports leftover leased processes and passes once they are gone', t => {
  const L = lab(t); const cfg = path.join(L.dir, 'cfg');
  const opts = L.withVars();
  assert.equal(cli(['--claude-dir', cfg, '--yes'], opts).status, 0);
  assert.equal(cli(['doctor', '--claude-dir', cfg], opts).status, 0);
  const pid = L.leased('S1');
  const d = cli(['doctor', '--claude-dir', cfg], opts);
  assert.equal(d.status, 1); assert.match(d.stdout, /error\tleftover-processes\tLeftover leased processes: chrome pid \d+/);
  assert.ok(JSON.parse(cli(['doctor', '--claude-dir', cfg, '--json'], opts).stdout).checks.some(c => c.id === 'hook:cleanup' && c.status === 'ok'));
  assert.equal(L.clean(['--apply', '--all']).status, 0); assert.ok(!alive(pid));
  assert.equal(cli(['doctor', '--claude-dir', cfg], opts).status, 0);
});

test('installer registers the cleanup hooks once and uninstall removes only them', t => {
  const dir = temp(t); const cfg = path.join(dir, 'cfg'); fs.mkdirSync(cfg);
  const user = { hooks: { Stop: [{ hooks: [{ type: 'command', command: 'echo mine' }] }] }, theme: 'dark' };
  fs.writeFileSync(path.join(cfg, 'settings.json'), JSON.stringify(user));
  assert.equal(cli(['--claude-dir', cfg, '--yes']).status, 0);
  const first = fs.readFileSync(path.join(cfg, 'settings.json'), 'utf8'); const settings = JSON.parse(first);
  const ours = event => settings.hooks[event].filter(e => e.hooks.some(h => h.command.includes('/lean-browser-use/hooks/cleanup.sh')));
  assert.equal(ours('SubagentStop').length, 1); assert.equal(ours('SubagentStop')[0].matcher, 'aun-browser-runner');
  assert.equal(ours('Stop').length, 1); assert.equal(ours('SessionEnd').length, 1);
  assert.ok(ours('SessionEnd')[0].hooks[0].timeout >= 10);
  assert.ok(fs.statSync(path.join(cfg, 'lean-browser-use/hooks/cleanup.sh')).mode & 0o100);
  assert.equal(cli(['--claude-dir', cfg, '--yes']).status, 0);
  assert.equal(fs.readFileSync(path.join(cfg, 'settings.json'), 'utf8'), first);
  assert.equal(cli(['uninstall', '--claude-dir', cfg]).status, 0);
  const after = JSON.parse(fs.readFileSync(path.join(cfg, 'settings.json'), 'utf8'));
  assert.deepEqual(after, user);
  assert.ok(!fs.existsSync(path.join(cfg, 'lean-browser-use')));
});

test('cleanup closes page tabs through the leased Chrome loopback debugging port', async t => {
  const L = lab(t); const closed = [];
  const server = http.createServer((req, res) => {
    if (req.url === '/json/list') res.end(JSON.stringify([{ id: 'A1', type: 'page' }, { id: 'B2', type: 'page' }, { id: 'W3', type: 'service_worker' }]));
    else if (req.url.startsWith('/json/close/')) { closed.push(req.url.split('/').pop()); res.end('Target is closing'); } else { res.statusCode = 404; res.end(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); t.after(() => server.close());
  const port = server.address().port;
  const pid = L.leased('S1', L.chrome([`--remote-debugging-port=${port}`]));
  const { stdout } = await promisify(execFile)(process.execPath, [path.join(root, 'bin/lean-browser-use.mjs'), 'cleanup', '--apply', '--all'], L.withVars());
  assert.match(stdout.trim(), /^cleanup: tabs_closed=2 ended=chrome:1 left=0$/);
  assert.deepEqual(closed.sort(), ['A1', 'B2']); assert.ok(!alive(pid));
});
