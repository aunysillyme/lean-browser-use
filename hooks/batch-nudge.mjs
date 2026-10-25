import { browser, native, shortName, probe, stateFile, readState, writeState, input, guard } from './common.mjs';

guard(() => {
  const p = input();
  if (p.hook_event_name !== 'PostToolUse' || (!browser(p.tool_name) && !native(p.tool_name))) return;
  const id = p.agent_id || p.session_id;
  if (!id) return;
  const file = stateFile('batch', id);
  const state = readState(file);
  const reset = probe(p.tool_name) || shortName(p.tool_name) === 'browser_batch';
  state.streak = reset ? 0 : (state.streak || 0) + 1;
  writeState(file, state);
  if (state.streak === 3) process.stderr.write('Chain these actions into one browser_batch; return the needed fields together.\n');
});
