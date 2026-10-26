import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readPins, copyPinFailures } from '../website/copy.mjs';
import { loadSourceFacts } from '../website/facts.mjs';
import { content } from '../website/content.mjs';
const root = fileURLToPath(new URL('..', import.meta.url));
const pins = readPins(root);
const facts = loadSourceFacts(root);
const copy = { headlineSource: facts.lead, headline: content.headline, installCommand: content.install.command, description: facts.description };

test('copy pins keep README, About, package metadata and the owner headline in agreement', () => {
  assert.deepEqual(copyPinFailures(pins, copy), []);
  assert.equal(pins.about, pins.packageDescription);
  assert.equal(pins.readmeLead, facts.lead);
  assert.equal(pins.installCommand, 'npx lean-browser-use');
  assert.equal(JSON.parse(readFileSync(new URL('../package.json', import.meta.url))).description, pins.packageDescription);
});

test('RED every pinned message rejects a one-word defect and accepts restoration', () => {
  for (const [field, diagnostic] of [['headlineSource', /pinned headline source/], ['headline', /pinned headline/], ['installCommand', /pinned install command/], ['description', /pinned meta description/]]) {
    assert.ok(copyPinFailures(pins, { ...copy, [field]: copy[field] + ' changed' }).some(finding => diagnostic.test(finding)), field);
    assert.deepEqual(copyPinFailures(pins, copy), []);
  }
});

test('RED malformed or missing snapshot fields fail closed', t => {
  const dir = mkdtempSync(join(tmpdir(), 'website-pins-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  mkdirSync(join(dir, 'website'));
  for (const field of ['about', 'readmeLead', 'installCommand', 'packageDescription']) {
    writeFileSync(join(dir, 'website/pins.json'), JSON.stringify({ ...pins, [field]: '' }));
    assert.throws(() => readPins(dir), new RegExp(`Missing copy pin: ${field}`));
  }
  writeFileSync(join(dir, 'website/pins.json'), JSON.stringify({ ...pins, readmeLead: 'Other format' }));
  assert.throws(() => readPins(dir), /lead format/);
  writeFileSync(join(dir, 'website/pins.json'), JSON.stringify(pins));
  assert.deepEqual(readPins(dir), pins);
});
