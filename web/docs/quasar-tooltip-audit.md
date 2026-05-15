# Quasar Tooltip Component — Props, Emits & Slots Audit

> Scanned **143 Vue files** under `web/src/` containing `<q-tooltip`.  
> Counts represent number of occurrences across the codebase.  
> Props prefixed with `:` are dynamically bound (`:prop="expr"`); without prefix they are static string / boolean attributes.

---

## Table of Contents

- [q-tooltip](#q-tooltip)
- [q-tooltip (test stubs)](#q-tooltip-test-stubs)
- [Anchor / Self → Side / Align mapping](#anchor--self--side--align-mapping)
- [Gap Analysis — OTooltip Design](#gap-analysis--otooltip-design)

---

## q-tooltip

### Props

| Prop | Count | Notes |
|---|---|---|
| (no props — plain text content) | ~200+ | Most common usage: `<q-tooltip>Text</q-tooltip>` with no positioning props |
| `anchor` | ~70 | Quasar positioning string, e.g. `"top middle"`, `"bottom middle"`, `"center right"`, `"center left"`, `"bottom right"`, `"top right"`, `"bottom left"`, `"top left"` |
| `self` | ~70 | Quasar self-anchor string, always paired with `anchor`. Same value format. |
| `:delay` | ~40 | Show delay in ms — values seen: `200`, `300`, `400`, `500` |
| `max-width` | ~25 | Max width of tooltip bubble — values seen: `"220px"`, `"250px"`, `"300px"`, `"320px"`, `"350px"`, `"400px"` |
| `class` | ~25 | Custom CSS applied to tooltip bubble — values seen: `"bg-grey-8"`, `"tw:text-xs"`, `"tw:text-[12px]"`, `"tw:text-sm"`, `"tw:max-w-sm"`, `"tw:max-w-md"`, `"q-mt-lg"`, `"anomaly-tooltip"` |
| `:offset` | ~10 | `[x, y]` pixel offset — values seen: `[0, 2]`, `[0, 4]`, `[0, 6]`, `[0, 8]` |
| `style` | ~5 | Inline style on tooltip bubble — values seen: `"font-size: 12px"`, `"font-size: 14px; width: 250px"` |
| `v-if` | ~30 | Conditional rendering — passed through to wrapper |
| `data-test` | ~3 | Test selector attribute |

### Emits / Events

`q-tooltip` has **no user-facing events** — it is a display-only overlay component.

### Slots

| Slot | Count | Notes |
|---|---|---|
| default | ~400+ | The tooltip content — plain text, interpolated text, or rich markup (icons, spans) |

---

## q-tooltip (test stubs)

Found in **35 spec files** under `web/src/`. Current stub patterns used:

| Pattern | Files | Notes |
|---|---|---|
| `'q-tooltip': { template: '<div class="q-tooltip-stub"><slot></slot></div>' }` | 2 | Explicit div stub |
| `'q-tooltip': { template: '<div class="q-tooltip"><slot /></div>' }` | 2 | Div with class |
| `'q-tooltip': { template: '<div data-test-stub="q-tooltip"><slot /></div>' }` | 1 | Test-attribute stub |
| `'q-tooltip': { template: '<span class="q-tooltip"><slot /></span>' }` | 1 | Span stub |
| `'q-tooltip': { template: '<div />' }` | ~28 | Minimal stub (no slot rendering) |
| `'q-tooltip': true` | 3 | Quasar's own built-in stub |
| `<q-tooltip-stub>` (inside component template string in test) | 2 | Nested inside icon stubs |

---

## Anchor / Self → Side / Align Mapping

Quasar uses `anchor` (the point on the **target element**) and `self` (the point on the **tooltip**) to calculate positioning. Reka UI's `TooltipContent` uses `side` + `align` + `sideOffset`.

> **Rule**: `anchor` determines which `side` of the trigger the tooltip appears on.  
> The `align` value is derived from the **horizontal** component of `anchor` (for vertical placements) or the **vertical** component (for horizontal placements).

### Anchor-to-Side Conversion

| Quasar `anchor` + `self` | O2 `side` | O2 `align` | Notes |
|---|---|---|---|
| (none — default) | `"top"` | `"center"` | Quasar default is above-center |
| `anchor="top middle" self="bottom middle"` | `"top"` | `"center"` | Most common — tooltip above trigger |
| `anchor="bottom middle" self="top middle"` | `"bottom"` | `"center"` | Tooltip below trigger |
| `anchor="center right" self="center left"` | `"right"` | `"center"` | Tooltip to the right (info icons) |
| `anchor="center left" self="center right"` | `"left"` | `"center"` | Tooltip to the left |
| `anchor="bottom right" self="top right"` | `"bottom"` | `"end"` | Below, right-aligned (panel buttons) |
| `anchor="bottom left" self="top left"` | `"bottom"` | `"start"` | Below, left-aligned |
| `anchor="top right" self="bottom right"` | `"top"` | `"end"` | Above, right-aligned |
| `anchor="top left" self="bottom left"` | `"top"` | `"start"` | Above, left-aligned |
| `anchor="bottom middle" self="top left"` | `"bottom"` | `"start"` | Approximate — align by anchor |
| `anchor="center left" self="center left"` | `"left"` | `"start"` | Approximate |

> **`self` can usually be dropped** — Reka UI's Popper engine handles tooltip self-alignment automatically using `side` + `align`. Only `anchor` needs to be decoded.

### Offset Mapping

| Quasar `:offset` | O2 `:side-offset` | Notes |
|---|---|---|
| `:offset="[0, 2]"` | `:side-offset="2"` | Use Y value for top/bottom placements |
| `:offset="[0, 4]"` | `:side-offset="4"` | Use Y value for top/bottom placements |
| `:offset="[0, 6]"` | `:side-offset="6"` | Use Y value for top/bottom placements |
| `:offset="[0, 8]"` | `:side-offset="8"` | Use Y value for top/bottom placements |
| `:offset="[4, 0]"` | `:align-offset="4"` | Use X value for left/right placements |

> Default `sideOffset` in O2 is `4` (4px gap between trigger and tooltip).

---

## Gap Analysis — OTooltip Design

### Quasar `q-tooltip` is a child; O2 `OTooltip` is a wrapper

This is the **most important structural difference**. Quasar `q-tooltip` is always placed **inside** its trigger element:

```vue
<!-- Quasar pattern: q-tooltip is a child of the trigger -->
<q-btn flat round icon="info">
  <q-tooltip>This is help text</q-tooltip>
</q-btn>
```

O2 `OTooltip` follows the Reka UI pattern: it **wraps** the trigger element. The trigger is the default slot; the tooltip content is the `#content` named slot or the `content` prop:

```vue
<!-- O2 pattern: OTooltip wraps the trigger -->
<OTooltip content="This is help text">
  <q-btn flat round icon="info" />
</OTooltip>
```

This means **every migration requires a template restructure** — lifting the trigger element out of q-tooltip's parent and wrapping it in OTooltip.

### Structural Change Summary

Every usage follows this pattern:

```
BEFORE:
<trigger-element [trigger-props]>
  ...trigger content...
  <q-tooltip [tooltip-props]>tooltip text</q-tooltip>
</trigger-element>

AFTER:
<OTooltip content="tooltip text" [o2-props]>
  <trigger-element [trigger-props]>
    ...trigger content...
  </trigger-element>
</OTooltip>
```

### Rich Content Handling

When the tooltip content is rich HTML (icons, multiline, interpolated), use `#content` slot:

```vue
<!-- BEFORE -->
<q-btn>
  <q-tooltip anchor="center right" self="center left" max-width="300px">
    <span class="tw:text-xs">This uses <strong>rich</strong> content</span>
  </q-tooltip>
</q-btn>

<!-- AFTER -->
<OTooltip side="right" max-width="300px">
  <q-btn />
  <template #content>
    <span class="tw:text-xs">This uses <strong>rich</strong> content</span>
  </template>
</OTooltip>
```

### Conditional Tooltip (`v-if`)

When `v-if` is on the `<q-tooltip>`, move it to the `OTooltip` wrapper:

```vue
<!-- BEFORE -->
<q-btn :disable="!canSubmit">
  Submit
  <q-tooltip v-if="!canSubmit">Please fill in all required fields</q-tooltip>
</q-btn>

<!-- AFTER -->
<OTooltip v-if="!canSubmit" content="Please fill in all required fields">
  <q-btn :disable="!canSubmit">Submit</q-btn>
</OTooltip>
<!-- OR use :disabled prop to keep OTooltip in DOM but inactive -->
<OTooltip :disabled="canSubmit" content="Please fill in all required fields">
  <q-btn :disable="!canSubmit">Submit</q-btn>
</OTooltip>
```

### Class / Style on Tooltip Bubble

In Quasar, `class` on `<q-tooltip>` styles the bubble. In O2, use `content-class` prop:

```vue
<!-- BEFORE -->
<q-tooltip class="bg-grey-8 tw:text-xs" max-width="300px">...</q-tooltip>

<!-- AFTER -->
<OTooltip content-class="tw:text-xs" max-width="300px">...</OTooltip>
```

> Background color (`bg-grey-8`) is **dropped** — OTooltip uses design tokens for its background.

### Reka UI Primitives Used

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
- WAI-ARIA `role="tooltip"` with correct `aria-describedby` association on the trigger
- Keyboard dismissal (Escape key closes tooltip)
- Hover delay management via `delayDuration`
- Floating UI / Popper-based positioning with automatic collision detection
- Focus-triggered tooltips for keyboard navigation accessibility

### OTooltip vs OTooltipStub

| Component | Purpose | Import |
|---|---|---|
| `OTooltip` | Runtime — renders the floating tooltip | `@/lib/overlay/Tooltip/OTooltip.vue` |
| `OTooltipStub` | Test stub — renders trigger + content without floating logic | Used in `stubs` option of `mount()` |

### TooltipProvider at App Root

Reka UI requires `TooltipProvider` at the application root (or high in the tree) to coordinate tooltip global delay. This should be added once in `App.vue` or the root layout:

```vue
<TooltipProvider :delay-duration="700" :skip-delay-duration="300">
  <RouterView />
</TooltipProvider>
```

> This is a **one-time setup** that does not require per-file migration.

---

## Full Prop Inventory — All Unique Values Found

### `anchor` values found in codebase

| Value | Frequency |
|---|---|
| `"top middle"` | ~20 |
| `"bottom middle"` | ~15 |
| `"center right"` | ~15 |
| `"center left"` | ~5 |
| `"bottom right"` | ~10 |
| `"bottom left"` | ~2 |
| `"top right"` | ~2 |

### `class` values found in codebase

| Value | Component context |
|---|---|
| `"bg-grey-8"` | Dark background tooltip (schema.vue, PromQLChartConfig.vue, CrossLinkUserGuide.vue) |
| `"tw:text-xs"` | Extra-small text (TraceEvaluationsView, IncidentList) |
| `"tw:text-[12px]"` | 12px text (AutoRefreshInterval, FunctionSelector, schema.vue) |
| `"tw:text-sm"` | Small text (AddAlert, IncidentDetailDrawer) |
| `"tw:max-w-sm"` | Max-width small (IncidentTimeline) |
| `"tw:max-w-md"` | Max-width medium (IncidentList) |
| `"q-mt-lg"` | Top margin (Dashboards.vue — drop, positional) |
| `"anomaly-tooltip"` | Custom class (PatternCard.vue — migrate to `content-class`) |

### `:delay` values found in codebase

| Value | Context |
|---|---|
| `200` | Fast reveal (IncidentDetailDrawer) |
| `300` | Standard delay (FilterGroup, QueryConfig, alerts) |
| `400` | Longer delay (QueryConfig, QueryEditorDialog) |
| `500` | Deliberate delay — icon-only buttons (O2AIChat, IncidentTableOfContents, IncidentDetailDrawer) |

### `max-width` values found in codebase

| Value | Context |
|---|---|
| `"220px"` | Compact panel errors (PanelContainer, PanelErrorButtons) |
| `"250px"` | Info icons in PromQL config |
| `"300px"` | Standard info tooltips (AlertSettings, Deduplication, DimensionFilterEditor) |
| `"320px"` | Reports (CreateReport) |
| `"350px"` | Wide info (AlertSettings) |
| `"400px"` | Extra wide (PromQLChartConfig) |
