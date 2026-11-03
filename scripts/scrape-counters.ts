// =============================================================================
//  Scrape per-hero counter data from the Dota 2 Fandom wiki (/Counters pages)
//  into clean structured JSON: data/wiki-counters.json.
//
//  Source: dota2.fandom.com MediaWiki API (action=parse&prop=wikitext). The
//  wikitext is far cleaner to parse than the rendered HTML. We pull three
//  sections per hero:
//     "Bad against..."     -> heroes that COUNTER this hero
//     "Good against..."    -> heroes this hero beats
//     "Works well with..." -> synergy partners
//  Hero names are resolved to our codes via data/roster.json.
//
//  Run:  npx tsx scripts/scrape-counters.ts                 (all hero_tags heroes)
//        npx tsx scripts/scrape-counters.ts witch_doctor anti_mage   (subset)
//
//  This is a build-time data tool. The committed JSON is the artifact; the engine
//  reads it (kb.ts), it is NOT fetched at runtime (ADR-006).
// =============================================================================

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readRawKB } from "../src/kb.js";
import { heroValveName } from "../src/web/hero-art.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/124.0 Safari/537.36";

interface RosterHero { valve: string; label: string }
interface CounterEntry { code: string | null; name: string; notes: string[] }
interface ItemEntry { slug: string; name: string; note: string }
interface HeroCounters {
  page: string;
  badAgainst: CounterEntry[];
  items: ItemEntry[];
  goodAgainst: CounterEntry[];
  synergy: CounterEntry[];
}

// --- name <-> code resolution ------------------------------------------------

function buildMaps() {
  const kb = readRawKB(ROOT);
  const roster = JSON.parse(
    readFileSync(join(ROOT, "data", "roster.json"), "utf8"),
  ) as { heroes: RosterHero[] };

  const valveToCode = new Map<string, string>();
  for (const code of Object.keys(kb.taxonomy.hero_tags)) {
    valveToCode.set(heroValveName(code), code);
  }
  const labelToCode = new Map<string, string>();
  const codeToLabel = new Map<string, string>();
  const codeToValve = new Map<string, string>();
  for (const h of roster.heroes) {
    const code = valveToCode.get(h.valve) ?? h.valve;
    labelToCode.set(h.label.toLowerCase(), code);
    codeToLabel.set(code, h.label);
    codeToValve.set(code, h.valve);
  }
  return { kb, labelToCode, codeToLabel };
}

// --- wikitext cleaning -------------------------------------------------------

/** Strip wiki/template markup from a bullet line to plain prose. */
function clean(s: string): string {
  let t = s;
  // {{A|Ability|Hero}} / {{A|Ability}} -> Ability ; {{I|Item}} -> Item ; {{H|Hero}} -> Hero
  t = t.replace(/\{\{[AIHWUui]\|([^|}]+)(?:\|[^}]*)?\}\}/g, "$1");
  // any other simple template -> its first arg
  t = t.replace(/\{\{[^|{}]*\|([^|{}]+)(?:\|[^{}]*)?\}\}/g, "$1");
  // leftover bare templates -> drop
  t = t.replace(/\{\{[^{}]*\}\}/g, "");
  // links [[Page|Text]] -> Text ; [[Page]] -> Page
  t = t.replace(/\[\[(?:[^\]|]*\|)?([^\]]+)\]\]/g, "$1");
  // bold/italic and refs
  t = t.replace(/'''?/g, "").replace(/<ref[^>]*>.*?<\/ref>/g, "").replace(/<[^>]+>/g, "");
  return t.replace(/\s+/g, " ").trim();
}

// --- section parsing ---------------------------------------------------------

type Section = "badAgainst" | "goodAgainst" | "synergy";
const SECTIONS: Record<string, Section> = {
  "Bad against...": "badAgainst",
  "Good against...": "goodAgainst",
  "Works well with...": "synergy",
};

function parseSectionBody(
  body: string,
  labelToCode: Map<string, string>,
  unresolved: Set<string>,
): CounterEntry[] {
  // cut off item subsections (=== Items ===) - we only want hero entries
  const heroPart = body.split(/^===/m)[0] ?? body;
  const entries: CounterEntry[] = [];
  const labelRe = /\{\{hero label\|([^|}]+)[^}]*\}\}/g;
  const matches = [...heroPart.matchAll(labelRe)];
  for (let i = 0; i < matches.length; i++) {
    const name = matches[i]![1]!.trim();
    if (name.includes("=")) continue; // skip malformed labels like "border=skyblue"
    const start = matches[i]!.index! + matches[i]![0].length;
    const end = i + 1 < matches.length ? matches[i + 1]!.index! : heroPart.length;
    const block = heroPart.slice(start, end);
    const notes = block
      .split("\n")
      .filter((l) => /^\*+\s/.test(l))
      .map((l) => clean(l.replace(/^\*+\s*/, "")))
      .filter((l) => l.length > 0);
    const code = labelToCode.get(name.toLowerCase()) ?? null;
    if (!code) unresolved.add(name);
    entries.push({ code, name, notes });
  }
  return entries;
}

/** Parse the "=== Items ===" subsection of a Bad-against body into item counters. */
function parseItems(body: string): ItemEntry[] {
  const idx = body.indexOf("=== Items ===");
  if (idx < 0) return [];
  const sub = (body.slice(idx + "=== Items ===".length).split(/^===/m)[0] ?? "");
  const items: ItemEntry[] = [];
  for (const line of sub.split("\n")) {
    const m = line.match(/^\*+\s*\{\{I\|([^|}]+)[^}]*\}\}(.*)$/);
    if (!m) continue;
    const name = m[1]!.trim();
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
    items.push({ slug, name, note: clean(m[2] ?? "") });
  }
  return items;
}

async function fetchWikitext(page: string): Promise<string | null> {
  const url =
    `https://dota2.fandom.com/api.php?action=parse&page=${encodeURIComponent(page)}` +
    `&prop=wikitext&format=json&redirects=1`;
  const res = await fetch(url, { headers: { "user-agent": UA, accept: "application/json" } });
  if (!res.ok) return null;
  const json = (await res.json()) as { parse?: { wikitext?: { "*": string } }; error?: unknown };
  return json.parse?.wikitext?.["*"] ?? null;
}

function parsePage(
  wikitext: string,
  page: string,
  labelToCode: Map<string, string>,
  unresolved: Set<string>,
): HeroCounters {
  const out: HeroCounters = { page, badAgainst: [], items: [], goodAgainst: [], synergy: [] };
  // split into level-2 sections ONLY (lookarounds exclude level-3 ===headers===,
  // so a "Bad against" body keeps its "=== Items ===" subsection).
  const parts = wikitext.split(/^==(?!=)[ ]*(.+?)[ ]*(?<!=)==[ ]*$/m);
  for (let i = 1; i < parts.length; i += 2) {
    const title = parts[i]!.trim();
    const body = parts[i + 1] ?? "";
    const key = SECTIONS[title];
    if (key) out[key] = parseSectionBody(body, labelToCode, unresolved);
    if (title === "Bad against...") out.items = parseItems(body);
  }
  return out;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main(): Promise<void> {
  const { labelToCode, codeToLabel } = buildMaps();
  const argv = process.argv.slice(2);
  // default: the FULL roster (cores + untagged), so every selectable enemy is covered.
  const codes = argv.length ? argv : [...codeToLabel.keys()];

  const pages: Record<string, HeroCounters> = {};
  const unresolved = new Set<string>();
  const failed: string[] = [];

  for (const code of codes) {
    const label = codeToLabel.get(code);
    if (!label) {
      failed.push(`${code} (no roster label)`);
      continue;
    }
    const page = `${label.replace(/ /g, "_")}/Counters`;
    const wt = await fetchWikitext(page);
    if (!wt) {
      failed.push(page);
      continue;
    }
    pages[code] = parsePage(wt, page, labelToCode, unresolved);
    const p = pages[code]!;
    console.log(
      `${code.padEnd(20)} bad ${p.badAgainst.length}  good ${p.goodAgainst.length}  synergy ${p.synergy.length}`,
    );
    await sleep(250); // be polite to the wiki
  }

  const result = {
    source: "https://dota2.fandom.com (CC-BY-SA)",
    fetchedFor: Object.keys(pages),
    pages,
    unresolvedNames: [...unresolved].sort(),
  };
  writeFileSync(join(ROOT, "data", "wiki-counters.json"), JSON.stringify(result, null, 0) + "\n", "utf8");
  console.log(`\nwrote data/wiki-counters.json (${Object.keys(pages).length} heroes)`);
  if (failed.length) console.log(`failed pages: ${failed.join(", ")}`);
  if (unresolved.size) console.log(`unresolved names (${unresolved.size}): ${[...unresolved].slice(0, 20).join(", ")}${unresolved.size > 20 ? " ..." : ""}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
