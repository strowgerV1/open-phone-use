// 02 — "So we gave agents a phone." A night panel: the rack wall, the title and the iPhone alone, head-on.
// Scrolling into step 1 grows it to full bleed, the rack wall fades, the machine assembles around the phone
// (a dark ghost) while the camera flies in, and scroll walks through three steps shown on its screen.
// Phones get the same pinned choreography, stacked: the iPhone up top, the active step below it.
import { reduced, clamp, lerp, range, ease, scrollProgress, onVisible, sleep } from './core.js';
import { mountMachine } from './machine.js';
import { rackWall } from './closing.js';
import { createTurnScreen } from './turn-screen.js';

// the intro: straight down onto the screen (head-on, upright, no tilt), centred, its top 46% down the panel and
// cropped by the panel's bottom edge — 377px wide in a 900px-tall panel. Target = the middle of the display.
// Tuned on a canvas as tall as the panel; aim() keeps those proportions of the panel, whatever its height.
// top = where that puts the phone's top edge (fraction of the panel), so short screens can push it below the title.
const HEAD = { theta: 0, phi: 0.01, radius: 0.474, roll: 0, target: [-0.0369, 0.0658, 0], shiftX: 0, shiftY: 0.393, top: 0.464 };
const CLOSE = { theta: -10, phi: 48, radius: 0.52, roll: 40, target: [-0.037, 0.066, 0.01], shiftX: 0.22, shiftY: 0 };
// portrait (≤900px wide): a smaller phone under the title, then the iPhone fills the top half above the steps
const M_HEAD = { theta: 0, phi: 0.01, radius: 0.65, roll: 0, target: [-0.0369, 0.0658, 0], shiftX: 0, shiftY: 0.255, top: 0.44 };
const M_CLOSE = { theta: -10, phi: 50, radius: 0.98, roll: 28, target: [-0.037, 0.066, 0.01], shiftX: 0, shiftY: -0.2 };
const DRIFT = [{ theta: 0, roll: 0, radius: 0 }, { theta: -6, roll: 3, radius: -0.02 }, { theta: 5, roll: -2, radius: -0.035 }];
const STEPS_AT = [0.26, 0.5, 0.74]; // progress where each step starts
const STEPS_IN = 0.18; // the step list starts to show; before this the title has the stage

const mix = (a, b, k) => ({
  theta: lerp(a.theta, b.theta, k), phi: lerp(a.phi, b.phi, k), radius: lerp(a.radius, b.radius, k), roll: lerp(a.roll, b.roll, k),
  shiftX: lerp(a.shiftX, b.shiftX, k), shiftY: lerp(a.shiftY, b.shiftY, k), target: a.target.map((v, i) => lerp(v, b.target[i], k)),
});

export default async function init(root) {
  const $ = s => root.querySelector(s), $$ = s => [...root.querySelectorAll(s)];
  const stage = $('.tn-stage'), track = $('.tn-track'), sticky = $('.tn-sticky'), rack = $('.tn-rack'), intro = $('.tn-intro');
  const steps = $$('.tn-step'), heads = $$('.tn-step-head'), agents = $$('.tn-agents li');
  const typed = $('.tn-typed'), prompt = $('.tn-prompt'), logItems = $$('.tn-log li'), receipt = $('.tn-receipt');
  const railN = $('.tn-rail-n'), bars = $$('.tn-rail-bars b');
  const agentName = $('.tn-agent-name');
  const narrow = matchMedia('(max-width: 900px) and (orientation: portrait)'); // landscape phones keep the side-by-side stage
  const screen = createTurnScreen();
  const TASK = typed.textContent;

  // the screen runs on the machine's clock. Under reduced motion that clock stands still, so each step
  // skews it forward to force a redraw and lands on the step's most informative frame (4 s in).
  let m = null, flatT = 0, skew = 0;
  if (reduced) { const draw = screen.draw; screen.draw = (t, touch) => draw(t + skew, touch); }
  const clock = () => (m ? m.time : flatT) + skew;

  let P = 0, near = false; // pin progress (current while the track is near the screen)
  // the intro panel is exactly as tall as the ending panel above the footer (css --tn-panel); without one, a screen
  const end = document.querySelector('.cl-end');
  let panel = 0, geo = null, fitted = 0;
  const fit = () => {
    const was = P; // read before this relayout moves anything
    if (end && end.offsetHeight !== panel) root.style.setProperty('--tn-panel', (panel = end.offsetHeight) + 'px');
    geo = null;
    // a new track length (the phone turned, the window resized) keeps the visitor on the step they were reading
    if (fitted !== (fitted = span()) && near && was > 0 && was < 1) scrollTo({ top: pinTop() + was * fitted, behavior: 'instant' });
    aim(); update();
  };
  // the panel in canvas px (the canvas is the screen at the stage's foot), and the lowest the title reaches
  // (fraction of the panel, + a gap): on short screens the phone starts below it
  const measure = () => {
    const S = sticky.offsetHeight, V = $('.tn-canvas').clientHeight, H = panel || S, pad = (S - H) / 2;
    return { V, H, top: pad - (S - V), clear: (intro.offsetTop - pad + intro.offsetHeight + 32) / H };
  };
  const aim = (snap = false) => {
    if (!m) return;
    const { V, H, top, clear } = geo ??= measure();
    const [h, b] = narrow.matches ? [M_HEAD, M_CLOSE] : [HEAD, CLOSE];
    // same place and size in the panel at any height: the radius scales the phone, a film offset moves it (never tilts it)
    const y = top + (0.5 + h.shiftY + Math.max(0, clear - h.top)) * H;
    const a = { ...h, radius: h.radius * V / H, shiftY: y / V - 0.5 };
    // the machine: nowhere in the intro, then part by part around the phone (the clip only runs once it's there)
    const f = reduced ? +(P >= 0.15) : range(P, 0.08, 0.24);
    m.setFrame(f);
    m.setAnimate(f > 0);
    if (reduced) return m.view(f ? b : a, snap); // easeRate below makes this a cut, not a flight
    const v = mix(a, b, ease(range(P, 0.06, 0.28)));
    const d = DRIFT[Math.max(current, 0)], k = range(P, 0.2, 0.3);
    m.view({ ...v, theta: v.theta + d.theta * k, roll: v.roll + d.roll * k, radius: v.radius + d.radius * k }, snap);
  };

  rackWall(rack, stage, { horizon: 0.49 });
  mountMachine($('.tn-canvas'), { mode: 'ghost', night: true, fadeFrame: true, screen, startAt: 2.4, easeRate: reduced ? 120 : 7 })
    .then(api => { m = api; root.classList.add('is-ready'); aim(true); })
    .catch(err => { // no WebGL: the display alone, flat in a bezel, still walking the steps
      console.warn('[turn] 3D unavailable', err);
      screen.canvas.className = 'tn-flat';
      screen.canvas.setAttribute('role', 'img');
      screen.canvas.setAttribute('aria-label', $('.tn-canvas').getAttribute('aria-label'));
      $('.tn-canvas').replaceWith(screen.canvas);
      root.classList.add('no-webgl');
      const idle = { u: 0.5, v: 0.5, down: false };
      let raf = 0;
      const tick = now => { flatT = reduced ? 0 : now / 1000; screen.draw(flatT, idle); raf = requestAnimationFrame(tick); };
      onVisible(stage, on => { cancelAnimationFrame(raf); if (on) raf = requestAnimationFrame(tick); }, { once: false, threshold: 0 });
    });

  // ---- step content ----
  let current = null, run = 0;
  const pick = name => {
    agents.forEach(li => li.classList.toggle('is-picked', li.dataset.agent === name));
    const label = name === 'Python' ? 'your code' : name;
    agentName.textContent = label.toLowerCase();
    screen.setAgent(label === 'your code' ? 'Your agent' : label);
  };
  pick('Claude');

  async function play(i) {
    const id = ++run;
    const alive = () => id === run;
    if (i === 0) {
      const names = agents.map(li => li.dataset.agent);
      for (let k = 0; alive() && !reduced; k++) { pick(names[k % names.length]); await sleep(k === 0 ? 1600 : 1100); if (k === names.length) { pick('Claude'); break; } }
    }
    if (i === 1) {
      prompt.classList.remove('is-sent');
      if (reduced) { typed.textContent = TASK; prompt.classList.add('is-sent'); return; }
      typed.textContent = '';
      for (const ch of TASK) { if (!alive()) return; typed.textContent += ch; await sleep(22 + Math.random() * 22); }
      await sleep(250); if (alive()) prompt.classList.add('is-sent');
    }
    if (i === 2) {
      logItems.forEach(li => li.classList.remove('is-done')); receipt.classList.remove('is-in');
      for (const li of logItems) { if (!alive()) return; await sleep(reduced ? 0 : 650); li.classList.add('is-done'); }
      await sleep(reduced ? 0 : 400); if (alive()) receipt.classList.add('is-in');
    }
  }

  // i = -1 while the title has the stage: no step yet, the iPhone shows the result (the posted story)
  // until step 1 starts over from the lock screen with "Claude connected".
  function setStep(i) {
    if (i === current) return;
    current = i;
    steps.forEach((s, k) => {
      s.classList.toggle('is-active', k === i);
      s.classList.toggle('is-done', k < i);
      if (k === i) heads[k].setAttribute('aria-current', 'step'); else heads[k].removeAttribute('aria-current');
    });
    if (i !== 0) pick('Claude'); // an interrupted agent shuffle still hands the task to Claude
    if (i > 1) prompt.classList.add('is-sent'), typed.textContent = TASK;
    railN.textContent = Math.max(i, 0) + 1;
    if (reduced) skew += 10;
    screen.setStep(i, clock() - (reduced ? 4 : 0));
    play(i);
  }
  setStep(-1);

  // ---- scroll choreography ----
  // progress runs only while the stage is pinned (from the panel's foot meeting the screen's), not while it scrolls in
  const span = () => track.offsetHeight - sticky.offsetHeight;
  const pinTop = () => track.getBoundingClientRect().top + scrollY - parseFloat(getComputedStyle(sticky).top); // where it pins
  function update() {
    const p = P = clamp((sticky.getBoundingClientRect().top - track.getBoundingClientRect().top) / span());
    // the intro panel grows to full bleed, then shrinks back into the same panel over the last 60vh (reduced: one cut, in)
    const out = p > 0.5, k = reduced ? +(p > 0.06) : out ? ease(range(1 - p, 0, 0.6 * innerHeight / span())) : ease(range(p, 0.02, 0.11));
    root.style.setProperty('--tn-k', k.toFixed(4));
    root.classList.toggle('tn-bleed', k === 1);
    root.style.setProperty('--tn-intro', (1 - range(p, 0.04, 0.12)).toFixed(3));
    // the rack wall fades with the title; once gone it's hidden, which also parks its loop: a still backdrop for the steps
    const r = 1 - range(p, 0.05, 0.15);
    root.style.setProperty('--tn-rack', r.toFixed(3));
    if (rack.hidden !== (r === 0)) rack.hidden = r === 0;
    root.style.setProperty('--tn-steps', range(p, STEPS_IN, 0.28).toFixed(3));
    root.classList.toggle('tn-steps-off', p < STEPS_IN);
    bars.forEach((b, k) => b.style.setProperty('--f', clamp((p - STEPS_AT[k]) / ((STEPS_AT[k + 1] ?? 1) - STEPS_AT[k])).toFixed(3)));
    setStep(p < STEPS_IN ? -1 : p >= STEPS_AT[2] ? 2 : p >= STEPS_AT[1] ? 1 : 0);
    aim();
  }
  scrollProgress(track, update);
  onVisible(track, v => { near = v; }, { once: false, threshold: 0 });
  if (end) new ResizeObserver(fit).observe(end, { box: 'border-box' });
  addEventListener('resize', fit);

  // step heads jump to their part of the scroll — on click, and on keyboard focus so focus never lands on a hidden step
  const goTo = k => scrollTo({ top: pinTop() + (STEPS_AT[k] + 0.04) * span(), behavior: reduced ? 'auto' : 'smooth' });
  heads.forEach((head, k) => {
    head.addEventListener('click', () => goTo(k));
    head.addEventListener('focus', () => { if (head.matches(':focus-visible') && current !== k) goTo(k); });
  });
  narrow.addEventListener('change', () => aim());
}
