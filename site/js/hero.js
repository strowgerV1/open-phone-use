import { reduced, clamp } from './core.js';

// world points the craft labels stick to
const TAPE_AT = [-0.104, 0.062, 0.13]; // cradle, front-left of the phone (Figma: the tape overlaps its corner and the rail)
const NOTE_AT = [-0.02, 0.19, -0.052];   // overhead camera body

export default async function init(root) {
  requestAnimationFrame(() => root.classList.add('is-in'));
  const canvas = root.querySelector('.hr-canvas');
  const stage = root.querySelector('.hr-stage');
  const tape = root.querySelector('.hr-tape');
  const note = root.querySelector('.hr-note');
  const steps = [...root.querySelectorAll('.hr-steps li')];
  const task = root.querySelector('.hr-log-task [data-text]');
  const clock = root.querySelector('.hr-clock');
  const mobile = matchMedia('(max-width: 900px)');
  const caret = Object.assign(document.createElement('i'), { className: 'hr-caret' });
  const CPS = 46; // typing speed, characters per second of story time

  // the log types itself in step with the phone: lines appear as the robot completes each action
  const typed = (el, text, since) => {
    const n = reduced ? text.length : Math.max(0, Math.min(text.length, Math.floor(since * CPS)));
    const out = text.slice(0, n);
    if (el.firstChild?.nodeValue !== out) el.textContent = out;
    return n === text.length;
  };
  let lastT = -1;
  const updateLog = t => {
    if (reduced) t = 14;
    if (Math.abs(t - lastT) < 1 / 30 && t > lastT) return;
    lastT = t;
    let typing = typed(task, task.dataset.text, t) ? null : task;
    steps.forEach((li, i) => {
      const at = +li.dataset.at, next = steps[i + 1] ? +steps[i + 1].dataset.at : Infinity;
      const shown = t >= at;
      const done = shown && typed(li, li.dataset.text, t - at);
      if (!shown) li.textContent = '';
      li.classList.toggle('is-done', done && t >= Math.min(next, at + 2.2));
      li.classList.toggle('is-active', shown && !li.classList.contains('is-done'));
      if (shown && !done) typing = li;
    });
    // caret sits where text is being typed, else at the end of the latest line
    const host = typing || [...steps].reverse().find(li => li.textContent) || task;
    if (caret.parentNode !== host || host.lastChild !== caret) host.append(caret);
    clock.textContent = `00:${String(Math.floor(t)).padStart(2, '0')}.${Math.floor((t % 1) * 10)}`;
  };

  const place = (el, p, dx, dy) => { el.style.transform = `translate3d(${Math.round(p.x + dx)}px, ${Math.round(p.y + dy)}px, 0) rotate(var(--rot, 0deg))`; };
  let tapeW = 0; // measured on resize (and when its font lands), never inside a frame
  new ResizeObserver(() => { tapeW = tape.offsetWidth; }).observe(tape);

  let m;
  try {
    // three.js and the screen load behind the copy: the headline never waits for them, the poster holds the stage
    const [{ mountMachine }, { createScreen, STORY }] = await Promise.all([import('./machine.js'), import('./phone-screen.js')]);
    m = await mountMachine(canvas, {
      mode: 'hero',
      screen: createScreen(),
      onFrame: api => {
        const tp = api.project(TAPE_AT); // centred on its anchor, but never past the stage's left edge (phones)
        place(tape, tp, Math.max(8 - tapeW * 0.5, 12 - tp.x), 10);
        if (!mobile.matches) place(note, api.project(NOTE_AT), -30, -8);
        updateLog(api.time % STORY);
      },
    });
  } catch (err) {
    (err.name === 'Off3D' ? console.info : console.error)('[hero] 3D unavailable', err); // Off3D: a light device, by design
    root.classList.add('no-webgl', 'is-ready');
    updateLog(14);
    return;
  }
  root.classList.add('is-ready');
  // a lost context (memory pressure, app switch) shows the poster until the browser hands it back
  canvas.addEventListener('webglcontextlost', () => root.classList.add('no-webgl'));
  canvas.addEventListener('webglcontextrestored', () => { root.classList.remove('no-webgl'); m.render(); });

  // camera: dolly toward top-down as the hero scrolls away, plus a little pointer parallax.
  // framing per breakpoint lives in hero.css (--hr-zoom, --hr-shift-x, --hr-shift-y on .hr-stage), read with the hero's
  // height on resize only: a scroll frame reads no layout or style
  const base = m.base, css = getComputedStyle(stage), num = k => +css.getPropertyValue(k) || 0;
  let px = 0, py = 0, sp = 0, raf = 0, h = 0, zoom = 1, sx = 0, sy = 0;
  const apply = () => {
    raf = 0;
    m.view({
      theta: base.theta - 18 * sp + px * 5,
      phi: base.phi - 16 * sp + py * 2.5,
      radius: base.radius * (1 - 0.1 * sp) * zoom,
      shiftX: sx,
      shiftY: sy,
    });
  };
  const req = () => { if (!raf) raf = requestAnimationFrame(apply); };
  // (no height = the page is set aside, e.g. by inspect mode: scrollY / 0 would poison the camera with NaN)
  const onScroll = () => { if (!h) return; const k = clamp(scrollY / h); if (k !== sp) { sp = k; req(); } };
  const measure = () => { h = root.offsetHeight; zoom = num('--hr-zoom') || 1; sx = num('--hr-shift-x'); sy = num('--hr-shift-y'); onScroll(); };
  const refit = () => { measure(); req(); };
  new ResizeObserver(refit).observe(root);
  addEventListener('scroll', onScroll, { passive: true });
  if (!reduced && matchMedia('(pointer: fine)').matches) {
    root.addEventListener('pointermove', e => {
      const r = stage.getBoundingClientRect();
      px = clamp(((e.clientX - r.left) / r.width) * 2 - 1, -1, 1);
      py = clamp(((e.clientY - r.top) / r.height) * 2 - 1, -1, 1);
      req();
    });
    root.addEventListener('pointerleave', () => { px = py = 0; req(); });
  }
  addEventListener('resize', refit);
  measure();
  apply();
}
