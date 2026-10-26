import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { buildSite } from '../website/build.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const commit = '0000000000000000000000000000000000000000';

function built(t) {
  const dir = mkdtempSync(join(tmpdir(), 'website-landing-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  buildSite({ root, outDir: dir, live: false, commit });
  return readFileSync(join(dir, 'index.html'), 'utf8');
}

test('landing skip link is the first focusable element, before the header', t => {
  const html = built(t);
  assert.equal(html.split('class="skip"').length - 1, 1);
  assert.ok(html.indexOf('class="skip"') < html.indexOf('<header'));
});

test('landing proof section renders the whole benchmark cost table, not a stray pipe line', t => {
  const html = built(t);
  const proof = html.slice(html.indexOf('id="proof"'));
  assert.doesNotMatch(proof, /<p>\|\s*Run\s*\|/);
  for (const value of ['0.5975', '0.5787', '0.5779', '0.4319']) assert.ok(proof.includes(value), value);
});
