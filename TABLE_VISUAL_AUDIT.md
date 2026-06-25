# Table Visual System — Design Notes

**Scope:** Data tables across the OpenObserve web app (~80 tables)
**Status:** Implemented — shared cell primitives + a typed-badge registry, adopted across the app.

---

## 1. The problem

Most table cells rendered their raw value as plain text: timestamps in several
different formats, status strings with no colour, numbers left-aligned and
ad-hoc formatted, owners as bare emails, and empty cells left blank. The data
was all there — it just wasn't *encoded* in a way that's scannable. The same
concept (e.g. "last triggered") looked different on every page.

The goal of this work: make the data easy to read at a glance and consistent
everywhere, by encoding meaning visually — colour for state, bars for
magnitude, relative-then-absolute time, aligned numerics — and doing it through
**shared components** rather than per-table markup.

The foundation already existed: `OTable` supports custom `cell` renderers,
per-cell `meta.format`, `getCellStyle()`, `getRowStatusColor()`, and alignment;
and we ship visual primitives (`OBadge` with solid/outline/soft variants, and
`OProgressBar`). The work was to build a small set of reusable cell components on
top of those and adopt them.

> **Core principle:** fixes live in *shared cell components and a badge
> registry*, not hand-rolled per table. Build the primitive once; adopting it is
> a one-line column change everywhere.

---

## 2. The building blocks

### 2.1 — One time format, everywhere

Timestamps were previously formatted at least five different ways across the app
(ISO-ish strings, `YYYY-MM-DD HH:mm:ss`, `toLocaleString`, raw ISO, raw
passthrough). A single `OTimeCell` standardizes them:

- Default display is **relative** ("2m ago", "3h ago") for recent timestamps.
- Past a cutoff (default 30 days) it falls back to an **absolute date**
  ("Jun 24, 2024") — relative time is meaningless for old rows.
- Event-log columns (alert/pipeline/search history) use **absolute** mode to
  always show the full datetime.
- Timezone-aware (honours the user's selected timezone), `tabular-nums` aligned,
  full datetime on hover.

### 2.2 — In-cell data bars for numeric columns

Numeric columns (counts, sizes, durations) benefit from a magnitude cue.
`ODataBarCell` renders the formatted value with a thin proportional bar
(width = `value / columnMax`, computed per visible page). The bar uses the
brand-teal progress fill, escalating to amber/red for threshold columns
(e.g. error counts, slow latencies). Use it where comparing rows at a glance is
valuable; plain `ONumberCell` is fine elsewhere.

### 2.3 — Status / state → typed badges

A single **badge registry** (`badgeGroups.ts`) maps a raw value to a colour,
optional icon, and optional dot, grouped by domain. `OTag` consumes it with two
props:

```vue
<OTag type="alertType"   value="realtime" />   <!-- colour + icon -->
<OTag type="alertStatus" value="active"   />   <!-- colour + dot  -->
<OTag type="logLevel"    value="error"    />   <!-- colour only   -->
```

Each group declares a render mode:

| Mode | Used for | Example groups |
|---|---|---|
| **icon** | distinct categories | `alertType`, `pipelineType`, `streamType`, `destinationType`, `enrichmentType` |
| **dot** | live states | `alertStatus`, `incidentStatus`, `severity`, `queryStatus`, `invoiceStatus`, `evalStatus`, `serviceStatus`, `booleanState` |
| **plain** | classifications | `logLevel`, `userRole`, `authType`, `httpMethod`, `fieldType` |

Adding a new type or value is a one-file edit. Unknown groups fall back to a
generic semantic mapping (`statusVariant`), so `OTag` always renders sensibly.

### 2.4 — Number formatting discipline

`ONumberCell` renders numerics right-aligned with `tabular-nums` and a shared set
of formatters (grouped counts, bytes, durations, percent), so digits line up and
units are consistent.

### 2.5 — Fill the blanks

Empty/null cells render a muted em-dash `—` (or a meaningful label like "Never")
instead of a blank, so tables never look broken. Per project rule, de-emphasized
text uses the primary text colour — never the disabled grey.

---

## 3. Secondary polish

- **Identifiers / SQL / tokens** → `OCodeCell` (monospace + copy-on-hover).
- **Owner / user columns** → `OUserCell` (currently plain email/name; a single
  place to enhance later).
- **Row status accent:** `getRowStatusColor()` supports a 4px left bar; can be
  extended per feature (e.g. firing alerts, overdue invoices).
- **Sparklines (future):** a `SparklineCell` for trend columns would need a small
  SVG renderer — not yet built.

---

## 4. The shared primitives

| Primitive | Purpose |
|---|---|
| `OTag` + `badgeGroups.ts` | typed status/category badges from a central registry |
| `OTimeCell` | relative→absolute, timezone-aware timestamps |
| `ONumberCell` | tabular, right-aligned, unit-aware numbers |
| `ODataBarCell` | value + proportional magnitude bar |
| `OCodeCell` | monospace identifiers/SQL with copy |
| `OUserCell` | owner/user/created-by columns |
| `statusVariant` | generic value→variant fallback engine |

`OTag` and `badgeGroups.ts` live under `web/src/lib/core/Badge/`; the cell
components and `statusVariant` under `web/src/lib/core/Table/cells/`.

---

## 5. Adoption pattern

Tables adopt a primitive by adding a per-column slot — no change to the column
definition (accessor/sorting stay intact):

```vue
<template #cell-status="{ row }">
  <OTag type="queryStatus" :value="row.status" />
</template>
<template #cell-created="{ row }">
  <OTimeCell :value="row.created" unit="iso" :timezone="store.state.timezone" />
</template>
```

For magnitude bars, the host table computes a per-page column max and passes it
to `ODataBarCell`.

---

## 6. Summary

The visual upgrade is delivered through ~7 shared cell primitives and a typed
badge registry, adopted across the app's tables via per-column slots. Meaning is
encoded consistently — colour for state, bars for magnitude, relative/absolute
time, aligned numerics — with no per-table bespoke rendering, so future changes
are made once and apply everywhere.
