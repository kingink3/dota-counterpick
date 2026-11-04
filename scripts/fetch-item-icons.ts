// =============================================================================
//  Download item icons into web/items/ (ADR-025): templates for reading enemy
//  items off the Tab scoreboard, and icons for the item chips.
//
//  Source: Valve dota_react item icons, keyed by the dotaconstants item key
//  (black_king_bar, sphere, ...). Covers every shop item and neutral item.
//  Idempotent: skips files already present. Needs network (the session container
//  has none - run on your machine or via the "Fetch item icons" workflow):
//      npm run fetch:items -- --constants <dotaconstants/build>
// =============================================================================

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "web", "items");
const CDN = "https://cdn.steamstatic.com";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/124.0 Safari/537.36";

interface DCItem { dname?: string; img?: string; cost?: number | null; tier?: number | null; qual?: string | null }

async function main(): Promise<void> {
  const i = process.argv.indexOf("--constants");
  const dir = i >= 0 ? process.argv[i + 1] : undefined;
  if (!dir || !existsSync(join(dir, "items.json"))) {
    console.error("usage: npm run fetch:items -- --constants <dotaconstants/build>   (npm pack dotaconstants && tar xzf ...)");
    process.exit(1);
  }
  const items = JSON.parse(readFileSync(join(dir, "items.json"), "utf8")) as Record<string, DCItem>;
  mkdirSync(OUT, { recursive: true });
  // buyable items + neutral items (tier set); recipes and removed (cost 0, no tier) skipped
  const wanted = Object.entries(items).filter(
    ([k, v]) => v.img && !k.startsWith("recipe_") && ((v.cost ?? 0) > 0 || (v.tier ?? 0) > 0),
  );
  let ok = 0;
  let skipped = 0;
  const failed: string[] = [];
  for (const [key, v] of wanted) {
    const dest = join(OUT, `${key}.png`);
    if (existsSync(dest)) {
      skipped++;
      continue;
    }
    try {
      const res = await fetch(CDN + v.img!.split("?")[0], { headers: { "user-agent": UA } });
      if (!res.ok) {
        failed.push(`${key} (${res.status})`);
        continue;
      }
      writeFileSync(dest, Buffer.from(await res.arrayBuffer()));
      ok++;
    } catch (e) {
      failed.push(`${key} (${(e as Error).message})`);
    }
  }
  // index for the web app: key -> display name, neutral flag
  const index = Object.fromEntries(
    wanted.filter(([k]) => existsSync(join(OUT, `${k}.png`))).map(([k, v]) => [k, { name: v.dname ?? k, neutral: (v.tier ?? 0) > 0 && !(v.cost ?? 0) }]),
  );
  writeFileSync(join(OUT, "index.json"), JSON.stringify(index, null, 0) + "\n");
  console.log(`item icons: ${ok} downloaded, ${skipped} already present, ${Object.keys(index).length} indexed -> web/items/`);
  if (failed.length) console.log(`failed (${failed.length}): ${failed.slice(0, 20).join(", ")}${failed.length > 20 ? " …" : ""}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
