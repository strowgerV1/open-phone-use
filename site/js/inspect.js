// The inspectable machine in "Undetectable". Hover a part → window 'machine:hover' {part}.
// Spec rows send window 'machine:focus' {part} → the part lights up here.
import { reduced, clamp, onVisible } from './core.js';
import { mountMachine } from './machine.js';
import { createScreen } from './phone-screen.js';

export default async function init(canvas) {
  let m;
  await new Promise(r => onVisible(canvas, r, { threshold: 0, rootMargin: '100% 0px' })); // its screen canvases only once it's near
  try { m = await mountMachine(canvas, { mode: 'inspect', screen: createScreen(), startAt: 6.2 }); }
  catch (err) { (err.name === 'Off3D' ? console.info : console.error)('[inspect] 3D unavailable', err); canvas.closest('.ud-panel')?.classList.add('no-webgl'); return; }
  canvas.classList.add('is-ready');

  let hover = null, pinned = null, drag = null, yaw = 0, scrollYaw = 0;
  const emit = part => dispatchEvent(new CustomEvent('machine:hover', { detail: { part } }));
  const setHover = part => {
    if (part === hover) return;
    hover = part;
    m.focus(pinned || hover);
    canvas.style.cursor = part ? 'pointer' : drag ? 'grabbing' : 'grab';
    emit(pinned || hover);
  };
  const narrow = matchMedia('(max-width: 640px)');
  const view = () => m.view({ theta: m.base.theta + yaw + scrollYaw, radius: m.base.radius * (narrow.matches ? 1.16 : 1), shiftY: narrow.matches ? -0.07 : 0 });
  narrow.addEventListener('change', view);
  view();

  canvas.style.cursor = 'grab';
  canvas.addEventListener('pointerdown', e => { drag = { x: e.clientX, yaw, moved: false }; });
  addEventListener('pointerup', e => {
    if (drag && !drag.moved && e.target === canvas) { // tap/click pins a part (touch has no hover)
      const part = m.pick(e.clientX, e.clientY);
      pinned = part && part !== pinned ? part : null;
      m.focus(pinned || hover);
      emit(pinned || hover);
    }
    drag = null;
  });
  addEventListener('pointercancel', () => { drag = null; }); // the browser took the gesture (a vertical scroll): no pick, no stuck drag
  canvas.addEventListener('pointermove', e => {
    if (drag) {
      const dx = e.clientX - drag.x;
      if (Math.abs(dx) > 4) { drag.moved = true; yaw = clamp(drag.yaw - dx * 0.25, -55, 55); view(); }
      if (e.pointerType === 'touch') return;
    }
    if (e.pointerType !== 'touch') setHover(m.pick(e.clientX, e.clientY));
  });
  canvas.addEventListener('pointerleave', () => { if (!drag) setHover(null); });
  addEventListener('machine:focus', e => { pinned = null; m.focus(e.detail?.part || null); });
  addEventListener('keydown', e => { if (e.key === 'Escape' && pinned) { pinned = null; m.focus(hover); emit(hover); } });

  // a slow quarter-turn as the section scrolls past (read once a frame, and only while the section is on screen)
  if (!reduced) {
    const section = canvas.closest('section') || canvas;
    let on = false, raf = 0;
    const turn = () => {
      raf = 0;
      const r = section.getBoundingClientRect();
      scrollYaw = (clamp(1 - (r.top + r.height / 2) / innerHeight, 0, 1) - 0.5) * -24;
      view();
    };
    onVisible(section, v => { on = v; if (v) turn(); }, { once: false, threshold: 0 });
    addEventListener('scroll', () => { if (on && !raf) raf = requestAnimationFrame(turn); }, { passive: true });
  }
}
