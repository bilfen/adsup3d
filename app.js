// AD'S UP — Görselden 3D videoya
// Akış: görsel yükle -> Hugging Face'teki Tencent Hunyuan3D-2 Space'ine gönder -> .glb al
//       -> Three.js ile göster -> dönerken MediaRecorder ile kaydet -> WebM indir.

const $ = (id) => document.getElementById(id);
const drop = $("drop"), preview = $("preview"), btnOlustur = $("btnOlustur");
const fileInput = $("fileInput");
const statusEl = $("status"), bar = $("bar"), barFill = $("barFill"), logEl = $("log");
const secViz = $("secViz"), vidList = $("vidList");
const canvas = $("c3d");

const API = "https://tencent-hunyuan3d-2.hf.space";
const log = (m) => { logEl.style.display = "block"; logEl.textContent += m + "\n"; logEl.scrollTop = 1e9; };
const setStatus = (t, pct) => { statusEl.textContent = t; if (pct != null) { bar.style.display = "block"; barFill.style.width = pct + "%"; } };

// ---------- 1) Görsel seçimi ----------
let file = null;
drop.addEventListener("click", () => fileInput.click());
fileInput.addEventListener("change", () => { if (fileInput.files[0]) setFile(fileInput.files[0]); });
["dragover", "dragenter"].forEach((e) =>
  drop.addEventListener(e, (ev) => { ev.preventDefault(); drop.classList.add("over"); }));
drop.addEventListener("dragleave", () => drop.classList.remove("over"));
drop.addEventListener("drop", (ev) => {
  ev.preventDefault(); drop.classList.remove("over");
  if (ev.dataTransfer.files[0]) setFile(ev.dataTransfer.files[0]);
});

function setFile(f) {
  if (!f || !f.type.startsWith("image/")) return;
  file = f;
  preview.src = URL.createObjectURL(f);
  preview.style.display = "block";
  btnOlustur.disabled = false;
  setStatus("Görsel hazır: " + f.name);
  log("Görsel seçildi: " + f.name + " (" + Math.round(f.size / 1024) + " KB)");
}

// ---------- 2) Hunyuan3D-2 API ----------
async function uploadFile(f) {
  const fd = new FormData();
  fd.append("files", f, f.name);
  const r = await fetch(API + "/upload", { method: "POST", body: fd });
  if (!r.ok) throw new Error("Yükleme hatası: HTTP " + r.status);
  const arr = await r.json();
  return { path: arr[0], meta: { _type: "gradio.FileData" }, orig_name: f.name };
}

function parseSSE(sseText) {
  // "data: [...]" satırlarını topla, en son complete bloğunu bul
  const chunks = [];
  let ev = null;
  for (const line of sseText.split("\n")) {
    if (line.startsWith("event:")) ev = line.slice(6).trim();
    else if (line.startsWith("data:")) chunks.push({ event: ev, data: line.slice(5).trim() });
  }
  return chunks;
}

async function generate3D(file) {
  setStatus("Görsel sunucuya yükleniyor…", 10);
  log("Yükleniyor: " + file.name);
  const fd = await uploadFile(file);

  setStatus("3D üretim kuyruğa alınıyor…", 20);
  log("Kuyruğa alınıyor (shape_generation)…");
  const join = await fetch(API + "/call/shape_generation", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      data: [
        null,                     // caption (yok)
        fd,                       // image
        null, null, null, null,   // multiview görselleri (yok)
        30,                       // steps
        5.0,                      // guidance_scale
        Math.floor(Math.random() * 10000), // seed
        256,                      // octree_resolution
        true,                     // arka plan sil (rembg)
        8000,                     // num_chunks
        true                      // randomize seed
      ]
    })
  });
  const j = await join.json();
  if (!join.ok || !j.event_id) throw new Error("Kuyruk hatası: " + JSON.stringify(j));

  setStatus("3D model üretiliyor… (10-60 sn, kuyrukta bekleme olabilir)", 35);
  log("event_id: " + j.event_id);

  // SSE ile sonucu bekle
  const sse = new EventSource(API + "/call/shape_generation/" + j.event_id);
  const result = await new Promise((resolve, reject) => {
    let ticks = 0;
    const timer = setInterval(() => {
      ticks++;
      // yavaş ilerleme: 35 -> 75
      if (ticks % 6 === 0) { let w = parseFloat(barFill.style.width) || 35; w = Math.min(75, w + 2); setStatus("Üretiliyor…" + Math.round(w) + "%", w); }
    }, 3000);
    sse.addEventListener("process_generating", (e) => log("…işlem: " + e.data.slice(0, 140)));
    sse.addEventListener("complete", (e) => {
      clearInterval(timer); sse.close();
      try {
        const chunks = JSON.parse(e.data);
        const arr = Array.isArray(chunks) ? chunks : [chunks];
        for (const c of arr) {
          if (c && typeof c === "object" && c.value && c.value.url) { resolve(c.value); return; }
        }
        reject(new Error("Sonuç bulunamadı: " + e.data.slice(0, 300)));
      } catch (err) { reject(err); }
    });
    sse.addEventListener("error", (e) => { clearInterval(timer); sse.close(); reject(new Error("Bağlantı hatası (SSE)")); });
  });

  // .glb dosyasını indir — SSE url nesili bazen bozuk oluyor; güvenli desen: /file=<path>
  setStatus("3D model indiriliyor…", 80);
  log("Model indiriliyor: " + (result.orig_name || "white_mesh.glb"));
  const candidates = [];
  if (result.path) {
    candidates.push(API + "/file=" + result.path);
    candidates.push(API + "/gradio_api/file=" + result.path);
  }
  if (result.url) candidates.push(result.url); // en son yedek
  let glbBlob = null;
  for (const u of candidates) {
    try {
      const blob = await (await fetch(u)).blob();
      const head = new Uint8Array(await blob.slice(0, 4).arrayBuffer());
      const magic = String.fromCharCode(...head);
      if (magic === "glTF") { glbBlob = blob; break; }
      log("Uyumsuz yanıt (" + magic + ") denendi: " + u.slice(-40));
    } catch (e) { log("İndirme denemesi başarısız: " + u.slice(-40)); }
  }
  if (!glbBlob) throw new Error("3D model dosyası indirilemedi (sunucu yanıtı geçersiz) — birkaç dakika sonra tekrar deneyin.");
  setStatus("Model hazır!", 100);
  return glbBlob;
}

// ---------- 3) Three.js sahne ----------
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

// Videoya gömülecek logo (sağ üst)
const logoImg = new Image();
logoImg.src = "assets/logo.png";

let renderer, scene, camera, controls, model = null, turning = false, frameId = 0, recTimer = 0;
function initScene() {
  if (scene) return;
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
  renderer.setSize(canvas.clientWidth, canvas.clientHeight, false);
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0f172a);
  camera = new THREE.PerspectiveCamera(45, canvas.clientWidth / canvas.clientHeight, 0.1, 100);
  camera.position.set(0, 0.4, 3.2);
  const hemi = new THREE.HemisphereLight(0xffffff, 0x333333, 1.0);
  const dir = new THREE.DirectionalLight(0xffffff, 2.4);
  dir.position.set(3, 5, 4);
  const dir2 = new THREE.DirectionalLight(0xffffff, 1.4);
  dir2.position.set(-4, 2, -3);
  scene.add(hemi, dir, dir2);
  controls = new OrbitControls(camera, canvas);
  controls.target.set(0, 0, 0);
  controls.enableDamping = true;
}

function drawCompositeFrame() {
  if (composite.width !== canvas.width || composite.height !== canvas.height) {
    composite.width = canvas.width;
    composite.height = canvas.height;
  }
  cctx.clearRect(0, 0, composite.width, composite.height);
  cctx.drawImage(canvas, 0, 0);
  if (logoImg.complete && logoImg.naturalWidth) {
    const pad = Math.round(composite.width * 0.022);
    const lw = Math.round(composite.width * 0.16);
    const lh = Math.round(lw * (logoImg.naturalHeight / logoImg.naturalWidth));
    const chipPadX = Math.round(lh * 0.35);
    const chipPadY = Math.round(lh * 0.25);
    // Hafif yarı saydam beyaz rozet üzerinde sağ üst logo
    const cw = lw + chipPadX * 2, ch = lh + chipPadY * 2;
    const cx = composite.width - cw - pad, cy = pad;
    cctx.save();
    cctx.globalAlpha = 0.88;
    cctx.fillStyle = "#ffffff";
    cctx.beginPath();
    if (cctx.roundRect) {
      cctx.roundRect(cx, cy, cw, ch, Math.round(ch * 0.3));
    } else {
      cctx.rect(cx, cy, cw, ch);
    }
    cctx.fill();
    cctx.globalAlpha = 0.92;
    cctx.drawImage(logoImg, cx + chipPadX, cy + chipPadY, lw, lh);
    cctx.restore();
  }
}

function stepScene() {
  resize();
  if (turning && model) {
    model.rotation.y += 0.012;
  }
  controls.update();
  renderer.render(scene, camera);
  if (recorder && recorder.state === "recording") {
    drawCompositeFrame();
  }
}

function loop() {
  frameId = requestAnimationFrame(loop);
  if (!recTimer) stepScene();
}

function resize() {
  if (!renderer) return;
  const w = canvas.clientWidth || 640, h = canvas.clientHeight || 480;
  if (canvas.width !== w * renderer.getPixelRatio() || canvas.height !== h * renderer.getPixelRatio()) {
    renderer.setSize(w, h, true);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
}
window.addEventListener("resize", resize);

function showModel(glbBlob) {
  initScene();
  resize();
  if (!frameId) loop();
  const url = URL.createObjectURL(glbBlob);
  new GLTFLoader().load(url, (gltf) => {
    resize();
    if (model) scene.remove(model);
    model = gltf.scene;
    const box = new THREE.Box3().setFromObject(model);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z) || 1;
    model.position.x = -center.x; model.position.y = -center.y; model.position.z = -center.z;
    model.scale.setScalar(1.6 / maxDim);
    scene.add(model);
    turning = true;
    URL.revokeObjectURL(url);
    secViz.style.display = "block";
    secViz.scrollIntoView({ behavior: "smooth", block: "start" });
  });
}

// ---------- 4) Video kaydı ----------
let recorder = null, chunks = [];
const composite = document.createElement("canvas"); // WebGL tuvali + logo katmanı
const cctx = composite.getContext("2d");
function pickMime() {
  const cands = ["video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm", "video/mp4"];
  return cands.find((m) => MediaRecorder.isTypeSupported(m)) || "";
}

function startRecording() {
  // Bileşik tuvali sahne boyutuna eşle ve ilk kareyi çiz
  resize();
  composite.width = canvas.width;
  composite.height = canvas.height;
  drawCompositeFrame();
  const stream = composite.captureStream(30);
  const mime = pickMime();
  recorder = new MediaRecorder(stream, mime ? { mimeType: mime, videoBitsPerSecond: 6_000_000 } : undefined);
  chunks = [];
  recorder.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
  recorder.start(250);
  if (recTimer) clearInterval(recTimer);
  recTimer = setInterval(stepScene, 33);
}

function stopRecording() {
  return new Promise((res) => {
    if (recTimer) { clearInterval(recTimer); recTimer = 0; }
    if (!recorder || recorder.state === "inactive") return res(null);
    recorder.onstop = () => {
      const mime = (recorder.mimeType || "video/webm").split(";")[0];
      const ext = mime.includes("mp4") ? "mp4" : "webm";
      const blob = new Blob(chunks, { type: mime });
      const url = URL.createObjectURL(blob);
      addVideoCard(url, ext, blob);
      res(blob);
    };
    recorder.stop();
  });
}

function addVideoCard(url, ext, blob) {
  const kb = Math.round(blob.size / 1024);
  const wrap = document.createElement("div");
  wrap.className = "vidcard";
  wrap.innerHTML = `
    <video controls src="${url}"></video>
    <div class="meta"><span>${ext.toUpperCase()} · ${kb} KB</span>
    <a class="dl" href="${url}" download="adsup-3d-video.${ext}">⬇ İndir</a></div>`;
  vidList.prepend(wrap);
}

$("btnTurn").addEventListener("click", () => { turning = !turning; });
$("btnRec5").addEventListener("click", async () => {
  turning = true;
  startRecording();
  await new Promise((r) => setTimeout(r, 10_000));
  await stopRecording();
});
$("btnRecManual").addEventListener("click", async () => {
  if (!recorder || recorder.state === "inactive") { startRecording(); $("btnRecManual").textContent = "⏹ Kaydı durdur"; }
  else { await stopRecording(); $("btnRecManual").textContent = "● Kaydı başlat / durdur"; }
});

// Test / otomasyon kancası
window.__adsup = { setFile, generate3D, showModel, composite };

// Set up generate button
btnOlustur.addEventListener("click", async () => {
  if (!file) return;
  btnOlustur.disabled = true;
  logEl.textContent = "";
  try {
    const glb = await generate3D(file);
    showModel(glb);
  } catch (err) {
    console.error(err);
    setStatus("Hata: " + err.message + " — Lütfen tekrar deneyin.");
    bar.style.display = "none";
  } finally {
    btnOlustur.disabled = false;
  }
});
