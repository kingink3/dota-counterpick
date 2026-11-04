# Dota Counter-Pick Engine - MVP (KB-only)

Explainable counter-pick / counter-build rule-engine for Dota 2. Implements the
**ADR-012** engine contract against the knowledge base in
[`taxonomy.yaml`](taxonomy.yaml). The core ranking is **KB-only** (ADR-004); an optional
Phase-2 **stat layer** (hero-vs-hero win rates from OpenDota) is now layered on top as
additive info - it shows but does not drive the rank.

The differentiator (per [`DECISIONS.md`](DECISIONS.md)) is **explainability**: every
recommendation comes with the *mechanism* of why it counters the enemy, not just a
number.

## Run it

```bash
npm install

# Web UI (ADR-001: standalone, deploy by URL)
npm run serve                          # build + serve at http://localhost:5173
npm run build:web                      # emit web/ as a static site (kb.json + app.js)

# CLI / engine
npm run demo                           # built-in showcase drafts
npm run demo -- riki clinkz slark      # ad-hoc: enemy hero codes
npm run demo -- --role 3 sven ursa     # filter hero recs to a position
npm run demo -- --factors medusa       # show the numeric factor breakdown
npm test                               # behavior + guard tests
npm run typecheck
```

Hero/enemy codes are the keys of `hero_tags:` in `taxonomy.yaml` (e.g. `riki`,
`phantom_lancer`, `storm_spirit`).

The web UI is a framework-free reactive picker laid out like the in-game draft screen:
the **full Dota roster** (127 heroes, from `data/roster.json`) in four attribute columns
(Str / Agi / Int / Universal), searchable, with portraits (self-hosted in `web/heroes/`),
a selected-enemy strip, and a role filter. Click enemy heroes, optionally pick your role,
and the ranked + explained recommendations recompute on every change (ADR-002).

Heroes that exist in the KB drive the real counter logic; the **~37 not-yet-tagged
heroes are greyed but still selectable** - picking one honestly yields "no known
counters" (ADR-004/011) rather than hiding it. The UI runs the **same** engine core as
the CLI/tests - the browser just fetches pre-built `kb.json` + `roster.json` (ADR-006:
YAML → static JSON, no runtime DB). Portraits are **self-hosted** under `web/heroes/`
(downloaded once via `npm run fetch:portraits`) rather than hot-linked from Steam's CDN,
which is blocked on some networks; any missing file degrades to a named tile.

The roster is regenerated with `npm run build:roster` (one-off static pull from OpenDota
- hero names/attributes only, **not** a runtime stat dependency; ADR-004/005 stand). It
needs network once; if Node's fetch is blocked, pass a pre-downloaded file:
`curl -s https://api.opendota.com/api/heroes -o h.json && npm run build:roster -- h.json`.

## How it works

The engine is a pure function of the KB and a `DraftState` (ADR-002 - it never asks
where the draft came from):

```
recommend({ enemyHeroes, myRole?, myHero? }) -> { heroes[], items[], uncovered[] }
```

**Resolution (ADR-012 §1–§4):**

1. **Census** - count the enemy team's reliance tags (drives `min_targets`).
2. **Edge basis (tag → tag)** - for every `tool` tag a candidate carries, walk the
   `tool → reliance` edges and match enemies carrying that reliance. Score =
   `tool_weight × edge_weight × reliance_weight`. One edge
   (`detection → relies_on_invisibility`) covers dozens of hero pairs (ADR-007).
3. **Guards (ADR-009/010)** - BKB-guards (`unless_target_tag: bkb_reliant`,
   escapable via `or_tool_tag: bkb_piercing_disable`), hybrid-trap exclusions
   (`exclude_target_tag`, e.g. true_strike vs Faceless Void's backtrack), and the
   census `min_targets` gate.
4. **Hero → hero enrichment (ADR-012 §3)** - point overrides from
   [`data/hero_edges.yaml`](data/hero_edges.yaml) layered on top of the tag basis,
   for matchups the tag vocabulary can't express (ships with AA → Huskar).
5. **Two-sided scoring (ADR-020)** - a candidate is also judged by what it
   *endures*: `resistance` + `resist_edges` (Mana Shield vs health-based damage,
   own debuff immunity vs silences, …) add score; enemy tools that hit the
   candidate's own reliances (edges reversed) and candidate tools blunted by an
   enemy resistance subtract it (scaled, capped per enemy, `pierced_by` exceptions).
   Blunting also applies to what the candidate's damage rests on (a right-clicker into
   evasion, lifesteal into Mana Shield - ADR-022); a net-negative pick is not shown.
   Composition (ADR-023): `team_needs` (disable, control through BKB, wave clear,
   saves, purge) and the damage mix of your allies add a bonus to picks that fill a
   gap; with a role set, reasons vs your lane opponents count x1.25.
6. **Explainability (ADR-012 §4)** - every point of score is backed by a `Reason`
   with its mechanism string; nothing scores silently.

**Heroes ∪ items.** Items are just subjects that carry `tool` tags
([`data/items.yaml`](data/items.yaml), curated from `tool.sources_hint`), run through
the *same* edges (ADR-007). Items are KB-only by nature - item-vs-hero winrate does
not exist (ADR-011).

**Point counters (hero & item).** Famous matchups the tag layer can't express live in
[`data/hero_edges.yaml`](data/hero_edges.yaml) (hero → enemy, e.g. Huskar vs Anti-Mage,
Muerta vs Necrophos) and [`data/item_edges.yaml`](data/item_edges.yaml) (item → enemy,
e.g. Nullifier vs Necrophos). They layer on top of the tag basis with their own mechanism.

**Wiki counter layer (scraped).** `scripts/scrape-counters.ts` pulls every hero's
`/Counters` page (full roster, ~124 heroes) from the Dota 2 Fandom wiki (MediaWiki API)
into `data/wiki-counters.json`, parsing three sections per hero into the engine's layers:
- *Bad against* → `hero_edge`s (which heroes counter this enemy)
- *Items* → `item_edge`s (which items counter this enemy)
- *Works well with* → `combo`s (synergy partners, searchable in the combos panel)

All carry `source: "wiki"`, a **low weight (0.5)**, are **capped per enemy** (14 heroes /
8 items) to bound size, and lose to any curated entry for the same pair. They may target
**any roster hero**, so even heroes not modelled in `hero_tags` (untagged supports like
Clockwerk) get counter coverage instead of landing in the honest-gaps list. Every wiki
reason carries a `wiki` badge. Honest by construction (ADR-004): scraped prose is
labelled, not passed off as expert-vetted. Regenerate with `npm run scrape:counters`
(network). Wiki text is CC-BY-SA, © Dota 2 Fandom contributors.

**Magic / physical damage read.** The engine reads the enemy team's school lean two ways:
*offense* (are they softer to physical via `low_armor` or magic via `magic_burst_vulnerable`)
and *defense* (do they deal physical vs magic burst). Each recommendation also gets a
`school` badge from its dominant counter route. Surfaced as a "Damage read" line.

**Allied synergy in recommendations.** The draft has two sides: `enemyHeroes` and
`allyHeroes`. A hero pick is scored on **both** axes at once - counter value vs the enemy
team *plus* synergy with your already-picked allies (from the wiki "Works well with"
data, weight 0.6 each). So drafting your pos-2/3 against 4 enemies with 2 allies surfaces
heroes that counter the enemy AND combo with your team. In a card, counter reasons render
first and synergy reasons last. The UI counter view lets you click heroes into either
side (Enemy / My team toggle).

**My-hero item tailoring.** Star one of your allies as the hero you're playing (`myHero`).
Item builds are then tailored to it: a pure support (pos 4/5) has greedy/farm-dependent
core items (BKB, Shiva's, Assault, MKB, …) down-weighted ×0.35, so a pos-5 is no longer
told to rush carry items. A position-light heuristic (ADR-004 honest), shown via a
"tailored for X" banner.

**Combos (separate view).** The UI splits into two top-level modes: **Counter picks**
(enemy-driven) and **Combos**. The Combos view is a hero grid: pick a hero (or type a
name) to see its synergies; nothing shows until you do. The list is built entirely from
the wiki "Works well with" sections (~760 duos, no curated list) and **ordered strongest
first** - a pair mentioned on *both* heroes' pages (`strength 2`, badged "mutual") ranks
above a one-way mention. Combo codes are validated against the full roster at build time,
so roster-only supports work too.

**Damage-type read & school-based defense.** The engine reads the enemy team's damage
school from broad signals - `attack_reliant` right-clickers deal physical, `spell_reliant`
casters deal magic (plus the dedicated burst tools). The defensive layer keys armor items
(Crimson Guard, Shiva's, Assault, Ghost) on `school: physical` and magic-resist items
(BKB, Pipe, Hood, Eternal Shroud) on `school: magic`, so a right-click lineup gets armor
and a caster lineup gets magic resist - not just the narrow burst tools. The offensive
"softer to" read uses `low_armor` (→ physical), `magic_burst_vulnerable` (→ magic) and
`high_armor` (physical mitigated → magic), with `squishy_to_burst` counting toward both.
Two distinct magic routes: `magic_burst` (Dagon/Lina) kills *magically-fragile* squishies,
while `magic_damage` items that ignore armor (Revenant's Brooch, Veil) answer *high-armor*
tanks (Timbersaw, Dragon Knight, Bristleback) - magic bypasses the armor; `armor_reduction`
(Desolator/AC) is the physical alternative there. Per-hero armor/MR tagging is an ongoing
expert pass (ADR-011) - lineups with no vulnerability tag honestly read "mixed".

**Defensive layer (the mirror).** Offensive edges answer "what does the enemy *rely on*";
the defensive layer ([`data/defense.yaml`](data/defense.yaml)) answers the build-time
mirror: "what is the enemy's *threat tool*, and what item blocks it". Each entry is an
enemy `tool` (threat) → defensive item, resolved against the enemy team's **tool census**
(`enemyToolWeight × weight`), each with its own mechanism. Honesty holds: threats with no
clean item answer (break, healing-reduction, raw mana-burn) are left out, and BKB is
deliberately absent from the `bkb_piercing_disable` block - those disables pierce it, so
Linken's / Aeon Disk are the honest answers. Output lands in `EngineResult.defense`.

**Honest gaps (ADR-004).** Enemies with no known counter are listed under
`uncovered` and printed as "no strong known counters found" rather than fabricated.

## Layout

| File | Role |
|---|---|
| `taxonomy.yaml` | KB / source of truth |
| `data/items.yaml` | curated item → tool catalog |
| `data/hero_edges.yaml` | hero → hero point counters (e.g. Huskar vs Anti-Mage) |
| `data/item_edges.yaml` | item → hero point counters (e.g. Nullifier vs Necrophos) |
| `data/item_traits.yaml` | what holding an item adds to an enemy hero (BKB, Butterfly, Linken's…) - ADR-024 |
| `data/combos.yaml` | curated combos (Infest + initiators, Surge + Doom…); listed before wiki combos (ADR-021) |
| `data/wiki-counters.json` | scraped Fandom wiki counters + synergies (generated, CC-BY-SA) |
| `data/matchups.json` | hero-vs-hero win rates (stat layer, from OpenDota; generated) |
| `scripts/scrape-counters.ts` | wiki `/Counters` scraper → `wiki-counters.json` |
| `data/defense.yaml` | defensive layer: enemy threat tool → item to build |
| `data/roster.json` | full hero roster for the picker (name/attr; generated) |
| `src/types.ts` | KB + engine I/O data structures |
| `src/knowledge.ts` | pure KB indexing + validation (fs-free; browser-safe) |
| `src/kb.ts` | disk loader (YAML → RawKB → `indexKB`) |
| `src/census.ts` | enemy-team tag census |
| `src/conditions.ts` | guard / condition evaluation |
| `src/resolver.ts` | edge resolution + scoring (engine core) |
| `src/explain.ts` | mechanism-first text rendering (CLI) |
| `src/engine.ts` | public API (`CounterPickEngine`) |
| `src/cli.ts` | demo CLI |
| `src/web/main.ts` | browser UI (same engine core, DOM rendering) |
| `src/web/game-view.ts` | Game tab: clock display, map-event timers (ADR-026) |
| `src/clock-match.ts` | reads the in-game clock from the top bar; pause / pre-horn |
| `src/game-timers.ts` | map-event schedule (`data/timings.yaml`) → next events |
| `src/item-match.ts` | bottom-HUD inventory + name plate; `locateHud` finds the panel |
| `src/web/hero-art.ts` | hero code → local portrait path (presentation only) |
| `scripts/fetch-portraits.ts` | download portraits to `web/heroes/` (self-host) |
| `web/index.html` | static shell + styles |
| `scripts/build-web.ts` | emit `web/kb.json` + `web/roster.json` + bundle `web/app.js` |
| `scripts/build-roster.ts` | regenerate `data/roster.json` from OpenDota (one-off) |
| `scripts/howdoiplay-review.ts` | `npm run review:howdoiplay -- --site <clone>`: counters named on howdoiplay.com that the engine does not suggest (review aid, ADR-021) |
| `test/engine.test.ts` | behavior + guard tests |

## Not in this MVP (by ADR)

- Bracket/positional matchup granularity - Phase 3 (STRATZ, ADR-005). The current win
  rates are public-match aggregates from OpenDota with small per-pair samples, so the
  UI shows the games-weighted aggregate vs the *whole* enemy team (steadier) plus the
  sample size; `data/matchups.json` is built by `scripts/build-matchups.ts`.
- Input UI (hero grid) - separate, sits behind the same `DraftState` (ADR-002).

Weights in the KB are calibrated expert estimates, not measurements; the first engine
run is expected to surface where to tune them (ADR-011).

## Auto-input: read the screen (ADR-013 P1)

**Read screen** (top bar) shares the Dota screen with the page; the 10 heroes are
read from the draft top bar 10× per second; a pick shows up on the page ~0.2 s
after it appears on screen (measured: median 0.18 s, max 0.34 s). Nothing touches the game - no launch
options, no files - the browser only sees pixels, like a Discord share.

- Pick the monitor (or the Dota window) in the browser's share dialog. Borderless
  windowed is the safe mode; exclusive fullscreen may share a black frame.
- Your side and ★ are found automatically: Dota draws YOUR name under your slot in
  bright white (everyone else's is grey), before and after the pick. Fallback: the
  grey preview of the hero you hover. Override with **Your side: Left / Right**
  (Radiant is always left). A new draft (all slots empty) clears the page.
- **Test a screenshot** runs a saved draft screenshot through the same recogniser -
  hover the status text for per-slot scores.
- Calibrated on 16:9 (2560×1440, verified at 1920×1080). Other aspect ratios are
  untested.

### Enemy items from the screen (ADR-025)

With Read screen on, click an enemy hero in the game: the app reads the 6 inventory
slots of the selected unit from the bottom HUD and updates that hero's items (and the
recommendations). The first time a hero is selected it asks "Whose items?" - one click
on the hero, recognised from then on. Item icons live in `web/items/` (refresh after a
patch: Actions -> "Fetch item icons" -> Run workflow).

### Game tab: clock and map timers (ADR-026)

With Read screen on, the app reads the in-game clock from the top bar (including the
pre-horn countdown and pauses) and switches to **Game** once the clock is confirmed to
be running. The tab lists the next map events for your position - bounty / water /
power runes, Wisdom Shrines, lotuses, stack and pull windows, day/night, neutral tiers,
Tormentor - with a countdown, gold when it is close, green while it is on. Press
**Roshan killed** / **Tormentor killed** to start their respawn timers. Without a screen
share, set the clock by hand (`12:30`, `-0:45`). The schedule and its patch-note
sources live in `data/timings.yaml`.

## Auto-input: local companion (ADR-013, optional)

Reads **your** hero, game phase, team and match id from Dota 2 Game State
Integration and fills "My team" + ★ automatically. Enemies stay manual (GSI in
player mode does not expose them; screen capture is P1).

```bash
npm run gsi -- --install          # once: writes the GSI cfg into your Dota install
                                  #   (or: --install "D:\SteamLibrary\steamapps\common\dota 2 beta")
# Steam → Dota 2 → Properties → Launch options:  -gamestateintegration   (restart Dota)
npm run companion                 # build web + bridge → open http://127.0.0.1:5174
```

- The page served by the bridge turns auto-input on by default; the header chip
  shows `bridge offline` / `waiting for Dota` / `live - <hero> - <phase>`.
- `npm run serve` (:5173) still works; the chip then connects to `127.0.0.1:5174`.
  Other port: `npm run gsi -- --port 5200` (re-run `--install`), page `?gsi=http://127.0.0.1:5200`.
- A new match id clears the draft; manual edits always win until the game reports a change.
- Debug: `http://127.0.0.1:5174/health`. The auth token lives in `.gsi-token` (gitignored).

## Hosted build (GitHub Pages, password-protected) — ADR-019

Every push to `main` runs `.github/workflows/pages.yml`: tests → `npm run build:pages`
→ deploy `dist/`. The app code and all data are encrypted (AES-256-GCM, key =
PBKDF2-SHA256(password, 600k)); the site serves only an unlock screen + `app.bin`.

- Password: repo secret **`APP_PASSWORD`** (≥ 12 chars; the build refuses without it).
  Use a long passphrase - `app.bin` is public and can be attacked offline.
- "Remember on this device" keeps the derived key in localStorage (per browser).
- GSI is disabled in the hosted build; screen reading works (HTTPS).
- CSP pins the page to its own origin (`connect-src 'self'`, no third-party scripts).
- The **repository is public**: source, KB and data are readable there - the password
  protects the hosted app, not the code.
- Local build/test of the site: `APP_PASSWORD='…' npm run build:pages` → `dist/`.
