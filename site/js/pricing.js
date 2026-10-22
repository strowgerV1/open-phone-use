// 09 — Pricing: card spotlight, the cloud card's Unlimited / Per session toggle, and the cloud/real switch.
import { reduced, onVisible } from './core.js';

export default function init(root) {
  spotlight(root);
  billing(root.querySelector('.pr-plan--cloud'));
  toggle(root);
}

function spotlight(root) {
  if (reduced) return;
  for (const card of root.querySelectorAll('.pr-plan')) {
    card.addEventListener('pointermove', e => {
      const r = card.getBoundingClientRect();
      card.style.setProperty('--mx', `${e.clientX - r.left}px`);
      card.style.setProperty('--my', `${e.clientY - r.top}px`);
    });
  }
}

/* ---------- cloud card: Monthly (from $20/mo) <-> Per minute ($0.024/min); CSS swaps the price block ---------- */
function billing(card) {
  const btns = card.querySelectorAll('.pr-seg-btn');
  for (const b of btns) b.addEventListener('click', () => {
    card.dataset.mode = b.dataset.mode;
    for (const o of btns) o.setAttribute('aria-pressed', String(o === b));
  });
}

/* ---------- the switch: device="cloud" <-> device="real" (from the old Pick a phone section) ---------- */
function toggle(root) {
  const btn = root.querySelector('.pr-val');
  const reel = btn.querySelector('.pr-reel');
  // reel holds cloud,real,cloud,real,cloud; each flip rolls 3 slots forward, then snaps back to 0/1
  let p = 0, timer = 0, auto = !reduced;

  const kind = () => (p % 2 ? 'real' : 'cloud');
  const set = k => {
    if (k !== kind()) { p = (p % 2) + 3; reel.style.setProperty('--p', p); }
    root.dataset.on = k;
    btn.setAttribute('aria-checked', String(k === 'real'));
  };
  reel.addEventListener('transitionend', e => {
    if (e.target !== reel || p < 2) return;
    p %= 2;
    reel.classList.add('is-snap');
    reel.style.setProperty('--p', p);
    void reel.offsetWidth;
    reel.classList.remove('is-snap');
  });

  const stop = () => { auto = false; clearInterval(timer); root.classList.add('is-touched'); };
  const choose = k => { stop(); set(k); };
  btn.addEventListener('click', () => choose(kind() === 'cloud' ? 'real' : 'cloud'));
  btn.addEventListener('focus', stop); // a focused switch only changes when the person flips it
  // pointing at the cloud or the real card sets the switch to match
  for (const card of root.querySelectorAll('.pr-plan[data-kind]')) {
    card.addEventListener('pointerenter', e => { if (e.pointerType === 'mouse') choose(card.dataset.kind); });
    card.addEventListener('focusin', e => { if (!card.contains(e.relatedTarget)) choose(card.dataset.kind); });
  }

  onVisible(btn, v => {
    clearInterval(timer);
    if (!v || !auto) return;
    if (!root.dataset.on) set('cloud');
    timer = setInterval(() => set(kind() === 'cloud' ? 'real' : 'cloud'), 3000);
  }, { once: false, threshold: 1 });
}
