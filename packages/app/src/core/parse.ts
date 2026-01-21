import * as Either from "effect/Either"
import * as ts from "typescript"

// CHANGE: parse import specifiers from JS/TS source using TypeScript AST
// WHY: cover ESM, CJS, and .d.ts import forms with a single parser
// QUOTE(TZ): "Учитывает dist/**/*.d.ts"
// REF: req-parse-1
// SOURCE: n/a
// FORMAT THEOREM: ∀s: parse(s) = Right(p) → p.specifiers ⊆ Strings
// PURITY: CORE
// EFFECT: n/a
// INVARIANT: dynamic imports are reported separately
// COMPLEXITY: O(n) where n = AST size

export interface ParsedImports {
  readonly staticSpecifiers: ReadonlyArray<string>
  readonly dynamicImports: ReadonlyArray<string>
  readonly dynamicRequires: ReadonlyArray<string>
}

const scriptKindFromFile = (fileName: string): ts.ScriptKind => {
  if (fileName.endsWith(".d.ts") || fileName.endsWith(".ts")) {
    return ts.ScriptKind.TS
  }
  if (fileName.endsWith(".mjs")) {
    return ts.ScriptKind.JS
  }
  if (fileName.endsWith(".cjs")) {
    return ts.ScriptKind.JS
  }
  return ts.ScriptKind.JS
}

const getStringLiteral = (expression: ts.Expression): string | undefined => {
  if (ts.isStringLiteral(expression)) {
    return expression.text
  }
  if (ts.isNoSubstitutionTemplateLiteral(expression)) {
    return expression.text
  }
  return undefined
}

const getImportTypeLiteral = (node: ts.ImportTypeNode): string | undefined => {
  const argument = node.argument
  if (ts.isLiteralTypeNode(argument)) {
    const literal = argument.literal
    if (ts.isStringLiteral(literal) || ts.isNoSubstitutionTemplateLiteral(literal)) {
      return literal.text
    }
  }
  return undefined
}

const isRequireIdentifier = (expression: ts.Expression): expression is ts.Identifier =>
  ts.isIdentifier(expression) && expression.text === "require"

const isRequireResolve = (expression: ts.Expression): expression is ts.PropertyAccessExpression =>
  ts.isPropertyAccessExpression(expression) &&
  ts.isIdentifier(expression.expression) &&
  expression.expression.text === "require" &&
  expression.name.text === "resolve"

const isDynamicImport = (expression: ts.Expression): boolean => expression.kind === ts.SyntaxKind.ImportKeyword

const collectImportDeclaration = (
  node: ts.ImportDeclaration,
  staticSpecifiers: Array<string>
): void => {
  if (ts.isStringLiteral(node.moduleSpecifier)) {
    staticSpecifiers.push(node.moduleSpecifier.text)
  }
}

const collectExportDeclaration = (
  node: ts.ExportDeclaration,
  staticSpecifiers: Array<string>
): void => {
  if (node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
    staticSpecifiers.push(node.moduleSpecifier.text)
  }
}

const collectImportType = (
  node: ts.ImportTypeNode,
  staticSpecifiers: Array<string>
): void => {
  const literal = getImportTypeLiteral(node)
  if (literal !== undefined) {
    staticSpecifiers.push(literal)
  }
}

const collectCallExpression = (
  node: ts.CallExpression,
  sourceFile: ts.SourceFile,
  staticSpecifiers: Array<string>,
  dynamicImports: Array<string>,
  dynamicRequires: Array<string>
): void => {
  if (isDynamicImport(node.expression)) {
    const argument = node.arguments[0]
    const literal = argument ? getStringLiteral(argument) : undefined
    if (literal === undefined) {
      dynamicImports.push(node.getText(sourceFile))
    } else {
      staticSpecifiers.push(literal)
    }
    return
  }
  if (isRequireIdentifier(node.expression) || isRequireResolve(node.expression)) {
    const argument = node.arguments[0]
    const literal = argument ? getStringLiteral(argument) : undefined
    if (literal === undefined) {
      dynamicRequires.push(node.getText(sourceFile))
    } else {
      staticSpecifiers.push(literal)
    }
  }
}

const parseSourceFile = (
  source: string,
  fileName: string
): Either.Either<ts.SourceFile, string> => {
  if (!fileName.endsWith(".d.ts")) {
    const diagnostics = ts.transpileModule(source, {
      compilerOptions: { module: ts.ModuleKind.ESNext },
      fileName,
      reportDiagnostics: true
    }).diagnostics ?? []
    const parseDiagnostics = diagnostics.filter(
      (diag: ts.Diagnostic) => diag.category === ts.DiagnosticCategory.Error
    )
    if (parseDiagnostics.length > 0) {
      const message = parseDiagnostics
        .map((diag: ts.Diagnostic) => ts.flattenDiagnosticMessageText(diag.messageText, "\n"))
        .join("; ")
      return Either.left(message)
    }
  }
  const sourceFile = ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.ESNext,
    true,
    scriptKindFromFile(fileName)
  )
  return Either.right(sourceFile)
}

const collectImports = (sourceFile: ts.SourceFile): ParsedImports => {
  const staticSpecifiers: Array<string> = []
  const dynamicImports: Array<string> = []
  const dynamicRequires: Array<string> = []

  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node)) {
      collectImportDeclaration(node, staticSpecifiers)
      ts.forEachChild(node, visit)
      return
    }
    if (ts.isExportDeclaration(node)) {
      collectExportDeclaration(node, staticSpecifiers)
      ts.forEachChild(node, visit)
      return
    }
    if (ts.isImportTypeNode(node)) {
      collectImportType(node, staticSpecifiers)
      ts.forEachChild(node, visit)
      return
    }
    if (ts.isCallExpression(node)) {
      collectCallExpression(node, sourceFile, staticSpecifiers, dynamicImports, dynamicRequires)
      ts.forEachChild(node, visit)
      return
    }
    ts.forEachChild(node, visit)
  }

  visit(sourceFile)

  return {
    staticSpecifiers,
    dynamicImports,
    dynamicRequires
  }
}

/**
 * Parse a source file and extract import specifiers.
 *
 * @param source - File contents.
 * @param fileName - File name (used for ScriptKind and diagnostics).
 * @returns Either with ParsedImports or parse error message.
 *
 * @pure true
 * @invariant all collected specifiers are string literals
 * @complexity O(n)
 */
export const parseImportsFromSource = (
  source: string,
  fileName: string
): Either.Either<ParsedImports, string> => {
  const sourceEither = parseSourceFile(source, fileName)
  if (sourceEither._tag === "Left") {
    return Either.left(sourceEither.left)
  }
  return Either.right(collectImports(sourceEither.right))
}
