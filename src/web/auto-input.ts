// =============================================================================
//  AutoInputAdapter - the second input adapter behind ADR-002 (ADR-013).
//
//  Subscribes to the local companion bridge (scripts/gsi-bridge.ts) over SSE and
//  turns GSI snapshots into DraftPatch updates. The UI merges a patch into the
//  same DraftState the manual grid produces, so the engine is untouched. Manual
//  input stays authoritative for everything GSI cannot see (enemy picks) and as a
//  correction path for what it can.
//
//  Browser-only. EventSource reconnects by itself (bridge `retry: 2000`).
// =============================================================================

import { GSI_DEFAULT_PORT, type GamePhase, type GsiSnapshot } from "../gsi.js";

export type AutoStatus =
  | { kind: "off" }
  /** EventSource is (re)connecting - the bridge process is not reachable. */
  | { kind: "connecting"; url: string }
  /** bridge reachable, but the game has not posted recently. */
  | { kind: "waiting" }
  /** game is posting. */
  | { kind: "live"; snap?: GsiSnapshot };

/** The adapter's output: a partial draft update in roster terms. */
export interface DraftPatch {
  /** a different match id than the previous patch -> the UI starts a fresh draft. */
  newMatch: boolean;
  matchId?: string;
  /** roster valve name of the hero you play (UI maps valve -> engineId). */
  myHeroValve?: string;
  phase: GamePhase;
  team?: "radiant" | "dire";
  snap: GsiSnapshot;
}

export interface AutoInputHandlers {
  onPatch(p: DraftPatch): void;
  onStatus(s: AutoStatus): void;
}

/** Same origin when the app is served by the bridge itself; else the default port.
 *  Override with ?gsi=http://127.0.0.1:5200 */
export function defaultBridgeUrl(loc: Location = window.location): string {
  const q = new URLSearchParams(loc.search).get("gsi");
  if (q) return q.replace(/\/+$/, "");
  if (loc.port === String(GSI_DEFAULT_PORT)) return loc.origin;
  return `http://127.0.0.1:${GSI_DEFAULT_PORT}`;
}

export class AutoInputAdapter {
  private es?: EventSource;
  private lastMatch?: string;
  private seenMatch = false;
  private gameUp = false;

  constructor(
    private readonly baseUrl: string,
    private readonly h: AutoInputHandlers,
  ) {}

  get running(): boolean {
    return this.es !== undefined;
  }

  start(): void {
    if (this.es) return;
    const url = `${this.baseUrl}/events`;
    this.h.onStatus({ kind: "connecting", url });
    const es = new EventSource(url);
    this.es = es;

    es.addEventListener("status", (ev) => {
      const st = JSON.parse((ev as MessageEvent<string>).data) as { game: boolean };
      this.gameUp = st.game;
      this.h.onStatus(st.game ? { kind: "live" } : { kind: "waiting" });
    });

    es.addEventListener("snapshot", (ev) => {
      const snap = JSON.parse((ev as MessageEvent<string>).data) as GsiSnapshot;
      // first match id seen after connecting is NOT a "new match" - the user may
      // have typed the draft in manually before turning auto-input on.
      const newMatch =
        snap.matchId !== undefined && this.seenMatch && snap.matchId !== this.lastMatch;
      if (snap.matchId !== undefined) {
        this.lastMatch = snap.matchId;
        this.seenMatch = true;
      }
      this.h.onPatch({
        newMatch,
        ...(snap.matchId ? { matchId: snap.matchId } : {}),
        ...(snap.myHeroValve ? { myHeroValve: snap.myHeroValve } : {}),
        phase: snap.phase,
        ...(snap.team ? { team: snap.team } : {}),
        snap,
      });
      if (this.gameUp) this.h.onStatus({ kind: "live", snap });
    });

    es.addEventListener("error", () => {
      if (es.readyState !== EventSource.CLOSED) this.h.onStatus({ kind: "connecting", url });
    });
  }

  stop(): void {
    this.es?.close();
    this.es = undefined;
    this.h.onStatus({ kind: "off" });
  }
}
