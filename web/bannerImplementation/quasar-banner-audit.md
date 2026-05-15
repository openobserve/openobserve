# Quasar Banner Component ΓÇö Props, Emits & Slots Audit

> Scanned **all Vue files** under `web/src/` containing `<q-banner`.
> Found **6 distinct usages** across **5 files**.
> Counts represent number of occurrences across the codebase.
> Props prefixed with `:` are dynamically bound (`:prop="expr"`); without prefix they are static string / boolean attributes.

---

## Table of Contents

- [q-banner](#q-banner)
- [Variant / Color Analysis](#variant--color-analysis)
- [Gap Analysis ΓÇö OBanner Design](#gap-analysis--obanner-design)

---

## q-banner

### Props

| Prop | Count | Notes |
|---|---|---|
| `class` | 5 | Static class string applied to the banner root element. Values seen: `"bg-negative text-white"`, `"bg-negative text-white tw:mb-[0.625rem]"`, `"note-info"`, `":class="[...dynamic theme-aware classes...]"` |
| `:class` | 1 | Dynamic class binding ΓÇö theme-aware Tailwind utilities for dark/light mode |
| `dense` | 2 | Boolean ΓÇö compact layout, reduces padding (`Condition.vue`, `AssociateFunction.vue`) |
| `inline` | 2 | Boolean ΓÇö layout modifier; content and actions appear side by side (`Condition.vue`, `AssociateFunction.vue`) |
| `rounded` | 1 | Boolean ΓÇö applies `border-radius` to the banner (`ServiceIdentitySetup.vue`) |
| `data-test` | 2 | Static test attribute (`ServiceIdentitySetup.vue`, `SearchJobInspector.vue`) |
| `v-if` | 1 | Conditional rendering (`SearchJobInspector.vue`) |

### Emits / Events

`q-banner` has **no user-facing events** ΓÇö it is a display-only container component.

### Slots

| Slot | Count | Notes |
|---|---|---|
| `default` | 6 | Main banner content ΓÇö plain text, interpolated text, or rich markup (`div` blocks with icons and text) |
| `#avatar` / `v-slot:avatar` | 4 | Icon/avatar displayed on the left side of the banner. Always a `<q-icon>` in practice |
| `#action` | 0 | Action buttons (right side / below content). Not used in the current codebase. |

---

## Observed Usage Patterns

### Pattern 1 ΓÇö Error Banner (Error state, full-width, with icon)
**Files**: `SearchJobInspector.vue`, `TraceDAG.vue`

```vue
<!-- SearchJobInspector.vue -->
<q-banner
  v-if="errorMessage"
  class="bg-negative text-white tw:mb-[0.625rem]"
  data-test="inspector-error-banner"
>
  <template v-slot:avatar>
    <q-icon name="error" />
  </template>
  {{ errorMessage }}
</q-banner>

<!-- TraceDAG.vue -->
<q-banner class="bg-negative text-white">
  <template #avatar>
    <q-icon name="error" color="white" />
  </template>
  Failed to load DAG: {{ error }}
</q-banner>
```

**Observations**:
- `class="bg-negative text-white"` = Quasar semantic error color (red)
- Icon: `q-icon name="error"` in `#avatar` slot
- Plain / interpolated text in default slot
- No actions

---

### Pattern 2 ΓÇö Warning Banner (Rounded, multi-line, with icon)
**File**: `ServiceIdentitySetup.vue`

```vue
<q-banner
  rounded
  class="tw:bg-amber-50 dark:tw:bg-amber-900/20 tw:border tw:border-amber-300 dark:tw:border-amber-700"
  data-test="service-identity-warnings-banner"
>
  <template #avatar>
    <q-icon name="warning" color="warning" />
  </template>
  <div class="tw:flex tw:flex-col tw:gap-1">
    <div v-for="(warn, idx) in warnings" :key="idx" class="tw:text-sm">
      {{ warn }}
    </div>
  </div>
</q-banner>
```

**Observations**:
- `rounded` prop used
- Full custom Tailwind class for background/border (no Quasar semantic color)
- Dark mode variant via `dark:` prefix
- Rich content (iterated list) in default slot
- Icon: `q-icon name="warning"` in `#avatar` slot

---

### Pattern 3 ΓÇö Info / Note Banner (Inline, dense, no avatar)
**Files**: `Condition.vue`, `AssociateFunction.vue`

```vue
<q-banner inline dense class="note-info">
  <div>
    <q-icon name="info" color="orange" class="q-mr-sm" />
    <span>...</span>
  </div>
  <div>
    <q-icon name="warning" color="red" class="q-mr-sm" />
    <span>...</span>
  </div>
</q-banner>
```

**Observations**:
- `inline` + `dense` used together for compact inline layout
- No `#avatar` slot ΓÇö icons are embedded directly in the default slot content
- Custom CSS class `note-info` for visual styling
- Multiple `<div>` rows of content

---

### Pattern 4 ΓÇö Warning Banner (Dynamic theme-aware classes, no Quasar color)
**File**: `ConfirmDialog.vue`

```vue
<q-banner :class="[
  'tw:border-l-4 tw:p-4 tw:rounded',
  store.state.theme === 'dark'
    ? 'tw:bg-gray-800/60 tw:border-yellow-600/70'
    : 'tw:bg-orange-50 tw:border-orange-400'
]">
  <template v-slot:avatar>
    <q-icon
      name="warning"
      :class="store.state.theme === 'dark' ? 'tw:text-yellow-500/80' : 'tw:text-orange-500'"
      size="24px"
    />
  </template>
  <div :class="[
    'tw:font-medium tw:text-sm tw:leading-relaxed tw:text-left',
    store.state.theme === 'dark' ? 'tw:text-gray-300' : 'tw:text-orange-800'
  ]">
    {{ warningMessage }}
  </div>
</q-banner>
```

**Observations**:
- Fully dynamic `:class` binding ΓÇö no static Quasar semantic color
- Manual dark/light mode switching via `store.state.theme` (should be handled by design tokens in O2)
- `border-l-4` left-accent border style
- Icon in `#avatar` slot with dynamic color class
- Rich text content in default slot

---

## Variant / Color Analysis

All `q-banner` usages map to one of three visual intents:

| Visual Intent | Quasar Implementation | Count | O2 Equivalent |
|---|---|---|---|
| **Error** | `class="bg-negative text-white"` | 2 | `variant="error"` |
| **Warning** | Custom Tailwind amber/orange classes + `store.state.theme` | 2 | `variant="warning"` |
| **Info / Note** | Custom CSS class `note-info` | 2 | `variant="info"` |

> **Key insight**: No usage leverages Quasar's built-in color props (`color`, `text-color`, `bg-color`). Colors are applied exclusively via `class` or `:class`. The O2 `variant` prop eliminates all of this boilerplate.

---

## Gap Analysis ΓÇö OBanner Design

### Props needed by the codebase

| Need | Seen in | OBanner Prop |
|---|---|---|
| Semantic error style | `SearchJobInspector.vue`, `TraceDAG.vue` | `variant="error"` |
| Semantic warning style | `ServiceIdentitySetup.vue`, `ConfirmDialog.vue` | `variant="warning"` |
| Semantic info / note style | `Condition.vue`, `AssociateFunction.vue` | `variant="info"` |
| Compact layout | `Condition.vue`, `AssociateFunction.vue` | `dense` |
| Inline content + actions | `Condition.vue`, `AssociateFunction.vue` | `inline-actions` |
| Rounded corners | `ServiceIdentitySetup.vue` | `rounded` (automatic via design tokens per variant) |
| Conditional render | `SearchJobInspector.vue` | `v-if` on OBanner (pass-through) |
| Test selector | Multiple | `data-test` pass-through |
| Icon shorthand | All 4 avatar usages | `icon` prop (replaces `#icon` slot when icon name only) |

### Slots needed by the codebase

| Slot | Need | OBanner Slot |
|---|---|---|
| `default` | All rich + plain content | `default` (unchanged) |
| `#avatar` | Left-side icon | `#icon` (renamed ΓÇö `avatar` is a Quasar naming convention) |
| `#action` | Not used in codebase | `#actions` (aligned with O2 naming conventions) |

### What can be dropped

| Quasar feature | Reason to drop |
|---|---|
| Manual `class="bg-negative text-white"` | Replaced by `variant="error"` |
| Manual `class="bg-warning"` etc. | Replaced by `variant` design tokens |
| Manual dark/light theme switching in `:class` | Handled by O2 CSS variables / design tokens automatically |
| `inline` prop | Replaced by `inline-actions` prop (clearer intent) |
| `rounded` prop | Variants have consistent rounded corners baked in via design tokens |

### Accessibility

`q-banner` renders with no ARIA role. OBanner should:
- Use `role="status"` for `variant="info"` (non-urgent, polite announcement)
- Use `role="alert"` for `variant="warning"` and `variant="error"` (urgent, assertive announcement)
- Use `role="status"` for `variant="success"` (non-urgent)
- Use `role="status"` for `variant="default"` (neutral)

This removes the need for screen-reader-only text patterns.

---

## Full File List (6 usages ┬╖ 5 files)

| File | Usage Count | Variant | Props Used | Slots Used |
|---|---|---|---|---|
| `src/plugins/logs/SearchJobInspector.vue` | 1 | error | `v-if`, `class`, `data-test` | `#avatar`, `default` |
| `src/plugins/traces/TraceDAG.vue` | 1 | error | `class` | `#avatar`, `default` |
| `src/components/settings/ServiceIdentitySetup.vue` | 1 | warning | `rounded`, `class`, `data-test` | `#avatar`, `default` |
| `src/components/pipeline/NodeForm/Condition.vue` | 1 | info | `inline`, `dense`, `class` | `default` (icons inline in content) |
| `src/components/pipeline/NodeForm/AssociateFunction.vue` | 1 | info | `inline`, `dense`, `class` | `default` (icons inline in content) |
| `src/components/ConfirmDialog.vue` | 1 | warning | `:class` (dynamic) | `v-slot:avatar`, `default` |
