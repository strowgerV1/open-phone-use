import { reduced } from './core.js';

export default function init(root) {
  const btn = root.querySelector('.nv-menu'), sheet = root.querySelector('.nv-sheet');
  const close = () => set(false);
  const set = open => {
    btn.setAttribute('aria-expanded', open); btn.setAttribute('aria-label', open ? 'Close menu' : 'Open menu'); sheet.hidden = !open;
    // a scroll closes the open sheet (listened for only while it is open)
    if (open) addEventListener('scroll', close, { passive: true }); else removeEventListener('scroll', close);
  };
  btn.addEventListener('click', () => set(sheet.hidden));
  sheet.addEventListener('click', e => { if (e.target.closest('a')) set(false); });
  addEventListener('keydown', e => { if (e.key === 'Escape' && !sheet.hidden) { set(false); btn.focus(); } });
  // close on a tap outside, on focus leaving the header (Tab past the last link), and on scroll
  document.addEventListener('pointerdown', e => { if (!sheet.hidden && !root.contains(e.target)) set(false); });
  root.addEventListener('focusout', e => { if (!sheet.hidden && !root.contains(e.relatedTarget)) set(false); });

  // glass once the page has scrolled past 24px: watched on a 24px strip at the top of the page, so no scroll
  // handler reads scrollY (a forced style and layout) on every scroll event
  const top = document.createElement('div');
  top.setAttribute('aria-hidden', 'true');
  top.style.cssText = 'position:absolute;top:0;left:0;width:1px;height:24px;visibility:hidden;pointer-events:none';
  document.body.append(top);
  new IntersectionObserver(([e]) => root.classList.toggle('is-scrolled', !e.isIntersecting)).observe(top);

  // dark glass while a dark surface (Build bento, closing end card) sits under the bar:
  // the observed strip is a thin band at bar height (~4–5% of the viewport)
  const under = new Set();
  const io = new IntersectionObserver(es => {
    es.forEach(e => e.isIntersecting ? under.add(e.target) : under.delete(e.target));
    root.classList.toggle('nv--on-dark', under.size > 0);
  }, { rootMargin: '-4% 0px -95% 0px' });
  document.querySelectorAll('[data-nav="dark"], #build .on-dark, #start.on-dark').forEach(el => io.observe(el));

  // theme toggle: light is the default; the choice is remembered
  const html = document.documentElement, tbtn = root.querySelector('.nv-theme');
  const meta = document.querySelector('meta[name="theme-color"]');
  const sync = () => {
    const dark = html.dataset.theme === 'dark';
    tbtn.setAttribute('aria-pressed', dark);
    if (meta) meta.content = dark ? '#0D0E10' : '#F2F1EC';
  };
  tbtn.addEventListener('click', () => {
    const next = html.dataset.theme === 'dark' ? 'light' : 'dark';
    const flip = () => { html.dataset.theme = next; };
    try { localStorage.setItem('pu-theme', next); } catch { /* private mode: still switches */ }
    // a view transition cross-fades two pictures of the page on the compositor: the page restyles once. The fallback
    // (.theme-anim) transitions every element, which freezes a slow phone for a second.
    if (reduced) flip();
    else if (document.startViewTransition) document.startViewTransition(flip);
    else { html.classList.add('theme-anim'); flip(); setTimeout(() => html.classList.remove('theme-anim'), 600); }
  });
  // any theme change (toggle, ?theme=, devtools) keeps aria-pressed and the browser chrome in step
  new MutationObserver(sync).observe(html, { attributes: true, attributeFilter: ['data-theme'] });
  sync();
}
