// =============================================================================
//  Demo CLI - exercises the engine end-to-end against the KB.
//
//  Usage:
//    npm run demo                         # built-in showcase drafts
//    npm run demo -- riki slark clinkz    # ad-hoc: enemy codes as args
//    npm run demo -- riki slark --role 3  # filter hero recs by position
//    npm run demo -- --factors riki slark # show the numeric factor breakdown
// =============================================================================

import { CounterPickEngine } from "./engine.js";
import { explainResult } from "./explain.js";
import type { DraftState } from "./types.js";

const SHOWCASE: Array<{ title: string; draft: DraftState }> = [
  {
    title: "Invis-heavy enemy core trio (detection / silence story)",
    draft: { enemyHeroes: ["riki", "clinkz", "slark"], myRole: 3 },
  },
  {
    title: "Illusion + mana-dependent (aoe_clear / mana_burn story)",
    draft: { enemyHeroes: ["phantom_lancer", "medusa", "storm_spirit"] },
  },
  {
    title: "BKB-guard showcase (PA, Sven, Ursa - bkb_reliant)",
    draft: { enemyHeroes: ["phantom_assassin", "sven", "ursa"], myRole: 3 },
  },
  {
    title: "Hero-edge enrichment (AA hard-counters Huskar)",
    draft: { enemyHeroes: ["huskar"], myRole: 4 },
  },
];

function parseArgs(argv: string[]): { drafts: Array<{ title: string; draft: DraftState }>; showFactors: boolean } {
  let showFactors = false;
  let role: number | undefined;
  let myHero: string | undefined;
  const enemies: string[] = [];
  const allies: string[] = [];

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--factors") showFactors = true;
    else if (a === "--role") role = Number(argv[++i]);
    else if (a === "--ally") { const v = argv[++i]; if (v) allies.push(v); }
    else if (a === "--myhero") myHero = argv[++i];
    else if (a?.startsWith("--")) continue;
    else if (a) enemies.push(a);
  }

  if (enemies.length === 0) {
    return { drafts: SHOWCASE, showFactors };
  }
  return {
    drafts: [
      {
        title: "Custom draft",
        draft: {
          enemyHeroes: enemies,
          ...(role !== undefined ? { myRole: role } : {}),
          ...(allies.length ? { allyHeroes: allies } : {}),
          ...(myHero ? { myHero } : {}),
        },
      },
    ],
    showFactors,
  };
}

function main(): void {
  const { drafts, showFactors } = parseArgs(process.argv.slice(2));
  const engine = CounterPickEngine.load();

  if (engine.warnings.length > 0) {
    console.error(`KB load warnings (${engine.warnings.length}):`);
    for (const w of engine.warnings) console.error(`  ! ${w}`);
    console.error("");
  }

  for (const { title, draft } of drafts) {
    console.log("=".repeat(78));
    console.log(title);
    console.log("=".repeat(78));
    const result = engine.recommend(draft);
    console.log(explainResult(engine.kb, result, { topN: 5, showFactors }));
    console.log("");
  }
}

main();
