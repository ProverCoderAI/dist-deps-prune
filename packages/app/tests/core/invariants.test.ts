import { describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"

import { listDevDependenciesUsedInDist } from "../../src/core/invariants.js"
import type { PackageJson } from "../../src/core/package-json.js"

describe("listDevDependenciesUsedInDist", () => {
  it.effect("returns sorted intersection of used and devDependencies", () =>
    Effect.sync(() => {
      const used = new Set<string>(["b", "a", "c", "p", "o", "z"])
      const pkg: PackageJson = {
        name: "fixture",
        version: "1.0.0",
        dependencies: {
          b: "1.0.0"
        },
        peerDependencies: {
          p: "1.0.0"
        },
        optionalDependencies: {
          o: "1.0.0"
        },
        devDependencies: {
          b: "1.0.0",
          d: "1.0.0",
          a: "1.0.0",
          p: "1.0.0",
          o: "1.0.0",
          z: "1.0.0"
        }
      }
      const result = listDevDependenciesUsedInDist(used, pkg)
      expect(result).toEqual(["a", "b", "o", "p", "z"])
    }))
})
