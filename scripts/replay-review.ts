// =============================================================================
//  Matches from the replay first (ADR-053); what this cannot do is left to STRATZ.
//    --mode auto   the owner's matches of the last 2 days not in the store (--skip), at most --max
//    --mode match  --match <id>, or the owner's latest match
//    --mode recent only the list of the owner's last 20 matches
//  The owner is read from the STRATZ token (no call). The list comes from OpenDota.
//  Each match: OpenDota -> replay -> odota/parser (localhost:5600) -> matchFromReplay
//  + buildTimeline -> <out>/match-<id>.json in the clear (the store step encrypts it).
//  Left for STRATZ in <out>/stratz-todo.json: { ids, latest, recent }.
//  Logs counts only: the repository and its Actions logs are public.
// =============================================================================

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ItemStats } from "../src/item-plan.js";
import { buildTimeline } from "../src/replay.js";
import { matchFromReplay } from "../src/replay-match.js";
import type { Ids } from "../src/review.js";
import { OD, odWithReplay, ownerOf, parseReplay } from "./replay-lib.js";

const arg = (n: string) => {
  const i = process.argv.indexOf(`--${n}`);
  return i > 0 ? process.argv[i + 1] : undefined;
};

interface OdRecent {
  match_id: number;
  player_slot: number;
  radiant_win: boolean;
  duration: number;
  game_mode: number;
  lobby_type: number;
  hero_id: number;
  start_time: number;
  kills: number;
  deaths: number;
  assists: number;
}
const GAME_MODE: Record<number, string> = { 1: "ALL_PICK", 2: "CAPTAINS_MODE", 3: "RANDOM_DRAFT", 4: "SINGLE_DRAFT", 5: "ALL_RANDOM", 16: "CAPTAINS_DRAFT", 18: "ABILITY_DRAFT", 20: "ALL_RANDOM_DEATH_MATCH", 22: "ALL_PICK_RANKED", 23: "TURBO" };
const LOBBY: Record<number, string> = { 0: "UNRANKED", 1: "PRACTICE", 2: "TOURNAMENT", 5: "TEAM_MATCH", 6: "SOLO_QUEUE", 7: "RANKED", 9: "BATTLE_CUP" };

async function recentOf(owner: number): Promise<OdRecent[] | undefined> {
  const r = await fetch(`${OD}/players/${owner}/recentMatches`).catch(() => undefined);
  if (!r?.ok) return undefined;
  const list = (await r.json()) as OdRecent[];
  return Array.isArray(list) && list.length ? list : undefined;
}

async function main(): Promise<void> {
  const out = arg("out") ?? "/tmp/match";
  mkdirSync(out, { recursive: true });
  const mode = arg("mode") ?? "match";
  const parser = arg("parser") ?? "http://localhost:5600";
  const owner = Number(process.env.OWNER_ID || 0) || ownerOf(process.env.STRATZ_TOKEN ?? "");
  const todo = { ids: [] as number[], latest: false, recent: false };
  const done = () => writeFileSync(join(out, "stratz-todo.json"), JSON.stringify(todo));

  // --- the list (OpenDota: shown on the site, and what auto / latest pick from) ----------
  const list = owner ? await recentOf(owner) : undefined;
  if (list && owner) {
    const now = Math.floor(Date.now() / 1000);
    const matches = list.map((m) => {
      const radiant = m.player_slot < 128;
      return {
        id: m.match_id,
        startDateTime: m.start_time,
        durationSeconds: m.duration,
        gameMode: GAME_MODE[m.game_mode] ?? `MODE_${m.game_mode}`,
        lobbyType: LOBBY[m.lobby_type] ?? `LOBBY_${m.lobby_type}`,
        didRadiantWin: m.radiant_win,
        // a replay is on Valve's servers for ~2 weeks: "parsed" = can be reviewed now
        parsedDateTime: now - (m.start_time + m.duration) < 14 * 86400 ? m.start_time + m.duration : null,
        players: [{ heroId: m.hero_id, isVictory: m.radiant_win === radiant, kills: m.kills, deaths: m.deaths, assists: m.assists }],
      };
    });
    writeFileSync(join(out, "recent.json"), JSON.stringify({ owner, fetchedAt: now, source: "opendota", matches }));
  } else todo.recent = true;
  console.log(`list: ${list ? `${list.length} from OpenDota` : "OpenDota gave none - STRATZ lists"}`);
  if (mode === "recent") return done();

  // --- which matches -------------------------------------------------------------------
  let ids: number[] = [];
  if (mode === "auto") {
    const skipFile = arg("skip");
    const skip = new Set<number>(skipFile && existsSync(skipFile) ? (JSON.parse(readFileSync(skipFile, "utf8")) as number[]) : []);
    const since = Date.now() / 1000 - 2 * 86400;
    if (!list) todo.latest = true; // STRATZ's own auto run picks them
    ids = (list ?? []).filter((m) => m.start_time >= since && !skip.has(m.match_id)).slice(0, Number(arg("max") ?? 3)).map((m) => m.match_id);
  } else {
    const id = Number(arg("match") || 0) || list?.[0]?.match_id;
    if (id) ids = [id];
    else todo.latest = true;
  }

  // --- each: the replay, or left for STRATZ ------------------------------------------------
  const idsJson = JSON.parse(readFileSync("data/ids.json", "utf8")) as Ids;
  const stats = JSON.parse(readFileSync("data/item-stats.json", "utf8")) as ItemStats;
  const components = Object.fromEntries(Object.entries(stats.items).map(([k, v]) => [k, v.components]));
  const costs = Object.fromEntries(Object.entries(stats.items).map(([k, v]) => [k, v.cost]));
  for (const [n, id] of ids.entries()) {
    const t0 = Date.now();
    let msg: string;
    try {
      const od = await odWithReplay(id);
      if (!od?.replay_url) msg = "no replay";
      else {
        const p = await parseReplay(id, od.replay_url, parser);
        if ("error" in p) msg = p.error;
        else {
          const m = matchFromReplay(p.lines, { ...od, match_id: id }, { ids: idsJson, components, costs });
          const replay = buildTimeline(p.lines);
          if (!m || !replay) msg = "the parse had no players";
          else if (owner && !m.players[String(owner)]) msg = "you are not in it"; // still stored: someone else's match by id
          else msg = "";
          if (m && replay) {
            m.summary.id = id;
            writeFileSync(join(out, `match-${id}.json`), JSON.stringify({ id, owner: owner ?? null, fetchedAt: Math.floor(Date.now() / 1000), ...m, replay }));
            msg = `ok from the replay (${p.mb.toFixed(0)} MB, ${Object.keys(m.players).length} players, ${Math.round((Date.now() - t0) / 1000)} s)${msg ? `; ${msg}` : ""}`;
          }
        }
      }
    } catch (e) {
      msg = `failed: ${String(e).slice(0, 120)}`;
    }
    if (!msg.startsWith("ok")) todo.ids.push(id);
    console.log(`match ${n + 1}/${ids.length}: ${msg}${msg.startsWith("ok") ? "" : " - left for STRATZ"}`);
  }
  done();
}

void main().catch((e) => {
  console.error(String(e));
  process.exit(1);
});
