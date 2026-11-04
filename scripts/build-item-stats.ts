// =============================================================================
//  Build data/item-stats.json (ADR-026 phases 2-3) from the raw OpenDota responses
//  that the "Fetch OpenDota stats" workflow pushes to the `opendota-raw` branch:
//
//      git fetch origin opendota-raw && git worktree add /tmp/od origin/opendota-raw
//      npx tsx scripts/build-item-stats.ts --raw /tmp/od --constants <dotaconstants/build>
//
//  Per hero (our KB code):
//    phases  - /heroes/{id}/itemPopularity (start / early / mid / late purchases),
//              each item as a share of the phase's most bought item;
//    timing  - /scenarios/itemTimings: purchase-time quartiles + win rate when the
//              item came early (<= p25) vs late (>= p75);
//    curve   - win rate by match length (/heroes/{id}/durations, 5-min bins; falls
//              back to /scenarios/laneRoles, all lanes summed).
//  Items: cost / quality / components / display name from dotaconstants items.json.
// =============================================================================

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readRawKB } from "../src/kb.js";
import type { HeroStats, ItemInfo, ItemStats, ItemTiming, Phase } from "../src/item-plan.js";
import { heroValveName } from "../src/web/hero-art.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const MIN_TIMING_GAMES = 30;
const MIN_PHASE_SHARE = 0.05;
/** OpenDota's last timing bucket (30:00): later purchases are not in the data. */
const LAST_BUCKET = 1800;

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
}

function readJson<T>(path: string): T | undefined {
  if (!existsSync(path)) return undefined;
  try {
    return JSON.parse(readFileSync(path, "utf8")) as T;
  } catch {
    return undefined;
  }
}

interface DcItem {
  id?: number;
  dname?: string;
  cost?: number | null;
  qual?: string;
  components?: string[] | null;
}

type Popularity = Partial<Record<"start_game_items" | "early_game_items" | "mid_game_items" | "late_game_items", Record<string, number>>>;
interface TimingRow {
  item: string;
  time: number | string;
  games: number | string;
  wins: number | string;
}
interface LaneRow {
  lane_role?: number | string;
  time: number | string;
  games: number | string;
  wins: number | string;
}
interface DurationRow {
  duration_bin: number | string;
  games_played: number | string;
  wins: number | string;
}

const PHASE_KEYS: Array<[Phase, keyof Popularity]> = [
  ["start", "start_game_items"],
  ["early", "early_game_items"],
  ["mid", "mid_game_items"],
  ["late", "late_game_items"],
];

function main(): void {
  const raw = arg("raw");
  const constants = arg("constants");
  if (!raw || !constants) {
    console.error("usage: tsx scripts/build-item-stats.ts --raw <opendota-raw dir> --constants <dotaconstants/build>");
    process.exit(1);
  }
  const dcItems = readJson<Record<string, DcItem>>(join(constants, "items.json"))!;
  const idToKey = new Map<string, string>();
  for (const [k, v] of Object.entries(dcItems)) if (v.id !== undefined) idToKey.set(String(v.id), k);

  const kb = readRawKB(ROOT);
  const valveToCode = new Map<string, string>();
  for (const code of Object.keys(kb.taxonomy.hero_tags)) valveToCode.set(heroValveName(code), code);
  const odHeroes = readJson<Array<{ id: number; name: string }>>(join(raw, "heroes.json")) ?? [];

  const used = new Set<string>();
  const heroes: Record<string, HeroStats> = {};
  let withTiming = 0;
  let withCurve = 0;
  for (const h of odHeroes) {
    const valve = h.name.replace(/^npc_dota_hero_/, "");
    const code = valveToCode.get(valve) ?? valve;
    const hs: HeroStats = { phases: {} };

    const pop = readJson<Popularity>(join(raw, "pop", `${h.id}.json`));
    for (const [phase, key] of PHASE_KEYS) {
      const counts = pop?.[key];
      if (!counts) continue;
      const rows = Object.entries(counts)
        .map(([id, n]) => [idToKey.get(id) ?? id, Number(n)] as [string, number])
        .filter(([k]) => dcItems[k]);
      const max = Math.max(1, ...rows.map(([, n]) => n));
      const list = rows
        .map(([k, n]) => [k, Math.round((n / max) * 1000) / 1000] as [string, number])
        .filter(([, s]) => s >= MIN_PHASE_SHARE)
        .sort((a, b) => b[1] - a[1]);
      if (list.length) hs.phases[phase] = list;
      for (const [k] of list) used.add(k);
    }

    const tRows = readJson<TimingRow[]>(join(raw, "timings", `${h.id}.json`));
    if (Array.isArray(tRows) && tRows.length) {
      const byItem = new Map<string, Array<{ t: number; g: number; w: number }>>();
      for (const r of tRows) {
        const k = String(r.item).replace(/^item_/, "");
        const list = byItem.get(k) ?? [];
        list.push({ t: Number(r.time), g: Number(r.games), w: Number(r.wins) });
        byItem.set(k, list);
      }
      const timing: Record<string, ItemTiming> = {};
      for (const [k, rows] of byItem) {
        const t = quartiles(rows);
        if (t && dcItems[k]) {
          timing[k] = t;
          used.add(k);
        }
      }
      if (Object.keys(timing).length) {
        hs.timing = timing;
        withTiming++;
      }
    }

    // durations: 5-min bins and ~15x the sample of laneRoles (15-min bins)
    const curve =
      durationCurve(readJson<DurationRow[]>(join(raw, "durations", `${h.id}.json`))) ??
      laneCurve(readJson<LaneRow[]>(join(raw, "lanes", `${h.id}.json`)));
    if (curve) {
      hs.curve = curve;
      withCurve++;
    }
    if (Object.keys(hs.phases).length || hs.timing || hs.curve) heroes[code] = hs;
  }

  const items: Record<string, ItemInfo> = {};
  for (const k of [...used].sort()) {
    const v = dcItems[k]!;
    items[k] = {
      cost: v.cost ?? 0,
      ...(v.qual ? { qual: v.qual } : {}),
      ...(v.components?.length ? { components: v.components } : {}),
      ...(v.dname ? { label: v.dname } : {}),
    };
  }
  const fetchedAt = existsSync(join(raw, "fetched-at.txt")) ? readFileSync(join(raw, "fetched-at.txt"), "utf8").trim() : undefined;
  const out: ItemStats = {
    source: "OpenDota API",
    ...(fetchedAt ? { fetchedAt } : {}),
    phasesFrom: "item popularity by game phase, professional matches",
    timingsFrom: "purchase times in parsed public matches",
    curveFrom: "win rate by match length",
    items,
    heroes,
  };
  writeFileSync(join(ROOT, "data", "item-stats.json"), JSON.stringify(out), "utf8");
  console.log(
    `item-stats.json: ${Object.keys(heroes).length} heroes (${withTiming} with timings, ${withCurve} with a game-length curve), ${Object.keys(items).length} items`,
  );
}

/** Quartiles of the purchase time from OpenDota's buckets. A row's `time` is the
 *  bucket's UPPER edge (bought by then): 7:30, 10, 12, 15, 20, 25, 30 min - uneven,
 *  and nothing after 30 min. Linear inside a bucket; the first bucket is taken as
 *  2.5 min wide. Items whose last bucket holds a big share are bought later than the
 *  data covers ("censored") - their quartiles are not reported. */
export function quartiles(rows: Array<{ t: number; g: number; w: number }>): ItemTiming | undefined {
  const byT = new Map<number, { g: number; w: number }>();
  for (const r of rows) {
    if (!(r.g > 0) || !Number.isFinite(r.t)) continue;
    const b = byT.get(r.t) ?? { g: 0, w: 0 };
    b.g += r.g;
    b.w += r.w;
    byT.set(r.t, b);
  }
  const rs = [...byT.entries()].sort((x, y) => x[0] - y[0]).map(([t, b]) => ({ t, ...b }));
  const games = rs.reduce((s, r) => s + r.g, 0);
  if (games < MIN_TIMING_GAMES || rs.length < 2) return undefined;
  const last = rs.at(-1)!;
  if (last.t >= LAST_BUCKET && last.g / games > 0.25) return undefined; // mostly after the data's end
  const lower = (i: number) => (i === 0 ? rs[0]!.t - 150 : rs[i - 1]!.t);
  const q = (p: number) => {
    let acc = 0;
    for (let i = 0; i < rs.length; i++) {
      const r = rs[i]!;
      if (acc + r.g >= p * games) return Math.round(lower(i) + ((p * games - acc) / r.g) * (r.t - lower(i)));
      acc += r.g;
    }
    return last.t;
  };
  // fast = bought by the earliest bucket edge holding >= 15% of games; slow = after the
  // latest edge with >= 15% of games still to come
  let acc = 0;
  let fastBy: number | undefined;
  let fastG = 0;
  let fastW = 0;
  for (const r of rs) {
    acc += r.g;
    fastG += r.g;
    fastW += r.w;
    if (acc >= 0.15 * games) {
      fastBy = r.t;
      break;
    }
  }
  let slowAfter: number | undefined;
  let slowG = 0;
  let slowW = 0;
  for (let i = rs.length - 1; i > 0; i--) {
    slowG += rs[i]!.g;
    slowW += rs[i]!.w;
    if (slowG >= 0.15 * games) {
      slowAfter = rs[i - 1]!.t;
      break;
    }
  }
  const round = (x: number) => Math.round(x * 1000) / 1000;
  return {
    p25: q(0.25),
    p50: q(0.5),
    p75: q(0.75),
    games,
    ...(fastBy !== undefined && fastG >= 20 ? { fastBy, wrFast: round(fastW / fastG) } : {}),
    ...(slowAfter !== undefined && slowG >= 20 ? { slowAfter, wrSlow: round(slowW / slowG) } : {}),
  };
}

function laneCurve(rows: LaneRow[] | undefined): Array<[number, number, number]> | undefined {
  if (!Array.isArray(rows) || !rows.length) return undefined;
  const bins = new Map<number, { g: number; w: number }>();
  for (const r of rows) {
    const min = Math.round(Number(r.time) / 60);
    const b = bins.get(min) ?? { g: 0, w: 0 };
    b.g += Number(r.games);
    b.w += Number(r.wins);
    bins.set(min, b);
  }
  return toCurve(bins);
}

function durationCurve(rows: DurationRow[] | undefined): Array<[number, number, number]> | undefined {
  if (!Array.isArray(rows) || !rows.length) return undefined;
  const bins = new Map<number, { g: number; w: number }>();
  for (const r of rows) {
    const min = Math.round(Number(r.duration_bin) / 60);
    const b = bins.get(min) ?? { g: 0, w: 0 };
    b.g += Number(r.games_played);
    b.w += Number(r.wins);
    bins.set(min, b);
  }
  return toCurve(bins);
}

function toCurve(bins: Map<number, { g: number; w: number }>): Array<[number, number, number]> | undefined {
  const out = [...bins.entries()]
    .filter(([, b]) => b.g > 0)
    .sort((a, b) => a[0] - b[0])
    .map(([m, b]) => [m, Math.round((b.w / b.g) * 1000) / 1000, b.g] as [number, number, number]);
  return out.length >= 3 ? out : undefined;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
