# Forms — Text, Selection & Choice Inputs

Reference for O2's text, selection, and choice form controls under `@/lib/forms/*`. Every prop, emit, slot, and default below was read from the component `.types.ts` and `.vue` source — nothing invented.

## Table of Contents

- [Headless (`OX`) vs form wrapper (`OFormX`)](#headless-ox-vs-form-wrapper-oformx)
- [When to use OX vs OFormX](#when-to-use-ox-vs-oformx)
- [Input family](#input-family) — OInput, OTextarea, OFormInput, OFormTextarea
- [Select family](#select-family) — OSelect, OSelectItem, OSelectGroup, OFormSelect
- [Combobox family](#combobox-family) — OCombobox, OFormCombobox
- [SearchInput](#searchinput) — OSearchInput
- [Checkbox family](#checkbox-family) — OCheckbox, OCheckboxGroup, OFormCheckbox, OFormCheckboxGroup
- [Radio family](#radio-family) — ORadio, ORadioGroup, OFormRadioGroup
- [Switch family](#switch-family) — OSwitch, OFormSwitch
- [OptionGroup family](#optiongroup-family) — OOptionGroup, OFormOptionGroup

---

## Headless (`OX`) vs form wrapper (`OFormX`)

Every form control ships as a **headless pair**:

- **`OX.vue` (headless)** — the actual control. You own the state via `v-model` (`modelValue` in, `update:modelValue` out). It renders label, help text, required marker, and error styling from props you pass, but it does not know about any form. You wire validation, error strings, and value binding yourself.

- **`OFormX.vue` (form wrapper)** — a thin adapter that `inject()`s the surrounding `<OForm>` context (`FORM_CONTEXT_KEY`) and renders `OX` inside a TanStack-Form `<Field :name="...">`. It **auto-binds** `modelValue`, `error`, and `errorMessage` from the field's validation state (`field.state.value`, `field.state.meta.errors`) and wires `@update:modelValue → field.handleChange` and `@blur → field.handleBlur`. Consequently every `OFormX` requires a **`name`** prop matching a key in the parent `<OForm>`'s `defaultValues`, and its props type is `Omit<XProps, "modelValue" | "error" | "errorMessage">` plus `name`. It logs a DEV warning if rendered outside `<OForm>`.

Because the wrapper is `Omit<..., "modelValue" | ...>`, you never pass `v-model`, `error`, or `errorMessage` to an `OFormX` — the form supplies them. All other presentational props (label, placeholder, size, width, slots) pass straight through.

## When to use OX vs OFormX

- Reach for **`OFormX`** whenever the control lives inside an `<OForm>` and its value is a validated form field — you get validation errors, dirty tracking, and submit wiring for free, and you avoid hand-writing `v-model` + error plumbing.
- Reach for **`OX`** (headless) for standalone controls not backed by a form field: toolbar filters, config-panel toggles, search boxes, a value bound directly to a Vuex/`ref` state, or any place where there is no `<OForm>` ancestor. You then manage `modelValue` and any `error`/`errorMessage` yourself.

---

## Input family

### OInput
**Import:** `@/lib/forms/Input/OInput.vue`
**Use when:** A single-line (or, via `type="textarea"`, multi-line) free-text field — text, password, email, number, url, tel, search — with optional prefix/suffix, icons, clear button, mask, debounce, and character counter.
**Don't use for:** Choosing from a fixed option list (use `OSelect`); typeahead over a suggestion list where free text is also allowed (use `OCombobox`); a pure filter/search box in a toolbar (use `OSearchInput`, which wraps this with a search icon).
**Key props:** `modelValue` (`string | number`), `type` (`"text"` default | `"password"` | `"email"` | `"number"` | `"search"` | `"url"` | `"tel"` | `"textarea"`), `label`, `placeholder`, `helpText`, `errorMessage`, `error` (boolean — error styling only shows when `error` is true; a bare `errorMessage` alone will not surface), `prefix`, `suffix`, `clearable` (default `false`), `readonly` (default `false`), `disabled` (default `false`), `required` (renders `*` after label — do not append ` *` manually), `autofocus` (default `false`), `debounce` (ms; flushed on blur), `autogrow` (default `false`, textarea only), `mask` (`"time"` | `"fulltime"` | `"DD-MM-YYYY"` — digit-extracting), `maxlength` (shows counter), `rows` (default `3`, textarea), `size` (`"sm"` | `"md"` default), `width` (`"xs"` | `"sm"` | `"md"` | `"lg"` | `"full"` default), `labelPosition` (`"inside"` | `"outside"` default), `modelModifiers` (`{ number?, trim? }`), `id`, `name`, `autocomplete`.
**Slots:** `icon-left`, `icon-right`, `prefix`, `suffix`, `tooltip` (put a tooltip element inside — renders an info icon in the label). (`append` is also consumed in template.)
**Emits:** `update:modelValue`, `clear`, `blur`, `focus`, `keydown`, `keyup`, `keypress`
**Example:**
```vue
<OInput
  v-model="host"
  type="text"
  label="Host"
  placeholder="db.internal"
  clearable
  :error="!!hostError"
  :error-message="hostError"
/>
```
**Family:** Siblings `OTextarea` (dedicated multi-line), `OFormInput` (form wrapper). Headless — pair with `OFormInput` inside `<OForm>`.

### OTextarea
**Import:** `@/lib/forms/Input/OTextarea.vue`
**Use when:** A dedicated multi-line text field where you want first-class textarea props like `rows`, `autogrow`, or `fill` (stretch to parent height in a bounded flex container).
**Don't use for:** Single-line input (use `OInput`). Note `OInput` can also render a textarea via `type="textarea"`; prefer `OTextarea` when you need `fill` or a textarea-only API surface.
**Key props:** `modelValue` (`string`), `label`, `placeholder`, `helpText`, `errorMessage`, `error` (boolean — same "error only shows when true" rule as OInput), `rows` (default `3`), `autogrow` (default `false`), `readonly` (default `false`), `disabled` (default `false`), `required`, `autofocus` (default `false`), `maxlength` (shows counter), `size` (`"sm"` | `"md"` default), `width` (`"xs"`|`"sm"`|`"md"`|`"lg"`|`"full"` default), `fill` (default `false` — stretch to parent height), `id`, `name`, `autocomplete`.
**Slots:** `append` (block below the border), `tooltip` (info icon in label)
**Emits:** `update:modelValue`, `blur`, `focus`, `keydown`
**Example:**
```vue
<OTextarea v-model="description" label="Description" :rows="5" autogrow />
```
**Family:** Siblings `OInput`, `OFormTextarea` (form wrapper). Headless.

### OFormInput
**Import:** `@/lib/forms/Input/OFormInput.vue`
**Use when:** An `OInput` field inside `<OForm>` — value and validation errors bind automatically from the form field named by `name`.
**Don't use for:** Standalone inputs with no `<OForm>` ancestor (use `OInput` + your own `v-model`).
**Key props:** `name` (**required** — must match a key in `OForm` `defaultValues`), plus everything `OInput` accepts **except** `modelValue`, `error`, `errorMessage` (auto-bound). So: `type`, `label`, `placeholder`, `helpText`, `clearable`, `disabled`, `readonly`, `required`, `debounce`, `mask`, `maxlength`, `size`, `width`, `labelPosition`, `id`, `autocomplete`, etc.
**Slots:** forwards `icon-left`, `icon-right`, `prefix`, `suffix`, `tooltip`, `append` to `OInput`.
**Emits:** none you wire yourself — internally emits `update:modelValue`/`blur` into the form field.
**Example:**
```vue
<OForm :default-values="{ email: '' }" ...>
  <OFormInput name="email" type="email" label="Email" required />
</OForm>
```
**Family:** Form wrapper for `OInput`. Sibling wrapper `OFormTextarea`.

### OFormTextarea
**Import:** `@/lib/forms/Input/OFormTextarea.vue`
**Use when:** An `OTextarea` field inside `<OForm>` with auto-bound value and validation.
**Don't use for:** Standalone multi-line input (use `OTextarea`).
**Key props:** `name` (**required**), plus everything `OTextarea` accepts **except** `modelValue`, `error`, `errorMessage`: `label`, `placeholder`, `helpText`, `rows`, `autogrow`, `maxlength`, `disabled`, `readonly`, `required`, `size`, `width`, `id`, `autocomplete`.
**Slots:** none forwarded (wraps `OTextarea` directly).
**Emits:** none consumer-facing (binds into the form field).
**Example:**
```vue
<OFormTextarea name="notes" label="Notes" :rows="4" autogrow />
```
**Family:** Form wrapper for `OTextarea`.

---

## Select family

### OSelect
**Import:** `@/lib/forms/Select/OSelect.vue`
**Use when:** Choosing one or many values from a **known option list** — single or `multiple`, optionally `searchable` (built-in filter), `creatable`, grouped, virtualized, with chips, "Select All", and per-option icons.
**Don't use for:** Free-text entry with suggestions where the typed text itself is the value (use `OCombobox`); a plain text field (use `OInput`); a small set of always-visible mutually-exclusive/multi options laid out inline (use `OOptionGroup` / `ORadioGroup` / `OCheckboxGroup`).
**Key props:** `modelValue` (`SelectValue | SelectValue[]`, where `SelectValue = string | number | boolean | null`), `options` (`SelectOption[]` — `{ label, value?, disabled?, header? }`; or use the default slot for custom/grouped items), `multiple` (default `false`), `maxVisibleChips` (default computed from trigger width), `searchable` (default `true`), `searchDebounce` (default `0`), `hideSelected` (default `false`), `selectAll` (default off — multi listbox only), `creatable` (default `false` — emits `create`), `searchPlaceholder` (default `"Search..."`), `labelKey`/`valueKey`/`iconKey`, `label`, `required`, `placeholder`, `errorMessage`, `error` (default `false`), `clearable` (default `false`), `disabled` (default `false`), `size` (`"sm"` | `"md"` default), `width` (`"xs"`|`"sm"`|`"md"`|`"lg"`|`"full"` default), `labelPosition` (`"inside"` | `"outside"` default), `loading` (default off — spinner replaces chevron), `rowClickSingleSelect` (default `false`), `optionTooltip` (default `false`), `helpText`, `id`, `name`, `dropdownStyle`.
**Slots:** `default` (render `OSelectItem`/`OSelectGroup`), `trigger` (`{ value }`), `chip` (`{ label, value }`), `empty`, `before-options`, `after-options`, `icon-left`, `tooltip` (OSelect has `icon-left` only — no `icon-right`)
**Emits:** `update:modelValue`, `clear`, `search`, `create`, `open`, `close`, `blur`, `change`, `keydown`
**Example:**
```vue
<OSelect
  v-model="stream"
  :options="streamOptions"
  label="Stream"
  placeholder="Select a stream"
  searchable
  clearable
/>
```
**Family:** Siblings `OSelectItem`, `OSelectGroup` (slot children), `OFormSelect` (form wrapper). Headless.

### OSelectItem
**Import:** `@/lib/forms/Select/OSelectItem.vue`
**Use when:** Declaring a single custom option inside `OSelect`'s default slot — when you need custom label markup instead of the flat `options` array.
**Don't use for:** Simple flat option lists (pass `options` to `OSelect` instead); grouping headers (wrap items in `OSelectGroup`).
**Key props:** `value` (`SelectValue`, **required** — emitted when selected), `label` (fallback display text), `disabled`
**Slots:** `default` (custom option content — overrides `label`)
**Emits:** none (selection is driven by parent `OSelect`)
**Example:**
```vue
<OSelect v-model="pick">
  <OSelectItem :value="1" label="One" />
  <OSelectItem :value="2"><b>Two</b></OSelectItem>
</OSelect>
```
**Family:** Child of `OSelect`; sibling `OSelectGroup`. Headless building block (no form wrapper of its own).

### OSelectGroup
**Import:** `@/lib/forms/Select/OSelectGroup.vue`
**Use when:** Grouping `OSelectItem`s under a visible heading inside `OSelect`'s default slot.
**Don't use for:** Flat lists (use `options`); a single option (use `OSelectItem`).
**Key props:** `label` (group heading)
**Slots:** `default` (the `OSelectItem` nodes)
**Emits:** none
**Example:**
```vue
<OSelect v-model="pick">
  <OSelectGroup label="Fruit">
    <OSelectItem value="apple" label="Apple" />
  </OSelectGroup>
</OSelect>
```
**Family:** Child of `OSelect`; sibling `OSelectItem`. Headless building block.

### OFormSelect
**Import:** `@/lib/forms/Select/OFormSelect.vue`
**Use when:** An `OSelect` inside `<OForm>` — value and validation bind automatically.
**Don't use for:** Standalone selects (use `OSelect`).
**Key props:** `name` (**required**), plus everything `OSelect` accepts **except** `modelValue`, `error`, `errorMessage`. Note: the wrapper re-defaults `searchable` to `true` to stay transparent (an omitted boolean would otherwise cast to `false`). Common: `options`, `label`, `placeholder`, `multiple`, `searchable`, `clearable`, `disabled`, `required`, `size`, `width`, `labelKey`, `valueKey`, `selectAll`, `creatable`, `hideSelected`.
**Slots:** forwards `default`, `empty`, `tooltip` to `OSelect`.
**Emits:** none consumer-facing (binds into the form field).
**Example:**
```vue
<OFormSelect name="stream" :options="streamOptions" label="Stream" required />
```
**Family:** Form wrapper for `OSelect`.

---

## Combobox family

### OCombobox
**Import:** `@/lib/forms/Combobox/OCombobox.vue`
**Use when:** A **typeahead text input with a suggestion dropdown** where the bound value is the **typed string** (free entry allowed) and picking a suggestion fills/transforms the text. Supports a `searchRegex` to extract a needle from the input and a `valueReplaceFn` to transform the chosen option before emit. This is the O2 replacement for `CommonAutoComplete`.
**Don't use for:** Selecting from a fixed set where only listed values are valid (use `OSelect` — it emits the option's value, not free text, and supports multiple/groups/chips). Difference from `OSelect`: **OCombobox's model is the input string and free text is allowed**; **OSelect's model is a chosen option value from the list** and there is no free-text value (its `searchable`/`creatable` still commit list values or explicit created entries).
**Key props:** `modelValue` (`string` — the text in the input), `items` (`ComboboxOption[]` = `{ label, value }`, default `[]`), `placeholder`, `label`, `searchRegex` (regex string; first non-undefined capture group becomes the search needle; whole input if omitted), `valueReplaceFn` (`(option) => string`, default `option => option.value`), `disabled` (default `false`), `required`, `size` (`"sm"` | `"md"` default), `error` (default `false`), `errorMessage`, `helpText`, `debounce` (ms, default `0`), `labelPosition` (`"inside"` | `"outside"` default), `id`, `name`.
**Slots:** `label` (replaces `label` prop), `tooltip` (info icon next to label)
**Emits:** `update:modelValue` (`string`), `select` (`string` — fired when an option is chosen)
**Example:**
```vue
<OCombobox
  v-model="query"
  :items="fieldSuggestions"
  label="Field"
  placeholder="Type or pick a field"
/>
```
**Family:** Sibling `OFormCombobox` (form wrapper). Headless.

### OFormCombobox
**Import:** `@/lib/forms/Combobox/OFormCombobox.vue`
**Use when:** An `OCombobox` inside `<OForm>` with auto-bound value and validation.
**Don't use for:** Standalone typeahead (use `OCombobox`); fixed-list form selection (use `OFormSelect`).
**Key props:** `name` (**required**), plus everything `OCombobox` accepts **except** `modelValue`, `error`, `errorMessage`: `items`, `label`, `placeholder`, `searchRegex`, `valueReplaceFn`, `disabled`, `required`, `size`, `debounce`, `helpText`, `labelPosition`, `id`.
**Slots:** `label`, `tooltip` (forwarded).
**Emits:** none consumer-facing (binds into the form field).
**Example:**
```vue
<OFormCombobox name="field" :items="fieldSuggestions" label="Field" />
```
**Family:** Form wrapper for `OCombobox`.

---

## SearchInput

### OSearchInput
**Import:** `@/lib/forms/SearchInput/OSearchInput.vue`
**Use when:** A compact filter/search box (list filters, toolbar search) — an `OInput` preset with a search icon, clearable by default, and an extra `xs` size. Value is a plain string, no label/error surface.
**Don't use for:** A general text field with label/validation (use `OInput`); selecting from options (use `OSelect`); typeahead suggestions (use `OCombobox`).
**Key props:** `modelValue` (`string`, default `""`), `placeholder` (default `"Search..."`), `size` (`"xs"` | `"sm"` default `"sm"` | `"md"` — `xs` maps to OInput `sm` height), `clearable` (default `true`), `debounce` (ms, default `0`), `disabled` (default `false`).
**Slots:** none
**Emits:** `update:modelValue`, `clear`
**Example:**
```vue
<OSearchInput v-model="filter" placeholder="Filter streams..." />
```
**Family:** No form wrapper — it wraps `OInput` internally. Standalone/headless only.

---

## Checkbox family

### OCheckbox
**Import:** `@/lib/forms/Checkbox/OCheckbox.vue`
**Use when:** A single boolean (or tri-state `indeterminate`) checkbox, or a member of an `OCheckboxGroup` (set `value`/`val` and it reads the group's checked array). Supports custom `trueValue`/`falseValue`/`indeterminateValue`.
**Don't use for:** A set of related checkboxes with a shared array model (wrap them in `OCheckboxGroup`, or use `OOptionGroup type="checkbox"` for a list-driven layout); an on/off toggle switch (use `OSwitch`).
**Key props:** `modelValue` (`boolean | "indeterminate" | string | number | (string|number)[]`), `value` (member value in a group; excludes boolean by design), `val` (compatibility alias for `value`), `label`, `size` (`"xs"` | `"sm"` | `"md"` default), `trueValue`/`falseValue`/`indeterminateValue` (custom-value mode), `color` (`"primary"` default | `"negative"`), `disabled` (default `false`), `required`, `id`, `name`.
**Slots:** `label` (custom label content — overrides `label` prop)
**Emits:** `update:modelValue`, `change` (emits the item value when inside a group)
**Example:**
```vue
<OCheckbox v-model="agree" label="I agree to the terms" />
```
**Family:** Siblings `OCheckboxGroup`, `OFormCheckbox`, `OFormCheckboxGroup`. Headless.

### OCheckboxGroup
**Import:** `@/lib/forms/Checkbox/OCheckboxGroup.vue`
**Use when:** Managing several `OCheckbox` children as one array-valued selection — it `provide()`s a group context so each child with a `value` toggles into/out of the shared `modelValue` array.
**Don't use for:** A single boolean (use `OCheckbox`); a compact list-driven multi-select laid out from an options array (use `OOptionGroup type="checkbox"`).
**Key props:** `modelValue` (`(string | number)[]`, default `[]`), `disabled` (default `false` — disables all children)
**Slots:** `default` (the `OCheckbox` children)
**Emits:** `update:modelValue` (the new checked-values array)
**Example:**
```vue
<OCheckboxGroup v-model="selected">
  <OCheckbox value="logs" label="Logs" />
  <OCheckbox value="metrics" label="Metrics" />
</OCheckboxGroup>
```
**Family:** Parent of `OCheckbox`; siblings `OFormCheckbox`, `OFormCheckboxGroup`. Headless.

### OFormCheckbox
**Import:** `@/lib/forms/Checkbox/OFormCheckbox.vue`
**Use when:** A single boolean checkbox bound to one `<OForm>` field.
**Don't use for:** A multi-value checkbox set in a form (use `OFormCheckboxGroup`); standalone (use `OCheckbox`).
**Key props:** `name` (**required**), plus everything `OCheckbox` accepts **except** `modelValue`: `value`, `val`, `label`, `size`, `trueValue`, `falseValue`, `indeterminateValue`, `color`, `disabled`, `required`, `id`, `name`.
**Slots:** `label` (per `OCheckbox`).
**Emits:** none consumer-facing (binds into the form field).
**Example:**
```vue
<OFormCheckbox name="acceptTos" label="Accept terms" />
```
**Family:** Form wrapper for `OCheckbox`.

### OFormCheckboxGroup
**Import:** `@/lib/forms/Checkbox/OFormCheckboxGroup.vue`
**Use when:** An array-valued checkbox group bound to one `<OForm>` field (unlike the other OForm wrappers this extends the full `CheckboxGroupProps` — `modelValue` still comes from the form).
**Don't use for:** A single boolean (use `OFormCheckbox`).
**Key props:** `name` (**required**), plus `CheckboxGroupProps` (`disabled`; `modelValue` bound by the form).
**Slots:** `default` (the `OCheckbox` children).
**Emits:** none consumer-facing (binds into the form field).
**Example:**
```vue
<OFormCheckboxGroup name="channels">
  <OCheckbox value="email" label="Email" />
  <OCheckbox value="slack" label="Slack" />
</OFormCheckboxGroup>
```
**Family:** Form wrapper for `OCheckboxGroup`.

---

## Radio family

### ORadio
**Import:** `@/lib/forms/Radio/ORadio.vue`
**Use when:** A single radio button representing one `value` — **must** be used inside `ORadioGroup` (the group provides the RadioGroupRoot context and value map).
**Don't use for:** Standalone use outside a group (it has no own model); a multi-select (use checkboxes); a compact options-array layout (use `OOptionGroup type="radio"`).
**Key props:** `value` (`string | number | boolean` — this radio's value, compared against the group's `modelValue`), `val` (compatibility alias for `value`), `label`, `size` (`"xs"` | `"sm"` | `"md"` default), `disabled` (default `false`), `id`
**Slots:** `label` (custom label content)
**Emits:** none (selection flows through the parent `ORadioGroup`)
**Example:**
```vue
<ORadioGroup v-model="mode">
  <ORadio value="auto" label="Auto" />
  <ORadio value="manual" label="Manual" />
</ORadioGroup>
```
**Family:** Child of `ORadioGroup`. Headless building block.

### ORadioGroup
**Import:** `@/lib/forms/Radio/ORadioGroup.vue`
**Use when:** A single-choice group of `ORadio` children with one selected value; controls orientation and shared name.
**Don't use for:** Multi-select (use `OCheckboxGroup`); a list-driven layout from an options array (use `OOptionGroup type="radio"`).
**Key props:** `modelValue` (`string | number | boolean`), `label` (visually-hidden legend / aria-label), `disabled` (default `false`), `required`, `orientation` (`"horizontal"` | `"vertical"` default), `name`
**Slots:** `default` (the `ORadio` children)
**Emits:** `update:modelValue`
**Example:**
```vue
<ORadioGroup v-model="mode" orientation="horizontal" label="Mode">
  <ORadio value="auto" label="Auto" />
  <ORadio value="manual" label="Manual" />
</ORadioGroup>
```
**Family:** Parent of `ORadio`; sibling `OFormRadioGroup`. Headless.

### OFormRadioGroup
**Import:** `@/lib/forms/Radio/OFormRadioGroup.vue`
**Use when:** A single-choice radio group bound to one `<OForm>` field.
**Don't use for:** Standalone radios (use `ORadioGroup`).
**Key props:** `name` (**required**), plus full `RadioGroupProps` (`label`, `disabled`, `required`, `orientation`, `name`; `modelValue` bound by the form).
**Slots:** `default` (the `ORadio` children).
**Emits:** none consumer-facing (binds into the form field).
**Example:**
```vue
<OFormRadioGroup name="mode" label="Mode">
  <ORadio value="auto" label="Auto" />
  <ORadio value="manual" label="Manual" />
</OFormRadioGroup>
```
**Family:** Form wrapper for `ORadioGroup`.

---

## Switch family

### OSwitch
**Import:** `@/lib/forms/Switch/OSwitch.vue`
**Use when:** An on/off toggle — instant enable/disable of a setting. Supports custom `checkedValue`/`uncheckedValue` and label placement.
**Don't use for:** A checkbox in a list/form validation context (use `OCheckbox`); choosing among 3+ options (use `ORadioGroup`/`OOptionGroup`).
**Key props:** `modelValue` (`boolean | string | number`), `label`, `labelPosition` (`"left"` | `"right"` default), `size` (`"sm"` | `"md"` default | `"lg"` | `"xl"`), `checkedValue` (custom on-value — string/number only), `uncheckedValue` (custom off-value), `disabled` (default `false`), `required`, `id`, `name`
**Slots:** `label` (custom label content — overrides prop), `tooltip` (info icon inline in label)
**Emits:** `update:modelValue`, `change`
**Example:**
```vue
<OSwitch v-model="enabled" label="Enable alerts" />
```
**Family:** Sibling `OFormSwitch`. Headless.

### OFormSwitch
**Import:** `@/lib/forms/Switch/OFormSwitch.vue`
**Use when:** An on/off toggle bound to one `<OForm>` field.
**Don't use for:** Standalone toggles (use `OSwitch`).
**Key props:** `name` (**required**), plus everything `OSwitch` accepts **except** `modelValue`: `label`, `labelPosition`, `size`, `checkedValue`, `uncheckedValue`, `disabled`, `required`, `id`, `name`.
**Slots:** `label`, `tooltip` (per `OSwitch`).
**Emits:** none consumer-facing (binds into the form field).
**Example:**
```vue
<OFormSwitch name="notifications" label="Email notifications" />
```
**Family:** Form wrapper for `OSwitch`.

---

## OptionGroup family

**What OptionGroup is:** `OOptionGroup` is a **single component that renders an inline group of radios OR checkboxes from an `options` array** (switch via `type`), with a shared label, help text, and error surface. Contrast with `ORadioGroup`/`OCheckboxGroup`, which are containers you fill with individual `ORadio`/`OCheckbox` **child elements** in the slot. Use `OOptionGroup` when the choices come from a data array and you want a compact, list-driven layout with built-in label/help/error; use the Radio/Checkbox groups when you need custom per-item markup as slot children.

### OOptionGroup
**Import:** `@/lib/forms/OptionGroup/OOptionGroup.vue`
**Use when:** Rendering a set of mutually-exclusive (`type="radio"`) or multi-select (`type="checkbox"`) choices from an options array, inline (horizontal/vertical), with label + help text + error styling.
**Don't use for:** Choices needing custom child markup (use `ORadioGroup`/`OCheckboxGroup` with slot children); a dropdown of many options (use `OSelect`); a single toggle (use `OSwitch`/`OCheckbox`).
**Key props:** `options` (`OptionGroupOption[]` = `{ label, value, disabled? }`, **required**), `modelValue` (single `string|number|boolean` for radio, array for checkbox), `type` (`"radio"` default | `"checkbox"`), `orientation` (`"horizontal"` | `"vertical"` default), `label`, `helpText`, `errorMessage`, `error` (default `false`), `disabled` (default `false`), `required`, `size` (`"xs"` | `"sm"` | `"md"` default), `name`
**Slots:** `label` (custom label content), `tooltip` (info icon in label row)
**Emits:** `update:modelValue`, `change`
**Example:**
```vue
<OOptionGroup
  v-model="severity"
  type="radio"
  :options="[
    { label: 'Low', value: 'low' },
    { label: 'High', value: 'high' },
  ]"
  label="Severity"
/>
```
**Family:** Sibling `OFormOptionGroup`. Headless.

### OFormOptionGroup
**Import:** `@/lib/forms/OptionGroup/OFormOptionGroup.vue`
**Use when:** An option group (radio or checkbox) bound to one `<OForm>` field.
**Don't use for:** Standalone option groups (use `OOptionGroup`).
**Key props:** `name` (**required**), plus everything `OOptionGroup` accepts **except** `modelValue`: `options`, `type`, `orientation`, `label`, `helpText`, `disabled`, `required`, `size`, `name`. (`error`/`errorMessage` come from the form field.)
**Slots:** `label`, `tooltip` (per `OOptionGroup`).
**Emits:** none consumer-facing (binds into the form field).
**Example:**
```vue
<OFormOptionGroup
  name="severity"
  type="radio"
  :options="severityOptions"
  label="Severity"
/>
```

---

## Building custom reusable form controls

When no O2 component fits your use case, **build a reusable control** instead of hand-wiring `v-model` + error handling inline. The pattern:

1. **Decide:** Is it generic/reusable (lives in `web/src/lib/forms/*`), or app-specific (lives in `web/src/components/*`)?
2. **Build the headless version first** — a plain component that owns its value via `v-model` (props `modelValue`, emits `update:modelValue`). No form knowledge.
3. **Add the form wrapper** if it will go inside `<OForm>` — a sibling component that `inject(FORM_CONTEXT_KEY)`, renders the headless version inside a `<Field :name="...">`, and wires validation/value/blur to the field.

**Illustrative example — a `SecretInput` control** *(hypothetical: there is no `SecretInput` in this repo; it only shows the shape of a headless control you'd build)*

Say you need a field that accepts a secret token with reveal/copy controls and nothing in O2 fits. The headless version owns its value via `v-model` and has no form knowledge:

```vue
<!-- SecretInput.vue — illustrative, not a real file -->
<template>
  <div class="flex gap-2 items-end">
    <OInput
      :type="revealed ? 'text' : 'password'"
      :model-value="modelValue"
      :label="label"
      :placeholder="placeholder"
      :required="required"
      :disabled="disabled"
      @update:model-value="$emit('update:modelValue', $event)"
      :data-test="dataTest"
    />
    <div class="flex gap-1">
      <OButton
        variant="ghost"
        size="sm"
        :icon-left="revealed ? 'visibility-off' : 'visibility'"
        @click="revealed = !revealed"
        :disabled="!modelValue || disabled"
        :title="t(revealed ? 'common.hide' : 'common.show')"
      />
      <OButton
        variant="ghost"
        size="sm"
        icon-left="content-copy"
        @click="copyToClipboard"
        :disabled="!modelValue || disabled"
        :title="t('common.copy')"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from "vue";
import { useI18n } from "vue-i18n";
import { useToast } from "@/lib/feedback/Toast/useToast";
import OInput from "@/lib/forms/Input/OInput.vue";
import OButton from "@/lib/core/Button/OButton.vue";

interface Props {
  modelValue?: string;
  label?: string;
  placeholder?: string;
  required?: boolean;
  disabled?: boolean;
  dataTest?: string;
}

defineProps<Props>();

defineEmits<{
  "update:modelValue": [value: string];
}>();

const { t } = useI18n();
const toast = useToast();
const revealed = ref(false);

const copyToClipboard = async () => {
  try {
    await navigator.clipboard.writeText(modelValue || "");
    toast.success(t("common.copiedToClipboard"));
  } catch {
    toast.error(t("common.copyFailed"));
  }
};
</script>
```

**To use outside a form:**
```vue
<SecretInput
  :model-value="authToken"
  @update:model-value="authToken = $event"
  label="API Token"
  placeholder="sk_..."
/>
```

**To use inside `<OForm>`**, add the form wrapper (step 3) rather than bridging by
hand: a sibling `OFormSecretInput` that `inject(FORM_CONTEXT_KEY)`, renders the
headless `SecretInput` inside a `<Field :name>`, and wires value/blur/error to the
field — modeled on `OFormInput`. That keeps the field name-bound and schema-owned,
consistent with every other `OForm*` control (see
[forms-validation.md](forms-validation.md)). Reserve the manual
`setFieldValue`/`v-model` bridge for a control that genuinely can't host a form
wrapper (a third-party editor like Monaco).
