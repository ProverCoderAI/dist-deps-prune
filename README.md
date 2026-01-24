# dist-deps-prune

CLI utility that scans published build outputs (from `package.json` `files`) to find **actually used** external packages, reports unused dependencies, and can prune `package.json` for release.

## Install

```bash
npm i -D @prover-coder-ai/dist-deps-prune
```

## Usage

### Scan only

```bash
npx @prover-coder-ai/dist-deps-prune scan --package ./package.json
```

### Apply pruning

```bash
npx @prover-coder-ai/dist-deps-prune apply --package ./package.json --write --prune-dev true
```

### Release mode (backup + restore)

```bash
npx @prover-coder-ai/dist-deps-prune release --package ./package.json --command "npm publish"
```

### Restore package.json

```bash
npx @prover-coder-ai/dist-deps-prune restore --package ./package.json
```

## CI/CD (Release workflow)

Use the tool during release so only the published outputs’ dependencies stay in the package.
Below is a minimal GitHub Actions snippet that builds, prunes, publishes, and restores automatically:

```yaml
- name: Build dist
  run: pnpm build

- name: Publish with dist-deps-prune (auto restore)
  run: |
    npx @prover-coder-ai/dist-deps-prune release \
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
