// =============================================================================
//  Build the password-protected static site for GitHub Pages (ADR-019).
//
//      APP_PASSWORD='long passphrase' npm run build:pages     -> dist/
//
//  What is published:
//    dist/index.html   the app markup + an unlock screen (no app code, no data)
//    dist/app.bin      AES-256-GCM( gzip( { app.js, kb, roster, matchups } ) )
//    dist/heroes/, fonts/, favicon.svg   public assets (Valve art, OFL fonts)
//  The key is PBKDF2-SHA256(password, 600k iterations). The browser decrypts in
//  memory (WebCrypto) and runs the app from a blob: URL. A wrong password fails the
//  GCM tag check. Security = strength of the password: app.bin can be downloaded and
//  attacked offline, so use a long passphrase. GitHub stores it as a repo secret.
//
//  A Content-Security-Policy (meta) pins the page to its own origin: connect-src
//  'self', no third-party scripts, so the screen-reading code can never send frames
//  anywhere. GSI (needs a local bridge on 127.0.0.1) is off in this build.
// =============================================================================

import { createHash, webcrypto } from "node:crypto";
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const WEB = join(ROOT, "web");
const DIST = join(ROOT, "dist");

/** constant per-site salt: lets "remember on this device" survive redeploys. */
const SALT = "dota-counterpick/pages/v1";
const ITERATIONS = 600_000;
const MIN_PASSWORD = 12;

async function main(): Promise<void> {
  const password = process.env.APP_PASSWORD ?? "";
  if (password.length < MIN_PASSWORD) {
    console.error(
      `APP_PASSWORD missing or shorter than ${MIN_PASSWORD} characters - refusing to publish an unprotected build.\n` +
        "  GitHub: Settings -> Secrets and variables -> Actions -> New repository secret APP_PASSWORD",
    );
    process.exit(1);
  }
  for (const f of ["app.js", "kb.json", "roster.json", "index.html"]) {
    if (!existsSync(join(WEB, f))) throw new Error(`web/${f} missing - run npm run build:web first`);
  }
  if (!existsSync(join(WEB, "heroes"))) throw new Error("web/heroes missing - run npm run fetch:portraits");

  // ---- payload ---------------------------------------------------------------
  const js = readFileSync(join(WEB, "app.js"), "utf8").replace(/\n\/\/# sourceMappingURL=.*$/m, "");
  const matchupsPath = join(WEB, "matchups.json");
  const itemStatsPath = join(WEB, "item-stats.json");
  const opt = (f: string) => (existsSync(join(WEB, f)) ? JSON.parse(readFileSync(join(WEB, f), "utf8")) : null);
  const payload = {
    js,
    data: {
      kb: JSON.parse(readFileSync(join(WEB, "kb.json"), "utf8")),
      roster: JSON.parse(readFileSync(join(WEB, "roster.json"), "utf8")),
      matchups: existsSync(matchupsPath) ? JSON.parse(readFileSync(matchupsPath, "utf8")) : null,
      itemStats: existsSync(itemStatsPath) ? JSON.parse(readFileSync(itemStatsPath, "utf8")) : null,
      ids: opt("ids.json"),
      benchmarks: opt("benchmarks.json"),
      pages: true,
    },
  };
  const plain = gzipSync(Buffer.from(JSON.stringify(payload), "utf8"), { level: 9 });

  const subtle = webcrypto.subtle;
  const base = await subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveKey"]);
  const key = await subtle.deriveKey(
    { name: "PBKDF2", salt: new TextEncoder().encode(SALT), iterations: ITERATIONS, hash: "SHA-256" },
    base,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt"],
  );
  const iv = webcrypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await subtle.encrypt({ name: "AES-GCM", iv }, key, plain));
  const bin = new Uint8Array(iv.length + ct.length);
  bin.set(iv, 0);
  bin.set(ct, iv.length);

  // ---- page ------------------------------------------------------------------
  const gateJs = gateScript();
  const gateHash = createHash("sha256").update(gateJs, "utf8").digest("base64");
  const csp = [
    "default-src 'none'",
    `script-src 'sha256-${gateHash}' blob:`,
    "style-src 'unsafe-inline'",
    "img-src 'self' blob:",
    "font-src 'self'",
    "connect-src 'self'",
    "base-uri 'none'",
    "form-action 'none'",
  ].join("; ");

  let html = readFileSync(join(WEB, "index.html"), "utf8");
  const tag = '<script type="module" src="./app.js"></script>';
  if (!html.includes(tag)) throw new Error("index.html: app script tag not found");
  html = html
    .replace("<head>", `<head>\n    <meta http-equiv="Content-Security-Policy" content="${csp}" />\n    <meta name="robots" content="noindex, nofollow" />`)
    .replace("<html lang=\"en\">", '<html lang="en" class="locked">')
    .replace("</style>", `${GATE_CSS}\n    </style>`)
    .replace(tag, `${GATE_HTML}\n    <script>${gateJs}</script>`);

  rmSync(DIST, { recursive: true, force: true });
  mkdirSync(DIST, { recursive: true });
  writeFileSync(join(DIST, "index.html"), html, "utf8");
  writeFileSync(join(DIST, "app.bin"), bin);
  writeFileSync(join(DIST, ".nojekyll"), "");
  cpSync(join(WEB, "heroes"), join(DIST, "heroes"), { recursive: true });
  if (existsSync(join(WEB, "items"))) cpSync(join(WEB, "items"), join(DIST, "items"), { recursive: true });
  cpSync(join(WEB, "fonts"), join(DIST, "fonts"), { recursive: true });
  cpSync(join(WEB, "favicon.svg"), join(DIST, "favicon.svg"));

  console.log(
    `dist/: index.html (unlock screen), app.bin ${(bin.length / 1024).toFixed(0)} KB encrypted ` +
      `(payload ${(plain.length / 1024).toFixed(0)} KB gzip), heroes/, fonts/`,
  );
}

const GATE_CSS = `
      html.locked body > header, html.locked body > #counter-view, html.locked body > #combo-view,
      html.locked body > .credits { display: none; }
      html:not(.locked) #gate { display: none; }
      #gate { min-height: 100vh; display: grid; place-items: center; padding: 24px; }
      #gate form { width: min(360px, 100%); display: grid; gap: 12px; }
      #gate h1 { margin: 0 0 4px; font: 700 26px/1.1 var(--cond); }
      #gate p { margin: 0; color: var(--muted); font-size: 14px; }
      #gate input[type=password] { background: var(--panel); border: 1px solid var(--line); border-radius: 3px;
        color: var(--text); padding: 10px 12px; font: inherit; font-size: 16px; }
      #gate label { display: flex; gap: 8px; align-items: center; color: var(--muted); font-size: 13px; }
      #gate button { background: var(--gold); color: #1d1606; border: 0; border-radius: 3px; padding: 10px 12px;
        font: 700 17px/1 var(--cond); cursor: pointer; }
      #gate button:disabled { opacity: .6; cursor: progress; }
      #gate .err { color: var(--bad); min-height: 18px; font-size: 13px; }`;

const GATE_HTML = `
    <main id="gate">
      <form id="gate-form" autocomplete="on">
        <h1>Counter-Pick</h1>
        <p>Private build. Enter the password to open the app.</p>
        <input id="gate-pw" type="password" autocomplete="current-password" aria-label="Password" required autofocus />
        <label><input id="gate-remember" type="checkbox" checked /> Remember on this device</label>
        <button id="gate-go" type="submit">Unlock</button>
        <div class="err" id="gate-err" role="alert"></div>
      </form>
    </main>`;

/** the only inline script on the page (its hash is pinned in the CSP). */
function gateScript(): string {
  return `(() => {
  const SALT = ${JSON.stringify(SALT)}, ITER = ${ITERATIONS}, STORE = "dotaapp.pagesKey.v1";
  const $ = (id) => document.getElementById(id);
  const enc = new TextEncoder();
  async function derive(pw) {
    const base = await crypto.subtle.importKey("raw", enc.encode(pw), "PBKDF2", false, ["deriveKey"]);
    return crypto.subtle.deriveKey({ name: "PBKDF2", salt: enc.encode(SALT), iterations: ITER, hash: "SHA-256" },
      base, { name: "AES-GCM", length: 256 }, true, ["decrypt"]);
  }
  async function open(key) {
    const buf = new Uint8Array(await (await fetch("./app.bin", { cache: "no-cache" })).arrayBuffer());
    const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: buf.slice(0, 12) }, key, buf.slice(12));
    const text = await new Response(new Blob([plain]).stream().pipeThrough(new DecompressionStream("gzip"))).text();
    const p = JSON.parse(text);
    window.__DOTA_BUNDLE = p.data;
    document.documentElement.classList.remove("locked");
    await import(URL.createObjectURL(new Blob([p.js], { type: "text/javascript" })));
  }
  async function remembered() {
    try {
      const raw = localStorage.getItem(STORE);
      if (!raw) return false;
      const key = await crypto.subtle.importKey("raw", Uint8Array.from(atob(raw), (c) => c.charCodeAt(0)), "AES-GCM", false, ["decrypt"]);
      await open(key);
      return true;
    } catch {
      try { localStorage.removeItem(STORE); } catch {}
      return false;
    }
  }
  remembered().then((ok) => {
    if (ok) return;
    $("gate-form").addEventListener("submit", async (e) => {
      e.preventDefault();
      $("gate-err").textContent = "";
      $("gate-go").disabled = true;
      $("gate-go").textContent = "Unlocking…";
      try {
        const key = await derive($("gate-pw").value);
        await open(key);
        if ($("gate-remember").checked) {
          const raw = new Uint8Array(await crypto.subtle.exportKey("raw", key));
          try { localStorage.setItem(STORE, btoa(String.fromCharCode(...raw))); } catch {}
        }
      } catch (err) {
        $("gate-err").textContent = err && err.name === "OperationError" ? "Wrong password." : "Could not open the app: " + err;
        $("gate-go").disabled = false;
        $("gate-go").textContent = "Unlock";
      }
    });
  });
})();`;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
