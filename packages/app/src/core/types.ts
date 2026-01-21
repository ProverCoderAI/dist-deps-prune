// CHANGE: define core domain types for scan results, warnings, and reports
// WHY: keep IO-free data structures reusable across CLI modes and tests
// QUOTE(TZ): "Генерирует отчёт и (по флагу) удаляет неиспользуемые зависимости."
// REF: req-report-types-1
// SOURCE: n/a
// FORMAT THEOREM: ∀r ∈ Report: r.used ⊆ Packages ∧ r.unused.dependencies ⊆ Packages
// PURITY: CORE
// EFFECT: n/a
// INVARIANT: warning.type ∈ {"dynamic-import","dynamic-require","parse-error"}
// COMPLEXITY: O(1)/O(1)

export type Warning =
  | { readonly type: "dynamic-import"; readonly file: string; readonly expr: string }
  | { readonly type: "dynamic-require"; readonly file: string; readonly expr: string }
  | { readonly type: "parse-error"; readonly file: string; readonly error: string }

export interface ScanStats {
  readonly filesScanned: number
  readonly importsFound: number
}

export interface ScanOutcome {
  readonly used: ReadonlySet<string>
  readonly warnings: ReadonlyArray<Warning>
  readonly stats: ScanStats
}

export interface UnusedByKind {
  readonly dependencies: ReadonlyArray<string>
  readonly devDependencies: ReadonlyArray<string>
  readonly optionalDependencies: ReadonlyArray<string>
  readonly peerDependencies: ReadonlyArray<string>
}

export interface Report {
  readonly used: ReadonlyArray<string>
  readonly unused: UnusedByKind
  readonly keptByRule: ReadonlyArray<string>
  readonly warnings: ReadonlyArray<Warning>
  readonly stats: ScanStats
}
