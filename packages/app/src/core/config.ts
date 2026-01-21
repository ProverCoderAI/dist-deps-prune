import type { CliArgs } from "./cli.js"

// CHANGE: define config merging rules and defaults
// WHY: ensure CLI flags override config file and defaults deterministically
// QUOTE(TZ): "Приоритет: CLI-флаги > конфиг > дефолты."
// REF: req-config-merge-1
// SOURCE: n/a
// FORMAT THEOREM: ∀k: resolve(cli, cfg).k = cli.k ?? cfg.k ?? default(k)
// PURITY: CORE
// EFFECT: n/a
// INVARIANT: resolved patterns list is non-empty
// COMPLEXITY: O(n)/O(1)

export interface FileConfig {
  readonly keep?: ReadonlyArray<string>
  readonly ignorePatterns?: ReadonlyArray<string>
  readonly pruneDev?: boolean
  readonly pruneOptional?: boolean
  readonly patterns?: ReadonlyArray<string>
}

export interface ResolvedConfig {
  readonly patterns: ReadonlyArray<string>
  readonly ignorePatterns: ReadonlyArray<string>
  readonly keep: ReadonlyArray<string>
  readonly pruneDev: boolean
  readonly pruneOptional: boolean
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

export const defaultPatterns = (distPath: string): ReadonlyArray<string> => [
  `${distPath}/**/*.js`,
  `${distPath}/**/*.mjs`,
  `${distPath}/**/*.cjs`,
  `${distPath}/**/*.d.ts`
]

const resolvePatterns = (cli: CliArgs, fileConfig: FileConfig | undefined): ReadonlyArray<string> =>
  cli.patterns ?? fileConfig?.patterns ?? defaultPatterns(cli.dist)

const resolveIgnorePatterns = (fileConfig: FileConfig | undefined): ReadonlyArray<string> =>
  fileConfig?.ignorePatterns ?? []

const resolveKeep = (cli: CliArgs, fileConfig: FileConfig | undefined): ReadonlyArray<string> =>
  unique([...(fileConfig?.keep ?? []), ...cli.keep])

const resolvePruneDev = (cli: CliArgs, fileConfig: FileConfig | undefined): boolean =>
  cli.pruneDev ?? fileConfig?.pruneDev ?? (cli.command === "release")

const resolvePruneOptional = (cli: CliArgs, fileConfig: FileConfig | undefined): boolean =>
  cli.pruneOptional ?? fileConfig?.pruneOptional ?? false

/**
 * Resolve the effective config from CLI flags, file config, and defaults.
 *
 * @param cli - Parsed CLI arguments.
 * @param fileConfig - Optional config loaded from .dist-deps-prune.json.
 * @returns Resolved configuration.
 *
 * @pure true
 * @invariant patterns length ≥ 1
 * @complexity O(n)
 */
export const resolveConfig = (
  cli: CliArgs,
  fileConfig: FileConfig | undefined
): ResolvedConfig => {
  return {
    patterns: resolvePatterns(cli, fileConfig),
    ignorePatterns: resolveIgnorePatterns(fileConfig),
    keep: resolveKeep(cli, fileConfig),
    pruneDev: resolvePruneDev(cli, fileConfig),
    pruneOptional: resolvePruneOptional(cli, fileConfig)
  }
}
