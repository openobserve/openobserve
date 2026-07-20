# Forms — Container, Validation & Specialized Inputs

The `OForm` container + `useOForm` composable own field registration, validation timing, and submit; each specialized control ships as a headless `OX.vue` (bind `v-model` yourself) and a form-bound `OFormX.vue` wrapper (reads/writes the field by `name`, renders label/error/required for you).

## Table of contents
- [OForm + useOForm](#oform--useoform) — container & validation (read first)
- [OColor](#ocolor) — hex color picker
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

**Validation timing (submit-then-change):** when you pass a `schema`, nothing validates while typing or on blur — the first submit reveals all errors, then every field re-validates live on each change. This is wired with `revalidateLogic({ mode: "submit", modeAfterSubmission: "change" })` and a single `onDynamic`/`onDynamicAsync` validator source; TanStack routes each schema issue to the field whose `name` matches the schema key, so individual fields need no per-field validators.

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

**Slots:** default only — scoped as `{ isSubmitting, canSubmit }`.
**Emits:** `reset` — fired when `.reset()` is called on the ref.
**Exposed (via template ref, `OFormExposed`):** `validate(): Promise<boolean>`, `resetValidation()`, `submit()`, `reset()`, `isSubmitting` (ref), `canSubmit` (ref), `form` (raw TanStack instance).
**Family:** Container for all `OForm*` field wrappers; pairs with `useOForm`.

### useOForm
**Import:** `import { useOForm } from "@/lib/forms/Form/useOForm"`
**Use when:** The component that **owns** `<OForm>` needs the form state reactively at `setup()` — e.g. a discriminated form whose visible sections depend on a `kind` field (`v-if` / `v-for` / `OStepper`). Create the form in setup, read it with `form.useStore(selector)`, write it with `form.setFieldValue(...)`, then hand it to `<OForm :form="form">`.
**Don't use for:** A field **inside** `<OForm>` (a descendant) — it should `inject(FORM_CONTEXT_KEY)` instead. Simple forms with no parent-side conditional rendering need only `<OForm :default-values :schema @submit>` (OForm calls `useOForm` internally with the identical config).
**Signature:** `useOForm<T>({ defaultValues: T, schema?: unknown, onSubmit?: (values: T) => unknown | Promise<unknown> })` → a TanStack form instance (`OFormInstance`). The config is guaranteed identical to OForm's internal fallback (same submit-then-change timing, single `onDynamic` source, awaited `onSubmit`).

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
  onSubmit: async (v) => { await save(v); },
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

## OColor

### OColor
**Import:** `@/lib/forms/Color/OColor.vue`
**Use when:** Picking a single `#RRGGBB` hex color — a swatch opens a Reka saturation/brightness + hue popover, with an always-visible hex text input.
**Don't use for:** A choice among a fixed palette of named colors — use `OSelect`/`OOptionGroup`. Inside an `OForm`, use `OFormColor`.
**Key props:** `modelValue` (`string` — `#RRGGBB`), `readonly` (`boolean`, default `false` — swatch-only, text input read-only), `clearable` (`boolean`, default `false`), `disabled` (`boolean`, default `false`), `required` (`boolean`), `size` (`"sm" | "md"`, default `"md"`), `label`, `placeholder` (default `#000000`), `helpText`, `errorMessage`, `error` (`boolean`), `id`, `name`.
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

## ODate

### ODate
**Import:** `@/lib/forms/Date/ODate.vue`
**Use when:** Selecting a single calendar date as `YYYY-MM-DD`.
**Don't use for:** A start/end date span — use [ODateRangeCalendar](#odaterangecalendar) or [ODateTimeRange](#odatetimerange). A date **and** time-of-day range — use [ODateTimeRange](#odatetimerange). Inside an `OForm`, use `OFormDate`.
**Key props:** `modelValue` (`string` — `YYYY-MM-DD`), `min` / `max` (`string` — `YYYY-MM-DD`), `clearable` (`boolean`), `autoApply` (`boolean`, default `true` — apply on click; set `false` for an Apply button), `readonly` (`boolean`), `disabled` (`boolean`, default `false`), `required` (`boolean`), `size` (`"sm" | "md"`, default `"md"`), `label`, `placeholder`, `helpText`, `errorMessage`, `error` (`boolean`), `id`, `name`.
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
**Key props:** `modelValue` (`string` — `HH:MM` / `HH:MM:SS`), `withSeconds` (`boolean`, default `false`), `min` / `max` (`string` — `HH:MM`), `step` (`number` — seconds, default 60), `clearable` (`boolean`), `readonly` (`boolean`), `disabled` (`boolean`, default `false`), `required` (`boolean`), `size` (`"sm" | "md"`, default `"md"`), `label`, `placeholder`, `helpText`, `errorMessage`, `error` (`boolean`), `id`, `name`.
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

Three distinct components — do not confuse them:

- **`ODateTimeRange`** — the full standalone headless picker: a popover trigger with Relative and Absolute tabs, `OTime` inputs, timezone selector, and its own Reka `RangeCalendar` (built directly, it does **not** consume `ODateRangeCalendar`). Value is exposed field-by-field via `startDate`/`startTime`/`endDate`/`endTime`/`mode`/`relativeUnit`/`relativeAmount` (each with its own `update:*`), plus a consolidated `change` payload (`DateTimeRangeValue` — a discriminated `absolute | relative` union).
- **`ODateRangeCalendar`** — a low-level, date-only dual-month range calendar (no time, no popover, no tabs). Dates are `YYYY/MM/DD` (app convention; it converts to Reka's `YYYY-MM-DD` internally). Currently a standalone building block — not wired into `ODateTimeRange`.
- **`OFormDateTimeRange`** — the form-bound wrapper. **It does not wrap `ODateTimeRange`;** it wraps the legacy composite `@/components/DateTime.vue` (which takes its value via once-read `default-*` props and emits `on:date-change`). The wrapper seeds those props from the field, translates each change into the form's `{ type, period, from, to }` timerange object via `field.handleChange`, and remounts the inner picker (via `:key`) only when the field value changes from an external source (form reset / async prefill).

### ODateTimeRange
**Import:** `@/lib/forms/DateTimeRange/ODateTimeRange.vue`
**Use when:** A standalone date-time range picker offering both relative ("last 30 minutes") and absolute (start/end date+time) selection, outside a form.
**Don't use for:** A single date (`ODate`) or a date-only range with no time/relative modes (`ODateRangeCalendar`). Inside an `OForm`, use `OFormDateTimeRange`.
**Key props:** `startDate`/`endDate` (`string` — `YYYY-MM-DD`, default `""`), `startTime`/`endTime` (`string` — `HH:MM[:SS]`, default `""`), `mode` (`"relative" | "absolute"`, default `"relative"`), `relativeUnit` (`"seconds" | "minutes" | "hours" | "days" | "weeks" | "months"`, default `"minutes"`), `relativeAmount` (`number`, default 0 — 0 = no selection), `withSeconds` (`boolean`, default `false`), `autoApply` (`boolean`, default `false` — else shows Apply), `disableRelative` (`boolean`, default `false` — absolute-only), `hideTime` (`boolean`, default `false`), `showTimezone` (`boolean`, default `false`), `minDate`/`maxDate` (`string` — `YYYY-MM-DD`), `maxHours` (`number` — disables relative options exceeding it), `timezone` (`string` — IANA; `""` = browser local), `label`, `helpText`, `errorMessage`, `disabled` (`boolean`), `required` (`boolean`), `placeholder` (default `"Select date range"`).
**Slots:** `label`, `tooltip`.
**Emits:** `update:startDate`, `update:startTime`, `update:endDate`, `update:endTime`, `update:mode`, `update:timezone`, `update:relativeUnit`, `update:relativeAmount`, and `change` (the consolidated `DateTimeRangeValue` union). Note: no single `v-model` — bind the individual `update:*` events (or use `v-model:startDate` etc.).
**Example:**
```vue
<ODateTimeRange
  v-model:start-date="startDate"
  v-model:start-time="startTime"
  v-model:end-date="endDate"
  v-model:end-time="endTime"
  :mode="mode"
  @update:mode="mode = $event"
  show-timezone
  @change="onRangeChange"
/>
```
**Family:** Standalone headless picker; date-only sibling `ODateRangeCalendar`; form-bound wrapper `OFormDateTimeRange` (wraps legacy DateTime, not this component).

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
**Use when:** A timerange field inside `<OForm>` whose value is the app's `{ type, period, from, to }` shape (backed by the legacy `@/components/DateTime.vue` picker).
**Don't use for:** A standalone (non-form) range picker — use `ODateTimeRange`. Note the path lives under `forms/DateTime/`, not `forms/DateTimeRange/`.
**Key props:** `name` (`string`, required — supports nested/indexed paths like `dashboards[0].timerange`), `label` (`string` — DateTime has no label of its own), `required` (`boolean` — renders the `*`), `description` (`string` — helper line under the label). All other DateTime attrs pass through via `$attrs`.
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

### ORange
**Import:** `@/lib/forms/Range/ORange.vue`
**Use when:** Selecting a numeric span (a low/high pair) with two draggable thumbs.
**Don't use for:** A single value — use `OSlider`. Inside an `OForm`, use `OFormRange`.
**Key props:** `modelValue` (`{ min: number; max: number }`), `min` (`number`, default 0), `max` (`number`, default 100), `step` (`number`, default 1), `size` (`"sm" | "md" | "lg"`, default `"md"`), `showValue` (`boolean`, default `false`), `formatValue` (`(value: number) => string`), `disabled` (`boolean`, default `false`), `required` (`boolean`), `vertical` (`boolean`, default `false`), `reverse` (`boolean`, default `false`), `labelAlways` (`boolean`, default `false` — always show value next to each thumb), `markers` (`boolean`, default `false` — tick marks), `markerLabels` (`{ value: number; label: string }[]`), `label`, `helpText`, `errorMessage`, `error` (`boolean`), `id`, `name`.
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
**Key props:** `modelValue` (`number`), `min` (`number`, default 0), `max` (`number`, default 100), `step` (`number`, default 1), `size` (`"sm" | "md" | "lg"`, default `"md"`), `showValue` (`boolean`, default `false`), `formatValue` (`(value: number) => string`), `disabled` (`boolean`, default `false`), `required` (`boolean`), `label`, `helpText`, `errorMessage`, `error` (`boolean`), `id`, `name`.
**Slots:** `label`, `tooltip`.
**Emits:** `update:modelValue` (number), `change` (number), `blur`, `focus`.
**Example:**
```vue
<OSlider v-model="opacity" :min="0" :max="1" :step="0.1" show-value label="Opacity" />
```
**Family:** Headless sibling `OSlider`; form-bound wrapper `OFormSlider`. Dual-thumb counterpart: `ORange`.

### OFormSlider
**Import:** `@/lib/forms/Slider/OFormSlider.vue`
**Use when:** A single-value slider field inside `<OForm>`.
**Key props:** `name` (`string`, required) plus every `OSlider` prop except `modelValue`.
**Slots:** `label`. **Emits:** none.
**Example:**
```vue
<OFormSlider name="threshold" :min="0" :max="100" show-value label="Threshold" />
```

---

## OFile

### OFile
**Import:** `@/lib/forms/File/OFile.vue`
**Use when:** Selecting one or many files, optionally via a drag-and-drop drop zone, with `accept` and max-size validation.
**Don't use for:** A field inside `<OForm>` — use `OFormFile`.
**Key props:** `modelValue` (`File | File[] | null`), `multiple` (`boolean`, default `false`), `accept` (`string` — comma-separated MIME types/extensions, e.g. `"image/*,.pdf"`), `maxFileSize` (`number` — bytes; emits `size-error` when exceeded), `dropZone` (`boolean`, default `false`), `size` (`"sm" | "md"`, default `"md"`), `disabled` (`boolean`, default `false`), `required` (`boolean`), `label`, `placeholder`, `helpText`, `errorMessage`, `error` (`boolean`), `id`, `name`.
**Slots:** `label`, `tooltip`, `hint` (custom drop-zone hint when `dropZone` is on).
**Emits:** `update:modelValue` (`FileValue`), `change` (`FileValue`), `clear`, `size-error` (`File[]` — files over `maxFileSize`), `type-error` (`File[]` — files rejected by `accept`).
**Example:**
```vue
<OFile
  v-model="upload"
  accept="image/*,.pdf"
  :max-file-size="5 * 1024 * 1024"
  drop-zone
  label="Attachment"
  @size-error="notifyTooLarge"
/>
```
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
