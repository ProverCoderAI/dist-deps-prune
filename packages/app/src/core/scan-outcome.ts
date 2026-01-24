import type { ScanOutcome } from "./types.js"

// CHANGE: provide pure helpers for scan outcome aggregation
// WHY: enable multi-root scanning while preserving functional core
// QUOTE(TZ): "их надо анализировать"
// REF: req-dist-files-3
// SOURCE: n/a
// FORMAT THEOREM: ∀a,b: used(merge(a,b)) = used(a) ∪ used(b)
// PURITY: CORE
// EFFECT: n/a
// INVARIANT: stats are additive
// COMPLEXITY: O(n + m)

export const emptyScanOutcome: ScanOutcome = {
  used: new Set<string>(),
  warnings: [],
  stats: { filesScanned: 0, importsFound: 0 }
}

/**
 * Merge two scan outcomes.
 *
 * @param left - First scan outcome.
 * @param right - Second scan outcome.
 * @returns Combined scan outcome.
 *
 * @pure true
 * @invariant used = union of inputs
 * @complexity O(n + m)
 */
export const mergeScanOutcomes = (left: ScanOutcome, right: ScanOutcome): ScanOutcome => ({
  used: new Set<string>([...left.used, ...right.used]),
  warnings: [...left.warnings, ...right.warnings],
  stats: {
    filesScanned: left.stats.filesScanned + right.stats.filesScanned,
    importsFound: left.stats.importsFound + right.stats.importsFound
  }
})

// CHANGE: aggregate multiple scan outcomes without Array.reduce
// WHY: comply with lint rules while preserving pure aggregation
// QUOTE(TZ): "их надо анализировать"
// REF: req-dist-files-4
// SOURCE: n/a
// FORMAT THEOREM: ∀xs: used(mergeAll(xs)) = ⋃ used(x)
// PURITY: CORE
// EFFECT: n/a
// INVARIANT: stats are additive across outcomes
// COMPLEXITY: O(n + m)
export const mergeAllScanOutcomes = (
  outcomes: ReadonlyArray<ScanOutcome>
): ScanOutcome => {
  let merged = emptyScanOutcome
  for (const outcome of outcomes) {
    merged = mergeScanOutcomes(merged, outcome)
  }
  return merged
}
