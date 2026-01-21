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

## CI/CD (Release workflow)

Use the tool during release so only the `dist/`-used dependencies stay in the published package.
Below is a minimal GitHub Actions snippet that builds, prunes, publishes, and restores automatically:

```yaml
- name: Build dist
  run: pnpm build

- name: Publish with dist-deps-prune (auto restore)
  run: |
    npx @prover-coder-ai/dist-deps-prune release \
      --dist ./dist \
      --package ./package.json \
      --prune-dev true \
      --command "npm publish" \
      --silent
  env:
    NPM_TOKEN: ${{ secrets.NPM_TOKEN }}
```

If you already run a publish command (e.g., `changeset-publish`), just put it into `--command`.

## Notes

- Supports ESM + CJS static imports in `.js/.mjs/.cjs/.d.ts`.
- Handles scoped packages and subpaths (`@scope/pkg/path` → `@scope/pkg`).
- Optional allowlist via `.dist-deps-prune.json`.
