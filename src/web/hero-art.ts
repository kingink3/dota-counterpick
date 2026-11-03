// =============================================================================
//  Hero portrait art - presentation only (browser-side), NOT KB logic.
//
//  Portraits are served LOCALLY from web/heroes/<valveName>.png (downloaded by
//  scripts/fetch-portraits.ts). We self-host instead of hot-linking Steam's CDN
//  because cdn.steamstatic.com is blocked / unreachable on some networks - local
//  files load regardless. The valve name == the portrait filename == OpenDota's
//  npc name minus prefix; ~20 legacy heroes differ (Shadow Fiend = nevermore, …).
// =============================================================================

const VALVE_NAME: Record<string, string> = {
  anti_mage: "antimage",
  lifestealer: "life_stealer",
  wraith_king: "skeleton_king",
  queen_of_pain: "queenofpain",
  shadow_fiend: "nevermore",
  outworld_destroyer: "obsidian_destroyer",
  zeus: "zuus",
  windranger: "windrunner",
  necrophos: "necrolyte",
  centaur_warrunner: "centaur",
  underlord: "abyssal_underlord",
  doom: "doom_bringer",
  timbersaw: "shredder",
  magnus: "magnataur",
  natures_prophet: "furion",
  vengeful_spirit: "vengefulspirit",
};

const ART_DIR = "./heroes"; // self-hosted in web/heroes/

/** KB hero code -> Valve internal short name (= portrait filename, = OpenDota npc name minus prefix). */
export function heroValveName(code: string): string {
  return VALVE_NAME[code] ?? code;
}

export function heroImageUrl(code: string): string {
  return `${ART_DIR}/${heroValveName(code)}.png`;
}

/** Portrait URL straight from a Valve short name (for full-roster heroes not in the KB). */
export function heroImageUrlByValve(valveName: string): string {
  return `${ART_DIR}/${valveName}.png`;
}
