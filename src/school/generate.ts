// =============================================================================
//  Situations generated from the knowledge base (ADR-046): "the enemy is X - which
//  item / hero answers it best?". The engine's top pick is the answer; the other
//  options are real items / heroes that scored far lower for this draft (at most a
//  third of the top score), so the question has one clear answer. The reasons the
//  engine gives are the explanation. Pure: the caller passes the engine.
// =============================================================================

import type { DraftState, EngineResult, Recommendation } from "../types.js";
import type { KnowledgeBase } from "../knowledge.js";
import type { ItemStats } from "../item-plan.js";
import type { Situation } from "./types.js";

export interface GenDeps {
  resolve: (d: DraftState) => EngineResult;
  /** heroes the KB knows (engine ids). */
  heroes: string[];
  /** items that may appear as options (engine ids). */
  items: string[];
  heroLabel: (id: string) => string;
  itemLabel: (id: string) => string;
  /** one line: why this recommendation (the lead reason). */
  why: (rec: Recommendation) => string;
  /** module 3 (ADR-049): the knowledge base itself and the build statistics. */
  kb?: KnowledgeBase;
  stats?: ItemStats;
}

export type GenKind = "items" | "draft" | "mechanism" | "itemtool" | "builds" | "timing";

/** small seeded PRNG so a "new set" is reproducible from its seed. */
export function rng(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}
const pickN = <T>(xs: T[], n: number, r: () => number): T[] => {
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a.slice(0, n);
};

/** the top answer must beat every distractor by this factor. */
const MARGIN = 3;

const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}`;

export function generate(kind: GenKind, n: number, seed: number, d: GenDeps): Situation[] {
  const r = rng(seed);
  const out: Situation[] = [];
  if (kind !== "items" && kind !== "draft") return generateKb(kind, n, r, seed, d);
  for (let tries = 0; out.length < n && tries < n * 12; tries++) {
    const enemies = pickN(d.heroes, 5, r);
    if (kind === "items") {
      const pool = d.heroes.filter((h) => !enemies.includes(h));
      const me = pickN(pool, 1, r)[0]!;
      const res = d.resolve({ enemyHeroes: enemies, allyHeroes: [me], myHero: me });
      const top = res.items[0];
      if (!top || top.score < 2) continue;
      const scored = new Map(res.items.map((x) => [x.code, x.score]));
      const low = d.items.filter((i) => i !== top.code && (scored.get(i) ?? 0) * MARGIN <= top.score);
      if (low.length < 3) continue;
      const options = [top.code, ...pickN(low, 3, r)];
      out.push({
        id: `gi-${seed}-${out.length}`,
        scene: `Enemy team: ${enemies.map(d.heroLabel).join(", ")}. You play ${d.heroLabel(me)}.`,
        q: "Which of these items answers this enemy lineup best?",
        options: options.map(d.itemLabel),
        correct: 0,
        why: `${d.itemLabel(top.code)}: ${d.why(top)}`,
      });
    } else {
      const res = d.resolve({ enemyHeroes: enemies });
      const top = res.heroes[0];
      if (!top || top.score < 2) continue;
      const low = res.heroes.filter((h) => h.score * MARGIN <= top.score).map((h) => h.code);
      if (low.length < 3) continue;
      const options = [top.code, ...pickN(low, 3, r)];
      out.push({
        id: `gd-${seed}-${out.length}`,
        scene: `Enemy team: ${enemies.map(d.heroLabel).join(", ")}.`,
        q: "Which of these heroes counters this lineup best?",
        options: options.map(d.heroLabel),
        correct: 0,
        why: `${d.heroLabel(top.code)}: ${d.why(top)}`,
      });
    }
  }
  return out;
}

// ---- module 3: straight from the knowledge base and the build statistics ----------

function generateKb(kind: Exclude<GenKind, "items" | "draft">, n: number, r: () => number, seed: number, d: GenDeps): Situation[] {
  const kb = d.kb;
  const out: Situation[] = [];
  if (!kb) return out;
  const tx = kb.taxonomy;
  const toolLabel = (c: string) => kb.toolByCode.get(c)?.label ?? c;
  const used = new Set<string>();
  for (let tries = 0; out.length < n && tries < n * 20; tries++) {
    const id = `g${kind[0]}-${seed}-${out.length}`;
    if (kind === "mechanism") {
      // "this enemy relies on X - which tool answers it?" (taxonomy edges, with their mechanism)
      const e = tx.edges[Math.floor(r() * tx.edges.length)]!;
      if (used.has(e.target) || !kb.toolByCode.has(e.tool)) continue;
      const rel = tx.reliance.find((x) => x.code === e.target);
      const heroes = Object.entries(tx.hero_tags).filter(([, t]) => (t.reliance[e.target] ?? 0) >= 0.7).map(([h]) => h);
      const answers = new Set(tx.edges.filter((x) => x.target === e.target).map((x) => x.tool));
      const wrong = tx.tool.filter((t) => !answers.has(t.code) && t.class === "mechanical").map((t) => t.code);
      if (!rel || !heroes.length || wrong.length < 3) continue;
      used.add(e.target);
      const hero = heroes[Math.floor(r() * heroes.length)]!;
      out.push({
        id,
        scene: `The enemy ${d.heroLabel(hero)} - ${rel.label.toLowerCase()}.`,
        q: "Which kind of answer works on that?",
        options: [toolLabel(e.tool), ...pickN(wrong, 3, r).map(toolLabel)],
        correct: 0,
        why: `${toolLabel(e.tool)}: ${e.mechanism}.`,
      });
    } else if (kind === "itemtool") {
      // "what does this item bring?" (items.yaml tools, the strongest one)
      const items = kb.items.filter((i) => Object.values(i.tool).some((w) => w >= 0.8));
      const it = items[Math.floor(r() * items.length)];
      if (!it || used.has(it.code)) continue;
      const [tool] = Object.entries(it.tool).sort((a, b) => b[1] - a[1])[0]!;
      if (!kb.toolByCode.has(tool)) continue;
      const wrong = tx.tool.filter((t) => !(t.code in it.tool) && t.class === "mechanical").map((t) => t.code);
      used.add(it.code);
      out.push({
        id,
        scene: `You think about buying ${it.label}.`,
        q: "What does it bring against the enemy?",
        options: [toolLabel(tool), ...pickN(wrong, 3, r).map(toolLabel)],
        correct: 0,
        why: `${it.label}: ${toolLabel(tool).toLowerCase()}${Object.keys(it.tool).length > 1 ? ` (also ${Object.keys(it.tool).filter((t) => t !== tool).map(toolLabel).join(", ").toLowerCase()})` : ""}.`,
      });
    } else {
      const stats = d.stats;
      if (!stats) return out;
      const heroes = Object.keys(stats.heroes);
      const h = heroes[Math.floor(r() * heroes.length)]!;
      const hs = stats.heroes[h]!;
      if (used.has(h) || !kb.taxonomy.hero_tags[h]) continue;
      if (kind === "builds") {
        // the most common finished core item for the hero's main position (STRATZ, public
        // matches Crusader-Ancient, by position) vs finished items it never builds there
        const pos = hs.mainPos;
        const ph = pos ? hs.byPos?.[pos]?.phases : undefined;
        const big = (k: string) => (stats.items[k]?.components?.length ?? 0) > 0 && (stats.items[k]?.cost ?? 0) >= 2000;
        const top = [...(ph?.mid ?? []), ...(ph?.late ?? [])].map(([k]) => k).find(big);
        const own = new Set(Object.values(ph ?? {}).flatMap((x) => x.map(([k]) => k)));
        const others = Object.keys(stats.items).filter((k) => big(k) && !own.has(k));
        if (!pos || !top || others.length < 3) continue;
        used.add(h);
        const lab = (k: string) => stats.items[k]?.label ?? d.itemLabel(k);
        out.push({
          id,
          scene: `${d.heroLabel(h)} as position ${pos}.`,
          q: "Which of these finished items do players build most often on this hero?",
          options: [lab(top), ...pickN(others, 3, r).map(lab)],
          correct: 0,
          why: `${lab(top)} is the most common big item for this hero at position ${pos} in public matches (Crusader-Ancient, STRATZ); the others do not appear in its builds there.`,
        });
      } else {
        // the typical finish time of a core item
        const t = Object.entries(hs.timing ?? {}).filter(([, v]) => v.games >= 300 && v.p50 >= 480 && v.p25 !== v.p75);
        if (!t.length) continue;
        const [item, v] = t[Math.floor(r() * t.length)]!;
        const lab = (k: string) => stats.items[k]?.label ?? d.itemLabel(k);
        const round = (x: number) => Math.round(x / 60) * 60;
        const right = round(v.p50);
        const alts = [...new Set([round(v.p50 * 0.55), round(v.p50 * 1.45), round(v.p50 * 1.9)])].filter((x) => x !== right && x > 0);
        if (alts.length < 3) continue;
        used.add(h);
        out.push({
          id,
          scene: `${d.heroLabel(h)} buys ${lab(item)}.`,
          q: "When do players typically finish it?",
          options: [mmss(right), ...alts.map(mmss)],
          correct: 0,
          why: `Median about ${mmss(v.p50)}; a quarter of players by ${mmss(v.p25)}, three quarters by ${mmss(v.p75)} (parsed public matches). Earlier finishers win more, partly because they were already ahead.`,
        });
      }
    }
  }
  return out;
}
