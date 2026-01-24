import { describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"

import { runCli } from "../../src/app/program.js"
import { runCommand } from "../../src/shell/command.js"
import { provideNodeContext, withTempDir } from "./test-helpers.js"

const INTEGRATION = process.env["DIST_DEPS_PRUNE_INTEGRATION"] === "1"
const REPO_URL = "https://github.com/ProverCoderAI/component-tagger.git"
const REPO_COMMIT = "05f69625c268c12426987b25dee5bdd65658c990"

const expectExitZero = (label: string) => (exitCode: number): Effect.Effect<number> =>
  Effect.succeed(exitCode).pipe(
    Effect.map((value) => {
      expect(value, label).toBe(0)
      return value
    })
  )

describe("component-tagger integration", () => {
  if (INTEGRATION) {
    it.effect(
      "fails when dist imports devDependencies",
      () =>
        withTempDir(({ path, tempDir }) =>
          Effect.gen(function*(_) {
            const repoDir = path.join(tempDir, "component-tagger")
            const repoDirQuoted = `"${repoDir}"`

            yield* _(
              runCommand(`git clone ${REPO_URL} ${repoDirQuoted}`, tempDir).pipe(
                Effect.flatMap(expectExitZero("git clone")),
                Effect.asVoid
              )
            )
            yield* _(
              runCommand(`git -C ${repoDirQuoted} checkout ${REPO_COMMIT}`, tempDir).pipe(
                Effect.flatMap(expectExitZero("git checkout")),
                Effect.asVoid
              )
            )
            yield* _(
              runCommand(`pnpm -C ${repoDirQuoted} install`, tempDir).pipe(
                Effect.flatMap(expectExitZero("pnpm install")),
                Effect.asVoid
              )
            )
            yield* _(
              runCommand(`pnpm -C ${repoDirQuoted} build`, tempDir).pipe(
                Effect.flatMap(expectExitZero("pnpm build")),
                Effect.asVoid
              )
            )

            const pkgPath = path.join(repoDir, "packages", "app", "package.json")
            const scanArgs = [
              "node",
              "cli",
              "scan",
              "--package",
              pkgPath,
              "--silent"
            ]

            const scanResult = yield* _(Effect.either(runCli(scanArgs)))
            if (scanResult._tag === "Left") {
              if (scanResult.left._tag === "DevDependencyInDist") {
                expect(scanResult.left.packages).toContain("vite")
                expect(scanResult.left.message).toContain("devDependencies")
              } else {
                expect(scanResult.left._tag).toBe("DevDependencyInDist")
              }
            } else {
              expect(scanResult._tag).toBe("Left")
            }
          })
        ).pipe(provideNodeContext),
      120_000
    )
  } else {
    it.skip("fails when dist imports devDependencies", () => {})
  }
})
