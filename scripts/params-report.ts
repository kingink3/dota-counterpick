// =============================================================================
//  Sensitivity of the ranking to each engine parameter (ADR-039).
//  Three outputs are compared: hero picks, counter items, and the "For this draft"
//  part of the item plan for the hero you play (where the buy-share parameters act).
//
//  For a fixed set of drafts (seeded, reproducible) the engine ranks heroes and items
//  with every parameter at its documented value (baseline), then again with ONE
//  parameter moved to the low and to the high end of its range (src/params.ts). Per
//  run: how many of the baseline top-5 stay in the top-5, and whether the #1 changes.
//  A parameter whose whole defensible range barely moves the top needs no calibration;
//  one that reshuffles it is where real data should go first.
//
//    npx tsx scripts/params-report.ts            -> PARAMS.md
//    npx tsx scripts/params-report.ts --drafts 300
// =============================================================================

import { writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { CounterPickEngine } from "../src/engine.js";
import { archetypeOf } from "../src/resolver.js";
import { buildPlan, type ItemStats } from "../src/item-plan.js";
import { P, PARAM_DOCS, resetParams, type ParamName } from "../src/params.js";
import type { DraftState, EngineResult } from "../src/types.js";

const root = join(import.meta.dirname, "..");
const argN = process.argv.indexOf("--drafts");
const N = argN > 0 ? Number(process.argv[argN + 1]) : 120;
const TOP = 5;

// ---- drafts: seeded random, 5 enemies; half with 2 allies + your hero and role ----
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}
const engine = CounterPickEngine.load(root);
const roster = (JSON.parse(readFileSync(join(root, "data", "roster.json"), "utf8")) as { heroes: Array<{ valve: string }> }).heroes
  .map((h) => h.valve)
  .filter((h) => engine.kb.taxonomy.hero_tags[h]);
const stats = JSON.parse(readFileSync(join(root, "data", "item-stats.json"), "utf8")) as ItemStats;
// items an enemy can be seen with: everything the KB gives traits or tools
const traitIds = Object.keys((engine.kb as unknown as { itemTraits?: Record<string, unknown> }).itemTraits ?? {});
const itemPool = [...new Set([...traitIds, ...engine.kb.items.filter((i) => Object.keys(i.tool).length).map((i) => i.code)])];
const rand = rng(39);
const pick = (n: number, not: Set<string>) => {
  const out: string[] = [];
  while (out.length < n) {
    const h = roster[Math.floor(rand() * roster.length)]!;
    if (!not.has(h)) {
      not.add(h);
      out.push(h);
    }
  }
  return out;
};
const drafts: DraftState[] = [];
for (let i = 0; i < N; i++) {
  const used = new Set<string>();
  const enemyHeroes = pick(5, used);
  if (i % 2 === 0) {
    drafts.push({ enemyHeroes, allyHeroes: pick(2, used), myRole: 1 + (i % 5) });
  } else {
    const [myHero, ...allies] = pick(3, used);
    const role = engine.kb.taxonomy.hero_tags[myHero!]?.pos[0] ?? 1;
    // the hero you play is locked: enemies show 1-2 items each (ADR-024), so item tools count
    const enemyItems: Record<string, string[]> = {};
    for (const e of enemyHeroes) enemyItems[e] = Array.from({ length: 1 + Math.floor(rand() * 2) }, () => itemPool[Math.floor(rand() * itemPool.length)]!);
    drafts.push({ enemyHeroes, allyHeroes: [myHero!, ...allies], myHero: myHero!, myRole: role, enemyItems });
  }
}

const planTop = (d: DraftState, r: EngineResult): string[] => {
  if (!d.myHero) return [];
  const archetype = archetypeOf(engine.kb, d.myHero, d.myRole);
  const plan = buildPlan({
    hero: d.myHero,
    ...(archetype ? { archetype } : {}),
    ...(d.myRole ? { role: d.myRole } : {}),
    stats,
    counters: [...r.items, ...r.defense].sort((a, b) => b.score - a.score),
    dcKey: (id) => engine.kb.itemDcKey?.[id],
    allies: (d.allyHeroes ?? []).filter((h) => h !== d.myHero),
  });
  return (plan?.phases.find((p) => p.id === "situational")?.items ?? []).slice(0, TOP).map((i) => i.key);
};
const tops = (d: DraftState, r: EngineResult) => ({ heroes: r.heroes.slice(0, TOP).map((x) => x.code), items: r.items.slice(0, TOP).map((x) => x.code), plan: planTop(d, r) });
type Tops = ReturnType<typeof tops>;
const run = (): Tops[] => drafts.map((d) => tops(d, engine.recommend(d)));

function compare(base: Tops[], alt: Tops[], kind: "heroes" | "items" | "plan") {
  let kept = 0;
  let slots = 0;
  let firstChanged = 0;
  let n = 0;
  base.forEach((b, i) => {
    const B = b[kind];
    const A = alt[i]![kind];
    if (!B.length) return;
    n++;
    slots += B.length;
    kept += B.filter((x) => A.includes(x)).length;
    if (A[0] !== B[0]) firstChanged++;
  });
  return { keep: n ? kept / slots : 1, first: n ? firstChanged / n : 0, n };
}

resetParams();
const base = run();
const rows: Array<{ name: ParamName; lo: number; hi: number; h: [number, number]; hf: [number, number]; i: [number, number]; if_: [number, number]; p: [number, number]; worst: number; idle: boolean }> = [];
for (const name of Object.keys(PARAM_DOCS) as ParamName[]) {
  const d = PARAM_DOCS[name];
  const res: Array<{ h: ReturnType<typeof compare>; i: ReturnType<typeof compare>; p: ReturnType<typeof compare>; touched: boolean }> = [];
  for (const v of d.range) {
    resetParams();
    P[name] = v;
    const alt = run();
    res.push({ h: compare(base, alt, "heroes"), i: compare(base, alt, "items"), p: compare(base, alt, "plan"), touched: JSON.stringify(alt) !== JSON.stringify(base) });
  }
  resetParams();
  const [L, H] = res as [(typeof res)[0], (typeof res)[0]];
  rows.push({
    name,
    lo: d.range[0],
    hi: d.range[1],
    h: [L.h.keep, H.h.keep],
    hf: [L.h.first, H.h.first],
    i: [L.i.keep, H.i.keep],
    if_: [L.i.first, H.i.first],
    p: [L.p.keep, H.p.keep],
    worst: Math.min(L.h.keep, H.h.keep, L.i.keep, H.i.keep, L.p.keep, H.p.keep),
    idle: !L.touched && !H.touched,
  });
}

const pct = (x: number) => `${Math.round(x * 100)}%`;
const band = (w: number) => (w >= 0.95 ? "low" : w >= 0.85 ? "medium" : "**high**");
const heroDrafts = base.filter((b) => b.heroes.length).length;
const itemDrafts = base.filter((b) => b.items.length).length;
const planDrafts = base.filter((b) => b.plan.length).length;
const lines: string[] = [
  "# Engine parameters and their sensitivity",
  "",
  "Generated by `npx tsx scripts/params-report.ts` (ADR-039). Values and arguments live in",
  "`src/params.ts`; this file shows how much the ranking depends on each of them.",
  "",
  `Method: ${N} seeded random drafts (5 enemies; half also with 2 allies and a role, half with your`,
  `hero locked and 1-2 items seen on each enemy): ${heroDrafts} with hero picks, ${itemDrafts} with counter items, ${planDrafts} with an`,
  `item plan ("For this draft"). Each parameter is moved alone to`,
  `the low and the high end of its range; **top-${TOP} kept** = share of the baseline top-${TOP} still in the`,
  `top-${TOP}; **#1 changed** = drafts whose first pick changed. Sensitivity = the worst "kept" of the`,
  "six comparisons: low >= 95%, medium >= 85%, high below. *Not exercised* = no output changed at",
  "either end; the parameter is real but these drafts never reach it - its argument stands alone.",
  "",
  "Kinds: *game* - a fact; *design* - a cap / floor / normalisation; *derived* - computed from",
  "other choices; *expert* - a judgement, to be calibrated first where sensitivity is high.",
  "",
  `| Parameter | Value | Kind | Range | Heroes top-${TOP} kept (lo / hi) | Heroes #1 changed | Items top-${TOP} kept | Items #1 changed | Plan top-${TOP} kept | Sensitivity |`,
  "|---|---|---|---|---|---|---|---|---|---|",
];
for (const r of [...rows].sort((a, b) => a.worst - b.worst)) {
  const d = PARAM_DOCS[r.name];
  lines.push(
    `| \`${r.name}\` | ${d.value} | ${d.kind} | ${r.lo} – ${r.hi} | ${pct(r.h[0])} / ${pct(r.h[1])} | ${pct(r.hf[0])} / ${pct(r.hf[1])} | ${pct(r.i[0])} / ${pct(r.i[1])} | ${pct(r.if_[0])} / ${pct(r.if_[1])} | ${pct(r.p[0])} / ${pct(r.p[1])} | ${r.idle ? "not exercised" : band(r.worst)} |`,
  );
}
lines.push("", "## Arguments", "");
for (const [name, d] of Object.entries(PARAM_DOCS)) lines.push(`- **\`${name}\` = ${d.value}** (${d.kind}, ${d.area}; range ${d.range[0]} – ${d.range[1]}). ${d.why}`);
lines.push("");
writeFileSync(join(root, "PARAMS.md"), lines.join("\n"));
console.log(lines.filter((l) => l.startsWith("|")).join("\n"));
