// Görsel -> kısa MP4. Model: Lightricks LTX-Video 0.9.8 distilled
// (https://github.com/Lightricks/LTX-Video), ücretsiz Hugging Face alanı.
// Gradio 5. /gradio_api/call hata metnini "data: null" diye yutar.
// Çalışan yol: /gradio_api/queue/join + /gradio_api/queue/data?session_hash=

const BASE = "https://lightricks-ltx-video-distilled.hf.space";
const FN = 5;
const TIMEOUT_MS = 240000;
const DEFAULT_PROMPT = "The subject in the image gently comes to life with a small natural movement";
const NEGATIVE = "worst quality, inconsistent motion, blurry, jittery, distorted";

function shortError(raw) {
  const s = String(raw || "");
  if (/quota|ZeroGPU|rate limit/i.test(s)) {
    const wait = s.match(/Try again in ([0-9:]+)/);
    const extra = wait && wait[1] && wait[1] !== "0:00:00" ? " Yeniden deneme süresi: " + wait[1] + "." : "";
    return "Ücretsiz video kotası doldu. Bu internetteki günlük hak bitmiş olabilir." + extra;
  }
  if (/503|busy|queue is full|GPU task aborted|No GPU/i.test(s)) {
    return "Video servisi şu an meşgul. Birkaç dakika sonra yeniden dene.";
  }
  if (/Could not load image|input_image/i.test(s)) {
    return "Görsel video servisine ulaşmadı. Başka bir görselle yeniden dene.";
  }
  const clean = s.replace(/\s+/g, " ").trim();
  if (!clean || clean === "null") return "Video üretilemedi. Bir süre sonra yeniden dene.";
  return clean.slice(0, 220);
}

function newSession() {
  const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  let s = "";
  for (const b of bytes) s += alphabet[b % alphabet.length];
  return s;
}

async function shrink(src) {
  const bmp = await createImageBitmap(src);
  const scale = Math.min(1, 768 / Math.max(bmp.width, bmp.height));
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

async function uploadImage(file) {
  let last = "yükleme olmadı";
  for (const url of [BASE + "/gradio_api/upload", BASE + "/upload"]) {
    const fd = new FormData();
    fd.append("files", file, file.name || "gorsel.jpg");
    let r;
    try {
      r = await fetch(url, { method: "POST", body: fd });
    } catch (e) {
      last = e.message || "bağlantı yok";
      continue;
    }
    if (!r.ok) {
      last = "HTTP " + r.status;
      continue;
    }
    const j = await r.json().catch(() => null);
    const item = Array.isArray(j) ? j[0] : j;
    const path = typeof item === "string" ? item : item && item.path;
    if (path && String(path).includes("/tmp/")) return String(path);
    last = "dosya yolu yok";
  }
  throw new Error("Görsel buluta yüklenemedi (" + last + ")");
}

function findVideoUrl(node) {
  const urls = [];
  const paths = [];
  const walk = (n) => {
    if (!n) return;
    if (typeof n === "string") {
      if (/^https?:/i.test(n) && /\.mp4(\?|$)/i.test(n)) urls.push(n);
      else if (n.startsWith("/tmp/") && /\.mp4(\?|$)/i.test(n)) paths.push(n.split("?")[0]);
      return;
    }
    if (Array.isArray(n)) {
      n.forEach(walk);
      return;
    }
    if (typeof n === "object") {
      const mime = String(n.mime_type || "");
      const orig = String(n.orig_name || "");
      const path = typeof n.path === "string" ? n.path : "";
      if (path.startsWith("/tmp/") && /video\/mp4|\.mp4/i.test(mime + orig + path)) {
        if (typeof n.url === "string" && /^https?:/i.test(n.url)) urls.push(n.url);
        else paths.push(path.split("?")[0]);
      }
      Object.keys(n).forEach((k) => walk(n[k]));
    }
  };
  walk(node);
  if (urls.length) return urls[urls.length - 1];
  if (paths.length) return BASE + "/gradio_api/file=" + paths[paths.length - 1];
  return null;
}

async function readQueue(session, onStatus, signal) {
  const r = await fetch(BASE + "/gradio_api/queue/data?session_hash=" + encodeURIComponent(session), {
    headers: { Accept: "text/event-stream" },
    signal
  });
  if (!r.ok || !r.body) throw new Error("Kuyruk akışı açılmadı (" + r.status + ")");
  const reader = r.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let idx;
    while ((idx = buf.indexOf("\n\n")) >= 0) {
      const block = buf.slice(0, idx);
      buf = buf.slice(idx + 2);
      const dataLine = block.split("\n").filter((l) => l.startsWith("data:")).map((l) => l.slice(5).trim()).join("");
      if (!dataLine) continue;
      let msg;
      try { msg = JSON.parse(dataLine); } catch { continue; }
      if (msg.msg === "estimation") onStatus("Sıradasın, video servisi hazırlanıyor…", 35);
      else if (msg.msg === "process_starts") onStatus("Video üretiliyor… bu bir-iki dakika sürebilir", 58);
      else if (msg.msg === "progress" && msg.progress_data && msg.progress_data[0] && msg.progress_data[0].length) {
        const p = msg.progress_data[0];
        onStatus("Kareler oluşuyor…", 58 + Math.round(28 * (p.index || 0) / p.length));
      } else if (msg.msg === "process_completed") {
        if (!msg.success) {
          const out = msg.output || {};
          throw new Error(shortError(out.error || out.title || msg.title));
        }
        return msg.output;
      } else if (msg.msg === "unexpected_error") {
        throw new Error(shortError(msg.message));
      }
    }
  }
  throw new Error("Video servisi yanıtı yarıda kesti. Bir süre sonra yeniden dene.");
}

async function downloadMp4(url, signal) {
  let r = await fetch(url, { signal });
  if (!r.ok && url.includes("/gradio_api/file=")) {
    r = await fetch(url.replace("/gradio_api/file=", "/file="), { signal });
  }
  if (!r.ok) throw new Error("Video indirilemedi (HTTP " + r.status + ")");
  const blob = await r.blob();
  if (blob.size < 5000) throw new Error("Gelen dosya video değil.");
  const head = new Uint8Array(await blob.slice(0, 32).arrayBuffer());
  const ascii = String.fromCharCode.apply(null, head);
  if (!ascii.includes("ftyp")) throw new Error("Gelen dosya MP4 değil.");
  return new Blob([blob], { type: "video/mp4" });
}

export async function imageToVideo(srcFile, onStatus, promptText) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    onStatus("Görsel hazırlanıyor…", 12);
    const small = await shrink(srcFile);
    onStatus("Görsel ücretsiz video bulutuna gidiyor…", 22);
    const path = await uploadImage(small);
    const prompt = (promptText || "").trim() || DEFAULT_PROMPT;
    const fileData = {
      path,
      orig_name: small.name,
      mime_type: "image/jpeg",
      meta: { _type: "gradio.FileData" }
    };
    const data = [prompt, NEGATIVE, fileData, null, 512, 704, "image-to-video", 2, 9, 42, true, 1, false];
    const session = newSession();
    onStatus("Video kuyruğuna giriliyor…", 30);
    const join = await fetch(BASE + "/gradio_api/queue/join", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ data, fn_index: FN, session_hash: session, trigger_id: 10 }),
      signal: ctrl.signal
    });
    const joinText = await join.text();
    if (!join.ok || !/"event_id"/.test(joinText)) throw new Error(shortError(joinText || ("HTTP " + join.status)));
    const output = await readQueue(session, onStatus, ctrl.signal);
    const videoUrl = findVideoUrl(output);
    if (!videoUrl) throw new Error("Video dosyasının adresi gelmedi.");
    onStatus("Video indiriliyor…", 92);
    return await downloadMp4(videoUrl, ctrl.signal);
  } catch (e) {
    if (e && e.name === "AbortError") throw new Error("Video zaman aşımına uğradı. Servis meşgul olabilir, yeniden dene.");
    if (e instanceof TypeError) throw new Error("Video servisine bağlanılamadı. İnterneti kontrol et.");
    throw e instanceof Error ? e : new Error(shortError(e));
  } finally {
    clearTimeout(timer);
  }
}
