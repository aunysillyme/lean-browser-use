import fs from 'node:fs';
import path from 'node:path';
import { configDir, loadManifest, manifestPath, safePath, noSymlinks } from './paths.mjs';
import { readSettings, ownedHook } from './install.mjs';
import { exists, sha256, atomicWrite, refusal } from './util.mjs';

export function uninstall(options = {}) {
  const cfg = noSymlinks(configDir(options));
  const manifest = loadManifest(cfg);
  const settings = readSettings(cfg);
  const removals = [], edited = [];
  for (const item of manifest.files) {
    const file = safePath(cfg, item.path);
    if (!exists(file)) continue;
    if (!fs.lstatSync(file).isFile()) throw refusal('Refused non-file manifest entry.');
    (sha256(fs.readFileSync(file)) === item.sha256 ? removals : edited).push(item);
  }
  let settingsChanged = false;
  for (const [event, entries] of Object.entries(settings.hooks || {})) {
    const kept = [];
    for (const entry of entries) {
      const hooks = entry.hooks.filter(hook => !ownedHook(hook));
      if (hooks.length !== entry.hooks.length) settingsChanged = true;
      if (hooks.length || !entry.hooks.length) kept.push({ ...entry, hooks });
    }
    if (kept.length || !entries.length) settings.hooks[event] = kept; else delete settings.hooks[event];
  }
  if (settings.hooks && !Object.keys(settings.hooks).length && settingsChanged) delete settings.hooks;
  const removalSet = new Set(removals.map(f => f.path));
  const directories = [];
  for (const dir of [...manifest.directories].sort((a, b) => b.length - a.length)) {
    const full = safePath(cfg, dir);
    if (!exists(full)) continue;
    if (!fs.lstatSync(full).isDirectory()) throw refusal('Refused non-directory manifest entry.');
    const emptyAfter = fs.readdirSync(full).every(name => {
      const child = `${dir}/${name}`;
      return removalSet.has(child) || directories.includes(child) || child === 'lean-browser-use/manifest.json';
    });
    if (emptyAfter) directories.push(dir);
  }
  for (const item of removals) console.log(`Remove ${item.path}`);
  for (const item of edited) console.log(`Keep edited ${item.path}`);
  if (settingsChanged) console.log('Remove owned hook entries from settings.json.');
  for (const dir of directories) console.log(`Remove empty directory ${dir}`);
  const removeConfig = manifest.configDirectoryCreated && fs.readdirSync(cfg).every(name => directories.includes(name));
  console.log('Remove lean-browser-use/manifest.json last.');
  if (removeConfig) console.log('Remove empty config directory.');
  if (manifest.manualHooks) console.log('Manual step: remove any hook entries pasted elsewhere by hand.');
  if (manifest.backupWritten) console.log('Saved settings backup remains at settings.json.lean-browser-use.bak.');
  if (options.dry) return edited.length ? 3 : 0;
  for (const item of removals) {
    const file = safePath(cfg, item.path);
    // Recheck both the object and its bytes immediately before unlinking.
    if (!fs.lstatSync(file).isFile() || sha256(fs.readFileSync(file)) !== item.sha256) throw refusal('File changed during uninstall; preserved.');
    fs.unlinkSync(file);
  }
  if (settingsChanged) atomicWrite(noSymlinks(path.join(cfg, 'settings.json')), `${JSON.stringify(settings, null, 2)}\n`);
  const removeEmpty = dir => {
    const full = safePath(cfg, dir);
    if (exists(full) && fs.lstatSync(full).isDirectory() && fs.readdirSync(full).length === 0) fs.rmdirSync(full);
  };
  for (const dir of directories) if (dir !== 'lean-browser-use') removeEmpty(dir);
  const file = noSymlinks(manifestPath(cfg));
  if (!fs.lstatSync(file).isFile()) throw refusal('Manifest changed during uninstall.');
  fs.unlinkSync(file);
  if (directories.includes('lean-browser-use')) removeEmpty('lean-browser-use');
  if (removeConfig && fs.readdirSync(noSymlinks(cfg)).length === 0) fs.rmdirSync(noSymlinks(cfg));
  return edited.length ? 3 : 0;
}
