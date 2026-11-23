// 해파리 쇼츠 3D 장면 (three.js). 프레임 시각 t 와 연출 큐(cues)를 받아 한 장씩 렌더링한다.
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
renderer.toneMappingExposure = 1.0;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = canvasTex(8, 512, (g, w, h) => {
  const gr = g.createLinearGradient(0, 0, 0, h);
  gr.addColorStop(0, '#2b74b8'); gr.addColorStop(0.35, '#164a8a'); gr.addColorStop(0.75, '#0a2457'); gr.addColorStop(1, '#050f2e');
  g.fillStyle = gr; g.fillRect(0, 0, w, h);
});
scene.fog = new THREE.Fog(new THREE.Color('#0f3168'), 14, 34);

const camera = new THREE.PerspectiveCamera(30, W / H, 0.1, 200);
const CAM = { y: 0.75, z: 12, lookY: 1.07 };
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
scene.add(new THREE.HemisphereLight(0x9fd8ff, 0x0a1a3a, 0.9));
const topLight = new THREE.DirectionalLight(0xcfe9ff, 1.4); topLight.position.set(-2, 10, 6); scene.add(topLight);
const jellyLight = new THREE.PointLight(0xff8ad8, 0, 9, 1.6);
scene.add(jellyLight);

// ------------------------------------------------------------------ 텍스처
const glowTex = canvasTex(128, 128, (g, w, h) => {
  const gr = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
  gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.3, 'rgba(255,255,255,0.45)');
  gr.addColorStop(0.65, 'rgba(255,255,255,0.12)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, w, h);
});
const nerveTex = canvasTex(512, 256, (g, w, h) => {
  g.fillStyle = '#000'; g.fillRect(0, 0, w, h);
  g.strokeStyle = '#8ff7ff'; g.shadowColor = '#8ff7ff'; g.shadowBlur = 6; g.lineWidth = 2.2;
  const r = mulberry32(3);
  for (let i = 0; i < 24; i++) { const x = (i + 0.5) / 24 * w; g.beginPath(); g.moveTo(x, h * 0.02); g.lineTo(x + (r() - 0.5) * 10, h * 0.98); g.stroke(); }
  for (const v of [0.18, 0.4, 0.62, 0.85]) { g.beginPath(); g.moveTo(0, v * h); for (let x = 0; x <= w; x += 8) g.lineTo(x, v * h + 4 * Math.sin(x * 0.05)); g.stroke(); }
  for (let i = 0; i < 70; i++) {
    const x = r() * w, y = r() * h;
    g.beginPath(); g.moveTo(x, y); g.lineTo(x + (r() - 0.5) * 50, y + (r() - 0.5) * 40); g.stroke();
    g.fillStyle = '#d4fdff'; g.beginPath(); g.arc(x, y, 2.5, 0, TAU); g.fill();
  }
});
nerveTex.wrapS = THREE.RepeatWrapping;

// ------------------------------------------------------------------ 해파리
const BELL_PROFILE = new THREE.SplineCurve([[0.001, 1.0], [0.3, 0.98], [0.55, 0.9], [0.75, 0.76], [0.9, 0.56], [0.99, 0.33],
  [1.04, 0.12], [1.05, 0.02], [1.0, -0.03], [0.93, -0.02]].map(([x, y]) => new THREE.Vector2(x, y))).getPoints(70);
const bellR = (y) => {
  let best = 0;
  for (let i = 0; i < BELL_PROFILE.length - 1; i++) {
    const a = BELL_PROFILE[i], b = BELL_PROFILE[i + 1];
    if ((y <= a.y && y >= b.y) || (y >= a.y && y <= b.y)) best = Math.max(best, lerp(a.x, b.x, (y - a.y) / ((b.y - a.y) || 1e-6)));
  }
  return best;
};
const BELL_GEO = new THREE.LatheGeometry(BELL_PROFILE, 96);
const INNER_GEO = new THREE.LatheGeometry(BELL_PROFILE.map((p) => new THREE.Vector2(p.x * 0.78, p.y * 0.8 + 0.08)), 64);

function makeRimMat(color, opacity = 0.42) {
  const mat = new THREE.MeshPhysicalMaterial({
    color, transparent: true, opacity, roughness: 0.15, clearcoat: 1, clearcoatRoughness: 0.1,
    side: THREE.DoubleSide, depthWrite: false, emissive: '#ffffff', emissiveMap: nerveTex, emissiveIntensity: 0 });
  const U = { uRim: { value: new THREE.Color(color) }, uRimStrength: { value: 1.0 }, uRimPow: { value: 2.2 } };
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, U);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec3 uRim;\nuniform float uRimStrength;\nuniform float uRimPow;')
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        float fres = pow(1.0 - abs(dot(normal, normalize(vViewPosition))), uRimPow);
        totalEmissiveRadiance += uRim * fres * uRimStrength;
        diffuseColor.a = clamp(diffuseColor.a + fres * 0.45 * min(uRimStrength, 1.0), 0.0, 1.0);`);
  };
  mat.customProgramCacheKey = () => 'jellyrim';
  mat.userData.U = U;
  return mat;
}

const TENT_N = 30, TENT_M = 4, TENT_COUNT = 20, ARM_N = 40;
function makeJelly(scale, withFace) {
  const root = new THREE.Group(); scene.add(root);
  const bell = new THREE.Group(); root.add(bell);
  const color = new THREE.Color('#e9a8ff');
  const mat = makeRimMat(color);
  const bellMesh = new THREE.Mesh(BELL_GEO, mat); bellMesh.renderOrder = 2; bell.add(bellMesh);
  const innerMat = makeRimMat(new THREE.Color('#ffc2f0'), 0.22);
  const inner = new THREE.Mesh(INNER_GEO, innerMat); inner.renderOrder = 1; bell.add(inner);
  // 생식소 (네잎 모양)
  const gonMat = new THREE.MeshStandardMaterial({ color: '#ff7fbf', emissive: '#ff5fae', emissiveIntensity: 0.6, roughness: 0.4 });
  const gonads = [];
  for (let k = 0; k < 4; k++) {
    const g = new THREE.Mesh(new THREE.TorusGeometry(0.17, 0.045, 10, 30, Math.PI * 1.5), gonMat);
    const a = k * Math.PI / 2 + Math.PI / 4;
    g.position.set(Math.cos(a) * 0.3, 0.62, Math.sin(a) * 0.3);
    g.rotation.set(Math.PI / 2, 0, a + Math.PI * 0.75);
    bell.add(g); gonads.push(g);
  }
  // 얼굴
  const face = { eyes: [], closed: [] };
  if (withFace) {
    const dark = new THREE.MeshPhysicalMaterial({ color: '#1d1438', roughness: 0.15, clearcoat: 1 });
    const shine = new THREE.MeshBasicMaterial({ color: '#ffffff' });
    const fy = 0.44, rr = bellR(fy);
    const at = (x, y, off = 0) => { const r = bellR(y); const z = Math.sqrt(Math.max(r * r - x * x, 0.01)); const n = V(x, 0.25, z).normalize(); return { p: V(x, y, z).addScaledVector(n, off), n }; };
    for (const s of [-1, 1]) {
      const g = new THREE.Group();
      const ball = new THREE.Mesh(new THREE.SphereGeometry(0.085, 24, 16), dark);
      const h1 = new THREE.Mesh(new THREE.SphereGeometry(0.026, 10, 8), shine); h1.position.set(-0.03, 0.035, 0.07);
      const h2 = new THREE.Mesh(new THREE.SphereGeometry(0.013, 8, 6), shine); h2.position.set(0.03, -0.025, 0.075);
      g.add(ball, h1, h2);
      const { p, n } = at(s * 0.28, fy, 0.01); g.position.copy(p); g.quaternion.setFromUnitVectors(ZAXIS, n);
      bell.add(g); face.eyes.push(g);
      const c = new THREE.Mesh(new THREE.TorusGeometry(0.07, 0.022, 8, 24, Math.PI), dark);
      const cg = new THREE.Group(); cg.add(c); cg.position.copy(at(s * 0.28, fy, 0.03).p); cg.quaternion.setFromUnitVectors(ZAXIS, n);
      bell.add(cg); face.closed.push(cg);
      const blush = new THREE.Mesh(new THREE.CircleGeometry(0.09, 20), new THREE.MeshBasicMaterial({ color: '#ff6fa8', transparent: true, opacity: 0.55, depthWrite: false }));
      const b = at(s * 0.46, fy - 0.12, 0.02); blush.position.copy(b.p); blush.quaternion.setFromUnitVectors(ZAXIS, b.n); blush.scale.set(1.3, 0.8, 1);
      bell.add(blush);
    }
    const smile = new THREE.Mesh(new THREE.TorusGeometry(0.08, 0.02, 8, 24, 2.2), dark);
    const sg = new THREE.Group(); sg.add(smile); smile.rotation.z = -(Math.PI / 2 + 1.1);
    const sm = at(0, fy - 0.1, 0.02); sg.position.copy(sm.p); sg.quaternion.setFromUnitVectors(ZAXIS, sm.n);
    bell.add(sg);
    void rr;
  }
  // 입팔 (주름 리본 4개)
  const armMat = new THREE.MeshPhysicalMaterial({ color: '#ffc6ee', transparent: true, opacity: 0.55, roughness: 0.3, side: THREE.DoubleSide, depthWrite: false, emissive: '#ff9fd8', emissiveIntensity: 0.25 });
  const arms = [];
  for (let k = 0; k < 4; k++) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array((ARM_N + 1) * 2 * 3), 3));
    const idx = []; for (let i = 0; i < ARM_N; i++) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    geo.setIndex(idx);
    const m = new THREE.Mesh(geo, armMat); m.frustumCulled = false; m.renderOrder = 1; root.add(m); arms.push(m);
  }
  // 촉수
  const tentGeo = new THREE.BufferGeometry();
  const tv = TENT_COUNT * (TENT_N + 1) * (TENT_M + 1);
  tentGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(tv * 3), 3));
  const tidx = [];
  for (let c = 0; c < TENT_COUNT; c++) {
    const base = c * (TENT_N + 1) * (TENT_M + 1);
    for (let k = 0; k < TENT_N; k++) for (let a = 0; a < TENT_M; a++) {
      const v0 = base + k * (TENT_M + 1) + a, v1 = v0 + 1, v2 = v0 + TENT_M + 1, v3 = v2 + 1;
      tidx.push(v0, v2, v1, v1, v2, v3);
    }
  }
  tentGeo.setIndex(tidx);
  const tentMat = new THREE.MeshBasicMaterial({ color: '#ffd8f6', transparent: true, opacity: 0.75, depthWrite: false, side: THREE.DoubleSide });
  const tents = new THREE.Mesh(tentGeo, tentMat); tents.frustumCulled = false; root.add(tents);
  // 후광
  const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false }));
  halo.position.y = 0.5; halo.scale.setScalar(4.2); root.add(halo);
  root.scale.setScalar(scale);
  return { root, bell, mat, innerMat, gonMat, armMat, arms, tents, tentMat, halo, face, color, scale };
}

function pulseCurve(t, period, off) {
  const ph = ((t + off) % period) / period;
  return ph < 0.3 ? Math.sin(Math.PI / 2 * ph / 0.3) : Math.cos(Math.PI / 2 * (ph - 0.3) / 0.7);
}

function updateJelly(j, P, t) {
  j.root.visible = P.visible && P.scale > 0.005;
  if (!j.root.visible) return;
  const c = pulseCurve(t, P.period, P.off);
  j.root.position.set(P.x, P.y + 0.05 * c, P.z || 0);
  j.root.scale.setScalar(P.scale);
  j.root.rotation.set(0.28, 0.15 * Math.sin(t * 0.4 + P.off), 0.05 * Math.sin(t * 0.7 + P.off));
  const sx = 1 - 0.12 * c, sy = 1 + 0.08 * c;
  j.bell.scale.set(sx, sy, sx);
  const col = P.color;
  j.mat.color.copy(col); j.mat.userData.U.uRim.value.copy(col).lerp(new THREE.Color('#ffffff'), 0.25);
  j.mat.userData.U.uRimStrength.value = 0.35 + 1.25 * P.glow;
  j.mat.opacity = 0.18 + 0.27 * P.alpha;
  j.mat.emissiveIntensity = P.nerve * 1.4;
  nerveTex.offset.x = t * 0.03;
  j.innerMat.opacity = 0.08 + 0.16 * P.alpha;
  j.innerMat.userData.U.uRimStrength.value = 0.3 + 0.7 * P.glow;
  j.gonMat.emissiveIntensity = 0.05 + 0.75 * P.glow;
  j.gonMat.color.set('#ff7fbf').lerp(new THREE.Color('#2e2b55'), 1 - clamp((P.alpha - 0.15) / 0.85));
  j.armMat.opacity = 0.2 + 0.4 * P.alpha;
  j.tentMat.opacity = 0.12 + 0.63 * P.alpha;
  j.tentMat.color.set('#ffd8f6').lerp(col, 0.25);
  j.halo.material.color.copy(col);
  j.halo.material.opacity = 0.6 * P.glow;
  if (j.face.eyes.length) {
    const happy = P.happy;
    j.face.eyes.forEach((e) => { e.visible = !happy; e.scale.set(1, P.blink, 1); });
    j.face.closed.forEach((e) => { e.visible = happy; });
  }
  // 입팔
  j.arms.forEach((m, k) => {
    const p = m.geometry.attributes.position.array;
    const a0 = k * Math.PI / 2 + Math.PI / 4 + 0.2;
    const ox = Math.cos(a0) * 0.12, oz = Math.sin(a0) * 0.12;
    for (let i = 0; i <= ARM_N; i++) {
      const s = i / ARM_N;
      const x = ox * (1 + s * 1.5) + 0.14 * Math.sin(TAU * (0.45 * t - 0.9 * s) + k * 1.7) * s;
      const z = oz * (1 + s * 1.5) + 0.1 * Math.cos(TAU * (0.4 * t - 0.8 * s) + k) * s;
      const y = 0.05 - s * 1.55 * (1 + 0.05 * c);
      const w = 0.16 * (1 - 0.6 * s) * (1 + 0.35 * Math.sin(s * 34 + k));
      const sxv = -Math.sin(a0) * w, szv = Math.cos(a0) * w;
      p[i * 6] = x + sxv; p[i * 6 + 1] = y; p[i * 6 + 2] = z + szv;
      p[i * 6 + 3] = x - sxv; p[i * 6 + 4] = y; p[i * 6 + 5] = z - szv;
    }
    m.geometry.attributes.position.needsUpdate = true;
    m.geometry.computeVertexNormals();
  });
  // 촉수
  const tp = j.tents.geometry.attributes.position.array;
  let vi = 0;
  for (let ci = 0; ci < TENT_COUNT; ci++) {
    const a = ci / TENT_COUNT * TAU;
    const bx = Math.cos(a) * 0.97 * sx, bz = Math.sin(a) * 0.97 * sx;
    const L = 2.3 + 0.4 * rnd(ci, 3);
    const ph = rnd(ci, 7) * TAU;
    for (let k = 0; k <= TENT_N; k++) {
      const s = k / TENT_N;
      const cx = bx * (1 + 0.12 * s) + 0.2 * Math.sin(TAU * (0.5 * t - 1.2 * s) + ph) * s;
      const cz = bz * (1 + 0.12 * s) + 0.2 * Math.cos(TAU * (0.45 * t - 1.1 * s) + ph) * s;
      const cy = 0.02 - s * L * (1 - 0.06 * c);
      const r = 0.016 * (1 - 0.7 * s) + 0.004;
      for (let m = 0; m <= TENT_M; m++) {
        const ang = m / TENT_M * TAU;
        tp[vi++] = cx + Math.cos(ang) * r; tp[vi++] = cy; tp[vi++] = cz + Math.sin(ang) * r;
      }
    }
  }
  j.tents.geometry.attributes.position.needsUpdate = true;
}

const mainJ = makeJelly(1.0, true);
const babies = [makeJelly(1.0, true), makeJelly(1.0, true)];

// ------------------------------------------------------------------ 배경: 눈 같은 입자, 빛줄기, 먼 해파리
const dotTex = canvasTex(32, 32, (g) => {
  const gr = g.createRadialGradient(16, 16, 0, 16, 16, 16);
  gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 32, 32);
});
const SNOW = 700;
const snowGeo = new THREE.BufferGeometry();
snowGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(SNOW * 3), 3));
scene.add(new THREE.Points(snowGeo, new THREE.PointsMaterial({ size: 0.06, map: dotTex, transparent: true, opacity: 0.7, depthWrite: false, color: '#cfefff' })));
function updateSnow(t, camDy) {
  const p = snowGeo.attributes.position.array;
  for (let i = 0; i < SNOW; i++) {
    p[i * 3] = (rnd(i, 1) - 0.5) * 18 + 0.3 * Math.sin(t * 0.3 + i);
    p[i * 3 + 1] = 9 - ((rnd(i, 2) * 14 + t * (0.08 + 0.12 * rnd(i, 3))) % 14) + camDy * 0.7;
    p[i * 3 + 2] = -14 + rnd(i, 4) * 20;
  }
  snowGeo.attributes.position.needsUpdate = true;
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
const rays = [];
for (let i = 0; i < 7; i++) {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(1.4 + rnd(i, 21) * 1.2, 26),
    new THREE.MeshBasicMaterial({ map: rayTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false, opacity: 0.08, color: '#a8ddff' }));
  scene.add(m);
  rays.push({ m, x: -8 + i * 2.6 + rnd(i, 22), z: -6 - rnd(i, 23) * 8, ph: i * 1.7 });
}
const farGlows = [];
for (let i = 0; i < 9; i++) {
  const col = i % 3 === 0 ? '#7fe3ff' : (i % 3 === 1 ? '#ff9ad9' : '#c9a6ff');
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: col, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, fog: false }));
  scene.add(sp);
  farGlows.push({ sp, x: (rnd(i, 31) - 0.5) * 16, y: -3 + rnd(i, 32) * 11, z: -12 - rnd(i, 33) * 10, s: 0.8 + rnd(i, 34) * 1.4, ph: rnd(i, 35) * TAU });
}
function updateBackground(t, camDy) {
  for (const r of rays) {
    r.m.position.set(r.x + 0.5 * Math.sin(t * 0.3 + r.ph), 12 + camDy, r.z);
    r.m.rotation.set(0, 0, 0.25 + 0.04 * Math.sin(t * 0.25 + r.ph));
    r.m.material.opacity = 0.06 + 0.03 * Math.sin(t * 0.7 + r.ph * 2);
  }
  for (const g of farGlows) {
    g.sp.position.set(g.x + 0.4 * Math.sin(t * 0.2 + g.ph), g.y + 0.5 * Math.sin(t * 0.35 + g.ph) + camDy * 0.5, g.z);
    g.sp.scale.setScalar(g.s * (0.85 + 0.15 * Math.sin(t * 1.3 + g.ph)));
    g.sp.material.opacity = 0.35 + 0.15 * Math.sin(t * 1.1 + g.ph);
  }
}

// ------------------------------------------------------------------ 바위 + 폴립
const ROCK_TOP = V(0, -2.48, 0.25);
{
  const g = new THREE.IcosahedronGeometry(1, 4);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const v = V(p.getX(i), p.getY(i), p.getZ(i));
    v.multiplyScalar(1 + 0.12 * Math.sin(v.x * 3.1) * Math.sin(v.y * 2.7 + 1) + 0.06 * Math.sin(v.z * 6.3));
    p.setXYZ(i, v.x * 1.6, v.y * 0.75, v.z * 1.2);
  }
  g.computeVertexNormals();
  const rock = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: '#5f6274', roughness: 0.9 }));
  rock.position.set(0, -3.2, 0.25);
  scene.add(rock);
  for (let k = 0; k < 6; k++) {
    const c = new THREE.Mesh(new THREE.SphereGeometry(0.12 + rnd(k, 2) * 0.1, 12, 10), new THREE.MeshStandardMaterial({ color: k % 2 ? '#ff8a9a' : '#ffb26b', roughness: 0.6 }));
    c.position.set(-1.2 + k * 0.5, -2.62 + 0.1 * rnd(k, 3), 0.9 - rnd(k, 4) * 0.8);
    scene.add(c);
  }
}
const polyp = new THREE.Group();
{
  const pm = new THREE.MeshPhysicalMaterial({ color: '#ff8fa3', roughness: 0.35, clearcoat: 0.6, emissive: '#ff4f7a', emissiveIntensity: 0.25 });
  const stalk = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.07, 0.5, 14), pm); stalk.position.y = 0.25;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.11, 18, 14), pm); head.position.y = 0.55; head.scale.set(1, 0.8, 1);
  polyp.add(stalk, head);
  for (let k = 0; k < 10; k++) {
    const a = k / 10 * TAU;
    const tnt = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.014, 0.2, 6), pm);
    const dir = V(Math.cos(a) * 0.8, 0.6, Math.sin(a) * 0.8).normalize();
    tnt.quaternion.setFromUnitVectors(UP, dir);
    tnt.position.set(0, 0.58, 0).addScaledVector(dir, 0.12);
    polyp.add(tnt);
  }
  polyp.position.copy(ROCK_TOP);
  scene.add(polyp);
}
const POLYP_HEAD = ROCK_TOP.clone().add(V(0, 0.58, 0));

// ------------------------------------------------------------------ 소품
const PROP = {};
const glossy = (c, extra = {}) => new THREE.MeshPhysicalMaterial(Object.assign({ color: c, roughness: 0.22, clearcoat: 1, clearcoatRoughness: 0.08 }, extra));
function heartGeometry() {
  const s = new THREE.Shape();
  for (let k = 0; k <= 120; k++) {
    const th = TAU * k / 120;
    const x = 16 * Math.pow(Math.sin(th), 3) / 32;
    const y = (13 * Math.cos(th) - 5 * Math.cos(2 * th) - 2 * Math.cos(3 * th) - Math.cos(4 * th) + 2.5) / 32;
    if (k === 0) s.moveTo(x, y); else s.lineTo(x, y);
  }
  const g = new THREE.ExtrudeGeometry(s, { depth: 0.24, bevelEnabled: true, bevelThickness: 0.1, bevelSize: 0.06, bevelSegments: 6 });
  g.translate(0, 0, -0.12); g.computeVertexNormals();
  return g;
}
function dropGeometry() {
  const pts = [];
  for (let k = 0; k <= 20; k++) { const a = -Math.PI / 2 + (Math.PI / 2 + Math.PI / 6) * k / 20; pts.push(new THREE.Vector2(Math.cos(a), Math.sin(a))); }
  for (let k = 1; k <= 12; k++) { const f = k / 12; pts.push(new THREE.Vector2(lerp(Math.cos(Math.PI / 6), 0.0, f) + 0.02 * Math.sin(Math.PI * f), lerp(0.5, 2.0, f))); }
  pts[pts.length - 1].x = 0.001;
  return new THREE.LatheGeometry(pts, 48);
}

function buildProps(font) {
  const qg = new TextGeometry('?', { font, size: 1.0, depth: 0.32, curveSegments: 10, bevelEnabled: true, bevelThickness: 0.08, bevelSize: 0.025, bevelSegments: 3 });
  qg.center();
  PROP.q = new THREE.Mesh(qg, glossy('#ffd23f', { emissive: '#8a5c00', emissiveIntensity: 0.35 }));
  scene.add(PROP.q);
  // 뇌
  const bg = new THREE.SphereGeometry(0.5, 64, 40);
  const bp = bg.attributes.position;
  for (let i = 0; i < bp.count; i++) {
    const v = V(bp.getX(i), bp.getY(i), bp.getZ(i)).normalize();
    let r = 0.5 * (1 + 0.05 * Math.sin(v.x * 22 + v.y * 9) * Math.sin(v.z * 19 + v.y * 7) + 0.03 * Math.sin(v.y * 31));
    r *= 1 - 0.14 * Math.exp(-Math.pow(v.x / 0.07, 2)) * smooth(-0.3, 0.3, v.y);
    bp.setXYZ(i, v.x * r * 1.12, v.y * r * 0.88, v.z * r);
  }
  bg.computeVertexNormals();
  const brain = new THREE.Mesh(bg, glossy('#ffa9c0', { roughness: 0.4, sheen: 0.6, sheenColor: new THREE.Color('#ffd0dc'), emissive: '#ff6f96', emissiveIntensity: 0.35 }));
  const heart = new THREE.Mesh(heartGeometry(), glossy('#ff3557', { emissive: '#c4102e', emissiveIntensity: 0.45 }));
  const bone = new THREE.Group();
  const boneMat = glossy('#fffaf0', { roughness: 0.45, emissive: '#d9cfb8', emissiveIntensity: 0.45 });
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.11, 0.85, 20), boneMat); shaft.rotation.z = Math.PI / 2; bone.add(shaft);
  for (const sx of [-0.45, 0.45]) for (const sy of [-0.1, 0.1]) {
    const k = new THREE.Mesh(new THREE.SphereGeometry(0.15, 20, 14), boneMat); k.position.set(sx, sy, 0); bone.add(k);
  }
  bone.rotation.z = 0.5;
  PROP.icons = [brain, heart, bone].map((m) => { const g = new THREE.Group(); g.add(m); scene.add(g); return g; });
  // 물방울
  PROP.drop = new THREE.Mesh(dropGeometry(), makeRimMat(new THREE.Color('#79d8ff'), 0.6));
  PROP.drop.material.userData.U.uRimStrength.value = 1.4;
  PROP.drop.material.emissiveMap = null; PROP.drop.material.emissive.set('#3aa8e8'); PROP.drop.material.emissiveIntensity = 0.6;
  scene.add(PROP.drop);
}

function updateProps(t, C, anchors) {
  const qa = prog(t, 0.9, 1.35), qo = prog(t, 3.37, 3.55);
  const qs = (0.4 + 0.6 * easeBack(qa, 2.2)) * Math.min(1, qa * 2.5) * (1 - qo);
  PROP.q.visible = t >= 0.9 && t < 3.55 && qs > 0.01;
  if (PROP.q.visible) {
    const p = screenToWorld(540, 780 + 12 * Math.sin(t * 4));
    PROP.q.position.copy(p);
    PROP.q.scale.setScalar(qs * 140 / (0.72 * pxPerUnitAt(p)));
    PROP.q.rotation.set(0.05, Math.sin(t * 2.2) * 0.6, 0.14 * Math.sin(t * 3.1));
  }
  const xs = [290, 540, 790];
  PROP.icons.forEach((g, i) => {
    const a = prog(t, C.ICONS[i], C.ICONS[i] + 0.35), o = prog(t, C.ICONS_OUT[0] + i * 0.06, C.ICONS_OUT[1] + i * 0.06);
    const s = easeBack(a, 2.2) * (1 - easeIn(o));
    g.visible = t >= C.ICONS[i] && s > 0.01;
    if (!g.visible) return;
    const p = screenToWorld(xs[i], 860 - 40 * easeIn(o));
    g.position.copy(p);
    g.scale.setScalar(s * 150 / pxPerUnitAt(p));
    g.rotation.set(0.15, 0.5 * Math.sin(t * 1.4 + i), 0);
  });
  const da = prog(t, C.DROP[0], C.DROP[0] + 0.45), dO = prog(t, C.DROP[1] - 0.2, C.DROP[1]);
  const ds = easeBack(da, 2.0) * (1 - easeIn(dO));
  PROP.drop.visible = t >= C.DROP[0] && t < C.DROP[1] && ds > 0.01;
  if (PROP.drop.visible) {
    const p = screenToWorld(370, 880 + 10 * Math.sin(t * 2));
    PROP.drop.position.copy(p);
    PROP.drop.scale.setScalar(ds * 72 / pxPerUnitAt(p));
    PROP.drop.rotation.set(0, t * 0.6, 0.08 * Math.sin(t * 1.6));
  }
  // 폴립
  const pg = easeBack(prog(t, C.POLYP[0], C.POLYP[1]), 1.8) * (1 - easeIn(prog(t, 22.45, 22.6)));
  polyp.visible = pg > 0.01;
  polyp.scale.setScalar(Math.max(pg, 0.001));
  polyp.rotation.z = 0.06 * Math.sin(t * 1.5);
  if (polyp.visible) anchors.polyp = project(POLYP_HEAD);
}

// ------------------------------------------------------------------ 포즈
const LILAC = new THREE.Color('#e9a8ff'), RED = new THREE.Color('#ff6b81');
function blinkAt(t, off) { const bt = (t + off) % 3.4; return bt < 0.14 ? Math.max(0.1, 1 - Math.sin(Math.PI * bt / 0.14)) : 1; }

function poses(t, C) {
  const red = smooth(C.RED[0], C.RED[0] + 0.5, t) * (1 - smooth(C.RED[1] - 0.3, C.RED[1], t));
  const reveal = smooth(C.REVEAL, C.REVEAL + 0.5, t);
  const color = LILAC.clone().lerp(RED, red).lerp(new THREE.Color('#33406e'), 0.75 * (1 - reveal));
  const burst = Math.exp(-Math.max(0, t - C.REVEAL) / 0.35) * (t >= C.REVEAL ? 1 : 0);
  const glow = lerp(0.0, 1, reveal) + 0.8 * burst;
  const nerve = smooth(C.NERVE[0], C.NERVE[0] + 0.5, t) * (1 - smooth(C.NERVE[1] - 0.4, C.NERVE[1], t)) * (0.75 + 0.25 * Math.sin(t * 5));
  const happy = (t >= C.REVEAL + 0.05 && t < C.REVEAL + 1.4) || t >= 27.7 || (t >= C.REGROW[1] && t < 22.6);
  const M = { visible: true, x: 0, y: 0.0 + 0.12 * Math.sin(t * 0.6), z: 0, scale: 1, period: 1.7, off: 0, color, glow, alpha: lerp(0.15, 1, reveal),
    nerve, happy, blink: blinkAt(t, 0.4) };
  // 사실 3: 작아져서 폴립으로 -> 아기로 다시 나와 자람
  const sh = easeIO(prog(t, C.SHRINK[0], C.SHRINK[1]));
  if (t >= C.SHRINK[0] && t < C.BUDS[0]) {
    M.scale = lerp(1, 0.16, sh);
    M.x = 0; M.y = lerp(M.y, POLYP_HEAD.y - 0.05, sh);
    M.visible = t < C.SHRINK[1];
    M.alpha *= 1 - smooth(0.75, 1, sh);
    M.glow *= 1 - 0.6 * sh;
  } else if (t >= C.BUDS[0] && t < C.REGROW[1]) {
    const rise = easeOut(prog(t, C.BUDS[0], C.REGROW[0]));
    const grow = easeIO(prog(t, C.REGROW[0], C.REGROW[1]));
    const sy = lerp(POLYP_HEAD.y + 0.15, -1.05, rise);
    M.scale = lerp(lerp(0.12, 0.3, rise), 1, grow);
    M.y = lerp(sy, 0.0 + 0.12 * Math.sin(t * 0.6), grow);
    M.period = lerp(1.0, 1.7, grow);
  }
  // 아기 해파리 2마리
  const B = [0, 1].map((i) => {
    const t0 = C.BUDS[i + 1];
    const side = i === 0 ? -1 : 1;
    const rise = easeOut(prog(t, t0, t0 + 1.6));
    let x = lerp(0, side * 1.45, rise), y = lerp(POLYP_HEAD.y + 0.15, i === 0 ? -0.75 : -0.45, rise);
    const fr = easeIO(prog(t, C.FRIENDS[0], C.FRIENDS[1]));
    x = lerp(x, side * 1.35, fr); y = lerp(y, i === 0 ? 0.95 : 0.55, fr);
    return { visible: t >= t0, x, y: y + 0.1 * Math.sin(t * 0.9 + i), z: 0.3, scale: lerp(0.12, 0.3, rise), period: 1.0 + 0.15 * i, off: i * 0.4,
      color, glow: 0.9, alpha: 1, nerve: 0, happy: t >= 27.7, blink: blinkAt(t, 1.3 + i) };
  });
  return { M, B };
}

// ------------------------------------------------------------------ 프레임 렌더
window.renderFrame = (S, opts = {}) => {
  const t = S.t, C = S.cues;
  const cd = C.CAM_DOWN;
  const camDy = -1.7 * easeIO(prog(t, cd[0], cd[1])) * (1 - easeIO(prog(t, cd[2], cd[3])));
  setCamera(camDy);
  const { M, B } = poses(t, C);
  updateJelly(mainJ, M, t);
  B.forEach((p, i) => updateJelly(babies[i], p, t));
  jellyLight.position.set(M.x, M.y + 0.6 * M.scale, 0.8);
  jellyLight.color.copy(M.color);
  jellyLight.intensity = M.visible ? 6 * M.glow * M.scale : 0;
  updateSnow(t, camDy);
  updateBackground(t, camDy);
  const anchors = {};
  updateProps(t, C, anchors);
  if (mainJ.root.visible) anchors.jelly = project(V(M.x, M.y + 0.5 * M.scale, 0));
  anchors.babies = B.filter((p) => p.visible).map((p) => project(V(p.x, p.y + 0.15, p.z)));
  renderer.render(scene, camera);
  const img = renderer.domElement.toDataURL(opts.png ? 'image/png' : 'image/jpeg', 0.95);
  return { img, anchors };
};

new FontLoader().load('/three/examples/fonts/helvetiker_bold.typeface.json', (font) => {
  buildProps(font);
  window.ready = true;
}, undefined, (e) => { window.loadError = String(e); });
