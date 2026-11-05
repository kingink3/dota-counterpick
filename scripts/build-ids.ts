// =============================================================================
//  data/ids.json (ADR-029): numeric ids in STRATZ match data -> our codes.
//    heroes: OpenDota/STRATZ hero id -> KB code (roster valve name when not in the KB)
//    items:  item id -> dotaconstants key (icons in web/items use it)
//    cd:     active item cooldown in seconds (dotaconstants) - "died with BKB ready"
//
//      npx tsx scripts/build-ids.ts --constants <dotaconstants/build> --heroes <opendota heroes.json>
// =============================================================================

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readRawKB } from "../src/kb.js";
import { heroValveName } from "../src/web/hero-art.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
}
const constants = arg("constants");
const heroesFile = arg("heroes");
if (!constants || !heroesFile) {
  console.error("usage: tsx scripts/build-ids.ts --constants <dir> --heroes <heroes.json>");
  process.exit(1);
}
const kb = readRawKB(ROOT);
const valveToCode = new Map<string, string>();
for (const code of Object.keys(kb.taxonomy.hero_tags)) valveToCode.set(heroValveName(code), code);
const heroes: Record<string, string> = {};
for (const h of JSON.parse(readFileSync(heroesFile, "utf8")) as Array<{ id: number; name: string }>) {
  const valve = h.name.replace(/^npc_dota_hero_/, "");
  heroes[String(h.id)] = valveToCode.get(valve) ?? valve;
}
const dc = JSON.parse(readFileSync(join(constants, "items.json"), "utf8")) as Record<string, { id?: number; cd?: number | false; dname?: string }>;
const items: Record<string, string> = {};
const cd: Record<string, number> = {};
const names: Record<string, string> = {};
for (const [k, v] of Object.entries(dc)) {
  if (v.id === undefined) continue;
  items[String(v.id)] = k;
  if (typeof v.cd === "number" && v.cd > 0) cd[k] = v.cd;
  if (v.dname) names[k] = v.dname;
}
// items: mana cost of actives
const mc: Record<string, number> = {};
for (const [k, v] of Object.entries(dc as Record<string, { mc?: number | false }>)) if (typeof v.mc === "number" && v.mc > 0) mc[k] = v.mc;

// hero abilities (fight analysis): id -> key, name, cooldown / mana by level, kind
interface DcAbility {
  dname?: string;
  behavior?: string | string[];
  cd?: string | string[] | number;
  mc?: string | string[] | number;
  target_team?: string | string[];
  attrib?: Array<{ key: string; value: string | string[] }>;
}
const abilities = JSON.parse(readFileSync(join(constants, "abilities.json"), "utf8")) as Record<string, DcAbility>;
const abilityIds = JSON.parse(readFileSync(join(constants, "ability_ids.json"), "utf8")) as Record<string, string>;
const heroAbilities = JSON.parse(readFileSync(join(constants, "hero_abilities.json"), "utf8")) as Record<string, { abilities: string[] }>;
const heroKeys = new Set(Object.values(heroAbilities).flatMap((h) => h.abilities));
const nums = (x: DcAbility["cd"]): number[] => (Array.isArray(x) ? x.map(Number) : x === undefined || x === null ? [] : [Number(x)]).filter((n) => Number.isFinite(n));
const ab: Record<string, { k: string; n: string; cd: number[]; mc: number[]; f: string; r?: number; ra?: number }> = {};
const maxOf = (v: string | string[] | undefined): number | undefined => {
  const xs = nums(v as DcAbility["cd"]);
  return xs.length ? Math.max(...xs) : undefined;
};
for (const [id, key] of Object.entries(abilityIds)) {
  if (!heroKeys.has(key)) continue;
  const a = abilities[key];
  if (!a) continue;
  const beh = ([] as string[]).concat(a.behavior ?? []);
  const team = ([] as string[]).concat(a.target_team ?? []);
  // flags: p passive, h hidden (granted by shard / scepter / sub-ability), u unit target, t point target,
  // n no target, e enemy target, a ally target, c channelled
  const both = team.includes("Both");
  const f = [
    beh.includes("Passive") && "p", beh.includes("Hidden") && "h", beh.includes("Unit Target") && "u", beh.includes("Point Target") && "t",
    beh.includes("No Target") && "n", (team.includes("Enemy") || both) && "e", (team.includes("Friendly") || both) && "a", beh.includes("Channeled") && "c",
  ].filter(Boolean).join("");
  // cast range (max over levels) and effect radius, for "was an enemy in range"
  const at = a.attrib ?? [];
  const r = maxOf(at.find((x) => x.key === "abilitycastrange")?.value);
  const rad = at.find((x) => x.key === "radius") ?? at.find((x) => /radius/.test(x.key) && !/vision/.test(x.key));
  const ra = maxOf(rad?.value);
  ab[id] = { k: key, n: a.dname ?? key, cd: nums(a.cd), mc: nums(a.mc), f, ...(r ? { r } : {}), ...(ra ? { ra } : {}) };
}
writeFileSync(join(ROOT, "data", "ids.json"), JSON.stringify({ heroes, items, cd, mc, names, abilities: ab }));
console.log(`ids.json: ${Object.keys(heroes).length} heroes, ${Object.keys(items).length} items, ${Object.keys(cd).length} cooldowns, ${Object.keys(ab).length} hero abilities`);
