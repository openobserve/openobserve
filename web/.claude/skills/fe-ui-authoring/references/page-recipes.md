# Page Recipes (standard layouts)

How to lay out a whole page so every screen has the same anatomy. Two recipes
cover almost everything: a **listing/table page** and a **detail/editor page**.
Follow the recipe rather than improvising a layout — that's what makes the app
feel like one product.

## Table of contents

- [Every page = AppPageHeader + body](#every-page--apppageheader--body)
- [Recipe: listing / table page](#recipe-listing--table-page)
  - [The mandatory listing toolbar: search · refresh · column toggle](#the-mandatory-listing-toolbar)
  - [Columns: hideable + default-hidden + persisted](#columns-hideable--default-hidden--persisted)
  - [States, actions, shortcuts, data](#states-actions-shortcuts-data)
- [Recipe: detail / editor page](#recipe-detail--editor-page)
- [Listing-page checklist](#listing-page-checklist)

---

## Every page = AppPageHeader + body

Any routed view is: an `AppPageHeader` (rule 1) on top, then the page body below
it in a `flex flex-col min-h-0` container so the body can scroll/fill without the
header moving.

- **Primary page action** (New / Add / Create) and page-level secondary actions
  (Import, an overflow `ODropdown`) go in the header's **`#actions`** slot as O2
  buttons — never in the table toolbar.
- The header owns its own chrome — don't wrap it in a bordered/padded div.

```vue
<template>
  <div class="flex flex-col h-full min-h-0">
    <AppPageHeader :title="t('channels.title')" icon="notifications" :subtitle="t('channels.subtitle')">
      <template #actions>
        <OButton variant="primary" size="sm" icon-left="add" data-test="channels-new" @click="create">
          {{ t("channels.new") }}
        </OButton>
      </template>
    </AppPageHeader>

    <div class="flex-1 min-h-0">
      <!-- recipe body goes here -->
    </div>
  </div>
</template>
```

---

## Recipe: listing / table page

A listing page is `AppPageHeader` + an `OTable` that **always** carries three
toolbar affordances: a **search** box, a **refresh** button, and a
**column-visibility (show/hide columns) toggle**. These are the default standard
for every list — don't ship a listing page without them.

```vue
<OTable
  :data="rows"
  :columns="columns"
  row-key="id"
  :loading="loading"
  :page-size="20"
  :page-size-options="[20, 50, 100]"
  show-global-filter
  v-model:global-filter="search"
  :global-filter-placeholder="t('channels.search')"
  :column-visibility="defaultColumnVisibility"
  :persist-columns="true"
  table-id="channels-list"
  :enable-column-resize="true"
  data-test="channels-table"
  @row-click="edit"
>
  <!-- refresh lives in the trailing edge of the toolbar -->
  <template #toolbar-trailing>
    <OButton
      variant="outline"
      size="icon-sm"
      icon-left="refresh"
      :loading="loading"
      data-test="channels-refresh"
      @click="fetchChannels"
    >
      <OTooltip side="bottom" :content="t('channels.reload')" shortcut-id="channelsRefresh" />
    </OButton>
  </template>

  <template #empty><OEmptyState :title="t('channels.empty')" /></template>
</OTable>
```

### The mandatory listing toolbar

**Search.** Two accepted ways:
- **Built-in global filter** (simplest, client-side): set `show-global-filter`,
  `v-model:global-filter`, and `:global-filter-placeholder`. Good when the full
  list is in memory.
- **Custom search in the `#toolbar` slot**: put an `OInput` (with a leading
  `search` icon) that fills the bar — use this when search is server-driven or
  needs extra controls (scope toggles, etc.). Set `:show-global-filter="false"`
  and drive the query yourself.

**Refresh.** An `OButton size="icon-sm" icon-left="refresh" :loading` in the
`#toolbar-trailing` slot, wired to the same fetch function the page uses on
mount. Attach an `OTooltip` with `shortcut-id` so it advertises the `r` shortcut.

**Column show/hide toggle.** `OTable` renders the column-visibility button
**automatically** — but only when **all three** hold:
1. `:persist-columns="true"`,
2. a stable `table-id="..."`, and
3. at least one non-action column is marked `hideable: true`.

So to get the toggle button, mark your optional columns `hideable` and set
`persist-columns` + `table-id`. There's no manual button to add — omit any of the
three and the button silently won't appear.

### Columns: hideable + default-hidden + persisted

```ts
const columns = computed<OTableColumnDef<Channel>[]>(() => [
  { id: "name", header: t("channels.name"), accessorKey: "name" },
  { id: "type", header: t("channels.type"), accessorKey: "type" },
  { id: "url", header: t("channels.url"), accessorKey: "url", hideable: true },
  { id: "lastUsed", header: t("channels.lastUsed"), accessorKey: "lastUsed",
    cell: OTimeCell, hideable: true },
  { id: "actions", header: "", isAction: true, cell: /* row buttons */ },
]);

// Hide non-essential columns by default — the user can re-show them via the
// toggle, and the choice persists per table-id. Keep identity columns visible.
const defaultColumnVisibility = { lastUsed: false };
```

- **Mark optional columns `hideable: true`** — that both enables the toggle
  button and lets the user hide them.
- **Hide non-essential columns by default** via `:column-visibility="{ id: false }"`.
  Keep the identifying columns (name, status) visible; hide secondary/metadata
  columns (timestamps, ids, counts) by default so the default view is clean.
- **`persist-columns` + `table-id`** makes both column sizing and the user's
  show/hide choices survive reloads. The `table-id` must be unique and stable.
- The actions column is `isAction: true` (excluded from the toggle) and renders
  O2 buttons per row.

### States, actions, shortcuts, data

- **Loading / empty / error:** pass `:loading`; provide an `#empty` slot
  (`OEmptyState`) and, if fetch can fail, an `#error` slot. Never leave a blank
  table.
- **Primary action** (New) is in the header `#actions`; **row actions**
  (edit/delete/…) are in the `isAction` column as O2 buttons; **destructive
  delete** goes through `ConfirmDialog` + `useConfirmDialog`.
- **Keyboard shortcuts** (register + bind — see
  [keyboard-shortcuts.md](keyboard-shortcuts.md)): `n` → create, `/` → focus
  search, `r` → refresh. Advertise `r` via the refresh button's `OTooltip
  shortcut-id`.
- **Data flow** (see [SKILL.md § Where code goes](../SKILL.md)): fetch through a
  domain service, org from `store.state.selectedOrganization`; hold the rows in a
  local `ref` (or Vuex if shared); keep column defs local.

---

## Recipe: detail / editor page

A detail or create/edit screen that is the page's *primary* task (not a small
form — those go in an `ODialog`/`ODrawer`; see SKILL.md § Forms):

- `AppPageHeader` with a **back** target (`:back="{ label, to }"`) so the leading
  icon tile becomes a Back button, and the title reflects the item.
- Body = the form, built with `OForm` + a colocated Zod schema (see
  [forms-validation.md](forms-validation.md)). Save/Cancel follow the standard
  pair (cancel `outline` / save `primary`, `size="sm-action"`).
- Sub-sections use `OCard` (+ `OCardSection`); tabs within the editor use the
  `OTabs` family or the header's `#tabs` slot.

---

## Listing-page checklist

- [ ] `AppPageHeader` on top; primary **New** action in `#actions`.
- [ ] `OTable` with a **search** box (built-in `show-global-filter` or a custom
      `#toolbar` input).
- [ ] **Refresh** button in `#toolbar-trailing`, wired to the fetch fn, with an
      `OTooltip shortcut-id`.
- [ ] **Column show/hide toggle** present — i.e. `:persist-columns="true"` +
      `table-id` + at least one `hideable` column.
- [ ] Non-essential columns **hidden by default** via `:column-visibility`.
- [ ] `#empty` (and `#error` if fetch can fail) states; `:loading` bound.
- [ ] Row actions in an `isAction` column; delete via `ConfirmDialog`.
- [ ] `n` / `/` / `r` keyboard shortcuts registered and bound.
