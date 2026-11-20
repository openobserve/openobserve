# Feedback, Data Display & Lists

O2 components for loading states, messaging, transient notifications, hierarchical/temporal data, and label-value detail rows. All source lives under `@/lib/`; import each component from its own `.vue` file.

## Table of contents

- [Loading & messaging decision guide](#loading--messaging-decision-guide)
- Feedback
  - [OBanner](#obanner)
  - [OInlineNotice](#oinlinenotice)
  - [OSkeleton](#oskeleton)
  - [OLoadingLine](#oloadingline)
  - [OSpinner](#ospinner)
  - [Toast — OToastProvider + useToast](#toast--otoastprovider--usetoast)
- Data display
  - [OStatStrip / OStatCard](#ostatstrip--ostatcard)
  - [OProgressBar](#oprogressbar)
  - [OSegmentedBar](#osegmentedbar)
  - [OTimeline / OTimelineItem](#otimeline--otimelineitem)
  - [OTree](#otree)
- Lists
  - [ODescriptionList / ODescriptionItem](#odescriptionlist--odescriptionitem)
  - [OFieldList / OFieldRow / OFieldLabel](#fieldlist--ofieldlist--ofieldrow--ofieldlabel)

## Loading & messaging decision guide

Four channels, each with one job (K1–K5). Pick by **what the message is about**:

| Situation | Use | Why |
| --- | --- | --- |
| The result of an action that is not otherwise visible ("Alert saved", "3 alerts deleted · Undo") | **Toast** | One line, bottom centre, 4 s (8 s with an action) (K1) |
| A lasting condition of the PAGE (quota, partial data, read-only) | **OBanner** | One line directly under the header (K3) |
| A condition of one SECTION (a hint, a check that failed, a field group's warning) | **OInlineNotice** | Inside the section, wraps (K2) |
| First load of content whose shape is known | **OSkeleton** (a `preset` where it fits) | The final layout after 150 ms, never a "0" (K4) |
| A refresh of content already on screen | **OLoadingLine** | Rows stay visible under a 2 px line (K4) |
| A control that is busy (inside a button, beside a value) | **OSpinner** | Busy where the action happened (B10) |
| Nothing to show | **OEmptyState** (core-display.md) | Four kinds; a failed load is `error` (K5) |

Rules of thumb:

- **Errors the user must fix go inline, never in a toast** (K2). A copy confirms in its button
  (`OCopyButton`), not in a toast.
- **No page-level spinner covering content** and no `0` or empty state while loading (C4, K5).
- **Never raw HTTP text** in a banner, notice or empty state (K6); never a solid red fill.

---

## Feedback

### OBanner

**Import:** `@/lib/feedback/Banner/OBanner.vue`
**Use when:** A lasting condition of the PAGE — quota, partial data, read-only, a restored
draft — in ONE line, full width, directly under the header (K3): min 36 px, 16 px tone glyph,
13 px text, `border-b`, the soft status triplet. What, since when, what to do.
**Don't use for:** The result of an action (Toast, K1); a condition of one section
([OInlineNotice](#oinlinenotice)); raw HTTP text (K6).
**Key props:**

- `tone` — `neutral` | `info` (default) | `warn` | `err`. No `ok`: a page condition never
  succeeds. Role follows the tone (`err`/`warn` are alerts).
- `message` (I18nText; the default slot replaces it with rich text)
- `icon` (IconName — only a glyph that names the condition, e.g. `lock`, `history`; never one
  that restates the tone)
- `actionLabel` + `@action` + `actionVariant` (`secondary` | `link`) + `actionDataTest` — ONE
  action at most, sm
- `dismissible` + `@dismiss` — only for a condition the user can safely ignore

**Slots:** `default`, `actions` (one `sm` control, in place of `actionLabel`)
**Removed:** `variant` → `tone` (warning → warn, error and error-soft → err, default → neutral,
success → an OInlineNotice `ok`, promo dropped), `content` → `message`, `dense`,
`inlineActions`, `bar`, `center`, `textSize`, `colors`, `role`, `preserveWhitespace`, slots
`#icon`/`#meta`/`#footer`. `local/o2-display-api` rejects them.
**Example:**

```vue
<OBanner tone="warn" :message="t('usage.quotaNear', { pct: 92 })" :action-label="t('usage.view')" @action="openUsage" />
```

### OInlineNotice

**Import:** `@/lib/feedback/InlineNotice/OInlineNotice.vue`
**Use when:** A condition of one SECTION, inside it: a form group's warning, a check that
failed, a hint ("Schema changes apply to new events only"). `rounded-default`, 1 px edge,
`px-3 py-2`, 13 px, wraps (never cut), icon top-aligned.
**Don't use for:** Page-wide conditions (OBanner) or field errors (under the field, V6).
**Key props:** `tone` (`neutral` | `info` (default) | `warn` | `err` | `ok`), `message`, `icon`,
`actionLabel` + `@action` + `actionVariant` + `actionDataTest` (one end-aligned action). For raw
multi-line text add `class="whitespace-pre-line wrap-anywhere"`.
**Slots:** `default`, `actions` (one `sm` control)
**Removed:** as OBanner, plus `text` → `message`, `variant` (warning/error) → `tone`, `dataTest`
→ a plain `data-test`.

```vue
<OInlineNotice tone="ok" :message="t('destinations.connectionWorks', { ms: 12 })" />
```

### OSkeleton

**Import:** `@/lib/feedback/Skeleton/OSkeleton.vue`
**Use when:** First load of content whose shape is known: a skeleton of the FINAL layout,
shown after 150 ms so a fast load never flashes one (K4). Every skeleton shimmers;
`rounded-chip` (circles `rounded-full`).
**Don't use for:** A refresh of rows already on screen ([OLoadingLine](#oloadingline)) or a busy
control ([OSpinner](#ospinner)).
**Key props:**

- `shape` — `line` (default, 12 px) | `block` | `circle`. Width and height come from the layout
  box it stands in for (classes on the call site); never a radius class.
- `preset` — `tableRows` (`rows`, default 5) | `statStrip` (`count`, default 4) | `chart`:
  whole-layout skeletons.
- `delay` (ms, default 150) — waits `invisible`, so the box is held and nothing jumps.

**Removed:** `type` (text → `line`, rect → `block`), `animation`.

```vue
<OSkeleton v-if="isPending" preset="tableRows" :rows="8" />
<OSkeleton shape="circle" class="size-6" />
```

### OLoadingLine

**Import:** `@/lib/feedback/LoadingLine/OLoadingLine.vue`
**Use when:** A refresh keeps the current rows visible: a 2 px indeterminate accent line at the
top of the region (K4). Its 2 px strip stays when inactive, so nothing shifts.
**Key props:** `active` (boolean, required). Replaces `OInnerLoading` (deleted) and the
hand-made `LoadingProgress` bars.

### OSpinner

**Import:** `@/lib/feedback/Spinner/OSpinner.vue`
**Use when:** Only inside the control that is busy, or beside a value being computed (B10):
a 2 px ring.
**Don't use for:** A region or page — that is a skeleton (first load) or the loading line
(refresh). No page-level spinner covering content.
**Key props:** `size` — `sm` 12 | `md` 16 (default) | `lg` 20.
**Removed:** `variant` (dots), sizes `xs`/`xl`; never a size or colour class.

```vue
<OSpinner size="sm" />
```

### Toast — OToastProvider + useToast

**Import:**

- Provider: `@/lib/feedback/Toast/OToastProvider.vue`
- Composable: `import { useToast } from "@/lib/feedback/Toast/useToast"` (also exports a bare `toast` for use outside the Vue tree — services, `main.ts`)

**Use when:** The result of an action that is not otherwise visible (K1): ONE line,
"<Object> <past verb>" ("Alert saved", "Folder deleted"), on the inverse surface,
`rounded-menu`, always at the bottom centre and lifted above sticky footers and the table's
selection bar (D6; mark another sticky footer with `data-toast-avoid`). 4 s, 8 s with an
action; hover pauses it. A reversible change (pause, disable) applies at once and offers Undo
instead of a confirmation (V8).
**Don't use for:** Field errors (inline, K2), copy confirmations (`OCopyButton`), progress (the
busy control), lasting page conditions ([OBanner](#obanner)).

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

- `message` (I18nText, required) — one line; a longer text is cut and shown in full on hover.
- `variant` (`"success" | "error" | "warning" | "info" | "loading" | "default"`) — `success`
  draws the ok icon, `error` the error icon, the rest neutral.
- `action` (`{ label, handler, successLabel? }`) — one word: Undo, View, Retry; it extends the
  toast to 8 s.
- `timeout` (ms) — leave it unset (4 s / 8 s); `0` only for a persistent error with an action.
- `onDismiss` (`() => void`) — called once when the toast closes.

**Removed:** `title`, `titleCount`, `details`, `position` (always bottom centre), `updateToast`.

**Return value:** `toast()` returns `DismissFn` — `(replacement?: { variant, message }) => void`.
The `loading` variant renders no UI; fire it, then call the returned fn with a `replacement`
when work finishes.

Duplicate identical open toasts collapse into one record with a count badge (a polling 403 won't stack). `dismissAll()` clears everything (use on org switch / logout).

**Example:**

```vue
<script setup lang="ts">
import { useToast } from "@/lib/feedback/Toast/useToast";

const { toast } = useToast();

async function save() {
  const done = toast({ variant: "loading", message: t("alerts.saving") });
  try {
    await api.saveAlert();
    done({ variant: "success", message: t("alerts.saved") });
  } catch {
    done({ variant: "error", message: t("alerts.saveFailed") });
  }
}

function pause(alert: Alert) {
  pauseAlert(alert);
  toast({
    variant: "success",
    message: t("alerts.paused"),
    action: { label: t("common.undo"), handler: () => resumeAlert(alert) },
  });
}
</script>
```

**Family:** `OToastProvider.vue` (mount once), `OToast.vue` (single toast, rendered internally), `useToast.ts` (public API). You author with the provider + `useToast()`; `OToast` is internal.

---

## Data display

### OStatStrip / OStatCard

**Import:** `@/lib/data/StatStrip/OStatStrip.vue` · `OStatCard.vue` (types in `OStatStrip.types.ts`)
**Use when:** The ONE stat primitive, for a real distribution people act on whose numbers vary
and are not already on screen (F7). The strip picks one of three looks by its job:

- **Filter chips** (`selectable`) — 32 px chips (icon or tone dot, label, count badge) in
  `OTable`'s `#toolbar` right after the search, with `:row="false"`. They share the search row
  only while every chip fits (`useInlineFit`), else take their own full-width toolbar line;
  phones always get their own line. Overflow scrolls sideways under edge fades with a chevron,
  never wraps. The reset chip (`default-key`, "All") leads, carries the total and reads as
  quietly selected while nothing is picked; Esc resets. Selected is an accent border plus soft
  fill with a primary count badge; error/warning chips above 0 get a tinted badge. The tooltip
  says what a click does ("Show only / Also show / Stop showing …"). `multiple` toggles chips
  into `v-model:selected-keys` (empty means unfiltered). A strip whose only clickable chip would
  be the reset chip renders as KPIs; `selectable: false` items render as KPIs ahead of the chips.
- **Inline KPI line** (`inline`, read-only) — icon · value · label, no border, for a toolbar
  row. `row` gives a read-only strip its own band above the table header (page-edge padding,
  bottom hairline) — e.g. DB monitoring.
- **Cards** (read-only, or `selectable :tray="false"` tiles that navigate) — value (24/600
  tabular) beside the label, a tone icon chip and a proportion bar that is always drawn; they
  wrap at `basis-52` (`compact`: `basis-36`) and grow to fill the row. `stacked` puts each label
  under its value. Below lg they compact (label moves to the tile's `title`).

**Values (C4):** a value is shown verbatim; pass "—" for unknown and a real `0` renders "0".
Both render muted, and only a non-zero value takes the tone colour. `loading` holds a skeleton
until the FIRST load lands; a refresh keeps the last numbers unless `resetKey` changes.
**Key props:**

- Strip: `items` (`StatItem[]`), `loading`, `selectable`, `tray` (`false` = clickable cards),
  `inline`, `row` (default on for filter chips), `selectedKey` + `@select(key)`, `multiple` +
  `v-model:selected-keys`, `defaultKey`, `compact`, `resetKey`, `compactValues`, `stacked`.
- `StatItem`: `{ key, label, value, icon?, tone?, trend?, max?, sub?, subIcon?, subTooltip?,
  compactValue?, selectable?, dataTest? }`.
- `tone` — `success | warning | error | primary | info | orange | blue | teal | purple |
  neutral` (default). `blue`/`teal`/`purple` mirror the OTag badge groups.
- `trend` — `{ direction: 'up' | 'down' | 'flat', label, tone? }`.
- `OStatCard` takes the same fields plus `variant` (`card` | `chip` | `kpi`, set by the strip),
  `clickable`, `selected`, `quiet`, `hint`, `loading`; slots `#value`, `#icon`, `#chart`
  (overview sparkline).

Use the strip instead of `KpiCard` / `KpiCardRow` / `ProfileStatTile` for new work.
Conventions: [calm-signal.md § Summary-strip conventions](calm-signal.md#summary-strip-conventions).

```vue
<!-- #toolbar, right after the search box -->
<OStatStrip
  :items="summaryStats"
  :loading="loading"
  selectable
  multiple
  :row="false"
  :selected-keys="stateFilters"
  default-key="total"
  class="max-md:order-last"
  data-test="pipeline-list-summary"
  @update:selected-keys="stateFilters = $event"
/>
```

### OProgressBar

**Import:** `@/lib/data/ProgressBar/OProgressBar.vue`
**Use when:** Determinate or indeterminate progress, or a single share: ONE 4 px bar
(`rounded-full`, hover-fill track).
**Don't use for:** A busy control ([OSpinner](#ospinner)) or a refresh
([OLoadingLine](#oloadingline)).
**Key props:**

- `value` (`number | null`, required) — percent 0–100; `null` animates an indeterminate fill.
- `tone` — `accent` (default) | `ok` | `warn` | `err`: status only when the reading is a status.
- `label` (I18nText — the accessible name) · `start` (0–100, left edge for a timeline segment)

**Removed:** `size` (one 4 px bar), `variant` → `tone` (default/neutral → accent, success →
ok, warning → warn, danger → err), `indeterminate` → `:value="null"`, `color`, the default
slot, `aria-label` → `label`.

```vue
<OProgressBar :value="usedPct" :tone="usedPct >= 90 ? 'warn' : 'accent'" :label="t('usage.quota')" />
```

**Family:** standalone.

### OSegmentedBar

**Import:** `@/lib/data/SegmentedBar/OSegmentedBar.vue` (types and `SEGMENT_SWATCH` from `OSegmentedBar.types.ts`)
**Use when:** One track split into coloured shares (status mix, usage vs capacity), optionally with tick markers such as a request or limit line.
**Don't use for:** A single 0-1 progress value (use [OProgressBar](#oprogressbar)) or a time series (use a chart).
**Key props:**

- `segments` (`{ id, pct, variant? }[]`, required) — `pct` is 0-100 and clamped; segments render left to right.
- `markers` (`{ id, pct, variant? }[]`, default `[]`) — ticks drawn over the track.
- `variant` per entry (`"default" | "success" | "warning" | "danger" | "info" | "neutral" | "muted" | "contrast"`, default `"default"` = brand accent).
- `size` (`"sm" | "md"` — default `"sm"`) — track height.
- `label` (`I18nText`) — accessible name; without it the bar is `aria-hidden` and a legend must sit beside it.
  **Legend dots:** use the exported `SEGMENT_SWATCH[variant]` background class so dots match the bar; never re-declare the map.
  **Emits:** none. Test hooks: `o-segmented-bar-segment-<id>`, `o-segmented-bar-marker-<id>`.
  **Example:**

```vue
<OSegmentedBar
  :segments="[{ id: 'usage', pct: 62 }]"
  :markers="[{ id: 'limit', pct: 90, variant: 'danger' }]"
  :label="t('usage')"
/>
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

### ODescriptionList / ODescriptionItem

**Import:** `@/lib/lists/DescriptionList/ODescriptionList.vue` · `ODescriptionItem.vue`
**Use when:** The properties of ONE entity in a drawer or detail page, as a real `<dl>`:
160 px labels, values beside them, stacked when the list is under 30 rem wide.
**Don't use for:** Comparing rows — that is a table.
**Rules:** unknown or missing is a muted "—", never blank and never a zero (C4, D4); labels,
not raw keys or booleans ("No", not `false`: W5); machine values are mono (T4).
**Key props:**

- List: `labels` — `text` (default: sans 13 px, secondary labels, for entity properties) |
  `mono` (mono 12 px keys and values, for field keys); `layout` — `auto` (default) | `columns` |
  `stacked`; `emptyLabel` (default "—"); `items` (`{ label, value, mono?, copy? }[]`) in place
  of children.
- Item: `label`, `value` (or the default slot for rich content), `emptyLabel`, `mono` (one
  machine value in a text list), `copy` (an `OCopyButton` on hover, always on touch).

**Slots:** list `default` (items); item `default` (value), `label`
**Removed:** `columns` → `layout`, `dense`, `labelWidth` (one 160 px column), item `stacked` →
`layout="stacked"` on the list. `OValue` stays for a table cell's loading / none / error value.

```vue
<ODescriptionList
  labels="mono"
  :items="[
    { label: raw('k8s.pod.name'), value: pod.name, copy: true },
    { label: raw('k8s.namespace'), value: pod.namespace },
  ]"
/>
<ODescriptionList>
  <ODescriptionItem :label="t('alerts.owner')" :value="alert.owner" />
  <ODescriptionItem :label="t('alerts.query')" :value="alert.sql" mono copy />
</ODescriptionList>
```

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
        <OButton
          variant="ghost"
          icon-only
          size="xs"
          icon="add"
          :label="t('metrics.addToChart')"
          @click.stop="addToChart(row)"
        />
      </template>
    </OFieldRow>
  </template>
  <template #empty>No fields match your search</template>
</OFieldList>
```

**Family:** `OFieldList` (container) + `OFieldRow` (row shell) + `OFieldLabel` (icon + label) — ship and compose together.
