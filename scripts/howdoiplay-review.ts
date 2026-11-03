// =============================================================================
//  howdoiplay.com review (ADR-021): which counters named on the site does our
//  engine NOT suggest? A research aid for patch review (PATCH_RUNBOOK B5).
//
//    git clone --depth 1 https://github.com/tsunami643/tsunami643.github.io /tmp/hdip
//    npm run review:howdoiplay -- --site /tmp/hdip [--constants <dotaconstants/build>]
//
//  Writes howdoiplay-report.md (gitignored). The site's text is NOT licensed for
//  reuse: the report quotes it locally for review only; anything added to the KB
//  is written in our own words.
// =============================================================================
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { parse } from "yaml";
import { CounterPickEngine } from "../src/engine.js";
import { heroValveName } from "../src/web/hero-art.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const argv = process.argv.slice(2);
const opt = (n: string) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : undefined; };
const site = opt("--site");
if (!site || !existsSync(join(site, "tips"))) {
  console.error("usage: npm run review:howdoiplay -- --site <clone of tsunami643/tsunami643.github.io> [--constants <dotaconstants/build>]");
  process.exit(1);
}
const HD = join(site, "tips");
let DC = opt("--constants");
if (!DC) {
  const tmp = mkdtempSync(join(tmpdir(), "dc-"));
  execFileSync("npm", ["pack", "dotaconstants", "--silent", "--pack-destination", tmp], { stdio: "ignore" });
  const tgz = readdirSync(tmp).find((f) => f.endsWith(".tgz"))!;
  execFileSync("tar", ["xzf", join(tmp, tgz), "-C", tmp]);
  DC = join(tmp, "package", "build");
}
const engine = CounterPickEngine.load();
const tax = parse(readFileSync(join(ROOT, "taxonomy.yaml"), "utf8"));
const kbCodes: string[] = Object.keys(tax.hero_tags);
const roster: Array<{ valve: string; label: string }> = JSON.parse(readFileSync(join(ROOT, "data", "roster.json"), "utf8")).heroes;
const valveToCode = new Map(kbCodes.map((c) => [heroValveName(c), c]));
const labelOf = new Map<string, string>();
for (const r of roster) { const c = valveToCode.get(r.valve); if (c) labelOf.set(c, r.label); }

// ---- name dictionary -> hero code -------------------------------------------
const heroNames = new Map<string, string>(); // lowercased phrase -> code
const add = (phrase: string, code: string) => heroNames.set(phrase.toLowerCase(), code);
for (const [c, l] of labelOf) add(l, c);
const ALIAS: Record<string, string[]> = {
  anti_mage: ["AM", "Antimage"], medusa: ["Dusa"], windranger: ["WR", "Windrunner"], wraith_king: ["WK"],
  lifestealer: ["LS", "Naix"], natures_prophet: ["Furion", "NP", "Prophet"], outworld_destroyer: ["OD", "Outworld Devourer"],
  queen_of_pain: ["QoP", "Queen"], shadow_fiend: ["SF"], keeper_of_the_light: ["KotL", "Keeper"], centaur_warrunner: ["Centaur"],
  treant_protector: ["Treant"], vengeful_spirit: ["Venge", "VS"], timbersaw: ["Timber"], rattletrap: ["Clock", "Clockwerk", "Rattletrap"],
  crystal_maiden: ["CM"], phantom_assassin: ["PA"], phantom_lancer: ["PL"], templar_assassin: ["TA"], skywrath_mage: ["Sky", "Skywrath"],
  shadow_shaman: ["Shaman", "Rhasta"], witch_doctor: ["WD"], death_prophet: ["DP"], dark_seer: ["DS"], dragon_knight: ["DK"],
  bounty_hunter: ["BH", "Bounty"], night_stalker: ["NS", "Night Stalker"], spirit_breaker: ["SB", "Spirit Breaker", "Bara"],
  legion_commander: ["LC", "Legion"], monkey_king: ["MK"], elder_titan: ["ET"], ancient_apparition: ["AA"], troll_warlord: ["Troll"],
  naga_siren: ["Naga"], lone_druid: ["LD"], winter_wyvern: ["WW", "Wyvern"], storm_spirit: ["Storm"], ember_spirit: ["Ember"],
  earth_spirit: ["Earth Spirit"], void_spirit: ["Void Spirit"], faceless_void: ["Faceless Void", "Void"], primal_beast: ["PB", "Primal"],
  arc_warden: ["Arc"], underlord: ["Underlord", "Pit Lord"], wisp: ["Wisp", "Io"], snapfire: ["Snap"],
  ogre_magi: ["Ogre"], sand_king: ["SK", "Sand King"], chaos_knight: ["CK"], beastmaster: ["BM", "Beast"], batrider: ["Bat"],
  broodmother: ["Brood"], doom: ["Doom"], sniper: ["Kardel"], tinker: ["Boush"], gyrocopter: ["Gyro"], magnus: ["Mag"], mirana: ["Potm"],
  pangolier: ["Pango"], rubick: ["Rubick"], silencer: ["Silencer"], viper: ["Viper"], visage: ["Visage"], weaver: ["Weaver"], zeus: ["Zeus", "Zuus"],
  enchantress: ["Ench", "Enchantress"], bristleback: ["BB", "Bristle"], tidehunter: ["Tide"], kunkka: ["Kunkka", "Admiral"], marci: ["Marci"],
  hoodwink: ["Hoodwink"], dawnbreaker: ["Dawnbreaker", "Valora"], muerta: ["Muerta"], ringmaster: ["Ringmaster"], kez: ["Kez"], largo: ["Largo"],
};
for (const [c, as] of Object.entries(ALIAS)) if (labelOf.has(c)) for (const a of as) if (a.length >= 2) add(a, c);
// unique ability names -> owner
const ha = JSON.parse(readFileSync(`${DC}/hero_abilities.json`, "utf8"));
const ab = JSON.parse(readFileSync(`${DC}/abilities.json`, "utf8"));
const abilOwner = new Map<string, Set<string>>();
for (const [npc, k] of Object.entries<any>(ha)) {
  const code = valveToCode.get(npc.replace("npc_dota_hero_", ""));
  if (!code) continue;
  for (const a of k.abilities) {
    if (typeof a !== "string") continue;
    const d = ab[a]?.dname;
    if (typeof d !== "string" || d.length < 4) continue;
    const key = d.toLowerCase();
    abilOwner.set(key, new Set([...(abilOwner.get(key) ?? []), code]));
  }
}
const GENERIC = new Set(["blink", "hex", "silence", "shadow walk", "illusions", "release", "return", "cancel", "spirits", "rage", "enrage", "berserk"]);
for (const [d, owners] of abilOwner) if (owners.size === 1 && !GENERIC.has(d) && !heroNames.has(d)) heroNames.set(d, [...owners][0]!);

// items
const items = JSON.parse(readFileSync(`${DC}/items.json`, "utf8"));
const map = parse(readFileSync(join(ROOT, "data", "constants-map.yaml"), "utf8")).items as Record<string, string>;
const dcToOurs = new Map(Object.entries(map).map(([o, d]) => [d, o]));
const itemNames = new Map<string, string>();
for (const [k, v] of Object.entries<any>(items)) {
  if (!v.dname || !(v.cost > 0) || k.startsWith("recipe")) continue;
  itemNames.set(v.dname.toLowerCase(), dcToOurs.get(k) ?? k);
}
for (const [a, i] of Object.entries({ bkb: "black_king_bar", mkb: "monkey_king_bar", "eul's": "euls_scepter", euls: "euls_scepter", linkens: "linkens_sphere", "linken's": "linkens_sphere", "silver edge": "silver_edge", "spirit vessel": "spirit_vessel", vessel: "spirit_vessel", skadi: "eye_of_skadi", "shiva's": "shivas_guard", basher: "skull_basher", abyssal: "abyssal_blade", nullifier: "nullifier", dust: "dust_of_appearance", sentry: "sentry_ward", sentries: "sentry_ward", "force staff": "force_staff", "diffusal": "diffusal_blade", "orchid": "orchid", bloodthorn: "bloodthorn", halberd: "heavens_halberd", "ghost scepter": "ghost_scepter", "blade mail": "blade_mail", "lotus": "lotus_orb", "vyse": "scythe_of_vyse", "sheepstick": "scythe_of_vyse", "radiance": "radiance", "mjollnir": "mjollnir", "pipe": "pipe_of_insight", "glimmer": "glimmer_cape", "atos": "rod_of_atos", gleipnir: "gleipnir", "aeon disk": "aeon_disk", "crimson": "crimson_guard", "solar crest": "solar_crest", "medallion": "medallion_of_courage", "shiva": "shivas_guard", "manta": "manta_style", "satanic": "satanic", "daedalus": "daedalus", "butterfly": "butterfly", "gem": "gem_of_true_sight", "wand": "magic_wand", "stick": "magic_stick" })) itemNames.set(a, i);

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const mkRx = (keys: string[]) => new RegExp(`(?<![A-Za-z'])(${keys.sort((a, b) => b.length - a.length).map(esc).join("|")})(?![A-Za-z])`, "gi");
const heroRx = mkRx([...heroNames.keys()]);
const itemRx = mkRx([...itemNames.keys()]);
const CASE_SENSITIVE_SHORT = /^[A-Z]{2,4}$/; // acronyms must match case

// ---- pages ---------------------------------------------------------------------
const norm = (s: string) => s.toLowerCase().replace(/[^a-z]/g, "");
const pageToCode = new Map<string, string>();
for (const [c, l] of labelOf) pageToCode.set(norm(l), c);
const extra: Record<string, string> = { antimage: "anti_mage", naturesprophet: "natures_prophet", io: "wisp", wisp: "wisp" };
const strip = (h: string) => h.replace(/<[^>]+>/g, " ").replace(/&#39;|&rsquo;/g, "'").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&[a-z]+;/g, " ").replace(/\s+/g, " ").trim();

const NEG = /\b(isn't|is not|aren't|doesn't|does not|don't|can't|cannot|won't|not very|not effective|not that|ineffective|useless|struggle|bad against|avoid|careful|beware|watch out)\b/i;
const out: any[] = [];
const unmapped: string[] = [];
for (const f of readdirSync(HD)) {
  const slug = f.replace(/\.html$/, "");
  const target = pageToCode.get(norm(slug)) ?? extra[norm(slug)] ?? (kbCodes.includes(slug) ? slug : undefined);
  if (!target) { unmapped.push(slug); continue; }
  const html = readFileSync(`${HD}/${f}`, "utf8");
  const ci = html.search(/<h1>\s*Counters\s*<\/h1>/i);
  const sections: Array<[string, string]> = [["tips", html.slice(0, ci)], ["counters", html.slice(ci)]];
  for (const [sec, chunk] of sections) {
    // top-level bullets: split on <li>, keep nested text with parent
    const lis = chunk.split(/<li>/i).slice(1).map((x) => strip(x.split(/<\/ul>\s*<\/li>|<\/li>/i)[0]!));
    for (const text of lis) {
      const heroes = new Set<string>();
      for (const m of text.matchAll(heroRx)) {
        const raw = m[1]!;
        const code = heroNames.get(raw.toLowerCase())!;
        if (raw.length <= 4 && CASE_SENSITIVE_SHORT.test(raw.toUpperCase()) && raw !== raw.toUpperCase() && !labelOf.get(code)?.toLowerCase().startsWith(raw.toLowerCase())) continue;
        if (code !== target) heroes.add(code);
      }
      const its = new Set<string>();
      for (const m of text.matchAll(itemRx)) its.add(itemNames.get(m[1]!.toLowerCase())!);
      if (!heroes.size && !its.size) continue;
      out.push({ target, sec, text, heroes: [...heroes], items: [...its], neg: NEG.test(text) });
    }
  }
}

// ---- engine comparison ------------------------------------------------------
const cache = new Map<string, ReturnType<typeof engine.recommend>>();
const recOf = (t: string) => { if (!cache.has(t)) cache.set(t, engine.recommend({ enemyHeroes: [t] })); return cache.get(t)!; };
for (const o of out) {
  const r = recOf(o.target);
  o.heroStatus = Object.fromEntries(o.heroes.map((h: string) => {
    const i = r.heroes.findIndex((x) => x.code === h);
    return [h, i < 0 ? "none" : `#${i + 1}/${r.heroes.length}:${r.heroes[i]!.score}:${[...new Set(r.heroes[i]!.reasons.map((x) => x.basis))].join("+")}`];
  }));
  o.itemStatus = Object.fromEntries(o.items.map((it: string) => {
    const i = r.items.findIndex((x) => x.code === it);
    return [it, i < 0 ? "none" : `#${i + 1}`];
  }));
}
// ---- report ---------------------------------------------------------------------
const lines = ["# howdoiplay review - counters our engine does not suggest", "", `pages: ${new Set(out.map((o) => o.target)).size}, bullets naming a hero/item: ${out.length}`, ""];
const counters = out.filter((o) => o.sec === "counters" && !o.neg);
const pairs = new Map<string, number>();
for (const o of counters) for (const h of o.heroes) {
  const s = o.heroStatus[h] as string;
  const rank = s === "none" ? 999 : Number(s.split("/")[0]!.slice(1));
  const k = `${h}>${o.target}`;
  pairs.set(k, Math.min(pairs.get(k) ?? 999, rank));
}
const n = pairs.size;
const none = [...pairs.values()].filter((v) => v === 999).length;
const top10 = [...pairs.values()].filter((v) => v <= 10).length;
lines.push(`counter pairs (hero named in a Counters bullet): **${n}** - not suggested ${none} (${Math.round((100 * none) / n)}%), top-10 ${top10} (${Math.round((100 * top10) / n)}%)`, "");
lines.push("Many unmatched pairs are trivia (interactions, Aghanim-only notes). Review the bullets; add TAGS for repeated mechanics, hero_edges only for explicit counters.", "");
let cur = "";
for (const o of counters.sort((a, b) => a.target.localeCompare(b.target))) {
  const miss = o.heroes.filter((h: string) => o.heroStatus[h] === "none");
  if (!miss.length) continue;
  if (o.target !== cur) { lines.push("", `## ${labelOf.get(o.target) ?? o.target}`); cur = o.target; }
  lines.push(`- **${miss.join(", ")}** - ${o.text.slice(0, 280)}`);
}
writeFileSync(join(ROOT, "howdoiplay-report.md"), lines.join("\n") + "\n");
console.log(`howdoiplay-report.md: ${n} counter pairs, ${none} not suggested (${Math.round((100 * none) / n)}%)`);
