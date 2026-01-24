import { Match } from "effect"
import * as Either from "effect/Either"

// CHANGE: implement deterministic CLI parsing for dist-deps-prune
// WHY: keep CLI decoding pure and testable at the boundary
// QUOTE(TZ): "CLI интерфейс (финальная спецификация)"
// REF: req-cli-parse-1
// SOURCE: n/a
// FORMAT THEOREM: ∀argv: parse(argv) = Right(args) → args.command ∈ Commands
// PURITY: CORE
// EFFECT: n/a
// INVARIANT: unknown flags are rejected
// COMPLEXITY: O(n) where n = argv length

export type CliCommand = "scan" | "apply" | "release" | "restore"

export interface CliArgs {
  readonly command: CliCommand
  readonly dist: string
  readonly distExplicit: boolean
  readonly packagePath: string
  readonly ignorePath: string | undefined
  readonly ignorePathExplicit: boolean
  readonly keep: ReadonlyArray<string>
  readonly json: boolean
  readonly silent: boolean
  readonly strict: boolean
  readonly conservative: boolean
  readonly failOnUnused: boolean
  readonly patterns: ReadonlyArray<string> | undefined
  readonly pruneDev: boolean | undefined
  readonly pruneOptional: boolean | undefined
  readonly write: boolean
  readonly releaseCommand: string | undefined
}

export type CliError = { readonly _tag: "CliError"; readonly message: string }

const cliError = (message: string): CliError => ({ _tag: "CliError", message })

const isFlag = (value: string): boolean => value.startsWith("-")

const splitList = (value: string): ReadonlyArray<string> =>
  value
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0)

const parseBoolean = (value: string): Either.Either<boolean, CliError> => {
  if (value === "true" || value === "1") {
    return Either.right(true)
  }
  if (value === "false" || value === "0") {
    return Either.right(false)
  }
  return Either.left(cliError(`Invalid boolean value: ${value}`))
}

const parseCommand = (value: string): Either.Either<CliCommand, CliError> =>
  Match.value(value).pipe(
    Match.when("scan", () => Either.right<CliCommand>("scan")),
    Match.when("apply", () => Either.right<CliCommand>("apply")),
    Match.when("release", () => Either.right<CliCommand>("release")),
    Match.when("restore", () => Either.right<CliCommand>("restore")),
    Match.orElse(() => Either.left(cliError(`Unknown command: ${value}`)))
  )

const defaultArgs = (command: CliCommand): CliArgs => ({
  command,
  dist: "./dist",
  distExplicit: false,
  packagePath: "./package.json",
  ignorePath: undefined,
  ignorePathExplicit: false,
  keep: [],
  json: false,
  silent: false,
  strict: false,
  conservative: false,
  failOnUnused: false,
  patterns: undefined,
  pruneDev: undefined,
  pruneOptional: undefined,
  write: false,
  releaseCommand: undefined
})

const readFlagValue = (
  flagName: string,
  inlineValue: string | undefined,
  nextValue: string | undefined
): Either.Either<string, CliError> => {
  if (inlineValue !== undefined) {
    return Either.right(inlineValue)
  }
  if (nextValue === undefined || isFlag(nextValue)) {
    return Either.left(cliError(`Missing value for --${flagName}`))
  }
  return Either.right(nextValue)
}

const setParsedFlag = (
  next: CliArgs,
  consumed: number
): Either.Either<{ readonly next: CliArgs; readonly consumed: number }, CliError> => Either.right({ next, consumed })

const parseValueFlag = (
  flagName: string,
  current: CliArgs,
  inlineValue: string | undefined,
  nextValue: string | undefined,
  update: (args: CliArgs, value: string) => CliArgs
): Either.Either<{ readonly next: CliArgs; readonly consumed: number }, CliError> =>
  Either.map(readFlagValue(flagName, inlineValue, nextValue), (value) => ({
    next: update(current, value),
    consumed: inlineValue === undefined ? 2 : 1
  }))

const parseOptionalBooleanFlag = (
  current: CliArgs,
  inlineValue: string | undefined,
  nextValue: string | undefined,
  update: (args: CliArgs, value: boolean) => CliArgs
): Either.Either<{ readonly next: CliArgs; readonly consumed: number }, CliError> => {
  const useNext = inlineValue === undefined && nextValue !== undefined && !isFlag(nextValue)
  const nextValueResolved = inlineValue ?? (useNext ? nextValue : "true")
  return Either.map(parseBoolean(nextValueResolved), (value) => ({
    next: update(current, value),
    consumed: useNext ? 2 : 1
  }))
}

type FlagParser = (
  current: CliArgs,
  inlineValue: string | undefined,
  nextValue: string | undefined
) => Either.Either<{ readonly next: CliArgs; readonly consumed: number }, CliError>

const flagParsers: Record<string, FlagParser> = {
  json: (current) => setParsedFlag({ ...current, json: true }, 1),
  silent: (current) => setParsedFlag({ ...current, silent: true }, 1),
  strict: (current) => setParsedFlag({ ...current, strict: true }, 1),
  conservative: (current) => setParsedFlag({ ...current, conservative: true }, 1),
  "fail-on-unused": (current) => setParsedFlag({ ...current, failOnUnused: true }, 1),
  write: (current, inlineValue, nextValue) =>
    parseOptionalBooleanFlag(current, inlineValue, nextValue, (args, value) => ({
      ...args,
      write: value
    })),
  dist: (current, inlineValue, nextValue) =>
    parseValueFlag("dist", current, inlineValue, nextValue, (args, value) => ({
      ...args,
      dist: value,
      distExplicit: true
    })),
  package: (current, inlineValue, nextValue) =>
    parseValueFlag("package", current, inlineValue, nextValue, (args, value) => ({
      ...args,
      packagePath: value
    })),
  ignore: (current, inlineValue, nextValue) =>
    parseValueFlag("ignore", current, inlineValue, nextValue, (args, value) => ({
      ...args,
      ignorePath: value,
      ignorePathExplicit: true
    })),
  keep: (current, inlineValue, nextValue) =>
    parseValueFlag("keep", current, inlineValue, nextValue, (args, value) => ({
      ...args,
      keep: splitList(value)
    })),
  patterns: (current, inlineValue, nextValue) =>
    parseValueFlag("patterns", current, inlineValue, nextValue, (args, value) => ({
      ...args,
      patterns: splitList(value)
    })),
  "prune-dev": (current, inlineValue, nextValue) =>
    parseOptionalBooleanFlag(current, inlineValue, nextValue, (args, value) => ({
      ...args,
      pruneDev: value
    })),
  "prune-optional": (current, inlineValue, nextValue) =>
    parseOptionalBooleanFlag(current, inlineValue, nextValue, (args, value) => ({
      ...args,
      pruneOptional: value
    })),
  command: (current, inlineValue, nextValue) =>
    parseValueFlag("command", current, inlineValue, nextValue, (args, value) => ({
      ...args,
      releaseCommand: value
    }))
}

const parseFlag = (
  raw: string,
  nextValue: string | undefined,
  current: CliArgs
): Either.Either<{ readonly next: CliArgs; readonly consumed: number }, CliError> => {
  if (!raw.startsWith("--")) {
    return Either.left(cliError(`Unknown flag: ${raw}`))
  }
  const [name = "", inlineValue] = raw.slice(2).split("=", 2)
  const parser = flagParsers[name]
  if (parser === undefined) {
    return Either.left(cliError(`Unknown flag: --${name}`))
  }
  return parser(current, inlineValue === undefined ? undefined : inlineValue, nextValue)
}

interface ParsedCommand {
  readonly command: CliCommand
  readonly startIndex: number
}

const parseCommandFromArgs = (
  rawArgs: ReadonlyArray<string>
): Either.Either<ParsedCommand, CliError> => {
  const first = rawArgs[0]
  if (first === undefined || isFlag(first)) {
    return Either.right({ command: "scan", startIndex: 0 })
  }
  const commandEither = parseCommand(first)
  if (Either.isLeft(commandEither)) {
    return Either.left(commandEither.left)
  }
  return Either.right({ command: commandEither.right, startIndex: 1 })
}

const parseFlags = (
  rawArgs: ReadonlyArray<string>,
  startIndex: number,
  initial: CliArgs
): Either.Either<CliArgs, CliError> => {
  let args = initial
  let index = startIndex
  while (index < rawArgs.length) {
    const current = rawArgs[index]
    if (current === undefined) {
      return Either.left(cliError("Unexpected end of arguments"))
    }
    if (!isFlag(current)) {
      return Either.left(cliError(`Unexpected positional argument: ${current}`))
    }
    const nextValue = rawArgs[index + 1]
    const parsed = parseFlag(current, nextValue, args)
    if (Either.isLeft(parsed)) {
      return Either.left(parsed.left)
    }
    args = parsed.right.next
    index += parsed.right.consumed
  }
  return Either.right(args)
}

/**
 * Parse CLI arguments into a typed configuration.
 *
 * @param argv - Raw process.argv array.
 * @returns Either with parsed CliArgs or CliError.
 *
 * @pure true
 * @invariant command defaults to scan when omitted
 * @complexity O(n)
 */
export const parseCliArgs = (
  argv: ReadonlyArray<string>
): Either.Either<CliArgs, CliError> => {
  const rawArgs = argv.slice(2)
  const commandEither = parseCommandFromArgs(rawArgs)
  if (Either.isLeft(commandEither)) {
    return Either.left(commandEither.left)
  }
  const parsed = commandEither.right
  return parseFlags(rawArgs, parsed.startIndex, defaultArgs(parsed.command))
}
