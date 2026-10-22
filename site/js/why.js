import { onVisible, reduced } from './core.js';

// Section 05: start the tab pull, check draw-in and scribble once the board is in view.
// Phones: the table scrolls sideways, so the annotation waits until the STROWGER column is in view.
export default function init(root) {
  const sc = root.querySelector('.wy-scroll');
  const end = () => sc.classList.toggle('is-end', sc.scrollLeft + sc.clientWidth >= sc.scrollWidth - 40);
  sc.addEventListener('scroll', end, { passive: true });
  // sizes come from a ResizeObserver, which reports after layout: no forced layout at set-up or on resize
  const ro = new ResizeObserver(end);
  ro.observe(sc);
  ro.observe(sc.firstElementChild);
  if (reduced) { root.classList.add('is-on'); return; }
  onVisible(root.querySelector('.wy-board'), () => root.classList.add('is-on'), { threshold: 0.45 });
}
