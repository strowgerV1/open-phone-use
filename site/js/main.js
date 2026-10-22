// Each <section data-module="name"> loads ./name.js and calls its default export with the section element.
// nav and hero load at once; the rest when they come within a screen of the viewport (a slow phone isn't parsing and
// setting up sections far below while the hero loads). Jumps (#pricing, scrolled straight to the end) land in range too.
import { initReveal, copyText, SETUP_PROMPT } from './core.js';

const ready = new Map();   // element -> settles once its module has loaded and run its set-up
const run = el => {
  const mod = import(`./${el.dataset.module}.js`);
  mod.then(m => m.default?.(el)).catch(err => console.error(`[${el.dataset.module}]`, err));
  ready.set(el, mod.catch(() => {}));   // (settles after the line above has run the set-up)
};
const later = new Set();
const start = el => { if (later.delete(el)) { near.unobserve(el); run(el); } };
const near = new IntersectionObserver(es => { for (const e of es) if (e.isIntersecting) start(e.target); }, { rootMargin: '100% 0px' });
for (const el of document.querySelectorAll('[data-module]')) {
  if (el.dataset.module === 'nav' || el.dataset.module === 'hero') run(el);
  else { later.add(el); near.observe(el); }
}
initReveal();

// in-page links: every section above the target is set up at once, and if that moved the target (a section can grow as
// it's set up) while the smooth scroll was on its way, the scroll is aimed again, unless the visitor has taken it over
let jumps = 0;
document.addEventListener('click', e => {
  const a = e.target.closest('a[href^="#"]'), t = a?.hash && document.getElementById(a.hash.slice(1));
  if (!t) return;
  const n = ++jumps, at = () => t.getBoundingClientRect().top + scrollY, y = at();
  const above = [...document.querySelectorAll('[data-module]')].filter(el => el.compareDocumentPosition(t) & Node.DOCUMENT_POSITION_FOLLOWING);
  above.forEach(start);
  Promise.all(above.map(el => ready.get(el))).then(() => { if (n === jumps && Math.abs(at() - y) > 1) t.scrollIntoView(); });   // smooth, per the css
});
for (const type of ['wheel', 'touchstart', 'keydown']) addEventListener(type, () => jumps++, { passive: true });

// inspect mode is desktop only: phones, tablets and touch screens never download any of it (not even its CSS)
// (and it waits for the page to load and go idle, so its button's sprite never competes with the hero).
// It maps the whole page, so every section is set up first (closing.js moves the footer out of <main>)
if (matchMedia('(hover: hover) and (pointer: fine) and (min-width: 1024px)').matches) {
  const xray = () => { later.forEach(start); import('./xray.js').catch(err => console.error('[xray]', err)); };
  if (new URLSearchParams(location.search).has('inspect') || document.readyState === 'complete') xray();
  else addEventListener('load', () => (window.requestIdleCallback || setTimeout)(xray, { timeout: 2500 }), { once: true });
}

// park CSS loops in sections that are off screen (see .is-offscreen in base.css)
const offscreen = new IntersectionObserver(es => { for (const e of es) e.target.classList.toggle('is-offscreen', !e.isIntersecting); }, { rootMargin: '10% 0px' });
document.querySelectorAll('[data-module], footer').forEach(el => offscreen.observe(el));   // closing.js moves its footer out of the module

// any button with data-copy-setup copies the setup prompt
document.addEventListener('click', e => {
  const b = e.target.closest('[data-copy-setup]');
  if (b) copyText(SETUP_PROMPT, b);
});
