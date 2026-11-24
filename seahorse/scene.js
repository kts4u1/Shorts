// 해마 쇼츠 3D 장면 (three.js). 프레임 시각 t 와 연출 큐(cues)를 받아 한 장씩 렌더링한다.
import * as THREE from 'three';
import { FontLoader } from 'three/addons/loaders/FontLoader.js';
import { TextGeometry } from 'three/addons/geometries/TextGeometry.js';

const W = 1080, H = 1920;
const TAU = Math.PI * 2;
const UP = new THREE.Vector3(0, 1, 0);
const ZAXIS = new THREE.Vector3(0, 0, 1);

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
const prog = (t, a, b) => clamp((t - a) / (b - a));
const easeIO = (x) => x * x * (3 - 2 * x);
const easeOut = (x) => 1 - Math.pow(1 - x, 3);
const easeIn = (x) => x * x * x;
const easeBack = (x, s = 1.70158) => { x -= 1; return x * x * ((s + 1) * x + s) + 1; };
const V = (x, y, z) => new THREE.Vector3(x, y, z);

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
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = canvasTex(8, 512, (g, w, h) => {
  const gr = g.createLinearGradient(0, 0, 0, h);
  gr.addColorStop(0, '#7fe3ef'); gr.addColorStop(0.45, '#36b3cf'); gr.addColorStop(1, '#147a9c');
  g.fillStyle = gr; g.fillRect(0, 0, w, h);
});
scene.fog = new THREE.Fog(new THREE.Color('#3fb2c9'), 13, 32);

const camera = new THREE.PerspectiveCamera(30, W / H, 0.1, 200);
const CAM0 = { pos: V(0, 0.85, 10.5), look: V(0, 1.2, 0) }, CAM1 = { pos: V(-0.15, 1.0, 6.3), look: V(-0.15, 1.1, 0) };
function setCamera(z) {
  camera.position.copy(CAM0.pos).lerp(CAM1.pos, z);
  camera.lookAt(CAM0.look.clone().lerp(CAM1.look, z));
  camera.updateMatrixWorld();
}
setCamera(0);
function project(v) {
  const p = v.clone().project(camera);
  return [(p.x + 1) / 2 * W, (1 - p.y) / 2 * H];
}
function pxPerUnitAt(v) {
  const a = project(v), b = project(v.clone().add(V(0.01, 0, 0)));
  return Math.hypot(b[0] - a[0], b[1] - a[1]) / 0.01;
}
const PROP_Z = 2.0;
function screenToWorld(px, py, z = PROP_Z) {
  const v = V(px / W * 2 - 1, -(py / H * 2 - 1), 0.5).unproject(camera);
  const dir = v.sub(camera.position).normalize();
  return camera.position.clone().addScaledVector(dir, (z - camera.position.z) / dir.z);
}

// ------------------------------------------------------------------ lights
scene.add(new THREE.HemisphereLight(0xd8fbff, 0xc9b07a, 1.25));
const sun = new THREE.DirectionalLight(0xfff4d6, 2.4);
sun.position.set(-3, 10, 6);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -5, right: 5, top: 5, bottom: -4, near: 1, far: 30 });
sun.shadow.bias = -0.0005; sun.shadow.normalBias = 0.02; sun.shadow.radius = 5;
scene.add(sun, sun.target);
const fill = new THREE.DirectionalLight(0xffe7d0, 0.7); fill.position.set(5, 3, 8); scene.add(fill);
const rim = new THREE.DirectionalLight(0xbff6ff, 1.0); rim.position.set(3, 4, -6); scene.add(rim);

// ------------------------------------------------------------------ 물결 빛 무늬
function causticCanvas(size = 512, cells = 7) {
  const r = mulberry32(777), jit = [];
  for (let i = 0; i < cells * cells; i++) jit.push([r(), r()]);
  const c = document.createElement('canvas'); c.width = c.height = size;
  const g = c.getContext('2d'); const img = g.createImageData(size, size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const u = x / size * cells, v = y / size * cells, ci = Math.floor(u), cj = Math.floor(v);
    let d1 = 9, d2 = 9;
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
      const ii = ((ci + di) % cells + cells) % cells, jj = ((cj + dj) % cells + cells) % cells;
      const p = jit[jj * cells + ii], dx = u - (ci + di + p[0]), dy = v - (cj + dj + p[1]);
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d < d1) { d2 = d1; d1 = d; } else if (d < d2) d2 = d;
    }
    const val = Math.pow(clamp(1 - (d2 - d1) / 0.32), 3.2), k = (y * size + x) * 4;
    img.data[k] = img.data[k + 1] = img.data[k + 2] = val * 255; img.data[k + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  return c;
}
const causticTex = new THREE.CanvasTexture(causticCanvas());
causticTex.wrapS = causticTex.wrapT = THREE.RepeatWrapping;
const causticTime = { value: 0 };
function addCaustics(mat, strength = 0.5, scale = 0.2) {
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

// ------------------------------------------------------------------ 모래 바닥 + 해초
const FLOOR_Y = -1.25;
{
  const sandTex = canvasTex(512, 512, (g, w, h) => {
    g.fillStyle = '#f1d9a6'; g.fillRect(0, 0, w, h);
    const r = mulberry32(42);
    for (let i = 0; i < 8000; i++) {
      const x = r() * w, y = r() * h, s = 0.6 + r() * 1.8;
      g.fillStyle = r() > 0.5 ? `rgba(255,250,230,${0.25 + r() * 0.3})` : `rgba(150,110,60,${0.1 + r() * 0.2})`;
      for (const [ox, oy] of [[0, 0], [w, 0], [-w, 0], [0, h], [0, -h]]) { g.beginPath(); g.arc(x + ox, y + oy, s, 0, TAU); g.fill(); }
    }
  });
  sandTex.wrapS = sandTex.wrapT = THREE.RepeatWrapping; sandTex.repeat.set(30, 30);
  const geo = new THREE.PlaneGeometry(120, 120, 200, 200); geo.rotateX(-Math.PI / 2);
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), z = p.getZ(i);
    p.setY(i, FLOOR_Y + 0.25 * Math.sin(x * 0.4 + 1) * Math.cos(z * 0.3) * smooth(3, 9, Math.hypot(x, z)) + 0.03 * Math.sin(x * 3) * Math.sin(z * 2.6));
  }
  geo.computeVertexNormals();
  const floor = new THREE.Mesh(geo, addCaustics(new THREE.MeshStandardMaterial({ map: sandTex, roughness: 0.95 }), 0.7, 0.22));
  floor.receiveShadow = true;
  scene.add(floor);
}
const grassMats = ['#3fae4a', '#5cc24a', '#8fd13f', '#2f9a52'].map((c) => addCaustics(new THREE.MeshStandardMaterial({ color: c, roughness: 0.6, side: THREE.DoubleSide }), 0.35));
const BLADE_N = 14;
const blades = [];
function addBlade(x, z, h, w, ph, front = false) {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array((BLADE_N + 1) * 2 * 3), 3));
  const idx = []; for (let i = 0; i < BLADE_N; i++) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
  geo.setIndex(idx);
  const m = new THREE.Mesh(geo, grassMats[Math.floor(rnd(blades.length, 9) * 4)]);
  m.castShadow = !front; m.frustumCulled = false;
  scene.add(m);
  blades.push({ m, x, z, h, w, ph, front });
}
{
  const r = mulberry32(17);
  for (let i = 0; i < 150; i++) {
    const z = -9 + r() * 8.5, x = (r() - 0.5) * (14 + (-z) * 1.2);
    if (Math.abs(x) < 1.0 && z > -2.5) continue;
    addBlade(x, z, 1.4 + r() * 2.0, 0.09 + r() * 0.06, r() * TAU);
  }
  for (let i = 0; i < 12; i++) addBlade(-2.6 - r() * 1.4, 0.6 + r() * 1.2, 1.0 + r() * 1.4, 0.1, r() * TAU);
  for (let i = 0; i < 12; i++) addBlade(2.6 + r() * 1.4, 0.6 + r() * 1.2, 1.0 + r() * 1.4, 0.1, r() * TAU);
  for (let i = 0; i < 16; i++) addBlade(-0.75 + i * 0.1 + (r() - 0.5) * 0.06, 1.3 + r() * 0.3, 1.9 + r() * 0.6, 0.11, r() * TAU, true);
}
function updateBlades(t, part) {
  for (const b of blades) {
    const p = b.m.geometry.attributes.position.array;
    const side = b.x >= 0 ? 1 : -1;
    const bendOut = b.front ? part * side * 0.9 : 0;
    const hh = b.front ? b.h * (1 - 0.55 * part) : b.h;
    for (let i = 0; i <= BLADE_N; i++) {
      const s = i / BLADE_N;
      const sway = 0.28 * Math.sin(t * 1.1 + b.ph + s * 2.0) * s * s;
      const x = b.x + sway + bendOut * s * s;
      const y = FLOOR_Y + s * hh * (1 - 0.15 * Math.abs(bendOut) * s);
      const z = b.z + 0.1 * Math.sin(t * 0.8 + b.ph) * s;
      const w = b.w * (1 - 0.7 * s);
      p[i * 6] = x - w; p[i * 6 + 1] = y; p[i * 6 + 2] = z;
      p[i * 6 + 3] = x + w; p[i * 6 + 4] = y; p[i * 6 + 5] = z;
    }
    b.m.geometry.attributes.position.needsUpdate = true;
    b.m.geometry.computeVertexNormals();
  }
}

// ------------------------------------------------------------------ 거품, 입자, 빛줄기
const dotTex = canvasTex(32, 32, (g) => {
  const gr = g.createRadialGradient(16, 16, 0, 16, 16, 16);
  gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 32, 32);
});
const bubbleTex = canvasTex(128, 128, (g) => {
  g.strokeStyle = 'rgba(255,255,255,0.9)'; g.lineWidth = 7; g.fillStyle = 'rgba(255,255,255,0.1)';
  g.beginPath(); g.arc(64, 64, 56, 0, TAU); g.fill(); g.stroke();
  g.lineWidth = 9; g.lineCap = 'round'; g.beginPath(); g.arc(64, 64, 36, Math.PI * 1.1, Math.PI * 1.45); g.stroke();
});
const bubbles = [];
for (let i = 0; i < 36; i++) {
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: bubbleTex, transparent: true, depthWrite: false, opacity: 0.7 }));
  scene.add(sp);
  bubbles.push({ sp, x: (rnd(i, 1) - 0.5) * 12, z: -8 + rnd(i, 2) * 9, v: 0.4 + rnd(i, 3) * 0.7, off: rnd(i, 4) * 12, s: 0.07 + rnd(i, 5) * 0.2 });
}
const MOTE = 400;
const moteGeo = new THREE.BufferGeometry();
moteGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(MOTE * 3), 3));
scene.add(new THREE.Points(moteGeo, new THREE.PointsMaterial({ size: 0.05, map: dotTex, transparent: true, opacity: 0.6, depthWrite: false })));
const rayTex = canvasTex(64, 256, (g, w, h) => {
  const gv = g.createLinearGradient(0, 0, 0, h);
  gv.addColorStop(0, 'rgba(255,255,255,1)'); gv.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gv; g.fillRect(0, 0, w, h);
  g.globalCompositeOperation = 'destination-in';
  const gh = g.createLinearGradient(0, 0, w, 0);
  gh.addColorStop(0, 'rgba(0,0,0,0)'); gh.addColorStop(0.5, 'rgba(0,0,0,1)'); gh.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = gh; g.fillRect(0, 0, w, h);
});
const rays = [];
for (let i = 0; i < 7; i++) {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(1.5 + rnd(i, 21) * 1.3, 24),
    new THREE.MeshBasicMaterial({ map: rayTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false, opacity: 0.12 }));
  scene.add(m);
  rays.push({ m, x: -8 + i * 2.6 + rnd(i, 22), z: -5 - rnd(i, 23) * 8, ph: i * 1.7 });
}
function updateAmbient(t) {
  for (const b of bubbles) {
    b.sp.position.set(b.x + 0.15 * Math.sin(t * 1.7 + b.off), FLOOR_Y + ((t * b.v + b.off) % 10), b.z);
    b.sp.scale.setScalar(b.s);
  }
  const p = moteGeo.attributes.position.array;
  for (let i = 0; i < MOTE; i++) {
    p[i * 3] = (rnd(i, 11) - 0.5) * 16 + 0.3 * Math.sin(t * 0.4 + i);
    p[i * 3 + 1] = FLOOR_Y + ((rnd(i, 12) * 9 + t * (0.04 + 0.08 * rnd(i, 13))) % 9);
    p[i * 3 + 2] = -10 + rnd(i, 14) * 12;
  }
  moteGeo.attributes.position.needsUpdate = true;
  for (const r of rays) {
    r.m.position.set(r.x + 0.5 * Math.sin(t * 0.35 + r.ph), 11, r.z);
    r.m.rotation.set(0, 0, 0.3 + 0.04 * Math.sin(t * 0.3 + r.ph));
    r.m.material.opacity = 0.09 + 0.04 * Math.sin(t * 0.8 + r.ph * 2);
  }
}

// ------------------------------------------------------------------ 해마
const SPINE = new THREE.CatmullRomCurve3([[0.02, 1.32], [0.12, 1.12], [0.2, 0.9], [0.23, 0.66], [0.15, 0.42], [0.0, 0.22],
  [-0.08, 0.0], [-0.05, -0.22], [0.07, -0.35], [0.2, -0.3], [0.23, -0.15], [0.13, -0.08], [0.07, -0.16]].map(([x, y]) => V(x, y, 0)));
const RAD_KEYS = [[0, 0.15], [0.1, 0.21], [0.22, 0.24], [0.36, 0.2], [0.5, 0.13], [0.64, 0.085], [0.82, 0.045], [1.0, 0.02]];
const radAt = (s) => {
  for (let i = 0; i < RAD_KEYS.length - 1; i++) if (s <= RAD_KEYS[i + 1][0]) return lerp(RAD_KEYS[i][1], RAD_KEYS[i + 1][1], (s - RAD_KEYS[i][0]) / (RAD_KEYS[i + 1][0] - RAD_KEYS[i][0]));
  return 0.02;
};
function bodyGeometry(base, belly, stripe) {
  const N = 110, M = 22;
  const pos = [], nor = [], col = [], idx = [];
  const cB = new THREE.Color(base), cL = new THREE.Color(belly), cS = new THREE.Color(stripe);
  for (let k = 0; k <= N; k++) {
    const s = k / N;
    const P = SPINE.getPointAt(s), T = SPINE.getTangentAt(s);
    const Nn = V(T.y, -T.x, 0).normalize();     // 앞쪽(배) 방향
    const ring = 1 + 0.08 * Math.max(0, Math.cos(TAU * s * 24));
    const r = radAt(s) * ring;
    for (let a = 0; a <= M; a++) {
      const ang = a / M * TAU;
      const n = Nn.clone().multiplyScalar(Math.cos(ang)).add(ZAXIS.clone().multiplyScalar(Math.sin(ang)));
      pos.push(P.x + n.x * r, P.y + n.y * r, n.z * r * 0.85);
      nor.push(n.x, n.y, n.z);
      const front = smooth(0.2, 0.9, Math.cos(ang));
      const band = Math.max(0, Math.cos(TAU * s * 24)) > 0.92 ? 0.35 : 0;
      const c = cB.clone().lerp(cL, front * 0.7).lerp(cS, band * (1 - front * 0.6));
      col.push(c.r, c.g, c.b);
    }
  }
  for (let k = 0; k < N; k++) for (let a = 0; a < M; a++) {
    const v0 = k * (M + 1) + a, v1 = v0 + 1, v2 = v0 + M + 1, v3 = v2 + 1;
    idx.push(v0, v2, v1, v1, v2, v3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

const darkMat = new THREE.MeshPhysicalMaterial({ color: '#1d1438', roughness: 0.15, clearcoat: 1 });
const shineMat = new THREE.MeshBasicMaterial({ color: '#ffffff' });
const eyeWhite = new THREE.MeshPhysicalMaterial({ color: '#ffffff', roughness: 0.12, clearcoat: 1 });

function makeSeahorse(opts) {
  const { base, belly, stripe, male, detail = true } = opts;
  const root = new THREE.Group(); scene.add(root);
  const body = new THREE.Group(); root.add(body);
  const skin = addCaustics(new THREE.MeshPhysicalMaterial({ vertexColors: true, roughness: 0.4, clearcoat: 0.6, clearcoatRoughness: 0.3, sheen: 0.5, sheenColor: new THREE.Color(belly) }), 0.3);
  const solid = addCaustics(new THREE.MeshPhysicalMaterial({ color: base, roughness: 0.4, clearcoat: 0.6, clearcoatRoughness: 0.3 }), 0.3);
  const light = addCaustics(new THREE.MeshPhysicalMaterial({ color: belly, roughness: 0.4, clearcoat: 0.6, sheen: 0.5, sheenColor: new THREE.Color('#ffffff') }), 0.3);
  const torso = new THREE.Mesh(bodyGeometry(base, belly, stripe), skin); torso.castShadow = true; body.add(torso);
  const head = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 24), solid);
  head.scale.set(0.2, 0.18, 0.16); head.position.set(0.08, 1.45, 0); head.castShadow = true; body.add(head);
  // 주둥이
  const snout = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.066, 0.42, 20), solid);
  const sDir = V(0.95, -0.2, 0).normalize();
  snout.quaternion.setFromUnitVectors(UP, sDir); snout.position.set(0.22, 1.44, 0).addScaledVector(sDir, 0.2); body.add(snout);
  const lip = new THREE.Mesh(new THREE.TorusGeometry(0.05, 0.018, 8, 20), solid);
  lip.quaternion.setFromUnitVectors(ZAXIS, sDir); lip.position.set(0.22, 1.44, 0).addScaledVector(sDir, 0.41); body.add(lip);
  // 왕관 돌기
  for (const [x, y, s] of [[0.03, 1.62, 1], [-0.06, 1.58, 0.8], [0.11, 1.6, 0.8]]) {
    const c = new THREE.Mesh(new THREE.ConeGeometry(0.035 * s, 0.1 * s, 10), solid); c.position.set(x, y, 0); body.add(c);
  }
  // 등 돌기
  if (detail) for (let k = 0; k < 7; k++) {
    const s = 0.08 + k * 0.08, P = SPINE.getPointAt(s), T = SPINE.getTangentAt(s);
    const back = V(-T.y, T.x, 0).normalize();
    const c = new THREE.Mesh(new THREE.ConeGeometry(0.025, 0.07, 8), solid);
    c.quaternion.setFromUnitVectors(UP, back); c.position.copy(P).addScaledVector(back, radAt(s) + 0.02); body.add(c);
  }
  // 눈
  const eyes = [], closed = [];
  for (const sz of [1, -1]) {
    const g = new THREE.Group(); g.position.set(0.13, 1.5, 0.125 * sz); body.add(g);
    const white = new THREE.Mesh(new THREE.SphereGeometry(0.088, 24, 16), eyeWhite); g.add(white);
    const look = new THREE.Group(); g.add(look);
    const pupil = new THREE.Mesh(new THREE.SphereGeometry(0.054, 20, 14), darkMat); pupil.position.z = 0.066 * sz; pupil.scale.set(1, 1, 0.55); look.add(pupil);
    const h1 = new THREE.Mesh(new THREE.SphereGeometry(0.018, 8, 6), shineMat); h1.position.set(-0.016, 0.022, 0.096 * sz); look.add(h1);
    const h2 = new THREE.Mesh(new THREE.SphereGeometry(0.009, 8, 6), shineMat); h2.position.set(0.016, -0.016, 0.097 * sz); look.add(h2);
    eyes.push({ g, look, sz });
    const c = new THREE.Mesh(new THREE.TorusGeometry(0.05, 0.016, 8, 20, Math.PI), darkMat);
    const cg = new THREE.Group(); cg.add(c); cg.position.set(0.13, 1.5, 0.13 * sz + 0.03 * sz); cg.rotation.y = sz > 0 ? 0 : Math.PI; body.add(cg); closed.push(cg);
    const blush = new THREE.Mesh(new THREE.CircleGeometry(0.05, 16), new THREE.MeshBasicMaterial({ color: '#ff6f9c', transparent: true, opacity: 0.5, depthWrite: false }));
    blush.position.set(0.19, 1.41, 0.135 * sz); blush.rotation.y = sz > 0 ? 0.3 : Math.PI - 0.3; blush.scale.set(1.3, 0.8, 1); body.add(blush);
  }
  // 지느러미
  const finMat = new THREE.MeshPhysicalMaterial({ color: belly, transparent: true, opacity: 0.65, side: THREE.DoubleSide, roughness: 0.3, depthWrite: false });
  const finGeo = new THREE.CircleGeometry(0.18, 20, -Math.PI * 0.45, Math.PI * 0.9);
  const dorsal = new THREE.Mesh(finGeo, finMat);
  const dP = SPINE.getPointAt(0.33);
  dorsal.position.set(dP.x - 0.17, dP.y, 0); dorsal.rotation.z = Math.PI; body.add(dorsal);
  const pecs = [1, -1].map((sz) => {
    const f = new THREE.Mesh(new THREE.CircleGeometry(0.08, 14, -Math.PI * 0.4, Math.PI * 0.8), finMat);
    f.position.set(-0.04, 1.36, 0.13 * sz); f.rotation.set(0, sz > 0 ? -0.6 : Math.PI + 0.6, Math.PI); body.add(f);
    return f;
  });
  // 배 주머니
  let pouch = null;
  if (male) {
    pouch = new THREE.Mesh(new THREE.SphereGeometry(1, 28, 20), light);
    pouch.position.set(0.26, 0.6, 0); pouch.scale.set(0.15, 0.21, 0.17); pouch.castShadow = true; body.add(pouch);
  }
  return { root, body, eyes, closed, dorsal, pecs, pouch };
}

function updateSeahorse(h, P, t) {
  h.root.visible = P.visible;
  if (!P.visible) return;
  h.root.position.set(P.x, P.y + 0.05 * Math.sin(t * 1.6 + P.off), P.z);
  h.root.scale.setScalar(P.scale);
  h.root.rotation.set(0, P.yaw, 0.06 * Math.sin(t * 1.2 + P.off) + (P.tilt || 0));
  h.body.rotation.z = 0.04 * Math.sin(t * 2.0 + P.off);
  const f = P.finFreq || 3;
  h.dorsal.scale.set(1, 0.75 + 0.25 * Math.sin(TAU * f * t), 1);
  h.pecs.forEach((p, i) => p.scale.set(0.8 + 0.2 * Math.sin(TAU * f * t + i), 1, 1));
  h.eyes.forEach((e, i) => {
    e.g.visible = !P.happy;
    e.g.scale.set(1, P.blink, 1);
    const L = i === 0 ? P.eyeA : P.eyeB;
    // 반대쪽 눈은 좌우가 뒤집혀 있으므로 sz 를 곱해 같은 의미(+: 아래/앞)로 맞춘다
    e.look.rotation.set(L[1] * e.sz, (L[0] + (P.eyeFwd || 0)) * e.sz, 0);
  });
  h.closed.forEach((c) => { c.visible = !!P.happy; });
  if (h.pouch) {
    const k = P.pouch || 1;
    h.pouch.scale.set(0.15 * k, 0.21 * k, 0.17 * k);
    h.pouch.position.x = 0.26 + 0.05 * (k - 1);
  }
}

const male = makeSeahorse({ base: '#ffb22e', belly: '#ffe39a', stripe: '#e07a12', male: true });
const female = makeSeahorse({ base: '#ff8fb8', belly: '#ffd3e3', stripe: '#e05a8c', male: false });
const BABY_N = 34;
const babies = [];
for (let i = 0; i < BABY_N; i++) babies.push(makeSeahorse({ base: '#ffbf45', belly: '#fff0b8', stripe: '#ef8a1a', male: false, detail: false }));

// 알
const eggs = [];
const eggMat = new THREE.MeshPhysicalMaterial({ color: '#ffa340', roughness: 0.2, clearcoat: 1, emissive: '#ff7a00', emissiveIntensity: 0.6 });
for (let i = 0; i < 10; i++) { const e = new THREE.Mesh(new THREE.SphereGeometry(0.075, 16, 12), eggMat); scene.add(e); eggs.push(e); }

// 달팽이
const snail = new THREE.Group();
{
  const shellTex = canvasTex(256, 64, (g, w, h) => {
    g.fillStyle = '#c97b3c'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 9; i++) { g.fillStyle = i % 2 ? '#e8a868' : '#8f4f22'; g.fillRect(i * w / 9, 0, w / 18, h); }
  });
  const shellMat = new THREE.MeshPhysicalMaterial({ map: shellTex, roughness: 0.35, clearcoat: 0.8 });
  for (let k = 0; k < 4; k++) {
    const r = 0.17 * Math.pow(0.68, k);
    const tor = new THREE.Mesh(new THREE.TorusGeometry(r, r * 0.55, 12, 28), shellMat);
    tor.position.set(-0.02 * k, 0.24 + 0.02 * k, 0.03 * k);
    snail.add(tor);
  }
  const bodyM = new THREE.MeshPhysicalMaterial({ color: '#e9d6b0', roughness: 0.5, clearcoat: 0.4 });
  const foot = new THREE.Mesh(new THREE.CapsuleGeometry(0.07, 0.4, 6, 12), bodyM); foot.rotation.z = Math.PI / 2; foot.position.set(0.05, 0.07, 0); snail.add(foot);
  for (const sz of [-0.04, 0.04]) {
    const st = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.016, 0.18, 8), bodyM);
    st.position.set(0.3, 0.17, sz); st.rotation.z = -0.35; snail.add(st);
    const ey = new THREE.Mesh(new THREE.SphereGeometry(0.025, 10, 8), darkMat); ey.position.set(0.33, 0.26, sz); snail.add(ey);
  }
  snail.traverse((o) => { o.castShadow = true; });
  snail.scale.setScalar(1.3);
  scene.add(snail);
}
// 달팽이가 기어가는 앞쪽 바위 턱
const LEDGE_TOP = -0.82;
{
  const rockMat = addCaustics(new THREE.MeshStandardMaterial({ color: '#b3a58c', roughness: 0.9 }), 0.55);
  for (let k = 0; k < 9; k++) {
    const g = new THREE.IcosahedronGeometry(1, 3);
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) { const v = V(p.getX(i), p.getY(i), p.getZ(i)); v.multiplyScalar(1 + 0.1 * Math.sin(v.x * 3 + k) * Math.sin(v.z * 2.7 + k * 2)); p.setXYZ(i, v.x, v.y, v.z); }
    g.computeVertexNormals();
    const m = new THREE.Mesh(g, rockMat);
    m.scale.set(0.48 + 0.12 * rnd(k, 1), 0.3, 0.38);
    m.position.set(-3.6 + k * 0.9, LEDGE_TOP - 0.28 + 0.03 * rnd(k, 2), 1.25 + 0.05 * rnd(k, 3));
    m.rotation.y = rnd(k, 4) * 3; m.castShadow = m.receiveShadow = true;
    scene.add(m);
  }
}

// ------------------------------------------------------------------ 소품
const PROP = {};
function buildProps(font) {
  const qg = new TextGeometry('?', { font, size: 1.0, depth: 0.32, curveSegments: 10, bevelEnabled: true, bevelThickness: 0.08, bevelSize: 0.025, bevelSegments: 3 });
  qg.center();
  PROP.q = new THREE.Mesh(qg, new THREE.MeshPhysicalMaterial({ color: '#ffd23f', roughness: 0.22, clearcoat: 1, emissive: '#7a5200', emissiveIntensity: 0.15 }));
  PROP.q.castShadow = true;
  scene.add(PROP.q);
}

// ------------------------------------------------------------------ 포즈
function blinkAt(t, off) { const bt = (t + off) % 3.4; return bt < 0.14 ? Math.max(0.1, 1 - Math.sin(Math.PI * bt / 0.14)) : 1; }
const MALE_HOME = V(-0.14, -0.6, 0);
const POUCH_LOCAL = V(0.3, 0.6, 0.12);

function malePose(t, C) {
  const rv = easeBack(prog(t, C.REVEAL[0], C.REVEAL[1]), 1.4);
  const P = { visible: true, x: MALE_HOME.x, y: lerp(-3.0, MALE_HOME.y, rv), z: 0, scale: 1.22, yaw: -0.35, off: 0, finFreq: 3,
    eyeA: [0, 0], eyeB: [0, 0], blink: blinkAt(t, 0.3), happy: false, pouch: 1 };
  if (t < C.REVEAL[0]) P.y = -3.0;
  if ((t >= C.REVEAL[0] + 0.3 && t < C.REVEAL[0] + 1.5) || t >= 27.75) P.happy = true;
  // 엄마가 오면 왼쪽을 봄
  const fem = smooth(C.FEMALE[0], C.FEMALE[1], t) * (1 - smooth(C.FEMALE[2], C.FEMALE[3], t));
  P.yaw = lerp(P.yaw, -0.35 + 0.5 * fem, 1);
  // 배가 부풀었다가 아기를 낳으며 줄어듦
  const inf = easeBack(prog(t, C.INFLATE[0], C.INFLATE[1]), 2.0) * (1 - easeIO(prog(t, C.BIRTH[0] + 0.2, C.BIRTH[1])));
  const throb = (t >= C.BIRTH[0] && t < C.BIRTH[1]) ? 0.08 * Math.max(0, Math.sin(TAU * 1.4 * (t - C.BIRTH[0]))) : 0;
  P.pouch = 1 + 0.55 * inf - throb;
  P.eyeA = [0.15, -0.1 * inf]; P.eyeB = [0.15, -0.1 * inf];
  // 정면으로 돌아 두 눈을 따로따로
  const [t0, t1, t2, t3] = C.TURN;
  const turn = easeIO(prog(t, t0, t1)) * (1 - easeIO(prog(t, t2, t3)));
  P.yaw = lerp(P.yaw, -1.25, turn);
  P.x = lerp(P.x, -0.2, turn);
  P.eyeFwd = 0.85 * turn;
  if (t >= C.EYES[0] && t < C.EYES[1]) {
    const u = t - C.EYES[0];
    const a = 0.75 * Math.sin(u * 2.1), b = -0.75 * Math.sin(u * 2.1 + 0.35);   // 늘 반대 방향
    const ph2 = smooth(1.9, 2.2, u);
    P.eyeA = [0.25 * Math.sin(u * 1.3), lerp(-0.75, a, ph2)];
    P.eyeB = [0.25 * Math.sin(u * 1.1 + 1), lerp(0.75, b, ph2)];
  }
  // 아주 느린 헤엄
  const sl = prog(t, C.SLOW[0], C.SLOW[1]);
  if (t >= C.SLOW[0] - 0.3) {
    P.x = lerp(MALE_HOME.x, MALE_HOME.x + 0.22, sl) * (t < C.SLOW[0] ? 1 : 1);
    P.finFreq = lerp(3, 9, smooth(C.SLOW[0], C.SLOW[0] + 0.3, t) * (1 - smooth(C.SLOW[1] - 0.2, C.SLOW[1], t)));
    P.tilt = -0.08 * smooth(C.SLOW[0], C.SLOW[0] + 0.4, t) * (1 - smooth(C.SLOW[1] - 0.3, C.SLOW[1], t));
  }
  return P;
}

function femalePose(t, C) {
  const [a0, a1, b0, b1] = C.FEMALE;
  const inA = easeOut(prog(t, a0, a1)), outA = easeIn(prog(t, b0, b1)), in2 = easeOut(prog(t, C.OUTRO[0], C.OUTRO[1]));
  const visible = (t >= a0 && t < b1) || t >= C.OUTRO[0];
  let x = lerp(-4.2, -1.55, inA) - 2.8 * outA;
  if (t >= C.OUTRO[0]) x = lerp(-4.2, -1.55, in2);
  return { visible, x, y: -0.45, z: -0.3, scale: 0.98, yaw: 0.45, off: 1.3, finFreq: 3.5, eyeA: [0.1, 0], eyeB: [0.1, 0],
    blink: blinkAt(t, 1.7), happy: t >= 27.8 };
}

// ------------------------------------------------------------------ 프레임 렌더
window.renderFrame = (S, opts = {}) => {
  const t = S.t, C = S.cues;
  causticTime.value = t;
  const [c0, c1, c2, c3] = C.TURN;
  setCamera(easeIO(prog(t, c0, c1)) * (1 - easeIO(prog(t, c2, c3))));
  const part = easeIO(prog(t, C.REVEAL[0] - 0.1, C.REVEAL[0] + 0.5));
  updateBlades(t, part);
  updateAmbient(t);
  const MP = malePose(t, C), FP = femalePose(t, C);
  updateSeahorse(male, MP, t);
  updateSeahorse(female, FP, t);
  male.root.updateMatrixWorld(true); female.root.updateMatrixWorld(true);
  const pouchW = male.body.localToWorld(POUCH_LOCAL.clone());
  const anchors = {};
  // 알: 엄마 배 -> 아빠 주머니
  const femBelly = female.body.localToWorld(V(0.22, 0.6, 0.1));
  eggs.forEach((e, i) => {
    const t0 = C.EGGS[0] + i * 0.13, a = prog(t, t0, t0 + 0.7);
    e.visible = a > 0 && a < 1;
    if (!e.visible) return;
    const p = femBelly.clone().lerp(pouchW, easeIO(a));
    p.y += 0.45 * Math.sin(Math.PI * a) + 0.06 * Math.sin(i * 2.3);
    p.z += 0.08 * Math.sin(i * 1.7);
    e.position.copy(p);
    e.scale.setScalar(1 - 0.4 * smooth(0.8, 1, a));
  });
  // 아기 해마들
  babies.forEach((b, i) => {
    const tb = C.BIRTH[0] + (i / BABY_N) * (C.BIRTH[1] - C.BIRTH[0] - 1.2) + 0.15 * rnd(i, 3);
    const age = t - tb;
    const outroBaby = i < 6 && t >= C.OUTRO[0];
    if (outroBaby) {
      const a = easeOut(prog(t, C.OUTRO[0] + i * 0.08, C.OUTRO[1] + i * 0.08));
      const ang = -0.6 + i * 0.45;
      updateSeahorse(b, { visible: true, x: lerp(0.0, 0.1 + 1.45 * Math.cos(ang), a), y: lerp(-1.6, 0.35 + 0.9 * Math.sin(ang) * 0.6 + (i % 2) * 0.3, a), z: 0.6,
        scale: 0.3, yaw: -0.4 + 0.3 * Math.sin(i), off: i, finFreq: 5, eyeA: [0, 0], eyeB: [0, 0], blink: 1, happy: t >= 27.8 }, t);
      return;
    }
    const vis = age > 0 && age < 4.2 && t < 16.4;
    if (!vis) { b.root.visible = false; return; }
    const ang = -0.5 + rnd(i, 1) * 3.6;
    const dir = V(Math.cos(ang), Math.sin(ang) * 0.9 + 0.2, (rnd(i, 4) - 0.5) * 0.8).normalize();
    const dist = 1.5 * easeOut(clamp(age / 3.0)) + 0.08 * age;
    const p = pouchW.clone().addScaledVector(dir, dist);
    p.y += 0.18 * age;
    const sc = 0.26 * smooth(0, 0.35, age) * (1 - smooth(15.9, 16.35, t)) * (0.85 + 0.3 * rnd(i, 6));
    updateSeahorse(b, { visible: sc > 0.005, x: p.x, y: p.y, z: p.z, scale: sc, yaw: -0.5 + 0.8 * rnd(i, 7), off: i * 0.7, finFreq: 6,
      eyeA: [0, 0], eyeB: [0, 0], blink: 1, happy: false }, t);
  });
  // 달팽이
  const sa = prog(t, C.SLOW[0], C.SLOW[1]);
  snail.visible = t >= C.SLOW[0] - 0.1 && t < C.SLOW[1] + 0.1;
  snail.position.set(lerp(-3.2, 2.9, sa), LEDGE_TOP, 1.25);
  snail.rotation.set(0, 0, 0.03 * Math.sin(t * 6));
  if (snail.visible) anchors.snail = project(snail.position.clone().add(V(0, 0.5, 0)));
  // 물음표
  if (PROP.q) {
    const qa = prog(t, 0.9, 1.35), qo = prog(t, 3.37, 3.55);
    const qs = (0.4 + 0.6 * easeBack(qa, 2.2)) * Math.min(1, qa * 2.5) * (1 - qo);
    PROP.q.visible = t >= 0.9 && t < 3.55 && qs > 0.01;
    if (PROP.q.visible) {
      const p = screenToWorld(540, 800 + 12 * Math.sin(t * 4));
      PROP.q.position.copy(p);
      PROP.q.scale.setScalar(qs * 150 / (0.72 * pxPerUnitAt(p)));
      PROP.q.rotation.set(0.05, Math.sin(t * 2.2) * 0.6, 0.14 * Math.sin(t * 3.1));
    }
  }
  anchors.pouch = project(pouchW);
  anchors.male = project(male.body.localToWorld(V(0.1, 1.5, 0)));
  anchors.eyeA = project(male.eyes[0].g.getWorldPosition(V(0, 0, 0)));
  anchors.eyeB = project(male.eyes[1].g.getWorldPosition(V(0, 0, 0)));
  if (FP.visible) anchors.female = project(female.body.localToWorld(V(0.1, 1.5, 0)));
  renderer.render(scene, camera);
  const img = renderer.domElement.toDataURL(opts.png ? 'image/png' : 'image/jpeg', 0.95);
  return { img, anchors };
};

new FontLoader().load('/three/examples/fonts/helvetiker_bold.typeface.json', (font) => {
  buildProps(font);
  window.ready = true;
}, undefined, (e) => { window.loadError = String(e); });
