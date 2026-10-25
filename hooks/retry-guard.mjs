import { browser, native, shortName, probe, fruitless, isError, responseText, stable, hash, stateFile, readState, writeState, input, block, guard } from './common.mjs';

export function waitSeconds(name, args) {
  const code = String(args.code || args.javascript || args.script || args.text || '');
  const isWait = args.action === 'wait' || /wait|sleep/i.test(name) || Object.hasOwn(args, 'duration') || Object.hasOwn(args, 'ms') ||
    (name === 'javascript_tool' && /sleep|timeout|waitFor/i.test(code));
  if (!isWait) return null;
  if (Number.isFinite(Number(args.ms))) return Math.max(0, Number(args.ms) / 1000);
  if (Number.isFinite(Number(args.duration))) return Math.max(0, Number(args.duration));
  const delays = [...code.matchAll(/(?:setTimeout\s*\([^,]*,\s*|(?:sleep|waitFor|timeout)\s*\(\s*)(\d+)/gi)].map(m => Number(m[1]) / 1000);
  if (delays.length) return Math.max(...delays);
  // An unbounded scripted delay consumes the budget instead of bypassing it.
  return 60;
}
const empty = () => ({ waits: 0, nav: '', navCount: 0, origin: '', fruitless: 0, readKey: '', readCount: 0, text: '', nativeKey: '', nativeError: '', nativeCount: 0 });
function origin(url) { try { return new URL(url).origin; } catch { return ''; } }
guard(() => {
  const p = input();
  if ((!browser(p.tool_name) && !native(p.tool_name)) || probe(p.tool_name)) return;
  const id = p.agent_id || p.session_id;
  if (!id || !['PreToolUse', 'PostToolUse'].includes(p.hook_event_name)) return;
  const file = stateFile('retry', id);
  const data = readState(file);
  data.tabs ||= {};
  const args = p.tool_input || {};
  const tab = String(args.tabId ?? '-');
  let s = Object.hasOwn(data.tabs, tab) ? data.tabs[tab] : empty();
  const name = shortName(p.tool_name);
  const key = hash(`${p.tool_name}:${stable(args)}`);
  const wait = waitSeconds(name, args);
  const nav = name === 'navigate' || args.action === 'navigate';
  const url = String(args.url || '');
  const read = /^(read_page|find|get_page_text|get_page_content|javascript_tool|read|screenshot)$/.test(name) && wait === null;
  const targeted = /click|type|fill/.test(name) || /click|type|fill/.test(args.action || '');
  const movedOrigin = nav && origin(url) && s.origin && origin(url) !== s.origin;
  if (p.hook_event_name === 'PreToolUse') {
    if (browser(p.tool_name) && (movedOrigin || targeted)) s = empty();
    if (native(p.tool_name) && s.nativeKey === key && s.nativeCount >= 2) return block('Stop and report the repeated native error. Choose a new approach before trying again.');
    if (wait !== null && s.waits + wait > (Number(process.env.LBU_WAIT_CAP_SECONDS) || 60)) return block('Wait for an element, not for time. Stop and report if the page stays unchanged.');
    if (s.fruitless >= 2 && (wait !== null || nav || (read && s.readKey === key && s.readCount >= 2))) return block('Stop and report the fruitless reads. Use the supplied read code once or choose a different query.');
    if (nav && s.nav === url && s.navCount >= 2) return block('Stop and report the repeated navigation. Use the supplied read code once.');
    if (wait !== null) s.waits += wait;
    if (nav) { s.navCount = s.nav === url ? s.navCount + 1 : 1; s.nav = url; s.origin = origin(url); }
    else { s.nav = ''; s.navCount = 0; }
  } else {
    if (native(p.tool_name)) {
      const error = hash(responseText(p.tool_response));
      if (isError(p.tool_response)) {
        s.nativeCount = s.nativeKey === key && s.nativeError === error ? s.nativeCount + 1 : 1;
        s.nativeKey = key; s.nativeError = error;
      } else { s.nativeCount = 0; s.nativeKey = ''; }
    }
    if (read) {
      const text = hash(responseText(p.tool_response));
      if (fruitless(p.tool_response)) {
        s.fruitless += 1;
        s.readCount = s.readKey === key ? s.readCount + 1 : 1;
        s.readKey = key;
      } else {
        if (text !== s.text) s = empty();
        s.fruitless = 0; s.readCount = 0; s.text = text;
      }
    } else if (wait === null && !nav && !native(p.tool_name)) { s.fruitless = 0; s.readCount = 0; }
  }
  Object.defineProperty(data.tabs, tab, { value: s, enumerable: true, configurable: true, writable: true });
  // Bound state even when a session sees many tabs.
  for (const old of Object.keys(data.tabs).slice(0, -64)) delete data.tabs[old];
  writeState(file, data);
});
