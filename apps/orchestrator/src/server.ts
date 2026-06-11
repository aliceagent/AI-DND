/** The gateway process: HTTPS (mkcert local CA — phones need TLS for mic
 *  access) + WebSocket hub + static serving of the built PWA. Falls back to
 *  plain HTTP with a loud warning when certs are absent (desktop dev only —
 *  phone PTT will not get mic permission without TLS).
 *
 *  npm run setup-https   # one-time: mkcert CA + cert into certs/
 *  npm run serve         # https://<lan-ip>:8443 (or HERMYS_PORT) */

import { createServer as createHttpsServer } from "node:https";
import { createServer as createHttpServer } from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { extname, join, dirname, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { networkInterfaces } from "node:os";
import { randomUUID } from "node:crypto";
import { WebSocketServer } from "ws";
import { loadDrafts, saveReviewed, benchAuthorized } from "./bench.js";
import { Engine } from "../../../engine/src/engine.js";
import { SqliteEventStore } from "../../../engine/src/sqlite.js";
import { PCS } from "../../../engine/src/srd.js";
import { SessionHub } from "./hub.js";
import { createDM } from "./dm.js";
import { createMediaService } from "./media.js";

const here = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.HERMYS_PORT ?? 8443);
const CERT_DIR = process.env.HERMYS_TLS_DIR ?? join(here, "../certs");
const STATIC_DIR = process.env.HERMYS_PWA_DIR ?? join(here, "../../pwa/dist");
const DB_PATH = process.env.HERMYS_DB ?? join(here, "../session.db");

const BENCH_DIR = process.env.HERMYS_PACK_DIR ?? join(here, "../../../packs/hotdq/drafts");
const benchToken = randomUUID();

const engine = new Engine(Number(process.env.HERMYS_SEED ?? 20260610), new SqliteEventStore(DB_PATH));
if (!Object.keys(engine.state().combatants).length)
  for (const pc of PCS) engine.join(pc.ref, pc);
const hub = new SessionHub(engine, createDM(), createMediaService(), undefined, benchToken);

const MIME: Record<string, string> = {
  ".html": "text/html", ".js": "text/javascript", ".css": "text/css",
  ".json": "application/json", ".png": "image/png", ".svg": "image/svg+xml",
  ".webmanifest": "application/manifest+json", ".mp3": "audio/mpeg", ".ico": "image/x-icon",
};

function serveStatic(req: any, res: any): void {
  const url = (req.url ?? "/").split("?")[0];
  if (url.startsWith("/api/bench/")) return void handleBench(req, res, url);
  let file = normalize(join(STATIC_DIR, url === "/" ? "index.html" : url));
  if (!file.startsWith(normalize(STATIC_DIR))) { res.writeHead(403); res.end(); return; }
  if (!existsSync(file)) file = join(STATIC_DIR, "index.html"); // SPA fallback
  if (!existsSync(file)) {
    res.writeHead(200, { "content-type": "text/html" });
    res.end("<h1>Hermys orchestrator</h1><p>PWA not built yet — see apps/pwa.</p>");
    return;
  }
  // SvelteKit fingerprints /_app/immutable — cache those forever; never
  // cache HTML, or phones at the table run yesterday's app after a deploy.
  const cache = file.includes("/_app/immutable/")
    ? "public, max-age=31536000, immutable"
    : "no-cache";
  res.writeHead(200, { "content-type": MIME[extname(file)] ?? "application/octet-stream",
    "cache-control": cache });
  res.end(readFileSync(file));
}

/** Bench endpoints — host-token gated (the token rides only in the host's
 *  joined message). GET drafts, PUT the review; originals never overwritten. */
function handleBench(req: any, res: any, url: string): void {
  const reply = (code: number, body: unknown) => {
    res.writeHead(code, { "content-type": "application/json" });
    res.end(JSON.stringify(body));
  };
  if (!benchAuthorized(req.headers["x-bench-token"], benchToken))
    return reply(403, { error: "host token required" });
  if (req.method === "GET" && url === "/api/bench/drafts")
    return reply(200, loadDrafts(BENCH_DIR));
  if (req.method === "PUT" && url === "/api/bench/reviewed") {
    let body = "";
    req.on("data", (c: any) => (body += c));
    req.on("end", () => {
      try { reply(200, saveReviewed(BENCH_DIR, JSON.parse(body))); }
      catch (e) { reply(400, { error: String((e as Error).message) }); }
    });
    return;
  }
  reply(404, { error: "unknown bench endpoint" });
}

const keyPath = join(CERT_DIR, "key.pem"), certPath = join(CERT_DIR, "cert.pem");
const tls = existsSync(keyPath) && existsSync(certPath);
const server = tls
  ? createHttpsServer({ key: readFileSync(keyPath), cert: readFileSync(certPath) }, serveStatic)
  : createHttpServer(serveStatic);
if (!tls) console.warn("⚠ no certs in certs/ — serving HTTP; phone mics need HTTPS (npm run setup-https)");

const wss = new WebSocketServer({ server, path: "/ws" });
let nextClient = 1;
wss.on("connection", ws => {
  const id = `c${nextClient++}`;
  ws.on("message", async raw => {
    let msg: any;
    try { msg = JSON.parse(String(raw)); } catch { return; }
    try {
      if (msg.type === "join") {
        hub.join(id, { send: m => ws.readyState === ws.OPEN && ws.send(JSON.stringify(m)) },
          { role: msg.role, characterId: msg.characterId });
        if (msg.role === "screen" || msg.role === "host") await hub.open();
      } else {
        await hub.handle(id, msg);
      }
    } catch (e) {
      ws.send(JSON.stringify({ type: "error", error: String((e as Error).message) }));
    }
  });
  ws.on("close", () => hub.leave(id));
});

server.listen(PORT, () => {
  const lan = Object.values(networkInterfaces()).flat()
    .find(i => i && !i.internal && i.family === "IPv4")?.address ?? "localhost";
  console.log(`Hermys orchestrator: ${tls ? "https" : "http"}://${lan}:${PORT}  (ws: /ws)`);
  console.log(`  media: ${process.env.HERMYS_MEDIA ?? "mock"} · dm: ${process.env.HERMYS_DM ?? "echo"} · db: ${DB_PATH}`);
});
