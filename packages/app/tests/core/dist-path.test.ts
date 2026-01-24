import { describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"

import {
  buildPatternsForDistPaths,
  inferDistDirFromPackageJson,
  inferDistRootsFromPackageJson
} from "../../src/core/dist-path.js"
import type { PackageJson } from "../../src/core/package-json.js"

describe("inferDistDirFromPackageJson", () => {
  it.effect("prefers JS entrypoints when available", () =>
    Effect.sync(() => {
      const pkg: PackageJson = {
        name: "fixture",
        version: "1.0.0",
        main: "lib/index.js",
        module: "lib/index.mjs",
        files: ["dist", "README.md"]
      }
      expect(inferDistDirFromPackageJson(pkg)).toEqual("lib")
    }))

  it.effect("uses JS export targets over types", () =>
    Effect.sync(() => {
      const pkg: PackageJson = {
        name: "fixture",
        version: "1.0.0",
        exports: {
          ".": {
            import: "./dist/index.mjs",
            types: "./types/index.d.ts"
          }
        },
        files: ["dist", "types"]
      }
      expect(inferDistDirFromPackageJson(pkg)).toEqual("dist")
    }))

  it.effect("falls back to files entries when entrypoints are missing", () =>
    Effect.sync(() => {
      const pkg: PackageJson = {
        name: "fixture",
        version: "1.0.0",
        files: ["build", "README.md"]
      }
      expect(inferDistDirFromPackageJson(pkg)).toEqual("build")
    }))

  it.effect("ignores file-only entries without a directory", () =>
    Effect.sync(() => {
      const pkg: PackageJson = {
        name: "fixture",
        version: "1.0.0",
        files: ["README.md"]
      }
      expect(inferDistDirFromPackageJson(pkg)).toEqual(undefined)
    }))
})

describe("inferDistRootsFromPackageJson", () => {
  it.effect("returns unique directory roots from files", () =>
    Effect.sync(() => {
      const pkg: PackageJson = {
        name: "fixture",
        version: "1.0.0",
        files: ["dist", "lib/", "README.md", "lib/"]
      }
      expect(inferDistRootsFromPackageJson(pkg)).toEqual(["dist", "lib"])
    }))

  it.effect("extracts roots from nested and globbed entries", () =>
    Effect.sync(() => {
      const pkg: PackageJson = {
        name: "fixture",
        version: "1.0.0",
        files: ["bin/cli.js", "lib/cjs/**", "!dist/secret.js"]
      }
      expect(inferDistRootsFromPackageJson(pkg)).toEqual(["bin", "lib/cjs"])
    }))
})

describe("buildPatternsForDistPaths", () => {
  it.effect("expands to JS/d.ts patterns per path", () =>
    Effect.sync(() => {
      const patterns = buildPatternsForDistPaths(["dist", "lib/cjs"])
      expect(patterns).toEqual(
        expect.arrayContaining([
          "dist/**/*.js",
          "dist/**/*.mjs",
          "dist/**/*.cjs",
          "dist/**/*.d.ts",
          "lib/cjs/**/*.js",
          "lib/cjs/**/*.mjs",
          "lib/cjs/**/*.cjs",
          "lib/cjs/**/*.d.ts"
        ])
      )
    }))
})
