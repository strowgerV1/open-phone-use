// 06 · Build — typing editor, streaming terminal, looping chat, client status, device globe.
import { reduced, lowEnd, sleep, onVisible, whenVisible, copyText, typeInto } from './core.js';

export default function init(root) {
  code(root.querySelector('.bd-code'));
  run(root.querySelector('.bd-run'));
  chat(root.querySelector('.bd-chat'));
  clients(root.querySelector('.bd-clients'));
  fleet(root.querySelector('.bd-fleet'));
}

const seen = (el, threshold = .3) => new Promise(r => onVisible(el, r, { threshold }));
// Resolves immediately while el is on screen in a shown tab, otherwise when it comes back. Loops await it so they
// pause offscreen and in background tabs.
function gate(el) {
  let vis = false, waiting = [];
  onVisible(el, v => { vis = v; if (v) { waiting.forEach(r => r()); waiting = []; } }, { once: false, threshold: 0 });
  return () => (vis ? Promise.resolve() : new Promise(r => waiting.push(r))).then(whenVisible);
}
const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/* ---------------- 1 · code editor ---------------- */
const SNIPS = {
  mcp: `// Prototype MCP · adapter not implemented
{
  "mcpServers": {
    "strowger": {
      "type": "http",
      "url": "MCP_ADAPTER_NOT_IMPLEMENTED",
      "headers": {
        "Authorization": "Bearer YOUR_LOCAL_KEY"
      }
    }
  }
}`,
  api: `# API · acquire a local environment
curl -X POST http://127.0.0.1:8765/v1/leases \\
  -H "Authorization: Bearer $ENV_CLIENT_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"kind":"browser","ttl":300}'

# Keep the id and lease_token from the response.
curl -X POST http://127.0.0.1:8765/v1/leases/LEASE_ID/actions \\
  -H "Authorization: Bearer $ENV_CLIENT_KEY" \\
  -H "X-Lease-Token: LEASE_TOKEN" \\
  -H "Content-Type: application/json" \\
  -d '{"action":"observe","args":{}}'`,
  cli: `# Local runtime · see the project README
python3 -m venv .venv
. .venv/bin/activate
pip install -r requirements.lock
pip install -e .
playwright install chromium
python scripts/init_env.py`,
};
const KW = new Set(['curl', 'npm', 'phoneuse']);

// Tiny per-line highlighter: [[class, text], …]
function lex(line) {
  const out = [];
  const m = line.match(/(^|\s)(\/\/|#)\s.*$/);
  const src = m ? line.slice(0, m.index + m[1].length) : line;
  const re = /("(?:[^"\\]|\\.)*")|(https?:\/\/\S+)|(\s+)|(-[A-Za-z]\b)|([A-Za-z_$][\w$]*)|(.)/g;
  let t;
  while ((t = re.exec(src))) {
    const [s, str, url, ws, flag, word] = t, next = src.slice(re.lastIndex);
    if (str) out.push([/^\s*:/.test(next) ? 'k' : 's', s]);
    else if (url || ws) out.push(['', s]);
    else if (flag) out.push(['k', s]);
    else if (word) out.push([KW.has(s) ? 'kw' : next[0] === '(' ? 'fn' : next[0] === '=' ? 'k' : '', s]);
    else out.push(['p', s]);
  }
  if (m) out.push(['c', line.slice(src.length)]);
  return out;
}

function prep(src) {
  const lines = src.split('\n').map(l => ({ toks: lex(l), len: l.length }));
  // typing steps skip leading indentation, like an editor's auto-indent
  const steps = [];
  let indent = true;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (c === '\n') { indent = true; steps.push(i + 1); continue; }
    if (indent && c === ' ') continue;
    indent = false;
    steps.push(i + 1);
  }
  return { src, lines, steps, copy: src.replace(/^\/\/.*\n/, '').replace(/\n# →.*$/, '') };
}

// Render the first n chars with syntax colours, line numbers and a block caret. Returns [html, line, col].
function paint({ lines }, n) {
  let left = n, html = '', pos = [1, 1];
  for (let i = 0; i < lines.length; i++) {
    const { toks, len } = lines[i], cur = left <= len;
    let k = cur ? left : len, out = '';
    for (const [c, t] of toks) {
      if (k <= 0) break;
      const part = t.slice(0, k);
      k -= part.length;
      out += c ? `<span class="bd-t-${c}">${esc(part)}</span>` : esc(part);
    }
    html += `<div class="bd-row"><span class="bd-n">${i + 1}</span><span>${out}${cur ? '<span class="bd-caret"></span>' : ''}</span></div>`;
    if (cur) { pos = [i + 1, left + 1]; break; }
    left -= len + 1;
  }
  return [html, ...pos];
}

function code(card) {
  const snips = Object.fromEntries(Object.entries(SNIPS).map(([k, v]) => [k, prep(v)]));
  const out = card.querySelector('[data-lines]'), sr = card.querySelector('[data-sr]');
  const posEl = card.querySelector('[data-pos]'), langEl = card.querySelector('[data-lang]');
  const conn = card.querySelector('[data-conn]'), connLabel = card.querySelector('[data-conn-label]');
  const LANG = { mcp: 'JSON', api: 'Shell', cli: 'Shell' };
  const show = (s, n) => { const [html, ln, col] = paint(s, n); out.innerHTML = html; posEl.textContent = `Ln ${ln}, Col ${col}`; };
  const done = on => { conn.classList.toggle('is-on', on); card.classList.toggle('is-ready', on); connLabel.textContent = on ? 'strowger · demo' : 'strowger · demo…'; out.classList.toggle('is-idle', on); };
  const panel = card.querySelector('[role=tabpanel]');
  const tabs = [...card.querySelectorAll('[role=tab]')];
  let active = 'mcp', gen = 0;

  const type = key => {
    const s = snips[key], my = ++gen;
    sr.textContent = s.src;
    langEl.textContent = LANG[key];
    done(false);
    if (reduced) { show(s, s.src.length); return done(true); }
    let t0 = 0;
    const frame = now => {
      if (my !== gen) return;
      t0 ||= now;
      const k = Math.min(s.steps.length, Math.floor((now - t0) / 10));
      show(s, k ? s.steps[k - 1] : 0);
      if (k < s.steps.length) requestAnimationFrame(frame);
      else done(true);
    };
    requestAnimationFrame(frame);
  };

  const select = (tab, focus) => {
    tabs.forEach(t => { const on = t === tab; t.setAttribute('aria-selected', on); t.tabIndex = on ? 0 : -1; });
    panel.setAttribute('aria-labelledby', tab.id);
    if (focus) tab.focus();
    if (tab.dataset.k !== active || !out.textContent) { active = tab.dataset.k; type(active); }
  };
  tabs.forEach((t, i) => {
    t.addEventListener('click', () => select(t));
    t.addEventListener('keydown', e => {
      const d = { ArrowRight: 1, ArrowLeft: -1 }[e.key];
      if (d) { e.preventDefault(); select(tabs[(i + d + tabs.length) % tabs.length], true); }
    });
  });
  card.querySelector('[data-copy]').addEventListener('click', e => copyText(snips[active].copy, e.currentTarget));

  sr.textContent = snips[active].src;
  show(snips[active], 0);
  out.classList.add('is-idle');
  seen(card, .35).then(() => { if (gen === 0) type(active); });
}

/* ---------------- 2 · run (terminal) ---------------- */
const STEPS = [
  { d: 350, ctx: 12.4, html: `<i class="bd-mk">⁝</i><div><span class="bd-shimmer">Thinking…</span></div>` },
  { d: 1000, ctx: 13.05, html: `<i class="bd-mk">▸</i><div><span class="bd-tool">phone.acquire</span><span>device="real"</span></div>` },
  { d: 1200, ctx: 13.6, html: `<i class="bd-mk"></i><div><span class="bd-res">→ iPhone 15 Pro #07</span><span class="bd-time">1.2s</span></div>` },
  { d: 550, ctx: 14.2, html: `<i class="bd-mk">▸</i><div><span class="bd-tool">screen.read</span><span>Instagram · Reels · 38 comments</span></div>` },
  { d: 750, ctx: 14.7, html: `<i class="bd-mk">▸</i><div><span class="bd-tool">tap</span><span>(212, 640)</span><span class="bd-res">Reply</span></div>` },
  { d: 600, ctx: 15.3, html: `<i class="bd-mk">▸</i><div><span class="bd-tool">type</span><span class="bd-res">"Thank you, see you Friday"</span></div>` },
  { d: 750, ctx: 15.9, html: `<i class="bd-mk bd-ok">|</i><div><span class="bd-prog">Reply to 38 comments<span class="bd-lead"></span><span class="bd-done" data-n>0/38</span></span></div>`, prog: true },
  { d: 350, ctx: 16.15, html: `<i class="bd-mk">◆</i><div><span>Thought for 2.8s</span></div>`, last: true },
];

async function run(card) {
  const log = card.querySelector('[data-log]'), pct = card.querySelector('[data-ctx]'), bar = card.querySelector('[data-meter]');
  const ctx = v => { pct.textContent = v.toFixed(2) + '%'; bar.style.transform = `scaleX(${v / 100})`; };
  const add = html => {
    const li = document.createElement('li');
    li.innerHTML = html;
    log.append(li);
    li.offsetWidth; // commit start state so the entry transitions
    li.classList.add('is-in');
    return li;
  };
  const finish = li => { const n = li.querySelector('[data-n]'); n.textContent = '[done]'; li.classList.add('is-go', 'is-finished'); };

  if (reduced) {
    STEPS.forEach(s => { const li = add(s.html); if (s.prog) finish(li); });
    log.querySelector('.bd-shimmer').classList.add('is-done');
    return ctx(16.15);
  }
  const wait = gate(card);
  ctx(12.4);
  await seen(card, .35);
  for (;;) {
    for (const s of STEPS) {
      await sleep(s.d); await wait();
      const li = add(s.html);
      ctx(s.ctx);
      if (s.prog) {
        li.classList.add('is-go');
        const n = li.querySelector('[data-n]');
        for (let i = 1; i <= 38; i++) { n.textContent = `${i}/38`; await sleep(38); }
        finish(li);
      }
      if (s.last) log.querySelector('.bd-shimmer')?.classList.add('is-done');
    }
    await sleep(3800); await wait();
    log.classList.add('is-out');
    await sleep(500);
    log.replaceChildren();
    log.classList.remove('is-out');
    ctx(12.4);
  }
}

/* ---------------- 3 · chat ---------------- */
const MSGS = [
  ['me', 'Get a real iPhone and tell me when the driver is here.'],
  ['ai', 'Watching the ride app on iPhone #07…'],
  ['ai', 'Your driver is here: grey Toyota Camry, plate 8KXL 204. I texted the guest.'],
  ['me', 'Perfect. Book the same ride for Friday 7pm.'],
];

async function chat(card) {
  const list = card.querySelector('[data-list]'), box = list.parentElement;
  const draft = card.querySelector('[data-draft]'), input = card.querySelector('.bd-input');
  // a long draft scrolls like a real field: caret end stays in view, the start fades out
  // (overflow runs off the start side, so scrollWidth can't see it: measure the text itself)
  const rg = document.createRange();
  new MutationObserver(() => { rg.selectNodeContents(draft); draft.classList.toggle('is-long', rg.getBoundingClientRect().width + 4 > draft.clientWidth); })
    .observe(draft, { childList: true, characterData: true, subtree: true });
  const bubble = (who, html) => {
    const b = document.createElement('p');
    b.className = `bd-msg is-${who}`;
    b.innerHTML = html;
    return b;
  };
  if (reduced) { list.append(...MSGS.map(([w, t]) => bubble(w, esc(t)))); return; }

  // FLIP: run a DOM change, then slide the bottom-anchored list from its old position
  const shift = fn => {
    const h0 = list.offsetHeight;
    fn();
    const d = list.offsetHeight - h0;
    if (d) list.animate([{ transform: `translateY(${d}px)` }, { transform: 'none' }], { duration: 520, easing: 'cubic-bezier(.22,1,.36,1)' });
    const top = box.clientHeight - list.offsetHeight;
    // measure all first, then remove, so offsets aren't read mid-reflow
    [...list.children].filter(c => top + c.offsetTop + c.offsetHeight < -24).forEach(c => c.remove());
  };
  list.append(bubble(MSGS[0][0], esc(MSGS[0][1])), bubble(MSGS[1][0], esc(MSGS[1][1])));
  const wait = gate(card);
  await seen(card, .35);
  for (let i = 2; ; i = (i + 1) % MSGS.length) {
    const [who, text] = MSGS[i];
    if (who === 'me') {
      input.classList.add('is-typing');
      await typeInto(draft, text, { speed: 20, jitter: 26 });
      await sleep(380);
      draft.textContent = '';
      input.classList.remove('is-typing');
      shift(() => list.append(bubble('me', esc(text))));
    } else {
      const b = bubble('ai', '<span class="bd-dots"><i></i><i></i><i></i></span>');
      shift(() => list.append(b));
      await sleep(1100);
      shift(() => { b.textContent = text; });
    }
    await sleep(i === MSGS.length - 1 ? 2600 : 1200);
    await wait();
  }
}

/* ---------------- 4 · clients ---------------- */
async function clients(card) {
  if (reduced) return;
  const rows = [...card.querySelectorAll('.bd-clist li')];
  rows.forEach(r => r.classList.add('is-off'));
  await seen(card, .4);
  for (const r of rows) { await sleep(260); r.classList.remove('is-off'); }
  const wait = gate(card);
  for (;;) {
    await sleep(1400); await wait();
    const lat = rows[Math.random() * rows.length | 0].querySelector('[data-ms]');
    lat.textContent = `${+lat.dataset.ms + Math.round(Math.random() * 8 - 4)}ms`;
  }
}

/* ---------------- 5 · fleet globe ---------------- */
function fleet(card) {
  const cv = card.querySelector('canvas'), g = cv.getContext('2d');
  const countEl = card.querySelector('[data-count]'), cloudEl = card.querySelector('[data-cloud]'), realEl = card.querySelector('[data-real]');
  const N = 620, GA = Math.PI * (3 - Math.sqrt(5));
  const pts = Array.from({ length: N }, (_, i) => {
    const y = 1 - (i + .5) / N * 2, r = Math.sqrt(1 - y * y), a = GA * i;
    return { x: Math.cos(a) * r, y, z: Math.sin(a) * r, real: Math.random() < .055, heat: 0, hold: 0 };
  });
  const waves = [];
  let W = 0, H = 0, raf = 0, last = 0, nextWave = 0;
  // fillStyle strings by colour and alpha (1/200 steps, finer than the eye or 8-bit alpha tells): no new string per dot per frame
  const rgba = {};
  const fill = (col, a) => (rgba[col] ??= [])[a = Math.round(a * 200)] ??= `rgba(${col},${a / 200})`;
  // night lighting: on the lifted dark-theme card the globe glows a touch more
  const html = document.documentElement;
  const PAL = { light: { halo: .10, rim: .07, dot: 1 }, dark: { halo: .15, rim: .1, dot: 1.2 } };
  let pal = PAL.light;
  const theme = () => { pal = PAL[html.dataset.theme === 'dark' ? 'dark' : 'light']; if (!raf && W) draw(performance.now()); };
  theme();
  new MutationObserver(theme).observe(html, { attributes: true, attributeFilter: ['data-theme'] });

  const size = () => {
    const dpr = Math.min(devicePixelRatio || 1, 2);
    W = cv.clientWidth; H = cv.clientHeight;
    cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
  };

  const frame = now => {
    raf = requestAnimationFrame(frame);
    if (lowEnd && now - last < 30) return; // ~30 fps on phones and small CPUs: a slow spin, the same globe
    const dt = last ? Math.min(now - last, 64) : 16;
    last = now;
    if (now > nextWave) { waves.push({ t: now, c: pts[Math.random() * N | 0], max: .7 + Math.random() * .9 }); nextWave = now + 650 + Math.random() * 900; }
    const decay = Math.pow(.5, dt / 520);
    for (let w = waves.length - 1; w >= 0; w--) {
      const { t, c, max } = waves[w], front = (now - t) / 850;
      if (front > max) { waves.splice(w, 1); continue; }
      for (const p of pts) {
        const d = Math.acos(Math.max(-1, Math.min(1, p.x * c.x + p.y * c.y + p.z * c.z)));
        if (Math.abs(d - front) < .11 && p.heat < .9) { p.heat = 1; if (Math.random() < .1) p.hold = now + 2000 + Math.random() * 5000; }
      }
    }
    // held dots are phones mid-session: they settle to a steady glow instead of fading out
    for (const p of pts) p.heat = now < p.hold ? Math.max(.55, p.heat * decay) : p.heat * decay;
    draw(now);
  };

  function draw(now) {
    g.clearRect(0, 0, W, H);
    const wide = W > H * 1.05;
    const R = wide ? Math.min(H * .44, W * .32) : Math.min(W * .37, H * .26);
    const cx = wide ? Math.min(W * .655, W - R - 24) : W / 2, cy = wide ? H * .5 : H * .47;
    const halo = g.createRadialGradient(cx, cy, R * .2, cx, cy, R * 1.6);
    halo.addColorStop(0, `rgba(143,195,230,${pal.halo})`);
    halo.addColorStop(1, 'rgba(143,195,230,0)');
    g.fillStyle = halo;
    g.fillRect(0, 0, W, H);

    // faint rim so the sphere reads as an object, not a cloud of specks
    g.strokeStyle = `rgba(143,195,230,${pal.rim})`;
    g.lineWidth = 1;
    g.beginPath(); g.arc(cx, cy, R + 6, 0, 6.283); g.stroke();

    const th = now * .00011, ph = -.38, k = Math.max(.85, R / 150);
    const ct = Math.cos(th), st = Math.sin(th), cp = Math.cos(ph), sp = Math.sin(ph);
    for (const pass of [0, 1]) {
      for (const p of pts) {
        const x1 = p.x * ct + p.z * st, z1 = -p.x * st + p.z * ct;
        const y2 = p.y * cp - z1 * sp, z2 = p.y * sp + z1 * cp;
        if ((z2 >= 0) !== !!pass) continue;
        const depth = (z2 + 1) / 2, sx = cx + x1 * R, sy = cy + y2 * R;
        const lit = p.heat > .02;
        const col = p.real ? '255,79,20' : '143,195,230';
        if (lit && pass && p.heat > .2) {
          g.fillStyle = fill(col, p.heat * .2 * depth);
          g.beginPath(); g.arc(sx, sy, (3.4 + 1.6 * depth) * k, 0, 6.283); g.fill();
        }
        g.fillStyle = lit
          ? fill(col, (.3 + .7 * depth) * Math.max(p.heat, .12))
          : fill('242,241,236', (.07 + .38 * depth * depth) * pal.dot);
        g.beginPath(); g.arc(sx, sy, (.6 + .9 * depth + (lit ? p.heat * .8 : 0)) * k, 0, 6.283); g.fill();
      }
    }
  }

  let total = 312;
  const tick = () => {
    if (document.hidden) return;
    total = Math.max(296, Math.min(334, total + Math.round(Math.random() * 6 - 2.6)));
    const real = 22 + (Math.random() * 4 | 0);
    countEl.textContent = total; realEl.textContent = real; cloudEl.textContent = total - real;
  };

  new ResizeObserver(() => { size(); if (!raf) draw(performance.now()); }).observe(cv);
  if (reduced) {
    pts.forEach(p => { if (Math.random() < .14) p.heat = 1; });
    return;
  }
  let timer = 0;
  onVisible(card, v => {
    if (v && !raf) { last = 0; raf = requestAnimationFrame(frame); timer = setInterval(tick, 1600); }
    if (!v && raf) { cancelAnimationFrame(raf); raf = 0; clearInterval(timer); }
  }, { once: false, threshold: 0 });
}
