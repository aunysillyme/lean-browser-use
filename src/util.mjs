import fs from 'node:fs';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { randomBytes, createHash } from 'node:crypto';

export const sha256 = value => createHash('sha256').update(value).digest('hex');
export const readJSON = file => JSON.parse(fs.readFileSync(file, 'utf8'));
export const exists = file => { try { fs.lstatSync(file); return true; } catch (e) { if (e.code === 'ENOENT') return false; throw e; } };
export function atomicWrite(file, data, mode = 0o600) {
  const tmp = `${file}.${randomBytes(8).toString('hex')}.tmp`;
  try {
    fs.writeFileSync(tmp, data, { mode, flag: 'wx' });
    fs.renameSync(tmp, file);
  } finally { if (exists(tmp)) fs.unlinkSync(tmp); }
}
export function walk(dir) {
  if (!exists(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))
    .flatMap(e => e.isDirectory() ? walk(path.join(dir, e.name)) : e.isFile() ? [path.join(dir, e.name)] : []);
}
export function refusal(message) { const error = new Error(message); error.exitCode = 2; return error; }
export const shellQuote = text => `'${String(text).replaceAll("'", "'\\''")}'`;

// Regular files also work in sandboxes that restrict child-process pipe handles.
export function captured(command, args = [], options = {}) {
  const dir = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'lbu-process-'));
  const input = path.join(dir, 'stdin'), output = path.join(dir, 'stdout'), errors = path.join(dir, 'stderr');
  fs.writeFileSync(input, options.input ?? '');
  const fds = [fs.openSync(input, 'r'), fs.openSync(output, 'w'), fs.openSync(errors, 'w')];
  try {
    const result = spawnSync(command, args, { ...options, input: undefined, stdio: fds });
    return { ...result, stdout: fs.readFileSync(output, 'utf8'), stderr: fs.readFileSync(errors, 'utf8') };
  } finally { for (const fd of fds) fs.closeSync(fd); fs.rmSync(dir, { recursive: true, force: true }); }
}
