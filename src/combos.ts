// =============================================================================
//  Combo analysis (Combos view): which positions can a synergy pair actually play
//  on ONE team, and is the wiki line specific or a copy-paste template?
//
//  The wiki "Works well with" lists are position-blind ("Centaur + Abaddon"), but a
//  duo only exists if the two heroes can take DIFFERENT positions. We pick the
//  cheapest assignment from each hero's position list (index 0 = main role) and
//  name the lane relation (1+5 safe lane, 3+4 off lane, ...). Pure, no DOM.
// =============================================================================

import type { Combo } from "./types.js";

export interface RoleFit {
  /** positions for pair[0] and pair[1]. */
  pos: [number, number];
  /** 0 = both on their main role; +1 per step down a hero's position list. */
  cost: number;
  lane: "safe lane duo" | "off lane duo" | "support duo" | "mid + teammate" | "different lanes";
}

/** cheapest distinct-position assignment; null = impossible (same single role). */
export function roleFit(posA: number[] | undefined, posB: number[] | undefined): RoleFit | null | undefined {
  if (!posA?.length || !posB?.length) return undefined;
  let best: { cost: number; a: number; b: number } | undefined;
  posA.forEach((a, i) =>
    posB.forEach((b, j) => {
      if (a !== b && (!best || i + j < best.cost)) best = { cost: i + j, a, b };
    }),
  );
  if (!best) return null;
  return { pos: [best.a, best.b], cost: best.cost, lane: laneOf(best.a, best.b) };
}

function laneOf(a: number, b: number): RoleFit["lane"] {
  const s = new Set([a, b]);
  if (s.has(1) && s.has(5)) return "safe lane duo";
  if (s.has(3) && s.has(4)) return "off lane duo";
  if (s.has(4) && s.has(5)) return "support duo";
  if (s.has(2)) return "mid + teammate";
  return "different lanes";
}

/** Wiki lines repeated for many partners with only the hero name swapped
 *  ("Lunar Blessing can give X bonus attack damage to help him farm...") carry
 *  little pair-specific information - rank them after specific lines. */
export function genericCombos(combos: Combo[], labelOf: (code: string) => string, minRepeats = 3): Set<Combo> {
  const shape = (c: Combo) => {
    let t = c.mechanism.toLowerCase();
    for (const code of c.pair) {
      const name = labelOf(code).toLowerCase();
      if (name) t = t.split(name).join("@");
    }
    return t.replace(/\b(he|she|him|her|his|hers)\b/g, "~").replace(/\s+/g, " ").trim();
  };
  const groups = new Map<string, Combo[]>();
  for (const c of combos) {
    const k = shape(c);
    groups.set(k, [...(groups.get(k) ?? []), c]);
  }
  const out = new Set<Combo>();
  for (const g of groups.values()) if (g.length >= minRepeats) g.forEach((c) => out.add(c));
  return out;
}

/** Cut text at a sentence end <= max (fallback: word boundary + ellipsis). */
export function clipSentence(text: string, max: number): string {
  const t = text.replace(/\s+/g, " ").trim();
  if (t.length <= max) return t;
  const head = t.slice(0, max);
  const end = Math.max(head.lastIndexOf(". "), head.lastIndexOf("! "), head.lastIndexOf("? "));
  if (end >= max * 0.4) return head.slice(0, end + 1);
  const sp = head.lastIndexOf(" ");
  return (sp > max * 0.6 ? head.slice(0, sp) : head).replace(/[,;:]$/, "") + "…";
}
