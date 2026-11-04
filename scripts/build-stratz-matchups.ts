// =============================================================================
//  data/matchups.json from STRATZ heroVsHeroMatchup (Crusader-Archon + Legend-Ancient)
//  - the draft's win-rate layer (ADR-005), replacing OpenDota's all-rank public
//  matches (tiny per-pair samples). Also keeps "with" (same team) for synergy.
//
//      npx tsx scripts/build-stratz-matchups.ts --stratz <stratz-raw> --heroes <opendota heroes.json>
//  Output: { source, fetchedAt, heroes: {code: {enemy: [wr, games]}}, allies: {code: {ally: [wr, games]}} }
// =============================================================================

import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readRawKB } from "../src/kb.js";
import { heroValveName } from "../src/web/hero-art.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const MIN_GAMES = 200;

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
}

interface Pair {
  heroId2: number;
  matchCount: number;
  winCount: number;
}

const dir = arg("stratz");
const heroesFile = arg("heroes");
if (!dir || !heroesFile) {
  console.error("usage: tsx scripts/build-stratz-matchups.ts --stratz <dir> --heroes <heroes.json>");
  process.exit(1);
}
const kb = readRawKB(ROOT);
const valveToCode = new Map<string, string>();
for (const code of Object.keys(kb.taxonomy.hero_tags)) valveToCode.set(heroValveName(code), code);
const idToCode = new Map<number, string>();
for (const h of JSON.parse(readFileSync(heroesFile, "utf8")) as Array<{ id: number; name: string }>) {
  const valve = h.name.replace(/^npc_dota_hero_/, "");
  idToCode.set(h.id, valveToCode.get(valve) ?? valve);
}
const vs: Record<string, Record<string, [number, number]>> = {};
const withs: Record<string, Record<string, [number, number]>> = {};
let pairs = 0;
const md = join(dir, "matchups");
for (const f of readdirSync(md).filter((x) => /^matchups_\d+\.json$/.test(x))) {
  const data = JSON.parse(readFileSync(join(md, f), "utf8")) as {
    heroStats: Record<string, { advantage: Array<{ heroId: number; vs: Pair[]; with: Pair[] }> }>;
  };
  for (const entry of Object.values(data.heroStats)) {
    for (const a of entry.advantage ?? []) {
      const code = idToCode.get(a.heroId);
      if (!code) continue;
      for (const [rows, out] of [[a.vs, vs], [a.with, withs]] as const) {
        const m: Record<string, [number, number]> = {};
        for (const r of rows ?? []) {
          const other = idToCode.get(r.heroId2);
          if (!other || r.matchCount < MIN_GAMES) continue;
          m[other] = [Math.round((r.winCount / r.matchCount) * 1000) / 1000, r.matchCount];
          pairs++;
        }
        out[code] = m;
      }
    }
  }
}
const fetchedAt = existsSync(join(md, "fetched-at.txt")) ? readFileSync(join(md, "fetched-at.txt"), "utf8").trim() : undefined;
writeFileSync(
  join(ROOT, "data", "matchups.json"),
  JSON.stringify({ source: "STRATZ, Crusader-Archon + Legend-Ancient", ...(fetchedAt ? { fetchedAt } : {}), heroes: vs, allies: withs }),
);
console.log(`matchups.json: ${Object.keys(vs).length} heroes, ${pairs} pairs`);
