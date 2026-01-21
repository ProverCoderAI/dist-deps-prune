import { describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"
import * as Either from "effect/Either"
import * as Option from "effect/Option"

import { normalizePackageName } from "../../src/core/normalize.js"
import { parseImportsFromSource } from "../../src/core/parse.js"

const builtins = new Set<string>(["fs", "path"])

const collectUsed = (specifiers: ReadonlyArray<string>): ReadonlyArray<string> =>
  specifiers
    .map((specifier) => normalizePackageName(specifier, builtins))
    .filter((option) => Option.isSome(option))
    .map((option) => option.value)

describe("parseImportsFromSource + normalizePackageName", () => {
  it.effect("detects ESM imports as used packages", () =>
    Effect.sync(() => {
      const parsed = parseImportsFromSource(`import { x } from "a"`, "dist/a.js")
      expect(Either.isRight(parsed)).toBe(true)
      if (Either.isRight(parsed)) {
        const used = collectUsed(parsed.right.staticSpecifiers)
        expect(used).toContain("a")
      }
    }))

  it.effect("detects CJS require as used packages", () =>
    Effect.sync(() => {
      const parsed = parseImportsFromSource(`const b = require("b")`, "dist/b.cjs")
      expect(Either.isRight(parsed)).toBe(true)
      if (Either.isRight(parsed)) {
        const used = collectUsed(parsed.right.staticSpecifiers)
        expect(used).toContain("b")
      }
    }))

  it.effect("normalizes scoped subpaths to top-level package", () =>
    Effect.sync(() => {
      const parsed = parseImportsFromSource(`import x from "@scope/pkg/path"`, "dist/c.js")
      expect(Either.isRight(parsed)).toBe(true)
      if (Either.isRight(parsed)) {
        const used = collectUsed(parsed.right.staticSpecifiers)
        expect(used).toContain("@scope/pkg")
        expect(used).not.toContain("@scope/pkg/path")
      }
    }))

  it.effect("ignores node builtins", () =>
    Effect.sync(() => {
      const parsed = parseImportsFromSource(`import fs from "node:fs"`, "dist/d.js")
      expect(Either.isRight(parsed)).toBe(true)
      if (Either.isRight(parsed)) {
        const used = collectUsed(parsed.right.staticSpecifiers)
        expect(used).not.toContain("fs")
      }
    }))

  it.effect("ignores relative imports", () =>
    Effect.sync(() => {
      const parsed = parseImportsFromSource(`import x from "./local"`, "dist/e.js")
      expect(Either.isRight(parsed)).toBe(true)
      if (Either.isRight(parsed)) {
        const used = collectUsed(parsed.right.staticSpecifiers)
        expect(used).toEqual([])
      }
    }))

  it.effect("reports dynamic imports", () =>
    Effect.sync(() => {
      const parsed = parseImportsFromSource(`import(foo)`, "dist/f.js")
      expect(Either.isRight(parsed)).toBe(true)
      if (Either.isRight(parsed)) {
        expect(parsed.right.dynamicImports.length).toBe(1)
      }
    }))

  it.effect("includes .d.ts type imports as used", () =>
    Effect.sync(() => {
      const parsed = parseImportsFromSource(
        `export type Foo = import("types-pkg").Foo; import type { Bar } from "types-pkg-2"`,
        "dist/index.d.ts"
      )
      expect(Either.isRight(parsed)).toBe(true)
      if (Either.isRight(parsed)) {
        const used = collectUsed(parsed.right.staticSpecifiers)
        expect(used).toContain("types-pkg")
        expect(used).toContain("types-pkg-2")
      }
    }))
})
