import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { deflateSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { gate, scanText, termHashes, normalize } from '../scripts/gate.mjs';
import { temp, run } from './helpers.mjs';

const single = ['hidden', 'widget'].join('-');
const phrase = ['private', 'fixture'].join(' ');
const hashes = new Set(termHashes(`${single}\n${phrase}`));
test('hash tokens, phrases and multiline normalization; brand passes', () => {
  assert.ok(scanText(single.toUpperCase(), hashes).some(h => h.class.startsWith('private-term:')));
  assert.ok(scanText(phrase.replace(' ', '\n'), hashes).length);
  assert.equal(normalize('Word / TWO...'), 'word two');
  assert.equal(scanText('Auny aunysillyme Auny LLC aunysillyme.com aunysillyme.dev auny.media https://github.com/aunysillyme/lean-browser-use', hashes).length, 0);
});
test('gate refuses hashed terms in content and names without printing the term', t => {
  const dir = temp(t); fs.mkdirSync(path.join(dir, 'test'));
  fs.writeFileSync(path.join(dir, 'test/terms.private.sha256'), [...hashes].join('\n'));
  fs.writeFileSync(path.join(dir, 'content.txt'), phrase);
  fs.writeFileSync(path.join(dir, `${single}.md`), 'safe');
  const lines = [];
  assert.equal(gate(dir, { output: line => lines.push(line) }), 1);
  assert.match(lines.join('\n'), /:name:private-term:/);
  assert.match(lines.join('\n'), /content.txt:1:private-term:/);
  assert.ok(!lines.join('\n').includes(single)); assert.ok(!lines.join('\n').includes(phrase));
});
test('history and tag gate in an isolated fixture repository', t => {
  const dir = temp(t);
  assert.equal(spawnSync('git', ['init', '-q', dir]).status, 0);
  // Construct local fixture objects so the test never stages or commits work.
  function object(type, body) {
    const bytes = Buffer.concat([Buffer.from(`${type} ${Buffer.byteLength(body)}\0`), Buffer.from(body)]);
    const id = createHash('sha1').update(bytes).digest('hex');
    const folder = path.join(dir, '.git/objects', id.slice(0, 2)); fs.mkdirSync(folder, { recursive: true });
    fs.writeFileSync(path.join(folder, id.slice(2)), deflateSync(bytes)); return id;
  }
  const tree = object('tree', '');
  const identity = 'Fixture <fixture' + '@' + 'example.com> 1 +0000';
  const commit = object('commit', `tree ${tree}\nauthor ${identity}\ncommitter ${identity}\n\n${phrase}\n`);
  fs.writeFileSync(path.join(dir, '.git/refs/heads/main'), `${commit}\n`);
  fs.writeFileSync(path.join(dir, '.git/refs/tags', single), `${commit}\n`);
  fs.mkdirSync(path.join(dir, 'test')); fs.writeFileSync(path.join(dir, 'test/terms.private.sha256'), [...hashes].join('\n'));
  const out = []; assert.equal(gate(dir, { output: s => out.push(s) }), 1);
  assert.ok(out.some(s => s.startsWith('commit:'))); assert.ok(out.some(s => s.startsWith('tag:')));
  assert.ok(!out.join('\n').includes(phrase)); assert.ok(!out.join('\n').includes(single));
});
const classes = [
  ['home-path', '/home/' + 'someone/file'], ['home-path', '/Users/' + 'person/file'],
  ['email', 'person' + '@' + 'example.com'], ['ipv4', [8, 8, 8, 8].join('.')], ['cgnat', [100, 64, 1, 2].join('.')],
  ['ticket', 'AUN-' + '123'], ['tracker', 'linear' + '.app'], ['secret', 'sk-' + 'a'.repeat(20)],
  ['secret', 'gh' + 'p_' + 'test'], ['secret', 'github' + '_pat_' + 'test'], ['secret', 'AKIA' + 'A'.repeat(16)],
  ['secret', 'xox' + 'b-test'], ['secret', '-----BEGIN ' + 'PRIVATE KEY-----'], ['em-dash', String.fromCodePoint(0x2014)]
];
for (const [kind, value] of classes) test(`generic gate class ${kind}: ${classes.indexOf(classes.find(c => c[1] === value))}`, () => {
  assert.ok(scanText(value).some(h => h.class === kind));
});
test('documented safe placeholders and co-author trailers pass', () => {
  assert.equal(scanText('~/ $HOME /home/user /Users/you 127.0.0.1 0.0.0.0 192.0.2.5 198.51.100.9 203.0.113.4').length, 0);
  for (const domain of ['anthropic.com', 'openai.com']) {
    assert.equal(scanText('Co-authored-by: Assistant <noreply' + '@' + domain + '>').length, 0);
    assert.ok(scanText('noreply' + '@' + domain).length);
  }
});
test('plain and extra term lists and hash generation', t => {
  const dir = temp(t); const source = path.join(dir, 'list'); const target = path.join(dir, 'hashes');
  fs.writeFileSync(source, `# comment\n${phrase}\n${single}\n${single}\n`);
  assert.equal(run('scripts/terms-hash.mjs', [source, target]).status, 0);
  assert.equal(fs.readFileSync(target, 'utf8').trim().split('\n').length, 2);
  fs.writeFileSync(path.join(dir, 'content.txt'), single);
  assert.equal(gate(dir, { extraList: source, output: () => {} }), 1);
  fs.mkdirSync(path.join(dir, '.repo-build'));
  fs.writeFileSync(path.join(dir, '.repo-build/private.local.txt'), single);
  assert.equal(gate(dir, { output: () => {} }), 1);
});

test('every generic class fails the full file gate', t => {
  for (const [kind, value] of classes) {
    const dir = temp(t); fs.writeFileSync(path.join(dir, 'sample.txt'), value);
    const out = []; assert.equal(gate(dir, { output: s => out.push(s) }), 1, kind);
    assert.ok(out.some(line => line.endsWith(`:${kind}`)), kind);
    assert.ok(!out.join('\n').includes(value));
  }
});
test('expired proof warns without failing check', t => {
  const dir = temp(t); fs.mkdirSync(path.join(dir, 'proof'));
  fs.writeFileSync(path.join(dir, 'proof/results.json'), JSON.stringify({ version: 1, rows: [{ id: 'sample', expires: '2000-01-01' }] }));
  const result = run('scripts/check.mjs', [], { cwd: dir });
  assert.equal(result.status, 0); assert.match(result.stderr, /Warning: proof row sample expired/);
});
