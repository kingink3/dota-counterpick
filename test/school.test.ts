// ADR-046: school content integrity, generated situations, practice goals.
import assert from "node:assert/strict";
import { test } from "node:test";
import { join } from "node:path";
import { CounterPickEngine } from "../src/engine.js";
import { resolve } from "../src/resolver.js";
import { FOUNDATIONS } from "../src/school/foundations.js";
import { generate } from "../src/school/generate.js";
import { checkGoal } from "../src/school/practice.js";
import type { MatchReview } from "../src/review.js";

test("school: every question is well-formed and ids are unique", () => {
  const ids = new Set<string>();
  for (const l of FOUNDATIONS.lessons) {
    assert.ok(l.theory.length >= 2, `${l.id}: theory`);
    assert.ok(l.quiz.length >= 3, `${l.id}: test`);
    for (const q of [...l.quiz, ...l.situations]) {
      assert.ok(!ids.has(q.id), `duplicate id ${q.id}`);
      ids.add(q.id);
      assert.ok(q.options.length >= 2 && q.correct >= 0 && q.correct < q.options.length, `${q.id}: answer index`);
      assert.equal(new Set(q.options).size, q.options.length, `${q.id}: options repeat`);
      assert.ok(q.why.length > 20, `${q.id}: explanation`);
    }
    assert.ok(l.situations.length || l.generated, `${l.id}: situations`);
  }
});

test("school: generated situations have one clear answer from the KB", () => {
  const engine = CounterPickEngine.load(join(import.meta.dirname, ".."));
  const kb = engine.kb;
  const deps = {
    resolve: (d: Parameters<typeof resolve>[1]) => resolve(kb, d),
    heroes: Object.keys(kb.taxonomy.hero_tags),
    items: kb.items.filter((i) => Object.keys(i.tool).length).map((i) => i.code),
    heroLabel: (s: string) => s,
    itemLabel: (s: string) => s,
    why: () => "reason",
  };
  for (const kind of ["items", "draft"] as const) {
    const qs = generate(kind, 6, 42, deps);
    assert.equal(qs.length, 6, `${kind}: six situations`);
    for (const q of qs) {
      assert.equal(q.options.length, 4);
      assert.equal(new Set(q.options).size, 4, "distinct options");
    }
    assert.deepEqual(generate(kind, 6, 42, deps).map((q) => q.scene), qs.map((q) => q.scene), "same seed, same set");
  }
});

test("school: practice goals count fitting matches only", () => {
  const rev = (position: number, deaths: number, observers?: number) =>
    ({ matchId: Math.random(), position, kda: [1, deaths, 1], farm: [], comparable: true, findings: [], ...(observers !== undefined ? { vision: { observers, sentries: 0, dewards: 0, stacks: 0 } } : {}) }) as unknown as MatchReview;
  const d = checkGoal({ id: "deaths", text: "", need: 2, of: 3 }, [rev(1, 3), rev(2, 9), rev(3, 4), rev(1, 1)]);
  assert.equal(d.counted, 3);
  assert.equal(d.met, 2);
  assert.equal(d.done, true);
  const w = checkGoal({ id: "observers", text: "", roles: [4, 5], need: 2, of: 3 }, [rev(1, 0, 20), rev(5, 0, 9), rev(4, 0, 3)]);
  assert.equal(w.counted, 2, "the pos 1 match does not count");
  assert.equal(w.met, 1);
  assert.equal(w.done, false);
});
