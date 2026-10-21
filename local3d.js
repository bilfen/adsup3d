// Görselin kendi şeklini çıkarır (Depth Anything). Düz kart üretmez.
// Motor sayfa açılınca bir kez iner (~19 MB, WebGPU) ve tarayıcıda kalır.

import * as THREE from "three";

const TJS = "https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1";
const MODEL = "onnx-community/depth-anything-v2-small";

let _progressLog = null;
let pipePromise = null;

export function local3dProgress(cb) {
  _progressLog = cb || null;
}

function notify(msg) {
  if (_progressLog) _progressLog(msg);
}

export function preloadRelief() {
  return getPipe().catch(() => {});
}

function getPipe() {
  if (!pipePromise) {
    pipePromise = createPipe().catch((e) => {
      pipePromise = null;
      throw e;
    });
  }
  return pipePromise;
}

async function createPipe() {
  const { pipeline } = await import(/* @vite-ignore */ TJS);
  const progress_callback = (p) => {
    if (p && p.status === "progress" && p.total) {
      notify("3D motoru hazırlanıyor… %" + Math.round((100 * p.loaded) / p.total));
    }
  };
  if (navigator.gpu) {
    try {
      const pipe = await pipeline("depth-estimation", MODEL, { device: "webgpu", dtype: "q4f16", progress_callback });
      notify("3D motoru hazır");
      return pipe;
    } catch (e) { /* wasm */ }
  }
  const pipe = await pipeline("depth-estimation", MODEL, { device: "wasm", dtype: "q8", progress_callback });
  notify("3D motoru hazır");
  return pipe;
}

function maskFromBorder(data, W, H) {
  const n = W * H;
  const samples = [];
  const take = (x, y) => {
    const i = (y * W + x) * 4;
    samples.push(data[i], data[i + 1], data[i + 2]);
  };
  const sx = Math.max(1, (W / 18) | 0);
  const sy = Math.max(1, (H / 18) | 0);
  for (let x = 0; x < W; x += sx) { take(x, 0); take(x, H - 1); }
  for (let y = 0; y < H; y += sy) { take(0, y); take(W - 1, y); }
  let r = 0, g = 0, b = 0;
  const c = samples.length / 3;
  for (let i = 0; i < samples.length; i += 3) { r += samples[i]; g += samples[i + 1]; b += samples[i + 2]; }
  r /= c; g /= c; b /= c;
  let vari = 0;
  for (let i = 0; i < samples.length; i += 3) {
    const dr = samples[i] - r, dg = samples[i + 1] - g, db = samples[i + 2] - b;
    vari += dr * dr + dg * dg + db * db;
  }
  vari /= c;
  const inside = new Uint8Array(n);
  if (vari > 2500) { inside.fill(1); return { inside, full: true }; }
  const thr2 = 48 * 48;
  const bg = new Uint8Array(n);
  const stack = [];
  const seed = (x, y) => {
    const p = y * W + x;
    if (bg[p]) return;
    const i = p * 4;
    const dr = data[i] - r, dg = data[i + 1] - g, db = data[i + 2] - b;
    if (dr * dr + dg * dg + db * db <= thr2) { bg[p] = 1; stack.push(p); }
  };
  for (let x = 0; x < W; x++) { seed(x, 0); seed(x, H - 1); }
  for (let y = 1; y < H - 1; y++) { seed(0, y); seed(W - 1, y); }
  while (stack.length) {
    const p = stack.pop();
    const x = p % W;
    const y = (p / W) | 0;
    const see = (q) => {
      if (bg[q]) return;
      const i = q * 4;
      const dr = data[i] - r, dg = data[i + 1] - g, db = data[i + 2] - b;
      if (dr * dr + dg * dg + db * db <= thr2) { bg[q] = 1; stack.push(q); }
    };
    if (x > 0) see(p - 1);
    if (x + 1 < W) see(p + 1);
    if (y > 0) see(p - W);
    if (y + 1 < H) see(p + W);
  }
  let fg = 0;
  for (let i = 0; i < n; i++) if (!bg[i]) { inside[i] = 1; fg++; }
  if (fg < n * 0.02) { inside.fill(1); return { inside, full: true }; }
  return { inside, full: false };
}

function blur(src, W, H) {
  const out = new Float32Array(W * H);
  const r = 2;
  for (let y = 0; y < H; y++) {
    const yA = Math.max(0, y - r), yB = Math.min(H - 1, y + r);
    for (let x = 0; x < W; x++) {
      const xA = Math.max(0, x - r), xB = Math.min(W - 1, x + r);
      let s = 0, n = 0;
      for (let yy = yA; yy <= yB; yy++) {
        for (let xx = xA; xx <= xB; xx++) { s += src[yy * W + xx]; n++; }
      }
      out[y * W + x] = s / n;
    }
  }
  return out;
}

async function readDepth(file, canvas, W, H) {
  const { RawImage } = await import(/* @vite-ignore */ TJS);
  const pipe = await getPipe();
  notify("Görselin 3D şekli çıkarılıyor…");
  const raw = RawImage.fromCanvas
    ? await RawImage.fromCanvas(canvas)
    : await RawImage.fromBlob(file);
  const out = await pipe(raw);
  let depth = out.depth || out;
  if (depth.width !== W || depth.height !== H) depth = depth.resize(W, H);
  const ch = depth.channels || 1;
  const src = new Float32Array(W * H);
  for (let i = 0; i < W * H; i++) src[i] = depth.data[i * ch];
  return blur(src, W, H);
}

export async function buildRelief(file) {
  const bmp = await createImageBitmap(file);
  const maxSide = 400;
  const scale = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
  const W = Math.max(64, Math.round(bmp.width * scale));
  const H = Math.max(64, Math.round(bmp.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(bmp, 0, 0, W, H);
  bmp.close?.();
  const image = ctx.getImageData(0, 0, W, H);
  const px = image.data;
  const { inside, full } = maskFromBorder(px, W, H);
  const depth = await readDepth(file, canvas, W, H);

  const vals = [];
  for (let i = 0; i < W * H; i += 3) if (inside[i]) vals.push(depth[i]);
  if (!vals.length) throw new Error("Görselde şekil bulunamadı");
  vals.sort((a, b) => a - b);
  const dMin = vals[Math.floor(vals.length * 0.06)];
  const dMax = vals[Math.floor(vals.length * 0.94)];
  const span = Math.max(1e-4, dMax - dMin);

  let x0 = W, y0 = H, x1 = 0, y1 = 0;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (!inside[y * W + x]) continue;
      if (x < x0) x0 = x;
      if (y < y0) y0 = y;
      if (x > x1) x1 = x;
      if (y > y1) y1 = y;
    }
  }
  if (x1 <= x0 || y1 <= y0) throw new Error("Görselde şekil bulunamadı");

  if (!full) {
    for (let i = 0; i < inside.length; i++) if (!inside[i]) px[i * 4 + 3] = 0;
    ctx.putImageData(image, 0, 0);
  }

  const N = 110;
  const cols = N + 1;
  const bw = Math.max(1, x1 - x0);
  const bh = Math.max(1, y1 - y0);
  const depthAmt = 1.25;
  const thick = 0.18;
  const pos = [];
  const uv = [];
  const on = new Uint8Array(cols * cols);
  const at = (fx, fy) => {
    const cx = Math.max(0, Math.min(W - 1, Math.round(fx)));
    const cy = Math.max(0, Math.min(H - 1, Math.round(fy)));
    return cy * W + cx;
  };

  for (let j = 0; j <= N; j++) {
    for (let i2 = 0; i2 <= N; i2++) {
      const fx = x0 + (i2 / N) * bw;
      const fy = y0 + (j / N) * bh;
      const id = at(fx, fy);
      const fg = inside[id] ? 1 : 0;
      on[j * cols + i2] = fg;
      let t = fg ? (depth[id] - dMin) / span : 0;
      t = Math.max(0, Math.min(1, t));
      t = Math.pow(t, 0.72);
      pos.push(
        (fx - (x0 + x1) / 2) / bw,
        -((fy - (y0 + y1) / 2) / bw),
        fg ? 0.04 + t * depthAmt : 0
      );
      uv.push(fx / W, 1 - fy / H);
    }
  }

  const vCount = cols * cols;
  for (let k = 0; k < vCount; k++) {
    pos.push(pos[k * 3], pos[k * 3 + 1], -thick);
    uv.push(1 - uv[k * 2], uv[k * 2 + 1]);
  }

  const cellOn = (j, i2) => {
    if (j < 0 || i2 < 0 || j >= N || i2 >= N) return false;
    let n = 0;
    if (on[j * cols + i2]) n++;
    if (on[j * cols + i2 + 1]) n++;
    if (on[(j + 1) * cols + i2]) n++;
    if (on[(j + 1) * cols + i2 + 1]) n++;
    return n >= 3;
  };

  const idx = [];
  for (let j = 0; j < N; j++) {
    for (let i2 = 0; i2 < N; i2++) {
      if (!cellOn(j, i2)) continue;
      const tl = j * cols + i2, tr = tl + 1, bl = (j + 1) * cols + i2, br = bl + 1;
      idx.push(tl, bl, tr, tr, bl, br);
      const B = vCount;
      idx.push(B + tl, B + tr, B + bl, B + tr, B + br, B + bl);
    }
  }
  if (!idx.length) throw new Error("3D yüzey oluşamadı");

  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({
    map: tex,
    transparent: !full,
    alphaTest: full ? 0 : 0.15,
    side: THREE.DoubleSide,
    roughness: 0.58,
    metalness: 0.04
  }));
  mesh.name = "depth_relief";

  const sidePos = [];
  const sideCol = [];
  const PAL = [[0.90, 0.22, 0.27], [0.96, 0.64, 0.09], [0.16, 0.62, 0.33], [0.07, 0.45, 0.75], [0.70, 0.06, 0.46]];
  const pushSide = (a, b) => {
    const take = (i) => [pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]];
    const A = take(a), Bv = take(b), A2 = take(a + vCount), B2 = take(b + vCount);
    const ang = Math.atan2((A[1] + Bv[1]) * 0.5, (A[0] + Bv[0]) * 0.5);
    const p = PAL[Math.floor(((ang + Math.PI) / (Math.PI * 2)) * PAL.length) % PAL.length];
    for (const v of [A, Bv, B2, A, B2, A2]) {
      sidePos.push(v[0], v[1], v[2]);
      sideCol.push(p[0], p[1], p[2]);
    }
  };
  for (let j = 0; j < N; j++) {
    for (let i2 = 0; i2 < N; i2++) {
      if (!cellOn(j, i2)) continue;
      const tl = j * cols + i2, tr = tl + 1, bl = (j + 1) * cols + i2, br = bl + 1;
      if (!cellOn(j - 1, i2)) pushSide(tl, tr);
      if (!cellOn(j + 1, i2)) pushSide(br, bl);
      if (!cellOn(j, i2 - 1)) pushSide(bl, tl);
      if (!cellOn(j, i2 + 1)) pushSide(tr, br);
    }
  }
  const sideGeo = new THREE.BufferGeometry();
  sideGeo.setAttribute("position", new THREE.Float32BufferAttribute(sidePos, 3));
  sideGeo.setAttribute("color", new THREE.Float32BufferAttribute(sideCol, 3));
  const side = new THREE.Mesh(sideGeo, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide }));
  const group = new THREE.Group();
  group.add(mesh, side);
  notify("3D şekil hazır");
  return group;
}

export default { buildRelief, preloadRelief, local3dProgress };
