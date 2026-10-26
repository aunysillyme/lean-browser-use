import fs from 'node:fs';
import { reap, summary } from './lease.mjs';

// SubagentStop, Stop and SessionEnd: end this session's leased processes.
// The hook never blocks: every path leaves the exit code at 0 and prints nothing to stdout.
const RUNNER = 'aun-browser-runner';
async function main() {
  let payload;
  try { payload = JSON.parse(fs.readFileSync(0, 'utf8')); } catch { return; }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return;
  const session = payload.session_id;
  if (typeof session !== 'string' || !session || session.length > 200) return;
  const event = payload.hook_event_name;
  if (event === 'SubagentStop') { if (payload.agent_type !== RUNNER) return; }
  else if (event === 'Stop') {
    // A subagent still in flight may own a lease; its own stop or the session end cleans up.
    if (Array.isArray(payload.background_tasks) && payload.background_tasks.some(task => task?.type === 'subagent')) return;
  } else if (event !== 'SessionEnd') return;
  const result = await reap({ apply: true, session });
  if (Object.keys(result.ended).length || result.left || result.refused.length) process.stderr.write(`${summary(result)}\n`);
}
try { await main(); } catch { /* a failing cleanup must never block the session */ }
process.exitCode = 0;
