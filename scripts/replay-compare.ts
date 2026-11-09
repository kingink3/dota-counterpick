// Dev check (ADR-053): one match reviewed from STRATZ and from the replay, finding by finding.
//   npx tsx scripts/replay-compare.ts --dir <folder with opendota.json, parsed.ndjson.gz, stratz.json.gz>
import { existsSync, readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { join } from "node:path";
import { loadKB } from "../src/kb.js";
import type { ItemStats } from "../src/item-plan.js";
import { buildTimeline } from "../src/replay.js";
import { matchFromReplay, type OdMatch } from "../src/replay-match.js";
import { reviewMatch, type Benchmarks, type Ids, type MatchData } from "../src/review.js";

const dir = process.argv[process.argv.indexOf("--dir") + 1]!;
const kb = loadKB();
const ids = JSON.parse(readFileSync("data/ids.json", "utf8")) as Ids;
const stats = JSON.parse(readFileSync("data/item-stats.json", "utf8")) as ItemStats;
const bench = JSON.parse(readFileSync("data/benchmarks.json", "utf8")) as Benchmarks;
const ctx = { kb, ids, stats, bench, label: (c: string) => c };
const od = JSON.parse(readFileSync(join(dir, "opendota.json"), "utf8")) as OdMatch;
const lines = gunzipSync(readFileSync(join(dir, "parsed.ndjson.gz"))).toString().split("\n");
const st = JSON.parse(gunzipSync(readFileSync(join(dir, "stratz.json.gz"))).toString()) as { summary: MatchData["summary"]; positions?: MatchData["positions"]; health?: MatchData["health"]; vision?: MatchData["vision"]; players: Record<string, MatchData["me"]>; replay?: MatchData["replay"] };
const replay = buildTimeline(lines)!;
const comps = Object.fromEntries(Object.entries(stats.items).map(([k, v]) => [k, v.components]));
const costs = Object.fromEntries(Object.entries(stats.items).map(([k, v]) => [k, v.cost]));
const extract = existsSync(join(dir, "extract.ndjson.gz")) && !process.argv.includes("--no-extract") ? gunzipSync(readFileSync(join(dir, "extract.ndjson.gz"))).toString().split("\n") : undefined;
const rm = matchFromReplay(lines, od, { ids, components: comps, costs, ...(extract ? { extract } : {}) })!;
console.log("extract", extract ? "yes" : "no");
console.log("accounts", Object.keys(rm.players).length, "stratz", Object.keys(st.players).length, "same", Object.keys(rm.players).filter((a) => st.players[a]).length);
for (const p of rm.summary.players) {
  const q = st.summary.players.find((x) => x.playerSlot === p.playerSlot)!;
  if (p.position !== q.position || p.lane !== q.lane || p.kills !== q.kills || p.deaths !== q.deaths) console.log("summary diff", p.playerSlot, p.position, q.position, p.lane, q.lane, p.kills, q.kills, p.deaths, q.deaths);
}
console.log("bracket", rm.summary.bracket, st.summary.bracket, "mode", rm.summary.gameMode, rm.summary.lobbyType);
const only = process.argv.includes("--brief");
for (const acc of Object.keys(st.players)) {
  const a = reviewMatch({ summary: st.summary, me: st.players[acc]!, ...(st.positions ? { positions: st.positions } : {}), ...(st.health ? { health: st.health } : {}), ...(st.vision ? { vision: st.vision } : {}), replay }, Number(acc), ctx);
  const me = rm.players[acc];
  if (!me) { console.log(acc, "missing in replay"); continue; }
  const b = reviewMatch({ summary: rm.summary, me, positions: rm.positions, vision: rm.vision, ...(rm.health ? { health: rm.health } : {}), replay }, Number(acc), ctx);
  const fa = new Map(a.findings.map((f) => [f.id, f]));
  const fb = new Map(b.findings.map((f) => [f.id, f]));
  console.log(`\n== slot ${st.players[acc]!.playerSlot} pos ${a.position}/${b.position} deaths ${a.deaths?.length ?? "?"}/${b.deaths?.length ?? "?"}`);
  for (const id of new Set([...fa.keys(), ...fb.keys()])) {
    const x = fa.get(id), y = fb.get(id);
    if (x && y && x.title === y.title) { if (!only) console.log("  =", id); continue; }
    console.log(`  ${x ? (y ? "~" : "S") : "R"} ${id}: ${x?.title ?? ""}${x && y ? "  ||  " : ""}${y?.title ?? ""}`);
  }
}
