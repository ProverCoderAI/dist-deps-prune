import type { PlatformError } from "@effect/platform/Error"
import { FileSystem } from "@effect/platform/FileSystem"
import type { FileSystem as FileSystemService } from "@effect/platform/FileSystem"
import { Path } from "@effect/platform/Path"
import type { Path as PathService } from "@effect/platform/Path"
import * as Effect from "effect/Effect"
import * as Option from "effect/Option"

import type { AppError } from "../core/errors.js"
import { distNotFound, fileError, parseFileError } from "../core/errors.js"
import { compileGlobs, matchesAnyGlob } from "../core/glob.js"
import { normalizePackageName } from "../core/normalize.js"
import { parseImportsFromSource } from "../core/parse.js"
import type { ScanOutcome, Warning } from "../core/types.js"

// CHANGE: implement dist scanning with Effect file system services
// WHY: isolate IO while producing a deterministic ScanOutcome
// QUOTE(TZ): "Анализирует содержимое dist/ и строит множество внешних пакетов USED."
// REF: req-scan-1
// SOURCE: n/a
// FORMAT THEOREM: ∀f ∈ filesScanned: imports(f) ⊆ USED ∪ warnings
// PURITY: SHELL
// EFFECT: Effect<ScanOutcome, AppError, FileSystem | Path>
// INVARIANT: warnings include parse and dynamic import cases
// COMPLEXITY: O(n + m) where n = files, m = total AST nodes

export interface ScanSettings {
  readonly distPath: string
  readonly patterns: ReadonlyArray<string>
  readonly ignorePatterns: ReadonlyArray<string>
  readonly strict: boolean
  readonly builtins: ReadonlySet<string>
}

const normalizePath = (value: string): string => value.replaceAll("\\", "/")

const matchesPatterns = (
  include: ReadonlyArray<RegExp>,
  ignore: ReadonlyArray<RegExp>,
  candidates: ReadonlyArray<string>
): boolean => {
  const isIncluded = candidates.some((candidate) => matchesAnyGlob(include, candidate))
  if (!isIncluded) {
    return false
  }
  return !candidates.some((candidate) => matchesAnyGlob(ignore, candidate))
}

const scanFile = (
  filePath: string,
  source: string,
  builtins: ReadonlySet<string>
): {
  readonly used: ReadonlyArray<string>
  readonly warnings: ReadonlyArray<Warning>
  readonly importsFound: number
} => {
  const parsedEither = parseImportsFromSource(source, filePath)
  if (parsedEither._tag === "Left") {
    const warning: Warning = {
      type: "parse-error",
      file: filePath,
      error: parsedEither.left
    }
    return { used: [], warnings: [warning], importsFound: 0 }
  }
  const parsed = parsedEither.right
  const warnings: Array<Warning> = []
  for (const expr of parsed.dynamicImports) {
    warnings.push({ type: "dynamic-import", file: filePath, expr })
  }
  for (const expr of parsed.dynamicRequires) {
    warnings.push({ type: "dynamic-require", file: filePath, expr })
  }
  const used = parsed.staticSpecifiers
    .map((specifier) => normalizePackageName(specifier, builtins))
    .filter((option) => Option.isSome(option))
    .map((option) => option.value)
  return { used, warnings, importsFound: parsed.staticSpecifiers.length }
}

const mapFsError = (error: PlatformError): AppError => fileError(String(error))

const ensureDistExists = (
  fs: FileSystemService,
  distPath: string
): Effect.Effect<void, AppError> =>
  Effect.gen(function*(_) {
    const exists = yield* _(fs.exists(distPath).pipe(Effect.mapError(mapFsError)))
    if (!exists) {
      return yield* _(Effect.fail(distNotFound(distPath)))
    }
  })

const readDistEntries = (
  fs: FileSystemService,
  distPath: string
): Effect.Effect<ReadonlyArray<string>, AppError> =>
  fs.readDirectory(distPath, { recursive: true }).pipe(Effect.mapError(mapFsError))

interface FilterEntriesInput {
  readonly path: PathService
  readonly cwd: string
  readonly distPath: string
  readonly entries: ReadonlyArray<string>
  readonly include: ReadonlyArray<RegExp>
  readonly ignore: ReadonlyArray<RegExp>
}

const filterEntries = (input: FilterEntriesInput): ReadonlyArray<string> => {
  const candidates = input.entries.map((entry) => input.path.join(input.distPath, entry))
  return candidates.filter((absolutePath) => {
    const relativeToCwd = normalizePath(input.path.relative(input.cwd, absolutePath))
    const relativeToDist = normalizePath(input.path.relative(input.distPath, absolutePath))
    const absolute = normalizePath(absolutePath)
    return matchesPatterns(input.include, input.ignore, [absolute, relativeToCwd, relativeToDist])
  })
}

const scanFiles = (
  fs: FileSystemService,
  files: ReadonlyArray<string>,
  settings: ScanSettings
): Effect.Effect<ScanOutcome, AppError> =>
  Effect.gen(function*(_) {
    const initialUsed = new Set<string>()
    const warnings: Array<Warning> = []
    let importsFound = 0

    for (const filePath of files) {
      const source = yield* _(fs.readFileString(filePath).pipe(Effect.mapError(mapFsError)))
      const fileResult = scanFile(filePath, source, settings.builtins)
      if (settings.strict && fileResult.warnings.some((warning) => warning.type === "parse-error")) {
        const parseWarning = fileResult.warnings.find((warning) => warning.type === "parse-error")
        if (parseWarning) {
          return yield* _(Effect.fail(parseFileError(parseWarning.file, parseWarning.error)))
        }
      }
      for (const pkg of fileResult.used) {
        initialUsed.add(pkg)
      }
      for (const warning of fileResult.warnings) {
        warnings.push(warning)
      }
      importsFound += fileResult.importsFound
    }

    return {
      used: initialUsed,
      warnings,
      stats: {
        filesScanned: files.length,
        importsFound
      }
    }
  })

export const scanDist = (
  settings: ScanSettings
): Effect.Effect<ScanOutcome, AppError, FileSystemService | PathService> =>
  Effect.gen(function*(_) {
    const fs = yield* _(FileSystem)
    const path = yield* _(Path)

    yield* _(ensureDistExists(fs, settings.distPath))
    const cwd = yield* _(Effect.sync(() => process.cwd()))
    const includeGlobs = compileGlobs(settings.patterns)
    const ignoreGlobs = compileGlobs(settings.ignorePatterns)

    const entries = yield* _(readDistEntries(fs, settings.distPath))
    const filtered = filterEntries({
      path,
      cwd,
      distPath: settings.distPath,
      entries,
      include: includeGlobs,
      ignore: ignoreGlobs
    })
    return yield* _(scanFiles(fs, filtered, settings))
  })
