# i18n Enforcement

How the OpenObserve web app guarantees that user-facing text is translatable, and
what to do when a check fires.

**Status: complete and green.** `lint:ci` 0 errors · `type-check:app` 0 errors ·
`format:check` clean · 38,858 unit tests passing (identical to `main`).

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
| **`gt()`**           | the same `t`, for code outside a setup context                              |
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

Cost: **~31 s** for the full app type-check with the 10,622-key union. Not a
perf concern.

### `useI18nTyped()` vs `gt()`

- **In a component** → `const { t } = useI18nTyped()`. It is a pure type-level cast
  returning the exact composer vue-i18n created, so reactivity and every other
  member are unchanged.
- **Outside a setup context** (a composable reached from a plain function, a util,
  service-layer error handling) → `gt("some.key")`. `useI18n()` may only be called
  during setup.

Importing `useI18n` straight from `vue-i18n` is **blocked by `no-restricted-imports`**
— it returns an unbranded `string` and would silently defeat every check. Only
`src/types/i18n.ts`, the locale bootstrap, and specs are exempt.

### `raw()` — the opt-out

For server-provided messages and identifiers. Preferred over `eslint-disable`: it is
type-checked, survives refactors, and `grep -rn "raw(" src` lists every exemption
(currently **68**). It accepts nullish, so the usual fallback chain stays natural:

```ts
toast({
  variant: "error",
  message: raw(err.response?.data?.message) || t("alerts.saveFailed"),
});
```

**Never use `raw()` to silence the checker on real UI copy** — that is the exact bug
the brand exists to catch.

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
| i18n keys stored as data                         | enforced (`I18nKey`, 16 files)                    |
| Toast / notification text                        | enforced (`I18nText`, incl. the store + wrappers) |
| Text reached via `useI18nTyped()` / `gt()`       | branded across **654** files                      |

**Numbers:** en-US grew 10,216 → **10,622 keys**; **273** of the new ones sit under
`toastMessages.*` (28 module groups). 68 `raw()` opt-outs, 43 `gt()` call sites.

### Not covered

- **Dynamic keys** — ``t(`about.feature_${id}`)`` (~190 sites). No lint or type
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

| Symptom                                              | Fix                                                              |
| ---------------------------------------------------- | ---------------------------------------------------------------- |
| `no-missing-keys`                                    | add the key to `web/src/locales/languages/en-US.json`            |
| Text node `<div>Delete</div>`                        | `<div>{{ t('some.key') }}</div>`                                 |
| Static prop `label="Save"`                           | `:label="t('some.key')"`                                         |
| Bound literal `:label="'Save'"`                      | `:label="t('some.key')"`                                         |
| Composed `:label="'a' + b"`                          | `:label="t('some.key', { b })"` with `"a {b}"`                   |
| `Type 'string' is not assignable to type 'I18nText'` | wrap in `t()`; if it is server text or an identifier, `raw()`    |
| `Cannot find name 't'`                               | `const { t } = useI18nTyped()` — or `gt()` outside setup         |
| `'x.y' is not assignable to type 'I18nKey'`          | the key is missing or misspelled; tsc suggests the nearest match |
| A recurring unit/symbol/code token                   | add to `NON_TRANSLATABLE` with a one-line reason                 |
| A whole file that is genuinely code                  | add to the SyntaxGuide exemption block                           |

New text-carrying **component prop** → add its name to `TEXT_ATTRS`.
New **interface field** carrying text or a key → declare it `I18nText` / `I18nKey`.

---

## 7. Verifying

```bash
cd web
npm ci                      # fresh worktrees have no node_modules
npm run lint:ci             # 3 i18n rules + the import ban   -> 0 errors
npm run type-check:app      # I18nText / I18nKey              -> 0 errors
npm run format:check
npx vitest run --environment jsdom --root src/
```

Two notes on the test suite: it is **order-sensitive under load** — an occasional
single failure that passes in isolation is contention, not a regression; re-run
before investigating. And several specs build their own `createI18n` with a short
message list, so a component that starts calling `t()` will render the raw key
there — register the key in that spec's messages (or point it at the real
`en-US.json`) rather than asserting the key string.

---

## 8. Known rough edges

- Auto-generated `toastMessages.*` keys use **positional params** (`"{p0} moved
successfully"`). Functional, but `{type}` would read better for translators.
- A few of those key **names** are derived from their English text and are blunt
  (`pleaseWaitWhileLoadingActions`). Both are mechanical to rename.
- `eslint.config.js` still has some **duplicate rule keys** (`prettier/prettier`,
  `no-unused-vars`, `@typescript-eslint/no-unused-vars` set then redefined).
  Last-wins, so behaviour is correct, but a reader cannot tell which line is live.
