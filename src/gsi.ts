// =============================================================================
//  Dota 2 Game State Integration (GSI) - pure normalisation, no I/O.
//
//  Shared by the local bridge (scripts/gsi-bridge.ts, Node) and the browser
//  AutoInputAdapter (src/web/auto-input.ts). ADR-013 "Local companion mode".
//
//  What GSI gives in PLAYER mode (not spectator): only YOUR player/hero - not the
//  enemy draft. So GSI supplies myHero, game phase, team, gold, inventory and the
//  match id; enemies still come from manual input (P1: screen capture).
//
//  Hero names: GSI sends `npc_dota_hero_<valve>`. <valve> is exactly the roster's
//  `valve` field (data/roster.json is built from OpenDota /heroes `name`, which is
//  the same npc name), so the mapping GSI -> roster is "strip the prefix" and the
//  roster -> KB code link reuses heroValveName(). Legacy names (antimage,
//  nevermore, zuus, furion, …) therefore resolve with no extra table.
// =============================================================================

export const GSI_HERO_PREFIX = "npc_dota_hero_";

/** Normalised game phase (Valve's DOTA_GAMERULES_STATE_* collapsed). */
export type GamePhase =
  | "idle" // menus / not in a match
  | "loading" // INIT / WAIT_FOR_PLAYERS_TO_LOAD / WAIT_FOR_MAP_TO_LOAD
  | "hero_selection" // HERO_SELECTION
  | "strategy" // STRATEGY_TIME / TEAM_SHOWCASE
  | "pre_game" // PRE_GAME (horn not yet blown)
  | "in_progress" // GAME_IN_PROGRESS
  | "post_game" // POST_GAME / DISCONNECT
  | "unknown";

const PHASE: Record<string, GamePhase> = {
  DOTA_GAMERULES_STATE_INIT: "loading",
  DOTA_GAMERULES_STATE_WAIT_FOR_PLAYERS_TO_LOAD: "loading",
  DOTA_GAMERULES_STATE_WAIT_FOR_MAP_TO_LOAD: "loading",
  DOTA_GAMERULES_STATE_CUSTOM_GAME_SETUP: "loading",
  DOTA_GAMERULES_STATE_PLAYER_DRAFT: "hero_selection",
  DOTA_GAMERULES_STATE_HERO_SELECTION: "hero_selection",
  DOTA_GAMERULES_STATE_STRATEGY_TIME: "strategy",
  DOTA_GAMERULES_STATE_TEAM_SHOWCASE: "strategy",
  DOTA_GAMERULES_STATE_PRE_GAME: "pre_game",
  DOTA_GAMERULES_STATE_GAME_IN_PROGRESS: "in_progress",
  DOTA_GAMERULES_STATE_POST_GAME: "post_game",
  DOTA_GAMERULES_STATE_DISCONNECT: "post_game",
};

/** Raw GSI POST body - only the fields we read (everything optional: GSI omits
 *  whole sections in menus, and `hero` is empty until you pick). */
export interface GsiPayload {
  provider?: { name?: string; appid?: number; version?: number; timestamp?: number };
  map?: {
    matchid?: string;
    game_state?: string;
    clock_time?: number;
    game_time?: number;
    paused?: boolean;
    win_team?: string;
  };
  player?: {
    steamid?: string;
    accountid?: string;
    name?: string;
    team_name?: string;
    gold?: number;
    gpm?: number;
    xpm?: number;
    kills?: number;
    deaths?: number;
    assists?: number;
  };
  hero?: { id?: number; name?: string; level?: number; alive?: boolean };
  items?: Record<string, { name?: string } | undefined>;
  auth?: { token?: string };
  [k: string]: unknown;
}

/** What the bridge forwards to the browser over SSE. Compact and stable. */
export interface GsiSnapshot {
  /** bridge receive time (ms epoch). */
  receivedAt: number;
  /** undefined when not in a match (GSI sends "0" in menus). */
  matchId?: string;
  phase: GamePhase;
  /** raw DOTA_GAMERULES_STATE_* for debugging. */
  rawState?: string;
  /** roster valve name of the hero you are playing (prefix stripped). */
  myHeroValve?: string;
  heroLevel?: number;
  alive?: boolean;
  team?: "radiant" | "dire";
  gold?: number;
  gpm?: number;
  /** clock in seconds (negative before the horn). */
  clock?: number;
  /** inventory slots 0-5, item ids without the `item_` prefix (empties dropped). */
  items: string[];
  /** backpack slots 6-8 / stash are ignored; neutral item kept separately. */
  neutral?: string;
}

/** `npc_dota_hero_antimage` -> `antimage`; anything else (empty, "", id-only) -> undefined. */
export function gsiHeroToValve(name: string | undefined): string | undefined {
  if (!name || !name.startsWith(GSI_HERO_PREFIX)) return undefined;
  const v = name.slice(GSI_HERO_PREFIX.length);
  return v.length > 0 ? v : undefined;
}

export function normalizePhase(state: string | undefined): GamePhase {
  if (!state) return "idle";
  return PHASE[state] ?? "unknown";
}

function itemId(name: string | undefined): string | undefined {
  if (!name || name === "empty") return undefined;
  return name.replace(/^item_/, "");
}

/** Pure: raw GSI body -> snapshot. `now` injectable for tests. */
export function normalizeGsi(p: GsiPayload, now: number = Date.now()): GsiSnapshot {
  const matchId = p.map?.matchid && p.map.matchid !== "0" ? String(p.map.matchid) : undefined;
  const team = p.player?.team_name;
  const items: string[] = [];
  for (let i = 0; i <= 5; i++) {
    const id = itemId(p.items?.[`slot${i}`]?.name);
    if (id) items.push(id);
  }
  return {
    receivedAt: now,
    ...(matchId ? { matchId } : {}),
    phase: p.map ? normalizePhase(p.map.game_state) : "idle",
    ...(p.map?.game_state ? { rawState: p.map.game_state } : {}),
    ...(gsiHeroToValve(p.hero?.name) ? { myHeroValve: gsiHeroToValve(p.hero?.name)! } : {}),
    ...(typeof p.hero?.level === "number" ? { heroLevel: p.hero.level } : {}),
    ...(typeof p.hero?.alive === "boolean" ? { alive: p.hero.alive } : {}),
    ...(team === "radiant" || team === "dire" ? { team } : {}),
    ...(typeof p.player?.gold === "number" ? { gold: p.player.gold } : {}),
    ...(typeof p.player?.gpm === "number" ? { gpm: p.player.gpm } : {}),
    ...(typeof p.map?.clock_time === "number" ? { clock: p.map.clock_time } : {}),
    items,
    ...(itemId(p.items?.neutral0?.name) ? { neutral: itemId(p.items?.neutral0?.name)! } : {}),
  };
}

/** The Valve KeyValues cfg the game reads (cfg/gamestate_integration/*.cfg). */
export function gsiConfig(opts: { port: number; token: string }): string {
  return `"Dota App companion"
{
  "uri"        "http://127.0.0.1:${opts.port}/"
  "timeout"    "5.0"
  "buffer"     "0.1"
  "throttle"   "0.5"
  "heartbeat"  "30.0"
  "data"
  {
    "provider"   "1"
    "map"        "1"
    "player"     "1"
    "hero"       "1"
    "abilities"  "0"
    "items"      "1"
    "draft"      "0"
    "wearables"  "0"
  }
  "auth"
  {
    "token"      "${opts.token}"
  }
}
`;
}

/** Default bridge port (next to the web app's 5173). */
export const GSI_DEFAULT_PORT = 5174;
