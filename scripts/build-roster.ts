// =============================================================================
//  Generate data/roster.json - the FULL Dota hero roster for the picker grid.
//
//  Source: OpenDota /api/heroes (one-off static fetch; the JSON is committed and
//  read at build time - NOT a runtime stat dependency, so ADR-004/005 stand).
//  OpenDota's npc name (minus prefix) == the Valve portrait filename, so it also
//  doubles as the art key.
//
//  Output per hero: { valve, label, attr, attack }. The UI links a roster hero to KB tags
//  by `valve` (via heroValveName); roster heroes with no KB match are still
//  selectable but produce honest "no known counters" (ADR-004).
//
//  Run:  npx tsx scripts/build-roster.ts   (needs network once)
// =============================================================================

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readRawKB } from "../src/kb.js";
import { heroValveName } from "../src/web/hero-art.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

interface ODHero {
  name: string; // npc_dota_hero_antimage
  localized_name: string;
  primary_attr: "str" | "agi" | "int" | "all";
  attack_type: "Melee" | "Ranged";
}

/** OpenDota blocks Node's default fetch UA (Cloudflare). Allow a pre-fetched file:
 *    curl -s https://api.opendota.com/api/heroes -o heroes.json
 *    npx tsx scripts/build-roster.ts heroes.json
 *  Falls back to a live fetch (with a browser UA) when no file is given. */
async function loadOD(): Promise<ODHero[]> {
  const fileArg = process.argv[2];
  if (fileArg) return JSON.parse(readFileSync(fileArg, "utf8")) as ODHero[];
  const res = await fetch("https://api.opendota.com/api/heroes", {
    headers: { "user-agent": "Mozilla/5.0", accept: "application/json" },
  });
  return (await res.json()) as ODHero[];
}

async function main(): Promise<void> {
  const od = await loadOD();

  const heroes = od
    .map((h) => ({
      valve: h.name.replace(/^npc_dota_hero_/, ""),
      label: h.localized_name,
      attr: h.primary_attr,
      // melee / ranged: item fit (data/item_fit.yaml melee_only / ranged_only)
      attack: h.attack_type === "Ranged" ? "ranged" : "melee",
    }))
    .sort((a, b) => a.label.localeCompare(b.label));

  // sanity: every KB hero must appear in the roster, or it would vanish from the grid.
  const rosterValve = new Set(heroes.map((h) => h.valve));
  const kb = readRawKB(ROOT);
  const missing: string[] = [];
  for (const code of Object.keys(kb.taxonomy.hero_tags)) {
    if (!rosterValve.has(heroValveName(code))) missing.push(code);
  }
  if (missing.length) {
    console.error("KB heroes NOT found in OpenDota roster:", missing.join(", "));
    process.exit(1);
  }

  writeFileSync(
    join(ROOT, "data", "roster.json"),
    JSON.stringify({ heroes }, null, 0) + "\n",
    "utf8",
  );

  const byAttr = heroes.reduce<Record<string, number>>((m, h) => {
    m[h.attr] = (m[h.attr] ?? 0) + 1;
    return m;
  }, {});
  console.log(`roster.json: ${heroes.length} heroes`, byAttr);
  console.log(
    `KB-tagged: ${Object.keys(kb.taxonomy.hero_tags).length}, ` +
      `untagged (selectable, honest-gap): ${heroes.length - Object.keys(kb.taxonomy.hero_tags).length}`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
