# Page Recipes (standard layouts)

How to lay out a whole page so every screen has the same anatomy. Two recipes
cover almost everything: a **listing/table page** and a **detail/editor page**.
Follow the recipe rather than improvising a layout — that's what makes the app
feel like one product.

## Table of contents

- [Every page = OPageHeader + body](#every-page--opageheader--body)
- [Where a new page goes in navigation](#where-a-new-page-goes-in-navigation)
- [The listing-page skeleton (flush table, fixed height)](#the-listing-page-skeleton-flush-table-fixed-height)
- [Recipe: listing / table page](#recipe-listing--table-page)
  - [The mandatory listing toolbar: search · refresh · column toggle](#the-mandatory-listing-toolbar)
  - [Columns: hideable + default-hidden + persisted](#columns-hideable--default-hidden--persisted)
  - [Empty state: filtered vs first-run](#empty-state-filtered-vs-first-run)
  - [States, actions, shortcuts, data](#states-actions-shortcuts-data)
- [Recipe: detail / editor page](#recipe-detail--editor-page)
- [Listing-page checklist](#listing-page-checklist)

---

## Every page = OPageHeader + body

Any routed view is: an `OPageHeader` (rule 1) on top, then the page body below
it, all inside a **full-height flex column** so the header stays put and only the
body scrolls.

- **Primary page action** (New / Add / Create) and page-level secondary actions
  (Import, an overflow `ODropdown`) go in the header's **`#actions`** slot as O2
  buttons — never in the table toolbar.
- The header owns its own chrome — don't wrap it in a bordered/padded div, but
  **do** give it horizontal padding and a bottom divider so the header aligns with
  the app frame while the table below runs flush (see the skeleton next).
- The subtitle/description is the **`subtitle`** prop (there is **no**
  `description` prop on `OPageHeader`).

---

## Where a new page goes in navigation

A page isn't done when it renders — it must be **routed and surfaced in
navigation**, and **gated** for the right environment (OSS / cloud / enterprise)
and role. That is a separate, mandatory step with its own rules: which router
composable owns the route, whether the page becomes a top-level rail item / a
Settings sub-page / a hover-flyout child, and how to gate it with
`config.isEnterprise` / `config.isCloud` / `zoConfig.*` flags. **See
[navigation-menus.md](navigation-menus.md)** — don't hand-roll a sidebar link.

---

## The listing-page skeleton (flush table, fixed height)

Real listing pages do **not** use a padded `gap-6 p-6` page container. They use a
full-height flex column where **the header carries the horizontal padding and the
table wrapper carries none**, so table rows run **flush to the content edges**
while the header aligns with the app frame:

```vue
<template>
  <!-- page root: full height, NO page padding -->
  <div class="flex flex-col h-full p-0">
    <!-- header: shrink-0, its OWN horizontal padding + bottom divider -->
    <OPageHeader
      :title="t('channels.title')"
      icon="notifications"
      :subtitle="t('channels.subtitle')"
      class="shrink-0 px-4 border-b border-border-default"
    >
      <template #actions>
        <OButton variant="primary" size="sm" icon-left="add" data-test="channels-new" @click="create">
          {{ t("channels.new") }}
        </OButton>
      </template>
    </OPageHeader>

    <!-- table wrapper: fills remaining height, scrolls internally, NO padding -->
    <div class="card-container flex-1 min-h-0 overflow-hidden">
      <OTable :frame="false" … />
    </div>
  </div>
</template>
```

Why each class matters — these are load-bearing, not decoration:

- **`h-full` + `flex flex-col`** on the root, **`shrink-0`** on the header, and
  **`flex-1 min-h-0 overflow-hidden`** on the table wrapper form the fixed-height
  chain: the header never scrolls, the table body does. `min-h-0` is what lets the
  flex child shrink below its content so the inner scroll area works — omit it and
  the whole page scrolls instead of the table.
- **Header self-insets** (`OPageHeader` bakes in `px-page-edge`, the single
  `--spacing-page-edge` grid line) **+ `border-b border-border-default`**, table
  wrapper **no horizontal padding** → the table is **flush** (rows touch the
  content-area edges) but its first-column inset (also `--spacing-page-edge`)
  lands on the *same* grid line as the header title. **Never add a `px-*` to
  `OPageHeader`** — it owns its inset; a consumer `px-4` would fight the baked
  `px-page-edge` and knock the header 4px off the table. Don't add page padding and
  don't wrap the table in a padded box — that inset breaks the flush alignment.
- **`card-container`** is the existing app class that gives the table area its
  surface background; reuse it, don't invent a `bg-*`/border box (that would
  double-frame the borderless table).
- **`:frame="false"`** on `OTable` keeps it borderless (its default) — the app
  frame provides the single content card. If OPageLayout wraps the view instead,
  its `#header` wrapper is just `shrink-0 border-b border-border-default` — the
  `OPageHeader` inside still supplies the `px-page-edge` inset, so don't re-add
  it via `header-class`.

> Reserve `p-6`/`gap-6` page containers for **form / detail** views (constrained
> content), **not** for full-bleed listing tables.

---

## Recipe: listing / table page

A listing page is `OPageHeader` + an `OTable` that **always** carries three
toolbar affordances: a **search** box, a **refresh** button, and a
**column-visibility (show/hide columns) toggle**. These are the default standard
for every list — don't ship a listing page without them.

```vue
<OTable
  :data="rows"
  :columns="columns"
  row-key="id"
  :loading="loading"
  :frame="false"
  :page-size="20"
  :page-size-options="[20, 50, 100]"
  :show-global-filter="false"        <!-- filters + search live in #toolbar below -->
  :column-visibility="defaultColumnVisibility"
  :persist-columns="true"
  table-id="channels-list"
  :enable-column-resize="true"
  data-test="channels-table"
  @row-click="edit"
>
  <!-- filters + search on the LEFT of the toolbar (fills the row) -->
  <template #toolbar>
    <div class="flex items-center gap-2 w-full">
      <OToggleGroup :model-value="typeFilter" @update:model-value="filterByType">
        <OToggleGroupItem value="all" size="sm">{{ t("channels.all") }}</OToggleGroupItem>
        <OToggleGroupItem value="prebuilt" size="sm">{{ t("channels.prebuilt") }}</OToggleGroupItem>
        <OToggleGroupItem value="custom" size="sm">{{ t("channels.custom") }}</OToggleGroupItem>
      </OToggleGroup>
      <OSearchInput
        v-model="search"
        class="flex-1"
        :placeholder="t('channels.search')"
        clearable
        data-test="channels-search"
      />
    </div>
  </template>

  <!-- refresh on the RIGHT (the column-visibility toggle is auto-injected between them) -->
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

  <!-- ONE empty slot handles both first-run and filtered states (see below) -->
  <template #empty>
    <OEmptyState
      v-if="!loading"
      size="hero"
      preset="no-channels"
      :filtered="!!search || typeFilter !== 'all'"
      @action="onEmptyAction"
    />
  </template>
</OTable>
```

**Toolbar layout is fixed by `OTable`:** `#toolbar` sits on the left (make it fill
with `w-full`/`flex-1`), the **column-visibility toggle is auto-injected**, and
`#toolbar-trailing` (refresh) sits on the right. When a page has filters, put the
filter controls **and** the search box together in `#toolbar` and set
`:show-global-filter="false"` (the built-in global filter is only for the simplest
search-only lists with no other filters).

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

### Empty state: filtered vs first-run

Every listing page shows **two different empty states**, and this is handled by a
**single `OEmptyState` with the `filtered` prop** — you do **not** hand-render two
blocks:

- **First-run / genuinely empty** (no data yet): a `preset` supplies the
  "nothing here — create your first one" copy + create/import action cards.
- **Filtered / searched to zero** (data exists, but the current search/filter
  matches nothing): `OEmptyState` automatically swaps to the "No results found"
  title, description, the magnifier illustration, and a single **Clear filters**
  action — driven entirely by `:filtered="true"`.

```vue
<template #empty>
  <OEmptyState
    v-if="!loading"
    size="hero"
    preset="no-channels"                       <!-- first-run copy + create/import cards -->
    :filtered="!!search || typeFilter !== 'all'"  <!-- true → 'No results found' + Clear -->
    @action="onEmptyAction"
  />
</template>
```

- **Detecting `filtered`:** it is true when the **search term is non-empty and/or
  a non-default filter is active** (`!!search`, `statusFilter !== 'all'`,
  `!!(filters.status || filters.pipelineId)`, …). It is **not** based on comparing
  filtered-count to total.
- **Handle the `clear-filters` action:** when `filtered` is on, `OEmptyState`
  emits `action` with id `"clear-filters"` — reset the search/filter refs to their
  defaults. The same `@action` handler routes the preset's create/import ids:
  ```ts
  const onEmptyAction = (id: string) => {
    if (id === "clear-filters") { search.value = ""; typeFilter.value = "all"; return; }
    if (id === "import") return importChannels();
    createChannel();
  };
  ```
- The **preset** (e.g. `no-channels`) is a registered key that carries the
  first-run title/description/illustration/action cards — pick or add one rather
  than passing raw title/description strings for a listing page.

### States, actions, shortcuts, data

- **Loading / empty / error:** pass `:loading`; provide the single `#empty`
  `OEmptyState` (above) and, if fetch can fail, an `#error` slot. Never leave a
  blank table.
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

- `OPageHeader` with a **back** target (`:back="{ label, to }"`) so the leading
  icon tile becomes a Back button, and the title reflects the item.
- Body = the form, built with `OForm` + a colocated Zod schema (see
  [forms-validation.md](forms-validation.md)). Save/Cancel follow the standard
  pair (cancel `outline` / save `primary`, `size="sm-action"`).
- Sub-sections use `OCard` (+ `OCardSection`); tabs within the editor use the
  `OTabs` family or the header's `#tabs` slot.

---

## Listing-page checklist

- [ ] Full-height flex skeleton: root `flex flex-col h-full p-0`, header
      `shrink-0 border-b border-border-default` (OPageHeader self-insets with
      `px-page-edge` — no `px-*` on it), table wrapper
      `card-container flex-1 min-h-0 overflow-hidden` — **no page padding**, table
      runs **flush**.
- [ ] `OPageHeader` on top (description via **`subtitle`** prop); primary
      **New** action in `#actions`.
- [ ] `OTable :frame="false"`; filters + **search** in `#toolbar`
      (`:show-global-filter="false"`), or the built-in global filter for a
      search-only list.
- [ ] **Refresh** button in `#toolbar-trailing` (`variant="outline"
      size="icon-sm" icon-left="refresh"`), wired to the fetch fn, with an
      `OTooltip shortcut-id`.
- [ ] **Column show/hide toggle** present — i.e. `:persist-columns="true"` +
      `table-id` + at least one `hideable` column.
- [ ] Non-essential columns **hidden by default** via `:column-visibility`.
- [ ] Single `#empty` `OEmptyState` with a `preset` + **`:filtered`** (true when
      search/filter active) + an `@action` that resets on `clear-filters`;
      `#error` if fetch can fail; `:loading` bound.
- [ ] Row actions in an `isAction` column; delete via `ConfirmDialog`.
- [ ] `n` / `/` / `r` keyboard shortcuts registered and bound.
- [ ] **Registered in navigation** and gated for the right env/role — see
      [navigation-menus.md](navigation-menus.md).
