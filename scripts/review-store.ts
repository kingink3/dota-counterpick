// =============================================================================
//  Match store (ADR-031): adds one fetched match (stratz-fetch --mode match) to the
//  `review-data` branch, encrypted with the site key (APP_PASSWORD secret), and
//  keeps the newest KEEP. The branch is public, so nothing is in the clear:
//    index.bin   sealed JSON: [{ file, id, at, duration, radiantWin, heroes, owner }]
//    <random>.bin  sealed match JSON (summary, positions, health, vision, players)
//  File names are random, so the match ids are not visible either.
//
//    APP_PASSWORD=... tsx scripts/review-store.ts --in match.json [--recent recent.json] --dir <branch checkout>
//    recent.bin  sealed { owner, fetchedAt, matches }: the token owner's last 20 matches (ADR-042)
// =============================================================================

import { randomBytes } from "node:crypto";
import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
  const key = await siteKey(password);
  // the owner's recent matches (ADR-042): one sealed file, replaced on every run
  const recent = arg("recent");
  if (recent && existsSync(recent)) {
    writeFileSync(join(dir, "recent.bin"), await seal(key, readFileSync(recent, "utf8")));
    console.log("stored: the recent matches list");
  }
  const indexPath = join(dir, "index.bin");
  let index: StoreEntry[] = existsSync(indexPath) ? (JSON.parse(await unseal(key, readFileSync(indexPath))) as StoreEntry[]) : [];
  // --ids <file>: write the stored match ids (for the scheduled run to skip them) and stop
  const idsOut = arg("ids");
  if (idsOut) {
    writeFileSync(idsOut, JSON.stringify(index.map((e) => e.id)));
    // --missed <file>: matches the scheduled run found no replay for (kept in recent.bin)
    const missedOut = arg("missed");
    const rb = join(dir, "recent.bin");
    if (missedOut) {
      const prev = existsSync(rb) ? (JSON.parse(await unseal(key, readFileSync(rb))) as { missed?: number[] }) : {};
      writeFileSync(missedOut, JSON.stringify(prev.missed ?? []));
    }
    console.log(`store: ${index.length} matches`);
    return;
  }
  // --in <file> and/or --in-dir <dir> (every match*.json in it)
  const inputs = [arg("in"), ...(arg("in-dir") && existsSync(arg("in-dir")!) ? readdirSync(arg("in-dir")!).filter((f) => /^match.*\.json$/.test(f)).map((f) => join(arg("in-dir")!, f)) : [])]
    .filter((f): f is string => !!f && existsSync(f));
  for (const input of [...new Set(inputs)]) index = await add(input, index);
  if (!inputs.length) return;
  for (const old of index.slice(KEEP)) rmSync(join(dir, old.file), { force: true });
  index = index.slice(0, KEEP);
  writeFileSync(indexPath, await seal(key, JSON.stringify(index)));
  console.log(`stored: ${index.length} matches in the store`);

  async function add(input: string, idx: StoreEntry[]): Promise<StoreEntry[]> {
    const m = JSON.parse(readFileSync(input, "utf8")) as {
      id: number;
      owner?: number | null;
      fetchedAt: number;
      summary: { startDateTime?: number; durationSeconds?: number; didRadiantWin?: boolean; lobbyType?: string; gameMode?: string; players?: Array<{ heroId: number }> };
    };
    // a re-fetch replaces the old copy
    let index = idx;
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
    return index;
  }
}

void main().catch((e) => {
  console.error(String(e));
  process.exit(1);
});
