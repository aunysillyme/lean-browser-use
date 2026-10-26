import { captured } from '../src/util.mjs';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
export const root = fileURLToPath(new URL('../', import.meta.url));
// Every test process sees its own empty lease directory, never the developer's real one.
if (!process.env.LBU_LEASE_DIR) {
  const leases = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'lbu-leases-'));
  process.env.LBU_LEASE_DIR = leases;
  process.on('exit', () => fs.rmSync(leases, { recursive: true, force: true }));
}
export function temp(t) {
  const dir = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'lbu-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}
export const run = (script, args = [], options = {}) => {
  const env = { ...process.env, ...options.env };
  delete env.NODE_TEST_CONTEXT; delete env.NODE_CHANNEL_FD;
  return captured(process.execPath, [path.join(root, script), ...args], { timeout: 10000, ...options, env });
};
export const cli = (args, options) => run('bin/lean-browser-use.mjs', args, options);
export const payload = (name, tool_input = {}, extra = {}) => ({ session_id: 'session', hook_event_name: 'PreToolUse', tool_name: `mcp__claude-in-chrome__${name}`, tool_input, ...extra });
export function hook(name, p, state, extra = {}) {
  return run(`hooks/${name}.mjs`, [], { input: typeof p === 'string' ? p : JSON.stringify(p), env: { ...process.env, LBU_STATE_DIR: state }, ...extra });
}
export function blockingCases() {
  const post = p => ({ ...p, hook_event_name: 'PostToolUse', tool_response: '' });
  const wait = payload('computer', { action: 'wait', duration: 30 });
  const nav = payload('navigate', { url: 'https://example.com/a' });
  const read = payload('find', { query: 'price' });
  const native = payload('click', { x: 1 }, { tool_name: 'mcp__computer-use__click', hook_event_name: 'PostToolUse', tool_response: { isError: true, content: [{ text: 'Error unavailable' }] } });
  return [
    { id: 'unpicked-block', guard: 'pick-guard', setup: [], target: read },
    { id: 'wait-cap', guard: 'retry-guard', setup: [wait, wait], target: payload('computer', { action: 'wait', duration: 1 }) },
    { id: 'third-navigate', guard: 'retry-guard', setup: [nav, nav], target: nav },
    { id: 'fruitless-wait', guard: 'retry-guard', setup: [post(read), post(read)], target: wait },
    { id: 'fruitless-navigate', guard: 'retry-guard', setup: [post(read), post(read)], target: nav },
    { id: 'fruitless-read', guard: 'retry-guard', setup: [post(read), post(read)], target: read },
    { id: 'third-native-error', guard: 'retry-guard', setup: [native, native], target: { ...native, hook_event_name: 'PreToolUse' } }
  ];
}

// npm 12 prints pack JSON keyed by package name; older npm prints an array.
export function firstPack(parsed) { return Array.isArray(parsed) ? parsed[0] : Object.values(parsed)[0]; }
