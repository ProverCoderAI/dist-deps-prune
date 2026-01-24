import type { CommandExecutor } from "@effect/platform/CommandExecutor"
import type { FileSystem as FileSystemService } from "@effect/platform/FileSystem"
import { Path } from "@effect/platform/Path"
import type { Path as PathService } from "@effect/platform/Path"
import { Effect, Match } from "effect"
import type * as Either from "effect/Either"
import * as Exit from "effect/Exit"

import type { CliArgs } from "../core/cli.js"
import { parseCliArgs } from "../core/cli.js"
import { type FileConfig, resolveConfig, type ResolvedConfig } from "../core/config.js"
import {
  buildPatternsForDistPaths,
  inferDistDirFromPackageJson,
  inferDistRootsFromPackageJson
} from "../core/dist-path.js"
import { type AppError, devDependencyInDist } from "../core/errors.js"
import { listDevDependenciesUsedInDist } from "../core/invariants.js"
import type { PackageJson } from "../core/package-json.js"
import type { PrunePlan } from "../core/prune.js"
import { buildPrunePlan } from "../core/prune.js"
import { buildReport, renderHumanReport, renderJsonReport } from "../core/report.js"
import { mergeAllScanOutcomes } from "../core/scan-outcome.js"
import type { Report, ScanOutcome } from "../core/types.js"
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

// CHANGE: resolve dist path from package.json when --dist is not provided
// WHY: support non-standard build output directories without extra CLI flags
// QUOTE(TZ): "анализировал где смотреть запакованную версию исходя из package.json"
// REF: req-dist-infer-2
// SOURCE: n/a
// FORMAT THEOREM: ∀cli,pkg: dist(cli,pkg)=cli.dist if explicit else join(dirname(pkg), infer(pkg) ?? cli.dist)
// PURITY: SHELL
// EFFECT: n/a
// INVARIANT: resolved distPath is deterministic for fixed inputs
// COMPLEXITY: O(1)
const resolveDistPath = (
  cli: CliArgs,
  pkg: PackageJson,
  path: PathService
): string => {
  if (cli.distExplicit) {
    return cli.dist
  }
  const inferred = inferDistDirFromPackageJson(pkg)
  if (inferred === undefined) {
    return cli.dist
  }
  return path.join(path.dirname(cli.packagePath), inferred)
}

interface ScanPlan {
  readonly distPath: string
  readonly distPaths: ReadonlyArray<string>
  readonly useFiles: boolean
  readonly resolved: ResolvedConfig
}

const hasPatternsOverride = (cli: CliArgs, configFile: FileConfig | undefined): boolean =>
  cli.patterns !== undefined || configFile?.patterns !== undefined

const resolveDistRoots = (cli: CliArgs, pkg: PackageJson): ReadonlyArray<string> =>
  cli.distExplicit ? [] : inferDistRootsFromPackageJson(pkg)

const buildDistPaths = (
  useFiles: boolean,
  distRoots: ReadonlyArray<string>,
  packageDir: string,
  path: PathService
): ReadonlyArray<string> => (useFiles ? distRoots.map((root) => path.join(packageDir, root)) : [])

const resolveDistPathForScan = (
  useFiles: boolean,
  distPaths: ReadonlyArray<string>,
  cli: CliArgs,
  pkg: PackageJson,
  path: PathService
): string => (useFiles ? distPaths[0] ?? cli.dist : resolveDistPath(cli, pkg, path))

const resolvePatternsForScan = (
  useFiles: boolean,
  distPaths: ReadonlyArray<string>
): ReadonlyArray<string> | undefined => (useFiles ? buildPatternsForDistPaths(distPaths) : undefined)

// CHANGE: compute scan plan from CLI, config, and package.json
// WHY: keep analyzeProject within lint limits while preserving determinism
// QUOTE(TZ): "анализировал где смотреть запакованную версию исходя из package.json"
// REF: req-dist-infer-3
// SOURCE: n/a
// FORMAT THEOREM: ∀cli,pkg: plan(cli,pkg).distPath deterministic
// PURITY: SHELL
// EFFECT: n/a
// INVARIANT: resolved patterns list is non-empty
// COMPLEXITY: O(n)
const resolveScanPlan = (
  cli: CliArgs,
  configFile: FileConfig | undefined,
  pkg: PackageJson,
  path: PathService
): ScanPlan => {
  const distRoots = resolveDistRoots(cli, pkg)
  const useFiles = distRoots.length > 0 && !hasPatternsOverride(cli, configFile)
  const packageDir = path.dirname(cli.packagePath)
  const distPaths = buildDistPaths(useFiles, distRoots, packageDir, path)
  const distPath = resolveDistPathForScan(useFiles, distPaths, cli, pkg, path)
  const patterns = resolvePatternsForScan(useFiles, distPaths)
  const resolved = resolveConfig(
    patterns === undefined ? { ...cli, dist: distPath } : { ...cli, dist: distPath, patterns },
    configFile
  )
  return { distPath, distPaths, useFiles, resolved }
}

// CHANGE: run scan according to computed scan plan
// WHY: isolate multi-root scan behavior for lint and readability
// QUOTE(TZ): "их надо анализировать"
// REF: req-dist-files-5
// SOURCE: n/a
// FORMAT THEOREM: ∀plan: scan(plan) returns ScanOutcome
// PURITY: SHELL
// EFFECT: Effect<ScanOutcome, AppError, FileSystem | Path>
// INVARIANT: stats are additive across roots
// COMPLEXITY: O(n)
const scanFromPlan = (
  plan: ScanPlan,
  builtins: ReadonlySet<string>,
  strict: boolean
): Effect.Effect<ScanOutcome, AppError, ScanEnv> =>
  plan.useFiles
    ? Effect.forEach(plan.distPaths, (current) =>
      scanDist({
        distPath: current,
        patterns: plan.resolved.patterns,
        ignorePatterns: plan.resolved.ignorePatterns,
        strict,
        builtins
      }), { concurrency: 1 }).pipe(Effect.map((outcomes) => mergeAllScanOutcomes(outcomes)))
    : scanDist({
      distPath: plan.distPath,
      patterns: plan.resolved.patterns,
      ignorePatterns: plan.resolved.ignorePatterns,
      strict,
      builtins
    })

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
    const pkg = yield* _(readPackageJson(cli.packagePath))
    const path = yield* _(Path)
    const scanPlan = resolveScanPlan(cli, configFile, pkg, path)
    const builtins = yield* _(loadBuiltinModules)
    const scan = yield* _(scanFromPlan(scanPlan, builtins, cli.strict))
    const usedInDev = listDevDependenciesUsedInDist(scan.used, pkg)
    if (usedInDev.length > 0) {
      return yield* _(Effect.fail(devDependencyInDist(usedInDev)))
    }
    const plan = buildPrunePlan(pkg, {
      used: scan.used,
      keep: new Set(scanPlan.resolved.keep),
      pruneDev: scanPlan.resolved.pruneDev,
      pruneOptional: scanPlan.resolved.pruneOptional,
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
