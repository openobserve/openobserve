# Lint & Type‑Check Strictness Rollout — Design Doc

**Status:** In progress — the ESLint config foundation is implemented (rules activated
as `warn`/`error` per §8, the ratchet start); the per-bucket violation fixes are pending.
**Scope:** `web/` frontend (Vue 3 + TypeScript + ESLint flat config)
**Owner:** Frontend tooling
**Related:**
- Type-check gate → `ui_code_quality` job in `.github/workflows/unit-tests.yml`
  (plain hard gate: `npm run type-check:app`, any error fails — we are at 0).
- ESLint (`npm run lint:ci`) → runs in the four frontend workflows: `playwright.yml`,
  `playwright_regression.yml`, `build-pr-image.yml`, `build-fork-pr-image.yml`
  (`playwright.yml` is the per-PR gate; the others are dispatch/scheduled).
- Skill: `.claude/skills/eslint-error-handling/SKILL.md` (rule-by-rule fix playbook).

---

## 1. Purpose

`web/` currently ships with a large set of **deliberately disabled** ESLint rules and a
**non‑strict** `tsconfig.app.json`. This doc:

1. Inventories every disabled rule / unset compiler flag.
2. Reports the **measured** violation count for each (so effort is known, not guessed).
3. Categorizes them by **value vs. risk vs. effort**.
4. Proposes a **standard target config** and a **phased, ratcheting rollout** so we can
   tighten safely without blocking feature work.

This is the "standard yearly config" baseline; implementation happens in follow‑up PRs,
one bucket at a time.

---

## 2. Current state

### 2.1 ESLint (`web/eslint.config.js`)
Flat config, `eslint-plugin-vue` (`flat/essential`) + `@typescript-eslint`. **~37 rules are
turned `"off"`** in the shared block — a mix of core JS, TypeScript, and Vue rules. The only
actively‑enforced custom rule is `vue/no-restricted-html-elements` (bans `q-*` Quasar
components in favor of the `O*` design system).

### 2.2 TypeScript (`web/tsconfig.app.json`)
- `strict` is **not** set on the app config (only `tsconfig.vitest.json` / `tsconfig.config.json` are strict).
- None of these are set: `noImplicitReturns`, `noFallthroughCasesInSwitch`, `noUnusedLocals`,
  `noUnusedParameters`, `noUncheckedIndexedAccess`.
- CI gate (`type-check:app`) is **green at 0 errors** and enforced as a plain hard gate
  (`vue-tsc` fails on any error). A baseline ratchet was used to reach 0 and then retired.

---

## 3. Measured baseline

> Measured by temporarily re‑enabling every disabled ESLint rule as `warn` and running
> `eslint "src/**/*.{js,ts,vue}"`, and by enabling each tsconfig flag and running
> `type-check:app`. The measurement config was removed afterward; the build remains green.

### 3.1 ESLint — 11,855 violations across 1,518 files (if all re‑enabled)

| Rule | Count | Verdict |
|---|---:|---|
| `no-undef` | **5,117** | ❌ **Do not enable** — false positives in TS (see §4.1) |
| `no-unused-vars` (core) | 3,536 | ⚠️ Redundant — superseded by the TS‑aware rule (§4.2) |
| `@typescript-eslint/no-unused-vars` | 2,486 | ✅ The real unused‑code signal |
| `vue/no-mutating-props` | 228 | ✅ Real Vue anti‑pattern |
| `no-prototype-builtins` | 128 | ✅ Real correctness, low‑risk |
| `vue/no-unused-components` | 81 | ✅ Dead component registrations |
| `no-useless-escape` | 78 | ✅ Autofixable noise |
| `vue/multi-word-component-names` | 50 | 🟡 Style/opinion |
| `no-useless-catch` | 29 | ✅ Low‑risk |
| `no-async-promise-executor` | 17 | ✅ Real bug class |
| `no-empty` | 16 | ✅ Low‑risk |
| `vue/no-dupe-keys` | 12 | ✅ Real bug |
| `vue/no-unused-vars` (template) | 10 | ✅ Low |
| `vue/no-side-effects-in-computed-properties` | 9 | ✅ Real bug |
| `no-self-assign` | 9 | ✅ Real bug |
| `no-case-declarations` | 7 | ✅ Real bug |
| `no-unreachable` | 7 | ✅ Real bug / dead code |
| `no-redeclare` | 6 | ✅ Real bug |
| `vue/require-valid-default-prop` | 5 | ✅ Real bug |
| `vue/no-use-v-if-with-v-for` | 4 | ✅ Correctness/perf |
| `no-unsafe-optional-chaining` | 3 | ✅ Real bug (runtime throw) |
| `vue/return-in-computed-property` | 3 | ✅ Real bug |
| `no-import-assign` | 2 | ✅ Real bug |
| `vue/no-parsing-error` | 2 | ✅ Real bug |
| `vue/no-ref-as-operand` | 2 | ✅ Real bug (forgot `.value`) |
| `vue/require-v-for-key` | 2 | ✅ Correctness |
| `vue/valid-next-tick`, `vue/valid-v-for`, `vue/valid-attribute-name`, `vue/prefer-import-from-vue`, `vue/no-reserved-component-names`, `vue/require-toggle-inside-transition` | 1 each | ✅ Real bug/correctness |

**Takeaway:** the scary `11,855` is misleading. **~8,650 (73%) is `no-undef` + the redundant
core `no-unused-vars`** — neither of which we should enable. The *actionable* backlog is
**~2,486 unused‑code** + **~700 everything‑else**, and the "everything‑else" is dominated by a
handful of high‑value, low‑count bug rules.

### 3.2 TypeScript compiler flags — 1,347 errors (if all enabled at once)

| Flag | New errors | Notes |
|---|---:|---|
| `noUnusedLocals` + `noUnusedParameters` | ~1,279 (`TS6133/6196/6192/6198`) | Overlaps `@typescript-eslint/no-unused-vars` — **pick one source of truth** |
| `noImplicitReturns` | 60 (`TS7030`) | Real "function sometimes returns nothing" |
| `noFallthroughCasesInSwitch` | 8 (`TS7029`) | **All 8 are intentional** version‑migration cascades (see §4.3) |
| `noUncheckedIndexedAccess` | **0** | **No‑op without `strictNullChecks`** (see §4.4) |

---

## 4. Key findings & decisions

### 4.1 `no-undef` (5,117) — keep disabled, permanently
typescript-eslint **officially recommends not using `no-undef` on TypeScript projects**: the
rule doesn't use TypeScript to resolve globals (it relies on ESLint env config), and
TypeScript's own compiler already enforces undefined‑variable checks. Enabling it produces
thousands of false positives (Vue macros, auto‑imports, type‑only refs, globals). **Decision:
leave `no-undef: "off"`; TS is the source of truth for undefined symbols.**

### 4.2 `no-unused-vars` (core, 3,536) vs `@typescript-eslint/no-unused-vars` (2,486)
The core rule and the TS‑aware rule overlap. The TS‑aware one understands types, enums,
declaration merging, `import type`, etc., and produces fewer false positives. **Decision: keep
core `no-unused-vars: "off"`, enable only `@typescript-eslint/no-unused-vars`.** Additionally we
must decide **one** source of truth for unused code — ESLint **or** TS `noUnusedLocals`
(§7.1) — not both.

### 4.3 `noFallthroughCasesInSwitch` (8) — all intentional
Every violation is in dashboard schema/data **conversion** utilities
(`convertDashboardSchemaVersion.ts` ×6, `convertPanelData.ts`, `convertPromQLData.ts`) and is a
**deliberate, commented** version‑migration cascade (`case 1 → case 2 → …`, each bumping
`data.version`). TS ignores `// falls through` comments, so the flag flags correct code.
**Decision: to enable this flag, refactor the migration switches to an equivalent `if`‑chain
(behavior‑identical, since every case bumps the version) or a `while`‑loop over the switch — do
NOT add `break`s that would truncate the migration.** Low priority; zero real bugs caught.

### 4.4 `noUncheckedIndexedAccess` (0) — blocked on `strictNullChecks`
This flag adds `| undefined` to indexed access, but that's meaningless without
`strictNullChecks` (undefined is assignable to everything in non‑strict mode). On the current
non‑strict `tsconfig.app.json` it produces **0 errors and 0 safety benefit**. **Decision:
defer until we adopt `strictNullChecks` (a large, separate effort). Enabling it now is
cosmetic.**

---

## 5. Industry practice (research)

- **Ratcheting / baseline, not big‑bang.** Notion's "ratcheting" system (open‑sourced as
  `eslint-seatbelt`) records a baseline of existing violations, blocks *new* ones in CI, and lets
  the allowed count only ever decrease. This is the standard way to adopt rules on a large
  codebase without a mega‑PR. We used exactly this pattern (a baseline file) to drive type
  errors to **0**, then retired it for a plain hard gate — apply the same ratchet to the ESLint
  buckets (they start at thousands, not 0).
- **`eslint --max-warnings` ratchet** is the lightweight version: set a rule to `warn`, commit
  the current warning count as the ceiling, and lower it over time.
- **Disable `no-undef` on TS** (typescript-eslint FAQ) — confirmed above.
- **One unused‑vars source of truth**, with `argsIgnorePattern: "^_"` /
  `varsIgnorePattern: "^_"` so intentional unused params are opt‑out via `_` prefix. For
  auto‑removing unused imports, `eslint-plugin-unused-imports` provides a safe autofix (core
  `no-unused-vars` has no autofix).

Sources:
- typescript-eslint — [ESLint FAQs: no-undef](https://typescript-eslint.io/troubleshooting/faqs/eslint/)
- Notion — [How we evolved our code: ratcheting with custom ESLint rules](https://www.notion.com/blog/how-we-evolved-our-code-notions-ratcheting-system-using-custom-eslint-rules)
- [`eslint-seatbelt`](https://github.com/justjake/eslint-seatbelt) · [Tips for ESLint in a legacy codebase](https://www.sheshbabu.com/posts/tips-for-using-eslint-in-a-legacy-codebase/)

---

## 6. Categorization — how we solve it, by bucket

Rules are grouped by **value × effort**, which drives rollout order.

### Bucket 0 — Never enable
`no-undef` (5,117). TS covers it; pure false positives. **Action: leave off, add a comment
explaining why.**

### Bucket 1 — Real bugs, tiny counts → enable FIRST (highest value/effort ratio)
`no-unreachable` (7), `no-self-assign` (9), `no-redeclare` (6), `no-case-declarations` (7),
`no-unsafe-optional-chaining` (3), `no-import-assign` (2), `vue/no-dupe-keys` (12),
`vue/no-ref-as-operand` (2), `vue/no-side-effects-in-computed-properties` (9),
`vue/return-in-computed-property` (3), `vue/require-valid-default-prop` (5),
`vue/require-v-for-key` (2), `vue/valid-v-for` (1), `vue/valid-v-else-if`,
`vue/valid-attribute-name` (1), `vue/valid-next-tick` (1), `vue/no-parsing-error` (2),
`vue/no-use-v-if-with-v-for` (4).
**~90 violations total, each a genuine latent bug.** Fix by hand (each needs judgment), then
flip the rule to `error`. **This is the single highest‑value phase.**

### Bucket 2 — Low‑risk correctness / mostly mechanical
`no-prototype-builtins` (128 → `Object.prototype.hasOwnProperty.call(obj, k)`),
`no-useless-escape` (78), `no-empty` (16 → add a comment or `void`), `no-useless-catch` (29),
`no-async-promise-executor` (17 → hoist the async body). **~270 violations**, low risk, several
partially autofixable.

### Bucket 3 — Unused code (the big, mechanical one)
`@typescript-eslint/no-unused-vars` (2,486) **or** TS `noUnusedLocals`/`noUnusedParameters`
(1,279) — **pick one** (§7.1). Fix strategy: `eslint-plugin-unused-imports` autofix for unused
imports (the bulk), `_`‑prefix for intentionally‑unused params, manual removal for dead locals
(watch side‑effect initializers → keep the call, drop the binding). Roll out via **ratchet**,
not one PR. vue‑tsc/eslint‑vue already account for template usage, so flagged vars are truly
dead.

### Bucket 4 — Vue correctness, medium counts
`vue/no-mutating-props` (228 — emit an event or use a local copy),
`vue/no-unused-components` (81 — remove dead registrations). Real anti‑patterns; needs
per‑site fixes. Ratchet.

### Bucket 5 — Style / opinion (decide, don't rush)
`vue/multi-word-component-names` (50), `vue/max-attributes-per-line`, `prettier/prettier`,
`no-shadow-restricted-names`. Team decision on whether to enforce; `prettier/prettier` should be
handled by a formatter pass + pre‑commit, not a lint gate that fights the editor.

### Compiler‑flag track (parallel, independent of ESLint)
- `noImplicitReturns` (60) — add explicit `return undefined` on the fall‑off path (behavior‑
  preserving). **Enable in one PR.**
- `noFallthroughCasesInSwitch` (8) — refactor migration switches to `if`‑chains (§4.3), then enable.
- `noUnusedLocals`/`noUnusedParameters` — only if we choose TS as the unused source of truth (§7.1).
- `noUncheckedIndexedAccess` — **deferred** behind `strictNullChecks` (§4.4).

---

## 7. Decisions needed before implementation

### 7.1 Source of truth for "unused code": ESLint or TypeScript?
They overlap (~2,486 vs ~1,279 — counts differ because scope/rules differ). Recommendation:
**ESLint `@typescript-eslint/no-unused-vars`** as the single source, because:
- It autofixes unused imports (via `eslint-plugin-unused-imports`); `tsc` does not.
- `argsIgnorePattern: "^_"` gives an ergonomic opt‑out for intentionally‑unused params.
- Keeps the "unused" signal in the same tool devs already run with `--fix`.
Then leave TS `noUnusedLocals`/`noUnusedParameters` **off** to avoid double‑reporting.

### 7.2 Enforcement mechanism: ratchet vs. flip‑to‑error per bucket
- **Small buckets (1, 2, compiler flags):** fix fully in one PR, then flip to `error`. Clean.
- **Large buckets (3, 4):** **ratchet.** Set to `warn`, commit a per‑rule baseline count, block
  increases in CI, drive down over time. Use the same baseline-ratchet pattern that took type
  errors to 0 — add an ESLint warning‑count ratchet (`eslint --max-warnings <N>`, or
  `eslint-seatbelt`) to the shared `lint:ci` run, since that is where ESLint executes in CI
  (the four frontend workflows).

---

## 8. Proposed target ("standard") config

**ESLint** — enabled at `error` once each bucket is cleared:
- All Bucket 1 + 2 + 4 rules → `error`.
- `@typescript-eslint/no-unused-vars`: `["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrors: "none" }]`.
- `no-undef`: **stays `off`** (documented).
- `no-unused-vars` (core): stays `off` (superseded).
- Bucket 5: team decision; formatter handles `prettier/prettier`.

**TypeScript** (`tsconfig.app.json`) — target:
- `noImplicitReturns: true`, `noFallthroughCasesInSwitch: true` (after switch refactor).
- `noUnusedLocals`/`noUnusedParameters`: **off** if ESLint owns unused (§7.1).
- `strictNullChecks` → then `noUncheckedIndexedAccess`: a **separate, larger initiative** (own design doc).

---

## 9. Suggested rollout order (one PR per step)

1. **Bucket 1** (real bugs, ~90) — fix + flip to `error`. *Highest value.*
2. **`noImplicitReturns`** (60) — fix + enable.
3. **Bucket 2** (~270) — fix + flip to `error`.
4. **Migration‑switch refactor** → enable `noFallthroughCasesInSwitch`.
5. **Bucket 4** Vue correctness (~309) — ratchet down, then `error`.
6. **Bucket 3** unused code (~2,486) — adopt `eslint-plugin-unused-imports` + ratchet.
7. **Bucket 5** style — team decision.
8. **Future initiative:** `strictNullChecks` → `noUncheckedIndexedAccess`.

Each step keeps CI green (fix‑then‑flip) or trending‑down (ratchet), so feature work is never blocked.

---

## Appendix A — how the numbers were produced
- ESLint: temporary `eslint.measure.config.js` re‑enabled all disabled rules as `warn`;
  `eslint "src/**/*.{js,ts,vue}" -f json` parsed per `ruleId`. File removed after measuring.
- TypeScript: each flag added to `tsconfig.app.json`, `npm run type-check:app` error codes
  counted (`TS7030`, `TS7029`, `TS6133/6196/6192/6198`), then reverted.
- The *measurement* changed no production config. Subsequently, the ESLint **standard config
  foundation** (§8) was implemented in `eslint.config.js` (rules set `warn`/`error`); the
  **tsconfig strictness flags remain unset** (deferred to their rollout PRs). `type-check:app`
  is **0** and `lint:ci` is clean (warnings are the ratchet backlog).
