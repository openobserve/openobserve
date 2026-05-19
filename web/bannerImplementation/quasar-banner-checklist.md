# Quasar Banner — Migration Checklist

Tracks every file that uses `<q-banner>` and the O2 replacement to use.

> **Re-audited May 19, 2026**: 8 usages across 7 files. 0 migrated. 2 new files discovered. `OBanner.vue` exists and is ready.

## Replacement Map

| Quasar | O2 Replacement | Import |
|---|---|---|
| `<q-banner>` | `<OBanner>` | `@/lib/feedback/Banner/OBanner.vue` |

> **Rule**: Replace every `<q-banner>` with `<OBanner variant="...">`. The `variant` prop encodes the visual intent. See `quasar-banner-migration.md` for full prop mapping and code examples.

---

## Key Structural Change

Every `q-banner` migration requires:
1. Replacing `class="bg-negative text-white"` / `class="bg-warning"` etc. with `variant="error"` / `variant="warning"` etc.
2. Renaming `#avatar` slot → `icon` prop shorthand (all current usages are plain `<OIcon>` — collapse to `icon="..."` prop)
3. Dropping `rounded` — baked into design tokens
4. Dropping theme-aware `:class` bindings — design tokens handle dark/light automatically

> **Note**: All `#avatar` slots already use `<OIcon>` — no `<q-icon>` remains in any avatar slot.

```
BEFORE:
<q-banner class="bg-negative text-white">
  <template #avatar>
    <OIcon name="error" size="sm" />
  </template>
  {{ errorMessage }}
</q-banner>

AFTER:
<OBanner variant="error" icon="error" :content="errorMessage" />
```

---

## Key Prop Changes

| `q-banner` prop | `OBanner` prop | Notes |
|---|---|---|
| `class="bg-negative text-white"` | `variant="error"` | Replace — drop manual color class |
| `class="bg-orange-1 text-orange-9"` | `variant="info"` | Replace — drop Quasar palette class |
| `class="note-info"` | `variant="info"` | Replace — drop custom CSS class |
| `:class="[theme === 'dark' ? ...]"` | `variant="warning"` | Replace — design tokens handle dark/light |
| Plain text default slot `{{ someString }}` | `:content="someString"` | **Promote to prop** — cleaner self-closing tag |
| Rich markup default slot | `default` slot | Keep as slot — slot wins over `content` prop if both present |
| `inline` | — | **Drop** — no `#actions` slot used in any current file |
| `dense` | `dense` | Direct |
| `rounded` | — | **Drop** — baked into all variants |
| `style="font-size: 13px"` | — | **Drop** — OBanner default sizing is adequate |
| `data-test` | `data-test` | Direct |
| `v-if` | `v-if` on `<OBanner>` | Direct |

## Key Slot Changes

| `q-banner` slot | `OBanner` prop/slot | Notes |
|---|---|---|
| `#avatar` / `v-slot:avatar` with `<OIcon name="x" size="sm" />` only | `icon="x"` prop | Collapse to shorthand prop — all current usages qualify |
| `default` | `default` | Direct — no change |
| `#action` | `#actions` | Rename (not used in current codebase) |

---

## Files to Migrate

Legend: `[ ]` = not done · `[x]` = done

---

### Vue Component Files (7 files · 8 usages)

#### src/plugins/

- [x] `src/plugins/logs/SearchJobInspector.vue`
  - **Variant**: `error`
  - **Props to migrate**: `v-if`, `class="bg-negative text-white tw:mb-[0.625rem]"` → `variant="error"` (keep `tw:mb-[0.625rem]` as layout class), `data-test`
  - **Content**: `{{ errorMessage }}` is a plain string → use `:content="errorMessage"`
  - **Slots to migrate**: `#avatar` with `<OIcon name="error" size="sm" />` → `icon="error"` prop
  - **Result**: `<OBanner variant="error" icon="error" :content="errorMessage" class="tw:mb-[0.625rem]" data-test="inspector-error-banner" />`
  - **Pattern**: Error 1 from migration guide

- [x] `src/plugins/traces/TraceDAG.vue`
  - **Variant**: `error`
  - **Props to migrate**: `class="bg-negative text-white"` → `variant="error"`
  - **Content**: `Failed to load DAG: {{ error }}` is a plain string → use `:content="\`Failed to load DAG: ${error}\`"`
  - **Slots to migrate**: `#avatar` with `<OIcon name="error" size="sm" />` → `icon="error"` prop
  - **Result**: `<OBanner variant="error" icon="error" :content="\`Failed to load DAG: ${error}\`" />`
  - **Pattern**: Error 1 from migration guide

#### src/components/

- [x] `src/components/QueryPlanDialog.vue` *(new)*
  - **Variant**: `error`
  - **Props to migrate**: `class="bg-negative text-white"` → `variant="error"`
  - **Content**: `{{ error }}` is a plain string → use `:content="error"`
  - **Slots to migrate**: `v-slot:avatar` with `<OIcon name="error" size="sm" />` → `icon="error"` prop
  - **Result**: `<OBanner variant="error" icon="error" :content="error" />`
  - **Pattern**: Error 1 from migration guide

- [x] `src/components/ConfirmDialog.vue`
  - **Variant**: `warning`
  - **Props to migrate**: `:class="[theme === 'dark' ? ... : ...]"` → `variant="warning"` (entire dynamic class expression dropped)
  - **Content**: `{{ warningMessage }}` is a plain string → use `:content="warningMessage"`
  - **Slots to migrate**: `v-slot:avatar` with `<OIcon name="warning" :class="[theme-aware]" size="md" />` → `icon="warning"` prop (size + color handled by variant)
  - **Result**: `<OBanner variant="warning" icon="warning" :content="warningMessage" />`
  - **Pattern**: Warning 4 from migration guide
  - **Extra**: Remove `store.state.theme` import/usage from this component if no longer needed after migration

#### src/components/settings/

- [x] `src/components/settings/ServiceIdentitySetup.vue`
  - **Variant**: `warning`
  - **Props to migrate**: `rounded` (drop), `class="tw:bg-amber-50 dark:..."` → `variant="warning"`, `data-test`
  - **Content**: Rich markup (`v-for` list) → keep as **default slot** (cannot use `content` prop)
  - **Slots to migrate**: `#avatar` with `<OIcon name="warning" size="sm" />` → `icon="warning"` prop
  - **Pattern**: Warning 2 from migration guide

#### src/components/pipeline/NodeForm/

- [x] `src/components/pipeline/NodeForm/Condition.vue`
  - **Variant**: `info`
  - **Props to migrate**: `inline` (drop — no actions slot present), `dense`, `class="note-info"` → `variant="info"`
  - **Slots to migrate**: None — icons are inline inside the default slot content
  - **Pattern**: Info 3 from migration guide

- [x] `src/components/pipeline/NodeForm/AssociateFunction.vue`
  - **Variant**: `info`
  - **Props to migrate**: `inline` (drop — no actions slot present), `dense`, `class="note-info"` → `variant="info"`
  - **Slots to migrate**: None — icons are inline inside the default slot content
  - **Pattern**: Info 3 from migration guide

#### src/components/reports/

- [x] `src/components/reports/CreateReport.vue` *(new)*
  - **Variant**: `info`
  - **Props to migrate**: `rounded` (drop), `class="bg-orange-1 text-orange-9"` → `variant="info"`, `style="font-size: 13px"` (drop)
  - **Content**: Static string "PNG captures only the first visible page..." → use `content="PNG captures only the first visible page of the dashboard. Use PDF if the dashboard spans multiple pages."`
  - **Slots to migrate**: `v-slot:avatar` with `<OIcon name="info" size="sm" />` → `icon="info"` prop
  - **Result**: `<OBanner variant="info" icon="info" content="PNG captures only the first visible page of the dashboard. Use PDF if the dashboard spans multiple pages." />`
  - **Pattern**: Info from migration guide

---

## Migration Summary

| Variant | Files | q-banner usages |
|---|---|---|
| `error` | 3 | 3 |
| `warning` | 2 | 2 |
| `info` | 3 | 3 |
| `success` | 0 | 0 |
| `default` | 0 | 0 |
| **Total** | **7** | **8** |

---

## Pre-Migration Checklist

Before migrating any file, verify:

- [x] `OBanner.vue` exists at `web/src/lib/feedback/Banner/OBanner.vue` ✓
- [ ] `OBanner` is tested (at minimum: renders correct ARIA role per variant, applies correct CSS class per variant, renders `#icon` slot, renders `default` slot)
- [ ] Design tokens for all 5 variants are defined in the O2 Tailwind config
