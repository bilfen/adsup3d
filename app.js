// AD'S UP — Görselden renkli 3D videoya
// Akış: görsel yükle -> ücretsiz bulutta gerçek 3D model (GLB)
//       -> isteğe bağlı Gemini renk canlandırma (anahtar yalnızca yerel sunucuda)
//       -> Three.js ile 360° döndür -> MediaRecorder -> video indir.

const $ = (id) => document.getElementById(id);
const drop = $("drop"), preview = $("preview"), btnOlustur = $("btnOlustur");
const fileInput = $("fileInput");
const statusEl = $("status"), bar = $("bar"), barFill = $("barFill"), logEl = $("log");
const secViz = $("secViz"), vidList = $("vidList");
const canvas = $("c3d");

import { imageToGlb } from "./mesh3d.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

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

// ---------- 2) Ücretsiz 3D (bulut) + isteğe bağlı Gemini renk ----------
// Gemini 3D model üretmez. Anahtar tarayıcıya yazılmaz; yalnızca yerel sunucu
// /.env içindeki GEMINI_API_KEY ile renk canlandırabilir. 3D model Hugging Face'te üretilir.

let geminiOk = false;

async function shrinkForGemini(src) {
  const bmp = await createImageBitmap(src);
  const max = 1024;
  const scale = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const w = Math.max(1, Math.round(bmp.width * scale));
  const h = Math.max(1, Math.round(bmp.height * scale));
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  c.getContext("2d").drawImage(bmp, 0, 0, w, h);
  bmp.close?.();
  const blob = await new Promise((res) => c.toBlob(res, "image/jpeg", 0.9));
  if (!blob) throw new Error("Görsel küçültülemedi");
  return new File([blob], "gorsel.jpg", { type: "image/jpeg" });
}

async function enhanceWithGemini(src) {
  const small = await shrinkForGemini(src);
  const buf = new Uint8Array(await small.arrayBuffer());
  let bin = "";
  for (let i = 0; i < buf.length; i += 0x8000) {
    bin += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000));
  }
  const r = await fetch("/api/enhance", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ mime: small.type || "image/jpeg", data: btoa(bin) })
  });
  if (!r.ok) throw new Error((await r.text()).slice(0, 180) || ("HTTP " + r.status));
  const blob = await r.blob();
  if (!blob.type.startsWith("image/")) throw new Error("Gemini görsel döndürmedi");
  return new File([blob], "renkli.png", { type: blob.type });
}

async function probeGemini() {
  try {
    const r = await fetch("/api/health");
    if (!r.ok) return;
    const j = await r.json();
    geminiOk = !!j.gemini;
    const row = $("geminiRow");
    if (row) row.style.display = geminiOk ? "flex" : "none";
  } catch (e) { /* statik sayfa: Gemini yok, 3D yine çalışır */ }
}
probeGemini();

async function generate3D(srcFile) {
  setStatus("Görsel hazırlanıyor…", 8);
  log("Yükleniyor: " + srcFile.name);
  let work = srcFile;
  const wantGemini = geminiOk && $("geminiOn") && $("geminiOn").checked;
  if (wantGemini) {
    try {
      setStatus("Gemini renkleri canlandırıyor…", 18);
      log("Gemini: görsel Google'a gider, renk canlanır. 3D model sonra bulutta üretilir.");
      const enhanced = await enhanceWithGemini(srcFile);
      work = enhanced;
      preview.src = URL.createObjectURL(enhanced);
      preview.style.display = "block";
      log("Gemini renkli görsel hazır");
    } catch (e) {
      log("Gemini atlandı: " + e.message + " — orijinal görselle devam");
    }
  }
  log("Görsel, gerçek 3D model için ücretsiz buluta gidiyor.");
  const blob = await imageToGlb(work, (msg, pct) => setStatus(msg, pct));
  setStatus("3D model sahneye alınıyor…", 96);
  const buf = await blob.arrayBuffer();
  const gltf = await new Promise((resolve, reject) => {
    new GLTFLoader().parse(buf, "", resolve, (err) => reject(err instanceof Error ? err : new Error(String(err))));
  });
  if (!gltf.scene) throw new Error("3D model açılmadı");
  setStatus("3D hazır — dönüş başlıyor", 100);
  return gltf.scene;
}

// ---------- 3) Three.js sahne ----------
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";


// Videoya gömülecek logo (sağ üst)
const logoImg = new Image();
logoImg.src = "assets/logo.png";

let renderer, scene, camera, controls, model = null, floor = null, rimLights = [];
let turning = false, frameId = 0, recTimer = 0;

function makeStageTexture() {
  const c = document.createElement("canvas");
  c.width = 1024;
  c.height = 1024;
  const g = c.getContext("2d");
  const bg = g.createRadialGradient(512, 420, 40, 512, 520, 700);
  bg.addColorStop(0, "#314864");
  bg.addColorStop(0.5, "#152033");
  bg.addColorStop(1, "#070b14");
  g.fillStyle = bg;
  g.fillRect(0, 0, 1024, 1024);
  const orbs = [["#e63946", 190, 230, 280], ["#f4a417", 840, 190, 250], ["#2a9d53", 170, 830, 270], ["#1274bf", 860, 790, 290], ["#b30f76", 520, 940, 220]];
  for (const [col, x, y, rad] of orbs) {
    const rg = g.createRadialGradient(x, y, 0, x, y, rad);
    rg.addColorStop(0, col);
    rg.addColorStop(1, "rgba(0,0,0,0)");
    g.globalAlpha = 0.38;
    g.fillStyle = rg;
    g.beginPath();
    g.arc(x, y, rad, 0, Math.PI * 2);
    g.fill();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function makeFloorTexture() {
  const c = document.createElement("canvas");
  c.width = 512;
  c.height = 512;
  const g = c.getContext("2d");
  const colors = ["#e63946", "#f4a417", "#2a9d53", "#1274bf", "#b30f76"];
  for (let i = 0; i < 48; i++) {
    g.beginPath();
    g.moveTo(256, 256);
    g.arc(256, 256, 248, (i / 48) * Math.PI * 2, ((i + 1) / 48) * Math.PI * 2);
    g.closePath();
    g.fillStyle = colors[i % colors.length];
    g.globalAlpha = 0.9;
    g.fill();
  }
  g.globalAlpha = 1;
  g.beginPath();
  g.arc(256, 256, 168, 0, Math.PI * 2);
  g.fillStyle = "#0e1726";
  g.fill();
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function initScene() {
  if (scene) return;
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.12;
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
  renderer.setSize(canvas.clientWidth || 640, canvas.clientHeight || 480, false);
  scene = new THREE.Scene();
  scene.background = makeStageTexture();
  camera = new THREE.PerspectiveCamera(40, (canvas.clientWidth || 640) / (canvas.clientHeight || 480), 0.1, 100);
  camera.position.set(1.2, 0.78, 2.35);
  const hemi = new THREE.HemisphereLight(0xfff6ea, 0x1b2740, 1.25);
  const key = new THREE.DirectionalLight(0xfff3df, 2.3);
  key.position.set(2.6, 4.2, 4.4);
  const fill = new THREE.DirectionalLight(0xc5d8ff, 0.7);
  fill.position.set(-3.2, 1.4, 2);
  rimLights = [
    new THREE.PointLight(0xe63946, 6, 14),
    new THREE.PointLight(0x1274bf, 6, 14),
    new THREE.PointLight(0xf4a417, 4, 12)
  ];
  rimLights[0].position.set(-2.2, 1.1, 1.4);
  rimLights[1].position.set(2.3, 0.6, -1.6);
  rimLights[2].position.set(0.2, 2.4, 1.8);
  scene.add(hemi, key, fill, ...rimLights);
  floor = new THREE.Group();
  const disc = new THREE.Mesh(
    new THREE.CircleGeometry(1.2, 72),
    new THREE.MeshBasicMaterial({ map: makeFloorTexture(), transparent: true, opacity: 0.92, side: THREE.DoubleSide })
  );
  disc.rotation.x = -Math.PI / 2;
  floor.add(disc);
  scene.add(floor);
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

// Süre-tabanlı 360° dönüş: kare hızından bağımsız, kayıt sonunda tam bir tur.
let spin = null; // { t0, dur } — yalnızca 360° kaydı sırasında dolu
function stepScene() {
  resize();
  if (spin && model) {
    const p = Math.min(1, (performance.now() - spin.t0) / spin.dur);
    model.rotation.y = -0.7 + p * Math.PI * 2;
  } else if (turning && model) {
    model.rotation.y += 0.012;
  }
  if (rimLights.length) {
    const t = performance.now() / 1000;
    rimLights[0].position.x = Math.cos(t * 0.6) * 2.3;
    rimLights[0].position.z = Math.sin(t * 0.6) * 2.3;
    rimLights[1].position.x = Math.cos(t * 0.6 + Math.PI) * 2.3;
    rimLights[1].position.z = Math.sin(t * 0.6 + Math.PI) * 2.3;
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

function shadeMesh(root) {
  root.traverse((o) => {
    if (!o.isMesh || !o.material) return;
    const list = Array.isArray(o.material) ? o.material : [o.material];
    const next = list.map((m) => {
      if (!m) return m;
      if (m.map) m.map.colorSpace = THREE.SRGBColorSpace;
      if (m.isMeshStandardMaterial || m.isMeshPhysicalMaterial) {
        m.side = THREE.DoubleSide;
        m.needsUpdate = true;
        return m;
      }
      return new THREE.MeshStandardMaterial({
        map: m.map || null,
        color: m.color ? m.color.clone() : new THREE.Color(0xffffff),
        vertexColors: !!m.vertexColors,
        roughness: 0.62,
        metalness: 0.04,
        side: THREE.DoubleSide
      });
    });
    o.material = Array.isArray(o.material) ? next : next[0];
  });
}

function showModel(group) {
  secViz.style.display = "block";
  initScene();
  resize();
  if (!frameId) loop();
  if (model) scene.remove(model);
  shadeMesh(group);
  const box = new THREE.Box3().setFromObject(group);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  group.position.set(-center.x, -center.y, -center.z);
  const pivot = new THREE.Group();
  pivot.add(group);
  const maxDim = Math.max(size.x, size.y, size.z) || 1;
  const fit = 1.85 / maxDim;
  pivot.scale.setScalar(fit);
  model = pivot;
  scene.add(model);
  if (floor) floor.position.y = -(size.y * fit) / 2 - 0.05;
  turning = false;
  window.__adsup.lastModel = { mesh: true, size: [size.x, size.y, size.z] };
  log("3D model sahnede. Ölçü: " + size.x.toFixed(2) + " × " + size.y.toFixed(2) + " × " + size.z.toFixed(2));
  secViz.scrollIntoView({ behavior: "smooth", block: "start" });
  requestAnimationFrame(() => {
    resize();
    record360();
  });
}

// ---------- 4) Video kaydı ----------
let recorder = null, chunks = [];
const composite = document.createElement("canvas"); // WebGL tuvali + logo katmanı
composite.setAttribute("aria-hidden", "true");
composite.style.cssText = "position:fixed;left:-10000px;top:0;width:8px;height:8px;pointer-events:none";
document.body.appendChild(composite);
const cctx = composite.getContext("2d", { alpha: false });
function pickMime() {
  // MP4 önce: Chromium/Electron MediaRecorder MP4 kaydını destekliyorsa onu kullan; yoksa WebM'e düş.
  const cands = ["video/mp4;codecs=avc1.42E01E", "video/mp4", "video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm"];
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
    <span style="display:inline-flex;gap:6px;flex-wrap:wrap">
      <a class="dl" href="${url}" download="adsup-3d-video.${ext}">⬇ İndir</a>
      <button class="dl" data-drive>☁ Drive'a Kaydet</button>
    </span></div>`;
  wrap.querySelector("[data-drive]").addEventListener("click", (e) => saveToDrive(blob, e.currentTarget));
  vidList.prepend(wrap);
}

// ---------- 4.5) Google Drive'a kaydet ----------
// Kullanımı: DRIVE.clientId alanına Google Cloud OAuth Web Client ID'nizi girin.
// http://console.cloud.google.com → API & Services → OAuth Client ID (Web).
// Authorized JavaScript origins:  https://bilfen.github.io  (ve yerel test için http://localhost:5500)
// Google Drive API hizmetini etkinleştirin.
// Adım 2: driveSaveTarget = "ogrenci" → öğrencinin Drive'ına; "ortak" → aşağıdaki klasöre.
// Ayar tipi isterseniz ikisini de destekliyoruz (aşağıda).
const DRIVE = {
  clientId: "",           // ← ZORUNLU: sizin OAuth Web Client ID'niz ("xxxx.apps.googleusercontent.com")
  folderId: "",           // ← İSTEĞE BAĞLI: ortak/ataca klasör ID (klasör tarifinden); boşsa "Driveım" köküne gider
  scope: "https://www.googleapis.com/auth/drive.file"
};
let driveToken = null;

function driveClientReady() {
  return typeof google !== "undefined" && google.accounts && google.accounts.oauth2;
}

function getDriveToken() {
  return new Promise((resolve, reject) => {
    if (!driveClientReady()) return reject(new Error("Google modülü yüklenemedi — internet bağlantısını kontrol edin"));
    const client = google.accounts.oauth2.initTokenClient({
      client_id: DRIVE.clientId,
      scope: DRIVE.scope,
      callback: (resp) => {
        if (resp.error) reject(new Error("Google oturumu reddedildi: " + resp.error));
        else resolve(resp.access_token);
      },
      error_callback: (err) => reject(new Error(err.message || "Google oturumu açılamadı"))
    });
    client.requestAccessToken({ prompt: "" }); // açık oturum varsa sessiz, yoksa popup açar
  });
}

async function driveUpload(token, blob, name, mime) {
  const boundary = "ADSUP" + Math.random().toString(36).slice(2);
  const meta = { name, mimeType: mime };
  if (DRIVE.folderId) meta.parents = [DRIVE.folderId];
  const body = new Blob([
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(meta)}\r\n`,
    `--${boundary}\r\nContent-Type: ${mime}\r\n\r\n`,
    blob,
    `\r\n--${boundary}--\r\n`
  ], { type: "multipart/related; boundary=" + boundary });
  const r = await fetch("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,webViewLink", {
    method: "POST",
    headers: { Authorization: "Bearer " + token },
    body
  });
  const j = await r.json().catch(() => ({}));
  if (r.status === 401) { driveToken = null; throw new Error("Oturum yenilenmeli (401)"); }
  if (!r.ok) throw new Error("Drive hatası: " + (j.error && j.error.message || r.status));
  return j;
}

async function saveToDrive(blob, btn) {
  const original = btn.innerHTML;
  try {
    if (!DRIVE.clientId) {
      btn.textContent = "☁ Önce ayar gerek";
      setStatus("Drive'a kaydet için öğretmenin Google Client ID ayarı gerekli (adsup3d/app.js başındaki DRIVE bölümü). Kurulum talimatı proje README'sinde.");
      await new Promise(r => setTimeout(r, 4000));
      btn.innerHTML = original;
      return;
    }
    btn.disabled = true;
    btn.textContent = "☁ Yükleniyor…";
    setStatus("Google Drive'a yükleniyor…", null);
    let token = driveToken || await getDriveToken();
    // token canlı değilse sessiz yenile
    let res;
    try { res = await driveUpload(token, blob, "adsup-3d-video." + (blob.type.includes("mp4") ? "mp4" : "webm"), blob.type || "video/webm"); }
    catch (e) {
      if (!/401|Oturum yenilenmeli/.test(e.message)) throw e;
      token = await getDriveToken();
      res = await driveUpload(token, blob, "adsup-3d-video." + (blob.type.includes("mp4") ? "mp4" : "webm"), blob.type || "video/webm");
    }
    driveToken = token;
    btn.textContent = "✔ Drive'a kaydedildi";
    setStatus("✔ Google Drive'a kaydedildi: " + res.name + " — " + (res.webViewLink || "https://drive.google.com/drive/my-drive"));
    log("Drive'a yüklendi: id=" + res.id);
  } catch (err) {
    console.error(err);
    btn.textContent = "⚠ Drive hatası";
    setStatus("Drive'a kaydetmede hata: " + err.message);
    log("Drive hatası: " + err.message);
  } finally {
    btn.disabled = false;
    if (!btn.textContent.includes("✔"))
      setTimeout(() => { btn.innerHTML = original; btn.disabled = false; }, 3500);
    else setTimeout(() => { btn.innerHTML = original; }, 3500);
  }
}

$("btnTurn").addEventListener("click", () => { turning = !turning; });
// 360° video: tam bir tur (8 sn), bitince otomatik indirilir ve listeye eklenir
const SPIN_MS = 5000;
async function record360() {
  if (!model || spin || (recorder && recorder.state === "recording")) return;
  if (typeof MediaRecorder === "undefined" || !HTMLCanvasElement.prototype.captureStream) {
    setStatus("Bu tarayıcı video kaydedemiyor. Chrome veya Edge kullan.");
    turning = true;
    return;
  }
  const btn = $("btnRec5");
  btn.disabled = true;
  turning = false;
  try {
    setStatus("🎬 360° video kaydediliyor… (" + SPIN_MS / 1000 + " sn)");
    startRecording();
    spin = { t0: performance.now(), dur: SPIN_MS };
    await new Promise((r) => setTimeout(r, SPIN_MS + 60));
    spin = null;
    const blob = await stopRecording();
    turning = true;
    if (blob && blob.size > 100) {
      const ext = blob.type.includes("mp4") ? "mp4" : "webm";
      const name = "adsup-360-" + Date.now() + "." + ext;
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setStatus("✔ 360° video indirildi (" + ext.toUpperCase() + ", " + Math.round(blob.size / 1024) + " KB). İnmezse alttaki İndir düğmesine bas.");
      log("360° video hazır: " + name);
    } else {
      setStatus("Video oluşmadı. Chrome veya Edge ile tekrar dene, ya da “360° dönüş videosu” düğmesine bas.");
    }
  } catch (e) {
    spin = null;
    if (recTimer) { clearInterval(recTimer); recTimer = 0; }
    turning = true;
    setStatus("Video kaydı olmadı: " + (e && e.message ? e.message : e));
    log("Video hatası: " + (e && e.message ? e.message : e));
  } finally {
    btn.disabled = false;
  }
}
$("btnRec5").addEventListener("click", record360);
$("btnRecManual").addEventListener("click", async () => {
  if (spin) return; // 360° kaydı sürüyorsa karuşturma
  if (!recorder || recorder.state === "inactive") { startRecording(); $("btnRecManual").textContent = "⏹ Kaydı durdur"; }
  else { await stopRecording(); $("btnRecManual").textContent = "● Kaydı başlat / durdur"; }
});

// Test / otomasyon kancası
window.__adsup = { setFile, generate3D, showModel, composite };
Object.defineProperty(window.__adsup, "lastModel", { value: null, writable: true });
Object.defineProperty(window.__adsup, "rotY", { get: () => (model ? model.rotation.y : null) });

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