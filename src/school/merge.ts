// School progress merge (ADR-047): two copies (this browser, the account) become one by
// taking the best result per test, situations set and exam - progress never goes down.
export interface ProgressData {
  tests: Record<string, number>;
  sits: Record<string, number>;
  exam: Record<string, number>;
}
export const emptyProgress = (): ProgressData => ({ tests: {}, sits: {}, exam: {} });

export function mergeProgress(a: Partial<ProgressData> | undefined, b: Partial<ProgressData> | undefined): ProgressData {
  const out = emptyProgress();
  for (const k of ["tests", "sits", "exam"] as const) {
    for (const src of [a?.[k], b?.[k]]) {
      for (const [id, v] of Object.entries(src ?? {})) if (typeof v === "number" && v >= (out[k][id] ?? -1)) out[k][id] = Math.max(0, Math.min(1, v));
    }
  }
  return out;
}
export const sameProgress = (a: ProgressData, b: ProgressData): boolean => JSON.stringify(mergeProgress(a, {})) === JSON.stringify(mergeProgress(b, {}));
