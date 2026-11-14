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
  (`{ key, label, value, icon, tone, max?, delta?, selectable?, all?, dataTest }`);
  `tone` (`neutral | ok | warn | err | crit | info` — status only, C2) is the
  single colour knob, applied only while the value is above 0. Pass `:loading` so
  values hold a skeleton until the first load lands instead of reading "0"
  (copy-and-values.md § Loading is not zero); a failed load passes `value: null`
  ("—"), never `0` (C4). The 3 px proportion track is always drawn; `max` fills it
  (share of total). The tone icon sits in a **rounded-square chip**
  (`rounded-default`) — every icon chip in the app is a rounded square, never a
  circle (`rounded-full`). Set `selectable` + `:selected-key` + `@select` to make
  tiles **double as filters** (F7); add `multiple` with `:selected-keys` +
  `@update:selected-keys` when picks OR together. Compose
  `<OStatCard>` directly (with the `#chart` slot) for sparklines on overviews.
  Place it via `OTable`'s **`#subheader`** slot (wrapped in
  `px-page-edge py-1.5 border-b border-table-row-divider`) to sit below the
  search/tabs. See **Summary-strip conventions** below for ordering + selection.
- **Status / category chips** — `OTag` with a `type=` group from
  `badgeGroups.ts` (`alertStatus`, `alertType`, `severity`, `streamType`,
  `userRole`, `serviceStatus`, …). One registry → the same value is the same
  colour everywhere. Need a new family? Add a group there, don't hand-roll a pill.
  Check the group covers **every** value the API can return (a missing key falls
  back to a generic chip) — and don't set `size` on the group: a group-level size
  silently overrides the call sites, so its chips end up a different size from the
  Status chip beside them. Pass `size` at the call site, matching its siblings.
  Chip tones are `neutral | outline | accent | ok | warn | err | crit | info`;
  categories are `neutral` or `outline`, never a decorative hue (C1), and a status
  tone always carries a dot or an icon (C2). Priorities use `OPriority` (weight, not
  hue) and log levels `OSeverity`.
- **Row state signal** — an extreme-left colour **rail** via `OTable`'s
  `rowRailTone` (token tone per state) or per-row `getRowStyle` (inset box-shadow,
  rem width, token colour) + a **light exception highlight** via `rowState` (C3).
  The rail and the wash are two different strengths of the same signal, and the
  rail is the default:

  |         | Rail (`rowRailTone` / `getRowStyle`) | Wash (`rowState`)        |
  | ------- | ------------------------------------ | ------------------------ |
  | Cost    | a few px at the row edge             | ~the whole row           |
  | Use for | **every** state, always              | only the two cases below |

  `rowState` returns `"exception"` (error rail + error wash), `"warn"` (warning
  rail, no wash), `"paused"` (recedes), `"recent"` (a soft tint for what just
  arrived) or `null`. A page that draws its own rail keeps it, and the state adds
  only its fill; selection paints over the fill. No `!important` row class.

  A full-row wash is the loudest thing on a list, so it earns its place only when
  **all three** hold: the state means **act now** (not merely "not green"), it is
  **rare in a healthy system**, and **the row is the unit of action**. In practice
  that leaves exactly two washes:
  - `rowState` `"exception"` (the error wash) — failing/errored/offline. _Alerts_
    failed, _Pipelines_ errored, _Nodes_ offline, _Synthetics_ failed.
  - `rowState` `"paused"` (the panel fill) — paused/disabled. This one is
    **de-emphasis, not alarm**: the row is deliberately inert, so it recedes
    rather than shouts.

  Lists that still pass `!bg-status-error-bg` / `!bg-surface-panel` through
  `row-class` predate `rowState`; move them when you next touch the page.

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

Once a strip is `selectable`, four rules keep every strip behaving identically
(reference strips: Alerts, Incidents, Eval Jobs):

- **Order attention-first, left → right.** The most critical / attention-worthy
  tile is leftmost, descending to the calm/inert ones — e.g. `failed → recent →
active → paused`, `P1 → P2 → P3 → P4`, `degraded → paused → active → draft →
archived`. This mirrors the row rail's "critical colour on the left edge": what
  needs attention lives on the left, everywhere.
- **The "All" / "Total" tile is LAST, stays CLICKABLE, and is never highlighted.**
  Give it the key `all` (or `all: true`): the strip then emits `null` for it and
  never draws it selected. Wire `:selected-key` to the _raw filter value_ (`null`
  when unfiltered). `defaultKey` is gone (F7). **Never put `selectable: false` on
  it** — that turns it into a read-out, so the strip has no way back to
  unfiltered; `selectable: false` is only for a tile with no matching filter.
- **Selection toggles off.** The strip emits `null` when the selected tile is
  clicked again, so the handler is just `filter = key` (`@select="filter = $event"`).
- **Selected state is an accent border, not a fill** — the `OStatCard` default;
  there is no tray look (C6, Step 3).
- **Stats and filters are one control.** Never a stat row plus a separate filter
  select for the same facet, and never a tab strip (tabs switch views, they don't
  filter).
- **Multi-select ORs.** With `multiple`, a click toggles that tile and rows matching
  ANY picked tile show; "All" and Esc empty the selection. State is a `string[]`
  (empty means unfiltered), filtered with `matchesAnyKey` from
  [utils/filterKeys.ts](../../../web/src/utils/filterKeys.ts). A filter kept in the
  URL or view state is read with `readFilterKeys` (it still accepts an old single
  value) and written with `filterKeysToQuery`. Stay single-select when the backend
  takes one value and can't OR, or when the tiles split the whole set (picking both
  equals All).
- **Name the reset tile as a filter, not a stat.** "All", never "Total" ("Total" is a
  read-out). When another "All" sits beside it (a type toggle), name the tile by its
  facet, "All states" / "All statuses" (`common.allStates`, `common.allStatuses`).
- **The tooltip says what a click does** ("Show only / Also show / Stop showing …");
  the strip sets it. A strip whose only filter would be "All" renders display-only.
- **A strip in `#subheader` is a CLAIM ABOUT THE ROWS — scope decides position.**
  Inside the table frame, a strip promises "these numbers describe the list below",
  so it must be computed from the same filtered set _and_ be facet-clickable. Before
  writing one, check the fetch: **if the list is server-paginated you only hold one
  page**, so page-local sums are not totals — never sum the visible page and label
  it "Total". When the numbers genuinely can't meet the promise (server pagination,
  or totals that come from a different, wider endpoint such as an org-summary API),
  do **not** put them in `#subheader` — lift them to the page level as a read-only
  strip in `OPageLayout`'s **`#subnav`**, where they read as page context instead of
  a row summary, and label them for their real scope ("Total Streams", not
  "Streams"). What stays honest under pagination is anything derived from the single
  row in front of you: relative recency, a state rail, a per-row ratio. Reference:
  Alerts (client-side list → filterable `#subheader` strip) vs Streams
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
  - _already in the footer_ — the pager prints "1–20 of 143" under every table,
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

- **Monitoring** → `OStatStrip` (state counts, filter tiles) in `#subheader`;
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
