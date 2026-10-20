// Küçük statik dosya sunucusu: `bun dev-server.js` (Port 8080)
const root = import.meta.dir;
const extTypes = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".jpg": "image/jpeg", ".png": "image/png", ".webp": "image/webp", ".glb": "model/gltf-binary", ".svg": "image/svg+xml", ".ico": "image/x-icon" };

const server = Bun.serve({
  port: process.env.PORT ? parseInt(process.env.PORT, 10) : 8080,
  async fetch(req) {
    const url = new URL(req.url);
    let p = decodeURIComponent(url.pathname);
    if (p === "/") p = "/index.html";
    const f = Bun.file(root + p);
    if (!(await f.exists())) return new Response("404", { status: 404 });
    return new Response(f, { headers: { "Content-Type": extTypes[p.slice(p.lastIndexOf("."))] || "application/octet-stream", "Cache-Control": "no-store" } });
  }
});
console.log("AD'S UP yerel sunucu: http://localhost:" + server.port);
