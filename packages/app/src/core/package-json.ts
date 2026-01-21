import * as Either from "effect/Either"
import type { Json, JsonObject } from "./json.js"

// CHANGE: formalize the PackageJson domain and dependency maps
// WHY: ensure dependency pruning preserves non-dependency JSON fields safely
// QUOTE(TZ): "Сравнивает USED с package.json (dependencies/devDependencies/optional/peer)."
// REF: req-package-json-1
// SOURCE: n/a
// FORMAT THEOREM: ∀k ∈ DepKeys: value(k) ∈ String
// PURITY: CORE
// EFFECT: n/a
// INVARIANT: DependencyMap values are semantic version strings
// COMPLEXITY: O(1)/O(1)

export type DependencyMap = Readonly<Record<string, string>>

export interface PackageJson extends JsonObject {
  readonly dependencies?: DependencyMap
  readonly devDependencies?: DependencyMap
  readonly optionalDependencies?: DependencyMap
  readonly peerDependencies?: DependencyMap
}

interface DependencyMaps {
  readonly dependencies?: DependencyMap
  readonly devDependencies?: DependencyMap
  readonly optionalDependencies?: DependencyMap
  readonly peerDependencies?: DependencyMap
}

export type PackageJsonError = { readonly _tag: "PackageJsonError"; readonly message: string }

const makePackageJsonError = (message: string): PackageJsonError => ({
  _tag: "PackageJsonError",
  message
})

const isRecord = (value: Json): value is JsonObject =>
  typeof value === "object" && value !== null && !Array.isArray(value)

const toDependencyMap = (
  fieldName: string,
  value: Json | undefined
): Either.Either<DependencyMap | undefined, PackageJsonError> => {
  if (value === undefined) {
    const empty: DependencyMap | undefined = undefined
    return Either.right(empty)
  }
  if (!isRecord(value)) {
    return Either.left(makePackageJsonError(`${fieldName} must be an object`))
  }
  const entries = Object.entries(value)
  const result: Record<string, string> = {}
  for (const [key, rawValue] of entries) {
    if (typeof rawValue !== "string") {
      return Either.left(makePackageJsonError(`${fieldName}.${key} must be a string`))
    }
    result[key] = rawValue
  }
  return Either.right(result)
}

type DependencyField = { readonly key: keyof DependencyMaps; readonly label: string }

const dependencyFields: ReadonlyArray<DependencyField> = [
  { key: "dependencies", label: "dependencies" },
  { key: "devDependencies", label: "devDependencies" },
  { key: "optionalDependencies", label: "optionalDependencies" },
  { key: "peerDependencies", label: "peerDependencies" }
]

const readDependencyMaps = (value: JsonObject): Either.Either<DependencyMaps, PackageJsonError> => {
  const result: Record<string, DependencyMap> = {}
  for (const field of dependencyFields) {
    const decoded = toDependencyMap(field.label, value[field.key])
    if (Either.isLeft(decoded)) {
      return Either.left(decoded.left)
    }
    if (decoded.right !== undefined) {
      result[field.key] = decoded.right
    }
  }
  return Either.right(result)
}

/**
 * Decode a JsonObject into a PackageJson with validated dependency maps.
 *
 * @param value - Parsed JSON object representing package.json.
 * @returns PackageJson or a typed PackageJsonError.
 *
 * @pure true
 * @invariant dependency values are strings
 * @complexity O(n) where n = number of dependency entries
 */
export const decodePackageJson = (
  value: JsonObject
): Either.Either<PackageJson, PackageJsonError> => {
  const mapsEither = readDependencyMaps(value)
  if (Either.isLeft(mapsEither)) {
    return Either.left(mapsEither.left)
  }
  const maps = mapsEither.right
  const packageJson: PackageJson = {
    ...value,
    ...maps
  }
  return Either.right(packageJson)
}

export const omitDependencyFields = (value: JsonObject): JsonObject => {
  const result: Record<string, Json> = {}
  for (const [key, entry] of Object.entries(value)) {
    if (
      key !== "dependencies" &&
      key !== "devDependencies" &&
      key !== "optionalDependencies" &&
      key !== "peerDependencies"
    ) {
      result[key] = entry
    }
  }
  return result
}

export const isJsonObject = (value: Json): value is JsonObject =>
  typeof value === "object" && value !== null && !Array.isArray(value)
