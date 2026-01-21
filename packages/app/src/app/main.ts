import { NodeContext, NodeRuntime } from "@effect/platform-node"
import { Effect } from "effect"

import { runCli } from "./program.js"

// CHANGE: wire CLI program into Node runtime with proper teardown
// WHY: execute effects with platform services and typed error handling
// QUOTE(TZ): "CLI-тулу"
// REF: req-main-1
// SOURCE: n/a
// FORMAT THEOREM: runMain(program) terminates with exitCode from ProgramResult
// PURITY: SHELL
// EFFECT: Effect<void, never, NodeContext>
// INVARIANT: non-zero exit codes terminate the process
// COMPLEXITY: O(1)

const main = Effect.gen(function*(_) {
  const result = yield* _(runCli(process.argv))
  if (result.exitCode !== 0) {
    yield* _(
      Effect.sync(() => {
        process.exitCode = result.exitCode
      })
    )
  }
})

NodeRuntime.runMain(Effect.provide(main, NodeContext.layer))
