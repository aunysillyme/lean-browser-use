import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { root, temp, run, hook, payload, blockingCases } from './helpers.mjs';

for (const c of blockingCases()) test(`guard rule: ${c.id}`, t => {
  const dir = temp(t);
  for (const p of c.setup) assert.equal(hook(c.guard, p, dir).status, 0);
  const blocked = hook(c.guard, c.target, dir);
  assert.equal(blocked.status, 2, blocked.stderr);
  assert.ok(blocked.stderr.trim());
  assert.equal(hook(c.guard, payload('list_connected_browsers'), dir).status, 0);
  assert.equal(hook(c.guard, '{broken', dir).status, 0);
  const bad = path.join(dir, 'file'); fs.writeFileSync(bad, '');
  assert.equal(hook(c.guard, c.target, bad).status, 0);
});

test('pick records successful selections, manual picks, closes and resets', t => {
  const dir = temp(t);
  const action = payload('read_page');
  for (const error of [{ isError: true }, { is_error: true }, { error: '' }, 'Error refused']) {
    assert.equal(hook('pick-guard', payload('select_browser', {}, { hook_event_name: 'PostToolUse', tool_response: error }), dir).status, 0);
    assert.equal(hook('pick-guard', action, dir).status, 2);
  }
  assert.equal(hook('pick-guard', payload('select_browser'), dir).status, 0);
  hook('pick-guard', payload('select_browser', {}, { hook_event_name: 'PostToolUse', tool_response: 'selected' }), dir);
  assert.equal(hook('pick-guard', action, dir).status, 0);
  const marker = path.join(dir, 'pick', createHash('sha256').update('session').digest('hex').slice(0, 24));
  assert.equal(fs.statSync(marker).mode & 0o777, 0o600);
  assert.equal(fs.statSync(dir).mode & 0o777, 0o700);
  hook('pick-guard', payload('tabs_close_mcp', {}, { hook_event_name: 'PostToolUse' }), dir);
  assert.equal(hook('pick-guard', action, dir).status, 2);
  const opts = { env: { ...process.env, LBU_STATE_DIR: dir } };
  assert.equal(run('hooks/pick-guard.mjs', ['--pick', 'chosen', '--session', 'session'], opts).status, 0);
  assert.equal(hook('pick-guard', action, dir).status, 0);
  run('hooks/pick-guard.mjs', ['--reset', '--session', 'session'], opts);
  assert.equal(hook('pick-guard', action, dir).status, 2);
  assert.equal(hook('pick-guard', { ...action, session_id: undefined }, dir).status, 2);
  assert.equal(hook('pick-guard', payload('list_tabs', {}, { session_id: undefined }), dir).status, 0);
});

test('all page reads are pick actions and browser families share contract', t => {
  const dir = temp(t);
  for (const family of ['claude-in-chrome', 'Claude_Browser', 'Control_Chrome']) {
    for (const name of ['read_page', 'find', 'get_page_text', 'get_page_content', 'javascript_tool', 'browser_batch']) {
      assert.equal(hook('pick-guard', payload(name, {}, { tool_name: `mcp__${family}__${name}` }), dir).status, 2);
    }
  }
  for (const name of ['read_console_messages', 'read_network_requests', 'shortcuts_list', 'preview_list', 'preview_logs', 'preview_stop', 'get_current_tab', 'tabs_context_mcp']) assert.equal(hook('pick-guard', payload(name), dir).status, 0);
});

test('wait forms, tab and agent isolation, configured cap', t => {
  const dir = temp(t);
  const forms = [payload('computer', { action: 'wait', duration: 61 }), payload('javascript_tool', { text: 'await new Promise(r => setTimeout(r, 61000))' }), payload('anything', { ms: 61000 }), payload('javascript_tool', { code: 'sleep(61000)' }), payload('javascript_tool', { code: 'waitFor(61000)' })];
  for (const p of forms) assert.equal(hook('retry-guard', p, dir).status, 2);
  const p = payload('computer', { action: 'wait', duration: 60, tabId: 'a' }, { agent_id: 'one' });
  assert.equal(hook('retry-guard', p, dir).status, 0);
  assert.equal(hook('retry-guard', p, dir).status, 2);
  assert.equal(hook('retry-guard', { ...p, agent_id: 'two' }, dir).status, 0);
  assert.equal(hook('retry-guard', { ...p, tool_input: { ...p.tool_input, tabId: 'b' } }, dir).status, 0);
  assert.equal(hook('retry-guard', p, dir, { env: { ...process.env, LBU_STATE_DIR: temp(t), LBU_WAIT_CAP_SECONDS: '90' } }).status, 0);
});

test('fruitless forms and a different query allow another approach', t => {
  for (const value of ['', [], {}, null, 'not found', { isError: true }, { content: [{ type: 'text', text: '[]' }] }]) {
    const dir = temp(t);
    const read = payload('find', { query: 'price' }, { hook_event_name: 'PostToolUse', tool_response: value });
    hook('retry-guard', read, dir); hook('retry-guard', read, dir);
    assert.equal(hook('retry-guard', payload('find', { query: 'price' }), dir).status, 2);
    assert.equal(hook('retry-guard', payload('find', { query: 'version' }), dir).status, 0);
  }
});

test('changed origin, targeted action and changed read reset retry counters', t => {
  for (const reset of [payload('navigate', { url: 'https://example.org' }), payload('computer', { action: 'left_click', ref: 'target' }), payload('type', { text: 'query' }), payload('read_page', {}, { hook_event_name: 'PostToolUse', tool_response: 'new page text' })]) {
    const dir = temp(t);
    hook('retry-guard', payload('navigate', { url: 'https://example.com' }), dir);
    const r = payload('read_page', {}, { hook_event_name: 'PostToolUse', tool_response: '' });
    hook('retry-guard', r, dir); hook('retry-guard', r, dir);
    assert.equal(hook('retry-guard', reset, dir).status, 0);
    assert.equal(hook('retry-guard', payload('computer', { action: 'wait', duration: 1 }), dir).status, 0);
  }
});

test('native different arguments, error and success start new attempts', t => {
  for (const family of ['computer-use', 'cua-driver']) {
    const dir = temp(t);
    const p = payload('click', { ref: 'a' }, { tool_name: `mcp__${family}__click`, hook_event_name: 'PostToolUse', tool_response: { error: 'same' } });
    hook('retry-guard', p, dir); hook('retry-guard', p, dir);
    assert.equal(hook('retry-guard', { ...p, hook_event_name: 'PreToolUse', tool_input: { ref: 'b' } }, dir).status, 0);
    hook('retry-guard', { ...p, tool_response: { error: 'different' } }, dir);
    assert.equal(hook('retry-guard', { ...p, hook_event_name: 'PreToolUse' }, dir).status, 0);
    hook('retry-guard', { ...p, tool_response: 'success' }, dir);
    assert.equal(hook('retry-guard', { ...p, hook_event_name: 'PreToolUse' }, dir).status, 0);
  }
});

test('batch nudge shares browser/native streak and resets on batch/probe', t => {
  const dir = temp(t);
  const p = payload('click', {}, { hook_event_name: 'PostToolUse' });
  assert.equal(hook('batch-nudge', p, dir).stderr, '');
  assert.equal(hook('batch-nudge', { ...p, tool_name: 'mcp__computer-use__click' }, dir).stderr, '');
  const third = hook('batch-nudge', p, dir);
  assert.equal(third.status, 0); assert.match(third.stderr, /browser_batch/);
  for (const name of ['browser_batch', 'list_connected_browsers']) {
    hook('batch-nudge', { ...p, tool_name: `mcp__claude-in-chrome__${name}` }, dir);
    assert.equal(hook('batch-nudge', p, dir).stderr, '');
  }
});

for (const name of ['pick-guard', 'retry-guard', 'batch-nudge']) test(`${name} fail-open and shim contract`, t => {
  const dir = temp(t);
  assert.equal(hook(name, 'broken', dir).status, 0);
  assert.equal(hook(name, payload('click', {}, { session_id: undefined }), dir).status, name === 'pick-guard' ? 2 : 0);
  assert.equal(hook(name, payload('list_apps', {}, { tool_name: 'mcp__cua-driver__list_apps' }), dir).status, 0);
  const bad = path.join(dir, 'bad'); fs.writeFileSync(bad, '');
  assert.equal(hook(name, payload('read_page'), bad).status, 0);
  const locked = path.join(dir, 'locked'); fs.mkdirSync(locked, { mode: 0o500 });
  // A file parent reliably simulates an unavailable state store even under root.
  assert.equal(hook(name, payload('read_page'), path.join(bad, 'state')).status, 0);
  const shim = path.join(dir, `${name}.sh`);
  fs.copyFileSync(path.join(root, 'hooks', `${name}.sh`), shim);
  const call = () => spawnSync('sh', [shim], { encoding: 'utf8' });
  assert.equal(call().status, 0);
  fs.writeFileSync(path.join(dir, `${name}.mjs`), 'process.exit(2);'); assert.equal(call().status, 2);
  fs.writeFileSync(path.join(dir, `${name}.mjs`), 'process.exit(1);'); assert.equal(call().status, 0);
  assert.equal(spawnSync('/bin/sh', [shim], { env: { PATH: dir } }).status, 0);
});

test('retry prunes old state files', t => {
  const dir = temp(t); const sub = path.join(dir, 'retry'); fs.mkdirSync(sub);
  const stale = path.join(sub, 'old'); fs.writeFileSync(stale, '{}'); fs.utimesSync(stale, 0, 0);
  hook('retry-guard', payload('navigate', { url: 'https://example.com' }), dir);
  assert.equal(fs.existsSync(stale), false);
});

for (const name of ['pick-guard', 'retry-guard', 'batch-nudge']) test(`${name} unwritable state parent fails open`, t => {
  if (process.getuid?.() === 0) return t.skip('Root bypasses permission bits.');
  const dir = temp(t), locked = path.join(dir, 'locked'); fs.mkdirSync(locked, { mode: 0o500 });
  try { assert.equal(hook(name, payload('read_page', {}, { hook_event_name: name === 'batch-nudge' ? 'PostToolUse' : 'PreToolUse' }), path.join(locked, 'state')).status, 0); }
  finally { fs.chmodSync(locked, 0o700); }
});
