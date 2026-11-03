// =============================================================================
//  Explainability layer (ADR-012 §4, the project's differentiator per the intro
//  of DECISIONS.md): turn the ranked, mechanism-tagged result into prose a human
//  reads as "pick X - it counters Y because <mechanism>", never a bare number.
// =============================================================================

import type { KnowledgeBase } from "./kb.js";
import type { EngineResult, Reason, Recommendation } from "./types.js";

export interface ExplainOptions {
  /** how many candidates per section to render. */
  topN?: number;
  /** include the numeric factor breakdown after each mechanism. */
  showFactors?: boolean;
}

export function explainResult(
  kb: KnowledgeBase,
  result: EngineResult,
  opts: ExplainOptions = {},
): string {
  const topN = opts.topN ?? 5;
  const lines: string[] = [];

  const enemyLabels = result.input.enemyHeroes
    .map((e) => heroLabel(e))
    .join(", ");
  lines.push(`Enemy team: ${enemyLabels}`);
  if (result.input.myRole !== undefined) {
    lines.push(`Drafting for: position ${result.input.myRole}`);
  }
  if (result.input.myHero) {
    lines.push(`Locked hero: ${heroLabel(result.input.myHero)} (item recs only)`);
  }
  const d = result.damage;
  lines.push(
    `Damage read: enemy is softer to ${d.offenseLean.toUpperCase()} ` +
      `(phys-vuln ${d.physicalVuln} vs magic-vuln ${d.magicVuln}); ` +
      `they deal mostly ${d.defenseLean.toUpperCase()} ` +
      `(phys ${d.physThreat} vs magic ${d.magicThreat}) - build ` +
      `${d.defenseLean === "physical" ? "armor" : d.defenseLean === "magic" ? "magic resist" : "mixed defense"}`,
  );
  lines.push("");

  if (result.heroes.length > 0) {
    lines.push("== HERO PICKS ==");
    for (const rec of result.heroes.slice(0, topN)) {
      lines.push(...renderRecommendation(kb, rec, opts));
    }
    lines.push("");
  }

  lines.push("== ITEM BUILDS (offensive) ==");
  if (result.items.length === 0) {
    lines.push("  (no known item counters for this enemy team)");
  }
  for (const rec of result.items.slice(0, topN)) {
    lines.push(...renderRecommendation(kb, rec, opts));
  }
  lines.push("");

  lines.push("== DEFENSIVE BUILD (survive their threats) ==");
  if (result.defense.length === 0) {
    lines.push("  (no notable threat tools on this enemy team)");
  }
  for (const rec of result.defense.slice(0, topN)) {
    lines.push(...renderRecommendation(kb, rec, opts));
  }
  lines.push("");

  if (result.combos.length > 0) {
    lines.push("== HERO COMBOS (team synergy, independent of the enemy) ==");
    for (const c of result.combos) {
      lines.push(`\n  [${c.lane}] ${heroLabel(c.pair[0])} + ${heroLabel(c.pair[1])}`);
      lines.push(`      ${collapse(c.mechanism)}`);
    }
    lines.push("");
  }

  // ADR-004 mitigation: say so plainly rather than inventing a counter.
  if (result.uncovered.length > 0) {
    lines.push("== HONEST GAPS ==");
    lines.push(
      `  No strong known counters found for: ${result.uncovered
        .map(heroLabel)
        .join(", ")}`,
    );
    lines.push(
      "  (KB-only MVP is silent on undescribed matchups by design - ADR-004.)",
    );
  }

  return lines.join("\n");
}

export function renderRecommendation(
  kb: KnowledgeBase,
  rec: Recommendation,
  opts: ExplainOptions = {},
): string[] {
  const out: string[] = [];
  const tag =
    rec.kind === "hero" && rec.pos ? ` (pos ${rec.pos.join("/")})` : "";
  const cov = rec.coverage.length ? `answers ${rec.coverage.map(heroLabel).join(", ")}` : "";
  const syn = rec.synergyWith?.length
    ? `synergy with ${rec.synergyWith.map(heroLabel).join(", ")}`
    : "";
  const tail = [cov, syn].filter(Boolean).join(" · ");
  const wr =
    rec.winrate !== undefined
      ? `  [${Math.round(rec.winrate * 100)}% WR / ${rec.winrateGames}g]`
      : "";
  out.push(`\n  ▸ ${rec.label}${tag} - score ${rec.score}${tail ? `, ${tail}` : ""}${wr}`);
  for (const reason of rec.reasons) {
    const line =
      reason.basis === "synergy"
        ? `      ${reasonText(kb, reason)}`
        : `      vs ${heroLabel(reason.enemy)}: ${reasonText(kb, reason)}`;
    out.push(line);
    if (opts.showFactors) {
      out.push(`          ${factorText(reason)}`);
    }
    for (const note of reason.notes ?? []) {
      out.push(`          · ${note}`);
    }
  }
  return out;
}

function reasonText(kb: KnowledgeBase, reason: Reason): string {
  if (reason.basis === "synergy") {
    return `+ combos with ${heroLabel(reason.enemy)}: ${collapse(reason.mechanism)}`;
  }
  if (reason.basis === "hero_edge") {
    const tag = reason.source === "wiki" ? "" : "[hero-specific] ";
    return `${tag}${collapse(reason.mechanism)}`;
  }
  if (reason.basis === "item_edge") {
    const tag = reason.source === "wiki" ? "" : "[item-specific] ";
    return `${tag}${collapse(reason.mechanism)}`;
  }
  if (reason.basis === "defense") {
    const threat = reason.tool ? kb.toolByCode.get(reason.tool)?.label : reason.tool;
    return `blocks ${threat}: ${collapse(reason.mechanism)}`;
  }
  const tool = reason.tool ? kb.toolByCode.get(reason.tool)?.label : undefined;
  const reliance = reason.reliance
    ? kb.relianceByCode.get(reason.reliance)?.label
    : undefined;
  const head = tool && reliance ? `${tool} → ${reliance}: ` : "";
  return `${head}${collapse(reason.mechanism)}`;
}

function factorText(reason: Reason): string {
  const f = reason.factors;
  const parts: string[] = [];
  if (f.toolWeight !== undefined) parts.push(`tool ${f.toolWeight}`);
  if (f.edgeWeight !== undefined) parts.push(`edge ${f.edgeWeight}`);
  if (f.relianceWeight !== undefined) parts.push(`reliance ${f.relianceWeight}`);
  if (f.threatWeight !== undefined) parts.push(`threat ${f.threatWeight}`);
  if (f.defenseWeight !== undefined) parts.push(`defense ${f.defenseWeight}`);
  return `[${parts.join(" × ")} = ${reason.contribution}]`;
}

function collapse(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

/** snake_case hero code -> readable name (shared with resolver's prettifier). */
export function heroLabel(code: string): string {
  return code
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}
