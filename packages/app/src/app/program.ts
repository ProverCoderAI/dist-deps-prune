import type { CommandExecutor } from "@effect/platform/CommandExecutor"
import type { FileSystem as FileSystemService } from "@effect/platform/FileSystem"
import { Path } from "@effect/platform/Path"
import type { Path as PathService } from "@effect/platform/Path"
import { Effect, Match } from "effect"
import type * as Either from "effect/Either"
import * as Exit from "effect/Exit"

import type { CliArgs } from "../core/cli.js"
import { parseCliArgs } from "../core/cli.js"
import { resolveConfig } from "../core/config.js"
import type { AppError } from "../core/errors.js"
import type { PrunePlan } from "../core/prune.js"
import { buildPrunePlan } from "../core/prune.js"
import { buildReport, renderHumanReport, renderJsonReport } from "../core/report.js"
import type { Report } from "../core/types.js"
import { loadBuiltinModules } from "../shell/builtins.js"
import { runCommand } from "../shell/command.js"
import { loadConfigFile } from "../shell/config-file.js"
import { readPackageJson, writePackageJson } from "../shell/package-json.js"
import { ensureBackup, restorePackageJson } from "../shell/release.js"
import { scanDist } from "../shell/scan.js"

// CHANGE: orchestrate CLI modes with functional core + imperative shell
// WHY: enforce single entrypoint with typed errors and deterministic outputs
// QUOTE(TZ): "scan/apply/release/restore"
// REF: req-program-1
// SOURCE: n/a
// FORMAT THEOREM: ∀mode: run(mode) returns exitCode ∈ {0,1,2,...}
// PURITY: SHELL
// EFFECT: Effect<ProgramResult, AppError, Services>
// INVARIANT: report emitted at most once
// COMPLEXITY: O(n)

export interface ProgramResult {
  readonly report: Report
  readonly exitCode: number
}

type ScanEnv = FileSystemService | PathService
type ProgramEnv = FileSystemService | PathService | CommandExecutor

interface AnalyzeResult {
  readonly report: Report
  readonly plan: PrunePlan
}

const emptyReport: Report = {
  used: [],
  unused: {
    dependencies: [],
    devDependencies: [],
    optionalDependencies: [],
    peerDependencies: []
  },
  keptByRule: [],
  warnings: [],
  stats: { filesScanned: 0, importsFound: 0 }
}

const hasUnused = (report: Report): boolean =>
  report.unused.dependencies.length > 0 || report.unused.devDependencies.length > 0

const writeStdout = (payload: string): Effect.Effect<void> =>
  Effect.sync(() => {
    process.stdout.write(payload.endsWith("\n") ? payload : `${payload}\n`)
  })

const fromEither = <A, E>(either: Either.Either<A, E>): Effect.Effect<A, E> =>
  either._tag === "Left" ? Effect.fail(either.left) : Effect.succeed(either.right)

const emitReport = (report: Report, json: boolean, silent: boolean): Effect.Effect<void> => {
  if (silent) {
    return Effect.void
  }
  const payload = json ? renderJsonReport(report) : renderHumanReport(report)
  return writeStdout(payload)
}

const runReleaseCommand = (
  cli: CliArgs,
  plan: PrunePlan,
  backupPath: string
): Effect.Effect<number, AppError, FileSystemService | CommandExecutor> =>
  Effect.gen(function*(_) {
    yield* _(ensureBackup(cli.packagePath, backupPath))
    yield* _(writePackageJson(cli.packagePath, plan.nextPackageJson))
    const cwd = yield* _(Effect.sync(() => process.cwd()))
    const exit = yield* _(Effect.exit(runCommand(cli.releaseCommand ?? "", cwd)))
    yield* _(restorePackageJson(cli.packagePath, backupPath))
    return yield* _(
      Exit.matchEffect(exit, {
        onFailure: (cause) => Effect.failCause(cause),
        onSuccess: (value) => Effect.succeed(value)
      })
    )
  })

const analyzeProject = (
  cli: CliArgs
): Effect.Effect<AnalyzeResult, AppError, ScanEnv> =>
  Effect.gen(function*(_) {
    const configPath = cli.ignorePath ?? "./.dist-deps-prune.json"
    const configFile = yield* _(loadConfigFile(configPath, cli.ignorePathExplicit))
    const resolved = resolveConfig(cli, configFile)
    const builtins = yield* _(loadBuiltinModules)
    const scan = yield* _(
      scanDist({
        distPath: cli.dist,
        patterns: resolved.patterns,
        ignorePatterns: resolved.ignorePatterns,
        strict: cli.strict,
        builtins
      })
    )
    const pkg = yield* _(readPackageJson(cli.packagePath))
    const plan = buildPrunePlan(pkg, {
      used: scan.used,
      keep: new Set(resolved.keep),
      pruneDev: resolved.pruneDev,
      pruneOptional: resolved.pruneOptional,
      conservative: cli.conservative,
      hasUncertainty: scan.warnings.length > 0
    })
    const report = buildReport(scan, plan)
    return { report, plan }
  })

const handleRestore = (
  cli: CliArgs,
  backupPath: string
): Effect.Effect<ProgramResult, AppError, FileSystemService> =>
  Effect.gen(function*(_) {
    yield* _(restorePackageJson(cli.packagePath, backupPath))
    yield* _(emitReport(emptyReport, cli.json, cli.silent))
    return { report: emptyReport, exitCode: 0 }
  })

const handleScan = (
  cli: CliArgs
): Effect.Effect<ProgramResult, AppError, ScanEnv> =>
  Effect.gen(function*(_) {
    const { report } = yield* _(analyzeProject(cli))
    yield* _(emitReport(report, cli.json, cli.silent))
    const exitCode = cli.failOnUnused && hasUnused(report) ? 2 : 0
    return { report, exitCode }
  })

const handleApply = (
  cli: CliArgs
): Effect.Effect<ProgramResult, AppError, ScanEnv> =>
  Effect.gen(function*(_) {
    const { plan, report } = yield* _(analyzeProject(cli))
    if (cli.write) {
      yield* _(writePackageJson(cli.packagePath, plan.nextPackageJson))
    }
    yield* _(emitReport(report, cli.json, cli.silent))
    return { report, exitCode: 0 }
  })

const handleRelease = (
  cli: CliArgs,
  backupPath: string
): Effect.Effect<ProgramResult, AppError, ProgramEnv> =>
  Effect.gen(function*(_) {
    const { plan, report } = yield* _(analyzeProject(cli))
    if (cli.releaseCommand) {
      const exitCode = yield* _(runReleaseCommand(cli, plan, backupPath))
      yield* _(emitReport(report, cli.json, cli.silent))
      return { report, exitCode }
    }
    yield* _(ensureBackup(cli.packagePath, backupPath))
    yield* _(writePackageJson(cli.packagePath, plan.nextPackageJson))
    yield* _(emitReport(report, cli.json, cli.silent))
    if (!cli.json && !cli.silent) {
      yield* _(
        writeStdout(
          `package.json modified for release. Restore with: dist-deps-prune restore --package ${cli.packagePath}`
        )
      )
    }
    return { report, exitCode: 0 }
  })

const executeCommand = (
  cli: CliArgs,
  backupPath: string
): Effect.Effect<ProgramResult, AppError, ProgramEnv> =>
  Match.value(cli.command).pipe(
    Match.when("restore", () => handleRestore(cli, backupPath)),
    Match.when("scan", () => handleScan(cli)),
    Match.when("apply", () => handleApply(cli)),
    Match.when("release", () => handleRelease(cli, backupPath)),
    Match.exhaustive
  )

/**
 * Run CLI program with the provided argv.
 *
 * @param argv - process.argv array.
 * @returns ProgramResult with report and exit code.
 *
 * @pure false
 * @effect FileSystem, Path, CommandExecutor, Console
 * @invariant exitCode is deterministic for fixed inputs
 * @complexity O(n)
 */
export const runCli = (
  argv: ReadonlyArray<string>
): Effect.Effect<
  ProgramResult,
  AppError,
  ProgramEnv
> =>
  Effect.gen(function*(_) {
    const cli = yield* _(fromEither(parseCliArgs(argv)))
    const path = yield* _(Path)
    const backupPath = path.join(path.dirname(cli.packagePath), ".package.json.release.bak")
    return yield* _(executeCommand(cli, backupPath))
  })
