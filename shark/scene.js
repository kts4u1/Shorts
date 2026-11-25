// 상어 쇼츠 3D 장면 (three.js). 프레임 시각 t 와 연출 큐(cues)를 받아 한 장씩 렌더링한다.
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
  base: { pos: V(0, 0.85, 10.8), look: V(0, 0.55, 0) },
  close: { pos: V(0.3, 0.05, 4.3), look: V(0.27, -0.05, 1.1) },
  xray: { pos: V(0, 0.7, 9.8), look: V(0, 0.4, 0) },
  elec: { pos: V(0, 0.35, 10.2), look: V(0, -0.05, 0) },
};
function setCamera(t, C, mouthW) {
  let a = CAMS.base, b = CAMS.base, k = 0;
  if (t < 10.2) {
    const [c0, c1, c2, c3] = C.CLOSE;
    b = { pos: mouthW.clone().add(V(0.6, -0.35, 2.8)), look: mouthW.clone().add(V(-0.05, 0.05, 0)) };
    k = easeIO(prog(t, c0, c1)) * (1 - easeIO(prog(t, c2, c3)));
  } else if (t < 16.6) { a = CAMS.xray; b = CAMS.xray; }
  else if (t < 22.6) { a = CAMS.elec; b = CAMS.elec; }
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
  xray: { bg: grad([[0, '#14325a'], [0.5, '#0a1e3e'], [1, '#040b1d']]), fog: new THREE.Fog(new THREE.Color('#0a1e3e'), 10, 28) },
  ice: { bg: grad([[0, '#8fc6d4'], [0.3, '#3d7d93'], [1, '#0d2a38']]), fog: new THREE.Fog(new THREE.Color('#2f6478'), 10, 30) },
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

// 얼음 바다 소품
const iceGroup = new THREE.Group(); scene.add(iceGroup);
{
  const iceMat = new THREE.MeshPhysicalMaterial({ color: '#e8fbff', roughness: 0.15, clearcoat: 1, transparent: true, opacity: 0.85, emissive: '#9fdcef', emissiveIntensity: 0.25 });
  for (let k = 0; k < 14; k++) {
    const g = new THREE.DodecahedronGeometry(1, 0);
    const m = new THREE.Mesh(g, iceMat);
    m.position.set(-7 + k * 1.1 + rnd(k, 1) * 0.6, 4.2 + rnd(k, 2) * 0.6, -3 - rnd(k, 3) * 6);
    m.scale.set(0.7 + rnd(k, 4) * 0.8, 0.35 + rnd(k, 5) * 0.3, 0.6 + rnd(k, 6) * 0.6);
    m.rotation.set(rnd(k, 7), rnd(k, 8) * 3, rnd(k, 9) * 0.4);
    iceGroup.add(m);
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
const MOTE = 450;
const moteGeo = new THREE.BufferGeometry(); moteGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(MOTE * 3), 3));
const moteMat = new THREE.PointsMaterial({ size: 0.05, map: dotTex, transparent: true, opacity: 0.6, depthWrite: false });
scene.add(new THREE.Points(moteGeo, moteMat));

// ------------------------------------------------------------------ 상어
const SN = 64, SR = 24;
const RKEYS = [[0, 0.05], [0.08, 0.08], [0.25, 0.22], [0.5, 0.35], [0.7, 0.33], [0.85, 0.25], [0.94, 0.15], [1.0, 0.015]];
const radAt = (s) => { for (let i = 0; i < RKEYS.length - 1; i++) if (s <= RKEYS[i + 1][0]) return lerp(RKEYS[i][1], RKEYS[i + 1][1], (s - RKEYS[i][0]) / (RKEYS[i + 1][0] - RKEYS[i][0])); return 0.015; };
const xAt = (s) => -1.6 + 3.1 * s;
const TOP = new THREE.Color('#5f86a8'), BELLY = new THREE.Color('#f2f6fa');
const ICE_TOP = new THREE.Color('#6d6a5f'), ICE_BELLY = new THREE.Color('#b5ae9e');

const shark = (() => {
  const root = new THREE.Group(); scene.add(root);
  const geo = new THREE.BufferGeometry();
  const nv = (SN + 1) * (SR + 1);
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(nv * 3), 3));
  geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(nv * 3), 3));
  const uv = new Float32Array(nv * 2);
  for (let k = 0; k <= SN; k++) for (let a = 0; a <= SR; a++) { const j = k * (SR + 1) + a; uv[j * 2] = a / SR; uv[j * 2 + 1] = k / SN; }
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  const idx = [];
  for (let k = 0; k < SN; k++) for (let a = 0; a < SR; a++) { const v0 = k * (SR + 1) + a, v1 = v0 + 1, v2 = v0 + SR + 1, v3 = v2 + 1; idx.push(v0, v2, v1, v1, v2, v3); }
  geo.setIndex(idx);
  const skin = addCaustics(new THREE.MeshPhysicalMaterial({ vertexColors: true, roughness: 0.42, clearcoat: 0.7, clearcoatRoughness: 0.25, sheen: 0.3, sheenColor: new THREE.Color('#dff4ff') }), 0.3);
  const body = new THREE.Mesh(geo, skin); body.castShadow = true; body.frustumCulled = false; root.add(body);
  const finMat = addCaustics(new THREE.MeshPhysicalMaterial({ color: TOP.clone(), roughness: 0.45, clearcoat: 0.6 }), 0.3);
  const mkFin = (pts, depth) => {
    const sh = new THREE.Shape(); sh.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) sh.lineTo(pts[i][0], pts[i][1]);
    const g = new THREE.ExtrudeGeometry(sh, { depth, bevelEnabled: true, bevelThickness: 0.015, bevelSize: 0.015, bevelSegments: 2 });
    g.translate(0, 0, -depth / 2); g.computeVertexNormals();
    const m = new THREE.Mesh(g, finMat); m.castShadow = true; return m;
  };
  const dorsal = mkFin([[0.2, 0], [-0.16, 0], [-0.22, 0.04], [-0.04, 0.44], [0.04, 0.4]], 0.04);
  const pecs = [1, -1].map(() => mkFin([[0.12, 0], [-0.1, 0], [-0.32, -0.42], [-0.2, -0.43]], 0.03));
  const tail = mkFin([[0.05, 0.03], [-0.18, 0.55], [-0.3, 0.52], [-0.12, 0.02], [-0.26, -0.32], [-0.14, -0.3], [0.05, -0.03]], 0.03);
  const fins = new THREE.Group(); root.add(fins);
  const dorsalG = new THREE.Group(); dorsalG.add(dorsal); fins.add(dorsalG);
  const pecG = pecs.map((p, i) => { const g = new THREE.Group(); g.add(p); p.rotation.x = i === 0 ? -0.55 : 0.55; p.scale.z = 1; fins.add(g); return g; });
  const tailG = new THREE.Group(); tailG.add(tail); fins.add(tailG);
  // 얼굴
  const dark = new THREE.MeshPhysicalMaterial({ color: '#141026', roughness: 0.15, clearcoat: 1 });
  const shine = new THREE.MeshBasicMaterial({ color: '#ffffff' });
  const white = new THREE.MeshPhysicalMaterial({ color: '#ffffff', roughness: 0.12, clearcoat: 1 });
  const head = new THREE.Group(); root.add(head);
  const eyes = [], closed = [];
  for (const sz of [1, -1]) {
    const g = new THREE.Group(); head.add(g);
    g.add(new THREE.Mesh(new THREE.SphereGeometry(0.075, 20, 14), white));
    const pu = new THREE.Mesh(new THREE.SphereGeometry(0.05, 16, 12), dark); pu.position.z = 0.055; pu.scale.set(1, 1, 0.55); g.add(pu);
    const h1 = new THREE.Mesh(new THREE.SphereGeometry(0.017, 8, 6), shine); h1.position.set(0.016, 0.02, 0.084); g.add(h1);
    eyes.push({ g, sz });
    const c = new THREE.Mesh(new THREE.TorusGeometry(0.055, 0.016, 8, 20, Math.PI), dark);
    const cg = new THREE.Group(); cg.add(c); head.add(cg); closed.push({ g: cg, sz });
  }
  const smile = new THREE.Mesh(new THREE.TorusGeometry(0.14, 0.018, 8, 24, 2.0), dark);
  const smileG = new THREE.Group(); smileG.add(smile); smile.rotation.z = -(Math.PI / 2 + 1.0); head.add(smileG);
  // 벌린 입 + 이빨
  const mouthG = new THREE.Group(); head.add(mouthG);
  const inner = new THREE.Mesh(new THREE.CircleGeometry(0.17, 32, Math.PI, Math.PI), new THREE.MeshStandardMaterial({ color: '#7a1f35', roughness: 0.6, side: THREE.DoubleSide }));
  mouthG.add(inner);
  const toothMat = new THREE.MeshPhysicalMaterial({ color: '#ffffff', roughness: 0.2, clearcoat: 1, emissive: '#ffffff', emissiveIntensity: 0.25 });
  const toothGeo = new THREE.ConeGeometry(0.03, 0.09, 10);
  const teeth = [];
  for (const up of [1, -1]) for (let row = 0; row < 3; row++) for (let i = 0; i < 7; i++) {
    const m = new THREE.Mesh(toothGeo, toothMat); mouthG.add(m); teeth.push({ m, up, row, i });
  }
  const dropTooth = new THREE.Mesh(toothGeo, toothMat); scene.add(dropTooth);
  // 아가미
  const gills = [];
  for (const sz of [1, -1]) for (let k = 0; k < 5; k++) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.16, 0.012), new THREE.MeshStandardMaterial({ color: '#3d5a74', roughness: 0.6 }));
    root.add(m); gills.push({ m, sz, k });
  }
  // 로렌치니 기관
  const ampMat = new THREE.MeshStandardMaterial({ color: '#4d6a86', emissive: '#ffe066', emissiveIntensity: 0 });
  const amps = [];
  for (let k = 0; k < 28; k++) { const m = new THREE.Mesh(new THREE.SphereGeometry(0.009, 8, 6), ampMat); root.add(m); amps.push({ m, s: 0.9 + rnd(k, 1) * 0.085, ang: -1.9 + rnd(k, 2) * 2.6, sz: k % 2 ? 1 : -1 }); }
  // 엑스레이 골격
  const boneMat = new THREE.MeshBasicMaterial({ color: '#dffbff', transparent: true, opacity: 0.95 });
  const skel = new THREE.Group(); root.add(skel);
  const verts = [];
  for (let k = 0; k < 34; k++) { const m = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.055, 12), boneMat); m.rotation.z = Math.PI / 2; skel.add(m); verts.push(m); }
  const skull = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 16), boneMat); skull.scale.set(0.22, 0.12, 0.15); skel.add(skull);
  const jawU = new THREE.Mesh(new THREE.TorusGeometry(0.13, 0.02, 8, 24, Math.PI), boneMat); skel.add(jawU);
  const jawL = new THREE.Mesh(new THREE.TorusGeometry(0.12, 0.02, 8, 24, Math.PI), boneMat); skel.add(jawL);
  const girdle = new THREE.Mesh(new THREE.TorusGeometry(0.24, 0.018, 8, 24, Math.PI), boneMat); skel.add(girdle);
  const rays = [];
  for (let k = 0; k < 14; k++) { const m = new THREE.Mesh(new THREE.CylinderGeometry(0.013, 0.013, 1, 6), boneMat); skel.add(m); rays.push(m); }
  const xrayMat = new THREE.MeshPhysicalMaterial({ color: '#7fe6ff', transparent: true, opacity: 0.22, roughness: 0.2, depthWrite: false, emissive: '#1d6f8f', emissiveIntensity: 0.6, side: THREE.DoubleSide });
  return { root, body, geo, skin, finMat, xrayMat, dorsalG, pecG, tailG, head, eyes, closed, smileG, mouthG, inner, teeth, dropTooth, gills, amps, ampMat, skel, verts, skull, jawU, jawL, girdle, rays };
})();

// 상어 몸의 중심선 (헤엄칠 때 좌우로 휨)
function centerZ(s, t, P) { return P.amp * Math.pow(1 - s, 1.7) * Math.sin(TAU * P.freq * t - 3.2 * (1 - s)); }
function slopeZ(s, t, P) { const e = 0.01; return (centerZ(s + e, t, P) - centerZ(s - e, t, P)) / (3.1 * 2 * e); }

function updateShark(P, t) {
  const S = shark;
  S.root.visible = P.visible;
  if (!P.visible) return;
  S.root.position.set(P.x, P.y, P.z);
  S.root.rotation.set(P.roll || 0, P.yaw, P.pitch || 0);
  S.root.scale.setScalar(P.scale);
  const top = TOP.clone().lerp(ICE_TOP, P.ice), belly = BELLY.clone().lerp(ICE_BELLY, P.ice);
  const pos = S.geo.attributes.position.array, col = S.geo.attributes.color.array;
  for (let k = 0; k <= SN; k++) {
    const s = k / SN, x = xAt(s), r = radAt(s), zc = centerZ(s, t, P);
    const yc = -0.02 * smooth(0.8, 1.0, s);
    for (let a = 0; a <= SR; a++) {
      const ang = a / SR * TAU;
      const cy = Math.sin(ang), cz = Math.cos(ang);
      const j = (k * (SR + 1) + a) * 3;
      pos[j] = x; pos[j + 1] = yc + cy * r * (cy < 0 ? 0.92 : 1.0); pos[j + 2] = zc + cz * r * 0.82;
      const u = smooth(-0.35, 0.15, cy + 0.08 * Math.sin(x * 9));
      const c = belly.clone().lerp(top, u);
      col[j] = c.r; col[j + 1] = c.g; col[j + 2] = c.b;
    }
  }
  S.geo.attributes.position.needsUpdate = true; S.geo.attributes.color.needsUpdate = true;
  S.geo.computeVertexNormals();
  S.finMat.color.copy(top);
  // 지느러미
  const place = (g, s, y, z, extraYaw = 0) => { g.position.set(xAt(s), y, centerZ(s, t, P) + z); g.rotation.set(0, -Math.atan(slopeZ(s, t, P)) + extraYaw, 0); };
  place(S.dorsalG, 0.56, radAt(0.56) - 0.03, 0);
  S.pecG.forEach((g, i) => { const sz = i === 0 ? 1 : -1; place(g, 0.7, -0.12, sz * radAt(0.7) * 0.7); g.rotation.x = 0; g.children[0].rotation.set(sz * -0.6 - 0.1 * Math.sin(t * 2), 0, 0.15 * Math.sin(t * 1.7 + i)); });
  place(S.tailG, 0.02, 0, 0);
  // 머리(눈/입)
  const sH = 0.88, zH = centerZ(sH, t, P);
  S.head.position.set(0, 0, zH); S.head.rotation.set(0, -Math.atan(slopeZ(sH, t, P)), 0);
  S.eyes.forEach((e) => {
    e.g.position.set(1.1, 0.07, e.sz * radAt(0.875) * 0.8); e.g.quaternion.setFromUnitVectors(ZAXIS, V(0.35, 0.15, e.sz).normalize());
    e.g.visible = !P.happy; e.g.scale.set(1, P.blink, 1);
  });
  S.closed.forEach((c) => { c.g.position.set(1.1, 0.08, c.sz * (radAt(0.875) * 0.8 + 0.03)); c.g.rotation.set(0, c.sz > 0 ? 0.35 : Math.PI - 0.35, 0); c.g.visible = !!P.happy; });
  const open = P.mouth || 0;
  S.smileG.visible = open < 0.15;
  S.smileG.position.set(1.33, -0.07, 0); S.smileG.rotation.set(0, Math.PI / 2, 0); S.smileG.scale.setScalar(0.75);
  S.mouthG.visible = open >= 0.15;
  S.mouthG.position.set(1.27, -0.17, 0); S.mouthG.quaternion.setFromEuler(new THREE.Euler(0, Math.PI / 2, -0.75, 'ZYX'));
  S.inner.scale.set(1.15, 0.2 + 0.85 * open, 1);
  const conv = P.conv || 0;
  for (const th of S.teeth) {
    const p = th.row - (conv % 1);
    const vis = p > -0.25;
    th.m.visible = vis;
    if (!vis) continue;
    const u = th.i / 6 * 2 - 1;                 // -1..1 (입 가로)
    const back = Math.max(p, 0);
    let x, y;
    if (th.up > 0) { x = u * 0.17 * (1 - 0.12 * back); y = -0.012 - 0.0 * back; }      // 위턱: 일자
    else { const a = Math.PI + (u + 1) / 2 * Math.PI; x = Math.cos(a) * 0.17 * 1.15 * (1 - 0.15 * back); y = Math.sin(a) * 0.17 * (0.2 + 0.85 * open) * (1 - 0.15 * back) + 0.02; }
    th.m.position.set(x, y, -0.015 - 0.035 * back);
    const tilt = clamp(p, 0, 2) * 0.6;
    th.m.rotation.set(th.up > 0 ? Math.PI - tilt : tilt, 0, th.up > 0 ? 0 : -Math.atan2(x, -y + 0.02) * 0.6);
    th.m.scale.setScalar((p < 0 ? 1 + p * 2 : 1) * (1 - 0.18 * back));
  }
  // 아가미, 로렌치니
  for (const g of S.gills) { const s = 0.72 + g.k * 0.018; g.m.position.set(xAt(s), 0.0, centerZ(s, t, P) + g.sz * radAt(s) * 0.8); g.m.rotation.set(g.sz * 0.2, 0, 0.15); }
  for (const a of S.amps) { const r = radAt(a.s); a.m.position.set(xAt(a.s), -0.02 + Math.sin(a.ang) * r * 0.9, centerZ(a.s, t, P) + a.sz * Math.abs(Math.cos(a.ang)) * r * 0.85); }
  S.ampMat.emissiveIntensity = P.amp_glow || 0;
  // 엑스레이
  const xr = P.xray || 0;
  S.body.material = xr > 0.5 ? S.xrayMat : S.skin;
  S.dorsalG.children[0].material = S.pecG[0].children[0].material = S.pecG[1].children[0].material = S.tailG.children[0].material = xr > 0.5 ? S.xrayMat : S.finMat;
  S.skel.visible = xr > 0.5;
  S.eyes.forEach((e) => { e.g.visible = e.g.visible && xr <= 0.5; });
  if (S.skel.visible) {
    S.verts.forEach((m, k) => { const s = 0.06 + k / 33 * 0.78; m.position.set(xAt(s), 0.02, centerZ(s, t, P)); m.scale.set(1, 1, 1).multiplyScalar(0.6 + radAt(s) * 1.6); });
    S.skull.position.set(xAt(0.91), 0.02, centerZ(0.91, t, P));
    S.jawU.position.set(xAt(0.95), -0.06, centerZ(0.95, t, P)); S.jawU.rotation.set(Math.PI / 2, 0, -Math.PI / 2);
    S.jawL.position.set(xAt(0.94), -0.1, centerZ(0.94, t, P)); S.jawL.rotation.set(Math.PI / 2, 0, -Math.PI / 2);
    S.girdle.position.set(xAt(0.7), -0.1, centerZ(0.7, t, P)); S.girdle.rotation.set(0, Math.PI / 2, Math.PI);
    S.rays.forEach((m, k) => {
      let base, tip;
      if (k < 5) { const s = 0.53 + k * 0.012; base = V(xAt(s), radAt(s) - 0.02, centerZ(s, t, P)); tip = V(xAt(0.52) - 0.04 + k * 0.03, radAt(0.56) + 0.36 - k * 0.02, centerZ(0.56, t, P)); }
      else if (k < 10) { const j = k - 5; base = V(xAt(0.02), 0, centerZ(0.02, t, P)); tip = V(xAt(0.02) - 0.12 - j * 0.03, 0.5 - j * 0.18, centerZ(0.0, t, P)); }
      else { const j = k - 10; const sz = j % 2 ? 1 : -1; base = V(xAt(0.7), -0.12, centerZ(0.7, t, P) + sz * 0.2); tip = base.clone().add(V(-0.18 - 0.04 * j, -0.32, sz * 0.18)); }
      const d = tip.clone().sub(base); m.position.copy(base).addScaledVector(d, 0.5); m.quaternion.setFromUnitVectors(UP, d.clone().normalize()); m.scale.set(1, d.length(), 1);
    });
  }
}

// ------------------------------------------------------------------ 넙치 + 전기 신호
const flatfish = new THREE.Group();
{
  const ffTex = canvasTex(128, 64, (g, w, h) => {
    g.fillStyle = '#c9ad7a'; g.fillRect(0, 0, w, h);
    const r = mulberry32(8); for (let i = 0; i < 60; i++) { g.fillStyle = r() > 0.5 ? 'rgba(120,90,50,0.5)' : 'rgba(240,220,180,0.5)'; g.beginPath(); g.arc(r() * w, r() * h, 2 + r() * 4, 0, TAU); g.fill(); }
  });
  const body = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 12), new THREE.MeshStandardMaterial({ map: ffTex, roughness: 0.8 }));
  body.scale.set(0.38, 0.06, 0.24); flatfish.add(body);
  const finM = new THREE.Mesh(new THREE.ConeGeometry(0.14, 0.2, 4), body.material); finM.rotation.z = Math.PI / 2; finM.position.x = -0.42; finM.scale.set(1, 1, 0.2); flatfish.add(finM);
  const white = new THREE.MeshPhysicalMaterial({ color: '#ffffff', roughness: 0.1, clearcoat: 1 }), dk = new THREE.MeshBasicMaterial({ color: '#111' });
  for (const z of [-0.06, 0.06]) { const e = new THREE.Mesh(new THREE.SphereGeometry(0.04, 12, 8), white); e.position.set(0.18, 0.05, z); flatfish.add(e); const p = new THREE.Mesh(new THREE.SphereGeometry(0.022, 8, 6), dk); p.position.set(0.2, 0.07, z); flatfish.add(p); }
  scene.add(flatfish);
}
const ringTex = canvasTex(128, 128, (g) => { g.strokeStyle = 'rgba(255,240,120,1)'; g.lineWidth = 8; g.shadowColor = '#ffe066'; g.shadowBlur = 10; g.beginPath(); g.arc(64, 64, 52, 0, TAU); g.stroke(); });
const pulses = [0, 1, 2].map(() => { const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: ringTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending })); scene.add(s); return s; });
const FISH_HOME = V(1.25, FLOOR_Y + 0.02, 0.7);

// 물고기 떼 (아웃트로)
const school = [];
{
  const cols = ['#ffd23f', '#ff8a3d', '#4fc3ff', '#ff6f9c'];
  for (let i = 0; i < 12; i++) {
    const g = new THREE.Group();
    const b = new THREE.Mesh(new THREE.SphereGeometry(0.12, 16, 10), new THREE.MeshStandardMaterial({ color: cols[i % 4], roughness: 0.45 })); b.scale.set(1.6, 1, 0.55); g.add(b);
    const tl = new THREE.Mesh(new THREE.ConeGeometry(0.09, 0.14, 4), b.material); tl.rotation.z = Math.PI / 2; tl.position.x = -0.23; tl.scale.set(1, 1, 0.35); g.add(tl);
    const e = new THREE.Mesh(new THREE.SphereGeometry(0.025, 8, 6), new THREE.MeshBasicMaterial({ color: '#111' })); e.position.set(0.13, 0.03, 0.06); g.add(e);
    scene.add(g); school.push({ g, tl });
  }
}

// 이빨 비 (훅)
const rain = [];
{
  const tm = new THREE.MeshPhysicalMaterial({ color: '#ffffff', roughness: 0.2, clearcoat: 1, emissive: '#bfefff', emissiveIntensity: 0.2 });
  const tg = new THREE.ConeGeometry(0.06, 0.18, 10);
  for (let i = 0; i < 26; i++) { const m = new THREE.Mesh(tg, tm); scene.add(m); rain.push(m); }
}

const PROP = {};
function buildProps(font) {
  const qg = new TextGeometry('?', { font, size: 1.0, depth: 0.32, curveSegments: 10, bevelEnabled: true, bevelThickness: 0.08, bevelSize: 0.025, bevelSegments: 3 });
  qg.center();
  PROP.q = new THREE.Mesh(qg, new THREE.MeshPhysicalMaterial({ color: '#ffd23f', roughness: 0.22, clearcoat: 1, emissive: '#7a5200', emissiveIntensity: 0.2 }));
  scene.add(PROP.q);
}

// ------------------------------------------------------------------ 포즈
function blinkAt(t, off) { const bt = (t + off) % 3.4; return bt < 0.14 ? Math.max(0.1, 1 - Math.sin(Math.PI * bt / 0.14)) : 1; }
function sharkPose(t, C) {
  const P = { visible: true, x: 0, y: -0.15, z: 0, yaw: -0.55, pitch: 0, roll: 0, scale: 0.85, amp: 0.13, freq: 0.9, ice: 0, happy: false, blink: blinkAt(t, 0.3), mouth: 0, conv: 0, xray: 0, amp_glow: 0 };
  // 등장
  if (t < C.DASH[0]) P.visible = false;
  const d = easeOut(prog(t, C.DASH[0], C.DASH[1]));
  P.x = lerp(-6.5, 0, d); P.yaw = lerp(0, -0.55, d);
  if (t < C.DASH[1] + 0.3) { P.amp = 0.22; P.freq = 2.2; }
  if (t >= C.DASH[1] && t < C.DASH[1] + 1.2) P.happy = true;
  // 입 클로즈업
  const [c0, c1, c2, c3] = C.CLOSE;
  const cl = easeIO(prog(t, c0, c1)) * (1 - easeIO(prog(t, c2, c3)));
  P.yaw = lerp(P.yaw, -1.05, cl); P.y = lerp(P.y, -0.1, cl); P.amp = lerp(P.amp, 0.04, cl);
  P.mouth = easeOut(prog(t, C.MOUTH[0], C.MOUTH[0] + 0.4)) * (1 - easeIO(prog(t, C.MOUTH[1] - 0.3, C.MOUTH[1])));
  P.conv = t >= C.CONVEYOR[0] ? (t - C.CONVEYOR[0]) * 0.45 : 0;
  // 엑스레이
  if (t >= 10.2 && t < 16.6) { P.yaw = -0.32; P.y = 0.05; P.xray = (t >= C.XRAY[0] && t < C.XRAY[1]) ? 1 : 0; P.amp = 0.12; }
  // 전기
  if (t >= 16.6 && t < 22.6) {
    P.yaw = -0.45; P.x = -0.25; P.y = -0.3;
    P.amp_glow = smooth(C.AMPULLAE[0], C.AMPULLAE[0] + 0.3, t) * (1 - smooth(C.AMPULLAE[1] - 0.3, C.AMPULLAE[1], t)) * (0.7 + 0.3 * Math.sin(t * 10));
    const aim = smooth(19.4, 20.4, t);
    P.pitch = -0.32 * aim * (1 - smooth(C.FOUND + 0.3, C.FOUND + 1.0, t));
    P.x = lerp(-0.25, 0.05, smooth(C.FOUND - 0.5, C.FOUND, t)); P.y = lerp(-0.3, -0.55, aim) + 0.25 * smooth(C.FOUND + 0.2, C.FOUND + 1.0, t);
    if (t >= C.FOUND + 0.2) P.happy = true;
  }
  // 그린란드상어
  if (t >= 22.6 && t < 27.6) { P.ice = 1; P.scale = 0.95; P.amp = 0.08; P.freq = 0.45; P.yaw = -0.45; P.y = -0.45; }
  if (t >= 27.6) { P.happy = t >= 27.75; P.amp = 0.12; P.freq = 1.0; }
  return P;
}

// ------------------------------------------------------------------ 프레임 렌더
window.renderFrame = (S, opts = {}) => {
  const t = S.t, C = S.cues;
  causticTime.value = t;
  const mode = (t >= 10.2 && t < 16.6) ? (t >= C.XRAY[0] && t < C.XRAY[1] ? 'xray' : 'ocean') : (t >= 22.6 && t < 27.6 ? 'ice' : 'ocean');
  scene.background = BG[mode].bg; scene.fog = BG[mode].fog;
  causticAmt.value = mode === 'ocean' ? 1 : (mode === 'ice' ? 0.3 : 0.15);
  hemi.intensity = mode === 'xray' ? 0.5 : 1.15; key.intensity = mode === 'xray' ? 0.8 : (mode === 'ice' ? 1.6 : 2.3);
  iceGroup.visible = mode === 'ice';
  rays.forEach((r) => { r.m.visible = mode === 'ocean'; r.m.position.set(r.x + 0.5 * Math.sin(t * 0.35 + r.ph), 11, r.z); r.m.rotation.set(0, 0, 0.3 + 0.04 * Math.sin(t * 0.3 + r.ph)); });
  for (const b of bubbles) { b.sp.visible = mode !== 'xray'; b.sp.position.set(b.x + 0.15 * Math.sin(t * 1.7 + b.off), FLOOR_Y + ((t * b.v + b.off) % 10), b.z); b.sp.scale.setScalar(b.s); }
  const mp = moteGeo.attributes.position.array;
  for (let i = 0; i < MOTE; i++) {
    const fall = mode === 'ice' ? t * (0.15 + 0.15 * rnd(i, 13)) : -t * (0.04 + 0.06 * rnd(i, 13));
    mp[i * 3] = (rnd(i, 11) - 0.5) * 16 + 0.3 * Math.sin(t * 0.4 + i);
    mp[i * 3 + 1] = FLOOR_Y + ((((rnd(i, 12) * 9 - fall) % 9) + 9) % 9);
    mp[i * 3 + 2] = -10 + rnd(i, 14) * 12;
  }
  moteGeo.attributes.position.needsUpdate = true;
  moteMat.size = mode === 'ice' ? 0.07 : 0.05; moteMat.opacity = mode === 'xray' ? 0.25 : 0.6;
  const P = sharkPose(t, C);
  updateShark(P, t);
  shark.root.updateMatrixWorld(true);
  setCamera(t, C, shark.root.localToWorld(V(1.27, -0.17, centerZ(0.95, t, P))));
  const anchors = {};
  const toW = (x, y, z) => shark.root.localToWorld(V(x, y, z));
  anchors.mouth = project(toW(1.27, -0.17, centerZ(0.95, t, P)));
  anchors.snout = project(toW(1.4, 0.0, centerZ(0.97, t, P)));
  anchors.body = project(toW(0.1, 0.05, centerZ(0.5, t, P)));
  anchors.head = project(toW(0.9, 0.35, centerZ(0.85, t, P)));
  // 빠지는 앞니
  const dt = t - C.DROP;
  shark.dropTooth.visible = dt >= 0 && dt < 1.6 && t < 10.2;
  if (shark.dropTooth.visible) {
    const p0 = toW(1.3, -0.2, 0.02);
    shark.dropTooth.position.copy(p0).add(V(0.05 * dt, -0.9 * dt * dt - 0.1 * dt, 0.25 * dt));
    shark.dropTooth.rotation.set(dt * 7, 0, dt * 5); shark.dropTooth.scale.setScalar(1.4);
    anchors.drop = project(shark.dropTooth.position);
  }
  // 넙치 + 전기 신호
  const fy = t >= C.FOUND ? easeOut(prog(t, C.FOUND, C.FOUND + 0.4)) : 0;
  flatfish.visible = t >= 16.6 && t < 22.6;
  flatfish.position.copy(FISH_HOME).add(V(1.6 * easeIn(prog(t, C.FOUND + 0.3, C.FOUND + 1.4)), 0.25 * fy - 0.04 * (1 - fy), 0));
  flatfish.rotation.set(0, -0.4, 0.15 * fy * Math.sin(t * 20));
  pulses.forEach((sp, i) => {
    const ph = ((t - C.PULSE[0]) * 0.9 + i / 3) % 1;
    sp.visible = flatfish.visible && t >= C.PULSE[0] && t < C.PULSE[1];
    sp.position.copy(FISH_HOME).add(V(0, 0.12, 0)); sp.scale.setScalar(0.3 + 1.6 * ph); sp.material.opacity = 0.9 * (1 - ph);
  });
  if (flatfish.visible) anchors.fish = project(flatfish.position.clone().add(V(0, 0.1, 0)));
  // 물고기 떼
  school.forEach((f, i) => {
    const show = t >= C.FISH[0];
    f.g.visible = show;
    if (!show) return;
    const a = easeOut(prog(t, C.FISH[0] + i * 0.04, C.FISH[1] + i * 0.04));
    const ang = i / 12 * TAU + t * 0.5;
    f.g.position.set(lerp(6, 0.2 + 1.9 * Math.cos(ang), a), 0.9 + 0.55 * Math.sin(ang * 1.3) + 0.2 * (i % 3), 0.4 + 0.6 * Math.sin(ang));
    f.g.rotation.set(0, ang + Math.PI / 2, 0); f.tl.rotation.y = 0.5 * Math.sin(t * 12 + i);
  });
  // 이빨 비 + 물음표
  const [r0, r1] = C.TEETH_RAIN;
  rain.forEach((m, i) => {
    m.visible = t >= r0 && t < r1;
    if (!m.visible) return;
    const ph = ((t - r0) * (0.35 + 0.25 * rnd(i, 3)) + rnd(i, 4)) % 1;
    const p = screenToWorld(80 + rnd(i, 1) * 920, -100 + ph * 2100, 5 + rnd(i, 2) * 3);
    m.position.copy(p); m.rotation.set(t * (2 + rnd(i, 5) * 3), t * 1.3 + i, Math.PI + 0.4 * Math.sin(t + i));
    m.scale.setScalar(0.8 + rnd(i, 6) * 0.8);
  });
  if (PROP.q) {
    const qa = prog(t, 0.9, 1.35), qo = prog(t, 3.37, 3.55);
    const qs = (0.4 + 0.6 * easeBack(qa, 2.2)) * Math.min(1, qa * 2.5) * (1 - qo);
    PROP.q.visible = t >= 0.9 && t < 3.55 && qs > 0.01;
    if (PROP.q.visible) {
      const p = screenToWorld(540, 900 + 12 * Math.sin(t * 4), 4.0);
      PROP.q.position.copy(p); PROP.q.scale.setScalar(qs * 170 / (0.72 * pxPerUnitAt(p)));
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
