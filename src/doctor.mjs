import fs from 'node:fs';
import path from 'node:path';
import { configDir, safePath, noSymlinks, loadManifest } from './paths.mjs';
import { exists, sha256, captured } from './util.mjs';
import { readSettings, ownedHook, registrations } from './install.mjs';
import { scan, age, readLeases } from '../hooks/lease.mjs';
import { readState } from '../hooks/common.mjs';

export function doctor(options = {}) {
  const cfg = configDir(options);
  const checks = [];
  const add = (id, status, detail) => checks.push({ id, status, detail });
  add('node', Number(process.versions.node.split('.')[0]) >= 20 ? 'ok' : 'error', `Node ${process.versions.node}; needs >=20`);
  let manifest;
  try { manifest = loadManifest(cfg); add('manifest', 'ok', 'Manifest readable.'); }
  catch (e) { add('manifest', 'error', e.message); }
  for (const item of manifest?.files || []) {
    try {
      const file = safePath(cfg, item.path);
      const status = !exists(file) ? 'missing' : sha256(fs.readFileSync(file)) !== item.sha256 ? 'edited' : 'present';
      add(`file:${item.path}`, status === 'present' ? 'ok' : 'error', status);
    } catch { add(`file:${item.path}`, 'error', 'Unreadable installed file.'); }
  }
  if (manifest) {
    try {
      const settings = readSettings(cfg);
      const wantedRegistrations = registrations(cfg, { stopGate: manifest.stopGate !== false });
      const expected = manifest.manualHooks ? manifest.settingsEntries : Object.entries(wantedRegistrations).flatMap(([event, entries]) => entries.flatMap(entry => entry.hooks.map(hook => ({ event, matcher: entry.matcher, hook }))));
      for (const entry of expected) {
        const found = (settings.hooks?.[entry.event] || []).some(e => e.matcher === entry.matcher && e.hooks.some(h => h.command === entry.hook.command));
        add(`registration:${entry.event}:${entry.matcher || '*'}`, found ? 'ok' : 'error', found ? 'Registered.' : 'Hook registration missing.');
      }
      for (const entries of Object.values(settings.hooks || {})) for (const entry of entries) for (const hook of entry.hooks.filter(ownedHook)) {
        const wanted = Object.values(registrations(cfg)).flatMap(items => items.flatMap(item => item.hooks));
        const known = wanted.some(item => item.command === hook.command);
        const targetExists = manifest.files.some(item => item.path.endsWith('.sh') && hook.command.includes(item.path) && exists(safePath(cfg, item.path)));
        add('hook-target', known && targetExists ? 'ok' : 'error', known && targetExists ? 'Known hook command points at an existing file.' : 'Unknown or missing owned hook target.');
      }
      if (manifest.manualHooks && !manifest.settingsEntries.length) add('manual-hooks', 'optional', 'Paste the printed hook snippet to activate guards.');
    } catch { add('settings', 'error', 'Settings could not be checked.'); }
    for (const name of ['pick-guard', 'retry-guard', 'batch-nudge', 'cleanup', 'touch', 'stop-gate']) {
      try {
        const file = safePath(cfg, `lean-browser-use/hooks/${name}.sh`);
        fs.accessSync(file, fs.constants.X_OK);
        const result = captured(file, [], { input: '{malformed', timeout: 3000, env: { ...process.env, CLAUDE_CONFIG_DIR: cfg } });
        const ok = result.status === 0 && !result.error && !result.stderr && !result.stdout;
        add(`hook:${name}`, ok ? 'ok' : 'error', ok ? 'Executable; malformed payload fails open.' : 'Hook failed its synthetic check.');
      } catch { add(`hook:${name}`, 'error', 'Hook missing or not executable.'); }
    }
  }
  try {
    const dir = noSymlinks(path.join(process.env.LBU_STATE_DIR || path.join(cfg, 'lean-browser-use/state'), 'use'));
    const sessions = new Set(), surfaces = new Set();
    for (const name of exists(dir) ? fs.readdirSync(dir) : []) {
      if (!/^[a-f0-9]{24}$/.test(name)) continue;
      const file = noSymlinks(path.join(dir, name));
      if (!fs.lstatSync(file).isFile()) continue;
      const state = readState(file);
      for (const [surface, use] of Object.entries(state.surfaces || {})) {
        if (['chrome', 'pane'].includes(surface) && use?.lastAction > (use.lastClose || 0) && !use.kept && Date.now() - use.lastAction > 600000) {
          sessions.add(state.session || name); surfaces.add(surface);
        }
      }
    }
    add('open-surfaces', sessions.size ? 'error' : 'ok', sessions.size ? `Browser tabs left open by ${sessions.size} session(s): ${[...surfaces].sort().join(', ')}. Close them, or run npx lean-browser-use keep --reason "<why>" --session ID` : 'No stale open browser surfaces recorded.');
  } catch { add('open-surfaces', 'error', 'Browser use state could not be checked.'); }
  try {
    const leased = readLeases().leases.length;
    const items = leased ? scan().items : [];
    const live = items.filter(item => item.state === 'live');
    const refused = items.filter(item => item.state === 'refused');
    const list = live.map(({ lease, tree }) => `${lease.kind === 'chrome' ? 'chrome' : lease.argv[0].split('/').at(-1)} pid ${lease.pid} (${tree.kill.length + 1} processes, age ${age(Math.max(0, Math.round((Date.now() - Date.parse(lease.created)) / 1000) || 0))})`);
    if (refused.length) add('leftover-processes', 'error', `${refused.length} leased process(es) are running but cannot be proven safe to end: ${refused.map(r => `pid ${r.lease.pid} (${r.reason})`).join('; ')}`);
    else add('leftover-processes', live.length ? 'error' : 'ok', live.length ? `Leftover leased processes: ${list.join('; ')}. Run: npx lean-browser-use cleanup --apply` : 'No leased processes are running.');
  } catch { add('leftover-processes', 'error', 'The process list could not be read, so leftover processes could not be checked.'); }
  for (const [tool, gives] of [['python3', 'Reader and search commands'], ['crwl', 'Page text extraction'], ['docker', 'Search container'], ['claude', 'Agent runner and optional reader compile']]) {
    const available = (process.env.PATH || '').split(path.delimiter).some(dir => { try { fs.accessSync(path.join(dir, tool), fs.constants.X_OK); return true; } catch { return false; } });
    add(`capability:${tool}`, 'optional', `${available ? 'available' : 'absent'}: ${gives}`);
  }
  add('capability:transcripts', 'optional', `${exists(path.join(cfg, 'projects')) ? 'available' : 'absent'}: Token measurements`);
  const result = { ok: checks.every(c => c.status !== 'error'), checks };
  if (options.json) console.log(JSON.stringify(result, null, 2));
  else {
    for (const c of checks.filter(c => c.status !== 'optional')) console.log(`${c.status}\t${c.id}\t${c.detail}`);
    console.log('Your machine has / You get');
    for (const c of checks.filter(c => c.status === 'optional')) console.log(`${c.id.replace('capability:', '')}\t${c.detail}`);
  }
  return result.ok ? 0 : 1;
}
