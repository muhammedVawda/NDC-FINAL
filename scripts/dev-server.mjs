#!/usr/bin/env node
/*
  Local development server.

  Serves the static site from the repo root and mounts the real serverless
  handlers from /api (the same files Vercel runs), so the callback form, the
  assistant and the news endpoint can be exercised end to end on your machine.

    npm run dev                 -> http://localhost:8099
    PORT=3000 npm run dev       -> a different port

  Environment variables are read from the process (and from a `.env` file in
  the repo root if present: simple KEY=VALUE lines, never committed).

  To try the callback form WITHOUT sending any email, point delivery at a
  local webhook receiver, e.g.
    CONTACT_WEBHOOK_URL=http://127.0.0.1:9000/lead npm run dev
  See .env.example for every variable.
*/
import http from "node:http";
import { readFileSync, existsSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { createRequire } from "node:module";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const require = createRequire(import.meta.url);
const PORT = Number(process.env.PORT) || 8099;

// Minimal .env loader (does not override variables already set).
const envFile = path.join(ROOT, ".env");
if (existsSync(envFile)) {
  for (const line of readFileSync(envFile, "utf-8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}

const MIME = {
  ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8", ".json": "application/json; charset=utf-8", ".svg": "image/svg+xml",
  ".png": "image/png", ".jpg": "image/jpeg", ".webp": "image/webp", ".ico": "image/x-icon", ".txt": "text/plain; charset=utf-8",
  ".xml": "application/xml; charset=utf-8", ".webmanifest": "application/manifest+json", ".woff2": "font/woff2",
};

function readBody(req) {
  return new Promise((resolve) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
  });
}

// Vercel-style response helpers on top of node's ServerResponse.
function shim(res) {
  res.status = (code) => { res.statusCode = code; return res; };
  res.send = (body) => { res.end(body == null ? "" : String(body)); return res; };
  res.json = (obj) => { res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify(obj)); return res; };
  return res;
}

function send404(res) {
  const p = path.join(ROOT, "404.html");
  res.statusCode = 404;
  res.setHeader("Content-Type", MIME[".html"]);
  res.end(existsSync(p) ? readFileSync(p) : "Not found");
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  let pathname = decodeURIComponent(url.pathname);

  // ---- /api/<name> -> api/<name>.js ----
  const api = pathname.match(/^\/api\/([a-z0-9-]+)$/);
  if (api) {
    const file = path.join(ROOT, "api", `${api[1]}.js`);
    if (!existsSync(file) || api[1].startsWith("_")) return send404(res);
    const raw = await readBody(req);
    let body = raw;
    try { body = raw ? JSON.parse(raw) : {}; } catch { /* leave as string; the handler reports it */ }
    delete require.cache[file]; // pick up edits without restarting
    const handler = require(file);
    req.body = body;
    req.query = Object.fromEntries(url.searchParams);
    return handler(req, shim(res));
  }

  // ---- old WordPress URL forms (mirrors vercel.json) ----
  if (pathname === "/privacy-policy" || pathname === "/privacy-policy/") {
    res.statusCode = 301; res.setHeader("Location", "/privacy-policy.html"); return res.end();
  }

  // ---- static files ----
  let file = path.join(ROOT, pathname);
  if (!file.startsWith(ROOT)) return send404(res);
  if (existsSync(file) && statSync(file).isDirectory()) file = path.join(file, "index.html");
  if (!existsSync(file) || !statSync(file).isFile()) return send404(res);
  const ext = path.extname(file).toLowerCase();
  res.setHeader("Content-Type", MIME[ext] || "application/octet-stream");
  // Mirror vercel.json: security headers always; assets cached hard.
  res.setHeader("X-Content-Type-Options", "nosniff");
  if (pathname.startsWith("/assets/")) res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
  res.end(readFileSync(file));
});

server.listen(PORT, () => console.log(`NDC dev server: http://localhost:${PORT}  (api/ handlers mounted; ${process.env.CONTACT_WEBHOOK_URL ? "webhook delivery" : process.env.RESEND_API_KEY ? "Resend delivery" : "no delivery configured: the form will report that honestly"})`));
