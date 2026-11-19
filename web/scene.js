// The farm diorama. Everything here is presentation: the machines are simulated and their motion only
// replays outcomes the server already decided from real Telegraph answers.
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";

const V3 = THREE.Vector3;
const UP = new V3(0, 1, 0);
const COL = {
  hi: 0xffd426, ink: 0x23272b, white: 0xf7f7f2, steel: 0xc9ced3, wood: 0x8b6b4a,
  turf: 0x85b84f, soil: 0xb08552, soilDark: 0x86603a, sub: 0x6f4a2e, gravel: 0xd3c7aa, road: 0x8f9296,
  ok: 0x17914f, bad: 0xe0412f, hold: 0xd98a00, water: 0x5fb3ea, panel: 0x1e3a5f,
};

// small seeded generator so the layout is the same on every load
let seed = 20261119;
const rnd = () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

const mats = new Map();
function mat(color, o = {}) {
  const key = color + JSON.stringify(o);
  if (!mats.has(key)) mats.set(key, new THREE.MeshStandardMaterial({ color, roughness: 0.78, metalness: 0, ...o }));
  return mats.get(key);
}
const shadow = (m, cast = true, receive = true) => { m.castShadow = cast; m.receiveShadow = receive; return m; };
const at = (m, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) => { m.position.set(x, y, z); m.rotation.set(rx, ry, rz); return m; };
function rbox(w, h, d, color, r = 0.12, o) {
  const rad = Math.max(0.01, Math.min(r, Math.min(w, h, d) / 2 - 0.005));
  return shadow(new THREE.Mesh(new RoundedBoxGeometry(w, h, d, 3, rad), mat(color, o)));
}
const cyl = (rt, rb, h, color, seg = 20, o) => shadow(new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), mat(color, o)));
const sph = (r, color, o, seg = 20) => shadow(new THREE.Mesh(new THREE.SphereGeometry(r, seg, Math.max(8, seg * 0.7)), mat(color, o)));
function beam(a, b, r, color, o) {
  const d = b.clone().sub(a);
  const m = cyl(r, r, d.length(), color, 8, o);
  m.position.copy(a).addScaledVector(d, 0.5);
  m.quaternion.setFromUnitVectors(UP, d.clone().normalize());
  return m;
}
function canvasTex(w, h, draw) {
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  draw(c.getContext("2d"), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

// ---------------------------------------------------------------- machines
function buildKite() {
  const g = new THREE.Group();
  g.add(at(rbox(1.7, 0.56, 1.7, COL.ink, 0.24), 0, 1.25, 0));
  g.add(at(rbox(1.15, 0.24, 1.15, COL.hi, 0.1, { roughness: 0.45 }), 0, 1.6, 0));
  const tank = shadow(new THREE.Mesh(new THREE.CapsuleGeometry(0.46, 0.8, 6, 16), mat(COL.white, { roughness: 0.35 })));
  g.add(at(tank, 0, 0.72, 0, 0, 0, Math.PI / 2));
  g.add(at(rbox(0.5, 0.2, 0.96, COL.hi, 0.06), 0, 0.72, 0));
  const props = [];
  for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
    const a = new V3(sx * 0.6, 1.3, sz * 0.6), b = new V3(sx * 2.05, 1.42, sz * 2.05);
    g.add(beam(a, b, 0.11, COL.ink));
    g.add(at(cyl(0.24, 0.28, 0.42, COL.hi, 16, { roughness: 0.45 }), b.x, b.y + 0.05, b.z));
    const p = new THREE.Group();
    p.position.set(b.x, b.y + 0.32, b.z);
    p.add(rbox(1.9, 0.04, 0.17, 0x15181b, 0.02));
    const disc = new THREE.Mesh(new THREE.CircleGeometry(0.98, 28), new THREE.MeshBasicMaterial({ color: 0x15181b, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false }));
    disc.rotation.x = -Math.PI / 2;
    p.add(disc);
    p.userData.disc = disc;
    g.add(p);
    props.push(p);
  }
  for (const sz of [-0.78, 0.78]) {
    g.add(beam(new V3(-1.05, 0.08, sz), new V3(1.05, 0.08, sz), 0.07, COL.ink));
    for (const sx of [-0.6, 0.6]) g.add(beam(new V3(sx, 0.08, sz), new V3(sx * 0.7, 1.05, sz * 0.7), 0.05, COL.ink));
  }
  g.add(at(rbox(3.5, 0.08, 0.1, COL.ink, 0.03), 0, 0.42, -0.25));
  for (const x of [-1.55, -0.52, 0.52, 1.55]) g.add(at(cyl(0.07, 0.04, 0.16, COL.hi, 8), x, 0.33, -0.25));
  // spray mist: only drawn while the drone is on a spray pass
  const N = 90;
  const pos = new Float32Array(N * 3), ph = new Float32Array(N);
  for (let i = 0; i < N; i++) ph[i] = rnd();
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  const mist = new THREE.Points(geo, new THREE.PointsMaterial({ color: 0xe9f6ff, size: 0.2, transparent: true, opacity: 0.85, depthWrite: false }));
  mist.visible = false;
  mist.frustumCulled = false;
  g.add(mist);
  g.userData = { props, mist, ph };
  return g;
}

function buildLark() {
  const g = new THREE.Group();
  const blue = 0x2f6fe0;
  const body = shadow(new THREE.Mesh(new THREE.CapsuleGeometry(0.36, 2.4, 6, 16), mat(COL.white, { roughness: 0.4 })));
  g.add(at(body, 0, 1.0, 0, 0, 0, Math.PI / 2));
  g.add(at(sph(0.3, 0x1b2026, { roughness: 0.15, metalness: 0.4 }), 1.42, 0.92, 0));
  g.add(at(rbox(0.95, 0.09, 5.6, COL.white, 0.04, { roughness: 0.4 }), 0.15, 1.3, 0));
  for (const s of [-1, 1]) {
    g.add(at(rbox(0.95, 0.1, 0.55, blue, 0.04), 0.15, 1.3, s * 2.9));
    g.add(at(rbox(0.7, 0.07, 1.15, COL.white, 0.03), -1.55, 1.42, s * 0.5, s * -0.6, 0, 0));
    g.add(beam(new V3(-1.15, 1.18, s * 1.45), new V3(1.2, 1.18, s * 1.45), 0.07, COL.ink));
  }
  const props = [];
  for (const [x, z] of [[1.1, 1.45], [1.1, -1.45], [-1.05, 1.45], [-1.05, -1.45]]) {
    const p = new THREE.Group();
    p.position.set(x, 1.32, z);
    p.add(rbox(1.15, 0.03, 0.12, 0x15181b, 0.01));
    const disc = new THREE.Mesh(new THREE.CircleGeometry(0.6, 24), new THREE.MeshBasicMaterial({ color: 0x15181b, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false }));
    disc.rotation.x = -Math.PI / 2;
    p.add(disc);
    p.userData.disc = disc;
    g.add(p);
    props.push(p);
  }
  for (const s of [-1, 1]) for (const x of [-0.6, 0.6]) g.add(beam(new V3(x, 0.06, s * 0.5), new V3(x, 0.75, s * 0.25), 0.045, COL.ink));
  for (const s of [-1, 1]) g.add(beam(new V3(-0.8, 0.06, s * 0.5), new V3(0.8, 0.06, s * 0.5), 0.055, COL.ink));
  g.userData = { props };
  return g;
}

function buildMule() {
  const g = new THREE.Group();
  g.add(at(rbox(3.0, 0.7, 1.9, COL.hi, 0.22, { roughness: 0.5 }), 0, 0.98, 0));
  g.add(at(rbox(3.04, 0.16, 1.94, COL.ink, 0.06), 0, 0.68, 0));
  g.add(at(rbox(2.3, 0.08, 1.66, COL.panel, 0.03, { roughness: 0.2, metalness: 0.4 }), -0.25, 1.4, 0, 0, 0, 0.05));
  for (const x of [-1.08, 0, 1.08]) for (const z of [-1.08, 1.08]) {
    g.add(at(cyl(0.5, 0.5, 0.4, 0x1b1d1f, 20, { roughness: 0.95 }), x, 0.5, z, Math.PI / 2));
    g.add(at(cyl(0.22, 0.22, 0.43, COL.steel, 12, { metalness: 0.5, roughness: 0.4 }), x, 0.5, z, Math.PI / 2));
  }
  g.add(at(cyl(0.07, 0.07, 1.3, COL.ink, 8), 1.05, 2.0, 0));
  const head = new THREE.Group();
  head.position.set(1.05, 2.72, 0);
  head.add(rbox(0.56, 0.34, 0.4, COL.white, 0.1));
  head.add(at(sph(0.12, 0x101418, { roughness: 0.1, metalness: 0.6 }, 12), 0.27, 0, 0.09));
  head.add(at(sph(0.08, 0x101418, { roughness: 0.1, metalness: 0.6 }, 12), 0.27, 0, -0.1));
  g.add(head);
  const led = at(sph(0.1, 0xffffff, { emissive: COL.hi, emissiveIntensity: 0.4 }, 10), -1.52, 1.05, 0);
  g.add(led);
  g.userData = { head, led };
  return g;
}

function buildHaul() {
  const g = new THREE.Group();
  g.add(at(rbox(6.7, 0.3, 1.9, COL.ink, 0.08), 0.15, 0.78, 0));
  g.add(at(rbox(1.9, 2.0, 2.3, COL.white, 0.32, { roughness: 0.4 }), 2.4, 1.72, 0));
  g.add(at(rbox(0.12, 0.82, 1.95, 0x1c2630, 0.04, { roughness: 0.1, metalness: 0.6 }), 3.32, 2.08, 0));
  for (const s of [-1, 1]) g.add(at(rbox(0.9, 0.7, 0.1, 0x1c2630, 0.04, { roughness: 0.1, metalness: 0.6 }), 2.72, 2.12, s * 1.13));
  g.add(at(rbox(0.3, 0.42, 2.34, COL.hi, 0.1), 3.3, 0.86, 0));
  const lamps = [];
  for (const s of [-1, 1]) {
    const l = at(sph(0.13, 0xffffff, { emissive: 0xfff2b0, emissiveIntensity: 0.1 }, 10), 3.42, 1.22, s * 0.82);
    g.add(l);
    lamps.push(l);
  }
  g.add(at(rbox(4.6, 2.75, 2.5, COL.white, 0.14, { roughness: 0.45 }), -0.9, 2.3, 0));
  g.add(at(rbox(4.62, 0.5, 2.52, 0x1fa95b, 0.08), -0.9, 1.38, 0));
  g.add(at(rbox(0.5, 0.8, 1.7, COL.steel, 0.1, { metalness: 0.3, roughness: 0.5 }), 1.72, 3.18, 0));
  for (const x of [-2.5, -1.35, 2.5]) for (const z of [-1.06, 1.06]) {
    g.add(at(cyl(0.54, 0.54, 0.4, 0x1b1d1f, 20, { roughness: 0.95 }), x, 0.54, z, Math.PI / 2));
    g.add(at(cyl(0.24, 0.24, 0.43, COL.steel, 12, { metalness: 0.5, roughness: 0.4 }), x, 0.54, z, Math.PI / 2));
  }
  g.userData = { lamps };
  return g;
}

function buildLedger() {
  const g = new THREE.Group();
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2;
    g.add(beam(new V3(Math.cos(a) * 1.0, 0, Math.sin(a) * 1.0), new V3(0, 1.5, 0), 0.05, COL.ink));
  }
  g.add(at(cyl(0.07, 0.07, 4.4, COL.steel, 10, { metalness: 0.4, roughness: 0.4 }), 0, 2.2, 0));
  g.add(at(rbox(1.1, 1.15, 1.1, COL.white, 0.12), 0, 2.2, 0));
  for (let i = 0; i < 4; i++) g.add(at(rbox(1.14, 0.05, 1.14, COL.steel, 0.02), 0, 1.82 + i * 0.25, 0));
  g.add(at(rbox(0.95, 0.06, 0.7, COL.panel, 0.02, { roughness: 0.2, metalness: 0.4 }), 0.75, 3.35, 0, 0, 0, -0.5));
  const cups = new THREE.Group();
  cups.position.set(0, 4.5, 0);
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2;
    cups.add(beam(new V3(0, 0, 0), new V3(Math.cos(a) * 0.7, 0, Math.sin(a) * 0.7), 0.03, COL.ink));
    cups.add(at(sph(0.16, COL.hi, { roughness: 0.4 }, 12), Math.cos(a) * 0.7, 0, Math.sin(a) * 0.7));
  }
  g.add(cups);
  g.add(at(rbox(0.9, 1.3, 0.6, COL.steel, 0.1, { metalness: 0.3, roughness: 0.5 }), 1.35, 0.65, 0.2));
  const led = at(sph(0.11, 0xffffff, { emissive: COL.hi, emissiveIntensity: 0.3 }, 10), 1.35, 1.1, 0.52);
  g.add(led);
  g.userData = { cups, led };
  return g;
}

const BUILDERS = { kite: buildKite, lark: buildLark, mule: buildMule, haul: buildHaul, ledger: buildLedger };

// A small transparent render of one machine, for the dock.
export function machineThumb(id, size = 168) {
  const r = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
  r.setPixelRatio(2);
  r.setSize(size, size, false);
  r.toneMapping = THREE.ACESFilmicToneMapping;
  const s = new THREE.Scene();
  s.add(new THREE.HemisphereLight(0xffffff, 0xaab4bd, 2.6));
  const dl = new THREE.DirectionalLight(0xffffff, 2.8);
  dl.position.set(-3, 6, 4);
  s.add(dl);
  const o = BUILDERS[id]();
  s.add(o);
  const box = new THREE.Box3().setFromObject(o);
  const c = box.getCenter(new V3()), rad = box.getSize(new V3()).length() / 2;
  const cam = new THREE.PerspectiveCamera(26, 1, 0.1, 100);
  cam.position.copy(c).add(new V3(1.1, 0.72, 1.35).normalize().multiplyScalar((rad / Math.sin((13 * Math.PI) / 180)) * 0.98));
  cam.lookAt(c);
  r.render(s, cam);
  const url = r.domElement.toDataURL("image/png");
  r.dispose();
  r.forceContextLoss();
  return url;
}

// ---------------------------------------------------------------- world
export function createScene(host, { low = false } = {}) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, low ? 1.5 : 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.toneMappingExposure = 0.98;
  host.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.38;

  const camera = new THREE.PerspectiveCamera(26, 1, 1, 600);
  const HOME = new V3(0, 1, 0);
  camera.position.copy(HOME).add(new V3(-0.56, 0.6, 0.9).normalize().multiplyScalar(120));
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.copy(HOME);
  controls.enableDamping = true;
  controls.enablePan = false;
  controls.minPolarAngle = 0.5;
  controls.maxPolarAngle = 1.3;
  controls.zoomSpeed = 0.6;
  if (low) controls.enableZoom = false;

  scene.add(new THREE.HemisphereLight(0xdcecff, 0xb39a6c, 0.95));
  const sun = new THREE.DirectionalLight(0xfff1d6, 2.7);
  sun.position.set(-34, 60, 30);
  sun.castShadow = true;
  sun.shadow.mapSize.set(low ? 1024 : 2048, low ? 1024 : 2048);
  Object.assign(sun.shadow.camera, { left: -52, right: 52, top: 44, bottom: -44, near: 1, far: 190 });
  sun.shadow.bias = -0.0005;
  sun.shadow.normalBias = 0.04;
  sun.shadow.radius = 5;
  scene.add(sun);

  const world = new THREE.Group();
  scene.add(world);
  const add = (m) => (world.add(m), m);

  // slab with soil strata
  add(at(rbox(72, 2, 48, COL.turf, 0.9), 0, -1, 0));
  add(at(rbox(71.6, 0.7, 47.6, 0x5f7f35, 0.3), 0, -1.9, 0));
  add(at(rbox(71.2, 5, 47.2, 0xa5713f, 0.8), 0, -4.4, 0));
  add(at(rbox(70, 4.4, 46, COL.sub, 1.4), 0, -8.2, 0));
  for (let i = 0; i < 26; i++) {
    const onX = rnd() > 0.4, s = rnd() > 0.5 ? 1 : -1;
    const stone = sph(0.25 + rnd() * 0.5, i % 3 ? 0x8a7a68 : 0xa39684, { roughness: 1 }, 8);
    stone.scale.y = 0.7;
    add(at(stone, onX ? (rnd() - 0.5) * 66 : s * 35.4, -3 - rnd() * 6, onX ? s * 23.4 : (rnd() - 0.5) * 42));
  }
  const blob = new THREE.Mesh(new THREE.PlaneGeometry(128, 96), new THREE.MeshBasicMaterial({
    map: canvasTex(256, 256, (c, w, h) => {
      const g = c.createRadialGradient(w / 2, h / 2, 10, w / 2, h / 2, w / 2);
      g.addColorStop(0, "rgba(30,50,85,0.42)"); g.addColorStop(0.5, "rgba(30,50,85,0.16)"); g.addColorStop(1, "rgba(40,60,90,0)");
      c.fillStyle = g; c.fillRect(0, 0, w, h);
    }), transparent: true, depthWrite: false,
  }));
  add(at(blob, 3, -15, 5, -Math.PI / 2));

  // beds
  const bed = (x0, x1, z0, z1, color = COL.soil) => add(at(rbox(x1 - x0, 0.5, z1 - z0, color, 0.24, { roughness: 0.95 }), (x0 + x1) / 2, 0.2, (z0 + z1) / 2));
  function bushRows(x0, x1, z0, z1, { colors, r = 0.62, sy = 0.8, gapZ = 1.8, gapX = 1.25 }) {
    const nz = Math.floor((z1 - z0 - 1.4) / gapZ) + 1, nx = Math.floor((x1 - x0 - 1.4) / gapX) + 1;
    const mesh = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(r, 2), mat(0xffffff, { roughness: 0.9 }), nz * nx);
    const d = new THREE.Object3D(), c = new THREE.Color();
    let i = 0;
    for (let a = 0; a < nz; a++) for (let b = 0; b < nx; b++) {
      d.position.set(x0 + 0.7 + b * gapX + (rnd() - 0.5) * 0.18, 0.45 + r * sy * 0.55, z0 + 0.7 + a * gapZ);
      const s = 0.82 + rnd() * 0.36;
      d.scale.set(s * 1.05, s * sy, s);
      d.rotation.y = rnd() * 3;
      d.updateMatrix();
      mesh.setMatrixAt(i, d.matrix);
      mesh.setColorAt(i++, c.setHex(colors[(a + (rnd() > 0.8 ? 1 : 0)) % colors.length]).offsetHSL(0, 0, (rnd() - 0.5) * 0.05));
    }
    add(shadow(mesh));
  }
  // block 1: citrus orchard
  bed(-34, -18.5, -21, -7.5, 0x7fb548);
  const fruit = [];
  for (let a = 0; a < 3; a++) for (let b = 0; b < 4; b++) {
    const x = -32 + b * 3.9, z = -19 + a * 4.6;
    add(at(cyl(0.18, 0.24, 1.5, COL.wood, 8), x, 1.2, z));
    const top = sph(1.35, a % 2 ? 0x3f8a3c : 0x4a973f, { roughness: 0.95 }, 14);
    top.scale.y = 0.92;
    add(at(top, x, 2.7, z));
    add(at(sph(0.85, 0x4f9f44, { roughness: 0.95 }, 12), x + 0.7, 3.1, z + 0.4));
    for (let k = 0; k < 5; k++) fruit.push([x + (rnd() - 0.5) * 2.2, 2.3 + rnd() * 1.2, z + 0.9 + rnd() * 0.5]);
  }
  const fr = new THREE.InstancedMesh(new THREE.SphereGeometry(0.16, 8, 6), mat(0xff9a1f, { roughness: 0.5 }), fruit.length);
  const dm = new THREE.Object3D();
  fruit.forEach((p, i) => { dm.position.set(...p); dm.updateMatrix(); fr.setMatrixAt(i, dm.matrix); });
  add(fr);
  // block 2: lettuce
  bed(-16.5, 0, -21, -7.5);
  bushRows(-16.5, 0, -21, -7.5, { colors: [0x8fd05a, 0x7cc24c], r: 0.52, sy: 0.62, gapZ: 1.55, gapX: 1.12 });
  // block 3: vines, the spray target
  const B3 = { x0: -34, x1: -14, z0: -2, z1: 12.5 };
  bed(B3.x0, B3.x1, B3.z0, B3.z1);
  bushRows(B3.x0, B3.x1, B3.z0, B3.z1, { colors: [0x4f9a3d, 0x5aa845], r: 0.66, sy: 1.0, gapZ: 2.05, gapX: 1.1 });
  for (let a = 0; a < 7; a++) for (const x of [B3.x0 + 0.45, B3.x1 - 0.45]) add(at(cyl(0.07, 0.07, 1.5, COL.wood, 6), x, 1.1, B3.z0 + 0.7 + a * 2.05));
  // block 4: bare soil under the pivot irrigator
  const B4 = { x0: -12, x1: 1.5, z0: -2, z1: 12.5 };
  bed(B4.x0, B4.x1, B4.z0, B4.z1, 0xa27647);
  for (let i = 0; i < 8; i++) add(at(rbox(B4.x1 - B4.x0 - 1.2, 0.12, 0.5, COL.soilDark, 0.06, { roughness: 1 }), (B4.x0 + B4.x1) / 2, 0.48, B4.z0 + 1.1 + i * 1.75));
  const pivot = new THREE.Group();
  pivot.position.set((B4.x0 + B4.x1) / 2, 0.45, (B4.z0 + B4.z1) / 2);
  add(at(cyl(0.25, 0.4, 2.4, COL.steel, 10, { metalness: 0.4, roughness: 0.4 }), pivot.position.x, 1.6, pivot.position.z));
  pivot.add(beam(new V3(-6, 2.3, 0), new V3(6, 2.3, 0), 0.09, COL.steel, { metalness: 0.4, roughness: 0.4 }));
  for (const x of [-5.6, -2.8, 2.8, 5.6]) {
    pivot.add(beam(new V3(x, 2.3, 0), new V3(x - 0.5, 0.35, 0), 0.05, COL.steel));
    pivot.add(beam(new V3(x, 2.3, 0), new V3(x + 0.5, 0.35, 0), 0.05, COL.steel));
    pivot.add(at(cyl(0.3, 0.3, 0.2, 0x1b1d1f, 12), x, 0.3, 0, Math.PI / 2));
  }
  const DN = 70, dpos = new Float32Array(DN * 3), dph = new Float32Array(DN * 2);
  for (let i = 0; i < DN; i++) { dph[i * 2] = rnd() * 12 - 6; dph[i * 2 + 1] = rnd(); }
  const dgeo = new THREE.BufferGeometry();
  dgeo.setAttribute("position", new THREE.BufferAttribute(dpos, 3));
  const drizzle = new THREE.Points(dgeo, new THREE.PointsMaterial({ color: 0xbfe4ff, size: 0.18, transparent: true, opacity: 0.9, depthWrite: false }));
  drizzle.visible = false;
  drizzle.frustumCulled = false;
  pivot.add(drizzle);
  add(pivot);
  // canal
  add(at(rbox(41.5, 0.3, 2.9, 0x74a843, 0.14), -15.2, 0.02, -4.75));
  add(at(rbox(41, 0.3, 1.9, COL.water, 0.1, { roughness: 0.08, metalness: 0.1 }), -15.2, 0.06, -4.75));

  // road, yard, pads
  add(at(rbox(72.2, 0.24, 4.6, COL.road, 0.1, { roughness: 0.95 }), 0, 0.02, 17.2));
  const dashes = new THREE.InstancedMesh(new THREE.BoxGeometry(1.6, 0.02, 0.2), mat(0xfbfaf5), 18);
  for (let i = 0; i < 18; i++) { dm.position.set(-34 + i * 4, 0.15, 17.2); dm.rotation.set(0, 0, 0); dm.scale.set(1, 1, 1); dm.updateMatrix(); dashes.setMatrixAt(i, dm.matrix); }
  dashes.receiveShadow = true;
  add(dashes);
  add(at(rbox(25.5, 0.24, 17, COL.gravel, 0.5, { roughness: 1 }), 21.3, 0.02, 5.6));
  add(at(rbox(7, 0.24, 3, COL.gravel, 0.3, { roughness: 1 }), 21.5, 0.02, 14.6));
  const padTex = (letter) => canvasTex(256, 256, (c, w) => {
    c.fillStyle = "#eef0ec"; c.beginPath(); c.arc(w / 2, w / 2, w / 2, 0, 7); c.fill();
    c.strokeStyle = "#ffd426"; c.lineWidth = 16; c.beginPath(); c.arc(w / 2, w / 2, w / 2 - 22, 0, 7); c.stroke();
    c.fillStyle = "#23272b"; c.font = "600 120px 'Host Grotesk', system-ui, sans-serif"; c.textAlign = "center"; c.textBaseline = "middle"; c.fillText(letter, w / 2, w / 2 + 6);
  });
  const pad = (x, z, letter) => {
    add(at(cyl(3.1, 3.2, 0.24, 0xe4e7e1, 36), x, 0.12, z));
    const top = new THREE.Mesh(new THREE.CircleGeometry(3.1, 36), new THREE.MeshStandardMaterial({ map: padTex(letter), roughness: 0.9 }));
    top.receiveShadow = true;
    add(at(top, x, 0.245, z, -Math.PI / 2));
  };
  pad(5.2, 4.2, "K");
  pad(12.5, -15.8, "L");
  add(at(rbox(4, 0.24, 3, COL.gravel, 0.3, { roughness: 1 }), 8.2, 0.02, 4.2));

  // buildings
  const roofShape = (w, h) => { const s = new THREE.Shape(); s.moveTo(-w / 2, 0); s.lineTo(0, h); s.lineTo(w / 2, 0); s.closePath(); return s; };
  function gable(w, h, len, color) {
    const m = shadow(new THREE.Mesh(new THREE.ExtrudeGeometry(roofShape(w, h), { depth: len, bevelEnabled: true, bevelSize: 0.08, bevelThickness: 0.08, bevelSegments: 2 }), mat(color, { roughness: 0.7 })));
    m.geometry.translate(0, 0, -len / 2);
    return m;
  }
  // barn
  add(at(rbox(10, 5, 7.4, 0xc8452f, 0.18), 26, 2.5, -13.5));
  add(at(gable(8.6, 2.6, 10.6, 0x3b3f45), 26, 5, -13.5, 0, Math.PI / 2));
  add(at(rbox(3, 3.4, 0.14, 0xf3ede2, 0.05), 26, 1.75, -9.74));
  add(beam(new V3(24.6, 0.2, -9.64), new V3(27.4, 3.3, -9.64), 0.09, 0xc8452f));
  add(beam(new V3(27.4, 0.2, -9.64), new V3(24.6, 3.3, -9.64), 0.09, 0xc8452f));
  for (const x of [22.6, 29.4]) add(at(rbox(1.1, 1.1, 0.14, 0xf3ede2, 0.05), x, 3.4, -9.74));
  // silo
  add(at(cyl(1.8, 1.8, 7, 0xdfe3e6, 28, { metalness: 0.45, roughness: 0.35 }), 33, 3.5, -9.5));
  const cap = sph(1.8, 0xcfd5da, { metalness: 0.45, roughness: 0.35 }, 24);
  cap.scale.y = 0.55;
  add(at(cap, 33, 7, -9.5));
  for (let i = 1; i < 5; i++) add(at(cyl(1.83, 1.83, 0.08, 0xb9c0c6, 28, { metalness: 0.5, roughness: 0.4 }), 33, i * 1.4, -9.5));
  // cold store, where Haul loads
  add(at(rbox(8, 4.4, 10, 0xf2f3ef, 0.2, { roughness: 0.5 }), 29.5, 2.2, 5));
  add(at(rbox(8.04, 0.5, 10.04, 0x1fa95b, 0.1), 29.5, 3.5, 5));
  add(at(rbox(8.4, 0.3, 10.4, 0x3b3f45, 0.1), 29.5, 4.5, 5));
  for (const z of [2.4, 7.6]) add(at(rbox(0.14, 2.8, 3, COL.steel, 0.05, { metalness: 0.4, roughness: 0.4 }), 25.46, 1.6, z));
  add(at(rbox(1.6, 0.9, 9.4, 0xcfd3d0, 0.1), 24.9, 0.45, 5));
  // charging canopy, where Mule plugs in
  const CH = { x: 13.5, z: -1.2 };
  for (const [dx, dz] of [[-2.2, -1.6], [2.2, -1.6], [-2.2, 1.6], [2.2, 1.6]]) add(at(cyl(0.1, 0.1, 3.4, COL.ink, 8), CH.x + dx, 1.7, CH.z + dz));
  add(at(rbox(5.4, 0.14, 4.2, COL.panel, 0.05, { roughness: 0.18, metalness: 0.5 }), CH.x, 3.55, CH.z, 0.16));
  for (let i = -2; i <= 2; i++) add(at(rbox(0.04, 0.16, 4.2, 0x9fb3c8, 0.01), CH.x + i * 0.9, 3.56, CH.z, 0.16));
  add(at(rbox(0.6, 1.9, 0.6, COL.white, 0.14), CH.x + 2.9, 0.95, CH.z - 0.6));
  const chargerLed = at(rbox(0.36, 0.5, 0.06, 0xffffff, 0.04, { emissive: COL.ok, emissiveIntensity: 0.15 }), CH.x + 2.9, 1.4, CH.z - 0.28);
  add(chargerLed);

  // telegraph mast and poles
  const MAST = new V3(32, 0, -20.4), MH = 16.5;
  const mast = new THREE.Group();
  const legAt = (c, y) => { const k = 1.45 - (y / MH) * 1.1; return new V3(c[0] * k, y, c[1] * k); };
  const corners = [[1, 1], [1, -1], [-1, -1], [-1, 1]];
  for (const c of corners) mast.add(beam(legAt(c, 0), legAt(c, MH), 0.1, COL.steel, { metalness: 0.5, roughness: 0.4 }));
  for (let y = 0; y < MH; y += 3.3) for (let i = 0; i < 4; i++) {
    const a = corners[i], b = corners[(i + 1) % 4];
    mast.add(beam(legAt(a, y + 3.3 > MH ? MH : y + 3.3), legAt(b, Math.min(MH, y + 3.3)), 0.055, y > 9 ? COL.hi : COL.steel, { metalness: 0.4, roughness: 0.45 }));
    mast.add(beam(legAt(a, y), legAt(b, Math.min(MH, y + 3.3)), 0.045, COL.steel, { metalness: 0.4, roughness: 0.45 }));
  }
  mast.add(at(cyl(0.75, 0.75, 0.18, COL.ink, 16), 0, MH + 0.05, 0));
  mast.add(at(cyl(0.05, 0.05, 2.6, COL.ink, 8), 0, MH + 1.4, 0));
  const beacon = at(sph(0.42, 0xffffff, { emissive: COL.hi, emissiveIntensity: 0.55, roughness: 0.3 }, 16), 0, MH + 2.9, 0);
  mast.add(beacon);
  for (const s of [-1, 1]) mast.add(at(cyl(0.7, 0.7, 0.22, COL.white, 20), s * 0.75, MH - 2.4, 0.5, Math.PI / 2, 0, s * 0.5));
  mast.position.copy(MAST);
  add(mast);
  const BEACON = MAST.clone().add(new V3(0, MH + 2.9, 0));
  const poleXs = [3.5, 13, 22.5];
  const wirePts = [[], []];
  for (const x of poleXs) {
    add(at(cyl(0.15, 0.2, 7.4, COL.wood, 10), x, 3.7, -22.2));
    add(at(rbox(0.18, 0.18, 2.3, COL.wood, 0.04), x, 6.8, -22.2));
    [-0.9, 0.9].forEach((dz, k) => {
      add(at(cyl(0.08, 0.1, 0.24, COL.white, 8, { roughness: 0.3 }), x, 7.0, -22.2 + dz));
      wirePts[k].push(new V3(x, 7.12, -22.2 + dz));
    });
  }
  wirePts.forEach((pts, k) => {
    pts.push(MAST.clone().add(new V3(-0.9, 9.6, k ? 0.4 : -0.4)));
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i], b = pts[i + 1], mid = a.clone().lerp(b, 0.5);
      mid.y -= 0.7;
      const tube = new THREE.Mesh(new THREE.TubeGeometry(new THREE.QuadraticBezierCurve3(a, mid, b), 14, 0.028, 5), mat(0x2b2f33));
      add(tube);
    }
  });

  // trees, fence, sign
  function tree(x, z, s = 1, tall = false) {
    add(at(cyl(0.2 * s, 0.28 * s, 1.6 * s, COL.wood, 8), x, 0.8 * s, z));
    if (tall) {
      const t = sph(1.15 * s, 0x3d8742, { roughness: 0.95 }, 14);
      t.scale.set(1, 2.2, 1);
      add(at(t, x, 3.6 * s, z));
    } else {
      add(at(sph(1.5 * s, 0x58a84a, { roughness: 0.95 }, 14), x, 2.6 * s, z));
      add(at(sph(1.05 * s, 0x69b955, { roughness: 0.95 }, 12), x + 0.9 * s, 3.3 * s, z + 0.3 * s));
      add(at(sph(0.95 * s, 0x4f9c44, { roughness: 0.95 }, 12), x - 0.8 * s, 3.0 * s, z - 0.5 * s));
    }
  }
  for (let i = 0; i < 9; i++) tree(-33.5 + i * 4.1, -22.6, 0.85 + rnd() * 0.3, true);
  tree(34, 13.5, 0.85); tree(25.5, 21.6, 1.0); tree(-33.2, 21.4, 1.15); tree(-28.6, 22.2, 0.8); tree(12, 22, 0.75); tree(8.5, -9.5, 0.9);
  for (let i = 0; i < 26; i++) {
    const x = -24 + i * 1.5;
    if (x > 9 && x < 15) continue;
    add(at(rbox(0.18, 1.0, 0.18, 0xf3ede2, 0.04), x, 0.5, 20.6));
  }
  add(at(rbox(33, 0.12, 0.1, 0xf3ede2, 0.03), -7.5, 0.82, 20.6));
  add(at(rbox(33, 0.12, 0.1, 0xf3ede2, 0.03), -7.5, 0.45, 20.6));
  const signTex = canvasTex(512, 200, (c, w, h) => {
    c.fillStyle = "#1c7a46"; c.fillRect(0, 0, w, h);
    c.strokeStyle = "#fff"; c.lineWidth = 8; c.strokeRect(10, 10, w - 20, h - 20);
    c.fillStyle = "#fff"; c.font = "600 84px 'Host Grotesk', system-ui, sans-serif"; c.textBaseline = "middle"; c.fillText("Fresno", 44, h / 2 + 4);
    c.beginPath(); c.moveTo(w - 150, h / 2); c.lineTo(w - 60, h / 2); c.lineWidth = 16; c.stroke();
    c.beginPath(); c.moveTo(w - 96, h / 2 - 36); c.lineTo(w - 54, h / 2); c.lineTo(w - 96, h / 2 + 36); c.stroke();
  });
  for (const x of [29.6, 32.8]) add(at(cyl(0.09, 0.09, 3.4, COL.steel, 8, { metalness: 0.4 }), x, 1.7, 20.8));
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(4.4, 1.72), new THREE.MeshStandardMaterial({ map: signTex, roughness: 0.6 }));
  sign.castShadow = true;
  add(at(sign, 31.2, 2.9, 20.9));

  // clouds drift across and drop soft shadows on the fields
  const clouds = [];
  for (let i = 0; i < 3; i++) {
    const g = new THREE.Group();
    const n = 4 + Math.floor(rnd() * 3);
    const cm = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, transparent: true, opacity: 0.94 });
    for (let k = 0; k < n; k++) {
      const s = new THREE.Mesh(new THREE.SphereGeometry(1.6 + rnd() * 1.5, 14, 10), cm);
      s.castShadow = true;
      s.position.set((k - n / 2) * 2.1, rnd() * 0.9, (rnd() - 0.5) * 2.2);
      s.scale.y = 0.62;
      g.add(s);
    }
    // clouds stay over the right half of the farm so they never drift behind the headline
    g.position.set(34 + i * 15 + rnd() * 5, 20 + rnd() * 4, -20 + i * 8 + rnd() * 4);
    g.userData = { v: 0.5 + rnd() * 0.45, m: cm };
    clouds.push(add(g));
  }

  // ---------------------------------------------------------------- machines in the world
  const ROAD_Z = 17.2, SCALE = 1.32; // machines are drawn a little oversized so they read at a glance
  const M = {
    kite: { home: new V3(5.2, 0.25, 4.2), tagY: 3.6 },
    lark: { home: new V3(12.5, 0.25, -15.8), tagY: 3.2, yaw: Math.PI },
    mule: { home: new V3(12, 0.14, 9.6), tagY: 4.2 },
    haul: { home: new V3(21.5, 0.14, 10.2), tagY: 5.0 },
    ledger: { home: new V3(19, 0, -5.6), tagY: 6.0 },
  };
  for (const [id, m] of Object.entries(M)) {
    m.id = id;
    m.obj = BUILDERS[id]();
    m.obj.scale.setScalar(SCALE);
    m.obj.position.copy(m.home);
    m.obj.rotation.order = "YXZ";
    m.obj.rotation.y = m.yaw ?? 0;
    m.mode = "idle";
    m.since = -1e6;
    m.lift = 0;
    const ring = new THREE.Mesh(new THREE.RingGeometry(3.5, 4.0, 56), new THREE.MeshBasicMaterial({ color: COL.hi, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false }));
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(m.home.x, 0.4, m.home.z);
    m.ring = ring;
    add(ring);
    add(m.obj);
  }
  let pivotOn = false;
  let selected = null;

  // pulses: a paid request leaves the machine for the mast; the answer comes back along the same arc
  const pulses = [], bursts = [];
  const pulseGeo = new THREE.SphereGeometry(1, 14, 10);
  function pulse(id, dir, color, size, dur, onDone) {
    const m = M[id];
    if (!m) return;
    const beads = [];
    for (let i = 0; i < 7; i++) {
      const b = new THREE.Mesh(pulseGeo, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 1 - i * 0.13 }));
      b.scale.setScalar(size * (1 - i * 0.11));
      scene.add(b);
      beads.push(b);
    }
    pulses.push({ m, dir, beads, t: 0, dur, onDone });
  }
  const pt = new V3(), pa = new V3(), pb = new V3(), pc = new V3();
  function arcPoint(m, k, out) {
    m.obj.getWorldPosition(pa);
    pa.y += 1.6;
    pb.copy(BEACON);
    pc.copy(pa).lerp(pb, 0.5);
    pc.y = Math.max(pa.y, pb.y) + 7;
    const u = 1 - k;
    return out.set(u * u * pa.x + 2 * u * k * pc.x + k * k * pb.x, u * u * pa.y + 2 * u * k * pc.y + k * k * pb.y, u * u * pa.z + 2 * u * k * pc.z + k * k * pb.z);
  }
  function burst(id, color) {
    const m = M[id];
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.82, 1, 48), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.95, side: THREE.DoubleSide, depthWrite: false }));
    ring.rotation.x = -Math.PI / 2;
    m.obj.getWorldPosition(ring.position);
    ring.position.y = Math.max(0.5, ring.position.y - 0.4);
    scene.add(ring);
    bursts.push({ ring, t: 0 });
  }

  // ---------------------------------------------------------------- frame and camera
  let frame = null, baseDist = 120, tween = null, onFrame = null;
  const BOX = [];
  for (const x of [-36, 36]) for (const y of [-8, 9]) for (const z of [-24, 24]) BOX.push(new V3(x, y, z));
  const pv = new V3();
  function bounds() {
    const W = host.clientWidth, H = host.clientHeight;
    let a = Infinity, b = -Infinity, c = Infinity, d = -Infinity;
    for (const p of BOX) {
      pv.copy(p).project(camera);
      const x = ((pv.x + 1) / 2) * W, y = ((1 - pv.y) / 2) * H;
      a = Math.min(a, x); b = Math.max(b, x); c = Math.min(c, y); d = Math.max(d, y);
    }
    return { minx: a, maxx: b, miny: c, maxy: d };
  }
  function fit() {
    const W = host.clientWidth, H = host.clientHeight;
    if (!W || !H) return;
    renderer.setSize(W, H, false);
    camera.aspect = W / H;
    camera.clearViewOffset();
    const f = frame ?? { x: W * 0.04, y: H * 0.06, w: W * 0.92, h: H * 0.88 };
    const dir = camera.position.clone().sub(controls.target).normalize();
    let d = 120, b;
    for (let i = 0; i < 4; i++) {
      camera.position.copy(HOME).addScaledVector(dir, d);
      camera.lookAt(HOME);
      camera.updateProjectionMatrix();
      camera.updateMatrixWorld();
      b = bounds();
      d *= Math.max((b.maxx - b.minx) / f.w, (b.maxy - b.miny) / f.h);
    }
    camera.position.copy(HOME).addScaledVector(dir, d);
    camera.lookAt(HOME);
    camera.updateMatrixWorld();
    b = bounds();
    camera.setViewOffset(W, H, (b.minx + b.maxx) / 2 - (f.x + f.w / 2), (b.miny + b.maxy) / 2 - (f.y + f.h / 2), W, H);
    baseDist = d;
    controls.target.copy(HOME);
    controls.minDistance = d * 0.3;
    controls.maxDistance = d * 1.5;
    controls.update();
    tween = null;
  }
  function focus(id) {
    selected = id && M[id] ? id : null;
    const off = camera.position.clone().sub(controls.target);
    tween = {
      t: 0, from: controls.target.clone(), fromDist: off.length(),
      to: () => (selected ? M[selected].obj.getWorldPosition(new V3()).setY(1.5) : HOME),
      toDist: selected ? baseDist * 0.5 : baseDist,
    };
  }
  const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
  const damp = (v, target, k, dt) => v.lerp(target, 1 - Math.exp(-k * dt));
  const turnTo = (o, yaw, k, dt) => { o.rotation.y += Math.atan2(Math.sin(yaw - o.rotation.y), Math.cos(yaw - o.rotation.y)) * (1 - Math.exp(-k * dt)); };
  const RING = { thinking: COL.hi, act: COL.ok, hold: COL.hold, unverified: COL.bad };

  function setMode(id, mode, { settled = false } = {}) {
    const m = M[id];
    if (!m) return;
    m.mode = mode;
    m.since = settled ? -1e6 : clock.elapsedTime;
    if (id === "lark" && mode !== "thinking" && mode !== "idle") pivotOn = mode !== "hold";
  }

  const clock = new THREE.Clock();
  const tv = new V3(), tv2 = new V3();
  function spin(props, on, dt) {
    for (const p of props) {
      p.userData.w = THREE.MathUtils.damp(p.userData.w ?? 0, on ? 38 : 0, 3, dt);
      p.rotation.y += p.userData.w * dt;
      p.userData.disc.material.opacity = Math.min(0.22, p.userData.w / 150);
      p.children[0].visible = p.userData.w < 24;
    }
  }
  function tick() {
    const dt = Math.min(clock.getDelta(), 0.05), t = clock.elapsedTime;

    // Kite: hovers while it is buying, sprays block 3 in passes only after an accepted "act"
    {
      const m = M.kite, o = m.obj, age = t - m.since;
      const spraying = m.mode === "act" && age > 2.5 && age < 44;
      const up = m.mode === "thinking" || (m.mode === "act" && age < 47);
      tv.copy(m.home);
      if (m.mode === "thinking") tv.y = 3.2 + Math.sin(t * 2.2) * 0.18;
      if (m.mode === "act" && age < 44) {
        const k = Math.max(0, age - 2.5), lane = Math.min(6, Math.floor(k / 5.9)), u = (k % 5.9) / 5.9;
        const x = lane % 2 ? B3.x1 - 1.5 - u * (B3.x1 - B3.x0 - 3) : B3.x0 + 1.5 + u * (B3.x1 - B3.x0 - 3);
        tv.set(age < 2.5 ? m.home.x : x, 4.3, age < 2.5 ? m.home.z : B3.z0 + 0.7 + lane * 2.05);
      } else if (m.mode === "act" && age < 47) tv.y = 4.3;
      const before = o.position.x;
      damp(o.position, tv, up ? 1.6 : 2.4, dt);
      o.rotation.z = THREE.MathUtils.damp(o.rotation.z, THREE.MathUtils.clamp((before - o.position.x) * 2.2, -0.22, 0.22), 4, dt);
      spin(o.userData.props, up || o.position.y > m.home.y + 0.25, dt);
      const mist = o.userData.mist;
      mist.visible = spraying && o.position.y > 3.6;
      if (mist.visible) {
        const p = mist.geometry.attributes.position, ph = o.userData.ph;
        for (let i = 0; i < ph.length; i++) {
          const f = (t * 0.9 + ph[i]) % 1;
          p.setXYZ(i, ((i % 4) - 1.5) * 1.03 + Math.sin(i * 7.1) * 0.25 * f, 0.3 - f * 3.2, -0.25 + Math.cos(i * 3.3) * 0.3 * f);
        }
        p.needsUpdate = true;
      }
    }
    // Lark: takes off and circles the fields while it is checking imagery
    {
      const m = M.lark, o = m.obj, age = t - m.since;
      const air = m.mode === "thinking" || (m.mode !== "idle" && age < 14);
      if (air) {
        const a = t * 0.42;
        tv.set(-13 + Math.cos(a) * 17, 12.5, -3 + Math.sin(a) * 12);
        damp(o.position, tv, 1.1, dt);
        turnTo(o, Math.atan2(-Math.cos(a) * 12, -Math.sin(a) * 17), 3, dt); // nose along the flight path
        o.rotation.x = THREE.MathUtils.damp(o.rotation.x, 0.26, 2, dt);      // bank into the turn
      } else {
        damp(o.position, m.home, 1.3, dt);
        turnTo(o, m.yaw, 2.5, dt);
        o.rotation.x = THREE.MathUtils.damp(o.rotation.x, 0, 3, dt);
      }
      spin(o.userData.props, air || o.position.y > m.home.y + 0.3, dt);
    }
    // Haul: leaves along the road only when the drive fits the cold chain, then comes back
    {
      const m = M.haul, o = m.obj, age = t - m.since;
      let vis = 1;
      if (m.mode === "act" && age < 34) {
        if (age < 3) tv.set(m.home.x + ease(age / 3) * 2.9, m.home.y, m.home.z + ease(age / 3) * (ROAD_Z - m.home.z));
        else if (age < 11) tv.set(23.5 + ((age - 3) / 8) * 26, m.home.y, ROAD_Z);
        else if (age < 24) { tv.set(49.5, m.home.y, ROAD_Z); vis = 0; }
        else tv.set(49.5 - ease((age - 24) / 10) * 31, m.home.y, ROAD_Z + (m.home.z - ROAD_Z) * ease(Math.max(0, (age - 29) / 5)));
        tv2.copy(tv).sub(o.position);
        if (age < 11 && tv2.lengthSq() > 1e-5) turnTo(o, Math.atan2(-tv2.z, tv2.x), 5, dt);
        if (age >= 24) turnTo(o, Math.PI * (age < 31 ? 1 : 0), 3, dt);
        o.position.copy(tv);
      } else {
        damp(o.position, m.home, 3, dt);
        turnTo(o, 0, 4, dt);
      }
      const edge = THREE.MathUtils.clamp((40 - o.position.x) / 5, 0, 1) * vis;
      o.visible = edge > 0.02;
      o.scale.setScalar((0.4 + 0.6 * edge) * SCALE);
      for (const l of o.userData.lamps) l.material.emissiveIntensity = m.mode === "thinking" || (m.mode === "act" && age < 34) ? 1.6 : 0.1;
    }
    // Mule: rolls under the canopy and plugs in when it charges now, otherwise waits in its bay
    {
      const m = M.mule, o = m.obj;
      tv.set(m.mode === "act" ? CH.x : m.home.x, m.home.y, m.mode === "act" ? CH.z + 0.2 : m.home.z);
      damp(o.position, tv, 1.2, dt);
      o.userData.head.rotation.y = m.mode === "thinking" ? Math.sin(t * 2.4) * 0.9 : THREE.MathUtils.damp(o.userData.head.rotation.y, 0, 3, dt);
      const charging = m.mode === "act" && o.position.distanceTo(tv) < 0.4;
      o.userData.led.material.emissive.setHex(charging ? COL.ok : COL.hi);
      o.userData.led.material.emissiveIntensity = charging ? 1.2 + Math.sin(t * 4) * 0.8 : 0.4;
      chargerLed.material.emissiveIntensity = charging ? 1.4 + Math.sin(t * 4) * 0.9 : 0.15;
    }
    // Ledger: the cups turn in the wind; the lamp blinks while it is buying
    {
      const m = M.ledger;
      m.obj.userData.cups.rotation.y += dt * 2.6;
      m.obj.userData.led.material.emissiveIntensity = m.mode === "thinking" ? 1 + Math.sin(t * 9) : 0.3;
    }
    // pivot irrigator follows Lark's last call
    if (pivotOn) pivot.rotation.y += dt * 0.16;
    drizzle.visible = pivotOn;
    if (pivotOn) {
      const p = drizzle.geometry.attributes.position;
      for (let i = 0; i < DN; i++) { const f = (t * 1.2 + dph[i * 2 + 1]) % 1; p.setXYZ(i, dph[i * 2], 2.2 - f * 2, Math.sin(i * 5.7) * 0.35 * f); }
      p.needsUpdate = true;
    }

    for (const m of Object.values(M)) {
      const c = RING[m.mode], target = selected === m.id ? 0.9 : m.mode === "thinking" ? 0.55 + Math.sin(t * 5) * 0.3 : c && t - m.since < 9 ? 0.8 : 0;
      m.ring.material.color.setHex(selected === m.id && !c ? COL.ink : c ?? COL.hi);
      m.ring.material.opacity = THREE.MathUtils.damp(m.ring.material.opacity, target, 6, dt);
      m.ring.scale.setScalar(m.mode === "thinking" ? 1 + Math.sin(t * 5) * 0.04 : 1);
    }
    beacon.material.emissiveIntensity = THREE.MathUtils.damp(beacon.material.emissiveIntensity, pulses.length ? 2.6 : 0.55, 5, dt);

    for (let i = pulses.length - 1; i >= 0; i--) {
      const p = pulses[i];
      p.t += dt / p.dur;
      p.beads.forEach((b, k) => {
        const u = THREE.MathUtils.clamp(p.t - k * 0.035, 0, 1), e = ease(u);
        arcPoint(p.m, p.dir > 0 ? e : 1 - e, pt);
        b.position.copy(pt);
        b.visible = p.t - k * 0.035 > 0 && u < 1;
      });
      if (p.t >= 1.25) {
        p.beads.forEach((b) => { scene.remove(b); b.material.dispose(); });
        pulses.splice(i, 1);
        p.onDone?.();
      } else if (p.t >= 1 && !p.hit) { p.hit = true; p.onHit?.(); }
    }
    for (let i = bursts.length - 1; i >= 0; i--) {
      const b = bursts[i];
      b.t += dt;
      b.ring.scale.setScalar(1.5 + ease(Math.min(1, b.t / 0.9)) * 5);
      b.ring.material.opacity = Math.max(0, 0.95 - b.t / 0.9);
      if (b.t > 0.9) { scene.remove(b.ring); b.ring.geometry.dispose(); b.ring.material.dispose(); bursts.splice(i, 1); }
    }
    for (const c of clouds) {
      c.position.x += c.userData.v * dt;
      if (c.position.x > 78) c.position.x = 30;
      c.userData.m.opacity = 0.94 * THREE.MathUtils.clamp((c.position.x - 30) / 8, 0, 1) * THREE.MathUtils.clamp((78 - c.position.x) / 8, 0, 1);
    }

    if (tween) {
      tween.t = Math.min(1, tween.t + dt / 1.1);
      const e = ease(tween.t), off = camera.position.clone().sub(controls.target).normalize();
      controls.target.copy(tween.from).lerp(tween.to(), e);
      camera.position.copy(controls.target).addScaledVector(off, tween.fromDist + (tween.toDist - tween.fromDist) * e);
      if (tween.t >= 1) tween = null;
    }
    controls.update();
    renderer.render(scene, camera);

    if (onFrame) {
      const W = host.clientWidth, H = host.clientHeight, out = {};
      for (const m of Object.values(M)) {
        m.obj.getWorldPosition(pv);
        pv.y += m.tagY;
        pv.project(camera);
        out[m.id] = { x: ((pv.x + 1) / 2) * W, y: ((1 - pv.y) / 2) * H, show: m.obj.visible && pv.z < 1 && Math.abs(pv.x) < 1.1 && Math.abs(pv.y) < 1.1 };
      }
      onFrame(out);
    }
    requestAnimationFrame(tick);
  }

  new ResizeObserver(() => fit()).observe(host);
  fit();
  requestAnimationFrame(tick);

  return {
    setMode,
    focus,
    // dir "out": the machine's paid request travels to the mast. dir "in": the answer comes back.
    request: (id) => pulse(id, 1, 0x23272b, 0.2, 0.9),
    deliver: (id, verdict) => new Promise((done) => {
      const good = verdict === "accepted";
      pulse(id, -1, COL.hi, 0.34, 0.95, null);
      pulses[pulses.length - 1].onHit = () => { burst(id, good ? COL.ok : COL.bad); done(); };
    }),
    setFrame: (f) => { frame = f; fit(); },
    onFrame: (fn) => { onFrame = fn; },
    get selected() { return selected; },
  };
}
