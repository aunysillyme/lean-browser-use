import fs from 'node:fs';
import path from 'node:path';
import { configDir } from './paths.mjs';
import { refusal } from './util.mjs';
const browserTool = /^mcp__(claude-in-chrome|Claude_Browser|Control_Chrome|playwright|chrome-devtools)__/;
export function summarize(steps) {
  const values = steps.map(s => s.total).sort((a, b) => a - b), n = values.length;
  const total = values.reduce((a, b) => a + b, 0);
  return { steps: n, median: n ? (values[Math.floor((n - 1) / 2)] + values[Math.floor(n / 2)]) / 2 : 0,
    p90: n ? values[Math.ceil(n * 0.9) - 1] : 0, total,
    reread_share: total ? steps.reduce((sum, step) => sum + step.cached, 0) / total : 0 };
}
export function measureData(dir, since) {
  if (since && (!/^\d{4}-\d{2}-\d{2}$/.test(since) || !Number.isFinite(Date.parse(since)) || new Date(since).toISOString().slice(0, 10) !== since)) throw refusal('--since needs a valid YYYY-MM-DD date.');
  const earliest = since ? Date.parse(since) : null;
  const messages = new Map(); let skipped_lines = 0;
  function visit(folder) {
    let entries;
    try { entries = fs.readdirSync(folder, { withFileTypes: true }); }
    catch (e) { if (e.code !== 'ENOENT') skipped_lines++; return; }
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      const file = path.join(folder, entry.name);
      if (entry.isDirectory()) { visit(file); continue; }
      if (!entry.isFile() || !file.endsWith('.jsonl')) continue;
      let text; try { text = fs.readFileSync(file, 'utf8'); } catch { skipped_lines++; continue; }
      for (const line of text.split(/\r?\n/)) {
        if (!line.trim()) continue;
        try {
          const row = JSON.parse(line);
          if (!row || typeof row !== 'object' || Array.isArray(row)) throw new Error();
          if (earliest !== null) {
            if (!Number.isFinite(Date.parse(row.timestamp))) { skipped_lines++; continue; }
            if (Date.parse(row.timestamp) < earliest) continue;
          }
          if (row.type !== 'assistant') continue;
          const m = row.message;
          if (!m || typeof m.id !== 'string' || !Array.isArray(m.content) || !m.usage) throw new Error();
          const counts = ['input_tokens', 'cache_creation_input_tokens', 'cache_read_input_tokens'].map(k => m.usage[k] ?? 0);
          if (counts.some(v => typeof v !== 'number' || !Number.isFinite(v) || v < 0)) throw new Error();
          const browser = m.content.some(c => c.type === 'tool_use' && browserTool.test(c.name));
          const old = messages.get(m.id);
          const candidate = { browser, total: counts.reduce((a, b) => a + b, 0), cached: counts[1] + counts[2], runner: row.isSidechain === true || file.split(path.sep).includes('subagents') };
          if (!old || candidate.total >= old.total) messages.set(m.id, { ...candidate, browser: browser || !!old?.browser });
          else if (browser) old.browser = true;
        } catch { skipped_lines++; }
      }
    }
  }
  visit(path.resolve(dir));
  const steps = [...messages.values()].filter(m => m.browser);
  const main = summarize(steps.filter(s => !s.runner)), runner = summarize(steps.filter(s => s.runner));
  return { main, runner, ratio: main.steps >= 3 && runner.steps >= 3 && runner.median > 0 ? main.median / runner.median : null, skipped_lines };
}
export function measure(options = {}) {
  const result = measureData(options.dir || path.join(configDir(options), 'projects'), options.since);
  if (options.json) console.log(JSON.stringify(result, null, 2));
  else {
    if (!result.main.steps && !result.runner.steps) console.log('no browser steps found');
    console.log('group\tsteps\tmedian\tp90\ttotal\treread_share');
    for (const key of ['main', 'runner']) { const r = result[key]; console.log(`${key}\t${r.steps}\t${r.median}\t${r.p90}\t${r.total}\t${r.reread_share.toFixed(4)}`); }
    console.log(`ratio\t${result.ratio ?? 'needs at least 3 steps per group'}\nskipped_lines\t${result.skipped_lines}`);
  }
  return 0;
}
