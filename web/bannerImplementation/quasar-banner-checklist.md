# Quasar Banner ΓÇö Migration Checklist

Tracks every file that uses `<q-banner>` and the O2 replacement to use.

## Replacement Map

| Quasar | O2 Replacement | Import |
|---|---|---|
| `<q-banner>` | `<OBanner>` | `@/lib/feedback/Banner/OBanner.vue` |

> **Rule**: Replace every `<q-banner>` with `<OBanner variant="...">`. The `variant` prop encodes the visual intent. See `quasar-banner-migration.md` for full prop mapping and code examples.

---

## Key Structural Change

Every `q-banner` migration requires:
1. Replacing `class="bg-negative text-white"` / `class="bg-warning"` etc. with `variant="error"` / `variant="warning"` etc.
2. Renaming `#avatar` slot ΓåÆ `#icon` slot (or using `icon` prop shorthand for simple icon-only slots)
3. Dropping `rounded` ΓÇö baked into design tokens
4. Dropping theme-aware `:class` bindings ΓÇö design tokens handle dark/light automatically

```
BEFORE:
<q-banner class="bg-negative text-white">
  <template #avatar>
    <q-icon name="error" />
  </template>
  {{ errorMessage }}
</q-banner>

AFTER:
<OBanner variant="error" icon="error">
  {{ errorMessage }}
</OBanner>
```

---

## Key Prop Changes

| `q-banner` prop | `OBanner` prop | Notes |
|---|---|---|
| `class="bg-negative text-white"` | `variant="error"` | Replace ΓÇö drop manual color class |
| `class="bg-warning ..."` | `variant="warning"` | Replace ΓÇö drop manual color class |
| `class="note-info"` | `variant="info"` | Replace ΓÇö drop custom CSS class |
| `:class="[theme === 'dark' ? ...]"` | `variant="warning"` | Replace ΓÇö design tokens handle dark/light |
| Plain text default slot `{{ someString }}` | `:content="someString"` | **Promote to prop** ΓÇö cleaner self-closing tag |
| Rich markup default slot | `default` slot | Keep as slot ΓÇö slot wins over `content` prop if both present |
| `inline` | `inline-actions` | Rename |
| `dense` | `dense` | Direct |
| `rounded` | ΓÇö | **Drop** ΓÇö baked into all variants |
| `data-test` | `data-test` | Direct |
| `v-if` | `v-if` on `<OBanner>` | Direct |

## Key Slot Changes

| `q-banner` slot | `OBanner` slot | Notes |
|---|---|---|
| `#avatar` / `v-slot:avatar` with `<q-icon name="x" />` only | `icon="x"` prop | Collapse to shorthand prop |
| `#avatar` / `v-slot:avatar` with custom content | `#icon` slot | Rename |
| `default` | `default` | Direct ΓÇö no change |
| `#action` | `#actions` | Rename (not used in current codebase) |

---

## Files to Migrate

Legend: `[ ]` = not done ┬╖ `[x]` = done

---

### Vue Component Files (5 files ┬╖ 6 usages)

#### src/plugins/

- [ ] `src/plugins/logs/SearchJobInspector.vue`
  - **Variant**: `error`
  - **Props to migrate**: `v-if`, `class="bg-negative text-white tw:mb-[0.625rem]"` ΓåÆ `variant="error"` (keep `tw:mb-[0.625rem]` as layout class), `data-test`
  - **Content**: `{{ errorMessage }}` is a plain string ΓåÆ use `:content="errorMessage"`
  - **Slots to migrate**: `#avatar` with `<q-icon name="error" />` ΓåÆ `icon="error"` prop
  - **Result**: self-closing `<OBanner variant="error" icon="error" :content="errorMessage" class="tw:mb-[0.625rem]" data-test="inspector-error-banner" />`
  - **Pattern**: Error 1 from migration guide

- [ ] `src/plugins/traces/TraceDAG.vue`
  - **Variant**: `error`
  - **Props to migrate**: `class="bg-negative text-white"` ΓåÆ `variant="error"`
  - **Content**: `Failed to load DAG: {{ error }}` is a plain string ΓåÆ use `:content="`Failed to load DAG: ${error}`"`
  - **Slots to migrate**: `#avatar` with `<q-icon name="error" color="white" />` ΓåÆ `icon="error"` prop (color handled by variant)
  - **Result**: self-closing `<OBanner variant="error" icon="error" :content="`Failed to load DAG: ${error}`" />`
  - **Pattern**: Error 1 from migration guide

#### src/components/settings/

- [ ] `src/components/settings/ServiceIdentitySetup.vue`
  - **Variant**: `warning`
  - **Props to migrate**: `rounded` (drop), `class="tw:bg-amber-50 dark:..."` ΓåÆ `variant="warning"`, `data-test`
  - **Content**: Rich markup (`v-for` list) ΓåÆ keep as **default slot** (cannot use `content` prop)
  - **Slots to migrate**: `#avatar` with `<q-icon name="warning" color="warning" />` ΓåÆ `icon="warning"` prop
  - **Pattern**: Warning 2 from migration guide

#### src/components/pipeline/NodeForm/

- [ ] `src/components/pipeline/NodeForm/Condition.vue`
  - **Variant**: `info`
  - **Props to migrate**: `inline` ΓåÆ `inline-actions` (can be dropped if no actions slot), `dense`, `class="note-info"` ΓåÆ `variant="info"`
  - **Slots to migrate**: None ΓÇö icons are inline inside the default slot content
  - **Pattern**: Info 3 from migration guide

- [ ] `src/components/pipeline/NodeForm/AssociateFunction.vue`
  - **Variant**: `info`
  - **Props to migrate**: `inline` ΓåÆ `inline-actions` (can be dropped if no actions slot), `dense`, `class="note-info"` ΓåÆ `variant="info"`
  - **Slots to migrate**: None ΓÇö icons are inline inside the default slot content
  - **Pattern**: Info 3 from migration guide

#### src/components/

- [ ] `src/components/ConfirmDialog.vue`
  - **Variant**: `warning`
  - **Props to migrate**: `:class="[theme === 'dark' ? ... : ...]"` ΓåÆ `variant="warning"` (entire dynamic class expression dropped)
  - **Content**: `{{ warningMessage }}` is a plain string ΓåÆ use `:content="warningMessage"`
  - **Slots to migrate**: `v-slot:avatar` with `<q-icon name="warning" :class="[theme-aware]" size="24px" />` ΓåÆ `icon="warning"` prop (size + color handled by variant)
  - **Result**: self-closing `<OBanner variant="warning" icon="warning" :content="warningMessage" />`
  - **Pattern**: Warning 4 from migration guide
  - **Extra**: Remove `store.state.theme` import/usage from this component if no longer needed after migration

---

## Migration Summary

| Variant | Files | q-banner usages |
|---|---|---|
| `error` | 2 | 2 |
| `warning` | 2 | 2 |
| `info` | 2 (pipeline) | 2 |
| `success` | 0 | 0 |
| `default` | 0 | 0 |
| **Total** | **5** | **6** |

---

## Pre-Migration Checklist

Before migrating any file, verify:

- [ ] `OBanner.vue` exists at `web/src/lib/feedback/Banner/OBanner.vue`
- [ ] `OBanner` is tested (at minimum: renders correct ARIA role per variant, applies correct CSS class per variant, renders `#icon` slot, renders `default` slot)
- [ ] Design tokens for all 5 variants are defined in the O2 Tailwind config
