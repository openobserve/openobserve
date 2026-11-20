# Forms — Container, Validation & Specialized Inputs

The `OForm` container + `useOForm` composable own field registration, validation timing, and submit; each specialized control ships as a headless `OX.vue` (bind `v-model` yourself) and a form-bound `OFormX.vue` wrapper (reads/writes the field by `name`, renders label/error/required for you).

## Table of contents

- [OForm + useOForm](#oform--useoform) — container & validation (read first)
- [OSaveBar + useLeaveGuard](#osavebar--useleaveguard) — the one Save/Discard bar of an always-editable settings page, and the Save/Cancel footer of a create page
- [OColor](#ocolor) — hex color picker
- [OEmojiPicker](#oemojipicker) — curated emoji picker
- [ODate](#odate) — single date
- [OTime](#otime) — time of day
- [ODateTimeRange](#odatetimerange) — relative/absolute range picker
- [ODateRangeCalendar](#odaterangecalendar) — dual-month date-range calendar
- [OFormDateTimeRange](#oformdatetimerange) — form-bound legacy range picker
- [OFile](#ofile) — file upload
- [ORange](#orange) — dual-thumb numeric range
- [OSlider](#oslider) — single-value slider

---

## OForm + useOForm

`OForm` is the form **container**. It builds (or accepts) a TanStack `@tanstack/vue-form` instance, `provide()`s it under `FORM_CONTEXT_KEY`, and every `OForm*` field wrapper `inject()`s that context and registers itself via `form.Field` keyed by its `name` prop. There is no manual field registration — dropping an `OFormInput :name="..."` inside `<OForm>` is the registration.

**Validation timing (submit-then-change):** when you pass a `schema`, nothing validates while typing or on blur — the first submit reveals all errors, then every field re-validates live on each change. This is wired with `revalidateLogic({ mode: "submit", modeAfterSubmission: "change" })` and a single `onDynamic`/`onDynamicAsync` validator source; TanStack routes each schema issue to the field whose `name` matches the schema key, so individual fields need no per-field validators. Always-editable settings pages opt in to **leave-then-change** with `validateOn: "leave"`: a field the user changed shows its error when they leave it, then on every change until fixed, and Save still reveals everything. `coupled` lists groups of fields checked together (for example `[["min", "max"]]`); the group reveals together and a message the schema reports on every member prints once, on the group's last member. A custom field wrapper reads its error through `useVisibleFieldError(form)` from `@/lib/forms/Form/fieldError`, never `field.state.meta.errors` directly.

**Submit:** `OForm` **awaits** your `@submit` handler, so TanStack's `isSubmitting` stays true for the whole save. That drives the Save spinner automatically (an `ODialog`/`ODrawer` footer button linked by `form-id`, via the injected `FORM_SUBMIT_STATE_KEY`; or an inline button through the default slot's `isSubmitting`/`canSubmit` scope). Double-submit (e.g. Enter while saving) is guarded.

### OForm

**Import:** `@/lib/forms/Form/OForm.vue`
**Use when:** Wrapping any set of `OForm*` fields that validate and submit together.
**Don't use for:** A single unmanaged input with no validation/submit — use the headless control (`OInput`, `OColor`, …) with your own `v-model` instead.
**Key props:**

- `defaultValues` (`T` — required on the normal path; supplied via `useOForm()` on the headless `:form` path) — initial values for every field; keys must match each field's `name`
- `schema` (`unknown` — Zod / Standard Schema; optional) — validates the whole form, mapped to fields by `name`
- `onSubmit` (`(values: T) => unknown | Promise<unknown>`) — written `@submit="handler"` in templates; awaited
- `greedy` (`boolean`, default `false`) — validate every field instead of stopping at the first error
- `form` (`OFormInstance`) — an externally-created form from `useOForm()`; when present OForm uses it instead of creating its own
- `validateOn` (`"submit" | "leave"`, default `"submit"`) — when a field's error first shows; used only when OForm builds its own form
- `coupled` (`FormFieldPath<T>[][]`, default `[]`) — groups of fields checked together in leave mode; used only when OForm builds its own form

**Slots:** default only — scoped as `{ isSubmitting, canSubmit }`.
**Emits:** `reset` — fired when `.reset()` is called on the ref.
**Exposed (via template ref, `OFormExposed`):** `validate(): Promise<boolean>`, `resetValidation()`, `submit()`, `reset()`, `isSubmitting` (ref), `canSubmit` (ref), `form` (raw TanStack instance).
**Family:** Container for all `OForm*` field wrappers; pairs with `useOForm`.

### useOForm

**Import:** `import { useOForm } from "@/lib/forms/Form/useOForm"`
**Use when:** The component that **owns** `<OForm>` needs the form state reactively at `setup()` — e.g. a discriminated form whose visible sections depend on a `kind` field (`v-if` / `v-for` / `OStepper`). Create the form in setup, read it with `form.useStore(selector)`, write it with `form.setFieldValue(...)`, then hand it to `<OForm :form="form">`.
**Don't use for:** A field **inside** `<OForm>` (a descendant) — it should `inject(FORM_CONTEXT_KEY)` instead. Simple forms with no parent-side conditional rendering need only `<OForm :default-values :schema @submit>` (OForm calls `useOForm` internally with the identical config).
**Signature:** `useOForm<T>({ defaultValues: T, schema?: unknown, onSubmit?: (values: T) => unknown | Promise<unknown>, validateOn?: "submit" | "leave", coupled?: FormFieldPath<T>[][] })` → a TanStack form instance (`OFormInstance`). The config is guaranteed identical to OForm's internal fallback (same submit-then-change timing, single `onDynamic` source, awaited `onSubmit`).

**End-to-end example (simple path — OForm owns the form):**

```vue
<script setup lang="ts">
import { z } from "zod";
import OForm from "@/lib/forms/Form/OForm.vue";
import OFormInput from "@/lib/forms/Input/OFormInput.vue";

const schema = z.object({
  name: z.string().min(1, "Name is required"),
  email: z.string().email("Enter a valid email"),
});

const defaultValues = { name: "", email: "" };

async function onSubmit(values: { name: string; email: string }) {
  await saveUser(values); // awaited → Save spinner stays until this resolves
}
</script>

<template>
  <OForm
    :default-values="defaultValues"
    :schema="schema"
    @submit="onSubmit"
    v-slot="{ isSubmitting, canSubmit }"
    data-test="users-add-user-form"
  >
    <OFormInput name="name" label="Name" required />
    <OFormInput name="email" label="Email" required />
    <OButton
      variant="primary"
      type="submit"
      :loading="isSubmitting"
      :disabled="!canSubmit"
      data-test="users-add-user-submit-btn"
    >
      Save
    </OButton>
  </OForm>
</template>
```

**Headless path (owner needs reactive state at setup):**

```vue
<script setup lang="ts">
import { useOForm } from "@/lib/forms/Form/useOForm";
import OForm from "@/lib/forms/Form/OForm.vue";

const form = useOForm({
  defaultValues: { kind: "http", url: "" },
  onSubmit: async (v) => {
    await save(v);
  },
});
// read reactively to drive parent-side v-if
const kind = form.useStore((s) => s.values.kind);
</script>

<template>
  <OForm :form="form">
    <OFormSelect name="kind" :options="kinds" label="Kind" />
    <OFormInput v-if="kind === 'http'" name="url" label="URL" />
  </OForm>
</template>
```

---

## OSaveBar + useLeaveGuard

### OSaveBar

**Import:** `@/lib/forms/SaveBar/OSaveBar.vue`
**Use when:** An always-editable settings page (no dialog, no edit mode): one bar pinned to the bottom of the content that says how many values changed and holds Discard and Save. A full-page create/edit editor with a Cancel that leaves uses the same bar with `mode="create"`. One bar per page; never a second Save button on the page.
**Don't use for:** Dialog and drawer forms (their footer owns Save), or actions that are not values (uploads, "Add …", delete): those keep their own buttons and are not counted.
**Key props:**

- `mode` (`"edit" | "create"`, default `"edit"`) — `"create"` is for a new record: no change count, Save works on an untouched form, and Cancel (emits `cancel`) replaces Discard
- `form` (`OFormInstance`, default: the enclosing `OForm`) — source of the counts and of submit; pass it only when the bar sits outside the `<OForm>`
- `changeCount` (`number`, default: fields that differ from the saved values; a number field's text equal to the saved number is not a change) — override for pages with state outside the form. `useFormCounts(form)` (`@/lib/forms/SaveBar/formCounts`) gives the same `changes` and `errors` to add page state to, and for `useLeaveGuard`
- `errorCount` (`number`, default: fields printing an error; a `coupled` group prints one, so it is one field to fix)
- `loaded` (`boolean`, default `true`) — `false` until the saved values arrive
- `saving` (`boolean`, default: the form's `isSubmitting`)
- `contentSize` (`"sm" | "md" | "lg" | "xl" | "full"`, default `"lg"`) — the contents end at the form column's width
- `dataTest` (`string`, default `"save-bar"`) — parts: `-status`, `-fix`, `-discard`, `-save`
- `saveDataTest`, `discardDataTest` (`string`) — replace `<dataTest>-save` / `-discard` when the page's button already has a selector; an existing `data-test` is never renamed
- `cancelDataTest` (`string`) — replaces `<dataTest>-cancel` in create mode
- `saveLabel` (`string`) — replaces "Save" on the primary, such as "Continue" on a step
- `saveDisabled` (`boolean`) — disables the primary for a reason the form does not know, such as a step with nothing chosen
- `submit` (`boolean`, default `true`) — `false` makes the primary a plain button that emits `save` without submitting
- `formId` (`string`) — the `<form>`'s id, when the bar renders outside it (teleported into the Settings shell's slot); Enter in a field then still reaches Save

**States:**

| State | Status | Discard | Save |
| --- | --- | --- | --- |
| Loading (`loaded` false) | skeleton line | hidden | disabled |
| Clean | "No changes to save" | hidden | disabled |
| Changed | "1 unsaved change" / "N unsaved changes" ("N changes" below `md`) | shown | enabled |
| Changed, invalid | same, then the link "Fix N fields" | shown | enabled |
| Saving | unchanged | disabled | spinner |
| Create mode (`mode="create"`) | empty; "Fix N fields" when invalid | replaced by Cancel | enabled once loaded |

Save is the form's submit button, so Enter in a text field saves when something changed and does nothing when clean. Save is disabled only when nothing changed. On an invalid form it sends nothing, reveals every error and focuses the first invalid field; "Fix N fields" does the same without submitting. Discard resets the form to the last saved values with no confirm. After a successful save call `form.reset(savedValues)` so the bar returns to Clean; success and failure stay the page's own toasts.
**Slots:** `start` — page actions that are not values, before the status; `actions` — buttons before Cancel or Discard, such as a step's Back.
**Emits:** `save` (a valid submit has run; normally use the form's `@submit`), `discard` (after the reset), `cancel` (create mode: the user gave up the new record; the page decides whether to ask first).
**Example:**

```vue
<OForm ref="formRef" validate-on="leave" :schema="schema" :default-values="saved" @submit="save">
  <!-- sections and rows -->
  <Teleport defer :to="SAVE_BAR_SLOT">
    <OSaveBar class="px-4" form-id="general-settings-form" :loaded="!isLoading" data-test="settings-general-save-bar" />
  </Teleport>
</OForm>
```

A create page keeps the bar as the last child of its `OForm`:

```vue
<OSaveBar
  mode="create"
  data-test="add-cipher-key-footer"
  save-data-test="add-cipher-key-save-btn"
  cancel-data-test="add-cipher-key-cancel-btn"
  @cancel="closeEditor"
/>
```

In the Settings shell the bar is teleported to `SAVE_BAR_SLOT` (`@/components/settings/saveBarSlot`), a row below the scroller: the strip spans the pane, stays at its bottom on a short page, and its contents end at the form column. Outside that shell, leave the bar as the last child of the form; it is `sticky bottom-0`.

**Family:** `OForm validate-on="leave"`, `OSettingRow`, `useLeaveGuard`. Recipe: [page-recipes.md](page-recipes.md) § Settings form page.

### useLeaveGuard

**Import:** `@/lib/forms/SaveBar/useLeaveGuard`
**Use when:** Every page with an `OSaveBar`. Call it once in the page's setup; the bar does not call it.
**Signature:** `useLeaveGuard(isDirty: Ref<boolean> | (() => boolean), options?: { count?: () => number; onDiscard?: () => void })`
**Behaviour:** while dirty, leaving the route or switching organization opens the shared confirm dialog ("Discard changes" / "Keep editing") and follows the answer; a reload or tab close gets the browser's own prompt. On confirm it calls `onDiscard` first: discard the form there with `discardFormChanges(form)` (`@/lib/forms/SaveBar/formCounts`), because Settings pages are kept alive and would come back dirty. Use it rather than `form.reset()`: a save still open when the user leaves then lands as the saved values, and the discarded edits do not return as unsaved changes.
**`confirmLeave()`** (same module): a change that is not a navigation and unmounts the page, such as the header's organization switch, awaits it before committing anything and stops on `false`. It asks the dirty pages on screen with the same dialog; the navigation that follows a `true` does not ask again.
**Example:**

```ts
const changes = form.useStore(
  (s) => Object.values(s.fieldMeta).filter((m) => m && !m.isDefaultValue).length,
);
useLeaveGuard(() => changes.value > 0, {
  count: () => changes.value,
  onDiscard: () => discardFormChanges(form),
});
```

---

## OColor

### OColor

**Import:** `@/lib/forms/Color/OColor.vue`
**Use when:** Picking a single `#RRGGBB` hex color — a swatch opens a Reka saturation/brightness + hue popover, with an always-visible hex text input.
**Don't use for:** A choice among a fixed palette of named colors — use `OSelect`/`OOptionGroup`. Inside an `OForm`, use `OFormColor`.
**Key props:** `modelValue` (`string` — `#RRGGBB`), `readonly` (`boolean`, default `false` — swatch-only, text input read-only), `clearable` (`boolean`, default `false`), `disabled` (`boolean`, default `false`), `required` (`boolean`), `size` (`"sm"` 28 | `"md"` 32 default — S1), `label`, `placeholder` (default `#000000`), `helpText`, `errorMessage`, `error` (`boolean`), `id`, `name`.
**Slots:** `label`, `tooltip` (renders an info icon in the label row).
**Emits:** `update:modelValue` (string), `change` (string), `clear`, `blur` (FocusEvent), `focus` (FocusEvent).
**Example:**

```vue
<OColor v-model="brandColor" label="Brand color" clearable />
```

**Family:** Headless sibling `OColor`; form-bound wrapper `OFormColor` (`@/lib/forms/Color/OFormColor.vue`).

### OFormColor

**Import:** `@/lib/forms/Color/OFormColor.vue`
**Use when:** A hex color field inside `<OForm>`.
**Key props:** `name` (`string`, required — matches a `defaultValues` key) plus every `OColor` prop except `modelValue` (value + error come from the form).
**Slots:** `label`. **Emits:** none (writes through `field.handleChange` / `field.handleBlur`).
**Example:**

```vue
<OFormColor name="color" label="Series color" required />
```

---

## OEmojiPicker

### Icon tokens
The picker's value is an **icon token**, not plain text — either a Unicode emoji (`"🚀"`) or a service-glyph reference (`"o2:redis"`). Persist it opaquely; only `OGlyph` and `glyphRegistry.ts` need to tell them apart. Type it as `IconToken` from `@/lib/forms/EmojiPicker/OGlyph.types`.

### OEmojiPicker
**Import:** `@/lib/forms/EmojiPicker/OEmojiPicker.vue`
**Use when:** Letting a user badge a record (folder, board, saved view) with a single icon — a square trigger opens a searchable, grouped grid of ~200 curated entries: Unicode emoji plus **full-colour** logos for every service on the Ingestion pages (Redis, Kafka, Terraform, Prometheus, Postgres…).
**Don't use for:** A full Unicode emoji keyboard (the catalog is deliberately curated), or picking an app icon from the Material set — that's `OIcon`'s `IconName` union.
**Key props:** `modelValue` (`IconToken | null`), `size` (`"sm" | "md"`, default `"md"` — `md` matches OInput's box height so it lines up beside a text field), `disabled` (`boolean`, default `false`), `ariaLabel` (`I18nText`).
**Emits:** `update:modelValue` (`string | null`), and `select` (`string | null`) which fires **only** on a deliberate pick or clear — use it to stop any auto-fill you drive from another field.
**Behaviour:** clicking the selected entry deselects it; the panel search matches the catalog's `keywords`; the grid uses a roving tabindex (arrows / Home / End) so it adds one tab stop, not a hundred; the popover z-index rides ODialog's stacking ladder so it works inside a dialog.
**Example:**
```vue
<OEmojiPicker v-model="icon" size="md" @select="userChoseIcon = true" />
```
**Form binding:** There is no `OFormEmojiPicker`. Inside `<OForm>`, wrap it in an app component that injects `FORM_CONTEXT_KEY` and renders `form.Field` — see `components/common/sidebar/FolderIconField.vue`, which also shows the suggest-until-touched pattern.

### OGlyph
**Import:** `@/lib/forms/EmojiPicker/OGlyph.vue`
**Use when:** Displaying a chosen icon token anywhere outside the picker (a list row, a header, a chip). It renders an emoji as text, an Iconify glyph as an inline SVG, and an asset-backed glyph as an `<img>` — callers never branch on the kind.
**Key props:** `token` (`IconToken | null` — renders nothing when empty or unresolvable), `size` (`"sm" | "md" | "lg"`, default `"md"`; one scale drives emoji font-size and glyph box so the kinds line up on a row), `alt` (image-backed glyphs only; empty by default = decorative).
**Dark mode:** brand logos keep their own colours, so they can't adapt to the surface like an `OIcon`. The fix is the **`--color-glyph-plate` token** — transparent on light, a light chip on dark — which keeps near-black marks (GitHub, Kafka, Helm, InfluxDB) legible. It's a token, not a `dark:` class, so the theme owns the decision; don't add per-component conditionals here.
**Note:** glyphs are `aria-hidden` / empty-alt by design — the adjacent label carries the meaning. A retired `o2:` token renders nothing rather than leaking the raw string.
```vue
<OGlyph :token="folder.icon" size="sm" />
```

### Catalog & glyph registry
- `emojiCatalog.ts` exports `EMOJI_GROUPS` / `ALL_EMOJIS`. `emojiCatalog.spec.ts` enforces four invariants: **no token appears twice**, **no keyword has two owners** (ties break on catalog order, so a shared keyword silently resolves to whichever group is first), **registry ↔ catalog parity in both directions**, and **every Ingestion-page service is pickable**. The Services group owns product names; the Creatures group keeps only creature names.
- `glyphRegistry.ts` is a closed, explicitly-imported map with two sources: `@iconify-json/logos` (full-colour marks, compiled inline by `unplugin-icons`) and `@/assets/images/ingestion/*` (the repo's own logos, for services `logos` has no entry for — Fluentd, Telegraf, Databricks, IIS…). Using the ingestion assets keeps the picker and the integrations list from drifting apart. Both resolve at build time — no runtime fetch, air-gapped safe, same contract as `lib/core/Icon/OIcon.icons.ts`.
- **The list is the bundle cost.** 84 glyphs today: 67 inline colour SVGs ≈ **187 KB in the JS bundle** (tree-shaken from a 2,091-icon collection), plus 17 image-backed ones ≈ 662 KB served as separate lazy assets that the build already emits for the Ingestion pages. Eager rather than lazy so folder-rail icons paint without pop-in. Keep it curated; if it grows much further, switch the registry to `defineAsyncComponent` — `resolveGlyph()` is the only seam that would change.
- Deliberately **not** `simple-icons`: those marks are monochrome black, which reads as a UI glyph rather than a product logo.
- To match folder/record names against the same set, import `ALL_EMOJIS` — see `@/utils/folderIcons.ts`.

---

## ODate

### ODate

**Import:** `@/lib/forms/Date/ODate.vue`
**Use when:** Selecting a single calendar date as `YYYY-MM-DD`.
**Don't use for:** A start/end date span — use [ODateRangeCalendar](#odaterangecalendar) or [ODateTimeRange](#odatetimerange). A date **and** time-of-day range — use [ODateTimeRange](#odatetimerange). Inside an `OForm`, use `OFormDate`.
**Key props:** `modelValue` (`string` — `YYYY-MM-DD`), `min` / `max` (`string` — `YYYY-MM-DD`), `clearable` (`boolean`), `autoApply` (`boolean`, default `true` — apply on click; set `false` for an Apply button), `readonly` (`boolean`), `disabled` (`boolean`, default `false`), `required` (`boolean`), `size` (`"sm"` 28 | `"md"` 32 default — S1), `prefix` (text inside the box before the date, for a toolbar: "Day:", S3; there is no inside label), `label`, `placeholder`, `helpText`, `errorMessage`, `error` (`boolean`), `id`, `name`.
**Slots:** `label`, `tooltip`.
**Emits:** `update:modelValue` (string), `change` (string), `clear`, `blur`, `focus`.
**Example:**

```vue
<ODate v-model="startDate" label="Start date" :max="today" clearable />
```

**Family:** Headless sibling `ODate`; form-bound wrapper `OFormDate`. For a range, see the DateTimeRange family below.

### OFormDate

**Import:** `@/lib/forms/Date/OFormDate.vue`
**Use when:** A single-date field inside `<OForm>`.
**Key props:** `name` (`string`, required) plus every `ODate` prop except `modelValue`.
**Slots:** `label`. **Emits:** none.
**Example:**

```vue
<OFormDate name="expiresOn" label="Expires on" :min="today" required />
```

---

## OTime

### OTime

**Import:** `@/lib/forms/Time/OTime.vue`
**Use when:** Selecting a time of day as `HH:MM` (or `HH:MM:SS` with `withSeconds`).
**Don't use for:** A full date+time — pair with `ODate` or use `ODateTimeRange`. Inside an `OForm`, use `OFormTime`.
**Key props:** `modelValue` (`string` — `HH:MM` / `HH:MM:SS`), `withSeconds` (`boolean`, default `false`), `min` / `max` (`string` — `HH:MM`), `step` (`number` — seconds, default 60), `clearable` (`boolean`), `readonly` (`boolean`), `disabled` (`boolean`, default `false`), `required` (`boolean`), `size` (`"sm"` 28 | `"md"` 32 default — S1), `label`, `placeholder`, `helpText`, `errorMessage`, `error` (`boolean`), `id`, `name`.
**Slots:** `label`, `tooltip`.
**Emits:** `update:modelValue` (string), `change` (string), `clear`, `blur`, `focus`.
**Example:**

```vue
<OTime v-model="runAt" label="Run at" with-seconds />
```

**Family:** Headless sibling `OTime`; form-bound wrapper `OFormTime`.

### OFormTime

**Import:** `@/lib/forms/Time/OFormTime.vue`
**Use when:** A time field inside `<OForm>`.
**Key props:** `name` (`string`, required) plus every `OTime` prop except `modelValue`.
**Slots:** `label`. **Emits:** none.
**Example:**

```vue
<OFormTime name="startTime" label="Start time" required />
```

---

## DateTimeRange family

One picker for every time-scoped screen (F8). `components/DateTime.vue` is gone; every importer now uses `ODateTimeRange`:

- **`ODateTimeRange`** — the one time-range picker: presets rail (recent and calendar ranges), Relative and Absolute panels, time zone and Apply in ONE popover. It seeds itself from once-read `default-*` props and emits `on:date-change`.
- **`ODateRangeCalendar`** — the low-level, date-only dual-month range calendar the picker's Absolute panel uses. Dates are `YYYY/MM/DD`.
- **`OFormDateTimeRange`** — the form-bound wrapper around `ODateTimeRange`: it seeds the `default-*` props from the field, writes each change into the form's `{ type, period, from, to }` object, and remounts the picker only when the field changes from outside (reset, prefill).

### ODateTimeRange

**Import:** `@/lib/forms/DateTimeRange/ODateTimeRange.vue`
**Use when:** Any time-scoped toolbar or form: one control, just before refresh (F1, F8). Defaults: explorers and dashboards 15 minutes, overviews 24 hours.
**Don't use for:** A single date (`ODate`) or a single time (`OTime`); a segmented control of ranges or a read-only pill (F8).
**Look (S1, S2, O4, W4):** the trigger is `h-control-md` (32) or `h-control-sm` (28) from `size`, a fixed 216 px wide (`w-54`; it shrinks below md), so a label never reflows the toolbar. An absolute range reads short — "Nov 13 19:00 – 20:00", both dates when they differ, the year only outside this year — with the full range in the trigger tooltip. The popover is a fixed 664 px wide; Relative and Absolute share one grid cell, so switching modes never resizes or moves it. The ‹ › shift buttons are joined to the trigger at the same height. Never an `h-*` class on the picker (`local/o2-control-height`).
**Key props:** `size` (`"sm"` | `"md"` default), `defaultType` (`"relative"` | `"absolute"`), `defaultRelativeTime` (e.g. `"15m"`), `defaultAbsoluteTime` (`{ startTime, endTime }` in µs), `autoApply`, `applyPresets`, `calendarPresets` (Today … Last year), `initialTimezone` / `pickerTimezone`, `queryRangeRestrictionInHour` + `queryRangeRestrictionMsg` (the over-the-limit state), `disableRelative`, `hideRelativeTime`, `hideRelativeTimezone`, `hideClipboard`, `hideRangeShift`, `disablePrevShift`, `minDate` / `maxDate` (`YYYY/MM/DD`), `menuAlign`, `fieldAppearance` (full-width form look), `defaultOpen`, `hideSeconds`, `triggerText`, `dataTestName`, `disabled`. `local/o2-controls-api` rejects the old `disable` and `variant`.
**Exposed methods (via `ref`):** `setCustomDate`, `setSavedDate`, `setAbsoluteTime`, `setDateType`, `refresh`, `getConsumableDateTime` and the rest the old picker exposed.
**Emits:** `on:date-change` (`{ startTime, endTime, relativeTimePeriod, valueType, … }`), `on:timezone-change`, `show`, `hide`.
**Example:**

```vue
<ODateTimeRange
  ref="dateTimeRef"
  auto-apply
  :default-type="range.type"
  :default-relative-time="range.relativeTimePeriod"
  :default-absolute-time="{ startTime: range.startTime, endTime: range.endTime }"
  data-test-name="alerts-history-date-time"
  @on:date-change="onRangeChange"
/>
```

**Family:** Calendar `ODateRangeCalendar`; preset rail `components/DateTimeRail.vue`; form-bound wrapper `OFormDateTimeRange`; dashboard wrapper `DateTimePickerDashboard` (same `size`/`disabled` API).

### ODateRangeCalendar

**Import:** `@/lib/forms/DateTimeRange/ODateRangeCalendar.vue`
**Use when:** Embedding a bare dual-month date-range calendar (no time, no popover) — e.g. inline in a custom filter panel.
**Don't use for:** Anything needing time-of-day, relative ranges, or a popover trigger — use `ODateTimeRange`. A single date — use `ODate`.
**Key props:** `startDate` / `endDate` (`string` — `YYYY/MM/DD`), `minDate` / `maxDate` (`string` — `YYYY/MM/DD`), `disabled` (`boolean`).
**Slots:** none.
**Emits:** `update:startDate` (`YYYY/MM/DD`), `update:endDate` (`YYYY/MM/DD` — fired when the range is completed).
**Example:**

```vue
<ODateRangeCalendar
  v-model:start-date="from"
  v-model:end-date="to"
  :max-date="today"
/>
```

**Family:** Low-level calendar; the full picker is `ODateTimeRange`.

### OFormDateTimeRange

**Import:** `@/lib/forms/DateTime/OFormDateTimeRange.vue`
**Use when:** A timerange field inside `<OForm>` whose value is the app's `{ type, period, from, to }` shape (it wraps `ODateTimeRange`).
**Don't use for:** A standalone (non-form) range picker — use `ODateTimeRange`. Note the path lives under `forms/DateTime/`, not `forms/DateTimeRange/`.
**Key props:** `name` (`string`, required — supports nested/indexed paths like `dashboards[0].timerange`), `label` (13 px medium above the picker, S3), `required` (`boolean` — renders the `*`), `description` (`string` — helper line under the label), `size`. All other `ODateTimeRange` props pass through via `$attrs`.
**Slots:** none. **Emits:** none (writes the timerange object through `field.handleChange`). Errors are validated cross-field in the form schema, not rendered inline.
**Example:**

```vue
<OFormDateTimeRange name="timerange" label="Time range" required />
```

---

## Range vs Slider

Both are numeric track controls with identical `min`/`max`/`step` semantics — the difference is the value shape:

- **`OSlider`** — a **single** value (`modelValue: number`), one thumb.
- **`ORange`** — a **pair** (`modelValue: { min: number; max: number }`), two thumbs (dual-thumb). Use when the user selects a span, not a point.

Both come in one size (S1): there is no `size` prop, and `local/o2-controls-api` rejects one.

### ORange

**Import:** `@/lib/forms/Range/ORange.vue`
**Use when:** Selecting a numeric span (a low/high pair) with two draggable thumbs.
**Don't use for:** A single value — use `OSlider`. Inside an `OForm`, use `OFormRange`.
**Key props:** `modelValue` (`{ min: number; max: number }`), `min` (`number`, default 0), `max` (`number`, default 100), `step` (`number`, default 1), `showValue` (`boolean`, default `false`), `formatValue` (`(value: number) => string`), `disabled` (`boolean`, default `false`), `required` (`boolean`), `vertical` (`boolean`, default `false`), `reverse` (`boolean`, default `false`), `labelAlways` (`boolean`, default `false` — always show value next to each thumb), `markers` (`boolean`, default `false` — tick marks), `markerLabels` (`{ value: number; label: string }[]`), `label`, `helpText`, `errorMessage`, `error` (`boolean`), `id`, `name`.
**Slots:** `label`, `tooltip`.
**Emits:** `update:modelValue` (`RangeValue`), `change` (`RangeValue`), `blur`, `focus`.
**Example:**

```vue
<ORange
  v-model="priceRange"
  :min="0"
  :max="1000"
  :step="10"
  show-value
  label="Price range"
/>
```

**Family:** Headless sibling `ORange`; form-bound wrapper `OFormRange`. Single-value counterpart: `OSlider`.

### OFormRange

**Import:** `@/lib/forms/Range/OFormRange.vue`
**Use when:** A dual-thumb range field inside `<OForm>`.
**Key props:** `name` (`string`, required) plus every `ORange` prop except `modelValue`.
**Slots:** `label`. **Emits:** none.
**Example:**

```vue
<OFormRange name="scoreRange" :min="0" :max="100" label="Score range" />
```

### OSlider

**Import:** `@/lib/forms/Slider/OSlider.vue`
**Use when:** Selecting a single numeric value on a track (one thumb).
**Don't use for:** A low/high span — use `ORange`. Inside an `OForm`, use `OFormSlider`.
**Key props:** `modelValue` (`number`), `min` (`number`, default 0), `max` (`number`, default 100), `step` (`number`, default 1), `showValue` (`boolean`, default `false`), `formatValue` (`(value: number) => string`), `disabled` (`boolean`, default `false`), `required` (`boolean`), `label`, `helpText`, `errorMessage`, `error` (`boolean`), `id`, `name`.
**Slots:** `label`, `tooltip`.
**Emits:** `update:modelValue` (number), `change` (number), `blur`, `focus`.
**Example:**

```vue
<OSlider
  v-model="opacity"
  :min="0"
  :max="1"
  :step="0.1"
  show-value
  label="Opacity"
/>
```

**Family:** Headless sibling `OSlider`; form-bound wrapper `OFormSlider`. Dual-thumb counterpart: `ORange`.

### OFormSlider

**Import:** `@/lib/forms/Slider/OFormSlider.vue`
**Use when:** A single-value slider field inside `<OForm>`.
**Key props:** `name` (`string`, required) plus every `OSlider` prop except `modelValue`.
**Slots:** `label`. **Emits:** none.
**Example:**

```vue
<OFormSlider
  name="threshold"
  :min="0"
  :max="100"
  show-value
  label="Threshold"
/>
```

---

## OFile

### OFile

**Import:** `@/lib/forms/File/OFile.vue`
**Use when:** Every import and attachment (U1): pipelines, dashboards, enrichment tables, source maps, logos. One component: a drop zone that really accepts drops, with "choose a file" inside and the accepted types, size limit and count under it; each chosen file as a row (name, size, remove) with progress and errors inline. Never say "drop" where dropping does not work, and never ignore a rejected file silently (K6).
**Don't use for:** A field inside `<OForm>` — use `OFormFile`.
**Key props:** `modelValue` (`File | File[] | null`), `variant` (`"zone"` default — the dashed `rounded-surface` drop target | `"compact"` — a `h-control-md` box with the file name and a "Choose file" button for a form row), `sources` (`('file' | 'url' | 'paste')[]`, default `['file']`; two or more show an sm segmented switch above ONE fixed-height area, U2, O4) with `v-model:source`, `v-model:url`, `v-model:text`, `urlPlaceholder`, `textPlaceholder`, `multiple`, `maxFiles` (1 unless `multiple`), `accept` (e.g. `".json"`), `maxSize` (bytes), `validate` (`(file) => I18nText | null | Promise` — "Not valid JSON: …" on the row; `createJsonFileValidator(t)` ships with it), `upload` (`(file, onProgress) => Promise` — drives the row's progress and error), `disabled` + `disabledReason`, `required`, `label`, `helpText`, `errorMessage`, `error`, `id`, `name`.
**Slots:** `label`, `tooltip`. The dead `#prepend`/`#append` slots and `dropZone`, `size`, `maxFileSize`, `counter`, `counterLabel`, `bottomSlots` are removed and rejected by `local/o2-controls-api`.
**Emits:** `update:modelValue`, `change`, `clear`, `rejected` (`{ file, reason }[]` — every type, size, count or `validate` failure also shows as an error row), `update:source`, `update:url`, `update:text`.
**Example:**

```vue
<OFile
  v-model="file"
  accept=".json"
  :max-size="5 * 1024 * 1024"
  :validate="validateJson"
  :sources="['file', 'url', 'paste']"
  v-model:source="source"
  v-model:url="url"
  v-model:text="pasted"
  data-test="pipeline-import-file"
/>
```

Results of an import appear inline under one heading, "Import results", turning each error into a field to fix (U3).

**Family:** Headless sibling `OFile`; form-bound wrapper `OFormFile`.

### OFormFile

**Import:** `@/lib/forms/File/OFormFile.vue`
**Use when:** A file field inside `<OForm>`.
**Key props:** `name` (`string`, required) plus every `OFile` prop except `modelValue`.
**Slots:** `label`. **Emits:** none.
**Example:**

```vue
<OFormFile name="avatar" accept="image/*" label="Avatar" required />
```
