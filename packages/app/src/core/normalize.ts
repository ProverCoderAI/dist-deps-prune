import * as Option from "effect/Option"

// CHANGE: centralize package specifier normalization rules
// WHY: ensure consistent USED set across ESM/CJS/d.ts scanning
// QUOTE(TZ): "Нормализация имени пакета: lodash/get → lodash; @scope/name/x → @scope/name"
// REF: req-normalize-1
// SOURCE: n/a
// FORMAT THEOREM: ∀s ∈ Specifier: normalize(s) = Some(p) → p is top-level package name
// PURITY: CORE
// EFFECT: n/a
// INVARIANT: returned package name never contains subpath segments
// COMPLEXITY: O(n)/O(1)

const isRelativePath = (specifier: string): boolean => specifier.startsWith("./") || specifier.startsWith("../")

const isAbsolutePath = (specifier: string): boolean => {
  if (specifier.startsWith("/")) {
    return true
  }
  const windowsDrive = /^[a-zA-Z]:[\\/]/u
  return windowsDrive.test(specifier)
}

const isNonPackageAlias = (specifier: string): boolean =>
  specifier.startsWith("#") || specifier.startsWith("data:") || specifier.startsWith("http:")

const stripNodeProtocol = (specifier: string): string =>
  specifier.startsWith("node:") ? specifier.slice("node:".length) : specifier

const optionSome = Option.some

const getExternalCandidate = (
  specifier: string,
  builtins: ReadonlySet<string>
): string | undefined => {
  if (specifier.length === 0) {
    return undefined
  }
  if (isRelativePath(specifier) || isAbsolutePath(specifier) || isNonPackageAlias(specifier)) {
    return undefined
  }
  const withoutProtocol = stripNodeProtocol(specifier)
  const firstSegment = withoutProtocol.split("/")[0]
  if (builtins.has(withoutProtocol) || (firstSegment !== undefined && builtins.has(firstSegment))) {
    return undefined
  }
  return withoutProtocol
}

const normalizeScoped = (specifier: string): Option.Option<string> => {
  const parts = specifier.split("/")
  const scope = parts[0]
  const name = parts[1]
  if (scope === undefined || name === undefined || scope.length <= 1 || name.length === 0) {
    return Option.none()
  }
  return optionSome(`${scope}/${name}`)
}

const normalizeUnscoped = (specifier: string): Option.Option<string> => {
  const parts = specifier.split("/")
  const head = parts[0]
  return head === undefined || head.length === 0 ? Option.none() : optionSome(head)
}

/**
 * Normalize an import specifier into a top-level package name, if external.
 *
 * @param specifier - Raw import/require specifier.
 * @param builtins - Set of builtin module names (without node: prefix).
 * @returns Option with normalized package name.
 *
 * @pure true
 * @invariant external → not relative/absolute/builtin
 * @complexity O(n)
 */
export const normalizePackageName = (
  specifier: string,
  builtins: ReadonlySet<string>
): Option.Option<string> => {
  const trimmed = specifier.trim()
  const candidate = getExternalCandidate(trimmed, builtins)
  if (candidate === undefined) {
    return Option.none()
  }
  if (candidate.startsWith("@")) {
    return normalizeScoped(candidate)
  }
  return normalizeUnscoped(candidate)
}
