// local3d.js — Yerel 3D motor (sunucu yok, kota yok, anahtar yok)
// Akış: transformers.js (WebGPU varsa /yoksa WASM) ile
//   1) depth-anything-v2-small → derinlik haritası
//   2) Xenova/modnet → ön plan maskesi (arka plan kesilir)
//   3) three.js ile maskeli, renkli (texture = görselin kendisi) rölyef mesh
//   4) GLTFExporter ile .glb blob üretir → app.js aynı akışta gösterir/indirir.
// İlk kullanımda model dosyaları indirilir (~26 MB) ve tarayıcı önbelleğine alınır.

import * as THREE from "three";
import { GLTFExporter } from "three/addons/exporters/GLTFExporter.js";

const TJS = "https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1";

let tjs = null,
  depthPipe = null,
  cutPipe = null;

export function local3dProgress(cb) {
  _progressLog = cb || null;
}
let _progressLog = null;

async function loadTJS() {
  if (tjs) return tjs;
  tjs = await import(/* @vite-ignore */ TJS);
  return tjs;
}

function notify(msg) {
  if (_progressLog) _progressLog(msg);
}

// Öğrenci çizimini daha doygun gösterir. Gemini gerekmez.
function boostColors(canvas) {
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return canvas;
  const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const d = img.data;
  const sat = 1.5;
  const contrast = 1.1;
  for (let i = 0; i < d.length; i += 4) {
    const avg = (d[i] + d[i + 1] + d[i + 2]) / 3;
    for (let c = 0; c < 3; c++) {
      let v = avg + (d[i + c] - avg) * sat;
      v = (v - 128) * contrast + 128;
      d[i + c] = v < 0 ? 0 : v > 255 ? 255 : v;
    }
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}

async function getDepthPipe() {
  if (depthPipe) return depthPipe;
  const { pipeline } = await loadTJS();
  const MODEL = "onnx-community/depth-anything-v2-small";
  const opts = {
    progress_callback: (p) => {
      if (p && p.status === "progress") notify(`Yerel motor: ${Math.round(p.loaded / 1e6)}/${p.total ? Math.round(p.total / 1e6) + " MB" : "?"} — ${p.file || ""}`);
    }
  };
  if (navigator.gpu) {
    for (const dtype of ["q4f16", "fp16"]) {
      try {
        depthPipe = await pipeline("depth-estimation", MODEL, { ...opts, device: "webgpu", dtype });
        notify("Yerel motor: WebGPU hazır (" + dtype + ")");
        return depthPipe;
      } catch (e) { /* sıradaki dtype */ }
    }
    notify("WebGPU kullanılamadı — WASM'a geçiliyor (biraz yavaş)");
  }
  for (const dtype of ["q8", "fp32"]) {
    try {
      depthPipe = await pipeline("depth-estimation", MODEL, { ...opts, device: "wasm", dtype });
      notify("Yerel motor: WASM hazır (" + dtype + ")");
      return depthPipe;
    } catch (e) { /* sıradaki dtype */ }
  }
  throw new Error("Yerel derinlik modeli yüklenemedi");
}

async function getCutPipe() {
  if (cutPipe) return cutPipe;
  const { pipeline } = await loadTJS();
  const opts = {
    progress_callback: (p) => {
      if (p && p.status === "progress") notify(`Yerel motor: kesme modeli ${Math.round(p.loaded / 1e6)}/${p.total ? Math.round(p.total / 1e6) + " MB" : "?"}`);
    }
  };
  if (navigator.gpu) {
    try {
      cutPipe = await pipeline("background-removal", "Xenova/modnet", { ...opts, device: "webgpu", dtype: "fp16" });
      return cutPipe;
    } catch (e) { /* wasm'a düş */ }
  }
  cutPipe = await pipeline("background-removal", "Xenova/modnet", { ...opts, device: "wasm", dtype: "q8" });
  return cutPipe;
}

// Ana giriş: File/Blob → renkli .glb Blob
export async function generateLocal3D(file) {
  notify("Yerel 3D motor başlatılıyor (tarayızda, sunucu yok)…");
  const { RawImage } = await loadTJS();
  const img = await RawImage.fromBlob(file);

  const [depthPipeP, cutPipeP] = [getDepthPipe(), getCutPipe()];
  const cutOut = await (await cutPipeP)(img);
  const cutRaw = Array.isArray(cutOut) ? cutOut[0] : cutOut;   // RGBA RawImage (ön plan)
  if (!cutRaw || !cutRaw.width) throw new Error("Ön plan kesme başarısız");
  const cut = cutRaw;
  const depthRes = await (await depthPipeP)(img); // { predicted_depth, depth: RawImage(1ch) }
  let depthImg = depthRes.depth;

  // Derinliği kesme görüntüsünün boyutuna hizala
  const W = cut.width, H = cut.height;
  if (depthImg.width !== W || depthImg.height !== H) depthImg = depthImg.resize(W, H);

  const maskData = cut.data;     // RGBA
  const dData = depthImg.data;   // 1 kanal

  // Ön plan yoğunluğu: alpha>~45 piksel, arka plan alpha ~0
  // Maske yumuşatma: basit 1-adım box blur alpha kanalına
  const softA = new Float32Array(W * H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4 + 3;
      let a = maskData[i];
      if (x > 0) a += maskData[i - 4];
      if (x < W - 1) a += maskData[i + 4];
      if (y > 0) a += maskData[i - 4 * W];
      if (y < H - 1) a += maskData[i + 4 * W];
      softA[y * W + x] = a / 5;
    }
  }

  // Maske neredeyse boşsa (ör. geniş banner/logo), modnet konu bulamamıştır:
  // tüm görseli ön plan say ki model seyrek/dağınık kalmasın.
  let covered = 0;
  for (let k = 0; k < W * H; k++) if (softA[k] > 90) covered++;
  const fullCover = covered / (W * H) < 0.05;
  if (fullCover) {
    notify("Ön plan maskesi çok küçük — tüm görsel kullanılıyor");
    softA.fill(255);
  }

  // Konu bbox
  let x0 = W, y0 = H, x1 = 0, y1 = 0;
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++)
      if (softA[y * W + x] > 90) {
        if (x < x0) x0 = x; if (x > x1) x1 = x;
        if (y < y0) y0 = y; if (y > y1) y1 = y;
      }
  if (x1 <= x0 || y1 <= y0) throw new Error("Ön plan bulunamadı — görselde ana nesne belirgin mi?");
  // kenar payı
  const padX = Math.max(4, Math.round((x1 - x0) * 0.03));
  const padY = Math.max(4, Math.round((y1 - y0) * 0.03));
  x0 = Math.max(0, x0 - padX); y0 = Math.max(0, y0 - padY);
  x1 = Math.min(W - 1, x1 + padX); y1 = Math.min(H - 1, y1 + padY);

  // Konu derinlik aralığı (dışarıyı yok say)
  let dMin = 1e9, dMax = -1e9;
  for (let y = y0; y <= y1; y++)
    for (let x = x0; x <= x1; x++)
      if (softA[y * W + x] > 150) {
        const d = dData[y * W + x];
        if (d < dMin) dMin = d;
        if (d > dMax) dMax = d;
      }
  if (!(dMax > dMin)) { dMin = 0; dMax = 255; }

  // Derinliği yumuşat: rölyef pürüzsüz, 360° dönüşte daha tok durur.
  const dBlur = new Float32Array(W * H);
  const rad = 2;
  for (let y = 0; y < H; y++) {
    const yA = Math.max(0, y - rad), yB = Math.min(H - 1, y + rad);
    for (let x = 0; x < W; x++) {
      const xA = Math.max(0, x - rad), xB = Math.min(W - 1, x + rad);
      let s = 0, n = 0;
      for (let yy = yA; yy <= yB; yy++)
        for (let xx = xA; xx <= xB; xx++) { s += dData[yy * W + xx]; n++; }
      dBlur[y * W + x] = s / n;
    }
  }

  // Kalın, renkli kabartma: ön yüz + arka yüz + gökkuşağı kenar.
  // İnce bir kart 360° dönüşte yok olur; kalınlık kenardan okunur.
  const N = 160;
  const cols = N + 1;
  const bw = x1 - x0, bh = y1 - y0;
  const relH = 0.62;
  const thick = 0.2;
  const pos = [];
  const uv = [];
  const alphaCols = new Float32Array(cols * cols);
  const span = Math.max(dMax - dMin, 1);

  for (let j = 0; j <= N; j++) {
    for (let i2 = 0; i2 <= N; i2++) {
      const fx = x0 + (i2 / N) * bw;
      const fy = y0 + (j / N) * bh;
      const cx = Math.max(0, Math.min(W - 1, Math.round(fx)));
      const cy = Math.max(0, Math.min(H - 1, Math.round(fy)));
      let a = 0, n = 0;
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const xx = cx + dx, yy = cy + dy;
          if (xx >= 0 && yy >= 0 && xx < W && yy < H) { a += softA[yy * W + xx]; n++; }
        }
      alphaCols[j * cols + i2] = a / n;
      const t = Math.max(0, Math.min(1, (dBlur[cy * W + cx] - dMin) / span));
      pos.push(
        fx / W - (x0 + x1) / (2 * W),
        -(fy / H - (y0 + y1) / (2 * H)) * (bh / Math.max(1, bw)),
        0.04 + t * relH
      );
      uv.push(fx / W, 1 - fy / H);
    }
  }

  const vCount = cols * cols;
  for (let k = 0; k < vCount; k++) {
    pos.push(pos[k * 3], pos[k * 3 + 1], -thick);
    uv.push(1 - uv[k * 2], uv[k * 2 + 1]);
  }

  const inside = (j, i2) => {
    if (j < 0 || i2 < 0 || j >= N || i2 >= N) return false;
    return alphaCols[j * cols + i2] > 120 &&
      alphaCols[j * cols + i2 + 1] > 120 &&
      alphaCols[(j + 1) * cols + i2] > 120 &&
      alphaCols[(j + 1) * cols + i2 + 1] > 120;
  };

  const idx = [];
  for (let j = 0; j < N; j++) {
    for (let i2 = 0; i2 < N; i2++) {
      if (!inside(j, i2)) continue;
      const tl = j * cols + i2, tr = tl + 1, bl = (j + 1) * cols + i2, br = bl + 1;
      idx.push(tl, bl, tr, tr, bl, br);
      const B = vCount;
      idx.push(B + tl, B + tr, B + bl, B + tr, B + br, B + bl);
    }
  }
  if (!idx.length) throw new Error("Mesh yüzü oluşamadı — daha sade arka planlı görsel deneyin");

  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(idx);
  geo.computeVertexNormals();

  const texCanvas = boostColors(fullCover ? img.toCanvas() : cut.toCanvas());
  const tex = new THREE.CanvasTexture(texCanvas);
  tex.colorSpace = THREE.SRGBColorSpace;

  const mat = new THREE.MeshStandardMaterial({
    map: tex,
    transparent: !fullCover,
    alphaTest: fullCover ? 0 : 0.35,
    side: THREE.DoubleSide,
    roughness: 0.72,
    metalness: 0.02,
    emissive: 0xffffff,
    emissiveIntensity: 0.08,
    emissiveMap: tex
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = "local_relief";

  // Kenar: dönüş sırasında görünen renkli kalınlık.
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
    const tris = [A, Bv, B2, A, B2, A2];
    for (const v of tris) {
      sidePos.push(v[0], v[1], v[2]);
      sideCol.push(p[0], p[1], p[2]);
    }
  };
  for (let j = 0; j < N; j++) {
    for (let i2 = 0; i2 < N; i2++) {
      if (!inside(j, i2)) continue;
      const tl = j * cols + i2, tr = tl + 1, bl = (j + 1) * cols + i2, br = bl + 1;
      if (!inside(j - 1, i2)) pushSide(tl, tr);
      if (!inside(j + 1, i2)) pushSide(br, bl);
      if (!inside(j, i2 - 1)) pushSide(bl, tl);
      if (!inside(j, i2 + 1)) pushSide(tr, br);
    }
  }
  const sideGeo = new THREE.BufferGeometry();
  sideGeo.setAttribute("position", new THREE.Float32BufferAttribute(sidePos, 3));
  sideGeo.setAttribute("color", new THREE.Float32BufferAttribute(sideCol, 3));
  sideGeo.computeVertexNormals();
  const sideMat = new THREE.MeshBasicMaterial({
    vertexColors: true,
    side: THREE.DoubleSide
  });
  const sideMesh = new THREE.Mesh(sideGeo, sideMat);
  sideMesh.name = "local_rim";

  const group = new THREE.Group();
  group.add(mesh, sideMesh);

  // GLB blob
  const glb = await new Promise((resolve, reject) => {
    new GLTFExporter().parse(
      group,
      (r) => resolve(new Blob([r], { type: "model/gltf-binary" })),
      (e) => reject(e),
      { binary: true }
    );
  });
  notify("Yerel 3D model hazır (renkli, texture'lı)");
  return glb;
}

export default { generateLocal3D, local3dProgress };
