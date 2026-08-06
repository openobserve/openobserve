# Feedback, Data Display & Lists

O2 components for loading states, messaging, transient notifications, hierarchical/temporal data, and label-value detail rows. All source lives under `@/lib/`; import each component from its own `.vue` file.

## Table of contents

- [Loading & messaging decision guide](#loading--messaging-decision-guide)
- Feedback
  - [OBanner](#obanner)
  - [OInnerLoading](#oinnerloading)
  - [OSkeleton](#oskeleton)
  - [OSpinner](#ospinner)
  - [Toast — OToastProvider + useToast](#toast--otoastprovider--usetoast)
- Data display
  - [OProgressBar](#oprogressbar)
  - [OTimeline / OTimelineItem](#otimeline--otimelineitem)
  - [OTree](#otree)
- Lists
  - [OFieldList / OFieldRow / OFieldLabel](#fieldlist--ofieldlist--ofieldrow--ofieldlabel)

## Loading & messaging decision guide

Pick by **persistence** and **whether the thing is data that is still loading**:

| Situation | Use | Why |
|---|---|---|
| Persistent message that stays inline in the layout (validation summary, config hint, inline error/insight) | **OBanner** | Sits in the flow, does not auto-dismiss, semantic variant colors |
| Transient popup confirming an action or reporting a background result ("Saved", "Query failed") | **Toast** (`useToast().toast()`) | Auto-dismisses, floats over app, replaces `q-notify` |
| A whole container/panel is loading and you want to dim it with a centered spinner overlay | **OInnerLoading** | Absolute overlay over a `relative` parent; blocks the region |
| Content whose *shape* is known but not yet loaded (rows, cards, avatars) | **OSkeleton** | Placeholder that mimics final layout — less jarring than a spinner |
| A small, bare inline "working…" indicator (inside a button, next to text, an AI typing state) | **OSpinner** | Just the spinner, no overlay, no layout |

Rules of thumb:
- **Banner vs Toast**: does the message need to persist and stay tied to a spot in the page? Banner. Is it a fire-and-forget confirmation/error? Toast.
- **Skeleton vs Spinner vs InnerLoading**: Skeleton for first-load of structured content; InnerLoading for re-loading an existing container in place; bare Spinner for tiny inline waits.

---

## Feedback

### OBanner
**Import:** `@/lib/feedback/Banner/OBanner.vue`
**Use when:** You need a persistent, inline message block within the page flow — a form-level error summary, an informational note, a success confirmation that stays, or a soft warning/insight.
**Don't use for:** Transient "operation succeeded/failed" popups — use [Toast](#toast--otoastprovider--usetoast). Not for loading states.
**Key props:**
- `variant` (`"default" | "info" | "success" | "warning" | "error" | "error-soft"` — default `"default"`). `error` is a solid hard-failure banner; `error-soft` is a tinted, left-accent-bar variant for hints/insights.
- `content` (`string`) — message text, used only when the default slot is empty.
- `icon` (`string`) — OIcon name shown in the leading icon area.
- `dense` (`boolean` — default `false`) — tighter padding.
- `inlineActions` (`boolean` — default `false`) — lays the actions slot in the same row as the content instead of below it.
- `dataTest` (`string`) — forwarded to the root `data-test`.

`role` is derived automatically: `alert` for `error`/`warning`, otherwise `status`.
**Slots:** `default` (message body, overrides `content`), `icon` (custom leading icon, overrides `icon` prop), `actions` (buttons/links).
**Emits:** none.
**Example:**
```vue
<OBanner
  variant="error-soft"
  icon="lightbulb"
  data-test="alerts-add-alert-banner"
>
  This threshold has not fired in the last 30 days. Consider lowering it.
  <template #actions>
    <OButton variant="ghost" @click="dismiss">Got it</OButton>
  </template>
</OBanner>
```
**Family:** standalone (no sibling parts).

### OInnerLoading
**Import:** `@/lib/feedback/InnerLoading/OInnerLoading.vue`
**Use when:** An existing container (panel, card, table region) is (re)loading and you want to dim it with a centered spinner + optional label. The overlay is absolutely positioned, so the parent must be `relative`.
**Don't use for:** First-time load of content whose skeleton you can mimic — prefer [OSkeleton](#oskeleton). For a bare inline spinner with no overlay, use [OSpinner](#ospinner).
**Key props:**
- `showing` (`boolean`, required) — toggles the overlay (fades in/out over 200ms).
- `label` (`string`) — optional text under the spinner; also becomes the `aria-label` (falls back to `"Loading"`).
- `size` (`"xs" | "sm" | "md" | "lg" | "xl"` — default `"xs"`) — spinner size (uses the `ring` OSpinner).
**Slots:** none.
**Emits:** none.
**Example:**
```vue
<div class="relative min-h-40">
  <OInnerLoading :showing="isFetching" label="Loading results" size="sm" />
  <ResultsTable :rows="rows" />
</div>
```
**Family:** wraps [OSpinner](#ospinner) internally.

### OSkeleton
**Import:** `@/lib/feedback/Skeleton/OSkeleton.vue`
**Use when:** Content shape is known but data hasn't arrived — render one or more skeletons matching the final layout (text lines, avatar circles, card blocks) for first load.
**Don't use for:** Re-loading a populated container in place (use [OInnerLoading](#oinnerloading)) or a tiny inline wait (use [OSpinner](#ospinner)).
**Key props:**
- `type` (`"rect" | "circle" | "text"` — default `"rect"`). `rect` = full-width rounded block; `circle` = square aspect, fully rounded (avatars); `text` = full-width line at text height.
- `animation` (`"pulse" | "wave" | "none"` — default `"wave"`; note the type's doc-comment says `pulse` but the component default is `wave`). `wave` is a GPU-composited shimmer sweep.

Sizing is done with utility classes on the element (it renders a `span`) — set width/height via Tailwind since the component only fixes shape defaults.
**Slots:** none.
**Emits:** none.
**Example:**
```vue
<div class="flex items-center gap-3">
  <OSkeleton type="circle" class="size-10" />
  <div class="flex-1 flex flex-col gap-2">
    <OSkeleton type="text" class="w-1/2" />
    <OSkeleton type="text" />
  </div>
</div>
```
**Family:** standalone.

### OSpinner
**Import:** `@/lib/feedback/Spinner/OSpinner.vue`
**Use when:** You need just a spinning indicator — inside a button, beside a line of text, or an AI "typing" state — with no overlay and no layout scaffolding.
**Don't use for:** Dimming a whole region (use [OInnerLoading](#oinnerloading)) or placeholdering structured content (use [OSkeleton](#oskeleton)).
**Key props:**
- `variant` (`"ring" | "dots"` — default `"ring"`). `ring` for general loading; `dots` (three bouncing dots) for AI/typing contexts.
- `size` (`"xs" | "sm" | "md" | "lg" | "xl"` — default `"md"`).
**Slots:** none.
**Emits:** none.
**Example:**
```vue
<OButton :disabled="saving">
  <OSpinner v-if="saving" variant="ring" size="xs" />
  <span>Save</span>
</OButton>
```
**Family:** standalone; consumed by [OInnerLoading](#oinnerloading).

### Toast — OToastProvider + useToast
**Import:**
- Provider: `@/lib/feedback/Toast/OToastProvider.vue`
- Composable: `import { useToast } from "@/lib/feedback/Toast/useToast"` (also exports a bare `toast` for use outside the Vue tree — services, `main.ts`)

**Use when:** You need a transient, floating notification confirming an action or reporting a background result. This is the O2 replacement for `q-notify`.
**Don't use for:** Persistent inline messages tied to a spot in the layout — use [OBanner](#obanner).

**Setup — mount the provider once at the app root.** `OToastProvider` reads a module-level singleton store, so it must appear exactly once near the top of the app; every `toast()` call anywhere renders through it.
```vue
<!-- App.vue (or the root layout), once -->
<template>
  <router-view />
  <OToastProvider />
</template>
<script setup lang="ts">
import OToastProvider from "@/lib/feedback/Toast/OToastProvider.vue";
</script>
```

**Firing a toast.** Call `useToast()` inside a component to get `{ toast, toasts, dismissAll }`. `toast(options)` returns a **dismiss function** — call it to close early, or pass a `replacement` toast (used with the `loading` variant to swap in a result).

**`toast(options)` — key options:**
- `message` (`string`, required) — plain text only (no HTML). Auto-capitalized.
- `variant` (`"success" | "error" | "warning" | "info" | "loading" | "default"` — default `"default"`).
- `title` (`string`) — bold line above the message.
- `titleCount` (`number`) — count badge next to the title.
- `timeout` (`number` ms; `0` = persistent). Per-variant defaults: `success`/`info`/`default` = 5000, `error`/`warning` = 30000, `loading` = 0.
- `position` (`"top-center" | "top-right" | "top-left" | "bottom-center" | "bottom-right" | "bottom-left"`). Default per variant is `bottom-center`.
- `action` (`{ label, handler, successLabel? }`) — an action button inside the toast; `successLabel` temporarily replaces the label after click (e.g. "Copied!").
- `details` (`{ label, url }[]`) — collapsible list of affected resources.
- `onDismiss` (`() => void`) — called once when the toast closes (user or timeout).

**Return value:** `toast()` returns `DismissFn` — `(replacement?: { variant, message, title }) => void`. The `loading` variant renders no UI; the pattern is to fire it, then call the returned fn with a `replacement` when work finishes.

Duplicate identical open toasts collapse into one record with a count badge (a polling 403 won't stack). `dismissAll()` clears everything (use on org switch / logout).

**Example:**
```vue
<script setup lang="ts">
import { useToast } from "@/lib/feedback/Toast/useToast";

const { toast } = useToast();

async function save() {
  const done = toast({ variant: "loading", message: "Saving alert…" });
  try {
    await api.saveAlert();
    done({ variant: "success", message: "Alert saved" });
  } catch {
    done({ variant: "error", message: "Failed to save alert" });
  }
}

function copyLink(url: string) {
  toast({
    variant: "success",
    title: "Share link",
    message: "Link ready",
    action: {
      label: "Copy",
      successLabel: "Copied!",
      handler: () => navigator.clipboard.writeText(url),
    },
  });
}
</script>
```
**Family:** `OToastProvider.vue` (mount once), `OToast.vue` (single toast, rendered internally), `useToast.ts` (public API). You author with the provider + `useToast()`; `OToast` is internal.

---

## Data display

### OProgressBar
**Import:** `@/lib/data/ProgressBar/OProgressBar.vue`
**Use when:** Showing determinate progress or a proportion (0–1) — upload progress, quota usage, a percentage fill.
**Don't use for:** Indeterminate "still working" states — use [OSpinner](#ospinner) or [OInnerLoading](#oinnerloading).
**Key props:**
- `value` (`number`, required) — between 0 and 1; clamped to that range internally.
- `variant` (`"default" | "warning" | "danger"` — default `"default"`) — semantic fill color.
- `size` (`"xs" | "sm" | "md" | "lg"` — default `"sm"`) — track height.
**Slots:** `default` — content rendered inside the filled bar (e.g. a percentage label).
**Emits:** none.
**Example:**
```vue
<OProgressBar :value="usedRatio" variant="warning" size="md">
  {{ Math.round(usedRatio * 100) }}%
</OProgressBar>
```
**Family:** standalone.

### OTimeline / OTimelineItem
**Import:**
- `@/lib/data/Timeline/OTimeline.vue`
- `@/lib/data/Timeline/OTimelineItem.vue`

**Use when:** Rendering an ordered sequence of events with dots and a connecting vertical line — audit history, deployment steps, activity feeds.
**Don't use for:** Hierarchical parent/child data (use [OTree](#otree)) or flat key-value details (use [OFieldList](#fieldlist--ofieldlist--ofieldrow--ofieldlabel)).
**Key props:**
- `OTimeline` — no props; renders an `<ol>` and hides the connector line under the last item automatically.
- `OTimelineItem`:
  - `title` (`string`) — bold header line.
  - `subtitle` (`string`) — muted secondary line.
  - `icon` (`string`) — icon inside the dot; resolves an OIcon SVG name if registered, otherwise treated as a `material-icons` ligature (e.g. `"check_circle"`). Omit for a plain filled dot.
  - `variant` (`"primary" | "success" | "destructive" | "info" | "muted"` — default `"primary"`) — dot color.
**Slots:**
- `OTimeline`: `default` (the `OTimelineItem`s).
- `OTimelineItem`: `default` — extra content below the subtitle row.
**Emits:** none.
**Example:**
```vue
<OTimeline>
  <OTimelineItem
    title="Alert created"
    subtitle="2 hours ago"
    icon="check_circle"
    variant="success"
  />
  <OTimelineItem title="Threshold updated" subtitle="1 hour ago" variant="info">
    <span class="text-xs text-text-secondary">Changed 90 → 80</span>
  </OTimelineItem>
</OTimeline>
```
**Family:** `OTimeline` (list container) + `OTimelineItem` (rows) — always composed together.

### OTree
**Import:** `@/lib/data/Tree/OTree.vue`
**Use when:** Rendering selectable hierarchical data — a nested folder/field tree with tick checkboxes and expand/collapse, with optional filtering.
**Don't use for:** A time-ordered event sequence (use [OTimeline](#otimeline--otimelineitem)) or flat detail rows (use [OFieldList](#fieldlist--ofieldlist--ofieldrow--ofieldlabel)).
**Key props:**
- `nodes` (`TreeNode[]`, required) — each node: `{ label, children?, disabled?, [extra] }`.
- `nodeKey` (`string` — default `"label"`) — field used as each node's unique key.
- `tickStrategy` (`"leaf"` — default `"leaf"`) — only leaves are tickable; parents show indeterminate when partially ticked and act as tick-all shortcuts.
- `ticked` (`(string | number)[]` — default `[]`) — controlled ticked keys; pair with `@update:ticked`.
- `expanded` (`(string | number)[]` — default `[]`) — initial expanded keys.
- `filter` (`string` — default `""`) — hides non-matching nodes; parents stay visible if any descendant matches.
- `filterMethod` (`(node, filter) => boolean`) — custom predicate; defaults to case-insensitive label substring match.
- `defaultExpandAll` (`boolean` — default `false`) — expand every parent on first render.
**Slots:** none (renders from `nodes`).
**Emits:** `update:ticked` (`TreeNodeKey[]`), `update:expanded` (`TreeNodeKey[]`).
**Example:**
```vue
<OTree
  :nodes="streamFields"
  node-key="id"
  :ticked="selectedIds"
  :filter="search"
  default-expand-all
  @update:ticked="selectedIds = $event"
/>
```
**Family:** `OTree` (public) + `OTreeNode.vue` (internal recursive renderer, not imported directly).

---

## Lists

### FieldList — OFieldList / OFieldRow / OFieldLabel
**Import:**
- `@/lib/lists/FieldList/OFieldList.vue`
- `@/lib/lists/FieldList/OFieldRow.vue`
- `@/lib/lists/FieldList/OFieldLabel.vue`

**Use when:** Rendering a dense, scrollable, searchable/paginated panel of fields — the logs/dashboard field sidebar with type icons, hover actions, optional drag-and-drop, grouping, and expandable rows.
**Don't use for:** Hierarchical selection (use [OTree](#otree)) or a small fixed set of label-value details where you don't need search/pagination — there you can use `OFieldRow` + `OFieldLabel` on their own.

**How the three compose:**
- **`OFieldList`** is the container: search box, scroll body, pagination, group headers, drag/expand plumbing. For each field it renders a default row consisting of **`OFieldRow`** wrapping **`OFieldLabel`** — but you'll usually override the `field-row` slot to compose your own row.
- **`OFieldRow`** is a single hover-highlight row shell that reveals an `actions` slot on hover.
- **`OFieldLabel`** renders one field's type icon + truncated label with a tooltip when truncated.

**Key props:**
- `OFieldList` — `fields` (`FieldItem[]`, required; `FieldItem = { name, type?, isGroup?, groupName?, ... }`), `search` (default `""`), `searchPlaceholder` (default `"Search fields"`), `loading` (default `false`), `currentPage` (default `1`), `pageSize` (default `50`), `pageSizeOptions` (default `[50, 100, 250]`), `rowKey` (default `"name"`), `showSearch` (default `true`), `showPagination` (default `true`), `expandedIds` (default `[]`), `draggable` (default `false`), `dragEnabledFn` (`(row, index) => boolean`), `sortFn` (`(a, b) => number`).
- `OFieldRow` — `highlight` (`boolean`) — force the hover-highlight background on.
- `OFieldLabel` — `field` (`{ name, label?, type? }`, required), `showTypeIcon` (`boolean` — default `false`).
**Slots:**
- `OFieldList`: `before-list`, `after-list` (receives pagination helpers: `currentPage, pageSize, totalPages, totalRows, isFirstPage, isLastPage, setPageSize, firstPage, prevPage, nextPage, lastPage`), `field-row` (`{ row, index, draggable, isDragEnabled }`), `field-actions` (`{ row, index }`), `group-header` (`{ row, groupName }`), `expansion` (`{ row }`), `empty`, `loading`.
- `OFieldRow`: `default` (row content), `actions` (revealed on hover).
- `OFieldLabel`: none.
**Emits:**
- `OFieldList`: `update:search`, `update:currentPage`, `update:expandedIds`, `row-click` (`row, MouseEvent`), `row-dblclick` (`row, MouseEvent`), `scroll-end` (`scrollInfo`), `drag-start` (`row, DragEvent`), `drag-end` (`row, DragEvent`).
- `OFieldRow` / `OFieldLabel`: none.
`OFieldList` exposes `scrollToTop()` via template ref.
**Example:**
```vue
<OFieldList
  :fields="fields"
  v-model:search="search"
  :loading="loading"
  draggable
  @row-click="onSelect"
  @drag-start="onDragStart"
>
  <template #field-row="{ row, isDragEnabled }">
    <OFieldRow>
      <OFieldLabel :field="row" :show-type-icon="true" />
      <template #actions>
        <OButton variant="ghost" size="xs" @click.stop="addToChart(row)">+</OButton>
      </template>
    </OFieldRow>
  </template>
  <template #empty>No fields match your search</template>
</OFieldList>
```
**Family:** `OFieldList` (container) + `OFieldRow` (row shell) + `OFieldLabel` (icon + label) — ship and compose together.
