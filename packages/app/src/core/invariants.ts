import type { PackageJson } from "./package-json.js"

// CHANGE: add invariant checks for dist-used devDependencies
// WHY: forbid devDependencies in runtime imports even if duplicated elsewhere
// QUOTE(TZ): "надо что бы он заставлял полностью удалять dev"
// REF: req-guard-devdeps-1
// SOURCE: n/a
// FORMAT THEOREM: forall p in result: p in used and p in devDependencies
// PURITY: CORE
// EFFECT: n/a
// INVARIANT: result is sorted and unique
// COMPLEXITY: O(n log n)

const sortStrings = (values: ReadonlyArray<string>): ReadonlyArray<string> =>
  values.toSorted((left, right) => left.localeCompare(right))

/**
 * List devDependencies that are actually imported by dist outputs.
 *
 * @param used - Set of package names used in dist.
 * @param pkg - Validated package.json.
 * @returns Sorted list of devDependencies that appear in used.
 *
 * @pure true
 * @invariant result subset of used and keys(pkg.devDependencies)
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
  const hits = Object.keys(devDependencies).filter((name) => used.has(name))
  return sortStrings(hits)
}
