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

Every screen answers one question. Colour *that*; keep the rest quiet. Which
signal earns the colour changes by page type:

| Archetype | Examples | Primary signal → colour |
| --- | --- | --- |
| **Monitoring** | Alerts, Incidents, RUM errors, Synthetics | **state / severity / health** — active/paused/failed, firing, recency |
| **Catalog** | Dashboards, Streams, Functions, Pipelines | **organise & orient** — category/type, owner, freshness, size/usage, favourites |
| **Access** | Users, IAM, Roles, Service accounts | **role / permission** — privilege runs hot→cool, plus active/invited status |
| **Forms & settings** | creation flows, editors, org/stream settings | **progress & validity** — where am I, is it right, what still needs me |

Don't bolt "status" onto a screen that has none. A Dashboards list has no
firing/paused state — its signal is category + recency + ownership.

---

## Step 2 — Colour the signal with the shared toolkit

All token-backed and dark-mode-safe. Reuse these before inventing anything.

- **Summary strip** — `OStatStrip` + `OStatCard`
  ([web/src/lib/data/StatStrip](../../../web/src/lib/data/StatStrip)). A row of
  KPI tiles at the top of a list/dashboard. Data-driven via `:items`
  (`{ key, label, value, icon, tone, max?, trend?, selectable?, dataTest }`);
  `tone` (`success | warning | error | primary | neutral`) is the single colour
  knob. `max` draws a proportion bar (share of total). Set `selectable` +
  `:selected-key` + `@select` to make tiles **double as filters**. Compose
  `<OStatCard>` directly (with the `#chart` slot) for sparklines on overviews.
  Place it via `OTable`'s **`#subheader`** slot to sit below the search/tabs.
- **Status / category chips** — `OTag` with a `type=` group from
  `badgeGroups.ts` (`alertStatus`, `alertType`, `severity`, `streamType`,
  `userRole`, `serviceStatus`, …). One registry → the same value is the same
  colour everywhere. Need a new family? Add a group there, don't hand-roll a pill.
- **Row state signal** — an extreme-left colour **rail** via `OTable`'s
  per-row `getRowStyle` (inset box-shadow, rem width, token colour) + a **light
  exception highlight** via `row-class` (tint only the rows that need action —
  never the normal ones).
- **Recency** — `OTimeCell` `mode="relative"` (`"3 min ago"`) with a hot/warm/
  cold dot, instead of a raw timestamp column.
- **People** — `OUserCell` for owner/author columns.
- **Section identity (forms)** — a soft `icon-chip` header per section
  (`bg-icon-chip-*-bg text-icon-chip-*-text`); a coloured step rail for
  multi-step flows (done=green, current=accent, upcoming=grey); inline
  validation colour (green check / amber warning / red error).

Reference implementation of most of the above: the Alerts list,
[web/src/components/alerts/AlertList.vue](../../../web/src/components/alerts/AlertList.vue).

---

## Step 3 — Keep everything else calm

Colour only earns attention if most of the screen stays quiet:

- **Highlight exceptions, not the norm.** Tint the failed/paused rows; leave the
  healthy majority clean. A table where every row is coloured signals nothing.
- **Muted zero.** A `0` renders muted, not in the loud tone colour, and "no
  data" is a `—`, not a wall of zeros. (`OStatCard` does this.)
- **State is border/colour, not fills.** Selected/hover on interactive tiles use
  an accent **border**, not a grey/blue background wash. No hover shadows.
- **Semantic colour ≠ brand accent.** Green/amber/red carry *meaning* (health);
  the brand teal carries *structure/selection*. Don't mix the two roles.
- **One primary action.** In forms, exactly one brand-coloured primary (Save);
  destructive in red; everything else neutral.
- **No layout shift.** Reserve space for anything that streams in (a stat card
  renders the same box loaded or not; a proportion-bar *track* is always drawn).

---

## Per-archetype quick recipe

- **Monitoring** → `OStatStrip` (state counts, filter tiles) in `#subheader`;
  `OTag` status chips; row rail + exception tint; relative recency. *(Alerts.)*
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
