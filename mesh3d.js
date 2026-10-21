// Görseli ücretsiz bir bulut modeline gönderir, renkli GLB döner.
// GitHub Pages GPU çalıştıramaz; model Hugging Face üzerindeki açık
// image-to-3D alanlarında üretilir. Video kaydı tarayıcıda kalır.

const SPACES = [
  {
    label: "Stable Fast 3D",
    base: "https://stabilityai-stable-fast-3d.hf.space",
    fn: 5,
    timeout: 240000,
    // Önce arka plan silinir, aynı oturumda model üretilir. Düğme ve state kuyruğa dahildir.
    twoStep: true
  },
  {
    label: "Hunyuan3D 2.1",
    base: "https://tencent-hunyuan3d-2-1.hf.space",
    fn: 5,
    timeout: 240000,
    // ilk değer sunucudaki state; görsel ve dört boş açı
    data: (file) => [null, file, null, null, null, null, 5, 5, 1234, 256, true, 8000, true]
  },
  {
    label: "Hunyuan3D",
    base: "https://tencent-hunyuan3d-2.hf.space",
    fn: 8,
    timeout: 240000,
    data: (file) => ["", file, null, null, null, null, 5, 5, 1234, 256, true, 8000, true]
  }
];

async function shrinkForMesh(src) {
  const bmp = await createImageBitmap(src);
  const max = 768;
  const scale = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const w = Math.max(1, Math.round(bmp.width * scale));
  const h = Math.max(1, Math.round(bmp.height * scale));
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  c.getContext("2d").drawImage(bmp, 0, 0, w, h);
  bmp.close?.();
  const blob = await new Promise((res) => c.toBlob(res, "image/jpeg", 0.92));
  if (!blob) throw new Error("Görsel hazırlanamadı");
  return new File([blob], "gorsel.jpg", { type: "image/jpeg" });
}

async function uploadFile(base, file) {
  let last = "yükleme olmadı";
  for (const ep of [base + "/upload", base + "/gradio_api/upload"]) {
    const form = new FormData();
    form.append("files", file, file.name || "gorsel.jpg");
    let r;
    try {
      r = await fetch(ep, { method: "POST", body: form });
    } catch (e) {
      last = "bağlantı kurulamadı";
      continue;
    }
    const text = await r.text();
    if (!r.ok) {
      last = "HTTP " + r.status;
      continue;
    }
    try {
      const j = JSON.parse(text);
      const item = Array.isArray(j) ? j[0] : j;
      const path = typeof item === "string" ? item : item && item.path;
      if (path) return path;
    } catch (e) { /* sonraki adres */ }
    last = "dosya adresi gelmedi";
  }
  throw new Error(last);
}

function fileData(path, file) {
  return {
    path,
    orig_name: file.name || "gorsel.jpg",
    mime_type: file.type || "image/jpeg",
    meta: { _type: "gradio.FileData" }
  };
}

function looksLikeGlb(node) {
  const s = [node.orig_name, node.path, node.url, node.mime_type].filter(Boolean).join(" ").toLowerCase();
  return s.includes(".glb") || s.includes("gltf");
}

function collectGlbs(node, acc) {
  if (!node || typeof node !== "object") return;
  if (!Array.isArray(node) && looksLikeGlb(node)) acc.push(node);
  const kids = Array.isArray(node) ? node : Object.keys(node).map((k) => node[k]);
  for (const kid of kids) collectGlbs(kid, acc);
}

function resolveUrl(base, node) {
  const url = node.url || "";
  if (/^https?:/i.test(url)) return url;
  const path = node.path || url;
  if (!path) return null;
  if (/^https?:/i.test(path)) return path;
  return base.replace(/\/$/, "") + "/file=" + path;
}

function pickGlb(base, data) {
  const found = [];
  collectGlbs(data, found);
  if (!found.length) return null;
  const textured = found.find((f) => /textured/i.test([f.orig_name, f.path, f.url].join(" ")));
  return resolveUrl(base, textured || found[found.length - 1]);
}

function shortError(text) {
  const raw = String(text || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  if (/quota|exceeded|rate limit/i.test(raw)) return "ücretsiz GPU kotası dolu";
  if (/503|busy|queue is full|no gpu/i.test(raw)) return "servis meşgul";
  if (/pymeshlab|empty mesh|degenerate/i.test(raw)) return "bu görselden kapalı model çıkmadı";
  return raw.slice(0, 180) || "yanıt yok";
}

function newSession() {
  return Math.random().toString(36).slice(2, 14);
}

async function readQueue(url, onStatus, signal) {
  const r = await fetch(url, { headers: { Accept: "text/event-stream" }, signal });
  if (!r.ok || !r.body) throw new Error("HTTP " + r.status);
  const reader = r.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  let ticks = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let cut;
    while ((cut = buf.indexOf("\n\n")) >= 0) {
      const block = buf.slice(0, cut);
      buf = buf.slice(cut + 2);
      const dataLines = [];
      for (const line of block.split(/\r?\n/)) {
        if (line.startsWith("data:")) dataLines.push(line.slice(5).trim());
      }
      const dataStr = dataLines.join("\n");
      if (!dataStr) continue;
      let msg;
      try { msg = JSON.parse(dataStr); } catch (e) { continue; }
      if (!msg || !msg.msg) continue;
      if (msg.msg === "estimation") {
        ticks += 1;
        const eta = msg.rank_eta != null ? " Yaklaşık " + Math.max(1, Math.round(msg.rank_eta)) + " sn." : "";
        onStatus("3D model sırasında bekleniyor." + eta, Math.min(70, 40 + ticks));
      } else if (msg.msg === "process_starts") {
        onStatus("Görsel 3D modele çevriliyor…", 72);
      } else if (msg.msg === "process_completed") {
        if (!msg.success) {
          const err = msg.output && msg.output.error;
          throw new Error(shortError(err || "3D model üretilemedi"));
        }
        return msg.output && msg.output.data;
      } else if (msg.msg === "unexpected_error" || msg.msg === "error") {
        throw new Error(shortError(msg.message || msg.output || "3D servisi hata verdi"));
      }
    }
  }
  if (buf.trim()) {
    const leftover = buf.split(/\r?\n/).filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trim()).join("\n");
    if (leftover) {
      try {
        const msg = JSON.parse(leftover);
        if (msg && msg.msg === "process_completed") {
          if (!msg.success) throw new Error(shortError((msg.output && msg.output.error) || "3D model üretilemedi"));
          return msg.output && msg.output.data;
        }
      } catch (e) {
        if (e && e.message && !/JSON/.test(e.message)) throw e;
      }
    }
  }
  throw new Error("3D servisi yanıtı yarıda kesildi");
}

async function joinQueue(space, session, data, onStatus, signal) {
  const body = JSON.stringify({
    data,
    session_hash: session,
    fn_index: space.fn
  });
  let last = "iş başlatılamadı";
  for (const ep of [space.base + "/queue/join", space.base + "/gradio_api/queue/join"]) {
    let r;
    try {
      r = await fetch(ep, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
        signal
      });
    } catch (e) {
      if (e && e.name === "AbortError") throw e;
      last = "bağlantı kurulamadı";
      continue;
    }
    const text = await r.text();
    if (!r.ok) {
      last = shortError(text || ("HTTP " + r.status));
      continue;
    }
    let eventId = "";
    try { eventId = JSON.parse(text).event_id || ""; } catch (e) { eventId = ""; }
    if (!eventId) {
      last = "iş numarası gelmedi";
      continue;
    }
    const root = ep.replace(/\/queue\/join$/, "");
    return readQueue(root + "/queue/data?session_hash=" + encodeURIComponent(session), onStatus, signal);
  }
  throw new Error(last);
}

async function callSpace(space, file, onStatus, signal) {
  const session = newSession();
  if (space.twoStep) {
    onStatus("Arka plan ayrılıyor…", 40);
    await joinQueue(space, session, ["Remove Background", file, null, 0.85, "None", -1, 1024], onStatus, signal);
    onStatus("3D model örülüyor…", 62);
    return joinQueue(space, session, ["Run", file, null, 0.85, "None", -1, 1024], onStatus, signal);
  }
  return joinQueue(space, session, space.data(file), onStatus, signal);
}

async function downloadGlb(url, signal) {
  const r = await fetch(url, { signal });
  if (!r.ok) throw new Error("model inemedi (HTTP " + r.status + ")");
  const blob = await r.blob();
  if (blob.size < 1000) throw new Error("model dosyası boş");
  const head = new Uint8Array(await blob.slice(0, 4).arrayBuffer());
  const magic = String.fromCharCode(head[0], head[1], head[2], head[3]);
  if (magic !== "glTF") throw new Error("gelen dosya 3D model değil");
  return blob;
}

export async function imageToGlb(srcFile, onStatus) {
  const say = onStatus || (() => {});
  say("Görsel 3D modele hazırlanıyor…", 12);
  const small = await shrinkForMesh(srcFile);
  const errors = [];
  for (const space of SPACES) {
    const timer = new AbortController();
    const killer = setTimeout(() => timer.abort(), space.timeout);
    try {
      say(space.label + " görseli 3D modele çeviriyor…", 30);
      let data = null;
      let attemptErr = null;
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          const path = await uploadFile(space.base, small);
          data = await callSpace(space, fileData(path, small), say, timer.signal);
          attemptErr = null;
          break;
        } catch (e) {
          attemptErr = e;
          const msg = e && e.name === "AbortError" ? "süre doldu" : shortError(e && e.message);
          if (e && e.name === "AbortError") throw e;
          if (!/session not found|dosya|bulunamad/i.test(msg) || attempt === 2) throw e;
        }
      }
      if (attemptErr) throw attemptErr;
      const url = pickGlb(space.base, data);
      if (!url) throw new Error("model dosyası dönmedi");
      say("3D model indiriliyor…", 90);
      const blob = await downloadGlb(url, timer.signal);
      clearTimeout(killer);
      return blob;
    } catch (e) {
      clearTimeout(killer);
      const msg = e && e.name === "AbortError" ? "süre doldu" : shortError(e && e.message);
      errors.push(space.label + ": " + msg);
      say(space.label + " olmadı, sıradaki deneniyor…", 34);
    }
  }
  throw new Error("3D model üretilemedi. Ücretsiz servis meşgul ya da kotası dolu. Birkaç dakika sonra tekrar dene. (" + errors[0] + ")");
}
