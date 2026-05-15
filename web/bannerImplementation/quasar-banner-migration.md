# Quasar Banner ΓåÆ O2 / Reka UI Migration Guide

> Covers: `q-banner`
> Source data from: `web/.claude/agents/quasar-banner-audit.md` (5 Vue files scanned)

---

## Status Overview

| Quasar Component | O2 Standalone | Reka UI Primitive | Usages | O2 Status |
|---|---|---|---|---|
| `q-banner` | `OBanner` | None (native `<div role="alert/status">`) | 6 usages across 5 files | Γ¼£ Not yet built |

> **Location**: `web/src/lib/feedback/Banner/OBanner.vue`

---

## Architecture

### Headless Base

`OBanner` has no Reka UI headless primitive ΓÇö banners are static display containers. The component uses:

- Native `<div>` with semantic ARIA `role` attribute (`"alert"` or `"status"`)
- Design token CSS variables for variant colors (no inline style or manual Tailwind theme switching)
- Tailwind CSS v4 utilities for layout

### OBanner Composition

```
OBanner
ΓööΓöÇΓöÇ <div role="alert|status">     (root ΓÇö role depends on variant)
    Γö£ΓöÇΓöÇ <div class="obanner-icon"> (optional ΓÇö shown when icon prop or #icon slot is used)
    Γöé   ΓööΓöÇΓöÇ <slot name="icon" />  ΓåÉ or auto-rendered icon from `icon` prop
    Γö£ΓöÇΓöÇ <div class="obanner-content">
    Γöé   ΓööΓöÇΓöÇ <slot />              ΓåÉ default slot (main content)
    ΓööΓöÇΓöÇ <div class="obanner-actions"> (optional ΓÇö shown when #actions slot has content)
        ΓööΓöÇΓöÇ <slot name="actions" />
```

### ARIA Role Selection

| `variant` | `role` | Rationale |
|---|---|---|
| `"error"` | `"alert"` | Urgent ΓÇö screen readers announce immediately (assertive) |
| `"warning"` | `"alert"` | Urgent ΓÇö screen readers announce immediately (assertive) |
| `"info"` | `"status"` | Polite ΓÇö screen readers announce when idle |
| `"success"` | `"status"` | Polite ΓÇö screen readers announce when idle |
| `"default"` | `"status"` | Neutral ΓÇö polite announcement |

> This eliminates the need for hidden `aria-live` wrappers in consuming code.

---

## Component API

### `OBanner` Props

| Prop | Type | Default | Description |
|---|---|---|---|
| `variant` | `"default" \| "info" \| "success" \| "warning" \| "error"` | `"default"` | Visual intent ΓÇö controls background color, border color, icon color, and ARIA role |
| `content` | `string \| undefined` | `undefined` | Plain text message shorthand. When provided, renders the text as the banner body. **The `default` slot takes precedence** ΓÇö use `content` only when no slot content is needed. |
| `icon` | `string \| undefined` | `undefined` | Icon name shorthand. When provided, renders the icon in the `#icon` slot area without needing the `<template #icon>` slot. Drop when using the `#icon` slot directly. |
| `dense` | `boolean` | `false` | Compact layout ΓÇö reduces padding |
| `inline-actions` | `boolean` | `false` | When `true`, the `#actions` slot content appears inline with the banner content (same row) instead of below it |
| `data-test` | `string` | `undefined` | Test selector attribute ΓÇö passed through to root element |

### `OBanner` Slots

| Slot | Required | Description |
|---|---|---|
| `default` | No* | Main banner content ΓÇö plain text, interpolated text, or rich markup. **Takes precedence over `content` prop when both are provided.** Required if `content` prop is not set. |
| `#icon` | No | Custom icon area on the left side of the banner. Use instead of the `icon` prop when you need more than a bare icon (e.g. custom size or class) |
| `#actions` | No | Action buttons ΓÇö rendered to the right (inline-actions mode) or below the content |

> **Content resolution order**: `default` slot ΓåÆ `content` prop. If both are provided, the slot wins and the prop is ignored. This mirrors the `OTooltip` pattern (`content` prop + `#content` slot).

### `OBanner` Events

`OBanner` has no user-facing events ΓÇö it is a display-only component.

---

## Prop Mapping ΓÇö `q-banner` ΓåÆ `OBanner`

| Quasar prop | O2 prop | Action |
|---|---|---|
| `class="bg-negative text-white"` | `variant="error"` | **Replace** ΓÇö drop manual class |
| `class="bg-warning"` | `variant="warning"` | **Replace** ΓÇö drop manual class |
| `class="note-info"` | `variant="info"` | **Replace** ΓÇö drop `note-info` class |
| `:class="[theme === 'dark' ? ... : ...]"` | `variant="warning"` | **Replace** ΓÇö design tokens handle dark/light automatically |
| Plain text default slot | `content` prop | **Promote to prop** when content is a plain string ΓÇö cleaner one-liner |
| Rich markup default slot | `default` slot | Keep as slot ΓÇö cannot be expressed as a prop |
| `inline` | `inline-actions` | Rename ΓÇö clearer intent |
| `dense` | `dense` | Direct |
| `rounded` | ΓÇö | **Drop** ΓÇö all variants have consistent `border-radius` baked in via design tokens |
| `data-test` | `data-test` | Direct pass-through |
| `v-if` | `v-if` on `<OBanner>` | Direct pass-through |

### Slot Mapping

| Quasar slot | O2 slot | Action |
|---|---|---|
| `#avatar` / `v-slot:avatar` | `#icon` | Rename |
| `default` | `default` | Direct |
| `#action` | `#actions` | Rename |

### Icon Shorthand

When the `#avatar` slot contains only a plain `<q-icon name="...">`, replace the entire slot with the `icon` prop:

```vue
<!-- BEFORE -->
<q-banner class="bg-negative text-white">
  <template #avatar>
    <q-icon name="error" />
  </template>
  {{ errorMessage }}
</q-banner>

<!-- AFTER ΓÇö using icon prop shorthand -->
<OBanner variant="error" icon="error">
  {{ errorMessage }}
</OBanner>
```

### Content Prop vs Default Slot

Use the `content` prop when the message is a **plain string** (static or computed). Use the `default` slot when the content has **any markup**.

```vue
<!-- content prop ΓÇö plain string, most compact -->
<OBanner variant="error" icon="error" :content="errorMessage" />

<!-- content prop ΓÇö static string -->
<OBanner variant="warning" icon="warning" content="This action cannot be undone." />

<!-- default slot ΓÇö computed string is fine here too, but prop is cleaner above -->
<OBanner variant="error" icon="error">
  {{ errorMessage }}
</OBanner>

<!-- default slot ΓÇö required when content has markup -->
<OBanner variant="warning" icon="warning">
  <div class="tw:flex tw:flex-col tw:gap-1">
    <div v-for="(warn, idx) in warnings" :key="idx">{{ warn }}</div>
  </div>
</OBanner>

<!-- WRONG ΓÇö both provided, slot wins, content prop is silently ignored -->
<OBanner variant="info" content="ignored">
  This slot content takes over.
</OBanner>
```

> **Decision rule**: If the entire banner body is `{{ someString }}` with no surrounding elements, use `:content="someString"`. If there is any wrapping `<div>`, `v-for`, `<span>`, or formatting, use the slot.

---

## Code Examples

### Example 1 ΓÇö Error Banner with Icon (SearchJobInspector.vue / TraceDAG.vue)

```vue
<!-- BEFORE (Quasar) -->
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

<!-- AFTER (O2) ΓÇö using content prop (preferred for plain string) -->
<OBanner
  v-if="errorMessage"
  variant="error"
  icon="error"
  :content="errorMessage"
  class="tw:mb-[0.625rem]"
  data-test="inspector-error-banner"
/>
```

> Note: The `tw:mb-[0.625rem]` spacing class is layout-specific and stays on the component. Only color/style classes (`bg-negative text-white`) are replaced by `variant`.
> `errorMessage` is a plain string ΓÇö the `content` prop is preferred over wrapping it in a default slot.

---

### Example 2 ΓÇö Warning Banner with Rich Content (ServiceIdentitySetup.vue)

```vue
<!-- BEFORE (Quasar) -->
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

<!-- AFTER (O2) -->
<OBanner
  variant="warning"
  icon="warning"
  data-test="service-identity-warnings-banner"
>
  <div class="tw:flex tw:flex-col tw:gap-1">
    <div v-for="(warn, idx) in warnings" :key="idx" class="tw:text-sm">
      {{ warn }}
    </div>
  </div>
</OBanner>
```

> `rounded` is dropped ΓÇö OBanner variants apply consistent border-radius via design tokens.
> Manual `tw:bg-amber-50 dark:tw:bg-amber-900/20 tw:border tw:border-amber-300 dark:tw:border-amber-700` is entirely replaced by `variant="warning"`.

---

### Example 3 ΓÇö Info / Note Banner (Inline, Dense, No Avatar) (Condition.vue / AssociateFunction.vue)

```vue
<!-- BEFORE (Quasar) -->
<q-banner inline dense class="note-info">
  <div>
    <q-icon name="info" color="orange" class="q-mr-sm" />
    <span>To check for an empty value, use <span class="highlight">""</span>.</span>
  </div>
  <div>
    <q-icon name="warning" color="red" class="q-mr-sm" />
    <span>If conditions are not met, the record will be dropped.</span>
  </div>
</q-banner>

<!-- AFTER (O2) -->
<OBanner variant="info" dense>
  <div class="tw:flex tw:flex-col tw:gap-1">
    <div class="tw:flex tw:items-center tw:gap-2">
      <q-icon name="info" color="orange" />
      <span>To check for an empty value, use <span class="highlight">""</span>.</span>
    </div>
    <div class="tw:flex tw:items-center tw:gap-2">
      <q-icon name="warning" color="red" />
      <span>If conditions are not met, the record will be dropped.</span>
    </div>
  </div>
</OBanner>
```

> `inline` is dropped (no actions present, so `inline-actions` is irrelevant).
> `class="note-info"` is replaced by `variant="info"`.
> Icons remain inline in the default slot content because they are content icons, not the banner's primary icon.

---

### Example 4 ΓÇö Warning Banner with Dynamic Theme Classes (ConfirmDialog.vue)

```vue
<!-- BEFORE (Quasar) -->
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

<!-- AFTER (O2) ΓÇö plain string ΓåÆ content prop -->
<OBanner variant="warning" icon="warning" :content="warningMessage" />
```

> All manual dark/light mode class switching is removed ΓÇö `variant="warning"` applies the correct colors for both themes via CSS design tokens.
> `warningMessage` is a plain string ΓÇö the `content` prop collapses the entire banner to a self-closing tag.

---

## Import

```ts
import OBanner from "@/lib/feedback/Banner/OBanner.vue";
```

---

## OBanner Implementation Reference

When building `OBanner.vue`, use the following design token structure:

```vue
<script setup lang="ts">
import { computed, useSlots } from "vue";

interface Props {
  variant?: "default" | "info" | "success" | "warning" | "error";
  content?: string;
  icon?: string;
  dense?: boolean;
  inlineActions?: boolean;
  dataTest?: string;
}

const props = withDefaults(defineProps<Props>(), {
  variant: "default",
  dense: false,
  inlineActions: false,
});

const slots = useSlots();

// ARIA role: "alert" for error/warning, "status" for others
const ariaRole = computed(() =>
  props.variant === "error" || props.variant === "warning" ? "alert" : "status"
);

// Slot presence checks
const hasDefaultSlot = computed(() => !!slots.default);
const hasIconSlot = computed(() => !!slots.icon);
const hasActionsSlot = computed(() => !!slots.actions);

// Content resolution: default slot wins over content prop
const showContentProp = computed(() => !hasDefaultSlot.value && !!props.content);
</script>

<template>
  <div
    :role="ariaRole"
    :data-test="dataTest"
    :class="[
      'obanner',
      `obanner--${variant}`,
      dense && 'obanner--dense',
      inlineActions && 'obanner--inline-actions',
    ]"
  >
    <!-- Icon area -->
    <div v-if="icon || hasIconSlot" class="obanner__icon">
      <slot name="icon">
        <!-- rendered by consuming code or by the icon prop implementation -->
      </slot>
    </div>

    <!-- Content: slot takes precedence over content prop -->
    <div class="obanner__content">
      <slot />
      <template v-if="showContentProp">{{ content }}</template>
    </div>

    <!-- Actions -->
    <div v-if="hasActionsSlot" class="obanner__actions">
      <slot name="actions" />
    </div>
  </div>
</template>
```

### Design Token Classes (Tailwind v4)

```css
/* variant="default" */
.obanner--default { @apply tw:bg-gray-100 dark:tw:bg-gray-800 tw:text-gray-800 dark:tw:text-gray-200 tw:rounded-md; }

/* variant="info" */
.obanner--info { @apply tw:bg-blue-50 dark:tw:bg-blue-900/20 tw:border tw:border-blue-200 dark:tw:border-blue-700 tw:text-blue-900 dark:tw:text-blue-100 tw:rounded-md; }

/* variant="success" */
.obanner--success { @apply tw:bg-green-50 dark:tw:bg-green-900/20 tw:border tw:border-green-200 dark:tw:border-green-700 tw:text-green-900 dark:tw:text-green-100 tw:rounded-md; }

/* variant="warning" */
.obanner--warning { @apply tw:bg-amber-50 dark:tw:bg-amber-900/20 tw:border-l-4 tw:border tw:border-amber-300 dark:tw:border-amber-700 tw:text-amber-900 dark:tw:text-amber-100 tw:rounded-md; }

/* variant="error" */
.obanner--error { @apply tw:bg-red-600 dark:tw:bg-red-700 tw:text-white tw:rounded-md; }

/* dense modifier */
.obanner--dense { @apply tw:p-2; }
.obanner:not(.obanner--dense) { @apply tw:p-4; }

/* inline-actions modifier */
.obanner--inline-actions { @apply tw:flex tw:items-center tw:gap-3; }
.obanner:not(.obanner--inline-actions) { @apply tw:flex tw:flex-col tw:gap-2; }

/* icon area */
.obanner__icon { @apply tw:flex-shrink-0 tw:flex tw:items-start; }

/* content */
.obanner__content { @apply tw:flex-1 tw:text-sm; }
```
