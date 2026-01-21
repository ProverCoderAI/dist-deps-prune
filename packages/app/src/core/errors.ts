import type { CliError } from "./cli.js"
import type { PackageJsonError } from "./package-json.js"

// CHANGE: unify error algebra for the CLI tool
// WHY: provide typed failures for program flow and exit codes
// QUOTE(TZ): "Коды возврата: 1 — ошибка выполнения"
// REF: req-errors-1
// SOURCE: n/a
// FORMAT THEOREM: ∀e ∈ AppError: e._tag is stable and exhaustively matchable
// PURITY: CORE
// EFFECT: n/a
// INVARIANT: error tags are unique
// COMPLEXITY: O(1)/O(1)

export type ConfigError = { readonly _tag: "ConfigError"; readonly message: string }
export type FileError = { readonly _tag: "FileError"; readonly message: string }
export type DistNotFound = { readonly _tag: "DistNotFound"; readonly path: string }
export type ParseFileError = { readonly _tag: "ParseError"; readonly file: string; readonly error: string }
export type CommandFailed = {
  readonly _tag: "CommandFailed"
  readonly command: string
  readonly exitCode: number
}
export type RestoreError = { readonly _tag: "RestoreError"; readonly message: string }
export type DevDependencyInDist = {
  readonly _tag: "DevDependencyInDist"
  readonly packages: ReadonlyArray<string>
  readonly message: string
}

export type AppError =
  | CliError
  | PackageJsonError
  | ConfigError
  | FileError
  | DistNotFound
  | ParseFileError
  | CommandFailed
  | RestoreError
  | DevDependencyInDist

export const configError = (message: string): ConfigError => ({
  _tag: "ConfigError",
  message
})

export const fileError = (message: string): FileError => ({
  _tag: "FileError",
  message
})

export const distNotFound = (path: string): DistNotFound => ({
  _tag: "DistNotFound",
  path
})

export const parseFileError = (file: string, error: string): ParseFileError => ({
  _tag: "ParseError",
  file,
  error
})

export const commandFailed = (command: string, exitCode: number): CommandFailed => ({
  _tag: "CommandFailed",
  command,
  exitCode
})

export const restoreError = (message: string): RestoreError => ({
  _tag: "RestoreError",
  message
})

export const devDependencyInDist = (
  packages: ReadonlyArray<string>
): DevDependencyInDist => ({
  _tag: "DevDependencyInDist",
  packages,
  message: `dist imports packages from devDependencies: ${packages.join(", ")}\n` +
    "Remove them from devDependencies and keep them only in dependencies or peerDependencies, then retry."
})
