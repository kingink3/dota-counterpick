// =============================================================================
//  Golden drafts (PATCH_RUNBOOK D2): the top recommendations for a fixed set of
//  drafts, kept in test/fixtures/golden-drafts.json. A change in the engine or the
//  KB that moves them fails this test: look at the diff, and if it is intended,
//  refresh the snapshot with
//
//      UPDATE_GOLDEN=1 npx tsx --test test/golden.test.ts
//
//  and commit it - the "was / now" is then visible in the commit.
// =============================================================================

import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { CounterPickEngine } from "../src/engine.js";
import type { DraftState } from "../src/types.js";

const FILE = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "golden-drafts.json");

interface Golden {
  name: string;
  draft: DraftState;
  expect?: { heroes: string[]; items: string[]; defense: string[]; damage: string };
}

const engine = CounterPickEngine.load();
const doc = JSON.parse(readFileSync(FILE, "utf8")) as { drafts: Golden[] };

function snapshot(draft: DraftState): NonNullable<Golden["expect"]> {
  const r = engine.recommend(draft);
  return {
    heroes: r.heroes.slice(0, 5).map((x) => x.code),
    items: r.items.slice(0, 5).map((x) => x.code),
    defense: r.defense.slice(0, 4).map((x) => x.code),
    damage: r.damage.defenseLean,
  };
}

if (process.env.UPDATE_GOLDEN) {
  for (const g of doc.drafts) g.expect = snapshot(g.draft);
  writeFileSync(FILE, JSON.stringify(doc, null, 2) + "\n", "utf8");
}

for (const g of doc.drafts) {
  test(`golden draft: ${g.name}`, () => {
    assert.ok(g.expect, "no snapshot yet: run with UPDATE_GOLDEN=1");
    assert.deepEqual(snapshot(g.draft), g.expect);
  });
}
