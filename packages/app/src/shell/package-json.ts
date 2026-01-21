import type { FileSystem as FileSystemService } from "@effect/platform/FileSystem"
import { FileSystem } from "@effect/platform/FileSystem"
import * as Schema from "@effect/schema/Schema"
import * as TreeFormatter from "@effect/schema/TreeFormatter"
import * as Effect from "effect/Effect"
import { pipe } from "effect/Function"

import type { AppError } from "../core/errors.js"
import { fileError } from "../core/errors.js"
import type { Json } from "../core/json.js"
import { decodePackageJson, isJsonObject } from "../core/package-json.js"
import type { PackageJson } from "../core/package-json.js"

// CHANGE: provide package.json read/write helpers with validation
// WHY: isolate filesystem IO while keeping typed dependency maps
// QUOTE(TZ): "package.json текущего пакета"
// REF: req-pkg-io-1
// SOURCE: n/a
// FORMAT THEOREM: ∀p: read(p) = Right(pkg) → pkg.dependencies values are strings
// PURITY: SHELL
// EFFECT: Effect<PackageJson, AppError, FileSystem>
// INVARIANT: JSON is validated before use
// COMPLEXITY: O(n)

const JsonSchema: Schema.Schema<Json> = Schema.suspend(() =>
  Schema.Union(
    Schema.Null,
    Schema.Boolean,
    Schema.Number,
    Schema.String,
    Schema.Array(JsonSchema),
    Schema.Record({ key: Schema.String, value: JsonSchema })
  )
)

const JsonParseSchema = Schema.parseJson(JsonSchema)

const parseJson = (raw: string): Effect.Effect<Json, AppError> =>
  pipe(
    Schema.decodeUnknown(JsonParseSchema)(raw),
    Effect.mapError((error) => fileError(TreeFormatter.formatErrorSync(error)))
  )

export const readPackageJsonRaw = (
  path: string
): Effect.Effect<string, AppError, FileSystemService> =>
  Effect.gen(function*(_) {
    const fs = yield* _(FileSystem)
    return yield* _(
      fs.readFileString(path).pipe(Effect.mapError((error) => fileError(String(error))))
    )
  })

export const readPackageJson = (
  path: string
): Effect.Effect<PackageJson, AppError, FileSystemService> =>
  Effect.gen(function*(_) {
    const raw = yield* _(readPackageJsonRaw(path))
    const parsed = yield* _(parseJson(raw))
    if (!isJsonObject(parsed)) {
      return yield* _(Effect.fail(fileError("package.json must be an object")))
    }
    const decoded = decodePackageJson(parsed)
    if (decoded._tag === "Left") {
      return yield* _(Effect.fail(fileError(decoded.left.message)))
    }
    return decoded.right
  })

export const writePackageJson = (
  path: string,
  pkg: PackageJson
): Effect.Effect<void, AppError, FileSystemService> =>
  Effect.gen(function*(_) {
    const fs = yield* _(FileSystem)
    const payload = JSON.stringify(pkg, null, 2) + "\n"
    yield* _(
      fs.writeFileString(path, payload).pipe(Effect.mapError((error) => fileError(String(error))))
    )
  })
