import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline/promises';
import { root, configDir, safePath, noSymlinks, manifestPath, loadManifest } from './paths.mjs';
import { exists, walk, readJSON, sha256, atomicWrite, refusal, shellQuote } from './util.mjs';

export const ownedHook = hook => typeof hook?.command === 'string' && hook.command.includes('/lean-browser-use/hooks/');
export function registrations(cfg) {
  const data = readJSON(path.join(root, 'hooks/hooks.settings.json'));
  for (const entries of Object.values(data.hooks)) for (const entry of entries) for (const hook of entry.hooks) {
    const filename = hook.command.match(/\$\{HOOKS_DIR\}\/([^"']+)/)?.[1];
    if (!filename) throw refusal('Invalid hook template.');
    hook.command = shellQuote(path.join(cfg, 'lean-browser-use/hooks', filename));
  }
  return data.hooks;
}
export function readSettings(cfg) {
  const file = noSymlinks(path.join(cfg, 'settings.json'));
  if (!exists(file)) return {};
  try {
    const settings = readJSON(file);
    if (!settings || typeof settings !== 'object' || Array.isArray(settings)) throw new Error();
    if (settings.hooks !== undefined && (!settings.hooks || typeof settings.hooks !== 'object' || Array.isArray(settings.hooks))) throw new Error();
    for (const entries of Object.values(settings.hooks || {})) if (!Array.isArray(entries) || entries.some(e => !Array.isArray(e.hooks))) throw new Error();
    return settings;
  } catch { throw refusal('Refused invalid settings.json; repair its JSON before installing.'); }
}
export function mergeHooks(settings, wanted) {
  const added = [];
  settings.hooks ||= {};
  for (const [event, entries] of Object.entries(wanted)) {
    settings.hooks[event] ||= [];
    for (const entry of entries) {
      for (const hook of entry.hooks) {
        const found = settings.hooks[event].some(e => e.matcher === entry.matcher && e.hooks.some(h => h.command === hook.command));
        if (!found) { settings.hooks[event].push({ ...entry, hooks: [hook] }); added.push({ event, matcher: entry.matcher, hook }); }
      }
    }
  }
  return added;
}
function sourceFiles(options) {
  const mappings = [['skills/lean-browser-use', 'skills/lean-browser-use'], ['agents/aun-browser-runner.md', 'agents/aun-browser-runner.md'], ['hooks', 'lean-browser-use/hooks'], ['briefs', 'lean-browser-use/briefs']];
  if (options.withReader) mappings.push(['reader', 'lean-browser-use/reader'], ['searxng', 'lean-browser-use/searxng']);
  const files = [];
  for (const [source, destination] of mappings) {
    const full = path.join(root, source);
    if (!exists(full)) throw refusal(`Package file missing: ${source}`);
    const children = fs.statSync(full).isDirectory() ? walk(full) : [full];
    for (const child of children) {
      if (child.split(path.sep).some(p => ['__pycache__', 'state'].includes(p)) || child.endsWith('.pyc')) continue;
      const relative = child === full ? destination : `${destination}/${path.relative(full, child).split(path.sep).join('/')}`;
      files.push({ source: child, path: relative, sha256: sha256(fs.readFileSync(child)) });
    }
  }
  return files;
}
export async function install(options = {}) {
  const cfg = noSymlinks(configDir(options));
  const configExisted = exists(cfg);
  const previous = exists(manifestPath(cfg)) ? loadManifest(cfg) : null;
  const files = sourceFiles(options);
  const settings = readSettings(cfg);
  const wanted = registrations(cfg);
  const entries = options.noHooks ? [] : mergeHooks(settings, wanted);
  const backup = path.join(cfg, 'settings.json.lean-browser-use.bak');
  const settingsFile = path.join(cfg, 'settings.json');
  const backupNeeded = !options.noHooks && exists(settingsFile) && !exists(noSymlinks(backup));
  for (const item of files) {
    const target = safePath(cfg, item.path);
    if (exists(target)) {
      if (!fs.lstatSync(target).isFile()) throw refusal(`Refused non-file target: ${item.path}`);
      const current = sha256(fs.readFileSync(target));
      const old = previous?.files.find(f => f.path === item.path);
      if (current !== item.sha256 && (!old || current !== old.sha256)) throw refusal(`Edited or existing file preserved: ${item.path}`);
    }
  }
  const dirs = new Set(previous?.directories || []);
  for (const item of [...files, { path: 'lean-browser-use/manifest.json' }]) {
    let dir = path.posix.dirname(item.path);
    while (dir !== '.') { if (!exists(safePath(cfg, dir))) dirs.add(dir); dir = path.posix.dirname(dir); }
  }
  console.log(`Install into ${cfg}`);
  for (const item of files) console.log(`Write ${item.path}`);
  if (backupNeeded) console.log('Back up settings.json once.');
  if (!options.noHooks) console.log('Merge hook entries in settings.json.');
  else console.log(`Paste these hook entries into settings.json:\n${JSON.stringify({ hooks: wanted }, null, 2)}`);
  console.log('Write lean-browser-use/manifest.json');
  if (options.withReader) console.log('Reader needs Python 3 and crawl4ai. Install it yourself with: python3 -m pip install crawl4ai\nSearch needs Docker: https://docs.docker.com/get-docker/');
  if (options.dry) return 0;
  if (process.stdin.isTTY && !options.yes) {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    let answer; try { answer = await rl.question('Proceed? [Y/n] '); } finally { rl.close(); }
    if (/^n/i.test(answer.trim())) return 0;
  }
  fs.mkdirSync(cfg, { recursive: true, mode: 0o700 });
  for (const dir of [...dirs].sort((a, b) => a.length - b.length)) fs.mkdirSync(safePath(cfg, dir), { recursive: true, mode: 0o700 });
  for (const item of files) {
    const executable = /\.sh$|\/(reader|searx)$/.test(item.path);
    atomicWrite(safePath(cfg, item.path), fs.readFileSync(item.source), executable ? 0o755 : 0o644);
  }
  if (backupNeeded) fs.copyFileSync(noSymlinks(settingsFile), noSymlinks(backup), fs.constants.COPYFILE_EXCL);
  if (!options.noHooks) atomicWrite(noSymlinks(settingsFile), `${JSON.stringify(settings, null, 2)}\n`);
  const retained = (previous?.files || []).filter(old => !files.some(item => item.path === old.path));
  const manifest = {
    version: readJSON(path.join(root, 'package.json')).version,
    installedAt: new Date().toISOString(),
    files: [...retained, ...files.map(({ path: file, sha256: hash }) => ({ path: file, sha256: hash }))],
    directories: [...dirs], settingsEntries: [...(previous?.settingsEntries || []), ...entries],
    backupWritten: !!(previous?.backupWritten || backupNeeded), manualHooks: !!options.noHooks,
    configDirectoryCreated: previous?.configDirectoryCreated ?? !configExisted,
    sharedFiles: [settingsFile, backup].filter(f => exists(f)).map(f => ({ path: path.basename(f), sha256: sha256(fs.readFileSync(f)) }))
  };
  atomicWrite(noSymlinks(manifestPath(cfg)), `${JSON.stringify(manifest, null, 2)}\n`);
  return 0;
}
