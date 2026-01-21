import { Match } from "effect"
import type { PrunePlan } from "./prune.js"
import type { Report, ScanOutcome, UnusedByKind, Warning } from "./types.js"

// CHANGE: build structured reports and render output formats
// WHY: keep reporting pure and deterministic across CLI modes
// QUOTE(TZ): "Отчёт в stdout (человекочитаемый)"
// REF: req-report-1
// SOURCE: n/a
// FORMAT THEOREM: ∀r: report(r).used is sorted
// PURITY: CORE
// EFFECT: n/a
// INVARIANT: Report.used is unique and sorted
// COMPLEXITY: O(n log n)

const compareStrings = (left: string, right: string): number => left.localeCompare(right)

const mergeSorted = (
  left: ReadonlyArray<string>,
  right: ReadonlyArray<string>
): ReadonlyArray<string> => {
  if (left.length === 0) {
    return right
  }
  if (right.length === 0) {
    return left
  }
  const leftHead = left[0] ?? ""
  const rightHead = right[0] ?? ""
  if (compareStrings(leftHead, rightHead) <= 0) {
    return [leftHead, ...mergeSorted(left.slice(1), right)]
  }
  return [rightHead, ...mergeSorted(left, right.slice(1))]
}

const mergeSort = (values: ReadonlyArray<string>): ReadonlyArray<string> => {
  if (values.length <= 1) {
    return [...values]
  }
  const mid = Math.floor(values.length / 2)
  const left = mergeSort(values.slice(0, mid))
  const right = mergeSort(values.slice(mid))
  return mergeSorted(left, right)
}

const sortUnique = (values: ReadonlyArray<string>): ReadonlyArray<string> => mergeSort([...new Set(values)])

const sortUnused = (unused: UnusedByKind): UnusedByKind => ({
  dependencies: sortUnique(unused.dependencies),
  devDependencies: sortUnique(unused.devDependencies),
  optionalDependencies: sortUnique(unused.optionalDependencies),
  peerDependencies: sortUnique(unused.peerDependencies)
})

/**
 * Build a Report object from scan and prune results.
 *
 * @param scan - Scan outcome with used set and warnings.
 * @param plan - Prune plan with unused lists and keptByRule.
 * @returns Report ready for output.
 *
 * @pure true
 * @invariant report.used is sorted and unique
 * @complexity O(n log n)
 */
export const buildReport = (scan: ScanOutcome, plan: PrunePlan): Report => ({
  used: sortUnique([...scan.used]),
  unused: sortUnused(plan.unused),
  keptByRule: sortUnique(plan.keptByRule),
  warnings: scan.warnings,
  stats: scan.stats
})

const formatWarning = (warning: Warning): string =>
  Match.value(warning).pipe(
    Match.when({ type: "dynamic-import" }, (value) => `[dynamic-import] ${value.file}: ${value.expr}`),
    Match.when({ type: "dynamic-require" }, (value) => `[dynamic-require] ${value.file}: ${value.expr}`),
    Match.when({ type: "parse-error" }, (value) => `[parse-error] ${value.file}: ${value.error}`),
    Match.exhaustive
  )

const formatList = (title: string, values: ReadonlyArray<string>): ReadonlyArray<string> => {
  if (values.length === 0) {
    return [`${title}: (none)`]
  }
  return [title + ":", ...values.map((value) => `  - ${value}`)]
}

/**
 * Render a human-readable report.
 *
 * @param report - Report data.
 * @returns Multi-line string for stdout.
 *
 * @pure true
 * @invariant output lists all required sections
 * @complexity O(n)
 */
export const renderHumanReport = (report: Report): string => {
  const lines = [
    ...formatList("USED", report.used),
    ...formatList("Unused dependencies", report.unused.dependencies),
    ...formatList("Unused devDependencies", report.unused.devDependencies),
    ...formatList("Unused optionalDependencies", report.unused.optionalDependencies),
    ...formatList("Peer dependencies (reported only)", report.unused.peerDependencies)
  ]
  const warningLines = report.warnings.length === 0
    ? ["Warnings: (none)"]
    : [
      "Warnings:",
      ...report.warnings
        .map((warning) => formatWarning(warning))
        .map((line) => `  - ${line}`)
    ]
  const statsLines = [
    `Stats: filesScanned=${report.stats.filesScanned}, importsFound=${report.stats.importsFound}`
  ]
  return [...lines, ...warningLines, ...statsLines].join("\n")
}

/**
 * Render report as JSON text.
 *
 * @param report - Report data.
 * @returns JSON string.
 *
 * @pure true
 * @invariant output matches the JSON schema described in the spec
 * @complexity O(n)
 */
export const renderJsonReport = (report: Report): string =>
  JSON.stringify(
    {
      used: report.used,
      unused: {
        dependencies: report.unused.dependencies,
        devDependencies: report.unused.devDependencies
      },
      keptByRule: report.keptByRule,
      warnings: report.warnings,
      stats: report.stats
    },
    null,
    2
  )
