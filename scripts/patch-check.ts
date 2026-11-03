// =============================================================================
//  patch:check - what changed in Dota since our KB was last reviewed?
//  (PATCH_RUNBOOK.md step A1)
//
//  Source: the `dotaconstants` npm package (OpenDota's game constants: heroes,
//  items, abilities, patches). Downloaded straight from the npm registry - no
//  dependency, node_modules untouched - or read from a local build dir.
//
//      npm run patch:check                    # latest dotaconstants -> patch-report.md
//      npm run patch:check -- --accept        # ...and save it as the new baseline
//      npm run patch:check -- --from <dir>    # use a local dotaconstants/build dir
//      npm run patch:check -- --version 10.8.0
//
//  Compares against:
//    - our data (roster.json, taxonomy.yaml, items / item_fit / defense / item_edges
//      + the wiki item layer)                                       -> always
//    - data/constants-snapshot.json, the baseline accepted after the last review
//      (ability / item fingerprints)                                -> "what changed"
//  The first run has no baseline: it reports the current state and writes one.
//  Exit code 0 always; `--strict` exits 1 when there are action items (for CI).
// =============================================================================

import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";
import { parse as parseYaml } from "yaml";
import { readRawKB } from "../src/kb.js";
import { heroValveName } from "../src/web/hero-art.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SNAPSHOT = join(ROOT, "data", "constants-snapshot.json");
const REPORT = join(ROOT, "patch-report.md");
const FILES = ["heroes.json", "items.json", "abilities.json", "hero_abilities.json", "neutral_abilities.json", "patch.json"] as const;

const argv = process.argv.slice(2);
const opt = (name: string) => {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] && !argv[i + 1]!.startsWith("--") ? argv[i + 1] : undefined;
};
const flag = (name: string) => argv.includes(name);

// ---------------------------------------------------------------------------
//  dotaconstants types (only what we read)
// ---------------------------------------------------------------------------

interface DCHero { name: string; localized_name: string; attack_type: "Melee" | "Ranged"; primary_attr: string }
interface DCItem {
  dname?: string;
  abilities?: Array<{ title?: string; description?: string }>;
  cost?: number | null;
  qual?: string | null;
  tier?: number | null;
  cd?: number | false;
  mc?: number | false;
  attrib?: Array<{ key: string; value: unknown }>;
}
interface DCAbility { dname?: string; desc?: string; attrib?: Array<{ key: string; value: unknown }>; cd?: unknown; mc?: unknown; dmg_type?: string; bkbpierce?: string; behavior?: unknown }
interface DCHeroAbilities {
  abilities: string[];
  talents?: Array<{ name?: string; level?: number }>;
  facets?: Array<{ name?: string; title?: string; description?: string }>;
}
interface Constants {
  version: string;
  heroes: Record<string, DCHero>;
  items: Record<string, DCItem>;
  abilities: Record<string, DCAbility>;
  heroAbilities: Record<string, DCHeroAbilities>;
  /** neutral creep abilities in the current game (keys -> abilities.json). */
  neutralAbilities: Record<string, unknown>;
  patches: Array<{ name: string; date: string }>;
}

// ---------------------------------------------------------------------------
//  load constants: local dir or npm registry tarball
// ---------------------------------------------------------------------------

/** minimal ustar reader: returns the files whose basename we want. */
function untar(buf: Buffer, want: Set<string>): Map<string, Buffer> {
  const out = new Map<string, Buffer>();
  let off = 0;
  while (off + 512 <= buf.length) {
    const header = buf.subarray(off, off + 512);
    if (header.every((b) => b === 0)) break;
    const str = (a: number, b: number) => header.subarray(a, b).toString("utf8").replace(/\0.*$/s, "");
    const name = (str(345, 500) ? str(345, 500) + "/" : "") + str(0, 100);
    const size = parseInt(str(124, 136).trim() || "0", 8);
    const type = String.fromCharCode(header[156]!);
    const body = off + 512;
    const base = name.split("/").pop()!;
    if ((type === "0" || type === "\0") && /\/build\/[^/]+$/.test(name) && want.has(base)) {
      out.set(base, Buffer.from(buf.subarray(body, body + size)));
    }
    off = body + Math.ceil(size / 512) * 512;
  }
  return out;
}

async function loadConstants(): Promise<Constants> {
  const files = new Map<string, Buffer>();
  let version = "local";
  const from = opt("--from");
  if (from) {
    for (const f of FILES) files.set(f, readFileSync(join(from, f)));
  } else {
    const pin = opt("--version") ?? "latest";
    let meta: { version: string; dist: { tarball: string } };
    let tgz: Buffer;
    try {
      meta = (await (await fetch(`https://registry.npmjs.org/dotaconstants/${pin}`)).json()) as typeof meta;
      console.log(`dotaconstants ${meta.version}: downloading…`);
      tgz = Buffer.from(await (await fetch(meta.dist.tarball)).arrayBuffer());
    } catch (e) {
      throw new Error(
        `cannot reach registry.npmjs.org (${(e as Error).message}).\n` +
          "  Behind a proxy: set HTTPS_PROXY and NODE_USE_ENV_PROXY=1.\n" +
          "  Offline: npm pack dotaconstants, unpack, then  npm run patch:check -- --from <package/build>",
      );
    }
    version = meta.version;
    for (const [k, v] of untar(gunzipSync(tgz), new Set(FILES))) files.set(k, v);
  }
  const json = <T>(f: string): T => {
    const b = files.get(f);
    if (!b) throw new Error(`dotaconstants: ${f} missing`);
    return JSON.parse(b.toString("utf8")) as T;
  };
  return {
    version,
    heroes: json("heroes.json"),
    items: json("items.json"),
    abilities: json("abilities.json"),
    heroAbilities: json("hero_abilities.json"),
    neutralAbilities: json("neutral_abilities.json"),
    patches: json("patch.json"),
  };
}

// ---------------------------------------------------------------------------
//  fingerprints (the baseline stores hashes, not the whole constants)
// ---------------------------------------------------------------------------

const hash = (v: unknown) => createHash("sha1").update(JSON.stringify(v)).digest("hex").slice(0, 12);

function abilityPrint(a: DCAbility | undefined): string {
  if (!a) return "missing";
  return hash([a.dname, a.desc, a.cd, a.mc, a.dmg_type, a.bkbpierce, a.behavior, (a.attrib ?? []).map((x) => [x.key, x.value])]);
}
function itemPrint(i: DCItem): string {
  return hash([i.dname, i.cost, i.qual, i.tier, i.cd, i.mc, (i.attrib ?? []).map((x) => [x.key, x.value]), (i.abilities ?? []).map((x) => x.description)]);
}

interface Snapshot {
  dotaconstants: string;
  patch: string;
  acceptedAt: string;
  /** valve -> ability key -> fingerprint (incl. "facets"). */
  heroes: Record<string, Record<string, string>>;
  /** dotaconstants item key -> fingerprint. */
  items: Record<string, string>;
}

function snapshotOf(c: Constants): Snapshot {
  const heroes: Snapshot["heroes"] = {};
  for (const [npc, ha] of Object.entries(c.heroAbilities)) {
    const valve = npc.replace(/^npc_dota_hero_/, "");
    const abil: Record<string, string> = {};
    for (const key of ha.abilities) if (key !== "generic_hidden") abil[key] = abilityPrint(c.abilities[key]);
    if (ha.facets) abil.facets = hash(ha.facets.map((f) => [f.name, f.title, f.description]));
    heroes[valve] = abil;
  }
  const items: Snapshot["items"] = {};
  for (const [k, v] of Object.entries(c.items)) items[k] = itemPrint(v);
  const last = c.patches[c.patches.length - 1];
  return { dotaconstants: c.version, patch: last?.name ?? "?", acceptedAt: new Date().toISOString(), heroes, items };
}

// ---------------------------------------------------------------------------
//  checks
// ---------------------------------------------------------------------------

type ItemState = "ok" | "removed" | "not in shop" | "neutral now" | "unknown id";
function itemState(i: DCItem | undefined): ItemState {
  if (!i) return "unknown id";
  if (i.tier) return "neutral now";
  if (!i.cost) return i.qual === "consumable" ? "ok" : "not in shop";
  return "ok";
}

async function main(): Promise<void> {
  const c = await loadConstants();
  const raw = readRawKB(ROOT);
  const roster = JSON.parse(readFileSync(join(ROOT, "data", "roster.json"), "utf8")) as {
    heroes: Array<{ valve: string; label: string; attr: string; attack?: string }>;
  };
  const mapDoc = parseYaml(readFileSync(join(ROOT, "data", "constants-map.yaml"), "utf8")) as {
    items?: Record<string, string>;
    abilities_still_current?: string[];
    mechanic_terms?: string[];
  };
  const map = mapDoc.items ?? {};
  const tax = parseYaml(readFileSync(join(ROOT, "taxonomy.yaml"), "utf8")) as { meta?: { patch?: string; reviewed?: string } };
  const prev: Snapshot | undefined = existsSync(SNAPSHOT) ? JSON.parse(readFileSync(SNAPSHOT, "utf8")) : undefined;
  const now = snapshotOf(c);
  const lastPatch = c.patches[c.patches.length - 1]!;

  const actions: string[] = [];
  const lines: string[] = [];
  const h = (t: string) => lines.push("", `## ${t}`, "");

  lines.push(
    `# Patch report — ${new Date().toISOString().slice(0, 10)}`,
    "",
    `- dotaconstants **${c.version}**, latest patch in it: **${lastPatch.name}** (${lastPatch.date.slice(0, 10)})`,
    `- KB reviewed for patch: **${tax.meta?.patch ?? "not set"}**${tax.meta?.reviewed ? ` (reviewed ${tax.meta.reviewed})` : ""}`,
    `- baseline: ${prev ? `dotaconstants ${prev.dotaconstants}, patch ${prev.patch}, accepted ${prev.acceptedAt.slice(0, 10)}` : "**none yet** (this run creates it)"}`,
  );
  if (tax.meta?.patch && tax.meta.patch !== lastPatch.name) {
    actions.push(`KB was reviewed for ${tax.meta.patch}, constants are at ${lastPatch.name}: run the review (B5-B7)`);
  }
  if (!tax.meta?.patch) actions.push("set `meta.patch` / `meta.reviewed` in taxonomy.yaml after the review (B7)");

  // ---- heroes ---------------------------------------------------------------
  h("Heroes");
  const dcHeroes = new Map(Object.values(c.heroes).map((x) => [x.name.replace(/^npc_dota_hero_/, ""), x]));
  const rosterBy = new Map(roster.heroes.map((x) => [x.valve, x]));
  const described = new Set(Object.keys(raw.taxonomy.hero_tags).map(heroValveName));
  const newHeroes = [...dcHeroes.keys()].filter((v) => !rosterBy.has(v));
  const goneHeroes = [...rosterBy.keys()].filter((v) => !dcHeroes.has(v));
  const untagged = roster.heroes.filter((x) => !described.has(x.valve));
  const attackChanged = roster.heroes.filter((x) => {
    const d = dcHeroes.get(x.valve);
    return d && x.attack && d.attack_type.toLowerCase() !== x.attack;
  });
  const attrChanged = roster.heroes.filter((x) => {
    const d = dcHeroes.get(x.valve);
    return d && d.primary_attr !== x.attr;
  });
  lines.push(`- ${dcHeroes.size} heroes in constants, ${rosterBy.size} in roster.json, ${described.size} described in the KB`);
  const list = (title: string, xs: string[], action?: string) => {
    if (!xs.length) return;
    lines.push(`- **${title} (${xs.length}):** ${xs.join(", ")}`);
    if (action) actions.push(`${action}: ${xs.join(", ")}`);
  };
  list("NEW heroes", newHeroes.map((v) => dcHeroes.get(v)!.localized_name), "new heroes → `npm run build:roster` + `fetch:portraits`, then hero_tags (B5)");
  list("heroes no longer in constants", goneHeroes.map((v) => rosterBy.get(v)!.label), "check removed heroes");
  list("roster heroes without hero_tags", untagged.map((x) => x.label), "describe in taxonomy.yaml (B5)");
  list("attack type changed", attackChanged.map((x) => `${x.label} (${x.attack} → ${dcHeroes.get(x.valve)!.attack_type.toLowerCase()})`), "rebuild roster (attack) and re-check item_fit");
  list("primary attribute changed", attrChanged.map((x) => `${x.label} (${x.attr} → ${dcHeroes.get(x.valve)!.primary_attr})`), "rebuild roster (grid column)");

  // abilities changed since the baseline
  if (prev) {
    const changed: string[] = [];
    for (const [valve, abil] of Object.entries(now.heroes)) {
      const before = prev.heroes[valve];
      if (!before) continue;
      const diff = Object.keys({ ...abil, ...before }).filter((k) => abil[k] !== before[k]);
      if (diff.length) {
        const label = rosterBy.get(valve)?.label ?? valve;
        const names = diff.map((k) => (k === "facets" ? "facets" : c.abilities[k]?.dname ?? k));
        changed.push(`${label} (${names.join(", ")})`);
      }
    }
    list("heroes whose abilities changed since the baseline", changed, "review hero_tags / special_cases / hero_edges for");
    if (!changed.length) lines.push("- no ability changes since the baseline");
  } else {
    lines.push("- ability diff: no baseline yet — the next run after a patch will list changed heroes");
  }

  // ---- items ------------------------------------------------------------------
  h("Items referenced by the KB");
  const refs = new Map<string, Set<string>>(); // our id -> where it is used
  const use = (id: string, where: string) => (refs.get(id) ?? refs.set(id, new Set()).get(id)!).add(where);
  for (const i of raw.items) use(i.code, "items.yaml");
  for (const id of Object.keys(raw.itemFit?.fit ?? {})) use(id, "item_fit");
  for (const d of raw.defenseEdges) use(d.item, "defense.yaml");
  for (const e of raw.itemEdges) use(e.item, e.source === "wiki" ? "wiki" : "item_edges.yaml");
  const dcKey = (id: string) => map[id] ?? id;
  const unavailable = new Set(raw.itemFit?.unavailable ?? []);
  const bad: string[] = [];
  const unknown: string[] = [];
  for (const [id, where] of [...refs].sort()) {
    const st = itemState(c.items[dcKey(id)]);
    if (unavailable.has(id)) {
      if (st === "ok") bad.push(`${c.items[dcKey(id)]?.dname ?? id} \`${id}\` — marked unavailable but IS in the shop again (item_fit.yaml unavailable)`);
      continue;
    }
    if (st === "ok") continue;
    const label = c.items[dcKey(id)]?.dname ?? id;
    const entry = `${label} \`${id}\` — ${st} (used in ${[...where].join(", ")})`;
    (st === "unknown id" ? unknown : bad).push(entry);
  }
  lines.push(`- ${refs.size} item ids referenced${unavailable.size ? `, ${unavailable.size} marked unavailable (never recommended): ${[...unavailable].join(", ")}` : ""}`);
  if (bad.length) {
    lines.push("- **not buyable any more:**", ...bad.map((x) => `  - ${x}`));
    actions.push(`add to \`unavailable\` in data/item_fit.yaml (or re-check) ${bad.length} item(s) (B6)`);
  } else lines.push("- all referenced items are still in the shop");
  if (unknown.length) {
    lines.push("- **id not found in constants** (add to data/constants-map.yaml or fix the id):", ...unknown.map((x) => `  - ${x}`));
    actions.push(`map ${unknown.length} unknown item id(s) in data/constants-map.yaml`);
  }
  if (prev) {
    const ourKeys = new Set([...refs.keys()].map(dcKey));
    const changedItems = [...ourKeys].filter((k) => prev.items[k] && now.items[k] && prev.items[k] !== now.items[k]);
    list("KB items whose stats/effects changed since the baseline", changedItems.map((k) => c.items[k]?.dname ?? k), "re-check tags / fit of");
    const added = Object.keys(now.items).filter(
      (k) => !prev.items[k] && (c.items[k]?.cost ?? 0) > 0 && !c.items[k]?.tier && !k.startsWith("recipe_"),
    );
    list("NEW buyable items in the game", added.map((k) => c.items[k]?.dname ?? k), "consider tags + fit for new items");
  }
  // big shop items the KB never mentions (informational)
  const ourKeys = new Set([...refs.keys()].map(dcKey));
  const ourNames = new Set([...ourKeys].map((k) => c.items[k]?.dname).filter(Boolean));
  const uncovered = [
    ...new Set(
      Object.entries(c.items)
        .filter(([k, v]) => !ourKeys.has(k) && !k.startsWith("recipe_") && !v.tier && v.dname && !ourNames.has(v.dname))
        .filter(([k]) => !/_[2-9]$/.test(k)) // upgrade levels (Dagon 2-5, Necronomicon 2-3)
        .filter(([, v]) => (v.cost ?? 0) >= 2000 && ["rare", "epic", "artifact"].includes(v.qual ?? ""))
        .filter(([, v]) => !/^Aghanim's Blessing/.test(v.dname!))
        .map(([, v]) => v.dname!),
    ),
  ].sort();
  if (uncovered.length) lines.push(`- shop items ≥2000 gold the KB never recommends (${uncovered.length}, info): ${uncovered.join(", ")}`);

  // ---- wiki texts naming abilities that are not in the game any more ------------
  h("Wiki texts mentioning abilities not in the current game");
  const current = new Set<string>();
  const dn = (a: DCAbility | undefined) => (typeof a?.dname === "string" ? a.dname : undefined);
  for (const ha of Object.values(c.heroAbilities)) {
    for (const k of ha.abilities ?? []) {
      const d = typeof k === "string" ? dn(c.abilities[k]) : undefined;
      if (d) current.add(d.toLowerCase());
    }
    for (const f of ha.facets ?? []) if (typeof f?.title === "string") current.add(f.title.toLowerCase());
    // current talents ("Doom applies Mute") are names the wiki may quote too
    for (const t of ha.talents ?? []) {
      const d = typeof t?.name === "string" ? dn(c.abilities[t.name]) : undefined;
      if (d) current.add(d.toLowerCase());
    }
  }
  for (const it of Object.values(c.items)) {
    if (it.dname) current.add(it.dname.toLowerCase());
    for (const a of it.abilities ?? []) if (typeof a.title === "string") current.add(a.title.toLowerCase());
  }
  // neutral creeps still in the game (Doom's Devour / Chen / Enchantress use them)
  for (const k of Object.keys(c.neutralAbilities)) {
    const d = dn(c.abilities[k]);
    if (d) current.add(d.toLowerCase());
  }
  // summon / sub-unit abilities (Brewmaster spirits, Spirit Bear) are not in the hero
  // kits but still exist - curated in data/constants-map.yaml
  for (const a of mapDoc.abilities_still_current ?? []) current.add(a.toLowerCase());
  // game terms that happen to match old ability names ("Spell Immunity", "True Strike")
  for (const a of mapDoc.mechanic_terms ?? []) current.add(a.toLowerCase());
  // only multi-word names: single words ("Poison", "Purge", "Tempest") are ordinary
  // English / parts of current names and drown the signal
  const gone = [
    ...new Set(
      Object.values(c.abilities)
        .map(dn)
        .filter((d): d is string => !!d && /\s/.test(d.trim()) && !current.has(d.toLowerCase()) && !/\bpierces\b/i.test(d)),
    ),
  ].sort((a, b) => b.length - a.length);
  // 1) which retired names does the scraped wiki still use (any note, not just the
  //    displayed one)? -> data/retired-abilities.json, read by the KB loader, which
  //    then shows a hero's next clean note or drops the point (src/kb.ts freshNote)
  const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const rx = gone.length ? new RegExp(`(?<![A-Za-z])(${gone.map(esc).join("|")})(?![A-Za-z])`, "g") : undefined;
  const wikiPath = join(ROOT, "data", "wiki-counters.json");
  type Page = Record<string, Array<{ notes?: string[]; note?: string }> | undefined>;
  const pages: Record<string, Page> = existsSync(wikiPath) ? (JSON.parse(readFileSync(wikiPath, "utf8")).pages ?? {}) : {};
  const used = new Map<string, number>();
  for (const page of Object.values(pages)) {
    for (const list of Object.values(page)) {
      for (const e of list ?? []) {
        for (const t of [...(e.notes ?? []), ...(e.note ? [e.note] : [])]) {
          for (const m of new Set(rx ? t.match(rx) ?? [] : [])) used.set(m, (used.get(m) ?? 0) + 1);
        }
      }
    }
  }
  const retired = [...used.keys()].sort();
  const retiredPath = join(ROOT, "data", "retired-abilities.json");
  const prevRetired = existsSync(retiredPath) ? (JSON.parse(readFileSync(retiredPath, "utf8")).names ?? []) as string[] : [];
  writeFileSync(
    retiredPath,
    JSON.stringify({ note: "written by npm run patch:check - ability names in wiki-counters.json that are not in the current game", constants: c.version, names: retired }, null, 2) + "\n",
  );
  lines.push(
    `- the scraped wiki names **${retired.length}** retired abilit${retired.length === 1 ? "y" : "ies"} in ${[...used.values()].reduce((a, b) => a + b, 0)} note(s): ` +
      (retired.slice(0, 12).map((n) => `${n} ×${used.get(n)}`).join(", ") || "none") + (retired.length > 12 ? ", …" : ""),
  );
  lines.push("  - handled automatically: the KB shows the hero's next note that is up to date, or drops that wiki point (data/retired-abilities.json)");
  const newlyRetired = retired.filter((n) => !prevRetired.includes(n));
  if (newlyRetired.length) actions.push(`re-scrape the wiki (A4): it still describes ${newlyRetired.length} newly retired abilit${newlyRetired.length === 1 ? "y" : "ies"} (${newlyRetired.slice(0, 5).join(", ")})`);

  // 2) safety net: what the app will actually DISPLAY after that fallback
  const shown = readRawKB(ROOT);
  const texts: Array<{ kind: string; who: string; text: string }> = [
    ...shown.combos.map((x) => ({ kind: "combo", who: x.pair.join(" + "), text: x.mechanism })),
    ...shown.heroEdges.filter((e) => e.source === "wiki").map((e) => ({ kind: "counter", who: `${e.subject} vs ${e.target}`, text: e.mechanism })),
    ...shown.itemEdges.filter((e) => e.source === "wiki").map((e) => ({ kind: "item", who: `${e.item} vs ${e.target}`, text: e.mechanism })),
  ];
  const stale = new Map<string, string[]>();
  for (const t of texts) {
    for (const m of new Set(rx ? t.text.match(rx) ?? [] : [])) {
      stale.set(m, [...(stale.get(m) ?? []), `${t.kind} ${t.who}`]);
    }
  }
  if (stale.size) {
    const n = new Set([...stale.values()].flat()).size;
    lines.push(`- **${n} displayed text(s)** still name ${stale.size} retired abilit${stale.size === 1 ? "y" : "ies"}:`);
    for (const [name, where] of [...stale].sort((a, b) => b[1].length - a[1].length)) {
      lines.push(`  - "${name}" ×${where.length}: ${where.slice(0, 4).join("; ")}${where.length > 4 ? "; …" : ""}`);
    }
    lines.push(
      "  - fix: curated text (combos/hero_edges/item_edges yaml) - correct it; if the ability still exists (a summon's), add it to `abilities_still_current` in data/constants-map.yaml",
    );
    actions.push(`${n} displayed text(s) mention ${stale.size} ability name(s) no longer in the game`);
  } else {
    lines.push("- displayed texts: none name a retired ability");
  }

  // ---- other layers -------------------------------------------------------------
  h("Data freshness");
  const age = (f: string) => {
    const p = join(ROOT, "data", f);
    if (!existsSync(p)) return undefined;
    return statSync(p).mtime;
  };
  const patchDate = new Date(lastPatch.date);
  for (const [f, what, step] of [
    ["matchups.json", "win rates (OpenDota)", "A3"],
    ["wiki-counters.json", "wiki counters", "A4"],
  ] as const) {
    const m = age(f);
    if (!m) {
      lines.push(`- ${what}: \`data/${f}\` missing`);
      continue;
    }
    const stale = m < patchDate;
    lines.push(`- ${what}: updated ${m.toISOString().slice(0, 10)}${stale ? ` — **older than patch ${lastPatch.name}**` : ""}`);
    if (stale) actions.push(`refresh ${what} (${step}) - ideally 1-2 weeks after the patch`);
  }
  const tentative = (readFileSync(join(ROOT, "taxonomy.yaml"), "utf8").match(/^ {2}(\w+):.*TENTATIVE/gm) ?? []).map((l) => l.trim().split(":")[0]);
  if (tentative.length) lines.push(`- hero_tags marked TENTATIVE: ${tentative.join(", ")}`);

  // ---- summary ------------------------------------------------------------------
  const summary = actions.length
    ? ["", "## Action items", "", ...actions.map((a) => `- [ ] ${a}`)]
    : ["", "## Action items", "", "- nothing to do"];
  lines.splice(5, 0, ...summary);

  writeFileSync(REPORT, lines.join("\n") + "\n", "utf8");
  if (!prev || flag("--accept")) {
    writeFileSync(SNAPSHOT, JSON.stringify(now) + "\n", "utf8");
    console.log(`${prev ? "baseline updated" : "baseline created"}: data/constants-snapshot.json`);
  }
  console.log(`patch-report.md: ${actions.length} action item(s)`);
  for (const a of actions) console.log(`  - ${a}`);
  if (flag("--strict") && actions.length) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
