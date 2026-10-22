// Görsel -> gerçek 3B model. Stability AI Stable Fast 3D, Gradio 4.41.
// Ölçülen yol (22 Ekim 2026): /upload, sonra /queue/join fn_index 5.
// /call/run_button hata gövdesini "data: null" diye yutuyor.
// Veri sırası: [düğme, görsel, durum, ön plan oranı, remesh, köşe sayısı, doku].

const BASE = "https://stabilityai-stable-fast-3d.hf.space";
const FN = 5;
const TIMEOUT_MS = 180000;

function sessionHash() {
  const bytes = new Uint8Array(12);
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  crypto.getRandomValues(bytes);
  let s = "";
  for (const b of bytes) s += chars[b % chars.length];
  return s;
}

export function errorText(raw) {
  const s = String(raw || "");
  const wait = s.match(/Try again in (\d+:\d+:\d+)/i);
  if (/quota|ZeroGPU|runs limit|exceeded your/i.test(s)) {
    const when = wait && wait[1] !== "0:00:00" ? " Yeniden deneme: " + wait[1] + "." : "";
    return "Ücretsiz 3B modeli hakkı bu istek için yetmedi." + when;
  }
  if (/401|403|unauthorized|invalid token|authenticate/i.test(s)) {
    return "Ücretsiz model sırası bu isteği şu an kabul etmedi. Bir süre sonra yeniden dene.";
  }
  if (/busy|queue is full|503|No GPU/i.test(s)) {
    return "3B modeli servisi şu an meşgul. Bir-iki dakika sonra yeniden dene.";
  }
  const clean = s.replace(/\s+/g, " ").trim();
  return (clean || "3B modeli üretilemedi.").slice(0, 240);
}

async function shrink(file) {
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, 768 / Math.max(bmp.width, bmp.height));
  const w = Math.max(1, Math.round(bmp.width * scale));
  const h = Math.max(1, Math.round(bmp.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  canvas.getContext("2d").drawImage(bmp, 0, 0, w, h);
  bmp.close?.();
  const blob = await new Promise((res) => canvas.toBlob(res, "image/jpeg", 0.92));
  if (!blob) throw new Error("Görsel hazırlanamadı.");
  return new File([blob], "gorsel.jpg", { type: "image/jpeg" });
}

async function upload(file) {
  const fd = new FormData();
  fd.append("files", file, file.name || "gorsel.jpg");
  const r = await fetch(BASE + "/upload", { method: "POST", body: fd });
  if (!r.ok) throw new Error("Görsel yüklenemedi (HTTP " + r.status + ").");
  const j = await r.json();
  const item = Array.isArray(j) ? j[0] : j;
  const path = typeof item === "string" ? item : item && item.path;
  if (!path) throw new Error("Yükleme adresi alınamadı.");
  return path;
}

function findGlb(node) {
  let found = "";
  const walk = (n) => {
    if (!n || found) return;
    if (typeof n === "string") {
      if (/\.glb(\?|$)/i.test(n)) found = n.split("?")[0];
      return;
    }
    if (Array.isArray(n)) return n.forEach(walk);
    if (typeof n === "object") {
      const path = typeof n.path === "string" ? n.path : "";
      if (/\.glb$/i.test(path)) found = path;
      else Object.keys(n).forEach((k) => walk(n[k]));
    }
  };
  walk(node);
  return found;
}

async function readQueue(session, onStatus, signal) {
  const r = await fetch(BASE + "/queue/data?session_hash=" + encodeURIComponent(session), {
    headers: { Accept: "text/event-stream" },
    signal
  });
  if (!r.ok || !r.body) throw new Error("Kuyruk akışı açılmadı (HTTP " + r.status + ").");
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
      if (!msg || !msg.msg) continue;
      if (msg.msg === "estimation") onStatus("3B modeli sırası hazır · tahmini " + Math.round(msg.rank_eta || 0) + " sn", 28);
      else if (msg.msg === "process_starts") onStatus("Görsel 3B modele çevriliyor…", 45);
      else if (msg.msg === "progress") onStatus("Model örülüyor…", 70);
      else if (msg.msg === "process_completed") {
        if (!msg.success) {
          const out = msg.output || {};
          throw new Error(errorText(out.error || out.title || msg.title));
        }
        return msg.output;
      } else if (msg.msg === "unexpected_error" || msg.msg === "error") {
        throw new Error(errorText(msg.message || msg.title));
      }
    }
  }
  throw new Error("3B modeli servisi yanıtı yarıda kesti.");
}

async function downloadGlb(path, signal) {
  const url = /^https?:/i.test(path) ? path : BASE + "/file=" + path;
  const r = await fetch(url, { signal });
  if (!r.ok) throw new Error("Model indirilemedi (HTTP " + r.status + ").");
  const blob = await r.blob();
  if (blob.size < 1000) throw new Error("Gelen dosya 3B model değil.");
  const head = new Uint8Array(await blob.slice(0, 4).arrayBuffer());
  const magic = String.fromCharCode(head[0], head[1], head[2], head[3]);
  if (magic !== "glTF") throw new Error("Gelen dosya GLB modeli değil.");
  return blob;
}

/** @returns {Promise<{blob: Blob, ms: number}>} */
export async function imageToModel(opts) {
  const onStatus = opts.onStatus || (() => {});
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  const t0 = performance.now();
  try {
    onStatus("Görsel hazırlanıyor…", 8);
    const file = await shrink(opts.file);
    onStatus("Görsel 3B modeli servisine gidiyor…", 16);
    const path = await upload(file);
    const session = sessionHash();
    const fileData = {
      path,
      orig_name: file.name,
      mime_type: file.type || "image/jpeg",
      meta: { _type: "gradio.FileData" }
    };
    const body = {
      data: [null, fileData, null, 0.85, "None", -1, 1024],
      fn_index: FN,
      session_hash: session,
      trigger_id: 13
    };
    onStatus("Model kuyruğuna giriliyor…", 22);
    const join = await fetch(BASE + "/queue/join", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: ctrl.signal
    });
    if (!join.ok) throw new Error("Kuyruğa girilemedi (HTTP " + join.status + ").");
    const output = await readQueue(session, onStatus, ctrl.signal);
    const glbPath = findGlb(output);
    if (!glbPath) throw new Error("Servis model dosyası döndürmedi.");
    onStatus("3B model iniyor…", 88);
    const blob = await downloadGlb(glbPath, ctrl.signal);
    return { blob, ms: Math.round((performance.now() - t0) / 1000) };
  } catch (err) {
    if (err && err.name === "AbortError") throw new Error("3B modeli zaman aşımına uğradı. Yeniden dene.");
    if (err && err.name === "TypeError") throw new Error("3B modeli servisine bağlanılamadı.");
    throw err;
  } finally {
    clearTimeout(timer);
  }
}
