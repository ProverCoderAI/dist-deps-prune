// CHANGE: implement minimal glob matching for dist scanning
// WHY: avoid extra dependencies while supporting dist/**/*.js style patterns
// QUOTE(TZ): "Пользователь может переопределить маски флагом."
// REF: req-glob-1
// SOURCE: n/a
// FORMAT THEOREM: ∀p: match(glob, p) ∈ {true,false}
// PURITY: CORE
// EFFECT: n/a
// INVARIANT: '*' never matches path separator '/'
// COMPLEXITY: O(n) per match

const normalizeSlashes = (value: string): string => value.replaceAll("\\", "/")

const stripDotSlash = (value: string): string => value.startsWith("./") ? value.slice(2) : value

const escapeRegex = (value: string): string => value.replaceAll(/[.+^${}()|[\]\\]/gu, String.raw`\$&`)

const globToRegex = (pattern: string): RegExp => {
  const normalized = stripDotSlash(normalizeSlashes(pattern))
  let regex = "^"
  let index = 0
  while (index < normalized.length) {
    const char = normalized.charAt(index)
    const next = normalized.charAt(index + 1)
    if (char === "*" && next === "*") {
      const after = normalized.charAt(index + 2)
      if (after === "/") {
        regex += "(?:.*/)?"
        index += 3
        continue
      }
      regex += ".*"
      index += 2
      continue
    }
    if (char === "*") {
      regex += "[^/]*"
      index += 1
      continue
    }
    if (char === "?") {
      regex += "[^/]"
      index += 1
      continue
    }
    regex += escapeRegex(char)
    index += 1
  }
  regex += "$"
  return new RegExp(regex, "u")
}

/**
 * Compile glob patterns into regexes.
 *
 * @param patterns - Raw glob patterns.
 * @returns Compiled regular expressions.
 *
 * @pure true
 * @invariant compiled regexes match only whole paths
 * @complexity O(n) where n = total pattern length
 */
export const compileGlobs = (patterns: ReadonlyArray<string>): ReadonlyArray<RegExp> =>
  patterns.map((pattern) => globToRegex(pattern))

/**
 * Check if any compiled glob matches the path.
 *
 * @param globs - Compiled regex patterns.
 * @param candidate - Path to test.
 * @returns true if any pattern matches.
 *
 * @pure true
 * @complexity O(k) where k = number of globs
 */
export const matchesAnyGlob = (
  globs: ReadonlyArray<RegExp>,
  candidate: string
): boolean => {
  const normalized = stripDotSlash(normalizeSlashes(candidate))
  for (const glob of globs) {
    if (glob.test(normalized)) {
      return true
    }
  }
  return false
}
