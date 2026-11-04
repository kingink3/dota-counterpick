// =============================================================================
//  data/benchmarks.json (ADR-029): per-minute averages by hero x position from STRATZ
//  heroStats.stats(groupByTime) - Crusader-Archon + Legend-Ancient. The match review
//  compares your last hits / networth / xp / deaths at a minute with these.
//
//      npx tsx scripts/build-stratz-benchmarks.ts --stratz <stratz-raw> --heroes <opendota heroes.json>
//  Output: { source, fetchedAt, minutes, heroes: { code: { "1": { cs: [...], ... } } } }
// =============================================================================

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readRawKB } from "../src/kb.js";
import { heroValveName } from "../src/web/hero-art.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const BENCH_MINUTES = [5, 10, 15, 20, 25, 30, 35, 40];
const FIELDS = ["cs", "dn", "networth", "xp", "level", "kills", "deaths", "assists", "heroDamage", "towerDamage"] as const;
const MIN_GAMES = 1000;

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
}
const dir = arg("stratz");
const heroesFile = arg("heroes");
if (!dir || !heroesFile) {
  console.error("usage: tsx scripts/build-stratz-benchmarks.ts --stratz <dir> --heroes <heroes.json>");
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

type Row = { heroId: number; time: number; matchCount: number } & Record<(typeof FIELDS)[number], number>;
const heroes: Record<string, Record<string, Record<string, number[]> & { games: number }>> = {};
for (let p = 1; p <= 5; p++) {
  const f = join(dir, "review", `bench_${p}.json`);
  if (!existsSync(f)) continue;
  const rows = (JSON.parse(readFileSync(f, "utf8")) as { heroStats: { stats: Row[] } }).heroStats.stats;
  const byHero = new Map<number, Map<number, Row>>();
  for (const r of rows) {
    const m = byHero.get(r.heroId) ?? new Map<number, Row>();
    m.set(r.time, r);
    byHero.set(r.heroId, m);
  }
  for (const [id, m] of byHero) {
    const code = idToCode.get(id);
    const games = m.get(0)?.matchCount ?? 0;
    if (!code || games < MIN_GAMES) continue;
    const out = { games } as Record<string, number[]> & { games: number };
    for (const k of FIELDS) out[k] = BENCH_MINUTES.map((t) => Math.round((m.get(t)?.[k] ?? NaN) * 10) / 10);
    (heroes[code] ??= {})[String(p)] = out;
  }
}
const fetchedAt = existsSync(join(dir, "review", "fetched-at.txt")) ? readFileSync(join(dir, "review", "fetched-at.txt"), "utf8").trim() : undefined;
writeFileSync(
  join(ROOT, "data", "benchmarks.json"),
  JSON.stringify({ source: "STRATZ, Crusader-Archon + Legend-Ancient, per-minute averages", ...(fetchedAt ? { fetchedAt } : {}), minutes: BENCH_MINUTES, heroes }),
);
console.log(`benchmarks.json: ${Object.keys(heroes).length} heroes, ${Object.values(heroes).reduce((s, h) => s + Object.keys(h).length, 0)} hero-positions`);
