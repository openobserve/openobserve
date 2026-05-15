# Quasar Tooltip → O2 / Reka UI Migration Guide

> Covers: `q-tooltip`  
> Source data from: `web/.claude/agents/quasar-tooltip-audit.md` (143 Vue files scanned)

---

## Status Overview

| Quasar Component | O2 Standalone | Reka UI Primitive | Usages | O2 Status |
|---|---|---|---|---|
| `q-tooltip` | `OTooltip` | `TooltipRoot` + `TooltipContent` | ~400+ instances across 143 files | ⬜ Not yet built |
| `q-tooltip` (test) | `OTooltipStub` | — | 35 spec files | ⬜ Not yet built |

> **Location**: `web/src/lib/overlay/Tooltip/`  
> Both `OTooltip.vue` and `OTooltipStub.vue` should live in this directory.

---

## Architecture

### Reka UI Primitives

```ts
import {
  TooltipRoot,
  TooltipTrigger,
  TooltipPortal,
  TooltipContent,
  TooltipArrow,
  TooltipProvider,
} from "reka-ui";
```

**Why Reka UI**: `TooltipRoot` + `TooltipContent` provides:
- WAI-ARIA `role="tooltip"` with correct `aria-describedby` on the trigger
- Keyboard dismissal (Escape closes active tooltip)
- Hover delay management via `delayDuration`
- Floating UI / Popper-based automatic collision detection and repositioning
- Focus-triggered tooltips for keyboard accessibility (screen reader support)
- Global delay coordination via `TooltipProvider` at app root

### OTooltip Composition

```
OTooltip
└── TooltipRoot           (manages open state + delay)
    ├── TooltipTrigger    (asChild — wraps the default slot trigger element)
    │   └── <slot />      ← trigger element (e.g. OButton, icon, any element)
    └── TooltipPortal     (renders to document.body)
        └── TooltipContent  (the floating bubble)
            ├── TooltipArrow (optional)
            └── <slot name="content" />  or  {{ content }}
```

### App-Level Setup (One-Time)

`TooltipProvider` must be added once near the root of the application. It coordinates the global delay so hovering from one tooltip to another reveals the next one instantly:

```vue
<!-- App.vue or root layout -->
<template>
  <TooltipProvider :delay-duration="700" :skip-delay-duration="300">
    <RouterView />
  </TooltipProvider>
</template>

<script setup lang="ts">
import { TooltipProvider } from "reka-ui";
</script>
```

> Per-instance `:delay` on `OTooltip` overrides the provider default.

---

## Component API

### `OTooltip` Props

| Prop | Type | Default | Description |
|---|---|---|---|
| `content` | `string` | `undefined` | Tooltip text — shorthand for `#content` slot when content is plain text |
| `side` | `"top" \| "right" \| "bottom" \| "left"` | `"top"` | Which side of the trigger to render the tooltip on |
| `align` | `"start" \| "center" \| "end"` | `"center"` | Alignment along the chosen side |
| `side-offset` | `number` | `4` | Gap in pixels between trigger edge and tooltip bubble |
| `align-offset` | `number` | `0` | Shift along the alignment axis |
| `delay` | `number` | `700` | Milliseconds before tooltip shows on hover (maps to `delayDuration`) |
| `max-width` | `string` | `"320px"` | CSS max-width of the tooltip content bubble |
| `disabled` | `boolean` | `false` | When `true`, the tooltip never opens |
| `open` | `boolean` | `undefined` | Controlled open state — omit for uncontrolled |
| `arrow` | `boolean` | `false` | Show a small arrow pointing at the trigger |
| `content-class` | `string` | `undefined` | Extra CSS class applied to the tooltip bubble element |

### `OTooltip` Slots

| Slot | Required | Description |
|---|---|---|
| default | Yes | The trigger element. Wrapped in `TooltipTrigger asChild` — must be a single focusable element |
| `#content` | No | Rich tooltip content — use instead of `content` prop when markup is needed |

### `OTooltip` Events

`OTooltip` has no user-facing events — it is display-only.

---

## Prop Mapping — `q-tooltip` → `OTooltip`

| Quasar prop | O2 prop | Action |
|---|---|---|
| Default slot text | `content` prop | Move content to `content` prop for plain text |
| Default slot (rich markup) | `#content` named slot | Move content to `<template #content>` |
| `anchor="top middle"` | `side="top"` | Decode — see [Anchor Mapping](#anchor-mapping) |
| `anchor="bottom middle"` | `side="bottom"` | Decode |
| `anchor="center right"` | `side="right"` | Decode |
| `anchor="center left"` | `side="left"` | Decode |
| `anchor="bottom right"` | `side="bottom" align="end"` | Decode |
| `self` | — | **Drop** — Reka handles tooltip self-alignment automatically |
| `:delay` | `:delay` | Direct |
| `:offset="[0, y]"` | `:side-offset="y"` | Extract Y component for top/bottom placements |
| `:offset="[x, 0]"` | `:align-offset="x"` | Extract X component for left/right placements |
| `max-width` | `max-width` | Direct |
| `class` | `content-class` | Rename — only non-color utility classes; drop `bg-grey-8`, `q-mt-*` |
| `style` | `content-class` or inline on `#content` | Move inline styles to Tailwind utilities |
| `v-if` | `v-if` on `OTooltip` | Direct — or use `:disabled` to keep in DOM |
| `data-test` | `data-test` | Direct pass-through |

### Anchor Mapping

| Quasar `anchor` value | O2 `side` | O2 `align` |
|---|---|---|
| (no anchor — default) | `"top"` (default) | `"center"` (default) |
| `"top middle"` | `"top"` | `"center"` |
| `"bottom middle"` | `"bottom"` | `"center"` |
| `"center right"` | `"right"` | `"center"` |
| `"center left"` | `"left"` | `"center"` |
| `"bottom right"` | `"bottom"` | `"end"` |
| `"bottom left"` | `"bottom"` | `"start"` |
| `"top right"` | `"top"` | `"end"` |
| `"top left"` | `"top"` | `"start"` |

> **When `anchor` has no direct equivalent**: use the dominant direction from `anchor`'s vertical component as `side`, and the horizontal component for `align`. Ignore `self`.

---

## Code Examples

### Simple Text Tooltip (No Props)

```vue
<!-- BEFORE (Quasar) -->
<q-btn flat round>
  <q-icon name="refresh" />
  <q-tooltip>{{ t("common.refresh") }}</q-tooltip>
</q-btn>

<!-- AFTER (O2) -->
<OTooltip :content="t('common.refresh')">
  <q-btn flat round>
    <q-icon name="refresh" />
  </q-btn>
</OTooltip>
```

**Import**:
```ts
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
```

---

### Tooltip With Positioning

```vue
<!-- BEFORE -->
<q-btn flat round icon="info">
  <q-tooltip anchor="top middle" self="bottom middle">
    {{ t("alerts.helpText") }}
  </q-tooltip>
</q-btn>

<!-- AFTER -->
<OTooltip :content="t('alerts.helpText')" side="top">
  <q-btn flat round icon="info" />
</OTooltip>
```

---

### Tooltip to the Right (Info Icon Pattern)

```vue
<!-- BEFORE -->
<q-icon name="info" size="16px">
  <q-tooltip anchor="center right" self="center left" max-width="300px">
    When enabled, this setting applies to all streams.
  </q-tooltip>
</q-icon>

<!-- AFTER -->
<OTooltip
  content="When enabled, this setting applies to all streams."
  side="right"
  max-width="300px"
>
  <q-icon name="info" size="16px" />
</OTooltip>
```

---

### Tooltip With Delay

```vue
<!-- BEFORE -->
<q-btn flat round icon="delete">
  <q-tooltip :delay="500">Delete chat</q-tooltip>
</q-btn>

<!-- AFTER -->
<OTooltip content="Delete chat" :delay="500">
  <q-btn flat round icon="delete" />
</OTooltip>
```

---

### Rich Content Tooltip

```vue
<!-- BEFORE -->
<q-icon name="info">
  <q-tooltip class="bg-grey-8" anchor="top middle" self="bottom middle" max-width="300px">
    <span class="tw:text-xs">
      SQL mode supports <strong>all standard SQL</strong> functions.
    </span>
  </q-tooltip>
</q-icon>

<!-- AFTER -->
<OTooltip side="top" max-width="300px">
  <q-icon name="info" />
  <template #content>
    <span class="tw:text-xs">
      SQL mode supports <strong>all standard SQL</strong> functions.
    </span>
  </template>
</OTooltip>
```

> Note: `class="bg-grey-8"` is **dropped** — OTooltip background is controlled by design tokens.

---

### Conditional Tooltip (v-if Pattern)

When `v-if` conditionally shows the tooltip:

```vue
<!-- BEFORE -->
<q-btn :disable="!streamType">
  Add Field
  <q-tooltip v-if="!streamType">{{ t('alerts.selectStreamTypeFirst') }}</q-tooltip>
</q-btn>

<!-- AFTER — Option 1: v-if on OTooltip (removes from DOM when condition is false) -->
<OTooltip v-if="!streamType" :content="t('alerts.selectStreamTypeFirst')">
  <q-btn :disable="!streamType">Add Field</q-btn>
</OTooltip>
<q-btn v-else :disable="!streamType">Add Field</q-btn>

<!-- AFTER — Option 2: :disabled prop (keeps OTooltip in DOM, just inactive) -->
<OTooltip :disabled="!!streamType" :content="t('alerts.selectStreamTypeFirst')">
  <q-btn :disable="!streamType">Add Field</q-btn>
</OTooltip>
```

> **Prefer Option 2** (`:disabled` prop) when the trigger element is always rendered — it avoids duplicating the trigger markup.

---

### Offset Migration

```vue
<!-- BEFORE -->
<q-btn>
  <q-icon name="info" />
  <q-tooltip class="tw:text-[12px]" :offset="[0, 2]">Tooltip text</q-tooltip>
</q-btn>

<!-- AFTER -->
<OTooltip content="Tooltip text" content-class="tw:text-[12px]" :side-offset="2">
  <q-btn>
    <q-icon name="info" />
  </q-btn>
</OTooltip>
```

---

### Inline Style Migration

```vue
<!-- BEFORE -->
<q-tooltip style="font-size: 14px; width: 250px">
  {{ t("stream.fieldInfo") }}
</q-tooltip>

<!-- AFTER -->
<OTooltip
  :content="t('stream.fieldInfo')"
  max-width="250px"
  content-class="tw:text-sm"
/>
```

> `font-size: 14px` → `tw:text-sm`, `width: 250px` → `max-width="250px"` prop.

---

## `OTooltipStub` — Test Replacement

`OTooltipStub` is the test stub to use in unit test `stubs` when replacing `OTooltip`.

### What it renders

- Renders the trigger (default slot)
- Renders the content slot inline (no floating positioning)
- Adds `data-test="o-tooltip-stub"` for assertions

### Usage in tests

```ts
// In a spec file
import { mount } from "@vue/test-utils";
import OTooltipStub from "@/lib/overlay/Tooltip/OTooltipStub.vue";

const wrapper = mount(MyComponent, {
  global: {
    stubs: {
      OTooltip: OTooltipStub,
    },
  },
});

// Assert tooltip content is accessible in DOM
expect(wrapper.find('[data-test="o-tooltip-stub"]').exists()).toBe(true);
```

### Migrating existing `q-tooltip` stubs

Replace all `"q-tooltip"` stubs in spec files with `OTooltip`:

```ts
// BEFORE — old Quasar q-tooltip stubs (multiple patterns found in codebase)
stubs: {
  'q-tooltip': { template: '<div class="q-tooltip-stub"><slot></slot></div>' },
  // or:
  'q-tooltip': { template: '<div />' },
  // or:
  'q-tooltip': true,
}

// AFTER — single O2 stub
stubs: {
  OTooltip: OTooltipStub,
}
```

> **Note**: After migrating a component from `q-tooltip` to `OTooltip`, its spec file must also be updated. The `q-tooltip` stub becomes dead code and should be removed.

---

## Migration Strategy

### Step 1 — App root setup (once)

Add `TooltipProvider` to the root layout or `App.vue`. Only needs to be done once for the whole application.

### Step 2 — Migrate by file (143 Vue files)

For each file in the checklist:

1. Import `OTooltip`
2. For each `<q-tooltip>` in the file:
   - Move `<q-tooltip>` and its content **out of** its parent trigger
   - Wrap the trigger in `<OTooltip>`
   - Convert `anchor`/`self` to `side`/`align` using the mapping table
   - Move plain text content to `content` prop
   - Move rich markup content to `<template #content>`
   - Move `:delay` directly
   - Convert `:offset="[0, y]"` to `:side-offset="y"`
   - Move `max-width` directly
   - Move `class` utilities to `content-class` (drop background color classes)
   - Convert `v-if` on `q-tooltip` to `v-if` or `:disabled` on `OTooltip`
3. Remove the `q-tooltip` import if it was manually imported

### Step 3 — Migrate spec stubs

For each spec file in the checklist:
1. Replace `'q-tooltip'` stub with `OTooltip: OTooltipStub`
2. Remove `q-tooltip-stub` references from component template strings in tests

### Migration Difficulty Rating

| Pattern | Difficulty | Notes |
|---|---|---|
| Simple text, no props | ⬛ Easy | Just wrap + move content to prop |
| With `anchor`/`self` | ⬛ Easy | Decode and map to `side`/`align` |
| With `v-if` on tooltip | 🟡 Medium | Choose `v-if` vs `:disabled` strategy |
| Multiple tooltips in one parent | 🟡 Medium | Each needs its own `OTooltip` wrapper |
| Rich content slot | 🟡 Medium | Move to `<template #content>` |
| Tooltip inside `v-for` render | 🟡 Medium | Each item needs its wrapper |
| Tooltip inside deeply nested conditionals | 🔴 Complex | Restructure template carefully |

---

## Common Mistakes to Avoid

1. **Don't keep `q-tooltip` as a child** — `OTooltip` always wraps, never nests.
2. **Don't pass `bg-grey-8` or other color classes** to `content-class` — design tokens control the background.
3. **Don't copy `self` prop** — it is not used and has no O2 equivalent; Reka handles it automatically.
4. **Don't use both `content` prop and `#content` slot** — `#content` slot takes precedence; pick one.
5. **Ensure the default slot is a single focusable element** — `TooltipTrigger asChild` requires a single child with a DOM ref. If the trigger is a `<div>` or `<span>`, add `tabindex="0"` for keyboard accessibility.
