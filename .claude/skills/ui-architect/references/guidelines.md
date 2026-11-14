# OpenObserve UI guidelines (v2)

**Binding for every change under `web/`.** Each rule has a stable id, a strength, what it
fixes today and why. A change cites the ids it applies, in its PR description and in review.
Where an older house rule in this skill disagrees with a rule here, this file wins.

- **Strength.** `must` is a requirement: a change that breaks it is not done. `should` is the
  default: depart from it only with a stated reason.
- **"Today"** lines record what the November 2026 survey measured, with its source. They are
  evidence for the rule, not part of it. The full survey register and the bug list are in
  [ui-audit-2026-11.md](ui-audit-2026-11.md).
- **Numbers are design pixels.** Code never writes them: every height, radius and size below
  maps to a token utility (see [Tokens behind the numbers](#tokens-behind-the-numbers)).

## Tokens behind the numbers

| Guideline value | Utility | Token |
| --- | --- | --- |
| Control height 24 · 28 · 32 · 36 (S1) | `h-control-xs` · `h-control-sm` · `h-control-md` · `h-control-lg` (also `min-h-*`, `size-*`) | `--spacing-control-{xs,sm,md,lg}` |
| Radius 4: chips, badges, kbd, checkbox | `rounded-chip` | `--radius-chip` |
| Radius 6: buttons, inputs, selects, segmented, every control | `rounded-default` | `--radius-default` |
| Radius 8: menus, popovers, tooltips | `rounded-menu` | `--radius-menu` |
| Radius 10: dialogs, drawers, cards, panels, the content frame (L1) | `rounded-surface` | `--radius-surface` |
| Pills, avatars, dots | `rounded-full` | `--radius-full` |
| Text 11 · 12 · 13 · 14 (T1) | `text-2xs` · `text-xs` · `text-compact` · `text-sm` | `--text-*` in `base.css` |
| Text 16 (page title) · 20 · 24 (KPI values) | `text-base` · `text-xl` · `text-2xl` | `--text-*` in `base.css` |
| Text colour strong · default · secondary · tertiary · disabled (T3) | `text-text-heading` · `text-text-body` · `text-text-secondary` · `text-text-muted` · `text-text-disabled` | `--color-text-*` in `semantic.css` |
| Spacing 4 · 8 · 12 · 16 · 24 · 32 (L4) | `*-1` · `*-2` · `*-3` · `*-4` · `*-6` · `*-8` | Tailwind's rem scale |

The component sets its own height, radius and text size from its `size` prop. A call site
never overrides them (`local/o2-control-height`). Text 15 (dialog, drawer and section titles)
is `text-title`; `ODialog`, `ODrawer` and `OFormSection` set it, so a call site does not.

## Quick answers

- Search on the left or the right? — Left, first in the toolbar, 280 px on lists. (F1 · F2)
- The toolbar is full. Wrap or fold? — Fold the lowest-priority controls into More. Never wrap. (F10 · B8)
- A dashboard header has eight actions. — Two secondary, one primary, the rest in ⋯ More. (H3 · B8)
- Dropdown, popover, dialog, drawer or page? — Choose by the job and its size. See the decision table. (O1 · O2)
- My dialog grows when a radio changes. — Reserve the tallest state. Overlays never move while open. (O4 · O5)
- Which button is primary? — The one main action of a region. One per header, footer or form. (B1 · B2)
- Icon next to the button text? — Only when it adds meaning: ▾, ↗, download, upload, copy, run. Never "+". (B4 · B5)
- Show the keyboard shortcut? — In tooltips, menus and the palette. On the button only for Run and Ctrl K. (B6 · KB1)
- Where does Save go? — Where the eye ends: overlay footer, sticky page footer, or the settings bar. (V2 · V3)
- The user leaves with unsaved edits. — Editors ask "Leave with unsaved changes?" — Discard · Keep draft · Save. (V4 · V5)
- What does Back do on a detail page? — Returns to the list exactly as it was: filters, page, scroll, row. (N3 · H4)
- The header moves when I switch tabs. — Never. The title stays put, tabs sit on their own row, one font weight. (H1 · H8)
- Breadcrumbs? — No single-line trails. A small parent link sits above the title. (H4)
- How do filters survive navigation? — They live in the URL. Columns and density live in local storage. (F11 · N6)
- How do file uploads look? — One drop zone that really accepts drops, a file row, inline progress and errors. (U1 · U2)
- An input next to a button? — Same height token. Every control in a row is 32 px by default. (S1 · S2)
- Filters on one line? — Yes. Label inside the select ("Status: Any"), four visible, the rest in More filters. (F3 · F10)
- What changes on a small screen? — Rail becomes a drawer, toolbars fold, tables scroll inside their frame. (R1 · R2)

## 1. Principles

- **P1 The data speaks; the chrome is quiet.** Neutral surfaces, one accent, colour only for meaning: status, severity, selection, series. An on-call engineer at 3 a.m. sees the anomaly before they see our design.
- **P2 One job, one way.** The same job uses the same component, in the same place, at the same size, with the same words, on every page.
- **P3 Nothing jumps.** Layout does not shift when data loads, a row is hovered, a filter is added, or an option inside an overlay changes.
- **P4 Context survives.** Query, filters, time range, selection and scroll survive refresh, Back, drill-down and sharing. The URL is the source of truth.
- **P5 Dense, not cramped.** 32 px controls, 13 px UI text, 36 px rows. No band that holds a single item; no panel that holds a single folder.
- **P6 Fast by keyboard.** Every page and main action is reachable from the command palette. Shortcuts are shown where they save time, nowhere else.
- **P7 Calm signal.** Colour is information, never decoration. Highlight the exception, not the norm. This is the rule the shipped Calm Signal work already follows.

## 2. Page anatomy and spacing

- **L1** (must) The app frame is today's left rail plus a 48 px top bar. The content area meets the right and bottom window edges; only its top-left corner is rounded (10 px). No floating card with gaps on every side.
  - Today: Content edges differ by page: list pages start at x = 331, form-style settings pages at x = 335, and the function editor's back button sits 8 px off the shared edge. _(screens-settings-iam.md §0 · components/settings/index.vue:43 · screens-data.md)_
  - Why: Reclaims the dead margin for data and makes every page start on the same line.
- **L2** (must) Every page stacks the same bands, each optional except the header: header 56 → tabs 40 → toolbar 48 → KPI strip → applied-filter chips → content → footer 44.
  - Today: The header is 60 px (96 px with tabs). On 7+ screens the toolbar lives inside the header (Alert history, Pipeline history, Backfill, Data sources). OPageHeader is used in 40 different prop and slot combinations. _(composition.md §6 · screens-respond.md · screens-data.md)_
  - Why: The same three bands answer "where am I, what can I do, what am I looking at" on every page, so the eye learns them once.
- **L3** (must) One page gutter, 16 px, applied once by the page layout. A child component never re-applies it.
- **L4** (must) Spacing comes from the 4 px scale: 4, 8, 12, 16, 24, 32. Controls in a row: 8. Groups of controls: 16. Stacked panels: 12. Form fields: 16. Form sections: 24.
  - Today: Form field stacks use six gap values (gap-5 ×32, gap-4 ×23, gap-3 ×17, gap-2.5 ×17, gap-2 ×13, none ×10). Toolbars alone use 12 gap values; the six biggest layout contexts use 19–49 gap tokens each. _(composition.md §2)_
- **L5** (must) A band never holds a single item. A lone icon, a single tab or a single folder joins the neighbouring band or goes away.
- **L6** (should) Reading content (forms, settings, docs) uses a 720 px column. Data content (tables, charts, logs) uses the full width.
- **L7** (must) Density is a user setting with two values: Default (32 px controls, 36 px rows) and Compact (28 px controls, 28 px rows). A view never mixes densities.
  - Today: Size is chosen per call site: 78 controls override their own height in rows with `h-*` classes. _(composition.md §1)_

## 3. Type and text colour

| Size | Line | Role | Sample |
| --- | --- | --- | --- |
| 11 | 16 | Key chips, chart axes, micro captions | p95 latency · 10:42 |
| 12 | 16 | Meta, helper text, chips, badges, column headers | Updated 2 min ago |
| 13 | 20 | All UI: controls, menus, tables, labels | payments-api returned 503 for /checkout |
| 14 | 20 | Reading text: descriptions, empty states, dialog body | Alerts notify your team when a condition is met. |
| 15 | 22 | Dialog, drawer and section titles | Notification settings |
| 16 | 24 | Page title (never larger) | Checkout service health |
| 20 · 24 | 28 · 32 | KPI values only | 1,284 |

- **T1** (must) Use only the sizes in the table above, by role.
  - Today: In-page section headings come in about 9 size and weight pairs, from 13/550 to 30/400. Custom headers use 7 title styles; AutoObserve titles are 24–30 px. _(screens-settings-iam.md §4 · screens-ai-infra-security.md §6)_
  - Why: Changes the house rule's 14 px default to 13 px for UI text, matching the density of the data it sits beside; 14 stays for text people read.
- **T2** (must) The page title is 16 px semibold in the strong text colour — never larger, never pure black. The context line and the title identify the page together, not size.
  - Today: OPageHeader titles are already 16 px semibold: keep them. The custom headers are the outliers. _(lib/core/PageHeader/OPageHeader.vue:135)_
- **T3** (must) Four text colours, chosen by role: strong (titles, values), default (body), secondary (labels, column headers, metadata), tertiary (timestamps, hints, placeholders). Plus disabled. Never dim text with opacity.
- **T4** (must) Machine values are mono: timestamps, IDs, queries, durations, field keys, code. Every number uses tabular figures; a unit is separated by a space ("158 ms").
  - Today: Nine timestamp formats in Observe alone; "1162 ms" next to "158.00ms"; "0.30spans/s". _(screens-observe.md §9)_
- **T5** (must) Sentence case everywhere: buttons, tabs, titles, column headers, placeholders, menu items, toasts, empty states. Acronyms keep their case (SQL, API, P95). No uppercase labels.
  - Today: About 100 Title Case strings across the surveys ("Import Dashboard", "New Queue", "Link Copied Successfully!") and uppercase words: BETA, SUCCESS, CALENDAR, SECONDS, TRIGGER, SOURCES, TODAY. _(all five screen surveys)_

## 4. Colour

- **C1** (must) The accent marks only: the primary action, the current selection, keyboard focus, links and the active navigation item. It never decorates headers, icons at rest or tiles.
- **C2** (must) Status colours mean status only: ok, warning, error, critical, info. Chips use the soft triplet (text, fill, edge); marks (bars, dots, rails) use the solid colour. Status always comes with a word or an icon, never colour alone.
- **C3** (must) Highlight exceptions, not the norm. Tint failed or paused rows and give them a rail; leave healthy rows clean.
  - Why: A table where every row is coloured signals nothing. This is the Calm Signal rule already shipped on Alerts, Streams and Pipelines.
- **C4** (must) Unknown or missing is "—" in tertiary text. Zero is a muted "0". Neither ever gets a coloured tile.
  - Today: Unknown is written five ways in the Data area alone ("—", "--", "-", blank, "0 / 0.00 MB"). Two KPI strips show "0" after a failed load where the others show "—". _(screens-data.md · screens-respond.md)_
- **C5** (must) Grey means no data, unknown or never used. Amber means it was working and went quiet, or is degrading. When in doubt, grey.
  - Why: Amber on the "never" case fires on every new object and trains people to ignore it.
- **C6** (must) Selected and hover states on tiles and cards are an accent border, not a fill and not a shadow.
- **C7** (must) Charts use the validated series palette in a fixed order; series that mean status (5xx, errors) use status colours.
- **C8** (new) The chrome (rail and top bar) is tinted with the accent hue; the content surface stays white in light mode. Three themes ship: Indigo (default), Ocean and Ink rail.
  - Why: An all-grey frame with a white page read as "black and white". A tinted frame gives identity without competing with the data.

## 5. Page header

- **H1** (must) Every page has one header band, 56 px, with two stacked lines on the left: a context line (12 px, secondary) and the title (16 px semibold). Page actions sit on the right. The title is at the same x and y on every page, and the band never wraps.
  - Today: The header is 60 px, or 96 px with tabs; Respond alone has five header layouts; the Logs, Metrics and Traces explorers have no header at all. _(screens-respond.md · screens-observe.md §9)_
- **H2** (must) No icon tile and no subtitle paragraph; the rail already shows the area's icon. Explanations open from an About (ⓘ) button beside the title.
  - Today: Icon tile, title and subtitle on 46 screens in AI, Infra and Security, and on 18 in Respond. _(screens-ai-infra-security.md §6 · screens-respond.md)_
  - Why: The tile repeats the rail and the subtitle is read once, then costs 20 px forever. This changes house rule 1, which asks for a header icon that matches the nav icon.
- **H3** (must) Header actions, left to right: up to two secondary actions, one primary, then ⋯ More for everything else. External links (Terraform, community dashboards) go in More with an ↗ mark.
  - Today: Up to five header buttons (Alerts); Model pricing has five plus an info icon, Playground four, Threat intel three plus a segmented control, none with an overflow menu. External links are outline buttons, one of four marked ↗. _(screens-respond.md · screens-ai-infra-security.md §6)_
- **H4** (must) The context line names the page's container: the module on pages inside a module rail ("Settings", "IAM"; "Security" for the Security solution), the rail group on grouped pages ("Reliability"), the org on the others ("acme-prod"), and a "‹ Parent" link on detail, editor and import pages ("‹ Alerts"). That link is the Back affordance. No single-line breadcrumb trails and no separate boxed back button.
  - Today: Back is built 12 ways in code, a 38 px boxed back button sits on 27+ screens, AutoObserve uses a "← Back" text link, and no breadcrumb component exists. _(composition.md key findings · screens-*.md)_
- **H5** (should) A status chip or count may follow the title when it is the page's key fact ("3 firing", "Paused").
- **H6** (must) The create action is "New <object>", label only, sentence case, with the same words in the header and in the empty state.
  - Today: Settings mixes New (13), Create (3) and Add (5); "New workflow" in the header but "Add workflow" in the empty state; "+ New team"; seven Title Case and ten sentence case create buttons inside AI alone. _(screens-settings-iam.md §0 · screens-respond.md · screens-ai-infra-security.md §6)_
- **H7** (must) A page has one name in the rail, the context line, the header and the browser tab.
  - Today: "BYOB" vs "Bring Your Own Bucket", "Query Management" vs "Running Queries", "Nodes" vs "All Nodes", "Ingestion Tokens" vs "Manage Ingestion Tokens". _(screens-settings-iam.md §0)_
- **H8** (must) Nothing in the header moves while you work in an area. The title is the page or object name and never changes when a tab is clicked. Tabs sit on their own 40 px row from the content edge, never after the title. Every tab state uses one font weight, and counts reserve their width. Flyouts and the expanding rail overlay the content instead of pushing it.
  - Today: The prototype's first header put the tabs right after a title that changed per page, so every tab moved when the title did, and a single-line breadcrumb changed length on every page. Both are now banned. _(review of the app shell)_
  - Why: People aim for tabs and actions by position. If they move, every click needs a second look.

## 6. Toolbar, search and filters

- **F1** (must) Toolbar order, left to right: search → filters → (spacer) → view controls (columns, density, wrap) → time range → refresh. The page's primary action lives in the header, not the toolbar.
  - Today: Seven toolbar orders in Respond. On the explorers, Share sits after Run, last, or before Run depending on the page. The time range sits in the header on 11 screens and in the toolbar on 8. _(screens-respond.md · screens-observe.md §9 · screens-ai-infra-security.md §6)_
- **F2** (must) Search is the first control, on the left. List pages use a 280 px field (up to 360 px with an in-field scope toggle such as "This folder | All folders"). Explorers replace it with the query bar, which spans the toolbar, starts with the source chip and ends with Run.
  - Today: Search stretches across the row on 16 screens, is a fixed field on 4, sits alone on its own row on 4, and appears twice on Data sources (and neither box says when nothing matches). _(screens-ai-infra-security.md §6 · screens-data.md)_
  - Why: Reading starts on the left, at the content edge. A fixed width keeps the filters next to the search instead of pushed to the far right.
- **F3** (must) List filters are selects in the toolbar with the label inside ("Status: Any") that show a count when narrowed ("Severity: 2"). Up to four are visible; the rest live behind "More filters". Filters never get a label row above them.
  - Today: Floating-label selects on 10 AI scope bars, a prefix label once ("In Queue: All"), placeholder-only selects on Security and Fleet ("Any severity"), and raw option values on Backfill ("running"). _(screens-ai-infra-security.md §6 · screens-data.md)_
- **F4** (must) Explorers (logs, traces, metrics) filter with facets in a collapsible left panel — field, top values, counts, checkbox — and with the query bar. Facet panels hold nothing else.
- **F5** (must) Every applied filter shows as a chip in one row under the toolbar ("service is payments-api ×"), with Clear all at the end. Chips and the query are two views of one state, so editing either updates both.
  - Today: No list shows its applied filters. Clear all exists in four forms ("×" at the bar end, a "Clear filters" link, "1 selected ×", Reset) and is often offered only from the empty state. _(screens-observe.md §9 · screens-data.md · screens-ai-infra-security.md §6)_
- **F6** (must) A segmented control switches a view or an object type ("Alerts | Anomalies"). Tabs switch peer pages. Narrowing by state ("Firing", "Paused") is a filter: a filter select, a KPI tile or a chip.
  - Today: Segmented controls narrow by state on 26 screens: 12 in Respond, 6 in AI and Security, 5 in Observe, 3 in Data. _(screens-*.md filter styles)_
- **F7** (must) A KPI strip may filter the list. It sits inside the table frame between the toolbar and the table. Tiles count the rows below, in attention-first order; "All" is last, always clickable and never highlighted; clicking the active tile again clears it; the selected tile has an accent border; the applied filter also shows as a chip. A tile earns its place only if its number varies, someone acts on it, and it is not already on screen.
  - Today: KPI strips filter on 25+ screens and are the most consistent filter in the app. Keep them. A tile row with nothing to act on (Dashboards, Roles) is noise. _(ui-architect calm-signal.md · screens-ai-infra-security.md §6)_
- **F8** (must) One time-range control (presets, relative, absolute, time zone) in the toolbar. Defaults: explorers and dashboards 15 minutes, overviews and summaries 24 hours.
  - Today: The time range is a header picker (11 screens), a toolbar picker (8), a segmented control (6) or a read-only pill (2); defaults are 15 m, 24 h, 1 h, 3 h and 7 d. _(screens-ai-infra-security.md §6)_
- **F9** (must) Refresh is one control, last in the toolbar: a button showing the data age ("↻ 2 min ago") with auto-refresh in its menu.
  - Today: Refresh is drawn five ways: ORefreshButton with data age (29 screens), icon-only (19), primary "Refresh" (8), ghost with a dot (4), a split "Refresh ▾" (1). Auto-refresh is an icon popover, "Auto: Off ▾", or missing. _(screens-respond.md · screens-ai-infra-security.md §6 · screens-observe.md §9)_
- **F10** (must) The toolbar is one line. When it is full, the lowest-priority controls fold into a More popover in a fixed order: view controls first, then filters beyond the first two. Search, the first filters, the time range and refresh never fold.
  - Today: Only the Logs and Traces toolbars adapt to width, and each has two overflow menus with different contents. _(screens-observe.md §9)_
- **F11** (must) Filters, search, sort, page and time range live in the URL (`useListViewState`, `v.*`) and survive refresh, Back and sharing.
  - Today: 43 of 159 list pages keep this state in the URL; 63 keep it only in memory, so it is lost on Back. _(composition.md key findings)_

## 7. Buttons and actions

| Question | Answer | Example |
| --- | --- | --- |
| Is it primary? | Only the one main action of its region (header, dialog footer, drawer footer, form). | New alert |
| Icon beside the text? | Only when the icon adds what the word lacks: menu ▾, external ↗, download, upload, copy, run ▶. | Export Docs |
| Icon only? | Universal actions only, always with a tooltip and an aria-label. |  |
| Show the shortcut? | In the tooltip, the menu and the palette. On the button only for Run and the palette trigger. | RunCtrl ↵ |
| Destructive? | Red text last in a menu; a solid red button only inside the confirmation. | Delete alert |

- **B1** (must) One primary (solid accent) button per region: page header, dialog footer, drawer footer, form. Everything else is secondary (outline) or ghost.
  - Today: Mostly right: one primary per header almost everywhere. Exceptions: a primary "Refresh" on Metrics Explore and on 8 AI headers. _(screens-observe.md §9 · screens-ai-infra-security.md §6)_
- **B2** (must) Seven variants, chosen by job: primary, secondary, ghost, accent-ghost, danger (solid, only inside a confirmation), danger-ghost (red text) and link.
  - Today: OButton declares 40 variants and 23 sizes; call sites use 34 variants in 142 variant-and-size pairs, and 1,096 icon-only buttons come in 12 sizes from 24 to 34 px. _(components.md · usage.html)_
- **B3** (must) Labels are verb + noun ("Create folder", "Delete alert", "Save dashboard"). No "OK", no "Submit", no "Yes". The one exception is the header's entry point, "New <object>" (H6); the form it opens ends in "Create <object>".
  - Today: Delete confirmations labelled "OK" in red (3) and in blue (2); "Schedule search job" confirms with "OK"; five Observe dialogs share one footer layout with five different verbs. _(screens-data.md · screens-observe.md §9)_
- **B4** (must) An icon goes on a text button only when it adds meaning the word lacks: menu chevron, external link, download, upload, copy, run. The create button never has "+".
  - Today: "+ New team", "+" on the Security create buttons, an icon on "Manage tokens", and external links as outline buttons with an ↗ on only one of four. _(screens-respond.md · screens-ai-infra-security.md §6 · screens-data.md)_
- **B5** (must) Icon-only buttons are for universal actions only (refresh, close, more, copy, expand, settings, columns, and edit or delete in a row). Each has a tooltip naming the action and its shortcut, and an aria-label. Its size matches the row.
  - Today: 28 px refresh icons beside 34 px selects; wrong tooltips ("Edit Dashboard" on variable rows, both destination header icons "Edit"). _(screens-respond.md)_
- **B6** (should) Shortcut hints appear in tooltips, menus and the command palette — not on buttons — except Run on explorers (Ctrl Enter) and the palette trigger in the top bar (Ctrl K).
  - Today: The registry-driven hints in tooltips and the key chips in row menus are good: keep them. A "Del" key chip sits mid-menu in the alerts row menu. _(screens-observe.md §9 · screens-respond.md)_
- **B7** (must) Row actions: up to two inline icon actions, shown on hover and always on touch; everything else in the row's ⋯ menu. Destructive actions come last in that menu, in red, and confirm.
  - Today: Inline icons are always visible on six lists, hover-only on SLOs, missing on Firing; destructive actions sit mid-menu; a red pause icon sits inline. _(screens-respond.md)_
- **B8** (must) More than three actions in a header or toolbar: the extras go into ⋯ More in a fixed order (frequent first, destructive last). Never shrink buttons or wrap the row to fit them. A dashboard header shows Edit, Share and the primary; Export, Duplicate, Schedule, Print, Settings and Delete live in More.
- **B9** (must) Hide an action the user can never perform here. Disable, with a tooltip saying why, an action that will become available, such as a bulk action before anything is selected.
  - Today: 288 call sites pass props the components ignore — among them `disable`, so some buttons and inputs are never actually disabled. _(components.md)_
- **B10** (must) A busy button keeps its width, shows a spinner and ignores further clicks.
- **B11** (must) Overflow is always ⋯. The ≡ icon is reserved for opening navigation on small screens.
  - Today: Header overflow uses ≡ on Pipelines and Logs while row menus use ⋮. _(screens-data.md · screens-observe.md)_

## 8. Controls, sizes and pairing

| Height | Utility | Used by | Today |
| --- | --- | --- | --- |
| 24 | `h-control-xs` | Chips, filter chips, in-row icon buttons | 24 pager buttons, panel header icons |
| 28 | `h-control-sm` | Compact density, panel headers, table footer controls | 28 date picker, `xs` buttons, toggle items |
| 32 | `h-control-md` | Default: every input, select, button, toggle and date picker | 32 inputs, icon buttons, refresh; 34 selects, search, toggles; 30 date picker and dashboard header |
| 36 | `h-control-lg` | Sign-in and empty-state call to action only | 38 boxed back button, 42 `OToggleGroup md` |

- **S1** (must) Four heights only: 24, 28, 32, 36. A size name means the same height in every component.
  - Today: Nine control heights from 24 to 42 px, twelve once call-site overrides are counted; the same size name renders at different heights (`OToggleGroup` md is 42 px); the date picker is 28, 30 or 32 depending on its parent; chips render at 14, 23, 24, 26 and 28 px. 34 px holds 2,740 of 4,513 sized call sites, and only 31% already sit on one of the four heights. _(components.md · usage.html · screens-respond.md)_
- **S2** (must) Controls that share a row share a height: an input beside a button, a select beside a segmented control, a search beside a time picker.
  - Today: 170 of 1,046 control rows (16%) mix heights; 91 of 119 toolbars (76%) do. The library's own recipe causes the commonest case: `OSearchInput` is fixed at 34 px while the column toggle and refresh are 32, mismatched in 87 of 87 toolbar rows. _(composition.md §1 · usage.html)_
  - Why: Fields already agree with each other (input with select in 30 of 30 rows); buttons don't (input with button mixes in 38 of 54 rows, select with button in 75 of 105). Most of the fix is in button sizing. The usage map lists the eight pairing rules S2.1–S2.8 with their evidence.
- **S3** (must) Form labels sit above the field (13 px medium, secondary colour, 4 px gap). Toolbar controls carry their label inside and never a label above.
- **S4** (must) A button beside a labelled field aligns with the field, not with its label (align the row to the bottom).
  - Today: 43 rows put a labelled field beside an unlabelled control; 17 of them line the button up with the label. _(composition.md key findings)_
- **S5** (must) Choose the control by the shape of the choice:
  - 2–4 options that switch a view → segmented control;
  - one of up to 5 options in a form, especially with descriptions → radio group;
  - one of more than 5, or a dynamic list → select, searchable past 8 options;
  - several of many → multi-select showing up to two chips and "+N";
  - on or off, applied at once → switch; on or off, saved with the form → checkbox.
- **S6** (must) Filter controls are clearable; required form fields are not.
- **S7** (should) Field width signals the expected value: S 160, M 240, L 360, full. Toolbar selects are 160–200 px.
- **S8** (must) The table footer's page-size select and page buttons share one height (28).
  - Today: All 160 tables with a pager put a 34 px page-size select beside 24 px page buttons. _(OTablePagination.vue:272 · :281 · usage.html)_
- **S9** (must) One switch size (28 × 16), one checkbox size (16).
  - Today: Switches are 32 × 20 in some forms and 28 × 18 in others. _(screens-respond.md control heights)_

## 9. Overlays: tooltip, menu, popover, dialog, drawer, page

| Job | Use | Size | Example |
| --- | --- | --- | --- |
| A hint about an element | Tooltip | max 280 | "Refresh · R" |
| Pick one of a few actions | Menu (one submenu level at most) | 200–320 | Row ⋯, Export ▾, More |
| A small setting tied to its trigger | Popover | 260 · 320 · 440 | Filter editor, columns, time range, share link |
| A short task: up to about six fields and one decision | Dialog | 400 · 560 · 720 | Create folder, save view, confirm delete |
| Inspect or configure while seeing the page behind | Drawer from the right | 480 · 640 · 800 · 960 | Log row detail, pipeline node, stream settings |
| The page's main create or edit task, several sections | Full page with a sticky footer | 720 column | New alert, pipeline editor, new report |

- **O1** (must) Choose the overlay by the job, using the table above.
- **O2** (must) The same job uses the same container everywhere: save a view → dialog 400; create a small object (folder, dataset, queue, budget) → dialog 560; inspect a row → drawer 640; configure a node → drawer 640; a multi-section create or edit → page.
  - Today: Create alert is a page from Logs and Metrics but a dialog, then a page, from Traces. Save view is a 640 "Saved View" dialog in Logs and a 480 "Save view" dialog in Metrics. Small creates are drawers in AI and dialogs elsewhere. Create backfill is a drawer, edit backfill a dialog. _(screens-observe.md §9 · screens-ai-infra-security.md §6 · screens-data.md)_
- **O3** (must) Overlays come in fixed widths: dialogs 400, 560, 720; drawers 480, 640, 800, 960. No percentage or vw widths.
  - Today: 27 drawer widths in code (19 of them vw values); 8 in the Data area alone, from 432 to 1,397 px; dialogs from 480 to 1,080 px. _(composition.md §4 · screens-data.md)_
- **O4** (must) An overlay never changes size or position while it is open. When a radio, tab or select switches its content, it reserves the height of the tallest state, or grows downward only from a fixed top. Popovers that filter keep their width and show "No matches" in place.
  - Today: 18 overlays switch content with no fixed height. Create drilldown shrinks 468 → 378 → 308 px and its top moves about 80 px each time; Update user grows 319 → 511 px; the command palette's top jumps 184 → 360 px as you type; the stream picker narrows 288 → 175 px while filtering; Associate function widens 432 → 1,397 px. _(composition.md §4 · screens-respond.md · screens-settings-iam.md · screens-observe.md · screens-data.md §10)_
- **O5** (must) Dialogs sit at a fixed top offset (12 vh), not vertically centred, so growing content never moves the header. The command palette does the same.
- **O6** (must) The header and footer of a dialog or drawer stay fixed; only the body scrolls. The footer is never cut off, at any window height.
  - Today: The stream detail drawer's Cancel and Update settings are cut off at 1440 × 900. _(screens-data.md · schema.vue:70)_
- **O7** (must) Footer buttons are right-aligned: Cancel, then the primary. Extra actions (Test connection, Delete, Discard) sit at the left of the footer.
  - Today: Consistent in code — Cancel comes first in 132 of 132 pairs: keep it. The exceptions are tertiary buttons before Cancel, left-aligned wizard buttons, and actions moved into headers. _(composition.md key findings · screens-ai-infra-security.md §6)_
- **O8** (must) No overlay opens another modal overlay. A menu or popover inside a dialog is fine; a dialog from a dialog is not. A nested create becomes inline, such as "New folder" inside the folder select.
  - Today: Four chains: New dashboard → Add folder, Move dashboard → Add folder, Dashboard settings drawer → Add tab, Settings drawer → leave dialog. _(screens-respond.md)_
- **O9** (must) Escape closes the top overlay. Clicking outside closes popovers and menus. A dialog or drawer with edits asks before closing (V5).
  - Today: Dialogs throw typed input away on Escape or an outside click; the Condition drawer ignores Escape. _(screens-respond.md · screens-data.md)_

## 10. Forms and saving

| Surface | Where Save goes | Leaving with edits |
| --- | --- | --- |
| Dialog or drawer | Footer, right: Cancel · primary | "Discard changes?" in place of the footer — Keep editing · Discard |
| Full-page editor (alert, report, prompt, SLO) | Sticky footer of the form column: Cancel · Save | "Leave with unsaved changes?" — Discard · Keep draft · Save |
| Canvas editor (pipeline, dashboard, workflow) | Header primary, with a change count | Same three-way dialog, plus a browser prompt on reload |
| Settings page | Sticky bar while dirty: "Unsaved changes · Discard · Save" | "Discard changes?" — Keep editing · Discard |
| Explorer (logs, metrics, traces) | "Save view" in the saved views menu; a modified view shows a dot | No guard; the edited query stays until Run |

- **V1** (must) Forms are one column of titled sections (15 px semibold): 16 px between fields, 24 px between sections.
- **V2** (must) Save lives where the eye ends, as in the table above. Never inline in the middle of the content, never twice on one page.
  - Today: Code puts Save in 8 kinds of place (dialog footer 58, inline in a page or panel 51, inline in a form 33, sticky bar 21, drawer footer 21, pinned footer 20, header 20, table slot 19); Settings alone has 10. New destination's Save jumps from y = 318 to 836 with the chosen type. _(composition.md key findings · screens-settings-iam.md §0 · screens-respond.md)_
- **V3** (must) Settings pages show the sticky "Unsaved changes · Discard · Save" bar only while there are changes. A switch that applies immediately needs no Save and confirms with a toast.
  - Today: General, Organization parameters and Password policy have no guard; SSO shows "● Unsaved changes" but never asks. Password policy and Agent mapping keep Save disabled until dirty — the good base. _(screens-settings-iam.md §0)_
- **V4** (must) Full-page and canvas editors guard leaving with the shared draft dialog: "Leave with unsaved changes?" — Discard (left), Keep draft, Save. Escape or ✕ stays on the page. Reopening an editor with a kept draft shows a "Restore draft" banner.
  - Today: This dialog (`EditorDraftLeaveDialog` with `useEditorDraft`) already guards 8 Respond editors, 6 AI editors, pipelines and functions: make it the only one. 28 of 61 full-page editors have no guard; the workflow editor and Agent mapping use their own dialogs, one with "Discard changes" as the primary. _(composition.md key findings · screens-respond.md · screens-ai-infra-security.md §6)_
- **V5** (must) Dialogs, drawers and settings pages with edits ask "Discard changes?" — Keep editing (default) or Discard — on Escape, outside click, ✕ or navigation. In a dialog or drawer the question replaces its own footer, so no second dialog opens (O8); a settings page asks in a dialog.
  - Today: New stream, New enrichment table, Create backfill, every IAM dialog and every AI create drawer close silently and lose what was typed. _(screens-data.md §8 · screens-settings-iam.md §0 · screens-ai-infra-security.md §6)_
- **V6** (must) Validate on blur and on submit. On submit, scroll to and focus the first error; long forms also show a summary at the top. Errors sit under their field, never only in a toast.
  - Today: Validation appears in four places: under the field, in a side panel, in a toast, or nowhere. The Prompt form's required error sits below the fold with no scroll and no focus; Budget calls Destination optional, then rejects the save in a toast. _(screens-ai-infra-security.md §6)_
- **V7** (must) Enter submits only a single-field dialog (rename, create folder). In a multi-field form or editor, Enter never saves.
  - Today: Enter in the add-panel title saves the whole panel (it saved two panels during the survey); Enter in the function name submits the form. _(screens-respond.md · screens-data.md)_
- **V8** (must) Confirm a destructive action by naming the object ("Delete alert 'Payments 5xx'?") with a red button that repeats the verb. Type-to-confirm only for irreversible bulk or data-losing deletes. Reversible changes (pause, disable) apply at once with an Undo toast. One confirm component everywhere.
  - Today: Five confirm styles in Data and four in Settings; 64 hand-built confirm dialogs beside 104 uses of ConfirmDialog. Disabling an ingestion token and generating tokens do not confirm. Deleting an in-use function fails only after you confirm. _(composition.md §4 · screens-data.md · screens-settings-iam.md §0)_
- **V9** (must) Multi-step creates use one stepper: a horizontal step bar at the top of the page body, with Back and Next in the sticky footer. There are no Continue buttons inside steps. Required sections are not steps.
  - Today: Four stepper layouts, Continue buttons inside steps, and required-tab bars ("Alert rules * | Advanced") that act like steps. _(screens-respond.md)_
- **V10** (must) Required fields carry a red * after the label. When most fields are required, mark the few optional ones with "(optional)" instead.
  - Today: Dark and red asterisks on different forms; a required "Upload CSV File" with no mark; messages in four styles ("… is required", "Field is required!", "Please select a stream type"). _(screens-data.md)_

## 11. Tables and lists

- **D1** (must) Rows are 36 px (Default) or 28 px (Compact) with 12 px cell padding; the header is 32 px in 12 px medium secondary text, sentence case, with no coloured band.
- **D2** (must) The first column is the entity name as a real link; a State column comes next when the entity has a state. No row-number column.
- **D3** (must) Numbers are right-aligned and tabular. Times are relative with the absolute time in a tooltip. Long IDs are mono and middle-truncated.
- **D4** (must) Unknown values are "—" in tertiary text. A column that is empty in every row is hidden by default.
- **D5** (must) Lists of records page with one footer pager ("1–20 of 143", page size, previous and next). Streams of events (logs, spans) scroll continuously. Never both on one screen, and no pager under an empty table.
  - Today: Five pager layouts, page size 20 in AI and 50 in Security, two pagers on one page (Agent behavior), and "Showing 0 - 0 of 0 · Records per page" under every empty table. _(screens-ai-infra-security.md §6 · screens-data.md)_
- **D6** (must) Selecting rows turns the footer into the selection bar ("3 selected · actions · Clear"). Toasts never cover it.
  - Today: The OTable bulk bar on Alerts and Dashboards is the right pattern; toasts cover it. _(screens-respond.md · screens-data.md)_
- **D7** (must) A sticky actions column never covers column headers.
  - Today: Five headers are clipped under the sticky Actions column (Discovery "Qua", Queues "Tar", Jobs "Stre", Prompts "L", Remote tasks "Re"). _(screens-ai-infra-security.md §6)_
- **D8** (must) Tables fill the content width inside the page gutter. No card inside a card.
  - Today: Most tables bleed to the edges; Users, Budgets, Security sources and Agent behavior are inset cards. _(screens-ai-infra-security.md §6)_

## 12. Navigation and state

| State | Lives in | Survives |
| --- | --- | --- |
| Query, filters, search, sort, page, time range, open drawer, selected tab | URL | Refresh, Back, sharing a link |
| Scroll position and highlighted row | History entry | Back and Forward |
| Columns, density, panel sizes, collapsed panels | Local storage, per org | Every visit on this browser |
| Saved views, dashboards, preferences shared across devices | Server | Everywhere |
| Unsaved edits in a full-page editor | Local draft (7 days) | Reload and leaving, through "Keep draft" |

- **N1** (must) The left rail shows top-level areas only. An area with sub-pages opens a flyout listing its pages, each with a one-line description; the current page is marked in the flyout and the area in the rail.
  - Today: The rail's flyout groups (Reliability, Data, Infra, Experience, Dashboards, Settings) are the right model: keep them. AI toolsets has a route but no entry; some settings routes are hidden and render an error, a blank page or a redirect. _(screens-settings-iam.md §0)_
- **N2** (must) Inside an area, up to six peer pages are tabs on their own row under the header, starting at the content edge; one or two more go into a "More ▾" tab at the end. Areas with many pages (Settings, IAM) use a section list beside the rail instead of tabs.
- **N3** (must) Back returns to the exact previous state of the list: query, filters, sort, page, scroll and the highlighted row. From a deep link with no history, Back goes to the parent page. Use the shared `useSmartBack`; never a raw `router.back()`.
  - Today: 19 raw `router.back()` calls; six of them (Add alert Cancel, four import pages, New report) leave the app from a deep link. Scroll is restored only on Metrics. After a rail round trip the Logs URL is cut to `?period=` and Traces falls back to the Spans tab. _(composition.md key findings · screens-respond.md · screens-observe.md §8)_
- **N4** (must) A drill-down keeps a way back: a detail drawer closes with Escape to the same list position, a drill-down page shows a parent link above its title, and leaving a mode shows a one-line "Back to results" banner.
  - Today: The Logs "Back to results" banner and the J/K drawer with focus returned to the row are good: make them the standard. The alert page opened from Logs goes back to the alert list, not to Logs. _(screens-observe.md §9)_
- **N5** (must) Entity names in lists are real links, so opening in a new tab works.
- **N6** (must) State lives where the table above says.
  - Today: The stream detail drawer is not in the URL, while Prompts and AutoObserve drawers are. `meta.keepAlive` is set on 32 routes but nothing reads it. _(screens-data.md §9 · composition.md key findings)_
- **N7** (must) One name means one feature.
  - Today: "Drill down" names three features: Logs dimension insights, the Metrics detail page and the Traces selection comparison. _(screens-observe.md §9)_

## 13. Feedback

| Empty state | Says | Action |
| --- | --- | --- |
| First run | What this is and why you would use it | One primary: "New alert" |
| Filtered | No rows match the filters | Clear filters |
| Denied | You don't have access, and who can grant it | None, or "Request access" |
| Error | What failed, in plain words | Retry |

- **K1** (must) A toast reports the result of an action that is not otherwise visible. One line, "<Object> <past verb>" ("Alert saved", "Folder deleted · Undo"), 4 seconds (8 with Undo; 30 for an error or warning, which often carries a reason to read), bottom centre, above any sticky footer or selection bar.
  - Today: Toasts cover the sticky Save on Add alert and the bulk bar; success copy comes in seven shapes ("Pipeline saved successfully", "Saved enrichment table", "Link Copied Successfully!"); one toast capitalises a user's view name ("Uxinv-obs view view applied successfully."). _(screens-data.md · screens-respond.md · screens-observe.md)_
- **K2** (must) Errors the user must fix appear inline, not in a toast. A later success removes earlier error toasts about the same object.
  - Today: Stale warnings and errors stay after a later success (three times in Data); server compiler errors are dumped verbatim into a toast. _(screens-data.md)_
- **K3** (must) A banner states a lasting condition of the page (quota, partial data, read-only): one line, directly under the header.
- **K4** (must) Loading shows a skeleton of the final layout after 150 ms, never a "0". A refresh keeps the current rows visible with a thin progress bar.
  - Today: Logs keeps stale rows during a run, which is right; the Product analytics "Create named event" spinner never ends. _(screens-observe.md §9)_
- **K5** (must) Empty states come in the four kinds above, in one component. A failed load never shows the first-run state.
  - Today: Seven empty-state looks in Data and eight in AI and Infra. Synthetics shows its first-run state on a 404; escalation policies says "No on-call teams yet" after the load failed. _(screens-data.md · screens-ai-infra-security.md §6 · screens-respond.md)_
- **K6** (must) Error messages say what failed and what to do. Never raw HTTP text, never blame the user for a disabled feature.
  - Today: "Request failed with status code 404" on four Security screens; a solid red banner on Fleet; External alert sources blames the user's role for a feature that is switched off. _(screens-ai-infra-security.md §6 · screens-respond.md)_

## 14. File upload and import

- **U1** (must) One upload component everywhere: a drop zone that really accepts drops, with "choose a file" inside; the accepted types and size limit under it; each chosen file as a row (name, size, remove); progress and errors inline.
  - Today: Four upload UIs in two looks in Data, three versions of the same JSON import in Respond, three in Settings. The import pages say "Drop your file here" but dropping is switched off; nothing shows progress; an invalid file is silently ignored on dashboard import. _(screens-data.md §6 · BaseImport.vue:127-134 · screens-respond.md · screens-settings-iam.md §0)_
- **U2** (must) Import from a file, a URL or pasted text uses a segmented control above the zone, and the container keeps one size for all three.
  - Today: Segmented tabs on the import pages, a radio group in the enrichment dialog — which jumps 329 ↔ 351 px when you switch. _(screens-data.md §10)_
- **U3** (must) Import results appear inline under one heading, "Import results", and turn each error into a field the user can fix — the existing "Error validations" pattern, kept and named once.
  - Today: Three names for the same pane: "Error Validations", "Output Messages", "Import results". _(screens-respond.md)_

## 15. Keyboard

- **KB1** (must) Global keys: Ctrl K opens the command palette, / focuses the page search, Escape closes the top overlay, ? lists the shortcuts.
- **KB2** (must) Explorers: Ctrl Enter runs the query; J and K move through rows in the detail drawer; Escape closes the drawer and returns focus to the row.
- **KB3** (must) Shortcuts come from one registry, so a hint in a tooltip, a menu and the palette always shows the same keys.
- **KB4** (must) Everything clickable is a button or a link and is reachable by Tab with a visible focus ring.
  - Today: 126 raw buttons and 260 clickable divs bypass the library. _(components.md)_

## 16. Responsive

- **R1** (must) Desktop (1280 px and up) is the reference. From 1024 to 1279 px, toolbars fold into More (F10). Under 768 px the rail becomes a drawer behind ≡, tables scroll inside their frame, row actions move into ⋯, and segmented controls become selects.
  - Today: The global header overflows at 768 px and only the Logs and Traces toolbars adapt. Data already has the right phone patterns (segmented → dropdown, row actions → ⋯, rail → drawer): make them the standard. _(screens-observe.md §9 · screens-data.md)_
- **R2** (must) Under 640 px, dialogs become full-width sheets and the header's secondary actions move into ⋯ More, so the title keeps its room; under 768 px, drawers take the full width.
- **R3** (must) Nothing is cut off at a short window (900 px and less): overlay footers are sticky and page footers stay in view.

## 17. Copy

- **W1** (must) Sentence case; plain words; no exclamation marks; no apology.
- **W2** (must) One verb per action: "New <object>" opens a create page or dialog; its final button is "Create <object>"; editing ends in "Save"; putting a thing into a container is "Add <thing>" (Add panel, Add field, Add member).
- **W3** (must) Counts use figures and correct plurals: "1 entity", "2 entities".
  - Today: "1 entities", "1 items", "3 Dimensions selected". _(screens-observe.md §9 · screens-ai-infra-security.md §6)_
- **W4** (must) One time format. Tables show relative time ("3 min ago") with the absolute time in a tooltip; absolute times read `2026-11-13 19:46:58.332` in the user's time zone; durations read "158 ms", "1.2 s".
  - Today: Nine timestamp formats in Observe, from `11/13 13:52:49` to `07:00:26 PM`. _(screens-observe.md §9)_
- **W5** (must) Never show raw values: labels, not keys ("Enrichment tables", not `enrichment_tables`; "Running", not `running…`; "No", not `False`).
  - Today: Raw stream types, backfill statuses, "False" for cron, "Int64 / Utf8", "re_match". _(screens-data.md)_

## 18. Checklist for AI agents

- [L2] Bands in order: header, tabs, toolbar, strip, chips, content, footer.
- [H1] Header is a context line above a 16 px title, actions right.
- [H8] Nothing in the header moves on tab switch or navigation.
- [H3] At most two secondary, one primary, then ⋯ More.
- [H6] Create button: "New <object>", label only.
- [F1] Toolbar order: search, filters, spacer, view, time, refresh.
- [F2] Search first, 280 px on lists.
- [F3] Filter selects carry their label inside.
- [F5] Applied filters show as chips with Clear all.
- [F6] No segmented control or tab used as a state filter.
- [F10] Toolbar never wraps; overflow folds into More.
- [F11] Filters, sort, page and time range are in the URL.
- [S1] Heights only 24, 28, 32, 36.
- [S2] Every control in a row shares one height token.
- [S4] Buttons beside labelled fields align to the field.
- [B1] One primary per region.
- [B3] Verb + noun labels, never "OK".
- [B4] Icons on text buttons only for ▾ ↗ download upload copy run.
- [B5] Icon-only buttons have a tooltip and aria-label.
- [B7] Row actions: two inline, the rest in ⋯, destructive last.
- [O1] Overlay chosen by the job table.
- [O3] Overlay width from the fixed sizes.
- [O4] Overlay never resizes or moves while open.
- [O8] No dialog opens from a dialog.
- [V2] Save where the eye ends, once per page.
- [V4] Editors use the shared leave dialog.
- [V5] Dirty dialogs and settings ask before discarding.
- [V6] Validate on blur; focus the first error on submit.
- [V7] Enter never saves a multi-field form.
- [V8] Destructive confirm names the object.
- [N3] Back via useSmartBack; never raw router.back().
- [K5] Empty state of the right kind; never first-run on error.
- [K6] No raw HTTP errors in the UI.
- [C3] Colour the exception, not the norm.
- [C4] Unknown is "—", zero is a muted 0.
- [T5] Sentence case, no uppercase labels.
- [W4] One time format: relative with absolute tooltip.
