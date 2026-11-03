// =============================================================================
//  Edge condition / guard evaluation (ADR-009 BKB-guards, ADR-010 hybrid traps,
//  ADR-012 §2 census min_targets).
//
//  A guard is evaluated for a concrete (edge, enemy target, subject) triple plus
//  the team census. It answers: does this match survive, and why / why not.
// =============================================================================

import type { Census } from "./census.js";
import type { Conditions, HeroTags } from "./types.js";

export interface GuardOutcome {
  /** whether the match is allowed to score. */
  ok: boolean;
  /** explanation crumbs - surfaced in the recommendation's reason notes. */
  notes: string[];
}

/** does the subject (hero tags or item tool table) carry a given tool tag? */
export type SubjectToolLookup = (toolCode: string) => boolean;

/**
 * Evaluate an edge's conditions against one enemy target and the candidate subject.
 *
 *  - min_targets       : team-level gate (census). Fails the whole edge if too few
 *                        enemies carry the target reliance.
 *  - exclude_target_tag: enemy carrying this reliance tag => hard suppress
 *                        (e.g. true_strike excluded vs dodge_backtrack - Void).
 *  - unless_target_tag : enemy carrying this flag (bkb_reliant) => suppress, UNLESS
 *                        the subject supplies `or_tool_tag` (bkb_piercing_disable).
 */
export function evaluateConditions(
  conditions: Conditions | undefined,
  enemyTags: HeroTags,
  subjectHasTool: SubjectToolLookup,
  census: Census,
  targetReliance: string,
): GuardOutcome {
  const notes: string[] = [];
  if (!conditions) return { ok: true, notes };

  // --- min_targets: census gate -------------------------------------------
  if (conditions.min_targets !== undefined) {
    const have = census.relianceCount.get(targetReliance) ?? 0;
    if (have < conditions.min_targets) {
      return {
        ok: false,
        notes: [
          `min_targets: only ${have}/${conditions.min_targets} enemies carry "${targetReliance}"`,
        ],
      };
    }
    notes.push(
      `min_targets met (${have}≥${conditions.min_targets} carry "${targetReliance}")`,
    );
  }

  const enemyReliance = enemyTags.reliance ?? {};

  // --- exclude_target_tag: hard trap suppression --------------------------
  if (conditions.exclude_target_tag) {
    const tag = conditions.exclude_target_tag;
    if ((enemyReliance[tag] ?? 0) > 0) {
      return {
        ok: false,
        notes: [`excluded: target carries "${tag}" (naive tag would misfire)`],
      };
    }
  }

  // --- unless_target_tag (+ or_tool_tag escape): BKB-guard ----------------
  if (conditions.unless_target_tag) {
    const flag = conditions.unless_target_tag;
    const enemyHasFlag = (enemyReliance[flag] ?? 0) > 0;
    if (enemyHasFlag) {
      const escape = conditions.or_tool_tag;
      if (escape && subjectHasTool(escape)) {
        notes.push(
          `BKB-guard: target is "${flag}" but pierced via "${escape}"`,
        );
      } else {
        return {
          ok: false,
          notes: [
            escape
              ? `BKB-guard: target "${flag}" and no "${escape}" on subject - magic control bounces off BKB`
              : `guard: target carries "${flag}"`,
          ],
        };
      }
    }
  }

  return { ok: true, notes };
}
