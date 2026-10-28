import { stateFile, readState, writeState, input, guard } from './common.mjs';

guard(() => {
  const p = input();
  const session = p?.session_id;
  if (typeof session !== 'string' || !session || session.length > 200) return;
  let key = session;
  if (p.hook_event_name === 'SubagentStop') {
    if (p.agent_type !== 'aun-browser-runner' || typeof p.agent_id !== 'string' || !p.agent_id) return;
    key = `${session}\0${p.agent_id}`;
  } else if (p.hook_event_name === 'Stop') {
    if (Array.isArray(p.background_tasks) && p.background_tasks.length) return;
  } else return;
  const file = stateFile('use', key);
  const state = readState(file);
  const dirty = Object.entries(state.surfaces || {}).filter(([name, use]) => ['chrome', 'pane'].includes(name) && use?.lastAction > (use.lastClose || 0) && !use.kept);
  if (!dirty.length) return;
  const now = Date.now();
  if (p.stop_hook_active === true || state.blockedAt !== undefined) {
    for (const [, use] of dirty) use.lastClose = Math.max(now, use.lastAction);
    writeState(file, state);
    return;
  }
  state.blockedAt = now;
  writeState(file, state);
  const tools = dirty.map(([name]) => `${name}: ${name === 'chrome' ? 'tabs_close_mcp' : 'tabs_close'}`).join('; ');
  const reason = `Close this run's browser tabs (${tools}). Closing the run's tabs also ends the browser control. Tabs the user already had open stay open. To hold a tab for the user, run npx lean-browser-use keep --reason "<why>". Then say what stays open and why in the reply.`;
  console.log(JSON.stringify({ decision: 'block', reason }));
});
