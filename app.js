// AD'S UP — Görselden kısa videoya
// Akış: görsel yükle -> ücretsiz bulutta LTX image-to-video -> MP4 indir.
// İsteğe bağlı Gemini renk canlandırma yalnızca yerel sunucuda, anahtar tarayıcıya yazılmaz.

import { imageToVideo } from "./i2v.js";

const $ = (id) => document.getElementById(id);
const drop = $("drop"), preview = $("preview"), btnOlustur = $("btnOlustur");
const fileInput = $("fileInput");
const statusEl = $("status"), bar = $("bar"), barFill = $("barFill"), logEl = $("log");
const secViz = $("secViz"), vidList = $("vidList");

const log = (m) => { logEl.style.display = "block"; logEl.textContent += m + "\n"; logEl.scrollTop = 1e9; };
const setStatus = (t, pct) => { statusEl.textContent = t; if (pct != null) { bar.style.display = "block"; barFill.style.width = pct + "%"; } };

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

let geminiOk = false;

async function shrinkForGemini(src) {
  const bmp = await createImageBitmap(src);
  const scale = Math.min(1, 1024 / Math.max(bmp.width, bmp.height));
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
  } catch (e) { /* statik sayfa: Gemini yok */ }
}
probeGemini();

function addVideoCard(url, ext, blob) {
  const kb = Math.round(blob.size / 1024);
  const wrap = document.createElement("div");
  wrap.className = "vidcard";
  wrap.innerHTML = `
    <video controls autoplay loop src="${url}"></video>
    <div class="meta"><span>${ext.toUpperCase()} · ${kb} KB</span>
    <span style="display:inline-flex;gap:6px;flex-wrap:wrap">
      <a class="dl" href="${url}" download="adsup-video.${ext}">⬇ İndir</a>
      <button class="dl" data-drive>☁ Drive'a Kaydet</button>
    </span></div>`;
  wrap.querySelector("[data-drive]").addEventListener("click", (e) => saveToDrive(blob, e.currentTarget));
  vidList.prepend(wrap);
}

const DRIVE = {
  clientId: "",
  folderId: "",
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
    client.requestAccessToken({ prompt: "" });
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
      setStatus("Drive'a kaydet için öğretmenin Google Client ID ayarı gerekli (adsup3d/app.js içindeki DRIVE bölümü). Kurulum talimatı proje README'sinde.");
      await new Promise((r) => setTimeout(r, 4000));
      btn.innerHTML = original;
      return;
    }
    btn.disabled = true;
    btn.textContent = "☁ Yükleniyor…";
    setStatus("Google Drive'a yükleniyor…");
    let token = driveToken || await getDriveToken();
    let res;
    try { res = await driveUpload(token, blob, "adsup-video.mp4", blob.type || "video/mp4"); }
    catch (e) {
      if (!/401|Oturum yenilenmeli/.test(e.message)) throw e;
      token = await getDriveToken();
      res = await driveUpload(token, blob, "adsup-video.mp4", blob.type || "video/mp4");
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

function saveLocal(blob) {
  const url = URL.createObjectURL(blob);
  const name = "adsup-video-" + Date.now() + ".mp4";
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  return { url, name };
}

async function generateVideo(srcFile) {
  setStatus("Görsel hazırlanıyor…", 8);
  log("Yükleniyor: " + srcFile.name);
  let work = srcFile;
  const wantGemini = geminiOk && $("geminiOn") && $("geminiOn").checked;
  if (wantGemini) {
    try {
      setStatus("Gemini renkleri canlandırıyor…", 16);
      log("Gemini: görsel Google'a gider, renk canlanır. Video sonra bulutta üretilir.");
      const enhanced = await enhanceWithGemini(srcFile);
      work = enhanced;
      preview.src = URL.createObjectURL(enhanced);
      preview.style.display = "block";
      log("Gemini renkli görsel hazır");
    } catch (e) {
      log("Gemini atlandı: " + e.message + " — orijinal görselle devam");
    }
  }
  const prompt = ($("motion") && $("motion").value || "").trim();
  log("Görsel, ücretsiz video bulutuna gidiyor (Lightricks LTX-Video).");
  let lastLog = "";
  const blob = await imageToVideo(work, (msg, pct) => {
    setStatus(msg, pct);
    if (msg !== lastLog) { lastLog = msg; log(msg); }
  }, prompt);
  return blob;
}

window.__adsup = { setFile, generateVideo };

btnOlustur.addEventListener("click", async () => {
  if (!file) return;
  btnOlustur.disabled = true;
  logEl.textContent = "";
  try {
    const blob = await generateVideo(file);
    const saved = saveLocal(blob);
    secViz.style.display = "block";
    addVideoCard(saved.url, "mp4", blob);
    secViz.scrollIntoView({ behavior: "smooth", block: "start" });
    setStatus("✔ Video hazır (" + Math.round(blob.size / 1024) + " KB). İnmezse alttaki İndir düğmesine bas.", 100);
    log("Video hazır: " + saved.name);
  } catch (err) {
    console.error(err);
    setStatus("Hata: " + (err && err.message ? err.message : err));
    log("Hata: " + (err && err.message ? err.message : err));
    bar.style.display = "none";
  } finally {
    btnOlustur.disabled = !file;
  }
});
