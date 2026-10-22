import { reduced, sleep, range, ease, onVisible, scrollProgress, typeInto } from './core.js';

// Per app: what STROWGER lets the agent do, then three phone-only moments as [from app, title, text].
// Idle: the top-right and left notifications come from the top ring's front app, the bottom-right one
// from the bottom ring's. A chosen app fills all three.
const APPS = {
  uber: ['book the ride, read the PIN from your SMS and share it with the driver.',
    ['messages', 'Your Uber code is 4821', 'Share this PIN with your driver to start the trip.'],
    ['uber', 'Driver arriving shortly', 'Grey Toyota Camry · 8KXL 204 is 1\u00A0min away.'],
    ['uber', 'You’ve arrived', 'Rate Ahmed and add a tip in the app.']],
  messages: ['read verification codes and text back from a real number.',
    ['messages', '382 019 is your Google code', 'Sent by SMS to +1 ••• 4821. A browser has no SIM.'],
    ['messages', 'Courier · +1 628 ••• 7730', 'I’m at the gate. What’s the door code?'],
    ['messages', 'Mom', 'Call me when you land? Dinner is at 8.']],
  whatsapp: ['answer chats, send voice notes and share live location from your number.',
    ['whatsapp', 'Maya', 'Landed! Sharing my live location with you.'],
    ['messages', 'WhatsApp code 381-604', 'Enter it in WhatsApp to verify this phone.'],
    ['whatsapp', 'Family · 14 new messages', 'Dad: Who’s bringing dessert on Sunday?']],
  instagram: ['post Reels and stories, answer DMs and approve new logins.',
    ['instagram', 'Was this you?', 'Login attempt from Chrome on macOS. Approve it on this phone.'],
    ['instagram', 'maya.k sent you a Reel', 'Reply in the app to keep the thread going.'],
    ['instagram', 'New follow request', 'sam.designs wants to follow you.']],
  airbnb: ['check in, read the door code and message your host.',
    ['airbnb', 'Check-in is today', 'Your door code is 4821. It works from 3 PM.'],
    ['airbnb', 'New message from Elena', 'Parking is behind the cabin. Enjoy your stay!'],
    ['airbnb', 'Checkout is tomorrow, 11 AM', 'Leave the keys in the lockbox by the door.']],
  chase: ['approve device-bound sign-ins and pull statements from the app.',
    ['chase', 'Approve sign-in on this device?', 'New login from Chrome · San Francisco.'],
    ['messages', 'Chase: 448 207 is your code', 'Valid for 10 minutes. Never share it.'],
    ['chase', 'You received $24.00', 'Sam sent it with Zelle for pizza night.']],
  tinder: ['verify your profile with a real number and keep chats moving.',
    ['tinder', 'You have a new match', 'Say hi to Priya before the match expires.'],
    ['messages', 'Your Tinder code is 610 447', 'Enter it to verify your phone number.'],
    ['tinder', 'Priya sent a message', 'Coffee this weekend?']],
  snapchat: ['open Snaps, reply and keep your streaks alive.',
    ['snapchat', 'Riya sent you a Snap', 'Snaps only open in the app.'],
    ['snapchat', 'Your streak ends soon', 'Send a Snap to keep your 112\u2011day streak.'],
    ['snapchat', 'Sam is typing…', 'Open Snapchat to see the chat.']],
  zomato: ['order dinner, track the rider and chat with them on the way.',
    ['zomato', 'Your food is being prepared', 'Arriving in 28 min · 2 items from Kebab House.'],
    ['zomato', 'Rider assigned', 'Arjun is on the way. Call or chat in the app.'],
    ['zomato', 'Order delivered', 'Rate Kebab House and tip Arjun in the app.']],
  tiktok: ['post videos from the camera roll and reply to comments.',
    ['tiktok', 'Your video is live', '12.4K views in the first hour.'],
    ['messages', '[TikTok] 734 021 is your code', 'Use it to log in on this phone.'],
    ['tiktok', '38 new comments', '“How did you film this?” and more.']],
  swiggy: ['reorder groceries and read out the delivery OTP.',
    ['swiggy', 'Out for delivery', 'Your Instamart order is 9 min away.'],
    ['swiggy', 'Share OTP 3907 at the door', 'Only give it to your delivery partner.'],
    ['swiggy', 'Order delivered', 'Rate your Instamart order to earn coins.']],
  paytm: ['pay with UPI inside the limits you set.',
    ['paytm', 'Payment request · ₹420', 'Sharma General Store. Approve with your UPI PIN.'],
    ['messages', '₹420 debited from A/c XX4821', 'UPI ref 4106 2273 9910 · Paytm.'],
    ['paytm', 'You won ₹25 cashback', 'Scratch your card in the app to claim it.']],
  venmo: ['pay friends back, split the bill and confirm new devices.',
    ['venmo', 'Sam paid you $24.00', 'Pizza night. Move it to your bank in the app.'],
    ['messages', 'Venmo code 618 204', 'Use it to confirm this new device.'],
    ['venmo', 'Maya requests $18.50', 'Movie tickets. Pay or decline in the app.']],
  telegram: ['log in with codes that only arrive inside the app.',
    ['telegram', 'Login code: 52381', 'Sent to your Telegram app, not by SMS.'],
    ['telegram', 'New login · Chrome on macOS', 'Not you? End the session in Settings.'],
    ['telegram', 'Maya', 'Sent you a voice message · 0:41']],
  google: ['answer Google sign-in prompts on a phone that is already signed in.',
    ['google', 'Trying to sign in?', 'Tap 42 on this phone to confirm it’s you.'],
    ['messages', 'G-284913 is your Google code', 'Sent to +1 ••• 4821 as a backup.'],
    ['google', 'New sign-in on a Pixel 8', 'Was this you? Check it on this phone.']],
  lyft: ['scan the QR code, unlock a scooter and end the ride.',
    ['lyft', 'Scooter unlocked', 'Ride started · 0.8 km so far.'],
    ['lyft', 'Park to end your ride', 'Take a photo of the scooter to finish.'],
    ['lyft', 'Ride ended · $3.40', 'Your receipt is in the app.']],
};

const SPRING = 'cubic-bezier(.34,1.56,.64,1)';
const wrap = a => ((a + 180) % 360 + 360) % 360 - 180;
// cards fade into the paper as they turn away (d: degrees from the front); the far side is hidden
const fade = d => Math.max(0, Math.cos(d * Math.PI / 180) * 1.15 - .15) ** 1.4;

// ---------- liquid glass: three looks, best first ----------
// lens:  the bend. Only where it is cheap: Chromium (the one engine that takes an SVG filter in backdrop-filter)
//        on a desktop with a fine pointer and headroom, no Save-Data, transparency allowed.
// frost: the same glass without the bend (Safari, Firefox, smaller machines).
// flat:  no backdrop pass; a fill baked to the frost's look (low-end devices). Phones always get it from CSS:
//        there the notes stack over plain paper, where the frost only ever brightened the paper.
const nav = navigator;
const RT = matchMedia('(prefers-reduced-transparency: reduce)').matches;   // CSS: solid notes
const LENS = !!nav.userAgentData && !nav.userAgentData.mobile
  && matchMedia('(hover: hover) and (pointer: fine)').matches
  && !RT && nav.hardwareConcurrency >= 8 && (nav.deviceMemory ?? 8) >= 8 && !nav.connection?.saveData;
const WEAK = nav.hardwareConcurrency < 4 || (nav.deviceMemory ?? 8) < 4 || !!nav.connection?.saveData;
const LOOKS = ['lens', 'frost', 'flat'];
const STACKED = matchMedia('(max-width: 1023px)');   // notes under the rings (see the responsive CSS)
const BEZEL = 22;   // px of rim that bends
const BEND = 52;    // feDisplacementMap scale: the rim samples up to BEND/2 px further in

// Displacement map for a w×h box with corner radius r. In the bezel along the rim, red/green move each
// pixel's sample inward along the edge normal, most at the very edge, so the cards behind fold and
// stretch into the rim like through a thick convex edge. 128/128 (no shift) everywhere else.
const lensMap = (w, h, r) => {
  const c = Object.assign(document.createElement('canvas'), { width: w, height: h });
  const g = c.getContext('2d'), img = g.createImageData(w, h), d = img.data;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const px = x + .5 - w / 2, py = y + .5 - h / 2;
    const qx = Math.abs(px) - w / 2 + r, qy = Math.abs(py) - h / 2 + r;
    let e, nx = 0, ny = 0;   // e: distance in from the rim; n: outward normal (per quadrant)
    if (qx > 0 && qy > 0) { const l = Math.hypot(qx, qy); e = r - l; nx = qx / l; ny = qy / l; }
    else if (qx > qy) { e = r - qx; nx = 1; } else { e = r - qy; ny = 1; }
    const m = e < 0 || e >= BEZEL ? 0 : (1 - e / BEZEL) ** 2;
    const i = (y * w + x) * 4;
    d[i] = 128 - 127 * m * nx * Math.sign(px);
    d[i + 1] = 128 - 127 * m * ny * Math.sign(py);
    d[i + 2] = 128;
    d[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  return c.toDataURL();
};

// One SVG lens per notification. No colour split: where the bend folds, a few px of red/cyan offset smear
// into a wide band the frost's saturate makes garish.
function lenses(slots) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('aria-hidden', 'true');
  svg.style.cssText = 'position:absolute;width:0;height:0';
  svg.innerHTML = slots.map((_, i) => `<filter id="wl-lens-${i}" x="0" y="0" width="100%" height="100%" color-interpolation-filters="sRGB">
    <feImage x="0" y="0" result="map"/>
    <feDisplacementMap in="SourceGraphic" in2="map" scale="${BEND}" xChannelSelector="R" yChannelSelector="G"/>
  </filter>`).join('');
  // a new map whenever a note's box changes (text swaps can change its height)
  const ro = new ResizeObserver(() => slots.forEach((li, i) => {
    const w = li.offsetWidth, h = li.offsetHeight, k = `${w}x${h}`;
    if (li.lens === k || !w) return;
    li.lens = k;
    const map = svg.querySelector(`#wl-lens-${i} feImage`);
    map.setAttribute('width', w);
    map.setAttribute('height', h);
    map.setAttribute('href', lensMap(w, h, parseFloat(getComputedStyle(li).borderTopLeftRadius)));
  }));
  slots.forEach((li, i) => { ro.observe(li); li.style.setProperty('--wl-lens', `url(#wl-lens-${i})`); });
  return svg;
}

// The notes' look. Backdrop passes run only while the stage is on screen (.is-vis). Once the notes are in, a frame
// check watches 180 frames on screen: if over a quarter miss 45 fps (weak GPU, software compositing), the glass
// steps down a look for good and is checked again, down to flat. ?glass=lens|frost|flat pins a look (dev).
function glass(stage, notes, slots) {
  const pin = new URLSearchParams(location.search).get('glass');
  let look = LOOKS.includes(pin) ? pin : LENS ? 'lens' : WEAK ? 'flat' : 'frost';
  let kept = LOOKS.includes(pin) ? look : null;   // a look that has passed (or is pinned): no more checks
  let svg = null, vis = false, live = false, raf = 0, last = 0, n = 0, slow = 0;
  const apply = () => {
    const lens = look === 'lens' && vis && !STACKED.matches && !RT;
    if (lens && !svg) svg = lenses(slots);
    // mount the filters only with the lens: Chromium keeps painting a url() backdrop-filter after the class
    // that set it is gone, until the filter it points at leaves the document
    if (lens) stage.append(svg); else svg?.remove();
    notes.classList.toggle('is-lens', lens);
    notes.classList.toggle('is-flat', look === 'flat');
    stage.classList.toggle('is-vis', vis);
    watch();
  };
  const frame = t => {
    raf = 0;
    if (last) { n++; if (t - last > 22) slow++; }
    last = t;
    if (n < 180) return watch();
    if (slow > 45) look = LOOKS[LOOKS.indexOf(look) + 1];   // a quarter of 3 s of frames missed 45 fps
    else kept = look;
    n = slow = 0;
    apply();
  };
  // only while there is a backdrop pass to save (phones: none, CSS keeps them flat)
  const watch = () => {
    const on = live && vis && !reduced && !RT && kept !== look && look !== 'flat' && !STACKED.matches;
    if (!on) { cancelAnimationFrame(raf); raf = 0; last = 0; }
    else if (!raf) raf = requestAnimationFrame(frame);
  };
  STACKED.addEventListener('change', apply);
  onVisible(stage, v => { vis = v; apply(); }, { once: false, threshold: 0 });
  return () => { live = true; watch(); };
}

export default function init(root) {
  const stage = root.querySelector('.wl-stage');
  const notes = root.querySelector('.wl-notes');
  const slots = [...notes.children];
  const capText = root.querySelector('.wl-can-v');
  const box = root.querySelector('.wl-3d');
  const wire = root.querySelector('.wl-wire path');
  const head = root.querySelector('.wl-path-head');
  const typed = root.querySelector('.wl-typed');
  const set = (k, v) => stage.style.setProperty(k, v);
  const R = parseFloat(getComputedStyle(root).getPropertyValue('--R'));
  const icon = {}, name = {}, orig = {};

  if (matchMedia('(hover: none)').matches) root.querySelector('.wl-can-idle').textContent = 'Tap an app to see what your agent can do with it.';

  // place each ring's cards around the cylinder by width, in the order they reach the front
  const rings = [...root.querySelectorAll('.wl-ring')].map((el, ri) => {
    const dir = +el.dataset.dir;
    // each app sits on the ring twice, half a turn apart: a dense ring, but an app is never shown twice at once
    for (const c of [...el.children]) {
      orig[c.dataset.app] = c;
      icon[c.dataset.app] = c.querySelector('.app');
      name[c.dataset.app] = c.getAttribute('aria-label');
      const twin = c.cloneNode(true);
      twin.tabIndex = -1;
      twin.setAttribute('aria-hidden', 'true');
      twin.addEventListener('mousedown', e => e.preventDefault());   // a click must not focus an aria-hidden copy
      el.append(twin);
    }
    const cards = [...el.children];
    const ws = cards.map(c => c.offsetWidth);
    const gap = (2 * Math.PI * R - ws.reduce((a, b) => a + b)) / cards.length;
    let s = 0;
    const th = cards.map((c, i) => {
      if (i) s += (ws[i - 1] + ws[i]) / 2 + gap;
      return -dir * s / R * 180 / Math.PI;
    });
    // a card reaches the front every ~3.5 s: period = ms per turn
    const ring = { el, dir, ri, cards, th, phi: 0, phi0: 0, to: null, front: -1, period: cards.length * 3500 };
    cards.forEach((c, i) => {
      c.style.setProperty('--a', th[i].toFixed(2));
      Object.assign(c, { ring, idx: i });
    });
    return ring;
  });
  const cards = rings.flatMap(r => r.cards);
  const origs = Object.values(orig);   // the 16 real buttons; their twins are aria-hidden

  // ---------- notifications ----------
  let live = reduced;   // notifications have made their entrance
  const fill = (li, [from, title, text]) => {
    li.querySelector('.wl-n-ico').replaceChildren(icon[from].cloneNode(true));
    li.querySelector('.wl-n-app').textContent = name[from];
    li.querySelector('.wl-n-title').textContent = title;
    li.querySelector('.wl-n-text').textContent = text;
  };
  const put = (li, m) => {
    if (li.m === m) return;
    li.m = m;
    if (!live) return fill(li, m);
    if (li.busy) return;                         // the running swap lands on the latest li.m
    li.busy = true;
    const parts = [...li.children];
    Promise.all(parts.map(p => p.animate(
      [{ opacity: 1 }, { opacity: 0, transform: 'translateY(-6px)' }],
      { duration: 150, easing: 'ease-in', fill: 'forwards' }).finished)).then(() => {
      fill(li, li.m);
      li.busy = false;
      parts.forEach((p, i) => {
        p.getAnimations().forEach(a => a.cancel());
        p.animate([{ opacity: 0, transform: 'translateY(9px)' }, { opacity: 1, transform: 'none' }],
          { duration: 560, delay: i * 50, easing: SPRING, fill: 'backwards' });
      });
      li.animate([{ scale: .93 }, { scale: 1 }], { duration: 700, easing: SPRING });
    });
  };

  // ---------- who drives the notifications ----------
  let sel = null, hold = 0;
  const sync = () => {
    const src = sel ? [sel] : rings.map(r => r.cards[r.front]);
    const [a, b] = src.map(c => APPS[c.dataset.app]);
    const m = [a[1], a[2], b ? b[1] : a[3]];
    slots.forEach((li, i) => put(li, m[i]));
    cards.forEach(c => c.classList.toggle('is-src', src.includes(c)));
    // roving tabindex: the chosen app is the group's one Tab stop and reads as pressed
    const pick = sel && orig[sel.dataset.app];
    if (pick) roving(pick);
    for (const c of origs) { const v = String(c === pick); if (c.getAttribute('aria-pressed') !== v) c.setAttribute('aria-pressed', v); }
  };
  const roving = card => { for (const c of origs) c.tabIndex = c === card ? 0 : -1; };

  // ---------- rings ----------
  // Turning freely (cruise), the compositor turns the rings (WAAPI), so the turn is smooth whatever the main thread
  // is doing and needs no frame of its own; a 100 ms clock reads the angle back for the cards' fade (a step is under
  // 1°, about 1% of opacity), the front cards and the far side. Only two elements animate, so the main frames that
  // other things cause don't restyle every card. Whatever steers the rings (a hover easing them to a stop, a glide
  // to a card) lands them back in the frame loop below.
  const turn = (r, a = r.phi) => `translateZ(${-R}px) rotateY(${a.toFixed(3)}deg)`;
  let anims = null, t0 = 0, clock = 0;
  const render = () => {
    let changed = false;
    for (const r of rings) {
      if (anims) r.phi = r.phi0 + r.dir * 360 * (document.timeline.currentTime - t0) / r.period;
      else { const tf = turn(r); if (r.tf !== tf) r.el.style.transform = r.tf = tf; }
      let best = 0, bd = 360;
      r.cards.forEach((c, i) => {
        const d = wrap(r.th[i] + r.phi);
        const k = Math.cos(d * Math.PI / 180);
        const o = (c === sel ? Math.max(.92, k) : fade(d)).toFixed(2);
        if (c.o !== o) c.style.opacity = c.o = o;
        c.classList.toggle('is-back', k < .14);
        if (Math.abs(d) < bd) { bd = Math.abs(d); best = i; }
      });
      if (best !== r.front) { r.front = best; changed = true; }
    }
    if (changed) sync();
  };
  const cruise = () => {
    if (anims) return;
    t0 = document.timeline.currentTime;
    anims = rings.map(r => {
      r.phi0 = r.phi;
      const a = r.el.animate([{ transform: turn(r) }, { transform: turn(r, r.phi + r.dir * 360) }], { duration: r.period, iterations: Infinity });
      a.startTime = t0;   // one clock for both rings and the read-back
      return a;
    });
    clock = setInterval(render, 100);
  };
  const land = () => {
    if (!anims) return;
    render();   // the angle the compositor reached
    clearInterval(clock);
    anims.forEach(a => a.cancel());
    anims = null;
    for (const r of rings) r.tf = null;
    render();
  };

  // ---------- the agent's path ----------
  let ax = 0, ay = 0, stop = 0, px = null, py = null, draw = 0, d = '', len = 0, hp = '', dv = '', jv = '';
  // progress goes to the three elements that read it, not the stage: a write there would restyle its whole subtree
  const dash = root.querySelector('.wl-path-dash');
  const drawn = (k, j) => {
    if (k !== dv) { wire.style.setProperty('--draw', dv = k); head.style.setProperty('--draw', k); }
    if (j !== jv) dash.style.setProperty('--dash', jv = j);
  };
  const measure = () => {
    const s = stage.getBoundingClientRect(), b = box.getBoundingClientRect();
    ax = b.left - s.left;
    ay = b.top - s.top;
    stop = parseFloat(getComputedStyle(stage).getPropertyValue('--stop')) || 0;   // the dot halts this far above the cards
    set('--ax', ax.toFixed(1));
    set('--ay', ay.toFixed(1));
  };
  const target = () => {
    if (!sel) return [ax, ay - stop];
    const s = stage.getBoundingClientRect(), b = sel.firstElementChild.getBoundingClientRect();
    return [b.left + b.width / 2 - s.left, b.top - s.top];
  };
  const paint = (dt = 1) => {
    const [tx, ty] = target();
    const k = px === null ? 1 : 1 - Math.exp(-dt * 9);
    px = px === null ? tx : px + (tx - px) * k;
    py = py === null ? ty : py + (ty - py) * k;
    const nd = `M${ax.toFixed(1)} 0C${ax.toFixed(1)} ${(py * .55).toFixed(1)} ${px.toFixed(1)} ${(py * .45).toFixed(1)} ${px.toFixed(1)} ${py.toFixed(1)}`;
    if (nd !== d) { wire.setAttribute('d', d = nd); len = 0; }
    if (draw < 1 && !len) len = wire.getTotalLength();
    const h = draw < 1 ? wire.getPointAtLength(draw * len) : { x: px, y: py };
    const t = `translate(${h.x.toFixed(1)}px,${h.y.toFixed(1)}px)`;
    if (t !== hp) head.style.transform = hp = t;
  };

  // ---------- select / release ----------
  let wake = null;   // (the frame loop, below; none with reduced motion)
  const select = (card, glide) => {
    clearTimeout(hold);
    const r = card.ring;
    land();
    if (glide) {   // turn to whichever copy of the app is nearer the front
      const n = r.cards.length, twin = r.cards[(card.idx + n / 2) % n];
      if (Math.abs(wrap(r.th[twin.idx] + r.phi)) < Math.abs(wrap(r.th[card.idx] + r.phi))) card = twin;
      r.to = r.phi - wrap(r.th[card.idx] + r.phi);
    }
    if (sel !== card) { sel?.classList.remove('is-on'); sel = card; card.classList.add('is-on'); }
    stage.classList.add('is-focus');
    capText.textContent = APPS[card.dataset.app][0];
    sync();
    if (reduced) { if (glide) r.phi = r.to; render(); paint(); }
    else wake();
  };
  const release = (delay = 650) => {
    clearTimeout(hold);
    hold = setTimeout(() => {
      sel?.classList.remove('is-on');
      sel = null;
      rings.forEach(r => { r.to = null; });
      stage.classList.remove('is-focus');
      sync();
      if (reduced) paint();
    }, delay);
  };
  let pointer = '';
  for (const c of cards) {
    c.addEventListener('pointerenter', e => { if (e.pointerType === 'mouse') select(c); });
    c.addEventListener('pointerleave', e => { if (e.pointerType === 'mouse') release(); });
    c.addEventListener('pointerdown', e => { pointer = e.pointerType; });
    // keyboard focus brings the card round to the front
    c.addEventListener('focus', () => { if (c.matches(':focus-visible')) select(c, true); });
    c.addEventListener('blur', () => release(400));
    c.addEventListener('click', () => {
      if (pointer === 'mouse') return;                      // hover already selected it
      select(c, true);
      if (pointer) release(6000);                           // touch: hold a while, then turn again
      pointer = '';
    });
  }

  // arrows move through the apps (left/right along a ring, up/down between rings) and choose them
  root.querySelector('.wl-rings').addEventListener('keydown', e => {
    const c = e.target.closest('.wl-c');
    if (!c) return;
    const r = c.ring, n = r.cards.length / 2;
    let next;
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      const step = e.key === 'ArrowRight' ? 1 : -1;   // dir flips which way the DOM order runs on screen
      next = orig[r.cards[((c.idx - r.dir * step) % n + n) % n].dataset.app];
    } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      const o = rings[e.key === 'ArrowUp' ? 0 : 1];
      next = orig[o.cards[o.front].dataset.app];
    } else return;
    e.preventDefault();
    next.focus();
    select(next, true);
  });

  const notesIn = glass(stage, notes, slots);

  roving(origs[0]);
  render();
  measure();
  new ResizeObserver(() => { measure(); paint(); }).observe(stage);

  if (reduced) {
    // static rings in their front arrangement; path drawn, notifications in
    notes.classList.add('is-on');
    stage.classList.add('is-hit');
    drawn(draw = 1, 1);
    paint();
    return;
  }

  // "stops cold" types in
  const text = typed.textContent;
  typed.textContent = '';
  const title = root.querySelector('.wl-title');
  onVisible(title, async () => {
    await sleep(650);
    await typeInto(typed, text, { speed: 62, jitter: 46 });
  }, { threshold: 0.6 });

  // inline app tiles flip through the other phone-only apps while the headline is on screen
  const flips = [...root.querySelectorAll('.wl-flip')];
  const shown = flips.map(f => f.firstElementChild.className);
  const pool = Object.values(icon).filter(i => !shown.includes(i.className)).map(i => i.cloneNode(true));
  const flip = async (f, i) => {
    await sleep(i * 120);
    await f.animate([{ transform: 'none' }, { transform: 'rotateX(90deg)' }],
      { duration: 190, easing: 'cubic-bezier(.55,0,.9,.45)' }).finished;
    pool.push(f.firstElementChild);
    f.replaceChildren(pool.shift());
    await f.animate([{ transform: 'rotateX(-90deg)' }, { transform: 'none' }],
      { duration: 620, easing: SPRING }).finished;
  };
  let timer = 0;
  onVisible(title, v => {
    clearInterval(timer);
    if (v) timer = setInterval(() => { pool.push(pool.shift()); flips.forEach(flip); }, 2200);
  }, { once: false, threshold: 0 });

  let raf = 0, last = 0, spd = 1, vis = false;   // the frame loop (below)

  // scroll: the path draws down to the rings and stops
  scrollProgress(stage, (p, r) => {
    const k = range(1 - r.top / innerHeight, 0.12, 0.58);
    draw = +ease(k).toFixed(4);
    drawn(draw, range(1 - r.top / innerHeight, 0.56, 0.72).toFixed(3));
    stage.classList.toggle('is-hit', k >= 1);
    if (!raf) paint();   // (the frame loop paints when it runs)
  });

  onVisible(notes, () => { notes.classList.add('is-on'); setTimeout(() => { live = true; notesIn(); }, 1400); }, { threshold: 0.3 });

  // rings turn only while on screen; hover/focus eases them to a stop, then the compositor takes them again
  const steered = () => sel || spd < .995 || rings.some(r => r.to !== null)
    || Math.abs(px - ax) > .05 || Math.abs(py - ay + stop) > .05;   // (the dot still on its way home)
  const frame = t => {
    const dt = Math.min(0.05, (t - (last || t)) / 1000);
    last = t;
    spd += ((sel ? 0 : 1) - spd) * (1 - Math.exp(-dt * 3.2));
    for (const r of rings) {
      if (r.to !== null) r.phi += (r.to - r.phi) * (1 - Math.exp(-dt * 6));
      else r.phi += r.dir * 360 / r.period * 1000 * spd * dt;
    }
    render();
    paint(dt);
    if (steered()) raf = requestAnimationFrame(frame);
    else { raf = 0; spd = 1; cruise(); }
  };
  wake = () => { if (vis && !raf) { last = 0; raf = requestAnimationFrame(frame); } };
  onVisible(stage, v => {
    vis = v;
    stage.classList.toggle('is-live', v);
    cancelAnimationFrame(raf);
    raf = 0;
    land();
    if (v) steered() ? wake() : cruise();
  }, { once: false, threshold: 0 });
}
