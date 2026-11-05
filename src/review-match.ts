// =============================================================================
//  Match overview (ADR-029d): who played well and who has work to do, for all ten
//  players. Pure.
//
//  From the summary alone (no extra requests): STRATZ IMP, networth vs the
//  Crusader-Ancient average for that hero and position, deaths vs average, kill
//  participation; vision (wards / dewards / stacks) from one shared query.
//  A loaded review of that player adds item timings and battle chances.
//  The score is a heuristic: weighted parts in -1..1, re-normalised over the
//  parts that exist; the weights favour farm for cores and vision for supports.
// =============================================================================

import { clamp, visionOf, type Benchmarks, type MatchReview, type StratzSummary, type StratzVision, type VisionStats } from "./review.js";

export type Grade = "strong" | "solid" | "mixed" | "work";

export interface OverviewPart {
  key: "imp" | "farm" | "deaths" | "kp" | "vision" | "battles" | "timing";
  label: string;
  /** -1..1 */
  value: number;
  weight: number;
  text: string;
}

export interface OverviewRow {
  slot: number;
  account?: number;
  isRadiant: boolean;
  hero: string;
  position?: number;
  won: boolean;
  kda: [number, number, number];
  imp?: number;
  kp?: number;
  /** networth / average for the hero and position at 20:00 (or the last minute before). */
  nwRatio?: number;
  nwMinute?: number;
  deaths: number;
  deathsAvg?: number;
  vision?: VisionStats;
  /** battle chances used / all (a loaded review). */
  battles?: { used: number; windows: number };
  /** core items: fast / typical / slow / missing (a loaded review). */
  timing?: { fast: number; typical: number; slow: number; missing: number };
  parts: OverviewPart[];
  score: number;
  grade: Grade;
  reviewed: boolean;
  workOn?: string;
  goodAt?: string;
}

export interface MatchOverview {
  rows: OverviewRow[];
  duration: number;
}

const W: Record<"core" | "support", Record<OverviewPart["key"], number>> = {
  core: { imp: 0.3, farm: 0.25, deaths: 0.15, kp: 0.1, vision: 0, battles: 0.15, timing: 0.1 },
  support: { imp: 0.3, farm: 0.05, deaths: 0.15, kp: 0.15, vision: 0.2, battles: 0.15, timing: 0.05 },
};

export function gradeOf(score: number): Grade {
  return score >= 0.3 ? "strong" : score >= 0.05 ? "solid" : score >= -0.2 ? "mixed" : "work";
}
export const GRADE_LABEL: Record<Grade, string> = { strong: "Strong", solid: "Solid", mixed: "Mixed", work: "Work to do" };

export function matchOverview(
  s: StratzSummary,
  opts: { bench?: Benchmarks; heroOf: (id: number) => string; vision?: StratzVision },
  reviews: ReadonlyMap<number, MatchReview> = new Map(),
): MatchOverview {
  const duration = s.durationSeconds;
  const minutes = opts.bench?.minutes ?? [];
  const posNum = (p?: string | null) => {
    const m = /POSITION_(\d)/.exec(p ?? "");
    return m ? Number(m[1]) : undefined;
  };
  const benchAt = (arr: number[] | undefined, t: number) => {
    const i = minutes.findIndex((m) => m * 60 >= t);
    return arr?.[i >= 0 ? i : minutes.length - 1];
  };
  const teamKills = (radiant: boolean) => s.players.filter((p) => p.isRadiant === radiant).reduce((a, p) => a + p.kills, 0);
  const per10 = (n: number) => n / Math.max(1, duration / 600);

  const rows = s.players.map((p): OverviewRow => {
    const hero = opts.heroOf(p.heroId);
    const position = posNum(p.position);
    const r = p.steamAccountId ? reviews.get(p.steamAccountId) : undefined;
    const bench = position ? opts.bench?.heroes[hero]?.[String(position)] : undefined;
    const support = (position ?? 0) >= 4;
    const w = W[support ? "support" : "core"];
    const parts: OverviewPart[] = [];
    const add = (key: OverviewPart["key"], label: string, value: number, text: string) => {
      if (w[key] > 0 && Number.isFinite(value)) parts.push({ key, label, value: clamp(value, -1, 1), weight: w[key], text });
    };

    // IMP: STRATZ's own performance index, 0 = average for hero + position
    if (p.imp != null) add("imp", "STRATZ performance", p.imp / 40, `IMP ${p.imp > 0 ? "+" : ""}${p.imp}`);

    // networth vs average at 20:00 (or the last benchmark minute the game reached)
    const nw = p.stats?.networthPerMinute ?? [];
    let nwRatio: number | undefined;
    let nwMinute: number | undefined;
    if (bench?.networth) {
      const reached = minutes.filter((m) => m <= 20 && m * 60 <= duration && nw[m] !== undefined);
      const m = reached[reached.length - 1];
      const b = m !== undefined ? bench.networth[minutes.indexOf(m)] : undefined;
      if (m !== undefined && b) {
        nwRatio = nw[m]! / b;
        nwMinute = m;
        add("farm", "Farm", (nwRatio - 1) * 2.5, `networth ${pct(nwRatio)} at ${m}:00`);
      }
    }

    const dB = benchAt(bench?.deaths, duration);
    if (dB !== undefined) add("deaths", "Deaths", (dB - p.deaths) / Math.max(2, dB), `${p.deaths} deaths (avg ${dB.toFixed(1)})`);

    const tk = teamKills(p.isRadiant);
    const kp = tk >= 5 ? (p.kills + p.assists) / tk : undefined;
    if (kp !== undefined) add("kp", "Fight presence", (kp - 0.55) * 2.5, `kill participation ${Math.round(kp * 100)}%`);

    const vRaw = opts.vision?.players.find((x) => x.playerSlot === p.playerSlot)?.stats;
    const vision = r?.vision ?? (vRaw ? visionOf(vRaw) : undefined);
    if (vision && support && duration > 900) {
      const v =
        clamp((per10(vision.observers) - 1.5) / 1.5, -1, 1) * 0.5 + clamp((per10(vision.dewards) - 0.5) / 1, -1, 1) * 0.3 + clamp((per10(vision.stacks) - 0.5) / 1, -1, 1) * 0.2;
      add("vision", "Vision & stacks", v * 1.25, `${vision.observers} obs, ${vision.sentries} sentries, ${vision.dewards} dewards, ${vision.stacks} stacks`);
    }

    let battles: OverviewRow["battles"];
    if (r?.battles) {
      const used = r.battles.totals.reduce((a, u) => a + u.used, 0);
      const windows = r.battles.totals.reduce((a, u) => a + u.windows, 0);
      if (windows >= 5) {
        battles = { used, windows };
        add("battles", "Spells & items in battles", (used / windows - 0.6) * 2.5, `${used} of ${windows} chances used`);
      }
    }

    let timing: OverviewRow["timing"];
    if (r && r.comparable) {
      const cs = r.checks.filter((c) => c.phase === "core" || c.phase === "late");
      if (cs.length) {
        timing = { fast: 0, typical: 0, slow: 0, missing: 0 };
        for (const c of cs) {
          if (c.verdict === "fast") timing.fast++;
          else if (c.verdict === "typical" || c.verdict === "bought") timing.typical++;
          else if (c.verdict === "slow") timing.slow++;
          else if (c.verdict === "missing" && (c.planned ?? 0) < duration) timing.missing++;
        }
        const n = timing.fast + timing.typical + timing.slow + timing.missing;
        if (n) add("timing", "Item timings", (timing.fast - timing.slow - timing.missing) / n, `${timing.fast} fast, ${timing.typical} on time, ${timing.slow} late, ${timing.missing} missing`);
      }
    }

    const total = parts.reduce((a, x) => a + x.weight, 0);
    const score = total ? parts.reduce((a, x) => a + x.value * x.weight, 0) / total : 0;
    const worst = [...parts].sort((a, b) => a.value - b.value)[0];
    const best = [...parts].sort((a, b) => b.value - a.value)[0];
    const goodFinding = r?.findings.filter((f) => f.good).sort((a, b) => b.severity - a.severity)[0];
    return {
      slot: p.playerSlot,
      ...(p.steamAccountId ? { account: p.steamAccountId } : {}),
      isRadiant: p.isRadiant,
      hero,
      ...(position ? { position } : {}),
      won: p.isVictory,
      kda: [p.kills, p.deaths, p.assists],
      ...(p.imp != null ? { imp: p.imp } : {}),
      ...(kp !== undefined ? { kp } : {}),
      ...(nwRatio !== undefined ? { nwRatio, nwMinute } : {}),
      deaths: p.deaths,
      ...(dB !== undefined ? { deathsAvg: dB } : {}),
      ...(vision ? { vision } : {}),
      ...(battles ? { battles } : {}),
      ...(timing ? { timing } : {}),
      parts,
      score,
      grade: gradeOf(score),
      reviewed: !!r,
      ...(r?.growth[0] ? { workOn: r.growth[0].title } : worst && worst.value < 0 ? { workOn: `${worst.label}: ${worst.text}` } : {}),
      ...(goodFinding ? { goodAt: goodFinding.title } : best && best.value > 0.2 ? { goodAt: `${best.label}: ${best.text}` } : {}),
    };
  });
  return { rows, duration };
}

function pct(r: number): string {
  const d = Math.round((r - 1) * 100);
  return `${d >= 0 ? "+" : ""}${d}%`;
}

/** a review as a message for Discord / Telegram (<= 1900 characters: Discord's limit is 2000). */
export function adviceText(r: MatchReview, label: (hero: string) => string, opts: { grade?: Grade; who?: string; top?: number } = {}): string {
  const mm = (t: number) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, "0")}`;
  const first = (x: string) => (/^(.+?[.!?])(\s|$)/.exec(x)?.[1] ?? x).replace(/\s+/g, " ");
  const head = [
    opts.who,
    `${label(r.hero)}${r.position ? ` pos ${r.position}` : ""}`,
    r.kda.join("/"),
    r.won ? "won" : "lost",
    mm(r.duration),
    r.mode,
  ].filter(Boolean);
  const lines: string[] = [`**${head.join(" · ")}**${r.matchId > 1 ? ` (match ${r.matchId})` : ""}`];
  if (opts.grade) lines.push(`Overall: ${GRADE_LABEL[opts.grade]}`);
  const v = r.vision;
  if (v && (r.position ?? 0) >= 4) lines.push(`Vision: ${v.observers} observers, ${v.sentries} sentries, ${v.dewards} enemy wards destroyed, ${v.stacks} stacks`);
  if (r.battles?.battles.length) {
    const used = r.battles.totals.reduce((a, u) => a + u.used, 0);
    const windows = r.battles.totals.reduce((a, u) => a + u.windows, 0);
    lines.push(`Battles: ${r.battles.battles.length}, spell / item chances used ${used} of ${windows}`);
  }
  lines.push("", "**Work on:**");
  const growth = r.growth.slice(0, opts.top ?? 6);
  growth.forEach((g, i) => lines.push(`${i + 1}. ${g.title} - ${first(g.detail)}`));
  if (!growth.length) lines.push("Nothing stood out.");
  const good = r.findings.filter((f) => f.good).sort((a, b) => b.severity - a.severity).slice(0, 3);
  if (good.length) {
    lines.push("", "**Good:**");
    for (const g of good) lines.push(`+ ${g.title}`);
  }
  let out = lines.join("\n");
  // trim the longest list first, then hard-cut
  while (out.length > 1900 && growth.length > 3) {
    growth.pop();
    return adviceText(r, label, { ...opts, top: growth.length });
  }
  return out.length > 1900 ? `${out.slice(0, 1890)}…` : out;
}
