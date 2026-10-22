// Inspect mode, behind the page: the STROWGER rack room. Opened by js/xray.js once the page has x-rayed:
//   const w = await open({ canvas, hud, y0, transition }); await w.enter(); … const y = await w.leave(); w.stop(); w.dispose();
// The page hangs in an aisle at night as one screen per section, in page order, alternating sides (images by
// dev/xray-shots.mjs: the x-ray look, plus the page as it is, which a screen wakes up to when you stop at it).
// Racks of robots line the aisle: the tapper machine with its phone in the cradle, instanced as a low-poly proxy,
// their screens lighting up blue (cloud) or orange (real) as agents use them, like the rack wall in js/closing.js.
// The first unit, on a plinth, is the full phoneuse.glb with its phone running the hero's UI.
// enter(): the x-rayed page is swapped for its screen, face-on and pixel for pixel. A view transition keeps the page's
// own picture on top, warped to follow the screen, until the camera has moved (so live states the images can't
// have — a stuck panel, another window size — never show as a jump); then the camera pulls back into the aisle as
// the lights come on. Wheel / touch / arrow keys fly FORWARD down it: a straight line along the aisle (never sideways,
// never a scroll), the screens swinging round to face you as you come up on them, speed streaks, banking and a wider
// lens when you go fast. leave() flies back to the screen you're at and lines it up with the page again. Everything is
// built on open and disposed on close.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { loadModel } from './machine.js';
import { createScreen } from './phone-screen.js';
import { reduced, clamp, sleep } from './core.js';

const SHOTS = new URL('../assets/xray/', import.meta.url).href;
const BG = 0x04070a, FOG = 0x0a1118, FOG_TO = 44;   // m: past FOG_TO everything is the fog colour
// the room, in metres: screens hang SP apart down the aisle (−z), bottom edge at B; racks face the aisle
const SP = 6, B = 0.55, CAB = 0.8, CAB_D = 0.9, CAB_H = 1.86, SHELVES = [0.12, 0.52, 0.92, 1.32];
const T_IN = 2.5, T_OUT = 1.5;   // s: the reveal, the way back
const EYE = 1.6, DZ = 5.2;   // the flight: eye height; how far short of a screen the camera stops to read it
const Y = new THREE.Vector3(0, 1, 0);
const ease = t => t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
const win = (t, a, b) => ease(clamp((t - a) / (b - a)));
let seed = 7;   // reset on every open: the same room each time
const rng = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;

// ---- how much this machine gets, judged once: 0 full (as designed), 1 lite (≤ 4 cores or an integrated GPU: no
// MSAA, pixel ratio ≤ 1.25), 2 off (software rendering: the page stays in its x-ray). ?xrtier=0|1|2 forces one.
// Within a tier, a frame watchdog (open → watch) steps quality down while flight frames run long.
let TIER = null, learned = null;   // learned: where the watchdog got to last time, so a reopen starts there
function tier() {
  if (TIER !== null) return TIER;
  const forced = new URLSearchParams(location.search).get('xrtier');
  if (forced) return TIER = clamp(Math.round(+forced) || 0, 0, 2);
  let gpu = '';
  try {   // a throwaway context: the real one's antialias has to be chosen before it exists
    const gl = document.createElement('canvas').getContext('webgl', { failIfMajorPerformanceCaveat: true, powerPreference: 'high-performance' });
    if (!gl) return TIER = 2;   // no WebGL, or only a software one
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    gpu = String(gl.getParameter(ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER));
    gl.getExtension('WEBGL_lose_context')?.loseContext();
  } catch { return TIER = 2; }
  return TIER = /swiftshader|llvmpipe|softpipe|lavapipe|software|basic render/i.test(gpu) ? 2
    : navigator.hardwareConcurrency <= 4 || /intel(?!.*\barc\b)|mali|adreno|powervr|vivante|videocore|radeon(\(tm\))?( vega \d+| \d{3}m)? graphics/i.test(gpu) ? 1 : 0;
}

// The rack robots. phoneuse.glb is ~131k triangles, so each unit is a box proxy of its frame, measured off the model
// (voxelised at 1 cm, then picked by hand): base and cradle rails, the tapper's axis and carriage, the camera
// gantry, the phone. [centre x, y, z, size x, y, z, part] in model metres; part 0 frame · 1 phone · 2 head · 3 tapper.
const PROXY = [
  [-0.135, 0.02, 0, 0.025, 0.03, 0.37, 0], [0.125, 0.02, 0, 0.025, 0.03, 0.37, 0],
  [-0.005, 0.02, 0.165, 0.26, 0.03, 0.03, 0], [-0.005, 0.02, -0.17, 0.26, 0.03, 0.03, 0],
  [-0.085, 0.035, 0.01, 0.03, 0.03, 0.33, 0], [0.005, 0.035, 0.01, 0.03, 0.03, 0.33, 0],
  [0.085, 0.07, 0.01, 0.03, 0.04, 0.4, 0],
  [-0.135, 0.115, -0.15, 0.025, 0.2, 0.025, 0], [-0.135, 0.115, 0.14, 0.025, 0.2, 0.025, 0], [-0.135, 0.205, -0.005, 0.025, 0.025, 0.315, 0],
  [-0.08, 0.2, -0.05, 0.11, 0.02, 0.05, 0], [-0.05, 0.168, -0.053, 0.04, 0.04, 0.04, 3],
  [0.099, 0.12, 0.014, 0.055, 0.057, 0.034, 2], [0.011, 0.091, 0.014, 0.107, 0.02, 0.012, 0],
  [0.07, 0.035, 0.165, 0.1, 0.035, 0.035, 0], [-0.037, 0.058, 0, 0.1, 0.012, 0.205, 1],
];
const DISPLAY = [-0.037, 0.0648, 0, 0.091, 0.197];   // the phone's screen: centre x, y, z, width, length

// what the rack's agents are doing, for the hover note: [prompt, …steps]. Real units hold one of PHONES.
const PHONES = ['iPhone 15 Pro', 'iPhone 15', 'iPhone 14', 'iPhone 13', 'Galaxy S24', 'Pixel 8'];
const JOBS = [
  ['When the driver is here, text the guest the plate number.', 'opened uber · read “driver is here” · 8KXL 204', 'sent imessage “look for 8KXL 204”', 'shared the ETA with the guest'],
  ['Post today’s menu photo to our Instagram story and tag the chef.', 'opened instagram · uploaded menu.jpg', 'tagged @chef.ana', 'story posted'],
  ['Read the Google code from SMS and finish the sign-up.', 'waiting for sms · from 32665', 'code 382 019 · entered it', 'account verified'],
  ['Order dinner from Kebab House on the saved card.', 'opened zomato · added 2 items', 'paid ₹640 · order placed', 'rider assigned · 28 min'],
  ['Get the Airbnb door code and send it to the group.', 'opened the trip · read Elena’s message', 'door code · 4821', 'sent it to “Tahoe weekend”'],
  ['Approve the Chase sign-in and download September’s statement.', 'approved sign-in on this device', 'opened statements · september', 'saved statement.pdf'],
  ['Reply to Maya on WhatsApp and share my live location.', 'read 2 new messages from maya', 'replied “on my way”', 'shared live location · 1 h'],
  ['Post the launch video to TikTok with the caption.', 'opened tiktok · uploaded launch.mp4', 'added caption and 4 tags', 'posted · 0 views'],
  ['Book a Lyft to SFO for 6:40 tomorrow.', 'opened lyft · pickup 6:40 am', 'chose standard · $38', 'ride scheduled'],
  ['Keep the Snapchat streak with today’s photo.', 'opened snapchat · camera', 'sent a snap to riya', 'streak · 113 days'],
];

// ---- the screens' images: fetched and decoded off the main thread, kept until the mode closes
let pre = null;   // { set: Promise<manifest set>, bm: Map<file, Promise<ImageBitmap>> }
const bitmap = file => {
  if (!pre.bm.has(file)) pre.bm.set(file, fetch(SHOTS + file).then(r => { if (!r.ok) throw new Error(file); return r.blob(); }).then(b => createImageBitmap(b, { imageOrientation: 'flipY' })));
  return pre.bm.get(file);
};
// Starts the downloads: the manifest, the aisle set, and the full-size shots of what's on screen now.
export function prefetch() {
  if (tier() > 1) return Promise.resolve(null);   // the room won't open here: nothing to fetch
  if (!pre) {
    pre = { bm: new Map(), set: fetch(SHOTS + 'manifest.json').then(r => r.json()).then(j => j[innerWidth < 700 ? 'mobile' : 'desktop']) };
    pre.set.then(m => {
      for (const b of m.bands) b['x-lo'].forEach(([f]) => bitmap(f));
      const sc = m.w / document.documentElement.clientWidth;   // roughly: the bands around the scroll position
      for (const b of m.bands) if (b.y < (scrollY + innerHeight) * sc && b.y + b.h > scrollY * sc) b['x-hi'].forEach(([f]) => bitmap(f));
    }).catch(() => { pre = null; });
  }
  return pre.set;
}

// ---- small builders
function boxes(list, colors, parts) {   // [cx, cy, cz, sx, sy, sz, part] → one geometry (vertex colours by part; parts: an aPart attribute)
  const geos = list.map(([x, y, z, w, h, d, part = 0]) => {
    const g = new THREE.BoxGeometry(w, h, d).translate(x, y, z);
    g.deleteAttribute('uv');
    if (colors) {
      const c = new THREE.Color(colors[part]).toArray(), n = g.attributes.position.count;
      g.setAttribute('color', new THREE.Float32BufferAttribute(Array.from({ length: n * 3 }, (_, i) => c[i % 3]), 3));
    }
    if (parts) g.setAttribute('aPart', new THREE.Float32BufferAttribute(new Array(g.attributes.position.count).fill(part), 1));
    return g;
  });
  const geo = mergeGeometries(geos);
  geos.forEach(g => g.dispose());
  return geo;
}
// a faint cool rim on lit metal, so dark machines read against the dark room (the "edge glow")
function rim(mat, color, k) {
  mat.onBeforeCompile = s => {
    s.uniforms.uRim = { value: new THREE.Color(color).multiplyScalar(k) };
    s.fragmentShader = 'uniform vec3 uRim;\n' + s.fragmentShader.replace('#include <emissivemap_fragment>',
      '#include <emissivemap_fragment>\n\ttotalEmissiveRadiance += uRim * pow(1. - saturate(dot(normal, normalize(vViewPosition))), 3.);');
  };
  mat.customProgramCacheKey = () => 'xr-rim' + k;
  return mat;
}
function canvasTexture(w, h, paint) {
  const cv = Object.assign(document.createElement('canvas'), { width: w, height: h }), g = cv.getContext('2d');
  paint(g, w, h);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
const glowTexture = () => canvasTexture(128, 128, (g, w) => {
  const r = g.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2);
  for (const [at, a] of [[0, 1], [0.35, 0.45], [0.7, 0.1], [1, 0]]) r.addColorStop(at, `rgba(255,255,255,${a})`);
  g.fillStyle = r; g.fillRect(0, 0, w, w);
});
// a raised-floor tile: seams, and the perforated cold-aisle tiles' dot grid
const tileTexture = () => canvasTexture(256, 256, (g, w) => {
  g.fillStyle = '#0c0f13'; g.fillRect(0, 0, w, w);
  g.fillStyle = '#151a20';
  for (let y = 24; y < w - 16; y += 14) for (let x = 24; x < w - 16; x += 14) g.fillRect(x, y, 3, 3);
  g.strokeStyle = '#1f262e'; g.lineWidth = 3; g.strokeRect(1.5, 1.5, w - 3, w - 3);
});
// DevTools' element tooltip, hung over each screen's top-left corner
const tagTexture = (tag, size) => canvasTexture(512, 64, (g, w, h) => {
  g.font = '500 27px "Geist Mono", ui-monospace, monospace';
  const dims = `${size[0]} × ${size[1]}`, tw = g.measureText(tag).width, dw = g.measureText(dims).width;
  g.fillStyle = 'rgba(19,21,23,.92)'; g.beginPath(); g.roundRect(0, 6, Math.min(w, tw + dw + 50), h - 12, 10); g.fill();
  g.fillStyle = '#FF7A45'; g.fillText(tag, 16, 42);
  g.fillStyle = '#8D9196'; g.fillText(dims, 34 + tw, 42);
});

// GLSL shared by the robots' screens and their glows: is a phone in use right now (closing.js's pulse and taps),
// and has the lights-on wave reached it yet (screens flicker on as it passes)
const GLSL_LIT = `
uniform float uTime, uWave, uZ0;
float hash(float n) { return fract(sin(n) * 43758.5453); }
float inUse(float s, float t) {
  if (s < 0.) return .06;   // idle, on standby (picked in JS, so a robot's hover note agrees with its screen)
  float ph = hash(s) * 6.283, sp = .18 + hash(s + 7.) * .5;
  float a = clamp((.5 + .5 * sin(t * sp + ph) - .22) / .78, 0., 1.);
  a = a * a * (3. - 2. * a);
  if (mod(t * (.5 + sp) + ph, 4.2) < .09) a = min(1., a + .55);   // a tap
  return .1 + .9 * a;
}
float powered(float z) {
  float d = abs(z - uZ0) - uWave;
  return d > 0. ? 0. : d > -2.5 ? step(.45, hash(floor(z * 4.) + floor(uTime * 24.))) : 1.;
}`;

// ---- open: everything is built here, before the hand-off, so nothing compiles or uploads mid-move
export async function open({ canvas, hud, y0, transition }) {
  if (tier() > 1) throw Object.assign(new Error('software rendering: the rack room stays off'), { quiet: true });
  seed = 7;
  const doc = document.documentElement;
  const man = await prefetch(), N = man.bands.length;
  // the page as laid out now (it's set aside once the room is up): where each band starts, how tall it is
  const live = (() => {
    const H = doc.scrollHeight, ys = man.bands.map(b => (b.id === 'footer' ? document.querySelector('body > footer') : document.getElementById(b.id))?.getBoundingClientRect().top + scrollY);
    if (ys.some(y => !Number.isFinite(y))) return null;   // stale manifest: the bands are mapped proportionally instead
    return { ys, hs: ys.map((y, i) => (ys[i + 1] ?? H) - y), max: H - innerHeight };
  })();
  const S = []; man.bands.reduce((s, b, i) => (S[i] = s) + b.g, 0);   // each band's top on the strip (capture px)
  const mobile = man.w < 700, SW = mobile ? 1.15 : 2.4, k = SW / man.w;   // screen width (m), metres per capture px
  const XS = SW / 2 + 0.35, RX = Math.max(2.3, XS + SW / 2 * Math.cos(0.3) + 0.5);   // screens' and racks' distance from the centre line
  const maxH = Math.max(...man.bands.map(b => b.g)) * k, CEIL = Math.max(5.2, B + maxH + 0.9);
  const Z0 = 9, Z1 = -(N - 1) * SP - 9;   // the racks' run

  // quality: pixel ratio, motion trails, streak count, how far down the aisle robots are drawn (the fog's end: past it
  // they'd only draw in the fog colour). The watchdog lowers these one step at a time; full tier starts as designed
  const lite = tier() > 0, qual = { pr: Math.min(devicePixelRatio, lite ? 1.25 : 1.5), trails: true, streaks: 260, far: FOG_TO };
  if (learned) Object.assign(qual, learned, { pr: Math.min(qual.pr, learned.pr) });
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: !lite, powerPreference: 'high-performance', preserveDrawingBuffer: !reduced });
  renderer.setPixelRatio(qual.pr);
  renderer.setClearColor(BG, 1);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.1;
  renderer.autoClear = false;
  const aniso = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(FOG, 5, FOG_TO);
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  pmrem.dispose();
  renderer.setClearColor(0x000001, 1);   // from here only the trails-off clear uses it (draw): what the opaque fade (BG, tone-mapped) writes
  scene.environmentIntensity = 0.06;
  scene.add(new THREE.HemisphereLight(0x6f93b3, 0x050608, 0.1));
  const key = new THREE.DirectionalLight(0xc9dcf0, 0.3);
  key.position.set(0.4, 1, 0.5);
  scene.add(key);
  const camera = new THREE.PerspectiveCamera(40, 1, 0.05, 80);
  const shared = [];   // geometries/materials/textures that dispose() must free besides the scene graph's
  const glow = glowTexture();
  shared.push(glow);

  // ---- the room: raised floor, ceiling, walls behind the racks, trusses, cable trays and light strips
  const len = Z0 - Z1, mid = (Z0 + Z1) / 2, dark = (c, r = 0.7, m = 0.4) => new THREE.MeshStandardMaterial({ color: c, roughness: r, metalness: m });
  const tiles = tileTexture();
  tiles.wrapS = tiles.wrapT = THREE.RepeatWrapping;
  tiles.repeat.set((RX * 2 + 6) / 0.6, (len + 30) / 0.6);
  tiles.anisotropy = aniso;
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(RX * 2 + 6, len + 30), new THREE.MeshStandardMaterial({ map: tiles, roughness: 0.45, metalness: 0.35 }));
  floor.rotation.x = -Math.PI / 2; floor.position.z = mid;
  const ceiling = new THREE.Mesh(new THREE.PlaneGeometry(RX * 2 + 6, len + 30), new THREE.MeshBasicMaterial({ color: 0x07090c }));
  ceiling.rotation.x = Math.PI / 2; ceiling.position.set(0, CEIL, mid);
  const walls = new THREE.Mesh(boxes([[-(RX + CAB_D + 0.6), CEIL / 2, mid, 0.1, CEIL, len + 30], [RX + CAB_D + 0.6, CEIL / 2, mid, 0.1, CEIL, len + 30]]), dark(0x0b0e12, 0.9, 0));
  const steel = rim(dark(0x0e1013, 0.55, 0.6), 0x8fc3e6, 0.16);
  const trays = [];
  for (const s of [-1, 1]) trays.push([s * (RX + 0.45), 2.2, mid, 0.55, 0.07, len]);   // over the racks
  for (let i = 0; i < N; i++) trays.push([0, CEIL - 0.25, -i * SP, RX * 2 + 1, 0.12, 0.12]);   // a truss over each screen
  const steelwork = new THREE.Mesh(boxes(trays), steel);
  scene.add(floor, ceiling, walls, steelwork);

  // ---- racks: open cabinets, a run on each side with a gap after every 9; 4 shelves × 2 robots each
  const cabs = [];
  for (const s of [-1, 1]) for (let z = Z0, n = 0; z > Z1; z -= CAB, n++) if (n % 10 !== 9) cabs.push([s, z]);
  const post = 0.04, cabGeo = boxes([
    ...[[0, -1], [0, 1], [1, -1], [1, 1]].map(([d, w]) => [d * CAB_D, CAB_H / 2, w * (CAB / 2 - post / 2), post, CAB_H, post]),
    ...SHELVES.map(y => [CAB_D / 2, y - 0.012, 0, CAB_D, 0.02, CAB - 0.02]),
    [CAB_D / 2, CAB_H, 0, CAB_D + 0.02, 0.04, CAB], [CAB_D - 0.01, CAB_H / 2, 0, 0.02, CAB_H, CAB],
  ]);
  const racks = new THREE.InstancedMesh(cabGeo, steel, cabs.length);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), v = new THREE.Vector3(), one = new THREE.Vector3(1, 1, 1);
  // a cabinet's x runs from its open face (0) to its back (CAB_D): turned so the open face meets the aisle
  cabs.forEach(([s, z], i) => racks.setMatrixAt(i, m4.compose(v.set(s * RX, 0, z), q.setFromAxisAngle(Y, s < 0 ? Math.PI : 0), one)));
  scene.add(racks);

  // robots: proxy + display quads (instanced) + a glow per display and two status LEDs per cabinet (points)
  const robotGeo = boxes(PROXY, [0x1c1f23, 0x2a3530, 0x3a3f45, 0x4a5058], true);
  const robotMat = rim(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.45, metalness: 0.6 }), 0x9cc8ea, 0.3);
  const rimCompile = robotMat.onBeforeCompile;
  robotMat.onBeforeCompile = sh => {   // the tapper head dips onto the phone as the robot uses it (same clock as its screen)
    rimCompile(sh);
    Object.assign(sh.uniforms, lit);
    sh.vertexShader = 'attribute float aPart, aSeed;\n' + GLSL_LIT + '\n' + sh.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
      if (aPart > 2.5) { float ph = hash(aSeed) * 6.283, sp = .18 + hash(aSeed + 7.) * .5, m = mod(uTime * (.5 + sp) + ph, 4.2);
        transformed.y -= .022 * smoothstep(0., .06, m) * (1. - smoothstep(.12, .3, m)) * step(0., aSeed); }`);
  };
  robotMat.customProgramCacheKey = () => 'xr-robot';
  const units = [];
  for (const [s, z] of cabs) for (const y of SHELVES) for (const w of [-1, 1]) units.push([s, y, z + w * 0.195]);
  const dispGeo = new THREE.PlaneGeometry(DISPLAY[3], DISPLAY[4]).rotateX(-Math.PI / 2).translate(DISPLAY[0], DISPLAY[1], DISPLAY[2]);
  const seeds = new Float32Array(units.length), kinds = new Float32Array(units.length), place = new Float32Array(units.length * 16);
  const glowPos = [], glowSeed = [], glowKind = [];
  units.forEach(([s, y, z], i) => {
    m4.compose(v.set(s * (RX + 0.26), y, z), q.setFromAxisAngle(Y, s < 0 ? Math.PI / 2 : -Math.PI / 2), one).toArray(place, i * 16);   // its front toward the aisle
    seeds[i] = rng() * 100; kinds[i] = rng() < 0.22 ? 1 : 0;
    if (seeds[i] * 7.31 % 1 > 0.72) seeds[i] = -seeds[i];   // idle: a negative seed (GLSL_LIT)
    v.set(DISPLAY[0], DISPLAY[1] + 0.06, DISPLAY[2]).applyMatrix4(m4);
    glowPos.push(v.x, v.y, v.z); glowSeed.push(seeds[i]); glowKind.push(kinds[i]);
  });
  for (const [s, z] of cabs) for (const dy of [0, 0.06]) { glowPos.push(s * (RX + 0.02), CAB_H - 0.12 - dy, z + CAB / 2 - 0.06); glowSeed.push(rng() * 100); glowKind.push(2); }
  // instanced per run of cabinets (both sides, 8 m), so the runs behind you or past the fog aren't drawn (see draw)
  const byRun = new Map();
  units.forEach(([, , z], i) => { const n = Math.floor(Math.round((Z0 - z) / CAB) / 10); byRun.has(n) ? byRun.get(n).push(i) : byRun.set(n, [i]); });
  const slice = (src, idx, k) => { const a = new Float32Array(idx.length * k); idx.forEach((i, j) => a.set(src.subarray(i * k, i * k + k), j * k)); return new THREE.InstancedBufferAttribute(a, k); };
  const share = (geo, more) => { const g = new THREE.BufferGeometry().setIndex(geo.index); for (const [n, a] of Object.entries({ ...geo.attributes, ...more })) g.setAttribute(n, a); return g; };
  shared.push(robotGeo, dispGeo);
  const lit = { uTime: { value: 0 }, uWave: { value: 0 }, uZ0: { value: 0 } };
  const dispMat = new THREE.ShaderMaterial({
    uniforms: { ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog), ...lit }, fog: true,
    vertexShader: `attribute float aSeed, aKind; varying float vA, vK; varying vec2 vUv;
      #include <fog_pars_vertex>
      ${GLSL_LIT}
      void main() {
        vec4 wp = modelMatrix * instanceMatrix * vec4(position, 1.), mvPosition = viewMatrix * wp;
        gl_Position = projectionMatrix * mvPosition;
        vA = powered(wp.z) * inUse(aSeed, uTime); vK = aKind; vUv = uv;
        #include <fog_vertex>
      }`,
    fragmentShader: `varying float vA, vK; varying vec2 vUv;
      #include <fog_pars_fragment>
      void main() {
        float ui = .7 + .3 * step(.5, fract(vUv.y * 11.)) * step(.1, vUv.x) * step(vUv.x, .9) + .4 * step(.92, vUv.y);   // a hint of rows and a status bar
        vec3 c = vK > .5 ? vec3(1., .36, .1) : vec3(.3, .66, 1.);
        gl_FragColor = vec4(c * vA * ui * 1.15, 1.);
        #include <fog_fragment>
      }`,
  });
  const runs = [...byRun.values()].map(idx => {   // [robots, their displays]
    const aSeed = slice(seeds, idx, 1);
    const robots = new THREE.InstancedMesh(share(robotGeo, { aSeed }), robotMat, idx.length);
    const displays = new THREE.InstancedMesh(share(dispGeo, { aSeed, aKind: slice(kinds, idx, 1) }), dispMat, idx.length);
    displays.instanceMatrix = robots.instanceMatrix = slice(place, idx, 16);   // same placements
    robots.computeBoundingSphere();
    return [robots, displays];
  });
  // the ceiling strips' glow joins the points too (kind 3)
  const strips = [];
  for (const s of [-1, 1]) for (let z = Z0 - 1.5; z > Z1; z -= 3) strips.push([s * Math.min(1.25, RX - 0.9), CEIL - 0.06, z]);
  for (const [x, y, z] of strips) { glowPos.push(x, y - 0.4, z); glowSeed.push(rng() * 100); glowKind.push(3); }
  for (let z = Z0; z > Z1; z -= 3.5) { glowPos.push((rng() - 0.5) * RX, 1.6 + rng() * 2, z); glowSeed.push(rng() * 100); glowKind.push(4); }   // haze
  const glowGeo = new THREE.BufferGeometry();
  glowGeo.setAttribute('position', new THREE.Float32BufferAttribute(glowPos, 3));
  glowGeo.setAttribute('aSeed', new THREE.Float32BufferAttribute(glowSeed, 1));
  glowGeo.setAttribute('aKind', new THREE.Float32BufferAttribute(glowKind, 1));
  const glowMat = new THREE.ShaderMaterial({
    uniforms: { ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog), ...lit, uPx: { value: 600 }, uHaze: { value: 0 }, uPtMax: { value: renderer.getContext().getParameter(renderer.getContext().ALIASED_POINT_SIZE_RANGE)[1] } },
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: true,   // fog: for its near/far (it fades, not tints)
    vertexShader: `attribute float aSeed, aKind; uniform float uPx, uHaze, uPtMax, fogNear, fogFar; varying vec3 vC; varying float vA, vK, vCut;
      ${GLSL_LIT}
      void main() {
        vec4 mvPosition = modelViewMatrix * vec4(position, 1.);
        gl_Position = projectionMatrix * mvPosition;
        float on = powered(position.z); float fade = 1. - smoothstep(fogNear, fogFar, -mvPosition.z);
        float a = aKind < 1.5 ? inUse(aSeed, uTime) * .8 : aKind < 2.5 ? step(.35, fract(uTime * (.2 + hash(aSeed) * .5) + hash(aSeed + 3.))) : aKind < 3.5 ? .1 * uHaze : (.035 + .015 * sin(uTime * .3 + aSeed)) * uHaze;
        if (aKind > 3.5) on = 1.;
        vA = on * a * fade; vK = aKind;
        vC = aKind < .5 ? vec3(.3, .62, 1.) : aKind < 1.5 ? vec3(1., .36, .1) : aKind < 2.5 ? (hash(aSeed + 9.) > .85 ? vec3(1., .62, .2) : vec3(.18, .75, .39)) : aKind < 3.5 ? vec3(.7, .82, .95) : vec3(.45, .62, .85);
        // a sprite is drawn only out to vCut of its radius: past that (at its brightest) it adds under half a step of
        // 8-bit colour, which rounds to nothing. Clamped as the GPU would first, so the biggest ones match too
        vCut = aKind < 1.5 ? .9 : aKind < 2.5 ? 1. : aKind < 3.5 ? .76 : .67;
        gl_PointSize = min((aKind < 1.5 ? .6 : aKind < 2.5 ? .035 : aKind < 3.5 ? 2.6 : 7.) * uPx / -mvPosition.z, uPtMax) * vCut;
        if (vA <= 0.) gl_Position = vec4(0., 0., 2., 1.);   // adds nothing at all: clipped, no fragments
      }`,
    fragmentShader: `varying vec3 vC; varying float vA, vK, vCut;
      void main() {
        float d = length(gl_PointCoord - .5) * 2. * vCut, g = vK > 1.5 && vK < 2.5 ? smoothstep(1., .3, d) : exp(-d * d * 5.) * (1. - d);
        gl_FragColor = vec4(vC * vA * max(g, 0.), 1.);
      }`,
  });
  const glows = new THREE.Points(glowGeo, glowMat);
  glows.frustumCulled = false;
  // the strips themselves: flicker on as the wave passes
  const stripMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(0.06, 0.03, 2.3), new THREE.MeshBasicMaterial({ color: 0xffffff }), strips.length);
  strips.forEach(([x, y, z], i) => { stripMesh.setMatrixAt(i, m4.makeTranslation(x, y, z)); stripMesh.setColorAt(i, new THREE.Color(0)); });
  // cables: bundles along the trays, a drop into every cabinet
  const cable = [];
  for (const s of [-1, 1]) {
    for (const dx of [-0.15, 0, 0.12]) cable.push(s * (RX + 0.45) + dx, 2.26, Z0, s * (RX + 0.45) + dx, 2.26, Z1);
    for (const [cs, z] of cabs) if (cs === s) cable.push(s * (RX + 0.3), 2.2, z, s * (RX + 0.3), CAB_H, z);
  }
  const cableGeo = new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(cable, 3));
  const cables = new THREE.LineSegments(cableGeo, new THREE.LineBasicMaterial({ color: 0x2a3540 }));
  scene.add(...runs.flat(), stripMesh, cables, glows);

  // ---- the hero unit: the full machine on a plinth near the aisle's start, its phone running the hero's UI
  const gltf = await loadModel(), model = gltf.scene, mixer = new THREE.AnimationMixer(model);
  mixer.clipAction(gltf.animations[0]).play();
  const phone = createScreen(), phoneTex = new THREE.CanvasTexture(phone.canvas);
  phoneTex.flipY = false; phoneTex.colorSpace = THREE.SRGBColorSpace; phoneTex.anisotropy = aniso;
  phoneTex.repeat.x = -1; phoneTex.offset.x = 1;   // the model's screen UVs run right-to-left (machine.js)
  model.traverse(o => {
    if (!o.isMesh) return;
    for (const m of [].concat(o.material)) {
      if (m.name === 'phone | Supplied Material.004') {   // the display emits its own colours
        m.map = null; m.emissiveMap = phoneTex; m.color.set(0); m.emissive.set(0xffffff); m.emissiveIntensity = 0.92; m.toneMapped = false;
      } else rim(m, 0x8fc3e6, 0.32);
    }
  });
  const hero = new THREE.Group(), plinth = new THREE.Mesh(boxes([[0, 0.25, 0, 0.7, 0.5, 0.95], [0, 0.51, 0, 0.78, 0.02, 1.03]]), steel);
  model.scale.setScalar(2.4); model.position.set(-0.04, 0.52, 0); model.rotation.y = -0.55;
  hero.add(plinth, model);
  hero.position.set(mobile ? 0.8 : 1.2, 0, 0.6);   // across from the first screen, in the reveal's frame; the first fly-by passes it
  const heroLight = new THREE.PointLight(0xffc49a, 2.6, 4.5, 1.6);
  heroLight.position.set(hero.position.x - 0.4, 2.3, 1.4);
  scene.add(hero, heroLight);

  // ---- the screens: one group per band (origin: top centre, tiles hang down), a bezel, a glow, a tag, two cables
  const frameMat = new THREE.MeshStandardMaterial({ color: 0x101317, roughness: 0.5, metalness: 0.6, transparent: true, opacity: 0 });
  const tex = {};   // file → THREE.Texture
  const texture = async file => tex[file] ??= (async () => {
    const t = new THREE.Texture(await bitmap(file));
    t.colorSpace = THREE.SRGBColorSpace; t.flipY = false; t.anisotropy = aniso; t.minFilter = THREE.LinearMipmapLinearFilter; t.needsUpdate = true;
    renderer.initTexture(t);
    return t;
  })();
  const bands = man.bands.map((b, i) => {
    const H = b.g * k, group = new THREE.Group(), u = { uWake: { value: 0 }, uHi: { value: 0 }, uN: { value: 0 } };
    let acc = 0;
    const tilesOf = b['x-lo'].map(([, h]) => {
      const mat = new THREE.ShaderMaterial({
        uniforms: { ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog), ...u, mapX: { value: null }, mapN: { value: null }, uY: { value: new THREE.Vector2(acc / b.g, h / b.g) } },
        fog: true,
        vertexShader: `varying vec2 vUv;
          #include <fog_pars_vertex>
          void main() { vUv = uv; vec4 mvPosition = modelViewMatrix * vec4(position, 1.); gl_Position = projectionMatrix * mvPosition;
          #include <fog_vertex>
          }`,
        fragmentShader: `uniform sampler2D mapX, mapN; uniform float uWake, uHi, uN; uniform vec2 uY; varying vec2 vUv;
          #include <fog_pars_fragment>
          void main() {
            vec4 c = texture2D(mapX, vUv);
            float y = uY.x + (1. - vUv.y) * uY.y, w = uWake * 1.1 - .05;   // y: 0 at the band's top; the wake line sweeps down
            if (uN > .5 && y < w) c.rgb = texture2D(mapN, vUv).rgb * .62;
            if (uWake > .001 && uWake < .999) c.rgb += vec3(.45, .7, .95) * smoothstep(.006, 0., abs(y - w));
            gl_FragColor = c;
            #include <colorspace_fragment>
            gl_FragColor.rgb += vec3(.02, .05, .09) * uHi;   // DevTools' hover tint
            #include <fog_fragment>
          }`,
      });
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(SW, h * k), mat);
      mesh.position.y = -(acc + h / 2) * k;
      acc += h;
      group.add(mesh);
      return mesh;
    });
    const t = 0.035, bezel = new THREE.Mesh(boxes([[0, t / 2, -0.03, SW + 2 * t, t, 0.06], [0, -H - t / 2, -0.03, SW + 2 * t, t, 0.06],
      [-SW / 2 - t / 2, -H / 2, -0.03, t, H, 0.06], [SW / 2 + t / 2, -H / 2, -0.03, t, H, 0.06], [0, -H / 2, -0.065, SW + 2 * t, H + 2 * t, 0.01]]), frameMat);
    const halo = new THREE.Mesh(new THREE.PlaneGeometry(SW + 2.2, H + 2.2), new THREE.MeshBasicMaterial({ map: glow, color: 0x8fc3e6, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }));
    halo.position.set(0, -H / 2, -0.1);
    const pool = new THREE.Mesh(new THREE.PlaneGeometry(SW + 1.2, 2.6), halo.material);
    pool.rotation.x = -Math.PI / 2; pool.position.set(0, -H - B + 0.01, 1.1);
    const tw = SW * (mobile ? 0.62 : 0.34), label = new THREE.Mesh(new THREE.PlaneGeometry(tw, tw / 8), new THREE.MeshBasicMaterial({ map: tagTexture(b.tag, b.size), transparent: true, opacity: 0, depthWrite: false }));
    label.position.set(-SW / 2 + tw / 2 - 0.01, tw / 16 + 0.03, 0.004);
    const hang = new THREE.LineSegments(new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(
      [-0.4, 0, -0.04, -0.4, 12, -0.04, 0.4, 0, -0.04, 0.4, 12, -0.04].map((c, j) => j % 3 === 0 ? c * SW : c), 3)), cables.material);
    group.add(bezel, halo, pool, label, hang);
    scene.add(group);
    const s = i % 2 ? 1 : -1;
    return { ...b, i, H, group, u, tiles: tilesOf, bezel, halo, pool, label, side: s,
      aisle: { p: new THREE.Vector3(s * XS, B + H, -i * SP), q: new THREE.Quaternion().setFromAxisAngle(Y, -s * Math.atan2(XS, DZ)) }, swing: -s * Math.atan2(XS, DZ),
      from: { p: new THREE.Vector3(), q: new THREE.Quaternion() }, to: { p: new THREE.Vector3(), q: new THREE.Quaternion() }, wake: 0 };
  });
  async function useSet(band, key) {   // swap a band's x-ray tiles between the aisle set and the full-size one
    const ts = await Promise.all(band[key].map(([f]) => texture(f)));
    band.tiles.forEach((m, i) => { m.material.uniforms.mapX.value = ts[i]; m.material.uniforms.mapN.value ??= ts[i]; });
  }
  const wakeSet = () => Promise.all(bands.map(async band => {   // the page as it is, for the wake (after the reveal has started)
    const ts = await Promise.all(band['n-lo'].map(([f]) => texture(f)));
    band.tiles.forEach((m, i) => { m.material.uniforms.mapN.value = ts[i]; });
    band.u.uN.value = 1;
  })).catch(() => {});

  // ---- the strip: the page as it lies, the bands one under another (capture px). Where the window is on it:
  const Wl = () => doc.clientWidth, Vl = () => innerHeight, Vc = () => Vl() * man.w / Wl();
  const stripTop = s => {
    if (!live) return s * man.w / Wl();
    let i = 0; while (i < N - 1 && live.ys[i + 1] <= s + 0.5) i++;
    const b = man.bands[i];
    let d = s - live.ys[i];
    d = b.g !== b.h ? Math.max(0, d - (live.hs[i] - Vl())) * man.w / Wl()   // pinned: its stage holds still while it plays
      : d * b.g / live.hs[i];
    return S[i] + d;
  };
  // the window over the strip → the band it's mostly on, every band it touches, and how it sits on that band
  const region = top => {
    const vc = Vc(), centre = top + vc / 2;
    let c = 0; while (c < N - 1 && S[c + 1] <= centre) c++;
    const yT = -(top - S[c]) * k, yB = yT - vc * k;
    const lift = Math.max(0, 0.5 - (bands[c].aisle.p.y + yB));   // keep it clear of the floor while it's the page
    return { c, top, yT, yB, lift, list: bands.filter(b => S[b.i] < top + vc && S[b.i] + b.g > top).map(b => b.i) };
  };
  const stripPose = (r, j, out) => {
    const a = bands[r.c].aisle;
    out.q.copy(a.q);
    out.p.copy(a.p).addScaledVector(Y, r.lift - (S[j] - S[r.c]) * k);
    return out;
  };
  // the camera that sees exactly the window: face-on, at the distance where the screen is 1:1 with the page
  const handPose = r => {
    const pose = stripPose(r, r.c, { p: new THREE.Vector3(), q: new THREE.Quaternion() });
    const d = (r.yT - r.yB) / 2 / Math.tan(THREE.MathUtils.degToRad(path.fov) / 2);
    pose.p.add(v.set(0, (r.yT + r.yB) / 2, d).applyQuaternion(pose.q));
    return pose;
  };

  // ---- the flight: straight down the middle of the aisle at eye height, looking ahead. u = i stops DZ short of
  // screen i (which has swung round to face you); there's no sideways move anywhere on it
  const path = {};
  function buildPath() { path.fov = camera.fov; }   // (the lens at rest; it widens with speed)
  const flyPose = (u, out) => {   // u: −0.5 (entrance) … 0 (screen 0) … N − 0.5 (the far end)
    out.p.set(0, EYE, -u * SP + DZ);
    out.q.identity();
    return out;
  };
  const look = (from, to) => new THREE.Quaternion().setFromRotationMatrix(m4.lookAt(from, to, Y));

  // ---- state
  const r0 = region(stripTop(y0)), c0 = r0.c;
  let r = r0, mode = 'idle', t = 0, time = 0, last = 0, raf = 0, u = c0 - 0.35, goal = c0, idleAt = 0, readout = -1;
  let A = null, Bp = { p: new THREE.Vector3(), q: new THREE.Quaternion() }, from = { p: new THREE.Vector3(), q: new THREE.Quaternion() };
  let done = null, handing = false, wave = 0, haze = 0, frames = 0, vel = 0, acc = 0, kick = 0, kick0 = 0, wheelAt = 0;
  const lean = { x: 0, y: 0, tx: 0, ty: 0 }, bank = { roll: 0, pitch: 0 }, gaze = { yaw: 0, pitch: 0, ty: 0, tp: 0 }, qy = new THREE.Quaternion(), tilt = new THREE.Euler(), pose = { p: new THREE.Vector3(), q: new THREE.Quaternion() }, prev = new THREE.Vector3();
  const tc = hud.querySelector('.xr-tc'), camTag = hud.querySelector('.xr-cam b'), camDims = hud.querySelector('.xr-cam i'), hint = hud.querySelector('.xr-hint');
  lit.uZ0.value = bands[c0].aisle.p.z;

  // ---- hover a robot: a note beside it with what its agent is doing, typed like the hero's log
  const hit = new THREE.InstancedMesh(new THREE.BoxGeometry(0.3, 0.22, 0.38).translate(0, 0.11, 0), robotMat, units.length);   // a box round each unit: the proxy alone is mostly gaps
  hit.instanceMatrix = new THREE.InstancedBufferAttribute(place, 16);   // every unit, in units order (the drawn meshes are split by run)
  hit.computeBoundingSphere();
  shared.push(hit.geometry);
  const note = hud.appendChild(document.createElement('div'));
  note.className = 'xr-note';
  const ray = new THREE.Raycaster(), ndc = new THREE.Vector2(), mouse = { x: 0, y: 0, in: false };
  ray.far = 9;
  let picked = -1, pickedAt = 0, job = null, edge = 0;
  const cabsPerSide = cabs.length / 2;
  const noteFor = i => {
    const n = Math.floor(seeds[i] * 1e4) >>> 0, cab = i >> 3, side = cabs[cab][0] < 0 ? 'L' : 'R';
    const phone = kinds[i] ? `${PHONES[n % PHONES.length]} #${String(i % 97 + 1).padStart(2, '0')}` : `cloud android ${(n * 2654435761 >>> 0).toString(16).slice(-4)}`;
    const where = `rack SF-2 · cab ${String(cab % cabsPerSide + 1).padStart(2, '0')}${side} · shelf ${((i >> 1) & 3) + 1} · slot ${(i & 1) + 1}`;
    if (seeds[i] < 0) return { idle: true, phone, where, task: 'on standby · charged 100%', steps: ['waiting for the next task'] };
    const [task, ...steps] = JOBS[n % JOBS.length];
    return { phone, where, task: `“${task}”`, steps };
  };
  note.innerHTML = '<p class="xr-note-head"><span class="dot"></span><span class="xr-note-who"></span><span class="xr-note-clock"></span></p><p class="xr-note-where"></p><p class="xr-note-task"><b>❯</b> <span></span></p><ol class="xr-note-steps"></ol>';
  const [noteDot, noteWho, noteClock] = note.querySelector('.xr-note-head').children, noteWhere = note.querySelector('.xr-note-where'), noteTask = note.querySelector('.xr-note-task span'), noteSteps = note.querySelector('.xr-note-steps');
  const caret = Object.assign(document.createElement('i'), { className: 'xr-note-caret' });
  const typed = (el, text, since) => {   // as in js/hero.js: 46 characters a second
    const out = text.slice(0, reduced ? text.length : Math.max(0, Math.floor(since * 46)));
    if (el.firstChild?.nodeValue !== out) el.textContent = out;
    return out.length === text.length;
  };
  const showJob = i => {
    picked = i; pickedAt = performance.now(); job = noteFor(i);
    noteDot.className = job.idle ? 'dot' : 'dot dot--live';
    noteWho.textContent = `${job.idle ? 'idle' : 'agent'} · ${job.phone}`;
    noteWhere.textContent = job.where;
    noteSteps.innerHTML = job.steps.map(() => '<li></li>').join('');
    note.classList.toggle('is-idle', !!job.idle);
    note.classList.add('is-on');
  };
  const hideJob = () => { if (picked < 0) return; picked = -1; note.classList.remove('is-on'); };
  function pick(now) {   // every frame while flying: the robot under the pointer, unless a screen is in front of it
    if (!mouse.in || Math.abs(vel) > 1.2) return hideJob();
    camera.updateMatrixWorld();
    ndc.set(mouse.x / canvas.clientWidth * 2 - 1, 1 - mouse.y / canvas.clientHeight * 2);
    ray.setFromCamera(ndc, camera);
    const r = ray.intersectObject(hit, false)[0];
    const screen = r && ray.intersectObjects(bands.flatMap(b => b.tiles), false)[0];
    const i = r && !(screen && screen.distance < r.distance) ? r.instanceId : -1;
    if (i < 0) return hideJob();
    if (i !== picked) showJob(i);
    // story time: the prompt types, then a step every ~2.4 s, then it holds and starts over
    let t = (now - pickedAt) / 1000;
    if (t > 11) { pickedAt = now; t = 0; }
    let typing = typed(noteTask, job.task, job.idle ? 99 : t) ? null : noteTask;
    const at0 = job.idle ? 0 : job.task.length / 46 + 0.5;
    [...noteSteps.children].forEach((li, k) => {
      const at = at0 + k * 2.4, shown = t >= at, done = shown && typed(li, job.steps[k], job.idle ? 99 : t - at);
      if (!shown) li.textContent = '';
      li.className = job.idle ? '' : done && t >= at + 2.2 ? 'is-done' : shown ? 'is-active' : '';
      if (shown && !done) typing = li;
    });
    const host = typing || [...noteSteps.children].reverse().find(li => li.textContent) || noteTask;
    if (caret.parentNode !== host || host.lastChild !== caret) host.append(caret);
    noteClock.textContent = `00:${String(Math.floor(t)).padStart(2, '0')}.${Math.floor((t % 1) * 10)}`;
    // pinned over the robot's screen: to its right if it fits, else its left, kept on screen; the ring marks the robot
    v.set(glowPos[i * 3], glowPos[i * 3 + 1], glowPos[i * 3 + 2]).project(camera);
    if (v.z > 1) return hideJob();
    const W = canvas.clientWidth, nw = note.offsetWidth, x = (v.x + 1) / 2 * W, y = (1 - v.y) / 2 * canvas.clientHeight;
    const left = clamp(x + 18 + nw > W - 12 ? x - 18 - nw : x + 18, 12, W - nw - 12);
    note.style.translate = `${Math.round(left)}px ${Math.round(Math.max(y, note.offsetHeight + 90))}px`;
    note.style.setProperty('--ax', `${Math.round(x - left)}px`);
  }

  // bands: from → to over a window of the timeline (an arc away from the screen plane, so they don't cross it)
  const placeBands = which => {
    for (const b of bands) {
      const e = which(b);
      b.group.position.lerpVectors(b.from.p, b.to.p, e);
      if (!b.from.p.equals(b.to.p) && b.i !== r.c) b.group.position.addScaledVector(v.set(0, 0, -1).applyQuaternion(b.to.q), Math.sin(Math.PI * e) * 1.4);
      b.group.quaternion.slerpQuaternions(b.from.q, b.to.q, e);
    }
  };
  const setFrames = a => {   // bezels, glows, tags: off while the screens are the page
    frameMat.opacity = a; frameMat.visible = a > 0.01;
    for (const b of bands) {
      b.label.material.opacity = a; b.label.visible = b.halo.visible = b.pool.visible = a > 0.01;
      b.halo.material.opacity = a * (0.14 + b.wake * 0.32);
      b.halo.material.color.set(b.wake > 0.5 ? 0xf2efe6 : 0x8fc3e6);
    }
  };
  let sweep = 0;
  const setStrips = () => {   // the light strips flicker on as the wave passes; then a sweep runs down the aisle ahead of you
    const zs = camera.position.z + 4 - sweep;
    strips.forEach(([, , z], i) => {
      const d = Math.abs(z - lit.uZ0.value) - wave;
      const on = d > 0 ? 0 : d > -3 ? (Math.sin(time * 70 + i * 13) > 0.2 ? 0.9 : 0.15) : 1;
      const s = wave > 900 ? Math.exp(-(((z - zs) / 2.2) ** 2)) * 1.6 : 0;
      stripMesh.setColorAt(i, v.set(0.5 + s * 0.3, 0.62 + s * 0.25, 0.75 + s * 0.2).multiplyScalar(on * 0.42 * (1 + s)));
    });
    stripMesh.instanceColor.needsUpdate = true;
  };

  function revealAt(tt) {   // 0 … T_IN: pull back from the page, turn into the aisle; the room powers up
    const kp = ease(clamp(tt / T_IN) ** 0.7), kr = win(tt, 0.2, T_IN);
    const n = v.set(0, 0, 1).applyQuaternion(A.q);
    camera.position.lerpVectors(A.p, Bp.p, kp).addScaledVector(n, Math.sin(Math.PI * kp) * 1.5).addScaledVector(Y, Math.sin(Math.PI * kp) * 0.35);
    camera.quaternion.slerpQuaternions(A.q, Bp.q, kr);
    placeBands(b => b.i === r.c ? win(tt, 0.15, 1.3) : win(tt, 0.25 + Math.abs(b.i - r.c) * 0.12, 1.6));
    setFrames(win(tt, 0.35, 1.1));
    bands[r.c].u.uHi.value = Math.sin(Math.PI * clamp((tt - 0.3) / 1.2));
    wave = 90 * clamp((tt - 0.45) / (T_IN - 0.45)) ** 1.7;
    haze = win(tt, 0.5, 1.8);
  }
  function leaveAt(tt) {   // back to the screen you're at, face-on, the page's neighbours rejoining it
    const kp = ease(clamp(tt / T_OUT));
    lens(kick0 * (1 - win(tt, 0, 0.6)));
    camera.position.lerpVectors(from.p, A.p, kp);
    camera.quaternion.slerpQuaternions(from.q, A.q, ease(clamp(tt / (T_OUT - 0.1))));
    placeBands(b => win(tt, b.i === r.c ? 0.3 : 0.1, b.i === r.c ? 1.35 : 1.25));
    setFrames(1 - win(tt, 0, 0.7));
  }
  const lens = kk => { kick = kk; const f = path.fov + kk; if (Math.abs(camera.fov - f) > 1e-3) { camera.fov = f; camera.updateProjectionMatrix(); } };
  function flyStep(dt) {
    if (performance.now() - idleAt > 450 && !reduced) goal += (clamp(Math.round(goal), 0, N - 1) - goal) * (1 - Math.exp(-dt * 2.5));   // settle on a screen (the last one too: not one past it)
    const u1 = u + (goal - u) * (reduced ? 1 : 1 - Math.exp(-dt * 2.4));
    const v1 = dt ? (u1 - u) * SP / dt : 0;   // m/s along the aisle (+ = forward)
    acc += ((dt ? (v1 - vel) / dt : 0) - acc) * (1 - Math.exp(-dt * 4)); vel = v1; u = u1;
    flyPose(u, pose);
    const settle = ease(clamp(t / 1.5));   // out of the reveal's establishing shot, into the path (and the lean fades in)
    if (settle < 1) { pose.p.lerpVectors(Bp.p, pose.p, settle); pose.q.slerpQuaternions(Bp.q, q.copy(pose.q), settle); }   // (slerpQuaternions copies its first argument in first: pose.q can't be both)
    // energy: the lens widens with speed, the camera banks into speeding up / braking and dips its nose when fast.
    // The mouse only tilts the view a hair (no sideways slide), and holds still while you're flying
    const sp = Math.abs(vel), damp = 1 - Math.exp(-dt * 2.2);
    lens(kick + (clamp(sp * 1.1, 0, 14) * settle - kick) * (1 - Math.exp(-dt * 5)));
    bank.roll += (clamp(acc * 0.006, -0.06, 0.06) * Math.sign(Math.round(u + 0.5) % 2 ? 1 : -1) - bank.roll) * damp;
    bank.pitch += (clamp(-sp * 0.004, -0.035, 0) - bank.pitch) * damp;
    if (performance.now() - wheelAt > 350) { lean.x += (lean.tx - lean.x) * (1 - Math.exp(-dt * 1.5)); lean.y += (lean.ty - lean.y) * (1 - Math.exp(-dt * 1.5)); }
    // looking around (the pointer at the window's left / right edge, or ← →): a deliberate turn of the head toward
    // the racks, held where you leave it; flying on brings it back to the aisle
    if (edge) lookTo(gaze.ty + edge * dt * 1.5, gaze.tp);
    if (performance.now() - wheelAt < 400) { const k = Math.exp(-dt * 1.6); gaze.ty *= k; gaze.tp *= k; }   // only while you scroll, not while it glides
    const gk = reduced ? 1 : 1 - Math.exp(-dt * 7);
    gaze.yaw += (gaze.ty - gaze.yaw) * gk; gaze.pitch += (gaze.tp - gaze.pitch) * gk;
    camera.position.copy(pose.p).addScaledVector(Y, Math.sin(time * 0.6) * 0.012 + Math.sin(time * 9) * 0.004 * clamp(sp / 8));
    camera.quaternion.copy(pose.q).multiply(qy.setFromAxisAngle(Y, gaze.yaw * settle))
      .multiply(q.setFromEuler(tilt.set(gaze.pitch * settle + bank.pitch - lean.y * 0.012 * settle, -lean.x * 0.014 * settle, bank.roll * settle)));
  }
  // the screens swing round to face you as you come up on them (flat to the aisle when far), and follow you past
  function swingBands(dt) {
    const k = reduced ? 1 : 1 - Math.exp(-dt * 3.2);
    for (const b of bands) {
      const dz = camera.position.z - b.aisle.p.z, far = clamp((dz - SP * 1.1) / SP);
      const want = -b.side * (dz > 0.05 ? Math.atan2(XS, dz) : Math.PI / 2) * (1 - far) - b.side * 1.25 * far;
      b.swing += (want - b.swing) * k;
      b.group.position.copy(b.aisle.p);
      b.group.quaternion.setFromAxisAngle(Y, b.swing);
    }
  }

  // speed streaks: hairlines fixed in the room around you (they wrap past you), stretched and lit by your speed
  const STREAKS = 260, sPos = [], sEnd = [], sCol = [];
  for (let i = 0; i < STREAKS; i++) {
    const side = rng() < 0.5 ? -1 : 1, x = rng() < 0.75 ? side * (0.6 + rng() * (RX - 0.9)) : (rng() - 0.5) * 1.2;
    const y = rng() < 0.7 ? 0.15 + rng() * (CEIL - 0.5) : CEIL - 0.3 - rng() * 0.3, z = rng() * 40;
    const c = rng() < 0.12 ? [1, 0.42, 0.15] : rng() < 0.4 ? [0.35, 0.68, 1] : [0.75, 0.86, 0.96];
    for (const e of [0, 1]) { sPos.push(x, y, z); sEnd.push(e); sCol.push(...c); }
  }
  const streakGeo = new THREE.BufferGeometry();
  streakGeo.setAttribute('position', new THREE.Float32BufferAttribute(sPos, 3));
  streakGeo.setAttribute('aEnd', new THREE.Float32BufferAttribute(sEnd, 1));
  streakGeo.setAttribute('color', new THREE.Float32BufferAttribute(sCol, 3));
  const streakMat = new THREE.ShaderMaterial({
    uniforms: { uCamZ: { value: 0 }, uVel: { value: 0 } },
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, vertexColors: true,
    vertexShader: `attribute float aEnd; uniform float uCamZ, uVel; varying vec3 vC; varying float vA;
      void main() {
        vec3 p = position;
        p.z = uCamZ + 2. - mod(uCamZ + 2. - p.z, 40.) + aEnd * uVel * .09;   // its tail trails behind you
        float near = 1. - smoothstep(14., 36., uCamZ - p.z);
        vA = smoothstep(1.2, 9., abs(uVel)) * near * (1. - aEnd * .9); vC = color;
        gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.);
      }`,
    fragmentShader: `varying vec3 vC; varying float vA; void main() { gl_FragColor = vec4(vC * vA * .8, 1.); }`,
  });
  const streaks = new THREE.LineSegments(streakGeo, streakMat);
  streaks.frustumCulled = false;
  streakGeo.setDrawRange(0, qual.streaks * 2);
  scene.add(streaks);

  // trails: each frame first darkens the last one instead of clearing it (opaque = a clean frame). Trails off
  // (watchdog): a plain clear instead, to the colour the opaque fade comes out as
  const fade = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.MeshBasicMaterial({ color: BG, transparent: true, depthTest: false, depthWrite: false }));
  const flat = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  shared.push(fade.geometry, fade.material);
  const fwd = new THREE.Vector3();
  const draw = (trail = 1) => {
    // robot runs that start past qual.far (the fog's end) are skipped; three's culling drops those behind you
    fwd.set(0, 0, -1).applyQuaternion(camera.quaternion);
    for (const [r, d] of runs) r.visible = d.visible = v.copy(r.boundingSphere.center).sub(camera.position).dot(fwd) - r.boundingSphere.radius < qual.far;
    if (qual.trails) { fade.material.opacity = trail; renderer.render(fade, flat); renderer.clearDepth(); }
    else renderer.clear();
    renderer.render(scene, camera);
  };
  // the watchdog: in flight, when over half of 60 frames come later than 24 ms (under ~42 fps), step down one notch
  // (pixel ratio 1.5 → 1.25 → 1, then no trails, fewer streaks, robots only to 30 m). Never back up: no see-sawing.
  // A steady 30 fps is a frame cap (battery saver, a 30 Hz screen), not a struggling GPU: left alone
  const notches = [   // each: did it change anything
    () => qual.pr > 1.25 && (qual.pr = 1.25),
    () => qual.pr > 1 && (qual.pr = 1),
    () => qual.trails && !(qual.trails = false),
    () => qual.streaks > 120 && (qual.streaks = 120),
    () => qual.far > 30 && (qual.far = 30),
  ];
  let watched = 0, late = 0, capped = 0, calm = 0;
  const watch = ms => {
    if (mode !== 'fly' || !ms || ms > 500) return;   // a stall (tab switch, GC) isn't a trend
    if (calm > 0) { calm--; return; }   // just after the flight starts (uploads) or a step down
    watched++; if (ms > 24) late++; if (ms > 31 && ms < 36) capped++;
    if (watched < 60) return;
    if (late > 30 && capped < 48 && notches.some(n => n())) {
      learned = { ...qual };
      if (renderer.getPixelRatio() !== qual.pr) { renderer.setPixelRatio(qual.pr); pxScale(); }
      streakGeo.setDrawRange(0, qual.streaks * 2);
      calm = 30;
    }
    watched = late = capped = 0;
  };

  function step(now) {
    const dt = last ? Math.min(0.05, (now - last) / 1000) : 0;
    last = now; time += dt; t += dt;
    prev.copy(camera.position);
    if (mode === 'reveal') { revealAt(t); if (t >= T_IN) { mode = 'fly'; t = 0; wave = 999; setStrips(); hint.classList.remove('is-quiet'); wakeSet(); calm = 45; } }
    else if (mode === 'fly') { flyStep(dt); swingBands(dt); }
    else if (mode === 'leave') { leaveAt(t); if (t >= T_OUT) { mode = 'held'; done?.(); } }
    if (mode === 'fly') pick(now); else hideJob();
    // wake: the screen you've stopped at shows the page as it is
    for (const b of bands) {
      const want = mode === 'fly' && Math.abs(u - b.i) < 0.2 && Math.abs(goal - u) < 0.05 ? 1 : 0;
      b.wake = reduced ? want : clamp(b.wake + (want ? dt * 0.8 : -dt * 2.2));
      b.u.uWake.value = ease(b.wake);
    }
    if (mode === 'fly') setFrames(1);
    lit.uTime.value = time; lit.uWave.value = wave;
    glowMat.uniforms.uHaze.value = mode === 'reveal' ? haze : 1;
    sweep = (sweep + dt * (7 + Math.abs(vel) * 1.5)) % 46;
    if (mode !== 'idle' && mode !== 'held') setStrips();
    streakMat.uniforms.uCamZ.value = camera.position.z; streakMat.uniforms.uVel.value = mode === 'fly' ? vel : 0;
    // the hero unit runs its tap loop while you're near it
    if (camera.position.distanceTo(hero.position) < 16) {
      mixer.setTime(time % gltf.animations[0].duration);
      if (phone.draw(time, { u: 0.5, v: 0.5, down: false })) phoneTex.needsUpdate = true;
    }
    // HUD: timecode, the section you're at
    const s = 14 * 60 + 32 + time, i = clamp(Math.round(mode === 'fly' ? u : r.c), 0, N - 1);
    const code = [s / 3600, (s / 60) % 60, s % 60, (s * 24) % 24].map(x => String(Math.floor(x)).padStart(2, '0')).join(':');
    if (code !== tc.textContent) tc.textContent = code;   // 24 frames a second: most display frames leave it as it is
    if (i !== readout) { readout = i; camTag.textContent = bands[i].tag; camDims.textContent = `${bands[i].size[0]}×${bands[i].size[1]}`; }
    const speed = dt ? camera.position.distanceTo(prev) / dt : 0;
    draw(mode === 'fly' && !reduced ? clamp(1 - speed * 0.07, 0.5, 1) : 1);
    if (handing) handoff();
    frames++;
  }
  const loop = now => { raf = requestAnimationFrame(loop); const ms = last && now - last; step(now); watch(ms); };
  const run = () => { if (!raf && !reduced) raf = requestAnimationFrame(loop); };
  const stop = () => { cancelAnimationFrame(raf); raf = 0; };

  // the page's own picture (the view transition's old image) rides on the screen: viewport corners → the window's
  // four corners on screen, as a homography in a matrix3d
  const corner = new THREE.Vector3();
  function handoff() {
    const W = canvas.clientWidth, H = canvas.clientHeight, g = bands[r.c].group;
    g.updateMatrixWorld();
    const [[x0, y0_], [x1, y1], [x2, y2], [x3, y3]] = [[-SW / 2, r.yT], [SW / 2, r.yT], [SW / 2, r.yB], [-SW / 2, r.yB]].map(([x, y]) => {
      corner.set(x, y, 0).applyMatrix4(g.matrixWorld).project(camera);
      return [(corner.x + 1) / 2 * W, (1 - corner.y) / 2 * H];
    });
    const dx1 = x1 - x2, dx2 = x3 - x2, dx3 = x0 - x1 + x2 - x3, dy1 = y1 - y2, dy2 = y3 - y2, dy3 = y0_ - y1 + y2 - y3;
    const den = dx1 * dy2 - dx2 * dy1, gg = (dx3 * dy2 - dx2 * dy3) / den, hh = (dx1 * dy3 - dx3 * dy1) / den;
    const a = x1 - x0 + gg * x1, b = x3 - x0 + hh * x3, d = y1 - y0_ + gg * y1, e = y3 - y0_ + hh * y3;
    doc.style.setProperty('--xr-m', `matrix3d(${[a / W, d / W, 0, gg / W, b / H, e / H, 0, hh / H, 0, 0, 1, 0, x0, y0_, 0, 1].join(',')})`);
    doc.style.setProperty('--xr-o', (1 - win(t, 0.06, 0.5)).toFixed(3));
  }

  const v2 = new THREE.Vector2();
  const pxScale = () => { glowMat.uniforms.uPx.value = renderer.getDrawingBufferSize(v2).y / 2 / Math.tan(THREE.MathUtils.degToRad(path.fov) / 2); };   // glow sprites: px per metre at 1 m
  function resize() {
    const w = canvas.clientWidth, h = canvas.clientHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.fov = clamp(THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(20)) / Math.min(1, camera.aspect))), 40, 72);   // 40° tall, wider on portrait screens
    camera.updateProjectionMatrix();
    buildPath();
    pxScale();
    if (mode === 'fly' || reduced) { flyStep(0); draw(); }
  }

  // ---- input (the page underneath never scrolls)
  const ac = new AbortController(), on = (el, type, fn, o) => el.addEventListener(type, fn, { ...o, signal: ac.signal });
  const go = (to, snap) => { goal = clamp(to, -0.5, N - 0.5); idleAt = performance.now(); if (snap) goal = Math.round(goal); if (reduced) { u = goal; step(performance.now()); } };
  on(window, 'wheel', e => {
    if (e.ctrlKey) return;   // pinch-zoom stays the browser's
    e.preventDefault();
    if (mode !== 'fly') return;
    if (reduced) { if (Math.abs(e.deltaY) > 4 && performance.now() - idleAt > 500) go(Math.round(goal) + Math.sign(e.deltaY), true); return; }
    wheelAt = performance.now();   // only deltaY flies: a trackpad's sideways component is ignored
    go(goal + e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? innerHeight : 1) * 0.0016);
  }, { passive: false });
  on(window, 'keydown', e => {
    if (mode !== 'fly' || e.metaKey || e.ctrlKey || e.altKey) return;
    if ((e.key === ' ' || e.key === 'Enter') && e.target.closest?.('button')) return;   // Space/Enter press the chip
    const turn = { ArrowLeft: 0.5, ArrowRight: -0.5 }[e.key];   // ← → turn to look at the racks
    if (turn) { e.preventDefault(); lookTo(gaze.ty + turn, gaze.tp); return; }
    const n = Math.round(goal), to = { ArrowDown: n + 1, PageDown: n + 1, ' ': e.shiftKey ? n - 1 : n + 1, ArrowUp: n - 1, PageUp: n - 1, Home: 0, End: N - 1 }[e.key];
    if (to !== undefined) { e.preventDefault(); go(to, true); }
  });
  // look around (mouse): no dragging. The pointer in the outer ~12% of the window turns your head that way (faster the
  // closer to the edge), up to ~75°, and the view holds when you come back in. Over a robot, its note shows (pick()).
  const lookTo = (yaw, pitch) => { gaze.ty = clamp(yaw, -1.3, 1.3); gaze.tp = clamp(pitch, -0.35, 0.35); if (reduced) step(performance.now()); };
  let drag = null;
  on(canvas, 'pointerdown', e => { if (e.pointerType !== 'mouse') drag = e.clientY; });
  on(window, 'pointerup', () => { drag = null; });
  on(window, 'pointercancel', () => { drag = null; });
  on(canvas, 'dblclick', () => lookTo(0, 0));   // straight down the aisle again
  on(doc, 'mouseleave', () => { mouse.in = false; edge = 0; hud.classList.remove('is-look-l', 'is-look-r'); });
  on(window, 'pointermove', e => {
    if (e.pointerType === 'mouse') {
      const nx = e.clientX / innerWidth;
      lean.tx = nx * 2 - 1; lean.ty = e.clientY / innerHeight * 2 - 1;
      Object.assign(mouse, { x: e.clientX, y: e.clientY, in: true });
      edge = mode === 'fly' ? clamp((0.12 - nx) / 0.12) ** 2 - clamp((nx - 0.88) / 0.12) ** 2 : 0;   // + = turn left
      hud.classList.toggle('is-look-l', edge > 0); hud.classList.toggle('is-look-r', edge < 0);
      if (reduced && mode === 'fly') step(performance.now());
    }
    else if (drag !== null && mode === 'fly') {
      const dy = drag - e.clientY;
      if (!reduced) { go(goal + dy * 0.0033); drag = e.clientY; }   // a ~300 px swipe ≈ the next screen
      else if (Math.abs(dy) > 40) { go(Math.round(goal) + Math.sign(dy), true); drag = e.clientY; }   // a swipe = the next screen
    }
  });
  on(window, 'resize', resize);
  on(document, 'visibilitychange', () => { if (document.hidden) stop(); else if (mode !== 'idle' && mode !== 'held') { last = 0; run(); } });

  if (new URLSearchParams(location.search).has('xrdebug')) window.__xr = { renderer, scene, camera, state: () => ({ mode, u, goal, vel, fov: camera.fov, tier: tier(), qual: { ...qual } }), go, watch };   // dev: triangle counts, quality steps (watch(ms) feeds the watchdog)

  // ---- first frame: the camera exactly where the page is
  resize();
  A = handPose(r);
  for (const b of bands) { stripPose(r, b.i, b.from); b.to.p.copy(b.aisle.p); b.to.q.copy(b.aisle.q); }
  for (const b of bands) if (!r.list.includes(b.i)) b.from.p.copy(b.aisle.p), b.from.q.copy(b.aisle.q);
  placeBands(() => 0);
  setFrames(0);
  const establish = c => {   // the reveal's last frame: on the flight line a little short of screen c, up high, looking down the aisle
    flyPose(c - 0.35, Bp);
    Bp.p.y += 0.5;
    Bp.q.copy(look(Bp.p, v.set(0, EYE - 0.2, Bp.p.z - 12)));
  };
  establish(r.c);
  camera.position.copy(A.p); camera.quaternion.copy(A.q);
  await Promise.all(bands.map(b => useSet(b, r.list.includes(b.i) ? 'x-hi' : 'x-lo').catch(() => useSet(b, 'x-lo'))));
  await renderer.compileAsync(scene, camera);
  step(performance.now());

  return {
    async enter({ hold = false } = {}) {
      if (hold) { doc.classList.add('xr-3d'); last = 0; step(performance.now()); return; }   // the hand-off frame, held (calibration)
      if (reduced) {   // straight to a still of the aisle at the screen you were on
        mode = 'fly'; u = goal = r.c; t = 9;
        placeBands(() => 1); setFrames(1); wave = 999; setStrips();
        await transition(() => { doc.classList.add('xr-3d'); step(performance.now()); }, 350, { ready: vt => vt && doc.animate({ opacity: [1, 0] }, { duration: 350, fill: 'forwards', pseudoElement: '::view-transition-old(root)' }) });
        wakeSet().then(() => step(performance.now()));
        return;
      }
      hint.classList.add('is-quiet');
      mode = 'reveal'; t = 0; last = 0;
      doc.classList.add('xr-vt-hand');
      await transition(() => { doc.classList.add('xr-3d'); draw(); }, 650, { frame: (k, now) => {
        if (!handing) { handing = true; t = 0; last = now; }   // the reveal's clock starts with the transition's first frame
        step(now);   // the page is set aside by now: setting --xr-m on <html> each frame restyles next to nothing
      } });
      handing = false;
      doc.classList.remove('xr-vt-hand');
      run();
    },
    async leave() {
      const target = mode === 'fly' ? clamp(Math.round(u), 0, N - 1) : r.c;
      const y = target === c0 ? y0 : live ? clamp(live.ys[target], 0, live.max) : y0;
      r = region(stripTop(y));
      lit.uZ0.value = bands[r.c].aisle.p.z;
      for (const b of bands) {
        b.from.p.copy(b.group.position); b.from.q.copy(b.group.quaternion);
        if (r.list.includes(b.i)) stripPose(r, b.i, b.to); else b.to.p.copy(b.aisle.p), b.to.q.copy(b.aisle.q);
        if (r.list.includes(b.i)) useSet(b, 'x-hi').catch(() => {});
      }
      A = handPose(r);
      from.p.copy(camera.position); from.q.copy(camera.quaternion);
      kick0 = kick; vel = 0;
      mode = 'leave'; t = 0;
      hint.classList.add('is-quiet');
      if (reduced) { leaveAt(T_OUT); mode = 'held'; step(performance.now()); return y; }
      run();
      await new Promise(res => { done = res; });
      await Promise.race([Promise.all(r.list.map(j => useSet(bands[j], 'x-hi'))).catch(() => {}), sleep(1200)]);
      last = 0; step(performance.now());
      stop();
      return y;
    },
    stop,
    dispose() {
      stop(); ac.abort();
      note.remove(); hud.classList.remove('is-look-l', 'is-look-r');
      mixer.stopAllAction(); mixer.uncacheRoot(model);
      scene.traverse(o => {
        o.geometry?.dispose();
        for (const m of [].concat(o.material || [])) { for (const val of Object.values(m)) if (val?.isTexture) val.dispose(); m.dispose(); }
      });
      for (const b of bands) b.tiles.forEach(m => { m.material.uniforms.mapX.value = m.material.uniforms.mapN.value = null; });
      for (const tx of Object.values(tex)) tx.then(x => x.dispose(), () => {});
      shared.forEach(x => x.dispose());
      scene.environment?.dispose();
      renderer.dispose();
      renderer.forceContextLoss();   // free the context now (browsers cap live contexts)
      for (const p of pre?.bm.values() || []) p.then(b => b.close(), () => {});
      pre = null;
    },
  };
}
