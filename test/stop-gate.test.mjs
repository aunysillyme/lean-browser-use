import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { cli, temp, hook, run, root } from './helpers.mjs';
import { hash } from '../hooks/common.mjs';
import { captured } from '../src/util.mjs';

const action = (surface = 'pane', extra = {}) => ({ session_id: 'session', hook_event_name: 'PostToolUse', tool_name: `mcp__${surface === 'pane' ? 'Claude_Browser' : 'claude-in-chrome'}__navigate`, tool_response: {}, ...extra });
const stop = (extra = {}) => ({ session_id: 'session', hook_event_name: 'Stop', stop_hook_active: false, background_tasks: [], ...extra });
const agentStop = (extra = {}) => stop({ hook_event_name: 'SubagentStop', agent_type: 'aun-browser-runner', agent_id: 'a1', ...extra });
const file = (dir, agent = '', session = 'session') => path.join(dir, 'use', hash(agent ? `${session}\0${agent}` : session).slice(0, 24));
const state = (dir, agent = '', session = 'session') => JSON.parse(fs.readFileSync(file(dir, agent, session), 'utf8'));
const touch = (dir, p = action()) => silent(hook('touch', p, dir));
function silent(result) {
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, ''); assert.equal(result.stdout, '');
  return result;
}
function blocked(result, surface = 'pane', tool = 'tabs_close') {
  assert.equal(result.status, 0, result.stderr); assert.equal(result.stderr, '');
  const value = JSON.parse(result.stdout);
  assert.deepEqual(Object.keys(value), ['decision', 'reason']);
  assert.equal(value.decision, 'block');
  assert.ok(value.reason.includes(surface)); assert.ok(value.reason.includes(tool));
  assert.match(value.reason, /ends the browser control/);
  assert.match(value.reason, /user already had open stay open/);
  assert.match(value.reason, /npx lean-browser-use keep --reason "<why>"/);
  assert.match(value.reason, /what stays open and why/);
}
const hold = (dir, args = [], env = {}) => cli(['keep', '--reason', 'review', '--session', 'session', ...args], { env: { LBU_STATE_DIR: dir, ...env } });

test('touch: action dirties and successful close cleans each browser surface', t => {
  const dir = temp(t);
  for (const [surface, tool] of [['pane', 'tabs_close'], ['chrome', 'tabs_close_mcp'], ['chrome', 'close_tab']]) {
    const p = action(surface);
    touch(dir, p);
    const use = state(dir).surfaces[surface];
    assert.ok(use.firstAction > 0); assert.ok(use.lastAction > use.lastClose);
    assert.ok(use.actions >= 1); assert.equal(use.kept, false);
    touch(dir, { ...p, tool_name: p.tool_name.replace('navigate', tool) });
    const closed = state(dir).surfaces[surface];
    assert.ok(closed.lastClose >= closed.lastAction); assert.ok(closed.closes >= 1);
  }
  silent(hook('stop-gate', stop(), dir));
});

test('RED: pane action without a lease blocks Stop with pane and tabs_close', t => {
  const dir = temp(t); touch(dir);
  const stub = run('test/fixtures/always-allow.mjs', [], { input: JSON.stringify(stop()) });
  assert.throws(() => blocked(stub), { name: 'SyntaxError' });
  blocked(hook('stop-gate', stop(), dir));
  assert.ok(state(dir).blockedAt > 0);
});

test('RED: active Stop resolves once and following Stop stays silent until a new action', t => {
  const dir = temp(t); touch(dir);
  blocked(hook('stop-gate', stop(), dir));
  silent(hook('stop-gate', stop({ stop_hook_active: true }), dir));
  assert.ok(state(dir).surfaces.pane.lastClose >= state(dir).surfaces.pane.lastAction);
  silent(hook('stop-gate', stop(), dir));
  touch(dir); blocked(hook('stop-gate', stop(), dir));
});

test('stop-gate: repeated inactive Stop also cannot block twice for one dirty stretch', t => {
  const dir = temp(t); touch(dir);
  blocked(hook('stop-gate', stop(), dir));
  silent(hook('stop-gate', stop(), dir));
  silent(hook('stop-gate', stop(), dir));
});

test('RED: failed close leaves the pane dirty and Stop still blocks', t => {
  const dir = temp(t); touch(dir);
  touch(dir, action('pane', { tool_name: 'mcp__Claude_Browser__tabs_close', tool_response: { isError: true, content: [{ type: 'text', text: 'no such tab' }] } }));
  assert.equal(state(dir).surfaces.pane.closes, 0);
  blocked(hook('stop-gate', stop(), dir));
});

test('touch: all isError response forms preserve dirty chrome', t => {
  for (const tool_response of [{ is_error: true }, { error: 'failed' }, 'Error: failed']) {
    const dir = temp(t); touch(dir, action('chrome'));
    touch(dir, action('chrome', { tool_name: 'mcp__claude-in-chrome__tabs_close_mcp', tool_response }));
    blocked(hook('stop-gate', stop(), dir), 'chrome', 'tabs_close_mcp');
  }
});

test('touch: probes and desktop tools neither start nor clean a surface', t => {
  const dir = temp(t);
  const probes = ['tabs_context_mcp', 'tabs_context', 'list_connected_browsers', 'select_browser', 'switch_browser', 'list_tabs', 'get_current_tab', 'read_console_messages', 'read_network_requests', 'shortcuts_list', 'preview_list', 'preview_logs'];
  const tools = probes.map(name => `mcp__Claude_Browser__${name}`).concat(['mcp__computer-use__click', 'mcp__cua-driver__click']);
  for (const tool_name of tools) touch(dir, action('pane', { tool_name }));
  assert.ok(!fs.existsSync(path.join(dir, 'use')));
  touch(dir);
  const before = fs.readFileSync(file(dir), 'utf8');
  for (const tool_name of tools) touch(dir, action('pane', { tool_name }));
  assert.equal(fs.readFileSync(file(dir), 'utf8'), before);
});

test('touch: a close never starts a surface; preview_stop cleans an existing pane', t => {
  const dir = temp(t);
  const close = action('pane', { tool_name: 'mcp__Claude_Browser__preview_stop' });
  touch(dir, close); assert.ok(!fs.existsSync(file(dir)));
  touch(dir); touch(dir, close);
  assert.equal(state(dir).surfaces.pane.closes, 1);
  silent(hook('stop-gate', stop(), dir));
});

test('touch: Control_Chrome actions and close_tab use chrome state', t => {
  const dir = temp(t);
  touch(dir, action('chrome', { tool_name: 'mcp__Control_Chrome__navigate' }));
  blocked(hook('stop-gate', stop(), dir), 'chrome', 'tabs_close_mcp');
  touch(dir, action('chrome', { tool_name: 'mcp__Control_Chrome__close_tab' }));
  silent(hook('stop-gate', stop(), dir));
});

test('touch: subagent and main-thread keys stay separate in both directions', t => {
  const dir = temp(t);
  touch(dir, action('pane', { agent_id: 'a1' }));
  assert.ok(!fs.existsSync(file(dir))); assert.equal(state(dir, 'a1').session, hash('session'));
  silent(hook('stop-gate', stop(), dir));
  blocked(hook('stop-gate', agentStop(), dir));
  touch(dir, action('chrome'));
  blocked(hook('stop-gate', stop(), dir), 'chrome', 'tabs_close_mcp');
});

test('stop-gate: background tasks defer without resolving or blocking', t => {
  const dir = temp(t); touch(dir);
  silent(hook('stop-gate', stop({ background_tasks: [{ type: 'shell' }] }), dir));
  assert.equal(state(dir).blockedAt, undefined);
  blocked(hook('stop-gate', stop(), dir));
});

test('stop-gate: runner ignores main use and other agent types are ignored', t => {
  const dir = temp(t); touch(dir);
  silent(hook('stop-gate', agentStop(), dir));
  touch(dir, action('pane', { agent_id: 'a1' }));
  silent(hook('stop-gate', agentStop({ agent_type: 'other' }), dir));
  blocked(hook('stop-gate', agentStop(), dir));
});

test('stop-gate: both dirty surfaces have their exact close tool in the reason', t => {
  const dir = temp(t); touch(dir); touch(dir, action('chrome'));
  const result = hook('stop-gate', stop(), dir);
  blocked(result); blocked(result, 'chrome', 'tabs_close_mcp');
});

test('stop-gate: sh wrapper preserves block JSON on stdout', t => {
  const dir = temp(t); touch(dir);
  blocked(captured('sh', [path.join(root, 'hooks/stop-gate.sh')], { input: JSON.stringify(stop()), env: { ...process.env, LBU_STATE_DIR: dir } }));
});

test('hooks: malformed payloads, wrong events and invalid sessions fail open silently', t => {
  const dir = temp(t);
  for (const name of ['touch', 'stop-gate']) for (const p of ['{malformed', 'null', '[]', '{}', stop({ session_id: '' }), stop({ session_id: 'x'.repeat(201) }), stop({ session_id: 4 }), stop({ hook_event_name: 'SessionEnd' })]) silent(hook(name, p, dir));
  touch(dir, action('pane', { session_id: '' }));
  touch(dir, action('pane', { session_id: 'x'.repeat(201) }));
  silent(hook('stop-gate', agentStop({ agent_id: undefined }), dir));
});

test('hooks: corrupt state and unavailable state directory fail open silently', t => {
  const dir = temp(t); touch(dir);
  fs.writeFileSync(file(dir), '{malformed');
  for (const name of ['touch', 'stop-gate']) silent(hook(name, name === 'touch' ? action() : stop(), dir));
  const unavailable = path.join(temp(t), 'file'); fs.writeFileSync(unavailable, 'file');
  for (const name of ['touch', 'stop-gate']) silent(hook(name, name === 'touch' ? action() : stop(), unavailable));
});

test('keep: holds every main and agent surface and leaves other sessions unchanged', t => {
  const dir = temp(t); touch(dir); touch(dir, action('chrome')); touch(dir, action('pane', { agent_id: 'a1' }));
  touch(dir, action('pane', { session_id: 'other' }));
  const result = hold(dir); assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, 'keep: 3 surface(s) held: review\n');
  for (const agent of ['', 'a1']) {
    const value = state(dir, agent); assert.equal(value.keepReason, 'review');
    assert.ok(Object.values(value.surfaces).every(use => use.kept));
  }
  assert.equal(state(dir, '', 'other').surfaces.pane.kept, false);
  silent(hook('stop-gate', stop(), dir));
});

test('RED: keep with only the session id reaches runner state before SubagentStop', t => {
  const dir = temp(t); touch(dir, action('pane', { agent_id: 'a1' }));
  assert.equal(hold(dir).status, 0);
  silent(hook('stop-gate', agentStop(), dir));
});

test('keep: later action clears every keep on its key and re-arms the gate', t => {
  const dir = temp(t); touch(dir); touch(dir, action('chrome'));
  assert.equal(hold(dir).status, 0); touch(dir);
  assert.equal(state(dir).keepReason, undefined);
  assert.ok(Object.values(state(dir).surfaces).every(use => !use.kept));
  blocked(hook('stop-gate', stop(), dir));
});

test('keep: reason is required and sessions use the environment or explicit config', t => {
  const cfg = temp(t), dir = path.join(cfg, 'lean-browser-use/state'); touch(dir);
  for (const args of [[], ['--reason'], ['--reason', '   ']]) assert.equal(cli(['keep', ...args], { env: { CLAUDE_CONFIG_DIR: cfg, CLAUDE_CODE_SESSION_ID: 'session' } }).status, 2);
  const result = cli(['keep', '--reason', 'review', '--claude-dir', cfg], { env: { LBU_STATE_DIR: '', CLAUDE_CODE_SESSION_ID: 'session' } });
  assert.equal(result.status, 0, result.stderr); assert.equal(state(dir).surfaces.pane.kept, true);
});

test('install: gate registrations are unique and uninstall removes all new hooks', t => {
  const cfg = temp(t), args = ['install', '--claude-dir', cfg, '--yes'];
  for (let n = 0; n < 2; n++) assert.equal(cli(args).status, 0);
  const settings = JSON.parse(fs.readFileSync(path.join(cfg, 'settings.json')));
  for (const [event, name] of [['PostToolUse', 'touch'], ['Stop', 'stop-gate'], ['SubagentStop', 'stop-gate']]) {
    const entries = settings.hooks[event].filter(entry => entry.hooks.some(h => h.command.includes(`/${name}.sh`)));
    assert.equal(entries.length, 1); assert.equal(entries[0].hooks[0].timeout, 10);
    if (event === 'SubagentStop') assert.equal(entries[0].matcher, 'aun-browser-runner');
  }
  assert.equal(JSON.parse(fs.readFileSync(path.join(cfg, 'lean-browser-use/manifest.json'))).stopGate, true);
  assert.equal(cli(['uninstall', '--claude-dir', cfg]).status, 0);
  assert.ok(!fs.existsSync(path.join(cfg, 'lean-browser-use/hooks/touch.mjs')));
  assert.ok(!fs.existsSync(path.join(cfg, 'lean-browser-use/hooks/stop-gate.sh')));
  assert.ok(!fs.readFileSync(path.join(cfg, 'settings.json'), 'utf8').includes('/lean-browser-use/hooks/'));
});

test('install: no-stop-gate omits registrations and doctor accepts it', t => {
  const cfg = temp(t);
  assert.equal(cli(['install', '--claude-dir', cfg, '--yes', '--no-stop-gate']).status, 0);
  const settings = fs.readFileSync(path.join(cfg, 'settings.json'), 'utf8');
  assert.doesNotMatch(settings, /\/(touch|stop-gate)\.sh/);
  assert.equal(JSON.parse(fs.readFileSync(path.join(cfg, 'lean-browser-use/manifest.json'))).stopGate, false);
  assert.ok(fs.existsSync(path.join(cfg, 'lean-browser-use/hooks/touch.mjs')));
  const result = cli(['doctor', '--claude-dir', cfg, '--json']); assert.equal(result.status, 0, result.stdout);
  for (const name of ['touch', 'stop-gate']) assert.equal(JSON.parse(result.stdout).checks.find(c => c.id === `hook:${name}`).status, 'ok');
});

test('install: no-hooks paste snippet honors no-stop-gate', t => {
  const result = cli(['install', '--claude-dir', temp(t), '--yes', '--no-hooks', '--no-stop-gate']);
  assert.equal(result.status, 0, result.stderr);
  const snippet = result.stdout.split('Paste these hook entries into settings.json:\n')[1];
  assert.doesNotMatch(snippet, /\/(touch|stop-gate)\.sh/);
});

test('install: no-stop-gate removes previously registered gate hooks on reinstall', t => {
  const cfg = temp(t), args = ['install', '--claude-dir', cfg, '--yes'];
  assert.equal(cli(args).status, 0);
  const file = path.join(cfg, 'settings.json');
  const settings = JSON.parse(fs.readFileSync(file));
  settings.hooks.Stop.push({ hooks: [{ type: 'command', command: 'echo user-hook' }] });
  fs.writeFileSync(file, JSON.stringify(settings));
  assert.equal(cli([...args, '--no-stop-gate']).status, 0);
  const after = fs.readFileSync(file, 'utf8');
  assert.doesNotMatch(after, /\/(touch|stop-gate)\.sh/); assert.match(after, /echo user-hook/);
  const result = cli(['doctor', '--claude-dir', cfg, '--json']); assert.equal(result.status, 0, result.stdout);
});

test('doctor: stale dirty surfaces error, session count groups agents, keep or close clears it', t => {
  const cfg = temp(t), dir = path.join(cfg, 'lean-browser-use/state');
  assert.equal(cli(['install', '--claude-dir', cfg, '--yes']).status, 0);
  const report = () => {
    const result = cli(['doctor', '--claude-dir', cfg, '--json'], { env: { LBU_STATE_DIR: '' } });
    return { result, check: JSON.parse(result.stdout).checks.find(c => c.id === 'open-surfaces') };
  };
  touch(dir); assert.equal(report().check.status, 'ok');
  touch(dir, action('chrome', { agent_id: 'a1' }));
  for (const agent of ['', 'a1']) {
    const value = state(dir, agent);
    for (const use of Object.values(value.surfaces)) use.firstAction = use.lastAction = Date.now() - 660000;
    fs.writeFileSync(file(dir, agent), JSON.stringify(value));
  }
  const dirty = report(); assert.equal(dirty.result.status, 1); assert.equal(dirty.check.status, 'error');
  assert.match(dirty.check.detail, /1 session\(s\): chrome, pane/);
  assert.equal(hold(dir).status, 0); assert.equal(report().check.status, 'ok');
  const value = state(dir); value.surfaces.pane.kept = false;
  fs.writeFileSync(file(dir), JSON.stringify(value)); assert.equal(report().check.status, 'error');
  touch(dir, action('pane', { tool_name: 'mcp__Claude_Browser__tabs_close' }));
  assert.equal(report().check.status, 'ok');
});
