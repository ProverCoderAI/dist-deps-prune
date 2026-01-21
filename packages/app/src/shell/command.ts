import * as Command from "@effect/platform/Command"
import type { CommandExecutor } from "@effect/platform/CommandExecutor"
import * as Effect from "effect/Effect"
import * as Either from "effect/Either"
import { pipe } from "effect/Function"

import type { AppError } from "../core/errors.js"
import { fileError } from "../core/errors.js"

// CHANGE: run external command with Effect CommandExecutor
// WHY: enable release mode with typed exit code handling
// QUOTE(TZ): "Запускает команду из --command"
// REF: req-command-1
// SOURCE: n/a
// FORMAT THEOREM: ∀c: run(c) = code → code ∈ ℕ
// PURITY: SHELL
// EFFECT: Effect<number, AppError, CommandExecutor>
// INVARIANT: stdout/stderr are inherited
// COMPLEXITY: O(n)

type QuoteState = "\"" | "'" | null

interface ParseStep {
  readonly current: string
  readonly quote: QuoteState
  readonly index: number
  readonly pushToken: boolean
}

const consumeQuoted = (
  input: string,
  index: number,
  current: string,
  quote: QuoteState
): ParseStep => {
  const char = input.charAt(index)
  const nextChar = input.charAt(index + 1)
  if (quote !== null && char === quote) {
    return { current, quote: null, index: index + 1, pushToken: false }
  }
  if (quote === "\"" && char === "\\" && nextChar.length > 0) {
    return { current: current + nextChar, quote, index: index + 2, pushToken: false }
  }
  return { current: current + char, quote, index: index + 1, pushToken: false }
}

const consumeUnquoted = (input: string, index: number, current: string): ParseStep => {
  const char = input.charAt(index)
  const nextChar = input.charAt(index + 1)
  if (char === "\"" || char === "'") {
    return { current, quote: char, index: index + 1, pushToken: false }
  }
  if (char.trim().length === 0) {
    return { current: "", quote: null, index: index + 1, pushToken: current.length > 0 }
  }
  if (char === "\\" && nextChar.length > 0) {
    return { current: current + nextChar, quote: null, index: index + 2, pushToken: false }
  }
  return { current: current + char, quote: null, index: index + 1, pushToken: false }
}

const splitCommandLine = (input: string): Either.Either<Array<string>, AppError> => {
  let result: Array<string> = []
  let current = ""
  let quote: QuoteState = null
  let index = 0
  while (index < input.length) {
    const step: ParseStep = quote
      ? consumeQuoted(input, index, current, quote)
      : consumeUnquoted(input, index, current)
    if (step.pushToken) {
      result = [...result, current]
    }
    current = step.current
    quote = step.quote
    index = step.index
  }
  if (quote !== null) {
    return Either.left(fileError("Unterminated quote in --command"))
  }
  if (current.length > 0) {
    result = [...result, current]
  }
  return Either.right(result)
}

export const runCommand = (
  commandLine: string,
  cwd: string
): Effect.Effect<number, AppError, CommandExecutor> =>
  Effect.gen(function*(_) {
    const parts = splitCommandLine(commandLine)
    if (Either.isLeft(parts)) {
      return yield* _(Effect.fail(parts.left))
    }
    if (parts.right.length === 0) {
      return yield* _(Effect.fail(fileError("Empty --command")))
    }
    const [cmd, ...args] = parts.right
    if (cmd === undefined) {
      return yield* _(Effect.fail(fileError("Empty --command")))
    }
    const command = pipe(
      Command.make(cmd, ...args),
      Command.stdin("inherit"),
      Command.stdout("inherit"),
      Command.stderr("inherit"),
      Command.workingDirectory(cwd)
    )
    const exitCode = yield* _(
      Command.exitCode(command).pipe(Effect.mapError((error) => fileError(String(error))))
    )
    return Number(exitCode)
  })
