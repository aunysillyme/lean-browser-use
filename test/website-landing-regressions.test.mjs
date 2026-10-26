import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { buildSite } from '../website/build.mjs';
import { parseHtml } from '../website/check.mjs';

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

const trace = '<svg class="card-trace" aria-hidden="true" focusable="false"><rect class="ray-tail" x=".5" y=".5" pathLength="100"/><rect class="ray-mid" x=".5" y=".5" pathLength="100"/><rect class="ray-tip" x=".5" y=".5" pathLength="100"/></svg>';
const hasClass = (node, name) => (node.attrs.class || '').split(/\s+/).includes(name);

test('every landing card and action starts with a decorative three-part ray', t => {
  const nodes = parseHtml(built(t));
  const groups = [
    ['routing graphic', node => hasClass(node, 'routing'), 1],
    ['install command', node => hasClass(node, 'install'), 1],
    ['doc links', node => hasClass(node, 'doc-link'), 4],
    ['feature cards', node => node.name === 'article' && hasClass(node.parent, 'three') && !hasClass(node.parent, 'requirements'), 3],
    ['install panel', node => hasClass(node, 'code'), 1],
    ['requirements', node => node.name === 'article' && hasClass(node.parent, 'requirements'), 4],
    ['proof card', node => hasClass(node, 'proof-card'), 1],
    ['hero actions', node => node.name === 'a' && hasClass(node.parent, 'hero-actions'), 4],
    ['copy button', node => hasClass(node, 'copy'), 1],
    ['step buttons', node => node.name === 'button' && hasClass(node.parent, 'task-tabs'), 4],
    ['trailer control', node => hasClass(node, 'trailer-toggle'), 1],
    ['routing nodes', node => 'data-role' in node.attrs, 4],
  ];
  for (const [name, select, count] of groups) {
    const cards = nodes.filter(select);
    assert.equal(cards.length, count, name);
    for (const card of cards) {
      assert.ok(hasClass(card, 'card'), name);
      assert.ok(card.inner.startsWith(trace), name);
    }
  }
  for (const node of nodes.filter(node => node.name === 'aside' || node.name === 'header')) assert.ok(!node.inner.includes('card-trace'));
});

test('docs tool and proof cards get rays while document code blocks stay plain', t => {
  const dir = mkdtempSync(join(tmpdir(), 'website-rays-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  buildSite({ root, outDir: dir, commit });
  for (const file of ['docs/how-it-works/index.html', 'docs/proof/index.html']) {
    const nodes = parseHtml(readFileSync(join(dir, file), 'utf8'));
    const cards = nodes.filter(node => 'data-tool' in node.attrs || hasClass(node, 'proof-card'));
    assert.ok(cards.length, file);
    for (const card of cards) {
      assert.ok(hasClass(card, 'card'), file);
      assert.ok(card.inner.startsWith(trace), file);
    }
    for (const pre of nodes.filter(node => node.name === 'pre')) assert.ok(!pre.inner.includes('card-trace'));
  }
});

test('ray CSS defines border travel, hover and focus triggers, stacking and motion preferences', () => {
  const css = readFileSync(join(root, 'website/assets/site.css'), 'utf8');
  assert.match(css, /\.card\{[^}]*position:relative/);
  assert.match(css, /@keyframes card-ray\{to\{stroke-dashoffset:100\}\}/);
  assert.match(css, /\.card:hover \.card-trace,\.card:focus-within \.card-trace\{opacity:1\}/);
  assert.match(css, /\.card:hover \.card-trace rect,\.card:focus-within \.card-trace rect\{animation:card-ray 5s linear infinite\}/);
  assert.match(css, /@media\s*\(prefers-reduced-motion:\s*reduce\)\{\.card-trace rect\{animation:none!important\}\}/);
  assert.match(css, /\.card-trace\{[^}]*z-index:2/);
  assert.match(css, /@media\s*\(forced-colors:\s*active\)\{\.card \.card-trace\{display:none\}\}/);
});

test('every docs page puts the skip link before the header', t => {
  const dir = mkdtempSync(join(tmpdir(), 'website-docs-skip-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  buildSite({ root, outDir: dir, live: false, commit });
  for (const route of ['docs/overview', 'docs/install']) {
    const html = readFileSync(join(dir, route, 'index.html'), 'utf8');
    assert.equal(html.split('class="skip"').length - 1, 1, route);
    assert.ok(html.indexOf('class="skip"') < html.indexOf('<header'), route);
  }
});

test('live markdown twins carry no mobile navigation summary text', t => {
  const dir = mkdtempSync(join(tmpdir(), 'website-twin-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  buildSite({ root, outDir: dir, live: true, commit });
  for (const route of ['', 'docs/overview/']) {
    const lines = readFileSync(join(dir, route, 'index.md'), 'utf8').split('\n').map(line => line.trim());
    for (const label of ['Documentation', 'On this page']) assert.ok(!lines.includes(label), `${route || 'home'} has a stray "${label}" line`);
  }
});
