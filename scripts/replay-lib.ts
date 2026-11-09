// =============================================================================
//  Replays in Actions (ADR-043, ADR-045, ADR-053): OpenDota match -> replay_url (or a
//  parse request, waited for) -> Valve CDN (.dem.bz2 name, Zstandard or bzip2 inside)
//  -> odota/parser on localhost:5600 -> NDJSON lines. Logs nothing (the caller logs counts).
// =============================================================================

import { execFileSync } from "node:child_process";
import { createReadStream, existsSync, rmSync, statSync, writeFileSync } from "node:fs";
import { Readable } from "node:stream";
import type { OdMatch } from "../src/replay-match.js";

export const OD = "https://api.opendota.com/api";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export type OdFull = OdMatch & { replay_url?: string };

export async function odMatch(id: number): Promise<OdFull | undefined> {
  const r = await fetch(`${OD}/matches/${id}`).catch(() => undefined);
  if (!r?.ok) return undefined;
  return (await r.json()) as OdFull;
}

/** OpenDota's match with a replay_url; asks OpenDota to fetch it when missing (up to ~8 min). */
export async function odWithReplay(id: number): Promise<OdFull | undefined> {
  let m = await odMatch(id);
  if (m?.replay_url) return m;
  await fetch(`${OD}/request/${id}`, { method: "POST" }).catch(() => undefined);
  for (let i = 0; i < 16 && !m?.replay_url; i++) {
    await sleep(30_000);
    m = (await odMatch(id)) ?? m;
  }
  return m;
}

/** our clarity extractor (tools/clarity, ADR-055), when it was built: HP, mana, gold, items. */
const EXTRACT_CP = "tools/clarity/target/classes:tools/clarity/target/dependency/*";
function extract(dem: string): string[] | undefined {
  if (!existsSync("tools/clarity/target/classes/app/Extract.class")) return undefined;
  try {
    return execFileSync("java", ["-cp", EXTRACT_CP, "app.Extract", dem], { maxBuffer: 256 << 20, stdio: ["ignore", "pipe", "ignore"] }).toString().split("\n");
  } catch {
    return undefined; // optional: the review runs without it
  }
}

/** download, unpack, parse: the parser's NDJSON lines (+ our extractor's), or why not. */
export async function parseReplay(id: number, url: string, parser: string): Promise<{ lines: string[]; extract?: string[]; mb: number } | { error: string }> {
  const r = await fetch(url);
  if (!r.ok) return { error: `CDN HTTP ${r.status}` };
  const packed = `/tmp/r-${id}.pack`;
  const dem = `/tmp/r-${id}.dem`;
  writeFileSync(packed, Buffer.from(await r.arrayBuffer()));
  const kind = execFileSync("file", ["-b", packed]).toString();
  if (/Zstandard/.test(kind)) execFileSync("zstd", ["-q", "-f", "-d", packed, "-o", dem]);
  else if (/bzip2/.test(kind)) execFileSync("sh", ["-c", `bunzip2 -c "${packed}" > "${dem}"`]);
  else execFileSync("mv", [packed, dem]);
  rmSync(packed, { force: true });
  const mb = statSync(dem).size / 1e6;
  const res = await fetch(parser, {
    method: "POST",
    body: Readable.toWeb(createReadStream(dem)) as never,
    duplex: "half",
  } as RequestInit & { duplex: "half" });
  const ex = res.ok ? extract(dem) : undefined;
  rmSync(dem, { force: true });
  if (!res.ok) return { error: `parser HTTP ${res.status}` };
  return { lines: (await res.text()).split("\n"), ...(ex ? { extract: ex } : {}), mb };
}

/** the "SteamId" claim of a STRATZ token (no call: read from the token). */
export function ownerOf(token: string): number | undefined {
  try {
    const json = JSON.parse(Buffer.from(token.split(".")[1] ?? "", "base64url").toString("utf8")) as { SteamId?: string };
    const n = Number(json.SteamId);
    return n > 0 ? n : undefined;
  } catch {
    return undefined;
  }
}
