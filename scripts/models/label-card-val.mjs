#!/usr/bin/env node
/**
 * Keyboard-speed labelling of card photos for the card model's real-photo
 * validation set (training/HANDOFF-card-and-centering.md, Step 10.3).
 *
 * Shoot cards with the phone's own camera (front, back, whatever, any surface,
 * some crooked, some rotated, some bowed, some in sleeves), copy the photos to
 * a folder on the PC (iPhone HEIC is fine: it is converted once into
 * <photos>/_converted/), then:
 *
 *   node scripts/models/label-card-val.mjs --photos "C:/path/to/photos" [--out training/data/card-val] [--port 5210]
 *
 * A page opens with each photo. If the app's bounds detector finds something
 * card-shaped it is drawn as the suggestion; otherwise (textured tables fool
 * it) the outline is empty and you click the four corners in any order — the
 * clicks are sorted into TL/TR/BR/BL. Drag a corner to adjust. Keys:
 *   Enter  accept and next        C  clear (click again)     R  suggestion
 *   S  skip     B / V / X  toggle a tag: bowed / sleeved / deliberately bad
 *   Backspace  previous photo
 * Each accepted photo is written as <out>/<name>/front.jpg (long side capped
 * at 2000 px, the app's upload size) + labels.json in the same shape the app's
 * "Keep Originals For Training" toggle produces, so the two sources merge.
 */
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { createCanvas, Image } from 'canvas';
import heicConvert from 'heic-convert';

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(here, '..', '..');
const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
const PHOTOS = opt('--photos', null);
const OUT = path.resolve(ROOT, opt('--out', 'training/data/card-val'));
const PORT = Number(opt('--port', 5210));
const MAX_PX = 2000;
if (!PHOTOS || !fs.existsSync(PHOTOS)) { console.error('pass --photos <folder of jpg/png/heic-converted photos>'); process.exit(1); }

const stem = (f) => path.basename(f).replace(/\.[^.]+$/, '').replace(/[^A-Za-z0-9_-]+/g, '_');
const isPhoto = (f) => /\.(jpe?g|png|webp|heic|heif)$/i.test(f);
const isHeic = (f) => /\.(heic|heif)$/i.test(f);
const CONVERTED = path.join(PHOTOS, '_converted');
const listPhotos = () => fs.readdirSync(PHOTOS).filter(isPhoto).sort().map((f) => ({ file: f, name: stem(f), done: fs.existsSync(path.join(OUT, stem(f), 'labels.json')) }));

/** Path of a photo the browser and node-canvas can read; HEIC is converted once and cached. */
const converting = new Map();
async function readablePath(file) {
  const src = path.join(PHOTOS, path.basename(file));
  if (!isHeic(file)) return src;
  const dst = path.join(CONVERTED, stem(file) + '.jpg');
  if (fs.existsSync(dst)) return dst;
  if (!converting.has(dst)) {
    converting.set(dst, (async () => {
      fs.mkdirSync(CONVERTED, { recursive: true });
      const jpg = await heicConvert({ buffer: fs.readFileSync(src), format: 'JPEG', quality: 0.92 });
      fs.writeFileSync(dst, Buffer.from(jpg));
      console.log(`converted ${path.basename(file)} -> _converted/${path.basename(dst)}`);
      return dst;
    })().finally(() => converting.delete(dst)));
  }
  return converting.get(dst);
}

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.json': 'application/json' };

async function saveLabel(body) {
  const { file, corners, imageWidth, imageHeight, tags } = body;
  const src = await readablePath(file);
  const img = new Image(); img.src = fs.readFileSync(src);
  const s = Math.min(1, MAX_PX / Math.max(img.width, img.height));
  const w = Math.round(img.width * s), h = Math.round(img.height * s);
  const c = createCanvas(w, h); const ctx = c.getContext('2d'); ctx.imageSmoothingQuality = 'high'; ctx.drawImage(img, 0, 0, w, h);
  const dir = path.join(OUT, stem(file)); fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'front.jpg'), c.toBuffer('image/jpeg', { quality: 0.92 }));
  const labels = {
    version: 1, capturedAt: new Date().toISOString(), source: 'label-card-val', originalFile: path.basename(file), tags: tags || [],
    sides: { front: { corners, imageWidth: w, imageHeight: h, labelledOn: { width: imageWidth, height: imageHeight }, rotation: 0, measureMode: 'corner', lrRatio: null, tbRatio: null } },
  };
  fs.writeFileSync(path.join(dir, 'labels.json'), JSON.stringify(labels, null, 2));
  return { dir: path.relative(ROOT, dir), width: w, height: h };
}

const PAGE = String.raw`<!doctype html><html><head><meta charset="utf-8"><title>label card-val</title>
<style>
body{margin:0;background:#111;color:#ddd;font:13px system-ui;display:flex;flex-direction:column;height:100vh}
#bar{padding:8px 12px;display:flex;gap:16px;align-items:center;background:#1a1a1a}
#stage{flex:1;position:relative;overflow:hidden}
canvas{position:absolute;left:0;top:0}
.tag{padding:2px 8px;border:1px solid #444;border-radius:4px;color:#888}.tag.on{border-color:#6ede82;color:#6ede82}
kbd{background:#333;padding:1px 5px;border-radius:3px}
</style></head><body>
<div id="bar"><span id="count"></span><span id="name"></span><span class="tag" id="tag-bowed">B bowed</span><span class="tag" id="tag-sleeve">V sleeved</span><span class="tag" id="tag-bad">X bad photo</span>
<span id="hint" style="color:#e0a040"></span><span style="margin-left:auto;color:#777"><kbd>Enter</kbd> accept · click 4 corners · <kbd>C</kbd> clear · <kbd>R</kbd> suggestion · <kbd>S</kbd> skip · <kbd>Backspace</kbd> back</span></div>
<div id="stage"><canvas id="c"></canvas></div>
<script type="module">
import { findBounds } from '/src/lib/detectors.js';
const stage = document.getElementById('stage'), cv = document.getElementById('c'), ctx = cv.getContext('2d');
let photos = [], idx = 0, img = null, quad = null, sugg = null, tags = new Set(), scale = 1, drag = null, clicks = [];
const CARD_ASPECT = 2.5 / 3.5;
function plausible(q) {
  if (!q) return false;
  const w = q.tr.x - q.tl.x, h = q.bl.y - q.tl.y, W = img.naturalWidth, H = img.naturalHeight;
  const fill = (w * h) / (W * H), asp = w / h;
  return fill > 0.08 && fill < 0.85 && (Math.abs(asp - CARD_ASPECT) < 0.15 || Math.abs(asp - 1 / CARD_ASPECT) < 0.3);
}
function quadFromClicks(pts) {
  // sort four points into TL, TR, BR, BL by angle around their centre
  const cx = pts.reduce((s, p) => s + p.x, 0) / 4, cy = pts.reduce((s, p) => s + p.y, 0) / 4;
  const sorted = [...pts].sort((a, b) => Math.atan2(a.y - cy, a.x - cx) - Math.atan2(b.y - cy, b.x - cx));
  const i0 = sorted.findIndex((p) => p.x < cx && p.y < cy); // start at the top-left-most
  const r = i0 >= 0 ? [...sorted.slice(i0), ...sorted.slice(0, i0)] : sorted;
  return { tl: r[0], tr: r[1], br: r[2], bl: r[3] };
}
async function load() { photos = await (await fetch('/api/photos')).json(); idx = photos.findIndex((p) => !p.done); if (idx < 0) idx = 0; show(); }
function fit() { const W = stage.clientWidth, H = stage.clientHeight; scale = Math.min(W / img.naturalWidth, H / img.naturalHeight); cv.width = Math.round(img.naturalWidth * scale); cv.height = Math.round(img.naturalHeight * scale); cv.style.left = Math.round((W - cv.width) / 2) + 'px'; }
function suggest() {
  const w = 700, h = Math.round(img.naturalHeight * 700 / img.naturalWidth);
  const t = document.createElement('canvas'); t.width = w; t.height = h; const tc = t.getContext('2d'); tc.drawImage(img, 0, 0, w, h);
  const b = findBounds(tc.getImageData(0, 0, w, h).data, w, h);
  const k = img.naturalWidth / w;
  return { tl: { x: b.left * k, y: b.top * k }, tr: { x: b.right * k, y: b.top * k }, br: { x: b.right * k, y: b.bottom * k }, bl: { x: b.left * k, y: b.bottom * k } };
}
async function show() {
  const p = photos[idx]; if (!p) return;
  document.getElementById('count').textContent = (idx + 1) + ' / ' + photos.length + '  (' + photos.filter((x) => x.done).length + ' done)';
  document.getElementById('name').textContent = p.file + (p.done ? '  ✓ labelled' : '');
  img = new Image(); await new Promise((r) => { img.onload = r; img.src = '/photo/' + encodeURIComponent(p.file); });
  fit(); sugg = suggest(); clicks = []; tags = new Set();
  quad = plausible(sugg) ? JSON.parse(JSON.stringify(sugg)) : null;
  draw();
}
function draw() {
  ctx.drawImage(img, 0, 0, cv.width, cv.height);
  if (quad) {
    const pts = ['tl', 'tr', 'br', 'bl'].map((k) => [quad[k].x * scale, quad[k].y * scale]);
    ctx.lineWidth = 2; ctx.strokeStyle = '#6ede82'; ctx.beginPath(); pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.closePath(); ctx.stroke();
    for (const [x, y] of pts) { ctx.fillStyle = '#6ede82'; ctx.beginPath(); ctx.arc(x, y, 7, 0, 7); ctx.fill(); }
  } else {
    for (const p of clicks) { ctx.fillStyle = '#ffcc00'; ctx.beginPath(); ctx.arc(p.x * scale, p.y * scale, 7, 0, 7); ctx.fill(); }
  }
  document.getElementById('hint').textContent = quad ? '' : 'click the card corners (' + clicks.length + '/4)';
  for (const t of ['bowed', 'sleeve', 'bad']) document.getElementById('tag-' + t).classList.toggle('on', tags.has(t));
}
cv.addEventListener('pointerdown', (e) => {
  const r = cv.getBoundingClientRect(); const x = (e.clientX - r.left) / scale, y = (e.clientY - r.top) / scale;
  if (!quad) { clicks.push({ x, y }); if (clicks.length === 4) quad = quadFromClicks(clicks); draw(); return; }
  let best = null, bd = 1e9; for (const k of ['tl', 'tr', 'br', 'bl']) { const d = Math.hypot(quad[k].x - x, quad[k].y - y); if (d < bd) { bd = d; best = k; } }
  if (bd * scale < 40) { drag = best; cv.setPointerCapture(e.pointerId); }
});
cv.addEventListener('pointermove', (e) => { if (!drag) return; const r = cv.getBoundingClientRect(); quad[drag] = { x: Math.max(0, Math.min(img.naturalWidth, (e.clientX - r.left) / scale)), y: Math.max(0, Math.min(img.naturalHeight, (e.clientY - r.top) / scale)) }; draw(); });
cv.addEventListener('pointerup', () => { drag = null; });
async function accept() {
  if (!quad) { document.getElementById('hint').textContent = 'click all four corners first'; return; }
  const p = photos[idx]; const W = img.naturalWidth, H = img.naturalHeight;
  const corners = Object.fromEntries(Object.entries(quad).map(([k, v]) => [k, { x: v.x / W, y: v.y / H }]));
  const res = await fetch('/api/label', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ file: p.file, corners, imageWidth: W, imageHeight: H, tags: [...tags] }) });
  if (!res.ok) { alert('save failed: ' + await res.text()); return; }
  p.done = true; next();
}
function next() { if (idx < photos.length - 1) { idx++; show(); } else { document.getElementById('name').textContent = 'all photos labelled'; } }
window.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') accept(); else if (e.key === 'r' || e.key === 'R') { quad = JSON.parse(JSON.stringify(sugg)); clicks = []; draw(); }
  else if (e.key === 'c' || e.key === 'C') { quad = null; clicks = []; draw(); }
  else if (e.key === 's' || e.key === 'S') next(); else if (e.key === 'Backspace') { if (idx > 0) { idx--; show(); } }
  else if (e.key === 'b' || e.key === 'B') { tags.has('bowed') ? tags.delete('bowed') : tags.add('bowed'); draw(); }
  else if (e.key === 'v' || e.key === 'V') { tags.has('sleeve') ? tags.delete('sleeve') : tags.add('sleeve'); draw(); }
  else if (e.key === 'x' || e.key === 'X') { tags.has('bad') ? tags.delete('bad') : tags.add('bad'); draw(); }
});
window.addEventListener('resize', () => { if (img) { fit(); draw(); } });
load();
</script></body></html>`;

const server = http.createServer(async (req, res) => {
  const url = decodeURIComponent(req.url.split('?')[0]);
  try {
    if (url === '/' || url === '/index.html') { res.writeHead(200, { 'Content-Type': 'text/html' }); return res.end(PAGE); }
    if (url === '/api/photos') { res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify(listPhotos())); }
    if (url === '/api/label' && req.method === 'POST') {
      let body = ''; for await (const chunk of req) body += chunk;
      const out = await saveLabel(JSON.parse(body));
      console.log(`labelled ${out.dir} (${out.width}x${out.height})`);
      res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify(out));
    }
    if (url.startsWith('/photo/')) { const name = path.basename(url.slice(7)); if (!fs.existsSync(path.join(PHOTOS, name))) { res.writeHead(404); return res.end(); } const f = await readablePath(name); res.writeHead(200, { 'Content-Type': MIME[path.extname(f).toLowerCase()] || 'application/octet-stream' }); return fs.createReadStream(f).pipe(res); }
    if (url.startsWith('/src/')) { const f = path.join(ROOT, url); if (!fs.existsSync(f)) { res.writeHead(404); return res.end(); } res.writeHead(200, { 'Content-Type': 'text/javascript' }); return fs.createReadStream(f).pipe(res); }
    res.writeHead(404); res.end();
  } catch (e) { res.writeHead(500); res.end(String(e?.message || e)); }
});
server.listen(PORT, () => {
  const photos = listPhotos();
  console.log(`label-card-val: ${photos.length} photos in ${PHOTOS} (${photos.filter((p) => p.done).length} already labelled) -> ${path.relative(ROOT, OUT)}`);
  console.log(`open http://localhost:${PORT}/  (Ctrl+C when done)`);
  if (!args.includes('--no-open')) execFile(process.platform === 'win32' ? 'cmd' : 'open', process.platform === 'win32' ? ['/c', 'start', '', `http://localhost:${PORT}/`] : [`http://localhost:${PORT}/`], () => {});
});
