// SPTON: the SP-1200 sound engine under an Ableton-style Session View.
// Bun serves the static app; all audio runs in the browser via Web Audio.
// The DSP core (public/dsp.js) is the SP-1200 engine, copied verbatim.
const root = new URL("../public/", import.meta.url);
const port = Number(process.env.PORT || 3017);

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
};

Bun.serve({
  port,
  async fetch(req) {
    const url = new URL(req.url);
    let p = decodeURIComponent(url.pathname);
    if (p === "/") p = "/index.html";
    if (p.includes("..")) return new Response("bad path", { status: 400 });
    const dot = p.lastIndexOf(".");
    const file = Bun.file(new URL("." + p, root));
    if (await file.exists()) {
      return new Response(file, {
        headers: { "Content-Type": TYPES[p.slice(dot)] || "application/octet-stream" },
      });
    }
    return new Response("not found", { status: 404 });
  },
});

console.log(`SPTON running at http://localhost:${port}`);
