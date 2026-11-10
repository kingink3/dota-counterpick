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
  /** the weight of this rule for HERO PICKS, when the measured hero matchups say it
   *  differs from the mechanics (KB_VALIDATION.md, ADR-062). Counter items keep `weight`:
   *  the evidence is about heroes carrying the tool, not about an item that grants it. */
  pick_weight?: number;
  conditions?: Conditions;
}

/** membership row: which reliance/tool tags a hero carries, with weights. */
export interface HeroTags {
  pos: number[];
  reliance: Record<string, number>;
  tool: Record<string, number>;
  /** what this hero ENDURES (third axis, ADR-020): resistance code -> weight. */
  resist?: Record<string, number>;
}

/** a hero property that blunts an enemy TOOL (Mana Shield vs health-based damage). */
export interface Resistance {
  code: string;
  label: string;
  hook: string;
  /** attacker tools that bypass this resistance (mana burn vs Mana Shield,
   *  break vs passives, piercing disables vs own debuff immunity). */
  pierced_by?: string[];
}

/** resistance -> enemy threat it blunts (the mirror of an Edge, ADR-020).
 *  Exactly one of `tool` (enemy tool tag) or `reliance` (enemy damage source). */
export interface ResistEdge {
  resistance: string;
  tool?: string;
  reliance?: string;
  mechanism: string;
  weight: number;
}

/** taxonomy.yaml top-level shape (only the parts the engine consumes). */
export interface Taxonomy {
  meta?: Record<string, unknown>;
  reliance: Reliance[];
  tool: Tool[];
  special_cases: SpecialCase[];
  edges: Edge[];
  hero_tags: Record<string, HeroTags>;
  resistance?: Resistance[];
  resist_edges?: ResistEdge[];
  team_needs?: TeamNeed[];
}

/** A capability a team should have (ADR-023): which tools provide it and how much
 *  of it a five-hero lineup wants before more stops mattering. */
export interface TeamNeed {
  code: string;
  label: string;
  /** tool code -> how much one point of that tool counts toward the need. */
  tools: Record<string, number>;
  /** coverage at which the need is met (sum over allies of tool weight x factor). */
  want: number;
  /** max score bonus for a candidate that fills the gap completely. */
  weight: number;
}

/** What the allied lineup already covers (ADR-023), echoed for the UI. */
export interface TeamRead {
  needs: Array<{ code: string; label: string; have: number; want: number }>;
  /** shares (0..1) of the damage the allies deal over the game, by school (ADR-059). */
  physical: number;
  magic: number;
  pure: number;
  /** enemies assumed to face you in lane (needs myRole); by main position. */
  laneOpponents?: string[];
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
/** a school of dealt damage (ADR-059). */
export type DealtSchool = "physical" | "magic" | "pure";
/** game phases of the plan (Game tab): lane 0-10, mid 10-25, late 25+. */
export type DamagePhaseId = "lane" | "mid" | "late";
/** what a team deals in one phase (ADR-059): shares by school and who deals it. */
export interface DamagePhase {
  id: DamagePhaseId;
  /** shares of the team's damage in this phase, summing to 1. */
  physical: number;
  magic: number;
  pure: number;
  /** the heroes dealing it, biggest first: share of the team's damage in this phase
   *  and the school most of theirs is. */
  by: Array<{ hero: string; share: number; school: DealtSchool }>;
}
export interface DamageRead {
  /** how soft the enemy is to each school (sum of vulnerability tag weights). */
  physicalVuln: number;
  magicVuln: number;
  /** which damage to bring against them. */
  offenseLean: "physical" | "magic" | "mixed";
  /** shares (0..1) of the damage the enemy team deals over a 40-minute game, by school
   *  (ADR-059: per-hero school shares x damage per minute by position and phase). */
  physThreat: number;
  magicThreat: number;
  pureThreat: number;
  /** the same by phase: who deals it changes as the carry comes online. */
  phases: DamagePhase[];
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
  /** OR: the damage school the enemy deals (ADR-059: data/hero_damage.yaml x damage
   *  per minute) instead of one tool. An enemy counts by its part of that school. */
  school?: "physical" | "magic";
  /** defensive item id (own namespace; need not appear in items.yaml). */
  item: string;
  label: string;
  mechanism: string;
  weight: number;
  /** only recommend if at least N enemies carry the threat / deal that school. */
  min_threat?: number;
  /** enemies this item does NOT answer despite matching the threat (Ghost Scepter
   *  vs Muerta's Pierce the Veil, which hits ethereal targets) - ADR-022. */
  except?: string[];
  /** enemy tool that goes through this item (BKB vs bkb_piercing_disable): the more of
   *  it their lineup has, the less the item is worth (ADR-059, P.PIERCE_DISCOUNT). */
  pierced_by?: string;
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
  /** allied picks: synergy (combos) and composition (ADR-023). */
  allyHeroes?: string[];
  /** items seen on enemy heroes (Tab scoreboard / manual), our item ids (ADR-024). */
  enemyItems?: Record<string, string[]>;
}

/** What holding an item adds to an enemy hero's tags (data/item_traits.yaml, ADR-024). */
export interface ItemTrait {
  label: string;
  reliance?: Record<string, number>;
  resist?: Record<string, number>;
  tool?: Record<string, number>;
}

export type CandidateKind = "hero" | "item";

/** One concrete reason a candidate counters the enemy team - the explainability unit. */
export interface Reason {
  /** the other hero this reason relates to: an enemy (counter/defense) or, for a
   *  synergy reason, the allied partner. */
  enemy: string;
  /** how it applies: counter (edge/enrichment/defense) or synergy with an ally. */
  /** resist = the candidate endures this enemy's tool; risk = the enemy's tool hits a
   *  reliance of the candidate (negative contribution). ADR-020. */
  basis: "edge" | "hero_edge" | "item_edge" | "defense" | "synergy" | "resist" | "risk" | "team";
  /** team basis: the team need this candidate fills (enemy holds the need code). */
  need?: string;
  /** resist basis: the candidate's resistance code. */
  resistance?: string;
  /** tool tag used: subject's tool (edge) or the enemy's threat tool (defense). */
  tool?: string;
  /** target-side reliance tag hit (edge basis only). */
  reliance?: string;
  /** the human-readable mechanism string (the heart of ADR-012 §4). */
  mechanism: string;
  /** an item reason for a tool the hero you play already has (scaled down, ADR-027c). */
  selfHas?: boolean;
  /** the resistance the item grants that the hero already has (BKB / Blade Fury). */
  selfGrant?: string;
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
    /** resist basis: how central the resistance is to the candidate. */
    resistWeight?: number;
    /** resist/risk basis: weight of the ENEMY's tool, reliance or resistance. */
    enemyWeight?: number;
    /** hero picks (ADR-059): weight of the target by its position (1 = their carry). */
    targetWeight?: number;
    /** hero picks (ADR-059): 2nd, 3rd ... reason against the same enemy counts less. */
    stackWeight?: number;
  };
  /** any guard notes (e.g. "BKB-pierced via bkb_piercing_disable"). */
  notes?: string[];
  /** enemy items that created this match (ADR-024), display labels. */
  via?: string[];
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
  /** enemies whose tools hit a reliance of this candidate (risk reasons). */
  risks?: string[];
  /** dominant damage school of this candidate's counter route (if any). */
  school?: DamageSchool;
  /** stat layer (Phase 2, ADR-005): games-weighted win rate (0..1) vs the enemy
   *  team from public matches, present only when matchup data is loaded. Shown as
   *  is; the rank uses the matchup gap in `stat` instead (ADR-035). */
  winrate?: number;
  /** total games behind `winrate` (sample size for confidence). */
  winrateGames?: number;
  /** per-enemy win rate breakdown; `expected` = from both heroes' base win rates. */
  matchups?: Array<{ enemy: string; wr: number; n: number; expected?: number }>;
  /** hero picks (ADR-061): the score as an estimated win-rate edge against this draft, in
   *  percentage points. Per enemy: kb = KB score against it, baseline = what this hero
   *  scores against an average hero of that position, gap = measured win rate of the pair
   *  minus the rate expected from both base rates (pp, over `games`), dataWeight = how
   *  much the measurement outweighs the mechanics (games / (games + STAT_PRIOR_GAMES)),
   *  edge = the blend. team = what the pick adds to the allied lineup. total = before
   *  the role-fit factor. */
  edge?: {
    total: number;
    team: number;
    byEnemy: Array<{ enemy: string; kb: number; baseline: number; gap?: number; games?: number; dataWeight: number; edge: number }>;
  };
  /** hero picks with a role (ADR-060): how usual the hero is on that position - its share
   *  of the hero's games there, relative to its most played position - and the factor
   *  already applied to the score (1 = its main role). */
  roleFit?: { pos: number; share?: number; rel: number; factor: number };
  /** item recs only: how well the item suits YOUR hero (score already multiplied). */
  fit?: { archetype: Archetype; attack?: AttackType; mult: number };
  /** the hero you play buys it in this share of games (< 5%): shown and scored lower. */
  rareOnHero?: number;
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
  /** what your own lineup covers (ADR-023); present when allies are known. */
  team?: TeamRead;
  /** honest gaps: enemies for which no known counter was found (ADR-004 mitigation). */
  uncovered: string[];
  /** echo of the resolved input for traceability. */
  input: DraftState;
}
