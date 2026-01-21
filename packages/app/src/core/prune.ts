import type { DependencyMap, PackageJson } from "./package-json.js"
import { omitDependencyFields } from "./package-json.js"
import type { UnusedByKind } from "./types.js"

// CHANGE: implement dependency pruning plan calculation
// WHY: provide deterministic diff generation and conservative safety mode
// QUOTE(TZ): "Удалять из dependencies всё, что отсутствует в USED"
// REF: req-prune-1
// SOURCE: n/a
// FORMAT THEOREM: ∀d ∈ prunable: d ∉ USED ∧ d ∉ KEEP
// PURITY: CORE
// EFFECT: n/a
// INVARIANT: peerDependencies are never removed
// COMPLEXITY: O(n) where n = total dependencies

export interface PruneOptions {
  readonly used: ReadonlySet<string>
  readonly keep: ReadonlySet<string>
  readonly pruneDev: boolean
  readonly pruneOptional: boolean
  readonly conservative: boolean
  readonly hasUncertainty: boolean
}

export interface PrunePlan {
  readonly unused: UnusedByKind
  readonly prunable: UnusedByKind
  readonly keptByRule: ReadonlyArray<string>
  readonly nextPackageJson: PackageJson
}

const emptyUnused: UnusedByKind = {
  dependencies: [],
  devDependencies: [],
  optionalDependencies: [],
  peerDependencies: []
}

const listKeys = (map: DependencyMap | undefined): ReadonlyArray<string> => map === undefined ? [] : Object.keys(map)

const filterMap = (
  map: DependencyMap | undefined,
  remove: ReadonlySet<string>
): DependencyMap | undefined => {
  if (map === undefined) {
    return undefined
  }
  const entries = Object.entries(map).filter(([name]) => !remove.has(name))
  if (entries.length === 0) {
    return undefined
  }
  const result: Record<string, string> = {}
  for (const [name, version] of entries) {
    result[name] = version
  }
  return result
}

const computeUnused = (
  map: DependencyMap | undefined,
  used: ReadonlySet<string>,
  keep: ReadonlySet<string>
): ReadonlyArray<string> => listKeys(map).filter((name) => !used.has(name) && !keep.has(name))

const computeUnusedByKind = (pkg: PackageJson, options: PruneOptions): UnusedByKind => ({
  dependencies: computeUnused(pkg.dependencies, options.used, options.keep),
  devDependencies: computeUnused(pkg.devDependencies, options.used, options.keep),
  optionalDependencies: computeUnused(pkg.optionalDependencies, options.used, options.keep),
  peerDependencies: computeUnused(pkg.peerDependencies, options.used, options.keep)
})

const computePrunableByKind = (unused: UnusedByKind, options: PruneOptions): UnusedByKind => {
  const hasUncertainty = options.conservative && options.hasUncertainty
  return {
    ...emptyUnused,
    dependencies: hasUncertainty ? [] : unused.dependencies,
    devDependencies: options.pruneDev && !hasUncertainty ? unused.devDependencies : [],
    optionalDependencies: options.pruneOptional && !hasUncertainty ? unused.optionalDependencies : [],
    peerDependencies: []
  }
}

const computeKeptByRule = (
  unused: UnusedByKind,
  prunable: UnusedByKind,
  options: PruneOptions
): ReadonlyArray<string> => {
  const keptExplicit = [...options.keep].filter((name) => !options.used.has(name))
  return [
    ...keptExplicit,
    ...unused.dependencies.filter((name) => !prunable.dependencies.includes(name)),
    ...unused.devDependencies.filter((name) => !prunable.devDependencies.includes(name)),
    ...unused.optionalDependencies.filter((name) => !prunable.optionalDependencies.includes(name)),
    ...unused.peerDependencies
  ]
}

const buildNextPackageJson = (pkg: PackageJson, prunable: UnusedByKind): PackageJson => {
  const removeDependencies = new Set(prunable.dependencies)
  const removeDev = new Set(prunable.devDependencies)
  const removeOptional = new Set(prunable.optionalDependencies)
  const nextDependencies = filterMap(pkg.dependencies, removeDependencies)
  const nextDevDependencies = filterMap(pkg.devDependencies, removeDev)
  const nextOptionalDependencies = filterMap(pkg.optionalDependencies, removeOptional)
  const base = omitDependencyFields(pkg)
  return {
    ...base,
    ...(nextDependencies === undefined ? {} : { dependencies: nextDependencies }),
    ...(nextDevDependencies === undefined ? {} : { devDependencies: nextDevDependencies }),
    ...(nextOptionalDependencies === undefined ? {} : { optionalDependencies: nextOptionalDependencies }),
    ...(pkg.peerDependencies === undefined ? {} : { peerDependencies: pkg.peerDependencies })
  }
}

/**
 * Build the prune plan (analysis + actual removal) for a package.json.
 *
 * @param pkg - Parsed package.json.
 * @param options - Prune options (used set, keep rules, mode flags).
 * @returns PrunePlan with unused, prunable, and next package.json.
 *
 * @pure true
 * @invariant peerDependencies remain unchanged
 * @complexity O(n)
 */
export const buildPrunePlan = (pkg: PackageJson, options: PruneOptions): PrunePlan => {
  const unused = computeUnusedByKind(pkg, options)
  const prunable = computePrunableByKind(unused, options)
  const keptByRule = computeKeptByRule(unused, prunable, options)
  const nextPackageJson = buildNextPackageJson(pkg, prunable)

  return {
    unused,
    prunable,
    keptByRule,
    nextPackageJson
  }
}
