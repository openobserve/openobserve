# Action Scripts Page — Quasar Removal Audit

## Summary

Branch: `feat/ux-revamp-main` (HEAD) vs `main`. The Action Scripts surface was
migrated from Quasar primitives (`q-table`, `q-input`, `q-dialog`, `q-icon`,
`q-form`, `q-select`, `q-circular-progress`, etc.) to the in-house O* library
(`OTable`, `OInput`, `ODialog`, `OIcon`, `OForm`, `OSelect`, `OSpinner`,
`OStepper/OStep`, `OFile`, `OTooltip`, `OButton`). Toasts moved from
`$q.notify` to the local `toast()` helper. The runtime page/list works, but
several **dead-code branches were carried over** from `main`, a few **API
mistakes** were introduced during the rewrite (string-vs-number props,
`hover:tw:` order, Quasar palette classes, `tw:full-width`, `tw:mr-md`), and
the **spec files still hard-import Quasar** and assert on element names
(`q-input-stub`, `q-icon`, `.q-stepper`) that no longer exist in the new
templates. Monaco integration in `ScriptEditor.vue` is unaffected (lazy-loads
`CodeQueryEditor.vue`).

## Files Audited

- `/Users/ktx/Documents/Projects/openobserve.worktrees/ux-revamp/web/src/views/ActionScript.vue`
- `/Users/ktx/Documents/Projects/openobserve.worktrees/ux-revamp/web/src/views/ActionScript.spec.ts`
- `/Users/ktx/Documents/Projects/openobserve.worktrees/ux-revamp/web/src/components/actionScripts/ActionScripts.vue`
- `/Users/ktx/Documents/Projects/openobserve.worktrees/ux-revamp/web/src/components/actionScripts/ActionScripts.spec.ts`
- `/Users/ktx/Documents/Projects/openobserve.worktrees/ux-revamp/web/src/components/actionScripts/EditScript.vue`
- `/Users/ktx/Documents/Projects/openobserve.worktrees/ux-revamp/web/src/components/actionScripts/EditScript.spec.ts`
- `/Users/ktx/Documents/Projects/openobserve.worktrees/ux-revamp/web/src/components/actionScripts/FileItem.vue`
- `/Users/ktx/Documents/Projects/openobserve.worktrees/ux-revamp/web/src/components/actionScripts/FileItem.spec.ts`
- `/Users/ktx/Documents/Projects/openobserve.worktrees/ux-revamp/web/src/components/actionScripts/ScriptEditor.vue`
- `/Users/ktx/Documents/Projects/openobserve.worktrees/ux-revamp/web/src/components/actionScripts/ScriptEditor.spec.ts`
- `/Users/ktx/Documents/Projects/openobserve.worktrees/ux-revamp/web/src/components/actionScripts/ScriptToolbar.vue`
- `/Users/ktx/Documents/Projects/openobserve.worktrees/ux-revamp/web/src/components/actionScripts/ScriptToolbar.spec.ts`

## Critical Issues

### 1. `OSelect` for service account is broken at runtime
`web/src/components/actionScripts/EditScript.vue` lines 359-376 vs lines
1095-1133.

- The select declares `labelKey="label" valueKey="value"`, implying
  `{label, value}` objects.
- But `serviceAccountsOptions` is populated with **plain strings**
  (`account.email`) at line 1117:
  `serviceAccountsOptions.push(...res.data.data.map((account: any) => account.email));`
  and copied verbatim into `filteredServiceAccounts` at line 1119.
- Strings have no `.label`/`.value` properties, so the dropdown will render
  empty rows and writing to `v-model="formData.service_account"` will store
  `undefined`. Step 3 "Select Service Account" is effectively unusable.
- The inline `@search` handler at lines 370-374 also calls
  `s.label.toLowerCase()`, throwing on first keystroke for the same reason.

**Solution:**
```diff
- serviceAccountsOptions.push(...res.data.data.map((account: any) => account.email));
+ serviceAccountsOptions.push(...res.data.data.map((account: any) => ({
+   label: account.email, value: account.email,
+ })));
  filteredServiceAccounts.value = [...serviceAccountsOptions];
- @search="(val) => filteredServiceAccounts.value = serviceAccountsOptions.filter(s => s.label.toLowerCase().includes(val.toLowerCase()))"
+ @search="(val) => filteredServiceAccounts.value = serviceAccountsOptions.filter(s => s.label.toLowerCase().includes((val ?? '').toLowerCase()))"
```

### 2. `submitForm` and `showForm` are referenced but never defined
`web/src/components/actionScripts/ActionScripts.vue` lines 158-205.

The cloned `ODialog` block references `showForm` (`v-model:open`,
`@click:secondary`, header back button click) and `submitForm`
(`@click:primary`, `@submit` on `OForm`). Neither symbol exists in the
`setup()` return (search confirms no declaration in the file). This is
**dead code carried over from `main`** — Vue dev mode will log
"Property … was accessed during render but is not defined". The dialog can
never be opened because nothing flips a flag to `true`, so the run-time
impact is limited to template warnings, but the entire 50-line clone-dialog
block plus the unused refs (`toBeCloneAlertName`, `toBeCloneUUID`,
`toBeClonestreamType`, `toBeClonestreamName`, `streamTypes`, `streamNames`,
`isFetchingStreams`, `isSubmitting`, `updateStreams`, `updateStreamName`,
`filterStreams`, `filterColumns`, `streams`, `schemaList`, `indexOptions`,
`toBeClonedAlert`) should be removed.

**Solution:**
```diff
- <ODialog v-model:open="showForm" ...>  <!-- 50-line dead clone-dialog block -->
- ...
- @click:primary="submitForm" />
- // and remove all the dead refs from setup()
```

### 3. `tw:full-width` is not a Tailwind utility
`web/src/components/actionScripts/ActionScripts.vue` line 36.

`full-width` is a **Quasar** utility class (`width: 100% !important`).
Tailwind v4 with the `tw:` prefix has no `full-width` — the class is silently
dropped. Other layout utilities on the same element keep it from collapsing,
but the intent was lost. Replace with `tw:w-full`.

**Solution:**
```diff
- class="... tw:full-width ..."
+ class="... tw:w-full ..."
```

### 4. `tw:mr-md` is not a valid Tailwind utility
`web/src/components/actionScripts/ActionScripts.vue` line 113.

`mr-md` is the **Quasar** spacing token (16 px). Tailwind expects a numeric
scale (`tw:mr-4` etc.). The class is dropped at build time, so the table
footer "X Actions" label sits flush against the bulk-delete button.

**Solution:**
```diff
- class="... tw:mr-md ..."
+ class="... tw:mr-4 ..."
```

### 5. `hover:tw:bg-gray-200` is in the wrong order
`web/src/components/actionScripts/FileItem.vue` line 3.

With Tailwind v4 + the `tw:` prefix, the prefix comes first
(`tw:hover:bg-gray-200`). The current form is a no-op — file items lose
their hover affordance. Compare correct usage in
`web/src/lib/forms/DateTimeRange/ODateRangeCalendar.vue` line 85
(`tw:hover:bg-...`).

**Solution:**
```diff
- class="... hover:tw:bg-gray-200 ..."
+ class="... tw:hover:bg-gray-200 ..."
```

### 6. `text-red-5` / `text-red-7` are Quasar palette classes
`web/src/components/actionScripts/ScriptToolbar.vue` line 46.

Quasar's `$colors.red-5/-7` no longer compile (the SCSS map is gone with the
framework removal). The validation icon next to the script-name input loses
its red color — it falls back to inherited text color, so invalid action
names look identical to valid ones at a glance. Replace with
`tw:text-red-500` / `tw:text-red-700`.

**Solution:**
```diff
- class="... text-red-5 ..."
+ class="... tw:text-red-500 ..."
- class="... text-red-7 ..."
+ class="... tw:text-red-700 ..."
```

### 7. `text-weight-bold` is a Quasar utility
`web/src/components/actionScripts/ScriptEditor.vue` line 12.

Quasar shipped `.text-weight-bold { font-weight: 700 }`. Removed. The
"Loading…" label in the script editor toolbar reverts to the default weight.
Replace with `tw:font-bold`.

**Solution:**
```diff
- class="... text-weight-bold ..."
+ class="... tw:font-bold ..."
```

### 8. `bg-primary` (Quasar palette) on active file
`web/src/components/actionScripts/FileItem.vue` line 5.

`bg-primary` was a Quasar Sass-injected class. With the framework gone the
class is undefined, so a selected file in the script tree no longer turns
blue — the only feedback that a file is active is the `tw:text-white` text
color (which on a transparent background can render as low-contrast white on
white). Use a defined token like `tw:bg-primary-600` or
`tw:bg-[var(--color-primary)]`.

**Solution:**
```diff
- :class="{ 'bg-primary text-white': active }"
+ :class="{ 'tw:bg-[var(--o2-primary)] tw:text-white': active }"
```

### 9. `v-close-popup="true"` directive is unregistered
`web/src/components/actionScripts/ScriptToolbar.vue` line 56.

`v-close-popup` was a Quasar directive registered globally. The new shell
does not register it (`grep` across `web/src` only finds it in the legacy
migration `.md` doc). Vue will warn `Failed to resolve directive: close-popup`
in dev. Behaviour: the Fullscreen button still emits `@click`, but the stale
directive should be removed.

**Solution:**
```diff
- <OButton v-close-popup="true" ...>
+ <OButton ...>
```

## Logical Issues

### 10. Cron `debounce="300"` is a string, OInput expects a number
`web/src/components/actionScripts/EditScript.vue` line 282.

`OInput.types.ts:58` declares `debounce?: number`. Passing the string
`"300"` skips type-coercion (no `:` binding), so the v-model update is
**not debounced**. Live cron validation fires on every keystroke. Replace
with `:debounce="300"`.

**Solution:**
```diff
- <OInput debounce="300" ... />
+ <OInput :debounce="300" ... />
```

### 11. `OSelect @search` payload signature mismatch
`web/src/components/actionScripts/EditScript.vue` lines 370-374.

The handler accepts only `(val: string)` but OSelect's search event
(based on the rest of the codebase pattern) typically emits richer payloads.
The handler also assigns to `filteredServiceAccounts.value` — which is fine
— but does so on every keystroke without a debounce.

**Solution:**
```diff
- <OSelect ... @search="(val) => filteredServiceAccounts.value = ..." />
+ <OSelect ... :search-debounce="200" @search="(val: string) => { filteredServiceAccounts.value = serviceAccountsOptions.filter(s => s.label.toLowerCase().includes((val ?? '').toLowerCase())); }" />
```

### 12. Step 1 "Continue" doesn't actually validate the ZIP upload
`web/src/components/actionScripts/EditScript.vue` lines 178-186.

`@click="step++"` advances unconditionally. `validateActionScriptData()`
sends the user back to step 1 only when **saving**, not when moving forward.
A user can race through every step with an empty ZIP and only learn about
it at the final "Save" click. Old behaviour was similar but at least the
old Quasar stepper showed required-field errors via `q-step --error`. The
new `OStep` doesn't expose an error state from the template.

**Solution:**
```diff
- @click="step++"
+ @click="() => { if (!formData.value.zipFile) { zipError.value = 'ZIP file is required'; return; } step++; }"
```

### 13. `formData` is not deep-typed
`web/src/components/actionScripts/EditScript.vue` line 572.

`const formData = ref(defaultActionScript);` inherits the literal-type of
`defaultActionScript` for narrow keys (e.g. `frequency.type` becomes
`"repeat"` because that's the seed value), so any later assignment of
`"once"` will TypeScript-error. The component currently compiles only
because `<script setup>` doesn't surface these as build errors on `any`
fall-through, but it makes refactoring brittle.

**Solution:**
```diff
+ interface ActionScriptFormData { name: string; frequency: { type: "repeat" | "once" }; /* ... */ }
- const formData = ref(defaultActionScript);
+ const formData = ref<ActionScriptFormData>({ ...defaultActionScript });
```

### 14. Toast `dismiss()` not invoked on the success path of `saveActionScript`
`web/src/components/actionScripts/EditScript.vue` lines 845-882.

`dismiss()` is called only in the `.finally(() => dismiss())` block — that
part is fine. However, the loading toast itself uses `timeout: 2000` (line
848). The combination means the toast auto-dismisses after 2 s even while
the upload is still pending. The previous Quasar implementation passed
`spinner: true` with no timeout (sticky). Either drop the `timeout` or
move it to `0`.

**Solution:**
```diff
  const { dismiss } = toast({
    variant: "loading",
    message: "Saving action script...",
-   timeout: 2000,
+   timeout: 0,
  });
```

### 15. Inline validators are scattered
`web/src/components/actionScripts/EditScript.vue` lines 76-80, 109, 284-287,
369, 822-835.

Name / type / cron / service-account validation lives both in
`@update:model-value` handlers on each field **and** is re-checked inside
`saveActionScript`. Two sources of truth — easy for them to drift, and
there's no central rules object the way the Alert form has.

**Solution:**
```diff
+ // Centralize all validators in a single ref:
+ const rules = {
+   name: (v: string) => !!v && isValidResourceName(v) || "Invalid name",
+   cron: (v: string) => !v || isValidCronExpression(v) || "Invalid cron",
+   serviceAccount: (v: string) => !!v || "Service account required",
+ };
+ const validate = () => Object.entries(rules).every(([k, fn]) => fn(formData.value[k]) === true);
```

### 16. `isValidMethodName()` is invoked from `v-if`
`web/src/components/actionScripts/ScriptToolbar.vue` line 42.

`v-if="isValidMethodName() !== true && showInputError"` runs the regex
test on every re-render. Cheap, but it's also called from the computed
`scriptNameError` (line 117) and twice more from `OTooltip :content` (line
48). Hoist to a `computed` to avoid three calls per keystroke.

**Solution:**
```diff
+ const isMethodNameValid = computed(() => isValidMethodName() === true);
- v-if="isValidMethodName() !== true && showInputError"
+ v-if="!isMethodNameValid && showInputError"
```

### 17. `cancelUploadingNewFile` throws if `originalActionScriptData` is empty
`web/src/components/actionScripts/EditScript.vue` lines 1028-1032.

If the user reaches the screen via the "add" route, `originalActionScriptData`
is set to `JSON.stringify(formData.value)` (line 1091), which does not
contain `zip_file_name`. The "Cancel upload" button on the edit-mode
fast-path attempts `JSON.parse(originalActionScriptData.value).zip_file_name`
and assigns `undefined` to `formData.value.fileNameToShow`, hiding the
filename without warning.

**Solution:**
```diff
  const cancelUploadingNewFile = () => {
-   formData.value.fileNameToShow = JSON.parse(originalActionScriptData.value).zip_file_name;
+   const original = originalActionScriptData.value ? JSON.parse(originalActionScriptData.value) : {};
+   formData.value.fileNameToShow = original.zip_file_name ?? formData.value.fileNameToShow;
  };
```

## CSS / Layout Issues

### 18. View file still has Quasar selectors in `<style scoped>`
`web/src/views/ActionScript.vue` lines 43-75.

The `<style scoped lang="scss">` block targets `.q-table`, `.q-tabs`,
`.q-tab`. None of these elements exist in the new template (it only renders
a `<div>` and `<RouterView />`). Whole block is dead. Also references the
SCSS variables `$border-color` and `$accent` which still exist, but the
selectors will never match.

**Solution:**
```diff
- <style scoped lang="scss">
- .q-table { /* ... */ }
- .q-tabs { /* ... */ }
- .q-tab { /* ... */ }
- </style>
```

### 19. `:deep(.q-field__...)` selectors orphaned
- `web/src/components/actionScripts/EditScript.vue` lines 1142, 1148 —
  `.lookup-table-file-uploader :deep(.q-field__label)` and
  `.service-account-selector :deep(.q-field__control-container .q-field__native > :first-child)`.
- `web/src/components/actionScripts/ScriptToolbar.vue` lines 158, 163 —
  `:deep(.q-field__bottom)` and `:deep(.block)`.

Quasar's `q-field__*` class names are gone (OInput/OSelect use their own
DOM). Wrapper class `.lookup-table-file-uploader` is also not present in
the template. All `:deep` blocks should be deleted or rewritten against
the new O\* DOM.

**Solution:**
```diff
- .lookup-table-file-uploader :deep(.q-field__label) { /* ... */ }
- .service-account-selector :deep(.q-field__control-container .q-field__native > :first-child) { /* ... */ }
- :deep(.q-field__bottom) { /* ... */ }
- :deep(.block) { /* ... */ }
- // Delete all dead Quasar internal selectors
```

### 20. `card-container tw:h-[calc(100vh-124px)]` overflows
`web/src/components/actionScripts/ActionScripts.vue` line 59.

The wrapper hardcodes 124 px subtraction, but the parent already adds
`tw:pt-1 tw:pb-[0.625rem]` and a 68 px header card with its own margin
(`tw:mb-[0.625rem]`). Total chrome ≈ 68 + 10 + 4 + 10 = 92 px, so 124 px
over-subtracts by ~32 px — the table is shorter than necessary and never
fills the visible area. The earlier Quasar version computed height from
`var(--navbar-height)` (see diff hunk).

**Solution:**
```diff
- class="card-container tw:h-[calc(100vh-124px)]"
+ class="card-container tw:h-[calc(100vh-var(--navbar-height)-92px)]"
```

### 21. Duplicate / always-equal `:class` ternaries
`web/src/components/actionScripts/EditScript.vue` lines 251-254, 344-348.

Both branches yield the same class string `'tw:text-gray-400'`. The ternary
on `store.state.theme === 'dark'` is dead.

**Solution:**
```diff
- :class="store.state.theme === 'dark' ? 'tw:text-gray-400' : 'tw:text-gray-400'"
+ class="tw:text-gray-400"
```

### 22. `clone-alert-popup` style is orphaned
`web/src/components/actionScripts/ActionScripts.vue` line 858 of the
`<style lang="scss">` block.

`.clone-alert-popup { width: 400px; }` no longer matches anything — the
template moved to `ODialog`.

**Solution:**
```diff
- .clone-alert-popup { width: 400px; }
```

### 23. SCSS block for `.alerts-tabs .o-tabs` is dead
`web/src/components/actionScripts/ActionScripts.vue` lines 830-857.

The template renders no `.alerts-tabs` wrapper or `.o-tabs` elements;
this block is leftover from the Quasar vertical-tab layout. Pure
dead code.

**Solution:**
```diff
- .alerts-tabs .o-tabs { /* 28 lines */ }
```

## Component Migration Issues

### 24. Many unused imports in `ActionScripts.vue`
`web/src/components/actionScripts/ActionScripts.vue` imports that no longer
reference anything in the template or script:
- `alertsService` (line 225)
- `destinationService` (line 226)
- `templateService` (line 227)
- `useStreams` / `getStreams` (line 222, 316) — only used by the dead
  clone dialog path
- `OCheckbox` (line 247) — checkbox column is handled by `OTable selection`
- `OTooltip` (line 248) — never used in this file's template
- `OForm` (line 250) — only used by the dead clone dialog
- `OSpinner` (line 245) — actually used at line 87

**Solution:**
```diff
- import alertsService from "...";
- import destinationService from "...";
- import templateService from "...";
- import { useStreams } from "...";
- import OCheckbox from "...";
- import OTooltip from "...";
- import OForm from "...";
```

### 25. Unused imports in `EditScript.vue`
`web/src/components/actionScripts/EditScript.vue`:
- `DateTime` (line 499)
- `VariablesInput` (line 507)
- `dashboardService` (line 509)
- luxon `DateTime as _DateTime` (line 512)
- `convertDateToTimestamp` (line 516) — referenced only inside comments
- `filterServiceAccounts` (line 1100) — defined but never wired up

**Solution:**
```diff
- import DateTime from "...";
- import VariablesInput from "...";
- import dashboardService from "...";
- import { DateTime as _DateTime } from "luxon";
- import { convertDateToTimestamp } from "...";
- const filterServiceAccounts = (...) => { /* dead */ };
```

### 26. `serviceAccountsOptions` typed as `any[]` instead of `string[]`
`web/src/components/actionScripts/EditScript.vue` line 1108.

If this had been typed correctly, the `labelKey/valueKey` mistake in issue
#1 would have been caught at compile time.

**Solution:**
```diff
- const serviceAccountsOptions = ref<any[]>([]);
+ const serviceAccountsOptions = ref<{ label: string; value: string }[]>([]);
```

### 27. `OTooltip` placed as sibling rather than child of trigger
`web/src/components/actionScripts/EditScript.vue` lines 246-273 and
340-357.

`<OIcon … />` is self-closing, then `<OTooltip>` follows as a sibling. The
tooltip's "child mode" (no default slot) attaches hover handlers to the
**parent element** of its anchor span — which is the surrounding `<div>`,
not the icon. The tooltip will trigger anywhere over the whole title row
("Cron Expression *" + icon), which is wider than intended. Either nest
the tooltip inside the OIcon's default slot (the slot exists per
`OIcon.vue:36`) or wrap the trigger explicitly in OTooltip's default slot.

The ScriptToolbar usage (lines 47-49) does this correctly: tooltip is a
child of OIcon.

**Solution:**
```diff
- <OIcon name="info" size="sm" />
- <OTooltip :content="..." />
+ <OIcon name="info" size="sm">
+   <OTooltip :content="..." />
+ </OIcon>
```

### 28. `OStepper` `done` flag tied to `step > N` invariant
`web/src/components/actionScripts/EditScript.vue` lines 125, 195, 330, 401.

Each step uses `:done="step > N"`. When the user jumps backwards via the
"Back" button, the step that becomes current still shows `done` if the
user had progressed past it before. Visually OK, but logically `done`
should be `step > N && noErrorsForStepN`. Currently the stepper never
reflects unresolved validation.

**Solution:**
```diff
- :done="step > 1"
+ :done="step > 1 && !zipError"
- :done="step > 2"
+ :done="step > 2 && !nameError && !typeError"
```

### 29. `OTable` `:default-columns="false"` paired with `:columns`
`web/src/components/actionScripts/ActionScripts.vue` lines 60-75.

`:default-columns="false"` tells OTable to skip the auto-generated row-
index column. Fine, but the user is also defining their own `#` column
with `accessorKey: "#"`, which renders a *second* row-number column. The
"#" sort behaviour will treat the values as strings (`"01"…"09"`, then
`10` as number) because line 444 does
`counter <= 9 ? \`0${counter++}\` : counter++` — mixing string and number
in the same column trips natural-sort. Either always pad or always emit
numbers.

**Solution:**
```diff
- counter <= 9 ? `0${counter++}` : counter++
+ counter++   // always number, OTable column meta.type: "number" for sort
```

### 30. Loading toast in `ActionScripts.vue` `getActionScripts` lacks a `timeout`
`web/src/components/actionScripts/ActionScripts.vue` lines 419-422.

The new `toast({ variant: "loading", message: ... })` call doesn't pass a
timeout — that's intentional sticky behaviour. However the catch block at
lines 479-484 doesn't invoke `dismiss()` before showing the error toast,
so the user briefly sees both stacked. Move `dismiss()` before the error
toast.

**Solution:**
```diff
  .catch((err) => {
+   dismiss();
    toast({ variant: "error", message: err.message });
- });
+ });
```

## Test File Issues

### 31. Every spec still hard-imports Quasar
- `EditScript.spec.ts:19` — `import * as quasar from "quasar";`
- `ActionScripts.spec.ts:19` — same.

The codebase has dropped Quasar from runtime, but the package may still be
in `devDependencies` so these imports might not break the build. If Quasar
has actually been removed from `package.json`, these tests fail at module
resolution.

**Solution:**
```diff
- import * as quasar from "quasar";
```

### 32. `installQuasar()` still called
- `EditScript.spec.ts:69`
- `ActionScripts.spec.ts:38`
- `FileItem.spec.ts:6` (after diff)
- `ScriptEditor.spec.ts:14` (after diff)
- `ScriptToolbar.spec.ts:15`

The shim at `@/test/unit/helpers/install-quasar-plugin` is still in tree
but does nothing useful for components that no longer use Quasar. If the
helper itself depends on the `quasar` npm package, every spec breaks.

**Solution:**
```diff
- import { installQuasar } from "@/test/unit/helpers/install-quasar-plugin";
- installQuasar();
+ // Drop entirely if the component no longer uses Quasar.
```

### 33. ScriptToolbar.spec.ts asserts on stubs that don't exist
`web/src/components/actionScripts/ScriptToolbar.spec.ts` lines 80-103,
131, 139, 166, 322.

The template now renders `OInput`, `OButton`, `OIcon` — but the test
stubs `q-input`, `q-btn`, `q-form`, `q-tooltip` and then searches for
`.q-input-stub` and `.q-btn-stub`. These selectors will not match;
**every assertion that depends on them will fail**.

Line 126 also does `expect(backBtn.classes()).toContain('cursor-pointer')`,
but the new template emits the Tailwind-prefixed class
`tw:cursor-pointer`. The unprefixed class never appears.

**Solution:**
```diff
- wrapper.find(".q-input-stub")
+ wrapper.findComponent({ name: "OInput" })
- wrapper.find(".q-btn-stub")
+ wrapper.findComponent({ name: "OButton" })
- expect(backBtn.classes()).toContain('cursor-pointer');
+ expect(backBtn.classes()).toContain('tw:cursor-pointer');
```

### 34. EditScript.spec.ts references `q-stepper`
`web/src/components/actionScripts/EditScript.spec.ts` line 194:
`wrapper.find('[data-cy="stepper"], q-stepper, .q-stepper')` — the new
template renders `OStepper`, no `q-stepper` element or `.q-stepper` class
exists. Test will always fail this assertion.

Line 182 / 185: `wrapper.find("form")` — `OForm` was removed from
`EditScript.vue` entirely (no `<OForm>` or `<form>` element renders),
so this assertion fails too. The template uses standalone fields, no
form element wraps them.

**Solution:**
```diff
- wrapper.find('[data-cy="stepper"], q-stepper, .q-stepper')
+ wrapper.findComponent({ name: "OStepper" })
- wrapper.find("form")
+ wrapper.findAll('[data-test^="action-script-field-"]')
```

### 35. ActionScripts.spec.ts asserts ODialog migration props
`web/src/components/actionScripts/ActionScripts.spec.ts` lines 947-1014.

This block is new (added in the diff) and tests `ODialog` props. The tests
all mount the cloned-dialog block, but as noted in critical issue #2, the
clone-dialog block is dead code with undefined refs. The ODialog stub
might silently render anyway, but if the dialog ever runs in real Vue
(not stubbed) you'll get the undefined-ref warnings noted above.

**Solution:** Delete the whole "ODialog props" test block once the dead clone-dialog template is removed (see Critical Issue #2).

### 36. ActionScript.spec.ts:58 still asserts "q-page wrapper"
`web/src/views/ActionScript.spec.ts` line 58.

Test title says "should have q-page wrapper" but the new template renders
a plain `<div>`. The test body now just checks the `data-test` attribute
(line 68), which still passes — but the **test title lies** about what it
verifies. Rename to "should have outer wrapper" for honesty.

**Solution:**
```diff
- it("should have q-page wrapper", () => { ... });
+ it("should have outer wrapper", () => { ... });
```

### 37. `FileItem.spec.ts` stubs `OIcon: true` but asserts on `OIcon-stub`
`web/src/components/actionScripts/FileItem.spec.ts` lines 31, 67-72, 289.

With Vue Test Utils, `stubs: { OIcon: true }` generates a stub named
`<o-icon-stub>` (kebab-cased lowercase). The assertions use
`wrapper.find("OIcon-stub")` (camel-case) which will not match. Same for
the `.file-actions .OIcon` selector on line 289 — actual DOM class would
be `o-icon-stub`, not `OIcon`.

**Solution:**
```diff
- wrapper.find("OIcon-stub")
+ wrapper.find("o-icon-stub")
- wrapper.find(".file-actions .OIcon")
+ wrapper.find(".file-actions o-icon-stub")
```

## Validation Issues

### 38. Action name validation regex differs from server
`web/src/components/actionScripts/EditScript.vue` line 78
(`isValidResourceName`) — disallows `: ? / # ` (plus space).
`web/src/components/actionScripts/ScriptToolbar.vue` line 125 — uses
`/^[A-Z_][A-Z0-9_]*$/i` (Python-method-style).

Two name validations for the same domain ("action script"). The ScriptToolbar
form is the inline runtime-script editor for a single file's method name,
while EditScript validates the overall action name. The two should be
distinct but currently use overlapping error text ("Field is required!").
Verify the user can't pick e.g. "MyAction!" in EditScript (allowed) but
get rejected by ScriptToolbar (not allowed by the regex).

**Solution:**
```diff
+ // In EditScript.vue:
- "Field is required!"
+ t("actionScripts.invalidActionName")
+ // In ScriptToolbar.vue:
- "Field is required!"
+ t("actionScripts.invalidMethodName")
```

### 39. ZIP-upload error never surfaces before clicking Save
See issue #12 — the "ZIP File is required!" error message is bound only
when `step > 1`. If a user clicks "Continue" from step 1 with no ZIP,
they go forward and only after returning to step 1 does the message
appear.

**Solution:** See Logical Issue #12 — gate `step++` on `zipError` being empty.

## Accessibility Issues

### 40. Header back button missing `role`/`aria-label`
`web/src/components/actionScripts/EditScript.vue` lines 25-45.

The back-button is a `<div>` with a click handler. No `role="button"`,
no `tabindex`, no `aria-label`. Keyboard users cannot trigger it. The
Quasar version had the same problem, so not a regression — but the
migration is a good moment to fix it.

Same issue in
`web/src/components/actionScripts/ScriptToolbar.vue` lines 7-21 and the
ODialog `#header-left` slot in
`web/src/components/actionScripts/ActionScripts.vue` lines 171-181.

**Solution:**
```diff
- <div @click="goBack" ...>
-   <OIcon name="arrow-back-ios-new" />
- </div>
+ <OButton variant="ghost" size="icon-sm" :aria-label="t('common.goBack')" icon-left="arrow-back-ios-new" @click="goBack" />
```

### 41. Tooltips on icons lack accessible names
`web/src/components/actionScripts/EditScript.vue` lines 246-273, 340-357.

The OIcon trigger has no `aria-label`. Screen readers will announce
nothing when the user focuses the surrounding `<div>` containing the
icon + tooltip.

**Solution:**
```diff
- <OIcon name="info" size="sm" />
+ <OIcon name="info" size="sm" :aria-label="t('actionScripts.cronInfo')" tabindex="0" />
```

### 42. File-item edit/delete buttons hidden until hover
`web/src/components/actionScripts/FileItem.vue` lines 102-111.

`visibility: hidden` until `:hover` means keyboard-only users (who can't
hover) cannot reach the edit/delete buttons. Use `:focus-within` or
always-visible compact icons.

**Solution:**
```diff
- .file-item:hover .file-actions { visibility: visible; }
+ .file-item:hover .file-actions,
+ .file-item:focus-within .file-actions { visibility: visible; }
```

### 43. Active file-item contrast
See issue #8 — `bg-primary` no longer compiles, so the active row has
white text on near-transparent background. Even if you fix the class,
verify WCAG contrast.

**Solution:** See Critical Issue #8 — replace `bg-primary` with `tw:bg-[var(--o2-primary)]`. Then verify the white-on-primary combination meets WCAG AA (≥4.5:1).

## Recommendations

1. **Fix the service-account select first.** Either type
   `serviceAccountsOptions` as `{ label: string; value: string }[]` and
   build that shape in `getServiceAccounts`, or drop `labelKey/valueKey`
   and accept plain strings. (#1)
2. **Delete the dead clone-dialog branch entirely.** It's been broken
   since `main` and the migration just dressed up the corpse. (#2)
3. **Run a `tw:` lint pass on the actionScripts directory** — the
   common mistakes are `tw:full-width`, `tw:mr-md`, `hover:tw:bg-...`,
   `text-red-5/-7`, `text-weight-bold`, `bg-primary`. A regex pre-commit
   hook would catch these. (#3-#8)
4. **Remove the `v-close-popup` directive** from ScriptToolbar (#9).
5. **Bind `debounce` numerically** (`:debounce="300"`). (#10)
6. **Rewrite the spec files** to mount with the real O\* components or
   correctly stub them by their PascalCase names. Remove
   `installQuasar`, the `import * as quasar from "quasar"` lines, and
   any `q-*-stub` assertions. (#31-#37)
7. **Hoist tooltip into icon slot** at EditScript.vue:246-273 and
   :340-357 — the current sibling placement misroutes hover detection.
   (#27)
8. **Strip dead imports** in both `ActionScripts.vue` and
   `EditScript.vue`. (#24-#25)
9. **Delete dead `<style>` blocks** in `ActionScript.vue`,
   `ActionScripts.vue`, `EditScript.vue`, `ScriptToolbar.vue` —
   any `:deep(.q-field__*)`, `.q-tabs`, `.q-table`, `.alerts-tabs .o-tabs`,
   `.clone-alert-popup`, `.lookup-table-file-uploader`. (#18, #19, #22,
   #23)
10. **Tighten validation**: surface ZIP-required and cron-required errors
    *before* the user advances. Centralize the rules. (#12, #15, #38)

## Class-Level Styling Audit

### 1. Quasar Class Leftovers
| File:Line | Class | Replacement | Layer |
|---|---|---|---|
| ActionScript.vue:43 | `.q-table` selector | remove (dead) | file-scoped |
| ActionScript.vue:50 | `.q-tabs` selector | remove (dead) | file-scoped |
| ActionScript.vue:53 | `.q-tab` selector | remove (dead) | file-scoped |
| ActionScript.vue:61 | `.q-tab` selector | remove (dead) | file-scoped |
| EditScript.vue:1142 | `:deep(.q-field__label)` | remove | file-scoped |
| EditScript.vue:1148 | `:deep(.q-field__control-container .q-field__native ...)` | remove | file-scoped |
| ScriptToolbar.vue:158 | `:deep(.q-field__bottom)` | remove | file-scoped |
| ScriptEditor.vue:12 | `text-weight-bold` | `tw:font-bold` | file-scoped |
| ActionScripts.vue:113 | `tw:mr-md` | `tw:mr-4` | file-scoped |

### 2. Tailwind v4 Misuse
| File:Line | Wrong | Right | Layer |
|---|---|---|---|
| ActionScripts.vue:36 | `tw:full-width` | `tw:w-full` (no `full-width` token in TW) | file-scoped |
| ActionScripts.vue:113 | `tw:mr-md` | `tw:mr-4` | file-scoped |
| FileItem.vue:3 | `hover:tw:bg-gray-200` | `tw:hover:bg-gray-200` | file-scoped |

### 3. Quasar CSS Variables
| File:Line | Variable | Replacement | Layer |
|---|---|---|---|
| *(none found)* | | | |

### 4. Dead `:deep(.q-*)` / `body.body--dark` / `::v-deep`
| File:Line | Selector | Action | Layer |
|---|---|---|---|
| EditScript.vue:1142 | `:deep(.q-field__label)` | remove | file-scoped |
| EditScript.vue:1148 | `:deep(.q-field__control-container...)` | remove | file-scoped |
| ScriptToolbar.vue:158 | `:deep(.q-field__bottom)` | remove | file-scoped |

### 5. Quasar SCSS Variables in Scoped Styles
| File:Line | Variable | Replacement | Layer |
|---|---|---|---|
| ActionScript.vue:45 | `$border-color` | `var(--o2-border)` | file-scoped |

### 6. Quasar Directives
| File:Line | Directive | Action |
|---|---|---|
| ScriptToolbar.vue:56 | `v-close-popup="true"` | remove, use imperative close or v-model |

### 7. Icon Migration
| File:Line | Issue | Fix |
|---|---|---|
| *(none found)* | | |

### 8. Inline `style=` Hot Spots
| File:Line | Inline style | Suggested home |
|---|---|---|
| ActionScript.vue:18 | `min-height:inherit` | drop or scoped class |
| ActionScripts.vue:83 | `display:inline-block; width:33.14px; height:auto` | scoped `.action-thumbnail` class |
| ActionScripts.vue:175 | `border:1.5px solid; border-radius:50%; width:22px; height:22px` | scoped `.status-bubble` class |
| EditScript.vue:53 | `max-height: calc(100vh - var(--navbar-height) - 157px)` | scoped `.edit-script-scroll` class |
| EditScript.vue:58 | `width:1024px` | scoped class |
| EditScript.vue:66 | `padding-top:12px` | `tw:pt-3` |
| EditScript.vue:75 | `width:400px` | `tw:w-[400px]` |
| EditScript.vue:93 | `width:800px` | `tw:w-[800px]` |
| EditScript.vue:200,229,259,352 | `font-size:14px` | `tw:text-sm` |
| EditScript.vue:239 | `padding-top:8px; width:320px` | scoped class |
| EditScript.vue:283 | `width:100%` | `tw:w-full` |
| EditScript.vue:301,375 | `min-width:250px !important; width:250px !important` | scoped `.fixed-input-250` class |
| EditScript.vue:465 | `position:sticky; bottom:0px; z-index:2` | scoped `.edit-script-footer` class |
| ScriptToolbar.vue:38 | `min-width:300px` | `tw:min-w-[300px]` |

### 9. Duplicate Style Blocks
| Files | Duplicated block | Suggested partial |
|---|---|---|
| EditScript.vue:301,375 | identical `min-width:250px !important; width:250px !important` | `.fixed-input-250` shared class |
| EditScript.vue:200,229,259,352 | repeated `font-size:14px` spans | `.script-label-sm` class |
| ScriptEditor.vue:12 / TestFunction.vue:162,219 (Functions) | repeated `text-weight-bold tw:flex tw:items-center tw:text-gray-500 tw:ml-2 tw:text-[13px]` | shared `.section-label-13` extracted to common SCSS |

### 10. Layer Summary
- Global (`app.scss`) changes needed: 0
- Component-level partial changes: 2 (.fixed-input-250, .section-label-13 cross-component)
- File-level scoped changes: ~28 (4 q-* deep blocks, 1 SCSS var, 1 directive, 3 tw misuse, 18 inline styles)
