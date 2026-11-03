// =============================================================================
//  Local companion bridge (ADR-013): Dota 2 GSI POST  ->  SSE for the browser.
//
//  Dota pushes Game State Integration JSON to http://127.0.0.1:<port>/ (configured
//  by a cfg file the game reads at launch). This process normalises each POST
//  (src/gsi.ts) and fans it out to browser tabs over Server-Sent Events. It also
//  serves the built web/ folder, so ONE command gives the app + live data on the
//  same origin (no CORS, no Private/Local-Network-Access prompts):
//
//      npm run gsi                       # bridge + app on http://127.0.0.1:5174
//      npm run gsi -- --install [dir]    # write the GSI cfg into your Dota install
//      npm run gsi -- --print-cfg        # just print the cfg
//      npm run gsi -- --port 5200        # other port (re-run --install after)
//
//  Endpoints:
//      POST /         GSI body from the game (auth token checked)
//      GET  /events   SSE stream: `snapshot` + `status` events
//      GET  /health   JSON status (debug)
//      GET  /*        static files from web/ (run `npm run build:web` first)
//
//  Binds to 127.0.0.1 only. Node built-ins only (no new dependency).
// =============================================================================

import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { dirname, extname, join, normalize, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import {
  GSI_DEFAULT_PORT,
  gsiConfig,
  normalizeGsi,
  type GsiPayload,
  type GsiSnapshot,
} from "../src/gsi.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const WEB = join(ROOT, "web");
const TOKEN_FILE = join(ROOT, ".gsi-token");
const CFG_NAME = "gamestate_integration_dotaapp.cfg";
/** game heartbeat is 30 s (cfg); treat >40 s of silence as "game not connected". */
const GAME_STALE_MS = 40_000;

// ---------------------------------------------------------------------------
//  args / token
// ---------------------------------------------------------------------------

const argv = process.argv.slice(2);
function flag(name: string): boolean {
  return argv.includes(name);
}
function opt(name: string): string | undefined {
  const i = argv.indexOf(name);
  const v = i >= 0 ? argv[i + 1] : undefined;
  return v && !v.startsWith("--") ? v : undefined;
}
const PORT = Number(opt("--port") ?? process.env.GSI_PORT ?? GSI_DEFAULT_PORT);

function loadToken(): string {
  if (existsSync(TOKEN_FILE)) {
    const t = readFileSync(TOKEN_FILE, "utf8").trim();
    if (t) return t;
  }
  const t = randomBytes(16).toString("hex");
  writeFileSync(TOKEN_FILE, t + "\n", "utf8");
  return t;
}
const TOKEN = loadToken();

// ---------------------------------------------------------------------------
//  --install / --print-cfg
// ---------------------------------------------------------------------------

/** Steam library roots: default install + every "path" in libraryfolders.vdf. */
function steamLibraries(): string[] {
  const steamRoots = [
    process.env["ProgramFiles(x86)"] && join(process.env["ProgramFiles(x86)"]!, "Steam"),
    "C:\\Program Files (x86)\\Steam",
    "C:\\Program Files\\Steam",
    process.env.HOME && join(process.env.HOME, ".local", "share", "Steam"),
    process.env.HOME && join(process.env.HOME, "Library", "Application Support", "Steam"),
  ].filter((p): p is string => Boolean(p));
  const libs = new Set<string>();
  for (const root of steamRoots) {
    if (!existsSync(root)) continue;
    libs.add(root);
    const vdf = join(root, "steamapps", "libraryfolders.vdf");
    if (!existsSync(vdf)) continue;
    for (const m of readFileSync(vdf, "utf8").matchAll(/"path"\s+"([^"]+)"/g)) {
      libs.add(m[1]!.replace(/\\\\/g, "\\"));
    }
  }
  return [...libs];
}

function findDota(): string | undefined {
  for (const lib of steamLibraries()) {
    const d = join(lib, "steamapps", "common", "dota 2 beta");
    if (existsSync(join(d, "game", "dota"))) return d;
  }
  return undefined;
}

function install(dir: string | undefined): void {
  const dota = dir ?? findDota();
  if (!dota || !existsSync(join(dota, "game", "dota"))) {
    console.error(
      'Dota install not found. Pass it explicitly, e.g.\n' +
        '  npm run gsi -- --install "D:\\SteamLibrary\\steamapps\\common\\dota 2 beta"',
    );
    process.exit(1);
  }
  const cfgDir = join(dota, "game", "dota", "cfg", "gamestate_integration");
  mkdirSync(cfgDir, { recursive: true });
  const file = join(cfgDir, CFG_NAME);
  writeFileSync(file, gsiConfig({ port: PORT, token: TOKEN }), "utf8");
  console.log(`GSI cfg written: ${file}`);
  console.log(
    "Next:\n" +
      "  1. Steam -> Dota 2 -> Properties -> Launch options: add  -gamestateintegration\n" +
      "  2. Restart Dota (the cfg is read at launch)\n" +
      "  3. npm run gsi   then open the URL it prints",
  );
}

if (flag("--print-cfg")) {
  process.stdout.write(gsiConfig({ port: PORT, token: TOKEN }));
  process.exit(0);
}
if (flag("--install")) {
  install(opt("--install"));
  process.exit(0);
}

// ---------------------------------------------------------------------------
//  bridge state + SSE fan-out
// ---------------------------------------------------------------------------

let last: GsiSnapshot | undefined;
let lastPostAt = 0;
let lastSentKey = "";
let lastSentAt = 0;
const clients = new Set<ServerResponse>();

/** fields whose change is worth pushing immediately (gold/clock tick constantly). */
function keyOf(s: GsiSnapshot): string {
  return JSON.stringify([s.matchId, s.phase, s.myHeroValve, s.team, s.items, s.neutral, s.alive, s.heroLevel]);
}

function status(): { bridge: "up"; game: boolean; lastPostAgoMs: number | null; clients: number } {
  const ago = lastPostAt ? Date.now() - lastPostAt : null;
  return { bridge: "up", game: ago !== null && ago < GAME_STALE_MS, lastPostAgoMs: ago, clients: clients.size };
}

function send(res: ServerResponse, event: string, data: unknown): void {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}
function broadcast(event: string, data: unknown): void {
  for (const c of clients) send(c, event, data);
}

function logChange(prev: GsiSnapshot | undefined, s: GsiSnapshot): void {
  if (prev?.matchId !== s.matchId) console.log(`[gsi] match ${s.matchId ?? "-"}`);
  if (prev?.phase !== s.phase) console.log(`[gsi] phase ${s.phase}${s.rawState ? ` (${s.rawState})` : ""}`);
  if (prev?.myHeroValve !== s.myHeroValve) console.log(`[gsi] hero ${s.myHeroValve ?? "-"}`);
}

function onGsi(body: GsiPayload): void {
  const s = normalizeGsi(body);
  logChange(last, s);
  last = s;
  const wasStale = Date.now() - lastPostAt >= GAME_STALE_MS;
  lastPostAt = Date.now();
  if (wasStale) broadcast("status", status());
  const k = keyOf(s);
  // push on meaningful change, otherwise at most every 2 s (gold / clock)
  if (k !== lastSentKey || Date.now() - lastSentAt > 2000) {
    lastSentKey = k;
    lastSentAt = Date.now();
    broadcast("snapshot", s);
  }
}

setInterval(() => {
  broadcast("status", status());
  for (const c of clients) c.write(": ping\n\n");
}, 10_000).unref();

// ---------------------------------------------------------------------------
//  HTTP
// ---------------------------------------------------------------------------

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".map": "application/json",
  ".json": "application/json",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
};

function cors(res: ServerResponse): void {
  // the app may also be served by `npm run serve` (:5173) -> cross-origin SSE
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "content-type");
  res.setHeader("Access-Control-Allow-Private-Network", "true");
}

function readBody(req: IncomingMessage, limit = 2_000_000): Promise<string> {
  return new Promise((ok, fail) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => {
      size += c.length;
      if (size > limit) {
        fail(new Error("body too large"));
        req.destroy();
      } else chunks.push(c);
    });
    req.on("end", () => ok(Buffer.concat(chunks).toString("utf8")));
    req.on("error", fail);
  });
}

function serveStatic(urlPath: string, res: ServerResponse): void {
  const rel = decodeURIComponent(urlPath.split("?")[0]!).replace(/^\/+/, "") || "index.html";
  const file = normalize(join(WEB, rel));
  if (!file.startsWith(WEB + sep) && file !== WEB) {
    res.writeHead(403).end();
    return;
  }
  if (!existsSync(file) || !statSync(file).isFile()) {
    res.writeHead(404, { "content-type": "text/plain" }).end(
      rel === "index.html" ? "web/ not built - run `npm run build:web`" : "not found",
    );
    return;
  }
  res.writeHead(200, {
    "content-type": MIME[extname(file).toLowerCase()] ?? "application/octet-stream",
    "cache-control": "no-cache",
  });
  res.end(readFileSync(file));
}

const server = createServer(async (req, res) => {
  cors(res);
  const url = req.url ?? "/";
  try {
    if (req.method === "OPTIONS") {
      res.writeHead(204).end();
      return;
    }
    if (req.method === "POST") {
      const body = JSON.parse(await readBody(req)) as GsiPayload;
      if (body.auth?.token !== TOKEN) {
        res.writeHead(401).end("bad token");
        return;
      }
      onGsi(body);
      res.writeHead(200).end("ok");
      return;
    }
    if (req.method === "GET" && url.startsWith("/events")) {
      res.writeHead(200, {
        "content-type": "text/event-stream",
        "cache-control": "no-cache, no-transform",
        connection: "keep-alive",
      });
      res.write("retry: 2000\n\n");
      clients.add(res);
      send(res, "status", status());
      if (last) send(res, "snapshot", last);
      req.on("close", () => clients.delete(res));
      return;
    }
    if (req.method === "GET" && url.startsWith("/health")) {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ...status(), snapshot: last ?? null }));
      return;
    }
    if (req.method === "GET") {
      serveStatic(url, res);
      return;
    }
    res.writeHead(405).end();
  } catch (e) {
    res.writeHead(400).end(String((e as Error).message));
  }
});

server.on("error", (e: NodeJS.ErrnoException) => {
  if (e.code === "EADDRINUSE") console.error(`port ${PORT} is busy - try: npm run gsi -- --port ${PORT + 1}`);
  else console.error(e);
  process.exit(1);
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`Dota App companion on http://127.0.0.1:${PORT}/  (SSE: /events, debug: /health)`);
  if (!existsSync(join(WEB, "app.js"))) console.log("  web/ not built yet - run `npm run build:web`");
  console.log("  waiting for Dota GSI… (cfg missing? run: npm run gsi -- --install)");
});
