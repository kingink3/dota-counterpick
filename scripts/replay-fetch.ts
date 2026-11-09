// =============================================================================
//  Replays for the stored matches (ADR-043, ADR-045). For every match*.json in --dir:
//    OpenDota replay_url (or a parse request, waited for) -> Valve CDN (.dem.bz2 name,
//    Zstandard or bzip2 inside) -> odota/parser on localhost:5600 -> buildTimeline
//    -> `replay` added to the match JSON (the store step encrypts it).
//  Optional: a match without a replay is stored as before. Logs counts only.
//
//    npx tsx scripts/replay-fetch.ts --dir /tmp/match [--parser http://localhost:5600]
// =============================================================================

import { execFileSync } from "node:child_process";
import { createReadStream, existsSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Readable } from "node:stream";
import { buildTimeline } from "../src/replay.js";

const arg = (n: string) => {
  const i = process.argv.indexOf(`--${n}`);
  return i > 0 ? process.argv[i + 1] : undefined;
};
const OD = "https://api.opendota.com/api";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function replayUrl(id: number): Promise<string | undefined> {
  const get = async () => ((await (await fetch(`${OD}/matches/${id}`)).json()) as { replay_url?: string }).replay_url;
  let url = await get().catch(() => undefined);
  if (url) return url;
  await fetch(`${OD}/request/${id}`, { method: "POST" }).catch(() => undefined);
  for (let i = 0; i < 16 && !url; i++) {
    await sleep(30_000);
    url = await get().catch(() => undefined);
  }
  return url;
}

async function one(file: string, parser: string): Promise<string> {
  const m = JSON.parse(readFileSync(file, "utf8")) as { id: number; replay?: unknown };
  const t0 = Date.now();
  const url = await replayUrl(m.id);
  if (!url) return "no replay url";
  const r = await fetch(url);
  if (!r.ok) return `CDN HTTP ${r.status}`;
  const packed = `/tmp/r-${m.id}.pack`;
  const dem = `/tmp/r-${m.id}.dem`;
  writeFileSync(packed, Buffer.from(await r.arrayBuffer()));
  const kind = execFileSync("file", ["-b", packed]).toString();
  if (/Zstandard/.test(kind)) execFileSync("zstd", ["-q", "-f", "-d", packed, "-o", dem]);
  else if (/bzip2/.test(kind)) execFileSync("sh", ["-c", `bunzip2 -c "${packed}" > "${dem}"`]);
  else execFileSync("mv", [packed, dem]);
  rmSync(packed, { force: true });
  const size = statSync(dem).size;
  const res = await fetch(parser, {
    method: "POST",
    body: Readable.toWeb(createReadStream(dem)) as never,
    duplex: "half",
  } as RequestInit & { duplex: "half" });
  if (!res.ok) return `parser HTTP ${res.status}`;
  const text = await res.text();
  rmSync(dem, { force: true });
  const tl = buildTimeline(text.split("\n"));
  if (!tl) return "parser gave no timeline";
  m.replay = tl;
  writeFileSync(file, JSON.stringify(m));
  const secs = tl.heroes[Object.keys(tl.heroes)[0]!]!.x.length;
  return `ok: ${(size / 1e6).toFixed(0)} MB dem, ${Object.keys(tl.heroes).length} heroes x ${secs} s, ${tl.disables.length} disables, ${Math.round((Date.now() - t0) / 1000)} s`;
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
