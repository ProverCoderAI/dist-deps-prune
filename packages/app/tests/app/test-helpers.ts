import { NodeContext } from "@effect/platform-node"
import type { PlatformError } from "@effect/platform/Error"
import { FileSystem, type FileSystem as FileSystemService } from "@effect/platform/FileSystem"
import { Path, type Path as PathService } from "@effect/platform/Path"
import { Effect } from "effect"

export interface TempContext {
  readonly fs: FileSystemService
  readonly path: PathService
  readonly tempDir: string
}

export const withTempDir = <A, E, R>(
  use: (context: TempContext) => Effect.Effect<A, E, R>
): Effect.Effect<A, E | PlatformError, R | FileSystemService | PathService> =>
  Effect.gen(function*(_) {
    const fs = yield* _(FileSystem)
    const path = yield* _(Path)
    const tempDir = yield* _(fs.makeTempDirectory())
    return yield* _(use({ fs, path, tempDir }))
  })

export const provideNodeContext = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  effect.pipe(Effect.provide(NodeContext.layer))
