# Responsive layout — phones, tablets, and an untouched laptop

Every page in `web/` must work on a phone (375 / 360 px wide) and a tablet
(768 px) **without changing what a laptop shows**. This reference is the method the
whole app was converted with; new pages follow it from the first commit instead of
being retro-fitted.

## Table of contents

- [The contract](#the-contract)
- [Page shell: the header stays on one row](#page-shell-the-header-stays-on-one-row)
- [Side panels open from their own row](#side-panels-open-from-their-own-row)
- [Toolbars: one row, filters become a dropdown](#toolbars-one-row-filters-become-a-dropdown)
- [Tables and row actions](#tables-and-row-actions)
- [Stat strips and KPI cards: one row](#stat-strips-and-kpi-cards-one-row)
- [Popups, dropdowns and dialogs fit the viewport](#popups-dropdowns-and-dialogs-fit-the-viewport)
- [Nothing is clipped](#nothing-is-clipped)
- [Forms and settings rows](#forms-and-settings-rows)
- [Touch has no hover](#touch-has-no-hover)
- [Gotchas that already shipped once](#gotchas-that-already-shipped-once)
- [Verification](#verification)

---

## The contract

| Tier | Width | Tailwind | JS (`useBreakpoint()`) |
| --- | --- | --- | --- |
| Mobile | `< 48rem` (768 px) | `max-md:` | `isMobile` (`!mdUp`) |
| Tablet | `48rem – 64rem` | `md:max-lg:` | `isTablet` |
| Desktop / laptop | `≥ 64rem` (1024 px) | unprefixed | `isDesktop` (`lgUp`) |

1. **Desktop is frozen.** Every responsive rule is *additive below a breakpoint*:
   `max-md:` / `max-lg:` / `md:max-lg:` variants, `@media (max-width: 47.99rem)` in a
   surviving `<style>` block, or a JS branch on `isMobile` / `!lgUp`. An unprefixed
   class change, a bare `md:`/`lg:` class, or a new always-on prop/attribute changes
   the laptop view and is a review blocker — even when it "looks the same".
2. **CSS first, JS only for structure.** Hiding, wrapping, stacking and resizing are
   Tailwind variants. Reach for `useBreakpoint()` (`@/composables/useBreakpoint`) only
   when the *component tree* changes — an inline rail becomes a drawer, a toggle strip
   becomes a dropdown, a splitter locks shut. It is a singleton (one `matchMedia` pair
   for the app), so calling it per component is free.
3. **Reuse the library behaviour.** `OPageLayout`, `OPageHeader`, `OTable`,
   `OToggleGroup`, `OStatStrip`, `KpiCard`, `FolderList`, `ODrawer` and every popup
   already adapt. A new page that uses them correctly is mostly responsive for free;
   hand-rolled equivalents are where phones break.

Audit the desktop surface of a change before calling it done:

```bash
git diff origin/main -- web/src | grep '^+' | grep -vE 'max-md:|max-lg:|md:max-lg:|@media \(max-width'
```

Every added line that still carries a class, prop or style is a potential laptop
change — justify it or gate it.

---

## Page shell: the header stays on one row

`OPageLayout` / `OPageHeader` handle the phone header: the decorative module icon and
the subtitle drop below md, the title truncates, and below lg the row may wrap
(desktop keeps its fixed `h-15` row so `h-full` slot content — inline tabs, dividers —
spans it).

- **Primary actions in `#actions`, secondary ones in `#actions-overflow`.** The
  overflow slot renders inline on desktop and collapses behind one ⋮ "More" button
  below md, so the primary CTA keeps the title row. Add **`overflow-first`** when the
  secondaries sit *before* the primary on desktop (the usual "Import · Export · New"
  order) — without it they render after `#actions`.
- **Never reorder the laptop toolbar by moving a control between slots.** If a
  secondary control sits between primaries on desktop, render it twice:
  `v-if="!isMobile"` at its desktop position in `#actions`, `v-if="isMobile"` in
  `#actions-overflow` (see `ViewDashboard.vue`'s `AutoRefreshInterval`).
- Wide header controls (date pickers) drop their text label below md:
  `class="max-md:[&_.date-time-label]:hidden"`; labelled buttons go icon-only with
  `<span class="max-md:hidden">{{ label }}</span>` and keep a `:title` / `OTooltip`.
- A header should never take more than two rows on a phone. If it does, something
  belongs in `#actions-overflow` or in the page body.

## Side panels open from their own row

Only the main navigation drawer slides in from the top of the screen. Every other
side panel opens **from the row its trigger lives in**, so the chrome above it stays
visible.

- **`OPageLayout #sidebar`** becomes a left `ODrawer` below md. Its ☰ trigger is
  claimed by the page's first `OPageHeader` (no extra row) and the drawer anchors to
  the header's bottom edge; it closes on navigation. Don't add your own trigger row.
  Drawer content mounts lazily, so nothing the page needs on load may depend on a
  sidebar component's mount side effects.
- **`FolderList`** collapses to a one-row folder trigger + drawer below md on its own.
  Pass `:drawer-on-mobile="false"` when it is already inside an `OPageLayout`
  `#sidebar` (a drawer inside a drawer).
- **Any other rail** (field list, facet rail, chat history, integration list):
  hide the inline copy (`max-md:hidden` or `v-if="!isMobile"`) and render the same
  component in a drawer anchored to its trigger's row:

  ```vue
  <div data-drawer-anchor="alert-library-toolbar" class="flex items-center gap-3">
    <OButton class="md:hidden" size="icon-toolbar" icon-left="filter-list"
      data-test="alert-library-mobile-filters-btn" @click="filtersOpen = true" />
    …
  </div>
  <ODrawer v-if="isMobile" v-model:open="filtersOpen" side="left" size="sm" bleed seamless
    anchor='[data-drawer-anchor="alert-library-toolbar"]'>
    <LibraryRail … />
  </ODrawer>
  ```

  `anchor` takes a CSS selector or an element; the drawer's top starts at the
  anchor's top edge, or its bottom edge with `anchor-edge="bottom"` (use that when
  the trigger sits in the header itself).
- **Splitters**: lock the rail pane shut on phones (`:limits="isMobile ? [0, 0] : limits"`
  and set the model to 0), or flip `:horizontal="isMobile"` when both panes should
  stack. Restore the desktop size when the breakpoint flips back.
- **A short rail** (Logs / Metrics / Traces, a handful of sections) reads better as a
  horizontal tab strip than as a drawer: `DataSourceSidebarLayout compact-mode="strip"`,
  or `OTabs :orientation="isMobile ? 'horizontal' : 'vertical'"`.

## Toolbars: one row, filters become a dropdown

The recipe every list toolbar follows:

```vue
<template #toolbar>
  <!-- max-md:contents lets the filter, the search and OTable's own controls share one row -->
  <div class="flex w-full min-w-0 items-center gap-2 max-md:contents">
    <OToggleGroup v-model="typeFilter" mobile-dropdown data-test="channels-type-filter">
      <OToggleGroupItem value="all" size="sm" data-test="channels-type-all">…</OToggleGroupItem>
      …
    </OToggleGroup>
    <div class="min-w-0 flex-1 max-md:min-w-40">
      <OSearchInput v-model="search" class="w-full" … />
    </div>
  </div>
</template>
```

- **`mobile-dropdown`** turns a single-select horizontal `OToggleGroup` into a
  dropdown below md: the trigger shows the active item, the menu lists every item with
  a check on the active one. Data-tests: trigger `<group data-test>-dropdown-btn`,
  items `<item data-test>-item`. `AppTabs` forwards the same prop. This is the answer
  whenever a filter strip would claim its own row — do not hand-roll a second control.
- **Search needs a floor.** `flex-1` is `basis-0`; without `max-md:min-w-40` (or
  `min-w-24` in a crowded row) it shrinks to nothing instead of wrapping. A fixed
  `w-64` search becomes `w-64 max-md:w-auto max-md:min-w-40 max-md:flex-1`.
- **Page toolbars** (Logs / Metrics / Traces style): the mode toggle becomes an
  `ODropdown` showing the current mode (see `MetricsExplorer.vue`),
  `AutoRefreshInterval :is-compact="isMobile"`, text buttons go icon-only, spacers
  that pin a cluster right are `max-md:hidden` and the cluster takes `max-md:ms-auto`.
- An `OTable` toolbar wraps below md and right-aligns its own controls (column toggle,
  `#toolbar-trailing`) automatically.

## Tables and row actions

- **`OTable` handles phones itself**: every column stays, the table scrolls
  horizontally within its frame, oversized columns are capped at 200 px, the index
  column is dropped and persisted desktop column sizes are ignored. Tablets get a
  horizontal-scroll fallback once fill columns can't fit. **Do not hide data columns
  for mobile** — there is no per-column breakpoint flag.
- **Row actions → one kebab below md.** Inline action buttons get
  `class="max-md:hidden"`; add one `ODropdown` whose trigger is `md:hidden` and whose
  items (each `class="md:hidden"`) mirror the inline buttons — same `v-if`, same
  `:disabled`, `data-test="<inline data-test>-menu"`:

  ```vue
  <OButton class="max-md:hidden" icon-left="edit" :data-test="`x-${row.id}-edit`" @click="edit(row)" />
  <ODropdown side="bottom" align="end">
    <template #trigger>
      <OButton icon-left="more-vert" variant="ghost" size="icon-xs-sq" class="md:hidden"
        data-test="x-row-more-actions" @click.stop />
    </template>
    <ODropdownItem icon-left="edit" class="md:hidden" :data-test="`x-${row.id}-edit-menu`"
      @select="edit(row)">
      <span>{{ t("common.edit") }}</span>
    </ODropdownItem>
  </ODropdown>
  ```

  If the row already has an overflow menu, prepend the mirrored items (plus an
  `ODropdownSeparator class="md:hidden"`) instead of adding a second kebab. When every
  item is conditional, `v-if` the whole `ODropdown` on "any item applies" so a row never
  opens an empty menu. Hover-only buttons with no click action (a preview tooltip) have
  no menu counterpart.
- **Footer on one row**: the plain "N items" count is `max-md:hidden` — the pager's
  "x – y of z" already says it. Bulk-action buttons stay.

## Stat strips and KPI cards: one row

`OStatStrip` / `OStatCard` and `KpiCard` / `KpiCardRow` compact below lg to icon +
value; the label moves into the tile's `title`. Use them. A hand-rolled tile row follows
the same recipe so it never takes two rows of chrome:

- row: `max-lg:flex max-lg:flex-wrap max-lg:gap-1.5` (or `max-md:grid-cols-4` for a
  fixed four-up);
- tile: `max-lg:shrink-0 max-lg:basis-auto max-lg:px-1.5 max-lg:py-1`, `:title="label"`;
- label, caption, trend and sparkline: `max-lg:hidden`; value: `max-lg:text-lg`.

## Popups, dropdowns and dialogs fit the viewport

- Library popups (`ODropdown`, `OPopover`, `OSelect`, `OCombobox`, `OColor`, `OTime`,
  `ODateTimeRange`): below lg they cap to the available height, scroll, and keep an
  8 px margin from the viewport edge. Build floating UI from them, not from absolutely
  positioned divs.
- **No popup is wider than the phone.** A fixed width becomes
  `w-156 max-lg:w-[calc(100vw-1.5rem)]`; an inline or constant width uses
  `min(48rem, calc(100vw - 1.5rem))` (see `FIELD_FUNCTION_MENU_WIDTH`). Multi-pane
  popups stack with `max-md:flex-col`.
- `ODrawer` percentage widths clamp to 88% on phones automatically.
- A hover-opened submenu inside a menu needs a tap path below md (see
  [Touch has no hover](#touch-has-no-hover)).

## Nothing is clipped

- **`h-full` beside a stacked sibling** inside an `overflow-hidden` column is clipped
  once the row becomes a column (`max-md:flex-col`): `h-full` beats `flex-1`. Give that
  pane `max-md:h-auto max-md:min-h-0`.
- A fixed-height region whose content grows on phones scrolls: `max-lg:overflow-y-auto`,
  and grids that must size to content use `max-lg:auto-rows-min`.
- `OEmptyState` already scrolls with safe centering below lg; custom hero content goes
  in a `max-lg:overflow-y-auto` container.
- Full-viewport shells use `h-dvh`, never `100vh` (mobile browser chrome overlaps it).
- Long chips and IDs: `max-md:max-w-full max-md:truncate` on the text, not on the row.

## Forms and settings rows

- Side-by-side fields stack: `max-md:flex-col` / `max-md:grid-cols-1`; label/value
  settings grids `grid-cols-3 max-lg:grid-cols-1`.
- Fixed field widths (`w-100`, `min-w-100`, inline `style="width: 30%"`) get
  `max-md:w-full` / `max-md:min-w-0` (with `!` when an inline style must lose).
- Tall editors in a drawer or split view: stack panes below lg
  (`:horizontal="!lgUp"` on the splitter) and give the empty preview pane no height
  until it has something to show.

## Touch has no hover

- Hover-revealed affordances — `opacity-0 group-hover:opacity-100`,
  `invisible group-hover:visible`, `hidden group-hover:flex` — get the matching
  `max-md:opacity-100` / `max-md:visible` / `max-md:flex`.
- A tap fires `mouseenter` **before** `click`. A hover-opened submenu must ignore hover
  below md (`@mouseenter="!isMobile && …"`) and toggle on click only, ignoring clicks
  that land inside the submenu itself.
- Nav/flyout menus that open on hover become inline accordions below md (`ONavGroup`).

## Gotchas that already shipped once

- **`min-h-*` instead of `h-*` on a desktop row breaks `h-full` children.** Percentage
  heights need a definite parent height; keep fixed heights on desktop and relax them
  only below a breakpoint.
- **An empty flex item still costs a `gap`.** Render wrapper divs only when they have
  content, or the siblings shift by the gap.
- **`chevron-down` is not in the icon registry** — it renders an empty box. Use
  `arrow-drop-down` for dropdown carets.
- **Container width ≠ viewport width.** A toolbar squeezed by a folder rail at desktop
  width uses a named container query (`@container/name` + `@max-[38rem]/name:hidden`),
  not a viewport breakpoint.
- **Watchers that resize on the breakpoint** (`watch(isMobile, …, { immediate: true })`)
  must restore the desktop value when flipping back and must not overwrite a user's
  desktop choice on first load.
- **Compact labels must stay correct**: shortening a date range may drop the year only
  when both ends share it.

## Verification

1. In the in-app browser pane (not Playwright) against the local dev server, check
   **375×812, 360, 768×1024 and 1280** for every page you touched.
2. At 1280 compare against main side by side — header height, toolbar order, column
   widths, popup positions. Identical is the bar.
3. Useful in-page probes (`javascript_tool`): elements with `overflow: hidden` whose
   `scrollWidth/scrollHeight` exceed their client size (clipping); the number of distinct
   row tops in the header + toolbar band before the content (chrome rows — aim for one,
   two at most); popup `getBoundingClientRect()` against `innerWidth/innerHeight`.
4. `cd web && npm run lint && npm run type-check:app`, plus the specs of every library
   component you changed. Specs run with a desktop `matchMedia` (min-width queries match),
   so a mobile branch needs its own test that stubs `matchMedia` to not match.
