import { describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"

import { runCli } from "../../src/app/program.js"
import { provideNodeContext, withTempDir } from "./test-helpers.js"

describe("release mode restore", () => {
  it.effect("restores package.json byte-for-byte after command", () =>
    withTempDir(({ fs, path, tempDir }) =>
      Effect.gen(function*(_) {
        const distDir = path.join(tempDir, "dist")
        yield* _(fs.makeDirectory(distDir, { recursive: true }))
        const pkgPath = path.join(tempDir, "package.json")
        const original =
          `{\n  "name": "fixture",\n  "version": "1.0.0",\n  "dependencies": {\n    "a": "1.0.0"\n  }\n}\n`
        yield* _(fs.writeFileString(pkgPath, original))
        const distFile = path.join(distDir, "index.js")
        yield* _(fs.writeFileString(distFile, `import "a"`))

        const argv = [
          "node",
          "cli",
          "release",
          "--dist",
          distDir,
          "--package",
          pkgPath,
          "--command",
          "node -e \"process.exit(0)\"",
          "--silent"
        ]
        const result = yield* _(runCli(argv))
        const restored = yield* _(fs.readFileString(pkgPath))

        expect(result.exitCode).toBe(0)
        expect(restored).toBe(original)
      })
    ).pipe(provideNodeContext))
})
