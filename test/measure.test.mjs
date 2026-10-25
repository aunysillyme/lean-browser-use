import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { measureData, summarize } from '../src/measure.mjs';
import { cli, root, temp } from './helpers.mjs';
const fixture = path.join(root, 'test/fixtures/transcripts');
test('measure deduplicates final usage, counts batches once and splits sidechains', () => {
  assert.deepEqual(measureData(fixture), { main: { steps: 3, median: 400, p90: 600, total: 1200, reread_share: 0.5 }, runner: { steps: 3, median: 200, p90: 300, total: 600, reread_share: 0.5 }, ratio: 2, skipped_lines: 1 });
});
test('JSON and table contain only metrics; since filters and invalid dates exit 2', () => {
  const r = cli(['measure', '--dir', fixture, '--json']); assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(JSON.parse(r.stdout), measureData(fixture));
  assert.ok(!r.stdout.includes('PRIVATE_FIXTURE_CONTENT')); assert.ok(!r.stdout.includes('synthetic'));
  const table = cli(['measure', '--dir', fixture]); assert.match(table.stdout, /group\tsteps\tmedian\tp90\ttotal\treread_share/);
  assert.equal(measureData(fixture, '2026-10-26').main.steps, 0);
  assert.equal(cli(['measure', '--dir', fixture, '--since', '2026-02-30']).status, 2);
});
test('missing folder and empty transcripts succeed without steps', t => {
  const dir = temp(t); const r = cli(['measure', '--dir', path.join(dir, 'missing')]);
  assert.equal(r.status, 0); assert.match(r.stdout, /no browser steps found/);
  assert.equal(measureData(dir).ratio, null);
});
test('largest usage line can omit tools, and malformed rows are counted', t => {
  const dir = temp(t);
  const row = { type: 'assistant', message: { id: 'a', content: [{ type: 'tool_use', name: 'mcp__playwright__read' }], usage: { input_tokens: 10 } } };
  const last = { ...row, message: { ...row.message, content: [], usage: { input_tokens: 90 } } };
  fs.writeFileSync(path.join(dir, 'a.jsonl'), [JSON.stringify(row), JSON.stringify(last), 'null', '{bad', JSON.stringify({ type: 'assistant' })].join('\n'));
  assert.equal(measureData(dir).main.total, 90); assert.equal(measureData(dir).skipped_lines, 3);
  assert.equal(measureData(dir).ratio, null);
});
test('median uses middle pair, p90 uses nearest rank and zero share is defined', () => {
  assert.deepEqual(summarize([{ total: 10, cached: 2 }, { total: 20, cached: 4 }]), { steps: 2, median: 15, p90: 20, total: 30, reread_share: 0.2 });
  assert.equal(summarize([{ total: 0, cached: 0 }]).reread_share, 0);
});
