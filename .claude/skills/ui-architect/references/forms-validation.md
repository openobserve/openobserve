# Form Validation & Binding (OForm + Zod)

How to build a **validated** form in this app. `OForm` wraps
TanStack Vue Form (`@tanstack/vue-form`); validation is a **Zod schema**
mapped onto fields by `name`. This is the single sanctioned way to do form
validation — no hand-rolled `xError` refs, no per-field `:rules`, no manual
`validate()`.

Read [forms-inputs.md](forms-inputs.md) and [forms-specialized.md](forms-specialized.md)
for the individual `OForm*` field components; this file is about wiring them into
a validated whole.

## Table of contents

- [The one rule: single source of truth](#the-one-rule-single-source-of-truth)
- [Anatomy of a validated form](#anatomy-of-a-validated-form)
- [1. Colocate a Zod schema (`<Form>.schema.ts`)](#1-colocate-a-zod-schema)
- [2. Every control inside `<OForm>` is an `OForm*`, `name=`-owned](#2-every-control-is-an-oform-name-owned)
- [3. Validation timing & the `required` prop](#3-validation-timing--the-required-prop)
- [4. Submitting: overlay `form-id` vs inline, automatic loading](#4-submitting)
- [5. Building the payload (explicit keys, coerce numbers)](#5-building-the-payload)
- [6. Conditional rendering that depends on form state](#6-conditional-rendering)
- [7. Dynamic field arrays (repeatable rows)](#7-dynamic-field-arrays)
- [Options API forms](#options-api-forms)
- [Testing a form](#testing-a-form)
- [Anti-patterns (banned)](#anti-patterns-banned)

---

## The one rule: single source of truth

Once a control is inside `<OForm>`, **the TanStack form owns its value — nothing
else.** No parallel `ref` + `v-model`, no `formData` object the submit handler
reads back. The form is the only place the value lives; you read it via the
validated `value` handed to `@submit`, and you write it via
`form.setFieldValue(...)`.

Every other rule below is a consequence of this one. Two sources of truth (a
mirror `ref` synced by a `watch`) is the root cause of the classic bugs here:
drift between what's shown and what's saved, and post-save "required" flashes.

---

## Anatomy of a validated form

```vue
<script setup lang="ts">
import { useI18n } from "vue-i18n";
import OForm from "@/lib/forms/Form/OForm.vue";
import OFormInput from "@/lib/forms/Input/OFormInput.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import { makeStreamSchema, streamDefaults } from "./AddStream.schema";
import streamService from "@/services/streams";

const { t } = useI18n();
const schema = makeStreamSchema(t);

async function onSubmit(value: StreamForm) {
  // value is validated + typed. Build the request with explicit keys.
  await streamService.create({ name: value.name, retention: Number(value.retention) });
}
</script>

<template>
  <OForm :schema="schema" :default-values="streamDefaults()" @submit="onSubmit">
    <OFormInput name="name" :label="t('stream.name')" required />
    <OFormInput name="retention" type="number" :label="t('stream.retention')" />

    <div class="flex gap-2 mt-4">
      <OButton variant="outline" size="sm-action" @click="$emit('cancel')">
        {{ t("common.cancel") }}
      </OButton>
      <OButton variant="primary" size="sm-action" type="submit">
        {{ t("common.save") }}
      </OButton>
    </div>
  </OForm>
</template>
```

The pieces: a **schema** (Zod) + **typed defaults**, `OForm` carrying
`:schema`/`:default-values`/`@submit`, `OForm*` fields addressed only by `name`,
and a Save button that is `type="submit"`.

---

## 1. Colocate a Zod schema

Put the schema in a sibling `<Form>.schema.ts` — never an inline
`:default-values` literal or an inline validator. The file exports three things:
the schema, the inferred TS type, and typed defaults.

```ts
// AddStream.schema.ts
import { z } from "zod";

// A factory taking `t` so messages are localized (the component builds it once
// in setup with its own `t`). Match the app's makeXSchema(t) convention.
export const makeStreamSchema = (t: (k: string) => string) =>
  z.object({
    name: z.string().min(1, t("stream.nameRequired")),
    // <input type="number"> emits a STRING — validate the raw value, coerce at use.
    retention: z
      .any()
      .refine((v) => v === "" || Number(v) >= 0, t("stream.retentionPositive")),
  });

export type StreamForm = z.infer<ReturnType<typeof makeStreamSchema>>;

// Typed defaults — a factory for create, or a typed computed for edit-prefill.
export const streamDefaults = (): StreamForm => ({ name: "", retention: "" });
```

Why colocate + factory: the schema is the form's contract in one readable place,
localized, reusable by the spec, and impossible to drift from the field set
because the field `name`s must match the schema keys.

TanStack routes each schema issue to the field whose `name` matches the key, so
**individual `OForm*` fields need no `validators` prop** — the schema is the only
validation source.

## 2. Every control is an `OForm*`, `name=`-owned

Inside `<OForm>`, convert **every** base control to its form-bound `OForm*`
wrapper (`OFormInput`, `OFormSelect`, `OFormSwitch`, `OFormCombobox`,
`OFormToggleGroup`, `OFormDateTimeRange`, …) and give it **only** a `name` (plus
label/ui props). Not just the validated fields — even a purely-optional field
becomes an `OForm*` with `.optional()` in the schema, so there's one uniform
binding.

```vue
<!-- right: form owns the value -->
<OFormInput name="host" :label="t('dest.host')" required />

<!-- banned: a parallel ref is a second source of truth -->
<OFormInput name="host" v-model="hostRef" />          <!-- ❌ -->
<OInput v-model="hostRef" />                            <!-- ❌ bare, unbound -->
```

- **No `OForm*` wrapper exists for a control you need?** Author a thin one
  modeled on `OFormSelect`: `inject(FORM_CONTEXT_KEY)`, render `form.Field` with
  `name=`, bind `:model-value="field.state.value"`,
  `@update:model-value="field.handleChange"`, `@blur="field.handleBlur"`, and
  surface the error via `firstFieldError`. It's a shared `lib/forms/*` addition —
  build it once and reuse it.
- **The only controls that stay bare inside `<OForm>`** are genuine non-form
  widgets — a Monaco code editor, `<query-editor>`. If such a widget needs
  validation, bridge its value into the form **once** with
  `form.setFieldValue(name, value)` so the schema covers it; then it's already in
  `value` at submit. That single bridge is the *only* sanctioned `setFieldValue`
  from outside a field.
- **Data that isn't a form control** (org id from the store, a constant, the
  Monaco content) lives outside the form and is merged at submit — see
  [§5](#5-building-the-payload). That's not entanglement; the test is simply
  "is it a control rendered inside `<OForm>`?"

## 3. Validation timing & the `required` prop

Validation timing is **submit-then-change**, owned by `OForm` (via TanStack's
`revalidateLogic`): nothing validates while the user types or on blur, so errors
stay hidden during first entry; the first submit reveals all errors at once; then
each field re-validates live on every change. You don't configure this — it's
baked into `OForm`. The schema file only describes *what* is valid, never *when*.

Mark required fields with the **`required` prop** on the `OForm*` component — it
renders the required affordance and is the accessible signal. **Never hardcode a
`*` in the label.** The actual enforcement is the schema's `.min(1)` / non-empty
refine; the prop and the schema rule go together.

```vue
<OFormInput name="email" :label="t('user.email')" required />   <!-- prop, not "Email *" -->
```

## 4. Submitting

`OForm` renders a real `<form @submit>`. The submit path depends on where the
Save button lives:

- **Inline form** (button inside `<OForm>`): the Save button is
  `type="submit"`. Enter also submits.
- **Overlay form** (button in an `ODialog`/`ODrawer` footer, *outside* the
  `<form>`): give `<OForm id="myForm">` an `id` (it falls through to the inner
  `<form>`) and set the overlay's `form-id="myForm"`. The footer's built-in Save
  button renders as `<button form="myForm" type="submit">`, so it submits the
  form across the DOM boundary. Prefer the overlay's built-in
  `primary-button-label`, `secondary-button-label`, and `@click:secondary` props
  for Cancel.

**Loading and enabled-state are automatic — don't manage them.** `OForm` awaits
your `@submit` handler, so TanStack's `isSubmitting` stays true for the whole
save and the Save button shows its spinner on its own. Therefore:

- **Delete** any `useLoading` / `:loading` / `:primary-button-loading` wiring for
  the submit — it's redundant.
- **Do not** disable Save on invalid (`:primary-button-disabled` /
  `:disabled`). Save stays enabled; clicking an invalid form reveals the errors.
  That's the intended UX — a disabled button that never explains itself is worse.
- The default slot also exposes `{ isSubmitting, canSubmit }` for an inline
  button that wants the spinner: `<OForm v-slot="{ isSubmitting }">`

### Dialog + OForm button pattern (required)

When a form lives inside an `ODialog` or `ODrawer`, always use the overlay's
**built-in button props** — never hand-roll buttons in a template slot:

```vue
<!-- RIGHT: ODialog manages buttons, wired to form via form-id -->
<ODialog
  :open="showDialog"
  @update:open="showDialog = $event"
  :title="t('common.edit')"
  :form-id="FORM_ID"
  :primary-button-label="t('common.save')"
  :secondary-button-label="t('common.cancel')"
  @click:secondary="showDialog = false"
>
  <OForm
    :id="FORM_ID"
    :schema="schema"
    :default-values="defaults"
    @submit="onSubmit"
  >
    <OFormInput name="title" :label="t('common.title')" required />
  </OForm>
</ODialog>

<!-- WRONG: redundant manual buttons, duplicate the built-in pattern -->
<ODialog :open="showDialog" @update:open="showDialog = $event">
  <OForm :schema="schema" @submit="onSubmit">
    <OFormInput name="title" />
    <div class="flex gap-2">
      <OButton variant="outline" @click="showDialog = false">Cancel</OButton>
      <OButton variant="primary" type="submit">Save</OButton>
    </div>
  </OForm>
</ODialog>
```

**Why:** The built-in buttons automatically:
- Render with correct styling (outline/primary per the standard)
- Wire `:form="formId"` so the primary button's type="submit" submits the form
- Show the spinner automatically during `@submit` (no manual `:loading`)
- Align perfectly and spacing is correct
- Cancel button fires `@click:secondary` so you control the close action

**What the props do:**
- `:form-id="FORM_ID"` — wires the footer buttons to the `<OForm id="FORM_ID">`
- `:primary-button-label` — text on the Save button (localized, via `t()`)
- `:secondary-button-label` — text on the Cancel button
- `@click:secondary="showDialog = false"` — close the dialog when Cancel is clicked

## 5. Building the payload

The `@submit` handler receives the validated `value`. **Build the request body
with explicit keys — never `{ ...value }`.**

```ts
// right: explicit, typed, no leakage
async function onSubmit(value: DestForm) {
  await service.create({
    name: value.name,
    url: value.url,
    retries: Number(value.retries),          // OFormInput emits a string
    org: store.state.selectedOrganization.identifier,  // context, merged here
  });
}

// banned: spread leaks schema-only .optional() helper fields into the body,
// and ships string-typed numbers the API rejects
await service.create({ ...value });          // ❌
```

Two concrete traps this avoids:
- **Schema-only fields leak.** `.optional()` helper fields (a UI toggle, a
  discriminator) spread straight into the request and backends reject the extra
  keys. Name the keys you send.
- **Numbers arrive as strings.** `OFormInput` (even `type="number"`) emits a
  **string**. Coerce with `Number(...)` at use, or `z.coerce.number()` in the
  schema, wherever the API expects a number. A silently string-typed numeric
  field is a common creation failure.

## 6. Conditional rendering

Sometimes visible sections depend on form state (`v-if` on a `kind` field, an
`OStepper`, a `v-for` over a repeatable group). `form.useStore(...)` is reactive
**only for components rendered inside `<OForm>`** (Vue `provide` flows downward).
Pick the pattern by *who* needs the state — and in both, everyone reads the
**same one form**; nobody keeps a copy.

- **A descendant inside `<OForm>` needs it** → `inject(FORM_CONTEXT_KEY)` then
  `form.useStore((s) => s.values.kind)`. Render the conditional sub-form as a
  child and bind its fields by nested `name` (`config.akeyless.base_url`); the
  parent owns the single schema.

- **The component that *owns* `<OForm>` needs it** (it renders `<OForm>`, so it
  sits above the provide and can't inject) → create the form in `setup()` with
  `useOForm({ defaultValues, schema, onSubmit })`, read it with
  `form.useStore((s) => s.values.kind)`, write with `form.setFieldValue(...)`,
  and hand it down via `<OForm :form="form">`. Wire the save through
  `useOForm({ onSubmit })`, not `@submit`.

```ts
// owner setup()
import { useOForm } from "@/lib/forms/Form/useOForm";
const form = useOForm({ defaultValues: defaults(), schema, onSubmit });
const kind = form.useStore((s) => s.values.kind);   // reactive, drives v-if
```
```vue
<OForm :form="form">
  <OFormSelect name="kind" :options="kinds" />
  <AkeylessFields v-if="kind === 'akeyless'" />
</OForm>
```

Rule of thumb: *owns* `<OForm>` → `useOForm()`; *rendered inside* it → `inject` +
`useStore`. **Never** mirror form state into a parallel `ref`/`reactive` synced
by a `watch → setFieldValue` bridge, and never copy `form.state.values` into
local state via a subscription — that's the two-sources-of-truth bug the whole
pattern exists to prevent.

## 7. Dynamic field arrays

Repeatable rows (a list of headers, a key/value map) are modeled as
`z.array(rowSchema)` and rendered with **index-based names**: `rows[0].key`,
`rows[1].key`, … A map becomes an array of `{ key, value }` rows (convert
map→rows at edit-prefill, rebuild the map at submit).

```vue
<div v-for="(row, i) in rows" :key="i">
  <OFormInput :name="`rows[${i}].key`" />
  <OFormInput :name="`rows[${i}].value`" />
  <OButton variant="ghost" icon-left="delete" @click="removeRow(i)" />
</div>
```

**The `:key` MUST be the array index (`:key="i"`), not a `uuid`/stable id.** This
is the single most bug-prone form pattern in the app. `OForm*`/TanStack resolves
a field's `name` **once, at creation**, and does not re-bind when the `name`
later changes. With a stable-id `:key`, deleting a **non-last** row makes Vue
reuse and reorder the row components, so each surviving field stays bound to its
**old index** — the rendered inputs shift/blank while `form.state.values` stays
correct. So a data-only assertion passes while the UI is visibly broken.

- A field-array `:key` is **always** the index. (A `uuid` may live on the row
  schema for other purposes — just never as the `:key`.)
- Structural rules ("at least one row", "a draft row has a value but no key") are
  a submit-handler guard or a schema `superRefine` keyed by path
  (`["rows", i, "key"]`), not a per-row validator.
- **Mandatory test:** build ≥3 rows, delete a **non-last** row, and assert the
  **rendered inputs** (read each row `OForm*` → `OInput` `model-value`), not just
  `form.state.values`. If it fails, the `:key` is wrong.

## Options API forms

The library is Composition-API, but some app forms are still Options API. There,
the schema and defaults **must be `return`ed from `setup()`** (or defined in
`data`/`computed` and exposed) so `:schema`/`:default-values` resolve. If they're
`undefined`, validation silently no-ops and the form "saves" anything.

```ts
setup() {
  const { t } = useI18n();
  return { schema: makeGeneralSettingsSchema(t), defaults: generalSettingsDefaults() };
}
```

For the owner-conditional pattern in Options API, `return { form, ... }` from
`setup()` so the template can bind `<OForm :form="form">`.

## Testing a form

Drive behavior through the **real `<OForm>`**, not internals:

- Mount the component with the real `OForm`. Assert an empty required form ⇒
  `form.state.isValid === false` **and** the save service was **not** called;
  then the valid case ⇒ save **was** called.
- Add a test per validation rule (invalid ⇒ error shown + save blocked; valid ⇒
  save called).
- Await submission deterministically with `await form.handleSubmit()`.
- Assert the **exact** object handed to the save service — keys **and** value
  types (catches leaked keys and string-typed numbers).
- For field-array forms, the non-last-row delete test above is required.

(See the project's `fe-testing` rules for `data-test` selectors, MSW, and the
mount helpers — carry every `data-test` verbatim when converting a control.)

## Real-world example: NotificationChannels form

A complex form with non-schema fields (custom headers, reusable secret input) wired via `setFieldValue`:

```ts
// NotificationChannels.schema.ts
export const makeNotificationChannelSchema = (t: (key: string) => string) =>
  z.object({
    id: z.string().optional(),
    name: z.string().min(1, { message: t("notificationChannels.validation.nameRequired") }).trim(),
    type: z.enum(["webhook", "slack", "email"]),
    destination_url: z.string().min(1).url({ message: t("notificationChannels.validation.invalidUrl") }),
    auth_token: z.string().optional(),
    headers: z.record(z.string()).optional().default({}),  // map; convert rows ↔ map at submit
    retry_count: z.coerce.number().int().min(0).max(10),
    enabled: z.boolean().default(true),
  });

export type NotificationChannelForm = z.infer<ReturnType<typeof makeNotificationChannelSchema>>;
export const notificationChannelDefaults = (): NotificationChannelForm => ({
  name: "", type: "webhook", destination_url: "", auth_token: "", headers: {},
  retry_count: 3, enabled: true,
});
```

```vue
<template>
  <ODialog :form-id="FORM_ID" primary-button-label="Save" secondary-button-label="Cancel">
    <OForm
      :id="FORM_ID"
      :schema="notificationChannelSchema"
      :default-values="formDefaults"
      @submit="saveChannel"
    >
      <!-- Schema fields: OForm* components with name= -->
      <OFormInput name="name" :label="t('notificationChannels.name')" required />
      <OFormSelect name="type" :label="t('notificationChannels.type')" :options="typeOptions" required />
      <OFormInput name="destination_url" :label="t('notificationChannels.destination')" required />
      <OFormInput name="retry_count" type="number" :label="t('notificationChannels.retryCount')" required />
      <OFormCheckbox name="enabled" :label="t('notificationChannels.enabled')" />

      <!-- Non-schema field bridged by hand — SecretInput here is an illustrative
           custom control (not a real repo component); if it could be a form
           wrapper you'd use <OFormSecretInput name="auth_token" /> instead.
           auth_token stays schema-owned; the control is value-dumb -->

      <div class="space-y-2">
        <label class="text-sm font-medium">{{ t('notificationChannels.authToken') }}</label>
        <SecretInput
          :model-value="formInputs.auth_token"
          @update:model-value="formInputs.auth_token = $event"
          :placeholder="t('notificationChannels.authToken')"
        />
      </div>

      <!-- Dynamic field array: custom headers (map ↔ array conversion at edit/submit) -->
      <div class="space-y-3">
        <div class="flex justify-between">
          <label class="text-sm font-medium">{{ t("notificationChannels.headers") }}</label>
          <OButton variant="ghost" size="sm" icon-left="add" type="button" @click="addHeader">
            {{ t("notificationChannels.addHeader") }}
          </OButton>
        </div>
        <!-- Rendered as array of {key, value} rows; converted to map for schema at submit -->
        <div v-for="(header, idx) in headers" :key="idx" class="flex gap-2">
          <OInput v-model="header.key" :placeholder="t('notificationChannels.headerKey')" />
          <OInput v-model="header.value" :placeholder="t('notificationChannels.headerValue')" />
          <OButton variant="ghost" size="sm" icon-left="delete" type="button" @click="removeHeader(idx)" />
        </div>
      </div>
    </OForm>
  </ODialog>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import { useI18n } from "vue-i18n";
import { makeNotificationChannelSchema, notificationChannelDefaults, type NotificationChannelForm } from "./NotificationChannels.schema";

const { t } = useI18n();
const FORM_ID = "notification-channel-form";

// Schema is computed because it needs t() at every render (translations can change)
const notificationChannelSchema = computed(() => makeNotificationChannelSchema(t));
const formDefaults = notificationChannelDefaults();
const formInputs = ref<NotificationChannelForm>(structuredClone(formDefaults));

// Non-schema state: custom headers as an array of rows (converted to map at submit)
const headers = ref<Array<{ key: string; value: string }>>([]);

// When editing, prefill schema fields + convert map → array for headers
const openEditForm = (channel: any) => {
  formInputs.value = {
    id: channel.id,
    name: channel.name,
    type: channel.type,
    destination_url: channel.destination_url,
    auth_token: channel.auth_token || "",
    headers: channel.headers || {},
    retry_count: channel.retry_count,
    enabled: channel.enabled,
  };
  // Convert map to array for UI
  headers.value = Object.entries(channel.headers || {}).map(([key, value]) => ({
    key,
    value: value as string,
  }));
};

// On submit: the validated schema value, + non-schema rows converted back to map
async function saveChannel(values: NotificationChannelForm) {
  const headersObj = Object.fromEntries(
    headers.value.filter((h) => h.key && h.value).map((h) => [h.key, h.value])
  );
  
  const data = {
    ...values,
    headers: headersObj,  // merge the constructed map into the payload
  };
  
  await service.create(data);
}
</script>
```

**Key patterns here:**
- **Computed schema:** `makeNotificationChannelSchema(t)` wrapped in `computed()` because translations are reactive
- **Non-schema fields don't go in Zod.** Custom headers, SecretInput are UI-only (converted at edit/submit).
- **The split:** `formInputs` (schema-owned refs) + `headers` (ephemeral array rows) live side-by-side.
- **At submit:** merge the rows into a map and combine with validated `values`.
- **Dialog integration:** `<ODialog :form-id="FORM_ID">` + `<OForm :id="FORM_ID">` wire the footer button to the form.

---

## Anti-patterns (banned)

| Anti-pattern | Why it's wrong | Do instead |
| --- | --- | --- |
| `OFormInput` + `v-model="ref"` | two sources of truth → drift | `name=` only; read `value` at submit |
| A `formData` object the `@submit` reads | same | read the validated `value` arg |
| Mirror `ref` synced by `watch → setFieldValue` | drift, post-save "required" flash | owner: `useOForm` + `:form`; descendant: `inject` + `useStore` |
| Per-field `:rules` / hand-rolled `validate()` / `xError` refs | forks validation off the schema | one Zod schema on `<OForm :schema>` |
| Hardcoded `*` in a label | not accessible, drifts from the rule | `required` prop + schema rule |
| `:primary-button-disabled` on invalid | dead-end UX; Save must explain itself | leave Save enabled (submit reveals errors) |
| `useLoading` / `:loading` for submit | redundant | `OForm` awaits `@submit` → auto spinner |
| `{ ...value }` as the request body | leaks `.optional()` keys, ships string numbers | explicit keys + `Number()`/`z.coerce.number()` |
| `uuid` `:key` on a field-array row | mid-list delete shifts/blanks inputs | `:key="index"` + delete test |
| bare control with no `OForm*` wrapper inside `<OForm>` | unvalidated, unbound | author the `OForm*` wrapper |
| Schema tied to static `t` | translations don't react | `computed(() => makeSchema(t))` for reactive updates |
