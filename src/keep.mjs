import fs from 'node:fs';
import path from 'node:path';
import { configDir, noSymlinks } from './paths.mjs';
import { refusal } from './util.mjs';
import { sessionFromEnv } from '../hooks/lease.mjs';
import { hash, stateFile, readState, writeState } from '../hooks/common.mjs';

export function keep(options = {}) {
  const reason = options.reason?.trim();
  if (!reason) throw refusal('keep requires --reason TEXT.');
  const session = options.session || sessionFromEnv();
  if (!session || session.length > 200) throw refusal('keep requires --session ID or a session environment variable (at most 200 characters).');
  const previous = process.env.CLAUDE_CONFIG_DIR;
  try {
    process.env.CLAUDE_CONFIG_DIR = configDir(options);
    const main = stateFile('use', session);
    const dir = path.dirname(main);
    const files = new Set([main, ...fs.readdirSync(dir).filter(name => /^[a-f0-9]{24}$/.test(name)).map(name => path.join(dir, name))]);
    let count = 0;
    for (const file of files) {
      noSymlinks(file);
      if (file !== main && !fs.lstatSync(file).isFile()) continue;
      let state;
      try { state = readState(file); } catch (e) { if (file === main) throw e; continue; }
      if (file !== main && state?.session !== hash(session)) continue;
      state.session = hash(session);
      state.surfaces ||= {};
      for (const use of Object.values(state.surfaces)) { use.kept = true; count++; }
      state.keepReason = reason;
      writeState(file, state);
    }
    console.log(`keep: ${count} surface(s) held: ${reason}`);
    return 0;
  } finally {
    if (previous === undefined) delete process.env.CLAUDE_CONFIG_DIR;
    else process.env.CLAUDE_CONFIG_DIR = previous;
  }
}
