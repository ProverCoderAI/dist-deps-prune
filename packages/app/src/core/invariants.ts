import type { PackageJson } from "./package-json.js"

// CHANGE: add invariant checks for dist-used dev-only dependencies
// WHY: prevent runtime imports from staying in devDependencies when not declared elsewhere
// QUOTE(TZ): "used in dist and dev-only dependencies must be empty"
// REF: req-guard-devdeps-1
// SOURCE: n/a
// FORMAT THEOREM: forall p in result: p in used and p in devDependencies and p not in runtime deps
// PURITY: CORE
// EFFECT: n/a
// INVARIANT: result is sorted and unique
// COMPLEXITY: O(n log n)

const sortStrings = (values: ReadonlyArray<string>): ReadonlyArray<string> =>
  values.toSorted((left, right) => left.localeCompare(right))

const listKeys = (map: Readonly<Record<string, string>> | undefined): ReadonlyArray<string> =>
  map === undefined ? [] : Object.keys(map)

const buildRuntimeSet = (pkg: PackageJson): ReadonlySet<string> =>
  new Set([
    ...listKeys(pkg.dependencies),
    ...listKeys(pkg.peerDependencies),
    ...listKeys(pkg.optionalDependencies)
  ])

/**
 * List dev-only dependencies that are actually imported by dist outputs.
 *
 * @param used - Set of package names used in dist.
 * @param pkg - Validated package.json.
 * @returns Sorted list of devDependencies that appear in used and are not in runtime deps.
 *
 * @pure true
 * @invariant result subset of used and keys(pkg.devDependencies) minus runtime deps
 * @complexity O(n log n)
 */
export const listDevDependenciesUsedInDist = (
  used: ReadonlySet<string>,
  pkg: PackageJson
): ReadonlyArray<string> => {
  const devDependencies = pkg.devDependencies
  if (devDependencies === undefined) {
    return []
  }
  const runtime = buildRuntimeSet(pkg)
  const hits = Object.keys(devDependencies).filter((name) => used.has(name) && !runtime.has(name))
  return sortStrings(hits)
}
