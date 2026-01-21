import type { FileSystem as FileSystemService } from "@effect/platform/FileSystem"
import { FileSystem } from "@effect/platform/FileSystem"
import * as S from "@effect/schema/Schema"
import * as TreeFormatter from "@effect/schema/TreeFormatter"
import * as Effect from "effect/Effect"
import { pipe } from "effect/Function"

import type { FileConfig } from "../core/config.js"
import type { AppError } from "../core/errors.js"
import { configError, fileError } from "../core/errors.js"

// CHANGE: decode .dist-deps-prune.json with schema validation
// WHY: keep boundary data typed and reject invalid config early
// QUOTE(TZ): "поддержать файл .dist-deps-prune.json"
// REF: req-config-file-1
// SOURCE: n/a
// FORMAT THEOREM: ∀c: decode(c) = Right(cfg) → cfg fields have correct types
// PURITY: SHELL
// EFFECT: Effect<FileConfig | undefined, AppError, FileSystem>
// INVARIANT: missing config yields undefined
// COMPLEXITY: O(n)

const RawConfigSchema = S.partial(
  S.Struct({
    keep: S.Array(S.String),
    ignorePatterns: S.Array(S.String),
    pruneDev: S.Boolean,
    pruneOptional: S.Boolean,
    patterns: S.Array(S.String)
  })
)

const ConfigSchema = S.parseJson(RawConfigSchema)

const decodeConfig = (raw: string): Effect.Effect<FileConfig, AppError> =>
  pipe(
    S.decodeUnknown(ConfigSchema)(raw),
    Effect.map((config) => ({
      ...(config.keep === undefined ? {} : { keep: config.keep }),
      ...(config.ignorePatterns === undefined ? {} : { ignorePatterns: config.ignorePatterns }),
      ...(config.pruneDev === undefined ? {} : { pruneDev: config.pruneDev }),
      ...(config.pruneOptional === undefined ? {} : { pruneOptional: config.pruneOptional }),
      ...(config.patterns === undefined ? {} : { patterns: config.patterns })
    })),
    Effect.mapError((error) => configError(TreeFormatter.formatErrorSync(error)))
  )

export const loadConfigFile = (
  path: string | undefined,
  explicit: boolean
): Effect.Effect<FileConfig | undefined, AppError, FileSystemService> =>
  Effect.gen(function*(_) {
    if (path === undefined) {
      return
    }
    const fs = yield* _(FileSystem)
    const exists = yield* _(
      fs.exists(path).pipe(Effect.mapError((error) => fileError(String(error))))
    )
    if (!exists) {
      if (explicit) {
        return yield* _(Effect.fail(fileError(`Config file not found: ${path}`)))
      }
      return
    }
    const contents = yield* _(
      fs.readFileString(path).pipe(Effect.mapError((error) => fileError(String(error))))
    )
    const decoded = yield* _(decodeConfig(contents))
    return decoded
  })
