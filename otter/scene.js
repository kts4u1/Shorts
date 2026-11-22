// 해달 쇼츠 3D 장면 (three.js). 프레임 시각 t 와 연출 큐(cues)를 받아 한 장씩 렌더링한다.
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
const lerpV = (a, b, t) => a.clone().lerp(b, t);

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
scene.background = new THREE.Color('#157cc0');

// 하늘 환경맵 (수면/털/조개 반사용)
{
  const s = new THREE.Scene();
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    vertexShader: 'varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `varying vec3 vP;
      void main(){
        float h = vP.y;
        vec3 zen = vec3(0.14, 0.42, 0.86), hor = vec3(0.80, 0.93, 1.0), sea = vec3(0.03, 0.22, 0.42);
        vec3 c = h > 0.0 ? mix(hor, zen, smoothstep(0.0, 0.65, h)) : mix(hor, sea, smoothstep(0.0, -0.25, h));
        vec3 sd = normalize(vec3(-0.45, 0.72, -0.55));
        float d = max(dot(vP, sd), 0.0);
        c += vec3(1.0, 0.95, 0.85) * (pow(d, 900.0) * 30.0 + pow(d, 12.0) * 0.35);
        gl_FragColor = vec4(c, 1.0);
      }`,
  });
  s.add(new THREE.Mesh(new THREE.SphereGeometry(50, 64, 32), mat));
  const pm = new THREE.PMREMGenerator(renderer);
  scene.environment = pm.fromScene(s, 0.02).texture;
}

const camera = new THREE.PerspectiveCamera(30, W / H, 0.1, 200);
const CAM = { pos: V(0, 10.4, 8.6), look: V(0, 0, -1.85) };
camera.position.copy(CAM.pos);
camera.lookAt(CAM.look);
camera.updateMatrixWorld();

function project(v) {
  const p = v.clone().project(camera);
  return [(p.x + 1) / 2 * W, (1 - p.y) / 2 * H];
}
function pxPerUnitAt(v) {
  const a = project(v), b = project(v.clone().add(V(0.01, 0, 0)));
  return Math.hypot(b[0] - a[0], b[1] - a[1]) / 0.01;
}
const PROP_Y = 2.2;   // 소품이 떠 있는 높이 (수면 위)
function screenToWorld(px, py, y = PROP_Y) {
  const v = V(px / W * 2 - 1, -(py / H * 2 - 1), 0.5).unproject(camera);
  const dir = v.sub(camera.position).normalize();
  const tt = (y - camera.position.y) / dir.y;
  return camera.position.clone().addScaledVector(dir, tt);
}

// ------------------------------------------------------------------ lights
scene.add(new THREE.HemisphereLight(0xd6f1ff, 0x3c86b0, 0.95));
const sun = new THREE.DirectionalLight(0xfff2dc, 2.7);
sun.position.set(-5, 12, -3);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -6, right: 6, top: 6, bottom: -6, near: 1, far: 40 });
sun.shadow.bias = -0.0005;
sun.shadow.normalBias = 0.02;
sun.shadow.radius = 6;
scene.add(sun, sun.target);
const fill = new THREE.DirectionalLight(0xffe6d0, 0.6); fill.position.set(4, 6, 10); scene.add(fill);

// ------------------------------------------------------------------ 수면
const WAVES = [[0.96, 0.28, 0.055, 0.9, 1.15, 0.0], [-0.37, 0.93, 0.04, 1.55, 1.8, 1.3],
  [0.71, -0.71, 0.024, 2.7, 2.5, 2.1], [0.2, 0.98, 0.014, 4.3, 3.3, 0.7]];
function waveH(x, z, t) {
  let h = 0;
  for (const w of WAVES) h += w[2] * Math.sin((x * w[0] + z * w[1]) * w[3] - t * w[4] + w[5]);
  return h;
}
function waveSlope(x, z, t) {
  const e = 0.05;
  return [(waveH(x + e, z, t) - waveH(x - e, z, t)) / (2 * e), (waveH(x, z + e, t) - waveH(x, z - e, t)) / (2 * e)];
}
const waterNormal = (() => {
  const N = 256, hgt = new Float32Array(N * N), r = mulberry32(9);
  const comps = [];
  for (let i = 0; i < 26; i++) comps.push([1 + Math.floor(r() * 7), 1 + Math.floor(r() * 7), r() * TAU, (r() > 0.5 ? 1 : -1), 0.4 + r()]);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    let v = 0;
    for (const [a, b, ph, s, amp] of comps) v += Math.sin(TAU * (a * x + s * b * y) / N + ph) * amp / (a + b);
    hgt[y * N + x] = v;
  }
  const c = document.createElement('canvas'); c.width = c.height = N;
  const g = c.getContext('2d'); const img = g.createImageData(N, N);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const dx = hgt[y * N + (x + 1) % N] - hgt[y * N + (x - 1 + N) % N];
    const dy = hgt[((y + 1) % N) * N + x] - hgt[((y - 1 + N) % N) * N + x];
    const n = V(-dx * 2.5, -dy * 2.5, 1).normalize();
    const k = (y * N + x) * 4;
    img.data[k] = (n.x * 0.5 + 0.5) * 255; img.data[k + 1] = (n.y * 0.5 + 0.5) * 255; img.data[k + 2] = (n.z * 0.5 + 0.5) * 255; img.data[k + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(16, 16);
  return t;
})();
const water = (() => {
  const geo = new THREE.PlaneGeometry(70, 70, 170, 170);
  geo.rotateX(-Math.PI / 2);
  const mat = new THREE.MeshPhysicalMaterial({
    color: '#1386cc', roughness: 0.2, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.12,
    normalMap: waterNormal, normalScale: new THREE.Vector2(0.32, 0.32), envMapIntensity: 0.9 });
  const m = new THREE.Mesh(geo, mat);
  m.receiveShadow = true;
  scene.add(m);
  return m;
})();
function updateWater(t) {
  const p = water.geometry.attributes.position;
  for (let i = 0; i < p.count; i++) p.setY(i, waveH(p.getX(i), p.getZ(i), t));
  p.needsUpdate = true;
  water.geometry.computeVertexNormals();
  waterNormal.offset.set(t * 0.012, t * 0.007);
}

// 수면 위 거품 점
const FOAM = 160;
const foamGeo = new THREE.BufferGeometry();
foamGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(FOAM * 3), 3));
const dotTex = canvasTex(32, 32, (g) => {
  const gr = g.createRadialGradient(16, 16, 0, 16, 16, 16);
  gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 32, 32);
});
scene.add(new THREE.Points(foamGeo, new THREE.PointsMaterial({ size: 0.09, map: dotTex, transparent: true, opacity: 0.7, depthWrite: false })));
function updateFoam(t) {
  const p = foamGeo.attributes.position.array;
  for (let i = 0; i < FOAM; i++) {
    const x = (rnd(i, 1) - 0.5) * 16 + 0.25 * t * (0.3 + rnd(i, 4)) % 16;
    const z = -9 + rnd(i, 2) * 14 + 0.1 * Math.sin(t * 0.5 + i);
    p[i * 3] = x; p[i * 3 + 1] = waveH(x, z, t) + 0.02; p[i * 3 + 2] = z;
  }
  foamGeo.attributes.position.needsUpdate = true;
}

// ------------------------------------------------------------------ 재질
const furNormal = (() => {
  const N = 256, c = document.createElement('canvas'); c.width = c.height = N;
  const g = c.getContext('2d'); g.fillStyle = 'rgb(128,128,255)'; g.fillRect(0, 0, N, N);
  const r = mulberry32(21);
  for (let i = 0; i < 2600; i++) {
    const x = r() * N, y = r() * N, l = 3 + r() * 7, a = -0.4 + r() * 0.8;
    g.strokeStyle = `rgba(${100 + r() * 60},${100 + r() * 60},255,0.6)`; g.lineWidth = 1;
    g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.sin(a) * l, y + Math.cos(a) * l); g.stroke();
  }
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(5, 5);
  return t;
})();
const furMat = new THREE.MeshPhysicalMaterial({
  vertexColors: true, roughness: 0.8, sheen: 1.0, sheenColor: new THREE.Color('#f6dcc0'), sheenRoughness: 0.5,
  normalMap: furNormal, normalScale: new THREE.Vector2(0.35, 0.35), envMapIntensity: 0.6 });
const pawMat = new THREE.MeshPhysicalMaterial({ color: '#4a2c1c', roughness: 0.55, sheen: 0.6, sheenColor: new THREE.Color('#a77b5a') });
const darkMat = new THREE.MeshPhysicalMaterial({ color: '#1c120e', roughness: 0.15, clearcoat: 1 });
const noseMat = new THREE.MeshPhysicalMaterial({ color: '#2a1912', roughness: 0.25, clearcoat: 0.8 });
const shineMat = new THREE.MeshBasicMaterial({ color: '#ffffff' });
const muzzleMat = new THREE.MeshPhysicalMaterial({ color: '#f4ecdc', roughness: 0.7, sheen: 1, sheenColor: new THREE.Color('#ffffff') });
const whiskerMat = new THREE.MeshBasicMaterial({ color: '#f7f2ea' });
const cheekMat = new THREE.MeshBasicMaterial({ color: '#ff8fa8', transparent: true, opacity: 0.45, depthWrite: false });

function ellipsoidGeo(rx, ry, rz, cx, cy, cz, colorFn, ws = 56, hs = 36) {
  const g = new THREE.SphereGeometry(1, ws, hs);
  const p = g.attributes.position;
  const col = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i) * rx + cx, y = p.getY(i) * ry + cy, z = p.getZ(i) * rz + cz;
    p.setXYZ(i, x, y, z);
    const c = colorFn(x, y, z);
    col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.computeVertexNormals();
  return g;
}

// ------------------------------------------------------------------ 해달
const HEAD_C = V(0, 0.46, -1.08), HEAD_R = 0.56;
const FACE_F = V(0, 0.82, 0.57).normalize(), FACE_U = V(0, 0.57, -0.82).normalize(), FACE_R = V(1, 0, 0);
const headDir = (dx, dy) => FACE_F.clone().addScaledVector(FACE_R, Math.tan(dx)).addScaledVector(FACE_U, Math.tan(dy)).normalize();
const SHOULDER = [V(-0.45, 0.4, -0.62), V(0.45, 0.4, -0.62)];
const REST = [V(-0.22, 0.68, -0.34), V(0.22, 0.68, -0.34)];

function makeOtter(tint) {
  const dark = new THREE.Color('#5a3824').lerp(new THREE.Color('#7a5236'), tint);
  const light = new THREE.Color('#b48b64').lerp(new THREE.Color('#cfa983'), tint);
  const cream = new THREE.Color('#ddc8a8').lerp(new THREE.Color('#eadbc2'), tint);
  const root = new THREE.Group();
  scene.add(root);
  const bodyGeo = ellipsoidGeo(0.72, 0.42, 1.25, 0, 0.12, 0.25, (x, y, z) =>
    dark.clone().lerp(light, smooth(-0.15, -0.95, z) * 0.85 + smooth(0.3, 0.55, y) * 0.12));
  const body = new THREE.Mesh(bodyGeo, furMat); body.castShadow = true; root.add(body);
  const neck = new THREE.Mesh(ellipsoidGeo(0.5, 0.36, 0.5, 0, 0.32, -0.8, (x, y, z) =>
    light.clone().lerp(cream, smooth(-0.6, -1.15, z))), furMat);
  neck.castShadow = true; root.add(neck);

  const head = new THREE.Group(); head.position.copy(HEAD_C); root.add(head);
  const headMesh = new THREE.Mesh(ellipsoidGeo(HEAD_R, HEAD_R * 0.95, HEAD_R, 0, 0, 0, (x, y, z) => {
    const d = V(x, y, z).normalize().dot(FACE_F);
    return cream.clone().lerp(light, smooth(0.1, -0.6, d) * 0.6);
  }, 64, 48), furMat);
  headMesh.castShadow = true; head.add(headMesh);
  const at = (dx, dy, dist) => headDir(dx, dy).multiplyScalar(dist);
  const orient = (obj, dx, dy) => obj.quaternion.setFromUnitVectors(ZAXIS, headDir(dx, dy));

  // 귀
  for (const s of [-1, 1]) {
    const ear = new THREE.Mesh(new THREE.SphereGeometry(0.1, 20, 14), pawMat);
    ear.position.copy(at(s * 0.78, 0.62, 0.5)); ear.scale.set(1, 0.75, 1); head.add(ear);
  }
  // 눈 (뜬 눈 / 감은 눈)
  const eyesOpen = [], eyesClosed = [];
  for (const s of [-1, 1]) {
    const g = new THREE.Group();
    const ball = new THREE.Mesh(new THREE.SphereGeometry(0.082, 28, 20), darkMat);
    const h1 = new THREE.Mesh(new THREE.SphereGeometry(0.024, 12, 8), shineMat); h1.position.set(-0.03, 0.032, 0.068);
    const h2 = new THREE.Mesh(new THREE.SphereGeometry(0.012, 10, 8), shineMat); h2.position.set(0.028, -0.024, 0.072);
    g.add(ball, h1, h2);
    g.position.copy(at(s * 0.36, 0.2, 0.525)); orient(g, s * 0.36, 0.2);
    head.add(g); eyesOpen.push(g);
    const c = new THREE.Mesh(new THREE.TorusGeometry(0.07, 0.02, 10, 28, Math.PI), darkMat);
    const cg = new THREE.Group(); cg.add(c);
    cg.position.copy(at(s * 0.36, 0.2, 0.57)); orient(cg, s * 0.36, 0.2);
    head.add(cg); eyesClosed.push({ g: cg, mesh: c });
  }
  // 코, 주둥이, 입, 수염, 볼
  const nose = new THREE.Mesh(new THREE.SphereGeometry(0.08, 24, 16), noseMat);
  nose.scale.set(1.45, 1.0, 0.8); nose.position.copy(at(0, -0.06, 0.57)); orient(nose, 0, -0.06); head.add(nose);
  const ns = new THREE.Mesh(new THREE.SphereGeometry(0.018, 10, 8), shineMat); ns.position.copy(at(-0.04, -0.02, 0.63)); head.add(ns);
  for (const s of [-1, 1]) {
    const m = new THREE.Mesh(new THREE.SphereGeometry(0.15, 24, 18), muzzleMat);
    m.position.copy(at(s * 0.13, -0.25, 0.47)); head.add(m);
    const mouth = new THREE.Mesh(new THREE.TorusGeometry(0.045, 0.011, 8, 20, Math.PI), darkMat);
    const mg = new THREE.Group(); mg.add(mouth); mouth.rotation.z = Math.PI;
    mg.position.copy(at(s * 0.05, -0.4, 0.6)); orient(mg, s * 0.05, -0.4); head.add(mg);
    const cheek = new THREE.Mesh(new THREE.CircleGeometry(0.1, 24), cheekMat);
    cheek.position.copy(at(s * 0.52, -0.1, 0.567)); orient(cheek, s * 0.52, -0.1); cheek.scale.set(1.3, 0.85, 1); head.add(cheek);
    for (let k = 0; k < 3; k++) {
      const from = at(s * 0.26, -0.27 + k * 0.06 - 0.06, 0.6);
      const dir = FACE_R.clone().multiplyScalar(s).addScaledVector(FACE_U, (k - 1) * 0.28).addScaledVector(FACE_F, 0.25).normalize();
      const w = new THREE.Mesh(new THREE.CylinderGeometry(0.005, 0.005, 0.36, 5), whiskerMat);
      w.quaternion.setFromUnitVectors(UP, dir);
      w.position.copy(from).addScaledVector(dir, 0.18);
      head.add(w);
    }
  }
  // 팔
  const arms = [0, 1].map(() => {
    const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.115, 1, 16), furMat.clone());
    arm.material.vertexColors = false; arm.material.color = dark.clone().lerp(light, 0.25);
    const paw = new THREE.Mesh(new THREE.SphereGeometry(0.125, 22, 16), pawMat);
    paw.scale.set(1, 0.82, 1.1);
    arm.castShadow = paw.castShadow = true;
    root.add(arm, paw);
    return { arm, paw };
  });
  // 뒷발, 꼬리
  const feet = [-1, 1].map((s) => {
    const f = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 16), pawMat);
    f.scale.set(0.16, 0.055, 0.27); f.position.set(s * 0.32, 0.3, 1.42); f.rotation.x = -0.65;
    f.castShadow = true; root.add(f); return f;
  });
  const tail = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 16), pawMat);
  tail.scale.set(0.17, 0.07, 0.52); tail.position.set(0, 0.13, 1.78); root.add(tail);
  // 몸 둘레 물결 테
  const ring = new THREE.Mesh(new THREE.PlaneGeometry(2.1, 3.6), new THREE.MeshBasicMaterial({
    map: canvasTex(128, 220, (g, w, h) => {
      g.strokeStyle = 'rgba(255,255,255,0.75)'; g.lineWidth = 7; g.filter = 'blur(3px)';
      g.beginPath(); g.ellipse(w / 2, h / 2, w * 0.36, h * 0.4, 0, 0, TAU); g.stroke();
    }), transparent: true, depthWrite: false }));
  ring.rotation.x = -Math.PI / 2; ring.position.set(0, 0.02, 0.28); root.add(ring);
  // 퍼지는 물결
  const ripples = [0, 1].map(() => {
    const r = new THREE.Mesh(new THREE.RingGeometry(0.96, 1.0, 64), new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, depthWrite: false }));
    r.rotation.x = -Math.PI / 2; scene.add(r); return r;
  });
  return { root, head, eyesOpen, eyesClosed, arms, feet, tail, ripples, scale: 1 };
}

function setArm(o, i, paw) {
  const s = SHOULDER[i];
  const d = paw.clone().sub(s);
  const len = d.length();
  o.arms[i].arm.position.copy(s).addScaledVector(d, 0.5);
  o.arms[i].arm.quaternion.setFromUnitVectors(UP, d.normalize());
  o.arms[i].arm.scale.set(1, len, 1);
  o.arms[i].paw.position.copy(paw);
}

function updateOtter(o, pose, t, seed) {
  o.root.visible = pose.visible;
  for (const r of o.ripples) r.visible = pose.visible;
  if (!pose.visible) return;
  const y = waveH(pose.x, pose.z, t);
  const [sx, sz] = waveSlope(pose.x, pose.z, t);
  o.root.position.set(pose.x, y - 0.03, pose.z);
  o.root.rotation.set(sz * 0.6, pose.yaw, -sx * 0.8 + pose.roll);
  o.root.scale.setScalar(pose.scale);
  o.head.rotation.set(pose.nod, 0, pose.tilt);
  const open = pose.eyes === 'open';
  for (const e of o.eyesOpen) { e.visible = open; e.scale.set(1, open ? pose.blink : 1, 1); }
  for (const e of o.eyesClosed) {
    e.g.visible = !open;
    e.mesh.rotation.z = pose.eyes === 'sleep' ? Math.PI : 0;   // 잠: ∪, 행복: ∩
  }
  setArm(o, 0, pose.pawL);
  setArm(o, 1, pose.pawR);
  o.feet.forEach((f, i) => { f.rotation.x = -0.65 + 0.12 * Math.sin(t * 2.4 + i * 1.7 + seed); });
  o.tail.rotation.y = 0.08 * Math.sin(t * 1.3 + seed);
  o.ripples.forEach((r, i) => {
    const ph = ((t * 0.55 + i * 0.5 + seed * 0.13) % 1);
    r.position.set(pose.x, waveH(pose.x, pose.z, t) + 0.015, pose.z + 0.2);
    r.scale.set((1.0 + ph * 1.6) * pose.scale, (1.6 + ph * 1.8) * pose.scale, 1);
    r.material.opacity = 0.45 * (1 - ph) * smooth(0, 0.15, ph);
  });
}

const otterA = makeOtter(0.0);
const otterB = makeOtter(0.55);

function blinkAt(t, off) {
  const bt = (t + off) % 3.4;
  return bt < 0.14 ? Math.max(0.1, 1 - Math.sin(Math.PI * bt / 0.14)) : 1;
}

function clamHeight(t, C) {
  const hits = C.HITS;
  const start = C.CLAM[0] + 0.15;
  if (t < start) return 1.0;
  let prev = start, prevHit = false;
  for (const h of hits) {
    if (t < h) {
      const ph = (t - prev) / (h - prev);
      const from = prevHit ? 0.9 : 1.0;
      return ph < 0.62 ? lerp(from, 1.12, easeOut(ph / 0.62)) : lerp(1.12, 0.9, easeIn((ph - 0.62) / 0.38));
    }
    prev = h; prevHit = true;
  }
  return lerp(0.9, 0.98, easeOut(prog(t, prev, prev + 0.3)));
}

function poseA(t, C) {
  const side = easeIO(prog(t, C.B_IN[0], C.B_IN[1])) * (1 - easeIO(prog(t, C.B_OUT[0], C.B_OUT[1])))
    + easeIO(prog(t, C.B_IN2[0], C.B_IN2[1]));
  const p = { visible: true, x: -0.88 * side, z: 0.3, yaw: 0.06 * side, roll: 0, scale: 1, tilt: 0, nod: 0,
    eyes: 'open', blink: blinkAt(t, 0.3), pawL: REST[0].clone(), pawR: REST[1].clone() };
  const bob = 0.02 * Math.sin(t * 2.1);
  p.pawL.y += bob; p.pawR.y += bob;
  if (t < 3.6) { p.tilt = 0.2 * Math.sin(t * 2.4) * smooth(0.7, 1.2, t); p.nod = -0.08; }
  if (t >= C.SLEEP[0] && t < C.SLEEP[1]) p.eyes = 'sleep';
  if (t >= C.CLAM_OPEN + 0.12) p.eyes = 'happy';
  // 손잡기 (사실 1, 아웃트로)
  const hold = smooth(C.B_IN[1] - 0.2, C.B_IN[1] + 0.25, t) * (1 - smooth(C.B_OUT[0] - 0.05, C.B_OUT[0] + 0.15, t))
    + smooth(C.B_IN2[1] - 0.2, C.B_IN2[1] + 0.25, t);
  p.pawR.lerp(V(0.74, 0.5, -0.46), hold);
  // 사실 3: 왼팔 들기
  const up = easeIO(prog(t, C.ARM_UP[0], C.ARM_UP[0] + 0.45)) * (1 - easeIO(prog(t, C.ARM_UP[1] - 0.4, C.ARM_UP[1])));
  p.pawL.lerp(V(-0.86, 0.85, -1.02), up);
  if (up > 0) { p.tilt = -0.15 * up; }
  // 사실 4: 조개 두드리기
  const clam = smooth(C.CLAM[0] - 0.1, C.CLAM[0] + 0.2, t) * (1 - smooth(C.CLAM[1] - 0.15, C.CLAM[1] + 0.1, t));
  if (clam > 0) {
    const cy = clamHeight(t, C);
    p.pawL.lerp(V(-0.22, cy, 0.02), clam);
    p.pawR.lerp(V(0.22, cy, 0.02), clam);
    p.nod = 0.12 * clam;
  }
  // 아웃트로: 왼손 흔들기
  const wv = easeIO(prog(t, C.WAVE[0], C.WAVE[0] + 0.35));
  p.pawL.lerp(V(-0.62 + 0.13 * Math.sin(TAU * 2.2 * t), 1.08, -0.98), wv);
  return p;
}

function poseB(t, C) {
  const inA = easeOut(prog(t, C.B_IN[0], C.B_IN[1])), outA = easeIn(prog(t, C.B_OUT[0], C.B_OUT[1]));
  const in2 = easeOut(prog(t, C.B_IN2[0], C.B_IN2[1]));
  const visible = (t >= C.B_IN[0] && t < C.B_OUT[1]) || t >= C.B_IN2[0];
  let x = 4.6;
  if (t < C.B_OUT[1]) x = lerp(4.6, 0.88, inA) + (4.6 - 0.88) * outA;
  if (t >= C.B_IN2[0]) x = lerp(4.6, 0.88, in2);
  const p = { visible, x, z: 0.42, yaw: -0.08, roll: 0, scale: 0.92, tilt: 0.05, nod: 0,
    eyes: 'open', blink: blinkAt(t, 1.6), pawL: REST[0].clone(), pawR: REST[1].clone() };
  if (t >= C.SLEEP[0] + 0.3 && t < C.SLEEP[1]) p.eyes = 'sleep';
  if (t >= C.B_IN2[0]) p.eyes = 'happy';
  const hold = smooth(C.B_IN[1] - 0.2, C.B_IN[1] + 0.25, t) * (1 - smooth(C.B_OUT[0] - 0.05, C.B_OUT[0] + 0.15, t))
    + smooth(C.B_IN2[1] - 0.2, C.B_IN2[1] + 0.25, t);
  p.pawL.lerp(V(-0.78, 0.5, -0.5), hold);
  return p;
}

// ------------------------------------------------------------------ 해초
const kelpMat = new THREE.MeshPhysicalMaterial({ color: '#7a8a2e', roughness: 0.4, clearcoat: 0.6, side: THREE.DoubleSide, sheen: 0.4, sheenColor: new THREE.Color('#c9d36a') });
const KELP_N = 140;
const kelp = (() => {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(KELP_N * 2 * 3), 3));
  const idx = [];
  for (let i = 0; i < KELP_N - 1; i++) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
  geo.setIndex(idx);
  const m = new THREE.Mesh(geo, kelpMat); m.castShadow = true; m.frustumCulled = false;
  scene.add(m);
  return m;
})();
function updateKelp(t, C) {
  const grow = easeIO(prog(t, C.KELP[0], C.KELP[1])) * (1 - easeIO(prog(t, C.B_OUT[0] - 0.1, C.B_OUT[0] + 0.3)));
  kelp.visible = grow > 0.01;
  if (!kelp.visible) return;
  const A = otterA.root, B = otterB.root;
  A.updateMatrixWorld(); B.updateMatrixWorld();
  const la = (x, y, z) => A.localToWorld(V(x, y, z));
  const lb = (x, y, z) => B.localToWorld(V(x, y, z));
  const pts = [V(A.position.x - 2.0, waveH(A.position.x - 2, 1.4, t), 1.4), V(A.position.x - 1.1, waveH(A.position.x - 1.1, 0.9, t), 0.9),
    la(-0.62, 0.42, 0.6), la(0, 0.58, 0.48), la(0.6, 0.45, 0.42), V(0, waveH(0, 0.5, t) + 0.03, 0.5),
    lb(-0.6, 0.45, 0.45), lb(0, 0.58, 0.5), lb(0.62, 0.42, 0.58),
    V(B.position.x + 1.15, waveH(B.position.x + 1.15, 1.0, t), 1.0), V(B.position.x + 2.1, waveH(B.position.x + 2.1, 1.6, t), 1.6)];
  const curve = new THREE.CatmullRomCurve3(pts);
  const p = kelp.geometry.attributes.position.array;
  const n = Math.max(2, Math.floor(KELP_N * grow));
  for (let i = 0; i < KELP_N; i++) {
    const u = Math.min(i, n - 1) / (KELP_N - 1);
    const P = curve.getPointAt(u), T = curve.getTangentAt(u);
    const side = V(0, 1, 0).cross(T).normalize();
    const w = 0.17 * (1 + 0.25 * Math.sin(u * 60)) * (i < n ? 1 : 0.0001);
    p[i * 6] = P.x + side.x * w; p[i * 6 + 1] = P.y + 0.02; p[i * 6 + 2] = P.z + side.z * w;
    p[i * 6 + 3] = P.x - side.x * w; p[i * 6 + 4] = P.y + 0.02; p[i * 6 + 5] = P.z - side.z * w;
  }
  kelp.geometry.attributes.position.needsUpdate = true;
  kelp.geometry.computeVertexNormals();
  kelp.geometry.setDrawRange(0, (n - 1) * 6);
}

// ------------------------------------------------------------------ 소품
const PROP = {};
const glossy = (c, extra = {}) => new THREE.MeshPhysicalMaterial(Object.assign({ color: c, roughness: 0.25, clearcoat: 1, clearcoatRoughness: 0.1 }, extra));

function buildProps(font) {
  // 물음표
  const qg = new TextGeometry('?', { font, size: 1.0, depth: 0.32, curveSegments: 10, bevelEnabled: true, bevelThickness: 0.08, bevelSize: 0.025, bevelSegments: 3 });
  qg.center();
  PROP.q = new THREE.Mesh(qg, glossy('#ffd23f', { emissive: '#7a5200', emissiveIntensity: 0.15 }));
  PROP.q.castShadow = true;
  scene.add(PROP.q);

  // 털 1제곱센티미터 모형
  PROP.patch = new THREE.Group();
  const base = new THREE.Mesh(new THREE.BoxGeometry(1, 0.14, 1), new THREE.MeshPhysicalMaterial({ color: '#4a2f1f', roughness: 0.7 }));
  base.position.y = -0.07; base.castShadow = true;
  PROP.patch.add(base);
  const HN = 3600;
  const hair = new THREE.InstancedMesh(new THREE.ConeGeometry(0.011, 0.34, 4, 1), new THREE.MeshPhysicalMaterial({ roughness: 0.6, sheen: 1, sheenColor: new THREE.Color('#e6c7a0') }), HN);
  const r = mulberry32(5), m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), c = new THREE.Color();
  for (let i = 0; i < HN; i++) {
    const x = (r() - 0.5) * 0.96, z = (r() - 0.5) * 0.96, hgt = 0.75 + r() * 0.5;
    e.set((r() - 0.5) * 0.5, 0, (r() - 0.5) * 0.5); q.setFromEuler(e);
    m4.compose(V(x, 0.17 * hgt, z), q, V(1, hgt, 1));
    hair.setMatrixAt(i, m4);
    hair.setColorAt(i, c.set('#5b3a25').lerp(new THREE.Color('#b08a62'), r() * 0.8));
  }
  hair.castShadow = true;
  PROP.patch.add(hair);
  PROP.patchHair = hair;
  scene.add(PROP.patch);

  // 돌
  const rg = new THREE.IcosahedronGeometry(1, 3);
  const rp = rg.attributes.position, rc = new Float32Array(rp.count * 3), rr = mulberry32(31);
  for (let i = 0; i < rp.count; i++) {
    const v = V(rp.getX(i), rp.getY(i), rp.getZ(i));
    const n = 1 + 0.12 * Math.sin(v.x * 3.3 + 1) * Math.sin(v.y * 2.9 + 2) + 0.06 * Math.sin(v.z * 6.1);
    v.multiplyScalar(n); v.y *= 0.72;
    rp.setXYZ(i, v.x, v.y, v.z);
    const k = 0.42 + 0.12 * Math.sin(v.x * 9 + v.z * 7) + (rr() < 0.05 ? -0.12 : 0);
    rc[i * 3] = k; rc[i * 3 + 1] = k * 1.02; rc[i * 3 + 2] = k * 1.08;
  }
  rg.setAttribute('color', new THREE.BufferAttribute(rc, 3));
  rg.computeVertexNormals();
  PROP.rock = new THREE.Mesh(rg, new THREE.MeshPhysicalMaterial({ vertexColors: true, roughness: 0.45, clearcoat: 0.5, clearcoatRoughness: 0.3 }));
  PROP.rock.castShadow = true;
  scene.add(PROP.rock);

  // 조개
  const shellTex = canvasTex(256, 128, (g, w, h) => {
    g.fillStyle = '#f2dcb8'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 18; i++) { g.fillStyle = i % 2 ? 'rgba(196,148,98,0.55)' : 'rgba(255,240,220,0.4)'; g.fillRect(i * w / 18, 0, w / 36, h); }
    const gr = g.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, 'rgba(120,80,50,0.35)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(0, 0, w, h);
  });
  const shellMat = new THREE.MeshPhysicalMaterial({ map: shellTex, roughness: 0.35, clearcoat: 0.8, side: THREE.DoubleSide });
  PROP.clam = new THREE.Group();
  const bottom = new THREE.Mesh(new THREE.SphereGeometry(0.3, 40, 16, 0, TAU, Math.PI / 2, Math.PI / 2), shellMat);
  bottom.scale.set(1, 0.36, 0.86);
  const hinge = new THREE.Group(); hinge.position.set(0, 0, -0.25);
  const top = new THREE.Mesh(new THREE.SphereGeometry(0.3, 40, 16, 0, TAU, 0, Math.PI / 2), shellMat);
  top.scale.set(1, 0.36, 0.86); top.position.set(0, 0, 0.25);
  hinge.add(top);
  const meat = new THREE.Mesh(new THREE.SphereGeometry(0.17, 24, 16), new THREE.MeshPhysicalMaterial({ color: '#ffd6c4', roughness: 0.3, clearcoat: 1 }));
  meat.scale.set(1, 0.4, 0.8); meat.position.y = 0.01;
  PROP.clam.add(bottom, hinge, meat);
  PROP.clamHinge = hinge;
  PROP.clam.traverse((o) => { o.castShadow = true; });
  scene.add(PROP.clam);
}

function updateProps(t, C, anchors) {
  // 물음표
  const qa = prog(t, 0.9, 1.35), qo = prog(t, 3.37, 3.55);
  const qs = (0.4 + 0.6 * easeBack(qa, 2.2)) * Math.min(1, qa * 2.5) * (1 - qo);
  PROP.q.visible = t >= 0.9 && t < 3.55 && qs > 0.01;
  if (PROP.q.visible) {
    const p = screenToWorld(540, 800 + 12 * Math.sin(t * 4));
    PROP.q.position.copy(p);
    PROP.q.scale.setScalar(qs * 140 / (0.72 * pxPerUnitAt(p)));
    PROP.q.quaternion.copy(camera.quaternion);
    PROP.q.rotateY(Math.sin(t * 2.2) * 0.6);
    PROP.q.rotateZ(0.14 * Math.sin(t * 3.1));
  }
  // 털 모형
  const pa = prog(t, C.PATCH[0], C.PATCH[0] + 0.45), po = prog(t, C.PATCH[1] - 0.2, C.PATCH[1]);
  const ps = Math.max(0.001, easeBack(pa, 2.0) * (1 - easeIn(po)));
  PROP.patch.visible = t >= C.PATCH[0] && t < C.PATCH[1];
  if (PROP.patch.visible) {
    const p = screenToWorld(380, 835);
    PROP.patch.position.copy(p);
    PROP.patch.scale.setScalar(ps * 235 / pxPerUnitAt(p));
    PROP.patch.rotation.set(0.55, t * 0.5, 0.1 * Math.sin(t * 1.3));
    PROP.patch.updateMatrixWorld(true);
    anchors.patch = project(p);
    anchors.patch_bottom = project(PROP.patch.localToWorld(V(0, -0.1, 0.55)));
  }
  // 돌
  const A = otterA.root;
  A.updateMatrixWorld();
  const pouch = A.localToWorld(V(-0.52, 0.44, -0.56));
  const chest = A.localToWorld(V(0, 0.62, 0.06));
  const hover = screenToWorld(540, 840);
  let rockPos = null, rockScale = 0.2;
  if (t >= C.ROCK_OUT && t < C.CLAM[1]) {
    const a = easeOut(prog(t, C.ROCK_OUT, C.ROCK_OUT + 0.8));
    rockPos = pouch.clone().lerp(hover, a);
    rockScale = lerp(0.12, 0.42, a);
    if (t >= C.ROCK_TO_CHEST[0]) {
      const b = easeIO(prog(t, C.ROCK_TO_CHEST[0], C.ROCK_TO_CHEST[1]));
      rockPos = hover.clone().lerp(chest, b); rockPos.y += 0.5 * Math.sin(Math.PI * b);
      rockScale = lerp(0.42, 0.21, b);
    }
    rockScale *= 1 - easeIn(prog(t, C.CLAM[1] - 0.15, C.CLAM[1]));
  }
  PROP.rock.visible = !!rockPos;
  if (rockPos) {
    PROP.rock.position.copy(rockPos);
    PROP.rock.scale.setScalar(Math.max(0.001, rockScale));
    const spin = t < C.ROCK_TO_CHEST[1] ? t * 1.6 : C.ROCK_TO_CHEST[1] * 1.6;
    PROP.rock.rotation.set(0.3, spin, 0.2);
    anchors.rock = project(rockPos);
  }
  anchors.armpit = project(A.localToWorld(V(-0.5, 0.52, -0.58)));
  // 조개
  const ca = smooth(C.CLAM[0] - 0.1, C.CLAM[0] + 0.2, t) * (1 - smooth(C.CLAM[1] - 0.15, C.CLAM[1] + 0.1, t));
  PROP.clam.visible = ca > 0.01;
  if (PROP.clam.visible) {
    const cy = clamHeight(t, C);
    const cp = A.localToWorld(V(0, cy + 0.02, 0.02));
    PROP.clam.position.copy(cp);
    PROP.clam.scale.setScalar(ca);
    PROP.clam.rotation.set(0.25, A.rotation.y, A.rotation.z);
    PROP.clamHinge.rotation.x = -1.15 * easeBack(prog(t, C.CLAM_OPEN, C.CLAM_OPEN + 0.35), 1.6);
    anchors.clam = project(cp);
  }
}

// ------------------------------------------------------------------ 프레임 렌더
window.renderFrame = (S, opts = {}) => {
  const t = S.t, C = S.cues;
  updateWater(t);
  updateFoam(t);
  const pa = poseA(t, C), pb = poseB(t, C);
  updateOtter(otterA, pa, t, 0);
  updateOtter(otterB, pb, t, 3);
  updateKelp(t, C);
  const anchors = {};
  updateProps(t, C, anchors);
  otterA.root.updateMatrixWorld(); otterB.root.updateMatrixWorld();
  anchors.head_a = project(otterA.head.localToWorld(FACE_F.clone().multiplyScalar(0.6)));
  if (pb.visible) {
    anchors.head_b = project(otterB.head.localToWorld(FACE_F.clone().multiplyScalar(0.6)));
    anchors.hands = project(otterA.arms[1].paw.getWorldPosition(V(0, 0, 0)).add(otterB.arms[0].paw.getWorldPosition(V(0, 0, 0))).multiplyScalar(0.5));
  }
  renderer.render(scene, camera);
  const img = renderer.domElement.toDataURL(opts.png ? 'image/png' : 'image/jpeg', 0.95);
  return { img, anchors };
};

new FontLoader().load('/three/examples/fonts/helvetiker_bold.typeface.json', (font) => {
  buildProps(font);
  window.ready = true;
}, undefined, (e) => { window.loadError = String(e); });
