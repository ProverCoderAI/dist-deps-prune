import { describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"

import { runCli } from "../../src/app/program.js"
import { runCommand } from "../../src/shell/command.js"
import { readPackageJson } from "../../src/shell/package-json.js"
import { provideNodeContext, withTempDir } from "./test-helpers.js"

const INTEGRATION = process.env["DIST_DEPS_PRUNE_INTEGRATION"] === "1"
const REPO_URL = "https://github.com/ProverCoderAI/component-tagger.git"
const REPO_COMMIT = "05f69625c268c12426987b25dee5bdd65658c990"

const compareStrings = (left: string, right: string): number => left.localeCompare(right)

const mergeSorted = (
  left: ReadonlyArray<string>,
  right: ReadonlyArray<string>
): ReadonlyArray<string> => {
  if (left.length === 0) {
    return right
  }
  if (right.length === 0) {
    return left
  }
  const leftHead = left[0] ?? ""
  const rightHead = right[0] ?? ""
  if (compareStrings(leftHead, rightHead) <= 0) {
    return [leftHead, ...mergeSorted(left.slice(1), right)]
  }
  return [rightHead, ...mergeSorted(left, right.slice(1))]
}

const mergeSort = (values: ReadonlyArray<string>): ReadonlyArray<string> => {
  if (values.length <= 1) {
    return [...values]
  }
  const mid = Math.floor(values.length / 2)
  const left = mergeSort(values.slice(0, mid))
  const right = mergeSort(values.slice(mid))
  return mergeSorted(left, right)
}

const expectExitZero = (label: string) => (exitCode: number): Effect.Effect<number> =>
  Effect.succeed(exitCode).pipe(
    Effect.map((value) => {
      expect(value, label).toBe(0)
      return value
    })
  )

const sortedKeys = (record: Readonly<Record<string, string>> | undefined): ReadonlyArray<string> =>
  mergeSort(Object.keys(record ?? {}))

describe("component-tagger integration", () => {
  if (INTEGRATION) {
    it.effect(
      "prunes devDependencies based on dist output",
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

            const distDir = path.join(repoDir, "packages", "app", "dist")
            const pkgPath = path.join(repoDir, "packages", "app", "package.json")
            const scanArgs = [
              "node",
              "cli",
              "scan",
              "--dist",
              distDir,
              "--package",
              pkgPath,
              "--silent"
            ]
            const applyArgs = [
              "node",
              "cli",
              "apply",
              "--dist",
              distDir,
              "--package",
              pkgPath,
              "--write",
              "--prune-dev",
              "true",
              "--silent"
            ]

            const before = yield* _(runCli(scanArgs))
            expect(before.exitCode).toBe(0)
            expect(before.report.used).toContain("@babel/core")
            expect(before.report.used).toContain("effect")
            expect(before.report.used).toContain("vite")
            expect(before.report.unused.devDependencies.length).toBeGreaterThan(0)
            expect(before.report.unused.devDependencies).toContain("@types/node")

            const applyResult = yield* _(runCli(applyArgs))
            expect(applyResult.exitCode).toBe(0)

            const pkg = yield* _(readPackageJson(pkgPath))
            const devDeps = sortedKeys(pkg.devDependencies)
            const deps = sortedKeys(pkg.dependencies)
            expect(devDeps).toEqual(["vite"])
            expect(deps).toEqual(["@babel/core", "@effect/platform", "@effect/platform-node", "effect"])

            const after = yield* _(runCli(scanArgs))
            expect(after.exitCode).toBe(0)
            expect(after.report.unused.devDependencies).toEqual([])
            expect(after.report.unused.dependencies).toEqual([])
          })
        ).pipe(provideNodeContext),
      120_000
    )
  } else {
    it.skip("prunes devDependencies based on dist output", () => {})
  }
})
