// =============================================================================
//  Hero baselines (ADR-061): what a hero scores in the KB against an AVERAGE enemy.
//
//  The KB score is a sum of absolute contributions, so a hero with many tool tags
//  (Doom, Juggernaut, Silencer) scores high against any lineup: about half of the
//  score's variance came from who the hero is, not from the draft. Subtracting the
//  hero's own usual leaves the part that is about this draft.
//
//  baselines[role]["hero"][p - 1] = mean KB score of the hero against one enemy whose
//  main position is p, for role "0" (no position chosen) and "1".."5" (the role sets
//  who is the lane opponent). Computed from the KB alone - no statistics - by
//  scripts/build-baselines.ts into data/baselines.json; a test checks it is current.
// =============================================================================

import type { KnowledgeBase } from "./knowledge.js";
import { assignPositions, kbPairScores } from "./resolver.js";

export type Baselines = Record<string, Record<string, number[]>>;

export function computeBaselines(kb: KnowledgeBase, roles: number[] = [0, 1, 2, 3, 4, 5]): Baselines {
  const heroes = Object.keys(kb.taxonomy.hero_tags);
  const mainPos = new Map(heroes.map((h) => [h, assignPositions(kb, [h]).get(h) ?? 3]));
  const out: Baselines = {};
  for (const role of roles) {
    const sum: Record<string, number[]> = {};
    const count: Record<string, number[]> = {};
    for (const enemy of heroes) {
      const p = mainPos.get(enemy)! - 1;
      const scores = kbPairScores(kb, enemy, role || undefined);
      for (const [hero, score] of scores) {
        (sum[hero] ??= [0, 0, 0, 0, 0])[p]! += score;
        (count[hero] ??= [0, 0, 0, 0, 0])[p]! += 1;
      }
    }
    out[String(role)] = Object.fromEntries(
      Object.entries(sum).map(([hero, s]) => [hero, s.map((x, i) => Math.round((x / Math.max(1, count[hero]![i]!)) * 1000) / 1000 + 0)]),
    );
  }
  return out;
}
