# Overlay & Navigation

O2 overlay primitives (Dialog, Drawer, Dropdown, Popover, Tooltip) and navigation primitives (Pagination, Stepper, Tabs). The overlay primitives are headless-first wrappers over reka-ui; the navigation primitives (Pagination, Stepper) are custom implementations (Tabs uses only reka-ui's `Primitive`). All carry design-system tokens — pick by intent, not by looks.

## Table of contents

- [Overlay decision guide](#overlay-decision-guide)
- Overlay
  - [ODialog](#odialog)
  - [ODrawer](#odrawer)
  - [ConfirmDialog](#confirmdialog) · [EditorDraftLeaveDialog](#editordraftleavedialog)
  - [ODropdown](#odropdown) · [ODropdownItem](#odropdownitem) · [ODropdownGroup](#odropdowngroup) · [ODropdownSeparator](#odropdownseparator)
  - [OPopover](#opopover)
  - [OTooltip](#otooltip)
- Navigation
  - [OPagination](#opagination)
  - [OStepper](#ostepper) · [OStep](#ostep)
  - [OTabs](#otabs) · [OTab](#otab) · [OTabPanels](#otabpanels) · [OTabPanel](#otabpanel)

---

## Overlay decision guide

| If you need…                                                              | Use                   | Not                                                                               |
| ------------------------------------------------------------------------- | --------------------- | --------------------------------------------------------------------------------- |
| A hover/focus hint describing an element (no interaction inside)          | **OTooltip**          | Popover — a tooltip is dismissable-free and passive                               |
| A menu of **actions** (Edit, Duplicate, Delete) triggered by a button     | **ODropdown** + items | Popover — dropdown gives menu semantics (arrow-key nav, typeahead, `role="menu"`) |
| **Freeform** floating content (filter form, color picker, mini info card) | **OPopover**          | Dropdown — popover keeps normal Tab order and frees arrow keys for the content    |
| A short **modal task**: up to about six fields and one decision (create folder, save view) | **ODialog** | Drawer — dialog is for short, self-contained tasks |
| A confirmation (delete, discard, run)                                     | **ConfirmDialog**     | A hand-built ODialog — one confirm component everywhere (V8)                      |
| Inspect or configure while seeing the page behind (row detail, node, stream settings) | **ODrawer** | Dialog — drawer slides from the right and can stay `seamless` (page still usable) |
| The page's main multi-section create or edit                              | A full page           | A 960 drawer or a full-screen dialog (O1, O2)                                    |

Rule of thumb (O1): **Tooltip = hint, Dropdown = action menu, Popover = small setting tied to its trigger, Dialog = short task, Drawer = task beside the page.** Dialog and Drawer share one surface, header, footer (`OOverlayFooter`), action objects, discard guard and `formId` auto-loading — choose by job and size, not capability.

**Fixed sizes (O3) and no movement while open (O4, O5).** Dialogs 400 · 560 · 720, drawers 480 · 640 · 800 · 960, popovers 260 · 320 · 440, menus 200–320, tooltips at most 280. There is no `width`, no vw or percentage, and no width class on any overlay; `local/o2-overlays-api` rejects them.

**No modal chains (O8).** A menu or popover inside a dialog is fine; a dialog or `confirm()` opened from a dialog or drawer is not. A nested create becomes inline (the "New folder" row inside the folder select), and the "Discard changes?" question replaces the overlay's own footer.

---

## Overlay

### ODialog

**Import:** `@/lib/overlay/Dialog/ODialog.vue`
**Use when:** A user must complete a short, self-contained task without leaving the page — create/edit forms, confirmations, focused settings.
**Don't use for:** Long or contextual side-panel work (use **ODrawer**); a menu of actions (use **ODropdown**); a passive hint (use **OTooltip**).
**Key props:**

- `open` (boolean — controlled, use `v-model:open`)
- `size` (`"sm"|"md"|"lg"|"full"` — default `"md"`; sm 400 (confirm, rename, save view), md 560 (create a small object), lg 720 (install, query inspector); `full` only for content that needs the whole window: query profile, screenshot lightbox, the workflow node view (O2, O3))
- `title` (15 px semibold, `text-title`; ignored when `#header` slot used) · `subtitle` (one line, 13 px secondary)
- `primary` · `secondary` · `extra` — **action objects** `{ label, variant?, disabled?, disabledReason?, loading?, dataTest? }`. Footer order is fixed (O7): `extra` left, then `secondary` (Cancel) and `primary` right. An action without a label is not drawn. A busy action freezes the others; a disabled one with `disabledReason` stays focusable and says why (B9). Defaults: primary `"primary"`, secondary `"secondary"`, extra `"ghost"`.
- `dirty` (boolean) — unsaved edits: Escape, ✕ and an outside click put **"Discard changes?" · Keep editing · Discard** in place of the footer (V5, O8) and emit `discard` before closing. A nested `OForm` reports its own edits, so most form dialogs need nothing.
- `persistent` (boolean) — a forced flow that cannot be dismissed (no ✕, Escape and outside clicks ignored). Busy actions already block dismissal; do not use it for "don't lose my input" — that is `dirty`.
- `showClose` (boolean — default `true`; off only when the `#header` slot draws its own close)
- `formId` (string — makes the primary `type="submit"` for that form, with the auto spinner while a nested OForm submits)

**Behaviour:** top-anchored at 12 vh, never centred, so growing content extends downward and never moves the header (O5); header and footer fixed, only the body scrolls, capped at 76 vh (O6); a field-less dialog focuses the primary, or Cancel when the primary is `danger`; Enter submits only a single-field form (V7).
**Slots:** `trigger`, `header` (full override), `header-left`, `header-right`, `default` (body, `text-sm` reading text), `footer` (override), `footer-left`
**Emits:** `update:open`, `click:primary`, `click:secondary`, `click:extra`, `discard` (`click:primary` does NOT fire when `formId` is set — the form's submit handles it)
**Example:** form-in-dialog using action objects + `formId`

```vue
<ODialog
  v-model:open="isOpen"
  :title="t('folders.new')"
  size="md"
  form-id="create-folder-form"
  :primary="{ label: t('folders.create') }"
  :secondary="{ label: t('common.cancel') }"
  @click:secondary="isOpen = false"
>
  <OForm id="create-folder-form" @submit="handleSubmit">
    <OFormInput name="name" :label="t('folders.name')" required />
    <OFormTextarea name="description" :label="t('folders.description')" />
  </OForm>
</ODialog>
```

**Family:** ODrawer (same surface, right edge), ConfirmDialog (confirmations).

---

### ConfirmDialog

**Import:** `@/components/ConfirmDialog.vue` (template form) or `useConfirmDialog().confirm({ … })` (promise form, rendered by `ConfirmDialogProvider`).
**Use when:** Any confirmation. One component everywhere (V8); never a hand-built ODialog with a red primary.
**Key props:** `kind` (`"confirm"|"destructive"|"typeToConfirm"|"discard"` — default `"confirm"`) · `title` · `message`, or `messageKeypath` + `messageName` to **name the object** in bold (V8) · `warningMessage` · `okLabel` (the verb: "Delete alert", "Run backfill" — never "OK", B3) · `cancelLabel` · `confirmText` (the phrase for `typeToConfirm`) · `v-model`
**Kinds:** `confirm` — primary button. `destructive` — red button repeating the verb (defaults to "Delete"), Cancel focused. `typeToConfirm` — only for irreversible bulk or data-losing deletes; the red button stays disabled until the phrase is typed. `discard` — "Discard changes?" · Keep editing · Discard, for settings pages (V3, V5); dialogs and drawers ask in their own footer instead.
**Emits:** `update:ok`, `update:cancel`, `update:modelValue`
**Reversible changes** (pause, disable) apply at once with an Undo toast — no confirm (V8, K1).

### EditorDraftLeaveDialog

**Import:** `@/components/common/drafts/EditorDraftLeaveDialog.vue` (normally through `EditorDraftDialogs` + `useEditorDraft`).
**Use when:** A full-page or canvas editor is left with unsaved changes (V4): "Leave with unsaved changes?" — **Discard** (left, `danger-ghost`) · **Keep draft** · **Save**. Escape or ✕ stays on the page.
**Key props:** `entityLabel` · `canKeepDraft` · `canSave` · `saveDisabledReason` (Save stays visible but disabled with the reason when the editor is invalid; thread it with `useEditorDraft({ saveDisabledReason })`) · `saveLabel` · `saving`
**Emits:** `choose` (`"save" | "keep" | "discard" | "stay"`)

---

### ODrawer

**Import:** `@/lib/overlay/Drawer/ODrawer.vue`
**Use when:** Inspect or configure while the page stays visible behind — row detail, a pipeline node, stream settings, a long contextual form (O1, O2: inspect a row → 640, configure a node → 640). Can stay `seamless` so the page underneath remains interactive.
**Don't use for:** A short task or confirmation (use **ODialog** / **ConfirmDialog**); a one-field form (inline edit or a dialog); a task that covers the page (that is a page).
**Key props:** the ODialog set (`title`, `subtitle`, `primary`/`secondary`/`extra`, `dirty`, `persistent`, `showClose`, `formId`, same footer and discard guard) plus:

- `size` (`"sm"|"md"|"lg"|"xl"` — default `"md"`; sm 480 (help, small forms), md 640 (inspect a row, a node), lg 800 (long forms, schemas), xl 960 (editors with a preview)). No `width`, no vw (O3); under md a drawer takes the full width (R2).
- `tabs` (`{ value, label, count?, dataTest? }[]`) + `v-model:tab` — compact tabs fixed under the header
- `side` (`"right"|"left"` — default `"right"`; `left` is only for the navigation drawer a rail becomes below md, R1)
- `bleed` (boolean — full-bleed body for editors, embedded dashboards, tables that inset themselves)
- `seamless` (boolean — no scrim; the page stays visible) · `modal` (boolean — default `true`; `false` for docked side panels)
- `lazy` (boolean — default `true`) · `portalTarget` · `anchor` + `anchorEdge` (a mobile side panel opens from its trigger's row; see [responsive § Side panels](responsive.md#side-panels-open-from-their-own-row)) · `returnFocusTo`

**Behaviour:** full height from the right, radius 10 on the leading corners; header, tabs and footer fixed, only the body scrolls, the footer never cut off (O6, R3); `dirty` asks "Discard changes?" in the footer (V5).
**Slots:** `trigger`, `header`, `header-left`, `header-right`, `default`, `footer`, `footer-left`
**Emits:** `update:open`, `update:tab`, `click:primary`, `click:secondary`, `click:extra`, `discard`, `after-close`
**Example:** form-in-drawer with `formId` + auto-loading

```vue
<ODrawer
  v-model:open="showEdit"
  size="md"
  :title="t('alerts.edit')"
  form-id="edit-alert-form"
  :primary="{ label: t('alerts.save') }"
  :secondary="{ label: t('common.cancel') }"
  :extra="{ label: t('alerts.delete'), variant: 'danger-ghost' }"
  @click:secondary="showEdit = false"
  @click:extra="askDelete"
>
  <OForm id="edit-alert-form" @submit="save">
    <OFormInput name="name" :label="t('alerts.name')" required />
    <OFormTextarea name="query" :label="t('alerts.query')" />
  </OForm>
</ODrawer>
```

**Family:** ODialog (same surface, centred).

---

### ODropdown

**Import:** `@/lib/overlay/Dropdown/ODropdown.vue`
**Use when:** A trigger (icon button, "•••", "Actions") opens a menu of discrete actions. Gives full menu semantics — arrow-key navigation, typeahead, `role="menu"`.
**Don't use for:** Freeform content like forms or pickers (use **OPopover**); a persistent tab strip (use **OTabs**).
**Key props:** `open` (boolean, `v-model:open`) · `modal` (boolean — default `false`) · `side` (`"top"|"right"|"bottom"|"left"` — default `"bottom"`) · `align` (`"start"|"center"|"end"` — default `"start"`) · `sideOffset` (number — default `4`) · `contentClass` (string — never a width) · `persistent` (`boolean | number` — default `false`; `true`=never close on outside click, `N`=require N outside clicks, useful for nested OSelect: `:persistent="2"`)
**Look (fixed):** 200–320 wide, 4 px inset, `rounded-menu`, 32 px rows in `text-compact`, section labels 11 px tertiary. `OContextMenu` (right-click) is the same surface and takes the same items.
**Rules:** frequent first; destructive items last, after a separator, `tone="danger"`, and they confirm (B7, B8); one submenu level at most (O1, the lint rejects a nested `ODropdownSub`); overflow is ⋯ (B11); no forms in a menu — that is a popover; an action the user can never perform is hidden, one that will become available is `disabled` with `disabled-reason` (B9).
**Slots:** `trigger` (as-child), `default` (ODropdownItem / ODropdownGroup / ODropdownSeparator / ODropdownSub children)
**Emits:** `update:open` (boolean)
**Example:**

```vue
<ODropdown align="end">
  <template #trigger>
    <OButton variant="ghost" icon-only icon="more-vert" :label="t('common.actions')" />
  </template>
  <ODropdownItem icon="edit" shortcut="alertsRowEdit" @select="edit">{{ t("common.edit") }}</ODropdownItem>
  <ODropdownItem icon="content-copy" @select="duplicate">{{ t("common.duplicate") }}</ODropdownItem>
  <ODropdownSub :label="t('alerts.moveToFolder')" icon="folder">
    <ODropdownItem v-for="f in folders" :key="f.id" :checked="f.id === folderId" @select="move(f)">
      {{ f.name }}
    </ODropdownItem>
  </ODropdownSub>
  <ODropdownItem icon="pause" disabled :disabled-reason="t('alerts.viewOnly')">{{ t("alerts.pause") }}</ODropdownItem>
  <ODropdownSeparator />
  <ODropdownItem tone="danger" icon="delete" @select="remove">{{ t("alerts.delete") }}</ODropdownItem>
</ODropdown>
```

**Family:** ODropdownItem, ODropdownGroup, ODropdownSeparator, ODropdownSub (ship together).

---

### ODropdownItem

**Import:** `@/lib/overlay/Dropdown/ODropdownItem.vue`
**Use when:** A single selectable action row inside an ODropdown.
**Don't use for:** A section heading (use **ODropdownGroup**'s `label`); a visual divider (use **ODropdownSeparator**).
**Key props:** `icon` (IconName) · `tone` (`"default"|"danger"` — danger for Delete/Remove, placed last) · `disabled` (boolean) · `disabledReason` (`I18nText` — keeps the item focusable and says why under its label, B9) · `description` (second line of a rich item) · `checked` (boolean — the check mark of a single-choice group; renders `menuitemradio`) · `shortcut` (registry id — the same keys as the tooltip and palette, KB3) · `keys` (raw keycaps when there is no registry id) · `textValue` (typeahead override)
**Slots:** `icon` (a custom glyph instead of `icon`), `default` (label), `end` (trailing count or badge)
**Emits:** `select` (Event)
**Example:**

```vue
<ODropdownItem icon="download" shortcut="alertsRowExport" @select="exportJson">
  {{ t("alerts.exportJson") }}
</ODropdownItem>
```

`ODropdownSub` takes `label`, `icon`, `description` and the `end` slot; its default slot holds the submenu items. `OContextMenuItem` takes exactly the ODropdownItem props.

**Family:** ODropdown, ODropdownGroup, ODropdownSeparator.

---

### ODropdownGroup

**Import:** `@/lib/overlay/Dropdown/ODropdownGroup.vue`
**Use when:** Grouping related items under an optional label inside an ODropdown.
**Don't use for:** A plain divider without a heading (use **ODropdownSeparator**).
**Key props:** `label` (string — optional visible group label)
**Slots:** `default` (items), `label-action` (right-aligned action beside the label)
**Emits:** none
**Example:**

```vue
<ODropdownGroup :label="t('search.menuGroupDownloads')">
  <ODropdownItem icon="data-object" @select="exportJson">{{ t("search.downloadJSON") }}</ODropdownItem>
  <ODropdownItem icon="grid-on" @select="exportCsv">{{ t("search.downloadCSV") }}</ODropdownItem>
</ODropdownGroup>
```

**Family:** ODropdown, ODropdownItem, ODropdownSeparator.

---

### ODropdownSeparator

**Import:** `@/lib/overlay/Dropdown/ODropdownSeparator.vue`
**Use when:** A thin visual divider between groups of dropdown items.
**Don't use for:** A labelled section (use **ODropdownGroup**).
**Key props:** none
**Slots:** none (purely visual)
**Emits:** none
**Example:**

```vue
<ODropdownSeparator />
```

**Family:** ODropdown, ODropdownItem, ODropdownGroup.

---

### OPopover

**Import:** `@/lib/overlay/Popover/OPopover.vue`
**Use when:** Floating content that isn't a list of actions — filter forms, pickers, info cards, mini editors. Keeps normal Tab order; arrow keys belong to the content. Non-modal by default. Descendant overlays (OSelect / OCombobox / nested dropdowns) opened inside won't dismiss it.
**Don't use for:** A menu of actions (use **ODropdown** for menu semantics); a passive text hint (use **OTooltip**); a large modal task (use **ODialog**/**ODrawer**).
**Key props:** `open` (boolean, `v-model:open`) · `size` (`"sm"|"md"|"lg"` — default `"md"`; 260 filter editor, 320 columns, 440 share or kiosk setup; `auto` is reserved for library composites such as the 664 date-time range) · `title` (optional head, 13 px semibold; also the accessible name) · `reserveHeight` (a rem length, e.g. `"20rem"` — the body keeps the tallest state's height, so switching content never resizes it, O4) · `modal` (boolean — default `false`) · `side` · `align` (default `"start"`) · `hideWhenDetached` · `ariaLabel` · `contentClass` (padding only — never a width; the lint rejects one)
**Rules:** fixed width from `size`, anchored once and never re-anchored while open (O3, O4). A filterable list keeps its width and shows "No matches" in place instead of shrinking. More than about four fields, or a decision, is a dialog (O1). Never open a dialog from a popover (O8).
**Slots:** `trigger` (as-child), `default` (content; padded `p-3` when there is a `title` or `#footer`), `footer` (actions, right-aligned)
**Emits:** `update:open` (boolean)

**Info-popover recipe.** Explanatory copy that would otherwise be a paragraph or a
truncated sentence (copy-and-values.md § A sentence cut by an ellipsis): a ghost
info button labelled with what it explains, placed beside the control it qualifies,
icon-only on phones with the label kept for screen readers; the body is one `meta`
paragraph capped to the viewport.

```vue
<OPopover v-model:open="noteOpen" size="lg" side="bottom" align="start" :aria-label="t('dbm.metrics.load.about')">
  <template #trigger>
    <OButton variant="ghost" size="sm" icon="info-outline" data-test="dbm-metrics-load-hint-trigger">
      <span class="max-md:sr-only">{{ t("dbm.metrics.load.about") }}</span>
    </OButton>
  </template>
  <p class="p-3 leading-5" data-test="dbm-metrics-load-hint">
    <OText variant="meta">{{ t("dbm.metrics.load.hint") }}</OText>
  </p>
</OPopover>
```

Use `align="start"` when the button sits at the start of its row; an `OTooltip` is
not a substitute — it is hover-only and never opens on touch.

**Filter-popover recipe.** A "Filters" / "Narrow results" popover is not a loose
stack of selects — build it as **one panel you fill in and dismiss**: a title, a
column of **labelled** fields, then a **pinned action row**. Three rules:

- **Every field carries a label**, even when its placeholder names the dimension
  (`ENGINE` label above an `All engines` placeholder). The label is the axis; the
  placeholder is the *unset* state. Prefer the field component's own `label` prop
  (it wires `for`/`id` + a11y); drop to a hand-rolled micro-label
  (`text-text-label text-3xs font-semibold tracking-wide uppercase`) only when the
  label must match a string shown elsewhere (e.g. a toolbar chip) and be cased up.
- **A pinned action row** at the bottom, divided by `border-t border-border-default`,
  holding **Clear all** (`variant="secondary"`, `:disabled` when nothing is set so its
  place never shifts). **No Done/Apply button when filters apply live** — each
  `@update` already commits, so there is nothing to submit, and the popover
  dismisses on outside-click. Add a primary Done only if the popover *stages*
  changes and commits on close.
- **Don't reserve/hide the reset by presence** — keep Clear all in the layout and
  toggle `:disabled`, so opening the popover doesn't shift the fields upward.

```vue
<OPopover v-model:open="open" size="sm" align="end">
  <template #trigger>
    <OButton variant="secondary" icon="filter-list">{{ t("dbm.filters.scope") }}</OButton>
  </template>
  <div class="flex flex-col">
    <div class="flex flex-col gap-2.5 p-3">
      <p class="text-text-primary text-sm font-semibold">{{ t("dbm.filters.popoverTitle") }}</p>
      <OSelect
        v-for="f in filters"
        :key="f.key"
        :label="f.dimension"
        :model-value="f.value"
        :options="f.options"
        size="sm"
        clearable
        :placeholder="f.placeholder"
        @update:model-value="f.onChange"
      />
    </div>
    <div class="border-border-default flex items-center border-t px-3 py-2.5">
      <OButton variant="secondary" :disabled="!activeCount" @click="clear">
        {{ t("dbm.filters.clearScope") }}
      </OButton>
    </div>
  </div>
</OPopover>
```

Reference implementation: `web/src/components/dbm/DbmScopeFilters.vue` (adds the
set dimensions back to the toolbar as removable `ODimensionChip`s, so an
unfiltered page spends one button and a filtered one shows its scope as chips).

**Family:** ODropdown (menu sibling — shares overlay coordination).

---

### OTooltip

**Import:** `@/lib/overlay/Tooltip/OTooltip.vue`
**Use when:** A passive hover/focus hint describing an element — icon-button labels, disabled-state explanations, a hint that adds information. Two modes: **wrapper** (default slot wraps the trigger) or **child** (no default slot).
**Cut text ("…") is not a hand-wired `OTooltip`:** use **`OTruncatedText`** ([core-display](core-display.md#otruncatedtext)), which shows the full text only while it is cut; in an `OTable` cell the table already does it. Never add an `OTooltip` (or a `title`) that just repeats the visible text.
**Child mode binds to the nearest previous VISIBLE ELEMENT SIBLING, and only falls back to the parent when there is none** — it is not simply "the parent". So put a child-mode `OTooltip` **first** inside the element you want as the trigger; placed after an `<OIcon>` it silently binds to that icon, and only the icon becomes hoverable. Text nodes do not count as siblings, so `<OIcon/> {{ count }} <OTooltip/>` binds to the icon and leaves the count dead. This shipped in the alert-dependency count chips, where the tooltip fired on a 12px glyph inside a 52px chip.
**Don't use for:** Anything the user interacts with inside the bubble (use **OPopover**); an action menu (use **ODropdown**).
**Key props:** `content` (`I18nText` — one line: the action or the fact, sentence case) · `side` (`"top"|"right"|"bottom"|"left"` — default `"top"`; flips once, centred and clamped to the viewport) · `shortcut` (registry id — the key chips, matching OButton's `shortcut`, B6, KB3) · `keys` (raw keycaps when there is no registry id) · `disabled` (boolean) · `open` (boolean — controlled) · `contentClass` (never a width) · `overflowOnly` (boolean — open only while the trigger's text is actually cut; without `content` it shows that text. `OTruncatedText` is built on this — reach for it first) · `anchor` (`HTMLElement | null` — one tooltip shared by many targets, visibility follows `open` alone) · `hoverable` (legacy: links or selectable text belong in a popover)
**Fixed look and timing:** at most 280 wide, `rounded-menu`, 350 ms delay (instant for a neighbour inside the skip window), 6 px from the trigger. There is no `maxWidth`, `delay`, `sideOffset` or `align` — `local/o2-overlays-api` rejects them. Nothing interactive inside (O1).
**Slots:** `default` (trigger — single focusable element; omit for child mode), `content` (rich content, overrides `content` prop)
**Emits:** `update:open`
**Example:**

```vue
<!-- wrapper mode -->
<OTooltip :content="t('panel.run')" shortcut="panelEditorRun">
  <OButton variant="ghost" icon-only icon="refresh" :label="t('common.refresh')" />
</OTooltip>

<!-- child mode: attaches to the parent element, no default slot -->
<button>
  Save
  <OTooltip content="Saves without closing" />
</button>
```

**Family:** standalone.

---

## Navigation

### OPagination

**Import:** `@/lib/navigation/Pagination/OPagination.vue`
**Use when:** The one pager (D5, S8): "1–20 of 143", the page-size select and previous / next, all sm 28; first and last only past ten pages. `OTable` renders it in its footer — use it directly only for a paged list that is not an `OTable`.
**Don't use for:** Switching between content sections (use **OTabs**); a linear multi-step flow (use **OStepper**); logs and spans that scroll (D5). Never hand-build a pager.
**Key props:** `page` (`v-model:page`, 1-based) · `pageSize` (`v-model:page-size`) · `pageSizes` (number[]; no "All") · `total` ("1–20 of 143") · `totalExact` (false → "of many", no Last) · `pageCount` (without `total`: "Page 4 of 31") · `loading` (inactive but focusable) · `disabledReason` · `testIds`. `max`, `maxPages`, `disable` and `v-model` are gone (`local/o2-table-api`).
**Slots:** `range` (`{ text }`) — replace or empty the range
**Emits:** `update:page` (number) · `update:pageSize` (number)
**Example:**

```vue
<OPagination v-model:page="page" v-model:page-size="size" :page-sizes="[20, 50, 100]" :total="total" />
```

**Family:** standalone.

---

### OStepper

**Import:** `@/lib/navigation/Stepper/OStepper.vue`
**Use when:** A guided linear flow across multiple steps — a wizard, or (with `expanded`) a progress checklist/timeline. Root container owns the active-step state and only the active step's panel shows by default.
**Don't use for:** Peer content sections switched in any order (use **OTabs**); paging a list (use **OPagination**).
**Key props:** `modelValue` (number — active step, required, `v-model`) · `orientation` (`"horizontal"|"vertical"` — default `"horizontal"`) · `animated` (boolean — default `true`) · `navigable` (boolean — default `false`; allow clicking completed headers to go back) · `expanded` (boolean — default `false`; render ALL step panels at once as a checklist/timeline)
**Slots:** `default` (OStep children)
**Emits:** `update:modelValue` (number), `change` (number)
**Example:**

```vue
<OStepper v-model="currentStep" navigable>
  <OStep :name="1" title="Source" :done="currentStep > 1">
    <SourcePicker />
  </OStep>
  <OStep :name="2" title="Transform" :done="currentStep > 2">
    <TransformConfig />
  </OStep>
  <OStep :name="3" title="Review">
    <ReviewSummary />
  </OStep>
</OStepper>
```

**Family:** OStep (required children).

---

### OStep

**Import:** `@/lib/navigation/Stepper/OStep.vue`
**Use when:** One step within an OStepper — registers itself and renders its content when active.
**Don't use for:** Standalone use — must be a child of OStepper.
**Key props:** `name` (number — unique, matched against OStepper `v-model`, required) · `title` (string, required) · `icon` (IconName | Lucide Component | null — replaced by a checkmark when `done`) · `done` (boolean — default `false`; typically `:done="currentStep > N"`) · `navigable` (boolean — per-step override; inherits OStepper when undefined) · `description` (string — subtitle under the title) · `error` (boolean — default `false`; error state on the indicator)
**Slots:** `default` (step content, shown only when active), `title-suffix` (inline content next to the title — vertical orientation only)
**Emits:** none
**Example:**

```vue
<OStep
  :name="2"
  title="Transform"
  description="Optional"
  :done="step > 2"
  :error="hasError"
>
  <TransformConfig />
</OStep>
```

**Family:** OStepper (required parent).

---

### OTabs

**Import:** `@/lib/navigation/Tabs/OTabs.vue`
**Use when:** Peer pages or sections (N2): page tabs (40 px) in the page header's tab row, compact tabs (32 px) inside a drawer or panel. Owns the active-tab state; pair with OTabPanels/OTabPanel, or give each OTab a `to` for route tabs.
**Don't use for:** A linear wizard (use **OStepper**); a view or object-type switch (use **OToggleGroup**); narrowing a list by state such as Firing or Paused, which is a filter (F6).
**Key props:** `modelValue` (`string | number`, required, `v-model`) · `size` (`"page"|"compact"`, default `"page"`: 40 or 32 px) · `orientation` (`"horizontal"|"vertical"`; vertical items are 32 px, 28 compact) · `bordered` (boolean) · `reorderable` (boolean; OTabs reports the move, the parent owns the order) · `collapseLabels` (boolean)
**Behaviour:** tabs always start at the content edge. Past six tabs a horizontal, non-reorderable strip folds the rest into one "More ▾" tab (N2); the row never wraps. `dense`, `align`, `mobile-arrows` and `breakpoint` are gone (`local/o2-controls-api`).
**Page tabs:** put the strip in `OPageLayout`'s `#header-tabs` (`#tabs` on a bare `OPageHeader`) and pass **`tabs-below`**, so it gets the full-width row under the title; without it the strip renders inline beside the title and shifts with the title's width (house rule 1).
**Slots:** `default` (OTab children)
**Emits:** `update:modelValue`, `change`, `reorder` (`{ from, to, before }`)
**Family:** OTab, OTabPanels, OTabPanel.

---

### OTab

**Import:** `@/lib/navigation/Tabs/OTab.vue`
**Use when:** One tab inside OTabs. One font weight (500) in every state: selecting changes only the colour and the 2 px accent bar, so nothing moves (P3).
**Key props:** `name` (required) · `label` (`I18nText`) · `icon` · `count` (number; tabular, capped at "999+" and always as wide as "999+"; `null` reserves the width while it loads) · `countTone` (`"default"|"error"`; error only when the count is the exception, C3) · `locked` + `lockedLabel` (lock glyph and its screen-reader text) · `dirty` (unsaved dot) · `disabled` · `tooltip` · `to` (RouteLocationRaw: a route tab that navigates on click and selects itself while `route.name === name`; replaces ORouteTab)
**Removed:** `disable` → `disabled`, `suffixIcon="lock"` → `locked`, `suffixLabel` → `lockedLabel`, an OTag/OBadge count in the slot → `count`. Never set a height or font weight on a tab by class (`local/o2-control-height`).
**Slots:** `default` (custom trigger content), `icon`, `trailing` (controls beside the trigger)
**Example:**

```vue
<OTabs v-model="section" bordered>
  <OTab name="all" :label="t('alerts.all')" :to="{ name: 'alertList' }" />
  <OTab name="destinations" :label="t('alerts.destinations')" :count="destinationCount" />
</OTabs>
```

**Family:** OTabs, OTabPanels, OTabPanel.

---

### OTabPanels

**Import:** `@/lib/navigation/Tabs/OTabPanels.vue`
**Use when:** The container that shows the correct OTabPanel for the active tab. Keep its `modelValue` in sync with OTabs' `v-model`.
**Don't use for:** The tab strip itself (use **OTabs**).
**Key props:** `modelValue` (`string | number` — active tab, keep synced with OTabs) · `animated` (boolean — CSS slide transition between panels) · `keepAlive` (boolean — keep all panel DOM alive when switching, avoids remounting) · `grow` (boolean — default `false`; adds `flex-1` to fill a flex parent) · `scroll` (`"none"|"auto"|"y"` — default `"none"`)
**Slots:** `default` (OTabPanel children)
**Emits:** `update:modelValue` (`string|number`)
**Example:** see OTabPanel below.
**Family:** OTabs, OTab, OTabPanel.

---

### OTabPanel

**Import:** `@/lib/navigation/Tabs/OTabPanel.vue`
**Use when:** The content area for one tab, shown when its `name` matches the active tab.
**Don't use for:** Standalone use — must be a child of OTabPanels.
**Key props:** `name` (`string | number` — must match the OTab `name`, required) · `padding` (`"none"|"sm"|"md"` — default `"none"`) · `layout` (`"block"|"flex-col"|"flex-row"` — default `"block"`) · `stretch` (boolean — default `false`; panel root fills 100% parent height)
**Slots:** `default` (panel content)
**Emits:** none
**Example:** full OTabs + OTab + OTabPanels + OTabPanel pattern

```vue
<script setup lang="ts">
import { ref } from "vue";
const activeTab = ref("logs");
</script>

<template>
  <OTabs v-model="activeTab" bordered>
    <OTab name="logs" label="Logs" icon="list" />
    <OTab name="metrics" label="Metrics" icon="activity" />
  </OTabs>

  <OTabPanels v-model="activeTab" keep-alive grow>
    <OTabPanel name="logs" padding="md">
      <LogsView />
    </OTabPanel>
    <OTabPanel name="metrics" padding="md" layout="flex-col">
      <MetricsView />
    </OTabPanel>
  </OTabPanels>
</template>
```

**Family:** OTabs, OTab, OTabPanels.
