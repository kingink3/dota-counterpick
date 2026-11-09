// =============================================================================
//  Replays for the stored matches (ADR-043, ADR-045). For every match*.json in --dir:
//    OpenDota replay_url (or a parse request, waited for) -> Valve CDN (.dem.bz2 name,
//    Zstandard or bzip2 inside) -> odota/parser on localhost:5600 -> buildTimeline
//    -> `replay` added to the match JSON (the store step encrypts it).
//  Optional: a match without a replay is stored as before. Logs counts only.
//
//    npx tsx scripts/replay-fetch.ts --dir /tmp/match [--parser http://localhost:5600]
// =============================================================================

import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { buildTimeline } from "../src/replay.js";
import { odWithReplay, parseReplay } from "./replay-lib.js";

const arg = (n: string) => {
  const i = process.argv.indexOf(`--${n}`);
  return i > 0 ? process.argv[i + 1] : undefined;
};

async function one(file: string, parser: string): Promise<string> {
  const m = JSON.parse(readFileSync(file, "utf8")) as { id: number; replay?: unknown };
  if (m.replay) return "has its replay already";
  const t0 = Date.now();
  const url = (await odWithReplay(m.id))?.replay_url;
  if (!url) return "no replay url";
  const p = await parseReplay(m.id, url, parser);
  if ("error" in p) return p.error;
  const tl = buildTimeline(p.lines);
  if (!tl) return "parser gave no timeline";
  m.replay = tl;
  writeFileSync(file, JSON.stringify(m));
  const secs = tl.heroes[Object.keys(tl.heroes)[0]!]!.x.length;
  return `ok: ${p.mb.toFixed(0)} MB dem, ${Object.keys(tl.heroes).length} heroes x ${secs} s, ${tl.disables.length} disables, ${tl.objectives?.filter((o) => o.kind === "tower" || o.kind === "rax").length ?? 0} buildings / ${tl.objectives?.filter((o) => o.kind === "roshan").length ?? 0} Roshan / ${tl.objectives?.filter((o) => o.kind === "tormentor").length ?? 0} Tormentor fell, ${Math.round((Date.now() - t0) / 1000)} s`;
}

async function main(): Promise<void> {
  const dir = arg("dir") ?? "/tmp/match";
  const parser = arg("parser") ?? "http://localhost:5600";
  if (!existsSync(dir)) return;
  const files = readdirSync(dir).filter((f) => /^match.*\.json$/.test(f));
  for (const f of files) {
    let msg: string;
    try {
      msg = await one(join(dir, f), parser);
    } catch (e) {
      msg = `failed: ${String(e).slice(0, 120)}`;
    }
    console.log(`replay ${files.indexOf(f) + 1}/${files.length}: ${msg}`); // no match id: the log is public
  }
}

void main().catch((e) => {
  console.error(String(e));
  process.exit(0); // replays are optional: never fail the run because of them
});
