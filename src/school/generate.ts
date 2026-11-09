// =============================================================================
//  Situations generated from the knowledge base (ADR-046): "the enemy is X - which
//  item / hero answers it best?". The engine's top pick is the answer; the other
//  options are real items / heroes that scored far lower for this draft (at most a
//  third of the top score), so the question has one clear answer. The reasons the
//  engine gives are the explanation. Pure: the caller passes the engine.
// =============================================================================

import type { DraftState, EngineResult, Recommendation } from "../types.js";
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
}

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

export function generate(kind: "items" | "draft", n: number, seed: number, d: GenDeps): Situation[] {
  const r = rng(seed);
  const out: Situation[] = [];
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
