// Yerel sunucu: `bun dev-server.js`
// Statik dosyalar + isteğe bağlı Gemini renk canlandırma.
// Anahtar yalnızca .env içindeki GEMINI_API_KEY. Sayfaya ve loga yazılmaz.
// .env istekleri 404 döner.

const root = import.meta.dir;

const envFile = Bun.file(root + "/.env");
if (await envFile.exists()) {
  for (const line of (await envFile.text()).split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i < 1) continue;
    const k = t.slice(0, i).trim();
    let v = t.slice(i + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (!process.env[k]) process.env[k] = v;
  }
}

const extTypes = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".jpg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".glb": "model/gltf-binary",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon"
};

const MODELS = ["gemini-3.1-flash-lite-image", "gemini-2.5-flash-image", "gemini-nano-banana-2.1"];
const PROMPT = "Bu bir öğrencinin kendi çizimi veya fotoğrafı. Aynı konuyu, aynı şekilleri ve kompozisyonu koru. Renkleri daha canlı, doygun ve temiz yap. Arka planı sade, açık ve düz bir renk yap ki nesne ayrılsın. Yeni nesne, yeni yazı veya logo ekleme. Tek bir net görsel döndür.";

function safeErr(msg) {
  const key = process.env.GEMINI_API_KEY || "";
  let s = String(msg || "Gemini hatası");
  if (key) s = s.split(key).join("[anahtar]");
  return s.slice(0, 280);
}

function findImage(node, depth = 0) {
  if (!node || depth > 12 || typeof node === "string") return null;
  if (Array.isArray(node)) {
    for (const item of node) {
      const hit = findImage(item, depth + 1);
      if (hit) return hit;
    }
    return null;
  }
  if (typeof node !== "object") return null;
  const inline = node.inlineData || node.inline_data;
  if (inline && typeof inline.data === "string" && inline.data.length > 80) {
    const mime = inline.mimeType || inline.mime_type || "image/png";
    if (String(mime).startsWith("image/")) return { mime: String(mime), data: inline.data };
  }
  if (typeof node.data === "string" && node.data.length > 80) {
    const mime = node.mime_type || node.mimeType || "";
    const typed = node.type === "image" || node.type === "image_content";
    if (String(mime).startsWith("image/") || (typed && node.data.length > 200)) {
      return { mime: String(mime).startsWith("image/") ? String(mime) : "image/png", data: node.data };
    }
  }
  for (const k of Object.keys(node)) {
    const hit = findImage(node[k], depth + 1);
    if (hit) return hit;
  }
  return null;
}

async function postJson(url, body) {
  const r = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": process.env.GEMINI_API_KEY
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(90000)
  });
  const text = await r.text();
  let json = null;
  try { json = JSON.parse(text); } catch (e) { json = null; }
  return { status: r.status, text, json };
}

async function geminiEnhance(bytes, mime) {
  const b64 = Buffer.from(bytes).toString("base64");
  let last = "Gemini görsel döndürmedi";
  for (const model of MODELS) {
    const gen = await postJson(
      "https://generativelanguage.googleapis.com/v1beta/models/" + model + ":generateContent",
      {
        contents: [{
          role: "user",
          parts: [
            { text: PROMPT },
            { inline_data: { mime_type: mime, data: b64 } }
          ]
        }],
        generationConfig: { responseModalities: ["TEXT", "IMAGE"] }
      }
    );
    const img = gen.json && findImage(gen.json);
    if (img) return img;
    last = safeErr((gen.json && gen.json.error && gen.json.error.message) || gen.text || ("HTTP " + gen.status));
    const missing = gen.status === 404 || /not found|is not supported|unknown model/i.test(last);
    if ((gen.status === 401 || gen.status === 403 || gen.status === 429) && !missing) throw new Error(last);
    if (!missing && gen.status && gen.status < 500 && gen.status !== 400) break;
  }
  const alt = await postJson("https://generativelanguage.googleapis.com/v1beta/interactions", {
    model: MODELS[0],
    input: [
      { type: "text", text: PROMPT },
      { type: "image", mime_type: mime, data: b64 }
    ]
  });
  const img2 = alt.json && findImage(alt.json);
  if (img2) return img2;
  const altMsg = safeErr((alt.json && alt.json.error && alt.json.error.message) || alt.text || last);
  throw new Error(altMsg || last);
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }
  });
}

const server = Bun.serve({
  port: process.env.PORT ? parseInt(process.env.PORT, 10) : 8080,
  async fetch(req) {
    const url = new URL(req.url);
    if (url.pathname === "/api/health") {
      return json({ gemini: Boolean(process.env.GEMINI_API_KEY), engine: "mesh3d" });
    }
    if (url.pathname === "/api/enhance" && req.method === "POST") {
      if (!process.env.GEMINI_API_KEY) return new Response("Gemini anahtarı yok. .env dosyasına GEMINI_API_KEY yaz.", { status: 503 });
      let body;
      try { body = await req.json(); } catch (e) { return new Response("Görsel okunamadı", { status: 400 }); }
      if (!body || typeof body.data !== "string") return new Response("Görsel yok", { status: 400 });
      const bytes = Buffer.from(body.data, "base64");
      if (bytes.length > 8 * 1024 * 1024) return new Response("Görsel 8 MB sınırını aşıyor", { status: 413 });
      const mime = typeof body.mime === "string" && body.mime.startsWith("image/") ? body.mime : "image/jpeg";
      try {
        const out = await geminiEnhance(bytes, mime);
        const bytes = Buffer.from(out.data, "base64");
        return new Response(bytes, { headers: { "Content-Type": out.mime, "Cache-Control": "no-store" } });
      } catch (e) {
        return new Response(safeErr(e.message), { status: 502 });
      }
    }

    let p = decodeURIComponent(url.pathname);
    if (p === "/") p = "/index.html";
    const parts = p.split("/");
    if (parts.some((s) => s === ".." || s.startsWith("."))) return new Response("404", { status: 404 });
    const f = Bun.file(root + p);
    if (!(await f.exists())) return new Response("404", { status: 404 });
    const ext = p.slice(p.lastIndexOf("."));
    return new Response(f, { headers: { "Content-Type": extTypes[ext] || "application/octet-stream", "Cache-Control": "no-store" } });
  }
});

console.log("AD'S UP yerel sunucu: http://localhost:" + server.port);
console.log(process.env.GEMINI_API_KEY ? "Gemini renk canlandırma: açık (anahtar .env içinde)" : "Gemini renk canlandırma: kapalı (3D yine çalışır)");
