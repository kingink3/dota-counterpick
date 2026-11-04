// =============================================================================
//  Resolver - the rule engine core (ADR-012 §1-§4).
//
//  For each candidate subject (hero OR item) it produces a scored Recommendation
//  whose every point of score is backed by a Reason carrying a mechanism string:
//
//    edge basis      subject.tool[T] × edge(T→R).weight × enemy.reliance[R]
//                    guarded by conditions (BKB-guards, traps, census min_targets)
//    hero_edge basis hero_edge.weight                      (point enrichment)
//
//  Nothing scores without an explanation - that asymmetry IS the product (ADR-012 §4).
// =============================================================================

import { buildCensus, type Census } from "./census.js";
import { evaluateConditions } from "./conditions.js";
import { TOOL_SCHOOL, type KnowledgeBase } from "./knowledge.js";
import { ARCHETYPES } from "./types.js";
import type {
  Archetype,
  AttackType,
  DamageRead,
  DamageSchool,
  DraftState,
  EngineResult,
  HeroTags,
  Reason,
  Recommendation,
  TeamRead,
} from "./types.js";

interface Subject {
  kind: "hero" | "item";
  code: string;
  label: string;
  pos?: number[];
  /** tool code -> weight. */
  toolTable: Record<string, number>;
  /** heroes only (ADR-020): what the candidate endures / what it depends on. */
  resist?: Record<string, number>;
  tags?: HeroTags;
}

export function resolve(kb: KnowledgeBase, draft: DraftState): EngineResult {
  const census = buildCensus(kb, draft.enemyHeroes, draft.enemyItems);
  const allies = new Set(draft.allyHeroes ?? []);
  const synergy = buildSynergyIndex(kb, allies);

  const team = readTeam(kb, draft);
  const heroLocked = Boolean(draft.myHero);
  const heroes = heroLocked
    ? []
    : rankSubjects(heroCandidates(kb, draft, census, allies), kb, census, synergy, team);
  // item builds tailored to the hero you play: a counter item that does not belong in
  // that hero's build (Eul's on a carry Sniper) sinks instead of topping the list.
  const fit = itemFitFor(kb, draft);
  const items = rankItems(kb, census, fit);
  const defense = resolveDefense(kb, census, fit);
  const damage = readDamage(census);

  // Honest gap reporting (ADR-004): which enemies did nothing answer - offensively
  // OR defensively? (a pure threat we can itemise against is not a blind spot.)
  const answered = new Set<string>();
  for (const rec of [...heroes, ...items, ...defense]) {
    for (const e of rec.coverage) answered.add(e);
  }
  // an enemy (tagged OR untagged) is a gap only if nothing - including the wiki
  // layer - answered it.
  const uncovered = census.allSelected.filter((e) => !answered.has(e));

  return {
    heroes,
    items,
    defense,
    combos: kb.combos,
    damage,
    ...(team.read ? { team: team.read } : {}),
    uncovered,
    input: draft,
  };
}

// ---------------------------------------------------------------------------
//  Composition (ADR-023): what YOUR lineup still lacks, and who you face in lane
// ---------------------------------------------------------------------------

/** gap bonuses are scaled by how much of the allied draft is known. */
const TEAM_FULL_AT = 3;
/** damage-mix bonus: max bonus when your team deals (almost) only one school. */
const DAMAGE_MIX_WEIGHT = 0.3;
const DAMAGE_MIX_MIN_SHARE = 0.3;
/** reasons against the enemies you lane against count a little more. */
const LANE_WEIGHT = 1.25;

interface TeamContext {
  read?: TeamRead;
  /** need code -> { have, want, weight, tools } for gap bonuses. */
  gaps: Array<{ code: string; label: string; have: number; want: number; weight: number; tools: Record<string, number> }>;
  scale: number;
  physical: number;
  magic: number;
  allies: number;
  lane: Set<string>;
}

function readTeam(kb: KnowledgeBase, draft: DraftState): TeamContext {
  const tagsOf = (c: string) => kb.taxonomy.hero_tags[c];
  const allyCodes = [...new Set([...(draft.allyHeroes ?? []), ...(draft.myHero ? [draft.myHero] : [])])].filter((c) => tagsOf(c));
  const gaps: TeamContext["gaps"] = [];
  const needsRead: TeamRead["needs"] = [];
  for (const n of kb.taxonomy.team_needs ?? []) {
    let have = 0;
    for (const a of allyCodes) have += capability(tagsOf(a)!.tool ?? {}, n.tools);
    have = round(have);
    needsRead.push({ code: n.code, label: n.label, have, want: n.want });
    gaps.push({ code: n.code, label: n.label, have, want: n.want, weight: n.weight, tools: n.tools });
  }
  let physical = 0;
  let magic = 0;
  for (const a of allyCodes) {
    physical += schoolDamage(tagsOf(a)!, "physical");
    magic += schoolDamage(tagsOf(a)!, "magic");
  }
  const lane = laneOpponents(kb, draft);
  const read: TeamRead | undefined =
    allyCodes.length || lane.size
      ? {
          needs: allyCodes.length ? needsRead : [],
          physical: round(physical),
          magic: round(magic),
          ...(lane.size ? { laneOpponents: [...lane] } : {}),
        }
      : undefined;
  return {
    ...(read ? { read } : {}),
    gaps,
    scale: Math.min(1, allyCodes.length / TEAM_FULL_AT),
    physical,
    magic,
    allies: allyCodes.length,
    lane,
  };
}

function capability(tools: Record<string, number>, factors: Record<string, number>): number {
  let c = 0;
  for (const [t, f] of Object.entries(factors)) c += (tools[t] ?? 0) * f;
  return c;
}

/** Enemies you face in lane: each enemy gets a distinct position (cheapest by its
 *  position list, index 0 = main role), then your role picks the opposing lane. */
const LANE_OPPOSITION: Record<number, number[]> = { 1: [3, 4], 5: [3, 4], 2: [2], 3: [1, 5], 4: [1, 5] };
function laneOpponents(kb: KnowledgeBase, draft: DraftState): Set<string> {
  const out = new Set<string>();
  if (draft.myRole === undefined) return out;
  const enemies = draft.enemyHeroes.filter((e) => kb.taxonomy.hero_tags[e]);
  if (!enemies.length) return out;
  const cost = (e: string, p: number) => {
    const i = kb.taxonomy.hero_tags[e]!.pos.indexOf(p);
    return i < 0 ? 4 : i;
  };
  let best: { cost: number; pos: number[] } | undefined;
  const walk = (i: number, used: number[], acc: number) => {
    if (best && acc >= best.cost) return;
    if (i === enemies.length) {
      best = { cost: acc, pos: [...used] };
      return;
    }
    for (let p = 1; p <= 5; p++) {
      if (used.includes(p)) continue;
      used.push(p);
      walk(i + 1, used, acc + cost(enemies[i]!, p));
      used.pop();
    }
  };
  walk(0, [], 0);
  const opp = LANE_OPPOSITION[draft.myRole] ?? [];
  enemies.forEach((e, i) => {
    if (opp.includes(best!.pos[i]!)) out.add(e);
  });
  return out;
}

/** gap + damage-mix bonuses for one hero candidate (basis "team"). */
function teamReasons(team: TeamContext, tags: HeroTags | undefined): Reason[] {
  if (!tags || team.allies === 0) return [];
  const out: Reason[] = [];
  for (const g of team.gaps) {
    const missing = g.want - g.have;
    if (missing <= 0) continue;
    const c = capability(tags.tool ?? {}, g.tools);
    if (c <= 0) continue;
    const deficit = missing / g.want;
    const fill = Math.min(1, c / missing);
    out.push({
      enemy: g.code,
      basis: "team",
      need: g.code,
      mechanism: `your team has ${round(g.have)}/${g.want} ${g.label.toLowerCase()} - this pick adds ${round(c)}`,
      contribution: g.weight * team.scale * deficit * fill,
      factors: { edgeWeight: g.weight, toolWeight: round(c) },
    });
  }
  // damage mix: a lineup dealing (almost) one school is easy to itemise against
  const total = team.physical + team.magic;
  if (team.allies >= 2 && total > 0) {
    for (const school of ["magic", "physical"] as const) {
      const share = (school === "magic" ? team.magic : team.physical) / total;
      if (share >= DAMAGE_MIX_MIN_SHARE) continue;
      const c = schoolDamage(tags, school);
      if (c <= 0) continue;
      const other = school === "magic" ? "physical" : "magic";
      out.push({
        enemy: "damage_mix",
        basis: "team",
        need: "damage_mix",
        mechanism: `your team deals ${Math.round((1 - share) * 100)}% ${other} damage - one armor or magic-resistance item answers all of it; this pick adds ${school}`,
        contribution: DAMAGE_MIX_WEIGHT * team.scale * ((DAMAGE_MIX_MIN_SHARE - share) / DAMAGE_MIX_MIN_SHARE) * Math.min(1, c),
        factors: { edgeWeight: DAMAGE_MIX_WEIGHT, toolWeight: round(c) },
      });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
//  Candidate pools
// ---------------------------------------------------------------------------

/** synergy index: candidate code -> ally partners it combos with (+ mechanism). */
type SynergyIndex = Map<string, Array<{ partner: string; mechanism: string }>>;

function buildSynergyIndex(kb: KnowledgeBase, allies: Set<string>): SynergyIndex {
  const index: SynergyIndex = new Map();
  if (allies.size === 0) return index;
  for (const c of kb.combos) {
    const [a, b] = c.pair;
    let cand: string | undefined;
    let partner: string | undefined;
    if (allies.has(a) && !allies.has(b)) [cand, partner] = [b, a];
    else if (allies.has(b) && !allies.has(a)) [cand, partner] = [a, b];
    else continue;
    const arr = index.get(cand) ?? [];
    if (!arr.some((x) => x.partner === partner)) arr.push({ partner, mechanism: c.mechanism });
    index.set(cand, arr);
  }
  return index;
}

function heroCandidates(
  kb: KnowledgeBase,
  draft: DraftState,
  census: Census,
  allies: Set<string>,
): Subject[] {
  const enemySet = new Set(census.enemies);
  const subjects: Subject[] = [];
  for (const [code, tags] of Object.entries(kb.taxonomy.hero_tags)) {
    if (enemySet.has(code)) continue; // can't pick an enemy
    if (allies.has(code)) continue; // already on your team
    if (draft.myHero && code === draft.myHero) continue;
    if (draft.myRole !== undefined && !tags.pos.includes(draft.myRole)) continue;
    subjects.push({
      kind: "hero",
      code,
      label: prettifyHero(code),
      pos: tags.pos,
      toolTable: tags.tool ?? {},
      resist: tags.resist ?? {},
      tags,
    });
  }
  return subjects;
}

function itemCandidates(kb: KnowledgeBase): Subject[] {
  return kb.items.map((item) => ({
    kind: "item" as const,
    code: item.code,
    label: item.label,
    toolTable: item.tool,
  }));
}

/** How well an item suits the hero you play (data/item_fit.yaml, ADR-018). */
interface ItemFit {
  mult(code: string): number;
  info?: { archetype: Archetype; attack?: AttackType };
}

/** Archetype of the hero you play: your selected position wins, else the hero's
 *  first listed position (2 splits into right-click mid vs caster), with curated
 *  overrides for the heroes the heuristic gets wrong. */
export function archetypeOf(kb: KnowledgeBase, myHero?: string, myRole?: number): Archetype | undefined {
  const tags = myHero ? kb.taxonomy.hero_tags[myHero] : undefined;
  const override = myHero ? kb.itemFit?.override[myHero] : undefined;
  const pos = myRole ?? tags?.pos[0];
  if (pos === 4 || pos === 5) return "support";
  if (override) return override;
  if (pos === 1) return "carry";
  if (pos === 3) return "offlane";
  if (pos === 2) {
    if (!tags) return undefined; // a mid we know nothing about: don't guess
    return (tags.reliance.attack_reliant ?? 0) >= 0.6 ? "carry" : "caster";
  }
  return undefined;
}

function itemFitFor(kb: KnowledgeBase, draft: DraftState): ItemFit {
  const table = kb.itemFit;
  const archetype = archetypeOf(kb, draft.myHero, draft.myRole);
  if (!table || !archetype) return { mult: () => 1 };
  const attack = draft.myHero ? kb.heroAttack?.[draft.myHero] : undefined;
  const col = ARCHETYPES.indexOf(archetype);
  const meleeOnly = new Set(table.meleeOnly);
  const rangedOnly = new Set(table.rangedOnly);
  return {
    info: { archetype, ...(attack ? { attack } : {}) },
    mult: (code) => {
      let m = table.fit[code]?.[col] ?? 1;
      if (attack === "ranged" && meleeOnly.has(code)) m = Math.min(m, table.wrongAttack);
      if (attack === "melee" && rangedOnly.has(code)) m = Math.min(m, table.wrongAttack);
      return m;
    },
  };
}

/** finalize an item rec with its fit multiplier applied (and recorded for the UI). */
function finalizeItem(code: string, label: string, reasons: Reason[], fit: ItemFit): Recommendation {
  const m = fit.mult(code);
  const rec = finalizeRec("item", code, label, undefined, scaleReasons(reasons, m));
  if (fit.info) rec.fit = { ...fit.info, mult: m };
  return rec;
}

function scaleReasons(reasons: Reason[], m: number): Reason[] {
  return m === 1 ? reasons : reasons.map((r) => ({ ...r, contribution: r.contribution * m }));
}

/** How much damage of a given school a single hero deals (right-clickers = physical
 *  via attack_reliant; casters = magic via spell_reliant; burst tools add on top). */
function schoolDamage(tags: HeroTags, school: "physical" | "magic"): number {
  const rel = tags.reliance ?? {};
  const tool = tags.tool ?? {};
  return school === "physical"
    ? (rel.attack_reliant ?? 0) + (tool.physical_burst ?? 0)
    : (rel.spell_reliant ?? 0) + (tool.magic_burst ?? 0);
}

// ---------------------------------------------------------------------------
//  Defensive layer: enemy threat tools -> defensive items (mirror of edges)
// ---------------------------------------------------------------------------

function resolveDefense(
  kb: KnowledgeBase,
  census: Census,
  fit: ItemFit,
): Recommendation[] {
  const byItem = new Map<string, { label: string; reasons: Reason[] }>();

  for (const d of kb.defenseEdges) {
    // per-enemy threat magnitude: a specific tool, or the broad damage school.
    const threatOf = (enemy: string): number => {
      if (d.except?.includes(enemy)) return 0;
      const tags = census.tagsOf(enemy)!;
      if (d.school) return schoolDamage(tags, d.school);
      return tags.tool?.[d.threat!] ?? 0;
    };
    // census gate: how many enemies carry the threat / deal that school.
    if (d.min_threat !== undefined) {
      const carriers = census.enemies.filter((e) => threatOf(e) > 0).length;
      if (carriers < d.min_threat) continue;
    }
    const label = d.school ? `${d.school} damage` : d.threat;
    for (const enemy of census.enemies) {
      const threatWeight = threatOf(enemy);
      if (threatWeight <= 0) continue;

      const entry = byItem.get(d.item) ?? { label: d.label, reasons: [] };
      entry.reasons.push({
        enemy,
        basis: "defense",
        tool: label,
        mechanism: d.mechanism,
        contribution: threatWeight * d.weight,
        factors: { threatWeight, defenseWeight: d.weight },
        ...viaField(d.threat ? census.viaOf(enemy, "tool", d.threat) : undefined),
      });
      byItem.set(d.item, entry);
    }
  }

  const recs = [...byItem.entries()].map(([code, { label, reasons }]) =>
    finalizeItem(code, label, reasons, fit),
  );
  return recs.sort(rankCompare);
}

// ---------------------------------------------------------------------------
//  Offensive item layer: tag-derived recs + item_edges enrichment
// ---------------------------------------------------------------------------

function rankItems(
  kb: KnowledgeBase,
  census: Census,
  fit: ItemFit,
): Recommendation[] {
  const acc = new Map<string, { label: string; reasons: Reason[] }>();

  // tag-based: items carrying tool tags, scored through the same edges
  for (const subject of itemCandidates(kb)) {
    const reasons = scoreSubject(subject, kb, census);
    if (reasons.length) acc.set(subject.code, { label: subject.label, reasons });
  }

  // item->hero point counters (e.g. Nullifier vs Necrophos, + wiki items) merged on top
  const selected = new Set(census.allSelected);
  for (const ie of kb.itemEdges) {
    if (!selected.has(ie.target)) continue;
    const entry = acc.get(ie.item) ?? { label: ie.label, reasons: [] };
    entry.reasons.push({
      enemy: ie.target,
      basis: "item_edge",
      mechanism: ie.mechanism.trim(),
      contribution: ie.weight,
      factors: { edgeWeight: ie.weight },
      ...(ie.source ? { source: ie.source } : {}),
    });
    acc.set(ie.item, entry);
  }

  const recs = [...acc.entries()]
    .map(([code, { label, reasons }]) => finalizeItem(code, label, reasons, fit))
    .filter((r) => r.score > 0); // blunted into this lineup more than it answers (ADR-022)
  return recs.sort(rankCompare);
}

// ---------------------------------------------------------------------------
//  Scoring
// ---------------------------------------------------------------------------

/** synergy contribution per allied combo (modest, so counters still lead). */
const SYNERGY_WEIGHT = 0.6;

/** Attach the candidate's public-match win rate vs the selected enemies (stat layer,
 *  ADR-005). Games-weighted aggregate is far steadier than any single small-sample pair. */
function attachWinrate(rec: Recommendation, kb: KnowledgeBase, census: Census): void {
  const mu = kb.matchups?.[rec.code];
  if (!mu) return;
  const breakdown: Array<{ enemy: string; wr: number; n: number }> = [];
  let weighted = 0;
  let games = 0;
  for (const enemy of census.allSelected) {
    const pair = mu[enemy];
    if (!pair) continue;
    const [wr, n] = pair;
    breakdown.push({ enemy, wr, n });
    weighted += wr * n;
    games += n;
  }
  if (games === 0) return;
  const winrate = weighted / games;
  rec.winrate = Math.round(winrate * 1000) / 1000;
  rec.winrateGames = games;
  rec.matchups = breakdown.sort((a, b) => a.wr - b.wr);

  // Blend the stat into the rank: a confidence-weighted tilt around 50% so a hero
  // that performs well in practice rises and a theory-only counter (good mechanism,
  // bad win rate) sinks. Small samples barely move; KB mechanics still dominate.
  const deviation = winrate - 0.5;
  const confidence = Math.min(1, games / WINRATE_FULL_CONF);
  const factor = clamp(1 + WINRATE_TILT * deviation * confidence, 0.94, 1.06);
  rec.score = round(rec.score * factor);
}

// Light tiebreaker: win rate only nudges near-tied counters; KB mechanics still lead.
const WINRATE_TILT = 0.8; // gentle tilt strength
const WINRATE_FULL_CONF = 150; // games for full confidence in the tilt

function clamp(x: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, x));
}

function rankSubjects(
  subjects: Subject[],
  kb: KnowledgeBase,
  census: Census,
  synergy: SynergyIndex,
  team: TeamContext,
): Recommendation[] {
  const recs: Recommendation[] = [];
  for (const subject of subjects) {
    const reasons = scoreSubject(subject, kb, census).map((r) =>
      team.lane.has(r.enemy)
        ? { ...r, contribution: r.contribution * LANE_WEIGHT, notes: [...(r.notes ?? []), "lane opponent"] }
        : r,
    );
    if (subject.kind === "hero") reasons.push(...teamReasons(team, subject.tags));
    // synergy with allied team (only when picking a hero)
    for (const s of synergy.get(subject.code) ?? []) {
      reasons.push({
        enemy: s.partner,
        basis: "synergy",
        mechanism: s.mechanism.trim(),
        contribution: SYNERGY_WEIGHT,
        factors: { edgeWeight: SYNERGY_WEIGHT },
      });
    }
    // a candidate needs at least one argument FOR it; resilience/exposure alone
    // only re-rank (a hero with nothing but risks is simply not suggested)
    if (!reasons.some((r) => r.contribution > 0)) continue;
    const rec = finalizeRec(subject.kind, subject.code, subject.label, subject.pos, reasons);
    // net negative = the enemy's kit beats this pick more than it answers them (ADR-022)
    if (rec.score <= 0) continue;
    if (subject.kind === "hero") attachWinrate(rec, kb, census);
    recs.push(rec);
  }
  return recs.sort(rankCompare);
}

/** Build a Recommendation from raw reasons: score, coverage, synergy, school, sorted reasons. */
function finalizeRec(
  kind: "hero" | "item",
  code: string,
  label: string,
  pos: number[] | undefined,
  reasons: Reason[],
): Recommendation {
  const score = reasons.reduce((s, r) => s + r.contribution, 0);
  const school = dominantSchool(reasons);
  const coverage = [
    ...new Set(
      reasons.filter((r) => r.basis !== "synergy" && r.basis !== "team" && r.contribution > 0).map((r) => r.enemy),
    ),
  ];
  const synergyWith = [...new Set(reasons.filter((r) => r.basis === "synergy").map((r) => r.enemy))];
  const risks = [...new Set(reasons.filter((r) => r.contribution < 0).map((r) => r.enemy))];
  return {
    kind,
    code,
    label,
    ...(pos ? { pos } : {}),
    score: round(score),
    coverage,
    ...(synergyWith.length ? { synergyWith } : {}),
    ...(risks.length ? { risks } : {}),
    ...(school ? { school } : {}),
    // counter/resist reasons first (by contribution), then synergy, then risks
    reasons: reasons
      .slice()
      .sort((a, b) => {
        const rank = (r: Reason) => (r.contribution < 0 ? 2 : r.basis === "synergy" || r.basis === "team" ? 1 : 0);
        const as = rank(a);
        const bs = rank(b);
        if (as !== bs) return as - bs;
        return b.contribution - a.contribution;
      })
      .map((r) => ({ ...r, contribution: round(r.contribution) })),
  };
}

/** Pick the candidate's damage school by summing contribution per tool school. */
function dominantSchool(reasons: Reason[]): DamageSchool | undefined {
  let phys = 0;
  let magic = 0;
  for (const r of reasons) {
    if (r.basis !== "edge") continue; // school = what the candidate DEALS
    const school = r.tool ? TOOL_SCHOOL[r.tool] : undefined;
    if (school === "physical") phys += r.contribution;
    else if (school === "magic") magic += r.contribution;
  }
  if (phys === 0 && magic === 0) return undefined;
  if (phys > magic * 1.25) return "physical";
  if (magic > phys * 1.25) return "magic";
  return undefined; // mixed / neutral -> no badge
}

// ---------------------------------------------------------------------------
//  Magic vs physical damage read of the enemy team
// ---------------------------------------------------------------------------

function readDamage(census: Census): DamageRead {
  let physicalVuln = 0;
  let magicVuln = 0;
  let physThreat = 0;
  let magicThreat = 0;
  for (const enemy of census.enemies) {
    const tags = census.tagsOf(enemy)!;
    const rel = tags.reliance ?? {};
    const tool = tags.tool ?? {};
    // what to bring against them (defensive weakness): low_armor -> physical,
    // magic_burst_vulnerable / high_armor (physical mitigated) -> magic, and
    // squishy_to_burst dies to either.
    const anySquish = 0.5 * (rel.squishy_to_burst ?? 0);
    physicalVuln += (rel.low_armor ?? 0) + anySquish;
    magicVuln += (rel.magic_burst_vulnerable ?? 0) + (rel.high_armor ?? 0) + anySquish;
    // what they deal: right-clickers (attack_reliant) deal physical; spell-reliant
    // casters deal magic. The dedicated burst tools add on top.
    physThreat += (rel.attack_reliant ?? 0) + (tool.physical_burst ?? 0);
    magicThreat += (rel.spell_reliant ?? 0) + (tool.magic_burst ?? 0);
  }
  return {
    physicalVuln: round(physicalVuln),
    magicVuln: round(magicVuln),
    offenseLean: lean(physicalVuln, magicVuln),
    physThreat: round(physThreat),
    magicThreat: round(magicThreat),
    defenseLean: lean(physThreat, magicThreat),
  };
}

function lean(phys: number, magic: number): "physical" | "magic" | "mixed" {
  if (phys === 0 && magic === 0) return "mixed";
  if (phys > magic * 1.3) return "physical";
  if (magic > phys * 1.3) return "magic";
  return "mixed";
}

function scoreSubject(
  subject: Subject,
  kb: KnowledgeBase,
  census: Census,
): Reason[] {
  const reasons: Reason[] = [];
  const subjectHasTool = (toolCode: string) =>
    (subject.toolTable[toolCode] ?? 0) > 0;

  // --- edge basis: tag -> tag ---------------------------------------------
  for (const [toolCode, toolWeight] of Object.entries(subject.toolTable)) {
    if (toolWeight <= 0) continue;
    const edges = kb.edgesByTool.get(toolCode);
    if (!edges) continue;

    for (const edge of edges) {
      for (const enemy of census.enemies) {
        const enemyTags = census.tagsOf(enemy)!;
        const relianceWeight = enemyTags.reliance?.[edge.target] ?? 0;
        if (relianceWeight <= 0) continue;

        const guard = evaluateConditions(
          edge.conditions,
          enemyTags,
          subjectHasTool,
          census,
          edge.target,
        );
        if (!guard.ok) continue;

        const contribution = toolWeight * edge.weight * relianceWeight;
        reasons.push({
          enemy,
          basis: "edge",
          tool: toolCode,
          reliance: edge.target,
          mechanism: edge.mechanism,
          contribution,
          factors: {
            toolWeight,
            edgeWeight: edge.weight,
            relianceWeight,
          },
          ...(guard.notes.length ? { notes: guard.notes } : {}),
          ...viaField(census.viaOf(enemy, "reliance", edge.target)),
        });
      }
    }
  }

  // --- hero_edge basis: point enrichment on top of the basis --------------
  // Matches ALL selected enemies (incl. untagged), so wiki edges cover heroes
  // outside hero_tags. Conditions are only evaluable on tagged targets.
  if (subject.kind === "hero") {
    const selected = new Set(census.allSelected);
    for (const he of kb.heroEdges) {
      if (he.subject !== subject.code) continue;
      if (!selected.has(he.target)) continue;
      let notes: string[] = [];
      if (he.conditions) {
        const enemyTags = census.tagsOf(he.target);
        if (!enemyTags) continue; // can't evaluate conditions on an untagged target
        const guard = evaluateConditions(he.conditions, enemyTags, subjectHasTool, census, "");
        if (!guard.ok) continue;
        notes = guard.notes;
      }
      reasons.push({
        enemy: he.target,
        basis: "hero_edge",
        mechanism: he.mechanism.trim(),
        contribution: he.weight,
        factors: { edgeWeight: he.weight },
        ...(notes.length ? { notes } : {}),
        ...(he.source ? { source: he.source } : {}),
      });
    }
  }

  scoreTwoSided(subject, kb, census, reasons);
  return reasons;
}

// ---------------------------------------------------------------------------
//  Two-sided scoring (ADR-020; blunted-by-reliance ADR-022): a pick is also judged by what it ENDURES and by
//  what in the enemy lineup hits ITS weaknesses - not only by what it deals.
//
//    resist  (+) candidate resistance x enemy tool / damage source   (resist_edges)
//    risk    (-) enemy tool x candidate reliance                     (edges, reversed)
//    blunted (-) candidate tool OR reliance x enemy resistance       (resist_edges, reversed)
//
//  Offense stays the backbone: penalties are scaled down (a risk is a reason to
//  play carefully, not a hard veto) and capped per enemy so a long reliance list
//  doesn't bury a hero.
// ---------------------------------------------------------------------------

const RESIST_WEIGHT = 1.0;
const RISK_WEIGHT = 0.5;
const BLUNT_WEIGHT = 0.6;
/** max |sum| per enemy for each two-sided term. */
const RESIST_CAP = 1.0;
const RISK_CAP = 0.8;

function scoreTwoSided(subject: Subject, kb: KnowledgeBase, census: Census, out: Reason[]): void {
  for (const enemy of census.enemies) {
    const enemyTags = census.tagsOf(enemy)!;
    const enemyTools = enemyTags.tool ?? {};
    const enemyRel = enemyTags.reliance ?? {};
    const resist: Reason[] = [];
    const risk: Reason[] = [];

    // resist: what the candidate endures (heroes only)
    for (const [code, rw] of Object.entries(subject.resist ?? {})) {
      if (rw <= 0) continue;
      // this enemy carries the answer to the resistance -> no credit vs them
      if ((kb.resistPiercedBy.get(code) ?? []).some((t) => (enemyTools[t] ?? 0) > 0)) continue;
      for (const re of kb.resistEdgesBy.get(code) ?? []) {
        const ew = re.tool ? (enemyTools[re.tool] ?? 0) : (enemyRel[re.reliance!] ?? 0);
        if (ew <= 0) continue;
        resist.push({
          enemy,
          basis: "resist",
          resistance: code,
          ...(re.tool ? { tool: re.tool } : { reliance: re.reliance }),
          mechanism: re.mechanism,
          contribution: RESIST_WEIGHT * rw * re.weight * ew,
          factors: { resistWeight: rw, edgeWeight: re.weight, enemyWeight: ew },
          ...viaField(re.tool ? census.viaOf(enemy, "tool", re.tool) : census.viaOf(enemy, "reliance", re.reliance!)),
        });
      }
    }

    // risk: the enemy's tools hit the candidate's reliances (heroes only)
    if (subject.tags) {
      const myRel = subject.tags.reliance ?? {};
      const enemyHasTool = (t: string) => (enemyTools[t] ?? 0) > 0;
      for (const [toolCode, tw] of Object.entries(enemyTools)) {
        if (tw <= 0) continue;
        for (const edge of kb.edgesByTool.get(toolCode) ?? []) {
          const cw = myRel[edge.target] ?? 0;
          if (cw <= 0) continue;
          if (edge.conditions?.min_targets !== undefined) continue; // team-level gate, not 1:1
          const guard = evaluateConditions(edge.conditions, subject.tags, enemyHasTool, census, edge.target);
          if (!guard.ok) continue;
          risk.push({
            enemy,
            basis: "risk",
            tool: toolCode,
            reliance: edge.target,
            mechanism: edge.mechanism,
            contribution: -RISK_WEIGHT * tw * edge.weight * cw,
            factors: { toolWeight: tw, edgeWeight: edge.weight, relianceWeight: cw },
            ...viaField(census.viaOf(enemy, "tool", toolCode)),
          });
        }
      }
    }

    // blunted: the candidate's tool is weak into this enemy's resistance (heroes + items)
    for (const [code, ew] of Object.entries(enemyTags.resist ?? {})) {
      if (ew <= 0) continue;
      // the candidate brings the answer (Nyx's mana burn vs Mana Shield) -> not blunted
      if ((kb.resistPiercedBy.get(code) ?? []).some((t) => (subject.toolTable[t] ?? 0) > 0)) continue;
      for (const [toolCode, tw] of Object.entries(subject.toolTable)) {
        if (tw <= 0) continue;
        for (const re of kb.resistEdgesByTool.get(toolCode) ?? []) {
          if (re.resistance !== code) continue;
          risk.push({
            enemy,
            basis: "risk",
            tool: toolCode,
            resistance: code,
            mechanism: re.mechanism,
            contribution: -BLUNT_WEIGHT * tw * re.weight * ew,
            factors: { toolWeight: tw, edgeWeight: re.weight, enemyWeight: ew },
            ...viaField(census.viaOf(enemy, "resist", code)),
          });
        }
      }
      // ...and the same for what the candidate's damage RESTS ON (heroes): a
      // right-clicker into evasion / Mana Shield, lifesteal sustain into Mana Shield
      for (const [relCode, cw] of Object.entries(subject.tags?.reliance ?? {})) {
        if (cw <= 0) continue;
        for (const re of kb.resistEdgesByReliance.get(relCode) ?? []) {
          if (re.resistance !== code) continue;
          risk.push({
            enemy,
            basis: "risk",
            reliance: relCode,
            resistance: code,
            mechanism: re.mechanism,
            contribution: -BLUNT_WEIGHT * cw * re.weight * ew,
            factors: { relianceWeight: cw, edgeWeight: re.weight, enemyWeight: ew },
            ...viaField(census.viaOf(enemy, "resist", code)),
          });
        }
      }
    }

    out.push(...capped(resist, RESIST_CAP), ...capped(risk, RISK_CAP));
  }
}

function viaField(v: string[] | undefined): { via?: string[] } {
  return v?.length ? { via: v } : {};
}

/** scale a group of same-sign reasons so |sum| <= cap (keeps the mix, bounds the total). */
function capped(rs: Reason[], cap: number): Reason[] {
  const total = Math.abs(rs.reduce((s, r) => s + r.contribution, 0));
  if (total <= cap) return rs;
  const k = cap / total;
  return rs.map((r) => ({ ...r, contribution: r.contribution * k, notes: [...(r.notes ?? []), `capped x${round(k)}`] }));
}

// ---------------------------------------------------------------------------
//  Helpers
// ---------------------------------------------------------------------------

function rankCompare(a: Recommendation, b: Recommendation): number {
  if (b.score !== a.score) return b.score - a.score;
  if (b.coverage.length !== a.coverage.length) {
    return b.coverage.length - a.coverage.length;
  }
  return a.label.localeCompare(b.label);
}

/** hero codes are snake_case; render a readable label (no hero-name table in MVP). */
function prettifyHero(code: string): string {
  return code
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

function round(n: number): number {
  return Math.round(n * 1000) / 1000;
}
