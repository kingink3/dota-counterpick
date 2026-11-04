// =============================================================================
//  Pure KB indexing - NO filesystem, NO Node APIs. Safe to bundle for the browser.
//
//  loadKB() (kb.ts) handles disk I/O and hands the raw parsed objects here; the
//  browser fetches the same objects as kb.json (ADR-006 prod path: YAML -> static
//  JSON, no runtime DB) and calls indexKB() directly. Same engine core both sides.
// =============================================================================

import type { Timings } from "./game-timers.js";
import type {
  AttackType,
  Combo,
  DamageSchool,
  DefenseEdge,
  Edge,
  HeroEdge,
  HeroTags,
  ItemDef,
  ItemEdge,
  ItemFitTable,
  Reliance,
  ResistEdge,
  Taxonomy,
  Tool,
  ItemTrait,
} from "./types.js";

/**
 * Damage school per tool - which damage type a counter route represents. Used for
 * the magic/physical "damage read" and per-recommendation school badges. Kept in
 * code (not YAML) because it is a derived presentation classification, not KB truth.
 */
export const TOOL_SCHOOL: Record<string, DamageSchool> = {
  // physical routes
  physical_burst: "physical",
  armor_reduction: "physical",
  true_strike: "physical",
  disarm: "physical",
  break: "physical",
  kite: "physical",
  // magic routes
  magic_burst: "magic",
  // everything else is school-neutral (control/utility/detection)
};

/** stat layer: candidateCode -> enemyCode -> [winrate 0..1, games]. Optional, loaded
 *  separately (data/matchups.json) so the lean kb.json stays KB-only. */
export type Matchups = Record<string, Record<string, [number, number]>>;

export interface KnowledgeBase {
  taxonomy: Taxonomy;
  items: ItemDef[];
  heroEdges: HeroEdge[];
  itemEdges: ItemEdge[];
  defenseEdges: DefenseEdge[];
  combos: Combo[];
  /** hero-vs-hero win rates (Phase 2). undefined when not loaded. */
  matchups?: Matchups;
  itemFit?: ItemFitTable;
  heroAttack?: Record<string, AttackType>;
  /** enemy-item traits (data/item_traits.yaml, ADR-024). */
  itemTraits?: Record<string, ItemTrait>;
  /** our item id -> dotaconstants key where they differ (icons, Tab reader). */
  itemDcKey?: Record<string, string>;
  /** timed map events (data/timings.yaml, ADR-026). */
  timings?: Timings;

  // indices -----------------------------------------------------------------
  relianceByCode: Map<string, Reliance>;
  toolByCode: Map<string, Tool>;
  /** edges grouped by their tool code - the resolver's primary lookup. */
  edgesByTool: Map<string, Edge[]>;
  /** resist edges grouped by resistance code (ADR-020). */
  resistEdgesBy: Map<string, ResistEdge[]>;
  /** resistance code -> attacker tools that bypass it. */
  resistPiercedBy: Map<string, string[]>;
  /** resist edges that name an enemy TOOL, grouped by that tool (blunted term). */
  resistEdgesByTool: Map<string, ResistEdge[]>;
  /** resist edges that name an enemy damage SOURCE (reliance), grouped by it. */
  resistEdgesByReliance: Map<string, ResistEdge[]>;
  knownReliance: Set<string>;
  knownTools: Set<string>;

  /** non-fatal data issues found at index time. */
  warnings: string[];
}

/** the raw, fs-free shape: exactly what kb.json serialises. */
export interface RawKB {
  taxonomy: Taxonomy;
  items: ItemDef[];
  heroEdges: HeroEdge[];
  itemEdges: ItemEdge[];
  defenseEdges: DefenseEdge[];
  combos: Combo[];
  /** item suitability per hero archetype (optional layer, ADR-018). */
  itemFit?: ItemFitTable;
  /** hero code (KB code AND roster valve name) -> melee / ranged. */
  heroAttack?: Record<string, AttackType>;
  itemTraits?: Record<string, ItemTrait>;
  itemDcKey?: Record<string, string>;
  timings?: Timings;
}

export function indexKB(raw: RawKB): KnowledgeBase {
  const { taxonomy, items, heroEdges, itemEdges, defenseEdges, combos } = raw;
  const warnings: string[] = [];

  const relianceByCode = new Map<string, Reliance>(
    taxonomy.reliance.map((r) => [r.code, r]),
  );
  const toolByCode = new Map<string, Tool>(taxonomy.tool.map((t) => [t.code, t]));
  const knownReliance = new Set(relianceByCode.keys());
  const knownTools = new Set(toolByCode.keys());

  const edgesByTool = new Map<string, Edge[]>();
  for (const edge of taxonomy.edges) {
    if (!knownTools.has(edge.tool)) {
      warnings.push(`edge references unknown tool "${edge.tool}"`);
    }
    if (!knownReliance.has(edge.target)) {
      warnings.push(`edge references unknown reliance "${edge.target}"`);
    }
    const list = edgesByTool.get(edge.tool);
    if (list) list.push(edge);
    else edgesByTool.set(edge.tool, [edge]);
  }

  for (const item of items) {
    for (const toolCode of Object.keys(item.tool)) {
      if (!knownTools.has(toolCode)) {
        warnings.push(`item "${item.code}" carries unknown tool "${toolCode}"`);
      }
    }
  }

  for (const he of heroEdges) {
    if (!taxonomy.hero_tags[he.subject]) {
      warnings.push(`hero_edge subject "${he.subject}" not in hero_tags`);
    }
    // wiki edges may target any roster hero (incl. untagged); only curated must be a core.
    if (he.source !== "wiki" && !taxonomy.hero_tags[he.target]) {
      warnings.push(`hero_edge target "${he.target}" not in hero_tags`);
    }
  }

  for (const d of defenseEdges) {
    if (d.threat && !knownTools.has(d.threat)) {
      warnings.push(`defense edge for "${d.item}" references unknown threat tool "${d.threat}"`);
    }
    if (!d.threat && !d.school) {
      warnings.push(`defense edge for "${d.item}" has neither threat nor school`);
    }
  }

  for (const ie of itemEdges) {
    if (ie.source !== "wiki" && !taxonomy.hero_tags[ie.target]) {
      warnings.push(`item_edge "${ie.item}" target "${ie.target}" not in hero_tags`);
    }
  }

  // NOTE: combos are team-synergy data, independent of the counter engine. They may
  // reference supports that are not counter targets (so not in hero_tags) - e.g.
  // Witch Doctor. Their hero codes are validated against the full roster at build
  // time (scripts/build-web.ts), not here.

  // third axis (ADR-020): what a candidate endures
  const knownResist = new Set((taxonomy.resistance ?? []).map((r) => r.code));
  const resistEdgesBy = new Map<string, ResistEdge[]>();
  const resistEdgesByTool = new Map<string, ResistEdge[]>();
  const resistEdgesByReliance = new Map<string, ResistEdge[]>();
  const resistPiercedBy = new Map<string, string[]>();
  for (const r of taxonomy.resistance ?? []) {
    for (const t of r.pierced_by ?? []) {
      if (!knownTools.has(t)) warnings.push(`resistance "${r.code}" pierced_by unknown tool "${t}"`);
    }
    resistPiercedBy.set(r.code, r.pierced_by ?? []);
  }
  for (const re of taxonomy.resist_edges ?? []) {
    if (!knownResist.has(re.resistance)) warnings.push(`resist edge references unknown resistance "${re.resistance}"`);
    if (!re.tool === !re.reliance) warnings.push(`resist edge ${re.resistance}: needs exactly one of tool / reliance`);
    if (re.tool && !knownTools.has(re.tool)) warnings.push(`resist edge references unknown tool "${re.tool}"`);
    if (re.reliance && !knownReliance.has(re.reliance)) warnings.push(`resist edge references unknown reliance "${re.reliance}"`);
    resistEdgesBy.set(re.resistance, [...(resistEdgesBy.get(re.resistance) ?? []), re]);
    if (re.tool) resistEdgesByTool.set(re.tool, [...(resistEdgesByTool.get(re.tool) ?? []), re]);
    if (re.reliance) resistEdgesByReliance.set(re.reliance, [...(resistEdgesByReliance.get(re.reliance) ?? []), re]);
  }

  const knownResistCodes = new Set((taxonomy.resistance ?? []).map((r) => r.code));
  for (const [item, t] of Object.entries(raw.itemTraits ?? {})) {
    for (const c of Object.keys(t.reliance ?? {})) if (!knownReliance.has(c)) warnings.push(`item trait "${item}" has unknown reliance "${c}"`);
    for (const c of Object.keys(t.resist ?? {})) if (!knownResistCodes.has(c)) warnings.push(`item trait "${item}" has unknown resistance "${c}"`);
    for (const c of Object.keys(t.tool ?? {})) if (!knownTools.has(c)) warnings.push(`item trait "${item}" has unknown tool "${c}"`);
  }

  for (const n of taxonomy.team_needs ?? []) {
    for (const t of Object.keys(n.tools)) {
      if (!knownTools.has(t)) warnings.push(`team need "${n.code}" references unknown tool "${t}"`);
    }
  }

  for (const [hero, tags] of Object.entries(taxonomy.hero_tags)) {
    validateHeroTags(hero, tags, knownReliance, knownTools, warnings);
    for (const code of Object.keys(tags.resist ?? {})) {
      if (!knownResist.has(code)) warnings.push(`hero "${hero}" has unknown resistance "${code}"`);
    }
  }

  return {
    taxonomy,
    items,
    heroEdges,
    itemEdges,
    defenseEdges,
    combos,
    ...(raw.itemFit ? { itemFit: raw.itemFit } : {}),
    ...(raw.heroAttack ? { heroAttack: raw.heroAttack } : {}),
    ...(raw.itemTraits ? { itemTraits: raw.itemTraits } : {}),
    ...(raw.itemDcKey ? { itemDcKey: raw.itemDcKey } : {}),
    ...(raw.timings ? { timings: raw.timings } : {}),
    relianceByCode,
    toolByCode,
    edgesByTool,
    resistEdgesBy,
    resistEdgesByTool,
    resistEdgesByReliance,
    resistPiercedBy,
    knownReliance,
    knownTools,
    warnings,
  };
}

function validateHeroTags(
  hero: string,
  tags: HeroTags,
  knownReliance: Set<string>,
  knownTools: Set<string>,
  warnings: string[],
): void {
  for (const code of Object.keys(tags.reliance ?? {})) {
    if (!knownReliance.has(code)) {
      warnings.push(`hero "${hero}" has unknown reliance tag "${code}"`);
    }
  }
  for (const code of Object.keys(tags.tool ?? {})) {
    if (!knownTools.has(code)) {
      warnings.push(`hero "${hero}" has unknown tool tag "${code}"`);
    }
  }
}
