---
name: vitest-vue2-init
description: Initialize a Vitest 4.x unit-testing framework in a zhuanzhuan Vue 2 frontend repo. Detects the project's actual stack (Vue 2.6/2.7, options/composition/setup-script/class/tsx/template, pinia/vuex, private @zz-* deps, CDN usage) via a zero-token shell script, then assembles a mainline config plus on-demand optional modules. Use when a repo has NO vitest.config and you want to bootstrap unit tests. Triggers on phrases like "set up vitest", "bootstrap unit tests", "initialize unit testing", "no test framework yet", "add vitest to this repo".
---

# Vitest + Vue 2 Init (cross-repo bootstrap)

> Bootstrap a unit-testing framework for a zhuanzhuan Vue 2 frontend project. **One-shot per repo.** After bootstrap completes, day-to-day test authoring is governed by the sibling skill `vitest-vue2-testing`.

## Preconditions — do not run if any of these is true

- `vitest.config.{mts,ts,js}` already exists in the project root
- `tests/unit/setup.ts` already exists
- User asks to "write a test" or "fix a test failure" — that is `vitest-vue2-testing` territory

If preconditions fail, redirect the user to `vitest-vue2-testing` and stop.

## Mandatory flow

### Step 1 — Run the stack detector (zero AI tokens)

```bash
node $SKILL_DIR/scripts/detect-stack.mjs $PROJECT_ROOT
```

Where `$SKILL_DIR` is `~/.claude/skills/vitest-vue2-init` and `$PROJECT_ROOT` is the user's repo root. The script returns a single JSON blob.

Capture the JSON. Do NOT use Read/Grep/Glob to scan the project yourself — that is what the script is for.

### Step 2 — Decide which references to load

Based on the JSON, conditionally Read these references:

| Profile field | Trigger | Reference to load |
|---------------|---------|-------------------|
| `vueMajorMinor === "2.6"` | always | `references/option-vue26.md` |
| `hasCompositionApi === true` | only if 2.6 | `references/option-vue26.md` |
| `stateManagement` includes `vuex` | `"vuex"` or `"both"` | `references/option-vuex.md` |
| `syntaxStyles.tsx > 0` | always | `references/option-tsx-jsx.md` |
| `syntaxStyles.classComponent > 0` | always | `references/option-class-component.md` |
| `privateDeps` non-empty | always | `references/private-deps-mock-catalog.md` |
| `cdnDomains` non-empty | always | `references/cdn-and-async-noise.md` |

The mainline (Vue 2.7 + composition + pinia + private-dep mocks) is the default — no reference needed if profile matches it cleanly.

### Step 3 — Run the 5-question audit (USER-FACING decisions)

These five questions came from the project lead's bootstrap brief. Do not skip them — they expose project-specific constraints that the JSON cannot tell you. Where the JSON has already settled a sub-question, state the JSON answer and ask only the remaining piece.

**Q1 — Versions**
- State from JSON: vue=`{vueVersion}`, hasCompositionApi=`{bool}`, stateManagement=`{...}`.
- Ask the user: "Is Vitest 4.x acceptable? Any version pins I should respect from your team's standards (e.g. happy-dom version, @vue/test-utils 1.x specifically)?"

**Q2 — File-type scope**
- State from JSON: SFC counts by style (`scriptSetup={n}, defineComponent={n}, classComponent={n}, tsx={n}, templateOnly={n}`).
- Confirm with the user: "Are all of these in scope for tests, or should we exclude TSX/class for now?"

**Q3 — Private dependencies**
- State from JSON: `privateDeps` list with import counts.
- For each entry NOT in `references/private-deps-mock-catalog.md`, ask: "How should this be mocked? Stub returning `vi.fn()` or do you have specific behavior requirements?"

**Q4 — CDN static files**
- State from JSON: `cdnDomains` with counts.
- If only template/CSS-string references → state "These are harmless — happy-dom does not fire image requests."
- If any `fetch(cdnUrl)` exists in source → ask: "Should we install a global `fetch` mock returning a default OK response, or mock per-test?"

**Q5 — API request contracts**
- Ask: "Are most APIs ready with TS types? If not, do you want me to use minimal-shape placeholders with `// @todo` markers, or pause and ask per-API?"
- Ask: "Do you have a `mock.local` or similar gitignored mock-data dir? If yes, should the test setup pick it up?"

Compile answers into a small decisions table you will show before writing files.

### Step 4 — Assemble and write files

In this order:

1. `vitest.config.mts` — copy `templates/vitest.config.mts.tpl`, uncomment optional plugin lines based on Step 2 decisions
2. `tests/unit/setup.ts` — copy `templates/setup.ts.tpl`, append additional `vi.mock(...)` blocks for private deps not in the mainline (from `private-deps-mock-catalog.md`), add Vue.use(VueCompositionAPI) and/or Vue.use(Vuex) when applicable
3. `tests/unit/sample-utils.test.ts` — copy `templates/sample-utils.test.ts.tpl`
4. `tests/unit/sample-component.test.ts` — copy `templates/sample-component.test.ts.tpl`
5. Merge `scripts` block from `templates/package-scripts.json.tpl` into the project's `package.json` (DO NOT replace the file — merge keys)
6. If `pnpm-lock.yaml` exists, suggest the install command but do NOT run it yourself: `pnpm add -D vitest @vitejs/plugin-vue2 @vue/test-utils happy-dom @vitest/coverage-v8` (plus any optional plugins like `@vitejs/plugin-vue2-jsx` for TSX projects)

### Step 5 — Validate

Ask the user to run:

```bash
pnpm install   # if devDependencies changed
pnpm test
```

Expected outcome: `2 test files passed, 4 tests passed` (the two samples).

If the sample component test crashes with `DOMException` noise about remote scripts, the mainline mocks are missing an export production code accesses through `setup.ts`'s transitively-loaded private deps — re-check the `privateDeps` JSON and consult `references/private-deps-mock-catalog.md`.

### Step 6 — Emit the private-deps scan report

After tests pass, write a short report to stdout (do not create a new file):

```
Private @zz-* deps detected (from grep counts):
  • @zz-common/zz-ui:      133 imports — mocked ✓
  • @zz-common/native-adapter: 89 imports — mocked ✓
  • ...
  • @zz-common/<unknown>:  N imports — NOT in mainline mock; see references/private-deps-mock-catalog.md
```

Highlight any package that was found by the scan but not present in the mainline `setup.ts` — those are the user's follow-up items.

## Boundary with `vitest-vue2-testing`

| | This skill (`vitest-vue2-init`) | `vitest-vue2-testing` |
|---|---|---|
| Trigger | No `vitest.config.*` exists | Test infrastructure already in place |
| Frequency | Once per repo | Daily |
| Outputs | Config + setup + sample tests + scan report | Test files + mock adjustments + noise diagnosis |
| Detection method | `scripts/detect-stack.mjs` (zero token) | Read existing `setup.ts` |

Always end this skill with a one-liner: "Framework ready. For test authoring, the skill `vitest-vue2-testing` takes over from here."

## References (loaded on demand based on Step 2)

| File | Trigger |
|------|---------|
| `references/option-vue26.md` | Vue 2.6 + composition-api adaptation |
| `references/option-vuex.md` | Vuex testing patterns (alone or with pinia) |
| `references/option-tsx-jsx.md` | `@vitejs/plugin-vue2-jsx` integration |
| `references/option-class-component.md` | Babel decorator setup for `vue-class-component` |
| `references/private-deps-mock-catalog.md` | Full @zz-* mock recipes |
| `references/cdn-and-async-noise.md` | CDN fetch mocks and known residual SDK noise |

## What you must NOT do

- Don't run the detect script's logic in your head — always invoke it via Bash
- Don't write a `vitest.config` without first reading the JSON output
- Don't overwrite an existing `vitest.config.*` or `tests/unit/setup.ts` — bail out, redirect to `vitest-vue2-testing`
- Don't add dependencies you can't justify against the JSON profile
- Don't install packages on the user's behalf — output the command and let them run it
