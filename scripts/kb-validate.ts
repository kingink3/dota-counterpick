// =============================================================================
//  KB against measured matchups (ADR-061): npm run kb:validate -> KB_VALIDATION.md
//
//  For every pair "hero vs enemy" with enough games in data/matchups.json:
//    gap  = win rate of the pair - the rate expected from both heroes' base rates (pp)
//    lift = KB score of the hero against that enemy - the hero's baseline
//  and reports
//    - how well the KB orders the pairs (rank correlation, mean gap by KB decile),
//    - the two numbers the engine blends with (src/params.ts):
//        KB_PP_PER_POINT  = slope of gap on lift (pp per KB point)
//        STAT_PRIOR_GAMES = sampling variance per game / variance of the true gap around
//                           that prior: the number of games at which a measurement
//                           weighs as much as the mechanics
//    - every general edge with the mean gap of the pairs it fires on: which RULES the
//      data supports and which it refutes,
//    - the biggest measured counters the KB is silent on, and the strongest KB claims
//      the data contradicts - a work list for new general edges, not for hero patches.
//
//  Noise in the gap does not bias the slope (it is the dependent variable); it does
//  lower the correlations, which rise with the minimum sample.
// =============================================================================

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { loadKB } from "../src/kb.js";
import { assignPositions, kbPairReasons } from "../src/resolver.js";
import type { Reason } from "../src/types.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const MIN_GAMES = 1000;
const full = loadKB(ROOT);
const mu = full.matchups;
if (!mu) throw new Error("data/matchups.json is missing");
const kb = { ...full, matchups: undefined } as typeof full;
const heroes = Object.keys(kb.taxonomy.hero_tags);
const logit = (p: number) => Math.log(p / (1 - p));
const sig = (x: number) => 1 / (1 + Math.exp(-x));
const label = (h: string) => h.split("_").map((w) => w[0]!.toUpperCase() + w.slice(1)).join(" ");

const base = new Map<string, number>();
for (const h of heroes) {
  let w = 0;
  let n = 0;
  for (const [wr, g] of Object.values(mu[h] ?? {})) {
    w += wr * g;
    n += g;
  }
  if (n) base.set(h, w / n);
}
const mainPos = new Map(heroes.map((h) => [h, assignPositions(kb, [h]).get(h) ?? 3]));

interface Row { h: string; e: string; kb: number; lift: number; gap: number; n: number; reasons: Reason[] }
const rows: Row[] = [];
for (const e of heroes) {
  const byHero = kbPairReasons(kb, e);
  for (const [h, reasons] of byHero) {
    const pair = mu[h]?.[e];
    if (!pair || pair[1] < MIN_GAMES || base.get(h) === undefined || base.get(e) === undefined) continue;
    const score = reasons.reduce((s, r) => s + r.contribution, 0);
    const usual = kb.baselines?.["0"]?.[h]?.[mainPos.get(e)! - 1] ?? 0;
    rows.push({ h, e, kb: score, lift: score - usual, gap: (pair[0] - sig(logit(base.get(h)!) - logit(base.get(e)!))) * 100, n: pair[1], reasons });
  }
}

// ---- weighted regression gap ~ beta * lift, with the true-gap variance tau^2 ----------
const NOISE = 2500; // variance of a win rate in pp^2, per game (0.5 x 0.5 x 100^2)
let tau2 = 1.5;
let beta = 0;
for (let it = 0; it < 20; it++) {
  let sxy = 0;
  let sxx = 0;
  for (const r of rows) {
    const w = 1 / (tau2 + NOISE / r.n);
    sxy += w * r.lift * r.gap;
    sxx += w * r.lift * r.lift;
  }
  beta = sxy / sxx;
  // method of moments on the pairs with a solid sample
  const solid = rows.filter((r) => r.n >= 5000);
  const m = solid.reduce((s, r) => s + (r.gap - beta * r.lift) ** 2 - NOISE / r.n, 0) / solid.length;
  tau2 = Math.max(0.05, m);
}
const priorGames = NOISE / tau2;

const rank = (a: number[]) => {
  const idx = a.map((v, i) => [v, i] as const).sort((x, y) => x[0] - y[0]);
  const out = new Array<number>(a.length);
  for (let i = 0; i < idx.length; ) {
    let j = i;
    while (j + 1 < idx.length && idx[j + 1]![0] === idx[i]![0]) j++;
    for (let k = i; k <= j; k++) out[idx[k]![1]] = (i + j) / 2;
    i = j + 1;
  }
  return out;
};
const corr = (a: number[], b: number[]) => {
  const n = a.length;
  const ma = a.reduce((s, x) => s + x, 0) / n;
  const mb = b.reduce((s, x) => s + x, 0) / n;
  let sab = 0;
  let sa = 0;
  let sb = 0;
  for (let i = 0; i < n; i++) {
    sab += (a[i]! - ma) * (b[i]! - mb);
    sa += (a[i]! - ma) ** 2;
    sb += (b[i]! - mb) ** 2;
  }
  return sab / Math.sqrt(sa * sb);
};
const spearman = (min: number, key: "kb" | "lift") => {
  const part = rows.filter((r) => r.n >= min);
  return { pairs: part.length, rho: corr(rank(part.map((r) => r[key])), rank(part.map((r) => r.gap))) };
};
const meanGap = (part: Row[]) => (part.length ? part.reduce((s, r) => s + r.gap, 0) / part.length : 0);
const sorted = [...rows].sort((a, b) => a.lift - b.lift);
const slice = (lo: number, hi: number) => sorted.slice(Math.floor(lo * sorted.length), Math.floor(hi * sorted.length));
const f = (x: number, d = 2) => (x >= 0 ? "+" : "") + x.toFixed(d);

// ---- per general rule: the pairs it fires on ------------------------------------------
const rules = new Map<string, { n: number; w: number; wg: number; side: string }>();
for (const r of rows) {
  const seen = new Set<string>();
  for (const x of r.reasons) {
    if (x.basis === "hero_edge" || !x.contribution) continue;
    const side = x.contribution > 0 ? "for" : "against";
    const what = x.tool && x.reliance ? `${x.tool} → ${x.reliance}` : x.selfGrant ? `resist ${x.selfGrant}${x.tool ? ` vs ${x.tool}` : ""}` : `${x.basis} ${x.tool ?? x.reliance ?? ""}`.trim();
    const key = `${side}: ${what}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const w = 1 / (tau2 + NOISE / r.n);
    const cur = rules.get(key) ?? { n: 0, w: 0, wg: 0, side };
    cur.n++;
    cur.w += w;
    cur.wg += w * r.gap;
    rules.set(key, cur);
  }
}
const ruleRows = [...rules]
  .map(([key, v]) => ({ key, n: v.n, gap: v.wg / v.w, se: Math.sqrt(1 / v.w), side: v.side }))
  .filter((x) => x.n >= 15);
const verdict = (x: (typeof ruleRows)[number]) => {
  const signed = x.side === "for" ? x.gap : -x.gap;
  if (signed >= 2 * x.se) return "supported";
  if (signed <= -2 * x.se) return "**refuted**";
  return "no signal";
};

const real = rows.filter((r) => r.gap >= 4);
const claims = rows.filter((r) => r.lift >= 0.6);
const pairLine = (r: Row) => `| ${label(r.h)} | ${label(r.e)} | ${f(r.gap, 1)} | ${(r.n / 1000).toFixed(1)}k | ${r.kb.toFixed(2)} | ${f(r.lift)} |`;
const s1 = spearman(1000, "lift");
const s5 = spearman(5000, "lift");
const s15 = spearman(15000, "lift");

const out: string[] = [];
out.push("# KB against measured matchups");
out.push("");
out.push("Generated by `npm run kb:validate` (scripts/kb-validate.ts). Do not edit by hand.");
out.push("");
const meta = JSON.parse(readFileSync(join(ROOT, "data", "matchups.json"), "utf8")) as { source?: string; fetchedAt?: string };
out.push(`Data: data/matchups.json (${meta.source ?? "?"}, ${(meta.fetchedAt ?? "").slice(0, 10)}), pairs with at least ${MIN_GAMES} games: **${rows.length}**.`);
out.push("gap = win rate of the pair minus the rate expected from both heroes' base rates, in pp; lift = KB score against that enemy minus the hero's baseline.");
out.push("");
out.push("## The two numbers the engine blends with");
out.push("");
out.push(`| | Value | Meaning |`);
out.push(`|---|---|---|`);
out.push(`| \`KB_PP_PER_POINT\` | **${beta.toFixed(2)}** | slope of gap on lift: one KB point above the hero's usual is worth this many pp |`);
out.push(`| sd of the true gap around the KB prior | ${Math.sqrt(tau2).toFixed(2)} pp | what the mechanics do not explain |`);
out.push(`| \`STAT_PRIOR_GAMES\` | **${Math.round(priorGames / 50) * 50}** | 2500 / ${tau2.toFixed(2)}: games at which the measurement weighs as much as the prior |`);
out.push("");
out.push("## How well the KB orders the pairs");
out.push("");
out.push("| Min games | Pairs | Spearman (lift vs gap) |");
out.push("|---|---|---|");
for (const [m, s] of [[1000, s1], [5000, s5], [15000, s15]] as const) out.push(`| ${m} | ${s.pairs} | ${s.rho.toFixed(3)} |`);
out.push("");
out.push(`Mean gap by KB lift: bottom 10% ${f(meanGap(slice(0, 0.1)))} pp, middle ${f(meanGap(slice(0.4, 0.6)))} pp, top 10% ${f(meanGap(slice(0.9, 1)))} pp, top 2% ${f(meanGap(slice(0.98, 1)))} pp.`);
out.push("");
out.push(`Measured counters (gap ≥ +4 pp): ${real.length}; the KB lifts them by ≥ 0.2 in ${Math.round((100 * real.filter((r) => r.lift >= 0.2).length) / Math.max(1, real.length))}%.`);
out.push(`Strong KB claims (lift ≥ 0.6): ${claims.length}; gap > +1 pp in ${Math.round((100 * claims.filter((r) => r.gap > 1).length) / Math.max(1, claims.length))}%, gap < -1 pp in ${Math.round((100 * claims.filter((r) => r.gap < -1).length) / Math.max(1, claims.length))}%.`);
out.push("");
out.push("## General rules: mean gap of the pairs each one fires on");
out.push("");
out.push("\"for\" = the rule argues for the pick (expected gap > 0); \"against\" = a risk or a blunted tool (expected gap < 0). Verdict at two standard errors. Rules firing on fewer than 15 pairs are left out. With this many rules a few verdicts are expected by chance alone (about one in twenty): treat a single verdict as a lead, not as proof.");
out.push("");
out.push("| Rule | Pairs | Mean gap, pp | ± | Verdict |");
out.push("|---|---|---|---|---|");
for (const x of ruleRows.sort((a, b) => (a.side === b.side ? (a.side === "for" ? b.gap - a.gap : a.gap - b.gap) : a.side === "for" ? -1 : 1))) {
  out.push(`| ${x.key} | ${x.n} | ${f(x.gap)} | ${x.se.toFixed(2)} | ${verdict(x)} |`);
}
out.push("");
out.push("## Measured counters the KB does not see (gap ≥ +4 pp, lift < 0.2)");
out.push("");
out.push("| Hero | Against | Gap, pp | Games | KB | Lift |");
out.push("|---|---|---|---|---|---|");
for (const r of real.filter((x) => x.lift < 0.2).sort((a, b) => b.gap * Math.sqrt(b.n) - a.gap * Math.sqrt(a.n)).slice(0, 40)) out.push(pairLine(r));
out.push("");
out.push("## Strong KB claims the data contradicts (lift ≥ 0.6, gap ≤ -1.5 pp)");
out.push("");
out.push("| Hero | Against | Gap, pp | Games | KB | Lift |");
out.push("|---|---|---|---|---|---|");
for (const r of claims.filter((x) => x.gap <= -1.5).sort((a, b) => a.gap * Math.sqrt(a.n) - b.gap * Math.sqrt(b.n)).slice(0, 40)) out.push(pairLine(r));
out.push("");
writeFileSync(join(ROOT, "KB_VALIDATION.md"), out.join("\n"), "utf8");
console.log(`pairs ${rows.length} | KB_PP_PER_POINT ${beta.toFixed(3)} | tau ${Math.sqrt(tau2).toFixed(2)} pp | STAT_PRIOR_GAMES ${Math.round(priorGames)} | rho ${s1.rho.toFixed(3)} / ${s5.rho.toFixed(3)} / ${s15.rho.toFixed(3)}`);
console.log(`rules: ${ruleRows.length}; supported ${ruleRows.filter((x) => verdict(x) === "supported").length}, refuted ${ruleRows.filter((x) => verdict(x) === "**refuted**").length}`);
