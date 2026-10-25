import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createHash, randomBytes } from 'node:crypto';

export const hash = data => createHash('sha256').update(String(data)).digest('hex');
export const browser = name => /^mcp__(claude-in-chrome|Claude_Browser|Control_Chrome)__/.test(name || '');
export const native = name => /^mcp__(computer-use|cua-driver)__/.test(name || '');
export const shortName = name => String(name || '').split('__').at(-1);
const probes = new Set(['list_connected_browsers', 'tabs_context_mcp', 'tabs_context', 'read_console_messages', 'read_network_requests', 'shortcuts_list', 'preview_list', 'preview_logs', 'preview_stop', 'list_tabs', 'get_current_tab', 'list_apps', 'list_windows']);
export const probe = name => probes.has(shortName(name)) || shortName(name).startsWith('tabs_context');
export function responseText(value) {
  if (typeof value === 'string') return value.trim();
  if (value == null) return '';
  if (Array.isArray(value)) return value.map(responseText).join('\n').trim();
  if (Array.isArray(value.content)) return responseText(value.content);
  if (typeof value.text === 'string') return value.text.trim();
  return JSON.stringify(value);
}
export function isError(value) {
  if (value && typeof value === 'object' && (value.isError || value.is_error || Object.hasOwn(value, 'error'))) return true;
  return /^error/i.test(responseText(value));
}
export const fruitless = value => isError(value) || /^(?:\[\]|\{\}|null|not found)?$/i.test(responseText(value));
export function stable(value) {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${stable(value[k])}`).join(',')}}`;
  return JSON.stringify(value);
}
function secureDir(dir) {
  let current = path.parse(path.resolve(dir)).root;
  for (const part of path.resolve(dir).slice(current.length).split(path.sep)) {
    current = path.join(current, part);
    try { if (fs.lstatSync(current).isSymbolicLink()) throw new Error('Unsafe state'); }
    catch (e) { if (e.code !== 'ENOENT') throw e; }
  }
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  fs.chmodSync(dir, 0o700);
}
export function stateFile(kind, id) {
  const cfg = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
  const dir = process.env.LBU_STATE_DIR || path.join(cfg, 'lean-browser-use', 'state');
  secureDir(dir);
  const subdir = path.join(dir, kind);
  secureDir(subdir);
  for (const name of fs.readdirSync(subdir)) {
    const file = path.join(subdir, name);
    const stat = fs.lstatSync(file);
    if (stat.isFile() && Date.now() - stat.mtimeMs > 86400000) fs.unlinkSync(file);
  }
  const file = path.join(subdir, hash(id).slice(0, 24));
  try { if (fs.lstatSync(file).isSymbolicLink()) throw new Error('Unsafe state'); }
  catch (e) { if (e.code !== 'ENOENT') throw e; }
  return file;
}
export function readState(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (e) { if (e.code === 'ENOENT') return {}; throw e; }
}
export function writeState(file, value) {
  const tmp = `${file}.${randomBytes(6).toString('hex')}`;
  try {
    fs.writeFileSync(tmp, JSON.stringify(value), { mode: 0o600, flag: 'wx' });
    fs.renameSync(tmp, file);
  } finally { try { fs.unlinkSync(tmp); } catch {} }
}
export function input() { return JSON.parse(fs.readFileSync(0, 'utf8')); }
export function block(message) { process.stderr.write(`${message}\n`); process.exitCode = 2; }
export function guard(run) {
  try { run(); } catch { process.exitCode = 0; }
}
