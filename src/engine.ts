// =============================================================================
//  Public engine API - the single entry point realising the ADR-012 contract.
//
//  Decoupled per ADR-002: callers hand in a DraftState object and get a ranked,
//  explainable EngineResult. The engine neither knows nor cares where the draft
//  came from (UI grid today, Overwolf roster adapter tomorrow).
// =============================================================================

import { loadKB, type KnowledgeBase } from "./kb.js";
import { resolve } from "./resolver.js";
import type { DraftState, EngineResult } from "./types.js";

export class CounterPickEngine {
  private constructor(readonly kb: KnowledgeBase) {}

  /** Load the KB once and reuse the engine across many recommend() calls. */
  static load(root?: string): CounterPickEngine {
    return new CounterPickEngine(loadKB(root));
  }

  /** ADR-012: enemies[] (+ role/hero) -> ranked, explainable candidates. */
  recommend(draft: DraftState): EngineResult {
    return resolve(this.kb, draft);
  }

  get warnings(): string[] {
    return this.kb.warnings;
  }
}

export type { DraftState, EngineResult };
export { loadKB };
