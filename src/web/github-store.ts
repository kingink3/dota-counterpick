// =============================================================================
//  Matches fetched by the "Review a match" workflow (ADR-031): encrypted files on
//  the public `review-data` branch, opened in the browser with the site key the
//  unlock screen derived (window.__DOTA_KEY). No STRATZ call from the page.
// =============================================================================

import type { StratzHealth, StratzMe, StratzPositions, StratzSummary, StratzVision } from "../review.js";

export interface StoreEntry {
  file: string;
  id: number;
  at: number;
  start?: number;
  duration?: number;
  radiantWin?: boolean;
  heroes: number[];
  owner?: number | null;
  mode?: string;
}

export interface StoredMatch {
  id: number;
  owner?: number | null;
  fetchedAt: number;
  summary: StratzSummary;
  positions?: StratzPositions;
  health?: StratzHealth;
  vision?: StratzVision;
  /** Steam account id -> that player's events. */
  players: Record<string, StratzMe>;
}

/** owner/repo of this site: kingink3.github.io/dota-counterpick -> kingink3/dota-counterpick. */
export function repoOf(loc: { hostname: string; pathname: string } = location): string {
  const m = /^([^.]+)\.github\.io$/.exec(loc.hostname);
  const repo = loc.pathname.split("/").filter(Boolean)[0];
  return m && repo ? `${m[1]}/${repo}` : "kingink3/dota-counterpick";
}

export function workflowUrl(): string {
  return `https://github.com/${repoOf()}/actions/workflows/review-match.yml`;
}

function key(): CryptoKey | undefined {
  return (window as unknown as { __DOTA_KEY?: CryptoKey }).__DOTA_KEY;
}

/** the store needs the published site (its password key); a local build has none. */
export function storeAvailable(): boolean {
  return !!key();
}

async function open<T>(file: string): Promise<T> {
  const k = key();
  if (!k) throw new Error("Only in the published site: it needs the site password");
  const r = await fetch(`https://raw.githubusercontent.com/${repoOf()}/review-data/${file}?t=${Date.now()}`, { cache: "no-store" });
  if (r.status === 404) throw new Error(file === "index.bin" ? "Nothing fetched yet: run \"Review a match\" on GitHub" : "This match is no longer in the store");
  if (!r.ok) throw new Error(`GitHub: HTTP ${r.status}`);
  const buf = new Uint8Array(await r.arrayBuffer());
  let plain: ArrayBuffer;
  try {
    plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: buf.slice(0, 12) }, k, buf.slice(12));
  } catch {
    throw new Error("Could not decrypt: the store was written with another site password");
  }
  const text = await new Response(new Blob([plain]).stream().pipeThrough(new DecompressionStream("gzip"))).text();
  return JSON.parse(text) as T;
}

export const loadIndex = (): Promise<StoreEntry[]> => open<StoreEntry[]>("index.bin");
export const loadMatch = (e: StoreEntry): Promise<StoredMatch> => open<StoredMatch>(e.file);
