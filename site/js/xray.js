// Inspect mode: a scan line turns the page into its own x-ray, then the page detaches as a screen hanging in the
// STROWGER rack room behind it (js/xray-scene.js, fetched only when asked for; warmed when the button is hovered).
// Desktop only (js/main.js doesn't import this on touch screens), and this module brings its own CSS.
// In: the "see rack" button (bottom right), docked DevTools opening (best effort), ?inspect in the URL, or the I key.
// Out: the same button, Esc or I. ?inspect=hold stops at the hand-off frame (for lining the screens up with the page).
import { reduced, clamp } from './core.js';

const doc = document.documentElement;
const CHIP_IN = 'See the rack behind the page (inspect mode)', CHIP_OUT = 'Exit inspect mode';
let state = 'off', world = null, ui = null, page = [], y0 = 0, back = null, wantOut = false;

const css = Object.assign(document.createElement('link'), { rel: 'stylesheet', href: new URL('../assets/xray/xray.css', import.meta.url).href });
await new Promise(res => { css.onload = css.onerror = res; document.head.append(css); });

// the button: the machine on a turntable (36 rendered frames: assets/model/machine-turn-light.* on the light page,
// machine-turn.* on dark and in the mode) over a handwritten "See rack". It turns right to left as the page scrolls
// down (and as you fly, inside the mode), and leans toward the cursor when it comes close
const chip = document.createElement('button');
chip.className = 'xr-chip';
chip.type = 'button';
chip.setAttribute('aria-label', CHIP_IN);
chip.innerHTML = '<i class="xr-rack" aria-hidden="true"></i><span class="xr-chip__t hand">See rack</span><kbd>esc</kbd>';
document.body.append(chip);
chip.addEventListener('click', toggle);
const warm = () => import('./xray-scene.js').then(m => m.prefetch()).catch(() => {});
chip.addEventListener('pointerenter', warm, { once: true });
chip.addEventListener('focus', warm, { once: true });

const FRAMES = 36, PX_PER_TURN = 1600, rack = chip.querySelector('.xr-rack');
let spin = 4, spinTo = 4, spinRaf = 0, lastY = scrollY;
const showFrame = () => rack.style.setProperty('--f', ((Math.round(spin) % FRAMES) + FRAMES) % FRAMES);
const spinStep = () => {
  spin += (spinTo - spin) * 0.18;
  if (Math.abs(spinTo - spin) < 0.05) { spin = spinTo; spinRaf = 0; } else spinRaf = requestAnimationFrame(spinStep);
  showFrame();
};
const turn = by => { if (reduced) return; spinTo -= by; /* frames run left to right: down the page turns it right to left */ if (!spinRaf) spinRaf = requestAnimationFrame(spinStep); };
showFrame();
addEventListener('scroll', () => { turn((scrollY - lastY) / PX_PER_TURN * FRAMES); lastY = scrollY; }, { passive: true });
addEventListener('wheel', e => { if (state === 'on') turn(e.deltaY / PX_PER_TURN * FRAMES); }, { passive: true });
if (!reduced) {   // magnetic: within ~120 px the button eases a few px toward the cursor, and springs back
  let home = null, was = false;
  const measure = () => { const b = chip.getBoundingClientRect(), m = chip.style; home = { x: b.left + b.width / 2 - (parseFloat(m.getPropertyValue('--mx')) || 0), y: b.top + b.height / 2 - (parseFloat(m.getPropertyValue('--my')) || 0), r: Math.max(b.width, b.height) / 2 }; };
  addEventListener('resize', () => { home = null; });
  addEventListener('pointermove', e => {
    if (e.pointerType !== 'mouse') return;
    home ??= (measure(), home);
    const dx = e.clientX - home.x, dy = e.clientY - home.y, d = Math.hypot(dx, dy), near = d < home.r + 120;
    if (!near && !was) return;   // far off and already at rest: nothing to write (most moves on the page)
    was = near;
    chip.style.setProperty('--mx', near ? `${clamp(dx * 0.16, -9, 9).toFixed(1)}px` : '0px');
    chip.style.setProperty('--my', near ? `${clamp(dy * 0.16, -7, 7).toFixed(1)}px` : '0px');
    chip.classList.toggle('is-near', near);
  }, { passive: true });
  doc.addEventListener('pointerleave', () => { was = false; chip.style.setProperty('--mx', '0px'); chip.style.setProperty('--my', '0px'); chip.classList.remove('is-near'); });
}

function setChip(on) {
  chip.classList.toggle('is-on', on);
  chip.querySelector('.xr-chip__t').textContent = on ? 'exit' : 'See rack';
  chip.setAttribute('aria-label', on ? CHIP_OUT : CHIP_IN);
  if (on) { chip.setAttribute('aria-keyshortcuts', 'Escape'); chip.setAttribute('aria-describedby', 'xr-hint'); }
  else { chip.removeAttribute('aria-keyshortcuts'); chip.removeAttribute('aria-describedby'); }
}

function toggle() {
  if (state === 'opening') wantOut = true;
  else if (state === 'on') close();
  else if (state === 'off') open();
}

// The mode's view transitions: the outgoing picture stays on top (css: html.xr-vt) for ms. ready(vt) starts what
// moves it (vt: false without view transitions: the update just happens); frame(k, now), if given, runs every frame.
async function transition(update, ms, { ready, frame } = {}) {
  const play = () => new Promise(done => {
    if (!frame) { setTimeout(done, ms); return; }
    const t0 = performance.now(), step = now => { const k = clamp((now - t0) / ms); frame(k, now); if (k < 1) requestAnimationFrame(step); else done(); };
    requestAnimationFrame(step);
  });
  if (!document.startViewTransition) { await update(); ready?.(false); await play(); return; }
  doc.style.setProperty('--xr-t', `${ms}ms`);
  doc.classList.add('xr-vt');
  const vt = document.startViewTransition(update);
  try { await vt.ready; ready?.(true); await play(); }
  catch (err) { if (err?.name !== 'AbortError' && err?.name !== 'TimeoutError') console.error('[xray]', err); }   // timeout: a slow machine took > 4 s to draw the new state, so the browser skipped the animation (the update still applied)
  await vt.finished.catch(() => {});
  doc.classList.remove('xr-vt');
  for (const p of ['--xr-t', '--xr-m', '--xr-o']) doc.style.removeProperty(p);
}
// the scan line crosses the screen and the old look is clipped away behind it (down: in, up: out). The line is its
// own view-transition group (css: above the old picture) and both pseudos start in the same task, so they share a
// start time; nothing restyles the page per frame
const scan = (up, ms) => vt => {
  const opt = { duration: ms, easing: 'cubic-bezier(.65, 0, .35, 1)' }, pseudo = n => ({ ...opt, fill: 'forwards', pseudoElement: `::view-transition-${n}` });   // forwards: the old picture can't pop back for the transition's last frame
  if (reduced) { if (vt) doc.animate({ opacity: [1, 0] }, pseudo('old(root)')); return; }
  const H = innerHeight, lh = ui.scan.offsetHeight, ys = up ? [H, 0] : [-lh, H - lh];
  if (!vt) { ui.scan.animate({ translate: ys.map(y => `0 ${y}px`) }, opt); return; }
  doc.animate({ clipPath: ['inset(0 0 0 0)', up ? 'inset(0 0 100% 0)' : 'inset(100% 0 0 0)'] }, pseudo('old(root)'));
  doc.animate({ transform: ys.map(y => `translate(0, ${y}px)`) }, pseudo('group(xr-scan)'));
};

function mountUi() {
  const root = Object.assign(document.createElement('div'), { className: 'xr' });
  root.innerHTML = `<canvas class="xr-canvas" aria-hidden="true"></canvas><i class="xr-scan" aria-hidden="true"></i>
    <div class="xr-hud" aria-hidden="true">
      <p class="xr-rec"><span class="dot dot--live"></span>INSPECT<span class="xr-sm"> · RACK SF-2</span> · <span class="xr-tc">00:14:32:08</span></p>
      <p class="xr-cam"><span>CAM 02</span><b></b><i></i></p>
      <p class="xr-hint" id="xr-hint">${reduced ? '↑ ↓ next screen' : 'scroll to fly'} · edges to look · hover a robot · esc to exit</p>
    </div>`;
  document.body.append(root);
  return { root, canvas: root.querySelector('canvas'), scan: root.querySelector('.xr-scan'), hud: root.querySelector('.xr-hud') };
}

async function open() {
  state = 'opening'; wantOut = false;
  y0 = scrollY; back = document.activeElement;
  const scene = import('./xray-scene.js');   // fetches while the page x-rays
  ui = mountUi();
  page = [...document.body.children].filter(el => el !== ui.root && el !== chip && !el.inert && el.tagName !== 'SCRIPT');
  for (const el of page) el.inert = true;
  const ms = reduced ? 300 : 900;
  doc.classList.add('xr-vt-scan');
  await transition(() => { doc.classList.add('xr-xray'); ui.root.classList.add('is-hud'); setChip(true); }, ms, { ready: scan(false, ms) });
  doc.classList.remove('xr-vt-scan');
  chip.focus({ preventScroll: true });
  try {
    const m = await scene;
    m.prefetch();
    world = await m.open({ canvas: ui.canvas, hud: ui.hud, y0, transition });
    await world.enter({ hold: new URLSearchParams(location.search).get('inspect') === 'hold' });
  } catch (err) {   // a software renderer opts out quietly (tier() in xray-scene.js)
    if (!err?.quiet) console.error('[xray] the rack room is unavailable, staying in the x-ray', err);
    world?.dispose(); world = null;
    ui.hud.querySelector('.xr-hint').textContent = 'esc to exit';
  }
  state = 'on';
  if (wantOut) close();
}

async function close() {
  state = 'closing';
  let y = y0;
  try { if (world) y = await world.leave(); } catch (err) { console.error('[xray]', err); }
  doc.classList.add('xr-vt-scan');
  await transition(() => {
    world?.stop();
    doc.classList.remove('xr-3d', 'xr-xray', 'xr-vt-hand');
    ui.root.classList.remove('is-hud');
    ui.scan.classList.add('is-up');
    setChip(false);
    for (const el of page) el.inert = false;
    scrollTo({ top: y, behavior: 'instant' });
  }, reduced ? 300 : 850, { ready: scan(true, reduced ? 300 : 850) });
  doc.classList.remove('xr-vt-scan');
  world?.dispose(); world = null;
  ui.root.remove(); ui = null;
  if (back && back !== chip && back !== document.body) back.focus?.({ preventScroll: true });
  state = 'off';
}

addEventListener('keydown', e => {
  if (e.metaKey || e.ctrlKey || e.altKey || e.repeat || e.isComposing) return;
  const t = e.target;
  if (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) return;
  if (e.key === 'i' || e.key === 'I' || (e.key === 'Escape' && state !== 'off')) toggle();
});

if (new URLSearchParams(location.search).has('inspect')) {
  if (document.readyState === 'complete') open(); else addEventListener('load', () => setTimeout(open, 300), { once: true });
}

console.log('%c phoneuse %c you found the wires. Press I (or "see rack") to see the rack behind the page.',
  'background:#FF4F14;color:#fff;border-radius:3px;font:600 11px ui-monospace,monospace', 'font:11px ui-monospace,monospace');

// Docked DevTools take their room from the page, not the window: the inner size drops while the outer size and the
// zoom stay put. Baseline 1 s after load; a window resize, fullscreen or zoom just moves the baseline. Re-arms once
// the page gets its room back. (Undocked DevTools can't be seen; Chrome's side panel looks the same as a side dock.)
{
  const DOCK_W = 160, DOCK_H = 120;   // px a dock must take; browser bars (bookmarks, find, infobars) take < 60
  const size = () => ({ iw: innerWidth, ih: innerHeight, ow: outerWidth, oh: outerHeight, dpr: devicePixelRatio });
  let base = null, armed = true, settle = 0;
  setTimeout(() => { base = size(); }, 1000);
  addEventListener('resize', () => {   // judged once the sizes settle (window animations can report outer late)
    clearTimeout(settle);
    settle = setTimeout(() => {
      if (!base) return;
      const now = size();
      if (Math.abs(now.ow - base.ow) > 2 || Math.abs(now.oh - base.oh) > 2 || now.dpr !== base.dpr) { base = now; armed = true; return; }
      const docked = base.iw - now.iw > DOCK_W || base.ih - now.ih > DOCK_H;
      if (docked && armed && state === 'off') toggle();
      armed = !docked;
      base.iw = Math.max(base.iw, now.iw); base.ih = Math.max(base.ih, now.ih);   // loaded with DevTools open: the room it gives back counts
    }, 250);
  });
}
