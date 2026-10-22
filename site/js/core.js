// Shared helpers for section modules. Keep this small.
export const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
export const sleep = ms => new Promise(r => setTimeout(r, ms));
export const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
export const lerp = (a, b, t) => a + (b - a) * t;
// map v from [a,b] to [0,1], clamped
export const range = (v, a, b) => clamp((v - a) / (b - a));
export const ease = t => 1 - Math.pow(1 - t, 3);
// phones, tablets and small CPUs: canvas loops draw at ~30 fps (the same test machine.js caps its loops with)
export const lowEnd = matchMedia('(pointer: coarse)').matches || (navigator.hardwareConcurrency || 8) <= 4;
// Resolves now while the tab is shown, otherwise once it is shown again. Timer loops await it so a background tab
// never keeps changing the page (rAF loops stop there by themselves).
export const whenVisible = () => document.hidden ? new Promise(r => {
  const f = () => { if (!document.hidden) { document.removeEventListener('visibilitychange', f); r(); } };
  document.addEventListener('visibilitychange', f);
}) : Promise.resolve();

// Call cb once (or every time with once:false) when el enters the viewport.
// cb receives true/false for enter/leave when once:false.
export function onVisible(el, cb, { once = true, threshold = 0.25, rootMargin = '0px' } = {}) {
  const io = new IntersectionObserver(entries => {
    for (const e of entries) {
      if (once) { if (e.isIntersecting) { io.disconnect(); cb(true); } }
      else cb(e.isIntersecting);
    }
  }, { threshold, rootMargin });
  io.observe(el);
  return () => io.disconnect();
}

// Scroll-linked progress for tall/pinned sections.
// cb(p) with p = 0 when el's top hits the viewport top, 1 when its bottom hits the viewport bottom.
// Only runs while el is near the viewport.
export function scrollProgress(el, cb) {
  let raf = 0, active = false, last = -1;
  const tick = () => {
    raf = 0;
    const r = el.getBoundingClientRect();
    const span = r.height - innerHeight;
    const p = span > 0 ? clamp(-r.top / span) : clamp(1 - r.bottom / (innerHeight + r.height));
    if (p !== last) { last = p; cb(p, r); }
  };
  const req = () => { if (active && !raf) raf = requestAnimationFrame(tick); };
  onVisible(el, v => { active = v; if (v) req(); }, { once: false, threshold: 0, rootMargin: '25% 0px' });
  addEventListener('scroll', req, { passive: true });
  addEventListener('resize', req);
  return () => { removeEventListener('scroll', req); removeEventListener('resize', req); };
}

// Type text into el character by character. Resolves when done.
export async function typeInto(el, text, { speed = 24, jitter = 18 } = {}) {
  if (reduced) { el.textContent = text; return; }
  el.textContent = '';
  for (const ch of text) {
    el.textContent += ch;
    await sleep(speed + Math.random() * jitter);
  }
}

// Copy text and flash a label on the button. Resolves true if the text reached the clipboard.
export async function copyText(text, btn, label = 'Copied') {
  let ok = true;
  try { await navigator.clipboard.writeText(text); } catch {
    // clipboard API blocked (permissions, insecure origin): fall back to the legacy copy command
    const prevFocus = document.activeElement;
    const ta = Object.assign(document.createElement('textarea'), { value: text, readOnly: true });
    ta.style.cssText = 'position:fixed;top:0;opacity:0;pointer-events:none';
    document.body.append(ta);
    ta.select();
    try { ok = document.execCommand('copy'); } catch { ok = false; }
    ta.remove();
    prevFocus?.focus?.({ preventScroll: true });
  }
  if (!btn) return ok;
  const t = btn.querySelector('[data-label]') || btn;
  clearTimeout(btn._copyT);
  btn._copyPrev ??= t.textContent;                       // a second click mid-flash must not save "Copied"
  if (!btn.style.minWidth) btn.style.minWidth = `${btn.offsetWidth}px`;  // hold the width while the label is short
  t.textContent = ok ? label : 'Copy failed';
  btn.classList.toggle('is-copied', ok);
  btn._copyT = setTimeout(() => {
    t.textContent = btn._copyPrev; btn._copyPrev = null;
    btn.classList.remove('is-copied'); btn.style.minWidth = '';
  }, 1600);
  return ok;
}

export function initReveal(root = document) {
  const els = root.querySelectorAll('[data-reveal]:not(.is-in)');
  if (reduced) { els.forEach(el => el.classList.add('is-in')); return; }
  const io = new IntersectionObserver(entries => {
    for (const e of entries) if (e.isIntersecting) { e.target.classList.add('is-in'); io.unobserve(e.target); }
  }, { threshold: 0.15, rootMargin: '0px 0px -6% 0px' });
  els.forEach(el => io.observe(el));
}

export const SETUP_PROMPT = `Installe le runtime STROWGER Environment Lease depuis https://github.com/strowgerV1/strowger-env . Suis le README, crée un environnement Python, installe les dépendances et Chromium, génère les clés locales avec scripts/init_env.py, puis démarre Uvicorn sur 127.0.0.1:8765. Lance examples/browser_demo.py. Cette version propose le SDK Python et une API HTTP ; aucun endpoint MCP STROWGER n’est encore disponible. Ne transmets aucune clé à un service tiers.`;
