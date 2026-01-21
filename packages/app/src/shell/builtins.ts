import * as Effect from "effect/Effect"

import type { AppError } from "../core/errors.js"
import { fileError } from "../core/errors.js"

// CHANGE: provide Node builtin module set for filtering
// WHY: builtins must be excluded from USED dependency detection
// QUOTE(TZ): "Node builtins: fs, path, url, node:fs и т.д."
// REF: req-builtins-1
// SOURCE: n/a
// FORMAT THEOREM: ∀b ∈ builtins: b does not represent an external package
// PURITY: SHELL
// EFFECT: Effect<ReadonlySet<string>, AppError, never>
// INVARIANT: node: prefix is stripped
// COMPLEXITY: O(n)

export const loadBuiltinModules: Effect.Effect<ReadonlySet<string>, AppError> = Effect.tryPromise({
  try: () => import("node:module"),
  catch: (error) => fileError(String(error))
}).pipe(
  Effect.map((module) => {
    const result = new Set<string>()
    for (const name of module.builtinModules) {
      if (name.startsWith("node:")) {
        result.add(name.slice("node:".length))
      } else {
        result.add(name)
      }
    }
    return result
  })
)
