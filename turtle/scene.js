// 바다거북 쇼츠 3D 장면 (three.js). 노을 진 해변 세트와 바닷속 세트를 시간에 따라 전환한다.
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

const camera = new THREE.PerspectiveCamera(30, W / H, 0.1, 300);
const CAMS = {
  A: { pos: V(0, 0.95, 3.7), look: V(0, 0.5, 0) },          // 둥지
  B: { pos: V(0, 2.2, 6.0), look: V(0, 0.2, -3.2) },        // 바다로 달려가는 아기들
  C: { pos: V(0.85, 1.05, 4.3), look: V(0.05, 0.32, -0.35) }, // 어른 거북 얼굴
  D: { pos: V(0, 1.3, 10.5), look: V(0, 1.25, 0) },         // 바닷속
};
function setCamera(t, C) {
  const [a0, a1, b0, b1, c0, c1] = C.CAM;
  let from = CAMS.A, to = CAMS.A, k = 0;
  if (t >= c0) { from = CAMS.C; to = CAMS.D; k = t >= 22.6 ? 1 : 0; }
  else if (t >= b0) { from = CAMS.B; to = CAMS.C; k = easeIO(prog(t, b0, b1)); }
  else if (t >= a0) { from = CAMS.A; to = CAMS.B; k = easeIO(prog(t, a0, a1)); }
  camera.position.copy(from.pos).lerp(to.pos, k);
  camera.lookAt(from.look.clone().lerp(to.look, k));
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
function screenToWorld(px, py, dist = 3.2) {
  const v = V(px / W * 2 - 1, -(py / H * 2 - 1), 0.5).unproject(camera);
  const dir = v.sub(camera.position).normalize();
  return camera.position.clone().addScaledVector(dir, dist);
}

// ------------------------------------------------------------------ 하늘/환경
const sunsetBg = canvasTex(8, 512, (g, w, h) => {
  const gr = g.createLinearGradient(0, 0, 0, h);
  gr.addColorStop(0, '#36407e'); gr.addColorStop(0.18, '#7b5aa6'); gr.addColorStop(0.3, '#e0789a');
  gr.addColorStop(0.38, '#ffa36e'); gr.addColorStop(0.46, '#ffd18e'); gr.addColorStop(1, '#ffd18e');
  g.fillStyle = gr; g.fillRect(0, 0, w, h);
});
const underBg = canvasTex(8, 512, (g, w, h) => {
  const gr = g.createLinearGradient(0, 0, 0, h);
  gr.addColorStop(0, '#62d0ec'); gr.addColorStop(0.45, '#1f8fc2'); gr.addColorStop(1, '#0b4d82');
  g.fillStyle = gr; g.fillRect(0, 0, w, h);
});
const sunsetFog = new THREE.Fog(new THREE.Color('#f2a98a'), 45, 140);
const underFog = new THREE.Fog(new THREE.Color('#2a92c4'), 12, 34);
let sunsetEnv;
{
  const s = new THREE.Scene();
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    vertexShader: 'varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `varying vec3 vP;
      void main(){
        float h = vP.y;
        vec3 top = vec3(0.21, 0.25, 0.5), mid = vec3(0.88, 0.47, 0.6), hor = vec3(1.0, 0.72, 0.45), sea = vec3(0.12, 0.2, 0.35);
        vec3 c = h > 0.0 ? mix(mix(hor, mid, smoothstep(0.0, 0.25, h)), top, smoothstep(0.25, 0.8, h)) : mix(hor, sea, smoothstep(0.0, -0.2, h));
        vec3 sd = normalize(vec3(0.35, 0.08, -1.0));
        float d = max(dot(vP, sd), 0.0);
        c += vec3(1.0, 0.75, 0.45) * (pow(d, 400.0) * 18.0 + pow(d, 10.0) * 0.5);
        gl_FragColor = vec4(c, 1.0);
      }`,
  });
  s.add(new THREE.Mesh(new THREE.SphereGeometry(50, 64, 32), mat));
  sunsetEnv = new THREE.PMREMGenerator(renderer).fromScene(s, 0.02).texture;
}

// ------------------------------------------------------------------ 조명
const hemi = new THREE.HemisphereLight(0xffd9b0, 0xc99a6a, 1.05);
const key = new THREE.DirectionalLight(0xffd2a1, 2.4);
key.position.set(-4, 6, 6);
key.castShadow = true;
key.shadow.mapSize.set(2048, 2048);
Object.assign(key.shadow.camera, { left: -6, right: 6, top: 6, bottom: -6, near: 1, far: 30 });
key.shadow.bias = -0.0005; key.shadow.normalBias = 0.02; key.shadow.radius = 5;
const back = new THREE.DirectionalLight(0xff9a6a, 1.3); back.position.set(6, 3, -10);
scene.add(hemi, key, key.target, back);

// ------------------------------------------------------------------ 물결 빛 무늬 (바닷속 바닥)
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

const sandTex = canvasTex(512, 512, (g, w, h) => {
  g.fillStyle = '#efcf98'; g.fillRect(0, 0, w, h);
  const r = mulberry32(42);
  for (let i = 0; i < 9000; i++) {
    const x = r() * w, y = r() * h, s = 0.6 + r() * 1.8;
    g.fillStyle = r() > 0.5 ? `rgba(255,248,225,${0.25 + r() * 0.3})` : `rgba(150,105,55,${0.12 + r() * 0.2})`;
    for (const [ox, oy] of [[0, 0], [w, 0], [-w, 0], [0, h], [0, -h]]) { g.beginPath(); g.arc(x + ox, y + oy, s, 0, TAU); g.fill(); }
  }
});
sandTex.wrapS = sandTex.wrapT = THREE.RepeatWrapping;

// ------------------------------------------------------------------ 해변 세트
const beach = new THREE.Group(); scene.add(beach);
const SHORE_Z = -4.4;
{
  const t2 = sandTex.clone(); t2.needsUpdate = true; t2.repeat.set(26, 26);
  const geo = new THREE.PlaneGeometry(80, 40, 220, 140); geo.rotateX(-Math.PI / 2); geo.translate(0, 0, 8);
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), z = p.getZ(i), d = Math.hypot(x, z);
    let y = 0.04 * Math.sin(x * 2.1) * Math.sin(z * 1.7) + 0.18 * Math.sin(x * 0.35 + 1) * smooth(4, 10, d) * smooth(SHORE_Z + 0.5, SHORE_Z + 2.5, z);
    y -= 0.22 * Math.exp(-Math.pow(d / 0.62, 2)) - 0.07 * Math.exp(-Math.pow((d - 0.78) / 0.18, 2));   // 둥지
    y -= 0.35 * smooth(SHORE_Z + 1.5, SHORE_Z - 1.0, z) + 1.4 * smooth(SHORE_Z - 0.8, SHORE_Z - 3.0, z);   // 물가로 경사, 그 너머는 물속으로
    p.setY(i, y);
  }
  geo.computeVertexNormals();
  const sand = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ map: t2, roughness: 0.95 }));
  sand.receiveShadow = true;
  beach.add(sand);
}
const seaGeo = new THREE.PlaneGeometry(200, 120, 160, 80);
seaGeo.rotateX(-Math.PI / 2); seaGeo.translate(0, -0.24, SHORE_Z - 60);
const sea = new THREE.Mesh(seaGeo, new THREE.MeshPhysicalMaterial({ color: '#174a86', roughness: 0.25, clearcoat: 0.6, clearcoatRoughness: 0.2, envMapIntensity: 0.3 }));
beach.add(sea);
const seaBase = Float32Array.from(seaGeo.attributes.position.array);
const foamTex = canvasTex(512, 64, (g, w, h) => {
  g.clearRect(0, 0, w, h);
  const r = mulberry32(5);
  for (let i = 0; i < 260; i++) {
    g.fillStyle = `rgba(255,255,255,${0.35 + r() * 0.5})`;
    g.beginPath(); g.ellipse(r() * w, h * (0.35 + r() * 0.4), 6 + r() * 16, 3 + r() * 5, 0, 0, TAU); g.fill();
  }
  const gr = g.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, 'rgba(255,255,255,0)'); gr.addColorStop(0.55, 'rgba(255,255,255,0.85)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, w, h);
});
foamTex.wrapS = THREE.RepeatWrapping; foamTex.repeat.set(6, 1);
const foam = new THREE.Mesh(new THREE.PlaneGeometry(60, 1.1), new THREE.MeshBasicMaterial({ map: foamTex, transparent: true, depthWrite: false }));
foam.rotation.x = -Math.PI / 2;
beach.add(foam);
const wetSand = new THREE.Mesh(new THREE.PlaneGeometry(60, 1.6), new THREE.MeshBasicMaterial({ color: '#b98f5a', transparent: true, opacity: 0.35, depthWrite: false }));
wetSand.rotation.x = -Math.PI / 2; beach.add(wetSand);
const glowTex = canvasTex(128, 128, (g, w, h) => {
  const gr = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
  gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.25, 'rgba(255,255,255,0.9)'); gr.addColorStop(0.5, 'rgba(255,255,255,0.25)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, w, h);
});
const sunSprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: '#ffd9a0', transparent: true, depthWrite: false, fog: false }));
sunSprite.position.set(22, 2.2, -70); sunSprite.scale.setScalar(16); beach.add(sunSprite);
// 야자수
function palm(x, z, s, lean) {
  const g = new THREE.Group();
  const trunkMat = new THREE.MeshStandardMaterial({ color: '#7a5532', roughness: 0.9 });
  const pts = [];
  for (let i = 0; i <= 12; i++) { const k = i / 12; pts.push(V(lean * k * k * 1.5, k * 4.2, 0)); }
  const trunk = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 24, 0.13, 10), trunkMat);
  g.add(trunk);
  const leafMat = new THREE.MeshStandardMaterial({ color: '#3f8f3a', roughness: 0.6, side: THREE.DoubleSide });
  const top = pts[pts.length - 1];
  for (let k = 0; k < 7; k++) {
    const a = k / 7 * TAU;
    const lg = new THREE.PlaneGeometry(2.2, 0.45, 10, 1);
    const p = lg.attributes.position;
    for (let i = 0; i < p.count; i++) { const xx = p.getX(i) + 1.1; p.setX(i, xx); p.setY(i, p.getY(i) * (1 - xx / 2.4)); p.setZ(i, -0.35 * xx * xx / 2.2); }
    lg.computeVertexNormals();
    const leaf = new THREE.Mesh(lg, leafMat);
    leaf.position.copy(top); leaf.rotation.set(Math.PI / 2 - 0.1, 0, a);
    const lp = new THREE.Group(); lp.position.copy(top); leaf.position.set(0, 0, 0); lp.rotation.y = a; leaf.rotation.set(-0.35, 0, 0); lp.add(leaf); g.add(lp);
  }
  g.position.set(x, 0, z); g.scale.setScalar(s);
  g.traverse((o) => { o.castShadow = true; });
  beach.add(g);
}
palm(-3.9, -1.5, 0.95, 0.9);
palm(4.6, -3.0, 0.8, -0.7);

// ------------------------------------------------------------------ 바닷속 세트
const under = new THREE.Group(); scene.add(under);
{
  const t3 = sandTex.clone(); t3.needsUpdate = true; t3.repeat.set(30, 30);
  const geo = new THREE.PlaneGeometry(120, 120, 160, 160); geo.rotateX(-Math.PI / 2);
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) { const x = p.getX(i), z = p.getZ(i); p.setY(i, -1.6 + 0.3 * Math.sin(x * 0.35) * Math.cos(z * 0.3) + 0.03 * Math.sin(x * 3) * Math.sin(z * 2.6)); }
  geo.computeVertexNormals();
  const floor = new THREE.Mesh(geo, addCaustics(new THREE.MeshStandardMaterial({ map: t3, roughness: 0.95 }), 0.7, 0.2));
  floor.receiveShadow = true; under.add(floor);
  const rockMat = addCaustics(new THREE.MeshStandardMaterial({ color: '#7d8796', roughness: 0.9 }), 0.4);
  for (let k = 0; k < 7; k++) {
    const g = new THREE.IcosahedronGeometry(1, 3); const pp = g.attributes.position;
    for (let i = 0; i < pp.count; i++) { const v = V(pp.getX(i), pp.getY(i), pp.getZ(i)); v.multiplyScalar(1 + 0.12 * Math.sin(v.x * 3 + k) * Math.sin(v.y * 2.5 + k)); pp.setXYZ(i, v.x, v.y, v.z); }
    g.computeVertexNormals();
    const m = new THREE.Mesh(g, rockMat);
    const x = [-4.2, 4.0, -2.6, 2.9, -6, 6.2, 0.4][k], z = [-2, -3, -7, -8, -10, -11, -14][k], s = [0.9, 1.1, 1.4, 1.2, 2.0, 1.8, 2.4][k];
    m.position.set(x, -1.6 + s * 0.3, z); m.scale.set(s * 1.3, s * 0.7, s); under.add(m);
  }
  const coralCols = ['#ff7f6e', '#ffb547', '#b27cff', '#ff6fa8'];
  for (let k = 0; k < 10; k++) {
    const mat = addCaustics(new THREE.MeshStandardMaterial({ color: coralCols[k % 4], roughness: 0.55 }), 0.35);
    const g = new THREE.Group(); const r = mulberry32(100 + k);
    const branch = (pos, dir, len, rad, depth) => {
      const m = new THREE.Mesh(new THREE.CapsuleGeometry(rad, len, 6, 12), mat);
      m.quaternion.setFromUnitVectors(UP, dir); m.position.copy(pos).addScaledVector(dir, len / 2); g.add(m);
      if (depth <= 0) return;
      const end = pos.clone().addScaledVector(dir, len);
      for (let i = 0; i < 2 + (r() > 0.6 ? 1 : 0); i++) {
        const a = r() * TAU; branch(end, dir.clone().add(V(Math.cos(a) * 0.7, 0.3, Math.sin(a) * 0.5)).normalize(), len * 0.72, rad * 0.78, depth - 1);
      }
    };
    branch(V(0, 0, 0), UP.clone(), 0.5, 0.1, 3);
    g.position.set((r() - 0.5) * 11, -1.62, -2 - r() * 10); g.scale.setScalar(0.9 + r() * 0.8);
    under.add(g);
  }
}
const rayTex = canvasTex(64, 256, (g, w, h) => {
  const gv = g.createLinearGradient(0, 0, 0, h); gv.addColorStop(0, 'rgba(255,255,255,1)'); gv.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gv; g.fillRect(0, 0, w, h); g.globalCompositeOperation = 'destination-in';
  const gh = g.createLinearGradient(0, 0, w, 0); gh.addColorStop(0, 'rgba(0,0,0,0)'); gh.addColorStop(0.5, 'rgba(0,0,0,1)'); gh.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = gh; g.fillRect(0, 0, w, h);
});
const rays = [];
for (let i = 0; i < 7; i++) {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(1.5 + rnd(i, 21) * 1.3, 24), new THREE.MeshBasicMaterial({ map: rayTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false, opacity: 0.12 }));
  under.add(m); rays.push({ m, x: -8 + i * 2.6 + rnd(i, 22), z: -5 - rnd(i, 23) * 8, ph: i * 1.7 });
}
const bubbleTex = canvasTex(128, 128, (g) => {
  g.strokeStyle = 'rgba(255,255,255,0.9)'; g.lineWidth = 7; g.fillStyle = 'rgba(255,255,255,0.1)';
  g.beginPath(); g.arc(64, 64, 56, 0, TAU); g.fill(); g.stroke();
  g.lineWidth = 9; g.lineCap = 'round'; g.beginPath(); g.arc(64, 64, 36, Math.PI * 1.1, Math.PI * 1.45); g.stroke();
});
const bubbles = [];
for (let i = 0; i < 40; i++) {
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: bubbleTex, transparent: true, depthWrite: false, opacity: 0.7 }));
  under.add(sp); bubbles.push({ sp, x: (rnd(i, 1) - 0.5) * 14, z: -8 + rnd(i, 2) * 10, v: 0.4 + rnd(i, 3) * 0.7, off: rnd(i, 4) * 12, s: 0.07 + rnd(i, 5) * 0.2 });
}
const dotTex = canvasTex(32, 32, (g) => {
  const gr = g.createRadialGradient(16, 16, 0, 16, 16, 16); gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 32, 32);
});
const MOTE = 450;
const moteGeo = new THREE.BufferGeometry(); moteGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(MOTE * 3), 3));
under.add(new THREE.Points(moteGeo, new THREE.PointsMaterial({ size: 0.05, map: dotTex, transparent: true, opacity: 0.6, depthWrite: false })));

// ------------------------------------------------------------------ 거북
const scuteTex = canvasTex(512, 256, (g, w, h) => {
  g.fillStyle = '#7d5b33'; g.fillRect(0, 0, w, h);
  const cells = [];
  for (let j = 0; j < 4; j++) for (let i = 0; i < 9; i++) cells.push([(i + (j % 2) * 0.5) / 9 * w, (j + 0.5) / 4 * h * 0.92]);
  for (const [x, y] of cells) {
    g.beginPath();
    for (let k = 0; k < 6; k++) { const a = k / 6 * TAU + Math.PI / 6; const xx = x + Math.cos(a) * w / 20, yy = y + Math.sin(a) * h / 9; if (k === 0) g.moveTo(xx, yy); else g.lineTo(xx, yy); }
    g.closePath();
    const gr = g.createRadialGradient(x, y, 0, x, y, w / 18); gr.addColorStop(0, '#c08b4e'); gr.addColorStop(1, '#8a6436');
    g.fillStyle = gr; g.fill(); g.strokeStyle = '#4a321a'; g.lineWidth = 5; g.stroke();
  }
});
const shellMat = new THREE.MeshPhysicalMaterial({ map: scuteTex, roughness: 0.45, clearcoat: 0.7, clearcoatRoughness: 0.25 });
const skinMat = new THREE.MeshPhysicalMaterial({ color: '#94b862', roughness: 0.5, sheen: 0.4, sheenColor: new THREE.Color('#d8f0a0') });
const plastronMat = new THREE.MeshPhysicalMaterial({ color: '#ead39a', roughness: 0.5 });
const darkMat = new THREE.MeshPhysicalMaterial({ color: '#1d1438', roughness: 0.15, clearcoat: 1 });
const shineMat = new THREE.MeshBasicMaterial({ color: '#ffffff' });
const eyeWhite = new THREE.MeshPhysicalMaterial({ color: '#ffffff', roughness: 0.12, clearcoat: 1 });
const blushMat = new THREE.MeshBasicMaterial({ color: '#ff7f9f', transparent: true, opacity: 0.5, depthWrite: false });

function makeTurtle(scale, parent) {
  const root = new THREE.Group(); parent.add(root);
  const body = new THREE.Group(); root.add(body);
  const shell = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 24, 0, TAU, 0, Math.PI / 2), shellMat);
  shell.scale.set(0.95, 0.46, 1.15); shell.castShadow = true; body.add(shell);
  const rim = new THREE.Mesh(new THREE.TorusGeometry(1, 0.05, 10, 64), new THREE.MeshStandardMaterial({ color: '#5e4426', roughness: 0.6 }));
  rim.rotation.x = Math.PI / 2; rim.scale.set(0.95, 1.15, 1); body.add(rim);
  const plast = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 16), plastronMat); plast.scale.set(0.88, 0.12, 1.06); plast.position.y = -0.02; body.add(plast);
  // 머리 (목 길이로 넣고 빼기)
  const neck = new THREE.Group(); neck.position.set(0, 0.06, 0.95); body.add(neck);
  const neckMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.18, 0.45, 18), skinMat);
  neckMesh.rotation.x = Math.PI / 2; neckMesh.position.z = 0.15; neck.add(neckMesh);
  const head = new THREE.Group(); head.position.set(0, 0.12, 0.45); neck.add(head);
  const headMesh = new THREE.Mesh(new THREE.SphereGeometry(0.27, 32, 24), skinMat); headMesh.scale.set(1, 0.86, 1.15); headMesh.castShadow = true; head.add(headMesh);
  const eyes = [];
  for (const sx of [-1, 1]) {
    const g = new THREE.Group(); g.position.set(0.145 * sx, 0.07, 0.17); head.add(g);
    g.quaternion.setFromUnitVectors(ZAXIS, V(0.55 * sx, 0.15, 0.82).normalize());
    g.add(new THREE.Mesh(new THREE.SphereGeometry(0.078, 20, 14), eyeWhite));
    const pupil = new THREE.Mesh(new THREE.SphereGeometry(0.05, 16, 12), darkMat); pupil.position.z = 0.058; pupil.scale.set(1, 1, 0.55); g.add(pupil);
    const h1 = new THREE.Mesh(new THREE.SphereGeometry(0.017, 8, 6), shineMat); h1.position.set(-0.016, 0.02, 0.087); g.add(h1);
    eyes.push(g);
    const b = new THREE.Mesh(new THREE.CircleGeometry(0.05, 16), blushMat);
    b.position.set(0.17 * sx, -0.04, 0.2); b.quaternion.setFromUnitVectors(ZAXIS, V(0.6 * sx, 0, 0.8).normalize()); b.scale.set(1.3, 0.8, 1); head.add(b);
  }
  const mouth = new THREE.Mesh(new THREE.TorusGeometry(0.07, 0.014, 8, 20, 2.2), darkMat);
  mouth.rotation.z = -(Math.PI / 2 + 1.1); mouth.position.set(0, -0.03, 0.305); head.add(mouth);
  // 지느러미
  const fGeo = new THREE.SphereGeometry(1, 20, 12);
  const flippers = [];
  for (const [sx, z, len, wid, front] of [[-1, 0.55, 0.75, 0.24, true], [1, 0.55, 0.75, 0.24, true], [-1, -0.75, 0.36, 0.17, false], [1, -0.75, 0.36, 0.17, false]]) {
    const pivot = new THREE.Group(); pivot.position.set(0.72 * sx, 0.02, z); body.add(pivot);
    const f = new THREE.Mesh(fGeo, skinMat); f.scale.set(len, 0.05, wid); f.position.set(len * 0.85 * sx, 0, front ? -0.1 : -0.06); f.castShadow = true;
    pivot.add(f); flippers.push({ pivot, sx, front });
  }
  const tail = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.25, 10), skinMat); tail.rotation.x = -Math.PI / 2; tail.position.set(0, 0, -1.18); body.add(tail);
  root.scale.setScalar(scale);
  return { root, body, neck, head, eyes, flippers };
}

function updateTurtle(T, P, t) {
  T.root.visible = P.visible;
  if (!P.visible) return;
  T.root.position.set(P.x, P.y, P.z);
  T.root.rotation.set(P.pitch || 0, P.yaw || 0, P.roll || 0);
  T.root.scale.setScalar(P.scale);
  T.neck.position.z = 0.95 - 0.38 * (P.retract || 0);
  T.head.rotation.set(P.nod || 0, P.turn || 0, 0);
  T.eyes.forEach((e) => { e.scale.set(1, P.blink ?? 1, 1); });
  const mode = P.mode || 'idle', ph = t * (P.speed || 1) + (P.off || 0);
  for (const f of T.flippers) {
    let rz = 0, ry = 0;
    if (mode === 'swim') {
      if (f.front) { rz = 0.65 * Math.sin(TAU * 0.55 * ph) * f.sx; ry = 0.35 * Math.cos(TAU * 0.55 * ph) * f.sx; }
      else { ry = 0.25 * Math.sin(TAU * 0.55 * ph + 1) * f.sx; }
    } else if (mode === 'crawl') {
      const s = f.front ? Math.sin(TAU * 1.0 * ph + (f.sx > 0 ? 0 : 0)) : Math.sin(TAU * 1.0 * ph + Math.PI);
      ry = 0.55 * s * f.sx; rz = 0.15 * Math.max(0, -s) * f.sx;
    } else if (mode === 'dig') {
      if (!f.front) ry = 0.5 * Math.sin(TAU * 0.8 * ph + (f.sx > 0 ? 0 : Math.PI)) * f.sx;
    } else {
      ry = 0.12 * Math.sin(TAU * 0.4 * ph) * f.sx;
    }
    f.pivot.rotation.set(0, ry, rz);
  }
  T.body.position.y = (mode === 'crawl') ? 0.03 * Math.abs(Math.sin(TAU * ph)) : 0;
}

const adult = makeTurtle(1.0, scene);
const HATCH_N = 8;
const hatchlings = [];
for (let i = 0; i < HATCH_N; i++) hatchlings.push(makeTurtle(1.0, scene));

// ------------------------------------------------------------------ 알 + 둥지
const eggMat = new THREE.MeshPhysicalMaterial({ color: '#fbf7ee', roughness: 0.35, clearcoat: 0.6, emissive: '#000000' });
const eggs = [];
{
  const spots = [[-0.32, 0.02, 0.05], [-0.12, 0.0, 0.18], [0.1, 0.0, 0.2], [0.3, 0.02, 0.06], [-0.24, 0.02, -0.18], [0.0, -0.02, -0.04], [0.22, 0.02, -0.2],
    [-0.05, 0.03, -0.3], [-0.18, 0.18, 0.0], [0.08, 0.2, 0.04], [0.26, 0.17, -0.06], [-0.04, 0.2, -0.18]];
  for (let i = 0; i < spots.length; i++) {
    const m = new THREE.Mesh(new THREE.SphereGeometry(0.11, 20, 14), eggMat.clone());
    m.position.set(spots[i][0], spots[i][1] - 0.08, spots[i][2]); m.castShadow = true; beach.add(m);
    eggs.push({ m, base: m.position.clone(), i });
  }
}
// 깨지는 알 (위/아래 반쪽)
const hatchEgg = new THREE.Group();
const eggBot = new THREE.Mesh(new THREE.SphereGeometry(0.115, 20, 12, 0, TAU, Math.PI / 2, Math.PI / 2), eggMat);
const eggTop = new THREE.Mesh(new THREE.SphereGeometry(0.115, 20, 12, 0, TAU, 0, Math.PI / 2), eggMat);
hatchEgg.add(eggBot, eggTop); hatchEgg.position.set(0.02, 0.2, 0.32); beach.add(hatchEgg);

// 온도계
const thermo = new THREE.Group();
{
  const glass = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.95, 20, 1, true), new THREE.MeshPhysicalMaterial({ color: '#ffffff', transparent: true, opacity: 0.35, roughness: 0.05, clearcoat: 1, side: THREE.DoubleSide, depthWrite: false }));
  glass.position.y = 0.6; thermo.add(glass);
  const cap = new THREE.Mesh(new THREE.SphereGeometry(0.07, 16, 10, 0, TAU, 0, Math.PI / 2), glass.material); cap.position.y = 1.075; thermo.add(cap);
  const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.12, 20, 14), new THREE.MeshPhysicalMaterial({ color: '#ff3b3b', emissive: '#c01818', emissiveIntensity: 0.5, roughness: 0.2, clearcoat: 1 }));
  bulb.position.y = 0.1; thermo.add(bulb);
  const col = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 1, 12), bulb.material); col.position.y = 0.1; thermo.add(col);
  thermo.userData.col = col;
  for (let k = 0; k < 7; k++) { const tk = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.012, 0.01), new THREE.MeshBasicMaterial({ color: '#333' })); tk.position.set(0.075, 0.25 + k * 0.12, 0.03); thermo.add(tk); }
  thermo.position.set(0.95, -0.02, 0.15);
  thermo.visible = false;
  thermo.traverse((o) => { o.castShadow = true; });
  beach.add(thermo);
}

// 눈물
const tearMat = new THREE.MeshPhysicalMaterial({ color: '#cfefff', transparent: true, opacity: 0.85, roughness: 0.05, clearcoat: 1, emissive: '#6fbfff', emissiveIntensity: 0.25 });
const tears = [];
for (let i = 0; i < 12; i++) { const m = new THREE.Mesh(new THREE.SphereGeometry(0.022, 12, 8), tearMat); m.scale.set(1, 1.5, 1); scene.add(m); tears.push(m); }

// 물음표
const PROP = {};
function buildProps(font) {
  const qg = new TextGeometry('?', { font, size: 1.0, depth: 0.32, curveSegments: 10, bevelEnabled: true, bevelThickness: 0.08, bevelSize: 0.025, bevelSegments: 3 });
  qg.center();
  PROP.q = new THREE.Mesh(qg, new THREE.MeshPhysicalMaterial({ color: '#ffd23f', roughness: 0.22, clearcoat: 1, emissive: '#7a5200', emissiveIntensity: 0.25 }));
  scene.add(PROP.q);
}

// ------------------------------------------------------------------ 갱신
function blinkAt(t, off) { const bt = (t + off) % 3.4; return bt < 0.14 ? Math.max(0.1, 1 - Math.sin(Math.PI * bt / 0.14)) : 1; }
const WARM = new THREE.Color('#ff8a5a'), COOL = new THREE.Color('#5aaeff'), BLACK = new THREE.Color('#000000');

function updateBeachSet(t, C, anchors) {
  // 바다 물결 + 파도 거품
  const p = seaGeo.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = seaBase[i * 3], z = seaBase[i * 3 + 2];
    p.setY(i, -0.24 + 0.05 * Math.sin(x * 0.6 + t * 1.3) + 0.04 * Math.sin(z * 0.9 - t * 1.7) + 0.02 * Math.sin((x + z) * 2 + t * 2.4));
  }
  p.needsUpdate = true; seaGeo.computeVertexNormals();
  const wave = Math.sin(t * 0.9);
  foam.position.set(0, -0.16 + 0.02 * wave, SHORE_Z + 0.35 + 0.35 * wave);
  foamTex.offset.x = t * 0.02;
  foam.material.opacity = 0.75 + 0.25 * wave;
  wetSand.position.set(0, -0.15, SHORE_Z + 0.9 + 0.2 * wave);
  // 알
  const wig = smooth(C.WIGGLE[0], C.WIGGLE[0] + 0.3, t) * (1 - smooth(C.WIGGLE[1] - 0.1, C.WIGGLE[1], t));
  const warm = smooth(C.WARM[0], C.WARM[0] + 0.3, t) * (1 - smooth(C.WARM[1] - 0.15, C.WARM[1] + 0.1, t));
  const cool = smooth(C.COOL[0], C.COOL[0] + 0.3, t) * (1 - smooth(C.COOL[1] - 0.15, C.COOL[1] + 0.1, t));
  const gone = t >= C.RUN[0] + 1.2;   // 아기들이 다 나가면 빈 둥지
  for (const e of eggs) {
    e.m.visible = !gone;
    const j = wig * (e.i % 3 === 0 ? 1 : 0.4);
    e.m.rotation.set(0.25 * j * Math.sin(t * 18 + e.i), 0, 0.25 * j * Math.sin(t * 15 + e.i * 2));
    e.m.position.copy(e.base);
    const left = e.base.x < 0.02, right = e.base.x > -0.02;
    const c = BLACK.clone().lerp(WARM, left ? warm : 0).lerp(COOL, right ? cool : 0);
    e.m.material.emissive.copy(c); e.m.material.emissiveIntensity = 0.75;
  }
  // 깨지는 알
  const h = prog(t, C.HATCH[0], C.HATCH[1]);
  hatchEgg.rotation.set(0.3 * wig * Math.sin(t * 20), 0, 0.3 * wig * Math.sin(t * 17));
  eggTop.position.set(0.12 * easeOut(h), 0.03 + 0.25 * Math.sin(Math.PI * Math.min(h, 1)) * (h < 1 ? 1 : 0) - (h >= 1 ? 0 : 0), 0.05 * h);
  eggTop.rotation.set(0, 0, -1.6 * easeOut(h));
  if (h >= 1) { eggTop.position.set(0.2, -0.08, 0.06); eggTop.rotation.set(0, 0, -2.6); }
  hatchEgg.visible = t < C.RUN[0] + 0.3;
  // 온도계
  const th = easeBack(prog(t, C.THERMO[0], C.THERMO[0] + 0.4), 1.8) * (1 - easeIn(prog(t, C.THERMO[1] - 0.25, C.THERMO[1])));
  thermo.visible = false; thermo.scale.setScalar(Math.max(th, 0.001));
  const level = 0.45 + 0.4 * warm - 0.3 * cool;
  thermo.userData.col.scale.y = level; thermo.userData.col.position.y = 0.1 + level / 2;
  if (thermo.visible) anchors.thermo = project(thermo.localToWorld(V(0, 1.15, 0)));
  anchors.eggs_warm = project(V(-0.2, 0.25, 0));
  anchors.eggs_cool = project(V(0.22, 0.25, 0));
  anchors.nest = project(V(0, 0.15, 0.1));
}

function hatchPose(i, t, C) {
  // 0번은 깨진 알에서 고개를 내밀고, 나머지는 RUN 때 둥지에서 나와 바다로
  const [r0, r1] = C.RUN;
  const start = r0 + (i === 0 ? 0.0 : 0.12 * i);
  const a = prog(t, start, start + 2.4 + 0.15 * rnd(i, 3));
  const x0 = (rnd(i, 1) - 0.5) * 0.5, z0 = (rnd(i, 2) - 0.5) * 0.3;
  const x1 = x0 * 3.2 + (rnd(i, 4) - 0.5) * 1.5, z1 = SHORE_Z - 0.2;
  if (t < start) {
    if (i === 0 && t >= C.HATCH[0]) {
      const pop = easeBack(prog(t, C.HATCH[0] + 0.05, C.HATCH[1] + 0.1), 2.2);
      return { visible: true, x: 0.02, y: 0.16 + 0.07 * pop, z: 0.34, scale: 0.11 * (0.6 + 0.4 * pop), yaw: 0, pitch: -0.45, mode: 'idle', blink: blinkAt(t, 0.5), off: i };
    }
    return { visible: false };
  }
  const x = lerp(x0, x1, a), z = lerp(z0, z1, easeIO(a));
  const yEmerge = smooth(0, 0.08, a);
  const sink = smooth(0.85, 1.0, a);
  return { visible: a < 1 && t < r1 + 0.6, x, y: -0.15 + 0.17 * yEmerge - 0.15 * sink + 0.02 * Math.abs(Math.sin(t * 9 + i)), z,
    scale: 0.12, yaw: Math.PI + Math.atan2(x1 - x0, -(z1 - z0)) * 0.3, mode: 'crawl', speed: 2.4, off: i * 0.3, blink: 1 };
}

function adultPose(t, C) {
  if (t >= 22.6) {
    // 바닷속: 옆모습으로 헤엄
    const rt = C.RETRACT;
    const r1 = bumpPulse(t, rt[0], rt[0] + 0.7), r2 = bumpPulse(t, rt[0] + 1.0, rt[0] + 1.7);
    const shake = (t >= rt[0] && t < rt[1]) ? 0.05 * Math.sin(t * 40) : 0;
    return { visible: true, x: -0.35, y: 1.1 + 0.12 * Math.sin(t * 1.1), z: 0, scale: 0.95, yaw: Math.PI / 2 - 0.55, pitch: 0, roll: 0.08 * Math.sin(t * 1.1),
      mode: 'swim', speed: 1, retract: 0.75 * Math.max(r1, r2), turn: shake, nod: 0, blink: blinkAt(t, 0.9) };
  }
  const [s0, s1] = C.RETURN;
  if (t < s0) return { visible: false };
  const emerge = easeOut(prog(t, s0, s0 + 1.0));
  const crawl = prog(t, s0 + 0.6, s1);
  const z = lerp(SHORE_Z - 2.6, -1.25, easeIO(crawl));
  const y = lerp(-0.45, 0.05, emerge) - 0.06 * smooth(-2.4, -1.6, z) * 0;
  const P = { visible: true, x: 0.1, y, z, scale: 1.0, yaw: 0, pitch: lerp(0.15, 0.04, emerge), mode: crawl < 1 ? 'crawl' : 'dig', speed: 0.8,
    nod: 0.12, blink: blinkAt(t, 0.9) };
  if (t >= 16.6) { P.z = -1.25; P.mode = 'dig'; P.nod = 0.2; }
  return P;
}
function bumpPulse(t, a, b) { return Math.sin(Math.PI * prog(t, a, b)); }

function updateUnderSet(t) {
  for (const b of bubbles) { b.sp.position.set(b.x + 0.15 * Math.sin(t * 1.7 + b.off), -1.6 + ((t * b.v + b.off) % 10), b.z); b.sp.scale.setScalar(b.s); }
  const p = moteGeo.attributes.position.array;
  for (let i = 0; i < MOTE; i++) {
    p[i * 3] = ((rnd(i, 11) * 18 - t * (0.25 + 0.2 * rnd(i, 15))) % 18 + 18) % 18 - 9;
    p[i * 3 + 1] = -1.4 + rnd(i, 12) * 7 + 0.1 * Math.sin(t * 0.5 + i);
    p[i * 3 + 2] = -10 + rnd(i, 14) * 12;
  }
  moteGeo.attributes.position.needsUpdate = true;
  for (const r of rays) { r.m.position.set(r.x + 0.5 * Math.sin(t * 0.35 + r.ph), 11, r.z); r.m.rotation.set(0, 0, 0.3 + 0.04 * Math.sin(t * 0.3 + r.ph)); }
}

window.renderFrame = (S, opts = {}) => {
  const t = S.t, C = S.cues;
  causticTime.value = t;
  const isUnder = t >= 22.6;
  beach.visible = !isUnder; under.visible = isUnder;
  scene.background = isUnder ? underBg : sunsetBg;
  scene.fog = isUnder ? underFog : sunsetFog;
  scene.environment = isUnder ? null : sunsetEnv;
  if (isUnder) {
    hemi.color.set('#d8f6ff'); hemi.groundColor.set('#2a6f8a'); hemi.intensity = 1.1;
    key.color.set('#e8f8ff'); key.intensity = 2.0; key.position.set(-2, 10, 5);
    back.color.set('#8fe4ff'); back.intensity = 1.0;
  } else {
    hemi.color.set('#ffd9b0'); hemi.groundColor.set('#c99a6a'); hemi.intensity = 1.05;
    key.color.set('#ffd2a1'); key.intensity = 2.4; key.position.set(-4, 6, 6);
    back.color.set('#ff9a6a'); back.intensity = 1.3;
  }
  setCamera(t, C);
  const anchors = {};
  if (!isUnder) updateBeachSet(t, C, anchors); else updateUnderSet(t);
  // 아기 거북
  hatchlings.forEach((h, i) => {
    let P;
    if (isUnder) {
      const o = prog(t, C.OUTRO[0] + i * 0.08, C.OUTRO[1] + i * 0.08);
      const show = i < 4 && t >= C.OUTRO[0];
      const ang = i * 1.6 + 0.4;
      P = { visible: show, x: lerp(-4.5, -1.6 + 3.3 * (i / 3), easeOut(o)), y: 1.9 + 0.55 * Math.sin(ang) + 0.1 * Math.sin(t * 1.5 + i), z: 0.6 + 0.4 * Math.cos(ang),
        scale: 0.24, yaw: Math.PI / 2 - 0.4, mode: 'swim', speed: 1.6, off: i, blink: 1 };
    } else P = hatchPose(i, t, C);
    updateTurtle(h, P, t);
  });
  // 어른 거북
  const AP = adultPose(t, C);
  updateTurtle(adult, AP, t);
  adult.root.updateMatrixWorld(true);
  if (AP.visible) {
    anchors.head = project(adult.head.getWorldPosition(V(0, 0, 0)).add(V(0, 0.12, 0)));
    anchors.eyeL = project(adult.eyes[0].getWorldPosition(V(0, 0, 0)));
    anchors.eyeR = project(adult.eyes[1].getWorldPosition(V(0, 0, 0)));
  }
  // 눈물
  const [e0, e1] = C.TEARS;
  tears.forEach((m, i) => {
    const eye = adult.eyes[i % 2];
    const cyc = 1.1, off = Math.floor(i / 2) * cyc / 6;
    const a = (((t - e0) + off) % cyc) / cyc;
    m.visible = !isUnder && t >= e0 && t < e1 && AP.visible;
    if (!m.visible) return;
    const p0 = eye.localToWorld(V(0.03 * (i % 2 ? 1 : -1), -0.05, 0.05));
    m.position.copy(p0).add(V(0, -0.38 * easeIn(a), 0.06 * a));
    m.scale.set(1, 1.5 + a, 1).multiplyScalar(0.9 + 0.3 * (1 - a));
  });
  // 물음표
  if (PROP.q) {
    const qa = prog(t, 0.9, 1.35), qo = prog(t, 3.37, 3.55);
    const qs = (0.4 + 0.6 * easeBack(qa, 2.2)) * Math.min(1, qa * 2.5) * (1 - qo);
    PROP.q.visible = t >= 0.9 && t < 3.55 && qs > 0.01;
    if (PROP.q.visible) {
      const p = screenToWorld(540, 830 + 12 * Math.sin(t * 4), 3.0);
      PROP.q.position.copy(p);
      PROP.q.scale.setScalar(qs * 150 / (0.72 * pxPerUnitAt(p)));
      PROP.q.quaternion.copy(camera.quaternion);
      PROP.q.rotateY(Math.sin(t * 2.2) * 0.6); PROP.q.rotateZ(0.14 * Math.sin(t * 3.1));
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
