// =============================================================================
//  Match store (ADR-031): adds one fetched match (stratz-fetch --mode match) to the
//  `review-data` branch, encrypted with the site key (APP_PASSWORD secret), and
//  keeps the newest KEEP. The branch is public, so nothing is in the clear:
//    index.bin   sealed JSON: [{ file, id, at, duration, radiantWin, heroes, owner }]
//    <random>.bin  sealed match JSON (summary, positions, health, vision, players)
//  File names are random, so the match ids are not visible either.
//
//    APP_PASSWORD=... tsx scripts/review-store.ts --in match.json --dir <branch checkout>
// =============================================================================

import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { MIN_PASSWORD, seal, siteKey, unseal } from "./seal.js";

const KEEP = 50;

export interface StoreEntry {
  file: string;
  id: number;
  /** when it was fetched (unix seconds). */
  at: number;
  start?: number;
  duration?: number;
  radiantWin?: boolean;
  heroes: number[];
  /** the token owner's Steam id, so the site can mark "you". */
  owner?: number | null;
  mode?: string;
}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
}

async function main(): Promise<void> {
  const password = process.env.APP_PASSWORD ?? "";
  if (password.length < MIN_PASSWORD) throw new Error("APP_PASSWORD secret missing: refusing to store a match unencrypted");
  const dir = arg("dir")!;
  const m = JSON.parse(readFileSync(arg("in")!, "utf8")) as {
    id: number;
    owner?: number | null;
    fetchedAt: number;
    summary: { startDateTime?: number; durationSeconds?: number; didRadiantWin?: boolean; lobbyType?: string; gameMode?: string; players?: Array<{ heroId: number }> };
  };
  const key = await siteKey(password);
  const indexPath = join(dir, "index.bin");
  let index: StoreEntry[] = existsSync(indexPath) ? (JSON.parse(await unseal(key, readFileSync(indexPath))) as StoreEntry[]) : [];
  // a re-fetch replaces the old copy
  for (const e of index.filter((x) => x.id === m.id)) rmSync(join(dir, e.file), { force: true });
  index = index.filter((x) => x.id !== m.id);
  const file = `${randomBytes(12).toString("hex")}.bin`;
  writeFileSync(join(dir, file), await seal(key, JSON.stringify(m)));
  index.unshift({
    file,
    id: m.id,
    at: m.fetchedAt,
    ...(m.summary.startDateTime ? { start: m.summary.startDateTime } : {}),
    ...(m.summary.durationSeconds ? { duration: m.summary.durationSeconds } : {}),
    ...(m.summary.didRadiantWin !== undefined ? { radiantWin: m.summary.didRadiantWin } : {}),
    heroes: (m.summary.players ?? []).map((p) => p.heroId),
    owner: m.owner ?? null,
    mode: `${m.summary.lobbyType ?? ""}/${m.summary.gameMode ?? ""}`,
  });
  for (const old of index.slice(KEEP)) rmSync(join(dir, old.file), { force: true });
  index = index.slice(0, KEEP);
  writeFileSync(indexPath, await seal(key, JSON.stringify(index)));
  console.log(`stored: ${index.length} matches in the store`);
}

void main().catch((e) => {
  console.error(String(e));
  process.exit(1);
});
