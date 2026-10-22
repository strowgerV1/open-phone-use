// The iPhone's display, drawn on a 2D canvas and used as the 3D screen texture.
// The robot's clip is 5 s: a tap at ~1.0 s (canvas uv .48,.56) and a downward swipe
// from v .35 → .63 between ~2.0 and 2.9 s. The UI is laid out so those touches land
// on real controls. Three loops make one story (15 s):
//   beat 0  ride app: "Your driver is here" → tap copies the plate, swipe pans the map
//   beat 1  messages: plate typed → tap sends it, swipe dismisses the keyboard
//   beat 2  ride app: trip started → tap shares the ETA, swipe pans the map
export const W = 540, H = 1168;
export const STORY = 15; // seconds
const F = '"Host Grotesk", -apple-system, "Helvetica Neue", sans-serif';
const MONO = '"Geist Mono", ui-monospace, Menlo, monospace';
const TAP = { u: 0.48, v: 0.56 };
const BLUE = '#0A84FF', INK = '#111214', MUTE = '#8A8A8E';

const ease = t => 1 - Math.pow(1 - Math.min(1, Math.max(0, t)), 3);
const inOut = t => { t = Math.min(1, Math.max(0, t)); return t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; };
const seg = (t, a, b) => Math.min(1, Math.max(0, (t - a) / (b - a)));

function rr(c, x, y, w, h, r) { c.beginPath(); c.roundRect(x, y, w, h, r); }

// one static map, larger than the screen so swipes can pan it. Built once, by the first screen; every screen shares it.
let map = null;
function makeMap() {
  const m = document.createElement('canvas'); m.width = W + 200; m.height = H + 500;
  const c = m.getContext('2d');
  c.fillStyle = '#EEF1EC'; c.fillRect(0, 0, m.width, m.height);
  c.fillStyle = '#D5EBC8'; rr(c, 380, 120, 260, 300, 26); c.fill(); // park
  c.fillStyle = '#C8E2F2'; c.beginPath(); c.moveTo(0, 980); c.bezierCurveTo(200, 900, 360, 1080, 740, 1010); c.lineTo(740, 1700); c.lineTo(0, 1700); c.fill(); // bay
  c.strokeStyle = '#FFFFFF'; c.lineCap = 'round';
  c.save(); c.translate(370, 600); c.rotate(-0.18);
  for (let i = -8; i <= 8; i++) { c.lineWidth = i % 3 ? 14 : 26; c.beginPath(); c.moveTo(i * 92, -900); c.lineTo(i * 92, 900); c.stroke(); }
  for (let j = -10; j <= 10; j++) { c.lineWidth = j % 4 ? 14 : 24; c.beginPath(); c.moveTo(-900, j * 84); c.lineTo(900, j * 84); c.stroke(); }
  c.restore();
  c.fillStyle = '#C9CDC6';
  c.font = `500 17px ${F}`; c.fillText('Mission St', 70, 560); c.fillText('Valencia', 420, 820); c.fillText('Dolores Park', 430, 270);
  return m;
}

export function createScreen() {
  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const c = canvas.getContext('2d');
  map ??= makeMap();
  let lastDraw = -1, wasDown = false, ripple = null, mapPan = 0, panFrom = 0, downV = 0, kb = 0;

  const statusBar = (dark = false) => {
    c.fillStyle = dark ? '#fff' : INK;
    c.font = `600 25px ${F}`; c.fillText('9:41', 50, 56);
    // signal, wifi, battery
    for (let i = 0; i < 4; i++) { rr(c, 382 + i * 9, 50 - 6 - i * 4, 6, 10 + i * 4, 2); c.fill(); }
    c.lineWidth = 3.4; c.strokeStyle = c.fillStyle; c.beginPath(); c.arc(436, 56, 16, -2.35, -0.79); c.stroke(); c.beginPath(); c.arc(436, 56, 8, -2.35, -0.79); c.stroke();
    c.lineWidth = 2; rr(c, 458, 39, 40, 20, 6); c.stroke(); rr(c, 461, 42, 30, 14, 3); c.fill(); rr(c, 500, 45, 3, 8, 1.5); c.fill();
  };

  const toast = (text, a, icon = '✓') => {
    if (a <= 0) return;
    c.save(); c.globalAlpha = a; c.translate(0, (1 - a) * -30);
    c.shadowColor = 'rgba(0,0,0,.18)'; c.shadowBlur = 30; c.shadowOffsetY = 8;
    c.fillStyle = 'rgba(28,28,30,.94)'; rr(c, 95, 92, 350, 64, 32); c.fill();
    c.shadowColor = 'transparent';
    c.fillStyle = '#34C759'; c.beginPath(); c.arc(132, 124, 15, 0, 7); c.fill();
    c.fillStyle = '#fff'; c.font = `700 18px ${F}`; c.textAlign = 'center'; c.fillText(icon, 132, 130);
    c.textAlign = 'left'; c.font = `600 22px ${F}`; c.fillText(text, 160, 132);
    c.restore();
  };

  const car = (x, y, rot) => {
    c.save(); c.translate(x, y); c.rotate(rot);
    c.shadowColor = 'rgba(0,0,0,.25)'; c.shadowBlur = 10; c.shadowOffsetY = 4;
    c.fillStyle = '#fff'; rr(c, -15, -26, 30, 52, 9); c.fill();
    c.shadowColor = 'transparent';
    c.fillStyle = INK; rr(c, -11, -17, 22, 12, 4); c.fill(); rr(c, -11, 8, 22, 9, 3); c.fill();
    c.restore();
  };

  const route = [[150, 860], [150, 700], [300, 640], [300, 470], [262, 380]];
  const along = (p) => { // point + heading along route at 0..1
    const lens = [], pts = route; let total = 0;
    for (let i = 1; i < pts.length; i++) { const l = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]); lens.push(l); total += l; }
    let d = p * total;
    for (let i = 0; i < lens.length; i++) {
      if (d <= lens[i] || i === lens.length - 1) { const k = Math.min(1, d / lens[i]); const a = pts[i], b = pts[i + 1]; return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, Math.atan2(b[1] - a[1], b[0] - a[0]) + Math.PI / 2]; }
      d -= lens[i];
    }
  };

  const rideApp = (t, trip) => {
    // map (pans with swipes)
    c.drawImage(map, -100, -260 + mapPan);
    c.save(); c.translate(0, mapPan * 0.999);
    c.lineWidth = 9; c.lineJoin = 'round'; c.lineCap = 'round';
    c.strokeStyle = trip ? BLUE : INK;
    c.beginPath(); route.forEach(([x, y], i) => i ? c.lineTo(x, y) : c.moveTo(x, y)); c.stroke();
    // pickup pin
    c.fillStyle = INK; c.beginPath(); c.arc(262, 380, 13, 0, 7); c.fill(); c.fillStyle = '#fff'; c.beginPath(); c.arc(262, 380, 5, 0, 7); c.fill();
    const p = trip ? 1 - ease(seg(t, 0, 4.6)) * 0.8 : ease(seg(t, 0, 0.9));
    const [x, y, r] = along(trip ? p : 0.15 + p * 0.85);
    car(trip ? x : x, y, r);
    c.restore();
    statusBar();
    // sheet
    const top = H * 0.47;
    c.shadowColor = 'rgba(0,0,0,.12)'; c.shadowBlur = 40; c.shadowOffsetY = -6;
    c.fillStyle = '#fff'; rr(c, 0, top, W, H - top + 40, [34, 34, 0, 0]); c.fill();
    c.shadowColor = 'transparent';
    c.fillStyle = '#D1D1D6'; rr(c, W / 2 - 30, top + 12, 60, 7, 4); c.fill();
    c.fillStyle = INK; c.font = `700 36px ${F}`; c.textAlign = 'center';
    c.fillText(trip ? 'On the way to SFO' : 'Your driver is here', W / 2, top + 64);
    if (!trip) {
      // plate pill — where the stylus taps
      const tapped = seg(t, 0.98, 1.08), pulse = tapped * (1 - seg(t, 1.25, 1.6));
      const pw = 270, ph = 66, px = TAP.u * W - pw / 2, py = TAP.v * H - ph / 2;
      c.fillStyle = pulse ? `rgba(10,132,255,${0.1 + 0.15 * pulse})` : '#F2F2F7'; rr(c, px, py, pw, ph, 14); c.fill();
      c.strokeStyle = pulse ? BLUE : '#E5E5EA'; c.lineWidth = 2; rr(c, px, py, pw, ph, 14); c.stroke();
      c.fillStyle = INK; c.font = `600 34px ${MONO}`; c.fillText('8KXL 204', TAP.u * W, py + 45);
      c.fillStyle = MUTE; c.font = `500 22px ${F}`; c.fillText('Grey Toyota Camry', W / 2, py + ph + 42);
    } else {
      const shared = seg(t, 0.98, 1.08);
      const pw = 270, ph = 66, px = TAP.u * W - pw / 2, py = TAP.v * H - ph / 2;
      c.fillStyle = shared ? '#34C759' : BLUE; rr(c, px, py, pw, ph, 33); c.fill();
      c.fillStyle = '#fff'; c.font = `600 24px ${F}`; c.fillText(shared ? 'ETA shared' : 'Share ETA', TAP.u * W, py + 42);
      c.fillStyle = MUTE; c.font = `500 22px ${F}`; c.fillText('Arrives 10:05 · 24 min', W / 2, py + ph + 42);
    }
    // driver row
    const ry = H * 0.7;
    c.textAlign = 'left';
    c.fillStyle = '#E9E3D8'; c.beginPath(); c.arc(78, ry + 34, 34, 0, 7); c.fill();
    c.fillStyle = '#8B7355'; c.beginPath(); c.arc(78, ry + 26, 13, 0, 7); c.fill(); c.beginPath(); c.ellipse(78, ry + 58, 22, 14, 0, Math.PI, 0); c.fill();
    c.fillStyle = INK; c.font = `600 25px ${F}`; c.fillText('Marco', 128, ry + 28);
    c.fillStyle = MUTE; c.font = `500 20px ${F}`; c.fillText('4.97 · 2,140 trips', 128, ry + 56);
    // action buttons
    const by = H * 0.81;
    [['Message', 40], ['Call', 280]].forEach(([l, x]) => { c.fillStyle = '#F2F2F7'; rr(c, x, by, 220, 64, 18); c.fill(); c.fillStyle = INK; c.font = `600 22px ${F}`; c.textAlign = 'center'; c.fillText(l, x + 110, by + 40); });
    c.textAlign = 'left';
    c.fillStyle = '#111'; rr(c, W / 2 - 70, H - 22, 140, 6, 3); c.fill(); // home indicator
    toast(trip ? 'ETA sent to Maya' : 'Plate copied', trip ? seg(t, 1.1, 1.35) * (1 - seg(t, 3.0, 3.4)) : seg(t, 1.1, 1.35) * (1 - seg(t, 3.0, 3.4)));
    c.textAlign = 'left';
  };

  const bubble = (text, x, y, out, a = 1, maxW = 330) => {
    c.font = `500 25px ${F}`;
    const words = text.split(' '), lines = []; let line = '';
    for (const w of words) { const t2 = line ? line + ' ' + w : w; if (c.measureText(t2).width > maxW - 40 && line) { lines.push(line); line = w; } else line = t2; }
    lines.push(line);
    const bw = Math.min(maxW, Math.max(...lines.map(l => c.measureText(l).width)) + 40), bh = lines.length * 32 + 22;
    const bx = out ? W - 28 - bw : 28;
    c.save(); c.globalAlpha = a; c.translate(0, (1 - a) * 18);
    c.fillStyle = out ? BLUE : '#E9E9EB'; rr(c, bx, y, bw, bh, 22); c.fill();
    c.fillStyle = out ? '#fff' : INK;
    lines.forEach((l, i) => c.fillText(l, bx + 20, y + 38 + i * 32));
    c.restore();
    return bh;
  };

  const messages = (t) => {
    c.fillStyle = '#fff'; c.fillRect(0, 0, W, H);
    statusBar();
    // header
    c.fillStyle = '#F7F7F8'; c.fillRect(0, 0, W, 190); c.fillStyle = '#E5E5EA'; c.fillRect(0, 190, W, 1.5);
    statusBar();
    c.strokeStyle = BLUE; c.lineWidth = 4; c.lineCap = 'round'; c.beginPath(); c.moveTo(48, 110); c.lineTo(34, 124); c.lineTo(48, 138); c.stroke();
    c.fillStyle = '#C7B8F0'; c.beginPath(); c.arc(W / 2, 118, 34, 0, 7); c.fill();
    c.fillStyle = '#fff'; c.font = `600 28px ${F}`; c.textAlign = 'center'; c.fillText('M', W / 2, 128);
    c.fillStyle = INK; c.font = `500 19px ${F}`; c.fillText('Maya (guest)', W / 2, 176); c.textAlign = 'left';
    c.fillStyle = MUTE; c.font = `500 18px ${F}`; c.textAlign = 'center'; c.fillText('Today 9:39', W / 2, 238); c.textAlign = 'left';
    let y = 262;
    y += bubble("I'm in the lobby. Which car is mine?", 0, y, false) + 14;
    const sent = seg(t, 1.0, 1.25);
    const msg = 'Look for a grey Camry, plate 8KXL 204';
    if (sent > 0) { y += bubble(msg, 0, y, true, ease(sent)) + 8; c.fillStyle = MUTE; c.font = `500 17px ${F}`; c.textAlign = 'right'; c.globalAlpha = seg(t, 1.4, 1.7); c.fillText('Delivered', W - 32, y + 14); c.globalAlpha = 1; c.textAlign = 'left'; y += 30; }
    // typing indicator after keyboard is gone
    const typing = seg(t, 3.2, 3.4);
    if (typing > 0) { c.globalAlpha = typing; c.fillStyle = '#E9E9EB'; rr(c, 28, y + 10, 92, 52, 26); c.fill(); for (let i = 0; i < 3; i++) { c.fillStyle = `rgba(110,110,115,${0.4 + 0.6 * Math.abs(Math.sin(t * 5 + i))})`; c.beginPath(); c.arc(54 + i * 20, y + 36, 6, 0, 7); c.fill(); } c.globalAlpha = 1; }
    // keyboard: up at TAP.v, dismissed by the swipe
    const kbTop = H * 0.6 + kb;
    const composerY = Math.min(H - 110, kbTop - 92);
    c.fillStyle = '#fff'; c.fillRect(0, composerY - 12, W, 110);
    c.strokeStyle = '#D1D1D6'; c.lineWidth = 2; rr(c, 78, composerY, 400, 62, 31); c.stroke();
    c.fillStyle = '#D1D1D6'; c.beginPath(); c.arc(44, composerY + 31, 22, 0, 7); c.fill(); c.fillStyle = '#fff'; c.fillRect(42, composerY + 21, 4, 20); c.fillRect(34, composerY + 29, 20, 4);
    const typed = sent > 0 ? '' : msg.slice(0, Math.floor(msg.length * seg(t, 0.05, 0.85)));
    c.font = `500 23px ${F}`; c.fillStyle = typed ? INK : '#B0B0B5';
    let shown = typed || 'iMessage'; while (c.measureText(shown).width > 320) shown = shown.slice(1);
    c.fillText(shown, 100, composerY + 40);
    if (typed && Math.floor(t * 3) % 2) { c.fillStyle = BLUE; c.fillRect(102 + c.measureText(shown).width, composerY + 16, 3, 32); }
    if (typed) { c.fillStyle = BLUE; c.beginPath(); c.arc(447, composerY + 31, 22, 0, 7); c.fill(); c.strokeStyle = '#fff'; c.lineWidth = 4; c.beginPath(); c.moveTo(447, composerY + 42); c.lineTo(447, composerY + 20); c.moveTo(437, composerY + 30); c.lineTo(447, composerY + 20); c.lineTo(457, composerY + 30); c.stroke(); }
    if (kbTop < H) {
      c.fillStyle = '#D3D5DB'; c.fillRect(0, kbTop, W, H - kbTop + 400);
      const rows = ['qwertyuiop', 'asdfghjkl', 'zxcvbnm'];
      c.font = `400 26px ${F}`; c.textAlign = 'center';
      rows.forEach((r, ri) => { const kw = 46, gap = 7, total = r.length * kw + (r.length - 1) * gap, x0 = (W - total) / 2; for (let i = 0; i < r.length; i++) { c.fillStyle = '#fff'; rr(c, x0 + i * (kw + gap), kbTop + 18 + ri * 78, kw, 62, 8); c.fill(); c.fillStyle = INK; c.fillText(r[i], x0 + i * (kw + gap) + kw / 2, kbTop + 58 + ri * 78); } });
      c.fillStyle = '#fff'; rr(c, 130, kbTop + 252, 280, 62, 8); c.fill(); c.fillStyle = INK; c.font = `400 22px ${F}`; c.fillText('space', W / 2, kbTop + 290);
      c.textAlign = 'left';
    }
    c.fillStyle = '#111'; rr(c, W / 2 - 70, H - 22, 140, 6, 3); c.fill();
  };

  function draw(time, touch) {
    // ~30 fps is plenty for a phone the size of a postage stamp on screen
    if (lastDraw >= 0 && time - lastDraw < 1 / 30 && touch.down === wasDown) return false;
    lastDraw = time;
    const beat = Math.floor(time / 5) % 3, t = time % 5;
    // touch → ripple / pan / keyboard drag
    if (touch.down && !wasDown) { ripple = { u: touch.u, v: touch.v, t0: time }; downV = touch.v; panFrom = mapPan; }
    if (touch.down && t > 1.8) { // swipe
      const d = (touch.v - downV) * H;
      if (beat === 1) kb = Math.max(0, d); else mapPan = panFrom + d * 0.9;
      if (ripple) { ripple.u = touch.u; ripple.v = touch.v; }
    }
    if (!touch.down && beat === 1 && t > 2.9) kb += (H - kb) * 0.25; // keyboard finishes sliding away
    if (beat === 1 && t < 0.2) kb = 0;
    if (t < 0.15) { mapPan += (0 - mapPan) * 0.3; }
    wasDown = touch.down;

    c.save();
    // app switch: slide between beats
    const outro = seg(t, 4.55, 5);
    if (beat === 1) messages(t); else rideApp(t, beat === 2);
    if (outro > 0) { c.fillStyle = `rgba(255,255,255,${inOut(outro)})`; c.fillRect(0, 0, W, H); }
    const intro = 1 - seg(t, 0, 0.35);
    if (intro > 0) { c.fillStyle = `rgba(255,255,255,${intro})`; c.fillRect(0, 0, W, H); }
    // finger contact
    if (ripple) {
      const age = time - ripple.t0, x = ripple.u * W, y = ripple.v * H;
      if (touch.down) { c.fillStyle = 'rgba(255,79,20,.28)'; c.beginPath(); c.arc(x, y, 30, 0, 7); c.fill(); c.strokeStyle = 'rgba(255,79,20,.9)'; c.lineWidth = 3; c.stroke(); }
      const r = 30 + age * 160, a = Math.max(0, 0.6 - age * 0.9);
      if (a > 0) { c.strokeStyle = `rgba(255,79,20,${a})`; c.lineWidth = 4; c.beginPath(); c.arc(x, y, r, 0, 7); c.stroke(); }
      else if (!touch.down) ripple = null;
    }
    c.restore();
    return true;
  }

  // the first frame of each app pays one-off costs (text shaping, shadows, the map's first blit: ~100 ms on a slow
  // phone, a hitch just as the machine comes alive). Pay them while idle instead, before anything shows the screen.
  (window.requestIdleCallback || setTimeout)(() => {
    if (lastDraw >= 0) return;
    for (const t of [0.5, 5.5, 10.5]) { lastDraw = -1; draw(t, { u: 0.5, v: 0.5, down: false }); }
    lastDraw = -1; mapPan = kb = 0;
  });

  return { canvas, draw };
}
