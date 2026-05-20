# Cipher Keys Page — Quasar Removal Audit

## Summary

The Cipher Keys page underwent a substantial migration: `q-page` → `<div>`, `q-table` → `OTable`, `q-input` → `OInput`, `q-select` → `OSelect`, `q-stepper`/`q-step` → `OStepper`/`OStep`, `q-form` → plain `<div>`, `$q.notify` → `toast()`, and Quasar `:rules` arrays → manual per-field error refs + `validateName()`/`validateStoreType()` helpers. Quasar is fully removed from `package.json`.

Core CRUD flows (list, create, edit, delete, bulk delete) still wire through `CipherKeysService` and remain functional, but several **migration regressions** have been introduced:

- A back-button `<div>` still carries leftover `q-btn` props (`no-caps`, `padding="xs"`, `outline`, `icon="..."`) that are now invisible HTML attributes.
- `OInput :disable=` is a Quasar-only prop — OInput accepts `disabled`. The name input cannot be disabled in edit mode (readonly still works, so it is cosmetic but inconsistent).
- `validateAkeylessFields()` is exported from `AddAkeylessType.vue` but is **never called** by `AddCipherKey.vue` on save, so users can submit empty Akeyless base URL / access ID / access key / LDAP / static-secret / DFC fields with no inline feedback.
- `AddOpenobserveType.vue` defines a local `secretTouched` ref but `onSubmit` in `AddCipherKey.vue` never invokes any child validation — submission with an empty OpenObserve secret falls through to the backend.
- `AddEncryptionMechanism.vue` is the same: `providerTypeTouched` / `algorithmTouched` exist but parent never queries the child to gate save.
- `maxLengthCharValidation` is imported into `AddCipherKey.vue` but no longer referenced (`validateName()` uses `length > 50` directly).
- `i18n` keys `cipherKey.providerTypeRequired` and `cipherKey.algorithmRequired` are referenced in `AddEncryptionMechanism.vue` but are missing from `web/src/locales/languages/en.json` (and presumably siblings); the `||` fallback never triggers because `t()` returns the key string truthy. Users will see literal i18n keys.
- Dead Quasar utility classes: `q-mt-md`, `q-mb-md`-equivalents are not redefined in `app.scss`. Spacing intent is silently lost (single occurrence remaining: `class="q-mt-md"` on `AddCipherKey.vue:63`).
- CSS variable `--q-color-dark` referenced in `AddAkeylessType.vue:391` is undefined now; the `<legend>` color falls back to default.
- Dead scoped style `.q-table { &__top { … } }` in `CipherKeys.vue:474-479` — selector never matches the new `OTable` markup.
- Spec files are **broken**:
  - `cipherKeyTestFixtures.ts:20` still `import { Quasar } from "quasar";` (Quasar removed from deps → import will fail).
  - `AddAkeylessType.spec.ts:20` still `import { QBtn, QFieldset, QInput, QSelect } from "quasar";`.
  - `AddCipherKey.spec.ts` & `CipherKeys.spec.ts` stub `q-page`, `q-form`, `q-input`, `q-select`, `q-stepper`, `q-step`, `q-btn`, `QTable`, etc., but the component now renders `OInput`/`OSelect`/`OStepper`/`OTable` — stubs are inert; many `wrapper.find('.q-*-stub')` assertions will fail.

The page renders and the happy path works in manual testing, but pre-merge a test re-write and the validation wiring fix are required.

## Files Audited

- `/Users/ktx/Documents/Projects/openobserve.worktrees/ux-revamp/web/src/components/settings/CipherKeys.vue`
- `/Users/ktx/Documents/Projects/openobserve.worktrees/ux-revamp/web/src/components/cipherkeys/AddCipherKey.vue`
- `/Users/ktx/Documents/Projects/openobserve.worktrees/ux-revamp/web/src/components/cipherkeys/AddAkeylessType.vue`
- `/Users/ktx/Documents/Projects/openobserve.worktrees/ux-revamp/web/src/components/cipherkeys/AddOpenobserveType.vue`
- `/Users/ktx/Documents/Projects/openobserve.worktrees/ux-revamp/web/src/components/cipherkeys/AddEncryptionMechanism.vue`
- `/Users/ktx/Documents/Projects/openobserve.worktrees/ux-revamp/web/src/components/settings/CipherKeys.spec.ts`
- `/Users/ktx/Documents/Projects/openobserve.worktrees/ux-revamp/web/src/components/cipherkeys/AddCipherKey.spec.ts`
- `/Users/ktx/Documents/Projects/openobserve.worktrees/ux-revamp/web/src/components/cipherkeys/AddAkeylessType.spec.ts`
- `/Users/ktx/Documents/Projects/openobserve.worktrees/ux-revamp/web/src/components/cipherkeys/AddOpenobserveType.spec.ts`
- `/Users/ktx/Documents/Projects/openobserve.worktrees/ux-revamp/web/src/components/cipherkeys/AddEncryptionMechanism.spec.ts`
- `/Users/ktx/Documents/Projects/openobserve.worktrees/ux-revamp/web/src/test/unit/fixtures/cipherKeyTestFixtures.ts`

Cross-checked: `/Users/ktx/Documents/Projects/openobserve.worktrees/ux-revamp/web/src/services/cipher_keys.ts`, `/Users/ktx/Documents/Projects/openobserve.worktrees/ux-revamp/web/src/lib/forms/Input/OInput.types.ts`, `/Users/ktx/Documents/Projects/openobserve.worktrees/ux-revamp/web/src/lib/core/Table/OTable.types.ts`, `/Users/ktx/Documents/Projects/openobserve.worktrees/ux-revamp/web/src/lib/navigation/Stepper/OStep.types.ts`, `/Users/ktx/Documents/Projects/openobserve.worktrees/ux-revamp/web/src/locales/languages/en.json` (cipherKey block), `/Users/ktx/Documents/Projects/openobserve.worktrees/ux-revamp/web/src/styles/app.scss`, `/Users/ktx/Documents/Projects/openobserve.worktrees/ux-revamp/web/src/styles/_quasar-variables.scss`, `/Users/ktx/Documents/Projects/openobserve.worktrees/ux-revamp/web/package.json`.

## Critical Issues

### C1. `validateAkeylessFields` defined but never called — Akeyless save bypasses all field validation

- `web/src/components/cipherkeys/AddAkeylessType.vue:294-325` defines `validateAkeylessFields()` and exposes it (line 371) but **no caller exists** (`grep` finds zero other matches across `.vue`/`.spec.ts`).
- `web/src/components/cipherkeys/AddCipherKey.vue:350-365` `onSubmit()` validates only `name` and `store.type`. There is no `ref` on the child component and no invocation of `validateAkeylessFields()`.
- Result: a user can pick "Akeyless", leave Base URL / Access ID / Auth (access key OR LDAP creds) / Secret Type (static_secret name OR DFC name + encrypted_data) entirely blank, click Save, and the request is shipped to the backend. Backend will 4xx, but no inline error appears next to the offending fields.
- This is a clear regression from the main branch which used Quasar's `q-form.validate()` to walk every child input's `:rules`.

**Solution:**
```diff
+ const akeylessRef = ref();   // template: <AddAkeylessType ref="akeylessRef" ... />

  const onSubmit = async () => {
    if (!validateName() || !validateStoreType()) return;
+   if (formData.value.key.store.type === "akeyless" && akeylessRef.value && !akeylessRef.value.validateAkeylessFields()) return;
    // proceed with save...
  };
```

### C2. OpenObserve type — empty secret submits to backend

- `web/src/components/cipherkeys/AddOpenobserveType.vue:24-27` ties `error` to a local `secretTouched && !formData.key.store.local`. The "touched" flag only flips on input — if the user never focuses the field and clicks Save, the error never shows.
- `AddCipherKey.vue onSubmit()` never queries the child. Same problem as C1.

**Solution:**
```diff
+ // In AddOpenobserveType.vue, expose validate fn:
+ defineExpose({ validateOpenobserveFields() { secretTouched.value = true; return !!formData.key.store.local; } });
+ // In AddCipherKey.vue:
+ const oobRef = ref();
+ if (formData.value.key.store.type === "openobserve" && !oobRef.value?.validateOpenobserveFields()) return;
```

### C3. Encryption mechanism — provider type / algorithm not enforced on save

- `web/src/components/cipherkeys/AddEncryptionMechanism.vue:26-29, 41-43` again uses a local `…Touched` ref. Default values (`type: "simple"`, `simple_algorithm: "aes-256-siv"`) currently mask the issue, but if a user opens step 2 and selects "Tink KeySet" (which has no algorithm dropdown branch) or somehow nullifies `simple_algorithm`, save proceeds with no inline error.

**Solution:**
```diff
+ // In AddEncryptionMechanism.vue:
+ defineExpose({
+   validateEncryptionMechanism() {
+     providerTypeTouched.value = true;
+     algorithmTouched.value = true;
+     return !!frmData.value.key.mechanism.type
+       && (frmData.value.key.mechanism.type !== "simple" || !!frmData.value.key.mechanism.simple_algorithm);
+   },
+ });
```

### C4. Spec files & shared fixture import a removed dependency (`quasar`)

- `web/src/test/unit/fixtures/cipherKeyTestFixtures.ts:20` — `import { Quasar } from "quasar";`
- `web/src/components/cipherkeys/AddAkeylessType.spec.ts:20` — `import { QBtn, QFieldset, QInput, QSelect } from "quasar";`
- `web/src/components/cipherkeys/AddCipherKey.spec.ts` — uses `installQuasar` from `@/test/unit/helpers/install-quasar-plugin` (still works if helper is a no-op) but the entire stub set targets `q-page`, `q-form`, `q-input`, `q-select`, `q-stepper`, `q-step`, `q-btn` which the component no longer renders.
- `web/src/components/settings/CipherKeys.spec.ts` — `vi.mock("quasar", …)` + `useQuasar` mock + `QTable`/`QInput`/`QBtn`/`QIcon`/`QTh`/`QTr`/`QTd` stubs.
- With Quasar removed from `package.json`, **these imports will fail at module resolution**, taking the entire `vitest` runs for these specs offline. Even if `quasar` is still resolvable via a transient peer, the assertion expectations (`.q-form-stub`, `.q-stepper-stub`, `.q-page-stub`) target stubs that are never rendered against `OInput`/`OSelect`/`OStepper`/`OStep` and will fail.

**Solution:**
```diff
- import { Quasar } from "quasar";
- import { QBtn, QFieldset, QInput, QSelect } from "quasar";
- installQuasar({ plugins: [], components: [QInput, QSelect, QBtn, QFieldset] });
+ // Replace q-* stubs with O* stubs and drop quasar imports.
+ const wrapper = mount(Comp, { global: { stubs: { OInput: true, OSelect: true, OButton: true, OStepper: true, OStep: true, OTable: true } } });
- wrapper.find(".q-form-stub")
+ wrapper.findComponent({ name: "OForm" })
```

## Logical Issues

### L1. Leftover Quasar QBtn attributes on a plain `<div>` (back button)

`web/src/components/cipherkeys/AddCipherKey.vue:20-28`

```vue
<div
  no-caps
    padding="xs"
    outline
    icon="arrow_back_ios_new"
    class="el-border tw:w-6 tw:h-6 ..."
  title="Go Back"
  @click="$emit('cancel:hideform')"
>
  <OIcon name="arrow-back-ios-new" size="xs" />
</div>
```

`no-caps`, `padding="xs"`, `outline`, and `icon="arrow_back_ios_new"` were `q-btn` props on `main`. After the migration to `<div>`, they are now inert HTML attributes (`icon` becomes a non-standard attr, `outline` becomes a boolean attr). Cosmetic but should be removed to avoid linter noise and DOM warnings.

Note the indentation (lines 22-24 are double-indented relative to 21/25) — a strong tell that this block was a hasty find-replace.

**Solution:**
```diff
- <div
-   no-caps padding="xs" outline icon="arrow_back_ios_new"
-   class="el-border tw:w-6 tw:h-6 ..." title="Go Back"
-   @click="$emit('cancel:hideform')"
- >
-   <OIcon name="arrow-back-ios-new" size="xs" />
- </div>
+ <OButton
+   variant="ghost" size="icon-sm"
+   icon-left="arrow-back-ios-new"
+   :title="t('common.goBack')" :aria-label="t('common.goBack')"
+   @click="$emit('cancel:hideform')"
+ />
```

### L2. `:disable` passed to `OInput` — OInput uses `disabled`

`web/src/components/cipherkeys/AddCipherKey.vue:53-54`

```vue
v-bind:readonly="isUpdatingCipherKey"
v-bind:disable="isUpdatingCipherKey"
```

`OInput.types.ts` (`web/src/lib/forms/Input/OInput.types.ts:54`) declares `disabled?: boolean`. The `disable` prop is a Quasar holdover, will land as a fallthrough HTML attribute on the `<input>` element (which has no `disable` attribute — it has `disabled`), so disabled-state styling and `pointer-events: none` will not apply. `readonly` does work because OInput exposes it. The cosmetic impact is small (readonly already blocks edits), but the visual disabled treatment is lost during edit mode.

**Solution:**
```diff
  v-bind:readonly="isUpdatingCipherKey"
- v-bind:disable="isUpdatingCipherKey"
+ v-bind:disabled="isUpdatingCipherKey"
```

### L3. `maxLengthCharValidation` imported but never used

`web/src/components/cipherkeys/AddCipherKey.vue:182-185` imports `maxLengthCharValidation` from `@/utils/zincutils`, but `validateName()` now uses `formData.value.name.length > 50` inline. Dead import.

**Solution:**
```diff
- import { maxLengthCharValidation } from "@/utils/zincutils";
```

### L4. i18n keys referenced but missing

`web/src/components/cipherkeys/AddEncryptionMechanism.vue:27` and `:41` use:

```vue
:error-message="t('cipherKey.providerTypeRequired') || 'Provider type is required'"
:error-message="t('cipherKey.algorithmRequired') || 'Algorithm is required'"
```

`web/src/locales/languages/en.json:3447-3473` (the `cipherKey` block) does not contain `providerTypeRequired` or `algorithmRequired`. `t()` returns the key string when missing — that is truthy, so the `||` literal fallback is unreachable. Users will see literal text `cipherKey.providerTypeRequired` / `cipherKey.algorithmRequired` if these errors ever fire (currently masked by defaults, see C3).

**Solution:**
```diff
// In web/src/locales/languages/en.json under "cipherKey":
+ "providerTypeRequired": "Provider type is required",
+ "algorithmRequired": "Algorithm is required",
```

### L5. `AddEncryptionMechanism.vue` uses `frmData = ref(props.formData)` without v-model emit

`web/src/components/cipherkeys/AddEncryptionMechanism.vue:61` does `const frmData = ref(props.formData || {})`. Because objects are passed by reference, mutating `frmData.value.key.mechanism.type` mutates the parent's `formData` too — so it works for the current usage. But the template uses `v-model:formData` on the parent (`AddCipherKey.vue:127`), implying the child should emit `update:formData`. It never does. Today this is a latent issue, only surfacing if the child is rewritten with primitive bindings; flag for future maintainers.

**Solution:**
```diff
+ const emit = defineEmits(["update:formData"]);
- const frmData = ref(props.formData || {});
+ const frmData = computed({
+   get: () => props.formData,
+   set: (v) => emit("update:formData", v),
+ });
```

### L6. `OStep icon` props use migrated icon names

`AddCipherKey.vue:80` (`icon="edit"`) and `:124` (`icon="add"`) — both names exist in `web/src/lib/core/Icon/OIcon.icons.ts:325, 294`. OK.

**Solution:** No change required.

### L7. `addCipherKeyFormRef` ref kept but never assigned

`AddCipherKey.vue:204` declares `const addCipherKeyFormRef: any = ref();` but the surrounding `<q-form ref="addCipherKeyFormRef">` was replaced with a plain `<div>` (line 42-44). The ref now holds `undefined` forever. Spec at `AddCipherKey.spec.ts:569-589` still asserts `vm.addCipherKeyFormRef = { validate: vi.fn().mockResolvedValue(true) }` and expects `validate` to be called — those tests will silently no-op against the migrated code.

**Solution:**
```diff
- const addCipherKeyFormRef: any = ref();   // dead - no template ref binding
- // and drop from setup() return
```

## CSS / Layout Issues

### S1. Dead Quasar utility class `q-mt-md`

`web/src/components/cipherkeys/AddCipherKey.vue:63` — `class="q-mt-md"`. `app.scss` defines `q-w-*` aliases but does **not** define `q-mt-md`, `q-mb-md`, `q-mx-md`, `q-pa-md`, etc. (`grep` returns no matches). The 16px top margin intent is lost; layout shifts slightly compared to main.

**Solution:**
```diff
- class="q-mt-md"
+ class="tw:mt-4"
```

### S2. Dead CSS variable `--q-color-dark`

`web/src/components/cipherkeys/AddAkeylessType.vue:378-403` (`<style lang="scss">`) line 391:

```scss
legend {
  font-size: 12px;
  color: var(--q-color-dark);
  margin-left: 8px;
  padding: 0 4px;
}
```

`--q-color-dark` is no longer defined in `_quasar-variables.scss` or anywhere else. The `<legend>` text color silently becomes the browser default (inherits from parent). Recommend `color: currentColor` or a token from `_variables.scss`.

**Solution:**
```diff
  legend {
    font-size: 12px;
-   color: var(--q-color-dark);
+   color: var(--o2-text-primary);
    margin-left: 8px;
    padding: 0 4px;
  }
```

### S3. Unscoped global selectors leaking from cipher key components

`web/src/components/cipherkeys/AddAkeylessType.vue:377-404` and `AddEncryptionMechanism.vue:86-92` use `<style lang="scss">` (no `scoped`) — the rules `.cipher-keys-add-akeyless-type .q-field--labeled.showLabelOnTop .q-field__bottom`, `.q-fieldset`, `.pre-text`, `.cipher-keys-add-encryption-mechanism .q-field--labeled.showLabelOnTop .q-field__bottom` all leak into the global scope.

- The selectors target Quasar internals (`.q-field--labeled`, `.q-field__bottom`) that no longer render — purely dead.
- `.pre-text` and `.q-fieldset` are still hit by the local `<pre class="pre-text">` / `<fieldset class="q-fieldset …">`, so the visible styles still work, but applying them globally is risky for other pages with their own `.pre-text` or `.q-fieldset` users.

**Solution:**
```diff
- <style lang="scss">                            <!-- unscoped, leaks globally -->
- .cipher-keys-add-akeyless-type .q-field--labeled.showLabelOnTop .q-field__bottom { /* dead */ }
- .q-fieldset { /* leaks */ }
- .pre-text { /* leaks */ }
- </style>
+ <style lang="scss" scoped>                     <!-- add scoped -->
+ .cipher-keys-fieldset { /* renamed to avoid global collision */ }
+ .pre-text { /* now safely scoped */ }
+ </style>
```

### S4. Dead `.q-table { &__top { … } }` scoped block

`web/src/components/settings/CipherKeys.vue:473-480`:

```scss
<style lang="scss" scoped>
.q-table {
  &__top {
    border-bottom: 1px solid $border-color;
    justify-content: flex-end;
  }
}
</style>
```

Selector cannot match anything — the new template renders `OTable`, no `.q-table` class exists on the root. Safe to delete.

**Solution:**
```diff
- <style lang="scss" scoped>
- .q-table {
-   &__top { border-bottom: 1px solid $border-color; justify-content: flex-end; }
- }
- </style>
```

### S5. Mixed Tailwind `tw:` and Quasar-flavor utility classes — `showLabelOnTop`

`AddAkeylessType.vue:23, 34, 52, 74, 95, 114, 136, 157, 168, 177, 183` and `AddOpenobserveType.vue:23` keep `class="showLabelOnTop q-w-lg"`. `showLabelOnTop` has no CSS definition anywhere (`grep` returns no matches). Was a Quasar `<q-input stack-label>` companion class. Inert.

**Solution:**
```diff
- class="showLabelOnTop q-w-lg"
+ class="tw:w-72"
+ // (OInput already stacks label above field by default)
```

### S6. Inline `var(--navbar-height)` references

`AddCipherKey.vue:45, 63` — `var(--navbar-height)`. Verified that `_quasar-variables.scss:51` still emits `--navbar-height` on `:root`, so these still resolve. OK.

**Solution:** No change required.

### S7. Hard-coded color `#E1E1E1` for `.pre-text` borders

`AddAkeylessType.vue:399` and `AddOpenobserveType.vue:104` — `border: 1px solid #E1E1E1;` doesn't respect theme tokens (dark mode shows same light gray). Pre-existing on `main` but worth noting since UX revamp added dark-mode polish elsewhere.

**Solution:**
```diff
- border: 1px solid #E1E1E1;
+ border: 1px solid var(--o2-border-color);
```

### S8. `o2-search-input` icon slot mismatch on main vs HEAD

`CipherKeys.vue:35-37` — slot renamed from `#prepend` to `#icon-left` and `q-icon` → `OIcon`. Looks correct vs `OInput.types.ts:95`. OK.

**Solution:** No change required.

## Component Migration Issues

### M1. `q-checkbox`/select-all template removed — selection behavior moved to `OTable selection="multiple"`

CipherKeys.vue (HEAD) drops the custom `<template #header>` checkbox and `<template v-slot:body-selection>` from `main`, deferring entirely to `OTable selection="multiple" :selected-ids` + `@update:selected-ids`. The selection binding looks correct (`selectedKeyIds` computed maps `selectedKeys → ids` and `handleSelectedIdsUpdate` maps back). OK structurally — UX-test that select-all works and that the bottom toolbar `{{ selectedKeys.length }} selected` appears.

**Solution:** No change required — structural migration is correct.

### M2. Pagination behavior change

On `main`, pagination was a custom `QTablePagination` rendered in `#bottom` with `perPageOptions`. On HEAD, `OTable` owns pagination via `pagination="client"` + `:page-size="20"` + `:page-size-options="[20,50,100,250,500]"`. Looks correct; no `resultTotal` injection into footer (now derived by OTable). One side-effect: the `resultTotal` `ref` (line 208) and the `watch(visibleRows, …)` updater (line 392-394) are no longer used by the template — dead. Safe to remove.

**Solution:**
```diff
- const resultTotal = ref(0);
- watch(visibleRows, (n) => { resultTotal.value = n.length; });
```

### M3. Footer `selectedKeys.length` slot

`CipherKeys.vue:87-103` renders `#bottom` only when `selectedKeys.length > 0`. Combined with `OTable`'s own pagination footer this may stack two footers or hide pagination — verify visually. Code-wise the slot signature matches `OTableSlots.bottom` (props ignored).

**Solution:** Visual verification only — if footers stack, render selection toolbar above OTable as a sibling rather than inside `#bottom`.

### M4. `OStepper` API match

`AddCipherKey.vue:64-70` — uses `orientation="vertical"` (replaces Quasar `vertical`), `animated`, `navigable` (replaces `header-nav`). Matches `OStepper`'s known props per the design folder. OK.

**Solution:** No change required.

### M5. `OStep` icon when `done=true`

`OStep.types.ts:15-16` says the icon is replaced by a checkmark when `done` is true. The migrated `icon="edit"` / `icon="add"` only renders on the un-completed step. OK.

**Solution:** No change required.

### M6. Service layer untouched — CRUD calls unchanged

`web/src/services/cipher_keys.ts:50-67` exposes `create`, `update`, `list`, `get_by_name`, `delete`, `bulkDelete` — all referenced from `CipherKeys.vue` (`list:281, delete:333, bulkDelete:403`) and `AddCipherKey.vue` (`get_by_name:299, create:372, update:446`). No regressions in service wiring.

**Solution:** No change required.

## Test File Issues

### T1. `cipherKeyTestFixtures.ts:20` imports `Quasar` from removed dep

```ts
import { Quasar } from "quasar";
```

`Quasar` is imported but I can see (`grep`) it is **not used** anywhere in the file body. Dead import that will break test bootstrap if module resolution is strict. (Auditor instructions flagged this explicitly.)

Recommend deleting the line. Also delete the entire `createQuasarStubs()` block (`web/src/test/unit/fixtures/cipherKeyTestFixtures.ts:185-256`) — `QForm`/`QInput`/`QSelect`/`QBtn`/`QStepper`/`QStep`/`QStepperNavigation`/`QSeparator`/`QIcon`/`QFieldset` stubs are now stubs for components the page never renders, so the tests that consume them will not exercise the real `O*` components.

**Solution:**
```diff
- import { Quasar } from "quasar";
- export function createQuasarStubs() { return { QForm: ..., QInput: ..., /* etc */ }; }
+ export function createOStubs() { return { OInput: true, OSelect: true, OButton: true, OStepper: true, OStep: true, OTable: true }; }
```

### T2. `AddAkeylessType.spec.ts:20` still imports `QBtn, QFieldset, QInput, QSelect` from `"quasar"`

These are registered as `installQuasar({ plugins: [], components: [QInput, QSelect, QBtn, QFieldset] })`. With Quasar gone from deps, the import will throw. Even if it resolved (e.g., via a peer), the component now renders `OInput`/`OSelect`/`OButton`/`OFieldset` (well, raw `<fieldset class="q-fieldset">`) — the registered components are inert.

**Solution:**
```diff
- import { QBtn, QFieldset, QInput, QSelect } from "quasar";
- installQuasar({ plugins: [], components: [QInput, QSelect, QBtn, QFieldset] });
+ // Drop entirely — the component no longer uses Quasar.
```

### T3. `AddCipherKey.spec.ts` stubs `q-*` components the page no longer renders

`AddCipherKey.spec.ts:87-134` registers stubs for `q-separator`, `q-form`, `q-input`, `q-select`, `q-stepper`, `q-step`, `q-stepper-navigation`, `q-btn`. The page renders `OSeparator`, plain `<div>`, `OInput`, `OSelect`, `OStepper`, `OStep`, `OButton`. Assertions like `wrapper.find('.q-form-stub')` (lines 365, 630, 646), `wrapper.find('.q-stepper-stub')` (lines 182, 631, 647), `wrapper.findAll('.q-step-stub')` (line 648) will all fail.

Additionally, the test at line 588-589 mocks `addCipherKeyFormRef = { validate: vi.fn().mockRejectedValue(...) }` and expects `onSubmit` to call `validate()` — but the new `onSubmit` no longer touches `addCipherKeyFormRef`. The test passes vacuously (the spy is never invoked) but provides false coverage.

The `'OIcon'` stub at line 83-86 has stale, mismatched indentation — visible artifact of a partial migration.

**Solution:**
```diff
- global: { stubs: { "q-separator": true, "q-form": true, "q-input": true, "q-select": true, "q-stepper": true, "q-step": true, "q-stepper-navigation": true, "q-btn": true } }
+ global: { stubs: { OSeparator: true, OInput: true, OSelect: true, OStepper: true, OStep: true, OButton: true, OIcon: true } }
- wrapper.find(".q-form-stub")
+ wrapper.findComponent({ name: "OForm" })
```

### T4. `CipherKeys.spec.ts` mocks `useQuasar`, `QTable`/`QBtn`/`QInput`/`QIcon`/`QTh`/`QTr`/`QTd`

`CipherKeys.spec.ts:28-36` provides `vi.mock("quasar", … useQuasar: () => ({ notify })) — the component no longer calls `useQuasar()` or `$q.notify` (uses `toast()` from `@/lib/feedback/Toast/useToast`). The mock is dead.

`CipherKeys.spec.ts:151-238` stubs `QTable`/`QBtn`/`QInput`/`QIcon`/`QTh`/`QTr`/`QTd` — none of these are rendered by the migrated `CipherKeys.vue`. The component now renders `OTable`/`OButton`/`OInput`/`OIcon`. Any assertion that hits `[data-test-stub='q-table']` etc. will fail.

No mock or test covers `bulkDelete` even though the service uses it (`CipherKeys.vue:400-440`). Coverage gap.

**Solution:**
```diff
- vi.mock("quasar", () => ({ useQuasar: () => ({ notify }) }));
+ vi.mock("@/lib/feedback/Toast/useToast", () => ({ toast: vi.fn(), useToast: () => ({ toast: vi.fn(), dismiss: vi.fn() }) }));
+ // Add bulkDelete test:
+ it("bulkDelete calls service with selected ids", async () => {
+   const spy = vi.spyOn(CipherKeysService, "bulkDelete").mockResolvedValue({});
+   await wrapper.vm.bulkDeleteCipherKeys(["k1", "k2"]);
+   expect(spy).toHaveBeenCalledWith(expect.any(String), ["k1", "k2"]);
+ });
```

### T5. `AddOpenobserveType.spec.ts` and `AddEncryptionMechanism.spec.ts` cleaner but stale

These two specs do not import `quasar` directly (confirmed by grep). They rely on `createCipherKeyMountConfig` from the fixtures file, which in turn relies on the (broken) `createQuasarStubs()`. They will probably still mount, but the rendered tree contains real `OSelect`/`OTextarea` instances now, while the assertions only look at `[data-test=…]`, which still works for those that pass through.

`AddEncryptionMechanism.spec.ts:135, 145` contain dead comments referencing `QSelect`.

**Solution:**
```diff
- // QSelect test — verifies q-select renders provider options
+ // OSelect test — verifies provider options render
```

## Recommendations

Priority order:

1. **Wire the missing validations into `AddCipherKey.vue onSubmit()`** (C1 + C2 + C3):
   - Add `ref` to `AddAkeylessType`, `AddOpenobserveType`, `AddEncryptionMechanism` from the parent.
   - Expose `validateAkeylessFields()` on Akeyless (already done) and add equivalents `validateOpenobserveFields()` / `validateEncryptionMechanism()` to the other two.
   - In `onSubmit`, call all three child validators conditionally and short-circuit on failure, the same way Quasar's `qForm.validate()` chained `:rules` previously.
2. **Add missing i18n keys** `cipherKey.providerTypeRequired` and `cipherKey.algorithmRequired` to `web/src/locales/languages/en.json` and every sibling language file (L4).
3. **Fix the back-button** in `AddCipherKey.vue:20-28`: drop `no-caps`, `padding="xs"`, `outline`, `icon="arrow_back_ios_new"`; tidy indentation; consider replacing the `<div>` with `<OButton variant="ghost" size="icon-sm">` for accessibility (currently it has no role/aria, only `@click`).
4. **Switch `:disable` → `disabled`** on the name `OInput` (`AddCipherKey.vue:54`) (L2).
5. **Remove dead Quasar artifacts** in templates and styles:
   - `class="q-mt-md"` (`AddCipherKey.vue:63`).
   - Dead `.q-table { &__top { … } }` scoped block (`CipherKeys.vue:473-480`).
   - `var(--q-color-dark)` → use `var(--o2-text-primary)` or `currentColor` (`AddAkeylessType.vue:391`).
   - `showLabelOnTop` class everywhere (no CSS).
   - Unused import `maxLengthCharValidation` (`AddCipherKey.vue:184`).
   - Dead refs `addCipherKeyFormRef` (line 204) and the standalone `resultTotal` + watcher (now redundant under OTable client pagination, lines 208, 392-394).
6. **Re-write the spec files** against the `O*` API:
   - Remove `import { Quasar } from "quasar"` from `cipherKeyTestFixtures.ts:20` and the `createQuasarStubs()` block.
   - Remove `import { QBtn, … } from "quasar"` from `AddAkeylessType.spec.ts:20`.
   - In `AddCipherKey.spec.ts` and `CipherKeys.spec.ts`, replace `q-*` stubs with `O*` stubs (or just unmount-mount integration tests against real components with vue-test-utils' `shallow: false`), and update all assertions targeting `.q-*-stub` classes.
   - Drop the `useQuasar` mock in `CipherKeys.spec.ts:28-36`.
   - Add a unit test for `bulkDeleteCipherKeys` (uncovered).
   - Delete the `validate()`-spy tests in `AddCipherKey.spec.ts:561-590` which no longer apply, and add coverage for the new `validateName()` / `validateStoreType()` paths.
7. **Verify visually** that the dual-`#bottom` slot (selection chip + OTable's built-in pagination footer) renders correctly (M3) and that "Continue" navigation in step 1 still triggers validation feedback for empty `name`/`type` (the inline error messages flow through the new error refs).
8. **Scope the global SCSS** in `AddAkeylessType.vue` and `AddEncryptionMechanism.vue` (add `scoped` once the `.q-field*` selectors are removed) (S3).

## Class-Level Styling Audit

### 1. Quasar Class Leftovers
| File:Line | Class | Replacement | Layer |
|---|---|---|---|
| CipherKeys.vue:24 | `q-table__title` | `tw:text-base tw:font-semibold` | file-scoped |
| CipherKeys.vue:474 | `.q-table` selector | remove dead | file-scoped |
| AddCipherKey.vue:63 | `q-mt-md` (Quasar margin token) | `tw:mt-4` | file-scoped |
| AddAkeylessType.vue:42 | `q-field` | drop (replaced by OInput) | file-scoped |
| AddAkeylessType.vue:61 | `q-fieldset q-w-lg` | scoped `.cipher-fieldset` class | file-scoped |
| AddAkeylessType.vue:82 | `q-field` | drop | file-scoped |
| AddAkeylessType.vue:103 | `q-field` | drop | file-scoped |
| AddAkeylessType.vue:124 | `q-field` | drop | file-scoped |
| AddAkeylessType.vue:145 | `q-fieldset q-w-lg` | scoped class | file-scoped |
| AddAkeylessType.vue:379 | `.q-field--labeled.showLabelOnTop .q-field__bottom` | remove dead selector | file-scoped |
| AddAkeylessType.vue:383 | `.q-fieldset` selector | remove dead | file-scoped |
| AddEncryptionMechanism.vue:88 | `.q-field--labeled.showLabelOnTop .q-field__bottom` | remove dead | file-scoped |
| AddOpenobserveType.vue:31 | `q-field` | drop | file-scoped |

### 2. Tailwind v4 Misuse
| File:Line | Wrong | Right | Layer |
|---|---|---|---|
| *(none found)* | | | |

### 3. Quasar CSS Variables
| File:Line | Variable | Replacement | Layer |
|---|---|---|---|
| AddAkeylessType.vue:391 | `var(--q-color-dark)` | `var(--o2-text-primary)` | file-scoped |

### 4. Dead `:deep(.q-*)` / `body.body--dark` / `::v-deep`
| File:Line | Selector | Action | Layer |
|---|---|---|---|
| AddAkeylessType.vue:379 | `.q-field--labeled.showLabelOnTop .q-field__bottom` | remove | file-scoped |
| AddEncryptionMechanism.vue:88 | same | remove | file-scoped |

### 5. Quasar SCSS Variables in Scoped Styles
| File:Line | Variable | Replacement | Layer |
|---|---|---|---|
| CipherKeys.vue:476 | `$border-color` | `var(--o2-border)` | file-scoped |

### 6. Quasar Directives
| File:Line | Directive | Action |
|---|---|---|
| *(none found)* | | |

### 7. Icon Migration
| File:Line | Issue | Fix |
|---|---|---|
| *(none found)* | | |

### 8. Inline `style=` Hot Spots
| File:Line | Inline style | Suggested home |
|---|---|---|
| AddCipherKey.vue:17 | `min-height:inherit` | drop or scoped class |
| AddCipherKey.vue:45 | `height: calc(100vh - var(--navbar-height) - 155px); overflow:auto` | scoped `.cipher-form-scroll` class |
| AddCipherKey.vue:63 | `height: calc(100vh - var(--navbar-height) - 300px);` | scoped class |
| AddCipherKey.vue:144 | `position:sticky; bottom:0px; z-index:2` | scoped `.cipher-form-footer` class |

### 9. Duplicate Style Blocks
| Files | Duplicated block | Suggested partial |
|---|---|---|
| AddAkeylessType.vue:42,82,103,124 / AddOpenobserveType.vue:31 | repeated `class="tw:flex q-field tw:mb-3"` field labels | extract `.cipher-field-label` partial after dropping `q-field` |
| AddAkeylessType.vue:379 / AddEncryptionMechanism.vue:88 | identical `.q-field--labeled.showLabelOnTop .q-field__bottom` dead block | delete from both files |

### 10. Layer Summary
- Global (`app.scss`) changes needed: 0
- Component-level partial changes: 1 (`.cipher-field-label` shared between AddAkeylessType + AddOpenobserveType)
- File-level scoped changes: ~17 (13 q-* leftovers, 1 var, 1 SCSS var, 4 inline styles)
