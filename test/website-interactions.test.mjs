import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setupTrailer } from '../website/assets/trailer.js';
import { setupFlow, setupCopy } from '../website/assets/site.js';
import { currentSection } from '../website/assets/navigation.js';

function playback(reduced = false) {
  const events = {}, clicks = {}, lifecycle = {};
  const preference = { matches: reduced, addEventListener: (_, callback) => { preference.change = callback; } };
  const video = {
    paused: true, autoplay: true, muted: false, loads: 0,
    addEventListener: (event, callback) => { events[event] = callback; },
    removeAttribute: key => { delete video[key]; },
    play() { this.paused = false; events.play?.(); return Promise.resolve(); },
    pause() { this.paused = true; events.pause?.(); },
    load() { this.loads++; },
  };
  const label = {};
  const button = { label, textContent: 'trace and label', querySelector: () => label, attrs: {}, setAttribute: (key, value) => { button.attrs[key] = value; }, addEventListener: (_, callback) => { clicks.click = callback; } };
  const doc = { hidden: false, addEventListener: (_, callback) => { lifecycle.visibility = callback; } };
  setupTrailer(video, button, { matchMedia: () => preference }, doc);
  return { video, button, doc, preference, click: () => clicks.click(), visibility: () => lifecycle.visibility() };
}

test('trailer autoplays muted, keeps button state, and preserves an explicit pause across visibility changes', () => {
  const run = playback();
  assert.equal(run.video.paused, false);
  assert.equal(run.video.muted, true);
  assert.equal(run.button.attrs['aria-pressed'], 'true');
  assert.equal(run.button.textContent, 'trace and label');
  assert.equal(run.button.label.textContent, 'Pause trailer');
  run.click();
  assert.equal(run.video.paused, true);
  assert.equal(run.button.attrs['aria-label'], 'Play trailer');
  assert.equal(run.button.label.textContent, 'Play trailer');
  run.doc.hidden = true; run.visibility();
  run.doc.hidden = false; run.visibility();
  assert.equal(run.video.paused, true);
  run.click();
  assert.equal(run.video.paused, false);
  assert.equal(run.button.attrs['aria-label'], 'Pause trailer');
});

test('reduced motion removes autoplay, restores the poster, and permits explicit playback', () => {
  const run = playback(true);
  assert.equal(run.video.paused, true);
  assert.equal(run.video.autoplay, undefined);
  assert.equal(run.video.loads, 1);
  assert.equal(run.button.attrs['aria-pressed'], 'false');
  run.click();
  assert.equal(run.video.paused, false);
  run.click();
  assert.equal(run.video.paused, true);
  run.preference.matches = false; run.preference.change();
  assert.equal(run.video.paused, true);
});

test('changing to reduced motion stops automatic playback and leaves the play control available', () => {
  const run = playback();
  run.preference.matches = true; run.preference.change();
  assert.equal(run.video.paused, true);
  assert.equal(run.video.loads, 1);
  assert.equal(run.button.attrs['aria-label'], 'Play trailer');
});

test('rejected autoplay leaves an operable play button', async () => {
  let click;
  const video = { paused: true, addEventListener() {}, play: () => Promise.reject(Error('Blocked')) };
  const button = { attrs: {}, setAttribute(key, value) { this.attrs[key] = value; }, addEventListener(_, callback) { click = callback; } };
  setupTrailer(video, button, { matchMedia: () => ({ matches: false, addEventListener() {} }) }, { hidden: false, addEventListener() {} });
  await Promise.resolve();
  assert.equal(button.attrs['aria-label'], 'Play trailer');
  assert.equal(typeof click, 'function');
});

test('all four flow stages change the caption and select exactly their own node', () => {
  const stages = ['frame', 'run', 'read', 'verify'];
  const buttons = stages.map(task => ({ dataset: { task, caption: `Caption for ${task}` }, attrs: {}, setAttribute(key, value) { this.attrs[key] = value; }, addEventListener(_, callback) { this.click = callback; } }));
  const nodes = stages.map(role => ({ dataset: { role }, classList: { toggle(_, selected) { this.selected = selected; } } }));
  const task = {};
  setupFlow({ querySelectorAll: selector => selector === '[data-task]' ? buttons : nodes, querySelector: () => task });
  for (const button of buttons) {
    button.click();
    assert.equal(buttons.filter(item => item.attrs['aria-pressed'] === 'true').length, 1);
    assert.equal(button.attrs['aria-pressed'], 'true');
    assert.equal(nodes.filter(item => item.classList.selected).length, 1);
    assert.ok(nodes.find(item => item.dataset.role === button.dataset.task).classList.selected);
    assert.equal(task.textContent, button.dataset.caption);
  }
});

test('reference navigation chooses the visible section and handles the bottom of the page', () => {
  const sections = [{ id: 'overview', top: -50 }, { id: 'trailer', top: 110 }, { id: 'proof', top: 500 }];
  assert.equal(currentSection(sections, 115, false), 'trailer');
  assert.equal(currentSection(sections, 115, true), 'proof');
});

test('copy feedback keeps the decorative SVG while changing and restoring its label', async () => {
  const label = { textContent: '⧉' };
  let click, restore, copied;
  const button = {
    dataset: { copy: 'install-command' }, textContent: 'trace and label',
    querySelector: selector => { assert.equal(selector, '[data-button-label]'); return label; },
    addEventListener: (_, callback) => { click = callback; },
  };
  const status = { dataset: { success: 'Copied', fallback: 'Copy manually' } };
  const doc = { querySelectorAll: () => [button], getElementById: id => id === 'copy-status' ? status : { textContent: 'npx lean-browser-use' } };
  setupCopy(doc, { writeText: async text => { copied = text; } }, callback => { restore = callback; });
  await click();
  assert.equal(copied, 'npx lean-browser-use');
  assert.equal(button.textContent, 'trace and label');
  assert.equal(label.textContent, '✓');
  assert.equal(status.textContent, 'Copied');
  restore();
  assert.equal(label.textContent, '⧉');
});
