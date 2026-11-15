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
  - [Denied: the third empty state (`:forbidden`)](#denied-the-third-empty-state-forbidden)
  - [States, actions, shortcuts, data](#states-actions-shortcuts-data)
- [Recipe: detail / editor page](#recipe-detail--editor-page)
- [Recipe: settings form page](#recipe-settings-form-page)
- [Listing-page checklist](#listing-page-checklist)

---

## Every page = OPageHeader + body

Any routed view is an `OPageLayout` (rule 1): the stacked `OPageHeader` on top,
then the page body, all inside a **full-height flex column** so the header stays
put and only the body scrolls. The header is [header-spec.md](header-spec.md):

- **One 56 px band on every page** (H1): a 16 px context line over a 24 px title line
  holding the 18 px title,
  actions on the right. The band never wraps and nothing in it is sized by its
  content, so the title sits at the same x and y on every page.
- **The context line names the container** (H4), derived for you from the route
  through the rail's nav model (`navGroups.ts` + MainLayout's links): the rail
  group ("Reliability", "Data", "Infra", "Experience", "Settings", "Dashboards")
  or nothing on ungrouped pages (the slot stays, empty; never the org). Override it with `:context` only where the
  derivation is wrong (an `OPageHeader` inside a panel). Detail, editor and import
  pages pass **`:back="{ label, to }"`**: the line becomes a real "‹ Parent" link,
  and Back is smart (N3) — see the detail recipe below.
- **The title is the page or object name** (`:title`) and never changes on a tab
  click (H8). Long titles truncate with a tooltip. A `#title` slot is only for an
  inline-edited name control; it owns its overflow.
- **A status chip or count follows the title in `#status`** (H5): "3 firing",
  "Paused", a Beta badge.
- **Actions** (H3): the primary (New / Add / Create) and anything that must never
  fold go in **`#actions`**; secondary page actions (Import, Export) go in
  **`#actions-overflow`**, which renders *before* `#actions` and folds into ⋯ More
  under 640 px (R2). Never in the table toolbar. See
  [responsive.md](responsive.md#page-shell-the-header-stays-on-one-row).
- **The create CTA is "New <object>", label only** (H6) — no `+`, here or on any
  other text button (B4). A text button carries an icon only for ▾, ↗, download,
  upload, copy or run. See
  [house-rules § No `+` on a text button](house-rules.md#no--on-a-text-button-b4-h6).
- **Peer tabs** go in `#header-tabs` (`#tabs` on a bare `OPageHeader`): always their
  own 40 px row under the band, the first label at the content edge (H8, N2). Only
  peer-page navigation belongs there, never a filter or a toggle (F6).
- **No icon and no subtitle** (H2): `icon`, `subtitle` and `#subtitle` are gone. Help
  that the title cannot say goes in **`:about`**, an ⓘ "About this page" popover
  beside the title; filler is dropped.
- **A lasting page condition** (quota, read-only, partial data) is one `OBanner` in
  **`#banner`**, directly under the header and tabs (K3), never a notice inside a
  padded body.
- The header owns its own chrome: its divider and the one 16 px gutter (L3). Never
  wrap it in a bordered or padded div and never put `px-*` or `border-b` on it.
- `local/o2-page-header-api` (in `lint:ci`) rejects the removed props and slots,
  a hand-built back button beside the header, `router.back()` in a page with a
  header, and an `<h1>` in a view.

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

Real listing pages do **not** use a padded `gap-6 p-6` page container. They are an
`OPageLayout` with **`bleed`**: the header carries the one gutter and the body
carries none, so table rows run **flush to the content edges** while the header
title and the table's first column share one grid line:

```vue
<template>
  <OPageLayout :title="t('channels.title')" bleed>
    <template #actions>
      <OButton variant="primary" data-test="channels-new" @click="create">
        {{ t("channels.new") }}
      </OButton>
    </template>
    <OTable … />
  </OPageLayout>
</template>
```

Why it works:

- `OPageLayout` is the fixed-height chain: a full-height column whose header never
  scrolls and whose body is `flex-1 min-h-0`, so the table scrolls internally
  instead of the page.
- **One gutter, applied once (L3).** `--spacing-page-edge` is 16 px. The header
  insets itself with it; a non-`bleed` body is inset by `OContent` with the same
  token; an `OTable` insets its first and last column with
  `--spacing-table-edge` (the gutter plus 2 px). So `bleed` is for a body that owns
  its edge (a table, a chart, a canvas, a `router-view` shell), and an inset body
  never adds its own `px-*` on top. **Never add a `px-*` or `border-b` to
  `OPageHeader`**; it owns its inset and its divider.
- `OTable` has one frame and no frame props (D8) — the app frame provides the
  single content card. The `#header` escape hatch is for the rare page the props
  cannot express; the `OPageHeader` inside still supplies the gutter and divider.

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
  :global-filter="search"            <!-- the OSearchInput in #toolbar below sets it -->
  :column-visibility="defaultColumnVisibility"
  :persist-columns="true"
  table-id="channels-list"
  :enable-column-resize="true"
  data-test="channels-table"
  @row-click="edit"
>
  <!-- filters + search on the LEFT of the toolbar (fills the row); max-md:contents +
       mobile-dropdown keep the phone toolbar on one row -->
  <template #toolbar>
    <div class="flex w-full min-w-0 items-center gap-2 max-md:contents">
      <OToggleGroup
        mobile-dropdown
        :model-value="typeFilter"
        data-test="channels-type-filter"
        @update:model-value="filterByType"
      >
        <OToggleGroupItem value="all">{{ t("channels.all") }}</OToggleGroupItem>
        <OToggleGroupItem value="prebuilt">{{ t("channels.prebuilt") }}</OToggleGroupItem>
        <OToggleGroupItem value="custom">{{ t("channels.custom") }}</OToggleGroupItem>
      </OToggleGroup>
      <div class="min-w-0 flex-1 max-md:min-w-40">
        <OSearchInput
          v-model="search"
          width="list"
          :placeholder="t('channels.search')"
          data-test="channels-search"
        />
      </div>
    </div>
  </template>

  <!-- refresh on the RIGHT (the column-visibility toggle is auto-injected between them) -->
  <template #toolbar-trailing>
    <ORefreshButton
      :last-run-at="dataUpdatedAt"
      :loading="fetching"
      shortcut="channelsRefresh"
      data-test="channels-refresh"
      @click="refreshChannels"
    />
  </template>

  <!-- ONE empty slot handles both first-run and filtered states (see below) -->
  <template #empty>
    <OEmptyState
      v-if="!loading"
      :kind="isFiltered ? 'filtered' : 'first-run'"
      :title="isFiltered ? t('channels.noMatch') : t('channels.emptyTitle')"
      :text="isFiltered ? undefined : t('channels.emptyText')"
      :action-label="isFiltered ? undefined : t('channels.newChannel')"
      @action="onEmptyAction"
    />
  </template>
</OTable>
```

**Toolbar layout is fixed by `OTable`:** `#toolbar` sits on the left (make it fill
with `w-full`/`flex-1`), the **column-visibility toggle is auto-injected**, and
`#toolbar-trailing` (refresh) sits on the right. When a page has filters, put the
filter controls **and** the search box together in `#toolbar`. OTable draws no
search box of its own.

### The mandatory listing toolbar

**Search.** An `OSearchInput width="list"` first in `#toolbar` (F1, F2):
- **Client-side**: bind its text to `:global-filter` and OTable filters the rows.
- **Server-driven**: drive the query yourself (and `filter-mode="server"` if you
  still pass `:global-filter`).

**Refresh.** One `ORefreshButton`, last in the toolbar, showing the data age
(F9), in the `#toolbar-trailing` slot: `:last-run-at` from the query's
`dataUpdatedAt`, `:loading` bound to its `isFetching` (the table's `:loading` is
`isPending`, the cold-read skeleton), and `shortcut` so its tooltip advertises
the `r` shortcut. Never an icon-only `OButton` with a refresh glyph.

The click goes to a **named handler that forces every read the page shows** —
the list and any secondary read (counts, "Used by", dropdown options). Mount,
paging and search read the cache; only a refresh is guaranteed to reach the
server. Full rule: [data-fetching.md § The refresh rule](data-fetching.md#the-refresh-rule).

```ts
const orgId = useOrgId();
const channelsList = useQuery(() =>
  Object.assign(channelsQuery(orgId.value), { enabled: !!orgId.value }),
);
const rows = computed(() => channelsList.data.value ?? []);
const loading = channelsList.isPending;
const fetching = channelsList.isFetching;
// Named handler: `@click="channelsList.refetch"` would pass the MouseEvent in.
const refreshChannels = () => {
  void channelsList.refetch();
  void loadChannelUsage(true); // a secondary read on the same view is forced too
};
```

**Column show/hide toggle.** `OTable` renders the column-visibility button
**automatically** — but only when **all three** hold:
1. `:persist-columns="true"`,
2. a stable `table-id="..."`, and
3. at least one non-action column is marked `hideable: true`.

So to get the toggle button, mark your optional columns `hideable` and set
`persist-columns` + `table-id`. There's no manual button to add — omit any of the
three and the button silently won't appear.

### The table footer

**A footer is never hand-built.** `OTable` draws the same bar on every list: the
pager on the end edge and, on the start edge, nothing — until the page has a
reason to put something there. There is **no total label** ("12 Channels"): the
pager's "1–20 of 143" is the count, so a line that only restates the row total is
not written at all, and an empty table has no pager (D5).

- **Bulk actions → `#selection-actions`.** While rows are selected the bar turns
  into the selection bar (D6): "3 selected", this slot, then Clear. Hand it **the buttons only** — no
  wrapper, no `v-if` on the selection length (the table already hides the slot
  with nothing selected), no margin / height / padding classes, every button
  `size="sm"`, a destructive action last. The count appears once, in the bar:
  never render your own "N selected", and never put a count in a label
  (`{{ t("common.delete") }}`, not "Delete (3)").
- **A line the pager cannot say → `#footer-note`.** A cap or truncation, partial
  data, "filtered x of y", a second figure, a conclusion. Put the `v-if` on the
  `<template>` so the note renders only in the states where it says more, give it
  **one root element**, and add no typography or padding — the bar sets its own
  small secondary text. A root with `max-md:hidden` hides the note on a phone
  without leaving an empty row. Rows selected wins over the note.

```vue
<OTable … selection="multiple" v-model:selected-ids="selectedIds">
  <template #selection-actions>
    <OButton variant="secondary" size="sm" icon="download" data-test="channels-export-selected" @click="exportSelected">
      {{ t("common.export") }}
    </OButton>
    <OButton variant="danger-ghost" size="sm" :loading="deleting" data-test="channels-delete-selected" @click="confirmBulkDelete = true">
      {{ t("common.delete") }}
    </OButton>
  </template>

  <template v-if="truncated" #footer-note>
    <span data-test="channels-truncated">{{ t("channels.truncated", { count: rows.length }) }}</span>
  </template>
</OTable>
```

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
  matches nothing): `kind="filtered"`, a title naming the query, and the default
  **Clear filters** action (K5, F5).
- **Failed load**: `kind="error"` in `#error` with Retry — never the first-run kind.

```vue
<template #empty>
  <OEmptyState
    v-if="!loading"
    :kind="isFiltered ? 'filtered' : 'first-run'"
    :title="isFiltered ? t('channels.noMatch') : t('channels.emptyTitle')"
    :action-label="isFiltered ? undefined : t('channels.newChannel')"
    @action="isFiltered ? clearFilters() : openCreate()"
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

### Denied: the third empty state (`:forbidden`)

A 403 and a genuinely empty list are **both zero rows**, so without help the table
shows the first-run state — inviting a user to "create your first alert" behind
buttons that will each 403. The page carries one boolean so `OTable` can tell them
apart:

```vue
<OTable :loading="loading" :forbidden="forbidden" ... />
```

With `useQuery`, derive it from the query's own error — it follows every
load path by construction:

```ts
const forbidden = computed(() => {
  const e: any = channelsList.error.value;
  return e?.status === 403 || e?.response?.status === 403;
});
```

With an imperative `queryClient.fetchQuery` loader, keep a ref and clear it at
the start of every load:

```ts
const forbidden = ref(false);

const getAlerts = async (folderId: string, force = false) => {
  loading.value = true;
  forbidden.value = false;                 // clear at the START of every load
  try {
    const options = alertsListQuery(orgId.value, folderId);
    if (force) {
      await queryClient.invalidateQueries({ queryKey: options.queryKey, exact: true, refetchType: "none" });
    }
    rows.value = await queryClient.fetchQuery(options);
  } catch (err: any) {
    forbidden.value = err?.response?.status === 403;
    // the grouped access toast already reports a 403; a second red toast adds nothing
    if (!forbidden.value) showErrorNotification(...);
  } finally {
    loading.value = false;
  }
};
```

`OTable` renders the shared `no-access` state ("You don't have access", no action
cards) when `forbidden` is true **and** the table has no rows. It never overrides
visible data.

**The rules that matter:**

- **Only the request that fetches THIS table's rows may set it.** A 403 from a
  *different* endpoint says nothing about this one. Sibling resources are granted
  independently — `dfolder` vs `dashboard`, `alerts` vs `alerts/templates` — so a
  denied folder list must not blank a dashboard list the user can read.
- **Wire every load path.** Initial load *and* refresh/refetch, or the flag goes
  stale between them.
- **The `#empty` slot is the only place for the empty state.** If a page renders
  its first-run state in an outer `v-else-if="!rows.length"` branch, the table
  never mounts when the list is empty and `:forbidden` is dead code. Fold both
  first-run and filtered copy into `#empty` (conditional `title`/`description`)
  so there is one code path.
- **Presentational tables** (a child that receives `:loading` as a prop) need a
  `forbidden?: boolean` prop forwarded the same way; the parent that owns the
  fetch sets it.
- **Never put `data-test` on `OEmptyState` itself** — Vue attribute fallthrough
  lands it on the same root element and silently *replaces* the component's own
  `data-test="o2-empty-state"`. Put it on the wrapper.
- **Beware composables that rewrap errors.** A helper that rejects with
  `new Error(e.message)` drops `.response`, so `err?.response?.status` is
  `undefined` and the flag can never fire. Preserve the status on the rejection.


### States, actions, shortcuts, data

- **Loading / empty / error:** pass `:loading`; provide the single `#empty`
  `OEmptyState` (above) and, if fetch can fail, an `#error` slot. Never leave a
  blank table.
- **Primary action** (New) is in the header `#actions`; **row actions**
  (edit/delete/…) go through `OTable` `row-actions` + `row-menu` (two inline at
  most, the rest in ⋯ with Delete last and red, one kebab below md; B7);
  **destructive delete** goes through `ConfirmDialog` + `useConfirmDialog`. A
  hand-written `#cell-actions` keeps the `max-md:hidden` buttons plus one
  `md:hidden` kebab mirror — see
  [responsive § Tables and row actions](responsive.md#tables-and-row-actions).
- **The name cell is a link that opens the item** (`meta.link`), wherever an open
  or edit target exists; elsewhere it stays text.
- **Keyboard shortcuts** (register + bind — see
  [keyboard-shortcuts.md](keyboard-shortcuts.md)): `n` → create, `/` → focus
  search, `r` → refresh. Advertise `r` via the refresh button's `OTooltip
  shortcut-id`.
- **Data flow** (see [data-fetching.md](data-fetching.md)): read the rows
  through the domain's declared query (`services/<domain>.queries.ts`, reuse
  one if it exists), org from `useOrgId()`; the rows are a `computed` over the
  query's data — never a Vuex copy; writes are `mutationOptions()` that
  invalidate the domain; keep column defs local.

---

## Recipe: detail / editor page

A detail or create/edit screen that is the page's *primary* task (not a small
form — those go in an `ODialog`/`ODrawer`; see SKILL.md § Forms):

- `OPageLayout` with a **back** target, `:back="{ label: t('<parent title key>'), to: parentRoute }"`,
  so the context line reads "‹ Parent" (H4). `label` is the parent page's own
  name (H7), never "Back". The link's href is `to`, so it opens in a new tab like
  any link; a click is smart (N3): it pops history when there is an in-app entry,
  so the list comes back exactly as the user left it, and pushes `to` from a deep
  link. Pass `onClick` instead of `to` only for an in-page parent with no route
  (closing an editor mode); a handler that must do work first navigates with
  `useSmartBack`, never `router.back()`.
- The title is the item's name; its status chip goes in `#status` (H5). Never a
  hand-built back button or a "← Back" text link beside the header (H4).
- Body = the form, built with `OForm` + a colocated Zod schema (see
  [forms-validation.md](forms-validation.md)). Save/Cancel sit in the sticky
  footer of the form column (V2), Cancel then primary (O7), default size.
- Sub-sections use `OCard` (`title`, `#actions`, `#footer`); the editor's peer
  tabs go in `#header-tabs`, their own row under the header (H8).

---

## Recipe: settings form page

An always-editable page of saved values (Settings › General, Organization
parameters, Password policy): no edit mode, no dialog, one Save for the page.

- The shell supplies the header (`OPageHeader`: the title, with the page's one-line help behind `about`); the
  page adds no second title.
- `OForm validate-on="leave"` with a colocated schema; list fields that are
  checked together in `coupled`.
- One `OFormSection variant="plain"` per group, stacked 24 px apart (`gap-6`), with
  `OSettingRow control-at="end" name="<field>"` rows inside. The row prints the
  field's error in place of its description, so nothing moves.
- Rows pass `loading` until the saved values arrive, and the bar gets
  `:loaded="false"` for the same time.
- One `OSaveBar` as the last child of the form, teleported to the shell's
  `SAVE_BAR_SLOT` with `form-id` = the form's id, and `useLeaveGuard` once in
  setup. No other Save or Cancel button on the page.
- After a successful save call `rebaseSavedValues(form, savedValues, submitted)`
  (`@/lib/forms/SaveBar/formCounts`), not `form.reset`: the fields stay editable
  during the request, and an edit made meanwhile must remain an unsaved change
  that still shows its error if it is invalid.
  Show the page's success or error toast. Server field errors go through
  `setServerFieldErrors`.
- Note the organization before the request and skip the store write, the form
  rebase and the toast when the selected organization changed while it ran.
- Uploads, "Add …" and delete actions act at once with their own buttons and are
  not counted by the bar.

```vue
<OForm id="settings-general-form" :form="form">
  <OFormSection variant="plain" :title="t('settings.limits')">
    <OSettingRow
      control-at="end"
      name="max_series"
      :label="t('settings.maxSeries')"
      :description="t('settings.maxSeriesDesc')"
      :loading="isLoading"
    >
      <OFormInput name="max_series" type="number" width="s" />
    </OSettingRow>
  </OFormSection>
  <Teleport defer :to="SAVE_BAR_SLOT">
    <OSaveBar
      class="px-4"
      form-id="settings-general-form"
      :loaded="!isLoading"
      data-test="settings-general-save-bar"
    />
  </Teleport>
</OForm>
```

Components: [forms-specialized.md](forms-specialized.md) § OSaveBar + useLeaveGuard,
[core-display.md](core-display.md) § OSettingRow.

---

## Listing-page checklist

- [ ] `OPageLayout bleed` skeleton: the header carries the one 16 px gutter (L3),
      no `px-*` or `border-b` on it, no page padding, the table runs **flush**.
- [ ] Stacked header (H1): context line derived from the route, title = the page
      name, **no icon and no subtitle** (H2, help in `:about`); primary
      **New <object>** action in `#actions`, **label only, no `+`** (H6, B4);
      peer tabs in `#header-tabs` (H8).
- [ ] Filters + **search** (`OSearchInput`) in `#toolbar`; OTable draws no
      search box and has no frame props.
- [ ] **Refresh** is one `ORefreshButton` in `#toolbar-trailing` showing the
      data age (F9), `:loading` from `isFetching`, with a `shortcut-id`; its
      named handler **forces** the list and every secondary read on the page.
- [ ] Rows come from a declared query (`useQuery` or `fetchQuery`) — no raw
      service/`http` call, no Vuex copy; writes invalidate the domain.
- [ ] **Column show/hide toggle** present — i.e. `:persist-columns="true"` +
      `table-id` + at least one `hideable` column.
- [ ] Non-essential columns **hidden by default** via `:column-visibility`.
- [ ] Single `#empty` `OEmptyState` of the right `kind` (`filtered` when
      search/filter active, its action clearing them; `first-run` otherwise);
      `#error` with `kind="error"` if fetch can fail; `:loading` bound. **No first-run state in an
      outer `v-if` branch** — the table must mount even when the list is empty.
- [ ] **`:forbidden`** bound to a ref the page sets from a 403 on *its own* list
      request (cleared at the start of every load path), so a denied user sees
      "You don't have access" rather than a create CTA that will 403.
- [ ] Row actions in an `isAction` column; delete via `ConfirmDialog`; inline
      buttons `max-md:hidden` + a `md:hidden` kebab mirroring them (`-menu` data-tests).
- [ ] **Footer not hand-built** — bulk actions in `#selection-actions` (buttons
      only, `size="sm"`, destructive last, no count in a label), a note the pager
      cannot say in `#footer-note` (`v-if` on the `<template>`, one root element),
      no total label and no page-rendered "N selected".
- [ ] **Responsive** — toolbar recipe (`max-md:contents`, `mobile-dropdown`, search
      floor), secondary header actions in `#actions-overflow`; checked at
      375 / 768 / 1280 with 1280 identical to main (see [responsive.md](responsive.md)).
- [ ] `n` / `/` / `r` keyboard shortcuts registered and bound.
- [ ] **Registered in navigation** and gated for the right env/role — see
      [navigation-menus.md](navigation-menus.md).
