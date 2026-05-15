# Quasar Form Components — Migration Checklist

Tracks every file that uses a legacy Quasar form component and the O2 replacement to use.

---

## O2 Form Components — Internal `data-test` Anatomy

> Same pattern as ODialog / ODrawer (see `ODIALOG_ODRAWER_E2E_AUDIT.md`).
> Every consumer adds **one** `data-test` on the component tag (the *parent slug*).
> All internal data-test selectors are derived automatically — no extra attributes needed.

### How it works

All O2 form components use `inheritAttrs: false` + `v-bind="$attrs"` on the root element and `useAttrs()` to expose a `parentDataTest` computed. The info-icon inside the label row automatically gets `data-test="${parentDataTest}-info"`.

| What you write on the tag | What lands in the DOM |
|---|---|
| `<OInput data-test="my-field" />` | Root div → `data-test="my-field"` |
| `<OInput data-test="my-field"><template #tooltip>…</template></OInput>` | Root div → `data-test="my-field"` \| Info icon → `data-test="my-field-info"` |
| `<OSelect data-test="my-sel" />` | Root div → `data-test="my-sel"` |
| `<OSwitch data-test="my-toggle" />` | Root div → `data-test="my-toggle"` |
| `<OSwitch data-test="my-toggle"><template #tooltip>…</template></OSwitch>` | Root div → `data-test="my-toggle"` \| Info icon → `data-test="my-toggle-info"` |

### Components with tooltip slot support

| Component | Root element | `#tooltip` slot → `data-test` auto-derived? |
|---|---|---|
| `OInput` | `<div data-test="…">` | ✅ icon gets `data-test="…-info"` |
| `OTextarea` | `<div data-test="…">` | ✅ |
| `OSelect` | `<div data-test="…">` | ✅ |
| `OSwitch` | `<div data-test="…">` | ✅ (icon appears inline in label row) |
| `ORange` | `<div data-test="…">` | ✅ |
| `OSlider` | `<div data-test="…">` | ✅ |
| `OFile` | `<div data-test="…">` | ✅ |
| `OColor` | `<div data-test="…">` | ✅ |
| `ODate` | `<div data-test="…">` | ✅ |
| `OTime` | `<div data-test="…">` | ✅ |
| `OOptionGroup` | `<div data-test="…">` | ✅ |
| `ODateTimeRange` | `<div data-test="…">` | ✅ |
| `OCheckbox` | `<label data-test="…">` | — (inline element; no stacked label) |
| `ORadio` | `<label data-test="…">` | — |

### e2e Selector Pattern

One `data-test` on the component tag; scope all assertions to the instance:

```ts
// Assert the field renders
await expect(page.locator('[data-test="dashboard-config-limit"]')).toBeVisible();

// Click the tooltip info icon to open it
await page.locator('[data-test="dashboard-config-limit"] [data-test="dashboard-config-limit-info"]').hover();

// For a dialog: scope form fields inside it
await page.locator('[data-test="add-alert-dialog"] [data-test="alert-name-input"]').fill('My Alert');
```

**Rule (formalised):**
`[data-test="<parent-slug>"] [data-test="<parent-slug>-info"]` — the parent slug uniquely identifies the field, the `-info` suffix identifies its tooltip icon inside it.

> This mirrors the ODialog pattern:
> `[data-test="<dialog-slug>"] [data-test="o-dialog-primary-btn"]`

---

## Migration Rules — Read Before You Start

### 1. `data-test` — Never Remove, Always Migrate

`data-test` attributes are the **sole selectors** used by E2E and unit tests. Removing or changing them breaks tests silently.

**Rules:**
- Every `data-test` attribute on a Quasar component **must** be copied verbatim to the O2 replacement.
- If the original was on a `<q-input>`, it goes on `<OInput>`. Same for `<q-select>` → `<OSelect>`, `<q-toggle>` → `<OSwitch>`.
- When the old code had a companion `data-test="...-info"` on a standalone `<q-icon>` (from the div-label wrapper pattern), **drop the manual attribute** — it is now auto-derived from the parent field's `data-test` via the `#tooltip` slot.
- Only explicitly add a `data-test` to a `q-icon` info when the icon lives in an `OSwitch #label` slot (not `#tooltip`) and you need a specific slug that differs from the auto-derived pattern.

**Naming pattern for NEW attributes:** `<module>-<filename>-<descriptor>` in kebab-case.
```
data-test="dashboard-config-limit"      ← value field (OInput)
                                           ↳ auto-derives: data-test="dashboard-config-limit-info"
```

---

### 2. Tooltip / Label Pattern — Prefer Props + `#tooltip` Slot

**Old pattern (bad — manual div label with q-icon + q-tooltip):**
```vue
<div class="row items-center all-pointer-events tw:text-xs tw:font-medium tw:text-input-label tw:mb-1">
  {{ t("dashboard.limit") }}
  <q-icon class="q-ml-xs" size="20px" name="info" data-test="dashboard-config-limit-info" />
  <q-tooltip class="bg-grey-8" anchor="top middle" self="bottom middle">
    {{ t("dashboard.limitTooltip") }}
  </q-tooltip>
</div>
<OInput ... data-test="dashboard-config-limit" />
```

**New pattern (correct — use `label` prop + `#tooltip` slot):**
```vue
<OInput
  :label="t('dashboard.limit')"
  data-test="dashboard-config-limit"
>
  <template #tooltip>
    <q-tooltip class="bg-grey-8" anchor="top middle" self="bottom middle">
      {{ t("dashboard.limitTooltip") }}
    </q-tooltip>
  </template>
</OInput>
```

Same applies for `<OSelect>` and `<OTextarea>`.  
The `#tooltip` slot renders an info icon (`q-icon name="info" size="16px"`) inline in the label row — no extra div needed.

---

### 3. `q-select` Options with `null` Values

`OSelect` supports `null` as a valid option value (maps to internal sentinel `"__o2__null__"`). Pass it normally:
```typescript
const unitOptions = [
  { label: 'Default', value: null },
  { label: 'Bytes', value: 'bytes' },
];
```
Do NOT use `""` (empty string) as a workaround for "no selection" when the original had `null`.

---

### 4. `q-select` with Object Options (emit-value + map-options)

Old Quasar pattern:
```vue
<q-select emit-value map-options option-label="label" option-value="value" />
```
O2 replacement:
```vue
<OSelect labelKey="label" valueKey="value" />
```
OSelect always emits the primitive value (not the full object). `emit-value` + `map-options` are implicit.

---

### 5. `q-select` with Custom `v-slot:option` (icons, colors)

OSelect **does not** support custom option rendering. If the original had icon-only options in the dropdown, migrate to labels-only. The icon display was decorative.  
If the option needs an icon *in the trigger*, use the `#trigger` slot:
```vue
<OSelect v-model="value" :options="opts">
  <template #trigger="{ value }">
    <component :is="getIcon(value)" class="tw:size-4" />
    {{ getLabel(value) }}
  </template>
</OSelect>
```

---

### 6. `q-toggle` with Tooltip (info icon beside label)

Use `label` prop + `#tooltip` slot — the info icon and `data-test="…-info"` are auto-derived:
```vue
<OSwitch
  v-model="val"
  :label="t('dashboard.connectNullValues')"
  data-test="dashboard-config-connect-null-values"
  size="lg"
>
  <template #tooltip>
    <q-tooltip class="bg-grey-8" anchor="top middle" self="bottom middle">
      {{ t("dashboard.connectNullValuesTooltip") }}
    </q-tooltip>
  </template>
</OSwitch>
```
The DOM will contain:
- `data-test="dashboard-config-connect-null-values"` on the root wrapper
- `data-test="dashboard-config-connect-null-values-info"` on the info icon — auto-derived

### 6b. `q-toggle` with Interactive Buttons in the Label

For interactive elements (OButton with click handler) inside the label, use `#label` slot instead of `#tooltip`:
```vue
<OSwitch v-model="val" size="lg">
  <template #label>
    {{ t('dashboard.myLabel') }}
    <OButton variant="ghost" size="icon" @click.stop>
      <template #icon-left><q-icon name="info_outline" /></template>
      <q-tooltip ...>...</q-tooltip>
    </OButton>
  </template>
</OSwitch>
```

---

### 7. `q-toggle` Size and Theme Classes

Drop these when migrating to `<OSwitch>`:
- `class="o2-toggle-button-lg"` — not applicable to OSwitch
- `class="o2-toggle-button-lg-dark"` / `class="o2-toggle-button-lg-light"` — not applicable
- `:class="store.state.theme === 'dark' ? ... : ..."` — OSwitch is theme-aware automatically

---

### 8. Options API — Register in `components: {}`

`<script setup>` components import and auto-register. Components that use `defineComponent` (Options API) must explicitly register O2 components:
```typescript
import OInput from "@/lib/forms/Input/OInput.vue";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import OSwitch from "@/lib/forms/Switch/OSwitch.vue";

export default defineComponent({
  components: { OInput, OSelect, OSwitch },
  // ...
})
```

---

### 9. Inline Pair Layouts (two fields side-by-side)

Replace `style="width: 100%; display: flex; gap: 16px"` wrappers with Tailwind utilities. Each child field needs `tw:flex-1 tw:min-w-0` to prevent x-scroll overflow:
```vue
<!-- Old -->
<div style="width: 100%; display: flex; gap: 16px">
  <div style="width: 50%"><OInput .../></div>
  <div style="width: 50%"><OInput .../></div>
</div>

<!-- New -->
<div class="tw:flex tw:gap-2">
  <OInput class="tw:flex-1 tw:min-w-0" ... />
  <OInput class="tw:flex-1 tw:min-w-0" ... />
</div>
```


---

### 10. OFormInput Validator Pattern — CRITICAL

**Quasar `rules` return `true` on pass. OFormInput `validators` must return `undefined` on pass.**

A direct translation of the Quasar pattern causes the validator to show the string `"true"` as an error when the field is valid, and blocks the form from submitting.

```typescript
// ❌ WRONG — Quasar rules pattern, DO NOT copy into OFormInput validators
:rules="[(val) => !!val.trim() || 'Name is required']"
// ^ returns true (truthy) on pass → OFormInput treats it as an error string

// ✅ CORRECT — OFormInput validators pattern
:validators="[(val: string | number | undefined) => !(val?.toString().trim()) ? t('dashboard.nameRequired') : undefined]"
// ^ returns undefined on pass (no error), error string on fail
```

**Rule:** `validators` functions must return `undefined` (or nothing) when the value is valid, and return the error message string when invalid.

---

## Replacement Map

| Quasar | O2 Replacement | Import |
|---|---|---|
| `<q-checkbox>` | `<OCheckbox>` / `<OCheckboxGroup>` | `@/lib/forms/Checkbox/OCheckbox.vue` |
| `<q-input>` (normal) | `<OInput>` | `@/lib/forms/Input/OInput.vue` |
| `<q-input autogrow>` | `<OTextarea>` | `@/lib/forms/Input/OTextarea.vue` |
| `<q-input type="textarea">` | `<OTextarea>` | `@/lib/forms/Input/OTextarea.vue` |
| `<q-input>` (inside `<OForm>`) | `<OFormInput>` | `@/lib/forms/Input/OFormInput.vue` |
| `<q-input autogrow>` (inside `<OForm>`) | `<OFormTextarea>` | `@/lib/forms/Input/OFormTextarea.vue` |
| `<q-radio>` | `<ORadio>` inside `<ORadioGroup>` | `@/lib/forms/Radio/ORadio.vue` |
| `<q-select>` | `<OSelect>` | `@/lib/forms/Select/OSelect.vue` |
| `<q-select>` (inside `<OForm>`) | `<OFormSelect>` | `@/lib/forms/Select/OFormSelect.vue` |
| `<q-toggle>` | `<OSwitch>` | `@/lib/forms/Switch/OSwitch.vue` |
| `<q-toggle>` (inside `<OForm>`) | `<OFormSwitch>` | `@/lib/forms/Switch/OFormSwitch.vue` |
| `<q-form>` | `<OForm>` | `@/lib/forms/Form/OForm.vue` |
| `<q-file>` | `<OFile>` | `@/lib/forms/File/OFile.vue` |
| `<q-file>` (inside `<OForm>`) | `<OFormFile>` | `@/lib/forms/File/OFormFile.vue` |
| `<q-slider>` | `<OSlider>` | `@/lib/forms/Slider/OSlider.vue` |
| `<q-slider>` (inside `<OForm>`) | `<OFormSlider>` | `@/lib/forms/Slider/OFormSlider.vue` |
| `<q-range>` | `<ORange>` | `@/lib/forms/Range/ORange.vue` |
| `<q-range>` (inside `<OForm>`) | `<OFormRange>` | `@/lib/forms/Range/OFormRange.vue` |
| `<q-date>` | `<ODate>` | `@/lib/forms/Date/ODate.vue` |
| `<q-date>` (inside `<OForm>`) | `<OFormDate>` | `@/lib/forms/Date/OFormDate.vue` |
| `<q-time>` | `<OTime>` | `@/lib/forms/Time/OTime.vue` |
| `<q-time>` (inside `<OForm>`) | `<OFormTime>` | `@/lib/forms/Time/OFormTime.vue` |
| `<q-color>` | `<OColor>` | `@/lib/forms/Color/OColor.vue` |
| `<q-color>` (inside `<OForm>`) | `<OFormColor>` | `@/lib/forms/Color/OFormColor.vue` |
| `<q-option-group>` | `<OOptionGroup>` | `@/lib/forms/OptionGroup/OOptionGroup.vue` |
| `<q-option-group>` (inside `<OForm>`) | `<OFormOptionGroup>` | `@/lib/forms/OptionGroup/OFormOptionGroup.vue` |
| `<q-select-stub>` | — (Quasar test stub only) | N/A — not a runtime component |

> **Rule:** Use the plain `O*` component when the field is not inside an `<OForm>`.
> Use the `OForm*` variant when the field is bound to a tanstack form instance via `<OForm>`.

---

## Key Prop Changes

### q-input → OInput / OTextarea
| q-input prop | OInput / OTextarea prop | Notes |
|---|---|---|
| `v-model` | `v-model` | unchanged |
| `label` | `label` | unchanged |
| `placeholder` | `placeholder` | unchanged |
| `hint` | `helpText` | renamed |
| `error` | `error` | unchanged |
| `error-message` | `error-message` | unchanged |
| `autogrow` | use `<OTextarea>` instead | different component |
| `type="textarea"` | use `<OTextarea>` instead | different component |
| `clearable` | `clearable` | unchanged |
| `readonly` | `readonly` | unchanged |
| `disabled` | `disabled` | unchanged |
| `prefix` / `suffix` | `prefix` / `suffix` slots | unchanged |
| `prepend` slot | `prepend` slot | unchanged |
| `append` slot | `append` slot | unchanged |
| `rules` | removed — use `validators` on `OFormInput` | validation moved to form layer; see **Rule 10** for the correct validator pattern |
| `dense` | removed — use `size="sm"` (h-8 / 32px) | |
| (default height) | `size="md"` → h-9 (36px) | reduced from h-10 in May 2026 — automatic |
| `outlined` / `borderless` | removed — OInput has one style | |

### q-select → OSelect
| q-select prop | OSelect prop | Notes |
|---|---|---|
| `v-model` | `v-model` | unchanged |
| `options` | `options` | unchanged |
| `option-label` | `labelKey` | renamed |
| `option-value` | `valueKey` | renamed |
| `use-input` | `searchable` | renamed |
| `input-debounce` | `searchDebounce` | renamed |
| `emit-value` | removed — always emits the full item unless `valueKey` is set | |
| `map-options` | removed — use `valueKey` / `labelKey` | |
| `use-chips` | removed — always chips in multiple mode | |
| `new-value-mode` | `creatable` | renamed |
| `popup-content-style` | `dropdownStyle` | renamed |
| `@filter` | `@search` | renamed |
| `@new-value` | `@create` | renamed |
| `rules` | removed — use `validators` on `OFormSelect` | |
| (default height) | `size="md"` → h-9 (36px) | reduced from h-10 in May 2026 — automatic, matches OInput |
| — | `maxVisibleChips` (NEW, optional `number`) | hard upper bound on chips shown in the trigger before `+N more` pill. Omit for pure width-aware fit |

> **Multi-select visual refresh (May 2026)** — automatic, no code changes needed:
> - Trigger chips now collapse into a `+N more` pill once they would overflow the trigger row (width-aware via `ResizeObserver`).
> - Each option in the dropdown shows an always-visible **checkbox** (empty / filled) instead of a check-only-when-selected indicator.
> - The dropdown chevron is a single chevron-down that rotates 180° while the popover is open.
> - The dropdown's built-in search box matches the trigger's `size` (`h-8` or `h-9`).
> - The clear ✕ button and dropdown chevron no longer overlap (extra right padding when both are visible).

### q-toggle → OSwitch
| q-toggle prop | OSwitch prop | Notes |
|---|---|---|
| `v-model` | `v-model` | unchanged |
| `label` | `label` | unchanged |
| `true-value` | `checkedValue` | renamed |
| `false-value` | `uncheckedValue` | renamed |
| `left-label` | `labelPosition="left"` | renamed |
| `disable` | `disabled` | renamed |
| `size` | `size` ("sm"\|"md"\|"lg") | now uses string size tokens |

### q-checkbox → OCheckbox
| q-checkbox prop | OCheckbox prop | Notes |
|---|---|---|
| `v-model` | `v-model` | unchanged |
| `label` | `label` | unchanged |
| `true-value` | `checkedValue` | renamed |
| `false-value` | `uncheckedValue` | renamed |
| `disable` | `disabled` | renamed |
| `indeterminate` | `indeterminate` | unchanged |

### q-radio → ORadio + ORadioGroup
Wrap all `<q-radio>` items in a single `<ORadioGroup v-model="...">` and replace each `<q-radio :val="x" label="y">` with `<ORadio value="x" label="y">`.

### q-form → OForm (or remove entirely)

**Decision rule — always check before adding `<OForm>`:**

| Scenario | Migration |
|---|---|
| `<q-form>` with child `<q-input :rules="...">` and a `formRef.validate()` call | → `<OForm>` + `<OFormInput :validators="[...]">` |
| `<q-form>` with no `rules` on children and no `formRef.validate()` call | → **remove the `<q-form>` wrapper entirely** — a plain layout div is correct |
| `<q-form>` wrapping only disabled/readonly inputs | → **remove** — no validation, no OForm needed |

```vue
<!-- ❌ Wrong — OForm for a display-only form -->
<OForm :default-values="{}" @submit="...">
  <OInput disabled :model-value="currentName" label="Current folder" />
</OForm>

<!-- ✅ Correct — just a layout div -->
<div class="tw:flex tw:flex-col tw:gap-2">
  <OInput disabled :model-value="currentName" label="Current folder" />
</div>

<!-- ✅ Correct — OForm when validation is needed -->
<OForm ref="formRef" :default-values="{ name: '' }" @submit="onSubmit">
  <OFormInput name="name" label="Name*"
    :validators="[(val) => !(val?.toString().trim()) ? 'Required' : undefined]"
  />
</OForm>
```

Also replace `<span>&nbsp;</span>` spacing hacks with `tw:gap-2` / `tw:gap-4` on the container.

| q-form usage | OForm equivalent | Notes |
|---|---|---|
| `<q-form ref="formRef" @submit="...">` | `<OForm ref="formRef" :default-values="..." @submit="...">` | OForm requires `defaultValues` — pass the initial object literal |
| `formRef.value.validate()` | `formRef.value.validate()` | unchanged — returns `Promise<boolean>` |
| `formRef.value.resetValidation()` | `formRef.value.resetValidation()` | unchanged |
| `formRef.value.submit()` | `formRef.value.submit()` | unchanged |
| `greedy` | `greedy` | unchanged |
| Child `<q-input :rules="...">` | `<OFormInput :validators="[...]">` | Move per-field rules into `validators` on the OForm-bound field; see **Rule 10** for correct pattern |
| `@submit.prevent` | `@submit` (OForm calls `e.preventDefault()` internally) | drop `.prevent` |
| No validation at all | remove `<q-form>` entirely | use a plain `<div>` for layout |

### q-file → OFile
| q-file prop | OFile prop | Notes |
|---|---|---|
| `v-model` | `v-model` | now binds `File`, `File[]`, or `null` |
| `multiple` | `multiple` | unchanged |
| `accept` | `accept` | unchanged |
| `max-file-size` | `maxFileSize` | renamed (camelCase); also emits `@size-error` |
| `label` | `label` | unchanged |
| `dense` / `filled` / `borderless` / `outlined` | removed — use `size="sm"` for compact | OFile has a single design |
| `counter` | not yet supported — see audit gaps | tracked for follow-up |
| `bottom-slots` | implicit — `helpText` / `errorMessage` render below | drop |

### q-slider → OSlider
| q-slider prop | OSlider prop | Notes |
|---|---|---|
| `v-model` | `v-model` | unchanged |
| `:min` / `:max` / `:step` | `:min` / `:max` / `:step` | unchanged |
| `label` / `label-always` / `label-value` | `:show-value` + `formatValue` | one numeric value rendered to the right of the label |
| `color` / `dark` / `markers` / `snap` / `dense` | removed — design tokens control look | drop |

### q-range → ORange
| q-range prop | ORange prop | Notes |
|---|---|---|
| `v-model` (`{ min, max }`) | `v-model` (`{ min, max }`) | unchanged |
| `:min` / `:max` / `:step` | `:min` / `:max` / `:step` | unchanged |
| `:disable` | `:disabled` | renamed |
| `@change` | `@change` | unchanged — emits `{ min, max }` |

### q-date → ODate
| q-date prop | ODate prop | Notes |
|---|---|---|
| `v-model` (ISO `"YYYY-MM-DD"`) | `v-model` | unchanged |
| `range` | **not yet supported** — see audit gaps | for range, use two `<ODate>` instances bound to `from` / `to` |
| `:locale` | — (native picker uses browser locale) | drop or format the display string externally |
| `size="sm"` | `size="sm"` | unchanged |
| Default slot (custom dialog footer) | — | not supported by native input; drop |

### q-time → OTime
| q-time prop | OTime prop | Notes |
|---|---|---|
| `v-model` | `v-model` | unchanged |
| `with-seconds` / `:with-seconds` | `with-seconds` | unchanged |
| Default slot (custom dialog footer) | — | not supported by native input; drop |

### q-color → OColor
| q-color prop | OColor prop | Notes |
|---|---|---|
| `v-model` (hex `"#RRGGBB"`) | `v-model` | unchanged |
| `@update:model-value` | `@update:model-value` | unchanged |
| `default-view` / `format-model` / `no-header` / `no-footer` / `palette` | — | not exposed — OColor uses native picker + hex input |

### q-option-group → OOptionGroup
| q-option-group prop | OOptionGroup prop | Notes |
|---|---|---|
| `v-model` | `v-model` | unchanged |
| `:options` | `:options` | unchanged — each `{ label, value }` |
| `type` (`"radio"` / `"checkbox"`) | `type` | unchanged |
| `inline` | `orientation="horizontal"` | renamed |
| `color="primary"` | — | drop — primary is the default |
| `dense` / `left-label` / `keep-color` | — | drop — design tokens control look |

---

## Files to Migrate

Legend: `[ ]` = not done · `[x]` = done

---

### q-checkbox → OCheckbox / OCheckboxGroup

- [ ] src/components/AppTable.vue
- [ ] src/components/actionScripts/ActionScripts.vue
- [ ] src/components/alerts/AlertList.vue
- [ ] src/components/alerts/AlertsDestinationList.vue
- [ ] src/components/alerts/ImportAlert.vue
- [ ] src/components/alerts/ImportSemanticGroups.vue
- [ ] src/components/alerts/ImportSemanticGroupsDrawer.vue
- [ ] src/components/alerts/OrganizationDeduplicationSettings.vue
- [ ] src/components/alerts/PipelinesDestinationList.vue
- [ ] src/components/alerts/SemanticFieldGroupsConfig.vue
- [ ] src/components/alerts/TemplateList.vue
- [ ] src/components/alerts/steps/AlertSettings.vue
- [ ] src/components/anomaly_detection/steps/AnomalyAlerting.vue
- [ ] src/components/common/DualListSelector.vue
- [ ] src/components/common/FieldValuesPanel.vue
- [x] src/components/dashboards/AddDashboardFromGitHub.vue
- [x] src/components/dashboards/OverrideConfigPopup.vue
- [x] src/components/dashboards/addPanel/AddAnnotation.vue
- [x] src/components/dashboards/addPanel/PromQLChartConfig.vue
- [x] src/components/dashboards/addPanel/customChartExamples/CustomChartConfirmDialog.vue
- [x] src/components/dashboards/addPanel/dynamicFunction/DynamicFunctionPopUp.vue
- [x] src/components/dashboards/settings/AddSettingVariable.vue
- [ ] src/components/dashboards/settings/VariableCustomValueSelector.vue
- [ ] src/components/dashboards/settings/VariableQueryValueSelector.vue
- [ ] src/components/functions/EnrichmentTableList.vue
- [ ] src/components/functions/FunctionList.vue
- [ ] src/components/iam/groups/GroupRoles.vue
- [ ] src/components/iam/groups/GroupServiceAccounts.vue
- [ ] src/components/iam/groups/GroupUsers.vue
- [ ] src/components/iam/roles/EntityPermissionTable.vue
- [ ] src/components/iam/roles/PermissionsTable.vue
- [ ] src/components/iam/serviceAccounts/ServiceAccountsList.vue
- [ ] src/components/iam/users/User.vue
- [ ] src/components/ingestion/recommended/AWSQuickSetup.vue
- [ ] src/components/ingestion/recommended/AzureConfig.vue
- [ ] src/components/login/GetStarted.vue
- [ ] src/components/logstream/AssociatedRegexPatterns.vue
- [ ] src/components/logstream/schema.vue
- [ ] src/components/pipeline/PipelinesList.vue
- [ ] src/components/pipelines/CreateBackfillJobDialog.vue
- [ ] src/components/pipelines/EditBackfillJobDialog.vue
- [ ] src/components/queries/RunningQueriesList.vue
- [ ] src/components/queries/SummaryList.vue
- [ ] src/components/reports/ReportList.vue
- [ ] src/components/rum/PlayerEventsSidebar.vue
- [ ] src/components/settings/BuiltInModelPricingTab.vue
- [ ] src/components/settings/BuiltInPatternsTab.vue
- [ ] src/components/settings/CipherKeys.vue
- [ ] src/components/settings/ModelPricingList.vue
- [ ] src/components/settings/Nodes.vue
- [ ] src/components/settings/RegexPatternList.vue
- [ ] src/components/shared/filter/FilterCreatorPopup.vue
- [ ] src/enterprise/components/EvalTemplateList.vue
- [ ] src/plugins/correlation/CorrelatedLogsTable.vue
- [ ] src/plugins/correlation/TelemetryCorrelationDashboard.vue
- [ ] src/plugins/traces/ServiceGraphNodeSidePanel.vue
- [ ] src/plugins/traces/metrics/TracesAnalysisDashboard.vue
- [x] src/views/Dashboards/Dashboards.vue
- [x] src/views/Dashboards/addPanel/AddCondition.vue
- [ ] src/views/LogStream.vue

---

### q-input → OInput · files with autogrow/textarea → OTextarea

Files marked `[T]` must use **OTextarea** (they contain `autogrow` or `type="textarea"`).
All others use **OInput** (or **OFormInput** / **OFormTextarea** when inside `<OForm>`).

- [ ] src/components/CustomDateTimePicker.vue
- [ ] src/components/DateTime.vue
- [ ] src/components/DateTimePicker.vue
- [ ] src/components/Header.vue
- [ ] src/components/NLModeQueryBar.vue
- [ ] src/components/O2AIChat.vue
- [ ] src/components/QueryEditor.vue
- [ ] src/components/actionScripts/ActionScripts.vue
- [ ] src/components/actionScripts/EditScript.vue
- [ ] src/components/actionScripts/ScriptToolbar.vue
- [T] src/components/ai_toolsets/AddAiToolset.vue
- [ ] src/components/alerts/AddAlert.vue
- [ ] src/components/alerts/AddDestination.vue
- [ ] src/components/alerts/AddTemplate.vue
- [ ] src/components/alerts/AlertList.vue
- [ ] src/components/alerts/AlertsDestinationList.vue
- [ ] src/components/alerts/DeduplicationConfig.vue
- [ ] src/components/alerts/FieldsInput.vue
- [ ] src/components/alerts/FilterCondition.vue
- [ ] src/components/alerts/ImportAlert.vue
- [ ] src/components/alerts/ImportDestination.vue
- [ ] src/components/alerts/ImportTemplate.vue
- [ ] src/components/alerts/IncidentList.vue
- [T] src/components/alerts/IncidentTimeline.vue
- [ ] src/components/alerts/OrganizationDeduplicationSettings.vue
- [ ] src/components/alerts/PipelinesDestinationList.vue
- [ ] src/components/alerts/PrebuiltDestinationForm.vue
- [ ] src/components/alerts/SemanticGroupItem.vue
- [ ] src/components/alerts/TemplateList.vue
- [ ] src/components/alerts/VariablesInput.vue
- [T] src/components/alerts/steps/Advanced.vue
- [ ] src/components/alerts/steps/AlertSettings.vue
- [ ] src/components/alerts/steps/Deduplication.vue
- [ ] src/components/alerts/steps/QueryConfig.vue
- [ ] src/components/anomaly_detection/steps/AnomalyDetectionConfig.vue
- [ ] src/components/cipherkeys/AddAkeylessType.vue *(also has autogrow — use OTextarea for those fields)*
- [ ] src/components/cipherkeys/AddCipherKey.vue
- [ ] src/components/cipherkeys/AddOpenobserveType.vue *(also has autogrow — use OTextarea for those fields)*
- [ ] src/components/common/BaseImport.vue
- [ ] src/components/common/DualListSelector.vue
- [ ] src/components/common/FieldValuesPanel.vue
- [ ] src/components/common/sidebar/AddFolder.vue
- [ ] src/components/common/sidebar/FieldList.vue
- [ ] src/components/common/sidebar/FolderList.vue
- [ ] src/components/common/sidebar/MoveAcrossFolders.vue
- [ ] src/components/cross-linking/CrossLinkDialog.vue
- [x] src/components/dashboards/AddDashboard.vue
- [x] src/components/dashboards/AddFolder.vue
- [x] src/components/dashboards/MoveDashboardToAnotherFolder.vue
- [x] src/components/dashboards/OverrideConfigPopup.vue
- [x] src/components/dashboards/VariablesValueSelector.vue
- [x] src/components/dashboards/addPanel/AddAnnotation.vue *(mixed — normal + autogrow fields)*
- [x] src/components/dashboards/addPanel/BuildFieldPopUp.vue
- [x] src/components/dashboards/addPanel/ColorBySeriesPopUp.vue
- [x] src/components/dashboards/addPanel/CommonAutoComplete.vue
- [x] src/components/dashboards/addPanel/ConfigPanel.vue *(mixed — normal + autogrow fields)*
- [ ] src/components/dashboards/addPanel/ConfigPanelSearch.vue
- [x] src/components/dashboards/addPanel/FieldList.vue
- [x] src/components/dashboards/addPanel/PromQLChartConfig.vue
- [x] src/components/dashboards/addPanel/ValueMappingPopUp.vue
- [x] src/components/dashboards/addPanel/customChartExamples/CustomChartTypeSelector.vue
- [x] src/components/dashboards/addPanel/dynamicFunction/DynamicFunctionPopUp.vue
- [x] src/components/dashboards/addPanel/dynamicFunction/SelectFunction.vue
- [x] src/components/dashboards/settings/AddSettingVariable.vue
- [x] src/components/dashboards/settings/GeneralSettings.vue
- [x] src/components/dashboards/settings/VariableAdHocValueSelector.vue
- [x] src/components/dashboards/tabs/AddTab.vue
- [ ] src/components/functions/AddEnrichmentTable.vue
- [ ] src/components/functions/AssociatedStreamFunction.vue
- [ ] src/components/functions/EnrichmentSchema.vue
- [ ] src/components/functions/EnrichmentTableList.vue
- [ ] src/components/functions/FunctionList.vue
- [ ] src/components/functions/FunctionsToolbar.vue
- [ ] src/components/functions/StreamRouting.vue
- [ ] src/components/iam/groups/AddGroup.vue
- [ ] src/components/iam/groups/AppGroups.vue
- [ ] src/components/iam/groups/GroupRoles.vue
- [ ] src/components/iam/groups/GroupServiceAccounts.vue
- [ ] src/components/iam/groups/GroupUsers.vue
- [ ] src/components/iam/organizations/AddUpdateOrganization.vue
- [ ] src/components/iam/organizations/ListOrganizations.vue
- [ ] src/components/iam/quota/Quota.vue
- [ ] src/components/iam/roles/AddRole.vue
- [ ] src/components/iam/roles/AppRoles.vue
- [ ] src/components/iam/roles/EditRole.vue
- [ ] src/components/iam/serviceAccounts/AddServiceAccount.vue
- [ ] src/components/iam/serviceAccounts/ServiceAccountsList.vue
- [ ] src/components/iam/users/AddUser.vue
- [ ] src/components/iam/users/MemberInvitation.vue
- [ ] src/components/iam/users/UpdateRole.vue
- [ ] src/components/iam/users/User.vue
- [ ] src/components/ingestion/AIIntegrations.vue
- [ ] src/components/ingestion/Database.vue
- [ ] src/components/ingestion/DevOps.vue
- [ ] src/components/ingestion/Languages.vue
- [ ] src/components/ingestion/MessageQueues.vue
- [ ] src/components/ingestion/Networking.vue
- [ ] src/components/ingestion/Others.vue
- [ ] src/components/ingestion/Security.vue
- [ ] src/components/ingestion/Server.vue
- [ ] src/components/ingestion/recommended/AWSIndividualServices.vue
- [ ] src/components/ingestion/recommended/AWSIntegrationGrid.vue
- [ ] src/components/ingestion/recommended/AzureConfig.vue
- [ ] src/components/ingestion/recommended/AzureIndividualServices.vue
- [ ] src/components/ingestion/recommended/KubernetesConfig.vue
- [ ] src/components/login/GetStarted.vue
- [ ] src/components/login/Login.vue
- [ ] src/components/login/SsoLogin.vue
- [ ] src/components/logstream/AddStream.vue
- [T] src/components/logstream/AssociatedRegexPatterns.vue *(mixed — normal + autogrow fields)*
- [ ] src/components/logstream/LlmEvaluationSettings.vue
- [ ] src/components/logstream/StreamFieldInputs.vue
- [ ] src/components/logstream/schema.vue
- [ ] src/components/pipeline/ImportPipeline.vue
- [ ] src/components/pipeline/NodeForm/CreateDestinationForm.vue
- [ ] src/components/pipeline/NodeForm/LlmEvaluation.vue
- [ ] src/components/pipeline/NodeForm/ScheduledPipeline.vue
- [ ] src/components/pipeline/PipelineEditor.vue
- [ ] src/components/pipeline/PipelinesList.vue
- [ ] src/components/pipeline/StreamSelection.vue
- [ ] src/components/pipelines/CreateBackfillJobDialog.vue
- [ ] src/components/pipelines/EditBackfillJobDialog.vue
- [ ] src/components/promql/components/OperationsList.vue
- [ ] src/components/promql/components/PromQLBuilderOptions.vue
- [ ] src/components/queries/RunningQueries.vue
- [T] src/components/reports/CreateReport.vue *(mixed — normal + autogrow fields)*
- [ ] src/components/reports/ReportList.vue
- [ ] src/components/rum/PlayerEventsSidebar.vue
- [T] src/components/settings/AddRegexPattern.vue
- [ ] src/components/settings/AiToolsets.vue
- [ ] src/components/settings/BuiltInModelPricingTab.vue
- [T] src/components/settings/BuiltInPatternsTab.vue *(mixed — normal + autogrow fields)*
- [ ] src/components/settings/CipherKeys.vue
- [ ] src/components/settings/DiscoveredServices.vue
- [ ] src/components/settings/DomainManagement.vue
- [ ] src/components/settings/General.vue
- [ ] src/components/settings/ImportModelPricing.vue
- [ ] src/components/settings/ImportRegexPattern.vue
- [T] src/components/settings/License.vue
- [ ] src/components/settings/ModelPricingEditor.vue
- [ ] src/components/settings/ModelPricingList.vue
- [ ] src/components/settings/Nodes.vue
- [ ] src/components/settings/OrganizationManagement.vue
- [ ] src/components/settings/OrganizationSettings.vue
- [ ] src/components/settings/RegexPatternList.vue
- [ ] src/components/settings/TestModelMatchDialog.vue
- [ ] src/components/shared/grid/Pagination.vue
- [ ] src/components/shared/grid/Table.vue
- [T] src/enterprise/components/EvalTemplateEditor.vue *(mixed — normal + autogrow fields)*
- [ ] src/enterprise/components/EvalTemplateList.vue
- [ ] src/plugins/correlation/DimensionFilterEditor.vue
- [ ] src/plugins/correlation/TelemetryCorrelationDashboard.vue
- [ ] src/plugins/correlation/TimeRangeEditor.vue
- [ ] src/plugins/logs/FunctionSelector.vue
- [ ] src/plugins/logs/JsonPreview.vue
- [ ] src/plugins/logs/SearchBar.vue
- [ ] src/plugins/logs/TransformSelector.vue
- [ ] src/plugins/logs/components/FieldList.vue
- [ ] src/plugins/metrics/AddToDashboard.vue
- [ ] src/plugins/metrics/MetricList.vue
- [ ] src/plugins/traces/IndexList.vue
- [ ] src/plugins/traces/ServiceGraph.vue
- [ ] src/plugins/traces/ServicesCatalog.vue
- [ ] src/plugins/traces/TraceDetails.vue
- [ ] src/plugins/traces/metrics/TracesAnalysisDashboard.vue
- [ ] src/views/AwsMarketplaceSetup.vue
- [ ] src/views/AzureMarketplaceSetup.vue
- [x] src/views/Dashboards/Dashboards.vue
- [ ] src/views/LogStream.vue
- [ ] src/views/RUM/UploadSourceMaps.vue

---

### q-input-stub → update test stubs to OInput

These spec files import or declare a `q-input-stub`. Change stubs to reference `OInput` instead.

- [ ] src/components/actionScripts/ScriptToolbar.spec.ts
- [ ] src/components/cipherkeys/AddCipherKey.spec.ts
- [ ] src/components/dashboards/addPanel/CommonAutoComplete.spec.ts
- [ ] src/plugins/logs/components/FieldList.spec.ts
- [ ] src/test/unit/helpers/setupTests.ts *(global stub registration — update here once)*

---

### q-radio → ORadio + ORadioGroup

Wrap all sibling `<q-radio>` elements in a single `<ORadioGroup v-model="...">`.
Replace each `<q-radio :val="x" label="y">` → `<ORadio value="x" label="y">`.

- [ ] src/components/ResumePipelineDialog.vue
- [x] src/components/dashboards/settings/TabsDeletePopUp.vue
- [ ] src/components/functions/FunctionsToolbar.vue
- [ ] src/components/logstream/AssociatedRegexPatterns.vue
- [ ] src/components/settings/DomainManagement.vue
- [ ] src/plugins/correlation/TimeRangeEditor.vue

---

### q-select → OSelect / OFormSelect

- [ ] src/components/CustomDateTimePicker.vue
- [ ] src/components/DateTime.vue
- [ ] src/components/DateTimePicker.vue
- [ ] src/components/actionScripts/ActionScripts.vue
- [ ] src/components/actionScripts/EditScript.vue
- [ ] src/components/ai_toolsets/AddAiToolset.vue
- [ ] src/components/alerts/AddAlert.vue
- [ ] src/components/alerts/AddDestination.vue
- [ ] src/components/alerts/AlertHistory.vue
- [ ] src/components/alerts/AlertList.vue
- [ ] src/components/alerts/DeduplicationConfig.vue
- [ ] src/components/alerts/FieldsInput.vue
- [ ] src/components/alerts/FilterCondition.vue
- [ ] src/components/alerts/ImportAlert.vue
- [ ] src/components/alerts/ImportDestination.vue
- [ ] src/components/alerts/ImportTemplate.vue
- [ ] src/components/alerts/PrebuiltDestinationForm.vue
- [ ] src/components/alerts/QueryEditorDialog.vue
- [ ] src/components/alerts/SemanticFieldGroupsConfig.vue
- [ ] src/components/alerts/steps/Advanced.vue
- [ ] src/components/alerts/steps/AlertSettings.vue
- [ ] src/components/alerts/steps/Deduplication.vue
- [ ] src/components/alerts/steps/QueryConfig.vue
- [ ] src/components/anomaly_detection/steps/AnomalyAlerting.vue
- [ ] src/components/anomaly_detection/steps/AnomalyDetectionConfig.vue
- [ ] src/components/cipherkeys/AddAkeylessType.vue
- [ ] src/components/cipherkeys/AddCipherKey.vue
- [ ] src/components/cipherkeys/AddEncryptionMechanism.vue
- [ ] src/components/common/sidebar/InlineSelectFolderDropdown.vue
- [ ] src/components/common/sidebar/SelectFolderDropDown.vue
- [ ] src/components/cross-linking/CrossLinkDialog.vue
- [x] src/components/dashboards/AddDashboardFromGitHub.vue
- [x] src/components/dashboards/OverrideConfigPopup.vue
- [x] src/components/dashboards/SelectDashboardDropdown.vue
- [x] src/components/dashboards/SelectFolderDropdown.vue
- [x] src/components/dashboards/SelectTabDropdown.vue
- [x] src/components/dashboards/addPanel/AddAnnotation.vue
- [x] src/components/dashboards/addPanel/BackGroundColorConfig.vue
- [ ] src/components/dashboards/addPanel/ColorPaletteDropDown.vue
- [x] src/components/dashboards/addPanel/ConfigPanel.vue
- [x] src/components/dashboards/addPanel/DashboardQueryEditor.vue
- [x] src/components/dashboards/addPanel/DrilldownPopUp.vue
- [x] src/components/dashboards/addPanel/FieldList.vue
- [x] src/components/dashboards/addPanel/HistogramIntervalDropDown.vue
- [x] src/components/dashboards/addPanel/MarkLineConfig.vue
- [x] src/components/dashboards/addPanel/PromQLChartConfig.vue
- [x] src/components/dashboards/addPanel/TablePaginationControls.vue
- [x] src/components/dashboards/addPanel/ValueMappingPopUp.vue
- [x] src/components/dashboards/addPanel/dynamicFunction/DynamicFunctionPopUp.vue
- [x] src/components/dashboards/addPanel/dynamicFunction/SelectFunction.vue
- [x] src/components/dashboards/panels/PromQLTableChart.vue
- [x] src/components/dashboards/settings/AddSettingVariable.vue
- [x] src/components/dashboards/settings/SinglePanelMove.vue
- [x] src/components/dashboards/settings/TabsDeletePopUp.vue
- [x] src/components/dashboards/settings/VariableAdHocValueSelector.vue
- [ ] src/components/dashboards/settings/VariableCustomValueSelector.vue
- [ ] src/components/dashboards/settings/VariableQueryValueSelector.vue
- [ ] src/components/functions/AssociatedStreamFunction.vue
- [ ] src/components/functions/StreamRouting.vue
- [ ] src/components/functions/TestFunction.vue
- [ ] src/components/iam/groups/GroupUsers.vue
- [ ] src/components/iam/quota/Quota.vue
- [ ] src/components/iam/roles/EditRole.vue
- [ ] src/components/iam/users/AddUser.vue
- [ ] src/components/iam/users/MemberInvitation.vue
- [ ] src/components/iam/users/UpdateRole.vue
- [ ] src/components/ingestion/recommended/AWSQuickSetup.vue
- [ ] src/components/logstream/AddStream.vue
- [ ] src/components/logstream/LlmEvaluationSettings.vue
- [ ] src/components/logstream/StreamFieldInputs.vue
- [ ] src/components/logstream/schema.vue
- [ ] src/components/pipeline/ImportPipeline.vue
- [ ] src/components/pipeline/NodeForm/AssociateFunction.vue
- [ ] src/components/pipeline/NodeForm/CreateDestinationForm.vue
- [ ] src/components/pipeline/NodeForm/ExternalDestination.vue
- [ ] src/components/pipeline/NodeForm/LlmEvaluation.vue
- [ ] src/components/pipeline/NodeForm/ScheduledPipeline.vue
- [ ] src/components/pipeline/NodeForm/Stream.vue
- [ ] src/components/pipeline/StreamSelection.vue
- [ ] src/components/pipelines/BackfillJobsList.vue
- [ ] src/components/pipelines/PipelineHistory.vue
- [ ] src/components/promql/components/LabelFilterEditor.vue
- [ ] src/components/promql/components/MetricSelector.vue
- [ ] src/components/promql/components/OperationsList.vue
- [ ] src/components/promql/components/PromQLBuilderOptions.vue
- [ ] src/components/queries/RunningQueries.vue
- [ ] src/components/reports/CreateReport.vue
- [ ] src/components/rum/PlayerEventsSidebar.vue
- [ ] src/components/rum/VideoPlayer.vue
- [ ] src/components/settings/BuiltInPatternsTab.vue
- [ ] src/components/settings/DiscoveredServices.vue
- [ ] src/components/settings/DomainManagement.vue
- [ ] src/components/settings/ModelPricingEditor.vue
- [ ] src/components/settings/ServiceIdentitySetup.vue
- [ ] src/components/shared/filter/FilterCreatorPopup.vue
- [ ] src/components/shared/grid/Pagination.vue
- [ ] src/enterprise/components/EvalTemplateEditor.vue
- [ ] src/enterprise/components/billings/Billing.vue
- [ ] src/plugins/correlation/DimensionFiltersBar.vue
- [ ] src/plugins/correlation/TelemetryCorrelationDashboard.vue
- [ ] src/plugins/logs/DetailTable.vue
- [ ] src/plugins/logs/IndexList.vue
- [ ] src/plugins/logs/JsonPreview.vue
- [ ] src/plugins/logs/SearchBar.vue
- [ ] src/plugins/logs/SearchResult.vue
- [ ] src/plugins/logs/TransformSelector.vue
- [ ] src/plugins/metrics/MetricList.vue
- [ ] src/plugins/traces/IndexList.vue
- [ ] src/plugins/traces/LLMInsightsDashboard.vue
- [ ] src/plugins/traces/SearchBar.vue
- [ ] src/plugins/traces/SearchResult.vue
- [ ] src/plugins/traces/ServiceGraph.vue
- [ ] src/plugins/traces/ServicesCatalog.vue
- [ ] src/plugins/traces/TraceDetails.vue
- [ ] src/plugins/traces/TraceEvaluationsView.vue
- [ ] src/views/AwsMarketplaceSetup.vue
- [ ] src/views/AzureMarketplaceSetup.vue
- [x] src/views/Dashboards/ImportDashboard.vue
- [x] src/views/Dashboards/addPanel/AddJoinPopUp.vue
- [ ] src/views/RUM/SourceMaps.vue

---

### q-toggle → OSwitch / OFormSwitch

- [ ] src/components/NLModeQueryBar.vue
- [ ] src/components/ai_toolsets/AddAiToolset.vue
- [ ] src/components/alerts/AddDestination.vue
- [ ] src/components/alerts/AlertInsights.vue
- [ ] src/components/alerts/AlertList.vue
- [ ] src/components/alerts/ImportDestination.vue
- [ ] src/components/alerts/PrebuiltDestinationForm.vue
- [ ] src/components/alerts/QueryEditorDialog.vue
- [ ] src/components/alerts/SemanticGroupItem.vue
- [ ] src/components/alerts/steps/AlertSettings.vue
- [ ] src/components/alerts/steps/QueryConfig.vue
- [ ] src/components/anomaly_detection/steps/AnomalyAlerting.vue
- [x] src/components/dashboards/addPanel/ConfigPanel.vue
- [x] src/components/dashboards/addPanel/DashboardQueryEditor.vue
- [x] src/components/dashboards/addPanel/DrilldownPopUp.vue
- [x] src/components/dashboards/addPanel/PromQLChartConfig.vue
- [x] src/components/dashboards/settings/AddSettingVariable.vue
- [x] src/components/dashboards/settings/GeneralSettings.vue
- [ ] src/components/functions/AssociatedStreamFunction.vue
- [ ] src/components/iam/users/AddUser.vue
- [ ] src/components/logstream/LlmEvaluationSettings.vue
- [ ] src/components/logstream/schema.vue
- [ ] src/components/pipeline/NodeForm/AssociateFunction.vue
- [ ] src/components/pipeline/NodeForm/CreateDestinationForm.vue
- [ ] src/components/pipeline/NodeForm/ExternalDestination.vue
- [ ] src/components/pipeline/NodeForm/LlmEvaluation.vue
- [ ] src/components/pipeline/NodeForm/ScheduledPipeline.vue
- [ ] src/components/pipeline/NodeForm/Stream.vue
- [ ] src/components/reports/CreateReport.vue
- [ ] src/components/reports/ReportList.vue
- [ ] src/components/rum/VideoPlayer.vue
- [ ] src/components/settings/OrganizationSettings.vue
- [ ] src/components/settings/ServiceIdentitySetup.vue
- [ ] src/plugins/logs/DetailTable.vue
- [ ] src/plugins/logs/FunctionSelector.vue
- [ ] src/plugins/logs/IndexList.vue
- [ ] src/plugins/logs/SearchBar.vue
- [ ] src/plugins/logs/SearchHistory.vue
- [ ] src/plugins/logs/TransformSelector.vue
- [ ] src/plugins/traces/SearchBar.vue
- [ ] src/plugins/traces/TraceDetailsSidebar.vue
- [x] src/views/Dashboards/Dashboards.vue

---

### q-form → OForm

- [ ] src/components/actionScripts/ActionScripts.vue
- [ ] src/components/actionScripts/EditScript.vue
- [ ] src/components/actionScripts/ScriptToolbar.vue
- [ ] src/components/ai_toolsets/AddAiToolset.vue
- [ ] src/components/alerts/AddAlert.vue
- [ ] src/components/alerts/AlertList.vue
- [ ] src/components/alerts/steps/AlertSettings.vue
- [ ] src/components/alerts/steps/QueryConfig.vue
- [ ] src/components/anomaly_detection/steps/AnomalyDetectionConfig.vue
- [ ] src/components/cipherkeys/AddCipherKey.vue
- [ ] src/components/common/BaseImport.vue
- [ ] src/components/common/sidebar/AddFolder.vue
- [ ] src/components/common/sidebar/MoveAcrossFolders.vue
- [ ] src/components/cross-linking/CrossLinkDialog.vue
- [x] src/components/dashboards/AddDashboard.vue
- [x] src/components/dashboards/AddFolder.vue
- [x] src/components/dashboards/MoveDashboardToAnotherFolder.vue
- [x] src/components/dashboards/settings/AddSettingVariable.vue
- [x] src/components/dashboards/settings/GeneralSettings.vue
- [x] src/components/dashboards/tabs/AddTab.vue
- [ ] src/components/functions/AddEnrichmentTable.vue
- [ ] src/components/functions/AddFunction.vue
- [ ] src/components/functions/FunctionsToolbar.vue
- [ ] src/components/functions/TestFunction.vue
- [ ] src/components/iam/organizations/AddUpdateOrganization.vue
- [ ] src/components/iam/serviceAccounts/AddServiceAccount.vue
- [ ] src/components/iam/users/AddUser.vue
- [ ] src/components/iam/users/UpdateRole.vue
- [ ] src/components/login/Login.vue
- [ ] src/components/login/SsoLogin.vue
- [ ] src/components/logstream/AddStream.vue
- [ ] src/components/logstream/schema.vue
- [ ] src/components/pipeline/NodeForm/AssociateFunction.vue
- [ ] src/components/pipeline/NodeForm/Condition.vue
- [ ] src/components/pipeline/NodeForm/CreateDestinationForm.vue
- [ ] src/components/pipeline/NodeForm/LlmEvaluation.vue
- [ ] src/components/pipeline/NodeForm/Query.vue
- [ ] src/components/pipeline/NodeForm/Stream.vue
- [ ] src/components/pipeline/StreamSelection.vue
- [ ] src/components/pipelines/CreateBackfillJobDialog.vue
- [ ] src/components/pipelines/EditBackfillJobDialog.vue
- [ ] src/components/reports/CreateReport.vue
- [ ] src/components/settings/AddRegexPattern.vue
- [ ] src/components/settings/General.vue
- [ ] src/plugins/metrics/AddToDashboard.vue
- [x] src/views/Dashboards/ImportDashboard.vue
- [x] src/views/Dashboards/PanelLayoutSettings.vue
- [ ] src/views/RUM/UploadSourceMaps.vue

---

### q-file → OFile / OFormFile

- [ ] src/components/actionScripts/EditScript.vue
- [ ] src/components/alerts/ImportAlert.vue
- [ ] src/components/alerts/ImportSemanticGroups.vue
- [ ] src/components/alerts/ImportSemanticGroupsDrawer.vue
- [ ] src/components/common/BaseImport.vue
- [ ] src/components/functions/AddEnrichmentTable.vue
- [ ] src/components/settings/General.vue
- [x] src/views/Dashboards/ImportDashboard.vue

---

### q-slider → OSlider / OFormSlider

- [ ] src/components/logstream/LlmEvaluationSettings.vue
- [ ] src/components/pipeline/NodeForm/LlmEvaluation.vue

---

### q-range → ORange / OFormRange

- [ ] src/components/anomaly_detection/steps/AnomalyDetectionConfig.vue
- [ ] src/components/settings/Nodes.vue

---

### q-date → ODate / OFormDate

> Files with `range` mode (date range selection) require a paired-input solution — see audit gap notes.

- [ ] src/components/DateTime.vue
- [ ] src/components/DateTimePicker.vue
- [ ] src/components/reports/CreateReport.vue

---

### q-time → OTime / OFormTime

- [ ] src/components/DateTime.vue
- [ ] src/components/DateTimePicker.vue
- [ ] src/components/reports/CreateReport.vue

---

### q-color → OColor / OFormColor

- [ ] src/components/PredefinedThemes.vue
- [x] src/components/dashboards/addPanel/ColorBySeriesPopUp.vue
- [x] src/components/dashboards/addPanel/ValueMappingPopUp.vue
- [ ] src/components/settings/General.vue

---

### q-option-group → OOptionGroup / OFormOptionGroup

- [ ] src/components/functions/AddEnrichmentTable.vue

---

## Totals

| Component | Files |
|---|---|
| q-checkbox | 59 |
| q-input (OInput) | ~155 |
| q-input (OTextarea — autogrow/textarea) | 14 |
| q-input-stub (test stubs) | 5 |
| q-radio | 6 |
| q-select | 105 |
| q-toggle | 43 |
| q-form | 47 |
| q-file | 8 |
| q-slider | 2 |
| q-range | 2 |
| q-date | 3 |
| q-time | 3 |
| q-color | 4 |
| q-option-group | 1 |
| q-select-stub | — (test stubs; no migration needed) |
