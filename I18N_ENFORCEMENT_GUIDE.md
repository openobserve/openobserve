# i18n Enforcement

How the OpenObserve web app guarantees that user-facing text is translatable, and
what to do when a check fires.

**Status: enforcement complete.** `lint:ci` 0 errors · `type-check:app` **exit 0**
(with `--composite false`, which the npm script passes, no TS6307 surfaces) ·
`format:check` clean.

> **Known measurement gap:** the "spec-inclusive" `type-check` (tsconfig.vitest.json)
> currently checks **no spec files at all** — its include is `src/**/*.spec.{ts,js}`,
> and TypeScript globs do **not** brace-expand, so the pattern matches nothing.
> Any past "spec-inclusive type-check 0 errors" claim was vacuous. Fixing it means
> splitting the include into `src/**/*.spec.ts` + `src/**/*.spec.js` AND then fixing
> the spec-only type errors that surface (e.g. `metricGrouping.spec.ts` assigns keys
> that don't exist in en-US to `I18nKey` fixtures). Tracked in §9.

The mechanisms are done and so is the message cleanup — **0 fake plurals** remain in
en-US, the 10 surviving `gt()` calls are each individually justified (§8), `TEXT_ATTRS`
has been retired in favour of prop types (§8), and the dead-key sweep is complete (§9).
What is left is narrower: **non-English plural rules** and **spec type-checking**
(a broken tsconfig glob plus a missing PR gate, §9.3). See
[§9 Outstanding work](#9-outstanding-work) — that section is the to-do list, kept in
sync with measurements.

Converting the 71 dynamic key sites so they can be type-checked was **considered and
declined** — it is recorded under §4 as an accepted limit, not pending work.

---

## 1. The problem, and why it takes two mechanisms

A hardcoded string is only a bug if it is _user-facing_. Nothing in the string
itself tells you that — `"Save"` is copy, `"trace_id"` is a field name, `"px"` is a
unit. Any check that tries to decide from the string is guessing, and guessing
either misses real bugs or cries wolf on code tokens.

So enforcement is split by **where the string lives**, because that changes what
evidence is available:

| Where              | What decides                                                | Enforced by                       |
| ------------------ | ----------------------------------------------------------- | --------------------------------- |
| `<template>`       | position — a text node or a text-carrying attribute _is_ UI | **ESLint** (3 rules)              |
| `<script>` / `.ts` | the **type** of the field it is assigned to                 | **TypeScript** (`type-check:app`) |

Neither replaces the other. A text node has no type to annotate; a `columns` array
in `<script>` is invisible to a template rule.

---

## 2. Template side — ESLint

Three rules in `web/eslint.config.js`, all `error`, all gating `npm run lint:ci`
(which runs in `build-pr-image.yml`, `build-fork-pr-image.yml`, `playwright.yml`
and `playwright_regression.yml`).

| Rule                                      | Catches                                                                              |
| ----------------------------------------- | ------------------------------------------------------------------------------------ |
| `@intlify/vue-i18n/no-missing-keys`       | `t('x.y')` whose key is absent from `en-US.json`                                     |
| `vue/no-bare-strings-in-template`         | text nodes **and** static text props — `<div>Save</div>`, `<OButton label="Save" />` |
| `local/no-bare-bound-text-props` (custom) | everything the other two cannot see (below)                                          |

`local/no-bare-bound-text-props` covers the bound forms — `:label="'Save'"`,
`v-text="'Save'"`, `{{ 'Save' }}` — **and composed expressions**, which are just as
untranslatable and were the last template loophole:

```text
:message="'Deleted ' + n + ' rows'"     concatenation
:content="cond ? 'Yes' : 'No'"          ternary — very common on toggles
:title="`Search ${field} values`"       interpolation
{{ name || 'Unknown' }}                 fallback
```

All four fail. vue-i18n handles every one natively, so the fix is always named
interpolation, never an exemption:

```text
:message="t('alerts.deletedRows', { count: n })"    en-US: "Deleted {count} rows"
```

Use a **plural message** when singular and plural genuinely differ, rather than
collapsing to `(s)`:

```jsonc
"frustrationSignalsDetected": "{count} frustration signal detected | {count} frustration signals detected"
```

```ts
t("rum.frustrationSignalsDetected", { count: n }, n); // named + plural choice
```

The third argument selects the plural branch; the `{ count: n }` bag fills `{count}`
inside it. They are separate jobs, which is why `n` appears twice. Note the
precedence: if the named bag contains `count` (or `n`), vue-i18n uses **that** for
branch selection and the explicit third argument is ignored — so keep them equal.

`(s)` is never acceptable in a message: it does not pluralise correctly in English
("1 item(s)") and cannot be expressed at all in languages with different plural rules —
Russian needs three forms. The en-US locale is now **free of it** (139 pipe plurals); the
only two remaining `(s)` values are the seconds unit. Keep it that way.

### Passing correctly

`{{ t('common.save') }}` · `:label="t('x')"` · `:label="row.name"` (a variable
contributes no literal) · `:label="'—'"` (no letters).

### One curated list

`TEXT_ATTRS` is **gone** — prop types now decide what counts as a text prop, so there
is no list to maintain (§8). Declaring a prop `I18nText` is what makes it enforced.

- **`NON_TRANSLATABLE`** (39 entries) — tokens that must read identically in every
  language: units (`px`, `ms`, `ns`, `min`), symbols (`×`, `→`, `~`), protocol and
  spec identifiers (`GET`, `UTC`, `SQL`, `PromQL`, the OpenTelemetry statuses
  `OK`/`ERROR`/`UNSET`), and code identifiers rendered as-is (`_timestamp`,
  `[RAF]`/`[RBF]`, the `devices` icon name). One curated place read by both rules,
  so no scattered `eslint-disable` comments. **Never put real UI copy here.**

### File-level exemptions

Only the SQL/PromQL cheat-sheets (`src/plugins/{logs,traces,metrics}/SyntaxGuide*.vue`),
whose "text" is query syntax. Add a file only when it is genuinely code, with a
one-line reason.

---

## 3. Script side — the type system

`web/src/types/i18n.ts`. The decision lives on the **type declaration**, where the
author already knows the answer, and `npm run type-check:app` enforces it. This
follows a pattern the library already used for icons (`iconLeft?: IconName`).

| Export               | Use                                                                         |
| -------------------- | --------------------------------------------------------------------------- |
| **`I18nText`**       | a field holding **resolved user-facing text** (`label`, `message`, `title`) |
| **`I18nKey`**        | a field holding an **i18n key as data** (`titleKey`, `labelKey`)            |
| **`useI18nTyped()`** | replaces `useI18n()` in components — `t` returns `I18nText`                 |
| **`TranslateFn`**    | the type of `t` when a composable/util takes it as a **parameter**          |
| **`gt()`**           | last resort for genuinely context-free code — **4 files**, see below        |
| **`raw()`**          | the explicit opt-out for text that must not be translated                   |

```ts
import { useI18nTyped, raw, type I18nText, type I18nKey } from "@/types/i18n";

interface Column {
  label: I18nText; // user-facing   -> must be t() or raw()
  field: string; //   data accessor -> ordinary string
}

// stores a key, not the resolved text
interface Preset {
  titleKey: I18nKey;
}
```

`label: "Name"` is now a **compile error**. So are the composed forms — `"a" + b`,
`cond ? "x" : "y"`, `` `a ${b}` `` all widen to `string`.

### `I18nKey` is derived, not maintained

```ts
export type I18nKey = Leaves<typeof enLocale>; // every dotted path in en-US.json
```

Add a key and it is instantly valid; delete one and every reference becomes an
error, with a suggestion:

```
presets.ts(76,5): error TS2820: Type '"emptyState.noLogs.titel"' is not assignable
  to type 'I18nKey'. Did you mean '"emptyState.noLogs.title"'?
```

Cost: **~31 s** for the full app type-check with the ~9,800-key union. Not a
perf concern.

### Getting a `t`: three cases, in order of preference

1. **In a component** → `const { t } = useI18nTyped()`. A pure type-level cast
   returning the exact composer vue-i18n created, so reactivity and every other
   member are unchanged.

2. **In a composable or util** → take `t` as a **parameter** typed `TranslateFn`,
   and let the calling component supply it:

   ```ts
   import { raw, type TranslateFn } from "@/types/i18n";

   export async function copyToClipboard(
     text: string,
     t: TranslateFn,
     opts = {},
   ) {
     toast({ message: raw(opts.successMessage || t("common.copySuccess")) });
   }
   ```

   This is the standard for non-component code (**35 files**). It is preferred over
   `gt()` because these functions are also called directly by specs, outside any
   component, where `useI18n()` would throw. Specs pass the real translator:

   ```ts
   import i18nInstance from "@/locales";
   const t = (i18nInstance.global as any).t;
   ```

   Put `t` on the **narrowest** signature that needs it. If only one function of a
   composable translates, `t` belongs on that function, not on the composable.

3. **Genuinely context-free code** → `gt("some.key")`. Only where there is neither a
   setup context nor a caller to thread `t` through. Exactly **four** files qualify
   (10 call sites), each for a distinct structural reason:

   - `useUnauthorizedErrorGrouper.ts` (6) — reached from an axios 403 interceptor
     registered once at module load (interceptor → 300 ms `setTimeout` → toast →
     click handler). The founding case.
   - `ingestion/setupCard/content/kubernetes.ts` (2) — the setup-card registry pins
     every builder to `(subs: CardSubstitutions) => RichCardContent`; threading `t`
     would change that shared contract for ~20 cards. Static prose in cards uses
     `descriptionKey`/`helpKey` (renderer-resolved); `gt` covers only the one
     description that interpolates a URL, translated at card-build time.
   - `utils/query/searchError.ts` (1) — the translated **default** of an optional
     `fallback: I18nText` parameter, evaluated per call; callers that hold `t`
     override it (e.g. `parseSearchError(err, gt("search.unknownError"))`).
   - `usePanelPromQLExecutor.ts` (1) — reached through composable chains that are
     not guaranteed to run in a setup context, where `useI18n()` would throw.

   `gt` is deliberately a narrow escape hatch, not an alternative to case 2. Before
   reaching for it, check whether a caller can pass `t` instead — the overwhelming
   majority of historical `gt` sites (including the import validators and
   `useQualityDetailCharts`, converted since) turned out to be case 2.

> **Keys resolved at display time, not module load.** When storing keys as data, keep
> the `I18nKey` map at module scope but resolve it inside the function that renders.
> Calling `gt()`/`t()` at module scope freezes the text at the locale that happened to
> be active on page load.

Importing `useI18n` straight from `vue-i18n` is **blocked by `no-restricted-imports`**
— it returns an unbranded `string` and would silently defeat every check. Only
`src/types/i18n.ts`, the locale bootstrap, and specs are exempt.

### `raw()` — the opt-out

For server-provided messages and identifiers. Preferred over `eslint-disable`: it is
type-checked, survives refactors, and `grep -rn "raw(" src` lists every exemption
(currently **62**). It accepts nullish, so the usual fallback chain stays natural:

```ts
toast({
  variant: "error",
  message: raw(err.response?.data?.message) || t("alerts.saveFailed"),
});
```

**Never use `raw()` to silence the checker on real UI copy** — that is the exact bug
the brand exists to catch. `raw("Saved successfully")` compiles and is wrong; 12 such
misuses were found and fixed by auditing every `raw()` whose argument was a **literal**
rather than a variable. That audit is worth repeating when the count grows.

### Which `*Key` fields are actually i18n keys

Not all of them. These are **field accessors** and stay `string`:

- `OSelect.labelKey` / `valueKey` / `iconKey` — "which property of the row holds the label"
- `JourneySteps.actionKey`, `nameKey`, `detailKey` — same
- `DetailKpi.titleKey` — holds a partial token (`"average"`, `"p50"`), not a full path

Read the doc comment before annotating. This distinction is precisely why the
annotation is made by hand at the declaration rather than by a pattern match.

---

## 4. Current coverage

| Surface                                          | State                                             |
| ------------------------------------------------ | ------------------------------------------------- |
| Template text nodes + static props               | enforced (ESLint)                                 |
| Template bound props, `v-text`/`v-html`, `{{ }}` | enforced (ESLint)                                 |
| Template **composed** expressions                | enforced (ESLint)                                 |
| `t()` keys — literal                             | enforced (ESLint, `.vue` **and** `.ts`)           |
| i18n keys stored as data                         | enforced (`I18nKey`, 19 files)                    |
| Toast / notification text                        | enforced (`I18nText`, incl. the store + wrappers) |
| Text reached via `useI18nTyped()`                | branded across **668** files                      |
| Composables / utils taking `t: TranslateFn`      | **27** files                                      |

**Numbers** (re-measured 2026-07-31, after the post-review debt cleanup): en-US holds
**9,837 keys** across **72 namespaces** (10,216 → 11,002 as text was migrated in,
→ 9,648 after the dead-key sweep §9, → 9,837 as the remaining hardcoded prose —
import validators, setup-card descriptions, status labels, dialog buttons — was
keyed); **309** sit under `toastMessages.*`. **977** `raw()` opt-outs — the count
rose steeply when props became `I18nText`, since every genuinely non-translatable
value (units, tokens, glyphs, API data) has to say so explicitly, then fell as
`raw()`-wrapped prose was converted to keys. **10** `gt()` call sites in **4**
files (see §3 case 3 for the per-file justification).

**Where the two checkers divide.** `no-missing-keys` validates `t('x.y')` **calls**;
it cannot see a key assigned to a field. Keys stored as **data** are validated instead
by `I18nKey`, which is a literal union over the real locale file — so a registry like
`triggers.ts` (`labelKey: I18nKey`) is checked by `type-check`, not by lint. Both must
be green to claim key coverage; neither alone is sufficient.

### Not covered

- **Dynamic keys — 71 sites. Considered and DECLINED; do not re-open as pending work.**

  ``t(`about.feature_${id}`)`` and similar. A renamed or deleted key reached this way is
  caught by nothing: ESLint sees no literal, `t`'s permissive
  `I18nKey | (string & {})` parameter accepts any string, vue-i18n returns the key
  instead of throwing, and the production build strips its dev warning. It renders the
  raw dotted path on screen.

  Nothing is currently broken — every key these sites can request was expanded and
  verified present. The exposure is a future rename, concentrated in `onlineEvals`
  (40 of the 71 sites).

  Closing it would mean removing the `(string & {})` arm, which surfaces **117 errors**:
  ~80 are unrelated consumers declaring their translator loosely as
  `(key: string) => string` (a contravariance failure, not a key problem), 15 need a
  variable widened to a literal union, 9 need a `Record<string, I18nKey>` map, and a
  handful are genuine key/code mismatches. Two-thirds of the work is therefore not about
  dynamic keys at all, which is why this was judged not worth it as a standalone project.

  If the guarantee is ever wanted, the cheap route is a second strict export
  (`(key: I18nKey)`) used by new code only — no flag day, no 98-file PR.

  > Count these with a word boundary: `grep 't(\`'` also matches `` fetch(`…`) `` and any
other call ending in `t`, which inflates the figure roughly fourfold. A further 21
  > sites use backticks but interpolate nothing — those are ordinary static keys.

- **Interfaces not yet annotated.** `I18nText` guards what it is applied to. That is
  _incomplete_, never _wrong_ — coverage grows one declaration at a time, at the
  definition site, with no central registry to keep in sync.
- **Other locales.** The 14 non-en locales are generated from en-US and lag behind;
  `localeDir` points at en-US only, on purpose. Never hand-edit them.
- **Unused keys.** `@intlify/vue-i18n/no-unused-keys` is available but **not enabled**.
  It reports 2,421 keys, but it only sees `t('literal')` calls — so keys reached
  through a variable or a dynamic prefix look unused to it, and its autofix would
  delete them. A direct measurement (literal tokens + dynamic prefixes + the one
  concatenation site) put the genuinely dead set at **1,363**, since deleted (§9).
  If you ever enable the rule, use `warn`, never `enableFix`, and populate `ignores`
  with the dynamic prefixes. Note that even the direct measurement missed 9 live keys
  (§9) — no automated sweep sees keys held in JSON data files.

---

## 5. Deliberately deferred: `strictTemplates`

A **declared** prop typed `label: I18nText` gates `<OButton label="Save" />` with or
without `strictTemplates` — declared props are always checked. `strictTemplates`
governs **undeclared** attributes only. This was verified by probe, and it is what
allowed `TEXT_ATTRS` to be retired (§8) while `strictTemplates` stays off.

Measured twice on this branch:

|                                                                                                                    | Errors    |
| ------------------------------------------------------------------------------------------------------------------ | --------- |
| `strictTemplates: true` as-is                                                                                      | **5,450** |
| after a global `AllowedComponentProps` augmentation for `data-test`/`dataTest`/`title`/`id`/`tabindex`/`draggable` | **2,655** |

Of those, ~303 are genuine `TS2322` type mismatches (real latent bugs); the rest are
undeclared pass-through attributes.

**It was left out on purpose.** It is a large _type-safety_ migration, not i18n work,
and it turned out to carry **no i18n payoff at all** — retiring `TEXT_ATTRS` did not
require it. Worth doing as its own PR for the ~303 genuine `TS2322` mismatches; not
worth burying this one under 2,655 unrelated errors.

---

## 6. Fixing a violation

| Symptom                                              | Fix                                                                                                   |
| ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `no-missing-keys`                                    | add the key to `web/src/locales/languages/en-US.json`                                                 |
| Text node `<div>Delete</div>`                        | `<div>{{ t('some.key') }}</div>`                                                                      |
| Static prop `label="Save"`                           | `:label="t('some.key')"`                                                                              |
| Bound literal `:label="'Save'"`                      | `:label="t('some.key')"`                                                                              |
| Composed `:label="'a' + b"`                          | `:label="t('some.key', { b })"` with `"a {b}"`                                                        |
| `Type 'string' is not assignable to type 'I18nText'` | wrap in `t()`; if it is server text or an identifier, `raw()`                                         |
| `Cannot find name 't'`                               | in a component `const { t } = useI18nTyped()`; in a composable/util add a `t: TranslateFn` param (§3) |
| `Cannot find name 't'` in an Options-API `methods:`  | use `this.t` — `methods` is a sibling of `setup()`, not inside its closure                            |
| `'x.y' is not assignable to type 'I18nKey'`          | the key is missing or misspelled; tsc suggests the nearest match                                      |
| A recurring unit/symbol/code token                   | add to `NON_TRANSLATABLE` with a one-line reason                                                      |
| A whole file that is genuinely code                  | add to the SyntaxGuide exemption block                                                                |

New text-carrying **component prop** → declare it `I18nText`. In `<script setup>`,
`defineProps<{ label: I18nText }>()`. In the Options API the double cast is required,
because `StringConstructor` resolves to an unbranded `string`:

```ts
title: { type: String as unknown as PropType<I18nText>, default: raw("") }
```

New **interface field** carrying text or a key → declare it `I18nText` / `I18nKey`.
New **i18n key stored in a `.json` data file** → add it to the `localeKeys.spec.ts`
guard; no type or lint rule can see it (§9).

---

## 7. Verifying

```bash
cd web
npm ci                      # fresh worktrees have no node_modules
npm run lint:ci             # 3 i18n rules + the import ban   -> 0 errors
npm run type-check:app      # I18nText / I18nKey (app code)   -> 0 errors
npm run type-check          # same, INCLUDING specs           -> 0 errors
npm run format:check
npx vitest run
```

**Run `type-check` as well as `type-check:app`.** They use different tsconfigs and
only `type-check:app` gates PRs (see §9) — `type-check:app` **excludes specs**, so a
spec calling `useDashboardPanelData()` without its new `t` argument passes it and
fails only at runtime. Several such breaks were caught this way.

Three notes on the test suite:

- It is **order-sensitive under load** — an occasional single failure that passes in
  isolation is contention, not a regression; re-run before investigating. Symptom to
  look for: aggregate `import`/`environment` times several times the wall clock,
  meaning worker oversubscription against a 5 s timeout.
- `setupTests.ts` installs the **real** i18n globally
  (`config.global.plugins = [..., i18n]`), so components resolve `t()` in specs
  without any per-spec setup. Its import graph is pulled into the module cache before
  every spec, which makes those modules **un-`vi.mock()`-able** — spy on them instead.
- **106 specs still construct their own `createI18n`.** A mount-level plugin installs
  _after_ the global one and wins, so those specs render **raw keys** for anything
  outside their own message list. That is why adding a `t()` call to a component can
  redden a spec that never mentioned i18n. Register the key there, or drop the local
  instance and let the global one apply.

  **Do not sweep these.** Measured: 32 point at the real `en-US.json` (redundant but
  harmless) and 73 of the remaining 74 never assert on translated text, so the short
  list never matters. Clean one up only when already editing it — and expect assertions
  that pin the raw key to break when you do (`SourceMaps.spec.ts` asserts
  `primaryButtonLabel === "common.ok"`, which becomes `"OK"` once the global instance
  applies). A 106-file sweep for no user-visible gain is how an earlier i18n pass broke
  1,168 tests.

**After merging `main`, re-run `lint:ci` before trusting the merge.** These rules exist
only on this branch, so code arriving from `main` has never been checked against them.
Git merges it cleanly — there is no conflict to review — and it can still fail CI. Two
real cases: a new component using the banned `useI18n` import, and a new feature adding
`label="Categraf"` plus a hardcoded doc-link string. Also watch for `main` **reverting**
a fix inside a region it rewrote: taking its side of a conflicted template reintroduced
a hardcoded `'At least 1 item required'` that this branch had already converted.

**Grepping for missing arguments.** When a shared function gains a `t` parameter,
`type-check` catches typed call sites but not `@ts-nocheck` files or `.spec.js`. Both
exist in this repo. A throwaway arity check over the call sites of the changed
function is the only reliable sweep — it found 10 missing arguments in `@ts-nocheck`
files on the main logs surfaces that both type-checks reported as clean.

---

## 8. Fixed since the first pass

Recorded so they are not re-reported as open:

- **Positional toast params.** `{p0}` / `{p1}` are gone — **0 remain** anywhere in the
  locale. Auto-generated `toastMessages.*` keys now use semantic names (`{type}`,
  `{name}`, `{count}`).
- **Fake plurals under `toastMessages.*`.** 33 `(s)` messages became pipe plurals;
  **0 remain** in that namespace (53 pipe plurals now exist locale-wide). Key names
  that encoded the old shape (a trailing `S`) were renamed to match.
- **`raw()` misuse.** 12 sites wrapped hardcoded English in `raw()`, defeating the
  brand; all now call `t()`.
- **Verb injection.** 5 messages interpolated an English verb into a sentence
  (`"Failed to {action} the alert"`), which is unlocalisable word order; each is now a
  complete message per case.
- **`gt` proliferation.** 49 sites / 22 files → **10 sites / 4 files**, by passing
  `t: TranslateFn` (§3, case 2). The audit (2026-07-31) converted every site whose
  caller could supply `t` — the onlineEvals import validators now take `t` via their
  `ctx`, `useQualityDetailCharts` and `computePrefixAssignment` take it as a
  parameter. The 10 that remain are each structurally unable to receive a `t`
  (axios interceptor, fixed registry contract, optional-param default, non-setup
  composable chain — the per-file list is in §3 case 3) and are **intentional and
  final**. Two alternatives were considered and rejected: deferring keys to render
  time, and injecting a translator at the composition root. `gt` stays exported as
  a deliberate, narrow escape hatch; **do not re-raise this as cleanup.**
- **The `useI18n` import ban** is clean tree-wide. The only remaining `vue-i18n` import
  outside the exempt paths is `createI18n` in a test fixture, which the ban permits.
- **`TEXT_ATTRS` is gone.** The 47-name attribute allowlist and the bound-prop half of
  `local/no-bare-bound-text-props` were deleted; prop types now do that job (§3). A
  declared `I18nText` prop is checked in templates **without** `strictTemplates` —
  `strictTemplates` governs _undeclared_ attributes only, so §5 is not a blocker for
  this. Type checking is also _stricter_ than the old rule: it rejects a plain `string`
  variable, which the rule allowed. `vue/no-bare-strings-in-template` stays enabled,
  because a bare text node has no prop to annotate; `NON_TRANSLATABLE` still feeds it.
- **Fake plurals everywhere else.** The remaining 104 `(s)` messages are gone — pipe
  plurals went 53 → **139**. Breakdown of how they were fixed:
  - 69 already interpolated `{count}`/`{n}`, so the call sites were already correct and
    only the messages changed.
  - 11 counted on a differently-named variable (`{successful}`, `{failCount}`); those
    were renamed to `count` at the call site. Where a message pluralised **two**
    different nouns, the second noun is dropped — vue-i18n selects one branch per
    message, so `"Deleted {count} groups. Failed to delete {failCount}."` is the shape.
  - 18 were standalone labels with no count (`"Variable(s)"`, `"Minute(s)"`) and simply
    took the plural word.
  - 5 were suffixes concatenated onto a number in the template
    (`{{ n }} {{ t('…streamsUnit') }}`); the count moved **into** the message.
  - `search.pluralSuffix` (value: `"(s)"`, appended in `Pagination.vue`) was deleted and
    replaced with a count-aware computed, since its noun comes from a runtime prop
    rather than a message.

  Two `(s)` entries remain **on purpose**: `dashboard.seconds` and
  `alerts.historyTable.evaluationTime` use it as the seconds unit.

---

## 9. Outstanding work

### ~~1. Delete dead keys from `en-US.json`~~ — done

`en-US.json` went from **11,002 → 9,648 keys** (75 → 71 namespaces, ~90 KB smaller).
1,363 keys were deleted and **9 were restored** after audit; see below. (The count
has since grown again to **9,837 / 72 namespaces** as the post-review debt cleanup
keyed the remaining hardcoded prose — that growth is live keys, not resurrected
dead ones.)

**What the scan excluded up front.** Keys with a literal reference in prod code or
specs, keys reachable through a dynamic prefix (a conservative exclusion — spared
because a dynamic key _might_ reach them, not because they are proven live), and the
5 keys reachable through the one concatenation site (`utils/common.ts`, `"message." +
code`).

**The audit that followed, and why it mattered.** Six independent read-only agents
re-checked all 1,363 deletions, each told to hunt specifically for what a
quoted-literal scan structurally cannot see. They found **9 genuine false deletions**
across two distinct blind spots — both now closed by guards that were verified to
fail when the key is removed:

| Blind spot                                                        | Keys | Guard added                                                   |
| ----------------------------------------------------------------- | ---- | ------------------------------------------------------------- |
| Keys living in a **JSON data file** (`constants/features.json`)   | 5    | `localeKeys.spec.ts` — resolves every key features.json cites |
| Template literal **assigned to a variable** before reaching `t()` | 4    | `useGreeting.ts` — `const key: I18nKey = …`                   |

The first is the more important lesson: TypeScript widens imported JSON string values
to `string`, so keys stored in a data file cannot be typed as `I18nKey` and are
invisible to _every_ static check. Annotating `FeatureAvailability` documents intent
but **does not enforce** — `FEATURE_REGISTRY` casts with `as`, and the widening defeats
it regardless. Only the spec guard actually catches this.

**If you delete keys again.** Regenerate the list (the set moves as code changes) and
scan **`.json`/`.md`/`.yaml` as well as `.ts`/`.vue`** — the original sweep read only
JS/TS and that is exactly how the features.json keys were lost. Never use
`no-unused-keys --fix`: it shares the blind spot and would delete the dynamic-reachable
keys. `no-missing-keys` and `I18nKey` together catch an over-delete of any _literal_
reference, but neither sees the two cases above.

**Other locales.** The 14 non-English files still carry ~1,317 of the deleted keys.
This is expected and self-healing: `scripts/translations/README.md` documents the
pipeline as pruning keys removed from `en-US.json`. Harmless meanwhile — nothing
requests them and en-US is the fallback.

### 2. Non-English plural rules (`pluralRules`)

The en-US messages are now real pipe plurals, but **branch selection still uses
vue-i18n's built-in default for every locale** because this repo configures no
`pluralRules`. The default is `n === 1 ? 0 : 1` for two branches — correct for
English, wrong for languages with different rules.

Russian is the clearest case: it needs one / few / many (1, 2–4, 5+), and the default
renders `1` using the "few" form. Fixing it means adding a `pluralRules` map in
`src/locales/` keyed by locale, then giving those locales three-branch messages.

Worth knowing how far the old convention spread before deciding scope: fr-FR carries
**130** `(s)` instances, pt-PT 107, es-ES 75, nl-NL 37, de-DE 17 — French more than
en-US ever had, including a mis-spaced `"{count} utilisateur (s)"`. Those files are
generated and must not be hand-edited, so they keep their `(s)` until regenerated.
This degrades safely: if en-US has a pipe and fr-FR does not, vue-i18n returns the
French message unchanged rather than mis-selecting a branch.

### 3. Spec type-checking does not exist — anywhere

Two separate problems compound here.

**First, the config is broken.** `tsconfig.vitest.json`'s include is
`src/**/*.spec.{ts,js}` — but TypeScript globs do **not** support brace expansion,
so the pattern matches **zero files**. `npm run type-check` "passes" in seconds
because it checks nothing but `vitest.config.ts`/`vite.config.ts` (verify with
`npx tsc -p tsconfig.vitest.json --listFilesOnly`). Any past claim that the tree
is "green under both configs" was vacuous. Additionally, the npm script's
`NODE_OPTIONS=…` prefix is POSIX-only, so `npm run type-check` errors outright on
Windows shells.

**Second, even a working spec type-check would not gate PRs.** `unit-tests.yml`
(the PR gate) runs only `type-check:app`, which excludes specs. Vitest transpiles
through esbuild, which strips types without checking them, so a type-broken spec
still runs and can pass while testing the wrong thing. This branch hit exactly
that — when `useDashboardPanelData()` gained its `t` parameter, **55 specs** kept
the old signature while `type-check:app` reported 0 errors.

Fix is two steps, in order:

1. Split the include in `tsconfig.vitest.json` into `src/**/*.spec.ts` and
   `src/**/*.spec.js`, run it, and fix what surfaces — spec-only type errors exist
   today (e.g. `metricGrouping.spec.ts` assigns non-existent keys to `I18nKey`
   fixtures), so expect this to start **red**, not clean.
2. Then add the step next to the existing one in `unit-tests.yml`:

```yaml
- name: Type-check specs (any error fails)
  working-directory: web
  run: npm run type-check
```

### 4. Standing limits (accepted, not scheduled)

- **71 dynamic keys** — conversion considered and **declined**; see §4 for the full
  reasoning and what closing it would cost.
- **`no-unused-keys` not enabled** — it reports 2,421 keys but shares the blind spot
  that makes ~1,000 of those false positives, and its autofix deletes what it flags.
  The dead-key cleanup in §9.1 uses a directly-measured list instead (§4).
- **`strictTemplates` deferred** — 2,655 errors, a type-safety migration rather than
  i18n work (§5).
- **`eslint.config.js` duplicate rule keys** — `prettier/prettier` appears 3×,
  `@typescript-eslint/no-unused-vars` 2×. Last-wins, so behaviour is correct, but a
  reader cannot tell which line is live.
- **Other locales** — the 14 non-en files are generated and lag; never hand-edit.

### Verification debt

The full unit suite has not been run since the `main` merge (`4927f39379`). What _was_
run: `lint:ci`, both type-checks, `format:check`, and the 53 spec files covering every
file the merge touched (2,681 tests, 0 failures). The residual risk is a spec elsewhere
asserting on locale text — low, since no key _values_ changed in the merge, but not
zero.
