# Calm Signal — the colour language

`design-tokens.md` covers **how** to colour (which token, which utility). This
covers **when** and **what** to colour, so every screen we touch gets more
colourful, scannable, and calm in the same way — not one-off palettes.

> **The one rule: colour is information, never decoration.** Keep a calm neutral
> canvas and spend saturated colour only on the one signal each screen exists to
> surface. The result is colourful and alive, yet restful enough to watch all day.

Apply it in three steps.

---

## Step 1 — Name the screen's primary signal

Every screen answers one question. Colour _that_; keep the rest quiet. Which
signal earns the colour changes by page type:

| Archetype            | Examples                                     | Primary signal → colour                                                         |
| -------------------- | -------------------------------------------- | ------------------------------------------------------------------------------- |
| **Monitoring**       | Alerts, Incidents, RUM errors, Synthetics    | **state / severity / health** — active/paused/failed, firing, recency           |
| **Catalog**          | Dashboards, Streams, Functions, Pipelines    | **organise & orient** — category/type, owner, freshness, size/usage, favourites |
| **Access**           | Users, IAM, Roles, Service accounts          | **role / permission** — privilege runs hot→cool, plus active/invited status     |
| **Forms & settings** | creation flows, editors, org/stream settings | **progress & validity** — where am I, is it right, what still needs me          |

Don't bolt "status" onto a screen that has none. A Dashboards list has no
firing/paused state — its signal is category + recency + ownership.

---

## Step 2 — Colour the signal with the shared toolkit

All token-backed and dark-mode-safe. Reuse these before inventing anything.

- **Summary strip** — `OStatStrip` + `OStatCard`
  ([web/src/lib/data/StatStrip](../../../web/src/lib/data/StatStrip)). **The one
  KPI-tile primitive** — new stat tiles use this, never a hand-rolled tile or the
  legacy `KpiCard`/`KpiCardRow` (being migrated onto `OStatStrip`). A row of KPI
  tiles at the top of a list/dashboard. Data-driven via `:items`
  (`{ key, label, value, icon, tone, max?, trend?, selectable?, dataTest }`);
  `tone` (`success | warning | error | primary | info | orange | neutral`) is the
  single colour knob. Pass `:loading` so values hold a skeleton until the first
  load lands instead of reading "0" (copy-and-values.md § Loading is not zero).
  `max` draws a proportion bar (share of total). The tone icon
  sits in a **rounded-square chip** (`rounded-default`) — every icon chip in the
  app is a rounded square, never a circle (`rounded-full`). A strip has three
  looks, picked by its job: **filter chips** (`selectable`: counts that filter the
  table), an **inline KPI line** (`inline`: read-only counts in a toolbar row), and
  **cards** (read-only overview tiles, or `selectable :tray="false"` tiles that
  navigate). Compose `<OStatCard>` directly (with the `#chart` slot) for sparklines
  on overviews. See **Summary-strip conventions** below for placement, selection
  and overflow.
- **Status / category chips** — `OTag` with a `type=` group from
  `badgeGroups.ts` (`alertStatus`, `alertType`, `severity`, `streamType`,
  `userRole`, `serviceStatus`, …). One registry → the same value is the same
  colour everywhere. Need a new family? Add a group there, don't hand-roll a pill.
  Check the group covers **every** value the API can return (a missing key falls
  back to a generic chip) — and don't set `size` on the group: a group-level size
  silently overrides the call sites, so its chips end up a different size from the
  Status chip beside them. Pass `size` at the call site, matching its siblings.
- **Row state signal** — an extreme-left colour **rail** via `OTable`'s
  per-row `getRowStyle` (inset box-shadow, rem width, token colour) + a **light
  exception highlight** via `row-class`. The rail and the wash are two different
  strengths of the same signal, and the rail is the default:

  |         | Rail (`getRowStyle`)     | Wash (`row-class`)       |
  | ------- | ------------------------ | ------------------------ |
  | Cost    | a few px at the row edge | ~the whole row           |
  | Use for | **every** state, always  | only the two cases below |

  A full-row wash is the loudest thing on a list, so it earns its place only when
  **all three** hold: the state means **act now** (not merely "not green"), it is
  **rare in a healthy system**, and **the row is the unit of action**. In practice
  that leaves exactly two washes:
  - `!bg-status-error-bg` — failing/errored/offline. _Alerts_ failed, _Pipelines_
    errored, _Nodes_ offline, _Synthetics_ failed.
  - `!bg-surface-panel` — paused/disabled. This one is **de-emphasis, not alarm**:
    the row is deliberately inert, so it recedes rather than shouts.

  Everything else keeps a clean row and reads from the rail — including states
  that are "bad but not urgent": **degraded/warning** (worth noticing, not worth
  acting on this second), **stale**, **unknown**, **never-ran**. And whatever the
  state means, if it is **common** the wash is wrong regardless: _Streams_ drops it
  entirely, because "never ingested" and "quiet for a day" describe a large share
  of rows in a normal org and a table where most rows are tinted signals nothing.
  Pages with no failure state at all — Users, Roles, Dashboards — never wash.

- **Recency** — `OTimeCell` `mode="relative"` (`"3 min ago"`) with a hot/warm/
  cold dot, instead of a raw timestamp column.
- **People** — `OUserCell` for owner/author columns.
- **Section identity (forms)** — a soft `icon-chip` header per section
  (`bg-icon-chip-*-bg text-icon-chip-*-text`); a coloured step rail for
  multi-step flows (done=green, current=accent, upcoming=grey); inline
  validation colour (green check / amber warning / red error).

Reference implementation of most of the above: the Alerts list,
[web/src/components/alerts/AlertList.vue](../../../web/src/components/alerts/AlertList.vue).

### Summary-strip conventions

A strip that filters the table is a row of **filter chips**: icon, label and a
count badge, one click each. Reference: the Pipelines and Alerts lists
([PipelinesList.vue](../../../web/src/components/pipeline/PipelinesList.vue)).

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

- **Stats and filters are one control.** Never a stat row plus a separate filter
  dropdown for the same facet, never a tab strip (tabs switch views, they don't
  filter), never a grey tray behind the chips.
- **Multi-select, OR'ed.** Filter chips are `multiple`: a click toggles that chip,
  and rows matching ANY picked chip show. State is a `string[]` (empty means
  unfiltered), filtered with `matchesAnyKey` from
  [utils/filterKeys.ts](../../../web/src/utils/filterKeys.ts). A filter kept in the
  URL or view state is read with `readFilterKeys` (it still accepts an old single
  value) and written with `filterKeysToQuery`. Stay single-select only when the
  backend takes one value and can't OR, or when the chips split the whole set
  (picking both equals All).
- **The reset chip comes FIRST and carries the total.** Its item is the
  `default-key`; it reads as selected (quietly) while nothing is picked, and a
  click empties the selection. There is **no Clear button**: the reset chip and Esc
  do that. Never put `selectable: false` on it (that turns it into a `<div>` and
  leaves no way back to unfiltered).
- **Name the reset chip as a filter, not a stat.** "All", never "Total" ("Total"
  is a read-out). When another "All" sits beside it (a type toggle), name the chip
  by its facet, "All states" / "All statuses" (`common.allStates`,
  `common.allStatuses`), and leave the toggle's "All" as it is.
- **Then attention-first, left → right.** After the reset chip, the most critical
  chip is leftmost, descending to the calm ones (`failed → firing → … → paused`,
  `P1 → P4`). This mirrors the row rail's critical colour on the left edge.
- **Placement: the search row.** Put the strip in `OTable`'s `#toolbar` right
  after the search (and any filter beside it), before refresh, with `:row="false"`,
  as a direct flex child of the toolbar (page wrappers are `contents`). Search is
  `flex-1` with a `md:min-w-48` floor and **no desktop max-width**, so it fills the
  row. The strip stays beside search only when **every** chip fits; otherwise it
  takes its own full-width toolbar line under refresh (`useInlineFit` decides;
  phones are always own-line). Never squeeze chips into a sliver.
- **Overflow scrolls on one line, never wraps.** When even the full line is too
  narrow, the chips scroll sideways: a flat edge block with a plain chevron and a
  surface fade shows only on the side that can scroll, and the chips never shift.
  Touch swipe, trackpad and mouse wheel all scroll it. Don't add your own arrows.
- **Size and look come from the component.** Chips are 32px, the height of the
  search box and toolbar buttons. Selected is an accent border plus soft fill with
  a primary count badge; error/warning chips with a count above 0 get a tinted
  badge. The tooltip says what a click does ("Show only / Also show / Stop
  showing …").
- **Read-only counts are not chips.** Info-only stats above a list are an `inline`
  KPI line (icon · value · label, no border, no hover) in the toolbar row, or their
  own compact `row` above the table header when the toolbar is full (DB
  monitoring). A strip whose only clickable item would be the reset chip renders
  as KPIs. Overview/dashboard tiles stay cards; tiles that **navigate** use
  `selectable :tray="false"` cards, not chips.
- **A strip in the table toolbar is a CLAIM ABOUT THE ROWS — scope decides position.**
  Inside the table frame, a strip promises "these numbers describe the list below",
  so it must be computed from the same filtered set _and_ be facet-clickable. Before
  writing one, check the fetch: **if the list is server-paginated you only hold one
  page**, so page-local sums are not totals — never sum the visible page and label
  it "Total". When the numbers genuinely can't meet the promise (server pagination,
  or totals that come from a different, wider endpoint such as an org-summary API),
  do **not** put them in the table toolbar — lift them to the page level as a read-only
  strip in `OPageLayout`'s **`#subnav`**, where they read as page context instead of
  a row summary, and label them for their real scope ("Total Streams", not
  "Streams"). What stays honest under pagination is anything derived from the single
  row in front of you: relative recency, a state rail, a per-row ratio. Reference:
  Alerts (client-side list → filter chips in the toolbar) vs Streams
  (server-paginated list → org footprint in `#subnav`).
- **`ODataBarCell` needs the whole set — client-paginated tables only.** Its bar is
  a share of the `max` the caller computes over the rendered rows, so on a
  **server-paginated** table it silently means "biggest on this page": the scale
  changes as you page, and the same stream draws a different bar on page 1 and page 4. On such a table drop the bars and let the (sortable) numbers rank the rows —
  right-aligned + `tabular-nums` already scans fine, and the stray part-width
  underlines read as artefacts rather than data. Same test as the strip: can this
  mark be computed from data you actually hold?

**Tile → section → drawer linkage.** When a tile drills into a table or a detail
drawer, reuse the **same glyph + tone** on the section header and the drawer header
so "this number → this table → this drawer" reads at a glance. The AI Observability
panels do this with a small section-header component
([PanelSectionHeader.vue](../../../web/src/enterprise/views/AIObservability/PanelSectionHeader.vue))
whose rounded-square icon chip matches the tile's — copy that pattern whenever a
strip feeds a drill-down.

---

### Before you colour a state, check how it CLEARS

A State column is a claim about _now_. Read the write path of whatever field backs
it and confirm something resets it — an expiry/retention job, a success write, a
status transition. A sticky error field (written on failure, never cleared) pins a
row to "Errored" forever and the column becomes noise within a week. Pipelines'
`last_error` is safe because the backend expires it on a retention interval;
verify the equivalent before promoting any field to a chip. If nothing clears it,
label it for what it is ("Last error", a timestamp) instead of a live state.

### Grey vs amber — the two "not green" states

They are not interchangeable, and the wrong pick cries wolf:

- **Grey = no data / unknown / not in use.** Never ingested, never run, not yet
  configured. Usually benign — a stream created five minutes ago, a schema-only
  stream, a job that has not had its first run. Pair with a muted "Never".
- **Amber = it WAS working and went quiet, or is degrading.** Silence from a thing
  that used to report is the case worth a second look.

Amber on the "never" case fires on every freshly created object, which trains
people to ignore the colour. When in doubt, grey.

## Step 3 — Keep everything else calm

Colour only earns attention if most of the screen stays quiet:

- **Earn every tile — a strip is not a page decoration.** Before adding one, put
  each tile to three questions: does the number **vary**, does someone **act** on
  it, and is it **not already on screen**? Tiles that fail are noise dressed as
  signal:
  - _structurally constant_ — "System accounts" is 1 in almost every org, so the
    tile is a label with a number stuck to it;
  - _almost always zero_ — "New this week" on a list that gains an item a quarter;
  - _derivable from its neighbours_ — "In use" beside "Unused" and "Total";
  - _already in the footer_ — the pager prints "x – y of N" under every table,
    so a Total tile alone is not a reason to have a strip.
    A page whose only candidates fail these gets **no strip** — keep the per-row
    signals (relative recency, a state rail, a count column) and stop. Dashboards,
    Service Accounts and Roles all ended up here: pages where a strip added pixels
    and no information. Roles is the clearest case — "Unused" is just the member
    column sorted ascending, so two tiles restated what the rows already said. **A
    count column plus sorting usually beats a strip**; reach for a strip only when
    the page has a real distribution to summarise (Users across roles, monitors
    across health) _and_ the tiles double as the facet.
- **Highlight exceptions, not the norm.** Tint the failed/paused rows; leave the
  healthy majority clean. A table where every row is coloured signals nothing.
  And if a page has no true failure state (a catalog list), the calm answer is a
  rail with no row wash at all — not a wash invented for symmetry with Alerts.
- **Muted zero.** A `0` renders muted, not in the loud tone colour, and "no
  data" is a `—`, not a wall of zeros. (`OStatCard` does this.)
- **State is border/colour, not fills.** Selected/hover on interactive tiles use
  an accent **border**, not a grey/blue background wash. No hover shadows.
- **Semantic colour ≠ brand accent.** Green/amber/red carry _meaning_ (health);
  the brand teal carries _structure/selection_. Don't mix the two roles.
- **One primary action.** In forms, exactly one brand-coloured primary (Save);
  destructive in red; everything else neutral.
- **No layout shift.** Reserve space for anything that streams in (a stat card
  renders the same box loaded or not; a proportion-bar _track_ is always drawn).

---

## Per-archetype quick recipe

- **Monitoring** → `OStatStrip` filter chips (state counts) in the `#toolbar`;
  `OTag` status chips; row rail + exception tint; relative recency. _(Alerts.)_
- **Catalog** → `OStatStrip` counting totals (Total · Folders · Favourites ·
  Updated-this-week, `max` optional); category `OTag` (folder/type/language);
  `OUserCell` owner; relative "updated"; a colour-filled favourite.
- **Access** → `OTag userRole` coloured by privilege; active/invited chips; a
  small count strip (Total · Admins · Invited · Service accounts).
- **Forms** → section `icon-chip` headers; step rail; inline validation colour;
  one primary action; a **review card** built from `OStatCard` summarising the
  config; preview output in the same semantic colours it'll show in monitoring.

**One line for the room:** we're not repainting the app — we're teaching each
screen to say, in colour, exactly what it's for.
