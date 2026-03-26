# Biome Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace ESLint + Prettier with Biome, producing identical formatting output and equivalent lint coverage.

**Architecture:** Single `biome.json` replaces `.eslintrc.js` and `.prettierrc`. Biome handles both linting and formatting. The `biome-rn-rules` GritQL plugin (sibling repo at `../biome-rn-rules`) provides additional rules. No code logic changes - only tooling.

**Tech Stack:** Biome 2.x, GritQL plugins

---

## File Map

| Action | File | Purpose |
|--------|------|---------|
| Create | `biome.json` | Combined formatter + linter + plugin config |
| Delete | `.eslintrc.js` | Replaced by biome.json |
| Delete | `.prettierrc` | Replaced by biome.json |
| Modify | `package.json` | Remove 8 deps, add 1, update scripts |
| Modify | `scripts/test-all.sh` | Update label from "ESLint" to "Biome" |

---

### Task 1: Install Biome and create biome.json

**Files:**
- Create: `biome.json`
- Modify: `package.json` (add devDependency only, don't change scripts yet)

- [ ] **Step 1: Install Biome**

Run:
```bash
npm install --save-dev --save-exact @biomejs/biome@latest
```

Expected: `@biomejs/biome` added to devDependencies in package.json.

- [ ] **Step 2: Create biome.json**

Create `biome.json` at the project root:

```json
{
  "$schema": "https://biomejs.dev/schemas/2.4.2/schema.json",
  "vcs": {
    "enabled": true,
    "clientKind": "git",
    "useIgnoreFile": true
  },
  "formatter": {
    "enabled": true,
    "indentStyle": "space",
    "indentWidth": 2,
    "lineWidth": 100,
    "lineEnding": "lf",
    "include": ["src/**", "example/**", "e2e/**"]
  },
  "linter": {
    "enabled": true,
    "include": ["src/**", "example/**", "e2e/**"],
    "rules": {
      "recommended": true,
      "suspicious": {
        "noExplicitAny": "error"
      },
      "correctness": {
        "noUnusedVariables": "error",
        "useExhaustiveDependencies": "warn",
        "useHookAtTopLevel": "error"
      }
    }
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
  },
  "plugins": [
    "../biome-rn-rules/rules/rn-no-unclean-effect-timer.grit",
    "../biome-rn-rules/rules/rn-no-unclean-effect-listener.grit",
    "../biome-rn-rules/rules/rn-no-scrollview-map.grit",
    "../biome-rn-rules/rules/rn-no-flatlist-missing-keyextractor.grit",
    "../biome-rn-rules/rules/rn-no-inline-styles.grit",
    "../biome-rn-rules/rules/rn-no-nested-touchables.grit",
    "../biome-rn-rules/rules/rn-forbid-dom-elements.grit",
    "../biome-rn-rules/rules/rn-no-color-literals.grit",
    "../biome-rn-rules/rules/react-no-unstable-context-value.grit",
    "../biome-rn-rules/rules/react-no-object-type-as-default-prop.grit",
    "../biome-rn-rules/rules/jsx-no-new-object-as-prop.grit",
    "../biome-rn-rules/rules/jsx-no-new-array-as-prop.grit",
    "../biome-rn-rules/rules/jsx-no-new-function-as-prop.grit",
    "../biome-rn-rules/rules/unicorn-prefer-array-some.grit",
    "../biome-rn-rules/rules/unicorn-prefer-includes.grit",
    "../biome-rn-rules/rules/unicorn-prefer-array-find.grit",
    "../biome-rn-rules/rules/unicorn-no-await-in-promise-methods.grit",
    "../biome-rn-rules/rules/unicorn-no-invalid-fetch-options.grit",
    "../biome-rn-rules/rules/unicorn-no-useless-undefined.grit",
    "../biome-rn-rules/rules/unicorn-no-nested-ternary.grit",
    "../biome-rn-rules/rules/unicorn-prefer-structured-clone.grit",
    "../biome-rn-rules/rules/promise-no-new-statics.grit",
    "../biome-rn-rules/rules/promise-no-return-in-finally.grit",
    "../biome-rn-rules/rules/promise-valid-params.grit",
    "../biome-rn-rules/rules/sonarjs-prefer-single-boolean-return.grit",
    "../biome-rn-rules/rules/sonarjs-no-identical-expressions.grit",
    "../biome-rn-rules/rules/sonarjs-no-collection-size-mischeck.grit",
    "../biome-rn-rules/rules/sonarjs-no-redundant-boolean.grit",
    "../biome-rn-rules/rules/import-no-mutable-exports.grit",
    "../biome-rn-rules/rules/import-no-export-all.grit"
  ]
}
```

Note: The plugin list is a curated subset of the 81 available rules. Rules specific to navigation, Firebase, or other libraries not used in this project are excluded. All plugin rules default to `warn` severity.

- [ ] **Step 3: Verify biome.json is valid**

Run:
```bash
npx biome check --config-path biome.json 2>&1 | head -5
```

Expected: No config errors. May show lint/format diagnostics (expected at this stage).

- [ ] **Step 4: Commit**

```bash
git add biome.json package.json package-lock.json
git commit -m "chore: install biome and add biome.json config"
```

---

### Task 2: Verify formatter compatibility on src/

**Files:** None modified (verification only)

- [ ] **Step 1: Format src/ with Prettier (baseline)**

Run:
```bash
npx prettier --write src
git stash -m "prettier baseline"
```

- [ ] **Step 2: Format src/ with Biome**

Run:
```bash
git stash pop
npx biome format --write src
```

- [ ] **Step 3: Diff Biome output against Prettier output**

Run:
```bash
npx prettier --write src
git diff src
```

Expected: Zero diff. If there are differences, adjust `biome.json` formatter settings and repeat.

- [ ] **Step 4: Reset src/ to clean state**

Run:
```bash
git checkout -- src
```

---

### Task 3: Format all scoped directories and fix lint violations

**Files:**
- Modified (formatting only): all `.ts`/`.tsx` files in `src/`, `example/`, `e2e/`

- [ ] **Step 1: Run Biome format on all scoped directories**

Run:
```bash
npx biome format --write src example e2e
```

Expected: Files reformatted. The `src/` files should have no changes (already Prettier-formatted). `example/` and `e2e/` may have formatting changes.

- [ ] **Step 2: Run Biome lint to see all violations**

Run:
```bash
npx biome lint src example e2e 2>&1 | tail -30
```

Review the output. For `src/` there should be zero or near-zero violations (already ESLint-clean). For `example/` and `e2e/` (newly linted), there may be violations.

- [ ] **Step 3: Auto-fix what Biome can fix**

Run:
```bash
npx biome lint --write src example e2e
```

- [ ] **Step 4: Manually fix or suppress remaining violations**

For each remaining violation:
- If it's a real issue, fix the code
- If it's a false positive or inapplicable rule for that directory, add a rule override in `biome.json` under `overrides`:

```json
{
  "overrides": [
    {
      "include": ["e2e/**"],
      "linter": {
        "rules": {
          "suspicious": {
            "noExplicitAny": "off"
          }
        }
      }
    }
  ]
}
```

Only add overrides that are necessary. Minimize suppression.

- [ ] **Step 5: Verify zero violations remain**

Run:
```bash
npx biome lint src example e2e
```

Expected: No errors. Warnings from GritQL plugin rules are acceptable.

- [ ] **Step 6: Verify unit tests still pass**

Run:
```bash
npm test
```

Expected: All 24 tests pass.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "chore: format and fix lint violations for biome migration"
```

---

### Task 4: Remove ESLint and Prettier, update scripts

**Files:**
- Delete: `.eslintrc.js`
- Delete: `.prettierrc`
- Modify: `package.json` (remove deps, update scripts)
- Modify: `scripts/test-all.sh` (update label)

- [ ] **Step 1: Remove ESLint and Prettier packages**

Run:
```bash
npm uninstall eslint eslint-config-prettier eslint-plugin-react eslint-plugin-react-hooks @typescript-eslint/parser @typescript-eslint/eslint-plugin prettier prettier-config-holepunch
```

- [ ] **Step 2: Delete config files**

Run:
```bash
rm .eslintrc.js .prettierrc
```

- [ ] **Step 3: Update npm scripts in package.json**

Replace the lint/format scripts in `package.json`:

```json
{
  "scripts": {
    "lint": "biome lint src example e2e",
    "lint:fix": "biome lint --write src example e2e",
    "format": "biome format --write src example e2e",
    "format:check": "biome format src example e2e",
    "check": "biome check src example e2e"
  }
}
```

Keep all other scripts unchanged (`build`, `test`, `typecheck`, etc.).

- [ ] **Step 4: Update scripts/test-all.sh label**

In `scripts/test-all.sh`, change line 37:

From:
```bash
echo -e "${YELLOW}[2/6] ESLint...${NC}"
```

To:
```bash
echo -e "${YELLOW}[2/6] Biome lint...${NC}"
```

And change line 39's success message (line 39):

From:
```bash
    echo -e "${GREEN}  ✓ ESLint passed${NC}"
```

To:
```bash
    echo -e "${GREEN}  ✓ Biome lint passed${NC}"
```

And change line 41's failure message:

From:
```bash
    echo -e "${RED}  ✗ ESLint failed${NC}"
```

To:
```bash
    echo -e "${RED}  ✗ Biome lint failed${NC}"
```

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "chore: remove eslint and prettier, update scripts for biome"
```

---

### Task 5: Full verification

**Files:** None modified (verification only)

- [ ] **Step 1: Verify lint passes**

Run:
```bash
npm run lint
```

Expected: Zero errors.

- [ ] **Step 2: Verify format check passes**

Run:
```bash
npm run format:check
```

Expected: All files formatted correctly.

- [ ] **Step 3: Verify TypeScript passes**

Run:
```bash
npm run typecheck
```

Expected: Zero errors.

- [ ] **Step 4: Verify unit tests pass**

Run:
```bash
npm test
```

Expected: All 24 tests pass.

- [ ] **Step 5: Verify combined check command works**

Run:
```bash
npm run check
```

Expected: Zero errors (runs both lint and format check).

- [ ] **Step 6: Verify test-all.sh works**

Run:
```bash
SKIP_E2E=1 ./scripts/test-all.sh
```

Expected: All steps pass (typecheck, biome lint, jest, swift tests, android tests).
