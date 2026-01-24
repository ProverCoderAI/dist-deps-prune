import { defaultPatterns } from "./config.js"
import type { Json, JsonObject } from "./json.js"
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
const stripDotSlash = (value: string): string => value.startsWith("./") ? value.slice(2) : value
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
const trimSlashes = (value: string): string => value.endsWith("/") ? value.slice(0, -1) : value
const normalizeFilesEntry = (value: string): string | undefined => {
  const trimmed = value.trim()
  if (trimmed === "" || trimmed.startsWith("!")) {
    return undefined
  }
  const normalized = stripDotSlash(normalizePath(trimmed))
  const sanitized = normalized.startsWith("/") ? normalized.slice(1) : normalized
  if (sanitized === "" || sanitized === "." || sanitized === "..") {
    return undefined
  }
  return sanitized
}
const withNormalizedFilesEntry = <T>(
  value: string,
  toResult: (sanitized: string) => T | undefined
): T | undefined => {
  const sanitized = normalizeFilesEntry(value)
  if (sanitized === undefined) {
    return undefined
  }
  return toResult(sanitized)
}
const stripWildcardPrefix = (value: string): string => {
  const wildcardIndex = findWildcardIndex(value)
  return wildcardIndex >= 0 ? value.slice(0, wildcardIndex) : value
}
const normalizeFilesPrefix = (value: string): string | undefined => {
  const prefix = stripWildcardPrefix(value)
  const withoutTrailing = trimSlashes(prefix)
  if (withoutTrailing === "" || withoutTrailing === "." || withoutTrailing === "..") {
    return undefined
  }
  return withoutTrailing
}
const deriveRootFromPrefix = (value: string): string | undefined => {
  const segments = value.split("/")
  const last = segments.at(-1)
  if (last === undefined) {
    return undefined
  }
  const hasExtension = last.includes(".")
  if (segments.length === 1) {
    return hasExtension ? undefined : value
  }
  if (hasExtension) {
    return segments.slice(0, -1).join("/")
  }
  return value
}
const toStringArray = (value: Json | undefined): ReadonlyArray<string> =>
  Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : []

const readStringField = (value: Json | undefined): ReadonlyArray<string> => typeof value === "string" ? [value] : []

const isJsonArray = (value: Json): value is ReadonlyArray<Json> => Array.isArray(value)

const readBinField = (value: Json | undefined): ReadonlyArray<string> => {
  if (value === undefined) {
    return []
  }
  if (typeof value === "string") {
    return [value]
  }
  if (isJsonObject(value)) {
    const result: Array<string> = []
    for (const key of Object.keys(value)) {
      const entry = value[key]
      if (typeof entry === "string") {
        result.push(entry)
      }
    }
    return result
  }
  return []
}

const collectExportPathsFromArray = (value: ReadonlyArray<Json>): ReadonlyArray<string> => {
  const result: Array<string> = []
  for (const entry of value) {
    const nested = collectExportPaths(entry)
    for (const item of nested) {
      result.push(item)
    }
  }
  return result
}

const collectExportPathsFromObject = (value: JsonObject): ReadonlyArray<string> => {
  const result: Array<string> = []
  for (const key of Object.keys(value)) {
    const entry = value[key]
    if (entry === undefined) {
      continue
    }
    const nested = collectExportPaths(entry)
    for (const item of nested) {
      result.push(item)
    }
  }
  return result
}

const collectExportPaths = (value: Json): ReadonlyArray<string> => {
  if (typeof value === "string") {
    return [value]
  }
  if (isJsonArray(value)) {
    return collectExportPathsFromArray(value)
  }
  if (isJsonObject(value)) {
    return collectExportPathsFromObject(value)
  }
  return []
}

const readExportsField = (value: Json | undefined): ReadonlyArray<string> =>
  value === undefined ? [] : collectExportPaths(value)

const hasJsExtension = (value: string): boolean =>
  normalizePath(value).toLowerCase().endsWith(".js") ||
  normalizePath(value).toLowerCase().endsWith(".mjs") ||
  normalizePath(value).toLowerCase().endsWith(".cjs") ||
  normalizePath(value).toLowerCase().endsWith(".node")

const topLevelFromPath = (value: string): string | undefined => {
  const normalized = stripDotSlash(normalizePath(value))
  const trimmed = normalized.startsWith("/") ? normalized.slice(1) : normalized
  const [first, ...rest] = trimmed.split("/")
  const head = first ?? ""
  if (head === "" || head === "." || head === ".." || head.includes("*")) {
    return undefined
  }
  if (rest.length === 0) {
    return undefined
  }
  return head
}

const rootFromFilesEntry = (value: string): string | undefined =>
  withNormalizedFilesEntry(value, (sanitized) => {
    const prefix = normalizeFilesPrefix(sanitized)
    if (prefix === undefined) {
      return
    }
    return deriveRootFromPrefix(prefix)
  })

const topLevelFromFilesEntry = (value: string): string | undefined =>
  withNormalizedFilesEntry(value, (sanitized) => {
    const segments = sanitized.split("/")
    const head = segments[0] ?? ""
    if (head === "" || head.includes("*")) {
      return
    }
    if (segments.length > 1) {
      return head
    }
    if (sanitized.endsWith("/")) {
      return head
    }
    return head.includes(".") ? undefined : head
  })

const unique = (values: ReadonlyArray<string>): ReadonlyArray<string> => [...new Set(values)]

const isBetterFrequency = (
  best: string | undefined,
  bestCount: number,
  key: string,
  count: number
): boolean => count > bestCount || (count === bestCount && best !== undefined && key < best)

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
    if (isBetterFrequency(best, bestCount, key, count)) {
      best = key
      bestCount = count
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

const collectFilesDirs = (pkg: PackageJson): ReadonlyArray<string> => {
  const result: Array<string> = []
  for (const entry of toStringArray(pkg["files"])) {
    const value = topLevelFromFilesEntry(entry)
    if (value !== undefined) {
      result.push(value)
    }
  }
  return result
}

const collectReleaseRoots = (pkg: PackageJson): ReadonlyArray<string> => {
  const result: Array<string> = []
  for (const entry of toStringArray(pkg["files"])) {
    const value = rootFromFilesEntry(entry)
    if (value !== undefined) {
      result.push(value)
    }
  }
  return result
}

const collectEntrypointDirs = (paths: ReadonlyArray<string>): ReadonlyArray<string> => {
  const result: Array<string> = []
  for (const entry of paths) {
    const value = topLevelFromPath(entry)
    if (value !== undefined) {
      result.push(value)
    }
  }
  return result
}

const collectJsEntrypointDirs = (paths: ReadonlyArray<string>): ReadonlyArray<string> => {
  const result: Array<string> = []
  for (const entry of paths) {
    if (hasJsExtension(entry)) {
      const value = topLevelFromPath(entry)
      if (value !== undefined) {
        result.push(value)
      }
    }
  }
  return result
}

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
): ReadonlyArray<string> => unique(distPaths.flatMap((distPath) => defaultPatterns(distPath)))
