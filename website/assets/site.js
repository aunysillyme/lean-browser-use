import { setupNavigation } from './navigation.js';
import { setupTrailer } from './trailer.js';

export function setupCopy(doc = document, clipboard = navigator.clipboard, later = setTimeout) {
  doc.querySelectorAll('[data-copy]').forEach(button => button.addEventListener('click', async () => {
    const command = doc.getElementById(button.dataset.copy);
    const status = doc.getElementById('copy-status');
    try {
      await clipboard.writeText(command.textContent);
      const label = button.querySelector?.('[data-button-label]') || button;
      label.textContent = '✓';
      status.textContent = status.dataset.success;
      later(() => { label.textContent = '⧉'; }, 1800);
    } catch {
      status.textContent = status.dataset.fallback;
    }
  }));
}

export function setupFlow(doc = document) {
  doc.querySelectorAll('[data-task]').forEach(button => button.addEventListener('click', () => {
    doc.querySelectorAll('[data-task]').forEach(other => other.setAttribute('aria-pressed', String(other === button)));
    doc.querySelectorAll('[data-role]').forEach(box => box.classList.toggle('selected', box.dataset.role === button.dataset.task));
    doc.querySelector('#task-text').textContent = button.dataset.caption;
  }));
}

if (typeof document !== 'undefined') {
  setupFlow();
  setupCopy();
  setupNavigation();
  setupTrailer(document.querySelector('#trailer video'), document.querySelector('.trailer-toggle'));
  document.querySelectorAll('.mobile-nav a').forEach(link => link.addEventListener('click', () => { link.closest('details').open = false; }));
}
