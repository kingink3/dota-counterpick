// =============================================================================
//  Download hero portraits into web/heroes/ so the app self-hosts them instead of
//  hot-linking Steam's CDN (which is blocked / unreachable on some networks).
//
//  Source: Valve dota_react landscape portraits, keyed by roster valve name.
//  Idempotent: skips files already present. Run once (needs network):
//      npm run fetch:portraits
// =============================================================================

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "web", "heroes");
const CDN = "https://cdn.steamstatic.com/apps/dota2/images/dota_react/heroes";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/124.0 Safari/537.36";

async function main(): Promise<void> {
  mkdirSync(OUT, { recursive: true });
  const roster = JSON.parse(readFileSync(join(ROOT, "data", "roster.json"), "utf8")) as {
    heroes: Array<{ valve: string }>;
  };

  let ok = 0;
  let skipped = 0;
  const failed: string[] = [];
  for (const { valve } of roster.heroes) {
    const dest = join(OUT, `${valve}.png`);
    if (existsSync(dest)) {
      skipped++;
      continue;
    }
    try {
      const res = await fetch(`${CDN}/${valve}.png`, { headers: { "user-agent": UA } });
      if (!res.ok) {
        failed.push(`${valve} (${res.status})`);
        continue;
      }
      writeFileSync(dest, Buffer.from(await res.arrayBuffer()));
      ok++;
    } catch (e) {
      failed.push(`${valve} (${(e as Error).message})`);
    }
  }
  console.log(`portraits: ${ok} downloaded, ${skipped} already present -> web/heroes/`);
  if (failed.length) console.log(`failed (${failed.length}): ${failed.join(", ")}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
