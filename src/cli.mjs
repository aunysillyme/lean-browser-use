import fs from 'node:fs';
import path from 'node:path';
import { root } from './paths.mjs';
import { install } from './install.mjs';
import { uninstall } from './uninstall.mjs';
import { doctor } from './doctor.mjs';
import { spawnCommand } from './spawn.mjs';
import { cleanup } from './cleanup.mjs';
import { keep } from './keep.mjs';

export const usage = `lean-browser-use [install] [--claude-dir DIR] [--project] [--no-hooks] [--no-stop-gate] [--with-reader] [--dry] [--yes]
lean-browser-use uninstall [--claude-dir DIR] [--dry] (also --uninstall)
lean-browser-use doctor [--claude-dir DIR] [--json]
lean-browser-use measure [--dir DIR] [--since YYYY-MM-DD] [--json]
lean-browser-use spawn [--session ID] [--run NAME] -- COMMAND [ARGS...]
lean-browser-use cleanup [--apply] [--all] [--session ID] [--run NAME] [--json]
lean-browser-use keep --reason TEXT [--session ID] [--claude-dir DIR]
--help  --version
Exit codes: 0 ok; 1 check failed; 2 usage or refused target; 3 edited files kept.
Requirements: Node >=20; optional Python 3.
Cleanup: dry run by default; --apply sends SIGTERM, waits 3 seconds, then SIGKILL for the same leased process only.
Guard defaults: wait cap 60 seconds; stop on attempt 3; element wait 10 seconds.
Install budgets: 400000 bytes packed; 5 seconds. Skill budgets: 6144 bytes; 120 lines.`;
export async function main(args = process.argv.slice(2)) {
  if (args[0] === 'spawn') {
    if (args.some(a => a === '--help' || a === '-h') && !args.includes('--')) { console.log(usage); return 0; }
    try { return await spawnCommand(args.slice(1)); } catch (e) { console.error(e.exitCode === 2 ? e.message : 'Spawn failed; check the command and the lease directory.'); return e.exitCode || 2; }
  }
  const options = {};
  let command = 'install', commandSet = false;
  const values = { '--claude-dir': 'claudeDir', '--dir': 'dir', '--since': 'since', '--session': 'session', '--run': 'run', '--reason': 'reason' };
  const booleans = { '--project': 'project', '--no-hooks': 'noHooks', '--no-stop-gate': 'noStopGate', '--with-reader': 'withReader', '--dry': 'dry', '--yes': 'yes', '--json': 'json', '--apply': 'apply', '--all': 'all' };
  const fail = message => { console.error(`${message}\n${usage}`); return 2; };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--help' || arg === '-h') { console.log(usage); return 0; }
    if (arg === '--version') { console.log(JSON.parse(fs.readFileSync(path.join(root, 'package.json'))).version); return 0; }
    if (arg in values) {
      if (!args[i + 1] || args[i + 1].startsWith('--')) return fail(`Value required for ${arg}.`);
      options[values[arg]] = args[++i];
    } else if (arg in booleans) options[booleans[arg]] = true;
    else if (['install', 'uninstall', 'doctor', 'measure', 'cleanup', 'keep', '--uninstall'].includes(arg) && !commandSet) { command = arg.replace(/^--/, ''); commandSet = true; }
    else return fail('Unknown command or option.');
  }
  const permitted = { install: ['claudeDir', 'project', 'noHooks', 'noStopGate', 'withReader', 'dry', 'yes'], uninstall: ['claudeDir', 'project', 'dry'], doctor: ['claudeDir', 'project', 'json'], measure: ['claudeDir', 'dir', 'since', 'json'], cleanup: ['apply', 'all', 'session', 'run', 'json'], keep: ['reason', 'session', 'claudeDir'] };
  if (Object.keys(options).some(k => !permitted[command].includes(k))) return fail('Option does not apply to this command.');
  try {
    if (command === 'install') return await install(options);
    if (command === 'uninstall') return uninstall(options);
    if (command === 'doctor') return doctor(options);
    if (command === 'cleanup') return await cleanup(options);
    if (command === 'keep') return keep(options);
    const { measure } = await import('./measure.mjs'); return measure(options);
  } catch (e) { console.error(e.exitCode === 2 ? e.message : 'Operation failed; check target permissions and file integrity.'); return e.exitCode || 2; }
}
