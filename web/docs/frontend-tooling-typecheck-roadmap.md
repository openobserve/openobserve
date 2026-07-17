# Frontend Tooling & Type-Check Roadmap

**Status:** proposed
**Scope:** `web/` only — type-checking, linting, formatting, pre-commit, coverage, AI guidance
**Consolidates:** `FRONTEND_TOOLING_AUDIT.md` (Tasks 0–9) + `prd_type_check.md` (Phases 0–3 + §5)
**Last verified against repo:** branch `build/tooling-support-v1`

---

## Purpose

Both source documents describe the same north star from two angles: a frontend toolchain that
**catches broken types, dead code, and convention violations automatically — and cannot silently
pass without having run.** They overlap heavily (the audit's "Task 1 — fix type-check scope" is the
same wound the PRD dissects in depth). This roadmap merges them into **one dependency-ordered
backlog**, records what has already landed, and specifies **how** each remaining task is
implemented so the work can proceed top-to-bottom without re-deciding scope.

The two organising rules inherited from the sources:

1. **Ratchet, never big-bang.** New rule/flag lands as `warn` or against a baseline, is burned
   down, then flips to `error`. Never block the whole team on day one.
2. **Never ship a check that can pass without running.** Every gate must be *demonstrably* able to
   fail — proven by a checked-in canary that goes red, not by reading config and believing it.
   (This is the PRD's core principle and it is currently unmet.)

---

## Current state (already landed)

| Capability | State | Evidence |
|---|---|---|
| App-wide type-check that genuinely reads source | ✅ `type-check:app` reads **1,627** `/src/` files, gated in CI, at **0 errors** | `package.json` → `type-check:app`; `.github/workflows/unit-tests.yml` |
| ESLint bug-catching rules re-enabled (ratcheted) | ✅ **30 `error`**, 2 `warn`, 5 documented-`off` | `web/eslint.config.js` |
| CI lints `.ts` (not just `.vue`) | ✅ `lint:ci` = `eslint "src/**/*.{js,ts,vue}" --no-fix --quiet` | `package.json` |
| Code-derived AI guidance | ◐ Partial — skills `eslint-error-handling`, `ui-architect`, `web/docs/SKILL.md` exist | no `CLAUDE.md`/`AGENTS.md`, not wired into `ai-code-review.yml` |

### Known gaps that make the current green misleading

- The **original `type-check` script is still dark** — `-p tsconfig.vitest.json`, include glob
  `src/**/*.spec.{ts,js}` (brace globs match nothing in TS), reads **0** source files.
- `type-check:app` is **non-strict** and **excludes `*.spec.ts`** — so ~4,715 spec-file and the
  implicit-`any` classes of error (TS7006/TS7016, incl. the ~665 `vuex` import) never fire.
- **No canary and no exit-code/OOM assertion** — a crash or OOM still exits 0 and reads as success.

---

## Unified sequenced backlog

Ordered by dependency and ROI. Each task: **Goal · Status · Depends on · How to implement · Verify · Risk.**
Origin tags map back to the source docs: `[A#]` = audit task, `[P#]` = PRD phase, `[P§5]` = PRD pilot.

---

### Phase A — Make the checks trustworthy (fail-closed) `[P0]`

> The whole program is worthless if a gate can pass without running. Do this before adding any new
> rule, because every later ratchet trusts these gates to actually fail.

#### A1. Add a type-check canary fixture + CI assertion `[P0.4]`
- **Goal:** a checked-in file with a known type error that CI asserts is *reported*; if it ever
  stops failing, the checker is dark and CI says so.
- **Status:** ❌ not started
- **Depends on:** —
- **How:**
  1. Add `web/src/__canary__/typecheck-canary.ts` containing `export const _canary: number = "nope";`
     inside the `type-check:app` include but excluded from the app build (guard with a path the
     bundler drops, or keep it type-only and tree-shaken).
  2. Add script `type-check:canary` that runs `type-check:app` scoped to a tiny config including
     only the canary, asserts **non-zero exit** and that output contains `TS2322`.
  3. CI step (in `unit-tests.yml`) runs `type-check:canary` and **fails if the canary is not
     reported**. The real `type-check:app` run continues to exclude the canary path.
- **Verify:** delete the error in the canary → `type-check:canary` fails (proving it guards).
- **Risk:** low. Keep the canary out of the shipped bundle and out of the main `type-check:app`
  error count.

#### A2. Assert exit code + non-empty output on type-check (fail on silent OOM) `[P0.3]`
- **Goal:** a run that emits a GC trace and exits 0 must be treated as failure.
- **Status:** ❌ not started (heap is pinned at 8 GB, which currently completes for app-non-spec;
  raising scope in later phases will re-introduce OOM risk).
- **Depends on:** —
- **How:**
  1. Wrap the type-check invocation in a small node/bash runner (`scripts/type-check.mjs`) that:
     spawns `vue-tsc`, captures stdout/stderr, and **exits non-zero** if the process was killed,
     if stderr contains `Mark-Compact`/`allocation failure`/`FATAL`, or if exit code ≠ 0.
  2. Pin heap explicitly and raise as scope grows (`--max-old-space-size` 8192 → 12288).
  3. Point both `type-check:app` and (post-A3) `type-check` at this runner.
- **Verify:** temporarily set heap to `--max-old-space-size=256` → runner exits non-zero (not 0).
- **Risk:** low.

#### A3. Retire / repoint the dark `type-check` script `[P0.1, P-OpenQ]`
- **Goal:** `npm run type-check` must read `> 1,500` source files (acceptance #1), not 0.
- **Status:** ❌ not started — still `-p tsconfig.vitest.json`.
- **Depends on:** A2 (so the repointed command is crash-safe).
- **How:** decide the vitest-project question (PRD open question):
  - Make `type-check` an alias of `type-check:app` (app source), add `type-check:tests` for a
    **fixed** spec include (`["src/**/*.spec.ts","src/**/*.spec.js","vitest.config.*"]`, brace glob
    split into two entries, `env.d.ts` added back), and `type-check:all` = run-s both.
  - Both run in CI. This closes the "checks nothing" wound at its original name.
- **Verify:** `vue-tsc -p <config> --listFiles | grep -c /src/` ≥ 1500 for `type-check`.
- **Risk:** medium — repointing surfaces the spec/strict debt; gate via baseline (B2), not hard-fail.

#### A4. Lint canary (parity with type-check) `[extends P0.4]`
- **Goal:** prove `lint:ci` can fail; a no-op lint glob is the same failure mode as the dark
  type-check.
- **Status:** ❌ not started
- **How:** a fixture with a guaranteed `error`-level violation (e.g. `no-unreachable`), asserted
  reported by a `lint:canary` CI step; excluded from the normal `lint:ci` glob.
- **Verify:** remove the violation → `lint:canary` fails.
- **Risk:** low.

---

### Phase B — Enforce what is clean; ratchet the rest

#### B1. Flip remaining ESLint `warn` → `error` `[A3 tail]`
- **Goal:** finish the audit's Bucket-B ratchet.
- **Status:** ◐ in progress — `vue/no-mutating-props` (228) fix **piloted** via the behaviour-
  preserving *computed-alias* technique (see `web/docs/SKILL.md`); `@typescript-eslint/no-unused-vars`
  and `vue/no-dupe-keys` have a few edge cases left as `warn`.
- **Depends on:** A4.
- **How:**
  1. Drive `vue/no-mutating-props` to 0 with the computed-alias pattern (`const XModel = computed(() => props.X)`,
     mutate `XModel.value…` / `v-model="XModel.…"`; emit `update:X` only where a parent v-model
     exists). One agent per non-overlapping scope; verify each file at 0.
  2. Resolve the `no-dupe-keys` prop/setup collisions and the 4 template-cast `no-unused-vars`
     false positives (narrow, not `any`).
  3. Flip each rule `warn` → `error` in `eslint.config.js` once its count is 0.
- **Verify:** `eslint "src/**/*.{js,ts,vue}" --quiet` → 0; each flipped rule stays 0.
- **Risk:** medium for `no-mutating-props` (behaviour-sensitive) — the computed-alias keeps the
  same object reference, so runtime is unchanged; verify per parent binding.

#### B2. Baseline ratchet so new errors fail while old debt is burned `[P1]`
- **Goal:** CI fails a PR that introduces a type error not in a recorded baseline; the baseline may
  only shrink.
- **Status:** ❌ not started (we hard-gate app-source at 0 instead, which does not cover specs).
- **Depends on:** A2, A3.
- **How:**
  1. Generate `web/typecheck-baseline.txt` — the sorted `file:code` set from the widest config
     (app + specs). Commit it.
  2. CI runner diffs current errors against the baseline: **new lines → fail**, fewer lines → pass
     and print how many cleared. Deleting a source of errors that isn't in the baseline is allowed.
  3. Delete the baseline and make the check a hard gate once it reaches 0.
- **Verify:** plant a new error → CI red; fix a baselined error and shrink the file → CI green.
- **Risk:** medium — baseline churn on merges; regenerate deterministically (sorted, path-relative).

#### B3. Harvest cheap type wins `[P2]`
- **Goal:** ~1,000 errors (13%) removed with zero application-logic change.
- **Status:** ❌ not started (sidestepped today by non-strict + spec-exclude).
- **Depends on:** A3 (specs in scope), B2 (baseline to measure against).
- **How (ordered by errors-removed-per-hour):**
  1. **Type `vuex`** — declare a typed `useStore()` wrapper / module augmentation (~665, the single
     biggest lever; 8.5% of PRD total).
  2. Add `env.d.ts` to every checked config's include (SFC shim → `TS2307` 334 → 8).
  3. Add module shims for `reodotdev`, `quasar`, `sortablejs` (~14).
- **Verify:** baseline shrinks by the expected magnitude after each.
- **Risk:** low — typings only.

#### B4. Pilot: `metricDefaults.js` → `.ts` `[P§5]`
- **Goal:** first deliberate consumer of the restored check; a realistic sample of the Phase-3 grind.
- **Status:** ❌ not done — `src/utils/metrics/metricDefaults.js` is still JS.
- **Depends on:** A1–A3 (a check that genuinely enforces the new annotations).
- **How:** rename `.js` → `.ts`; annotate the ~75 surfaced errors (implicit-`any` params, `never[]`
  inferences, 4 `TS2554` arity artifacts from JS optional-params). It is well covered by
  `metricDefaults.spec.ts`, so behaviour is guarded.
- **Verify:** `type-check:app` clean for the file; `metricDefaults.spec.ts` green.
- **Risk:** low/medium — it is the one bucket where a fix can change behaviour; lean on the tests.

---

### Phase C — TypeScript strictness ratchet `[A2, A7]`

> Do **not** start until Phase A guards exist and B2's baseline is in place — strict flags surface
> hundreds of errors that must land as baseline deltas, not hard failures.

#### C1. Enable `strict` sub-flags one PR at a time `[A2]`
- **Goal:** the app builds under `strict: true`.
- **Status:** ✅ **DONE** — `tsconfig.app.json` has `"strict": true`; all ~1,134 fallout errors were
  fixed to **actual 0** (no baseline). Done in one sweep rather than flag-by-flag.
- **Verify:** `type-check:app` at 0. ✔
- **Risk:** realized as high volume, low per-fix risk.

#### C2. Add extra compiler-strictness flags `[A7]`
- **Goal:** catch return/switch/unused/index bugs the strict set does not.
- **Status:** 🟡 **partial** — decisions made per flag:
  - `noImplicitReturns` — ✅ **enabled** (`tsconfig.app.json`). 34 fallout errors fixed to 0 by making
    each implicit fall-off `undefined` explicit (pure no-op; no behavior change).
  - `noFallthroughCasesInSwitch` — ❌ **rejected.** All 8 fallthroughs are intentional cumulative
    migrations already marked `// falls through`; the TS flag has no comment escape hatch, so enabling
    it would force behavior-risky refactors for zero real benefit. ESLint's comment-aware
    `no-fallthrough` is the guard instead. (See SKILL §6.)
  - `noUnusedLocals` + `noUnusedParameters` — ⏭️ **deferred to ESLint.** `@typescript-eslint/no-unused-vars`
    is already `error` and green; enabling the TS equivalents adds ~164 redundant errors with a
    different `_`-prefix convention. ESLint stays the single source of truth for unused.
  - `noUncheckedIndexedAccess` — ⏭️ **deferred** — 962 errors; warrants its own multi-PR effort.
- **Verify:** `type-check:app` at 0 with the enabled flags. ✔

---

### Phase D — Developer workflow & hygiene (parallelisable, independent)

#### D1. Pre-commit hooks — husky + lint-staged `[A5]`
- **Status:** ❌ not started (no `.husky/`, no deps, no `lint-staged` key).
- **How:** install `husky` + `lint-staged`; `npx husky init` at the **repo root** (git root is the
  parent of `web/`), hook body `cd web && npx lint-staged`; `lint-staged` config runs `eslint --fix`
  on staged `{ts,tsx,vue,js,cjs,mjs}` (and `prettier --write` after D2). Do **not** run full
  type-check pre-commit (too slow); optional `pre-push` for `type-check:app`.
- **Verify:** stage a file with an unused import → commit auto-fixes/blocks. Escape hatch: `HUSKY=0`.
- **Risk:** low; changes local flow — announce.

#### D2. Prettier config + CI check `[A6]`
- **Status:** ❌ not started — `.prettierrc.json` is `{}`, `prettier/prettier` off, no `format` scripts.
- **How:** define an explicit `.prettierrc.json` (team-agreed) + `.prettierignore`; add `format` /
  `format:check` scripts; land the one-time reformat as its **own isolated PR** and add its SHA to
  `.git-blame-ignore-revs`; add `format:check` as a fast CI step.
- **Verify:** `npm run format:check` exits 0 on a clean tree.
- **Risk:** big diff, zero logic — merge in a quiet window; team rebases after.

#### D3. a11y + import-hygiene lint; unify coverage `[A8]`
- **Status:** ❌ not started (neither plugin installed; two conflicting coverage gates —
  `coverage.sh` `55/43.5/44/54` vs `vitest.config.ts` `33/33/40/33`).
- **How:** add `eslint-plugin-vuejs-accessibility` (flat recommended, noisy rules `warn`); add
  `eslint-plugin-import(-x)` with `import/no-cycle` (`warn`) and `import/order` (autofix); pick a
  single coverage source of truth (`vitest.config.ts`), delete the duplicate in `coverage.sh`, set
  an honest baseline and ratchet up.
- **Verify:** a11y warnings appear; `test:coverage:check` is a single passing gate.
- **Risk:** low/medium; land as `warn`, schedule warn→error.

---

### Phase E — Complete AI guidance `[A9]`

#### E1. `CLAUDE.md` / `AGENTS.md` + wire skills into AI review
- **Status:** ✅ **DONE** — `web/CLAUDE.md` (links skills + ESLint-encoded conventions) and
  `web/AGENTS.md` (thin pointer) exist; the AI reviewer now consults them: `shared-rules.md`
  Project Context tells all reviewers to read `web/CLAUDE.md` for `web/` changes (and corrects
  the stale "Pinia" → Vuex), and `agents/code-quality.md` enumerates the frontend conventions to
  flag (no `any`/`!`/use-site `as`, `no-mutating-props`, O2-over-Quasar, tokens+i18n, type/lint
  clean). No stale `ui-guidelines.md` exists to deprecate.
- **How:** create a concise `web/CLAUDE.md` (stack; "use O-components not Quasar" derived from the
  `vue/no-restricted-html-elements` block; commands; the ratchet rules from this roadmap), add
  `web/AGENTS.md` as a thin pointer, reference it from `ai-code-review.yml` (+ bug/feat checkers),
  and deprecate the stale `ui-guidelines/ui-guidelines.md` with a one-line pointer. Link to code as
  the source of truth so it does not drift.
- **Verify:** a trivial `.vue` PR → AI reviewer cites O-component conventions; Claude Code in `web/`
  picks up `CLAUDE.md`.
- **Risk:** none.

---

## Sequencing

| Order | Task | Origin | Depends on | Risk | Disruption |
|---:|---|---|---|---|---|
| 1 | A1 type-check canary | P0.4 | — | low | none |
| 2 | A2 exit/OOM assertion | P0.3 | — | low | none |
| 3 | A4 lint canary | P0.4* | — | low | none |
| 4 | A3 repoint dark `type-check` | P0.1 | A2 | med | none (baselined) |
| 5 | B1 warn→error flips | A3 | A4 | med | low |
| 6 | B2 baseline ratchet | P1 | A2,A3 | med | low |
| 7 | B3 cheap type wins (vuex, shims) | P2 | A3,B2 | low | none |
| 8 | B4 metricDefaults.js→.ts pilot | P§5 | A1–A3 | low/med | none |
| 9 | C1 strict sub-flags | A2 | A2,B2 | high vol | low |
| 10 | C2 extra compiler flags | A7 | C1 | med/high | low |
| — | D1 husky/lint-staged | A5 | — | low | medium |
| — | D2 Prettier | A6 | D1 | low/big diff | one-time rebase |
| — | D3 a11y/import/coverage | A8 | B1 | low/med | low |
| — | E1 AI guidance | A9 | — | none | none |

> Phase D and E tasks are independent of the type-check spine and can be scheduled into any quiet
> window. Phases A → B → C are strictly ordered: trust the gate, then enforce-and-baseline, then
> ratchet strictness.

---

## Combined acceptance criteria

From both docs, the program is "done" when:

1. `npm run type-check` reads **> 1,500** source files (`--listFiles | grep -c /src/`).
2. A deliberate error in any `src/**/*.ts`, `src/**/*.vue`, **or** `src/**/*.spec.ts` makes the
   check **exit non-zero**.
3. An OOM/crash makes it **exit non-zero** (never 0 with no output).
4. Checked-in canaries (type-check **and** lint) prove #2 and #3 on every CI run.
5. CI fails any PR adding an error not in the baseline; the baseline is monotonically non-increasing
   and is deleted at 0.
6. `tsconfig.app.json` builds under `strict: true` plus the Phase-C flags.
7. ESLint: 0 `error`, warnings within an agreed cap; `.ts` linted in CI.
8. Prettier `format:check` clean; pre-commit runs eslint/prettier on staged files.
9. Single coverage gate; a11y + import rules at least at `warn`.
10. `web/CLAUDE.md` exists and is wired into the AI review workflows; the stale ui-guidelines is
    retired.

### One-shot verification (run before declaring "done")

```bash
cd web
npm run type-check:all        # app + tests, 0 errors (or baseline-clean)
npm run type-check:canary     # canary reported → guard proven
npm run lint:ci               # 0 errors, warnings within cap
npm run lint:canary           # lint canary reported → guard proven
npm run format:check          # clean
npm run test:coverage:check   # single unified gate passes
```
