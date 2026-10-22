import { reduced, lowEnd, onVisible, clamp, lerp, range, ease, scrollProgress } from './core.js';

export default function init(root) {
  root.querySelectorAll('.cl-q').forEach(accordion);

  const panel = root.querySelector('.cl-end');
  const cv = panel?.querySelector('.cl-rack');
  if (cv) rackWall(cv, panel);
  const line = root.querySelector('.cl-line');
  if (line) conveyor(line);
  // the panel grows to full size as it rises into view
  if (panel && !reduced) scrollProgress(panel, p => { panel.style.transform = `scale(${lerp(0.94, 1, ease(range(p, 0, 0.4))).toFixed(4)})`; });

  const clock = root.querySelector('[data-sf-time]');
  if (clock) {
    const fmt = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles', hour: 'numeric', minute: '2-digit' });
    const tick = () => { clock.textContent = fmt.format(new Date()); };
    tick();
    setInterval(tick, 20000);
  }

  // keep the copy button from changing width when its label flips to "Copied"
  const copy = root.querySelector('.cl-copy');
  copy?.addEventListener('click', () => {
    copy.style.minWidth = `${copy.offsetWidth}px`;
    clearTimeout(copy._t);
    copy._t = setTimeout(() => { copy.style.minWidth = ''; }, 1700);
  });

  const bar = root.querySelector('.cl-bar');
  if (bar) {
    if (!reduced) {
      bar.classList.add('is-armed');
      onVisible(bar, () => bar.classList.add('is-etched'), { threshold: 0.7 });
    }
    bar.addEventListener('pointermove', e => {
      const r = bar.getBoundingClientRect();
      bar.style.setProperty('--mx', `${((e.clientX - r.left) / r.width * 100).toFixed(1)}%`);
    });
  }

  // last, after everything above has found its nodes: the site footer belongs after <main> (a footer inside main/section is not a contentinfo landmark)
  const foot = root.querySelector('.cl-foot');
  if (foot) (root.closest('main') ?? root).after(foot);
}

/* <details> with an animated height. Native toggle when motion is reduced. */
function accordion(d) {
  const s = d.querySelector('summary');
  let anim = null;
  s.addEventListener('click', e => {
    if (reduced) return;
    e.preventDefault();
    const from = d.offsetHeight;
    const closing = d.open && !d.classList.contains('is-closing');
    anim?.cancel();
    let to;
    if (closing) {
      d.classList.add('is-closing');
      to = s.offsetHeight;
    } else {
      d.classList.remove('is-closing');
      d.open = true;
      to = d.offsetHeight;
    }
    anim = d.animate({ height: [`${from}px`, `${to}px`] }, { duration: closing ? 380 : 520, easing: 'cubic-bezier(.22, 1, .36, 1)' });
    anim.onfinish = () => {
      anim = null;
      if (closing) { d.open = false; d.classList.remove('is-closing'); }
    };
  });
}

/* "Rack wall at night": a perspective field of phones lying in cradles, receding to a horizon.
   Most are dim outlines; some screens glow blue (cloud) or orange (real) as agents use them.
   The camera drifts forward very slowly. Paused offscreen; one static frame for reduced motion. */
export function rackWall(cv, panel, opts = {}) {
  const ctx = cv.getContext('2d');
  const title = panel.querySelector('.cl-end__title'), lede = panel.querySelector('.cl-end__lede'), meta = panel.querySelector('.cl-end__meta');
  const PX = 0.13, PW = 0.072, PZ = 0.27, PL = 0.15, OX = 4.5 * 0.13;   // world pitch / phone size (eye height = 1)
  const AISLE_C = 9, AISLE_R = 6, LIT = 0.085, REAL = 0.2, SPEED = 0.07;
  const sprites = { c: sprite('143,195,230'), r: sprite('255,98,40') };
  let w = 0, h = 0, dpr = 1, hy = 0, raf = 0, last = 0, t = 7.3, camZ = 0;
  const lit = [];

  const mod = (a, n) => ((a % n) + n) % n;
  const hash = (a, b) => {
    let x = Math.imul(a, 374761393) + Math.imul(b, 668265263) | 0;
    x = Math.imul(x ^ (x >>> 13), 1274126177);
    return ((x ^ (x >>> 16)) >>> 0) / 4294967296;
  };

  function sprite(rgb) {
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const g = c.getContext('2d');
    const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, `rgba(${rgb},1)`);
    gr.addColorStop(0.3, `rgba(${rgb},.32)`);
    gr.addColorStop(1, `rgba(${rgb},0)`);
    g.fillStyle = gr;
    g.fillRect(0, 0, 64, 64);
    return c;
  }

  function resize() {
    dpr = Math.min(devicePixelRatio || 1, 2);
    w = cv.clientWidth;
    h = cv.clientHeight;
    cv.width = Math.round(w * dpr);
    cv.height = Math.round(h * dpr);
    if (!title) { hy = h * (opts.horizon ?? 0.55); draw(); return; } // reused by the turn intro panel: fixed horizon
    // layout offsets within the panel: immune to its scale-in and to the copy's reveal translate
    const y = el => { let v = 0; for (; el && el !== panel; el = el.offsetParent) v += el.offsetTop; return v; };
    const b = el => y(el) + el.offsetHeight;
    // horizon a hair above the headline's last baseline: the words stand on the floor and the hairline
    // hides behind their feet instead of grazing the lede. An empty inline-block sits on the baseline.
    const mark = title.appendChild(document.createElement('i'));
    mark.style.display = 'inline-block';
    hy = clamp(y(mark) - 0.05 * parseFloat(getComputedStyle(title).fontSize), h * 0.35, h * 0.7);
    mark.remove();
    // dark pool sized to the copy that sits over the field
    const pw = Math.max(lede.offsetWidth, meta.offsetWidth);
    panel.style.setProperty('--cl-py', `${((y(lede) + b(meta)) / 2).toFixed(0)}px`);
    panel.style.setProperty('--cl-pw', `${(pw * 0.8 + 60).toFixed(0)}px`);
    panel.style.setProperty('--cl-ph', `${((b(meta) - y(lede)) * 0.85 + 40).toFixed(0)}px`);
    draw();
  }

  function draw() {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const vx = w / 2;
    const f = (h - hy) * 1.7;                                   // keeps near phones portrait at any panel shape
    const cam = PW * (h - hy) / clamp(w * 0.02, 18, 28);         // eye height: nearest phone ~18–28px wide
    const zNear = cam * f / (h - hy + 24);
    const zFar = Math.min(12 * cam, Math.sqrt(cam * f * PZ / 2.2));

    // horizon haze
    const hz = ctx.createLinearGradient(0, hy - 70, 0, hy + 50);
    hz.addColorStop(0, 'rgba(143,195,230,0)');
    hz.addColorStop(0.58, 'rgba(143,195,230,.075)');
    hz.addColorStop(1, 'rgba(143,195,230,0)');
    ctx.fillStyle = hz;
    ctx.fillRect(0, hy - 70, w, 120);
    ctx.fillStyle = 'rgba(242,241,236,.09)';
    ctx.fillRect(0, Math.round(hy), w, 1);

    // aisle lines converging on the vanishing point
    const aisleHalf = (w / 2) * zFar / f;
    ctx.lineWidth = 1;
    const ag = ctx.createLinearGradient(0, hy, 0, h);
    ag.addColorStop(0, 'rgba(242,241,236,0)');
    ag.addColorStop(1, 'rgba(242,241,236,.07)');
    ctx.strokeStyle = ag;
    ctx.beginPath();
    for (let c = Math.floor(-aisleHalf / PX / AISLE_C) * AISLE_C; c * PX <= aisleHalf + OX; c += AISLE_C) {
      const X = c * PX - OX;
      ctx.moveTo(vx + X * f / zNear, hy + cam * f / zNear);
      ctx.lineTo(vx + X * f / zFar, hy + cam * f / zFar);
    }
    ctx.stroke();

    // rows, far to near
    lit.length = 0;
    const r0 = Math.floor((zNear + camZ) / PZ) - 1, r1 = Math.ceil((zFar + camZ) / PZ);
    for (let r = r1; r >= r0; r--) {
      if (mod(r, AISLE_R) === 0) continue;
      const za = r * PZ - camZ, zb = za + PL;
      if (za < zNear * 0.85 || zb > zFar) continue;
      const depth = (za - zNear) / (zFar - zNear);
      const fog = Math.pow(clamp(1 - depth), 1.4) * clamp((zFar - zb) / (PZ * 3));
      const ya = hy + cam * f / za, yb = hy + cam * f / zb;
      const half = (w / 2 + 60) * za / f;
      const c0 = Math.floor((OX - half) / PX), c1 = Math.ceil((OX + half) / PX);
      ctx.beginPath();
      for (let c = c0; c <= c1; c++) {
        if (mod(c, AISLE_C) === 0) continue;
        const X = c * PX - OX, x0 = X - PW / 2, x1 = X + PW / 2;
        ctx.moveTo(vx + x0 * f / za, ya);
        ctx.lineTo(vx + x1 * f / za, ya);
        ctx.lineTo(vx + x1 * f / zb, yb);
        ctx.lineTo(vx + x0 * f / zb, yb);
        ctx.closePath();
        if (hash(r, c) < LIT) lit.push(r, c, za, zb, fog);
      }
      ctx.strokeStyle = `rgba(242,241,236,${(0.035 + 0.12 * fog).toFixed(3)})`;
      ctx.stroke();
    }

    // lit screens + glow
    for (let i = 0; i < lit.length; i += 5) {
      const r = lit[i], c = lit[i + 1], za = lit[i + 2], zb = lit[i + 3], fog = lit[i + 4];
      const ph = hash(c, r + 101) * 6.283, sp = 0.18 + hash(r - 33, c + 7) * 0.5;
      let a = 0.5 + 0.5 * Math.sin(t * sp + ph);
      a = clamp((a - 0.22) / 0.78);
      a = a * a * (3 - 2 * a);
      if (((t * (0.5 + sp) + ph) % 4.2) < 0.09) a = Math.min(1, a + 0.55);   // a tap
      const alpha = a * (0.25 + 0.75 * fog);
      if (alpha < 0.02) continue;
      const real = hash(c * 3 + 1, r * 5 - 2) < REAL;
      const X = c * PX - OX, x0 = X - PW / 2 + 0.008, x1 = X + PW / 2 - 0.008;
      const ya = hy + cam * f / za, yb = hy + cam * f / zb;
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = alpha * 0.95;
      ctx.fillStyle = real ? '#FF6A33' : '#A7D3EF';
      ctx.beginPath();
      ctx.moveTo(vx + x0 * f / za, ya);
      ctx.lineTo(vx + x1 * f / za, ya);
      ctx.lineTo(vx + x1 * f / zb, yb);
      ctx.lineTo(vx + x0 * f / zb, yb);
      ctx.fill();
      const pw = PW * f / za, s = Math.max(9, pw * 2.8);
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = alpha * 0.55;
      ctx.drawImage(real ? sprites.r : sprites.c, vx + X * f / za - s / 2, (ya + yb) / 2 - s / 2, s, s);
    }
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
  }

  const loop = now => {
    if (!shown) { raf = 0; return; } // hidden (e.g. light theme): stop; the ResizeObserver restarts it
    raf = requestAnimationFrame(loop);
    if (now - last < (lowEnd ? 48 : 30)) return;   // ~30fps is plenty for a slow drift (~20 on phones: under 1px a frame)
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    t += dt;
    camZ += dt * SPEED;
    draw();
  };

  // shown = laid out with a size, kept by the ResizeObserver: frames never read layout
  let vis = false, shown = false;
  const start = () => { if (vis && shown && !raf) { last = performance.now(); raf = requestAnimationFrame(loop); } };
  new ResizeObserver(([e]) => { shown = e.contentRect.width > 0; resize(); start(); }).observe(cv);
  if (reduced) return;
  onVisible(panel, v => {
    vis = v;
    if (v) start();
    else if (raf) { cancelAnimationFrame(raf); raf = 0; }
  }, { once: false, threshold: 0 });
}

// Footer conveyor: machines ride the belt like a ticker. The set is cloned once so the loop is seamless;
// each machine starts at a different point of its 5 s tap cycle, on the sprite's 1/8 s frame grid so they all
// step on the same frame (one repaint per frame step, not one per machine).
function conveyor(line) {
  const track = line.querySelector('.cl-track'), set = track.querySelector('.cl-set');
  // the sprite (293 kB, ~13 MB decoded) loads once the footer is within a screen, not with the hero
  onVisible(line, () => line.style.setProperty('--sprite', `url("${new URL('../assets/model/machine-side.webp', import.meta.url).href}")`), { threshold: 0, rootMargin: '100% 0px' });
  set.querySelectorAll('.cl-slot-u').forEach((u, i) => u.style.setProperty('--ph', `${-Math.round((i * 1.37) % 5 * 8) / 8}s`));
  track.append(set.cloneNode(true));
  const measure = () => {
    const w = set.getBoundingClientRect().width;
    line.style.setProperty('--cl-w', `${w}px`);
    line.style.setProperty('--cl-dur', `${(w / 42).toFixed(1)}s`); // ~42 px/s
  };
  measure();
  new ResizeObserver(measure).observe(line);
  onVisible(line, v => line.classList.toggle('is-paused', !v), { once: false, threshold: 0 });
}
