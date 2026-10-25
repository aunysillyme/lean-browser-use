import fs from 'node:fs';
import { browser, shortName, probe, isError, stateFile, readState, writeState, input, block, guard } from './common.mjs';

const message = 'List connected browsers, ask the user to pick by profile name, then select that browser. For the in-app pane, record the pick with node pick-guard.mjs --pick <label> --session <id>. A runner re-picks only the deviceId named in its brief.';
guard(() => {
  const args = process.argv.slice(2);
  if (args.length) {
    const session = args[args.indexOf('--session') + 1];
    if (!args.includes('--session') || !session || session.startsWith('--')) return block(message);
    const file = stateFile('pick', session);
    if (args.includes('--reset')) { if (fs.existsSync(file)) fs.unlinkSync(file); return; }
    const label = args[args.indexOf('--pick') + 1];
    if (!args.includes('--pick') || !label || label.startsWith('--')) return block(message);
    writeState(file, { picked: true });
    return;
  }
  const p = input();
  if (!browser(p.tool_name) || probe(p.tool_name)) return;
  if (!p.session_id) return block(message);
  const file = stateFile('pick', p.session_id);
  const name = shortName(p.tool_name);
  const selecting = ['select_browser', 'switch_browser'].includes(name);
  if (p.hook_event_name === 'PostToolUse') {
    if (name === 'tabs_close_mcp') { if (fs.existsSync(file)) fs.unlinkSync(file); }
    else if (selecting && !isError(p.tool_response)) writeState(file, { picked: true });
  } else if (p.hook_event_name === 'PreToolUse' && !selecting && !readState(file).picked) block(message);
});
