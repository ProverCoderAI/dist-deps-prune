# dist-deps-prune

CLI utility that scans a built `dist/` directory to find **actually used** external packages, reports unused dependencies, and can prune `package.json` for release.

## Install

```bash
npm i -D @prover-coder-ai/dist-deps-prune
```

## Usage

### Scan only

```bash
npx @prover-coder-ai/dist-deps-prune scan --dist ./dist --package ./package.json
```

### Apply pruning

```bash
npx @prover-coder-ai/dist-deps-prune apply --dist ./dist --package ./package.json --write --prune-dev true
```

### Release mode (backup + restore)

```bash
npx @prover-coder-ai/dist-deps-prune release --dist ./dist --package ./package.json --command "npm publish"
```

### Restore package.json

```bash
npx @prover-coder-ai/dist-deps-prune restore --package ./package.json
```

## Notes

- Supports ESM + CJS static imports in `.js/.mjs/.cjs/.d.ts`.
- Handles scoped packages and subpaths (`@scope/pkg/path` → `@scope/pkg`).
- Optional allowlist via `.dist-deps-prune.json`.
