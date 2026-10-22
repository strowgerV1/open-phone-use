// The STROWGER machine: one GLB, mountable on several canvases.
//   const m = await mountMachine(canvas, { mode: 'hero' | 'inspect' | 'ghost' | 'phone', screen })
// ghost: the frame is rendered pale (a faded technical drawing), only the iPhone keeps its colour.
// phone: just the supplied iPhone, standing upright; drag (or arrow keys) turns it 360°, idles into a slow spin.
//        view({ theta }) sets the turn in degrees (0 = screen facing you, 180 = back).
// screen: optional { canvas, draw(time, touch) => bool(changed) } — drawn onto the iPhone's display.
// night: always the dark lighting/look, whatever the page theme.
// fadeFrame: every part but the iPhone can fade: setFrame(0) = the phone alone, setFrame(1) = the whole machine.
// Tap + swipe timings come from the model's 5 s "Tap and swipe" clip (measured from the GLB).
// Device tiers (TIER, decided once): 0 = no 3D (Save-Data, 2G, ≤2 GB): mountMachine throws before anything is fetched and
// the callers' flat fallbacks take over; so does a blocklisted or software GPU. 1 = phones, tablets, ≤4 GB: pixel ratio
// 1.4, the floor shadow baked once instead of a shadow pass every frame. 2 = desktop, full quality.
// Tier 1 and ≤4 cores render at most ~30 fps. ?force3d skips the checks (tests on software GL).
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

const MODEL = new URL('../assets/model/phoneuse.glb', import.meta.url).href;
const DRACO = new URL('../assets/vendor/draco/', import.meta.url).href;
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
const FORCE = new URLSearchParams(location.search).has('force3d');
const net = navigator.connection || {}, mem = navigator.deviceMemory || 8;
const lite = FORCE ? '' : net.saveData ? 'Save-Data' : /2g$/.test(net.effectiveType) ? `${net.effectiveType} network` : mem <= 2 ? `${mem} GB memory` : '';
export const TIER = lite ? 0 : matchMedia('(pointer: coarse)').matches || mem <= 4 ? 1 : 2;
const CAP = TIER < 2 || (navigator.hardwareConcurrency || 8) <= 4;
let broken = ''; // a GPU that failed one canvas fails them all: later mounts give up before fetching anything
const off = why => Object.assign(new Error(`3D off: ${why}`), { name: 'Off3D' });
let bytes; // fetch once, parse per instance (each canvas needs its own scene graph + skeletons)
const draco = new DRACOLoader().setDecoderPath(DRACO);
const loader = new GLTFLoader().setDRACOLoader(draco);
// a fresh parse of the GLB (own scene graph + skeletons); the bytes are fetched once, the Draco decoder alongside them.
// Also used by xray-scene.js.
export const loadModel = async () => loader.parseAsync((await (bytes ??= (draco.preload(), fetch(MODEL).then(r => r.arrayBuffer())))).slice(0), '');

// a WebGL 2 context, or a throw: none at all, a major performance caveat (blocklisted GPU) or a software rasteriser
// behind it (SwiftShader, llvmpipe) would crawl at a few fps. Made here, not by three, so a refusal fails quietly.
function context(canvas, antialias) {
  const gl = canvas.getContext('webgl2', { antialias, alpha: true, powerPreference: 'high-performance', failIfMajorPerformanceCaveat: !FORCE });
  let name = gl?.getParameter(gl.RENDERER) || '';
  if (/^WebKit/.test(name)) { const x = gl.getExtension('WEBGL_debug_renderer_info'); if (x) name = gl.getParameter(x.UNMASKED_RENDERER_WEBGL); }
  if (gl && (FORCE || !/SwiftShader|llvmpipe|Software/i.test(name))) return gl;
  if (gl) release(canvas);
  throw off(broken = gl ? `software renderer (${name})` : 'no WebGL 2');
}
// give a refused canvas's memory back but keep its context: a lost one paints an opaque placeholder over the
// fallback poster behind or on the canvas (.ud-canvas draws its poster as its own background)
const release = canvas => { canvas.width = canvas.height = 1; };

export const PARTS = ['phone', 'tapper', 'camera', 'cable'];
// probe tip → mesh UV, measured: u = -10.9469x + .0961, v = 5.0756z + .4996 (canvas u = 1 - u)
const uvOf = p => ({ u: -10.9469 * p.x + 0.0961, v: 5.0756 * p.z + 0.4996 });
export const ANCHORS = { phone: [-0.037, 0.068, 0.03], tapper: [0.103, 0.138, 0.014], camera: [-0.0385, 0.197, -0.0528], cable: [0.011, 0.026, 0.182] };

const VIEWS = {
  hero: { target: [0.012, 0.085, 0.01], theta: 38, phi: 56, radius: 1.04, fov: 30 },
  inspect: { target: [0.02, 0.095, 0.0], theta: 32, phi: 57, radius: 1.08, fov: 30 },
  ghost: { target: [0.012, 0.09, 0.01], theta: 30, phi: 58, radius: 1.0, fov: 28 },
  phone: { target: [0, 0, 0], theta: -18, phi: 84, radius: 0.62, fov: 24 },
};

const ORBIT_KEYS = ['theta', 'phi', 'radius', 'shiftX', 'shiftY', 'roll', 'tx', 'ty', 'tz'];
// resolve once el is within one viewport of the screen — scenes below the fold aren't built at page load
const near = el => new Promise(res => {
  const io = new IntersectionObserver(es => { if (es.at(-1).isIntersecting) { io.disconnect(); res(); } }, { rootMargin: '100% 0px' });
  io.observe(el);
});

export async function mountMachine(canvas, opts = {}) {
  const { mode = 'hero' } = opts;
  if (lite || broken) throw off(lite || broken);
  // (the Draco decoder is fetched by loadModel, with the GLB: only once a GPU has passed, never for a refused one)
  if (mode !== 'hero' || scrollY > innerHeight) await near(canvas); // (a page restored far down builds the hero only when near)
  if (mode !== 'hero') await new Promise(r => (window.requestIdleCallback || setTimeout)(r, { timeout: 600 })); // build between scroll frames
  if (broken) throw off(broken);
  // tier 1 draws ~half the pixels of 2x. MSAA stays below 1.5x: at 1.4x the edges match the 2x look (1.5x without it
  // shows stair-steps on the rails); from 1.5x up the extra samples would cost more than they show
  const ratio = Math.min(devicePixelRatio, TIER < 2 ? 1.4 : mode === 'inspect' ? 1.5 : mode === 'ghost' ? 1.75 : 2);
  const renderer = new THREE.WebGLRenderer({ canvas, context: context(canvas, TIER > 1 || ratio < 1.5), alpha: true });
  renderer.setPixelRatio(ratio);
  try { return await build(canvas, renderer, opts); }
  catch (err) { renderer.dispose(); release(canvas); throw err; } // a failed mount holds no GPU memory
}

async function build(canvas, renderer, { mode = 'hero', screen = null, onFrame = null, startAt = 1.6, easeRate = 6, night = false, fadeFrame = false }) {
  const gltf = await loadModel();
  let dirtyAll = () => {};
  // night = dark lighting. inspect/phone always sit on dark surfaces; hero/ghost follow the page theme unless asked for night.
  const alwaysNight = night || mode === 'inspect' || mode === 'phone', ghost = mode === 'ghost', solo = mode === 'phone';
  const pageDark = () => document.documentElement.dataset.theme === 'dark';
  let dark = alwaysNight || pageDark();

  renderer.setClearColor(0, 0);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const scene = new THREE.Scene();
  // the room's reflections, rendered on the GPU (so made again when a lost context comes back)
  const environment = () => {
    const pmrem = new THREE.PMREMGenerator(renderer), room = new RoomEnvironment(), env = pmrem.fromScene(room, 0.04).texture;
    pmrem.dispose(); room.dispose(); // keep the environment map, not the generator's half-float ping-pong target and blur
    return env;
  };
  scene.environment = environment();
  await new Promise(r => setTimeout(r)); // context + PMREM are one long task already: let a scroll frame through
  const hemi = new THREE.HemisphereLight(0xffffff, 0x8a8478, 0.85);
  scene.add(hemi);
  const key = new THREE.DirectionalLight(0xfff6ea, 2.6);
  key.position.set(0.3, 0.75, 0.35);
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024); // 2048 looked the same (PCF-soft blurs it) at 4x the memory and fill
  Object.assign(key.shadow.camera, { left: -0.45, right: 0.45, top: 0.45, bottom: -0.45, near: 0.1, far: 2 });
  key.shadow.bias = -0.00005; key.shadow.normalBias = 0.0008; key.shadow.radius = 6;
  scene.add(key);
  // rim lights so a black machine reads on a black background (night only)
  const rim = new THREE.DirectionalLight(0xbfdcff, 2.2); rim.position.set(-0.6, 0.4, -0.5); scene.add(rim);
  const warm = new THREE.DirectionalLight(0xffb48a, 0.9); warm.position.set(0.7, 0.2, -0.2); scene.add(warm);
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(3, 3), new THREE.ShadowMaterial({ opacity: 0.17 }));
  floor.rotation.x = -Math.PI / 2; floor.position.y = 0.0008; floor.receiveShadow = true;
  scene.add(floor);
  // tier 1: the key light's floor shadow, rendered once from above into a texture on the floor (the clip barely moves
  // it). Then no shadow pass and no shadow lookups per frame; the machine keeps all but its faint self-shadowing.
  const bakeFloor = () => {
    renderer.shadowMap.enabled = key.castShadow = false;
    if (!floor.visible) return key.shadow.dispose();
    const box = new THREE.Box3().setFromObject(model), L = key.position, xs = [], zs = [];
    for (const x of [box.min.x, box.max.x]) for (const y of [box.min.y, box.max.y]) for (const z of [box.min.z, box.max.z]) { xs.push(x - (L.x / L.y) * y); zs.push(z - (L.z / L.y) * y); }
    const x0 = Math.min(...xs) - 0.04, x1 = Math.max(...xs) + 0.04, z0 = Math.min(...zs) - 0.04, z1 = Math.max(...zs) + 0.04;
    const w = x1 - x0, d = z1 - z0, N = 512, px = new Uint8Array(N * N * 4), rt = new THREE.WebGLRenderTarget(N, N);
    const cam = new THREE.OrthographicCamera(-w / 2, w / 2, d / 2, -d / 2, 0.01, 2); // looking down, image up = -z
    cam.position.set(x0 + w / 2, 1, z0 + d / 2); cam.up.set(0, 0, -1); cam.lookAt(x0 + w / 2, 0, z0 + d / 2);
    // the machine casts but draws nothing (double-sided, as its own materials cast)
    const mats = meshes.map(o => o.material), hide = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide, colorWrite: false, depthWrite: false });
    for (const o of meshes) o.material = hide;
    renderer.shadowMap.enabled = key.castShadow = true;
    floor.material.opacity = 1;
    renderer.setRenderTarget(rt); renderer.clear(); renderer.render(scene, cam);
    renderer.readRenderTargetPixels(rt, 0, 0, N, N, px); // kept on the CPU too, so a restored context gets it back
    renderer.setRenderTarget(null);
    renderer.shadowMap.enabled = key.castShadow = false;
    meshes.forEach((o, i) => { o.material = mats[i]; });
    rt.dispose(); hide.dispose(); key.shadow.dispose(); floor.material.dispose(); floor.geometry.dispose();
    const map = Object.assign(new THREE.DataTexture(px, N, N), { magFilter: THREE.LinearFilter, minFilter: THREE.LinearMipmapLinearFilter, generateMipmaps: true, needsUpdate: true });
    floor.geometry = new THREE.PlaneGeometry(w, d);
    floor.position.set(x0 + w / 2, 0.0008, z0 + d / 2);
    floor.material = new THREE.MeshBasicMaterial({ color: 0, map, transparent: true, depthWrite: false, opacity: floorBase * frameK });
  };

  const model = gltf.scene;
  scene.add(model);
  const mixer = new THREE.AnimationMixer(model);
  const clip = gltf.animations[0];
  mixer.clipAction(clip).play();

  // material groups ("phone | …", "tapper | …") for hover + highlight
  const meshes = [], groups = {};
  let screenMesh = null, probe = null;
  model.traverse(o => {
    if (!probe && o.name.includes('capacitive')) probe = o;
    if (!o.isMesh) return;
    o.castShadow = true; o.receiveShadow = true;
    meshes.push(o);
    for (const m of [].concat(o.material)) {
      const g = m.name.split(' | ')[0];
      (groups[g] ??= new Set()).add(m);
      if (m.name === 'phone | Supplied Material.004') screenMesh = o;
    }
  });
  if (solo) { // lift the iPhone out of the machine, centre it and stand it up (screen toward +z)
    let placement = null;
    model.traverse(o => { if (!placement && o.name.includes('placement')) placement = o; });
    model.updateMatrixWorld(true);
    const centre = new THREE.Box3().setFromObject(placement).getCenter(new THREE.Vector3());
    const pivot = new THREE.Group();
    pivot.position.copy(centre);
    scene.add(pivot);
    pivot.attach(placement);
    pivot.position.set(0, 0, 0);
    pivot.rotation.x = Math.PI / 2;
    scene.remove(model);
    floor.visible = false;
  }
  // ghost look: the frame fades into the page (pale on paper, a faint silhouette at night); only the phone stays real
  const looks = new Map();
  if (ghost) {
    const paper = new THREE.Color(0xe4e2dc), night = new THREE.Color(0x0f1012);
    for (const [g, set] of Object.entries(groups)) if (g !== 'phone') for (const m of set) {
      const pale = { color: m.color.clone().lerp(paper, g === 'cable' ? 0.5 : 0.8), emissive: new THREE.Color(0xd8d5cd), ei: 0.22, metalness: 0, roughness: 0.85, env: 0.4 };
      const dim = { color: m.color.clone().lerp(night, g === 'cable' ? 0.8 : 0.97), emissive: new THREE.Color(g === 'cable' ? 0x1f2c34 : 0x1f2125), ei: 1, metalness: 0, roughness: 1, env: 0.02 };
      looks.set(m, { pale, dim });
    }
  }
  // fadeFrame: those materials go transparent once, here, before the shaders compile — a fade then only moves the
  // opacity uniform. The parts come in one after another, so the machine assembles around the phone.
  const FADE_AT = { chassis: 0, camera: 0.2, tapper: 0.35, cable: 0.5 };
  const fading = [];
  let frameK = 1, floorBase = 0;
  if (fadeFrame) for (const o of meshes) {
    const mats = [].concat(o.material), g = mats[0].name.split(' | ')[0];
    if (g === 'phone') continue;
    mats.forEach(m => { m.transparent = true; m.forceSinglePass = true; }); // one pass: no back/front split that relinks the program per draw
    fading.push([o, mats, FADE_AT[g] ?? 0]);
  }
  const snapshotBase = () => { for (const set of Object.values(groups)) for (const m of set) m.userData.base = { color: m.color.clone(), emissive: m.emissive.clone(), ei: m.emissiveIntensity }; };
  snapshotBase();

  function applyTheme() {
    dark = alwaysNight || pageDark();
    rim.visible = warm.visible = dark;
    rim.intensity = ghost ? 0.35 : 2.2; warm.intensity = ghost ? 0.1 : 0.9; // a ghost only needs a hint of edge light
    hemi.groundColor.set(dark ? 0x30343a : 0x8a8478); hemi.intensity = dark ? 0.5 : 0.85;
    key.intensity = dark ? 2.4 : 2.6;
    renderer.toneMappingExposure = dark ? 1.15 : 1.05;
    scene.environmentIntensity = dark ? 0.9 : 1;
    floorBase = ghost ? (dark ? 0.2 : 0.06) : dark ? 0.45 : 0.17;
    floor.material.opacity = floorBase * frameK;
    for (const [m, l] of looks) {
      const v = dark ? l.dim : l.pale;
      m.color.copy(v.color); m.emissive.copy(v.emissive); m.emissiveIntensity = v.ei;
      m.metalness = v.metalness; m.roughness = v.roughness; m.envMapIntensity = v.env;
    }
    snapshotBase();
  }
  applyTheme();
  if (!alwaysNight) new MutationObserver(() => { applyTheme(); applyHighlight(); dirtyAll(); }).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

  // live display
  let screenTex = null;
  if (screen && screenMesh) {
    screenTex = new THREE.CanvasTexture(screen.canvas);
    screenTex.flipY = false;
    screenTex.colorSpace = THREE.SRGBColorSpace;
    screenTex.anisotropy = 8;
    screenTex.repeat.x = -1; screenTex.offset.x = 1; // the model's screen UVs run right-to-left
    const m = screenMesh.material;
    screen.wallpaper = m.emissiveMap?.image || null; // the supplied wallpaper, for lock screens
    // a display emits its own colours: black albedo, texture as emission, no tone mapping
    m.map = null; m.emissiveMap = screenTex;
    m.color.set(0x000000); m.emissive.set(0xffffff); m.emissiveIntensity = 0.92;
    m.roughness = 0.12; m.metalness = 0.0; m.toneMapped = false;
    if (fadeFrame) m.envMap = scene.environment; // its own handle on the glass reflection (scene.environment ignores envMapIntensity): setFrame dims it
    m.userData.base = { color: m.color.clone(), emissive: m.emissive.clone(), ei: m.emissiveIntensity };
    m.needsUpdate = true;
  }

  // camera + orbit (yaw/pitch offsets are driven by the page: pointer parallax, scroll, drag)
  const v = VIEWS[mode];
  const camera = new THREE.PerspectiveCamera(v.fov, 1, 0.01, 10);
  const target = new THREE.Vector3(), arm = new THREE.Vector3();
  const orbit = { theta: v.theta, phi: v.phi, radius: v.radius, shiftX: 0, shiftY: 0, roll: 0, tx: v.target[0], ty: v.target[1], tz: v.target[2] };
  const goal = { ...orbit };
  const placeCamera = () => {
    target.set(orbit.tx, orbit.ty, orbit.tz);
    camera.position.copy(target).add(arm.setFromSphericalCoords(orbit.radius, THREE.MathUtils.degToRad(orbit.phi), THREE.MathUtils.degToRad(orbit.theta)));
    camera.lookAt(target);
    if (orbit.roll) camera.rotateZ(THREE.MathUtils.degToRad(orbit.roll));
    // film offset lets the page slide the machine inside the canvas without moving the canvas
    camera.setViewOffset(W, H, -orbit.shiftX * W, -orbit.shiftY * H, W, H);
  };

  let W = 1, H = 1; // css size, kept by the ResizeObserver: a frame never reads layout
  const resize = () => {
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (!w || !h) return;
    W = w; H = h;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    dirty = true;
  };
  let dirty = true;
  dirtyAll = () => { dirty = true; if (!running && api) api.render(); };
  new ResizeObserver(() => { resize(); kick(); }).observe(canvas);

  // highlight state: weights per part, eased
  const weights = Object.fromEntries(PARTS.map(p => [p, 0]));
  let focus = null;
  const tint = new THREE.Color(0xff4f14), tmp = new THREE.Color();
  const applyHighlight = () => {
    const total = Math.min(1, PARTS.reduce((a, p) => a + weights[p], 0));
    for (const [g, set] of Object.entries(groups)) {
      const w = weights[g] || 0;
      for (const m of set) {
        const b = m.userData.base;
        if (m === screenMesh?.material) { m.emissiveIntensity = b.ei * (1 - 0.5 * total * (1 - w)); continue; } // the display stays a display
        m.color.copy(b.color).multiplyScalar(1 - 0.6 * total * (1 - w));
        m.emissive.copy(b.emissive).lerp(tmp.copy(tint), w * 0.55);
        m.emissiveIntensity = b.ei + w * 0.5;
      }
    }
  };

  // pointer picking (inspect mode)
  const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
  const pick = (x, y) => {
    const r = canvas.getBoundingClientRect();
    ndc.set(((x - r.left) / r.width) * 2 - 1, -((y - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    const hit = ray.intersectObjects(meshes, false)[0];
    if (!hit) return null;
    const m = Array.isArray(hit.object.material) ? hit.object.material[hit.face.materialIndex] : hit.object.material;
    const g = m.name.split(' | ')[0];
    return PARTS.includes(g) ? g : null;
  };

  // touch state from the probe tip (for screen ripple + sync)
  const tipWorld = new THREE.Vector3(), vtx = new THREE.Vector3();
  let tipLocal = null;
  const touch = { u: 0.5, v: 0.5, down: false, clipT: 0, loop: 0 };
  const readTip = () => {
    if (!probe) return;
    if (!tipLocal) { // lowest vertex of the probe, cached in probe space
      let best = null, bestMesh = null;
      probe.traverse(o => { if (!o.isMesh) return; const a = o.geometry.attributes.position; for (let i = 0; i < a.count; i++) { vtx.fromBufferAttribute(a, i).applyMatrix4(o.matrixWorld); if (!best || vtx.y < best.y) { best = vtx.clone(); bestMesh = o; } } });
      tipLocal = probe.worldToLocal(best.clone());
    }
    tipWorld.copy(tipLocal);
    probe.localToWorld(tipWorld);
    const uv = uvOf(tipWorld);
    touch.u = 1 - uv.u; touch.v = uv.v; // in canvas space (texture is mirrored back above)
    touch.down = tipWorld.y < 0.0663; // screen sits at y = .0658
  };

  // the loop runs only while visible AND something moves; anything that changes the scene calls kick()
  let running = false, raf = 0, last = performance.now(), drawn = 0, elapsed = reduced ? startAt : 0, visible = false, posed = false;
  mixer.setTime(elapsed % clip.duration);
  let animate = !reduced && !solo;
  // phone mode: drag / keys turn it; after a pause it drifts on its own
  let lastTouch = -1e9, drag = null;
  if (solo) {
    canvas.style.touchAction = 'pan-y';
    canvas.style.cursor = 'grab';
    if (!canvas.hasAttribute('tabindex')) canvas.tabIndex = 0;
    canvas.addEventListener('pointerdown', e => { drag = { x: e.clientX, theta: goal.theta }; lastTouch = performance.now(); canvas.style.cursor = 'grabbing'; kick(); });
    addEventListener('pointermove', e => { if (!drag) return; goal.theta = drag.theta - (e.clientX - drag.x) * 0.6; lastTouch = performance.now(); kick(); });
    addEventListener('pointerup', () => { if (drag) { drag = null; canvas.style.cursor = 'grab'; lastTouch = performance.now(); } });
    canvas.addEventListener('keydown', e => {
      const d = e.key === 'ArrowLeft' ? -30 : e.key === 'ArrowRight' ? 30 : 0;
      if (d) { e.preventDefault(); goal.theta += d; lastTouch = performance.now(); kick(); }
    });
  }
  const loopFrame = now => {
    raf = 0;
    if (CAP && running && now - drawn < 30) { raf = requestAnimationFrame(loopFrame); return; } // low end: every other frame (dt spans both)
    drawn = now;
    const dt = Math.max(0, Math.min((now - last) / 1000, 0.05)); last = now; // rAF stamps can predate start()
    const live = (animate && !focus) || (solo && !reduced); // clip playing, or the phone's idle spin
    if (animate && !focus) { elapsed += dt; mixer.setTime(elapsed % clip.duration); posed = false; dirty = true; }
    touch.clipT = elapsed % clip.duration; touch.loop = Math.floor(elapsed / clip.duration);
    if (solo) { elapsed += dt; if (!reduced && !drag && now - lastTouch > 2500) goal.theta += dt * 16; }
    // ease orbit
    for (const k of ORBIT_KEYS) {
      if (!Number.isFinite(orbit[k])) { orbit[k] = goal[k]; dirty = true; continue; }
      const d = goal[k] - orbit[k];
      if (Math.abs(d) > 1e-4) { orbit[k] += d * Math.min(1, dt * easeRate); dirty = true; }
      else if (d) { orbit[k] = goal[k]; dirty = true; } // settle, so the loop can park
    }
    // ease highlight
    let hl = false;
    for (const p of PARTS) {
      const to = focus === p ? 1 : 0, d = to - weights[p];
      if (Math.abs(d) > 1e-3) { weights[p] += d * Math.min(1, dt * 10); hl = true; } else weights[p] = to;
    }
    if (hl) { applyHighlight(); dirty = true; }
    if (!posed) { model.updateMatrixWorld(true); readTip(); posed = true; } // only when the clip time moved
    if (screen && screen.draw(elapsed, touch)) { screenTex.needsUpdate = true; dirty = true; }
    const idle = !live && !dirty;
    if (dirty) {
      placeCamera();
      renderer.render(scene, camera);
      dirty = false;
      onFrame?.(api);
    }
    if (running) { if (idle) running = false; else raf = requestAnimationFrame(loopFrame); } // settled: park until kick()
  };
  const start = () => { if (running) return; running = true; last = performance.now(); raf = requestAnimationFrame(loopFrame); };
  const stop = () => { running = false; cancelAnimationFrame(raf); raf = 0; };
  let lost = false;
  const kick = () => { if (visible && !document.hidden && !lost) start(); };
  // entries queue up while the main thread is busy (a stale one first, e.g. mid smooth-scroll): the last one is current
  new IntersectionObserver(es => { visible = es.at(-1).isIntersecting; visible ? kick() : stop(); }, { rootMargin: '10% 0px' }).observe(canvas);
  document.addEventListener('visibilitychange', () => { if (document.hidden) stop(); else kick(); });
  // a lost context parks the loop. three re-uploads what it holds the data for when it comes back (the baked floor keeps
  // its pixels for that), but the environment map only ever lived on the GPU: without a new one the machine comes back flat black
  canvas.addEventListener('webglcontextlost', () => { lost = true; stop(); });
  canvas.addEventListener('webglcontextrestored', () => {
    lost = false;
    scene.environment = environment();
    if (screenMesh?.material.envMap) screenMesh.material.envMap = scene.environment;
    dirty = true; kick();
  });

  const proj = new THREE.Vector3();
  const api = {
    mode, camera, touch, clipDuration: clip.duration,
    get time() { return elapsed; },
    /** set orbit goal: {theta, phi, radius, roll, shiftX, shiftY, target:[x,y,z]} (degrees / model units / fraction of canvas).
     *  Eases there while on screen; snap = jump there now. */
    view(o, snap = false) {
      const { target: t, ...rest } = o;
      for (const k in rest) if (Number.isFinite(rest[k])) goal[k] = rest[k];   // a NaN would stick in the orbit for good
      if (t?.every(Number.isFinite)) [goal.tx, goal.ty, goal.tz] = t;
      if (snap || !visible || document.hidden) { Object.assign(orbit, goal); dirty = true; }
      kick();
    },
    base: { ...orbit },
    focus(part) { focus = PARTS.includes(part) ? part : null; dirty = true; kick(); },
    get focused() { return focus; },
    pick,
    setAnimate(on) { animate = on && !reduced; kick(); },
    /** fadeFrame only: 0 = the iPhone alone, 1 = the whole machine around it */
    setFrame(k) {
      if (!fading.length || k === frameK) return;
      frameK = k;
      for (const [o, mats, at] of fading) {
        const w = Math.min(1, Math.max(0, (k - at) / (1 - at)));
        o.visible = w > 0.002; // gone, not just clear: no draw call, no shadow
        for (const m of mats) { m.opacity = w; m.transparent = w < 1; } // assembled = opaque again: no sorting, no blending
      }
      floor.material.opacity = floorBase * k; floor.visible = !solo && k > 0.002;
      // the phone alone is seen head-on from above, where its glass would mirror the room's ceiling lights: keep the display clean
      if (screenMesh?.material.envMap) screenMesh.material.envMapIntensity = scene.environmentIntensity * (0.15 + 0.85 * k);
      dirty = true; kick();
    },
    /** project a world point [x,y,z] to canvas pixels */
    project(p) {
      proj.fromArray(p).project(camera);
      return { x: (proj.x * 0.5 + 0.5) * W, y: (-proj.y * 0.5 + 0.5) * H, behind: proj.z > 1 };
    },
    render() { dirty = true; if (!running) loopFrame(performance.now()); kick(); },
    /** render the exact frame at clip time t (seconds), camera snapped to its goal — for offline sprites */
    seek(t) {
      animate = false; elapsed = t; Object.assign(orbit, goal);
      mixer.setTime(t % clip.duration); model.updateMatrixWorld(true); readTip(); posed = true;
      if (screen) { screen.draw(t + 100, touch); screenTex.needsUpdate = true; }
      placeCamera(); renderer.render(scene, camera);
    },
  };
  resize();
  placeCamera();
  model.updateMatrixWorld(true);
  if (TIER < 2) bakeFloor();
  await renderer.compileAsync(scene, camera); // compile shaders off the critical path instead of stalling the first frame
  renderer.render(scene, camera);
  onFrame?.(api);
  return api;
}
