// =============================================================================
//  Audit of the heroes' `tool` tags against their abilities (dotaconstants) -
//  run after a patch. Lists heroes whose abilities show a mechanic that their
//  taxonomy tools do not have. A list to review, not a gate: the tags are expert
//  weights, and descriptions can mislead ("removes stuns" is not a stun).
//
//      npx tsx scripts/audit-tools.ts --constants <dotaconstants/build> [--valve-names data/roster.json]
// =============================================================================

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { loadKB } from "../src/kb.js";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
}

interface DcAbility {
  dname?: string;
  desc?: string;
  behavior?: string | string[];
  bkbpierce?: string;
  target_team?: string | string[];
  attrib?: Array<{ key: string }>;
}

const constants = arg("constants");
if (!constants) {
  console.error("usage: tsx scripts/audit-tools.ts --constants <dotaconstants/build>");
  process.exit(1);
}
const abilities = JSON.parse(readFileSync(join(constants, "abilities.json"), "utf8")) as Record<string, DcAbility>;
const heroAbilities = JSON.parse(readFileSync(join(constants, "hero_abilities.json"), "utf8")) as Record<string, { abilities: string[] }>;
const kb = loadKB();
const tags = kb.taxonomy.hero_tags as Record<string, { tool?: Record<string, number> }>;
// dotaconstants keys are npc_dota_hero_<valve name>; the taxonomy uses the same names
const codeOf = (npc: string) => npc.replace(/^npc_dota_hero_/, "");

const CONTROL = /\b(stun(s|ned)?|hex|transforms? an enemy|roots?|rooted|prohibiting movement|sleep|fear\w*|taunts?|banish\w*|cyclone|ensnar\w*|leash\w*|trapping|lift\w*|can't pass|dragging|pulls?)\b/i;
const CHECKS: Array<{ tool: string[]; why: string; test: (a: DcAbility) => boolean }> = [
  { tool: ["lockdown_early", "lockdown_root", "bkb_piercing_disable", "pickoff", "interrupt", "silence", "disarm"], why: "control", test: (a) => CONTROL.test(a.desc ?? "") },
  { tool: ["bkb_piercing_disable"], why: "control through BKB", test: (a) => /yes/i.test(a.bkbpierce ?? "") && CONTROL.test(a.desc ?? "") },
  { tool: ["silence"], why: "silence", test: (a) => /\bsilenc/i.test(a.desc ?? "") },
  { tool: ["break"], why: "break", test: (a) => /\bbreak\b/i.test(a.desc ?? "") && !/break(s)? (the )?(link|tether|spell)/i.test(a.desc ?? "") },
  { tool: ["healing_reduction"], why: "healing reduction", test: (a) => /(reduc\w+ (their |the target's )?(health )?(heal|regen)|heal(ing)? reduction)/i.test(a.desc ?? "") },
  { tool: ["armor_reduction"], why: "armor reduction", test: (a) => /(reduc\w+ (the )?(target's |enemy |their )?armor|armor reduction|-armor)/i.test(a.desc ?? "") || (a.attrib ?? []).some((x) => /armor_reduction|minus_armor/.test(x.key)) },
  { tool: ["disarm"], why: "disarm", test: (a) => /\bdisarm/i.test(a.desc ?? "") },
  { tool: ["illusion_execute"], why: "kills illusions", test: (a) => /(instantly )?(kills|destroys) illusions/i.test(a.desc ?? "") },
];

/** reviewed 2026-11-05 (7.41): the description matches, the mechanic does not (or it is minor). */
const REVIEWED: Record<string, string> = {
  templar_assassin: "Psionic Projection is a teleport, not break",
  clinkz: "Strafe: no break",
  enchantress: "Little Friends forces neutrals to attack: not control",
  huskar: "Inner Fire disarms / knocks back, Life Break is a leap: no silence / break",
  bounty_hunter: "Shadow Walk / Friendly Shadow: no control, no break",
  batrider: "Flaming Lasso: no break (lockdown tagged)",
  ancient_apparition: "Release = Ice Blast release: no silence",
  treant: "Leech Seed: slow, no disarm",
  visage: "Familiars: no armor reduction",
  oracle: "Rain of Destiny is ally healing: not healing reduction",
  arc_warden: "Magnetic Field protects allies (ally_save): not control",
  primal_beast: "Trample: no disarm",
  ringmaster: "Escape Act is an ally save",
  kez: "Shodo Sai parry: minor",
  largo: "Amphibian Rhapsody songs: minor",
  riki: "Smoke Screen armor reduction is minor next to the silence / miss",
};

let n = 0;
for (const [npc, h] of Object.entries(heroAbilities)) {
  const code = codeOf(npc);
  const t = tags[code];
  if (!t) continue;
  const have = new Set(Object.keys(t.tool ?? {}));
  const miss: string[] = [];
  for (const c of CHECKS) {
    const by = h.abilities.filter((k) => {
      const a = abilities[k];
      return a && !([] as string[]).concat(a.behavior ?? []).includes("Passive") && c.test(a);
    });
    if (by.length && !c.tool.some((x) => have.has(x))) miss.push(`${c.why} (${by.map((k) => abilities[k]?.dname ?? k).join(", ")}) -> ${c.tool.join(" / ")}`);
  }
  if (miss.length && !REVIEWED[code]) {
    n++;
    console.log(`${code}: ${miss.join("; ")}`);
  }
}
console.log(`${n} heroes to review`);
