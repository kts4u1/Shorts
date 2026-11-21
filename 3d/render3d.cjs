// three.js 장면을 헤드리스 Chromium(SwiftShader WebGL)으로 프레임 단위 렌더링.
//   node 3d/render3d.cjs --states build/states3d.json --out build/frames3d [--workers 3] [--png]
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const args = process.argv.slice(2);
const opt = (name, def) => { const i = args.indexOf('--' + name); return i >= 0 ? args[i + 1] : def; };
const flag = (name) => args.includes('--' + name);
const ROOT = __dirname;
const THREE_DIR = path.join(ROOT, 'node_modules', 'three');

async function renderPart(states, outDir, part, of, png) {
  const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const page = await browser.newPage({ viewport: { width: 1080, height: 1920 } });
  page.on('pageerror', (e) => console.error('pageerror:', e.message));
  page.on('console', (m) => { if (m.type() === 'error') console.error('console:', m.text()); });
  await page.route('http://r.local/**', (route) => {
    const p = new URL(route.request().url()).pathname;
    const f = p.startsWith('/three/') ? path.join(THREE_DIR, p.slice(7)) : path.join(ROOT, p === '/' ? 'index.html' : p);
    const type = f.endsWith('.js') ? 'text/javascript' : f.endsWith('.json') ? 'application/json' : 'text/html';
    route.fulfill({ body: fs.readFileSync(f), contentType: type });
  });
  await page.goto('http://r.local/index.html');
  await page.waitForFunction(() => window.ready || window.loadError, null, { timeout: 120000 });
  const err = await page.evaluate(() => window.loadError);
  if (err) throw new Error(err);
  const mine = states.filter((s, k) => k % of === part);
  let n = 0;
  const t0 = Date.now();
  for (const s of mine) {
    const res = await page.evaluate(([st, p]) => window.renderFrame(st, { png: p }), [s, png]);
    const ext = png ? 'png' : 'jpg';
    const name = String(s.index).padStart(4, '0');
    fs.writeFileSync(path.join(outDir, `f_${name}.${ext}`), Buffer.from(res.img.split(',')[1], 'base64'));
    fs.writeFileSync(path.join(outDir, `a_${name}.json`), JSON.stringify(res.anchors));
    n++;
    if (n % 25 === 0) console.log(`[part ${part}] ${n}/${mine.length}  ${((Date.now() - t0) / n).toFixed(0)}ms/frame`);
  }
  await browser.close();
}

(async () => {
  const statesPath = opt('states', 'build/states3d.json');
  const outDir = opt('out', 'build/frames3d');
  const workers = parseInt(opt('workers', '3'), 10);
  const png = flag('png');
  fs.mkdirSync(outDir, { recursive: true });
  if (opt('part', null) !== null) {
    const states = JSON.parse(fs.readFileSync(statesPath, 'utf8'));
    await renderPart(states, outDir, parseInt(opt('part'), 10), parseInt(opt('of'), 10), png);
    return;
  }
  const procs = [];
  for (let k = 0; k < workers; k++) {
    const a = [__filename, '--states', statesPath, '--out', outDir, '--part', String(k), '--of', String(workers)];
    if (png) a.push('--png');
    const p = spawn(process.execPath, a, { stdio: 'inherit' });
    procs.push(new Promise((res, rej) => p.on('exit', (c) => (c === 0 ? res() : rej(new Error('worker ' + k + ' exit ' + c))))));
  }
  await Promise.all(procs);
  console.log('3D 프레임 렌더 완료:', outDir);
})().catch((e) => { console.error(e); process.exit(1); });
