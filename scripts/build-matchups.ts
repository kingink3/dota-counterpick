// =============================================================================
//  Build data/matchups.json - hero-vs-hero win rates (the Phase-2 stat layer,
//  ADR-005). Source: OpenDota /api/heroes/{id}/matchups (a hero's record vs each
//  opponent in public matches). Additive info only - it does NOT drive the KB rank.
//
//  OpenDota blocks Node's fetch (Cloudflare), so fetch with curl first, then build:
//      curl -s https://api.opendota.com/api/heroes -o heroes.json
//      mkdir mu && for id in $(...); do curl .../heroes/$id/matchups -o mu/$id.json; done
//      npx tsx scripts/build-matchups.ts heroes.json mu
//
//  Output: { source, heroes: { <code>: { <enemyCode>: winrate } } }  (winrate 0..1)
// =============================================================================

import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readRawKB } from "../src/kb.js";
import { heroValveName } from "../src/web/hero-art.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const MIN_GAMES = 25; // ignore tiniest samples; keep n so the UI can show confidence

interface ODHero { id: number; name: string }
interface MURow { hero_id: number; games_played: number; wins: number }

function main(): void {
  const [heroesFile, muDir] = process.argv.slice(2);
  if (!heroesFile || !muDir) {
    console.error("usage: tsx scripts/build-matchups.ts <heroes.json> <mu-dir>");
    process.exit(1);
  }

  const od = JSON.parse(readFileSync(heroesFile, "utf8")) as ODHero[];
  const kb = readRawKB(ROOT);
  const valveToCode = new Map<string, string>();
  for (const code of Object.keys(kb.taxonomy.hero_tags)) valveToCode.set(heroValveName(code), code);
  const idToCode = new Map<number, string>();
  for (const h of od) {
    const valve = h.name.replace(/^npc_dota_hero_/, "");
    idToCode.set(h.id, valveToCode.get(valve) ?? valve);
  }

  // heroes[code][enemyCode] = [winrate (0..1, 3dp), games] - games kept for confidence.
  const heroes: Record<string, Record<string, [number, number]>> = {};
  let pairs = 0;
  for (const file of readdirSync(muDir)) {
    const m = file.match(/^(\d+)\.json$/);
    if (!m) continue;
    const code = idToCode.get(Number(m[1]));
    if (!code) continue;
    let rows: MURow[];
    try {
      rows = JSON.parse(readFileSync(join(muDir, file), "utf8")) as MURow[];
    } catch {
      continue;
    }
    if (!Array.isArray(rows)) continue;
    const vs: Record<string, [number, number]> = {};
    for (const r of rows) {
      const enemy = idToCode.get(r.hero_id);
      if (!enemy || r.games_played < MIN_GAMES) continue;
      vs[enemy] = [Math.round((r.wins / r.games_played) * 1000) / 1000, r.games_played];
      pairs++;
    }
    if (Object.keys(vs).length) heroes[code] = vs;
  }

  writeFileSync(
    join(ROOT, "data", "matchups.json"),
    JSON.stringify({ source: "https://api.opendota.com (public matches)", heroes }) + "\n",
    "utf8",
  );
  console.log(`matchups.json: ${Object.keys(heroes).length} heroes, ${pairs} pairs (min ${MIN_GAMES} games)`);
}

main();
