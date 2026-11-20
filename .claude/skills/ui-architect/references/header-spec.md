# Page header spec v2.1 (binding for every page)

The stacked page header that guidelines [H1–H8](guidelines.md#5-page-header) describe. It
replaces the breadcrumb title band and the icon-tile header. `OPageHeader` / `OPageLayout`
implement it; a page never builds its own header.

The user's review of the prototype's header found two failures:

- "The header shifts a lot when we navigate. Clicking a tab changes the title and shifts the tabs. That is basics."
- "Single-line breadcrumbs are the worst thing."

Both break rule P3, "Nothing jumps". This spec fixes them.

## Goals

1. **The title sits in exactly the same place on every page.** That means the same x, the same y, and the same header height everywhere.
2. **Nothing in the header moves while you work inside an area.** This covers switching tabs, paging, filtering and opening the area's sub-pages.
3. **No single-line breadcrumb trails anywhere.** A trail like "Reliability / Alerts" or "Alerts / Payments 5xx rate" is never shown on one line with the title.

## Anatomy: stacked header, 56 px, on every page

- **Left column**, starting at the content edge (x = the 16 px gutter):
  - **Context line**: 16 px tall, 12 px text in `--text-secondary`. The slot always exists, so the title never moves vertically. It names the container, and never the org (the top bar's org switcher already shows it):
    - Pages inside a module with its own rail (Settings, IAM, AI observability) show the page's rail group: "General", "Access & security", "Monitor". The rail's heading already names the module, so the line never repeats it. Security-solution pages show "Security".
    - Grouped top-level pages show the rail group: "Reliability", "Data", "Infra", "Experience", "Dashboards".
    - Detail, editor and import pages show a back link to the parent: "‹ Alerts", "‹ Pipelines". It is real link styling, and Back uses the smart-back rules (N3).
    - Every other page leaves the slot empty and `aria-hidden`: ungrouped top-level pages (Home, Logs, Metrics, Traces, AutoObserve, Profiles), a module page outside every rail group, and a page whose group is spelled like its title. The title stays at the same y.
  - **Title line**: 24 px tall, 18 px at weight 600 (`text-lg leading-6 font-title`) in `--text-strong`. An optional status chip (H5) follows the title. An inline-edited title (`#title` slot) uses `OInlineEdit size="lg"` so it matches.
  - The title is the strongest text on the page (T2): section titles below it are 14 px semibold with no tinted band.
  - The title is the page or object name. It does **not** change when the user switches tabs inside the page.
  - Long titles truncate with an ellipsis and show a tooltip; they never wrap.
- **Right side**: page actions, vertically centred, right-aligned, in this order: secondary actions, then the primary, then ⋯ More (H3).
  - Actions may change label per tab.
  - Nothing sits to the right of ⋯, so nothing else moves.

## Module rails: one header row with the page

- A module rail's heading row (the module name, and its collapse control) is 56 px, the same as the header band.
- Its bottom hairline sits at the same y as the band's, so the rail heading and the page header read as one header row.
- The rail heading names the module; the page's context line names the rail group (above).

## Tabs: their own row, never inline with the title

- The tab row is 40 px, directly under the header.
  - The first tab starts at the content edge (x = 16).
  - Tabs never sit after the title on the same line.
- Active and inactive tabs use **one font weight** (500) at 13 px, with 14 px glyphs.
  - Inactive tabs are `--text-secondary`; the active tab differs only in colour (`--text-strong`) and a 2 px accent underline on the row's divider.
  - Hover changes colour only.
- Counts in tabs:
  - use tabular figures;
  - sit centred in a compact neutral pill that reserves two digits, so the common counts never move the next tab; a third digit grows it, and "999+" is the cap;
  - take a status tint only when the caller passes a tone (Firing: a soft error tint).
- The reorder grip of a reorderable tab shows only on hover or keyboard focus.
- More than six tabs: the rest go into "More ▾" at the end of the row, never wrapped.
- Areas without peers have no tab row.

## Navigation stability

- **Rail flyouts and the expandable rail**: hovering opens them as overlays on top of the content. They never push the content. Only an explicit pin may push content.
- **The section list (navigation option B)**: it pushes content only when the user toggles it, and the toggle state is remembered.
- **Moving between pages of the same area**: the header height, the title x and y, and the x of every tab stay identical.

## Header alternatives (shown as options, not recommended)

- **"Title only"**: a 48 px band with only the title, and a ‹ back icon button before the title on detail pages. Simpler, but the title moves 36 px right on detail pages.
- **"Title in the top bar"**: the context line and title are stacked inside the global top bar, which saves a band. Page actions move to the toolbar row.

## Don'ts (shown as do/don't, never shipped)

- The title and tabs on one line: every title change moves every tab.
- A single-line breadcrumb trail ending in the title.
- An active tab in a heavier weight, which widens it and pushes its neighbours.
- A title that changes to the active tab's name.

## Test (scripted, required)

On each area, record the title's DOMRect, every tab's DOMRect and the header height. Then:

- click every tab;
- navigate list → detail → back;
- open a flyout;
- navigate to two other areas.

All of these must hold:

- **Title box**: x and y identical on every page; width may change.
- **Tabs**: x identical within an area.
- **Header height**: identical on every page.
- **Flyout**: opening it changes no content rect.
