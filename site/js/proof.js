// 08 · Proof — three real recordings.
// Each card is a <video> behind our own chrome: the poster shows until play, nothing downloads before that
// (preload="none"). One plays at a time; a card scrolled out of view pauses; an ended card goes back to its poster.
const fmt = s => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

function player(el) {
  const v = el.querySelector('.pf-video'), btn = el.querySelector('.pf-play'), tc = el.querySelector('.pf-tc');
  const title = el.closest('figure').querySelector('.pf-title').textContent;
  const total = () => (Number.isFinite(v.duration) ? v.duration : 0);
  const label = () => btn.setAttribute('aria-label', `${v.paused ? 'Play' : 'Pause'} recording: ${title}`);
  const time = () => {
    if (total()) tc.textContent = `${fmt(v.currentTime)} / ${fmt(total())}`;
    el.style.setProperty('--p', total() ? v.currentTime / total() : 0);
  };
  const buffered = () => {
    const b = v.buffered;
    el.style.setProperty('--b', b.length && total() ? b.end(b.length - 1) / total() : 0);
  };

  v.addEventListener('play', () => { el.classList.add('is-playing'); label(); });
  v.addEventListener('pause', () => { el.classList.remove('is-playing'); label(); });
  v.addEventListener('timeupdate', time);
  v.addEventListener('loadedmetadata', time);
  v.addEventListener('progress', buffered);
  // back to the poster: reloading an unbuffered source is what brings it back, a seek to 0 would show frame one
  v.addEventListener('ended', () => { v.load(); el.style.setProperty('--p', 0); time(); });
  v.addEventListener('error', () => el.classList.add('is-broken'));

  return {
    el, btn, v,
    toggle() { if (v.paused) v.play().catch(() => {}); else v.pause(); },
    pause() { if (!v.paused) v.pause(); },
  };
}

export default function init(root) {
  const ps = [...root.querySelectorAll('.pf-player')].map(player);

  for (const p of ps) {
    p.btn.addEventListener('click', () => {
      ps.forEach(q => q !== p && q.pause());
      p.toggle();
    });
  }

  // a recording that leaves the screen stops, so sound never plays from somewhere the visitor cannot see
  const io = new IntersectionObserver(entries => {
    for (const e of entries) if (!e.isIntersecting) ps.find(q => q.el === e.target)?.pause();
  }, { threshold: 0 });
  ps.forEach(p => io.observe(p.el));
}
