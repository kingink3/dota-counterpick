// =============================================================================
//  Enemy-team tag census (ADR-012 §1: "считать перепись тегов вражеского
//  состава для conditions с min_targets").
//
//  For every reliance tag, how many enemies carry it (and a quick presence test).
//  This is the team-level context that edge `min_targets` conditions read.
// =============================================================================

import { P } from "./params.js";
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
  /** quick lookup of a single enemy's tag table (hero tags + items, ADR-024). */
  tagsOf(enemy: string): HeroTags | undefined;
  /** labels of the enemy's items that raised this tag above the hero's own value. */
  viaOf(enemy: string, kind: "reliance" | "tool" | "resist", code: string): string[] | undefined;
}

/** an item's offensive tools count a bit less than a hero's own kit (ADR-039:
 *  P.ITEM_TOOL_SCALE). Traits from item_traits.yaml are used as written. */

export function buildCensus(kb: KnowledgeBase, enemyHeroes: string[], enemyItems?: Record<string, string[]>): Census {
  const heroTags = kb.taxonomy.hero_tags;
  const relianceCount = new Map<string, number>();
  const toolCount = new Map<string, number>();
  const enemies: string[] = [];
  const unknownEnemies: string[] = [];
  const merged = new Map<string, HeroTags>();
  const via = new Map<string, Map<string, string[]>>();
  const itemTools = new Map(kb.items.map((i) => [i.code, i]));

  for (const code of enemyHeroes) {
    const base = heroTags[code];
    if (!base) {
      unknownEnemies.push(code);
      continue;
    }
    enemies.push(code);
    const tags = withItems(base, enemyItems?.[code] ?? [], kb, itemTools, (key, label) => {
      const m = via.get(code) ?? new Map<string, string[]>();
      m.set(key, [...new Set([...(m.get(key) ?? []), label])]);
      via.set(code, m);
    });
    merged.set(code, tags);
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
    tagsOf: (enemy) => merged.get(enemy) ?? heroTags[enemy],
    viaOf: (enemy, kind, code) => via.get(enemy)?.get(`${kind}:${code}`),
  };
}

/** hero tags + what the held items add (max-merge; an item never lowers a tag). */
function withItems(
  base: HeroTags,
  items: string[],
  kb: KnowledgeBase,
  itemTools: Map<string, { label: string; tool: Record<string, number> }>,
  mark: (key: string, label: string) => void,
): HeroTags {
  if (!items.length) return base;
  const out: HeroTags = {
    pos: base.pos,
    reliance: { ...(base.reliance ?? {}) },
    tool: { ...(base.tool ?? {}) },
    resist: { ...(base.resist ?? {}) },
  };
  const raise = (kind: "reliance" | "tool" | "resist", code: string, w: number, label: string) => {
    const table = out[kind]!;
    if (w > (table[code] ?? 0)) {
      table[code] = w;
      mark(`${kind}:${code}`, label);
    }
  };
  for (const id of items) {
    const trait = kb.itemTraits?.[id];
    const def = itemTools.get(id);
    const label = trait?.label ?? def?.label ?? id;
    for (const [t, w] of Object.entries(def?.tool ?? {})) raise("tool", t, w * P.ITEM_TOOL_SCALE, label);
    for (const [t, w] of Object.entries(trait?.tool ?? {})) raise("tool", t, w, label);
    for (const [r, w] of Object.entries(trait?.reliance ?? {})) raise("reliance", r, w, label);
    for (const [r, w] of Object.entries(trait?.resist ?? {})) raise("resist", r, w, label);
  }
  return out;
}
