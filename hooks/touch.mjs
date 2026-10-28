import { browser, shortName, isError, hash, stateFile, readState, writeState, input, guard } from './common.mjs';

const probes = new Set(['tabs_context_mcp', 'tabs_context', 'list_connected_browsers', 'select_browser', 'switch_browser', 'list_tabs', 'get_current_tab', 'read_console_messages', 'read_network_requests', 'shortcuts_list', 'preview_list', 'preview_logs']);
const closes = { chrome: new Set(['tabs_close_mcp', 'close_tab']), pane: new Set(['tabs_close', 'preview_stop']) };

guard(() => {
  const p = input();
  if (p?.hook_event_name !== 'PostToolUse' || !browser(p.tool_name)) return;
  const session = p.session_id;
  if (typeof session !== 'string' || !session || session.length > 200) return;
  if (p.agent_id !== undefined && (typeof p.agent_id !== 'string' || !p.agent_id)) return;
  const surface = p.tool_name.startsWith('mcp__Claude_Browser__') ? 'pane' : 'chrome';
  const name = shortName(p.tool_name);
  const close = closes[surface].has(name);
  if (close ? isError(p.tool_response) : probes.has(name)) return;
  const key = p.agent_id ? `${session}\0${p.agent_id}` : session;
  const file = stateFile('use', key);
  const state = readState(file);
  state.surfaces ||= {};
  if (close && !state.surfaces[surface]) return;
  state.session = hash(session);
  const use = state.surfaces[surface] ||= { firstAction: Date.now(), lastAction: 0, lastClose: 0, actions: 0, closes: 0, kept: false };
  if (close) {
    use.lastClose = Math.max(Date.now(), use.lastAction);
    use.closes++;
  } else {
    for (const item of Object.values(state.surfaces)) item.kept = false;
    delete state.keepReason;
    delete state.blockedAt;
    use.lastAction = Math.max(Date.now(), use.lastClose + 1);
    use.actions++;
  }
  writeState(file, state);
});
