// =============================================================================
//  Data structures for the counter-pick rule-engine.
//
//  Two groups live here:
//    1. KB types     - the parsed shape of taxonomy.yaml (ADR-006 source of truth)
//                      plus the curated item catalog (data/items.yaml) and the
//                      optional hero->hero enrichment layer (data/hero_edges.yaml).
//    2. Engine I/O   - the DraftState input and ranked-recommendation output that
//                      realise the ADR-012 contract.
//
//  Everything is KB-only (ADR-004): no winrate / stat fields appear. Phase-2 slots
//  (matchups, hero_stats, advantage) are intentionally absent so the engine cannot
//  accidentally depend on them.
// =============================================================================

// ---------------------------------------------------------------------------
//  1. KB TYPES  (mirror of taxonomy.yaml)
// ---------------------------------------------------------------------------

/** target-side axis: what an enemy relies on / is vulnerable through. */
export interface Reliance {
  code: string;
  label: string;
  hook: string;
  /** tool codes that canonically answer this reliance (documentation cross-ref). */
  answered_by: string[];
}

export type ToolClass = "mechanical" | "strategic";

/** subject-side axis: what we hit the enemy WITH (a hero ability or an item). */
export interface Tool {
  code: string;
  /** mechanical = resolvable by a concrete item/skill; strategic = draft property. */
  class: ToolClass;
  label: string;
  /** free-text hints at hero/item sources; advisory only, not parsed for logic. */
  sources_hint?: string[];
}

/** a documented trap where naive tag->tag inference misinforms (ADR-010). */
export interface SpecialCase {
  id: string;
  trap: string;
  encoding: string;
  affected_heroes?: string[];
  note?: string;
}

/**
 * Conditions guarding an edge. All fields optional; an absent field is a no-op.
 *  - exclude_target_tag : suppress the match if the enemy carries this reliance tag.
 *  - unless_target_tag  : suppress the match if the enemy carries this tag (the BKB
 *                         flag), UNLESS the subject supplies `or_tool_tag` (ADR-009).
 *  - or_tool_tag        : escape hatch for `unless_target_tag` - a subject tool tag
 *                         that re-enables the match (e.g. bkb_piercing_disable).
 *  - min_targets        : team-level gate - the edge only fires if at least N enemies
 *                         carry the target reliance (census-driven; ADR-012 §1).
 */
export interface Conditions {
  exclude_target_tag?: string;
  unless_target_tag?: string;
  or_tool_tag?: string;
  min_targets?: number;
}

/** canonical tool->reliance rule: the base of the rule system (ADR-007). */
export interface Edge {
  tool: string;
  target: string;
  mechanism: string;
  weight: number;
  conditions?: Conditions;
}

/** membership row: which reliance/tool tags a hero carries, with weights. */
export interface HeroTags {
  pos: number[];
  reliance: Record<string, number>;
  tool: Record<string, number>;
}

/** taxonomy.yaml top-level shape (only the parts the engine consumes). */
export interface Taxonomy {
  meta?: Record<string, unknown>;
  reliance: Reliance[];
  tool: Tool[];
  special_cases: SpecialCase[];
  edges: Edge[];
  hero_tags: Record<string, HeroTags>;
}

// ---------------------------------------------------------------------------
//  Item catalog (data/items.yaml) - curated KB, derived from tool.sources_hint.
//  An item is just another subject that carries tool tags (ADR-007 "the same
//  edge where the subject is an item"). KB-only by definition: item-vs-hero
//  winrate does not exist (ADR-011), so items never get a stat layer.
// ---------------------------------------------------------------------------
export interface ItemDef {
  code: string;
  label: string;
  /** tool code -> weight, same semantics as hero_tags.tool. */
  tool: Record<string, number>;
  /** marks an entry whose source mapping was uncertain ("(?)" in sources_hint). */
  tentative?: boolean;
}

// ---------------------------------------------------------------------------
//  Hero->hero enrichment (data/hero_edges.yaml) - point overrides ON TOP of the
//  tag->tag basis (ADR-007, ADR-012 §3). Used for specific matchups that the tag
//  vocabulary cannot express at the right granularity.
// ---------------------------------------------------------------------------
export interface HeroEdge {
  /** candidate hero code (the pick we might recommend). */
  subject: string;
  /** enemy hero code this enrichment targets. */
  target: string;
  mechanism: string;
  weight: number;
  conditions?: Conditions;
  /** provenance: hand-curated (default) or scraped from the wiki. */
  source?: "curated" | "wiki";
}

/** Item->hero point counter (the mirror of HeroEdge, subject is an item). */
export interface ItemEdge {
  item: string;
  label: string;
  /** enemy hero code this item counters. */
  target: string;
  mechanism: string;
  weight: number;
  source?: "curated" | "wiki";
}

/** A synergy duo (orthogonal to the counter engine). */
export interface Combo {
  /** the two hero codes (roster codes; need not be in hero_tags). */
  pair: [string, string];
  /** lane pairing label, e.g. "1+5", "3+4", or "synergy" for scraped pairs. */
  lane: string;
  mechanism: string;
  source?: "curated" | "wiki";
  /** strength signal: how many of the two hero pages mention the pair (1 = one-way,
   *  2 = mutual). Used to order strongest synergies first. */
  strength?: number;
}

// ---------------------------------------------------------------------------
//  Item fit (data/item_fit.yaml, ADR-018): does an item belong in YOUR hero's build?
// ---------------------------------------------------------------------------
export type Archetype = "carry" | "caster" | "offlane" | "support";
export const ARCHETYPES: readonly Archetype[] = ["carry", "caster", "offlane", "support"];
export type AttackType = "melee" | "ranged";

export interface ItemFitTable {
  /** multiplier cap for an attack-type-restricted item on the other attack type. */
  wrongAttack: number;
  /** hero code -> archetype, for heroes the position heuristic gets wrong. */
  override: Record<string, Archetype>;
  /** duplicate item ids (wiki slugs) -> catalog id. */
  alias: Record<string, string>;
  /** item id -> multiplier per archetype, in ARCHETYPES order. */
  fit: Record<string, [number, number, number, number]>;
  meleeOnly: string[];
  rangedOnly: string[];
  /** items no longer buyable (removed / turned neutral): never recommended. */
  unavailable: string[];
}

/** magic vs physical read of the enemy team (ADR-012 damage weighting). */
export type DamageSchool = "physical" | "magic" | "neutral";
export interface DamageRead {
  /** how soft the enemy is to each school (sum of vulnerability tag weights). */
  physicalVuln: number;
  magicVuln: number;
  /** which damage to bring against them. */
  offenseLean: "physical" | "magic" | "mixed";
  /** how much physical / magic damage the enemy team threatens (tool census). */
  physThreat: number;
  magicThreat: number;
  /** what to defend against. */
  defenseLean: "physical" | "magic" | "mixed";
}

// ---------------------------------------------------------------------------
//  Defensive layer (data/defense.yaml) - the mirror of the offensive edges:
//  an enemy TOOL (threat) -> a defensive item you build to neutralise it.
//  Resolved against the enemy team's tool census, not its reliance tags.
// ---------------------------------------------------------------------------
export interface DefenseEdge {
  /** enemy tool tag that creates the threat (must exist in taxonomy.tool). Use this
   *  for specific disables (silence, lockdown, …). Mutually exclusive with `school`. */
  threat?: string;
  /** OR: gate on the enemy team's overall damage school (physical = right-clickers
   *  via attack_reliant; magic = casters via spell_reliant) instead of one tool. */
  school?: "physical" | "magic";
  /** defensive item id (own namespace; need not appear in items.yaml). */
  item: string;
  label: string;
  mechanism: string;
  weight: number;
  /** only recommend if at least N enemies carry the threat / deal that school. */
  min_threat?: number;
}

// ---------------------------------------------------------------------------
//  2. ENGINE I/O  (ADR-012 contract)
// ---------------------------------------------------------------------------

/** Decoupled draft state (ADR-002): the engine receives this and asks no source. */
export interface DraftState {
  /** enemy hero codes (keys of hero_tags). */
  enemyHeroes: string[];
  /** position we are drafting for (1/2/3 cores; 4/5 tolerated, see ADR-011). */
  myRole?: number;
  /** if already locked, the engine skips hero recs and focuses on items. */
  myHero?: string;
  /** allied picks, reserved for future synergy scoring; unused in MVP. */
  allyHeroes?: string[];
}

export type CandidateKind = "hero" | "item";

/** One concrete reason a candidate counters the enemy team - the explainability unit. */
export interface Reason {
  /** the other hero this reason relates to: an enemy (counter/defense) or, for a
   *  synergy reason, the allied partner. */
  enemy: string;
  /** how it applies: counter (edge/enrichment/defense) or synergy with an ally. */
  basis: "edge" | "hero_edge" | "item_edge" | "defense" | "synergy";
  /** tool tag used: subject's tool (edge) or the enemy's threat tool (defense). */
  tool?: string;
  /** target-side reliance tag hit (edge basis only). */
  reliance?: string;
  /** the human-readable mechanism string (the heart of ADR-012 §4). */
  mechanism: string;
  /** score this reason contributed. */
  contribution: number;
  /** transparent factor breakdown for the contribution. */
  factors: {
    toolWeight?: number;
    edgeWeight?: number;
    relianceWeight?: number;
    /** defense basis: the enemy's tool weight and the defensive item's weight. */
    threatWeight?: number;
    defenseWeight?: number;
  };
  /** any guard notes (e.g. "BKB-pierced via bkb_piercing_disable"). */
  notes?: string[];
  /** provenance for enrichment reasons (e.g. "wiki" for scraped counters). */
  source?: "curated" | "wiki";
}

/** A ranked candidate with its full explanation set. */
export interface Recommendation {
  kind: CandidateKind;
  code: string;
  label: string;
  /** positions, for hero candidates. */
  pos?: number[];
  /** aggregate score (sum of reason contributions). */
  score: number;
  /** distinct enemy codes this candidate answers. */
  coverage: string[];
  /** distinct allied codes this candidate synergises with (when allies are picked). */
  synergyWith?: string[];
  /** dominant damage school of this candidate's counter route (if any). */
  school?: DamageSchool;
  /** stat layer (Phase 2, ADR-005): games-weighted win rate (0..1) vs the enemy
   *  team from public matches, present only when matchup data is loaded. Additive
   *  info - it does NOT drive the KB rank. */
  winrate?: number;
  /** total games behind `winrate` (sample size for confidence). */
  winrateGames?: number;
  /** per-enemy win rate breakdown. */
  matchups?: Array<{ enemy: string; wr: number; n: number }>;
  /** item recs only: how well the item suits YOUR hero (score already multiplied). */
  fit?: { archetype: Archetype; attack?: AttackType; mult: number };
  reasons: Reason[];
}

export interface EngineResult {
  /** ranked hero picks (empty when myHero is locked). */
  heroes: Recommendation[];
  /** ranked offensive item builds (subjects that hit enemy reliances). */
  items: Recommendation[];
  /** ranked defensive items (block the enemy team's threat tools). */
  defense: Recommendation[];
  /** curated synergy combos (static; highlighted when a member is a top pick). */
  combos: Combo[];
  /** magic vs physical read of the enemy team. */
  damage: DamageRead;
  /** honest gaps: enemies for which no known counter was found (ADR-004 mitigation). */
  uncovered: string[];
  /** echo of the resolved input for traceability. */
  input: DraftState;
}
