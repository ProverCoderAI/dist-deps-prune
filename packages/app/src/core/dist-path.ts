import type { Json } from "./json.js"
import type { PackageJson } from "./package-json.js"
import { isJsonObject } from "./package-json.js"

// CHANGE: infer dist directory candidates from package.json entrypoints and files
// WHY: allow default dist resolution without forcing --dist for non-standard output folders
// QUOTE(TZ): "анализировал где смотреть запакованную версию исходя из package.json"
// REF: req-dist-infer-1
// SOURCE: n/a
// FORMAT THEOREM: ∀pkg: infer(pkg)=d → d ∈ Candidates(pkg) ∪ {undefined}
// PURITY: CORE
// EFFECT: n/a
// INVARIANT: inferred distDir is a top-level path segment
// COMPLEXITY: O(n) where n = number of inspected paths

const normalizePath = (value: string): string => value.replaceAll("\\", "/")

const stripDotSlash = (value: string): string =>
  value.startsWith("./") ? value.slice(2) : value

const findWildcardIndex = (value: string): number => {
  const star = value.indexOf("*")
  const question = value.indexOf("?")
  if (star === -1) {
    return question
  }
  if (question === -1) {
    return star
  }
  return Math.min(star, question)
}

const trimSlashes = (value: string): string =>
  value.endsWith("/") ? value.slice(0, -1) : value

const toStringArray = (value: Json | undefined): ReadonlyArray<string> => {
  if (!Array.isArray(value)) {
    return []
  }
  return value.filter((entry): entry is string => typeof entry === "string")
}

const readStringField = (value: Json | undefined): ReadonlyArray<string> =>
  typeof value === "string" ? [value] : []

const readBinField = (value: Json | undefined): ReadonlyArray<string> => {
  if (typeof value === "string") {
    return [value]
  }
  if (isJsonObject(value)) {
    return Object.values(value).filter((entry): entry is string => typeof entry === "string")
  }
  return []
}

const collectExportPaths = (value: Json): ReadonlyArray<string> => {
  if (typeof value === "string") {
    return [value]
  }
  if (Array.isArray(value)) {
    const result: Array<string> = []
    for (const entry of value) {
      result.push(...collectExportPaths(entry))
    }
    return result
  }
  if (isJsonObject(value)) {
    const result: Array<string> = []
    for (const entry of Object.values(value)) {
      result.push(...collectExportPaths(entry))
    }
    return result
  }
  return []
}

const readExportsField = (value: Json | undefined): ReadonlyArray<string> =>
  value === undefined ? [] : collectExportPaths(value)

const hasJsExtension = (value: string): boolean => {
  const normalized = normalizePath(value).toLowerCase()
  return (
    normalized.endsWith(".js") ||
    normalized.endsWith(".mjs") ||
    normalized.endsWith(".cjs") ||
    normalized.endsWith(".node")
  )
}

const topLevelFromPath = (value: string): string | undefined => {
  const normalized = stripDotSlash(normalizePath(value))
  const trimmed = normalized.startsWith("/") ? normalized.slice(1) : normalized
  const [first, ...rest] = trimmed.split("/")
  if (first === "" || first === "." || first === ".." || first.includes("*")) {
    return undefined
  }
  if (rest.length === 0) {
    return undefined
  }
  return first
}

const rootFromFilesEntry = (value: string): string | undefined => {
  const trimmed = value.trim()
  if (trimmed === "" || trimmed.startsWith("!")) {
    return undefined
  }
  const normalized = stripDotSlash(normalizePath(trimmed))
  const sanitized = normalized.startsWith("/") ? normalized.slice(1) : normalized
  if (sanitized === "" || sanitized === "." || sanitized === "..") {
    return undefined
  }
  const wildcardIndex = findWildcardIndex(sanitized)
  const prefix = wildcardIndex >= 0 ? sanitized.slice(0, wildcardIndex) : sanitized
  const withoutTrailing = trimSlashes(prefix)
  if (withoutTrailing === "" || withoutTrailing === "." || withoutTrailing === "..") {
    return undefined
  }
  const segments = withoutTrailing.split("/")
  const last = segments[segments.length - 1] ?? ""
  const hasExtension = last.includes(".")
  if (segments.length === 1) {
    return hasExtension ? undefined : withoutTrailing
  }
  if (hasExtension) {
    return segments.slice(0, -1).join("/")
  }
  return withoutTrailing
}

const topLevelFromFilesEntry = (value: string): string | undefined => {
  const trimmed = value.trim()
  if (trimmed.startsWith("!")) {
    return undefined
  }
  const cleaned = stripDotSlash(normalizePath(trimmed))
  const sanitized = cleaned.startsWith("/") ? cleaned.slice(1) : cleaned
  if (sanitized === "" || sanitized === "." || sanitized === "..") {
    return undefined
  }
  const [first, ...rest] = sanitized.split("/")
  if (first.includes("*")) {
    return undefined
  }
  if (rest.length > 0) {
    return first
  }
  if (sanitized.endsWith("/")) {
    return first
  }
  if (!first.includes(".")) {
    return first
  }
  return undefined
}

const unique = (values: ReadonlyArray<string>): ReadonlyArray<string> => {
  const seen = new Set<string>()
  const result: Array<string> = []
  for (const value of values) {
    if (!seen.has(value)) {
      seen.add(value)
      result.push(value)
    }
  }
  return result
}

const mostFrequent = (values: ReadonlyArray<string>): string | undefined => {
  if (values.length === 0) {
    return undefined
  }
  const counts = new Map<string, number>()
  for (const value of values) {
    counts.set(value, (counts.get(value) ?? 0) + 1)
  }
  let best: string | undefined
  let bestCount = -1
  for (const [key, count] of counts.entries()) {
    if (count > bestCount) {
      best = key
      bestCount = count
    } else if (count === bestCount && best !== undefined && key < best) {
      best = key
    }
  }
  return best
}

const chooseCandidate = (
  primary: ReadonlyArray<string>,
  secondary: ReadonlyArray<string>
): string | undefined => {
  if (primary.length === 0) {
    return undefined
  }
  const uniquePrimary = unique(primary)
  if (uniquePrimary.length === 1) {
    return uniquePrimary[0]
  }
  const secondarySet = new Set(secondary)
  const intersection = uniquePrimary.filter((value) => secondarySet.has(value))
  if (intersection.length === 1) {
    return intersection[0]
  }
  return mostFrequent(primary)
}

const collectEntrypointPaths = (pkg: PackageJson): ReadonlyArray<string> => [
  ...readStringField(pkg["main"]),
  ...readStringField(pkg["module"]),
  ...readStringField(pkg["types"]),
  ...readStringField(pkg["typings"]),
  ...readBinField(pkg["bin"]),
  ...readExportsField(pkg["exports"])
]

const collectFilesDirs = (pkg: PackageJson): ReadonlyArray<string> =>
  toStringArray(pkg["files"]).map(topLevelFromFilesEntry).filter((value): value is string => value !== undefined)

const collectReleaseRoots = (pkg: PackageJson): ReadonlyArray<string> =>
  toStringArray(pkg["files"]).map(rootFromFilesEntry).filter((value): value is string => value !== undefined)

const collectEntrypointDirs = (paths: ReadonlyArray<string>): ReadonlyArray<string> =>
  paths.map(topLevelFromPath).filter((value): value is string => value !== undefined)

const collectJsEntrypointDirs = (paths: ReadonlyArray<string>): ReadonlyArray<string> =>
  paths
    .filter(hasJsExtension)
    .map(topLevelFromPath)
    .filter((value): value is string => value !== undefined)

/**
 * Infer the top-level dist directory from package.json metadata.
 *
 * @param pkg - Parsed package.json object.
 * @returns Dist directory name or undefined when no candidates exist.
 *
 * @pure true
 * @invariant returned value is a top-level path segment
 * @complexity O(n)
 */
export const inferDistDirFromPackageJson = (pkg: PackageJson): string | undefined => {
  const entrypointPaths = collectEntrypointPaths(pkg)
  const jsEntrypointDirs = collectJsEntrypointDirs(entrypointPaths)
  const entrypointDirs = collectEntrypointDirs(entrypointPaths)
  const filesDirs = collectFilesDirs(pkg)

  const fromJsEntrypoints = chooseCandidate(jsEntrypointDirs, filesDirs)
  if (fromJsEntrypoints !== undefined) {
    return fromJsEntrypoints
  }
  const fromEntrypoints = chooseCandidate(entrypointDirs, filesDirs)
  if (fromEntrypoints !== undefined) {
    return fromEntrypoints
  }
  return mostFrequent(filesDirs)
}

// CHANGE: derive scan roots from package.json files entries
// WHY: treat published directories as authoritative release sources
// QUOTE(TZ): "он правильно работал с files"
// REF: req-dist-files-1
// SOURCE: n/a
// FORMAT THEOREM: ∀r ∈ roots: r is relative directory path
// PURITY: CORE
// EFFECT: n/a
// INVARIANT: roots are unique and non-empty
// COMPLEXITY: O(n)
export const inferDistRootsFromPackageJson = (pkg: PackageJson): ReadonlyArray<string> =>
  unique(collectReleaseRoots(pkg))

const patternsForDistPath = (distPath: string): ReadonlyArray<string> => [
  `${distPath}/**/*.js`,
  `${distPath}/**/*.mjs`,
  `${distPath}/**/*.cjs`,
  `${distPath}/**/*.d.ts`
]

// CHANGE: build scan patterns for multiple dist roots
// WHY: support scanning all published directories from package.json files
// QUOTE(TZ): "их надо анализировать"
// REF: req-dist-files-2
// SOURCE: n/a
// FORMAT THEOREM: ∀p ∈ paths: patterns(p) cover {js,mjs,cjs,d.ts}
// PURITY: CORE
// EFFECT: n/a
// INVARIANT: patterns list is non-empty when distPaths is non-empty
// COMPLEXITY: O(n)
export const buildPatternsForDistPaths = (
  distPaths: ReadonlyArray<string>
): ReadonlyArray<string> => unique(distPaths.flatMap((distPath) => patternsForDistPath(distPath)))
