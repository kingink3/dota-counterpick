// =============================================================================
//  Build scripts/stratz-queries.json - the batches the "Fetch STRATZ stats" workflow
//  runs in mode=fetch (ADR-027). Input: positions.json from a previous run (the
//  `positions` batch: matches per hero x position in Crusader-Archon + Legend-Ancient).
//
//      git show origin/stratz-raw:positions.json > /tmp/positions.json
//      npx tsx scripts/build-stratz-queries.ts /tmp/positions.json
//
//  A hero gets every position with >= 10% of its games (and >= 3000 games), at least
//  its main one. 4 hero-positions per call (aliases) -> ~65 calls, far below the
//  free-token limits.
// =============================================================================

import { readFileSync, writeFileSync } from "node:fs";

const BRACKETS = "bracketBasicIds: [CRUSADER_ARCHON, LEGEND_ANCIENT]";
const PER_CALL = 4;
const MIN_SHARE = 0.1;
const MIN_GAMES = 3000;

interface Row {
  heroId: number;
  position: string;
  matchCount: number;
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
const pairs: Array<[number, string]> = [];
for (const [hero, m] of [...byHero.entries()].sort((a, b) => a[0] - b[0])) {
  const total = [...m.values()].reduce((a, b) => a + b, 0);
  const sorted = [...m.entries()].sort((a, b) => b[1] - a[1]);
  const keep = sorted.filter(([, n]) => n / total >= MIN_SHARE && n >= MIN_GAMES);
  for (const [pos] of keep.length ? keep : sorted.slice(0, 1)) pairs.push([hero, pos]);
}

const field = (h: number, pos: string) => {
  const a = `h${h}_${pos.slice(-1)}`;
  const args = `heroId: ${h}, ${BRACKETS}, positionIds: [${pos}]`;
  return (
    `${a}_full: itemFullPurchase(${args}) { itemId instance time matchCount winCount } ` +
    `${a}_start: itemStartingPurchase(${args}) { itemId instance wasGiven matchCount winCount } ` +
    `${a}_boots: itemBootPurchase(${args}) { itemId instance time matchCount winCount }`
  );
};
const batches = [
  { name: "positions", query: `{ heroStats { stats(${BRACKETS}, groupByPosition: true) { heroId position matchCount winCount } } }` },
];
for (let i = 0; i < pairs.length; i += PER_CALL) {
  const chunk = pairs.slice(i, i + PER_CALL);
  batches.push({ name: `items_${String(i / PER_CALL).padStart(3, "0")}`, query: `{ heroStats { ${chunk.map(([h, p]) => field(h, p)).join(" ")} } }` });
}
writeFileSync("scripts/stratz-queries.json", JSON.stringify({ brackets: BRACKETS, pairs, batches }, null, 1));
console.log(`${pairs.length} hero-positions -> ${batches.length} calls`);
