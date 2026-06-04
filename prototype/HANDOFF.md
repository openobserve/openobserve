# OpenObserve — Unified Navigation & UI System
### Implementation handoff spec

This document describes the design system and navigation model demonstrated in the
`prototype/` clickable prototype. It is written to be implemented directly by an engineer
(or coding agent) against the real OpenObserve frontend. Every value below is taken from the
shipped prototype CSS (`prototype/styles.css`) — they are not aspirational, they are exact.

**Visual references** are in `prototype/handoff-assets/`:
- `01-dashboards.png` — flat list page (titled header, in-content folder rail, data table)
- `02-iam-table.png` — admin module (grouped rail + full-width table + breadcrumb)
- `03-iam-drawer.png` — record drawer (edit-in-context)
- `04-settings.png` — Settings using the **identical** pattern as IAM

---

## 0. Locked decisions (chosen variants)

These were A/B-tested in the prototype as tweaks. **Ship these as the defaults — drop the other variants.**

| Decision | Ship | Notes |
|---|---|---|
| **Typeface** | **IBM Plex Sans** + **IBM Plex Mono** | Built for data/technical UIs; razor-legible at 12–13px |
| **Header** | **Titled** | Two-part header: tile + title + subtitle on row 1, one of {tabs \| breadcrumb \| tagline} on row 2 |
| **Chrome** | **Framed** | Top bar + left rail merge into one tinted L-frame; content nests as a white rounded card |
| **Row density** | **Compact** | 38px rows, 13px base text — maximizes data on screen |
| **Casing** | **Sentence case** everywhere | "Cipher keys", not "Cipher Keys"; no ALL-CAPS eyebrows |
| **Surface (Logs)** | **Combined** | Hairline dividers between sections (not shadowed cards) |

---

## 1. Design tokens

Define these as CSS custom properties on `:root`. Everything else references them — **never hardcode a hex value in a component.**

### 1.1 Brand (iris) — the accent ramp
```
--iris-200: #F7F9FE   /* faintest tint — table row hover */
--iris-300: #EFF1FD   /* active nav bg, primary tint, selected rows, icon-tile bg */
--iris-400: #E4E9FE   /* avatar bg, selection text-on-tint */
--iris-500: #D7DEFE   /* chip-on border */
--iris-700: #B3BDF1   /* focus ring, hover border on cards */
--iris-900: #6B76E3   /* graph node strokes, decorative */
--iris-1000:#6069D3   /* primary hover, chart line */
--iris-1100:#575FC5   /* PRIMARY — buttons, active text, links */
--iris-1200:#282D5D   /* text on iris tints (e.g. avatar initials) */
```

### 1.2 Neutrals (gray ramp) — refined for AA contrast
```
--g-0:  #FFFFFF   /* panel / card surface */
--g-50: #FBFBFD   /* subtle zebra, rail bg in flush mode, button hover */
--g-100:#F5F6F9   /* framed-mode chrome bg, tray bg, icon chip bg */
--g-150:#EEF0F4   /* border-soft, skeleton base, hover fill */
--g-200:#E6E8EE   /* default border */
--g-300:#DADCE4   /* hover border, scrollbar thumb */
--g-400:#B4B8C4   /* disabled, separators, placeholder chevrons */
--g-500:#7C808E   /* (reserve) */
--g-600:#5C606E   /* text-3 — metadata, captions, labels */
--g-700:#474A56   /* text-2 — secondary body */
--g-800:#33363F   /* (reserve) */
--g-900:#1B1D24   /* text — primary near-black */
```

### 1.3 Semantic aliases — **use these in components, not the raw ramps**
```
--primary:       var(--iris-1100)
--primary-hover: var(--iris-1000)
--primary-tint:  var(--iris-300)
--panel:         var(--g-0)
--border:        var(--g-200)     /* structural dividers, input borders, table header underline */
--border-soft:   var(--g-150)     /* row dividers, section dividers (lighter) */
--text:          var(--g-900)     /* primary text, record names */
--text-2:        var(--g-700)     /* secondary text, nav links, button labels */
--text-3:        var(--g-600)     /* metadata, column headers, captions, IDs, timestamps */

--ok:    #1F8A5B  / --ok-tint:    #E7F4EE   /* healthy, active, success */
--warn:  #B7791F  / --warn-tint:  #FBF1DD   /* degraded, pending, >80% usage */
--danger:#D14343  / --danger-tint:#FBE9E9   /* errors, destructive actions */
--info:  #2A6FDB  / --info-tint:  #E7F0FC   /* informational badges (e.g. role=admin) */
```

### 1.4 Token-usage rules (which token, where)
- **Text hierarchy:** primary names/values → `--text`; secondary → `--text-2`; everything that is metadata, a column header, a timestamp, an ID, or a caption → `--text-3`. When in doubt, demote to `--text-3` — it keeps names popping.
- **Borders:** structural/outer and input borders → `--border`; in-list row dividers and intra-card section splits → `--border-soft`.
- **Status:** only ever use the four semantic pairs. A badge uses `--x-tint` background + `--x` foreground. A status dot uses solid `--x`.
- **Accent restraint:** `--primary` is for exactly one primary action per view, active nav, links, and the focus ring. Do not tint large surfaces with it. Selected/active backgrounds use `--iris-300`, never `--primary` at full strength.

---

## 2. Typography

### 2.1 Families
```
--font-ui:   'IBM Plex Sans'    /* all UI text */
--font-mono: 'IBM Plex Mono'    /* IDs, tokens, code, timestamps, metrics, regex, anything machine-generated */
```
Load weights **400, 500, 600, 700** for Sans and **400, 500, 600** for Mono. Apply `.mono` (with `font-feature-settings: "tnum"; letter-spacing: -.2px`) to every identifier, hash, timestamp, count, and code string.

### 2.2 The weight scale — **the single most important typography rule**
Weight must signal hierarchy. When everything is 700+, nothing stands out. Use exactly four steps:

| Weight | Use for |
|---|---|
| **700** | The one title peak per view (page title, drawer/detail title). **Never 800.** |
| **600** | Active nav item, primary/secondary button labels, badges, gray section labels, breadcrumb terminal |
| **500** | Record & row names (the "name" column). Enough to separate from metadata without shouting. |
| **400** | Body text, metadata, IDs, timestamps, captions, descriptions |

### 2.3 Sizes (compact density)
```
Page title (titled header) ... 17px / 700 / -0.35px tracking
Drawer / detail title ......... 18px / 700 / -0.4px
Section label (gray eyebrow) .. 11.5px / 600 / 0 tracking / --text-3   (sentence case, NOT uppercase)
Body / table cell / input ..... 13px / 400  (--fs)
Small / metadata / captions ... 12px / 400  (--fs-sm)
Table column header ........... 12px / 600 / --text-3
Micro (counts, sub-labels) .... 11–11.5px
Big stat number ............... 28–52px / 700 / negative tracking
```
`--fs: 13px`, `--fs-sm: 12px` at compact; `13.5 / 12.5` at comfortable. Line-height for titles ~1.15, body ~1.45–1.5.

### 2.4 Casing
Sentence case for **all** titles, labels, nav items, column headers, and section labels. Capitalize only the first word and proper nouns ("Service accounts", "Cipher keys", "Query management"). No ALL-CAPS, no letter-spacing tricks on labels.

---

## 3. Iconography

- **Style:** single-weight **outline/stroke** icons (Lucide-style). No filled, no duotone, no emoji.
- **Stroke width:** `1.6px` standard. Use `2px` only for tiny glyphs inside ≤18px chips/avatars.
- **Line caps/joins:** `round` / `round`.
- **Color:** inherits `currentColor`. In nav/list contexts icons sit at `--text-3`; they brighten to `--text`/`--primary` on hover/active alongside their label.
- **Sizes (px):**
  - L1 rail icon: **21**
  - Page-header tile icon: **21** (tile is 38×38, radius 10, `--iris-300` bg / `--iris-1100` fg)
  - Inline list/nav icon: **15–16**
  - Table row-action icon: **16** (inside a 28×28 `.iconbtn`)
  - Breadcrumb separator (chevron): **13**
  - Button leading icon: **16** (15 for `.sm`)
- **Redundant-icon rule:** never render the *same* icon on every row of a homogeneous list (e.g. a folder glyph on every folder). An icon must *differentiate* — vary it by type, or drop it and lead with the name. Reserve the icon slot only for rows that are genuinely special (e.g. the system `default` folder gets a home mark; the rest get none and no blank gutter).

---

## 4. Spacing, geometry & elevation
```
--topbar-h: 46px
--rail-w:   74px        (icon + label rail; 56px if labels are hidden)
--row-h:    38px        (compact)  / 46px (comfortable)
--pad:      14px        (compact)  / 18px (comfortable)  — standard horizontal padding for headers/toolbars/cells

Radii:  --radius-sm 6px (chips/inputs inner) · --radius 9px (buttons/cards) · --radius-lg 12px (panels, framed content)
Shadows:
  --shadow-1   0 1px 2px rgba(20,22,30,.04), 0 1px 1px rgba(20,22,30,.03)   /* cards, framed content, seg active */
  --shadow-2   0 4px 16px rgba(20,22,30,.08), 0 1px 3px rgba(20,22,30,.05)  /* hover lift on cards */
  --shadow-pop 0 12px 32px rgba(20,22,30,.16), 0 2px 8px rgba(20,22,30,.08) /* popovers, modals, drawer */
```
Prefer flex/grid with `gap` for all spacing — never margin chains or inline-flow whitespace.

---

## 5. App shell (chrome) — Framed

```
.app      → grid-rows: [46px topbar] [1fr body]
.app-body → grid-cols: [74px rail] [1fr content]
```

**Framed mode (`[data-chrome="framed"]`):**
- `.app`, `.topbar`, `.rail` all share `--g-100` background with **no** borders between them → they read as one continuous L-shaped frame.
- `.app-body` gets `padding: 0 6px 6px 0`.
- `.content` becomes a **white card**: `background --g-0`, `border 1px --border`, `border-radius 12px`, `box-shadow --shadow-1`. This is the tucked-corner "single unit" look.
- Active rail item: white bg + `--shadow-1` (no left accent bar in framed mode).

### 5.1 Top bar (global context only — never page navigation)
Left→right: brand logo (26×26 iris-gradient tile, radius 7) + wordmark → org switcher (popover) → flex spacer → edition pill → divider → icon buttons (AI, notifications, theme, docs, settings-gear) → user avatar (30px circle). Icon buttons are 32×32, radius 8, `--text-2`, hover `--g-100`. **The top bar never shows the page title or a breadcrumb** — that is the page header's job.

### 5.2 L1 icon rail (primary module nav)
Vertical list of modules (Home, Logs, Metrics, Traces, RUM, Pipelines, Dashboards, Streams, Reports, Alerts, Incidents, Data sources, IAM). Each item: stacked 21px icon + 10.5px/600 label, padding `9px 4px 8px`, margin `1px 8px`, radius 10. Active = `--iris-300` bg + `--iris-1100` fg.

---

## 6. Page header — the "one-header law"

**There is exactly one header per view.** It identifies the *module* and never mutates between tabs. Anatomy (Titled mode):

```
┌─ .pagehead ─────────────────────────────────────────────┐
│ .ph-row1  [tile] [title / subtitle]      [actions →]     │   padding: 12px 14px, gap 13px
│ .ph-row2  EXACTLY ONE OF: {tabs | breadcrumb | tagline}  │   padding: 0 14px, min-height 38px
└──────────────────────────────────────────────────────────┘
```
- **Row 1:** 38px icon tile (`--iris-300`/`--iris-1100`, radius 10) · title (17px/700) + optional subtitle (12px/`--text-3`) · right-aligned actions.
- **Row 2 — iron rule: show only ONE of:**
  - **Tabs** — for a module with **2–5 sibling sections** (e.g. Pipelines: Pipelines · Functions · Enrichment tables · Eval templates).
  - **Breadcrumb** — when the user has **drilled into a record/sub-page** (L3+).
  - **Tagline** — a one-line descriptor when there's neither (flat list pages).
  - **Never tabs *and* breadcrumb together.** When you drill in from a tabbed page, the breadcrumb **replaces** the tabs.
- If a view has none of the three, row 2 collapses (`display:none`).

### 6.1 Primary action placement
The primary CTA (`+ New …`) lives **top-right in the header, row 1**, and stays there across tab switches — only its label changes. This matches Datadog/Grafana/New Relic convention. **Do not** float the create button into the content body.

### 6.2 Where actions go
- **Header (row 1):** the single primary action + import/secondary at most. Scoped to the whole page/section.
- **Section toolbar (`.sectionbar`, below row 2):** search/filter/scope controls only — **no primary action here**.
- **Row hover:** per-record actions (edit/delete) live in the row's action cell, revealed on hover.

---

## 7. Breadcrumbs

- **Location:** always row 2 of the one header. Never in the top bar, never duplicated.
- **When:** only on an L3+ drill (a chosen record, a sub-page, an editor). Flat list pages get a tagline instead; tabbed pages get tabs.
- **Anatomy:** `Module › Group/Folder › Record [› Sub-page]`. Each non-terminal crumb is a `<button>` that navigates back (`--text-2`, hover fills `--g-100`). Terminal crumb is non-interactive, `--text`/600.
- **Separator:** 13px chevron-right in `--g-400`.
- **Overflow:** if a path exceeds **4 levels**, collapse the middle into a `…` button that opens a popover of the hidden crumbs. Always keep the **first** and the **last two** visible.
- **Examples in prototype:** `IAM › Access control › Users`; `Settings › Security › Cipher keys`; `Dashboards › default › <dashboard> › Add panel`.

---

## 8. Data tables

Reference: `01-dashboards.png` (full list table), `02-iam-table.png` (admin table).

### 8.1 Structure
```
.tbl-wrap   → flex:1; overflow:auto; min-height:0   (the scroll container)
table.tbl   → width:100%; border-collapse:collapse; font-size 13px
thead th    → position:sticky; top:0; z-index:2; bg --g-50; 12px/600 --text-3;
              height 36px; padding 0 14px; border-bottom 1px --border; white-space:nowrap
tbody td    → padding 0 14px; height var(--row-h)=38px; border-bottom 1px --border-soft;
              vertical-align:middle; white-space:nowrap
row hover   → all td bg → --iris-200
row select  → all td bg → --iris-300  (.sel)
```
The header is **sticky** so it stays while the body scrolls. The whole table scrolls inside `.tbl-wrap`; the page header, toolbar, and footer stay fixed.

### 8.2 Column-width strategy
**Fixed (px) for bounded/structural columns; fluid (auto) for the one column that should absorb slack.**

| Column | Width | Rule |
|---|---|---|
| Checkbox (select) | **40px** fixed | Just fits the 16px box + padding. Header cell holds the select-all checkbox. |
| Serial / index (`#`, `.c-idx`) | **48px** fixed | Tabular-nums, `--text-3`. Zero-padded ("01"). Optional — only on flat lists, not admin tables. |
| Primary **name** (`.c-name`) | **auto / fluid** | The flex column that eats remaining space. 500 weight. This is the one column with no fixed width. |
| Identifier / hash | fixed ~ content | `.mono`, `--text-3`. Set to fit the known ID length. |
| Short enums (role, type, status) | fixed ~96–120px | Sized to the badge. |
| Timestamps (created, last active) | fixed ~110–140px | `--text-3`. |
| **Actions** | **90px** fixed, `text-align:right` | See 8.3. |

**How to decide a width:** measure the *widest realistic value* for that column at 13px and add the 14px×2 cell padding; round up to a tidy number. Only the name column is fluid — everything else is content-bounded so the table never reflows awkwardly. Keep total fixed widths well under the viewport so the name column always has room; enable horizontal scroll (`.tbl-wrap` overflow:auto) as the safety valve for narrow screens.

### 8.3 Sticky / minimal action column
- Header label "Actions", **`width: 90px`**, `text-align:right`. This is deliberately **minimal** — only the 1–3 most common verbs (edit, delete; overflow goes into a `⋯` popover). Don't widen it; push extra actions into the row's overflow menu.
- Actions render in `.row-act`: a right-aligned flex of 28×28 `.iconbtn`s, **`opacity:.35` at rest → `1` on row hover** (so the column is calm until you target a row). Destructive `.iconbtn.danger` hovers to `--danger-tint`/`--danger`.
- The action cell stops click-propagation (`onClick=stopPropagation`) so clicking an icon doesn't also trigger the row's open/drill handler.
- For wide tables that scroll horizontally, the action column should be **`position:sticky; right:0`** with the row background carried through, so edit/delete stay reachable. (Add this when horizontal scroll is in play.)

### 8.4 Row click
Whole row is clickable to open the record (cursor:pointer) — opens the **drawer** in admin modules (§9), or **drills** to a full page where the detail needs full width (dashboards, pipeline editor).

---

## 9. IAM & Settings — the identical admin pattern

> Reference: `02-iam-table.png`, `03-iam-drawer.png`, `04-settings.png`.

**IAM and Settings behave exactly the same.** Both are built from one shared shell. The rule that drives this:

- **2–5 sections → tabs** in header row 2.
- **6+ sections → grouped left rail** (`.l2`). IAM has 7, Settings has ~16, so **both use the rail** — and therefore they look and behave identically. (Do **not** give IAM tabs and Settings a rail; that was an earlier inconsistency we explicitly removed.)

### 9.1 Anatomy (both modules)
```
[ L1 rail ] [ .l2 grouped section rail ] [ content: one-header + table/form ]  + slide-in drawer
```
- **`.l2` grouped rail** (218px, `--g-50` bg, right border `--border-soft`): a search field + collapsible groups. Group heading `.l2-ghead` (11.5px/600/`--text-3`, sentence case, chevron toggles collapse). Items `.l2-link` (7px/9px padding, radius 8, gap 9, 15–16px leading icon in `--text-3`). Active = `--iris-300` bg + `--iris-1100` text & icon.
  - IAM groups: **Access control** (Users, Roles, Groups) · **Authentication** (Service accounts, Organizations, Quota, Invitations).
  - Settings groups: **General** · **Security** · **Destinations** · **Advanced**.
- **Content** = the one header (titled, with breadcrumb `Module › Group › Section`) + either:
  - a **full-width table** (§8) for record sections (Users, Roles, Cipher keys, Templates, Nodes…), or
  - a **form** for singleton sections (Organization, SSO, Billing…).

### 9.2 Record editing → drawer (not a second list-column, not a full page)
Clicking a table row, or `+ New`, opens a **right-side drawer** (`03-iam-drawer.png`):
- Width **460px** (or **600px** `.wide` for permission matrices / scoped tokens), `--shadow-pop`, slides in over a 28%-dim scrim, **Esc** or scrim-click closes.
- **Drawer header:** small 36px tile + title (record name) + subtitle + close (×).
- **Drawer body:** key/value rows (`.kv`, 168px label column / fluid value) and section labels.
- **Drawer footer (`.drawer-foot`):** `Delete` (left, danger) · spacer · `Cancel` · `Save` (primary). In create mode the primary reads `Create <noun>`.
- **Create flow:** `+ New <noun>` opens the same drawer **blank** (no separate screen). Save returns to the list and toasts confirmation.

> Exception worth flagging: Roles' full permission matrix and service-account scopes are tight even in the wide drawer. If they feel cramped in production, promote *only those two* to a full-page editor (breadcrumb drill) and keep everything else in the drawer.

---

## 10. Other navigation patterns (for completeness)

- **Flat list page** (Dashboards): titled header + tagline (or nothing) in row 2; an **in-content** folder rail (this belongs to the page body, it is *not* chrome) + the data table. Row click drills to the item with a breadcrumb.
- **Deep drill module** (Data sources / Ingestion): a **push/pop drill rail** (category list → provider list with a "← All categories" back row) + a leaf card grid. Breadcrumb appears once a provider is chosen.
- **Full-bleed canvas** (Pipelines editor, Dashboard panel editor): the detail needs the whole width, so it **drills to a full page** (not a drawer); breadcrumb replaces tabs and Save/Cancel teleport into the header.
- **Search-first module** (Logs, Traces, Metrics): a tall query bar owns the top directly under the one header; view toggles (List/Scatter, Line/Area) ride an in-content toolbar, **not** a second header row.

---

## 11. Component primitives (CSS contracts)

| Component | Key specs |
|---|---|
| **Button `.btn`** | height 34px (`.sm` 30px), radius 8, 13px/600, border `--border`, bg `--g-0`. `.primary` = `--primary` bg/border, white text, subtle iris shadow. `.ghost` = transparent. `.danger` = danger text, danger-tint hover. `.icon` = 34px square. |
| **Icon button `.iconbtn`** | 28×28, radius 7, `--text-2`, hover `--g-150`. `.danger` hover → danger-tint. |
| **Input `.input` / `.field`** | height 34px, radius 8, border `--border`. Focus: border `--iris-700` + 3px `--iris-300` ring. `.search-lg` = 42px tall for query bars. |
| **Segmented `.seg`** | 2px-padded `--g-100` track; active button = white + `--shadow-1`. For 2–3 view toggles. |
| **Chip `.chip`** | 28px pill, radius 999, border `--border`. `.on` = `--iris-300` bg + `--iris-500` border + `--iris-1100` text. Use for filters/tags; can be a toggle. |
| **Badge `.badge`** | 22px pill, 11px/700. Variants `.ok/.warn/.danger/.info/.neutral` = tint bg + solid fg. Optional leading status `.dot` (7px solid). |
| **Toggle `.toggle`** | 34×20 track, 16px knob; on = `--primary`. |
| **Checkbox `.cbx`** | 16×16, radius 4, 1.5px `--g-400` border; on = `--primary` bg + white check. |
| **Avatar `.avatar-xs`** | 20px circle, iris bg, 9px/700 initials. Larger record avatars 30px (list) / 36–46px (header/drawer). |

---

## 12. Loading & empty states

- **Skeletons** (shimmer): `.skel` = `--g-150` block with a sweeping white-gradient `::after` (1.4s), honoring `prefers-reduced-motion`. Provide table-row, card, and list-row variants matching the real layout's geometry (don't shimmer a generic gray box — mirror the columns/cards). Show during fetch.
- **Empty states**: centered icon tile (56px, `--iris-300`/`--iris-1100`) + 15px title + 12px `--text-3` description + a **primary action** (e.g. "New dashboard") + an optional one-line tip. Distinguish **"nothing yet"** (offer the create action) from **"no matches"** (suggest adjusting the search) — different copy, different affordance.
- Every list/table/chart surface must implement all three states: **ready / loading / empty**.

---

## 13. Overlays — when to use which

| Surface | Use when | Behavior |
|---|---|---|
| **Popover** | Transient, anchored, no decision (menus, the `⋯` row overflow, org switcher) | Anchored to trigger, click-outside closes, no scrim |
| **Drawer** | Editing/viewing one record **in the context of its list** (all IAM/Settings records) | Right slide-in, 460/600px, dim scrim, Esc closes, footer actions |
| **Modal/dialog** | A focused decision or a short create form that must interrupt (delete confirm, import JSON, new folder) | Centered, scrim, Esc/Cancel closes; danger confirms use the danger button |
| **Full page** | The detail needs the whole width (graph editor, panel editor, dashboard view) | Drill with breadcrumb; Save/Cancel in header |

Destructive actions **always** confirm via a modal naming the item and stating irreversibility.

---

## 14. Implementation checklist

1. Define all tokens (§1) as `:root` custom properties; wire `--font-ui/--font-mono`.
2. Apply the **weight scale** (§2.2) and **sentence case** (§2.4) globally — this alone removes most of the "too bold / shouty" feel.
3. Build the **Framed shell** (§5): single tinted L-frame + nested white content card.
4. Implement the **one-header** component (§6) with the row-2 rule enforced (tabs XOR breadcrumb XOR tagline).
5. Build the **data table** (§8) with sticky header, the column-width strategy, and the minimal hover-revealed action column.
6. Build the shared **admin shell** (§9) and render **both IAM and Settings** from it (rail → table/form → drawer).
7. Add **loading skeletons + empty states** (§12) to every list/table/chart.
8. Standardize **overlays** (§13) and the redundant-icon rule (§3).

---

*Generated from the `prototype/` reference build. When a value here disagrees with the prototype CSS, the prototype CSS (`prototype/styles.css`) is the source of truth.*
