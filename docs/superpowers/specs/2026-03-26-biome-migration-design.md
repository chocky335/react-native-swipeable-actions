# Biome Migration Design

Replace ESLint + Prettier with Biome for linting and formatting, with 100% formatting compatibility and equivalent lint coverage.

## Scope

- **Source:** `src/` (11 files - library source + tests)
- **Example app:** `example/` (newly added to lint/format scope)
- **E2E tests:** `e2e/` (newly added to lint/format scope)
- **Excluded:** `build/`, `node_modules/`, `ios/`, `android/`

## Formatter Configuration

Exact replication of `prettier-config-holepunch` settings:

```json
{
  "formatter": {
    "enabled": true,
    "indentStyle": "space",
    "indentWidth": 2,
    "lineWidth": 100,
    "lineEnding": "lf",
    "include": ["src/**", "example/**", "e2e/**"]
  },
  "javascript": {
    "formatter": {
      "semicolons": "asNeeded",
      "quoteStyle": "single",
      "jsxQuoteStyle": "single",
      "trailingCommas": "none",
      "arrowParentheses": "always",
      "bracketSpacing": true,
      "bracketSameLine": false,
      "quoteProperties": "asNeeded"
    }
  }
}
```

Prettier's `semi: false` maps to Biome's `semicolons: "asNeeded"` - both remove semicolons except where ASI would be ambiguous. Output must be verified identical via diff.

## Linter Configuration

### Rule mapping (current ESLint to Biome)

| ESLint Rule | Biome Equivalent |
|---|---|
| `eslint:recommended` | `recommended: true` (default) |
| `@typescript-eslint/recommended` | `suspicious` + `nursery` groups |
| `@typescript-eslint/no-explicit-any: error` | `suspicious/noExplicitAny: "error"` |
| `@typescript-eslint/no-unused-vars` (`_` ignored) | `correctness/noUnusedVariables: "error"` |
| `react/recommended` | Built-in React rules in `correctness` + `suspicious` |
| `react-hooks/rules-of-hooks` | `correctness/useHookAtTopLevel: "error"` |
| `react-hooks/exhaustive-deps` | `correctness/useExhaustiveDependencies: "warn"` |
| `react/react-in-jsx-scope: off` | N/A (Biome has no equivalent rule) |
| `react/prop-types: off` | N/A (Biome has no equivalent rule) |

All current ESLint rules have direct Biome equivalents. No gaps.

### Extra coverage via biome-rn-rules plugin

The `biome-rn-rules` plugin (81 GritQL rules at `/Volumes/owc/repos/personal/biome-rn-rules`) provides additional lint rules beyond the current ESLint config. Referenced via relative path in `biome.json`. All plugin rules default to `warn` severity (won't break CI).

## Package Changes

### Remove (8 packages)

- `eslint` (^8.57.0)
- `eslint-config-prettier` (^9.1.0)
- `eslint-plugin-react` (^7.34.0)
- `eslint-plugin-react-hooks` (^4.6.0)
- `@typescript-eslint/parser` (^6.0.0)
- `@typescript-eslint/eslint-plugin` (^6.0.0)
- `prettier` (^3.2.0)
- `prettier-config-holepunch` (^2.0.0)

### Add (1 package)

- `@biomejs/biome` (2.x - matching biome-rn-rules target of 2.3.15)

### Remove files

- `.eslintrc.js`
- `.prettierrc`

### Add file

- `biome.json` (combined formatter + linter + plugin config)

## Script Changes

| Current | New |
|---|---|
| `"lint": "eslint src --ext .ts,.tsx"` | `"lint": "biome lint src example e2e"` |
| `"lint:fix": "eslint src --ext .ts,.tsx --fix"` | `"lint:fix": "biome lint --write src example e2e"` |
| `"format": "prettier --write src"` | `"format": "biome format --write src example e2e"` |
| `"format:check": "prettier --check src"` | `"format:check": "biome format src example e2e"` |
| (none) | `"check": "biome check src example e2e"` |

CI (`scripts/test-all.sh`): `npm run lint` invocation unchanged - same script name, different tool.

## Verification Strategy

1. Install Biome, create `biome.json`
2. Run `biome format --write` and diff against `prettier --write` output - must be identical
3. Run `biome lint` and compare against `eslint` output - no regressions
4. Fix or suppress lint violations in `example/` and `e2e/` (newly linted)
5. Remove ESLint/Prettier configs and deps
6. Update npm scripts and CI
7. Run full suite: `typecheck`, `lint`, `test` - all green

## Success criteria

- `biome format --write` produces byte-identical output to `prettier --write` on all `src/` files
- `biome lint` catches everything current ESLint catches
- All unit tests pass (no code changes, only tooling)
- CI passes
