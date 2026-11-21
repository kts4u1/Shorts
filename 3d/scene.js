// 문어 쇼츠 3D 장면 (three.js). Python 이 계산한 프레임 상태를 받아 한 장씩 렌더링한다.
import * as THREE from 'three';
import { FontLoader } from 'three/addons/loaders/FontLoader.js';
import { TextGeometry } from 'three/addons/geometries/TextGeometry.js';

const W = 1080, H = 1920;
const TAU = Math.PI * 2;
const ZAXIS = new THREE.Vector3(0, 0, 1);
const UP = new THREE.Vector3(0, 1, 0);

// ------------------------------------------------------------------ utils
function mulberry32(a) {
  return function () {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
const rnd = (i, salt = 0) => { const v = Math.sin(i * 12.9898 + salt * 78.233) * 43758.5453; return v - Math.floor(v); };
const lerp = (a, b, t) => a + (b - a) * t;
const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a)); return t * t * (3 - 2 * t); };
const smax = (a, b, k) => (a + b + Math.sqrt((a - b) * (a - b) + k * k)) / 2;

function canvasTex(w, h, draw, srgb = true) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

// ------------------------------------------------------------------ renderer / camera
const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(1);
renderer.setSize(W, H);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.NeutralToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = canvasTex(8, 512, (g, w, h) => {
  const gr = g.createLinearGradient(0, 0, 0, h);
  gr.addColorStop(0, '#5ad6f7'); gr.addColorStop(0.45, '#1c84c9'); gr.addColorStop(1, '#0a3c74');
  g.fillStyle = gr; g.fillRect(0, 0, w, h);
});
scene.fog = new THREE.Fog(new THREE.Color('#1b78ba'), 17, 36);

const camera = new THREE.PerspectiveCamera(30, W / H, 0.1, 200);
const CAM = { y: 3.4, z: 15, lookY: 3.0 };
function setCamera(dy) {
  camera.position.set(0, CAM.y + dy, CAM.z);
  camera.lookAt(0, CAM.lookY + dy, 0);
  camera.updateMatrixWorld();
}
setCamera(0);

function project(v) {
  const p = v.clone().project(camera);
  return [(p.x + 1) / 2 * W, (1 - p.y) / 2 * H];
}
function pxPerUnitAt(v) {
  const a = project(v), b = project(v.clone().add(new THREE.Vector3(0.01, 0, 0)));
  return Math.hypot(b[0] - a[0], b[1] - a[1]) / 0.01;
}
function screenToWorld(px, py, z) {
  const v = new THREE.Vector3(px / W * 2 - 1, -(py / H * 2 - 1), 0.5).unproject(camera);
  const dir = v.sub(camera.position).normalize();
  const tt = (z - camera.position.z) / dir.z;
  return camera.position.clone().addScaledVector(dir, tt);
}
const PX0 = pxPerUnitAt(new THREE.Vector3(0, 1.8, 0));
const PROP_Z = 0.8;

// ------------------------------------------------------------------ lights
scene.add(new THREE.HemisphereLight(0xc8eeff, 0xd9b27a, 1.35));
const sun = new THREE.DirectionalLight(0xfff2da, 2.7);
sun.position.set(-4, 14, 9);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -7, right: 7, top: 8, bottom: -6, near: 1, far: 45 });
sun.shadow.bias = -0.0004;
sun.shadow.normalBias = 0.02;
sun.shadow.radius = 5;
scene.add(sun, sun.target);
const rim = new THREE.DirectionalLight(0x8fe4ff, 1.6); rim.position.set(4, 6, -8); scene.add(rim);
const fill = new THREE.DirectionalLight(0xffd9e8, 0.7); fill.position.set(6, 3, 10); scene.add(fill);

// ------------------------------------------------------------------ caustics (물결 빛 무늬)
function causticCanvas(size = 512, cells = 7) {
  const r = mulberry32(777);
  const jit = [];
  for (let i = 0; i < cells * cells; i++) jit.push([r(), r()]);
  const c = document.createElement('canvas'); c.width = c.height = size;
  const g = c.getContext('2d'); const img = g.createImageData(size, size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const u = x / size * cells, v = y / size * cells;
    const ci = Math.floor(u), cj = Math.floor(v);
    let d1 = 9, d2 = 9;
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
      const ii = ((ci + di) % cells + cells) % cells, jj = ((cj + dj) % cells + cells) % cells;
      const p = jit[jj * cells + ii];
      const dx = u - (ci + di + p[0]), dy = v - (cj + dj + p[1]);
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d < d1) { d2 = d1; d1 = d; } else if (d < d2) d2 = d;
    }
    const val = Math.pow(clamp(1 - (d2 - d1) / 0.32), 3.2);
    const k = (y * size + x) * 4;
    img.data[k] = img.data[k + 1] = img.data[k + 2] = val * 255; img.data[k + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  return c;
}
const causticTex = new THREE.CanvasTexture(causticCanvas());
causticTex.wrapS = causticTex.wrapT = THREE.RepeatWrapping;
const causticTime = { value: 0 };

function addCaustics(mat, strength = 0.5, scale = 0.16) {
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = causticTime;
    shader.uniforms.uCaustic = { value: causticTex };
    shader.uniforms.uCStrength = { value: strength };
    shader.uniforms.uCScale = { value: scale };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vCWP;\nvarying vec3 vCWN;')
      .replace('#include <fog_vertex>', '#include <fog_vertex>\nvCWP = (modelMatrix * vec4(transformed, 1.0)).xyz;\nvCWN = normalize(mat3(modelMatrix) * objectNormal);');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uTime;\nuniform sampler2D uCaustic;\nuniform float uCStrength;\nuniform float uCScale;\nvarying vec3 vCWP;\nvarying vec3 vCWN;')
      .replace('#include <opaque_fragment>', `
        {
          vec2 cuv = vCWP.xz * uCScale + vec2(vCWP.y * 0.05);
          float c1 = texture2D(uCaustic, cuv + vec2(uTime * 0.035, uTime * 0.021)).r;
          float c2 = texture2D(uCaustic, cuv * 1.31 + vec2(-uTime * 0.027, uTime * 0.033)).r;
          float cst = min(c1, c2) * 1.6;
          float upw = clamp(vCWN.y * 0.75 + 0.35, 0.0, 1.0);
          outgoingLight += diffuseColor.rgb * cst * uCStrength * upw;
        }
        #include <opaque_fragment>`);
  };
  mat.customProgramCacheKey = () => 'caustic-' + strength + '-' + scale;
  return mat;
}

// ------------------------------------------------------------------ 바닥
const sandTex = canvasTex(512, 512, (g, w, h) => {
  g.fillStyle = '#efd39f'; g.fillRect(0, 0, w, h);
  const r = mulberry32(42);
  for (let i = 0; i < 9000; i++) {
    const x = r() * w, y = r() * h, s = 0.6 + r() * 1.8;
    const light = r() > 0.5;
    g.fillStyle = light ? `rgba(255,248,225,${0.25 + r() * 0.3})` : `rgba(150,105,55,${0.12 + r() * 0.2})`;
    for (const [ox, oy] of [[0, 0], [w, 0], [-w, 0], [0, h], [0, -h]]) {
      g.beginPath(); g.arc(x + ox, y + oy, s, 0, TAU); g.fill();
    }
  }
});
sandTex.wrapS = sandTex.wrapT = THREE.RepeatWrapping;
sandTex.repeat.set(36, 36);
{
  const geo = new THREE.PlaneGeometry(160, 160, 240, 240);
  geo.rotateX(-Math.PI / 2);
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), z = p.getZ(i);
    const d = Math.hypot(x, (z + 1) * 1.3);
    const dune = 0.38 * Math.sin(x * 0.28 + 1.0) * Math.cos(z * 0.25) + 0.16 * Math.sin(x * 0.75 + z * 0.55);
    p.setY(i, dune * smooth(3.5, 11, d) + 0.03 * Math.sin(x * 3.1) * Math.sin(z * 2.7));
  }
  geo.computeVertexNormals();
  const mat = addCaustics(new THREE.MeshStandardMaterial({ map: sandTex, roughness: 0.95 }), 0.6, 0.17);
  const floor = new THREE.Mesh(geo, mat);
  floor.receiveShadow = true;
  scene.add(floor);
}

// ------------------------------------------------------------------ 문어
const mantleProfile = (() => {
  const pts = [[0.001, 0], [0.55, 0.02], [0.9, 0.18], [1.08, 0.5], [1.12, 0.85], [1.06, 1.2],
    [0.9, 1.55], [0.62, 1.85], [0.32, 2.02], [0.001, 2.08]].map(([r, y]) => new THREE.Vector2(r * 0.9, y * 0.9));
  return new THREE.SplineCurve(pts).getPoints(80);
})();
function rAt(y) {
  for (let i = 0; i < mantleProfile.length - 1; i++) {
    const a = mantleProfile[i], b = mantleProfile[i + 1];
    if (y >= a.y && y <= b.y) return lerp(a.x, b.x, (y - a.y) / Math.max(1e-6, b.y - a.y));
  }
  return 0;
}
function surface(x, y) {
  const r = rAt(y);
  const z = Math.sqrt(Math.max(r * r - x * x, 0.0001));
  const e = 0.01;
  const drdy = (rAt(y + e) - rAt(y - e)) / (2 * e);
  const radial = new THREE.Vector3(x, 0, z).normalize();
  const n = radial.multiplyScalar(1).add(new THREE.Vector3(0, -drdy, 0)).normalize();
  return { p: new THREE.Vector3(x, y, z), n };
}

const mantleTex = canvasTex(1024, 512, (g, w, h) => {
  const gr = g.createLinearGradient(0, 0, 0, h);
  gr.addColorStop(0, '#ffa2c1'); gr.addColorStop(0.5, '#ff7aa5'); gr.addColorStop(1, '#ee5a8b');
  g.fillStyle = gr; g.fillRect(0, 0, w, h);
  const spots = [[0.09, 0.22, 26], [0.13, 0.33, 16], [0.06, 0.12, 12], [0.9, 0.2, 18], [0.95, 0.3, 11],
    [0.25, 0.35, 30], [0.35, 0.22, 20], [0.5, 0.3, 34], [0.62, 0.18, 22], [0.75, 0.33, 28], [0.82, 0.45, 15],
    [0.3, 0.55, 18], [0.68, 0.55, 20], [0.45, 0.6, 14], [0.18, 0.08, 14], [0.78, 0.1, 16]];
  g.fillStyle = 'rgba(210,58,108,0.42)';
  for (const [u, v, r] of spots) {
    for (const ox of [-w, 0, w]) { g.beginPath(); g.ellipse(u * w + ox, v * h, r * 1.3, r, 0, 0, TAU); g.fill(); }
  }
});

const PINK_ARM = new THREE.Color('#f9659a'), PINK_UNDER = new THREE.Color('#ffc6d8');
const bodyMat = addCaustics(new THREE.MeshPhysicalMaterial({
  map: mantleTex, roughness: 0.36, clearcoat: 0.65, clearcoatRoughness: 0.22,
  sheen: 0.8, sheenColor: new THREE.Color('#ffc4d8'), sheenRoughness: 0.45 }), 0.28);
const armMat = addCaustics(new THREE.MeshPhysicalMaterial({
  vertexColors: true, roughness: 0.38, clearcoat: 0.55, clearcoatRoughness: 0.25,
  sheen: 0.6, sheenColor: new THREE.Color('#ffc4d8'), sheenRoughness: 0.5 }), 0.28);
const skinMat = addCaustics(new THREE.MeshPhysicalMaterial({
  color: '#f9679b', roughness: 0.38, clearcoat: 0.55, clearcoatRoughness: 0.25, sheen: 0.6,
  sheenColor: new THREE.Color('#ffc4d8') }), 0.28);
const lidMat = new THREE.MeshPhysicalMaterial({ color: '#ff86ad', roughness: 0.4, clearcoat: 0.5 });
const suckerMat = new THREE.MeshPhysicalMaterial({ color: '#ffd9e5', roughness: 0.3, clearcoat: 0.6 });
const eyeWhiteMat = new THREE.MeshPhysicalMaterial({ color: '#ffffff', roughness: 0.1, clearcoat: 1 });
const pupilMat = new THREE.MeshPhysicalMaterial({ color: '#17122f', roughness: 0.12, clearcoat: 1 });
const shineMat = new THREE.MeshBasicMaterial({ color: '#ffffff' });
const darkMat = new THREE.MeshPhysicalMaterial({ color: '#241a40', roughness: 0.3, clearcoat: 0.6 });
const mouthMat = new THREE.MeshStandardMaterial({ color: '#5c1030', roughness: 0.5 });
const tongueMat = new THREE.MeshStandardMaterial({ color: '#ff8fab', roughness: 0.5 });
const cheekMat = new THREE.MeshBasicMaterial({ color: '#ff3c7c', transparent: true, opacity: 0.38, depthWrite: false });

const octo = new THREE.Group();
scene.add(octo);
const headPivot = new THREE.Group();
headPivot.position.y = 1.8;
octo.add(headPivot);
const mantle = new THREE.Mesh(new THREE.LatheGeometry(mantleProfile, 112), bodyMat);
mantle.position.y = -0.85;
mantle.castShadow = true;
headPivot.add(mantle);
const skirt = new THREE.Mesh(new THREE.SphereGeometry(0.64, 48, 24), skinMat);
skirt.scale.set(1, 0.5, 1);
skirt.position.y = 0.98;
skirt.castShadow = true;
octo.add(skirt);

function placeOnSurface(obj, x, y, lift = 0.0, forward = 0.0) {
  const { p, n } = surface(x, y);
  const dir = n.clone().add(new THREE.Vector3(0, 0, forward)).normalize();
  obj.position.copy(p).addScaledVector(n, lift);
  obj.quaternion.setFromUnitVectors(ZAXIS, dir);
  return { p, n };
}

// 눈
function makeEye(side) {
  const g = new THREE.Group();
  const ball = new THREE.Group(); g.add(ball);
  ball.add(new THREE.Mesh(new THREE.SphereGeometry(0.25, 40, 28), eyeWhiteMat));
  const look = new THREE.Group(); ball.add(look);
  const pupil = new THREE.Mesh(new THREE.SphereGeometry(0.16, 32, 20), pupilMat);
  pupil.scale.set(1, 1, 0.5); pupil.position.z = 0.185; look.add(pupil);
  const s1 = new THREE.Mesh(new THREE.SphereGeometry(0.052, 16, 12), shineMat); s1.position.set(-0.06, 0.065, 0.255); look.add(s1);
  const s2 = new THREE.Mesh(new THREE.SphereGeometry(0.026, 12, 8), shineMat); s2.position.set(0.055, -0.05, 0.252); look.add(s2);
  const lid = new THREE.Mesh(new THREE.SphereGeometry(0.262, 40, 20, 0, TAU, 0, Math.PI / 2), lidMat);
  lid.rotation.x = 0.55; lid.visible = false; ball.add(lid);
  const happy = new THREE.Mesh(new THREE.TorusGeometry(0.16, 0.05, 14, 40, Math.PI), darkMat);
  happy.position.set(0, -0.04, 0.12); happy.visible = false; g.add(happy);
  placeOnSurface(g, side * 0.37, 0.88, -0.11, 0.9);
  mantle.add(g);
  return { g, ball, look, pupil, lid, happy };
}
const eyes = [makeEye(-1), makeEye(1)];

// 볼터치
for (const side of [-1, 1]) {
  const c = new THREE.Mesh(new THREE.CircleGeometry(0.13, 32), cheekMat);
  placeOnSurface(c, side * 0.62, 0.6, 0.025, 0.3);
  c.scale.set(1.45, 0.85, 1);
  mantle.add(c);
}

// 입
const mouth = new THREE.Group();
placeOnSurface(mouth, 0, 0.5, 0.02, 0.0);
mantle.add(mouth);
const mouthSmile = new THREE.Mesh(new THREE.TorusGeometry(0.15, 0.032, 12, 40, 2.2), darkMat);
mouthSmile.rotation.z = -(Math.PI / 2 + 1.1);
mouthSmile.position.y = 0.1;
mouth.add(mouthSmile);
const mouthHappy = new THREE.Group();
{
  const m = new THREE.Mesh(new THREE.CircleGeometry(0.17, 40, Math.PI, Math.PI), mouthMat);
  m.position.y = 0.06; mouthHappy.add(m);
  const tg = new THREE.Mesh(new THREE.CircleGeometry(0.085, 24), tongueMat);
  tg.position.set(0, -0.04, 0.004); tg.scale.set(1.25, 0.7, 1); mouthHappy.add(tg);
}
mouth.add(mouthHappy);
const mouthO = new THREE.Mesh(new THREE.CircleGeometry(0.075, 32), mouthMat);
mouthO.scale.set(1, 1.3, 1);
mouth.add(mouthO);
const mouthWavy = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(
  [-0.13, -0.065, 0, 0.065, 0.13].map((x, i) => new THREE.Vector3(x, i % 2 ? 0.025 : -0.015, 0))), 40, 0.022, 8), darkMat);
mouth.add(mouthWavy);

// 안경
const glasses = new THREE.Group();
{
  const frameMat = new THREE.MeshPhysicalMaterial({ color: '#2b2340', roughness: 0.25, clearcoat: 1 });
  const lensMat = new THREE.MeshPhysicalMaterial({ color: '#ffffff', transparent: true, opacity: 0.16, roughness: 0.05 });
  for (const side of [-1, 1]) {
    const { p } = surface(side * 0.37, 0.88);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.3, 0.045, 14, 48), frameMat);
    ring.position.set(side * 0.39, 0.88, p.z + 0.16);
    ring.rotation.y = side * 0.25;
    const lens = new THREE.Mesh(new THREE.CircleGeometry(0.29, 40), lensMat);
    lens.position.copy(ring.position); lens.rotation.copy(ring.rotation);
    glasses.add(ring, lens);
  }
  const { p } = surface(0, 0.92);
  const bridge = new THREE.Mesh(new THREE.TorusGeometry(0.09, 0.035, 10, 24, Math.PI), frameMat);
  bridge.position.set(0, 0.9, p.z + 0.12);
  glasses.add(bridge);
}
const glassesPivot = new THREE.Group();
glassesPivot.position.set(0, 0.88, 0.9);
glasses.position.set(0, -0.88, -0.9);
glassesPivot.add(glasses);
mantle.add(glassesPivot);

// 땀방울
function dropGeometry(segs = 48) {
  const pts = [];
  for (let k = 0; k <= 20; k++) { const a = -Math.PI / 2 + (Math.PI / 2 + Math.PI / 6) * k / 20; pts.push(new THREE.Vector2(Math.cos(a), Math.sin(a))); }
  for (let k = 1; k <= 12; k++) { const f = k / 12; pts.push(new THREE.Vector2(lerp(Math.cos(Math.PI / 6), 0.0, f) + 0.02 * Math.sin(Math.PI * f), lerp(0.5, 2.0, f))); }
  pts[pts.length - 1].x = 0.001;
  return new THREE.LatheGeometry(pts, segs);
}
const DROP_GEO = dropGeometry();
const sweat = new THREE.Mesh(DROP_GEO, new THREE.MeshPhysicalMaterial({ color: '#a6e6ff', roughness: 0.05, clearcoat: 1, emissive: '#2a7bb0', emissiveIntensity: 0.25 }));
sweat.scale.setScalar(0.075);
mantle.add(sweat);

// 다리 (매 프레임 갱신되는 테이퍼 튜브)
const ARM_N = 46, ARM_M = 14, WAVE_ARM = 1;
const SUCKER_K = [];
for (let k = 11; k <= ARM_N - 4; k += 4) SUCKER_K.push(k);
const suckers = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 16, 10), suckerMat, 8 * SUCKER_K.length);
suckers.castShadow = false;
octo.add(suckers);
const arms = [];
for (let i = 0; i < 8; i++) {
  const geo = new THREE.BufferGeometry();
  const nv = (ARM_N + 1) * (ARM_M + 1);
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(nv * 3), 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(nv * 3), 3));
  geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(nv * 3), 3));
  const idx = [];
  for (let k = 0; k < ARM_N; k++) for (let a = 0; a < ARM_M; a++) {
    const v0 = k * (ARM_M + 1) + a, v1 = v0 + 1, v2 = v0 + ARM_M + 1, v3 = v2 + 1;
    idx.push(v0, v1, v2, v1, v3, v2);
  }
  geo.setIndex(idx);
  const mesh = new THREE.Mesh(geo, armMat);
  mesh.castShadow = true; mesh.receiveShadow = true; mesh.frustumCulled = false;
  octo.add(mesh);
  arms.push({ mesh, geo, pts: [], theta: [], er: new THREE.Vector3(), et: new THREE.Vector3() });
}
const armRadius = (s) => 0.205 * (1 - 0.84 * s) + 0.012;

const _v = new THREE.Vector3(), _T = new THREE.Vector3(), _B = new THREE.Vector3(), _N = new THREE.Vector3(), _C = new THREE.Vector3();
const _q = new THREE.Quaternion(), _m = new THREE.Matrix4(), _s = new THREE.Vector3();
let suckerCount = 0;

function updateArm(i, st, t, floorLocal) {
  const A = arms[i];
  let phi = (i + 0.5) * Math.PI / 4;
  let theta0 = THREE.MathUtils.degToRad(36 + 10 * rnd(i, 3)) * st.spread;
  let curl = (1.35 + 0.35 * rnd(i, 5)) * st.curl;
  const L = 2.05 * st.armlen * (0.92 + 0.16 * rnd(i, 7));
  const freq = st.freq * lerp(1, 0.6 + 0.9 * rnd(i, 31), st.indep);
  const phase = i * 1.3 + st.walk * i * 2.2;
  let amp = st.amp * (1 + 0.6 * st.walk * Math.sin(t * 3.6 + i * 1.7));
  if (i === WAVE_ARM && st.wave > 0) {
    const w = st.wave;
    phi = lerp(phi, THREE.MathUtils.degToRad(84), w);
    theta0 = lerp(theta0, THREE.MathUtils.degToRad(150 + 18 * Math.sin(TAU * 1.8 * t)), w);
    curl = lerp(curl, 0.45 + 0.3 * Math.sin(TAU * 1.8 * t - 1.0), w);
    amp = lerp(amp, 0.1, w);
  }
  const er = A.er.set(Math.sin(phi), 0, Math.cos(phi));
  const et = A.et.set(Math.cos(phi), 0, -Math.sin(phi));
  let rho = 0.42, h = 0.98, tau = 0;
  const ds = L / ARM_N;
  for (let k = 0; k <= ARM_N; k++) {
    const s = k / ARM_N;
    const theta = theta0 + curl * s * s + amp * Math.sin(TAU * freq * t - s * 4.0 + phase) * s * 2.2;
    tau = amp * 0.7 * Math.sin(TAU * freq * 0.8 * t - s * 3.0 + phase * 1.7) * s;
    const r = armRadius(s);
    const hh = (i === WAVE_ARM && st.wave > 0.5) ? h : smax(h, floorLocal + r * 0.9, 0.12);
    if (!A.pts[k]) A.pts[k] = new THREE.Vector3();
    A.pts[k].copy(er).multiplyScalar(rho).addScaledVector(et, tau).add(_v.set(0, hh, 0));
    A.theta[k] = theta;
    rho += Math.sin(theta) * ds;
    h -= Math.cos(theta) * ds;
  }
  const pos = A.geo.attributes.position.array, nor = A.geo.attributes.normal.array, colr = A.geo.attributes.color.array;
  for (let k = 0; k <= ARM_N; k++) {
    const s = k / ARM_N;
    const P = A.pts[k];
    _T.copy(A.pts[Math.min(k + 1, ARM_N)]).sub(A.pts[Math.max(k - 1, 0)]).normalize();
    _B.copy(et).addScaledVector(_T, -_T.dot(et)).normalize();
    _N.crossVectors(_B, _T);
    _C.copy(er).multiplyScalar(Math.cos(A.theta[k])).addScaledVector(UP, Math.sin(A.theta[k]));
    _C.addScaledVector(_T, -_C.dot(_T)).normalize();
    const r = k === ARM_N ? 0.002 : armRadius(s);
    for (let a = 0; a <= ARM_M; a++) {
      const ang = a / ARM_M * TAU;
      const nx = _N.x * Math.cos(ang) + _B.x * Math.sin(ang);
      const ny = _N.y * Math.cos(ang) + _B.y * Math.sin(ang);
      const nz = _N.z * Math.cos(ang) + _B.z * Math.sin(ang);
      const j = (k * (ARM_M + 1) + a) * 3;
      pos[j] = P.x + nx * r; pos[j + 1] = P.y + ny * r; pos[j + 2] = P.z + nz * r;
      nor[j] = nx; nor[j + 1] = ny; nor[j + 2] = nz;
      const u = smooth(0.15, 0.75, nx * _C.x + ny * _C.y + nz * _C.z);
      colr[j] = lerp(PINK_ARM.r, PINK_UNDER.r, u); colr[j + 1] = lerp(PINK_ARM.g, PINK_UNDER.g, u); colr[j + 2] = lerp(PINK_ARM.b, PINK_UNDER.b, u);
    }
    if (SUCKER_K.includes(k)) {
      _v.copy(P).addScaledVector(_C, r * 0.8);
      _q.setFromUnitVectors(ZAXIS, _C);
      _s.set(r * 0.46, r * 0.46, r * 0.2);
      _m.compose(_v, _q, _s);
      suckers.setMatrixAt(suckerCount++, _m);
    }
  }
  A.geo.attributes.position.needsUpdate = true;
  A.geo.attributes.normal.needsUpdate = true;
  A.geo.attributes.color.needsUpdate = true;
}

// 뉴런 빛
const glowTex = canvasTex(128, 128, (g, w, h) => {
  const gr = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
  gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.25, 'rgba(255,240,180,0.85)');
  gr.addColorStop(0.6, 'rgba(255,200,80,0.25)'); gr.addColorStop(1, 'rgba(255,180,60,0)');
  g.fillStyle = gr; g.fillRect(0, 0, w, h);
});
const neurons = [];
for (let i = 0; i < 24; i++) {
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: '#ffd54a', blending: THREE.AdditiveBlending, transparent: true, depthWrite: false }));
  sp.scale.setScalar(0.5);
  const core = new THREE.Mesh(new THREE.SphereGeometry(0.045, 12, 8), new THREE.MeshBasicMaterial({ color: '#fff7c2' }));
  octo.add(sp, core);
  neurons.push({ sp, core });
}

// 바닥 접촉 그림자
const blobTex = canvasTex(128, 128, (g, w, h) => {
  const gr = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
  gr.addColorStop(0, 'rgba(40,20,0,0.55)'); gr.addColorStop(1, 'rgba(40,20,0,0)');
  g.fillStyle = gr; g.fillRect(0, 0, w, h);
});
const blob = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: blobTex, transparent: true, depthWrite: false }));
blob.rotation.x = -Math.PI / 2;
scene.add(blob);

function updateOctopus(S, t, camDy) {
  const st = S.octo;
  const sc = st.s / 1.2;
  const wx = (st.x - 540) / PX0;
  const wy = camDy - (st.y - 1300) / PX0;
  octo.position.set(wx, wy, 0);
  octo.scale.setScalar(sc);
  octo.rotation.set(0, 0, -st.rot);
  const k = st.stretch;
  headPivot.scale.set(1 / Math.sqrt(k), k, 1 / Math.sqrt(k));

  const floorLocal = -wy / sc;
  suckerCount = 0;
  for (let i = 0; i < 8; i++) updateArm(i, st, t, floorLocal);
  suckers.count = suckerCount;
  suckers.instanceMatrix.needsUpdate = true;

  // 표정
  const expr = st.expr;
  for (const e of eyes) {
    const happy = expr === 'happy';
    e.ball.visible = !happy;
    e.happy.visible = happy;
    const big = expr === 'surprised' ? 1.13 : 1.0;
    e.ball.scale.set(big, big * (happy ? 1 : st.open), big);
    e.pupil.scale.set(expr === 'surprised' ? 0.72 : 1, expr === 'surprised' ? 0.72 : 1, 0.5);
    e.look.rotation.set(st.look[1] * 0.42, st.look[0] * 0.5, 0);
    e.lid.visible = expr === 'tired';
  }
  mouthSmile.visible = expr === 'normal';
  mouthHappy.visible = expr === 'happy';
  mouthO.visible = expr === 'surprised';
  mouthWavy.visible = expr === 'tired';
  const g = st.glasses;
  glassesPivot.visible = g > 0.01;
  glassesPivot.scale.setScalar(Math.max(g, 0.001));
  sweat.visible = st.sweat > 0;
  if (sweat.visible) {
    const ph = (t * 1.3) % 1;
    sweat.position.set(0.82, 1.45 - 0.3 * ph, 0.45);
    sweat.scale.setScalar(0.075 * (1 - 0.6 * ph));
  }
  // 뉴런
  const na = st.neuron;
  for (let n = 0; n < neurons.length; n++) {
    const i = n % 8, kk = Math.floor(n / 8);
    const { sp, core } = neurons[n];
    sp.visible = core.visible = na > 0.01;
    if (!sp.visible) continue;
    const s = (t * 0.55 + kk / 3 + rnd(i, 41)) % 1.0;
    const A = arms[i];
    const fi = s * ARM_N, j = Math.floor(fi), f = fi - j;
    _v.copy(A.pts[j]).lerp(A.pts[Math.min(j + 1, ARM_N)], f);
    const camLocal = octo.worldToLocal(camera.position.clone()).sub(_v).normalize();
    const r = armRadius(s);
    sp.position.copy(_v).addScaledVector(camLocal, r * 1.05);
    core.position.copy(_v).addScaledVector(camLocal, r * 0.85);
    const flick = 0.75 + 0.25 * Math.sin(t * 12 + i * 3 + kk);
    sp.material.opacity = na * flick;
    sp.scale.setScalar(0.55 * (0.8 + 0.2 * flick));
    core.scale.setScalar(na);
  }
  // 그림자
  const lift = clamp(wy / 1.5);
  blob.position.set(wx, 0.02, 0.05);
  blob.scale.setScalar(4.2 * sc * (1 - 0.35 * lift));
  blob.material.opacity = 1 - 0.8 * lift;
}

// ------------------------------------------------------------------ 소품
const PROP = {};
const glossy = (c, extra = {}) => new THREE.MeshPhysicalMaterial(Object.assign({ color: c, roughness: 0.2, clearcoat: 1, clearcoatRoughness: 0.08 }, extra));

function heartGeometry() {
  const s = new THREE.Shape();
  for (let k = 0; k <= 120; k++) {
    const th = TAU * k / 120;
    const x = 16 * Math.pow(Math.sin(th), 3) / 32;
    const y = (13 * Math.cos(th) - 5 * Math.cos(2 * th) - 2 * Math.cos(3 * th) - Math.cos(4 * th) + 2.5) / 32;
    if (k === 0) s.moveTo(x, y); else s.lineTo(x, y);
  }
  const g = new THREE.ExtrudeGeometry(s, { depth: 0.26, bevelEnabled: true, bevelThickness: 0.11, bevelSize: 0.07, bevelSegments: 8, steps: 1 });
  g.translate(0, 0, -0.13);
  g.computeVertexNormals();
  return g;
}

function buildProps(font) {
  const textGeo = (str, size, depth) => {
    const g = new TextGeometry(str, { font, size, depth, curveSegments: 10, bevelEnabled: true, bevelThickness: depth * 0.25, bevelSize: size * 0.025, bevelSegments: 3 });
    g.center();
    return g;
  };
  const white = glossy('#ffffff', { roughness: 0.3 });

  // 물음표
  PROP.q = new THREE.Mesh(textGeo('?', 1.0, 0.32), glossy('#ffd23f', { emissive: '#7a5200', emissiveIntensity: 0.15 }));
  PROP.q.castShadow = true;
  scene.add(PROP.q);

  // 하트
  const hg = heartGeometry();
  const heartMat = glossy('#ff2f52', { sheen: 0.4, sheenColor: new THREE.Color('#ff9ab0'), emissive: '#5a0010', emissiveIntensity: 0.2 });
  PROP.hearts = [0, 1, 2].map((i) => {
    const grp = new THREE.Group();
    const m = new THREE.Mesh(hg, heartMat); m.castShadow = true;
    const num = new THREE.Mesh(textGeo(String(i + 1), 0.42, 0.05), white);
    num.position.set(0, 0.0, 0.25);
    grp.add(m, num);
    scene.add(grp);
    return { grp, num };
  });

  // 핏방울
  PROP.drops = {};
  for (const [el, c] of [['Fe', '#ff2e45'], ['Cu', '#2d7cff']]) {
    const grp = new THREE.Group();
    const m = new THREE.Mesh(DROP_GEO, glossy(c, { emissive: c, emissiveIntensity: 0.12, roughness: 0.12 }));
    m.castShadow = true;
    const label = new THREE.Mesh(textGeo(el, 0.55, 0.08), white);
    label.position.set(0, 0.05, 0.98);
    grp.add(m, label);
    scene.add(grp);
    PROP.drops[el] = grp;
  }

  // 원그래프
  PROP.pie = new THREE.Group();
  PROP.pieYellowMat = glossy('#ffd23f', { roughness: 0.3 });
  PROP.piePink = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 0.32, 64, 1, false, Math.PI, TAU / 3), glossy('#ff8fb1', { roughness: 0.3 }));
  PROP.piePink.position.set(-0.05 * Math.sin(Math.PI + TAU / 6), 0, -0.05 * Math.cos(Math.PI + TAU / 6));
  PROP.pie.add(PROP.piePink);
  PROP.pieYellow = null;
  PROP.pieFill = -1;
  scene.add(PROP.pie);
}

function updateProps(P, t) {
  // 물음표
  const q = P.q;
  PROP.q.visible = q.s > 0.01;
  if (PROP.q.visible) {
    const p = screenToWorld(540, q.y, PROP_Z);
    const ppu = pxPerUnitAt(p);
    PROP.q.position.copy(p);
    PROP.q.scale.setScalar(Math.max(q.s, 0.001) * 175 / (0.72 * ppu));
    PROP.q.rotation.set(0.05, Math.sin(t * 2.2) * 0.65, q.rot);
  }
  // 하트
  for (const h of PROP.hearts) h.grp.visible = false;
  for (const h of P.hearts) {
    const H3 = PROP.hearts[h.i];
    H3.grp.visible = h.size > 1;
    const p = screenToWorld(h.x, h.y, PROP_Z);
    const ppu = pxPerUnitAt(p);
    H3.grp.position.copy(p);
    H3.grp.scale.setScalar(Math.max(h.size, 0.001) / ppu);
    H3.grp.rotation.set(0.08, 0.38 * Math.sin(t * 1.5 + h.i * 1.3), 0);
    H3.num.visible = h.num > 0.02;
    H3.num.scale.setScalar(Math.max(h.num, 0.001));
  }
  // 핏방울
  for (const el in PROP.drops) PROP.drops[el].visible = false;
  if (P.blood) {
    for (const d of P.blood.drops) {
      const grp = PROP.drops[d.el];
      grp.visible = d.r > 0.5;
      const p = screenToWorld(d.x, d.y, PROP_Z);
      const ppu = pxPerUnitAt(p);
      grp.position.copy(p);
      grp.scale.setScalar(Math.max(d.r, 0.001) / ppu);
      grp.rotation.set(0.05, 0.4 * Math.sin(t * 1.3 + d.x), 0.06 * Math.sin(t * 2 + d.x));
    }
  }
  // 원그래프
  const pie = P.pie;
  PROP.pie.visible = !!pie && pie.r > 0.5;
  const anchors = {};
  if (PROP.pie.visible) {
    const p = screenToWorld(pie.cx, pie.cy, PROP_Z);
    const ppu = pxPerUnitAt(p);
    PROP.pie.position.copy(p);
    PROP.pie.scale.setScalar(pie.r / ppu);
    PROP.pie.rotation.set(0.62, 0.15 * Math.sin(t * 1.2), 0);
    const fill = Math.round(pie.fill * 200) / 200;
    if (fill !== PROP.pieFill) {
      if (PROP.pieYellow) { PROP.pie.remove(PROP.pieYellow); PROP.pieYellow.geometry.dispose(); PROP.pieYellow = null; }
      if (fill > 0.005) {
        const len = TAU * (2 / 3) * fill;
        PROP.pieYellow = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 0.32, 64, 1, false, Math.PI - len, len), PROP.pieYellowMat);
        PROP.pie.add(PROP.pieYellow);
      }
      PROP.pieFill = fill;
    }
    PROP.pie.updateMatrixWorld(true);
    const at = (ang, rr) => project(PROP.pie.localToWorld(new THREE.Vector3(rr * Math.sin(ang), 0.17, rr * Math.cos(ang))));
    anchors.pie_leg = at(Math.PI - TAU / 3, 0.55);
    anchors.pie_head = at(Math.PI + TAU / 6, 0.58);
  }
  return anchors;
}

// ------------------------------------------------------------------ 배경 소품
const env = { seaweed: [], fish: [], bubbles: [], rays: [] };
const weedMat = addCaustics(new THREE.MeshStandardMaterial({ color: '#2fb565', roughness: 0.6 }), 0.3);
const weedMat2 = addCaustics(new THREE.MeshStandardMaterial({ color: '#23955a', roughness: 0.6 }), 0.3);
function makeStrand(x, z, hgt, r0, ph, mat) {
  const N = 22, M = 8;
  const geo = new THREE.BufferGeometry();
  const nv = (N + 1) * (M + 1);
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(nv * 3), 3));
  const idx = [];
  for (let k = 0; k < N; k++) for (let a = 0; a < M; a++) {
    const v0 = k * (M + 1) + a, v1 = v0 + 1, v2 = v0 + M + 1, v3 = v2 + 1;
    idx.push(v0, v2, v1, v1, v2, v3);
  }
  geo.setIndex(idx);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.castShadow = true; mesh.frustumCulled = false;
  scene.add(mesh);
  env.seaweed.push({ mesh, geo, x, z, hgt, r0, ph, N, M });
}
function updateStrands(t) {
  for (const w of env.seaweed) {
    const p = w.geo.attributes.position.array;
    for (let k = 0; k <= w.N; k++) {
      const s = k / w.N;
      const cx = w.x + 0.45 * Math.sin(t * 1.1 + s * 3.0 + w.ph) * s * s;
      const cz = w.z + 0.2 * Math.sin(t * 0.8 + s * 2.0 + w.ph * 2) * s;
      const cy = s * w.hgt;
      const r = w.r0 * (1 - 0.85 * s) * (1 + 0.25 * Math.sin(s * 10 + w.ph));
      for (let a = 0; a <= w.M; a++) {
        const ang = a / w.M * TAU;
        const j = (k * (w.M + 1) + a) * 3;
        p[j] = cx + Math.cos(ang) * r * 1.6; p[j + 1] = cy; p[j + 2] = cz + Math.sin(ang) * r * 0.6;
      }
    }
    w.geo.attributes.position.needsUpdate = true;
    w.geo.computeVertexNormals();
  }
}
[[-4.4, -2.0, 3.6, 0.14, 0.0], [-3.7, -3.6, 2.6, 0.12, 1.3], [-5.4, -6.0, 4.6, 0.16, 2.1],
 [4.2, -2.6, 3.9, 0.14, 0.7], [4.9, -4.2, 2.8, 0.12, 2.8], [5.8, -7.5, 5.0, 0.17, 3.6],
 [-2.6, -8.0, 3.4, 0.14, 4.4], [2.9, -9.0, 3.6, 0.14, 5.1], [-6.6, -10.5, 5.2, 0.18, 0.4],
 [7.0, -11.5, 5.5, 0.18, 1.9], [0.9, -12.5, 4.0, 0.15, 2.6], [-1.6, -13.5, 4.4, 0.16, 3.3],
 [-3.2, 1.2, 1.6, 0.1, 1.1], [3.5, 0.6, 2.0, 0.11, 2.4]].forEach(([x, z, hgt, r, ph], i) => makeStrand(x, z, hgt, r, ph, i % 2 ? weedMat2 : weedMat));

// 바위
const rockMat = addCaustics(new THREE.MeshStandardMaterial({ color: '#7f8a9a', roughness: 0.95 }), 0.45);
function makeRock(x, z, s, sx, sy, sz, seed) {
  const g = new THREE.IcosahedronGeometry(1, 4);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    _v.fromBufferAttribute(p, i);
    const n = 1 + 0.16 * Math.sin(_v.x * 3.1 + seed) * Math.sin(_v.y * 2.7 + seed * 2) + 0.08 * Math.sin(_v.z * 5.3 + seed * 3);
    _v.multiplyScalar(n);
    p.setXYZ(i, _v.x, _v.y, _v.z);
  }
  g.computeVertexNormals();
  const m = new THREE.Mesh(g, rockMat);
  m.scale.set(s * sx, s * sy, s * sz);
  m.position.set(x, s * sy * 0.35, z);
  m.rotation.y = seed;
  m.castShadow = m.receiveShadow = true;
  scene.add(m);
}
makeRock(-3.6, -0.8, 0.55, 1.3, 0.8, 1.0, 1.0);
makeRock(4.0, -1.6, 0.7, 1.2, 0.9, 1.1, 2.0);
makeRock(-5.6, -5.5, 1.3, 1.4, 0.9, 1.1, 3.0);
makeRock(6.0, -6.5, 1.1, 1.3, 1.0, 1.0, 4.0);
makeRock(0.5, -11, 1.8, 1.6, 0.8, 1.2, 5.0);
makeRock(2.4, 1.6, 0.3, 1.2, 0.7, 1.0, 6.0);

// 산호
function makeCoral(x, z, color, seed) {
  const mat = addCaustics(new THREE.MeshStandardMaterial({ color, roughness: 0.55 }), 0.35);
  const grp = new THREE.Group();
  const r = mulberry32(seed);
  function branch(pos, dir, len, rad, depth) {
    const g = new THREE.CapsuleGeometry(rad, len, 6, 14);
    const m = new THREE.Mesh(g, mat);
    m.quaternion.setFromUnitVectors(UP, dir);
    m.position.copy(pos).addScaledVector(dir, len / 2);
    m.castShadow = true;
    grp.add(m);
    if (depth <= 0) return;
    const end = pos.clone().addScaledVector(dir, len);
    const nkids = 2 + (r() > 0.6 ? 1 : 0);
    for (let k = 0; k < nkids; k++) {
      const a = r() * TAU;
      const nd = dir.clone().add(new THREE.Vector3(Math.cos(a) * 0.7, 0.25, Math.sin(a) * 0.5)).normalize();
      branch(end, nd, len * (0.65 + 0.15 * r()), rad * 0.78, depth - 1);
    }
  }
  branch(new THREE.Vector3(0, 0, 0), UP.clone(), 0.55, 0.11, 3);
  grp.position.set(x, 0, z);
  scene.add(grp);
}
makeCoral(-2.9, 0.4, '#ff8466', 11);
makeCoral(3.3, -0.4, '#b27cff', 23);
makeCoral(-4.6, -3.0, '#ffb547', 37);

// 불가사리
{
  const s = new THREE.Shape();
  for (let k = 0; k <= 10; k++) {
    const rr = k % 2 === 0 ? 0.5 : 0.21;
    const a = Math.PI / 2 + k * Math.PI / 5;
    if (k === 0) s.moveTo(rr * Math.cos(a), rr * Math.sin(a)); else s.lineTo(rr * Math.cos(a), rr * Math.sin(a));
  }
  const g = new THREE.ExtrudeGeometry(s, { depth: 0.06, bevelEnabled: true, bevelThickness: 0.07, bevelSize: 0.06, bevelSegments: 4 });
  const m = new THREE.Mesh(g, addCaustics(new THREE.MeshStandardMaterial({ color: '#ff9d36', roughness: 0.6 }), 0.4));
  m.rotation.set(-Math.PI / 2, 0, 0.4);
  m.position.set(2.3, 0.08, 2.4);
  m.castShadow = m.receiveShadow = true;
  scene.add(m);
}

// 물고기
function makeFish(color, stripe) {
  const grp = new THREE.Group();
  const body = new THREE.Mesh(new THREE.SphereGeometry(0.3, 24, 16), new THREE.MeshStandardMaterial({ color, roughness: 0.45 }));
  body.scale.set(1.7, 1, 0.55);
  const tail = new THREE.Mesh(new THREE.ConeGeometry(0.22, 0.36, 4), new THREE.MeshStandardMaterial({ color: stripe, roughness: 0.5 }));
  tail.rotation.z = Math.PI / 2; tail.position.x = -0.6; tail.scale.set(1, 1, 0.35);
  const eyeW = new THREE.Mesh(new THREE.SphereGeometry(0.06, 12, 8), new THREE.MeshBasicMaterial({ color: '#ffffff' }));
  eyeW.position.set(0.33, 0.07, 0.13);
  const eyeB = new THREE.Mesh(new THREE.SphereGeometry(0.032, 10, 8), new THREE.MeshBasicMaterial({ color: '#111' }));
  eyeB.position.set(0.36, 0.07, 0.16);
  grp.add(body, tail, eyeW, eyeB);
  scene.add(grp);
  return { grp, tail };
}
[['#ffd23f', '#ff9f1c', 0, 0.9, 3.6, -9, 1], ['#4fc3ff', '#1d6fd6', 7, 0.7, 5.2, -12, -1],
 ['#ff8a3d', '#ffffff', 13, 1.0, 2.4, -7, 1], ['#ff6f9c', '#ffd1df', 19, 0.8, 4.4, -14, -1],
 ['#9be15d', '#3fae4f', 4, 0.75, 6.0, -10, -1]].forEach(([c, s, off, sp, y, z, dir]) => {
  const f = makeFish(c, s);
  env.fish.push({ ...f, off, sp, y, z, dir });
});
function updateFish(t) {
  for (const f of env.fish) {
    const span = 30;
    let x = ((t + f.off) * f.sp * 1.6) % span - span / 2;
    if (f.dir < 0) x = -x;
    f.grp.position.set(x, f.y + 0.25 * Math.sin(t * 1.4 + f.off), f.z);
    f.grp.rotation.set(0, f.dir > 0 ? 0 : Math.PI, 0.05 * Math.sin(t * 2 + f.off));
    f.tail.rotation.y = 0.5 * Math.sin(t * 11 + f.off);
  }
}

// 거품 / 플랑크톤 / 빛줄기
const bubbleTex = canvasTex(128, 128, (g, w, h) => {
  g.strokeStyle = 'rgba(255,255,255,0.9)'; g.lineWidth = 7;
  g.fillStyle = 'rgba(255,255,255,0.1)';
  g.beginPath(); g.arc(64, 64, 56, 0, TAU); g.fill(); g.stroke();
  g.lineWidth = 9; g.lineCap = 'round';
  g.beginPath(); g.arc(64, 64, 36, Math.PI * 1.1, Math.PI * 1.45); g.stroke();
});
for (let i = 0; i < 46; i++) {
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: bubbleTex, transparent: true, depthWrite: false, opacity: 0.75 }));
  scene.add(sp);
  env.bubbles.push({ sp, x: (rnd(i, 1) - 0.5) * 16, z: -14 + rnd(i, 2) * 16, sp_: 0.5 + rnd(i, 3) * 0.9, off: rnd(i, 4) * 14, size: 0.08 + rnd(i, 5) * 0.28 });
}
function updateBubbles(t, camDy) {
  for (let i = 0; i < env.bubbles.length; i++) {
    const b = env.bubbles[i];
    const y = ((t * b.sp_ + b.off) % 14) - 1 + camDy * 0.6;
    b.sp.position.set(b.x + 0.2 * Math.sin(t * 1.8 + i), y, b.z);
    b.sp.scale.setScalar(b.size);
  }
}
const dotTex = canvasTex(32, 32, (g) => {
  const gr = g.createRadialGradient(16, 16, 0, 16, 16, 16);
  gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 32, 32);
});
const PLANK = 500;
const plankGeo = new THREE.BufferGeometry();
plankGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(PLANK * 3), 3));
const plank = new THREE.Points(plankGeo, new THREE.PointsMaterial({ size: 0.07, map: dotTex, transparent: true, opacity: 0.55, depthWrite: false }));
scene.add(plank);
function updatePlankton(t, camDy) {
  const p = plankGeo.attributes.position.array;
  for (let i = 0; i < PLANK; i++) {
    p[i * 3] = (rnd(i, 11) - 0.5) * 20 + 0.3 * Math.sin(t * 0.4 + i);
    p[i * 3 + 1] = ((rnd(i, 12) * 12 + t * (0.05 + 0.1 * rnd(i, 13))) % 12) - 1 + camDy;
    p[i * 3 + 2] = -16 + rnd(i, 14) * 22;
  }
  plankGeo.attributes.position.needsUpdate = true;
}
const rayTex = canvasTex(64, 256, (g, w, h) => {
  const gv = g.createLinearGradient(0, 0, 0, h);
  gv.addColorStop(0, 'rgba(255,255,255,1)'); gv.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gv; g.fillRect(0, 0, w, h);
  g.globalCompositeOperation = 'destination-in';
  const gh = g.createLinearGradient(0, 0, w, 0);
  gh.addColorStop(0, 'rgba(0,0,0,0)'); gh.addColorStop(0.5, 'rgba(0,0,0,1)'); gh.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = gh; g.fillRect(0, 0, w, h);
});
for (let i = 0; i < 8; i++) {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(1.6 + rnd(i, 21) * 1.4, 28),
    new THREE.MeshBasicMaterial({ map: rayTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false, opacity: 0.11, side: THREE.DoubleSide }));
  scene.add(m);
  env.rays.push({ m, x: -9 + i * 2.6 + rnd(i, 22), z: -5 - rnd(i, 23) * 9, ph: i * 1.7 });
}
function updateRays(t, camDy) {
  for (const r of env.rays) {
    r.m.position.set(r.x + 0.5 * Math.sin(t * 0.35 + r.ph), 12 + camDy, r.z);
    r.m.rotation.set(0, 0, 0.32 + 0.04 * Math.sin(t * 0.3 + r.ph));
    r.m.material.opacity = 0.09 + 0.04 * Math.sin(t * 0.8 + r.ph * 2);
  }
}

// ------------------------------------------------------------------ 프레임 렌더
window.renderFrame = (S, opts = {}) => {
  const t = S.t;
  causticTime.value = t;
  const camDy = S.floor_shift / PX0 * 2.0;
  setCamera(camDy);
  sun.position.set(-4, 14 + camDy, 9); sun.target.position.set(0, camDy * 0.5, 0); sun.target.updateMatrixWorld();
  updateOctopus(S, t, camDy);
  const anchors = updateProps(S.props, t);
  updateStrands(t);
  updateFish(t);
  updateBubbles(t, camDy);
  updatePlankton(t, camDy);
  updateRays(t, camDy);
  renderer.render(scene, camera);
  const img = renderer.domElement.toDataURL(opts.png ? 'image/png' : 'image/jpeg', 0.95);
  return { img, anchors };
};

new FontLoader().load('/three/examples/fonts/helvetiker_bold.typeface.json', (font) => {
  buildProps(font);
  window.ready = true;
}, undefined, (e) => { window.loadError = String(e); });
