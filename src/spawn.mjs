import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { classify, liveVerdict, psOne, writeLease, sessionFromEnv } from '../hooks/lease.mjs';
import { refusal } from './util.mjs';

export const spawnUsage = 'lean-browser-use spawn [--session ID] [--run NAME] -- COMMAND [ARGS...]';
export function parseSpawn(args) {
  const split = args.indexOf('--');
  const flags = split < 0 ? args : args.slice(0, split);
  const command = split < 0 ? [] : args.slice(split + 1);
  const options = { session: sessionFromEnv(), run: '' };
  for (let i = 0; i < flags.length; i++) {
    if (flags[i] === '--session' || flags[i] === '--run') {
      if (!flags[i + 1] || flags[i + 1].startsWith('--')) throw refusal(`Value required for ${flags[i]}.\n${spawnUsage}`);
      options[flags[i].slice(2)] = flags[++i];
    } else throw refusal(`Unknown option.\n${spawnUsage}`);
  }
  if (!command.length) throw refusal(`A command is required after --.\n${spawnUsage}`);
  return { ...options, command };
}
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
// A wrapper or interpreter may re-exec just after start; wait until two reads agree.
async function settledRow(pid) {
  let previous = null;
  for (let i = 0; i < 10; i++) {
    const row = psOne(pid);
    if (!row || row.stat.startsWith('Z')) return null;
    if (previous && previous.command === row.command && previous.start === row.start) return row;
    previous = row; await sleep(100);
  }
  return previous;
}
// Start COMMAND detached, record a lease for it, and return. A process that cannot be
// leased is stopped again, so nothing runs without an owner on record.
export async function spawnCommand(args) {
  const { session, run, command } = parseSpawn(args);
  const verdict = classify(command);
  if (!verdict.ok) throw refusal(`Refused: ${verdict.reason}.`);
  const child = spawn(command[0], command.slice(1), { detached: true, stdio: 'ignore' });
  try { await once(child, 'spawn'); } catch { throw refusal(`Could not start ${command[0]}.`); }
    // The child leads its own process group, so the group holds exactly it and what it started.
  const stop = message => { try { process.kill(-child.pid, 'SIGKILL'); } catch { child.kill('SIGKILL'); } throw refusal(message); };
  try {
    const row = await settledRow(child.pid);
    if (!row) { console.error('The command exited right away; no lease was written.'); return 1; }
    const live = liveVerdict(row.command);
    if (!live.ok || live.kind !== verdict.kind) stop(`Refused: ${live.reason || 'the running command differs from the one requested'}.`);
    const lease = writeLease({ pid: child.pid, kind: verdict.kind, start: row.start, command: row.command, argv: command, session, run, created: new Date().toISOString() });
    child.unref();
    console.log(`spawned pid=${child.pid} lease=${lease.id} kind=${verdict.kind}${session ? ` session=${session}` : ''}`);
    return 0;
  } catch (error) {
    if (error.exitCode === 2) throw error;
    stop('Could not record the lease, so the process was stopped.');
  }
}
