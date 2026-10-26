// Lease-based cleanup: end only the processes this package started and can prove.
// A lease is a small file written by `lean-browser-use spawn`. It records the
// process id, start time and exact command line. A process is ended only when the
// live process still matches its lease and passes a strict signature check.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';

export const TERM_WAIT_MS = 3000;
const KILL_WAIT_MS = 1500;
const POLL_MS = 100;
const ID = /^[0-9a-f]{16}$/;
const uid = () => (typeof process.getuid === 'function' ? process.getuid() : -1);
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

export function leaseDir(env = process.env) {
  if (env.LBU_LEASE_DIR) return path.resolve(env.LBU_LEASE_DIR);
  return path.join(env.XDG_STATE_HOME || path.join(os.homedir(), '.local', 'state'), 'lean-browser-use', 'leases');
}
export const sessionFromEnv = (env = process.env) => String(env.CLAUDE_CODE_SESSION_ID || env.CLAUDE_SESSION_ID || '');

// Regular files keep this working where child-process pipes are restricted.
function capture(command, args) {
  const dir = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'lbu-ps-'));
  const file = path.join(dir, 'out');
  const fd = fs.openSync(file, 'w');
  try {
    const result = spawnSync(command, args, { stdio: ['ignore', fd, 'ignore'], env: { ...process.env, LC_ALL: 'C' }, timeout: 8000 });
    if (result.error || result.status !== 0) throw new Error(`${command} failed`);
    return fs.readFileSync(file, 'utf8');
  } finally { fs.closeSync(fd); fs.rmSync(dir, { recursive: true, force: true }); }
}

const ROW = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(\S+)\s+(\w{3}\s+\w{3}\s+\d{1,2}\s+\d{2}:\d{2}:\d{2}\s+\d{4})\s+(.*)$/;
export function psTable() {
  const rows = new Map();
  for (const line of capture('ps', ['-axww', '-o', 'pid=,ppid=,uid=,stat=,lstart=,command=']).split('\n')) {
    const m = ROW.exec(line);
    if (m) rows.set(Number(m[1]), { pid: Number(m[1]), ppid: Number(m[2]), uid: Number(m[3]), stat: m[4], start: m[5].replace(/\s+/g, ' '), command: m[6] });
  }
  return rows;
}
export function psOne(pid) {
  const m = ROW.exec(capture('ps', ['-ww', '-p', String(pid), '-o', 'pid=,ppid=,uid=,stat=,lstart=,command=']).split('\n')[0] || '');
  return m ? { pid: Number(m[1]), ppid: Number(m[2]), uid: Number(m[3]), stat: m[4], start: m[5].replace(/\s+/g, ' '), command: m[6] } : null;
}
const isLive = row => !!row && !row.stat.startsWith('Z');
export function ancestors(table, pid = process.pid) {
  const chain = new Set([pid]);
  for (let row = table.get(pid); row && !chain.has(row.ppid) && row.ppid > 0; row = table.get(row.ppid)) chain.add(row.ppid);
  return chain;
}

// Signatures -------------------------------------------------------------------
const CHROMIUM = /^(?:google[ -]chrome(?:[ -](?:stable|beta|dev|canary|for testing))*|chrome|chromium(?:-browser)?|chrome-headless-shell|headless_shell|microsoft[ -]edge(?:[ -](?:beta|dev))?|msedge|brave(?:[ -]browser)?|vivaldi(?:-stable)?|opera)(?:\.exe)?$/i;
const CHROMIUM_START = /^(?:google[ -]chrome|chromium|chrome|headless_shell|microsoft[ -]edge|msedge|brave|vivaldi|opera)/i;
const OTHER_BROWSER = /^(?:firefox|safari|arc|tor browser|waterfox|librewolf)(?:\.exe)?$/i;
const norm = value => (process.platform === 'linux' ? value : value.toLowerCase());
const inside = (child, parent) => { const rel = path.relative(norm(parent), norm(child)); return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel)); };

export function realProfileRoots(home = os.homedir()) {
  const mac = ['Google/Chrome', 'Google/Chrome Beta', 'Google/Chrome Dev', 'Google/Chrome Canary', 'Chromium', 'Microsoft Edge', 'Microsoft Edge Beta', 'Microsoft Edge Dev', 'BraveSoftware', 'Vivaldi', 'Arc', 'com.operasoftware.Opera'];
  const linux = ['google-chrome', 'google-chrome-beta', 'google-chrome-unstable', 'chromium', 'microsoft-edge', 'microsoft-edge-beta', 'BraveSoftware', 'vivaldi', 'opera'];
  const roots = [...mac.map(n => path.join(home, 'Library', 'Application Support', n)), ...linux.map(n => path.join(home, '.config', n)), path.join(home, 'snap', 'chromium'), path.join(home, 'snap', 'brave'), path.join(home, '.var', 'app')];
  for (const base of [process.env.LOCALAPPDATA, process.env.APPDATA].filter(Boolean)) roots.push(path.join(base, 'Google'), path.join(base, 'Chromium'), path.join(base, 'Microsoft', 'Edge'), path.join(base, 'BraveSoftware'));
  for (const extra of String(process.env.LBU_PROTECTED_PROFILES || '').split(path.delimiter).filter(Boolean)) roots.push(path.resolve(extra));
  return roots;
}
function resolved(target) {
  let current = path.resolve(target); const tail = [];
  for (;;) {
    try { return path.join(fs.realpathSync(current), ...tail); }
    catch { const parent = path.dirname(current); if (parent === current) return path.resolve(target); tail.unshift(path.basename(current)); current = parent; }
  }
}
export function unsafeProfile(dir, home = os.homedir()) {
  const forms = [path.resolve(dir), resolved(dir)];
  const homes = [path.resolve(home), resolved(home)];
  const roots = realProfileRoots(home).flatMap(root => [root, resolved(root)]);
  return forms.some(form => inside(homes[0], form) || inside(homes[1], form) || roots.some(root => inside(form, root) || inside(root, form)));
}
export function userDataDir(argv) {
  let found = null;
  for (const arg of argv) if (arg === '--user-data-dir') return '';
  else if (arg.startsWith('--user-data-dir=')) found = arg.slice('--user-data-dir='.length);
  return found;
}
const automationFlag = arg => /^--headless(=.*)?$/.test(arg) || /^--remote-debugging-(port=\d+|pipe(=.*)?)$/.test(arg);
export function classify(argv, { home } = {}) {
  const no = reason => ({ ok: false, reason });
  if (!Array.isArray(argv) || !argv.length || argv.some(arg => typeof arg !== 'string' || arg.includes('\0'))) return no('the command is empty or malformed');
  const exe = path.basename(argv[0]);
  if (CHROMIUM.test(exe)) {
    const dir = userDataDir(argv);
    if (!dir) return no('Chrome needs an explicit --user-data-dir=PATH');
    if (!path.isAbsolute(dir)) return no('the user data directory must be an absolute path');
    if (unsafeProfile(dir, home)) return no('the user data directory is, or contains, a real browser profile');
    if (!argv.some(automationFlag)) return no('Chrome needs --headless or --remote-debugging-port=N');
    return { ok: true, kind: 'chrome' };
  }
  if (OTHER_BROWSER.test(exe)) return no('this browser is not an automation Chrome');
  if (/\.app\/Contents\/MacOS\//.test(argv[0])) return no('a desktop app executable is never leased');
  return { ok: true, kind: 'helper' };
}
// Judge the running command line itself. Wrappers and interpreters can re-exec, so the
// live text is the ground truth for what is running, not the argument list.
const programOf = command => path.basename(command.split(/ -/)[0]);
function userDataDirs(command) {
  const at = command.indexOf('--user-data-dir=');
  if (at < 0) return [];
  const rest = command.slice(at + '--user-data-dir='.length);
  const ends = [...rest.matchAll(/ --/g)].map(m => m.index);
  return [...new Set([...ends, rest.length])].map(end => rest.slice(0, end)).filter(Boolean);
}
export function liveVerdict(command, { home } = {}) {
  const no = reason => ({ ok: false, reason });
  const program = programOf(command);
  if (CHROMIUM_START.test(program)) {
    const dirs = userDataDirs(command);
    if (!dirs.length || dirs.some(dir => !path.isAbsolute(dir) || unsafeProfile(dir, home))) return no('the running command line is not an automation Chrome with a private profile');
    if (!/ --(headless|remote-debugging-port=\d+|remote-debugging-pipe)/.test(command)) return no('the running Chrome has no automation flag');
    return { ok: true, kind: 'chrome' };
  }
  if (OTHER_BROWSER.test(program.split(' ')[0])) return no('this browser is not an automation Chrome');
  return { ok: true, kind: 'helper' };
}
const labelOf = lease => (lease.kind === 'chrome' ? 'chrome' : path.basename(lease.argv[0]));

// Leases -----------------------------------------------------------------------
function secureDir(dir) {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const stat = fs.lstatSync(dir);
  if (stat.isSymbolicLink() || !stat.isDirectory() || (stat.uid !== uid() && uid() !== -1)) throw new Error('Unsafe lease directory');
  if ((stat.mode & 0o077) !== 0) fs.chmodSync(dir, 0o700);
}
export function writeLease(entry, dir = leaseDir()) {
  secureDir(dir);
  const id = randomBytes(8).toString('hex');
  const lease = { v: 1, id, ...entry };
  fs.writeFileSync(path.join(dir, `${id}.json`), `${JSON.stringify(lease)}\n`, { mode: 0o600, flag: 'wx' });
  return lease;
}
function valid(lease, id) {
  return lease && typeof lease === 'object' && lease.v === 1 && lease.id === id && Number.isInteger(lease.pid) && lease.pid > 1 &&
    ['chrome', 'helper'].includes(lease.kind) && typeof lease.start === 'string' && typeof lease.command === 'string' &&
    Array.isArray(lease.argv) && lease.argv.length > 0 && lease.argv.every(arg => typeof arg === 'string') &&
    typeof lease.session === 'string' && typeof lease.run === 'string' && typeof lease.created === 'string';
}
export function readLeases(dir = leaseDir()) {
  const leases = [], invalid = [];
  let names;
  try {
    const stat = fs.lstatSync(dir);
    if (stat.isSymbolicLink() || !stat.isDirectory()) return { leases, invalid: [dir] };
    names = fs.readdirSync(dir);
  } catch { return { leases, invalid }; }
  for (const name of names.sort()) {
    const match = /^([0-9a-f]{16})\.json$/.exec(name);
    if (!match) continue;
    const file = path.join(dir, name);
    try {
      const stat = fs.lstatSync(file);
      if (!stat.isFile() || (stat.uid !== uid() && uid() !== -1) || (stat.mode & 0o077) !== 0) throw new Error('not ours');
      const lease = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (!valid(lease, match[1]) || !ID.test(lease.id)) throw new Error('invalid');
      leases.push(lease);
    } catch { invalid.push(file); }
  }
  return { leases, invalid };
}
export function removeLease(lease, dir = leaseDir()) {
  if (!ID.test(lease.id)) return;
  const file = path.join(dir, `${lease.id}.json`);
  try { if (fs.lstatSync(file).isFile()) fs.unlinkSync(file); } catch { /* already gone */ }
}

// Scan: decide, without touching anything, what each lease proves ---------------
// A descendant that is a main Chrome process outside the rules, or a desktop app
// outside the leader's own bundle, is the user's and stays running.
function protectedProcess(row, leader, home) {
  const head = row.command.split(/ -/)[0];
  if (CHROMIUM_START.test(path.basename(head)) && !/ --type=/.test(row.command) && !liveVerdict(row.command, { home }).ok) return true;
  if (!row.command.includes('.app/Contents/')) return false;
  const bundle = leader.command.includes('.app/') ? `${leader.command.split('.app/')[0]}.app/` : null;
  if (bundle && row.command.startsWith(bundle)) return false;
  return !/\/Python\.app\/Contents\//.test(row.command);
}
function subtree(table, root, home) {
  const leader = table.get(root);
  const children = new Map();
  for (const row of table.values()) { if (!children.has(row.ppid)) children.set(row.ppid, []); children.get(row.ppid).push(row); }
  const order = []; let kept = 0;
  const walk = row => {
    for (const child of (children.get(row.pid) || []).sort((a, b) => a.pid - b.pid)) {
      if (!isLive(child) || child.pid === row.pid) continue;
      if (child.uid !== uid() || protectedProcess(child, leader, home)) { kept++; continue; }
      walk(child); order.push(child);
    }
  };
  walk(table.get(root));
  return { kill: order.map(({ pid, start, command, uid: owner }) => ({ pid, start, command, uid: owner })), kept };
}
function evaluate(lease, table, mine, home) {
  const row = table.get(lease.pid);
  if (!isLive(row)) return { lease, state: 'gone' };
  if (row.uid !== uid() || row.start !== lease.start || row.command !== lease.command) return { lease, state: 'reused' };
  const refuse = reason => ({ lease, state: 'refused', reason });
  const verdict = liveVerdict(row.command, { home });
  if (!verdict.ok) return refuse(verdict.reason);
  if (verdict.kind !== lease.kind) return refuse('the lease kind does not match the running command');
  if (mine.has(lease.pid)) return refuse('it is an ancestor of this cleanup run');
  const tree = subtree(table, lease.pid, home);
  if (tree.kill.some(item => mine.has(item.pid))) return refuse('it contains an ancestor of this cleanup run');
  return { lease, state: 'live', row, tree };
}
export function scan({ session, run, home, dir } = {}) {
  const table = psTable();
  const mine = ancestors(table);
  const { leases, invalid } = readLeases(dir);
  const items = leases.filter(l => (!session || l.session === session) && (!run || l.run === run)).map(l => evaluate(l, table, mine, home));
  return { table, items, invalid };
}

// Reap -------------------------------------------------------------------------
function signal(pid, name) { try { process.kill(pid, name); } catch { /* already gone or not ours */ } }
const same = (row, s) => isLive(row) && row.uid === s.uid && row.start === s.start && row.command === s.command;
// Read the single process again right before each signal, so the window for a recycled pid is a few milliseconds.
function signalIfSame(s, name) {
  let row;
  try { row = psOne(s.pid); } catch { return; }
  if (same(row, s)) signal(s.pid, name);
}
async function endAll(snaps) {
  const survivors = () => { const table = psTable(); return snaps.filter(s => same(table.get(s.pid), s)); };
  const settle = async ms => {
    const limit = Date.now() + ms;
    let live;
    do { await sleep(POLL_MS); live = survivors(); } while (live.length && Date.now() < limit);
    return live;
  };
  for (const s of survivors()) signalIfSame(s, 'SIGTERM');
  let live = await settle(TERM_WAIT_MS);
  if (live.length) {
    // Only a process that still matches its snapshot gets SIGKILL.
    for (const s of live) signalIfSame(s, 'SIGKILL');
    live = await settle(KILL_WAIT_MS);
  }
  return { ended: snaps.length - live.length, left: live.length };
}
function debugPort(command) {
  const arg = /--remote-debugging-port=(\d+)/.exec(command)?.[1];
  if (arg === undefined) return 0;
  const port = Number(arg);
  if (port > 0 && port < 65536) return port;
  const dir = userDataDirs(command)[0];
  try {
    const file = path.join(dir, 'DevToolsActivePort');
    const stat = fs.lstatSync(file);
    if (!stat.isFile() || stat.size > 200 || (stat.uid !== uid() && uid() !== -1)) return 0;
    const value = Number(fs.readFileSync(file, 'utf8').split('\n')[0]);
    return value > 0 && value < 65536 ? value : 0;
  } catch { return 0; }
}
// The port must be listened on by the leased tree itself; any other owner means no request is sent.
function listenerPids(port) {
  try {
    return capture('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-Fp']).split('\n').filter(l => l.startsWith('p')).map(l => Number(l.slice(1)));
  } catch { return []; }
}
// Close page tabs through the leased Chrome's own loopback debugging port.
async function closeTabs(lease, row, tree) {
  const port = lease.kind === 'chrome' ? debugPort(row.command) : 0;
  if (!port) return 0;
  const owners = listenerPids(port);
  const owned = new Set([row.pid, ...tree.kill.map(item => item.pid)]);
  if (!owners.length || !owners.every(pid => owned.has(pid))) return 0;
  const base = `http://127.0.0.1:${port}`;
  try {
    const targets = await (await fetch(`${base}/json/list`, { signal: AbortSignal.timeout(1500) })).json();
    let closed = 0;
    for (const target of Array.isArray(targets) ? targets : []) {
      if (target?.type !== 'page' || !/^[A-Za-z0-9-]{1,80}$/.test(String(target.id))) continue;
      const response = await fetch(`${base}/json/close/${target.id}`, { signal: AbortSignal.timeout(1500) });
      if (response.ok) closed++;
    }
    return closed;
  } catch { return 0; }
}
export async function reap({ apply = false, session, run, home, dir } = {}) {
  const { items, invalid } = scan({ session, run, home, dir });
  const result = { apply, candidates: [], stale: 0, refused: [], kept: 0, invalid: invalid.length, tabsClosed: 0, ended: {}, left: 0 };
  for (const item of items) {
    const lease = item.lease;
    if (item.state === 'gone' || item.state === 'reused') { result.stale++; if (apply) removeLease(lease, dir); continue; }
    if (item.state === 'refused') { result.refused.push({ id: lease.id, pid: lease.pid, reason: item.reason }); continue; }
    const name = labelOf(lease);
    result.candidates.push({ id: lease.id, name, kind: lease.kind, pid: lease.pid, processes: item.tree.kill.length + 1, ageSeconds: Math.max(0, Math.round((Date.now() - Date.parse(lease.created)) / 1000) || 0), session: lease.session, run: lease.run });
    result.kept += item.tree.kept;
    if (!apply) { result.ended[name] = (result.ended[name] || 0) + item.tree.kill.length + 1; continue; }
    result.tabsClosed += await closeTabs(lease, item.row, item.tree);
    const leader = { pid: item.row.pid, start: item.row.start, command: item.row.command, uid: item.row.uid };
    const outcome = await endAll([...item.tree.kill, leader]);
    result.ended[name] = (result.ended[name] || 0) + outcome.ended;
    result.left += outcome.left;
    const after = psTable().get(lease.pid);
    if (!isLive(after) || after.start !== lease.start) removeLease(lease, dir);
  }
  return result;
}
const names = counts => Object.entries(counts).filter(([, n]) => n > 0).map(([name, n]) => `${name.replace(/[\s,:]+/g, '_')}:${n}`).join(',') || 'none';
export function summary(result) {
  const extra = `${result.stale ? ` stale_leases=${result.stale}` : ''}${result.refused.length ? ` refused=${result.refused.length}` : ''}${result.kept ? ` kept_other_chrome=${result.kept}` : ''}`;
  if (!result.apply) return `cleanup (dry run): would_end=${names(result.ended)}${extra}`;
  return `cleanup: tabs_closed=${result.tabsClosed} ended=${names(result.ended)} left=${result.left}${extra}`;
}
export const exitCodeFor = result => (result.apply && (result.left > 0 || result.refused.length > 0) ? 1 : 0);
export function age(seconds) {
  if (seconds < 90) return `${seconds}s`;
  if (seconds < 5400) return `${Math.round(seconds / 60)}m`;
  if (seconds < 172800) return `${Math.round(seconds / 3600)}h`;
  return `${Math.round(seconds / 86400)}d`;
}
