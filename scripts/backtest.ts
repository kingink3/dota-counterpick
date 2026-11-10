// =============================================================================
//  Draft backtest (ADR-063): does the engine predict who wins a real draft?
//
//    npx tsx scripts/backtest.ts <matches.ndjson> [--variants]   -> BACKTEST.md
//
//  Matches: public ranked All Pick games from OpenDota (.github/workflows/fetch-backtest.yml,
//  branch backtest-raw), drafts and outcomes only. Only matches played AFTER the statistics
//  snapshot in data/matchups.json are used, so the measured matchups have not seen them.
//
//  Every feature is "radiant minus dire":
//    base    sum of logit(base win rate) of the heroes - how strong the heroes are in general
//    gap     sum over the 25 opposing pairs of the measured matchup gap (pp, both records)
//    kb      sum over the 25 pairs of the KB lift (score vs that enemy - the hero's baseline),
//            radiant on dire minus dire on radiant: the mechanics, pair by pair, no data
//    syn     sum over allied pairs of the measured "with" gap (data/matchups.json allies)
//    engine  the engine as shipped: every hero of the lineup evaluated on its position against
//            the other five, with its four allies (heroEdge) - lane, target weight, saturation,
//            team gaps and combos included; split into its measured part, its KB part and
//            its team part
//
//  Models are logistic regressions on these features, scored out of sample (5-fold
//  cross-validation): log-loss, AUC, accuracy; differences between models with a paired
//  bootstrap. Coefficients are shown in pp of win probability per unit (25 x beta, the
//  slope of the logistic curve at 50%).
// =============================================================================

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { computeBaselines } from "../src/baseline.js";
import { loadKB } from "../src/kb.js";
import { P } from "../src/params.js";
import { assignPositions, heroEdge, kbPairScores } from "../src/resolver.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const file = process.argv[2];
if (!file) throw new Error("usage: tsx scripts/backtest.ts <matches.ndjson> [--variants]");
const VARIANTS = process.argv.includes("--variants");

const kb = loadKB(ROOT);
const mu = kb.matchups!;
const allies = (JSON.parse(readFileSync(join(ROOT, "data", "matchups.json"), "utf8")) as { allies?: Record<string, Record<string, [number, number]>>; fetchedAt?: string; source?: string });
const statsAt = Date.parse(allies.fetchedAt ?? "2000-01-01");
const idToCode = (JSON.parse(readFileSync(join(ROOT, "data", "ids.json"), "utf8")) as { heroes: Record<string, string> }).heroes;
const heroes = Object.keys(kb.taxonomy.hero_tags);

// ---- matches ------------------------------------------------------------------------------
interface Match { id: number; at: number; rank: number; radiantWin: number; duration: number; r: string[]; d: string[] }
const matches: Match[] = [];
let raw = 0;
let unknown = 0;
let early = 0;
for (const line of readFileSync(file, "utf8").split("\n")) {
  if (!line.trim()) continue;
  raw++;
  const [id, at, rank, win, duration, r, d] = JSON.parse(line) as [number, number, number, number, number, number[], number[]];
  const rc = r.map((x) => idToCode[String(x)]);
  const dc = d.map((x) => idToCode[String(x)]);
  if ([...rc, ...dc].some((c) => !c || !kb.taxonomy.hero_tags[c])) { unknown++; continue; }
  if (at * 1000 <= statsAt) { early++; continue; }
  matches.push({ id, at: at * 1000, rank, radiantWin: win, duration, r: rc as string[], d: dc as string[] });
}
if (matches.length < 500) throw new Error(`only ${matches.length} matches after the statistics snapshot: not enough for a backtest`);
const radiantRate = matches.reduce((s, m) => s + m.radiantWin, 0) / matches.length;
console.log(`matches: ${raw} read, ${unknown} with an unknown hero, ${early} before the statistics snapshot, ${matches.length} used; radiant wins ${(radiantRate * 100).toFixed(1)}%`);

// ---- pairwise tables ----------------------------------------------------------------------
const logit = (p: number) => Math.log(p / (1 - p));
const sig = (x: number) => 1 / (1 + Math.exp(-x));
const base = new Map<string, number>();
for (const h of heroes) {
  let w = 0;
  let n = 0;
  for (const [wr, g] of Object.values(mu[h] ?? {})) {
    w += wr * g;
    n += g;
  }
  base.set(h, n ? w / n : 0.5);
}
/** measured gap of h vs e, pp, both records; 0 when unmeasured. */
function gapOf(h: string, e: string): number {
  const a = mu[h]?.[e];
  const b = mu[e]?.[h];
  const bh = base.get(h)!;
  const be = base.get(e)!;
  let w = 0;
  let s = 0;
  if (a) { s += (a[0] - sig(logit(bh) - logit(be))) * 100 * a[1]; w += a[1]; }
  if (b) { s += -(b[0] - sig(logit(be) - logit(bh))) * 100 * b[1]; w += b[1]; }
  return w ? s / w : 0;
}
/** measured "together" gap of an allied pair, pp, both records. */
function synOf(h: string, a: string): number {
  const t = allies.allies ?? {};
  const x = t[h]?.[a];
  const y = t[a]?.[h];
  const exp = sig(logit(base.get(h)!) + logit(base.get(a)!));
  let w = 0;
  let s = 0;
  if (x) { s += (x[0] - exp) * 100 * x[1]; w += x[1]; }
  if (y) { s += (y[0] - exp) * 100 * y[1]; w += y[1]; }
  return w ? s / w : 0;
}
const mainPos = new Map(heroes.map((h) => [h, assignPositions(kb, [h]).get(h) ?? 3]));
const lift = new Map<string, Map<string, number>>(); // lift.get(h).get(e)
for (const e of heroes) {
  const scores = kbPairScores(kb, e);
  for (const h of heroes) {
    if (h === e) continue;
    const usual = kb.baselines?.["0"]?.[h]?.[mainPos.get(e)! - 1] ?? 0;
    if (!lift.has(h)) lift.set(h, new Map());
    lift.get(h)!.set(e, (scores.get(h) ?? 0) - usual);
  }
}

// ---- features -----------------------------------------------------------------------------
type Feat = Record<string, number>;
function pairFeatures(m: Match): Feat {
  let b = 0;
  for (const h of m.r) b += logit(base.get(h)!);
  for (const h of m.d) b -= logit(base.get(h)!);
  let gap = 0;
  let k = 0;
  for (const h of m.r) for (const e of m.d) {
    gap += gapOf(h, e);
    k += lift.get(h)!.get(e)! - lift.get(e)!.get(h)!;
  }
  let syn = 0;
  for (const [team, sign] of [[m.r, 1], [m.d, -1]] as const) for (let i = 0; i < 5; i++) for (let j = i + 1; j < 5; j++) syn += sign * synOf(team[i]!, team[j]!);
  return { base: b, gap, kb: k, syn };
}
function engineFeatures(m: Match): Feat {
  const out = { eData: 0, eKb: 0, eTeam: 0, eTotal: 0 };
  for (const [team, other, sign] of [[m.r, m.d, 1], [m.d, m.r, -1]] as const) {
    const pos = assignPositions(kb, team);
    for (const h of team) {
      const rec = heroEdge(kb, { enemyHeroes: [...other], allyHeroes: team.filter((x) => x !== h), myRole: pos.get(h) }, h);
      if (!rec?.edge) continue;
      for (const x of rec.edge.byEnemy) {
        const prior = P.KB_PP_PER_POINT * (x.kb - x.baseline);
        out.eData += sign * (x.gap !== undefined ? x.dataWeight * x.gap : 0);
        out.eKb += sign * (1 - x.dataWeight) * prior;
      }
      out.eTeam += sign * rec.edge.team;
      out.eTotal += sign * rec.edge.total;
    }
  }
  return out;
}

// ---- logistic regression ------------------------------------------------------------------
function fit(X: number[][], y: number[], ridge = 1e-4): { beta: number[]; se: number[] } {
  const k = X[0]!.length;
  let beta = new Array<number>(k).fill(0);
  let H: number[][] = [];
  for (let it = 0; it < 30; it++) {
    const g = new Array<number>(k).fill(0);
    H = Array.from({ length: k }, () => new Array<number>(k).fill(0));
    for (let i = 0; i < X.length; i++) {
      const x = X[i]!;
      const p = sig(x.reduce((s, v, j) => s + v * beta[j]!, 0));
      const w = p * (1 - p);
      for (let a = 0; a < k; a++) {
        g[a]! += (y[i]! - p) * x[a]!;
        for (let b = 0; b < k; b++) H[a]![b]! += w * x[a]! * x[b]!;
      }
    }
    for (let a = 1; a < k; a++) { g[a]! -= ridge * beta[a]!; H[a]![a]! += ridge; }
    const step = solve(H, g);
    beta = beta.map((b, j) => b + step[j]!);
    if (Math.max(...step.map(Math.abs)) < 1e-9) break;
  }
  const inv = invert(H);
  return { beta, se: inv.map((row, j) => Math.sqrt(Math.max(0, row[j]!))) };
}
function solve(A: number[][], b: number[]): number[] {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]!]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r]![c]!) > Math.abs(M[p]![c]!)) p = r;
    [M[c], M[p]] = [M[p]!, M[c]!];
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = M[r]![c]! / M[c]![c]!;
      for (let k = c; k <= n; k++) M[r]![k]! -= f * M[c]![k]!;
    }
  }
  return M.map((row, i) => row[n]! / row[i]!);
}
function invert(A: number[][]): number[][] {
  const n = A.length;
  return Array.from({ length: n }, (_, j) => solve(A, Array.from({ length: n }, (_, i) => (i === j ? 1 : 0)))).map((col, j, all) => all.map((c) => c[j]!));
}

let seed = 20261110;
const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
const fold = matches.map(() => Math.floor(rnd() * 5));
const y = matches.map((m) => m.radiantWin);

interface Scored { name: string; feats: string[]; oof: number[]; logloss: number; auc: number; acc: number; beta: number[]; se: number[] }
function evaluate(name: string, feats: string[], F: Feat[]): Scored {
  const X = F.map((f) => [1, ...feats.map((k) => f[k]!)]);
  const oof = new Array<number>(X.length);
  for (let k = 0; k < 5; k++) {
    const tr = X.map((_, i) => i).filter((i) => fold[i] !== k);
    const { beta } = fit(tr.map((i) => X[i]!), tr.map((i) => y[i]!));
    for (let i = 0; i < X.length; i++) if (fold[i] === k) oof[i] = sig(X[i]!.reduce((s, v, j) => s + v * beta[j]!, 0));
  }
  const all = fit(X, y);
  return { name, feats, oof, ...metrics(oof, y), beta: all.beta, se: all.se };
}
function metrics(p: number[], t: number[]): { logloss: number; auc: number; acc: number } {
  let ll = 0;
  let acc = 0;
  for (let i = 0; i < p.length; i++) {
    const q = Math.min(1 - 1e-9, Math.max(1e-9, p[i]!));
    ll -= t[i]! ? Math.log(q) : Math.log(1 - q);
    acc += (q >= 0.5 ? 1 : 0) === t[i]! ? 1 : 0;
  }
  return { logloss: ll / p.length, auc: auc(p, t), acc: acc / p.length };
}
function auc(p: number[], t: number[]): number {
  const idx = p.map((v, i) => [v, i] as const).sort((a, b) => a[0] - b[0]);
  let rankSum = 0;
  let pos = 0;
  for (let r = 0; r < idx.length; ) {
    let j = r;
    while (j + 1 < idx.length && idx[j + 1]![0] === idx[r]![0]) j++;
    for (let k = r; k <= j; k++) if (t[idx[k]![1]]) { rankSum += (r + j) / 2 + 1; pos++; }
    r = j + 1;
  }
  const neg = p.length - pos;
  return (rankSum - (pos * (pos + 1)) / 2) / (pos * neg);
}
/** paired bootstrap of the log-loss difference a - b (negative = a is better). */
function compare(a: Scored, b: Scored): { diff: number; se: number } {
  const n = y.length;
  const d = a.oof.map((p, i) => {
    const q = (x: number) => -(y[i] ? Math.log(Math.max(1e-9, x)) : Math.log(Math.max(1e-9, 1 - x)));
    return q(p) - q(b.oof[i]!);
  });
  const mean = d.reduce((s, x) => s + x, 0) / n;
  let s2 = 0;
  for (let rep = 0; rep < 500; rep++) {
    let s = 0;
    for (let i = 0; i < n; i++) s += d[Math.floor(rnd() * n)]!;
    s2 += (s / n - mean) ** 2;
  }
  return { diff: mean, se: Math.sqrt(s2 / 500) };
}

// ---- run ----------------------------------------------------------------------------------
const t0 = Date.now();
const F: Feat[] = matches.map((m) => ({ ...pairFeatures(m), ...engineFeatures(m) }));
console.log(`features: ${((Date.now() - t0) / 1000).toFixed(0)} s`);

const models = [
  evaluate("constant (radiant side only)", [], F),
  evaluate("hero strength", ["base"], F),
  evaluate("+ measured matchups", ["base", "gap"], F),
  evaluate("+ KB mechanics (pairwise)", ["base", "kb"], F),
  evaluate("+ measured matchups + KB mechanics", ["base", "gap", "kb"], F),
  evaluate("+ matchups + KB + measured synergy", ["base", "gap", "kb", "syn"], F),
  evaluate("engine as shipped (one number)", ["base", "eTotal"], F),
  evaluate("engine split: data / KB / team", ["base", "eData", "eKb", "eTeam"], F),
  evaluate("engine split + measured synergy", ["base", "eData", "eKb", "eTeam", "syn"], F),
];
const byName = new Map(models.map((m) => [m.name, m]));

// ---- variants of the engine parameters ------------------------------------------------------
interface Variant { name: string; set: () => () => void }
const variants: Variant[] = [
  { name: "TARGET_FLOOR 1 (no target weight, before ADR-059)", set: () => tweak("TARGET_FLOOR", 1) },
  { name: "STACK_DECAY 1 (no saturation, before ADR-059)", set: () => tweak("STACK_DECAY", 1) },
  { name: "LANE_WEIGHT 1 (lane opponents not special)", set: () => tweak("LANE_WEIGHT", 1) },
  { name: "RISK_WEIGHT 0 (no risks)", set: () => tweak("RISK_WEIGHT", 0) },
  { name: "SYNERGY_WEIGHT 0 (no KB combos)", set: () => tweak("SYNERGY_WEIGHT", 0) },
  { name: "no pick_weight (rule weights before ADR-062)", set: () => {
    const saved = kb.taxonomy.edges.map((e) => e.pick_weight);
    for (const e of kb.taxonomy.edges) delete e.pick_weight;
    return () => kb.taxonomy.edges.forEach((e, i) => { if (saved[i] !== undefined) e.pick_weight = saved[i]; });
  } },
];
function tweak(name: keyof typeof P, value: number): () => void {
  const old = P[name];
  (P as Record<string, number>)[name] = value;
  return () => { (P as Record<string, number>)[name] = old; };
}
const variantRows: string[] = [];
if (VARIANTS) {
  const shipped = byName.get("engine split: data / KB / team")!;
  for (const v of variants) {
    const undo = v.set();
    const savedBase = kb.baselines;
    kb.baselines = computeBaselines({ ...kb, baselines: undefined, matchups: undefined } as typeof kb);
    const G = matches.map((m, i) => ({ ...F[i]!, ...engineFeatures(m) }));
    kb.baselines = savedBase;
    undo();
    const s = evaluate(v.name, ["base", "eData", "eKb", "eTeam"], G);
    const c = compare(s, shipped);
    variantRows.push(`| ${v.name} | ${s.logloss.toFixed(5)} | ${s.auc.toFixed(4)} | ${f(c.diff * 1000, 2)} ± ${(c.se * 1000).toFixed(2)} | ${verdictOf(c)} |`);
    console.log(`variant ${v.name}: ${f(c.diff * 1000, 2)} ± ${(c.se * 1000).toFixed(2)} (x1000 log-loss vs shipped)`);
  }
}
function verdictOf(c: { diff: number; se: number }): string {
  if (c.diff <= -2 * c.se) return "**better** than shipped";
  if (c.diff >= 2 * c.se) return "worse than shipped";
  return "no difference";
}

// ---- report -------------------------------------------------------------------------------
function f(x: number, d = 2): string {
  return (x >= 0 ? "+" : "") + x.toFixed(d);
}
const ref = byName.get("hero strength")!;
const out: string[] = [];
out.push("# Draft backtest");
out.push("");
out.push("Generated by `npx tsx scripts/backtest.ts <matches.ndjson>` (ADR-063). Do not edit by hand.");
out.push("");
const first = new Date(Math.min(...matches.map((m) => m.at))).toISOString().slice(0, 16);
const last = new Date(Math.max(...matches.map((m) => m.at))).toISOString().slice(0, 16);
out.push(`Matches: **${matches.length}** public ranked All Pick games, Crusader–Ancient, 15+ minutes, played ${first} – ${last} UTC (OpenDota publicMatches). All after the statistics snapshot (${allies.source ?? "?"}, ${(allies.fetchedAt ?? "").slice(0, 10)}): the measured matchups have not seen them. Radiant won ${(radiantRate * 100).toFixed(1)}%.`);
out.push("");
out.push("## Out-of-sample prediction of the winner");
out.push("");
out.push("5-fold cross-validation. Log-loss: lower is better (0.6931 = a coin flip). Δ: log-loss against \"hero strength\" × 1000, with a paired-bootstrap standard error; negative = better.");
out.push("");
out.push("| Model | Log-loss | AUC | Accuracy | Δ vs hero strength (×1000) |");
out.push("|---|---|---|---|---|");
for (const m of models) {
  const c = m === ref ? undefined : compare(m, ref);
  out.push(`| ${m.name} | ${m.logloss.toFixed(5)} | ${m.auc.toFixed(4)} | ${(m.acc * 100).toFixed(1)}% | ${c ? `${f(c.diff * 1000, 2)} ± ${(c.se * 1000).toFixed(2)}` : "—"} |`);
}
out.push("");
const pair = (a: string, b: string) => { const c = compare(byName.get(a)!, byName.get(b)!); return `${f(c.diff * 1000, 2)} ± ${(c.se * 1000).toFixed(2)}`; };
out.push("Key comparisons (log-loss × 1000, negative = the first is better):");
out.push("");
out.push(`- KB mechanics on top of measured matchups: ${pair("+ measured matchups + KB mechanics", "+ measured matchups")}`);
out.push(`- measured matchups on top of KB mechanics: ${pair("+ measured matchups + KB mechanics", "+ KB mechanics (pairwise)")}`);
out.push(`- measured synergy on top of both: ${pair("+ matchups + KB + measured synergy", "+ measured matchups + KB mechanics")}`);
out.push(`- the engine's lineup context (lane, target, saturation, team) vs the plain pairwise sums: ${pair("engine split: data / KB / team", "+ measured matchups + KB mechanics")}`);
out.push(`- engine split vs engine as one number: ${pair("engine split: data / KB / team", "engine as shipped (one number)")}`);
out.push("");
out.push("## Coefficients (all matches)");
out.push("");
out.push("pp of win probability per unit of the feature, at 50% (25 × β), ± one standard error. For the matchup and engine features the unit is already pp: a calibrated feature has a coefficient of about +1 per side counted (the engine counts every pair from both sides, so its calibrated value is about +0.5).");
out.push("");
out.push("| Model | Feature | pp per unit | ± |");
out.push("|---|---|---|---|");
for (const m of models) {
  m.feats.forEach((k, j) => out.push(`| ${m.name} | ${k} | ${f(25 * m.beta[j + 1]!, 3)} | ${(25 * m.se[j + 1]!).toFixed(3)} |`));
}
out.push("");
const both = byName.get("+ measured matchups + KB mechanics")!;
const ratio = both.beta[3]! / both.beta[2]!;
out.push(`KB point in pp of matchup, in full drafts: β(kb) / β(gap) = **${ratio.toFixed(2)}** (engine: KB_PP_PER_POINT = ${P.KB_PP_PER_POINT}, derived pair by pair). Noise in the measured gaps attenuates β(gap), so the ratio is an upper bound.`);
out.push("");
if (variantRows.length) {
  out.push("## Engine parameter variants");
  out.push("");
  out.push("The engine split model refitted with one parameter changed (baselines recomputed). Δ = log-loss × 1000 against the shipped parameters; negative = the variant predicts better.");
  out.push("");
  out.push("| Variant | Log-loss | AUC | Δ vs shipped (×1000) | Verdict |");
  out.push("|---|---|---|---|---|");
  out.push(...variantRows);
  out.push("");
}
writeFileSync(join(ROOT, "BACKTEST.md"), out.join("\n"), "utf8");
for (const m of models) console.log(`${m.name.padEnd(40)} ll ${m.logloss.toFixed(5)} auc ${m.auc.toFixed(4)} acc ${(m.acc * 100).toFixed(1)}`);
console.log(`KB point in pp, full drafts: ${ratio.toFixed(2)}`);
