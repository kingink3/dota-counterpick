// =============================================================================
//  Match plan for the Game tab (ADR-028): what the enemy draft does to YOU and
//  what to do about it, by game phase. Pure; built from the engine result, the
//  item plan and the power windows - no free text beyond fixed sentence frames.
// =============================================================================

import { CURVE_LABELS, mmss, type ItemPlan, type PlanItem, type TeamWindow } from "./item-plan.js";
import type { KnowledgeBase } from "./knowledge.js";
import type { EngineResult, Recommendation } from "./types.js";

export type GamePhase = "lane" | "mid" | "late";
export const PHASES: Array<{ id: GamePhase; label: string; from: number; to: number }> = [
  { id: "lane", label: "Lane 0-10", from: -Infinity, to: 600 },
  { id: "mid", label: "Mid game 10-25", from: 600, to: 1500 },
  { id: "late", label: "Late 25+", from: 1500, to: Infinity },
];

export function phaseAt(t: number | undefined): GamePhase {
  if (t === undefined) return "lane";
  return PHASES.find((p) => t >= p.from && t < p.to)!.id;
}

/** enemy tools that threaten any hero directly (a damage, disable or item answer). */
const DANGER: Record<string, number> = {
  bkb_piercing_disable: 1.2,
  magic_burst: 1,
  physical_burst: 1,
  lockdown_root: 0.9,
  silence: 0.8,
  lockdown_early: 0.8,
  pickoff: 0.7,
  health_based_damage: 0.6,
  disarm: 0.6,
  mana_burn: 0.5,
  break: 0.5,
  healing_reduction: 0.4,
  true_strike: 0.4,
};

export interface Threat {
  enemy: string;
  /** the enemy's dangerous tools, strongest first. */
  tools: string[];
  /** the best item answer among your plan / defensive items, with the reason for this enemy. */
  answer?: { rec: Recommendation; key: string };
  weight: number;
}

export interface MatchPlan {
  damage: { magic: number; physical: number; magicBy: string[]; physBy: string[] };
  defence: Array<{ rec: Recommendation; key: string }>;
  threats: Threat[];
  focus: Record<GamePhase, { title: string; lines: string[] }>;
}

export interface MatchPlanInput {
  kb: KnowledgeBase;
  result: EngineResult;
  enemies: string[];
  allies: string[];
  myHero?: string;
  plan?: ItemPlan;
  window?: TeamWindow;
  enemyItems?: Map<string, string[]>;
  label: (hero: string) => string;
  itemLabel: (key: string) => string;
  dcKey: (ourId: string) => string | undefined;
}

export function buildMatchPlan(inp: MatchPlanInput): MatchPlan {
  const { kb, result, label } = inp;
  const toolLabel = (c: string) => kb.toolByCode.get(c)?.label ?? c;
  const tags = (h: string) => kb.taxonomy.hero_tags[h];
  const fits = (r: Recommendation) => (r.fit?.mult ?? 1) >= 0.6 && r.score > 0;

  // --- damage: the engine's per-hero census (attack/spell reliance + burst tools)
  const per = inp.enemies.map((e) => {
    const t = tags(e);
    const phys = (t?.reliance.attack_reliant ?? 0) + (t?.tool.physical_burst ?? 0);
    const magic = (t?.reliance.spell_reliant ?? 0) + (t?.tool.magic_burst ?? 0);
    return { e, phys, magic };
  });
  const sum = result.damage.physThreat + result.damage.magicThreat || 1;
  const by = (k: "phys" | "magic") =>
    per
      .filter((x) => x[k] >= 0.6)
      .sort((a, b) => b[k] - a[k])
      .slice(0, 3)
      .map((x) => x.e);
  const damage = {
    magic: result.damage.magicThreat / sum,
    physical: result.damage.physThreat / sum,
    magicBy: by("magic"),
    physBy: by("phys"),
  };

  const keyOf = (r: Recommendation) => inp.dcKey(r.code) ?? r.code;
  const defence = result.defense.filter(fits).slice(0, 3).map((rec) => ({ rec, key: keyOf(rec) }));

  // --- threats: each enemy's dangerous tools + the strongest answer you have for them
  const planned = new Map<string, Recommendation>();
  for (const ph of inp.plan?.phases ?? []) for (const it of ph.items) if (it.counter) planned.set(it.key, it.counter);
  const answers = [...planned.values(), ...result.defense.filter(fits)];
  const threats: Threat[] = inp.enemies
    .map((enemy) => {
      const tool = tags(enemy)?.tool ?? {};
      const dangerous = Object.entries(tool)
        .filter(([c, w]) => DANGER[c] !== undefined && w >= 0.4)
        .sort((a, b) => b[1] * DANGER[b[0]]! - a[1] * DANGER[a[0]]!);
      const weight = dangerous.reduce((s, [c, w]) => s + w * DANGER[c]!, 0);
      const best = answers
        .filter((r) => r.reasons.some((x) => x.enemy === enemy && x.contribution > 0))
        .sort((a, b) => contributionVs(b, enemy) - contributionVs(a, enemy))[0];
      return {
        enemy,
        tools: dangerous.slice(0, 2).map(([c]) => toolLabel(c)),
        ...(best ? { answer: { rec: best, key: keyOf(best) } } : {}),
        weight,
      };
    })
    .filter((t) => t.tools.length || t.answer)
    .sort((a, b) => b.weight - a.weight)
    .slice(0, 5);

  return { damage, defence, threats, focus: focusLines(inp, threats) };
}

function contributionVs(r: Recommendation, enemy: string): number {
  return r.reasons.filter((x) => x.enemy === enemy).reduce((s, x) => s + x.contribution, 0);
}

// -----------------------------------------------------------------------------
//  Phase focus: fixed sentence frames filled from the data
// -----------------------------------------------------------------------------

function focusLines(inp: MatchPlanInput, threats: Threat[]): MatchPlan["focus"] {
  const { label, window: w, plan, result } = inp;
  const lane = plan?.phases.find((p) => p.id === "lane")?.items ?? [];
  const core = plan?.phases.find((p) => p.id === "core")?.items ?? [];
  const late = plan?.phases.find((p) => p.id === "late")?.items ?? [];
  const items = (xs: PlanItem[]) => xs.map((i) => `${i.label}${i.at !== undefined ? ` ~${mmss(i.at)}` : ""}`).join(", ");
  const drivers = (bin: number, side: "ally" | "enemy") =>
    (w?.drivers[bin] ?? [])
      .filter((d) => d.side === side && d.pp > 0.5)
      .slice(0, 2)
      .map((d) => `${label(d.hero)} +${d.pp.toFixed(1)}`)
      .join(", ");
  const windowLine = (bin: number): string | undefined => {
    const d = w?.diff[bin];
    if (d === undefined) return undefined;
    if (d > 0.5) {
      const who = drivers(bin, "ally");
      return `${cap(CURVE_LABELS[bin]!)} your lineup is ahead (+${d.toFixed(1)} pp${who ? `; ${who}` : ""}).`;
    }
    if (d < -0.5) {
      const who = drivers(bin, "enemy");
      return `${cap(CURVE_LABELS[bin]!)} they are ahead (${d.toFixed(1)} pp${who ? `; ${who}` : ""}).`;
    }
    return `${cap(CURVE_LABELS[bin]!)} roughly even.`;
  };
  const stake = (it: PlanItem) => {
    const t = it.timing;
    return t?.wrFast !== undefined && t.wrSlow !== undefined && t.wrFast - t.wrSlow > 0.05
      ? `${it.label} by ${mmss(t.fastBy ?? t.p25)}: ${pct(t.wrFast)} wins, after ${mmss(t.slowAfter ?? t.p75)}: ${pct(t.wrSlow)}.`
      : undefined;
  };
  const gaps = (result.team?.needs ?? [])
    .filter((n) => n.have < 0.75 * n.want)
    .map((n) => `${n.label.toLowerCase()} (${n.have.toFixed(1)} of ${n.want})`);
  const opp = result.team?.laneOpponents ?? [];
  const oppThreat = opp
    .map((o) => threats.find((t) => t.enemy === o))
    .filter((t): t is Threat => !!t && t.tools.length > 0)
    .map((t) => `${label(t.enemy)}: ${t.tools.join(", ").toLowerCase()}`);
  const seen = [...(inp.enemyItems ?? new Map<string, string[]>())]
    .filter(([e, its]) => inp.enemies.includes(e) && its.length)
    .map(([e, its]) => `${label(e)}: ${its.map(inp.itemLabel).join(", ")}`);
  const titleFor = (bins: number[], ours: string, theirs: string, even: string) => {
    const d = bins.map((b) => w?.diff[b] ?? 0).reduce((a, b) => a + b, 0) / bins.length;
    return w ? (d > 0.5 ? ours : d < -0.5 ? theirs : even) : even;
  };
  const clean = (xs: Array<string | undefined | false>) => xs.filter((x): x is string => !!x);

  return {
    lane: {
      title: opp.length ? `Lane: vs ${opp.map(label).join(" + ")}` : "Lane",
      lines: clean([
        oppThreat.length > 0 && `Watch for ${oppThreat.join("; ")}.`,
        lane.length > 0 && `Lane items: ${items(lane)}.`,
        core[0] && `First core: ${core[0].label}${core[0].at !== undefined ? ` ~${mmss(core[0].at)}` : ""}.`,
        windowLine(0),
      ]),
    },
    mid: {
      title: titleFor([0], "Mid game: your window - take the map before 25:00", "Mid game: their window - farm safely, defend", "Mid game: even - play around your item timings"),
      lines: clean([
        windowLine(0),
        windowLine(1),
        ...core.slice(0, 2).map(stake),
        gaps.length > 0 && `Your team lacks ${gaps.join(", ")}: avoid fights that need it.`,
      ]),
    },
    late: {
      title: titleFor([2, 3], "Late game: your lineup scales - take fights with your items", "Late game: they scale - end it or wait for your timings", "Late game: even"),
      lines: clean([
        windowLine(2),
        windowLine(3),
        late.length > 0 && `Late items: ${items(late)}.`,
        seen.length > 0 && `Enemy items seen: ${seen.join("; ")}.`,
      ]),
    },
  };
}

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
function pct(x: number): string {
  return `${Math.round(x * 100)}%`;
}
