# i18n Enforcement

How the OpenObserve web app guarantees that user-facing text is translatable, and
what to do when a check fires.

**Status: enforcement complete and green.** `lint:ci` 0 errors · `type-check:app`
0 errors · spec-inclusive `type-check` 0 errors · `format:check` clean.

The mechanisms are done and so is the message cleanup — **0 fake plurals** remain in
en-US. What is left is narrower: **non-English plural rules**, the last **6 `gt` sites**,
and **one CI gap**. See [§9 Outstanding work](#9-outstanding-work) — that section is the
to-do list, kept in sync with measurements.

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

### Two curated lists

- **`TEXT_ATTRS`** (47 names) — props that carry user-facing text. Feeds both the
  static and bound rules, so "what counts as a text prop" is defined once. **Add a
  name here when a component takes UI text through a new prop.**
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
| **`gt()`**           | last resort for genuinely context-free code — **1 file**, see below         |
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

Cost: **~31 s** for the full app type-check with the 10,665-key union. Not a
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

   This is the standard for non-component code (**27 files**). It is preferred over
   `gt()` because these functions are also called directly by specs, outside any
   component, where `useI18n()` would throw. Specs pass the real translator:

   ```ts
   import i18nInstance from "@/locales";
   const t = (i18nInstance.global as any).t;
   ```

   Put `t` on the **narrowest** signature that needs it. If only one function of a
   composable translates, `t` belongs on that function, not on the composable.

3. **Genuinely context-free code** → `gt("some.key")`. Only where there is neither a
   setup context nor a caller to thread `t` through. Exactly **one** file qualifies:
   `useUnauthorizedErrorGrouper.ts`, reached from an axios 403 interceptor registered
   once at module load (interceptor → 300 ms `setTimeout` → toast → click handler).

   `gt` is deliberately a narrow escape hatch, not an alternative to case 2. Before
   reaching for it, check whether a caller can pass `t` instead — 43 of the original
   49 `gt` sites turned out to be case 2.

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
| Text reached via `useI18nTyped()`                | branded across **663** files                      |
| Composables / utils taking `t: TranslateFn`      | **27** files                                      |

**Numbers:** en-US grew 10,216 → **10,665 keys**; **311** sit under `toastMessages.*`
(28 module groups). 62 `raw()` opt-outs. **6** `gt()` call sites, all in one file.

**Where the two checkers divide.** `no-missing-keys` validates `t('x.y')` **calls**;
it cannot see a key assigned to a field. Keys stored as **data** are validated instead
by `I18nKey`, which is a literal union over the real locale file — so a registry like
`triggers.ts` (`labelKey: I18nKey`) is checked by `type-check`, not by lint. Both must
be green to claim key coverage; neither alone is sufficient.

### Not covered

- **Dynamic keys** — ``t(`about.feature_${id}`)`` (**312** sites). No lint or type
  check can resolve these. The `t` key parameter is deliberately permissive
  (`I18nKey | (string & {})`) so they keep compiling.
- **Interfaces not yet annotated.** `I18nText` guards what it is applied to. That is
  _incomplete_, never _wrong_ — coverage grows one declaration at a time, at the
  definition site, with no central registry to keep in sync.
- **Other locales.** The 14 non-en locales are generated from en-US and lag behind;
  `localeDir` points at en-US only, on purpose. Never hand-edit them.
- **Unused keys.** `@intlify/vue-i18n/no-unused-keys` is available but **not
  enabled**. Measured on this repo it reports 2,421 keys of which only ~1,302 are
  genuinely dead — 681 are reached via a key-string, 437 via a dynamic prefix. If
  you enable it, use `warn`, never `enableFix`, and populate `ignores` with the
  dynamic prefixes; its autofix would delete live translations.

---

## 5. Deliberately deferred: `strictTemplates`

Typing a component prop `label: I18nText` only gates `<OButton label="Save" />` if
Vue's `strictTemplates` is on. It is **not** enabled, which is why `TEXT_ATTRS`
still exists.

Measured twice on this branch:

|                                                                                                                    | Errors    |
| ------------------------------------------------------------------------------------------------------------------ | --------- |
| `strictTemplates: true` as-is                                                                                      | **5,450** |
| after a global `AllowedComponentProps` augmentation for `data-test`/`dataTest`/`title`/`id`/`tabindex`/`draggable` | **2,655** |

Of those, ~303 are genuine `TS2322` type mismatches (real latent bugs); the rest are
undeclared pass-through attributes.

**It was left out on purpose.** It is a large _type-safety_ migration, not i18n work,
and its i18n payoff is only retiring the `TEXT_ATTRS` list — whose real gap was
measured at **five sites** (all fixed here: `reveal-tooltip`, `hide-tooltip`,
`unstable-dimension-tooltip`, `date-disabled-tooltip`). Worth doing as its own PR;
not worth burying this one under 2,655 unrelated errors.

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

New text-carrying **component prop** → add its name to `TEXT_ATTRS`.
New **interface field** carrying text or a key → declare it `I18nText` / `I18nKey`.

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
- **`gt` proliferation.** 49 sites / 22 files → **6 sites / 1 file**, by passing
  `t: TranslateFn` (§3, case 2).
- **The `useI18n` import ban** is clean tree-wide. The only remaining `vue-i18n` import
  outside the exempt paths is `createI18n` in a test fixture, which the ban permits.
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

Ordered by value. Item 3 is the cheapest; item 1 is the only user-visible one.

### 1. Non-English plural rules (`pluralRules`)

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

### 2. The last 6 `gt()` sites

`useUnauthorizedErrorGrouper.ts`. Blocked on architecture, not effort — see §3 case 3
for why there is no caller to thread `t` through. Two designs were considered and
rejected (deferring keys to render time; injecting a translator at the composition
root). Closing this is what would allow `gt` to be deleted from `types/i18n.ts`
entirely.

### 3. Spec-inclusive `type-check` does not gate PRs

`unit-tests.yml` runs `type-check:app`, which **excludes specs**. The spec-inclusive
`type-check` runs only in `npm-update.yml`, a scheduled dependency job — so a spec that
fails to compile can reach `main`. Adding one step to `unit-tests.yml` closes it, and
the tree is currently green under both, so it would go in clean.

### 4. Standing limits (accepted, not scheduled)

- **312 dynamic keys** — unresolvable by design (§4).
- **`no-unused-keys` not enabled** — ~1,302 genuinely dead keys of the 2,421 it
  reports; its autofix would delete live translations (§4).
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
