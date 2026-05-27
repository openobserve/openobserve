# OpenObserve UI Polish Plan
**Target:** Production-grade observability UI (Datadog / Sentry / Grafana feel)  
**Constraint:** 2 days, no breaking changes, merge in small incremental PRs  
**Status:** Analysis complete — ready to execute

---

## The Honest Assessment

Looking at the screenshots against Datadog/Sentry, here is exactly what makes ours look unpolished:

1. **Every page has a different "shape"** — Logs has no title and jumps to a tab bar; RUM has a large "Performance Summary" h2; Metrics has "Metrics" on the same line as action buttons; Pipelines/Dashboards look clean and consistent with each other but different from everything else.

2. **The toolbar height mix is broken** — `OButton size="md"` is 40px, `OInput/OSelect size="md"` is 32px. When they sit side by side (every single filter bar in the app), buttons look bloated and inputs look sunken. This single fix makes 60% of pages look immediately more professional.

3. **Icon buttons in the header are just floating** — No grouping, inconsistent spacing, the "Edition: Enterprise" badge clashes visually with the purple sparkle icon next to it.

4. **Status badges in tables are inconsistent** — Pipelines shows "scheduled"/"realtime" as plain text. Alerts shows "Ready" as a proper green badge. Streams shows "logs" type as a raw blue link color. Pick one treatment for all tables.

5. **Empty states are placeholder text** — "No Data", "No traces found. Please adjust the filters and try again." These are functional but feel like developer defaults.

6. **Action columns in tables are inconsistent** — Streams has 3 icons (🔍 📄 🗑️). Alerts has 5 icons (⏸ ✏️ ⬜ 🗑️ ⋮). Dashboards has 3 icons (📁 ⬜ 🗑️). Different sizes, different colors, no consistent density.

7. **The home page stat cards have random icon colors** — Blue, teal, orange, green, grey squared icon containers that look like they were each chosen by a different developer.

8. **"Records per page" is a native browser select** — In the bottom footer of every table, the page size control falls back to the OS native dropdown. Everything else in the app uses OSelect.

9. **Two parallel color systems** — `--o2-*` tokens (old Quasar era) and `--color-*` tokens (new system) are both active. Components using different systems look subtly different in dark mode.

10. **The body has a gradient background** — `linear-gradient(to bottom right, var(--o2-body-primary-bg), var(--o2-body-secondary-bg))`. Datadog, Sentry, Grafana all use flat `#f9fafb` or `#ffffff`. The gradient makes the app look like a SaaS landing page, not a data tool.

---

## Design Principles (The Target Look)

### Voice: "Quiet Authority"
The tool should feel like it's in control. No decorative gradients, no colored hero sections. Dense, readable, every pixel is data.

### Rules that Datadog/Grafana follow that we don't:
- Flat white/grey backgrounds. No gradients on content areas.
- One primary action per toolbar, maximum. Everything else is secondary or ghost.
- Tables have no decorative color — data color (e.g. link blue on names) is a navigation affordance only.
- Status is always a badge. Never plain text.
- Consistent icon density: one icon set, one size per context.
- Page titles are always in the same position and same visual weight.
- Toolbars always the same height (36px controls = `h-9`).

---

## Part 1: Token & Foundation Fixes

### 1.1 Unify Control Heights — The Most Impactful Change

**Current state:**
```
OButton size="sm"  → h-9  (36px)   ← used in toolbars
OButton size="md"  → h-10 (40px)   ← used in dialogs/forms
OInput  size="md"  → h-8  (32px)   ← used everywhere
OSelect size="md"  → h-8  (32px)   ← used everywhere
```

**The problem:** `OButton sm` (36px) next to `OInput md` (32px) = 4px misaligned. Users see buttons that are "too tall."

**Fix:** Raise `OInput` and `OSelect` `size="md"` from `h-8` to `h-9`.

```diff
// web/src/lib/forms/Input/OInput.vue  (~line 205)
const heightClasses = {
-  sm: "tw:h-8",
-  md: "tw:h-8",
+  sm: "tw:h-8",      // dense panels, config sidebars only
+  md: "tw:h-9",      // standard toolbar/form usage
}

// web/src/lib/forms/Select/OSelect.vue  (~line 637)
const heightClasses = {
-  sm: "tw:h-8 tw:text-sm",
-  md: "tw:h-8 tw:text-sm",
+  sm: "tw:h-8 tw:text-sm",
+  md: "tw:h-9 tw:text-sm",
}
```

**The rule going forward:**
| Context | Button size | Input/Select size | Expected height |
|---------|-------------|-------------------|-----------------|
| Page toolbar / filter row | `sm` | `md` | 36px — aligned |
| Dialog form | `md` | `md` | button 40px, input 36px — acceptable in forms |
| Dense sidebar panel | `sm` | `sm` | 32px both |
| Compact chip/query builder | `chip` | N/A | 24px |

---

### 1.2 Stop the Body Gradient

**Current (`app.scss` ~line 37):**
```scss
body {
  background: linear-gradient(to bottom right, var(--o2-body-primary-bg), var(--o2-body-secondary-bg));
}
```

**Fix:**
```scss
body {
  background: var(--color-surface-base);  /* flat white light / flat #0a0a0a dark */
}
```

The gradient is invisible in most views anyway (content covers it) but shows through when panels are loading or when the right panel is narrow. A flat background makes it look like a real tool.

---

### 1.3 Fix the CSS Variable Bug in MenuLink (Silent Rendering Failure)

In `web/src/components/MenuLink.vue`, the active state `::before` indicator has:

```scss
/* BROKEN — CSS property without var() wrapper, renders as nothing */
background: --o2-menu-gradient-start;
```

Should be:
```scss
background: var(--o2-menu-gradient-start);
```

This means the left-edge indicator on active sidebar items is silently invisible or falls back to transparent.

---

### 1.4 Replace `--o2-*` Tokens in ONavbar Template

`ONavbar.vue` uses old tokens inline in the template class string:
```html
class="... tw:bg-[var(--o2-card-bg)] tw:shadow-[0_0_5px_1px_var(--o2-hover-shadow)] ..."
```

Replace with new semantic tokens:
```html
class="... tw:bg-surface-panel tw:shadow-sm ..."
```

`--o2-card-bg` → `--color-surface-panel`  
`--o2-hover-shadow` → `--shadow-sm` (already a token)

---

## Part 2: Page Shell Standard

Every page in the app must follow the same visual structure. This is the single biggest thing that makes Datadog feel cohesive.

### 2.1 The Standard Page Shell

```
┌──────────────────────────────────────────────────────┐
│ [h1 Page Title]                   [Primary Action]   │  ← Page header  (px-4 py-3, border-b)
├──────────────────────────────────────────────────────┤
│ [Filter1] [Filter2] [Search...]   [Secondary Action] │  ← Toolbar row  (px-4 py-2, border-b, h-12 total)
├──────────────────────────────────────────────────────┤
│                                                      │
│   Content area                                       │  ← Main content (flex-1, overflow-y-auto)
│                                                      │
├──────────────────────────────────────────────────────┤
│ N items            Showing 1-20 of N  [20 ▾] [< >]  │  ← Footer row (px-4 py-2, border-t)
└──────────────────────────────────────────────────────┘
```

### 2.2 What `OPageHeader` Component Should Look Like

```vue
<!-- web/src/lib/core/PageHeader/OPageHeader.vue -->
<template>
  <header class="tw:flex tw:items-center tw:justify-between tw:px-4 tw:py-3 tw:border-b tw:border-border-default tw:bg-surface-base tw:shrink-0">
    <div class="tw:flex tw:items-center tw:gap-2">
      <slot name="breadcrumbs" />
      <h1 class="tw:text-base tw:font-semibold tw:text-text-primary tw:leading-none">
        <slot name="title" />
      </h1>
      <slot name="subtitle" />
    </div>
    <div class="tw:flex tw:items-center tw:gap-2">
      <slot name="actions" />
    </div>
  </header>
</template>
```

**Title font size: `text-base` (14px), `font-semibold`** — NOT `text-xl` or `text-2xl`. Look at Datadog: page titles are barely larger than body text. The screen real estate belongs to data, not to the word "Dashboards".

Compare:
- Our RUM page: "Performance Summary" as `text-xl` — enormous, takes 40px of vertical space
- Datadog equivalent: small, quiet, in the top rail — never dominates the content

### 2.3 Pages That Currently Violate the Shell

| Page | Current Problem | Fix |
|------|----------------|-----|
| **Logs** | No title at all. Jumps straight to search tabs | Add "Logs" title in the toolbar area left side |
| **Traces** | No title. Jumps to Spans/Traces/Service Graph tabs | Add "Traces" title |
| **Metrics** | "Metrics" h2 shares a row with "Syntax Guide" buttons | Move to page header area, demote to text-base |
| **RUM** | "Performance Summary" is h2-level at text-xl | Downsize to text-base font-semibold |
| **Home** | No consistent shell — just floating cards | Acceptable as-is (dashboard view) |
| **Pipelines** | ✅ Already correct structure | — |
| **Dashboards** | ✅ Already correct structure | — |
| **Streams** | ✅ Already correct structure | — |
| **Alerts** | ✅ Already correct structure | — |

---

## Part 3: Toolbar / Filter Row Standard

### 3.1 The Rule

Every toolbar that contains filters + actions must follow this anatomy:

```
[toggle-group?] [input?] [selects?]    →    [secondary buttons] [primary button]
LEFT: filters                               RIGHT: actions
```

- Total toolbar height: `h-12` (48px) containing `h-9` (36px) controls with auto vertical centering
- Internal padding: `px-4` sides, `gap-2` between controls
- Separator: `border-b border-border-default`
- Background: same as page (`bg-surface-base`), NOT a different shade

### 3.2 Filter Pattern Inconsistencies (from screenshots)

**Logs toolbar:**
```
[Search] [Timechart] [Visualize] [Patterns] [🔄] [··· More]    [Past 15 Min ▾] [Cancel query ▾+] [🔄] [share] [⚙]
```
Problems:
- "Search/Timechart/Visualize/Patterns" are view-mode tabs, not filters — should use `OTabs`, not toolbar buttons
- The refresh (🔄), share, and settings icons on the right have no visual grouping
- "Cancel query" is a red filled button (high urgency) but sits next to low-urgency icon buttons — everything looks "equally urgent"

**Fix anatomy:**
```
[OTabs: Search | Timechart | Visualize | Patterns | More]      [Past 15 Min ▾] [🔄] [share] [⚙] [Cancel query]
```
Move "Cancel query" to far right as the only filled destructive button. Right-side icon group gets a subtle divider before it.

**Metrics toolbar:**
```
Metrics  [Syntax Guide] [Legend]         [Past 15 Min ▾] [Off ▾]  [Run query]  →  [Add To Dashboard]
```
Problems:
- "Syntax Guide" and "Legend" are outline buttons but act as toggles/modals — should use ghost or outline consistently
- "Add To Dashboard" is a filled teal button floating in the right panel area (not in the main toolbar)
- The page title "Metrics" is on the same row as these buttons

**Fix:** "Syntax Guide" → ghost button with doc icon. "Legend" → ghost button with chart icon. Separate the main toolbar from the query panel actions.

**Traces toolbar:**
```
[Spans] [Traces] [Service Graph] [Service Catalog]  [toggle] [bar] [toggle] [clock] [clock]   [Past 15 Min ▾] [▶ Run query] [▾] [⬇] [share]
```
Problems:
- "Spans/Traces/Service Graph/Service Catalog" = view tabs (use OTabs)
- The 5 toggle/mode icons in the middle are unexplained — no labels, no grouping
- The "Run query" button is `size="sm"` (blue-ish) but "Add To Dashboard" in Metrics is `size="md"` (teal) — different sizes for the same CTA concept

### 3.3 Action Icon Groups in Toolbars

When you have a cluster of icon-only utility buttons (refresh, share, settings, download), wrap them in a visual group:

```vue
<!-- Use OButtonGroup for icon clusters -->
<OButtonGroup>
  <OButton variant="ghost" size="icon-sm" icon="refresh" />
  <OButton variant="ghost" size="icon-sm" icon="share" />
  <OButton variant="ghost" size="icon-sm" icon="settings" />
</OButtonGroup>
```

This gives them a shared border and makes them read as "one thing" not "three separate things."

---

## Part 4: Table Standard

Tables in Pipelines, Dashboards, Streams, Alerts — these look the most consistent already. But there are some issues:

### 4.1 Status Badges Must Always Be Badges

| Column | Current | Should Be |
|--------|---------|-----------|
| Pipelines → Type | `scheduled` (plain text) | `<OBadge variant="soft" color="default">scheduled</OBadge>` |
| Pipelines → Type | `realtime` (plain text) | `<OBadge variant="soft" color="primary">realtime</OBadge>` |
| Alerts → Status | `Ready` (green badge ✅) | ✅ Already correct |
| Streams → Type | `logs` (primary blue text) | `<OBadge variant="outline" color="info">logs</OBadge>` |

The rule: **any categorical column value that represents a state, type, or status must use `OBadge`.** Never color raw text to indicate type — that's using link-color semantics for non-link data.

### 4.2 Action Column Standard

Pick **one consistent pattern** for table action columns across all pages:

**Recommendation — context action menu approach (what Datadog does):**
```
Column: Actions
Content: [primary-icon-1] [primary-icon-2] [⋮ more]
```

- Maximum 2 direct icon buttons for the most common actions
- Everything else goes in the `⋮` dropdown
- All action icon buttons must be `size="icon-sm"` (h-9 w-9) `variant="ghost-muted"`
- The delete/destructive action goes **last** in the `⋮` menu, never as a standalone red button in the row

Current inconsistencies:
- Streams: 3 standalone icons, trash is red → move trash to dropdown, max 2 direct actions  
- Alerts: 5 standalone icons → reduce to 2 direct + ⋮ menu
- Dashboards: 3 standalone icons, trash is red → same fix

### 4.3 Footer / Pagination Row

The "Records per page" control at the bottom of every table currently uses an unstyled native `<select>`. Replace with `OSelect`:

```vue
<!-- Currently (native select - looks wrong): -->
<select v-model="perPage">
  <option>20</option>
  <option>50</option>
</select>

<!-- Should be: -->
<OSelect v-model="perPage" size="sm" :options="[20, 50, 100]" style="width: 70px" />
```

Footer layout standard:
```
[N items text]               [Showing X-Y of N]  [OSelect perPage]  [OPagination]
text-sm text-text-secondary      text-sm              w-[70px]           always
```

---

## Part 5: Home Page Stat Cards

### 5.1 Icon Container Colors Are Random

From the screenshot, the stat card icon containers are:
- Streams: teal/blue square `<>`
- Events: grey-blue bar chart
- Ingested Size: orange upload
- Compressed Size: teal +
- Index Size: grey table

These colors have no semantic meaning — they're just visual decoration chosen per-card. This is what makes it look "built by interns." Datadog's summary cards use one of two approaches: monochrome icons (all grey or all brand-color) or semantic icons (green for success, red for error, yellow for warning).

**Fix:** Make all stat card icon containers the same color: `bg-primary-100 text-primary-600` (light mode) / `bg-primary-900 text-primary-400` (dark mode). This immediately looks intentional.

```vue
<!-- Each stat card icon wrapper: -->
<div class="tw:rounded-lg tw:p-2 tw:bg-primary-100 tw:text-primary-600">
  <OIcon :name="icon" size="md" />
</div>
```

### 5.2 Section Cards (Functions, Alerts, Pipelines) Have Inconsistent Title Rows

From the screenshot:
- Functions tile: icon (orange f(x) rounded square) + "Functions" + "→" arrow
- Alerts tile: triangle warning icon (yellow outlined) + "Alerts" + "→"  
- Pipelines tile: pink share icon + "Pipelines" + "→"

The icons are different styles (one filled rounded square, one outlined, one colored SVG). Make them consistent: all use `OIcon` with the same size (`size="md"`) and the same color (`text-text-secondary` or `text-primary-600`).

---

## Part 6: Typography Discipline

### 6.1 The Scale (Already Defined, Just Not Used Consistently)

| Use case | Tag/class | font-size | font-weight |
|----------|-----------|-----------|-------------|
| Page title | `<h1>` | 14px (text-base) | semibold |
| Section title | `<h2>` | 13px (text-sm) | semibold |
| Card/panel title | `<h3>` / `<h4>` | 12px (text-xs) | medium |
| Body / table cells | `<p>` / `<span>` | 13px (text-sm) | normal |
| Labels above inputs | `.o-input-label` | 12px | semibold |
| Metadata / timestamps | `<small>` | 11px (text-xs) | normal, text-secondary |
| Monospace (code, IDs) | `<code>` | 12px | normal, font-mono |

**The key principle:** Page titles in production tools (Datadog, Grafana, Sentry) are NOT large. "Dashboards" at `text-xl` wastes space. At `text-base font-semibold` it looks precise and intentional.

### 6.2 The RUM Page Problem

```
"Performance Summary"   ← currently h2 = text-xl (20px) font-semibold  
"Overview | Web Vitals | Errors | API"  ← OTabs below it
```

In the screenshot, "Performance Summary" is enormous relative to the content beneath it. Compare with Datadog's RUM view — the page title is small, the tabs are prominent, and the data is the hero.

Fix: Downsize the page title to `text-base font-semibold` in the page header rail.

### 6.3 Stop Using `text-xl` and `text-2xl` for Page Headings

In `app.scss`, h1 = `--text-2xl` and h2 = `--text-xl`. This definition is correct for long-form content (marketing, docs). For a utility tool, use `text-base` or `text-sm` in the header rail. Either:
- Don't use `<h1>`/`<h2>` for page titles — use a `<span>` with utility classes
- OR change the semantic level — use `<h4>` for page titles (which maps to `text-md`)

---

## Part 7: Navigation Sidebar

### 7.1 Current State (from screenshots)
The sidebar shows: icon + label stacked vertically per item. Active item gets a slightly different background. Items like Home, Logs, Metrics, Traces, RUM, Pipelines, Dashboards, Streams, Reports, Alerts, Incidents, Data sources, IAM.

### 7.2 Issues Visible in Screenshots

**Icon inconsistency:** Icons use different visual weights:
- "Home" = house (outlined)
- "Logs" = lines (outlined)
- "Metrics" = bar chart (outlined)
- "Traces" = scatter? (outlined)
- "RUM" = screen/display (different style)
- "Dashboards" = grid (filled-looking?)
- "Streams" = some icon
- "Reports" = paper (outlined)
- "Alerts" = bell (outlined)
- "Incidents" = warning triangle (outlined)
- "Data sources" = database-ish
- "IAM" = person group

The visual weight (stroke thickness) and style (filled vs outlined) varies per icon. **Use one icon set, one weight, throughout.** If using Material Symbols Outlined, every icon should be the same optical size and weight.

**Active state:** The active item's background in light mode appears to be a light gradient or solid. The CSS has a `linear-gradient` for the active state in MenuLink. Compare screenshots — "Home" active has a blue/teal left border + gradient bg, while the active state in some screenshots just shows blue text. This should be:

```scss
/* Active sidebar item — simple, clear */
.nav-menu-item--active {
  background: var(--color-primary-100);   /* subtle blue tint */
  color: var(--color-primary-700);
  font-weight: var(--font-semibold);
  
  /* Left accent bar */
  border-left: 3px solid var(--color-primary-600);
  
  /* Remove the gradient — it's excessive */
}

.body--dark .nav-menu-item--active {
  background: var(--color-primary-900);
  color: var(--color-primary-300);
}
```

**Remove the gradient on the active sidebar item.** It's noisy. All good tools use a flat background tint + left border line.

### 7.3 Icon Color in Active State

Currently: `style: '#ffffff' (dark mode), '#19191e' (light mode)` — hardcoded hex.

Replace with:
```vue
:style="isActive ? { color: 'var(--color-primary-600)' } : undefined"
```

Light mode active: icon is primary-600 (same teal). Dark mode active: icon inherits from the CSS active class (`--color-primary-300`).

---

## Part 8: Header Bar

### 8.1 The "Edition: Enterprise" Badge

From the screenshot: a teal rectangular badge with white text "Edition: Enterprise" followed immediately by a sparkle/star icon in purple/pink. These two elements clash visually and make the header feel cluttered.

**Fix:**
- Move "Edition: Enterprise" to a less prominent position (maybe the user dropdown area or a subtitle beneath the org name)
- OR reduce to a simple `OBadge variant="soft" color="primary"` with smaller text
- The sparkle icon (AI feature) should have more visual separation from the edition badge

### 8.2 Right Side Icon Cluster

From the screenshot: `[sun icon] [grid icon] [? icon] [settings icon] [user icon]` — all floating individually.

**Fix:** Group them visually:
```
[sun]  [grid]  ←  separator  →  [?]  [settings]  [user circle]
```
- Theme toggle (sun) and app launcher (grid) are one group
- Help (?), settings, and user are another group  
- Separator = `<OSeparator vertical />`
- All icons: `size="icon-sm"` `variant="ghost-muted"` — same size, same variant

---

## Part 9: Empty States

### 9.1 The Pattern (to be consistent everywhere)

Every empty state should follow this layout:

```
        [icon: 32px, text-text-secondary]
        [heading: text-sm font-medium text-text-primary]
        [description: text-sm text-text-secondary, max-w-[280px] text-center]
        [optional: OButton size="sm" variant="primary" — only when there's a clear action]
```

### 9.2 Current Violations

**Traces page empty state:**
```
ⓘ No traces found. Please adjust the filters and try again.
```
Plain inline text. No visual hierarchy. No icon to anchor the eye.

**RUM stat cards:**
```
No Data
```
Just centered text in a bordered box. Looks like a rendering error.

**Fix for stat cards:** Use a consistent "no data" treatment:
```vue
<div class="tw:flex tw:flex-col tw:items-center tw:justify-center tw:gap-1 tw:py-4">
  <span class="tw:text-2xl tw:font-semibold tw:text-text-secondary">—</span>
  <span class="tw:text-xs tw:text-text-secondary">No data</span>
</div>
```

An em-dash (`—`) as the value placeholder reads as intentional, not broken. This is what Datadog and Grafana use.

### 9.3 Create `OEmptyState` Component

```vue
<!-- web/src/lib/feedback/EmptyState/OEmptyState.vue -->
<template>
  <div class="tw:flex tw:flex-col tw:items-center tw:justify-center tw:gap-3 tw:py-12 tw:px-6 tw:text-center">
    <div class="tw:text-text-secondary">
      <OIcon :name="icon || 'inbox-outline'" size="xl" />
    </div>
    <div class="tw:flex tw:flex-col tw:gap-1">
      <p class="tw:text-sm tw:font-medium tw:text-text-primary">{{ title }}</p>
      <p v-if="description" class="tw:text-sm tw:text-text-secondary tw:max-w-[320px]">
        {{ description }}
      </p>
    </div>
    <slot name="action" />
  </div>
</template>
```

Usage:
```vue
<!-- Traces no results -->
<OEmptyState
  icon="trace-outline"
  title="No traces found"
  description="Try adjusting your time range or filters."
>
  <template #action>
    <OButton size="sm" variant="ghost" @click="resetFilters">Reset filters</OButton>
  </template>
</OEmptyState>
```

---

## Part 10: Loading States

### 10.1 The Decision Matrix

| Scenario | Use | Why |
|----------|-----|-----|
| Initial full-page load | `OSkeleton` | User sees structure before data |
| Table/list reload (new filters applied) | `OInnerLoading` over the table | Keeps context, shows activity |
| Button click action (save, submit) | `OButton loading prop` | Inline feedback at the action |
| Small data widget reload | `OSpinner size="sm"` centered in widget | Too small for skeleton |
| Background sync | Nothing | Don't interrupt the user |

### 10.2 The "Loading..." Text Bug in Logs

From the Logs screenshot:
```
timestamp (Asia/Calcutta)    source
⟳ Loading...
```

The results table shows "Loading..." as plain text next to a CSS spinner. This should be `<OInnerLoading :showing="loading" />` placed over the table area.

---

## Part 11: Color Usage Rules

### 11.1 Stop Using Primary Color for Non-Interactive Text

From the Alerts screenshot: "10 Mins" in the "Check every" column is rendered in the primary blue. This communicates "this is a link" — but it's not. The user can't click it.

**Rule:** Primary color text = always interactive (link, button). Data values in tables = `text-text-primary` (default) or `text-text-secondary` (metadata).

Exceptions:
- Stream names in Logs/Streams → primary color OK (they're clickable links)
- Dashboard names → primary color OK (they open the dashboard)
- Values like "10 Mins", "5 Mins", "logs", "scheduled" → NO primary color

### 11.2 Consolidate the Two Token Systems

There are two color systems running in parallel:

| Old (`--o2-*`) | New (`--color-*`) | Files still using old |
|----------------|-------------------|-----------------------|
| `--o2-card-bg` | `--color-surface-panel` | ONavbar, MainLayout, app.scss |
| `--o2-border-color` | `--color-border-default` | UsageTab, many views |
| `--o2-text-body` | `--color-text-primary` | app.scss body |
| `--o2-hover-shadow` | `--shadow-sm` | ONavbar, card-container |
| `--o2-primary-btn-bg` | `--color-button-primary` | MainLayout, MenuLink |
| `--o2-text-link` | `--color-primary-600` | app.scss |

**Migration approach:** Don't do it all at once. For each file that gets touched for another reason, also migrate its `--o2-*` references to `--color-*`. Never open a file just to do this — too risky.

**The bridge to add to `_variables.scss`** (so both systems work in sync — this is a zero-risk addition):
```css
/* Sync old --o2-* tokens to new --color-* system */
/* Add at bottom of _variables.scss light mode block: */
:root {
  --o2-card-bg: var(--color-surface-panel);
  --o2-border-color: var(--color-border-default);
  --o2-hover-shadow: var(--shadow-sm);
}
/* And in .body--dark: */
.body--dark {
  --o2-card-bg: var(--color-surface-panel);
  --o2-border-color: var(--color-border-default);
}
```

This makes both systems reference the same underlying values — dark mode becomes consistent instantly.

---

## Part 12: Specific Component Quick Fixes

### 12.1 OButton — Remove `!important` Overrides from Preview Variants

These variants use `!important` to override the size system:
```
preview-slack:  tw:!rounded tw:!text-sm tw:!h-auto tw:!py-2 tw:!px-3
preview-teams:  tw:!rounded tw:!h-auto tw:!py-2 tw:!px-4
preview-email:  tw:!rounded tw:!h-auto tw:!py-3 tw:!px-6
preview-action: tw:!rounded tw:!h-auto tw:!py-2 tw:!px-3 tw:!text-sm
webinar-dismiss: tw:!h-auto tw:!p-0
pricing-chip:   tw:!rounded-[20px] tw:!text-xs tw:!font-medium tw:!h-auto tw:!py-[5px] tw:!px-[14px]
```

These variants are context-specific (they only belong in their specific components). They should not be in `OButton` at all.

**Migration plan (non-breaking):**
1. Keep the variants in OButton for now (don't break existing usage)
2. Create scoped `<style>` in each parent component with the specific button styling
3. After migration, deprecate the preview-* and webinar-dismiss variants

### 12.2 OSelect — The "Records per Page" Control

The table footer pagination control at the bottom of every list page uses a native `<select>` for "Records per page." This is visually inconsistent with everything else on the page.

Identify the component that renders this (likely a shared table footer component or inline in each view) and replace with:
```vue
<OSelect
  v-model="perPage"
  size="sm"
  :options="[{label: '20', value: 20}, {label: '50', value: 50}, {label: '100', value: 100}]"
  class="tw:w-[80px]"
/>
```

### 12.3 Quasar Leftovers in AppAlerts.vue

```scss
/* In AppAlerts.vue scoped styles — Quasar SCSS variables */
background-color: $accent;   /* Quasar token — becomes pink/red */
color: black;                /* Literal — breaks in dark mode */
```

Replace with:
```scss
background-color: var(--color-primary-600);
color: var(--color-text-inverse);
```

---

## Part 13: The Spacing System

Stop using `tw:[0.625rem]`, `tw:[1.875rem]`, `tw:[1.625rem]` etc.

The spacing token system exists:
```
--spacing-3  = 0.75rem  (12px)
--spacing-4  = 1rem     (16px)
--spacing-5  = 1.25rem  (20px)
--spacing-6  = 1.5rem   (24px)
--spacing-8  = 2rem     (32px)
--spacing-10 = 2.5rem   (40px)
```

For Tailwind, these map to: `tw:p-3` = 12px, `tw:p-4` = 16px, `tw:p-5` = 20px, `tw:p-6` = 24px.

Arbitrary values that appear regularly that should be replaced:
- `[0.625rem]` (10px) → use `tw:p-2.5` or round to `tw:p-3` (12px)
- `[1.875rem]` (30px) → for button heights use `h-[1.875rem]` → still fine as an exception for sm-toolbar
- `[1.625rem]` (26px) → for icon-panel size → still fine as a component-internal exception

**Rule:** Arbitrary values are OK inside component files (they're internal implementation details). They are NOT OK in page-level layout (views, layouts). Page-level spacing must use Tailwind scale classes or CSS spacing tokens.

---

## Part 14: The `OFilterBar` Component (New)

A reusable filter toolbar wrapper for list/table pages. Solves the ad-hoc spacing problem.

```vue
<!-- web/src/lib/core/FilterBar/OFilterBar.vue -->
<template>
  <div class="tw:flex tw:items-center tw:justify-between tw:gap-2 tw:px-4 tw:h-12 tw:shrink-0 tw:border-b tw:border-border-default tw:bg-surface-base">
    <div class="tw:flex tw:items-center tw:gap-2 tw:min-w-0">
      <slot />               <!-- left: toggle group, selects, search -->
    </div>
    <div class="tw:flex tw:items-center tw:gap-2 tw:shrink-0">
      <slot name="actions" />  <!-- right: import, new, etc. -->
    </div>
  </div>
</template>
```

Usage (replaces the ad-hoc div in every list page):
```vue
<OFilterBar>
  <OToggleGroup v-model="filter" :options="filterOptions" />
  <OInput v-model="search" placeholder="Search..." size="md" clearable />
  <template #actions>
    <OButton variant="outline" size="sm" icon="import">Import</OButton>
    <OButton variant="primary" size="sm" icon="plus">New alert</OButton>
  </template>
</OFilterBar>
```

---

## Execution Roadmap (2 Days)

### Day 1 — Foundation + Core Components

| # | Change | File(s) | Risk | Time |
|---|--------|---------|------|------|
| 1 | Fix input/select height: `md` → `h-9` | `OInput.vue`, `OSelect.vue` | Low | 30min |
| 2 | Fix CSS variable bug (`--o2-menu-gradient-start`) | `MenuLink.vue` | Zero | 5min |
| 3 | Replace `--o2-*` tokens in ONavbar template | `ONavbar.vue` | Low | 15min |
| 4 | Remove gradient from `body` | `app.scss` | Low | 5min |
| 5 | Create `OEmptyState` component | new file | Zero | 1.5h |
| 6 | Create `OFilterBar` component | new file | Zero | 1h |
| 7 | Create `OPageHeader` component | new file | Zero | 1h |
| 8 | Sync `--o2-*` to `--color-*` bridge in `_variables.scss` | `_variables.scss` | Low | 30min |
| 9 | Apply `OPageHeader` to Alerts, Streams, Dashboards, Pipelines | 4 view files | Medium | 2h |

### Day 2 — Polish + Consistency Pass

| # | Change | File(s) | Risk | Time |
|---|--------|---------|------|------|
| 10 | Status badges: wrap type columns in `OBadge` | Pipelines, Streams table components | Medium | 2h |
| 11 | Reduce action columns to 2 direct + ⋮ menu | Streams, Alerts, Dashboards | Medium | 3h |
| 12 | Apply `OEmptyState` to Traces, Logs empty result | Traces, Logs components | Medium | 1h |
| 13 | Replace native `<select>` in table footers with `OSelect` | Shared table footer or per-view | Medium | 1.5h |
| 14 | Sidebar: flatten active state gradient to token bg + left border | `MenuLink.vue` | Medium | 30min |
| 15 | Sidebar: unify icon color on active | `MenuLink.vue` | Low | 15min |
| 16 | Header: group right-side icons with visual separator | `Header.vue` | Low | 30min |
| 17 | Fix non-interactive blue text in table cells (Alerts "10 Mins" etc.) | Per-view | Medium | 1h |
| 18 | Home page: unify stat card icon container colors | Home view | Low | 30min |

### Day 3+ (Defer, don't rush)

- Apply `OPageHeader` to Logs, Traces, Metrics, RUM
- Extract feature-specific button variants from `OButton`
- Full `--o2-*` → `--color-*` migration
- Downsize RUM page title from `text-xl` to `text-base`

---

## What NOT to Change (Stability Guard)

- `OButton` size scale — it's referenced in 299+ files. Add sizes, don't remove or rename.
- `OTabs` structure — used in 95 files. Any change needs a full visual regression pass.
- `OPagination` — it's already correct. Don't touch it.
- `OSeparator` — 255 instances, already correct.
- The `prefix(tw)` Tailwind prefix — changing it would require updating every class in every file.
- The token file import order: `base → semantic → component → dark` — this cascade must stay intact.
- `OInnerLoading` — it's clean and correct. Just use it more.

---

## The Litmus Test

After these changes, open any page in the app and ask:

1. **Does the page have a title?** (If no: fix it)
2. **Are all controls in the toolbar the same height?** (If no: size mismatch)
3. **Do buttons and inputs align vertically when side by side?** (If no: height not fixed)
4. **Is every categorical value in a table a badge?** (If no: plain text for type/status)
5. **Are there more than 2 icon buttons in an action column?** (If yes: need a ⋮ menu)
6. **Is any status/type shown as primary-colored plain text?** (If yes: wrong semantics)
7. **Is there a loading state when content is fetching?** (If no: add OInnerLoading)
8. **Is there an empty state with an icon when results are zero?** (If no: add OEmptyState)

Pages that pass all 8 checks will look production-grade. Datadog passes all 8 on every single view.

---

## Part 15: Typography Components

### 15.1 The Problem This Solves

Across the codebase, the same visual pattern is expressed 15 different ways:

```vue
<!-- All of these are trying to be "secondary metadata text" -->
<span class="tw:text-xs tw:text-text-secondary">Last updated 2h ago</span>
<span class="text-caption text-grey-7">Last updated 2h ago</span>
<small style="color: var(--o2-text-caption)">Last updated 2h ago</small>
<p class="tw:text-xs tw:opacity-60">Last updated 2h ago</p>
```

This means: if the design changes "metadata text" from 12px to 11px, or from `text-secondary` to a new token, you have to hunt through the entire codebase. And you'll miss half of them.

`OText` and `OCode` solve this by making typography intent explicit.

---

### 15.2 `OText` — Polymorphic Text Component

**Location:** `web/src/lib/core/Typography/OText.vue`

#### Variants

| Variant | Size | Weight | Color | Default Element |
|---------|------|--------|-------|-----------------|
| `page-title` | 14px | semibold | `text-primary` | `<span>` (use `as="h1"`) |
| `section` | 12px | semibold + uppercase + tracking-wide | `text-secondary` | `<h2>` |
| `panel-title` | 12px | medium | `text-primary` | `<h3>` |
| `body` | 14px | normal | `text-primary` | `<p>` |
| `body-strong` | 14px | semibold | `text-primary` | `<strong>` |
| `label` | 12px | semibold | `text-primary` | `<span>` |
| `meta` | 12px | normal | `text-secondary` | `<span>` |
| `mono` | 12px | normal IBM Plex Mono | `text-primary` | `<span>` |

#### Usage

```vue
<!-- Page header title — ONE per page -->
<OText variant="page-title" as="h1">Dashboards</OText>

<!-- Section group label above a content block -->
<OText variant="section">Web Vitals</OText>

<!-- Card or panel title -->
<OText variant="panel-title">Label Filters</OText>

<!-- Default body text -->
<OText>This pipeline processes realtime log events.</OText>

<!-- Emphasized inline text -->
<OText variant="body-strong">286 streams</OText>

<!-- Form-adjacent label (not inside OInput) -->
<OText variant="label">Stream type</OText>

<!-- Timestamp / metadata -->
<OText variant="meta">Last updated 2026-05-26T15:15:44</OText>

<!-- Monospace — cron expression, field name, non-linked stream ID -->
<OText variant="mono">0 */5 * * *</OText>

<!-- Truncate long values in table cells -->
<OText variant="meta" truncate>automation@tester.ai</OText>

<!-- nowrap for single-line labels -->
<OText variant="label" nowrap>Records per page</OText>
```

#### What to Replace

| Old pattern | Replace with |
|-------------|--------------|
| `<span class="tw:text-xs tw:text-text-secondary">` | `<OText variant="meta">` |
| `<span class="tw:text-sm tw:font-semibold">` | `<OText variant="body-strong">` |
| `<h2 class="tw:text-xl tw:font-semibold">` page titles | `<OText variant="page-title" as="h1">` |
| `<span class="text-caption text-grey-7">` (Quasar) | `<OText variant="meta">` |
| `<small style="color: ...">` | `<OText variant="meta">` |
| `<p class="tw:text-xs ...">` helper text | `<OText variant="meta">` |
| `<span class="tw:text-xs tw:font-mono ...">` | `<OText variant="mono">` or `<OCode>` |
| Section headers like `<div class="text-subtitle2">` | `<OText variant="section">` |

---

### 15.3 `OCode` — Monospace Code Display

**Location:** `web/src/lib/core/Code/OCode.vue`

Used for content that is executable, queryable, or copy-pasteable: SQL, cron expressions, API keys, config values, stream IDs that users may need to copy.

Distinct from `OText variant="mono"` which is for static non-interactive identifiers.

#### Variants

**Inline** (default): subtle bordered pill, wraps in text flow.

```vue
<!-- Cron expression in a table cell -->
<OCode>0 */5 * * *</OCode>

<!-- Copyable stream ID -->
<OCode copyable>_o2_service_graph</OCode>

<!-- Truncated API key in a narrow column -->
<OCode truncate>sk-proj-abc123...xyz789</OCode>
```

**Block**: full-width scrollable pre-formatted area.

```vue
<!-- SQL snippet in a dialog or config panel -->
<OCode block>
  SELECT timestamp, body, service_name
  FROM default
  WHERE timestamp >= NOW() - INTERVAL 15 MINUTE
  ORDER BY timestamp DESC
</OCode>

<!-- VRL function body with copy button -->
<OCode block copyable>
  .level = upcase(string!(.level))
  .message = del(.body)
</OCode>
```

#### Visual Spec

**Inline:**
```
┌──────────────────┐
│ 0 */5 * * *  [⎘] │  ← border-default bg-surface-subtle rounded px-1 py-px text-xs mono
└──────────────────┘
```

**Block:**
```
┌──────────────────────────────────────┐  [⎘]
│ SELECT timestamp, body               │
│ FROM default                         │
│ WHERE timestamp >= NOW() - ...       │
└──────────────────────────────────────┘
  border-default bg-surface-panel rounded-md px-3 py-2 overflow-x-auto text-xs mono
```

#### What to Replace

| Old pattern | Replace with |
|-------------|--------------|
| `<span class="tw:font-mono tw:text-xs tw:bg-surface-subtle ...">` | `<OCode>` (inline) |
| `<pre class="...">` query/code blocks | `<OCode block>` |
| `<q-badge>` showing a cron string | `<OCode>` |
| Inline `<code>` tags with ad-hoc classes | `<OCode>` |
| Any code block with a copy button built inline | `<OCode block copyable>` |

---

### 15.4 Specific Pages to Fix First (Typography)

#### RUM — "Performance Summary" title is too large

```vue
<!-- Current (too large): -->
<h2 class="tw:text-xl tw:font-semibold">Performance Summary</h2>

<!-- Fix: -->
<OText variant="page-title" as="h1">Performance Summary</OText>
```

#### Traces — "0 Spans Found" counter badge

```vue
<!-- Current: plain text inside a div -->
<div class="badge">0 Spans Found</div>

<!-- Fix: -->
<OBadge variant="soft" color="default">
  <OText variant="label">0 Spans Found</OText>
</OBadge>
```

#### Pipelines — cron expressions in the "Cron" column

```vue
<!-- Current: raw text in table cell -->
<td>0 */5 * * *</td>

<!-- Fix: -->
<td><OCode>0 */5 * * *</OCode></td>
```

#### Alerts — "10 Mins" in "Check every" column (wrong primary color)

```vue
<!-- Current: appears in primary blue (wrong semantics — it's not a link) -->
<span class="tw:text-primary-600">10 Mins</span>

<!-- Fix: default body text color -->
<OText>10 Mins</OText>
```

#### Dashboard/Stream/Alert table footers — "N items" count

```vue
<!-- Current: inconsistent styling -->
<div class="tw:text-sm">968 Dashboards</div>

<!-- Fix: -->
<OText variant="meta">968 Dashboards</OText>
```

#### Logs/Traces — "Search for a field" section headers

```vue
<!-- Current (guessing from code): -->
<div class="field-group-label">Key Fields (5)</div>

<!-- Fix: -->
<OText variant="section">Key Fields (5)</OText>
```

---

### 15.5 Token Reference

Typography tokens are in `component.css` (`:root` block + `@theme inline`):

| Token | Default value | Tailwind class |
|-------|---------------|----------------|
| `--color-typography-page-title` | `--color-text-primary` | `tw:text-typography-page-title` |
| `--color-typography-section` | `--color-text-secondary` | `tw:text-typography-section` |
| `--color-typography-panel-title` | `--color-text-primary` | `tw:text-typography-panel-title` |
| `--color-typography-body` | `--color-text-primary` | `tw:text-typography-body` |
| `--color-typography-label` | `--color-text-primary` | `tw:text-typography-label` |
| `--color-typography-meta` | `--color-text-secondary` | `tw:text-typography-meta` |
| `--color-typography-mono` | `--color-text-primary` | `tw:text-typography-mono` |
| `--color-code-text` | `--color-text-primary` | `tw:text-code-text` |
| `--color-code-bg` | `--color-surface-subtle` | `tw:bg-code-bg` |
| `--color-code-border` | `--color-border-default` | `tw:border-code-border` |
| `--color-code-block-bg` | `--color-surface-panel` | `tw:bg-code-block-bg` |

Dark mode: all typography and code tokens reference semantic tokens (`--color-text-*`, `--color-surface-*`) which are already overridden in `dark.css`. No additional dark mode entries needed.

---

### 15.6 Typography Don'ts

| Don't | Do instead |
|-------|-----------|
| `<h1 class="tw:text-2xl">` for page titles | `<OText variant="page-title" as="h1">` |
| `<span style="color: var(--o2-text-caption)">` | `<OText variant="meta">` |
| `<p class="text-body2">` (Quasar class) | `<OText>` (default body) |
| `<span class="text-subtitle1">` (Quasar class) | `<OText variant="section">` or `variant="panel-title"` |
| `<code class="tw:font-mono ...">` with manual classes | `<OCode>` |
| `<pre>` with manual styling | `<OCode block>` |
| Using `tw:text-xl` / `tw:text-2xl` for page/section titles | Use OText variants (max `text-sm` for utility UI) |
| Making body text `tw:opacity-60` for "secondary" look | Use `variant="meta"` which has the right color token |
