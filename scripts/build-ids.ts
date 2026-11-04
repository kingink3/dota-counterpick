// =============================================================================
//  data/ids.json (ADR-029): numeric ids in STRATZ match data -> our codes.
//    heroes: OpenDota/STRATZ hero id -> KB code (roster valve name when not in the KB)
//    items:  item id -> dotaconstants key (icons in web/items use it)
//    cd:     active item cooldown in seconds (dotaconstants) - "died with BKB ready"
//
//      npx tsx scripts/build-ids.ts --constants <dotaconstants/build> --heroes <opendota heroes.json>
// =============================================================================

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readRawKB } from "../src/kb.js";
import { heroValveName } from "../src/web/hero-art.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
}
const constants = arg("constants");
const heroesFile = arg("heroes");
if (!constants || !heroesFile) {
  console.error("usage: tsx scripts/build-ids.ts --constants <dir> --heroes <heroes.json>");
  process.exit(1);
}
const kb = readRawKB(ROOT);
const valveToCode = new Map<string, string>();
for (const code of Object.keys(kb.taxonomy.hero_tags)) valveToCode.set(heroValveName(code), code);
const heroes: Record<string, string> = {};
for (const h of JSON.parse(readFileSync(heroesFile, "utf8")) as Array<{ id: number; name: string }>) {
  const valve = h.name.replace(/^npc_dota_hero_/, "");
  heroes[String(h.id)] = valveToCode.get(valve) ?? valve;
}
const dc = JSON.parse(readFileSync(join(constants, "items.json"), "utf8")) as Record<string, { id?: number; cd?: number | false; dname?: string }>;
const items: Record<string, string> = {};
const cd: Record<string, number> = {};
const names: Record<string, string> = {};
for (const [k, v] of Object.entries(dc)) {
  if (v.id === undefined) continue;
  items[String(v.id)] = k;
  if (typeof v.cd === "number" && v.cd > 0) cd[k] = v.cd;
  if (v.dname) names[k] = v.dname;
}
writeFileSync(join(ROOT, "data", "ids.json"), JSON.stringify({ heroes, items, cd, names }));
console.log(`ids.json: ${Object.keys(heroes).length} heroes, ${Object.keys(items).length} items, ${Object.keys(cd).length} cooldowns`);
