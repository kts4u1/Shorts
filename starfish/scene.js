// 불가사리 쇼츠 3D 장면 (three.js). 프레임 시각 t 와 연출 큐(cues)를 받아 한 장씩 렌더링한다.
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

const camera = new THREE.PerspectiveCamera(30, W / H, 0.1, 200);
const CAMS = {
  base: { pos: V(0, 2.7, 6.9), look: V(0, -0.58, 0) },
  top: { pos: V(0, 6.0, 4.3), look: V(0, -1.0, -0.42) },
  wide: { pos: V(0.04, 3.3, 7.5), look: V(0.04, -0.5, 0.05) },
  glass: { pos: V(0, 4.6, 4.6), look: V(0, -0.98, -0.22) },
  side: { pos: V(0.25, -0.5, 5.3), look: V(0.25, -0.92, 0) },
};
function setCamera(t, C) {
  let a = CAMS.base, b = CAMS.base, k = 0;
  if (t >= 3.6 && t < 10.2) {
    const [c0, c1, c2, c3] = C.CLOSE;
    b = CAMS.top; k = easeIO(prog(t, c0, c1)) * (1 - easeIO(prog(t, c2, c3)));
  } else if (t >= 10.2 && t < 16.6) { a = b = CAMS.wide; }
  else if (t >= 16.6 && t < 22.6) { a = b = CAMS.glass; }
  else if (t >= 22.6 && t < 27.6) { a = b = CAMS.side; }
  else if (t >= 27.6) { a = b = CAMS.wide; }
  camera.position.copy(a.pos).lerp(b.pos, k);
  camera.lookAt(a.look.clone().lerp(b.look, k));
  camera.updateMatrixWorld();
}
function project(v) {
  const p = v.clone().project(camera);
  return [(p.x + 1) / 2 * W, (1 - p.y) / 2 * H];
}
function pxPerUnitAt(v) {
  const a = project(v), b = project(v.clone().add(V(0.01, 0, 0)));
  return Math.hypot(b[0] - a[0], b[1] - a[1]) / 0.01;
}
function screenToWorld(px, py, dist = 4.0) {
  const v = V(px / W * 2 - 1, -(py / H * 2 - 1), 0.5).unproject(camera);
  const dir = v.sub(camera.position).normalize();
  return camera.position.clone().addScaledVector(dir, dist);
}

// ------------------------------------------------------------------ 배경 3종
const grad = (stops) => canvasTex(8, 512, (g, w, h) => {
  const gr = g.createLinearGradient(0, 0, 0, h);
  for (const [p, c] of stops) gr.addColorStop(p, c);
  g.fillStyle = gr; g.fillRect(0, 0, w, h);
});
const BG = {
  ocean: { bg: grad([[0, '#5cc9ec'], [0.45, '#1f86c2'], [1, '#0b467c']]), fog: new THREE.Fog(new THREE.Color('#2789c2'), 13, 34) },
  night: { bg: grad([[0, '#123a63'], [0.5, '#0a2142'], [1, '#040d1f']]), fog: new THREE.Fog(new THREE.Color('#0a2142'), 9, 26) },
};

// ------------------------------------------------------------------ 조명
const hemi = new THREE.HemisphereLight(0xd8f4ff, 0x3a6a86, 1.15);
const key = new THREE.DirectionalLight(0xf0fbff, 2.3);
key.position.set(-3, 10, 6); key.castShadow = true;
key.shadow.mapSize.set(2048, 2048);
Object.assign(key.shadow.camera, { left: -6, right: 6, top: 6, bottom: -6, near: 1, far: 30 });
key.shadow.bias = -0.0005; key.shadow.normalBias = 0.02; key.shadow.radius = 5;
const rim = new THREE.DirectionalLight(0xaeefff, 1.2); rim.position.set(4, 4, -7);
scene.add(hemi, key, key.target, rim);

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
const causticTime = { value: 0 }, causticAmt = { value: 1 };
function addCaustics(mat, strength = 0.5, scale = 0.2) {
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = causticTime; shader.uniforms.uAmt = causticAmt;
    shader.uniforms.uCaustic = { value: causticTex };
    shader.uniforms.uCStrength = { value: strength }; shader.uniforms.uCScale = { value: scale };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vCWP;\nvarying vec3 vCWN;')
      .replace('#include <fog_vertex>', '#include <fog_vertex>\nvCWP = (modelMatrix * vec4(transformed, 1.0)).xyz;\nvCWN = normalize(mat3(modelMatrix) * objectNormal);');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uTime;\nuniform float uAmt;\nuniform sampler2D uCaustic;\nuniform float uCStrength;\nuniform float uCScale;\nvarying vec3 vCWP;\nvarying vec3 vCWN;')
      .replace('#include <opaque_fragment>', `
        {
          vec2 cuv = vCWP.xz * uCScale + vec2(vCWP.y * 0.05);
          float c1 = texture2D(uCaustic, cuv + vec2(uTime * 0.035, uTime * 0.021)).r;
          float c2 = texture2D(uCaustic, cuv * 1.31 + vec2(-uTime * 0.027, uTime * 0.033)).r;
          float cst = min(c1, c2) * 1.6;
          float upw = clamp(vCWN.y * 0.75 + 0.35, 0.0, 1.0);
          outgoingLight += diffuseColor.rgb * cst * uCStrength * upw * uAmt;
        }
        #include <opaque_fragment>`);
  };
  mat.customProgramCacheKey = () => 'caustic-' + strength + '-' + scale;
  return mat;
}

// ------------------------------------------------------------------ 바닥, 바위, 해초
const FLOOR_Y = -1.45;
{
  const sandTex = canvasTex(512, 512, (g, w, h) => {
    g.fillStyle = '#e9d3a2'; g.fillRect(0, 0, w, h);
    const r = mulberry32(42);
    for (let i = 0; i < 8000; i++) {
      const x = r() * w, y = r() * h, s = 0.6 + r() * 1.8;
      g.fillStyle = r() > 0.5 ? `rgba(255,250,230,${0.25 + r() * 0.3})` : `rgba(150,110,60,${0.1 + r() * 0.2})`;
      for (const [ox, oy] of [[0, 0], [w, 0], [-w, 0], [0, h], [0, -h]]) { g.beginPath(); g.arc(x + ox, y + oy, s, 0, TAU); g.fill(); }
    }
  });
  sandTex.wrapS = sandTex.wrapT = THREE.RepeatWrapping; sandTex.repeat.set(30, 30);
  const geo = new THREE.PlaneGeometry(120, 120, 160, 160); geo.rotateX(-Math.PI / 2);
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) { const x = p.getX(i), z = p.getZ(i); p.setY(i, FLOOR_Y + 0.28 * Math.sin(x * 0.35 + 1) * Math.cos(z * 0.3) * smooth(3, 9, Math.hypot(x, z)) + 0.03 * Math.sin(x * 3) * Math.sin(z * 2.6)); }
  geo.computeVertexNormals();
  const floor = new THREE.Mesh(geo, addCaustics(new THREE.MeshStandardMaterial({ map: sandTex, roughness: 0.95 }), 0.7, 0.2));
  floor.receiveShadow = true; scene.add(floor);
  const rockMat = addCaustics(new THREE.MeshStandardMaterial({ color: '#7d8796', roughness: 0.9 }), 0.4);
  [[-5.2, -6.5, 0.9], [5.4, -7.5, 1.1], [-3.0, -11, 1.5], [3.6, -12, 1.4], [0.4, -16, 2.2], [-7, -14, 1.9]].forEach(([x, z, s], k) => {
    const g = new THREE.IcosahedronGeometry(1, 3); const pp = g.attributes.position;
    for (let i = 0; i < pp.count; i++) { const v = V(pp.getX(i), pp.getY(i), pp.getZ(i)); v.multiplyScalar(1 + 0.12 * Math.sin(v.x * 3 + k) * Math.sin(v.y * 2.5 + k)); pp.setXYZ(i, v.x, v.y, v.z); }
    g.computeVertexNormals();
    const m = new THREE.Mesh(g, rockMat); m.position.set(x, FLOOR_Y + s * 0.3, z); m.scale.set(s * 1.3, s * 0.7, s); m.receiveShadow = true; scene.add(m);
  });
  const weed = addCaustics(new THREE.MeshStandardMaterial({ color: '#3fae5a', roughness: 0.6, side: THREE.DoubleSide }), 0.3);
  for (let k = 0; k < 26; k++) {
    const x = (rnd(k, 1) - 0.5) * 14, z = -2 - rnd(k, 2) * 10, h = 0.8 + rnd(k, 3) * 1.6;
    const g = new THREE.PlaneGeometry(0.12, h, 1, 8); g.translate(0, h / 2, 0);
    const pp = g.attributes.position; for (let i = 0; i < pp.count; i++) { const y = pp.getY(i); pp.setX(i, pp.getX(i) + 0.15 * Math.sin(y * 2 + k) * y / h); }
    g.computeVertexNormals();
    const m = new THREE.Mesh(g, weed); m.position.set(x, FLOOR_Y, z); m.rotation.y = rnd(k, 4) * 3; scene.add(m);
  }
}

// 빛줄기, 거품, 입자
const glowTex = canvasTex(128, 128, (g, w, h) => {
  const gr = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
  gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.3, 'rgba(255,255,255,0.5)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, w, h);
});
const rayTex = canvasTex(64, 256, (g, w, h) => {
  const gv = g.createLinearGradient(0, 0, 0, h); gv.addColorStop(0, 'rgba(255,255,255,1)'); gv.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gv; g.fillRect(0, 0, w, h); g.globalCompositeOperation = 'destination-in';
  const gh = g.createLinearGradient(0, 0, w, 0); gh.addColorStop(0, 'rgba(0,0,0,0)'); gh.addColorStop(0.5, 'rgba(0,0,0,1)'); gh.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = gh; g.fillRect(0, 0, w, h);
});
const rays = [];
for (let i = 0; i < 7; i++) {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(1.5 + rnd(i, 21) * 1.3, 24), new THREE.MeshBasicMaterial({ map: rayTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false, opacity: 0.12 }));
  scene.add(m); rays.push({ m, x: -8 + i * 2.6 + rnd(i, 22), z: -5 - rnd(i, 23) * 8, ph: i * 1.7 });
}
const bubbleTex = canvasTex(128, 128, (g) => {
  g.strokeStyle = 'rgba(255,255,255,0.9)'; g.lineWidth = 7; g.fillStyle = 'rgba(255,255,255,0.1)';
  g.beginPath(); g.arc(64, 64, 56, 0, TAU); g.fill(); g.stroke();
  g.lineWidth = 9; g.lineCap = 'round'; g.beginPath(); g.arc(64, 64, 36, Math.PI * 1.1, Math.PI * 1.45); g.stroke();
});
const bubbles = [];
for (let i = 0; i < 36; i++) {
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: bubbleTex, transparent: true, depthWrite: false, opacity: 0.7 }));
  scene.add(sp); bubbles.push({ sp, x: (rnd(i, 1) - 0.5) * 14, z: -8 + rnd(i, 2) * 10, v: 0.4 + rnd(i, 3) * 0.7, off: rnd(i, 4) * 12, s: 0.07 + rnd(i, 5) * 0.2 });
}
const dotTex = canvasTex(32, 32, (g) => {
  const gr = g.createRadialGradient(16, 16, 0, 16, 16, 16); gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 32, 32);
});
const dropTex = canvasTex(64, 64, (g) => {
  const gr = g.createRadialGradient(26, 26, 2, 32, 32, 30);
  gr.addColorStop(0, 'rgba(235,252,255,1)'); gr.addColorStop(0.35, 'rgba(70,200,255,1)'); gr.addColorStop(0.8, 'rgba(20,120,240,0.9)'); gr.addColorStop(1, 'rgba(20,120,240,0)');
  g.fillStyle = gr; g.beginPath(); g.arc(32, 32, 30, 0, TAU); g.fill();
});
const MOTE = 450;
const moteGeo = new THREE.BufferGeometry(); moteGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(MOTE * 3), 3));
const moteMat = new THREE.PointsMaterial({ size: 0.05, map: dotTex, transparent: true, opacity: 0.6, depthWrite: false });
scene.add(new THREE.Points(moteGeo, moteMat));
// ------------------------------------------------------------------ 불가사리
// 팔 좌표: x = 팔이 뻗는 방향, y = 위, z = 옆. 팔 메시는 중심(원점)에서 시작해 끝까지 이어지고,
// 매 프레임 중심선(들어 올림/말림/옆 휨)을 따라 단면을 다시 쌓는다.
const ARM_L = 1.0, ARM_W = 0.2, ARM_H = 0.13, NS = 30, NA = 22, DOME_R = 0.34;
const STAR_Y = FLOOR_Y + 0.085;
const STUMP = 0.42;                                          // 떨어진 뒤 남은 팔 길이
const COL_TOP = new THREE.Color('#ff7444'), COL_TOP2 = new THREE.Color('#ff9c55');
const COL_BELLY = new THREE.Color('#ffd9b8'), COL_GROOVE = new THREE.Color('#ea8a5c');
const ARM_ANG = [0, 1, 2, 3, 4].map((k) => Math.PI / 2 + k * TAU / 5);   // 0번 팔 = 화면 위쪽
const SCREEN_ORDER = [0, 4, 3, 2, 1];                        // 화면 위에서 시계 방향
const BUMPS = [];
for (let j = 0; j < 7; j++) BUMPS.push([0.24 + 0.1 * j, Math.PI / 2, 1]);
for (let j = 0; j < 6; j++) for (const sd of [-1, 1]) BUMPS.push([0.29 + 0.11 * j, Math.PI / 2 + sd * 0.95, 0.7]);
const FEET = [];
for (let j = 0; j < 13; j++) for (const sd of [-1, 1]) FEET.push([0.3 + 0.05 * j, sd]);

function armProfile(s) {                                     // [폭, 두께] 배율: 양 끝이 둥글게 닫힘
  const tip = Math.sqrt(Math.max(0, 1 - Math.pow(s, 8)));
  const u = 1 - Math.min(1, s / 0.08), base = Math.sqrt(Math.max(0, 1 - u * u));
  return [(1 - 0.7 * s) * tip * base, (1 - 0.55 * s) * tip * base];
}
function csPoint(ph, w, h) {                                 // 단면 한 점 [옆, 위]: 위는 둥글고 아래는 납작
  const sy = Math.sin(ph);
  return [w * Math.cos(ph), sy >= 0 ? h * sy : 0.35 * h * sy];
}
function makeArmGeo() {
  const nv = (NS + 1) * NA, g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(nv * 3), 3));
  const col = new Float32Array(nv * 3), idx = [];
  for (let i = 0; i <= NS; i++) for (let a = 0; a < NA; a++) {
    const ph = a / NA * TAU, sy = Math.sin(ph), cz = Math.cos(ph), j = (i * NA + a) * 3;
    const c = sy > -0.05 ? COL_TOP.clone().lerp(COL_TOP2, clamp(0.35 + 0.5 * cz * cz - 0.25 * sy + 0.12 * Math.sin(i * 1.7))) : (Math.abs(cz) < 0.4 ? COL_GROOVE : COL_BELLY);
    col[j] = c.r; col[j + 1] = c.g; col[j + 2] = c.b;
    if (i < NS) { const a1 = (a + 1) % NA, p = i * NA + a, q = i * NA + a1; idx.push(p, p + NA, q, q, p + NA, q + NA); }
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3)); g.setIndex(idx);
  return g;
}
const starMat = addCaustics(new THREE.MeshPhysicalMaterial({ vertexColors: true, roughness: 0.55, clearcoat: 0.35, clearcoatRoughness: 0.5 }), 0.35);
const bumpMat = addCaustics(new THREE.MeshStandardMaterial({ color: '#ffe2a2', roughness: 0.5 }), 0.3);
const footMat = new THREE.MeshStandardMaterial({ color: '#ffe8c6', roughness: 0.55, emissive: '#39c8ff', emissiveIntensity: 0 });
const bumpGeo = new THREE.SphereGeometry(0.03, 10, 8); bumpGeo.scale(1, 0.75, 1);
const footGeo = new THREE.CapsuleGeometry(0.018, 0.06, 3, 8); footGeo.translate(0, -0.048, 0);
const eyeGeo = new THREE.SphereGeometry(0.036, 16, 12);
const MADRE = V(Math.cos(Math.PI / 2 + TAU / 10) * 0.17, 0.133, -Math.sin(Math.PI / 2 + TAU / 10) * 0.17);   // 물 들어가는 구멍

function makeStar(opts = {}) {
  const root = new THREE.Group(); scene.add(root);
  const glassMat = new THREE.MeshPhysicalMaterial({ vertexColors: true, roughness: 0.25, clearcoat: 1, transparent: true, opacity: 1 });
  const bumpGlass = new THREE.MeshStandardMaterial({ color: '#ffe2a2', roughness: 0.5, transparent: true, opacity: 1 });
  const domeGeo = new THREE.SphereGeometry(DOME_R, 36, 20);
  {
    const p = domeGeo.attributes.position, col = new Float32Array(p.count * 3);
    for (let i = 0; i < p.count; i++) { const y = p.getY(i); p.setY(i, y > 0 ? y * 0.44 : y * 0.13); const c = y > -0.01 ? COL_TOP : COL_BELLY; col.set([c.r, c.g, c.b], i * 3); }
    domeGeo.setAttribute('color', new THREE.BufferAttribute(col, 3)); domeGeo.computeVertexNormals();
  }
  const dome = new THREE.Mesh(domeGeo, starMat); dome.castShadow = true; root.add(dome);
  const mouth = new THREE.Mesh(new THREE.CircleGeometry(0.065, 24), new THREE.MeshStandardMaterial({ color: '#7a2c1c', roughness: 0.8 }));
  mouth.rotation.x = Math.PI / 2; mouth.position.y = -0.047; root.add(mouth);
  const madre = new THREE.Mesh(new THREE.CircleGeometry(0.035, 20), new THREE.MeshStandardMaterial({ color: '#ffd84d', roughness: 0.4, emissive: '#ff9d00', emissiveIntensity: 0.35 }));
  madre.rotation.x = -Math.PI / 2; madre.position.copy(MADRE); root.add(madre);
  const arms = ARM_ANG.map((ang) => {
    const g = new THREE.Group(); g.rotation.y = ang; root.add(g);
    const geo = makeArmGeo(), mesh = new THREE.Mesh(geo, starMat); mesh.castShadow = true; mesh.frustumCulled = false; g.add(mesh);
    const bumps = new THREE.InstancedMesh(bumpGeo, bumpMat, BUMPS.length); bumps.frustumCulled = false; g.add(bumps);
    const feet = new THREE.InstancedMesh(footGeo, footMat, FEET.length); feet.frustumCulled = false; g.add(feet);
    const eyeMat = new THREE.MeshPhysicalMaterial({ color: '#ff3030', emissive: '#ff1a1a', emissiveIntensity: 0.3, roughness: 0.15, clearcoat: 1 });
    const eye = new THREE.Mesh(eyeGeo, eyeMat); g.add(eye);
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: '#ff4a4a', transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0 })); g.add(glow);
    return { g, geo, mesh, bumps, feet, eye, eyeMat, glow, frames: [] };
  });
  const S = { root, dome, mouth, madre, arms, glassMat, bumpGlass, canal: null, drops: [] };
  if (opts.canals) {
    const cm = new THREE.MeshBasicMaterial({ color: '#1593ff', transparent: true, opacity: 0, depthWrite: false });
    const canal = new THREE.Group(); root.add(canal);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.17, 0.02, 8, 48), cm); ring.rotation.x = Math.PI / 2; ring.position.y = 0.03; canal.add(ring);
    for (const ang of ARM_ANG) {
      const c = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.019, 0.68, 8), cm); c.rotation.z = Math.PI / 2; c.position.set(0.51, 0.03, 0);
      const g = new THREE.Group(); g.rotation.y = ang; g.add(c); canal.add(g);
    }
    const stone = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.1, 8), cm); stone.position.set(MADRE.x, 0.08, MADRE.z); canal.add(stone);
    canal.traverse((o) => { o.renderOrder = 1; });
    S.canal = canal; S.canalMat = cm;
    for (let i = 0; i < 46; i++) {
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: dropTex, transparent: true, depthWrite: false, depthTest: false, opacity: 0 }));
      sp.renderOrder = 3; root.add(sp); S.drops.push(sp);
    }
  }
  return S;
}
function starParams() {
  return {
    visible: true, x: 0, y: STAR_Y, z: 0, yaw: 0, flip: 0, scale: 1, dome: 1, glass: 0, feet: 0, water: 0,
    arms: [0, 1, 2, 3, 4].map(() => ({ len: 1, wid: 1, curl: 0, yaw: 0, lift: 0 })),
    eyes: [0, 1, 2, 3, 4].map(() => ({ glow: 0.4, halo: 0, size: 1, blink: 1 })),
  };
}
function frameAt(A, s) {
  const f = clamp(s) * NS, i = Math.min(NS - 1, Math.floor(f)), u = f - i, F0 = A.frames[i], F1 = A.frames[i + 1];
  const L = (a, b) => [lerp(a[0], b[0], u), lerp(a[1], b[1], u), lerp(a[2], b[2], u)];
  return { c: L(F0.c, F1.c), d: L(F0.d, F1.d), n: L(F0.n, F1.n), b: L(F0.b, F1.b), w: lerp(F0.w, F1.w, u), h: lerp(F0.h, F1.h, u) };
}
const _o = new THREE.Object3D(), _down = V(0, -1, 0);
function updateArm(S, A, a, e, P, t, k) {
  A.g.visible = a.len > 0.02;
  if (!A.g.visible) return;
  const pos = A.geo.attributes.position.array, segL = ARM_L * a.len / NS;
  let cx = 0, cy = 0, cz = 0;
  for (let i = 0; i <= NS; i++) {
    const s = i / NS, th = a.lift + a.curl * Math.pow(s, 1.6), ps = a.yaw * s;
    const ct = Math.cos(th), st = Math.sin(th), cp = Math.cos(ps), sp = Math.sin(ps);
    if (i > 0) { cx += ct * cp * segL; cy += st * segL; cz += ct * sp * segL; }
    const [pw, ph] = armProfile(s), w = ARM_W * a.wid * pw, h = ARM_H * a.wid * ph;
    const F = A.frames[i] || (A.frames[i] = {});
    F.c = [cx, cy, cz]; F.d = [ct * cp, st, ct * sp]; F.n = [-st * cp, ct, -st * sp]; F.b = [-sp, 0, cp]; F.w = w; F.h = h;
    for (let q = 0; q < NA; q++) {
      const [zz, yy] = csPoint(q / NA * TAU, w, h), j = (i * NA + q) * 3;
      pos[j] = cx + F.n[0] * yy + F.b[0] * zz; pos[j + 1] = cy + F.n[1] * yy + F.b[1] * zz; pos[j + 2] = cz + F.n[2] * yy + F.b[2] * zz;
    }
  }
  A.geo.attributes.position.needsUpdate = true; A.geo.computeVertexNormals();
  const glass = P.glass > 0.01;
  A.mesh.material = glass ? S.glassMat : starMat; A.mesh.renderOrder = glass ? 2 : 0;
  A.bumps.material = glass ? S.bumpGlass : bumpMat; A.bumps.renderOrder = glass ? 2 : 0;
  const grow = clamp(a.len * 1.4);
  BUMPS.forEach(([s, ph, sz], m) => {
    const F = frameAt(A, s), [zz, yy] = csPoint(ph, F.w, F.h);
    _o.position.set(F.c[0] + F.n[0] * yy + F.b[0] * zz, F.c[1] + F.n[1] * yy + F.b[1] * zz, F.c[2] + F.n[2] * yy + F.b[2] * zz);
    _o.quaternion.setFromUnitVectors(UP, V(...F.n)); _o.scale.setScalar(Math.max(1e-3, sz * a.wid * (1 - 0.45 * s) * grow));
    _o.updateMatrix(); A.bumps.setMatrixAt(m, _o.matrix);
  });
  A.bumps.instanceMatrix.needsUpdate = true;
  FEET.forEach(([s, sd], m) => {
    const F = frameAt(A, s), zz = sd * 0.32 * F.w, yy = -0.33 * F.h;
    _o.position.set(F.c[0] + F.n[0] * yy + F.b[0] * zz, F.c[1] + F.n[1] * yy + F.b[1] * zz, F.c[2] + F.n[2] * yy + F.b[2] * zz);
    const wig = P.feet * 0.75 * Math.sin(t * 9 + s * 16 + sd * 1.4 + k * 0.9);
    const dir = V(-F.n[0] + F.d[0] * wig + F.b[0] * sd * 0.22, -F.n[1] + F.d[1] * wig, -F.n[2] + F.d[2] * wig + F.b[2] * sd * 0.22).normalize();
    _o.quaternion.setFromUnitVectors(_down, dir);
    const ln = (0.75 + P.feet * (0.35 + 0.25 * Math.sin(t * 7 + s * 11 + sd))) * (1 - 0.4 * s) * a.wid * grow;
    _o.scale.set(a.wid, Math.max(1e-3, ln), a.wid); _o.updateMatrix(); A.feet.setMatrixAt(m, _o.matrix);
  });
  A.feet.instanceMatrix.needsUpdate = true;
  const F = A.frames[NS - 1];
  A.eye.position.set(F.c[0] + F.d[0] * 0.03 + F.n[0] * 0.008, F.c[1] + F.d[1] * 0.03 + F.n[1] * 0.008, F.c[2] + F.d[2] * 0.03 + F.n[2] * 0.008);
  A.eye.scale.set(1, Math.max(0.08, e.blink), 1).multiplyScalar(Math.max(1e-3, e.size * a.wid * grow));
  A.eyeMat.emissiveIntensity = e.glow;
  A.glow.position.copy(A.eye.position); A.glow.material.opacity = clamp(e.halo);
  A.glow.scale.setScalar(0.34 * a.wid * (0.5 + e.halo)); A.glow.visible = e.halo > 0.01;
}
function poseStar(S, P, t) {
  S.root.visible = P.visible;
  if (!P.visible) return;
  S.root.position.set(P.x, P.y, P.z);
  S.root.rotation.set(P.flip, P.yaw, 0, 'YXZ');
  S.root.scale.setScalar(P.scale);
  const glass = P.glass > 0.01;
  S.glassMat.opacity = lerp(1, 0.42, P.glass); S.bumpGlass.opacity = lerp(1, 0.2, P.glass);
  S.dome.material = glass ? S.glassMat : starMat; S.dome.renderOrder = glass ? 2 : 0;
  S.dome.visible = P.dome > 0.01; S.dome.scale.setScalar(Math.max(P.dome, 1e-3));
  S.mouth.visible = P.dome > 0.3; S.mouth.scale.setScalar(P.dome);
  S.madre.visible = P.dome > 0.6; S.madre.material.emissiveIntensity = 0.35 + 1.2 * P.water;
  S.arms.forEach((A, k) => updateArm(S, A, P.arms[k], P.eyes[k], P, t, k));
  if (S.canal) {
    S.canal.visible = P.water > 0.01; S.canalMat.opacity = 0.95 * P.water;
    // 바닷물 알갱이: 구멍 -> 고리 관 -> 다섯 팔의 관
    S.drops.forEach((sp, i) => {
      sp.visible = P.water > 0.01;
      if (!sp.visible) return;
      const u = ((t * 0.42 + i / S.drops.length) % 1), k = i % 5;
      const a0 = Math.atan2(-MADRE.z, MADRE.x), a1 = ARM_ANG[k];
      let p;
      if (u < 0.15) { const f = u / 0.15; p = V(MADRE.x, lerp(0.16, 0.03, f), MADRE.z); }
      else if (u < 0.45) { const f = (u - 0.15) / 0.3, da = ((a1 - a0) % TAU + TAU) % TAU, ang = a0 + da * f; p = V(0.17 * Math.cos(ang), 0.03, -0.17 * Math.sin(ang)); }
      else { const f = (u - 0.45) / 0.55, r = lerp(0.17, 0.84, f); p = V(r * Math.cos(a1), 0.03, -r * Math.sin(a1)); }
      sp.position.copy(p); sp.scale.setScalar(0.075 + 0.015 * Math.sin(t * 8 + i)); sp.material.opacity = P.water;
    });
  }
}
function idle(P, t, seed) {
  P.arms.forEach((a, k) => { a.curl += 0.07 * Math.sin(t * 1.3 + k * 1.2 + seed); a.yaw += 0.05 * Math.sin(t * 0.9 + k * 2.1 + seed); });
}
const starA = makeStar({ canals: true });
const starB = makeStar();

// ------------------------------------------------------------------ 조개 + 위
const CLAM_POS = V(0.25, FLOOR_Y + 0.12, 0.1);
const clam = new THREE.Group(); scene.add(clam);
const clamHinge = new THREE.Group();
{
  const shellTex = canvasTex(256, 128, (g, w, h) => {
    g.fillStyle = '#ece2f4'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 18; i++) { g.fillStyle = i % 2 ? 'rgba(150,115,190,0.45)' : 'rgba(255,255,255,0.45)'; g.fillRect(i * w / 18, 0, w / 36, h); }
    for (let j = 0; j < 5; j++) { g.fillStyle = 'rgba(120,85,160,0.28)'; g.fillRect(0, j * h / 5 + 10, w, 3); }
  });
  const shellMat = addCaustics(new THREE.MeshStandardMaterial({ map: shellTex, roughness: 0.45, side: THREE.DoubleSide }), 0.4);
  const half = () => new THREE.SphereGeometry(0.3, 36, 12, 0, TAU, 0, Math.PI / 2);
  const bottom = new THREE.Mesh(half(), shellMat); bottom.rotation.x = Math.PI; bottom.scale.set(1.25, 0.45, 1); bottom.castShadow = true; clam.add(bottom);
  clamHinge.position.set(0, 0, -0.3); clam.add(clamHinge);
  const top = new THREE.Mesh(half(), shellMat); top.scale.set(1.25, 0.45, 1); top.position.set(0, 0, 0.3); top.castShadow = true; clamHinge.add(top);
  const flesh = new THREE.Mesh(new THREE.SphereGeometry(0.24, 24, 12), new THREE.MeshStandardMaterial({ color: '#ffd7ca', roughness: 0.4, emissive: '#ff9f8f', emissiveIntensity: 0.15 }));
  flesh.scale.set(1.15, 0.2, 0.85); clam.add(flesh);
  clam.position.copy(CLAM_POS);
}
const stomachMat = new THREE.MeshPhysicalMaterial({ color: '#ff9fbd', roughness: 0.3, transparent: true, opacity: 0.92, emissive: '#ff5f8f', emissiveIntensity: 0.35, clearcoat: 1 });
const stNeck = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 1, 20, 1, true), stomachMat);
const stBulb = new THREE.Mesh(new THREE.SphereGeometry(1, 28, 18), stomachMat);
scene.add(stNeck, stBulb);

// ------------------------------------------------------------------ 물고기 떼 (아웃트로)
const school = [];
{
  const cols = ['#ffd23f', '#4fc3ff', '#ff6f9c', '#8be36b'];
  for (let i = 0; i < 12; i++) {
    const g = new THREE.Group();
    const b = new THREE.Mesh(new THREE.SphereGeometry(0.12, 16, 10), new THREE.MeshStandardMaterial({ color: cols[i % 4], roughness: 0.45 })); b.scale.set(1.6, 1, 0.55); g.add(b);
    const tl = new THREE.Mesh(new THREE.ConeGeometry(0.09, 0.14, 4), b.material); tl.rotation.z = Math.PI / 2; tl.position.x = -0.23; tl.scale.set(1, 1, 0.35); g.add(tl);
    const e = new THREE.Mesh(new THREE.SphereGeometry(0.025, 8, 6), new THREE.MeshBasicMaterial({ color: '#111' })); e.position.set(0.13, 0.03, 0.06); g.add(e);
    scene.add(g); school.push({ g, tl });
  }
}

const PROP = {};
function buildProps(font) {
  const qg = new TextGeometry('?', { font, size: 1.0, depth: 0.32, curveSegments: 10, bevelEnabled: true, bevelThickness: 0.08, bevelSize: 0.025, bevelSegments: 3 });
  qg.center();
  PROP.q = new THREE.Mesh(qg, new THREE.MeshPhysicalMaterial({ color: '#ffd23f', roughness: 0.22, clearcoat: 1, emissive: '#7a5200', emissiveIntensity: 0.35 }));
  scene.add(PROP.q);
}

// ------------------------------------------------------------------ 포즈
const bump1 = (x) => Math.sin(Math.PI * clamp(x));
function scenePose(t, C) {
  const A = starParams(), B = starParams();
  B.visible = false;
  const S = { A, B, clamVis: false, clamOpen: 0, stomach: 0 };
  idle(A, t, 0); idle(B, t, 2.0);
  if (t < 3.6) {                                             // 훅: 어둠 속에서 팔 끝 눈이 하나씩 켜짐
    A.eyes.forEach((e) => { e.glow = 0.05; e.size = 0.6; });
    C.HOOK_EYES.forEach((te, i) => {
      const k = SCREEN_ORDER[i], o = prog(t, te, te + 0.22);
      if (o <= 0) return;
      const e = A.eyes[k];
      e.glow = 2.4; e.halo = 0.95; e.size = lerp(0.6, 1.35, easeBack(o, 2.6));
      A.arms[k].curl += 0.35 * bump1(prog(t, te, te + 0.4));
    });
    const bl = bump1(prog(t, 2.55, 2.75));
    A.eyes.forEach((e) => { e.blink = 1 - 0.92 * bl; });
  } else if (t < 10.2) {                                     // 사실 1: 정답 + 다섯 눈
    A.eyes.forEach((e) => { e.glow = 0.7; e.halo = 0.15; e.size = 1.1; });
    const hp = prog(t, C.HELLO[0], C.HELLO[1]);
    A.y += 0.6 * bump1(hp); A.yaw = TAU / 5 * easeIO(hp);
    A.arms.forEach((a) => { a.curl += 0.55 * bump1(hp); });
    const relax = 1 - easeIO(prog(t, 9.25, 9.65));
    C.EYES.forEach((te, i) => {
      const k = (SCREEN_ORDER[i] + 4) % 5;                   // 한 바퀴(72도) 돈 뒤라 팔 번호가 하나씩 밀림
      const o = prog(t, te, te + 0.3);
      if (o <= 0) return;
      A.arms[k].curl += 1.0 * easeBack(o, 2.0) * relax;
      const e = A.eyes[k];
      e.glow = lerp(0.7, 2.2, relax); e.halo = 0.75 * relax; e.size = lerp(1.1, 1.45 + 0.35 * bump1(prog(t, te, te + 0.35)), relax);
    });
    const bl = bump1(prog(t, C.BLINK, C.BLINK + 0.22));
    A.eyes.forEach((e) => { e.blink = 1 - 0.92 * bl; });
  } else if (t < 16.6) {                                     // 사실 2: 팔이 다시 자람 + 팔 하나가 새 불가사리로
    A.x = -0.12; A.z = -0.6; A.yaw = Math.PI;
    const off = C.ARM_OFF;
    if (t < off) A.arms[0].yaw += 0.14 * Math.sin(TAU * 4.5 * t) * prog(t, off - 0.5, off);
    if (t >= off) {
      A.arms[0].len = lerp(STUMP, 1, easeOut(prog(t, C.REGROW[0], C.REGROW[1])));
      B.visible = true;
      const mv = easeOut(prog(t, off, off + 0.7));
      B.x = lerp(A.x, 0.62, mv); B.z = lerp(A.z + STUMP * ARM_L, 0.72, mv); B.yaw = Math.PI + 0.65 * mv;
      B.dome = 0;
      B.arms.forEach((a, j) => { a.len = 0; a.wid = 0.62; });
      B.arms[0].len = 1 - STUMP; B.arms[0].wid = 1 - 0.7 * STUMP;
      const [b0] = C.BABY;
      B.dome = 0.62 * easeBack(prog(t, b0, b0 + 0.5), 2.0);
      for (let j = 1; j < 5; j++) B.arms[j].len = 0.5 * easeOut(prog(t, b0 + 0.3 + 0.22 * (j - 1), b0 + 1.3 + 0.22 * (j - 1)));
      B.eyes.forEach((e) => { e.glow = 0.7; e.size = 1.0; });
    }
    const hop = bump1(prog(t, C.BABY_HOP, C.BABY_HOP + 0.45));
    A.y += 0.32 * hop; B.y += 0.4 * bump1(prog(t, C.BABY_HOP + 0.08, C.BABY_HOP + 0.5));
    [A, B].forEach((P) => P.arms.forEach((a) => { a.curl += 0.4 * hop; }));
  } else if (t < 22.6) {                                     // 사실 3: 바닷물 + 관족
    const [g0, g1] = C.GLASS;
    A.glass = smooth(g0, g0 + 0.4, t) * (1 - smooth(g1 - 0.15, g1 + 0.1, t));
    A.water = smooth(g0 + 0.2, g0 + 0.6, t) * (1 - smooth(g1 - 0.15, g1 + 0.1, t));
    A.arms.forEach((a, k) => { a.curl *= 0.4; a.yaw *= 0.4; });
    const fp = easeIO(prog(t, C.FLIP[0], C.FLIP[1]));
    A.flip = Math.PI * fp; A.y += 0.55 * bump1(fp) + 0.1 * fp;
    A.feet = smooth(C.FEET[0], C.FEET[0] + 0.3, t);
    A.arms.forEach((a, k) => { a.curl += fp * (-0.22 - 0.14 * Math.sin(t * 3 + k * 1.3)); });
  } else if (t < 27.6) {                                     // 사실 4: 위를 꺼내서 먹기
    S.clamVis = true;
    const wk = easeIO(prog(t, C.WALK[0], C.WALK[1]));
    A.x = lerp(-1.75, CLAM_POS.x, wk); A.z = CLAM_POS.z - 0.04; A.yaw = 0;
    const walking = bump1(prog(t, C.WALK[0] - 0.1, C.WALK[1] + 0.1));
    A.arms.forEach((a, k) => { a.yaw += 0.16 * walking * Math.sin(t * 8 + k * 1.3); a.curl += 0.12 * walking * Math.sin(t * 8 + k * 1.3 + 1.2); });
    const hg = easeIO(prog(t, C.HUG[0], C.HUG[1]));
    const climb = Math.max(hg, smooth(C.WALK[0] + 0.35, C.WALK[1], t));      // 다가가며 조개 위로 올라탐
    A.y = STAR_Y + 0.36 * climb;
    A.arms.forEach((a) => { a.lift += 0.35 * hg; a.curl = lerp(a.curl, -2.3, hg); });
    S.clamOpen = 0.45 * easeOut(prog(t, C.OPEN[0], C.OPEN[1]));
    S.stomach = easeOut(prog(t, C.STOMACH[0], C.STOMACH[0] + 0.7)) * (1 - easeIO(prog(t, C.STOMACH[1] - 0.35, C.STOMACH[1])));
    const yum = prog(t, C.YUM[0], C.YUM[1] + 0.45);
    if (yum > 0 && yum < 1) A.dome = 1 + 0.06 * Math.sin(yum * TAU * 3);
    A.feet = 0.3 * walking;
  } else {                                                   // 아웃트로
    A.x = -0.22; A.z = -0.3; A.yaw = 0.2;
    B.visible = true; B.x = 0.68; B.z = 0.5; B.yaw = 0.55; B.dome = 0.62;
    B.arms.forEach((a) => { a.len = 0.55; a.wid = 0.66; });
    const w = smooth(C.WAVE[0], C.WAVE[0] + 0.3, t);
    A.arms[4].curl += w * (0.9 + 0.45 * Math.sin(t * 9)); A.arms[4].lift += 0.3 * w;
    B.arms[1].curl += w * (0.9 + 0.45 * Math.sin(t * 9 + 1.5)); B.arms[1].lift += 0.3 * w;
    const hop = bump1(prog(t, 27.75, 28.2));
    A.y += 0.3 * hop; B.y += 0.35 * bump1(prog(t, 27.85, 28.3));
    [A, B].forEach((P) => P.eyes.forEach((e) => { e.glow = 0.9; e.halo = 0.2; }));
  }
  return S;
}

// ------------------------------------------------------------------ 프레임 렌더
const armDirW = (S, k) => V(1, 0, 0).applyQuaternion(S.arms[k].g.getWorldQuaternion(new THREE.Quaternion()));
window.renderFrame = (St, opts = {}) => {
  const t = St.t, C = St.cues;
  causticTime.value = t;
  const night = t < 3.6;
  const mode = night ? 'night' : 'ocean';
  scene.background = BG[mode].bg; scene.fog = BG[mode].fog;
  causticAmt.value = night ? 0.15 : 1;
  hemi.intensity = night ? 0.2 : 1.15; key.intensity = night ? 0.28 : 2.3; rim.intensity = night ? 0.6 : 1.2;
  rays.forEach((r) => { r.m.visible = !night; r.m.position.set(r.x + 0.5 * Math.sin(t * 0.35 + r.ph), 11, r.z); r.m.rotation.set(0, 0, 0.3 + 0.04 * Math.sin(t * 0.3 + r.ph)); });
  for (const b of bubbles) { b.sp.position.set(b.x + 0.15 * Math.sin(t * 1.7 + b.off), FLOOR_Y + ((t * b.v + b.off) % 10), b.z); b.sp.scale.setScalar(b.s); b.sp.material.opacity = night ? 0.3 : 0.7; }
  const mp = moteGeo.attributes.position.array;
  for (let i = 0; i < MOTE; i++) {
    mp[i * 3] = (rnd(i, 11) - 0.5) * 16 + 0.3 * Math.sin(t * 0.4 + i);
    mp[i * 3 + 1] = FLOOR_Y + ((((rnd(i, 12) * 9 + t * (0.04 + 0.06 * rnd(i, 13))) % 9) + 9) % 9);
    mp[i * 3 + 2] = -10 + rnd(i, 14) * 12;
  }
  moteGeo.attributes.position.needsUpdate = true;
  moteMat.opacity = night ? 0.35 : 0.6;

  const SP = scenePose(t, C);
  poseStar(starA, SP.A, t); poseStar(starB, SP.B, t);
  footMat.emissiveIntensity = 0.55 * SP.A.feet * (0.5 + 0.5 * Math.sin(t * 6)) * (t >= 16.6 && t < 22.6 ? 1 : 0);
  clam.visible = SP.clamVis; clamHinge.rotation.x = -SP.clamOpen;
  scene.updateMatrixWorld(true);
  setCamera(t, C);
  const anchors = {};
  anchors.star = project(starA.root.position.clone().add(V(0, 0.15, 0)));
  starA.arms.forEach((A, k) => { if (A.g.visible) anchors['eye' + k] = project(A.eye.getWorldPosition(V(0, 0, 0))); });
  if (starB.root.visible) anchors.baby = project(starB.root.position.clone().add(V(0, 0.1, 0)));
  if (t >= 10.2 && t < 16.6) anchors.cut = project(starA.root.position.clone().addScaledVector(armDirW(starA, 0), STUMP * ARM_L));
  anchors.madre = project(starA.madre.getWorldPosition(V(0, 0, 0)));
  // 위
  const sk = SP.stomach;
  stNeck.visible = stBulb.visible = sk > 0.01;
  if (sk > 0.01) {
    const top = starA.root.localToWorld(V(0, -0.04, 0));
    const tgt = clam.localToWorld(V(0, 0.05, 0.27));
    const bulbP = top.clone().lerp(tgt, 0.35 + 0.65 * sk);
    const d = bulbP.clone().sub(top), len = d.length();
    stNeck.position.copy(top).addScaledVector(d, 0.5); stNeck.quaternion.setFromUnitVectors(UP, d.normalize());
    const r = 0.06 * sk + 0.008 * Math.sin(t * 7);
    stNeck.scale.set(r, len, r);
    const wob = 1 + 0.12 * Math.sin(t * 6.5);
    stBulb.position.copy(bulbP); stBulb.scale.set(0.15 * sk * wob, 0.095 * sk / wob, 0.13 * sk * wob);
    anchors.stomach = project(bulbP);
  }
  if (clam.visible) anchors.clam = project(clam.localToWorld(V(0, 0.05, 0.25)));
  // 물고기 떼
  school.forEach((f, i) => {
    const show = t >= C.FISH[0];
    f.g.visible = show;
    if (!show) return;
    const a = easeOut(prog(t, C.FISH[0] + i * 0.04, C.FISH[1] + i * 0.04));
    const ang = i / 12 * TAU + t * 0.5;
    f.g.position.set(lerp(6, 0.2 + 1.9 * Math.cos(ang), a), 0.9 + 0.55 * Math.sin(ang * 1.3) + 0.2 * (i % 3), -0.6 + 0.6 * Math.sin(ang));
    f.g.rotation.set(0, ang + Math.PI / 2, 0); f.tl.rotation.y = 0.5 * Math.sin(t * 12 + i);
  });
  // 물음표 (훅)
  if (PROP.q) {
    const qa = prog(t, 1.8, 2.2), qo = prog(t, 3.37, 3.55);
    const qs = (0.4 + 0.6 * easeBack(qa, 2.2)) * Math.min(1, qa * 2.5) * (1 - qo);
    PROP.q.visible = t >= 1.8 && t < 3.55 && qs > 0.01;
    if (PROP.q.visible) {
      const p = screenToWorld(540, 830 + 12 * Math.sin(t * 4), 4.0);
      PROP.q.position.copy(p); PROP.q.scale.setScalar(qs * 150 / (0.72 * pxPerUnitAt(p)));
      PROP.q.quaternion.copy(camera.quaternion); PROP.q.rotateY(Math.sin(t * 2.2) * 0.6); PROP.q.rotateZ(0.14 * Math.sin(t * 3.1));
    }
  }
  renderer.render(scene, camera);
  const img = renderer.domElement.toDataURL(opts.png ? 'image/png' : 'image/jpeg', 0.95);
  return { img, anchors };
};

new FontLoader().load('/three/examples/fonts/helvetiker_bold.typeface.json', (font) => {
  buildProps(font);
  window.ready = true;
}, undefined, (e) => { window.loadError = String(e); });
