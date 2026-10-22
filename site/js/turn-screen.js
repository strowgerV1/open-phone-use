// The iPhone display for "So we gave agents a phone." — one screen per step:
//   -1 the intro: the posted story, still   0 lock screen + "Claude connected"   1 the task arrives   2 the story gets posted
// Drawn in 428×926 iPhone points at 1.5× for the close-up.
const BW = 428, BH = 926, K = 1.5;
const F = '"Host Grotesk", -apple-system, "Helvetica Neue", sans-serif';
const MONO = '"Geist Mono", ui-monospace, Menlo, monospace';
const clamp01 = t => Math.min(1, Math.max(0, t));
const seg = (t, a, b) => clamp01((t - a) / (b - a));
const ease = t => 1 - Math.pow(1 - clamp01(t), 3);
const TASK = "Post today's menu photo to our Instagram story and tag the chef.";

export function createTurnScreen() {
  const canvas = document.createElement('canvas');
  canvas.width = BW * K; canvas.height = BH * K;
  const c = canvas.getContext('2d');
  let step = 0, stepAt = 0, last = -1, wasDown = false, ripple = null, agent = 'Claude', still = false;
  const api = { canvas, wallpaper: null, draw, setStep, setAgent: a => { agent = a; } };

  function setStep(i, time) { if (i !== step) { step = i; stepAt = time ?? last; still = false; } }

  const rr = (x, y, w, h, r) => { c.beginPath(); c.roundRect(x, y, w, h, r); };
  const wrap = (text, maxW) => { const out = []; let line = ''; for (const w of text.split(' ')) { const t = line ? line + ' ' + w : w; if (c.measureText(t).width > maxW && line) { out.push(line); line = w; } else line = t; } out.push(line); return out; };

  const status = (light = true) => {
    c.fillStyle = light ? '#fff' : '#111';
    c.font = `600 16px ${F}`; c.fillText('9:41', 36, 33);
    for (let i = 0; i < 4; i++) { rr(318 + i * 6, 30 - 4 - i * 2.6, 4, 6 + i * 2.6, 1.2); c.fill(); }
    c.lineWidth = 1.4; c.strokeStyle = c.fillStyle; rr(352, 21, 25, 12, 4); c.stroke(); rr(354, 23, 18, 8, 2); c.fill();
  };

  const wallpaper = () => {
    if (api.wallpaper) c.drawImage(api.wallpaper, 0, 0, BW, BH);
    else { const g = c.createLinearGradient(0, 0, BW, BH); g.addColorStop(0, '#9ccbb7'); g.addColorStop(1, '#2f6b5e'); c.fillStyle = g; c.fillRect(0, 0, BW, BH); }
    c.fillStyle = 'rgba(0,0,0,.12)'; c.fillRect(0, 0, BW, BH);
  };

  const logo = (x, y, s = 1) => { // STROWGER app icon
    c.save(); c.translate(x, y); c.scale(s, s);
    c.fillStyle = '#121314'; rr(0, 0, 30, 30, 8); c.fill();
    c.strokeStyle = '#fff'; c.lineWidth = 1.6; rr(10, 5, 10, 20, 3); c.stroke();
    c.fillStyle = '#FF4F14'; c.beginPath(); c.arc(15, 16, 2.4, 0, 7); c.fill();
    c.restore();
  };

  // a glass lock-screen notification, centred on y
  const note = (y, title, body, a, sub = 'now') => {
    if (a <= 0) return 0;
    c.font = `400 14.5px ${F}`;
    const lines = wrap(body, 300), h = 62 + lines.length * 19;
    c.save(); c.globalAlpha = a; c.translate(0, (1 - a) * 24);
    c.fillStyle = 'rgba(245,245,245,.78)'; rr(14, y, BW - 28, h, 22); c.fill();
    logo(28, y + 14, 1.05);
    c.fillStyle = '#111'; c.font = `600 15px ${F}`; c.fillText(title, 70, y + 30);
    c.fillStyle = 'rgba(60,60,67,.6)'; c.font = `400 13px ${F}`; c.textAlign = 'right'; c.fillText(sub, BW - 30, y + 30); c.textAlign = 'left';
    c.fillStyle = '#222'; c.font = `400 14.5px ${F}`; lines.forEach((l, i) => c.fillText(l, 70, y + 52 + i * 19));
    c.restore();
    return h;
  };

  const lock = (t, withTask) => {
    wallpaper();
    status();
    c.fillStyle = '#fff'; c.textAlign = 'center';
    c.font = `500 17px ${F}`; c.fillText('Tuesday, October 14', BW / 2, 104);
    c.font = `600 92px ${F}`; c.fillText('9:41', BW / 2, 196);
    c.textAlign = 'left';
    // notifications sit low, where the stylus taps (v ≈ .56)
    const y0 = 470;
    if (!withTask) note(y0, 'STROWGER', `${agent} connected. iPhone #07 is ready for tasks.`, ease(seg(t, 0.3, 0.9)));
    else {
      note(y0 - 96, 'STROWGER', `${agent} connected. iPhone #07 is ready for tasks.`, 0.55);
      note(y0, `New task from ${agent}`, TASK, ease(seg(t, 0.6, 1.2)), 'now');
    }
    // flashlight / camera buttons + home bar
    [[58, BH - 92], [BW - 58, BH - 92]].forEach(([x, y]) => { c.fillStyle = 'rgba(0,0,0,.28)'; c.beginPath(); c.arc(x, y, 25, 0, 7); c.fill(); });
    c.fillStyle = '#fff'; rr(BW / 2 - 67, BH - 14, 134, 5, 3); c.fill();
  };

  // story composer, as in the design: shakshuka on a wooden table, the @chef.ana mention sticker, share
  const EGGS = [[-75, -58], [54, -37], [-22, 65]]; // around the pan's centre
  const story = t => {
    // photo: wood planks, a round of bread, the pan with three eggs
    c.fillStyle = '#7b4b2b'; c.fillRect(0, 0, BW, BH);
    c.save(); c.rotate(0.1);
    for (let i = -2; i < 9; i++) { c.fillStyle = i % 2 ? 'rgba(255,214,170,.07)' : 'rgba(40,16,4,.12)'; c.fillRect(i * 66, -80, 64, BH + 160); c.fillStyle = 'rgba(30,10,2,.4)'; c.fillRect(i * 66 + 64, -80, 2, BH + 160); }
    c.restore();
    c.save(); c.translate(352, 146); c.rotate(-0.35);
    c.fillStyle = 'rgba(0,0,0,.3)'; c.beginPath(); c.ellipse(8, 14, 96, 66, 0, 0, 7); c.fill();
    const bread = c.createRadialGradient(-30, -24, 8, 0, 0, 100); bread.addColorStop(0, '#f5e6b8'); bread.addColorStop(1, '#c9a058');
    c.fillStyle = bread; c.beginPath(); c.ellipse(0, 0, 94, 64, 0, 0, 7); c.fill();
    c.restore();
    c.save(); c.translate(216, 466);
    c.fillStyle = 'rgba(0,0,0,.35)'; c.beginPath(); c.arc(8, 16, 208, 0, 7); c.fill();
    c.fillStyle = '#1e1b19'; c.beginPath(); c.arc(0, 0, 205, 0, 7); c.fill();
    const sauce = c.createRadialGradient(-40, -50, 20, 0, 0, 180); sauce.addColorStop(0, '#e9622f'); sauce.addColorStop(1, '#bd391a');
    c.fillStyle = sauce; c.beginPath(); c.arc(0, 0, 178, 0, 7); c.fill();
    [[-112, 40, 15], [118, 100, 22], [100, -110, 13], [-40, 140, 12]].forEach(([x, y, r]) => { c.fillStyle = 'rgba(130,30,12,.55)'; c.beginPath(); c.arc(x, y, r, 0, 7); c.fill(); });
    for (const [x, y] of EGGS) {
      c.fillStyle = 'rgba(90,20,0,.3)'; c.beginPath(); c.ellipse(x + 4, y + 6, 64, 54, 0.2, 0, 7); c.fill();
      c.fillStyle = '#fbf7ee'; c.beginPath(); c.ellipse(x, y, 64, 54, 0.2, 0, 7); c.ellipse(x + 14, y + 8, 50, 44, -0.3, 0, 7); c.fill();
      const yolk = c.createRadialGradient(x - 8, y - 9, 3, x, y, 27); yolk.addColorStop(0, '#ffd84a'); yolk.addColorStop(1, '#f39b12');
      c.fillStyle = yolk; c.beginPath(); c.arc(x, y, 26, 0, 7); c.fill();
    }
    [[-150, 10], [-10, -120], [96, 20], [70, 130], [-118, -40], [30, 92]].forEach(([x, y], i) => { c.fillStyle = i % 3 ? '#3f7d2a' : '#fff'; c.beginPath(); c.arc(x, y, i % 3 ? 5 : 4, 0, 7); c.fill(); });
    c.restore();
    status();
    // top tools: close · text, sticker, music, effects
    c.save(); c.strokeStyle = c.fillStyle = '#fff'; c.lineWidth = 2.6; c.lineCap = c.lineJoin = 'round';
    c.shadowColor = 'rgba(0,0,0,.35)'; c.shadowBlur = 6;
    const ty = 70;
    c.beginPath(); c.moveTo(27, ty - 9); c.lineTo(45, ty + 9); c.moveTo(45, ty - 9); c.lineTo(27, ty + 9); c.stroke();
    c.font = `700 19px ${F}`; c.textAlign = 'center'; c.fillText('Aa', 252, ty + 7);
    rr(288, ty - 11, 22, 22, 7); c.stroke(); c.beginPath(); c.arc(299, ty + 1, 5.5, 0.3, Math.PI - 0.3); c.stroke();
    c.beginPath(); c.moveTo(340, ty + 6); c.lineTo(340, ty - 10); c.lineTo(354, ty - 13); c.lineTo(354, ty + 3); c.stroke();
    c.beginPath(); c.arc(336, ty + 7, 4.5, 0, 7); c.stroke(); c.beginPath(); c.arc(350, ty + 4, 4.5, 0, 7); c.stroke();
    c.beginPath(); c.moveTo(393, ty - 12); [[405, ty], [393, ty + 12], [381, ty], [393, ty - 12]].forEach(([x, y]) => c.quadraticCurveTo(393, ty, x, y)); c.stroke();
    c.restore();
    // mention sticker appears
    const tag = ease(seg(t, 1.1, 1.6));
    if (tag > 0) {
      c.save(); c.translate(130, 222); c.rotate(-0.1); c.scale(0.6 + 0.4 * tag, 0.6 + 0.4 * tag); c.globalAlpha = tag;
      c.shadowColor = 'rgba(0,0,0,.25)'; c.shadowBlur = 10; c.shadowOffsetY = 3;
      c.fillStyle = '#fff'; rr(-78, -24, 156, 48, 12); c.fill(); c.shadowColor = 'transparent';
      const tg = c.createLinearGradient(-60, 0, 60, 0); tg.addColorStop(0, '#f77737'); tg.addColorStop(1, '#d62976');
      c.fillStyle = tg; c.font = `700 23px ${F}`; c.textAlign = 'center'; c.fillText('@chef.ana', 0, 8); c.restore();
    }
    // bottom: your story / close friends
    const shared = seg(t, 2.6, 2.75);
    c.fillStyle = 'rgba(0,0,0,.35)'; c.fillRect(0, BH - 96, BW, 96);
    c.fillStyle = '#fff'; rr(18, BH - 76, 186, 48, 24); c.fill();
    c.fillStyle = '#111'; c.font = `600 15px ${F}`; c.fillText(shared ? 'Shared' : 'Your story', 66, BH - 46);
    c.fillStyle = '#d6249f'; c.beginPath(); c.arc(42, BH - 52, 13, 0, 7); c.fill();
    c.fillStyle = '#fff'; rr(214, BH - 76, 150, 48, 24); c.fill(); c.fillStyle = '#111'; c.fillText('Close friends', 236, BH - 46);
    c.fillStyle = '#fff'; c.beginPath(); c.arc(BW - 34, BH - 52, 22, 0, 7); c.fill();
    c.strokeStyle = '#111'; c.lineWidth = 2.4; c.beginPath(); c.moveTo(BW - 42, BH - 52); c.lineTo(BW - 26, BH - 52); c.moveTo(BW - 32, BH - 58); c.lineTo(BW - 26, BH - 52); c.lineTo(BW - 32, BH - 46); c.stroke();
    // toast
    const toast = seg(t, 2.8, 3.1) * (1 - seg(t, 4.4, 4.7));
    if (toast > 0) {
      c.save(); c.globalAlpha = toast; c.translate(0, (1 - toast) * -16);
      c.fillStyle = 'rgba(20,20,22,.9)'; rr(64, 96, 300, 46, 23); c.fill();
      c.fillStyle = '#34C759'; c.beginPath(); c.arc(90, 119, 11, 0, 7); c.fill();
      c.strokeStyle = '#fff'; c.lineWidth = 2.2; c.beginPath(); c.moveTo(85, 119); c.lineTo(89, 123); c.lineTo(96, 115); c.stroke();
      c.fillStyle = '#fff'; c.font = `600 15px ${F}`; c.fillText('Shared to your story', 110, 124);
      c.restore();
    }
  };

  function draw(time, touch) {
    if (step < 0) { // the result first: the story with its @chef.ana sticker, drawn once, no stylus
      if (still) return false;
      still = true; ripple = null; wasDown = touch.down;
      c.setTransform(K, 0, 0, K, 0, 0);
      story(2.4);
      return true;
    }
    if (last >= 0 && time - last < 1 / 30 && touch.down === wasDown) return false;
    last = time;
    const t = time - stepAt;
    if (touch.down && !wasDown) ripple = { u: touch.u, v: touch.v, t0: time };
    if (touch.down && ripple) { ripple.u = touch.u; ripple.v = touch.v; }
    wasDown = touch.down;

    c.setTransform(K, 0, 0, K, 0, 0);
    if (step === 2) story(t % 5.2); else lock(t, step === 1);
    // cross-fade between steps
    const fade = 1 - seg(t, 0, 0.35);
    if (fade > 0) { c.fillStyle = `rgba(0,0,0,${fade * 0.6})`; c.fillRect(0, 0, BW, BH); }
    // the stylus contact
    if (ripple) {
      const age = time - ripple.t0, x = ripple.u * BW, y = ripple.v * BH;
      if (touch.down) { c.fillStyle = 'rgba(255,79,20,.3)'; c.beginPath(); c.arc(x, y, 20, 0, 7); c.fill(); c.strokeStyle = 'rgba(255,79,20,.95)'; c.lineWidth = 2; c.stroke(); }
      const a = Math.max(0, 0.6 - age * 0.9);
      if (a > 0) { c.strokeStyle = `rgba(255,79,20,${a})`; c.lineWidth = 2.5; c.beginPath(); c.arc(x, y, 20 + age * 110, 0, 7); c.stroke(); }
      else if (!touch.down) ripple = null;
    }
    return true;
  }

  return api;
}
