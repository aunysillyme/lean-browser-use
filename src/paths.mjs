import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { exists, refusal, readJSON } from './util.mjs';

export const root = fileURLToPath(new URL('../', import.meta.url));
export function configDir(options = {}) {
  if (options.project && options.claudeDir) throw refusal('Choose --project or --claude-dir.');
  let cfg = path.resolve(options.claudeDir || (options.project ? '.claude' : process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude')));
  const missing = [];
  // Resolve the selected root, keeping symlink checks inside its managed tree.
  while (!exists(cfg)) { missing.unshift(path.basename(cfg)); cfg = path.dirname(cfg); }
  return path.join(fs.realpathSync(cfg), ...missing);
}
export const manifestPath = cfg => path.join(cfg, 'lean-browser-use', 'manifest.json');
export function noSymlinks(target) {
  const full = path.resolve(target);
  let current = path.parse(full).root;
  for (const part of full.slice(current.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    if (exists(current) && fs.lstatSync(current).isSymbolicLink()) throw refusal('Refused symlink target.');
  }
  return full;
}
export function safePath(cfg, relative) {
  if (typeof relative !== 'string' || !relative || path.isAbsolute(relative) || relative.includes('\\') || relative.split('/').some(p => !p || p === '.' || p === '..')) {
    throw refusal('Refused unsafe manifest path.');
  }
  return noSymlinks(path.join(cfg, relative));
}
export function ownedPath(relative) {
  return relative === 'agents/aun-browser-runner.md' || relative.startsWith('skills/lean-browser-use/') ||
    /^lean-browser-use\/(hooks|briefs|reader|searxng)\//.test(relative);
}
export function loadManifest(cfg) {
  const file = noSymlinks(manifestPath(cfg));
  if (!exists(file)) throw refusal(`Missing manifest: ${file}`);
  let manifest;
  try { manifest = readJSON(file); } catch { throw refusal('Refused invalid manifest JSON.'); }
  if (!Array.isArray(manifest.files) || !Array.isArray(manifest.directories) || !Array.isArray(manifest.settingsEntries)) throw refusal('Refused invalid manifest shape.');
  for (const item of manifest.files) {
    safePath(cfg, item.path);
    if (!ownedPath(item.path) || !/^[a-f0-9]{64}$/.test(item.sha256)) throw refusal('Refused unowned manifest file.');
  }
  for (const dir of manifest.directories) {
    safePath(cfg, dir);
    if (!['skills', 'agents', 'lean-browser-use', 'skills/lean-browser-use'].includes(dir) && !ownedPath(`${dir}/x`)) throw refusal('Refused unowned manifest directory.');
  }
  return manifest;
}
