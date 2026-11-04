// =============================================================================
//  Build the STRATZ query specs scripts/stratz/<dataset>.json that the "Fetch STRATZ
//  stats" workflow runs (ADR-027). Input: positions.json from a previous items run
//  (matches per hero x position in Crusader-Archon + Legend-Ancient).
//
//      git show origin/stratz-raw:positions.json > /tmp/positions.json   (or items/positions.json)
//      npx tsx scripts/build-stratz-queries.ts /tmp/positions.json
//
//  Datasets (one workflow run each, >= 15 min apart: STRATZ allows 2 IPs / 15 min):
//    items      item purchases / starting items / boots per hero x position   ~66 calls
//    durations  win rate by match minute per position, Archon + Legend exactly   5 calls
//    matchups   hero vs / with hero, Crusader-Archon + Legend-Ancient           ~32 calls
//    lanes      lane outcome vs each enemy hero, per hero x position           ~65 calls
//    neutrals   neutral items per hero x position                              ~43 calls
//  A hero x position is kept with >= 10% of the hero's games and >= 3000 games (at
//  least the hero's main position).
// =============================================================================

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

const BRACKETS = "bracketBasicIds: [CRUSADER_ARCHON, LEGEND_ANCIENT]";
const MIN_SHARE = 0.1;
const MIN_GAMES = 3000;

interface Row {
  heroId: number;
  position: string;
  matchCount: number;
}
interface Batch {
  name: string;
  query: string;
}

const file = process.argv[2];
if (!file) {
  console.error("usage: tsx scripts/build-stratz-queries.ts <positions.json>");
  process.exit(1);
}
const rows = (JSON.parse(readFileSync(file, "utf8")) as { heroStats: { stats: Row[] } }).heroStats.stats;
const byHero = new Map<number, Map<string, number>>();
for (const r of rows) {
  if (!/^POSITION_[1-5]$/.test(r.position)) continue;
  const m = byHero.get(r.heroId) ?? new Map<string, number>();
  m.set(r.position, (m.get(r.position) ?? 0) + r.matchCount);
  byHero.set(r.heroId, m);
}
const heroes = [...byHero.keys()].sort((a, b) => a - b);
const pairs: Array<[number, string]> = [];
for (const hero of heroes) {
  const m = byHero.get(hero)!;
  const total = [...m.values()].reduce((a, b) => a + b, 0);
  const sorted = [...m.entries()].sort((a, b) => b[1] - a[1]);
  const keep = sorted.filter(([, n]) => n / total >= MIN_SHARE && n >= MIN_GAMES);
  for (const [pos] of keep.length ? keep : sorted.slice(0, 1)) pairs.push([hero, pos]);
}

function chunked<T>(xs: T[], n: number, name: string, body: (chunk: T[]) => string): Batch[] {
  const out: Batch[] = [];
  for (let i = 0; i < xs.length; i += n) {
    out.push({ name: `${name}_${String(i / n).padStart(3, "0")}`, query: `{ heroStats { ${body(xs.slice(i, i + n))} } }` });
  }
  return out;
}
const alias = (h: number, pos: string) => `h${h}_${pos.slice(-1)}`;
const pargs = (h: number, pos: string) => `heroId: ${h}, ${BRACKETS}, positionIds: [${pos}]`;

const datasets: Record<string, Batch[]> = {
  items: [
    { name: "positions", query: `{ heroStats { stats(${BRACKETS}, groupByPosition: true) { heroId position matchCount winCount } } }` },
    ...chunked(pairs, 4, "items", (c) =>
      c
        .map(
          ([h, p]) =>
            `${alias(h, p)}_full: itemFullPurchase(${pargs(h, p)}) { itemId instance time matchCount winCount } ` +
            `${alias(h, p)}_start: itemStartingPurchase(${pargs(h, p)}) { itemId instance wasGiven matchCount winCount } ` +
            `${alias(h, p)}_boots: itemBootPurchase(${pargs(h, p)}) { itemId instance time matchCount winCount }`,
        )
        .join(" "),
    ),
  ],
  // the latest game version only (take: 1), ranked All Pick, exactly Archon + Legend
  durations: [1, 2, 3, 4, 5].map((p) => ({
    name: `durations_${p}`,
    query:
      `{ heroStats { winGameVersion(take: 1, bracketIds: [ARCHON, LEGEND], positionIds: [POSITION_${p}], ` +
      `gameModeIds: [ALL_PICK_RANKED], groupBy: HERO_ID_DURATION_MINUTES) { gameVersionId heroId durationMinute winCount matchCount } } }`,
  })),
  matchups: chunked(heroes, 4, "matchups", (c) =>
    c
      .map(
        (h) =>
          `m${h}: heroVsHeroMatchup(heroId: ${h}, ${BRACKETS}, take: 200) { advantage { heroId matchCountVs matchCountWith ` +
          `vs { heroId2 matchCount winCount synergy } with { heroId2 matchCount winCount synergy } } }`,
      )
      .join(" "),
  ),
  lanes: chunked(pairs, 4, "lanes", (c) =>
    c
      .map(
        ([h, p]) =>
          `${alias(h, p)}: laneOutcome(heroId: ${h}, isWith: false, ${BRACKETS}, positionIds: [${p}]) ` +
          `{ heroId2 matchCount winCount drawCount lossCount stompWinCount stompLossCount }`,
      )
      .join(" "),
  ),
  neutrals: chunked(pairs, 6, "neutrals", (c) =>
    c
      .map(([h, p]) => `${alias(h, p)}: itemNeutral(${pargs(h, p)}) { itemId matchCount winCount equippedMatchCount equippedMatchWinCount }`)
      .join(" "),
  ),
};

mkdirSync("scripts/stratz", { recursive: true });
for (const [name, batches] of Object.entries(datasets)) {
  writeFileSync(`scripts/stratz/${name}.json`, JSON.stringify({ brackets: BRACKETS, pairs, batches }, null, 1));
  console.log(`${name}: ${batches.length} calls`);
}
