// local3d.js — Hızlı 3D motor
// Ağır model inmez. Görsel, sitenin içindeki motorla hemen renkli kabartmaya döner.
// Motor GitHub sayfasıyla birlikte gelir; öğrenci yalnızca sonucu görür.

import * as THREE from "three";
import { GLTFExporter } from "three/addons/exporters/GLTFExporter.js";

export function local3dProgress(cb) {
  _progressLog = cb || null;
}
let _progressLog = null;

function notify(msg) {
  if (_progressLog) _progressLog(msg);
}

function boostPixels(d) {
  const sat = 1.45;
  const contrast = 1.08;
  for (let i = 0; i < d.length; i += 4) {
    const avg = (d[i] + d[i + 1] + d[i + 2]) / 3;
    for (let c = 0; c < 3; c++) {
      let v = avg + (d[i + c] - avg) * sat;
      v = (v - 128) * contrast + 128;
      d[i + c] = v < 0 ? 0 : v > 255 ? 255 : v;
    }
  }
}

// Kenara değen düz rengi siler. Çizimin içindeki beyaz alan kalır.
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

function distanceInside(inside, W, H) {
  const n = W * H;
  const d = new Float32Array(n);
  const INF = 1e6;
  for (let i = 0; i < n; i++) d[i] = inside[i] ? INF : 0;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      let best = d[i];
      if (x > 0) best = Math.min(best, d[i - 1] + 1);
      if (y > 0) best = Math.min(best, d[i - W] + 1);
      if (x > 0 && y > 0) best = Math.min(best, d[i - W - 1] + 1.4);
      if (x + 1 < W && y > 0) best = Math.min(best, d[i - W + 1] + 1.4);
      d[i] = best;
    }
  }
  for (let y = H - 1; y >= 0; y--) {
    for (let x = W - 1; x >= 0; x--) {
      const i = y * W + x;
      let best = d[i];
      if (x + 1 < W) best = Math.min(best, d[i + 1] + 1);
      if (y + 1 < H) best = Math.min(best, d[i + W] + 1);
      if (x + 1 < W && y + 1 < H) best = Math.min(best, d[i + W + 1] + 1.4);
      if (x > 0 && y + 1 < H) best = Math.min(best, d[i + W - 1] + 1.4);
      d[i] = best;
    }
  }
  return d;
}

export async function generateLocal3D(file) {
  notify("Sonuç hazırlanıyor…");
  const bmp = await createImageBitmap(file);
  const maxSide = 420;
  const scale = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
  const W = Math.max(48, Math.round(bmp.width * scale));
  const H = Math.max(48, Math.round(bmp.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(bmp, 0, 0, W, H);
  bmp.close?.();
  const image = ctx.getImageData(0, 0, W, H);
  const px = image.data;
  const { inside, full } = maskFromBorder(px, W, H);
  const dist = distanceInside(inside, W, H);
  let dMax = 1;
  for (let i = 0; i < dist.length; i++) if (inside[i] && dist[i] < 1e5 && dist[i] > dMax) dMax = dist[i];

  let x0 = W, y0 = H, x1 = 0, y1 = 0;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (!inside[y * W + x]) continue;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  }
  if (x1 <= x0 || y1 <= y0) throw new Error("Görselde konu bulunamadı");
  const pad = 2;
  x0 = Math.max(0, x0 - pad);
  y0 = Math.max(0, y0 - pad);
  x1 = Math.min(W - 1, x1 + pad);
  y1 = Math.min(H - 1, y1 + pad);

  boostPixels(px);
  if (!full) {
    for (let i = 0; i < inside.length; i++) if (!inside[i]) px[i * 4 + 3] = 0;
  }
  ctx.putImageData(image, 0, 0);

  const N = 84;
  const cols = N + 1;
  const bw = Math.max(1, x1 - x0);
  const bh = Math.max(1, y1 - y0);
  const relH = 0.48;
  const thick = 0.16;
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
      const t = fg ? Math.min(1, Math.sqrt(Math.min(dist[id], dMax) / dMax)) : 0;
      const lum = fg ? (px[id * 4] * 0.3 + px[id * 4 + 1] * 0.59 + px[id * 4 + 2] * 0.11) / 255 : 0;
      const hgt = t * 0.86 + lum * 0.14;
      pos.push(
        fx / W - (x0 + x1) / (2 * W),
        -(fy / H - (y0 + y1) / (2 * H)) * (bh / bw),
        0.03 + hgt * relH
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
    return on[j * cols + i2] && on[j * cols + i2 + 1] && on[(j + 1) * cols + i2] && on[(j + 1) * cols + i2 + 1];
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
  if (!idx.length) throw new Error("3D yüzey oluşamadı — düz arka planlı bir görsel dene");

  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const mat = new THREE.MeshStandardMaterial({
    map: tex,
    transparent: !full,
    alphaTest: full ? 0 : 0.2,
    side: THREE.DoubleSide,
    roughness: 0.7,
    metalness: 0.02
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = "local_relief";

  const sidePos = [];
  const sideCol = [];
  const PAL = [
    [0.90, 0.22, 0.27],
    [0.96, 0.64, 0.09],
    [0.16, 0.62, 0.33],
    [0.07, 0.45, 0.75],
    [0.70, 0.06, 0.46]
  ];
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
  const sideMesh = new THREE.Mesh(sideGeo, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide }));
  sideMesh.name = "local_rim";

  const group = new THREE.Group();
  group.add(mesh, sideMesh);
  const glb = await new Promise((resolve, reject) => {
    new GLTFExporter().parse(
      group,
      (r) => resolve(new Blob([r], { type: "model/gltf-binary" })),
      (e) => reject(e),
      { binary: true }
    );
  });
  notify("Sonuç hazır");
  return glb;
}

export default { generateLocal3D, local3dProgress };
