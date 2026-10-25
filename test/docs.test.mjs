import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { root, cli } from './helpers.mjs';
import { walk } from '../src/util.mjs';
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');
function available(t, files) {
  const missing = files.filter(f => !fs.existsSync(path.join(root, f)));
  if (missing.length) { t.skip(`Writer B files pending: ${missing.join(', ')}`); return false; }
  return true;
}
test('text tree uses plain punctuation', () => {
  for (const file of walk(root).filter(f => !path.relative(root, f).split(path.sep).some(p => ['.git', '.repo-build', 'node_modules', '__pycache__', '.agents', '.aws', '.codex'].includes(p)) && !/\.(tgz|pyc)$/.test(f))) {
    assert.ok(!fs.readFileSync(file, 'utf8').includes(String.fromCodePoint(0x2014)), path.relative(root, file));
  }
});
test('CLAUDE pointer is exact and agent instructions are bounded', t => {
  if (!available(t, ['CLAUDE.md', 'AGENTS.md'])) return;
  assert.equal(read('CLAUDE.md'), '# CLAUDE.md\n\nAGENTS.md is the single source of agent instructions for this repo.\n\n' + '@' + 'AGENTS.md\n');
  assert.ok(read('AGENTS.md').trimEnd().split('\n').length <= 200);
});
test('README first-screen order, bounded fences, receipt markers and sibling row', t => {
  if (!available(t, ['README.md'])) return;
  const text = read('README.md'); assert.match(text, /^# lean-browser-use\n/);
  assert.ok(text.includes('**Cut browser use token cost about 3x per step in Claude Code: run page work in a fresh runner, send it in bulk, and see your own saving.**'));
  assert.ok(text.trimEnd().split('\n').length < 350);
  const positions = ['**Cut browser use token cost', 'npx lean-browser-use', '## What it does', '## What it saves', '## After you install', '## Part of a set', '## Measure your own saving', '## Common questions', '## Uninstall', '## Read next', 'For agents', '## Contributing', '## Credits', '## License'].map(s => {
    const i = text.indexOf(s); assert.ok(i >= 0, `Missing ${s}`); return i;
  });
  assert.deepEqual(positions, [...positions].sort((a, b) => a - b));
  for (const block of text.matchAll(/^```[^\n]*\n([\s\S]*?)^```/gm)) assert.ok(block[1].trimEnd().split('\n').length <= 8);
  assert.ok(!text.includes('{{proof:'), 'Replace proof placeholders from generated results.');
  assert.match(text, /\| \*\*lean-browser-use\*\* \|/);
  const description = JSON.parse(read('package.json')).description;
  assert.ok(text.includes(`| **lean-browser-use** | ${description} |`));
  assert.ok(read('llms.txt').includes(`> ${description}\n`));
  assert.ok(read('llms.txt').includes(`[lean-browser-use: ${description}]`));
  assert.match(text, /\[lean-computer-use\]\(https:\/\/github.com\/aunysillyme\/lean-computer-use\)/);
  assert.ok(text.includes('Token-lean computer use for AI agents: runner subagent, desktop scripts, guards and a token meter, installed with one command'));
  const questions = text.slice(text.indexOf('## Common questions'), text.indexOf('## Uninstall')).match(/^### /gm) || [];
  assert.ok(questions.length >= 4 && questions.length <= 6);
});
test('README quantities are backed by proof or captured program output', t => {
  if (!available(t, ['README.md', 'proof/results.json'])) return;
  const outputs = [cli(['--help']).stdout, cli(['--version']).stdout, cli(['measure', '--dir', 'test/fixtures/transcripts']).stdout, read('proof/results.json')].join('\n');
  const supported = new Set([...outputs.matchAll(/\d+(?:\.\d+)?/g)].map(m => Number(m[0].replaceAll(',', ''))));
  // URLs and licence identifiers are names; check prose quantities and list numbers.
  const prose = read('README.md').replace(/\]\([^)]*\)/g, ']').replace(/(?:Apache|AGPL|CC-BY)-[\d.]+/g, 'licence');
  const proof = JSON.parse(read('proof/results.json'));
  const value = id => { const row = proof.rows.find(r => r.id === id); assert.ok(row, id); return row.value; };
  for (const m of prose.matchAll(/about (\d+)x/g)) assert.equal(Number(m[1]), Math.round(value('paired_step_ratio')), 'README per-step ballpark must follow proof');
  assert.match(prose, /about half/);
  assert.equal(Math.round(value('paired_task_ratio')), 2, 'README about half must follow proof');
  const formatted = id => value(id).toLocaleString('en-US');
  assert.ok(prose.includes(`| Per browser step (median tokens) | ${formatted('paired_step_tokens_plain')} | ${formatted('paired_step_tokens_runner')} | ${value('paired_step_ratio')} |`));
  assert.ok(prose.includes(`| Whole task (browser-step tokens) | ${formatted('paired_task_tokens_plain')} | ${formatted('paired_task_tokens_runner_arm')} | ${value('paired_task_ratio')} |`));
  for (const m of prose.matchAll(/(?:^|[\s|(>])([0-9]+(?:,[0-9]{3})*(?:\.[0-9]+)?)(?=[\s.,)|%<]|$)/gm)) assert.ok(supported.has(Number(m[1].replaceAll(',', ''))), `Unproved README quantity: ${m[1]}`);
});
test('README, docs and llms links resolve and headings name useful content', t => {
  if (!available(t, ['README.md', 'llms.txt', 'docs/install.md'])) return;
  const files = ['README.md', 'llms.txt', ...walk(path.join(root, 'docs')).map(p => path.relative(root, p))];
  for (const file of files) {
    const text = read(file);
    for (const match of text.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)) {
      let link = match[1].replace(/^<|>$/g, '').split('#')[0];
      const prefix = 'https://github.com/aunysillyme/lean-browser-use/blob/main/';
      const repoLink = link.startsWith(prefix);
      if (repoLink) link = link.slice(prefix.length);
      else if (/^[a-z]+:/.test(link) || !link) continue;
      const target = path.resolve(root, repoLink ? '' : path.dirname(file), decodeURIComponent(link));
      assert.ok(fs.existsSync(target) && fs.statSync(target).isFile(), `${file}: ${link}`);
    }
    assert.ok(!/^#+\s+.*\b(What it is not|Limits|Missing|Honest limits)\b/im.test(text), file);
  }
});
test('llms shape and bounded skill/reference files', t => {
  const skill = 'skills/lean-browser-use/SKILL.md';
  if (!available(t, ['llms.txt', skill])) return;
  const llms = read('llms.txt'); assert.match(llms, /^# /); assert.match(llms, /^> /m); assert.match(llms, /npx lean-browser-use/);
  for (const title of ['Docs', 'Reference', 'Optional']) assert.ok(llms.includes(`## ${title}`));
  for (const section of llms.split(/^## /m).slice(1)) assert.match(section, /\[[^\]]+\]\(https:\/\//);
  const text = read(skill); assert.ok(Buffer.byteLength(text) < 6144); assert.ok(text.trimEnd().split('\n').length <= 120);
  assert.match(text, /^---\n/); assert.match(text.split('---')[1], /^name: lean-browser-use$/m); assert.match(text.split('---')[1], /^description: .+/m);
  for (const file of walk(path.join(root, 'skills/lean-browser-use/references'))) assert.ok(fs.statSync(file).size <= 8192);
});
test('runner frontmatter declares its name, description, tools and model', t => {
  const file = 'agents/aun-browser-runner.md'; if (!available(t, [file])) return;
  const front = read(file).match(/^---\n([\s\S]*?)\n---\n/); assert.ok(front);
  for (const key of ['name', 'description', 'tools', 'model']) assert.match(front[1], new RegExp(`^${key}: .+`, 'm'));
  assert.match(front[1], /^name: aun-browser-runner$/m); assert.match(front[1], /^model: haiku$/m);
});

test('historical saving figures stay outside the public tree', () => {
  const banned = new RegExp('99' + '\\.81%');
  for (const file of walk(root).filter(f => !path.relative(root, f).split(path.sep).some(p => ['.git', '.repo-build', 'node_modules', '__pycache__', '.agents', '.codex', '.aws'].includes(p)) && !/\.(tgz|pyc)$/.test(f))) assert.ok(!banned.test(fs.readFileSync(file, 'utf8')), path.relative(root, file));
});
