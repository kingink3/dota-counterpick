// =============================================================================
//  Combo analysis: position assignment, lane naming, copy-paste detection, clipping.
// =============================================================================

import assert from "node:assert/strict";
import { test } from "node:test";

import { clipSentence, genericCombos, roleFit } from "../src/combos.js";
import { loadKB } from "../src/kb.js";
import type { Combo } from "../src/types.js";

test("roleFit: Centaur 3 + Abaddon -> Abaddon moves to 4, off lane duo", () => {
  const f = roleFit([3], [3, 4, 5]);
  assert.deepEqual(f, { pos: [3, 4], cost: 1, lane: "off lane duo" });
  assert.equal(roleFit([3], [3]), null); // Axe + Dark Seer: impossible on one team
  assert.equal(roleFit([1], [5])?.lane, "safe lane duo");
  assert.equal(roleFit([2], [4])?.lane, "mid + teammate");
  assert.equal(roleFit(undefined, [1]), undefined);
});

test("genericCombos: the same line with only the partner's name swapped is generic", () => {
  const label = (c: string) => ({ luna: "Luna", am: "Anti-Mage", fv: "Faceless Void", sven: "Sven", cm: "Crystal Maiden" })[c] ?? c;
  const mk = (b: string, who: string): Combo => ({ pair: ["luna", b], lane: "synergy", mechanism: `Lunar Blessing can give ${label(b)} bonus attack damage to help ${who} farm.` });
  const cs = [mk("am", "him"), mk("fv", "him"), mk("sven", "him"), { pair: ["luna", "cm"], lane: "synergy", mechanism: "Crystal Nova sets up Eclipse." } as Combo];
  const g = genericCombos(cs, label);
  assert.equal(g.size, 3);
  assert.ok(!g.has(cs[3]!));
});

test("clipSentence: cut at a sentence end, never mid-word", () => {
  const t = "First sentence is here. Second sentence goes on and on and on without end";
  assert.equal(clipSentence(t, 40), "First sentence is here.");
  assert.ok(clipSentence("word ".repeat(100), 50).endsWith("…"));
  assert.equal(clipSentence("short", 50), "short");
});

test("real KB: combo texts end cleanly and most pairs fit on one team", () => {
  const kb = loadKB();
  const posOf = (c: string) => kb.taxonomy.hero_tags[c]?.pos;
  const conflicts = kb.combos.filter((c) => roleFit(posOf(c.pair[0]), posOf(c.pair[1])) === null);
  assert.ok(conflicts.length < 30, `${conflicts.length} conflicting pairs`);
  const ragged = kb.combos.filter((c) => !/[.!?)"'…]$/.test(c.mechanism.trim()));
  assert.ok(ragged.length < kb.combos.length * 0.05, `${ragged.length} texts end mid-sentence`);
});
