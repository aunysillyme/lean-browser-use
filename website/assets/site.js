const status = document.getElementById('copy-status');

for (const button of document.querySelectorAll('[data-copy]')) {
  button.addEventListener('click', async () => {
    const code = document.getElementById(button.dataset.copy);
    if (!code) return;
    try {
      await navigator.clipboard.writeText(code.textContent);
      if (status) status.textContent = status.dataset.success;
    } catch {
      if (status) status.textContent = status.dataset.fallback;
    }
  });
}

const menu = document.querySelector('[data-menu-toggle]');
const sidebar = document.getElementById('site-sidebar');
if (menu && sidebar) {
  const closeMenu = () => {
    sidebar.classList.remove('is-open');
    menu.setAttribute('aria-expanded', 'false');
  };
  menu.addEventListener('click', () => {
    const open = sidebar.classList.toggle('is-open');
    menu.setAttribute('aria-expanded', String(open));
  });
  sidebar.addEventListener('click', event => {
    if (event.target.closest('a')) closeMenu();
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && sidebar.classList.contains('is-open')) {
      closeMenu();
      menu.focus();
    }
  });
}

const sectionLinks = [...document.querySelectorAll('.side-links a[href^="#"]')];
const sections = sectionLinks.map(link => document.getElementById(link.hash.slice(1))).filter(Boolean);
if (sections.length && 'IntersectionObserver' in window) {
  const visible = new Set();
  const observer = new IntersectionObserver(entries => {
    for (const entry of entries) {
      if (entry.isIntersecting) visible.add(entry.target);
      else visible.delete(entry.target);
    }
    const current = sections.find(section => visible.has(section));
    if (!current) return;
    for (const link of sectionLinks) {
      const active = link.hash === `#${current.id}`;
      link.classList.toggle('active', active);
      if (active) link.setAttribute('aria-current', 'location');
      else link.removeAttribute('aria-current');
    }
  }, { rootMargin: '-8% 0px -55% 0px' });
  for (const section of sections) observer.observe(section);
}
