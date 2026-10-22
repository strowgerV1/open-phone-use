// 07 · Built for — six small live visuals. Each loops only while its card is on screen.
import { reduced, sleep, whenVisible } from './core.js';

const STOP = Symbol('stop');
const rnd = (a, b) => a + Math.random() * (b - a);
const shuffle = a => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const CHECK = '<svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';

// Paused (offscreen, before first view, reduced motion) shows final(). At 40% visible the card holds
// final() a beat, then loops: fade out, snap to reset() (a populated start state), run(), hold.
// Only a fully offscreen card stops the loop, so a visual never blanks while still on screen.
function scene(card, { reset, run, final, hold = 2800 }) {
  const vis = card.querySelector('.uc-vis');
  const snap = end => {
    vis.classList.add('is-snap');
    reset();
    if (end) final();
    void vis.offsetWidth;
    vis.classList.remove('is-snap', 'is-fade');
  };
  snap(true);
  if (reduced) return;
  let gen = 0, live = false;
  new IntersectionObserver(es => {
    const e = es.at(-1); // the latest entry: several can queue up
    if (live ? e.isIntersecting : e.intersectionRatio < 0.4) return;
    live = !live;
    card.classList.toggle('is-live', live);
    const id = ++gen;
    if (!live) return snap(true);
    const wait = async ms => { await sleep(ms); await whenVisible(); if (id !== gen) throw STOP; }; // holds in a background tab
    (async () => {
      await wait(800);
      for (;;) {
        vis.classList.add('is-fade');
        await wait(480);
        snap();
        await wait(500);
        await run(wait);
        await wait(hold);
      }
    })().catch(e => { if (e !== STOP) throw e; });
  }, { threshold: [0, 0.4] }).observe(card);
}

function social(card) {
  const vis = card.querySelector('.uc-social');
  const items = [...vis.querySelectorAll('.uc-cmt')];
  // typed part + caret + transparent remainder, so the line keeps its final size while typing
  const full = items.map(li => li.querySelector('.uc-reply-text').textContent);
  const parts = items.map(li => {
    const t = li.querySelector('.uc-reply-text');
    t.innerHTML = '<span></span><i class="uc-caret"></i><span class="uc-ghost"></span>';
    return [t.firstChild, t.lastChild];
  });
  const type = (i, k) => { parts[i][0].textContent = full[i].slice(0, k); parts[i][1].textContent = full[i].slice(k); };
  const count = vis.querySelector('.uc-count b');
  const set = n => { count.textContent = n; vis.classList.toggle('is-all', n === items.length); };
  scene(card, {
    reset() { items.forEach((li, i) => { li.className = 'uc-cmt'; type(i, 0); }); set(0); },
    final() { items.forEach((li, i) => { li.classList.add('is-replied'); type(i, full[i].length); }); set(items.length); },
    async run(wait) {
      for (const [i, li] of items.entries()) {
        li.classList.add('is-active');
        await wait(450);
        li.classList.add('is-typing');
        for (let k = 1; k <= full[i].length; k++) { type(i, k); await wait(rnd(16, 40)); }
        await wait(200);
        li.classList.remove('is-typing', 'is-active');
        li.classList.add('is-replied');
        set(i + 1);
        await wait(420);
      }
    },
  });
}

function imsg(card) {
  const vis = card.querySelector('.uc-imsg');
  const steps = ['is-trig', 'is-sent', 'is-delivered', 'is-read', 'is-typing', 'is-replied'];
  scene(card, {
    reset() { vis.classList.remove(...steps); },
    final() { vis.classList.add('is-sent', 'is-read', 'is-replied'); },
    async run(wait) {
      vis.classList.add('is-trig'); await wait(650);
      vis.classList.add('is-sent'); await wait(800);
      vis.classList.add('is-delivered'); await wait(1300);
      vis.classList.add('is-read'); await wait(500);
      vis.classList.add('is-typing'); await wait(1700);
      vis.classList.add('is-replied');
      vis.classList.remove('is-trig');
    },
  });
}

function sms(card) {
  const vis = card.querySelector('.uc-sms');
  const code = '482193';
  const boxes = [...vis.querySelectorAll('.uc-otp-box')];
  const reels = boxes.map((b, i) => {
    const reel = b.querySelector('.uc-otp-reel');
    const digits = ['', ...Array.from({ length: 6 }, () => Math.floor(Math.random() * 10)), code[i]];
    reel.innerHTML = digits.map(d => `<i>${d}</i>`).join('');
    return reel;
  });
  const roll = (i, on) => {
    const n = reels[i].children.length;
    reels[i].style.transform = on ? `translateY(${(-(n - 1) * 100) / n}%)` : '';
  };
  scene(card, {
    reset() {
      vis.classList.add('is-notif');
      vis.classList.remove('is-verified');
      boxes.forEach((b, i) => { b.className = i ? 'uc-otp-box' : 'uc-otp-box is-focus'; roll(i, false); });
    },
    final() {
      vis.classList.add('is-verified');
      boxes.forEach((b, i) => { b.className = 'uc-otp-box is-filled'; roll(i, true); });
    },
    async run(wait) {
      await wait(700);
      for (const [i, b] of boxes.entries()) {
        b.classList.add('is-focus', 'is-filled');
        roll(i, true);
        await wait(180);
        b.classList.remove('is-focus');
      }
      await wait(650);
      vis.classList.add('is-verified');
    },
  });
}

function apps(card) {
  const vis = card.querySelector('.uc-food');
  const track = vis.querySelector('.uc-track');
  const steps = [...track.children];
  const go = n => {
    steps.forEach((s, i) => { s.classList.toggle('is-done', i < n); s.classList.toggle('is-now', i === n); });
    track.style.setProperty('--p', Math.max(0, n) / 2);
  };
  scene(card, {
    reset() { vis.classList.remove('is-tap', 'is-ordered'); go(-1); },
    final() { vis.classList.add('is-ordered'); go(2); },
    async run(wait) {
      await wait(300);
      vis.classList.add('is-tap'); await wait(420);
      vis.classList.add('is-ordered'); go(0); await wait(1100);
      go(1); await wait(1300);
      go(2);
    },
  });
}

function qa(card) {
  const vis = card.querySelector('.uc-qa');
  const grid = vis.querySelector('.uc-qa-grid');
  grid.innerHTML = '<i class="uc-dev"></i>'.repeat(40);
  const devs = [...grid.children];
  devs.forEach((d, i) => d.style.setProperty('--w', `${((i % 10) + Math.floor(i / 10)) * 28}ms`));
  const n = vis.querySelector('.uc-qa-n');
  const what = vis.querySelector('.uc-qa-what');
  const stamp = vis.querySelector('.uc-stamp');
  const FLAKY = 26;
  scene(card, {
    reset() {
      devs.forEach(d => { d.className = 'uc-dev'; });
      n.textContent = 0; what.textContent = 'checkout';
      vis.classList.remove('is-done'); stamp.classList.remove('is-stamped');
    },
    final() {
      devs.forEach(d => { d.className = 'uc-dev is-pass'; });
      n.textContent = 40; vis.classList.add('is-done'); stamp.classList.add('is-stamped');
    },
    async run(wait) {
      devs.forEach(d => d.classList.add('is-run'));
      await wait(900);
      let passed = 0;
      for (const i of shuffle([...devs.keys()])) {
        if (i === FLAKY) devs[i].classList.add('is-flaky');
        else { devs[i].classList.add('is-pass'); n.textContent = ++passed; }
        await wait(rnd(22, 64));
      }
      what.textContent = 'retrying 1';
      await wait(500);
      devs[FLAKY].classList.add('is-retry'); await wait(1000);
      devs[FLAKY].classList.remove('is-flaky', 'is-retry');
      devs[FLAKY].classList.add('is-pass');
      n.textContent = ++passed; what.textContent = 'checkout';
      vis.classList.add('is-done');
      await wait(380);
      stamp.classList.add('is-stamped');
    },
  });
}

// Pixel phones: deterministic "used" screens (app icons, a notification or an error dialog).
const TINTS = ['#E8A598', '#8FC3E6', '#E3C38A', '#9BD3AE', '#C9C1E0', '#F2B880', '#B7C0C9', '#E6D6A8'];
function pixel(i) {
  const icons = Array.from({ length: 6 + ((i * 5) % 7) }, (_, k) => `<i style="background:${TINTS[(i * 3 + k * 5) % TINTS.length]}"></i>`).join('');
  const extra = ['<b class="uc-px-note"></b>', '<b class="uc-px-dlg"></b>', ''][i % 3];
  return `<div class="uc-px"><div class="uc-px-body"><div class="uc-px-screen">
    <div class="uc-px-dirty">${icons}</div>${extra}
    <div class="uc-px-clean"><span class="uc-px-ok">${CHECK}</span><em>clean</em></div>
    <i class="uc-px-scan"></i></div></div><span class="uc-px-id">px-${String(i + 1).padStart(2, '0')}</span></div>`;
}

function sandbox(card) {
  const vis = card.querySelector('.uc-sb');
  const row = vis.querySelector('.uc-sb-row');
  row.innerHTML = Array.from({ length: 10 }, (_, i) => pixel(i)).join('');
  const px = [...row.children];
  const n = vis.querySelector('.uc-sb-n');
  const state = vis.querySelector('.uc-sb-state');
  const dot = vis.querySelector('.uc-sb-dot');
  const set = k => {
    const done = k === px.length;
    n.textContent = k;
    state.textContent = done ? 'ready' : 'wiping';
    dot.classList.toggle('dot--live', !done);
    vis.classList.toggle('is-done', done);
  };
  scene(card, {
    reset() { px.forEach(p => { p.className = 'uc-px'; }); set(0); },
    final() { px.forEach(p => p.classList.add('is-wiping', 'is-clean')); set(px.length); },
    async run(wait) {
      let k = 0;
      await Promise.all(px.map(async (p, i) => {
        await wait(i * 230);
        p.classList.add('is-wiping');
        await wait(820);
        p.classList.add('is-clean');
        set(++k);
      }));
    },
    hold: 3200,
  });
}

export default function init(root) {
  const card = sel => root.querySelector(sel);
  social(card('.uc-card--social'));
  imsg(card('.uc-card--imsg'));
  sms(card('.uc-card--sms'));
  apps(card('.uc-card--apps'));
  qa(card('.uc-card--qa'));
  sandbox(card('.uc-card--sandbox'));
}
