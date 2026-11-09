// =============================================================================
//  Engine parameters (ADR-039): every weight of the ranking in one place, with the
//  argument for its value. Modules read `P.<NAME>` at call time, so the sensitivity
//  report (scripts/params-report.ts) can move one parameter and re-rank.
//
//  kind:
//    game     - a fact of Dota 2 or of the data source, not a choice;
//    design   - a structural choice (a cap, a floor, a normalisation) whose exact value
//               matters less than its existence; the argument is the shape it gives;
//    derived  - computed from other choices (shown how);
//    expert   - judgement about the game, not measured. These are the ones to calibrate
//               first when the sensitivity report shows the ranking depends on them.
//  range: the interval the argument still supports. The report moves each parameter to
//  both ends and measures how much the top recommendations change.
//
//  Not here: the per-hero / per-item tag weights in taxonomy.yaml, items.yaml and
//  item_fit.yaml. They are knowledge-base data (reviewed per patch, PATCH_RUNBOOK B5/B6),
//  not engine parameters.
// =============================================================================

export type ParamKind = "game" | "design" | "derived" | "expert";

export interface ParamDoc {
  value: number;
  kind: ParamKind;
  /** where it acts. */
  area: "counter" | "two-sided" | "team" | "synergy" | "items" | "stat";
  /** the argument for the value. */
  why: string;
  /** values the argument still supports [low, high]. */
  range: [number, number];
}

export const PARAM_DOCS = {
  // ---- counter scoring ------------------------------------------------------
  ITEM_TOOL_SCALE: {
    value: 0.8,
    kind: "expert",
    area: "counter",
    why: "An item's tool counts less than the same tool in a hero's kit: the item takes a slot and gold, is often bought for another reason, and its cooldown competes with the hero's own. 0.8 keeps item routes clearly secondary without hiding them; below ~0.6 an enemy's Orchid would barely change the read, above 1 an item would outweigh a kit built around the tool.",
    range: [0.6, 1.0],
  },
  LANE_WEIGHT: {
    value: 1.25,
    kind: "expert",
    area: "counter",
    why: "Reasons against your lane opponents count 25% more: the first 10 minutes are spent against them, and a lost lane delays the core items every other reason assumes. Kept small because lanes swap and rotate; at 1.5+ the lane would dominate a five-hero draft.",
    range: [1.0, 1.5],
  },
  // ---- two-sided (ADR-020/022) ---------------------------------------------
  RESIST_WEIGHT: {
    value: 1.0,
    kind: "design",
    area: "two-sided",
    why: "Enduring an enemy's tool is weighted like answering it: both decide the same fight. 1.0 is the neutral choice that needs no extra justification; the per-enemy cap (RESIST_CAP) keeps it from stacking.",
    range: [0.7, 1.2],
  },
  RISK_WEIGHT: {
    value: 0.5,
    kind: "expert",
    area: "two-sided",
    why: "A risk (the enemy's tool hits what you rely on) is a reason to play carefully, not a veto: players itemise and position around it. Half the weight of an answer keeps offense the backbone (ADR-020); at 1.0 every hero with a long reliance list sinks.",
    range: [0.3, 0.8],
  },
  BLUNT_WEIGHT: {
    value: 0.6,
    kind: "expert",
    area: "two-sided",
    why: "Your tool blunted by an enemy resistance (magic damage into BKB / Pipe) loses part of its value, not all: the resistance has a cooldown or a cost. Slightly above RISK_WEIGHT because it removes a reason you were picked for, rather than adding a danger.",
    range: [0.4, 0.8],
  },
  RESIST_CAP: {
    value: 1.0,
    kind: "design",
    area: "two-sided",
    why: "Max resistance bonus per enemy: one enemy cannot be 'resisted' more than one full answer is worth, so a long resist list does not inflate a hero.",
    range: [0.7, 1.5],
  },
  RISK_CAP: {
    value: 0.8,
    kind: "design",
    area: "two-sided",
    why: "Max penalty per enemy, below RESIST_CAP so a single bad matchup cannot bury an otherwise good pick (net-negative picks are still dropped, ADR-022).",
    range: [0.5, 1.0],
  },
  // ---- composition (ADR-023) -----------------------------------------------
  TEAM_FULL_AT: {
    value: 3,
    kind: "design",
    area: "team",
    why: "Team-gap bonuses reach full size once 3 allies are known: with 1-2 picks most gaps are simply not drafted yet, and with 3 the missing roles are real. Scale = min(1, allies / 3).",
    range: [2, 4],
  },
  DAMAGE_MIX_WEIGHT: {
    value: 0.3,
    kind: "expert",
    area: "team",
    why: "Bonus for the other damage school when your team deals almost one school: a one-school team is countered by one item (Pipe / armour). Small - about a third of a single counter reason - because damage mix is one consideration among many.",
    range: [0.15, 0.5],
  },
  DAMAGE_MIX_MIN_SHARE: {
    value: 0.3,
    kind: "expert",
    area: "team",
    why: "The bonus starts when the minority school is under 30% of the team's damage: above that one item no longer shuts the team down.",
    range: [0.2, 0.4],
  },
  // ---- synergy --------------------------------------------------------------
  SYNERGY_WEIGHT: {
    value: 0.6,
    kind: "expert",
    area: "synergy",
    why: "A curated combo with an ally adds 0.6 - less than a typical counter reason (~1): the draft tool's job is answering the enemy; a combo should tip near-ties, not outrank a real counter.",
    range: [0.3, 1.0],
  },
  // ---- items for the hero you play (ADR-027b/c) -----------------------------
  SELF_TOOL: {
    value: 0.5,
    kind: "expert",
    area: "items",
    why: "The hero's own tool at weight >= 0.5 (a core part of the kit: Drow's Gust 0.6 silence) makes an item for the same tool largely redundant. Below 0.5 the kit's version is situational and the item still adds.",
    range: [0.4, 0.7],
  },
  SELF_TOOL_FLOOR: {
    value: 0.25,
    kind: "design",
    area: "items",
    why: "A redundant item keeps at least 25% of its value (x max(0.25, 1 - own weight)): a second source of the tool still covers the kit's cooldown.",
    range: [0.1, 0.4],
  },
  MID_CARRY_ATTACK: {
    value: 0.6,
    kind: "expert",
    area: "items",
    why: "A mid with attack_reliant >= 0.6 builds like a carry (Shadow Fiend, Templar), below like a caster: 0.6 is the tag weight the KB gives to heroes whose damage is mainly right-click.",
    range: [0.5, 0.7],
  },
  BUY_COMMON: {
    value: 0.05,
    kind: "expert",
    area: "items",
    why: "The hero finishes the item in >= 5% of games: a normal option for it (fit 1).",
    range: [0.03, 0.1],
  },
  BUY_RARE: {
    value: 0.01,
    kind: "expert",
    area: "items",
    why: "Under 1% of games the hero practically never builds it (fit BUY_FIT_NEVER); 1-5% is occasional (BUY_FIT_SOME).",
    range: [0.005, 0.02],
  },
  BUY_FIT_SOME: {
    value: 0.6,
    kind: "expert",
    area: "items",
    why: "An occasional item (1-5%) keeps 60%: there are builds that use it, but the draft has to call for it clearly. Must stay above PLAN_BUY_FIT_MIN (0.5), or every occasional item drops out of the plan unless its score is >= 3 - the sensitivity report showed a third of the plan vanishing at 0.4.",
    range: [0.5, 0.8],
  },
  BUY_FIT_NEVER: {
    value: 0.25,
    kind: "expert",
    area: "items",
    why: "An item the hero practically never builds keeps 25%: shown only when the draft calls for it strongly (score >= 3 survives the filter).",
    range: [0.1, 0.4],
  },
  PLAN_BUY_FIT_MIN: {
    value: 0.5,
    kind: "design",
    area: "items",
    why: "An answer enters the plan when its buy fit is at least 0.5 - i.e. a usual (1) or occasional (BUY_FIT_SOME) item; one the hero never builds (BUY_FIT_NEVER) needs PLAN_STRONG_SCORE. It is the line between the two lower fit levels, not a tuned number.",
    range: [0.3, 0.6],
  },
  PLAN_STRONG_SCORE: {
    value: 3,
    kind: "expert",
    area: "items",
    why: "An item the hero practically never builds still enters the plan at engine score >= 3: about three solid reasons against this draft, i.e. most of the enemy lineup calls for it.",
    range: [2, 4],
  },
  PLAN_ITEM_FIT_MIN: {
    value: 0.6,
    kind: "design",
    area: "items",
    why: "Items whose archetype fit (item_fit.yaml) is below 0.6 are not planned at all: in that table 0.6 marks 'possible for this archetype', lower values 'wrong archetype' (a support's Divine Rapier).",
    range: [0.5, 0.7],
  },
  ALLY_BUYS_SHARE: {
    value: 0.25,
    kind: "expert",
    area: "items",
    why: "A teammate 'usually builds' an answer when they finish it in >= 25% of their games: then agree who buys, rather than both.",
    range: [0.15, 0.4],
  },
  ALLY_BUYS_SCALE: {
    value: 0.5,
    kind: "expert",
    area: "items",
    why: "An answer a teammate usually builds is halved for you: still useful twice (two Force Staffs), but the second copy is worth less than the first.",
    range: [0.3, 0.7],
  },
  // ---- stat layer (ADR-035) -------------------------------------------------
  WINRATE_CAP: {
    value: 0.06,
    kind: "design",
    area: "stat",
    why: "The stat layer moves a score by at most ±6%: enough to reorder near-ties, never enough to lift a hero without a mechanism over one with it (KB first, ADR-004). In practice the cap rarely binds: matchup gaps are mostly within ±2 pp, i.e. a factor within ±2.4%.",
    range: [0.03, 0.1],
  },
  WINRATE_TILT: {
    value: 1.2,
    kind: "derived",
    area: "stat",
    why: "Set so a +5 pp matchup gap at full confidence reaches the cap: 1 + 1.2 x 0.05 = 1.06. +5 pp is a large, well-known counter in public data; observed gaps are mostly within ±2 pp (ADR-035).",
    range: [0.8, 2.0],
  },
  WINRATE_FULL_CONF: {
    value: 150,
    kind: "derived",
    area: "stat",
    why: "Games for full confidence: with 150 games the standard error of a ~50% win rate is ~4 pp, the size of the effect being measured; fewer games scale the tilt down linearly. Public matchup samples are mostly in the thousands, so in practice confidence is 1 and the value rarely matters.",
    range: [100, 400],
  },
} satisfies Record<string, ParamDoc>;

export type ParamName = keyof typeof PARAM_DOCS;

/** live values; the sensitivity report changes them, nothing else should. */
export const P: Record<ParamName, number> = Object.fromEntries(Object.entries(PARAM_DOCS).map(([k, d]) => [k, d.value])) as Record<ParamName, number>;

/** reset every value to the documented one (after a sensitivity run). */
export function resetParams(): void {
  for (const [k, d] of Object.entries(PARAM_DOCS)) P[k as ParamName] = d.value;
}
