// =============================================================================
//  Enemy-team tag census (ADR-012 §1: "считать перепись тегов вражеского
//  состава для conditions с min_targets").
//
//  For every reliance tag, how many enemies carry it (and a quick presence test).
//  This is the team-level context that edge `min_targets` conditions read.
// =============================================================================

import type { KnowledgeBase } from "./kb.js";
import type { HeroTags } from "./types.js";

export interface Census {
  /** reliance tag -> number of enemy heroes carrying it (weight > 0). */
  relianceCount: Map<string, number>;
  /** tool tag -> number of enemy heroes carrying it (weight > 0) - threat census. */
  toolCount: Map<string, number>;
  /** the resolved enemy heroes (codes that exist in hero_tags). */
  enemies: string[];
  /** enemy codes not found in hero_tags (reported, not silently dropped). */
  unknownEnemies: string[];
  /** every selected enemy code (tagged + untagged) - what edges match against. */
  allSelected: string[];
  /** quick lookup of a single enemy's tag table. */
  tagsOf(enemy: string): HeroTags | undefined;
}

export function buildCensus(kb: KnowledgeBase, enemyHeroes: string[]): Census {
  const heroTags = kb.taxonomy.hero_tags;
  const relianceCount = new Map<string, number>();
  const toolCount = new Map<string, number>();
  const enemies: string[] = [];
  const unknownEnemies: string[] = [];

  for (const code of enemyHeroes) {
    const tags = heroTags[code];
    if (!tags) {
      unknownEnemies.push(code);
      continue;
    }
    enemies.push(code);
    for (const [tag, weight] of Object.entries(tags.reliance ?? {})) {
      if (weight > 0) {
        relianceCount.set(tag, (relianceCount.get(tag) ?? 0) + 1);
      }
    }
    for (const [tag, weight] of Object.entries(tags.tool ?? {})) {
      if (weight > 0) {
        toolCount.set(tag, (toolCount.get(tag) ?? 0) + 1);
      }
    }
  }

  return {
    relianceCount,
    toolCount,
    enemies,
    unknownEnemies,
    allSelected: [...enemies, ...unknownEnemies],
    tagsOf: (enemy) => heroTags[enemy],
  };
}
