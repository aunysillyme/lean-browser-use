export function currentSection(sections, threshold, atEnd) {
  if (atEnd) return sections.at(-1)?.id;
  let active = sections[0]?.id;
  for (const section of sections) {
    if (section.top <= threshold) active = section.id;
  }
  return active;
}

export function setupNavigation(doc = document, env = window) {
  const desktop = [...doc.querySelectorAll('.side-links a[href^="#"]')];
  const links = [...desktop, ...doc.querySelectorAll('.mobile-nav a[href^="#"]')];
  const sections = desktop.map(link => doc.getElementById(link.hash.slice(1))).filter(Boolean);
  if (!sections.length) return;
  let frame = null;
  function update() {
    frame = null;
    const root = doc.documentElement;
    const threshold = Math.max(
      parseFloat(env.getComputedStyle(root).scrollPaddingTop) || 0,
      doc.querySelector('.top')?.getBoundingClientRect().bottom || 0
    ) + 1;
    const atEnd = env.scrollY > 0 && env.scrollY + env.innerHeight >= root.scrollHeight - 2;
    const id = currentSection(sections.map(section => ({id:section.id, top:section.getBoundingClientRect().top})), threshold, atEnd);
    for (const link of links) {
      const active = link.hash === `#${id}`;
      link.classList.toggle('active', active);
      if (active) link.setAttribute('aria-current', 'location');
      else link.removeAttribute('aria-current');
    }
    const active = desktop.find(link => link.hash === `#${id}`);
    if (!active) return;
    const nav = active.parentElement;
    if (!nav.clientHeight || nav.scrollHeight <= nav.clientHeight) return;
    const box = active.getBoundingClientRect(), viewport = nav.getBoundingClientRect();
    if (box.top < viewport.top) nav.scrollTop += box.top - viewport.top;
    else if (box.bottom > viewport.bottom) nav.scrollTop += box.bottom - viewport.bottom;
  }
  function schedule() {
    if (frame === null) frame = env.requestAnimationFrame(update);
  }
  env.addEventListener('scroll', schedule, {passive:true});
  env.addEventListener('resize', schedule);
  env.addEventListener('hashchange', schedule);
  env.addEventListener('pageshow', schedule);
  if (env.ResizeObserver) {
    const observer = new env.ResizeObserver(schedule);
    observer.observe(doc.querySelector('main'));
    const header = doc.querySelector('.top');
    if (header) observer.observe(header);
  }
  update();
}
