# Copy and values — what the reader actually sees

`house-rules.md` §6 covers **how** text reaches the screen (`t()`, `raw()`,
`I18nText`). This covers **what it says**: the words, numbers, dates and states a
reader sees once real data flows through them. Every rule below shipped as a bug
first; the example is the one that was caught.

> **The one rule: read the screen with real data, out loud.** Lint proves a string
> is translated. It cannot prove that the sentence it produces is English, that
> the number means what its label claims, or that a blank is not a zero.

---

## Sentence case reaches past your template

The casing rule (SKILL.md §3) applies to **the values in `en-US.json` and to
shared components**, not only to the markup you wrote.

- A screen that embeds a shared component inherits its copy. The Kubernetes setup
  card showed "Quick Install (Recommended)", "Cluster Name", "Auto-Instrument
  Your Applications" because the shared setup-card keys were title case. Read the
  rendered screen, then fix the shared key — every card that uses it benefits.
- A library component can force caps on everyone: `OCodeBlock` printed
  "TERMINAL" through an `uppercase` class. A token like `bash` is already in its
  canonical case; never transform it.
- "No Data" → "No data". A product name stays as the product writes it
  ("HOT Commerce"), and must be spelled the same in every place it appears.

## Interpolated text must still read as a sentence

A message slot takes a **noun phrase or a value**, never another full sentence.

```text
key:   "{capability} stopped {duration} ago (last seen {date})."
WRONG: capability = "Pod health and node readiness are unavailable - cluster state metrics aren't arriving"
       → "Pod health and node readiness are unavailable - … stopped 37 hours ago"
RIGHT: capability = "Pod health & node readiness (cluster receiver)"   ← the group's label
       → "Pod health & node readiness (cluster receiver) stopped 37 hours ago"
```

Name the parameter for the grammar it needs (`{label}`, `{count}`), and check the
rendered sentence for every value it can take — including the longest one.

## Every count is a plural

Any message with `{count}` is a pipe plural **and** is called with the count as
the third argument: `t(key, { count, list }, count)`.
"1 data sources not found" shipped because the key was a single form and the
call omitted the count.

The plural also picks the quantifier and the verb. "All {waits} lead back to pid
{pid}" read "All 1 session waiting on a lock right now lead back to pid 12127";
the one-form drops "All" and takes the singular verb:
`"{waits} leads back to pid {pid} | All {waits} lead back to pid {pid}"`, called
with the count.

## Name a control by the label it carries

Help text, empty states and troubleshooting refer to a control **by its visible
label**. Troubleshooting said "switch to an In-Cluster variant" beside a toggle
labelled "Internal endpoint" — the reader looks for a word that is not on screen.

## Say it once

Adjacent elements must not repeat each other.

- A step with an "Optional" chip does not open its description with "Optional.".
- A page header titled "Kubernetes", a setup card titled "Kubernetes" and a
  headline between them is two headings too many — demote or drop one.
- One fact, one place: "86% · 714 of 832 connections" in Instance health and
  "86% connections" in Needs attention, repeated on every row of one instance, is
  the same reading three ways.
- Several warnings about one outage are **one** banner with a list, not a stack
  of near-identical banners above the content they qualify.

## A sentence cut by an ellipsis is never read

Explanatory copy — a caveat about a set of panels, how to read a chart, why a
number is approximate — is reference, not news. Shown inline it either takes a
paragraph above the content it qualifies or gets truncated to "Average sessions
actively working per interval, stacked by the chosen…", which nobody expands.

- Open it on demand from a labelled info button beside the control it qualifies
  ("About these numbers", "About this chart"): the `OPopover` info recipe in
  `overlay-navigation.md`. Icon-only on phones, the label kept for screen readers.
- Keep the button **next to** that control. Pushed to the far edge with `ms-auto`
  it left a wide empty gap on large screens and read as unrelated.
- A sentence that must stay visible gets shortened until it fits, not truncated.

## A banner is one line

A warning says **what** and **since when**, then offers the action. "Node CPU &
memory (kubeletstats receiver) stopped 2 days ago (last seen 2026-10-04 05:29).
Values below are from before then." took five lines on a phone above every panel.

```text
one source:   "{capability} stopped reporting {duration} ago"            + Jump to latest data
many sources: "{first} and {count} more sources stopped reporting"       + Jump to latest data
```

The exact time, the collector to restart and the setup hint move into the
disclosure that already lists the affected sources (see "One line per item").

## One line per item, opened per item

A list of sources, streams or findings shows **one line per item** and lets each
item open on its own:

- Line 1: the name, with its status on the right ("4 panels hidden · stopped 2
  days ago"). Line 2: the detail on one truncated line (`OText truncate`).
- The row is an `OCollapsible` with a `#trigger` slot (recipe in `core-display.md`);
  opening it shows the full detail and hint and hides the truncated line.
- **Not** one shared "Show details" for the whole list — a reader wants one
  source's streams, not all of them — and not a "+5 more" button per row, which
  still wrapped to three lines.
- Entries for the same entity are **one** row: a group that was both partly
  missing and stopped appeared twice in the "panels hidden" list, in two font
  sizes. Merge them and join their statuses with " · ".

## Changing a shared key changes every screen that uses it

Before rewording an existing key, search for every caller. `infra.curated.staleBanner`
was also the Host drawer's banner, so shortening it for one page would have
silently changed another. Add a new key for the new wording instead — and give
every new key a value in all 16 locales (a missing one falls back to English).

## A header names its column, nothing more

Qualifiers in a column header — "Live rows (est.)", "Seq scans (lifetime)" — are
what the ellipsis eats first ("Live rows (e…"). Drop them from the label and put
the sentence that explains them in `meta.headerTooltip`; reuse the page's existing
"About these numbers" sentences rather than inventing new copy.

## Good news is said once

An empty triage table that reads "✓ All clear" must not also print "0 of 0" in its
footer: the count makes a healthy table look broken. Drop the row count when the
empty state is good news; keep it on every table that has rows.

## People read names, not identifiers

Show the label a person chose; keep opaque ids out of prose.

- "you're an admin on 3IV3cRABFAqR5I3bdTtHdn041uU" → "you're an admin on
  dbmonitoring" (`selectedOrganization.label`, falling back to the identifier).
- A raw backend error string ("Error# [trace_id …] logs→search: request timeout
  in queue") is never the whole message. Use the load-error empty state; the raw
  string may ride along as its description.

## Lead with what tells rows apart

When rows share a long prefix, the shared part is noise. Six databases on one
host all opened with `o2dev.cf0ost4wkmaj.us-east-2.rds.amazonaws.com`, and the
names that differ (`o2alpha`, `o2main`) sat in small text beneath. Put the
distinguishing value on the primary line — and if a column is sortable, it must
sort by the value it **displays**, not the field it used to show.

## Times and numbers

| Value                              | Rule                                                                               | Shipped as                |
| ---------------------------------- | ---------------------------------------------------------------------------------- | ------------------------- |
| A time in prose ("last seen …")    | Minute precision: `yyyy-MM-dd HH:mm`; pair it with a relative age ("37 hours ago") | `2026-10-04 05:29:59.809` |
| A count (nodes, pods, rows)        | `decimals: 0` on the panel / formatter                                             | `Nodes 43.00`             |
| An unknown or absent value         | Muted `—` (`text-text-muted`), never `0`                                           | —                         |
| A unit the app already parses back | Keep the app's spelling (`us`, not `µs`, in DBM)                                   | —                         |

## Loading is not zero

Nothing renders a real-looking `0` before the first answer arrives. "0 / 0 /
0us" in the stat tiles during a load reads as "no databases, no calls".

- `OStatStrip`: pass `:loading` — values hold a skeleton until the first load
  completes; later refreshes keep the last values instead of flickering.
- Tables: `OTable :loading` already draws skeleton rows.
- A tile whose value is genuinely unknown shows a muted `—`.

## Failure has one look

`OTable :error` **without** an `#error` slot falls back to a solid red bar with
the raw server string. Every table that can fail supplies the slot:

```vue
<template #error="{ message }">
  <OEmptyState
    preset="load-error"
    :description="raw(message)"
    @action="onRefresh()"
  />
</template>
```

Wire Retry to the page's own refresh handler, the same one its refresh button
calls — not to the table's pagination event.

## Icons carry meaning

A warning glyph says "this is a problem". A list of questions ("Can I see a
working example?", "Which endpoint should I use?") with an amber triangle on every
row turns help into alarm. Use a neutral `help-outline` in `text-text-label` for
questions; keep `warning` for an actual failure state.

## Shared state: a page writes only its own facts

Kept-alive tabs that share a snapshot (tab badges, a scope, a selection) must each
publish **only what they own**. Top queries published its distinct-instance count
as the Overview tab's database count, so "Overview 6" read "Overview 1" from every
tab — and stayed wrong, because the hidden Overview page only republishes when its
own value changes. Pin ownership with a spec that reads every page's publish list.

## Check every state, not the happy one

Before calling a screen done, see each of these **with real data**, in light and
dark, at 375 / 768 / 1280:

| State                | What to look for                                                                                               |
| -------------------- | -------------------------------------------------------------------------------------------------------------- |
| Loading              | Skeletons, not zeros; no layout jump when data lands                                                           |
| Never set up         | The setup path, without controls that act on nothing (a time picker over no data)                              |
| Stopped / stale      | Says when data stopped and offers the window where it exists; does not tell the user to install what they have |
| Partly there         | Names what is missing, with correct plurals                                                                    |
| Failed               | The load-error state with Retry; no raw red bar                                                                |
| Populated            | Real names, real counts, nothing clipped                                                                       |
| Window past the data | A range ending after the last data point (a stale org) — what does every tile say?                             |

An org that is empty, one that stopped reporting and one with live data each
expose different bugs; use all three when they exist.
