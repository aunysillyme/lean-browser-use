(() => {
  document.querySelectorAll('[data-projects-popup]').forEach((root) => {
    const trigger = root.querySelector('[data-projects-trigger]');
    const panel = root.querySelector('[data-projects-panel]');
    if (!trigger || !panel || !panel.id) return;
    let timer;
    let hoverOpened = false;
    let pinned = false;
    let pointerDownInside = false;
    const cancelClose = () => clearTimeout(timer);
    const setOpen = (open) => {
      cancelClose();
      panel.hidden = !open;
      if (!open) { hoverOpened = false; pinned = false; }
      trigger.setAttribute('aria-expanded', String(open));
    };
    trigger.setAttribute('aria-controls', panel.id);
    trigger.setAttribute('aria-expanded', 'false');
    trigger.setAttribute('role', 'button');
    root.addEventListener('pointerenter', (event) => {
      if (event.pointerType === 'mouse' && matchMedia('(hover: hover)').matches) {
        cancelClose();
        if (panel.hidden) {
          setOpen(true);
          hoverOpened = true;
        }
      }
    });
    root.addEventListener('pointerleave', (event) => {
      if (event.pointerType === 'mouse' && matchMedia('(hover: hover)').matches && !pinned) {
        cancelClose();
        timer = setTimeout(() => {
          if (!panel.contains(document.activeElement)) setOpen(false);
        }, 180);
      }
    });
    trigger.addEventListener('click', (event) => {
      event.preventDefault();
      if (event.detail > 0 && hoverOpened && !pinned && !panel.hidden) {
        pinned = true;
        cancelClose();
      } else {
        const open = panel.hidden;
        setOpen(open);
        if (open) pinned = true;
      }
    });
    trigger.addEventListener('keydown', (event) => {
      if (event.key === ' ') {
        event.preventDefault();
        setOpen(panel.hidden);
      } else if (event.key === 'ArrowDown') {
        event.preventDefault();
        setOpen(true);
        panel.querySelector('a')?.focus();
      }
    });
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && !panel.hidden) {
        event.preventDefault();
        setOpen(false);
        trigger.focus();
      }
    });
    root.addEventListener('focusout', (event) => {
      if (!root.contains(event.relatedTarget) && !(event.relatedTarget === null && pointerDownInside)) setOpen(false);
    });
    document.addEventListener('pointerdown', (event) => {
      pointerDownInside = root.contains(event.target);
      if (!pointerDownInside) setOpen(false);
    });
    document.addEventListener('pointerup', () => { pointerDownInside = false; });
    document.addEventListener('pointercancel', () => { pointerDownInside = false; });
  });
})();
