export function setupTrailer(video, button, environment = window, documentRef = document) {
  if (!video || !button) return;
  const preference = environment.matchMedia('(prefers-reduced-motion: reduce)');
  let userPaused = false;
  let userStarted = false;
  const reflect = () => {
    const playing = !video.paused;
    button.setAttribute('aria-pressed', String(playing));
    button.setAttribute('aria-label', playing ? 'Pause trailer' : 'Play trailer');
    const label = button.querySelector?.('[data-button-label]') || button;
    label.textContent = playing ? 'Pause trailer' : 'Play trailer';
  };
  const play = () => {
    video.muted = true;
    video.play().catch(reflect);
  };
  const automatic = () => {
    video.autoplay = !preference.matches;
    if (preference.matches) {
      video.removeAttribute('autoplay');
      video.pause();
      if (!userStarted) video.load();
    } else if (!userPaused && !documentRef.hidden) play();
    reflect();
  };
  video.addEventListener('play', reflect);
  video.addEventListener('pause', reflect);
  video.addEventListener('error', reflect);
  button.addEventListener('click', () => {
    if (video.paused) { userPaused = false; userStarted = true; play(); }
    else { userPaused = true; video.pause(); }
  });
  documentRef.addEventListener('visibilitychange', () => {
    if (documentRef.hidden) video.pause();
    else if (!preference.matches && !userPaused) play();
  });
  preference.addEventListener('change', automatic);
  automatic();
}
