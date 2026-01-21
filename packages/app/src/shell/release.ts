import type { PlatformError } from "@effect/platform/Error"
import type { FileSystem as FileSystemService } from "@effect/platform/FileSystem"
import { FileSystem } from "@effect/platform/FileSystem"
import * as Effect from "effect/Effect"

import type { AppError } from "../core/errors.js"
import { fileError, restoreError } from "../core/errors.js"

// CHANGE: add backup/restore helpers for release mode
// WHY: allow pruning without polluting git history and restore package.json
// QUOTE(TZ): "делает backup package.json → .package.json.release.bak"
// REF: req-release-1
// SOURCE: n/a
// FORMAT THEOREM: backup(p); restore(p) → package.json restored byte-for-byte
// PURITY: SHELL
// EFFECT: Effect<void, AppError, FileSystem>
// INVARIANT: backup path is deterministic
// COMPLEXITY: O(n)

type FileSystemEffect<A> = Effect.Effect<A, AppError, FileSystemService>

const mapFileError = (error: PlatformError): AppError => fileError(String(error))

const mapRestoreError = (error: PlatformError): AppError => restoreError(String(error))

const withFileSystem = <A>(
  handler: (fs: FileSystemService) => Effect.Effect<A, AppError, FileSystemService>
): FileSystemEffect<A> =>
  Effect.gen(function*(_) {
    const fs = yield* _(FileSystem)
    return yield* _(handler(fs))
  })

const readFile = (
  fs: FileSystemService,
  path: string,
  onError: (error: PlatformError) => AppError
): Effect.Effect<string, AppError> => fs.readFileString(path).pipe(Effect.mapError(onError))

const writeFile = (
  fs: FileSystemService,
  path: string,
  contents: string,
  onError: (error: PlatformError) => AppError
): Effect.Effect<void, AppError> => fs.writeFileString(path, contents).pipe(Effect.mapError(onError))

const pathExists = (
  fs: FileSystemService,
  path: string,
  onError: (error: PlatformError) => AppError
): Effect.Effect<boolean, AppError> => fs.exists(path).pipe(Effect.mapError(onError))

const copyFile = (
  fs: FileSystemService,
  from: string,
  to: string,
  onError: (error: PlatformError) => AppError
): Effect.Effect<void, AppError> =>
  Effect.gen(function*(_) {
    const contents = yield* _(readFile(fs, from, onError))
    yield* _(writeFile(fs, to, contents, onError))
  })

const ensureThenCopy = (
  fs: FileSystemService,
  source: string,
  target: string,
  onError: (error: PlatformError) => AppError,
  missing: AppError
): Effect.Effect<void, AppError> =>
  Effect.gen(function*(_) {
    const exists = yield* _(pathExists(fs, source, onError))
    if (!exists) {
      return yield* _(Effect.fail(missing))
    }
    yield* _(copyFile(fs, source, target, onError))
  })

export const backupPackageJson = (
  packagePath: string,
  backupPath: string
): FileSystemEffect<void> => withFileSystem((fs) => copyFile(fs, packagePath, backupPath, mapFileError))

export const restorePackageJson = (
  packagePath: string,
  backupPath: string
): FileSystemEffect<void> =>
  withFileSystem((fs) =>
    ensureThenCopy(
      fs,
      backupPath,
      packagePath,
      mapRestoreError,
      restoreError(`Backup file not found: ${backupPath}`)
    )
  )

export const ensureBackup = (
  packagePath: string,
  backupPath: string
): FileSystemEffect<void> =>
  withFileSystem((fs) =>
    ensureThenCopy(
      fs,
      packagePath,
      backupPath,
      mapFileError,
      fileError(`package.json not found: ${packagePath}`)
    )
  )
