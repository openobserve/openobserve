# Forms — Text, Selection & Choice Inputs

Reference for O2's text, selection, and choice form controls under `@/lib/forms/*`. Every prop, emit, slot, and default below was read from the component `.types.ts` and `.vue` source — nothing invented.

## Table of Contents

- [Headless (`OX`) vs form wrapper (`OFormX`)](#headless-ox-vs-form-wrapper-oformx)
- [When to use OX vs OFormX](#when-to-use-ox-vs-oformx)
- [Input family](#input-family) — OInput, OTextarea, OFormInput, OFormTextarea
- [Select family](#select-family) — OSelect, OSelectItem, OSelectGroup, OFormSelect
- [Combobox family](#combobox-family) — OCombobox, OFormCombobox
- [TemplateInput family](#templateinput-family) — OTemplateInput, OTemplateTextarea
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
**Use when:** A single-line free-text field — text, password, email, number, url, tel — with an optional icon, prefix/suffix, clear button, copy button, mask, debounce, and character counter.
**Don't use for:** Multi-line text (use `OTextarea`; `type="textarea"` is gone); choosing from a fixed option list (use `OSelect`); typeahead where free text is also allowed (use `OCombobox`); a toolbar or list search (use `OSearchInput` — never `OInput` plus a search icon, F2).
**Key props:** `modelValue` (`string | number`), `type` (`"text"` default | `"password"` | `"email"` | `"number"` | `"search"` | `"url"` | `"tel"` | `"date"` | `"datetime-local"`; a password always gets the show/hide toggle), `label` (always above the field — there is no inside label, S3), `placeholder`, `helpText`, `errorMessage`, `error` (boolean — error styling only shows when `error` is true; a bare `errorMessage` alone will not surface), `icon` (`IconName`, leading), `prefix`, `suffix` (units go here with the value spaced by the field: `suffix="ms"`, T4), `clearable` (default `false`; on for filters, off for required fields, S6), `readonly`, `copyable` (copy button inside the box, for read-only values), `mono` (IDs, regex, paths, T4), `disabled`, `required` (renders `*` after the label), `autofocus`, `debounce` (ms; flushed on blur), `mask` (`"time"` | `"fulltime"` | `"DD-MM-YYYY"`), `maxlength` (shows counter), `size` (`"xs"` 24 inside table rows only | `"sm"` 28 | `"md"` 32 default | `"lg"` 36 sign-in only — S1, never an `h-*` class), `width` (`"s"` 160 | `"m"` 240 | `"l"` 360 | `"full"` default — S7), `modelModifiers` (`{ number?, trim? }`), `id`, `name`, `autocomplete`.
**Slots:** `icon` (custom leading content when `icon` cannot express it), `icon-end` (trailing content before clear/reveal), `tooltip` (info icon beside the label). `local/o2-controls-api` rejects the removed `label-position`, `revealable`, `field-width`, `disable`, `hint`, `flat`, `color`, `rows`/`autogrow`, and the `#icon-left`/`#icon-right`/`#prefix`/`#suffix`/`#append` slots.
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
**Don't use for:** Single-line input (use `OInput`). It is the only multi-line field: `OInput type="textarea"` was removed. Never put one in a control row — it breaks the shared height (S2).
**Key props:** `modelValue` (`string`), `label`, `placeholder`, `helpText`, `errorMessage`, `error` (boolean — same "error only shows when true" rule as OInput), `rows` (default `3`), `autogrow` (default `false`), `maxRows`, `readonly`, `disabled`, `required`, `autofocus`, `maxlength` (shows counter), `mono` (JSON, VRL, regex, SQL snippets, T4), `width` (`"s"` | `"m"` | `"l"` | `"full"` default, S7), `fill` (stretch to parent height), `id`, `name`, `autocomplete`. One size: `rows` sets the height, so there is no `size` prop; the text is 13 px.
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
**Key props:** `name` (**required** — must match a key in `OForm` `defaultValues`), plus everything `OInput` accepts **except** `modelValue`, `error`, `errorMessage` (auto-bound). So: `type`, `label`, `placeholder`, `helpText`, `icon`, `prefix`, `suffix`, `clearable`, `copyable`, `mono`, `disabled`, `readonly`, `required`, `debounce`, `mask`, `maxlength`, `size`, `width`, `id`, `autocomplete`, etc. (`min`/`max`/`step` are not forwarded, so native constraint validation never fights the Zod schema.)
**Slots:** forwards `icon`, `icon-end`, `tooltip` to `OInput`, plus its own `error` slot.
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
**Key props:** `name` (**required**), plus everything `OTextarea` accepts **except** `modelValue`, `error`, `errorMessage`: `label`, `placeholder`, `helpText`, `rows`, `autogrow`, `maxlength`, `mono`, `disabled`, `readonly`, `required`, `width`, `id`, `autocomplete`.
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
**Use when:** Choosing one or many values from a **known option list** (S5: more than five options, or a list that comes from data) — single or `multiple`, searchable past eight options, `creatable`, grouped, virtualized, with chips, "Select all", per-option icons, descriptions and counts. As a toolbar filter use `variant="filter"` (below).
**Don't use for:** Free-text entry with suggestions where the typed text itself is the value (use `OCombobox`); a plain text field (use `OInput`); a small set of always-visible mutually-exclusive/multi options laid out inline (use `OOptionGroup` / `ORadioGroup` / `OCheckboxGroup`).
**Key props:** `modelValue` (`SelectValue | SelectValue[]`, where `SelectValue = string | number | boolean | null`), `options` (`SelectOption[]` — `{ label, value?, disabled?, header?, headerCount?, subLabel? (the 2-line description), suffix?, count? (tabular, right-aligned) }`; or the default slot for custom items), `multiple` (default `false`), `maxChips` (default `2`, then "+N", S5), `searchable` (`"auto"` default = search box past eight options | `true` | `false`), `searchDebounce`, `hideSelected`, `selectAll` (multi listbox only), `creatable` (an `Add "x"` row for an unlisted typed value — emits `create`), `searchPlaceholder`, `labelKey`/`valueKey`/`iconKey`, `label`, `required`, `placeholder`, `errorMessage`, `error`, `clearable` (field default `false`; filter default `true`, S6), `disabled`, `size` (`"sm"` 28 | `"md"` 32 default | `"lg"` 36 sign-in only, S1), `variant` (`"field"` default | `"filter"`), `anyLabel` / `summary` (filter only), `width` (`"s"` | `"m"` | `"l"` | `"full"`, S7; a field defaults to full, a filter sizes to its text from 160), `loading` (spinner replaces the chevron; a loading row while there are no options), `helpText`, `id`, `name`.
**Menu (O4):** as wide as the trigger (200–360) and frozen at the size it opened with, so filtering never shrinks or moves it; the list is at most 232 px with 32 px rows and 28 px group labels; "No matches for …" with Clear search shows in place. Rows are `text-compact`, the menu `rounded-menu`, the trigger `rounded-default`.
**Slots:** `default` (render `OSelectItem`/`OSelectGroup`), `trigger` (`{ value }`), `chip` (`{ label, value }`), `option` (`{ option }`), `empty`, `before-options`, `after-options`, `icon` (leading icon in the trigger), `tooltip`. Removed and rejected by `local/o2-controls-api`: `label-position` and `appearance` (→ `variant="filter"`), `max-visible-chips` (→ `max-chips`), `dropdown-style`, `row-click-single-select`, `pin-selected-in-groups`, `option-tooltip`, the `#icon-left` and `#selected-item` slots, and `disable`/`hint`/`color` on `OFormSelect`.

**Filter select (F3, S6).** `variant="filter"` puts the label inside — "Status: Any" — and never gets a label row. Picking narrows it: the trigger shows the value ("Status: Firing") or, past one pick or with `summary="count"`, the count ("Status: 3") on the accent tint with ✕ to clear. A required config select that always holds a value passes `:clearable="false"` and stays untinted. Up to four filters in a toolbar; the rest go behind "More filters" (F10).

```vue
<OSelect v-model="status" variant="filter" :label="t('alerts.status')" :options="statusOptions" />
```
**Emits:** `update:modelValue`, `clear`, `search`, `create`, `open`, `close`, `blur`, `change`, `keydown`
**Example:**

```vue
<OSelect
  v-model="stream"
  :options="streamOptions"
  :label="t('logs.stream')"
  :placeholder="t('logs.selectStream')"
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
**Key props:** `name` (**required**), plus everything `OSelect` accepts **except** `modelValue`, `error`, `errorMessage`. Note: the wrapper mirrors OSelect's `searchable: "auto"` and `clearable: undefined` defaults, because an omitted boolean would otherwise be cast to `false` and forwarded. Common: `options`, `label`, `placeholder`, `multiple`, `searchable`, `clearable`, `disabled`, `required`, `size`, `width`, `labelKey`, `valueKey`, `selectAll`, `creatable`, `hideSelected`.
**Slots:** forwards `default`, `empty`, `before-options`, `after-options`, `tooltip`, `icon`, `trigger` to `OSelect`.
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
**Don't use for:** Selecting from a fixed set where only listed values are valid (use `OSelect` — it emits the option's value, not free text, and supports multiple/groups/chips); a text field that stays a plain field until the user types `{{`, where the pick splices a `{{NAME}}` token at the caret instead of replacing the text (use `OTemplateInput` / `OTemplateTextarea`). Difference from `OSelect`: **OCombobox's model is the input string and free text is allowed**; **OSelect's model is a chosen option value from the list** and there is no free-text value (its `searchable`/`creatable` still commit list values or explicit created entries).
**Key props:** `modelValue` (`string` — the text in the input), `items` (`ComboboxOption[]` = `{ label, value }`, default `[]`), `placeholder`, `label`, `searchRegex` (regex string; first non-undefined capture group becomes the search needle; whole input if omitted), `valueReplaceFn` (`(option) => string`, default `option => option.value`), `disabled` (default `false`), `required`, `size` (`"sm"` 28 | `"md"` 32 default, S1), `error` (default `false`), `errorMessage`, `helpText`, `debounce` (ms, default `0`), `id`, `name`. The label sits above the field; the 40 px inside-label mode is gone (S1, S3).
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
**Key props:** `name` (**required**), plus everything `OCombobox` accepts **except** `modelValue`, `error`, `errorMessage`: `items`, `label`, `placeholder`, `searchRegex`, `valueReplaceFn`, `disabled`, `required`, `size`, `debounce`, `helpText`, `id`.
**Slots:** `label`, `tooltip` (forwarded).
**Emits:** none consumer-facing (binds into the form field).
**Example:**

```vue
<OFormCombobox name="field" :items="fieldSuggestions" label="Field" />
```

**Family:** Form wrapper for `OCombobox`.

---

## TemplateInput family

### OTemplateInput

**Import:** `@/lib/forms/TemplateInput/OTemplateInput.vue`
**Use when:** A single-line text or URL field whose value may hold `{{NAME}}` template tokens that are substituted later (a Synthetics starting URL or step value, an alert template). Wraps `OInput` unchanged; typing `{{` opens a portalled, virtualised list of `suggestions` filtered case-insensitively by what follows the braces, and Enter / Tab / a row click splice `{{NAME}}` (stored spelling) over the open token at the caret. ArrowUp/ArrowDown move with wrap, Escape and blur close, moving the caret away closes. With `values` set, the value of the closed token under the caret peeks above the field after 300 ms. Without `suggestions` it behaves as a plain `OInput`.
**Don't use for:** Typeahead where the pick replaces the whole text and the list opens on focus (use `OCombobox`); a plain field with no template tokens (use `OInput`); multi-line prompt text (use `OTemplateTextarea`); `debounce`, `mask`, `modelModifiers`, or any `type` other than `"text"` / `"url"` — those desynchronise the caret from the emitted text and are omitted from the props type.
**Key props:** `modelValue` (`string`), `suggestions` (`TemplateSuggestion[]` = `{ name }` plus any caller fields, display order preserved; absent or empty = plain field), `values` (`Record<string, string>`; present turns the peek on), `type` (`"text"` default | `"url"`), plus every other `OInput` prop re-bound by name (`label`, `placeholder`, `helpText`, `errorMessage`, `error`, `icon`, `prefix`, `suffix`, `clearable`, `readonly`, `disabled`, `required`, `autofocus`, `maxlength`, `mono`, `size`, `width`, `id`, `name`, `autocomplete`). `$attrs` (`data-test`, `class`, undeclared listeners such as `@clear` / `@paste`) land on the field root, never on the wrapper.
**Slots:** `icon`, `icon-end`, `tooltip` (forwarded to `OInput`); `suggestion` (scoped, `{ suggestion, active }`, generic over the suggestion type — default renders `{{name}}` in mono).
**Emits:** `update:modelValue` (`string`), `select` (`string` — the inserted name), `focus`, `blur`, `keydown`
**data-test:** the consumer's id on the field root, `-field` on the native input, `-suggest` on the popover content, `-suggest-item-{name}` per row (name as stored), `-peek` on the peek. Rows render in a portal — query `document.body`.
**Example:**

```vue
<OTemplateInput
  v-model="url"
  type="url"
  icon="link"
  :label="t('synthetics.startingUrl')"
  data-test="synthetics-create-url-input"
  :suggestions="variableSuggestions"
  @blur="validateUrl"
>
  <template #suggestion="{ suggestion, active }">
    <VariableSuggestionRow :suggestion="suggestion" :active="active" />
  </template>
</OTemplateInput>
```

**Family:** Sibling `OTemplateTextarea` (multi-line). Shared sub-components `OTemplateOverlay` (peek box + list) and `OTemplateSuggestList`, plus the composable `useTemplateSuggest` (exports `CLOSED_TOKEN_RE`, `OPEN_TOKEN_RE`, `tokenAtCaret`, `tokenFor`), are internal to the family. Headless.

### OTemplateTextarea

**Import:** `@/lib/forms/TemplateInput/OTemplateTextarea.vue`
**Use when:** A multi-line field with the same `{{` suggestion list and optional peek as `OTemplateInput` — an LLM prompt message with declared variables. Wraps `OTextarea` unchanged (`autogrow`, `maxRows`, `fill` all work).
**Don't use for:** Single-line values (use `OTemplateInput`); free text with no template tokens (use `OTextarea`); JSON or code where an unrelated `{{` would open the list.
**Key props:** `modelValue` (`string`), `suggestions`, `values` (as `OTemplateInput`), plus every `OTextarea` prop re-bound by name (`label`, `placeholder`, `helpText`, `errorMessage`, `error`, `rows`, `autogrow`, `maxRows`, `readonly`, `disabled`, `required`, `autofocus`, `maxlength`, `mono`, `width`, `fill`, `id`, `name`, `autocomplete`).
**Slots:** `tooltip`, `append` (forwarded to `OTextarea`); `suggestion` (scoped, `{ suggestion, active }`).
**Emits:** `update:modelValue` (`string`), `select` (`string`), `focus`, `blur`, `keydown`
**Example:**

```vue
<OTemplateTextarea
  v-model="message.content"
  :rows="1"
  :max-rows="5"
  autogrow
  :suggestions="promptVariables"
  :values="variableValues"
  :data-test="`ai-playground-message-input-${message.id}`"
/>
```

**Family:** Sibling `OTemplateInput` (single-line). Headless.

---

## SearchInput

### OSearchInput

**Import:** `@/lib/forms/SearchInput/OSearchInput.vue`
**Use when:** The one search field of a list, toolbar, panel or menu (F1, F2): the first control on the left of a list toolbar, the search pinned at the top of a menu. Never `OInput` plus a search icon, and never two search boxes for one list.
**Don't use for:** A general text field with label/validation (use `OInput`); selecting from options (use `OSelect`); typeahead suggestions (use `OCombobox`); explorers, which use the query bar.
**Key props:** `modelValue` (`string`, default `""`; the page mirrors it to the URL, F11), `placeholder` ("Search <objects>", sentence case; default "Search..."), `size` (`"md"` 32 default in toolbars | `"sm"` 28 in panels and menus — S1, S2; never an `h-*` class), `width` (`"full"` default | `"list"` caps at 280 | `"scope"` caps at 360 — F2), `scope` + `scopeOptions` (`{ value, label, icon?, tooltip?, dataTest? }[]`; two segments inside the box such as "This folder | All folders", emits `update:scope`), `shortcut` ("/" focuses the field and the box shows the key while empty — KB1; defaults on at md, off at sm; one per page), `debounce` (ms, default `0` — a client-side filter answers at once; a search that asks the server passes `:debounce="200"`), `loading` (a spinner replaces the glyph), `disabled`. Always clearable; Escape clears the text first and only an empty field lets Escape reach the overlay behind.
**Slots:** none. The old `#icon-right` scope slot is replaced by `scope-options`; `clearable` and `autofocus` are rejected by `local/o2-controls-api`.
**Emits:** `update:modelValue`, `update:scope`, `clear`
**Example:**

```vue
<OSearchInput
  v-model="search"
  width="scope"
  :placeholder="t('dashboard.search')"
  :scope="acrossFolders ? 'all' : 'this'"
  :scope-options="scopeOptions"
  data-test="dashboard-search"
  @update:scope="(v) => (acrossFolders = v === 'all')"
/>
```

**Family:** No form wrapper — it wraps `OInput` internally. Standalone/headless only.

---

## Checkbox family

### OCheckbox

**Import:** `@/lib/forms/Checkbox/OCheckbox.vue`
**Use when:** On/off saved with the form (S5), multi-choice lists such as facets, row selection — a single boolean (or tri-state `indeterminate`) checkbox, or a member of an `OCheckboxGroup` (set `value` and it reads the group's checked array). Supports custom `trueValue`/`falseValue`/`indeterminateValue`. On/off that applies at once is an `OSwitch`.
**Don't use for:** A set of related checkboxes with a shared array model (wrap them in `OCheckboxGroup`, or use `OOptionGroup type="checkbox"` for a list-driven layout); an on/off toggle switch (use `OSwitch`).
**Key props:** `modelValue` (`boolean | "indeterminate" | string | number | (string|number)[]`), `value` (member value in a group; excludes boolean by design), `label` (13 px), `description` (12 px tertiary line under the label), `indeterminate` (mixed select-all state), `trueValue`/`falseValue`/`indeterminateValue` (custom-value mode), `disabled` (default `false`), `required`, `id`, `name`. One 16 px box with `rounded-chip` (S9): there is no `size`, no `color` and no `val` — `local/o2-controls-api` rejects them.
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
**Key props:** `name` (**required**), plus everything `OCheckbox` accepts **except** `modelValue`: `value`, `label`, `description`, `indeterminate`, `trueValue`, `falseValue`, `indeterminateValue`, `disabled`, `required`, `id`, `name`.
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
**Key props:** `value` (`string | number | boolean` — this radio's value, compared against the group's `modelValue`), `label`, `description` (12 px line under the label), `variant` (`"default"` | `"card"` for choices that carry an explanation), `disabled` (default `false`), `id`. One 16 px circle (S9): `size` and `val` are rejected by `local/o2-controls-api`. Content that depends on the choice reserves the tallest option's height (O4).
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
**Use when:** On/off that applies at once and confirms with a toast (S5, V3) — setting rows, instant enable/disable. Inside a form saved with a button, use a checkbox; never as a filter (F6).
**Don't use for:** A checkbox in a list/form validation context (use `OCheckbox`); choosing among 3+ options (use `ORadioGroup`/`OOptionGroup`).
**Key props:** `modelValue` (`boolean`), `label` (says what is on, not "Enable"), `description`, `labelPosition` (`"end"` default in forms | `"start"` for setting rows with the switch at the row end), `disabled` (default `false`), `required`, `id`, `name`, `offTone` (`"brand"` default | `"neutral"`: Off drawn in grey, for setting rows where a brand-coloured Off reads as On), `stateText` (default `false`: prints On / Off after the track). One 28 × 16 track with a 12 px thumb (S9): `size`, `checkedValue` and `uncheckedValue` are gone and rejected by `local/o2-controls-api`.
**Slots:** `label` (custom label content — overrides prop), `tooltip` (info icon inline in label)
**Emits:** `update:modelValue`, `change`
**Example:**

```vue
<OSwitch v-model="enabled" label="Enable alerts" />
```

**Family:** Sibling `OFormSwitch`. Headless.
In an `OSettingRow`, pass `off-tone="neutral" state-text` and no `label`; the row's label names the switch.

### OFormSwitch

**Import:** `@/lib/forms/Switch/OFormSwitch.vue`
**Use when:** An on/off toggle bound to one `<OForm>` field.
**Don't use for:** Standalone toggles (use `OSwitch`).
**Key props:** `name` (**required**), plus everything `OSwitch` accepts **except** `modelValue`: `label`, `description`, `labelPosition`, `disabled`, `required`, `id`, `name`, `offTone`, `stateText`.
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
**Key props:** `options` (`OptionGroupOption[]` = `{ label, value, disabled? }`, **required**), `modelValue` (single `string|number|boolean` for radio, array for checkbox), `type` (`"radio"` default | `"checkbox"`), `orientation` (`"horizontal"` | `"vertical"` default), `label`, `helpText`, `errorMessage`, `error` (default `false`), `disabled` (default `false`), `required`, `name` (one size: the 16 px box or circle, S9)
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
**Key props:** `name` (**required**), plus everything `OOptionGroup` accepts **except** `modelValue`: `options`, `type`, `orientation`, `label`, `helpText`, `disabled`, `required`, `name`. (`error`/`errorMessage` come from the form field.)
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

**Illustrative example — a `SecretInput` control** _(hypothetical: there is no `SecretInput` in this repo; it only shows the shape of a headless control you'd build)_

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
        icon-only
        :icon="revealed ? 'visibility-off' : 'visibility'"
        :pressed="revealed"
        :label="t(revealed ? 'common.hide' : 'common.show')"
        :disabled="!modelValue || disabled"
        @click="revealed = !revealed"
      />
      <!-- Every copy action is OCopyButton: inline check, no toast; copying never needs a reveal. -->
      <OCopyButton
        size="md"
        :value="modelValue ?? ''"
        :disabled="!modelValue || disabled"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from "vue";
import { useI18n } from "vue-i18n";
import OInput from "@/lib/forms/Input/OInput.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OCopyButton from "@/lib/core/CopyButton/OCopyButton.vue";

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
const revealed = ref(false);
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
