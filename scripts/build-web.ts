// =============================================================================
//  Build the static web bundle (ADR-001 deploy-by-URL, ADR-006 YAML -> JSON).
//    1. emit web/kb.json   - the RawKB the browser fetches (no runtime DB).
//    2. bundle web/app.js  - the engine core + UI, via esbuild.
//  Output folder `web/` is a self-contained static site: serve it anywhere.
// =============================================================================

import { copyFileSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { readRawKB } from "../src/kb.js";
import { heroValveName } from "../src/web/hero-art.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const WEB = join(ROOT, "web");

async function main(): Promise<void> {
  const raw = readRawKB(ROOT);

  // combos may reference roster-only supports; validate their codes against the
  // full roster (a portrait only loads if the valve name is real).
  const roster = JSON.parse(
    readFileSync(join(ROOT, "data", "roster.json"), "utf8"),
  ) as { heroes: Array<{ valve: string }> };
  const rosterValve = new Set(roster.heroes.map((h) => h.valve));
  const badCombo = raw.combos
    .flatMap((c) => c.pair)
    .filter((code) => !rosterValve.has(heroValveName(code)));
  if (badCombo.length) {
    console.error(`combo heroes not in roster: ${[...new Set(badCombo)].join(", ")}`);
    process.exit(1);
  }

  writeFileSync(join(WEB, "kb.json"), JSON.stringify(raw), "utf8");
  console.log(
    `kb.json: ${Object.keys(raw.taxonomy.hero_tags).length} heroes, ` +
      `${raw.taxonomy.edges.length} edges, ${raw.items.length} items, ` +
      `${raw.heroEdges.length} hero-edges, ${raw.itemEdges.length} item-edges, ` +
      `${raw.defenseEdges.length} defense, ${raw.combos.length} combos`,
  );

  // full picker roster (committed static data; see scripts/build-roster.ts)
  copyFileSync(join(ROOT, "data", "roster.json"), join(WEB, "roster.json"));
  console.log("roster.json copied → web/");

  // optional stat layer (hero-vs-hero win rates), fetched separately by the browser
  try {
    copyFileSync(join(ROOT, "data", "matchups.json"), join(WEB, "matchups.json"));
    console.log("matchups.json copied → web/");
  } catch {
    console.log("matchups.json absent - win rates disabled");
  }
  // optional: hero item / timing / game-length stats (ADR-026, scripts/build-item-stats.ts)
  try {
    copyFileSync(join(ROOT, "data", "item-stats.json"), join(WEB, "item-stats.json"));
    console.log("item-stats.json copied → web/");
  } catch {
    console.log("item-stats.json absent - item plan disabled");
  }

  await build({
    entryPoints: [join(ROOT, "src", "web", "main.ts")],
    bundle: true,
    format: "esm",
    target: "es2022",
    platform: "browser",
    outfile: join(WEB, "app.js"),
    minify: true,
    sourcemap: true,
    logLevel: "info",
  });
  console.log("app.js bundled → web/");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
