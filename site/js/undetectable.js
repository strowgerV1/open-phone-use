// 04 — Undetectable. Spec rows <-> 3D machine (events only), ticking timecode, app-side scan, PASS stamp.
import { reduced, onVisible, sleep } from './core.js';

const PARTS = {
  phone: ['01', 'Phone', 'A retail iPhone 15 Pro running real apps. No jailbreak, no helper app.'],
  tapper: ['02', 'Tapper', 'A capacitive tip taps and swipes the glass, exactly like a finger.'],
  camera: ['03', 'Camera', 'The overhead camera reads the screen so the agent sees what changed.'],
  cable: ['04', 'Cable', 'Keeps the phone charged so it’s ready for the next task.'],
};
const FPS = 25;
// frame count -> HH:MM:SS:FF
const timecode = f => [f / (FPS * 3600), f / (FPS * 60) % 60, f / FPS % 60, f % FPS]
  .map(n => String(Math.floor(n)).padStart(2, '0')).join(':');

export default function init(root) {
  const $ = s => root.querySelector(s);
  const targets = root.querySelectorAll('[data-part]'); // spec rows + legend chips
  const [tipK, tipName, tipText] = ['.ud-tip-k', '.ud-tip-name b', '.ud-tip-text'].map($);

  // Highlight state comes only from window events, so the 3D canvas and the rows share one path.
  let active = null;
  const show = e => {
    const part = PARTS[e.detail?.part] ? e.detail.part : null;
    if (part === active) return;
    active = part;
    root.classList.toggle('has-part', !!part);
    targets.forEach(el => el.classList.toggle('is-on', el.dataset.part === part));
    if (part) [tipK.textContent, tipName.textContent, tipText.textContent] = PARTS[part];
  };
  addEventListener('machine:hover', show);
  addEventListener('machine:focus', show);

  const focus = part => dispatchEvent(new CustomEvent('machine:focus', { detail: { part } }));
  targets.forEach(el => {
    const p = el.dataset.part;
    el.addEventListener('pointerenter', e => e.pointerType !== 'touch' && focus(p));
    el.addEventListener('pointerleave', e => e.pointerType !== 'touch' && focus(null));
    el.addEventListener('focus', () => focus(p));
    el.addEventListener('blur', () => focus(null));
    el.addEventListener('click', () => focus(p)); // touch has no hover, and iOS doesn't focus buttons on tap
  });

  // CAM 02 timecode at 25fps + the refresh sweep, only while the panel is on screen
  const tc = $('.ud-tc-time');
  let frame = ((14 * 60 + 32) * FPS) + 8, raf = 0; // 00:14:32:08
  if (!reduced) onVisible($('.ud-screen'), on => {
    cancelAnimationFrame(raf);
    root.classList.toggle('is-live', on);
    if (!on) return;
    const f0 = frame, t0 = performance.now();
    const tick = now => {
      const f = f0 + Math.floor((now - t0) * FPS / 1000);
      if (f !== frame) tc.textContent = timecode(frame = f);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
  }, { once: false, threshold: 0 });

  // App-side scan: each check resolves while a scan line crosses the feed, then the readout folds
  // into its verdict (a toggle to reopen it). Reduced motion: already clear, folded.
  const scan = $('.ud-scan'), checks = [...scan.querySelectorAll('li')], count = $('.ud-scan-n'), verdict = $('.ud-verdict');
  const STEP = 420; // ms per check; the scan line takes checks × STEP
  const fold = on => { scan.classList.toggle('is-folded', on); verdict.setAttribute('aria-expanded', !on); };
  verdict.addEventListener('click', () => { scan.classList.add('is-opened'); fold(!scan.classList.contains('is-folded')); });
  if (reduced) {
    checks.forEach(li => li.classList.add('is-ok'));
    count.textContent = `${checks.length}/${checks.length}`;
    root.classList.add('is-clear');
    fold(true);
  } else onVisible($('.ud-screen'), async () => {
    await sleep(500); // let the panel's reveal settle first
    root.style.setProperty('--ud-scan-t', `${checks.length * STEP}ms`);
    root.classList.add('is-scanning');
    for (const [i, li] of checks.entries()) {
      li.classList.add('is-run');
      await sleep(STEP);
      li.classList.replace('is-run', 'is-ok');
      count.textContent = `${i + 1}/${checks.length}`;
    }
    root.classList.replace('is-scanning', 'is-clear');
    await sleep(3200);
    if (!scan.classList.contains('is-opened')) fold(true); // the visitor took over: leave it as they set it
  }, { threshold: 0.5 });

  // PASS stamp lands after the rows have been ticked in
  onVisible($('.ud-sheet'), async () => {
    if (!reduced) await sleep(1150);
    $('.ud-stamp').classList.add('is-stamped');
  }, { threshold: 0.55 });
}
