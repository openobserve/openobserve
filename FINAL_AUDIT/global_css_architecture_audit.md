# Global CSS / Styles Architecture — Quasar Removal Audit

## Summary

Audited the global + component-level SCSS/CSS architecture in `web/src/styles/` and `web/src/lib/styles/` after the Quasar Framework removal refactor on the `feat/ux-revamp-main` branch.

Overall verdict: the **Tailwind + O2 token migration is sound at the entry-point level** (Tailwind `@theme` registers all `--color-*` tokens, dark mode flips on `html.dark`). However the legacy SCSS layer still carries **substantial Quasar-era debt**: ~600+ `.q-*` selectors that no longer match any DOM, an entire dark-mode token map gated on a `body--dark` class that is **never set anymore**, a missing `@font-face` for "Nunito Sans" that the CSS still references, and several orphan files.

Counts at a glance:
- 20 SCSS files in `web/src/styles/` (3,708 lines total)
- 5 CSS files in `web/src/lib/styles/` (Tailwind + 4 token layers, well-structured)
- 2 files deleted vs `main`: `quasar-overrides.scss` (615 lines), `quasar-variables.sass` (35 lines)
- 1 file added vs `main`: `_quasar-variables.scss` (52-line compat shim)
- ~151 Quasar (`.q-*`) selectors in `app.scss` alone, ~92 in `logs/logs-page.scss`
- 7 `.body--dark` selectors in `web/src/styles/` plus dozens more in scoped `<style>` blocks — all dormant.

## Files Audited

### Global styles (`web/src/styles/`)

| File | Lines | Imported by | Status |
|---|---|---|---|
| `app.scss` | 2,316 | `layouts/MainLayout.vue:1193`, `views/Login.vue:419` (via `@import`) | Active, but bloated with Quasar leftovers |
| `_variables.scss` | 646 | `vite.config.ts` global prepend (indirect, via `_quasar-variables`? — see below) | Active, but **dark mode block is dead** |
| `_quasar-variables.scss` | 52 | `vite.config.ts:134` `additionalData`, `app.scss:1` | **Active, required** (consumers found) |
| `_field-type-badge.scss` | 20 | `app.scss:3` | Active (defines `.field-type-container`, used in FieldList/FieldExpansion) |
| `_menu-variables.scss` | 127 | `components/MenuLink.vue:210` | Active |
| `_menu-animations.scss` | 52 | `components/MenuLink.vue:211` | Active |
| `index-list.scss` | 139 | **none** | **ORPHAN** (no `@import` or JS `import` references it) |
| `pagination.scss` | 58 | 3 traces files (`SearchResult.vue`, `ServicesCatalog.vue`, `TracesSearchResultList.vue`) | Active |
| `schema.scss` | 298 | `components/logstream/schema.vue:1095` (JS import) | Active |
| `tailwind.css` | (47 actual) | `main.ts:21` (entry point) | Active |
| `logs/logs-page.scss` | 1,305 | `plugins/logs/Index.vue:3519` | Active |
| `logs/search-result.scss` | 455 | `plugins/logs/SearchResult.vue`, `PatternStatistics.vue`, `PatternCard.vue` | Active |
| `logs/tenstack-table.scss` | 123 | `plugins/logs/TenstackTable.vue:1114`, `components/TenstackTable.vue:2256` | Active |
| `logs/search-history.scss` | 101 | `plugins/logs/SearchHistory.vue:661` | Active |
| `logs/transform-selector.scss` | 99 | `plugins/logs/TransformSelector.vue:340` | Active |
| `logs/syntax-guide.scss` | 77 | `plugins/logs/SyntaxGuide.vue:256`, `plugins/traces/SyntaxGuide.vue:174` | Active |
| `logs/json-preview.scss` | 77 | `plugins/logs/JsonPreview.vue:943`, `DetailTable.vue:825`, `components/JsonPreview.vue:158` | Active |
| `logs/function-selector.scss` | 64 | `plugins/logs/FunctionSelector.vue:171` | Active |
| `logs/detail-table.scss` | 57 | `plugins/logs/DetailTable.vue:824` | Active |
| `logs/visualizelogs-query.scss` | 53 | `plugins/logs/VisualizeLogsQuery.vue:323` | Active |
| `logs/search-schedulerlist.scss` | 50 | `plugins/logs/SearchSchedulersList.vue:830` | Active |

### Library tokens (`web/src/lib/styles/`)

| File | Purpose |
|---|---|
| `tailwind.css` | Standalone token entry — **NOT** imported by app entry; lives for the lib package |
| `tokens/base.css` | Raw palette / spacing / radius / shadow (well isolated) |
| `tokens/semantic.css` | Maps base palette to intent tokens, `@theme inline` registration for Tailwind utilities |
| `tokens/component.css` | Per-component design tokens (Button, ToggleGroup, Card, Dialog, Toast, OTable, …) |
| `tokens/dark.css` | Dark-mode overrides keyed on `html.dark` (works correctly via `applyThemeColors`) |

### Other style entry points found (outside scope but related)

- `web/src/assets/main.css` and `web/src/assets/inputs.scss` — **both orphan** (no importers anywhere). Contain a Vue scaffold leftover plus a stub `.o2-input` rule.
- `web/src/assets/base.css` — referenced as a fallback for `body` font-family. Not imported by current entry chain.
- `web/src/assets/styles/log-highlighting.css` — actively imported by `TenstackTable`, `LogsHighLighting`, `EventDetailDrawerContent`, pattern components.

## Critical Issues

### C1. `.body--dark` class is never set — entire dark-mode token block is dead
`web/src/styles/_variables.scss:470` defines the dark-mode CSS custom properties under a `.body--dark { … }` selector:
```scss
.body--dark {
  --o2-theme-mode: …;
  --o2-primary-background: …;
  --o2-text-primary: …D3D3D3;
  // ~170 lines of dark-mode tokens
}
```
But after Quasar removal nothing applies the `body--dark` class. `web/src/utils/theme.ts:100` only does:
```ts
document.documentElement.classList.toggle('dark', isDarkMode);   // html.dark — for Tailwind/lib
```
and sets a handful of `--o2-*` vars **inline on `document.body.style`** as a runtime fallback. So the entire `_variables.scss` dark token map (and `app.scss:545 .body--dark { … }`, `app.scss:1564 .body--dark .q-tooltip`, plus dozens of scoped-style `.body--dark { … }` blocks in Vue files) silently never activates.

Dark mode "works" only because:
1. `<router-view :class="… 'dark-theme' …">` adds `.dark-theme` (App.vue:19), and `.dark-theme` selectors (e.g. `logs-page.scss:1140`, `app.scss:1797`) match.
2. `applyThemeColors` overwrites a handful of `--o2-*` vars on `document.body.style`.
3. The lib uses `html.dark` (works via `tokens/dark.css`).

Everything keyed on `body--dark` — including the entire `_variables.scss:470-638` block of `--o2-text-primary`, `--o2-card-bg`, `--o2-border-color`, `--o2-table-actions-bg`, `--o2-tab-bg`, etc. for dark mode — is dead code. In practice the values fall back to whatever the runtime `theme.ts` sets (a small subset) plus the light-mode `:root` defaults. Visual dark mode parity with `main` will be uneven.

**Files affected (style-level samples):**
- `web/src/styles/_variables.scss:470-638` (170-line dark token block)
- `web/src/styles/app.scss:545-551, 1564-1568`
- `web/src/styles/logs/logs-page.scss:442`
- `web/src/styles/logs/search-result.scss:443, 450`
- `web/src/styles/logs/search-result.scss:374` (`.body--light &`)
- Plus ~30+ `.body--dark { … }` and `body.body--dark { … }` rules inside Vue scoped styles across `plugins/traces/`, `enterprise/components/`.

Also two JS readers will always return `false` now:
- `web/src/utils/logs/convertLogData.ts:101`
- `web/src/components/PredefinedThemes.vue:488`

**Solution:**
```diff
// web/src/styles/_variables.scss line 470:
- .body--dark {
+ :root.dark, .dark-theme {
    --o2-text-primary: #D3D3D3;
    /* ... rest of dark tokens */
  }
// In JS readers:
- document.body.classList.contains('body--dark')
+ document.documentElement.classList.contains('dark')
```

### C2. "Nunito Sans" `@font-face` declarations were deleted but the font is still referenced
The deleted `web/src/styles/quasar-overrides.scss` contained 35 `@font-face` blocks for "Nunito Sans". No replacement was added. `Nunito Sans` is still referenced as the primary font in:
- `web/src/assets/base.css:68` (body fallback — but `base.css` itself is orphan)
- `web/src/styles/logs/search-result.scss:297`
- `web/src/styles/logs/tenstack-table.scss:62`
- `web/src/components/dashboards/panels/TableRenderer.vue:277`
- `web/src/components/dashboards/addPanel/dynamicFunction/DynamicFunctionPopUp.vue:319,326`

Without the `@font-face` declarations the browser will silently fall back to the next item in each `font-family:` stack (`sans-serif`, system fonts). Typography in tables/panels will look different from `main`.

**Solution:**
```diff
// web/src/styles/app.scss (top of file):
+ @font-face {
+   font-family: "Nunito Sans";
+   font-weight: 400;
+   src: url("/fonts/NunitoSans-Regular.woff2") format("woff2");
+ }
+ /* repeat for 600, 700 weights */
// OR in index.html add:
+ <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Nunito+Sans:wght@400;600;700&display=swap">
```

### C3. `.o2-input` / `.o2-input-full` style definitions deleted but class still consumed
The deleted `quasar-overrides.scss` was the **only** place where the `.o2-input` and `.o2-input-full` rule blocks lived (height, border, `q-field__control` overrides, dark mode background). The remaining definition (`web/src/assets/inputs.scss:1`) is in an orphan file and only sets `padding-top: 8px`.

Consumers of these classes still exist in ~15+ places (e.g. `enterprise/components/EvalTemplateEditor.vue:49`, `plugins/traces/SearchBar.vue:313`, `plugins/logs/JsonPreview.vue:35`, `components/settings/OrganizationSettings.vue:12`, `components/logstream/StreamFieldInputs.vue:27`, `pipeline/NodeForm/ScheduledPipeline.vue:218`). They lose visual structure (heights, borders, label spacing). Most callers also include `tw:` Tailwind classes that may mask the regression, but it is still styling that no longer exists.

**Solution:**
```diff
// web/src/styles/app.scss — restore .o2-input rules:
+ .o2-input {
+   min-height: 36px;
+   border: 1px solid var(--o2-border-color);
+   border-radius: 4px;
+   padding: 4px 8px;
+ }
+ .o2-input-full { @extend .o2-input; width: 100%; }
```

### C4. ~600+ Quasar selectors styling DOM that no longer exists
Quasar `2.18.6` is removed from `package.json` (`web/package.json` diff confirms). Therefore selectors like `.q-btn`, `.q-tab`, `.q-table`, `.q-field`, `.q-icon`, `.q-toggle`, `.q-radio`, `.q-checkbox`, `.q-virtual-scroll`, `.q-tooltip`, `.q-toolbar`, `.q-position-engine`, `.q-splitter`, `.q-tr`, `.q-td`, `.q-table__top`, `.q-table__bottom`, `.q-btn-dropdown__arrow`, etc. have **no matching DOM**. They are pure dead code. Counts:
- `app.scss`: 171 lines with `.q-` selectors
- `logs/logs-page.scss`: 92 lines
- `logs/search-result.scss`: 29 lines
- `schema.scss`: 20 lines
- `logs/transform-selector.scss`: 8 lines
- `logs/function-selector.scss`: 5 lines
- Plus smaller numbers in the remaining logs partials.

Total ≈ **350+ Quasar-class selector rules** still emitted into the global stylesheet. They harm performance (parsing, specificity calculation) and obscure the real architecture.

**Solution:**
```diff
// web/src/styles/app.scss + logs/*.scss + schema.scss:
- .q-btn { /* ... */ }
- .q-tab { /* ... */ }
- .q-table { /* ... */ }
- .q-field { /* ... */ }
- .q-icon { /* ... */ }
- /* ... 350+ rules total */
+ // Delete all .q-* selectors — they target DOM that no longer exists.
```

## Three-Layer Architecture Compliance

### Global Layer (`web/src/styles/app.scss` + `_variables.scss`)

What's good:
- O2 design tokens are declared in `_variables.scss :root` (light) — comprehensive set covering text, surface, border, scrollbar, toggle, table, tab, JSON syntax, span-kind, status, wildcard, latency, trace, etc.
- Tailwind preset + lib tokens import chain (`web/src/styles/tailwind.css → lib/styles/tokens/*.css`) is correctly wired into `main.ts:21`.
- Global resets (html/body, scrollbar) are at the top.

What violates the layer:
- `app.scss` is **2,316 lines** and contains many one-off component skins (e.g. `.tabs-selection-container-dark`, `.o2-numeric-input-dark`, `.o2-table-header-dark`, `.o2-search-input`, `.o2-radio-button-light/dark`, `.o2-toggle-button-{xs,sm,lg}`, `.organization-menu-o2`, `.default-index-menu`, `.saved-views-dropdown-menu`, `.logs-visualize-toggle`). These are **component-scoped concerns living at the global layer** — page bleed risk and discoverability/maintenance pain.
- `app.scss:1830-2193` defines a giant `.default-index-menu { … }` block (~360 lines) — clearly component-level styling crammed into the global layer.
- Two split `<style>` blocks in `MainLayout.vue` (one unscoped that pulls in `app.scss`, another `scoped`) is fine, but `Login.vue:419` **separately re-imports `app.scss`** — duplicate inclusion if Login is mounted alongside MainLayout. Minor (Vite dedupes per-file, but still smell).
- `app.scss:53 var(--q-primary)` — that var is defined in `_variables.scss` (as `--q-primary: var(--o2-theme-color)`) so it resolves, but referencing a Quasar-namespaced variable in new code is architectural debt.

**Solution:**
```diff
// Move large component skins out of app.scss into dedicated partials:
+ // web/src/styles/components/_default-index-menu.scss   (360 lines)
+ // web/src/styles/components/_organization-menu.scss
+ // web/src/styles/components/_o2-search-input.scss
// In app.scss:
- .default-index-menu { /* 360 lines */ }
+ @import "components/default-index-menu";
- color: var(--q-primary);
+ color: var(--o2-theme-color);
```

### Component-Level Layer (`web/src/styles/logs/*`, `pagination.scss`, `schema.scss`, `index-list.scss`, `_field-type-badge.scss`, `_menu-*.scss`)

What's good:
- Logs partials are correctly imported from a single component each (one-to-one). Good naming.
- `_field-type-badge.scss` is a tight, well-scoped shared partial used by FieldList/FieldExpansion/FieldRow.
- `_menu-variables.scss` + `_menu-animations.scss` are imported only by `MenuLink.vue` and live alongside global. Reasonable.

What violates the layer:
- `web/src/styles/index-list.scss` (139 lines) — **orphan**, no importer anywhere. Likely superseded by the field-list refactor.
- `web/src/styles/logs/logs-page.scss` is 1,305 lines and contains many file-level concerns (page header, button states, time-picker overrides, virtual scroll cell hovers, dark-theme overrides). Component-level partial bloating into "page" partial.
- `pagination.scss` legitimately contains shared OPagination styling. Three traces files re-import it (correct shared use).

**Solution:**
```diff
- // web/src/styles/index-list.scss (139 lines, orphan)
+ // Delete file — no consumer.
// Split logs-page.scss into smaller partials:
+ // logs/_logs-header.scss, _logs-buttons.scss, _logs-virtual-scroll.scss
- @import "styles/logs/logs-page";
+ @import "styles/logs/logs-header";
+ @import "styles/logs/logs-buttons";
```

### File-Level Layer (`<style scoped>` inside `.vue`)

Component scoped styles are not in scope for this audit, but the audit did find:
- ~30+ scoped Vue style blocks contain `.body--dark { … }` or `body.body--dark` selectors that are dormant (same root cause as C1).
- A growing pattern of `.ai-hover-btn` / `.ai-btn-active` definitions repeated **inside many components** (AddRegexPattern, PipelineEditor, IncidentDetailDrawer, QueryEditorDialog, QueryConfig, FunctionsToolbar) even though canonical versions exist in `app.scss:2217-2255`. This is duplication that should be deleted in favor of the global rule.

**Solution:**
```diff
// Delete per-component duplicates of .ai-hover-btn/.ai-btn-active:
// AddRegexPattern.vue, PipelineEditor.vue, IncidentDetailDrawer.vue,
// QueryEditorDialog.vue, QueryConfig.vue, FunctionsToolbar.vue:
- <style scoped>
- .ai-hover-btn { /* duplicate */ }
- .ai-btn-active { /* duplicate */ }
- </style>
+ // Use the canonical rule in app.scss:2217-2255 (already global, no scope needed).
```

## Quasar Leftovers

### Still in the codebase (style files)

1. **`.q-*` selector rules** — see C4 above. Roughly 350 rules across `app.scss`, `logs/*.scss`, `schema.scss`, etc.
2. **`.q-w-{sm,md,lg,xl,p50,p80}` utility classes** (`app.scss:371-390`) — still used by some templates (e.g. `logstream/schema.vue:99 class="q-w-md"`). These should be migrated to Tailwind `tw:w-*` and the global class deleted. Active for now.
3. **`.q-tooltip { … }` styling at `app.scss:1529-1574`** — heavy override of a component that no longer exists.
4. **`.q-position-engine { z-index: 10001 }`** (`app.scss:444-446`) — dead (no Quasar positioning).
5. **`.q-toolbar { min-height: 2.5rem }`** (`app.scss:2285-2287`) — dead.
6. **`.q-splitter--vertical`, `.q-splitter--horizontal`, `.q-splitter`** rules (`app.scss:109-124, 1257-1283`) — dead (replaced by `OSplitter`).
7. **`.q-tabs--vertical .q-tab`, `.q-tabs--horizontal .q-tab`** (`app.scss:228-283`) — dead.
8. **All `.q-table`, `.q-table__card`, `.o2-quasar-table .q-virtual-scroll__content`, etc.** (`app.scss:557-708`) — dead.
9. **`.q-toggle__*`, `.q-radio__*`, `.q-checkbox__*`, `.q-field__*` rules** scattered everywhere in `app.scss` — dead.

### Legacy Quasar SCSS variables still consumed

`_quasar-variables.scss` (the new compat shim) is genuinely required. Verified consumers (sample, ~80+ matches total in `.vue` files):

| Variable | Consumers (sample) |
|---|---|
| `$primary` | `enterprise/components/billings/plans.vue:388`, `plugins/metrics/SyntaxGuideMetrics.vue:198`, `pipeline/NodeForm/ScheduledPipeline.vue:2694,2738`, `dashboards/addPanel/DashboardQueryBuilder.vue:1455`, `functions/TestFunction.vue:752`, `functions/EnrichmentSchema.vue:283`, `logstream/schema.vue:2969`, `_variables.scss:322,505`, `logs/tenstack-table.scss:20`, `logs/syntax-guide.scss:53`, `app.scss:732,741` |
| `$dark` | `iam/quota/Quota.vue:1631`, `logs/search-result.scss:181` |
| `$dark-page` | `plugins/traces/SearchBar.vue:1098,1124`, `components/DateTime.vue:1192,1235,1301,1348`, `CustomDateTimePicker.vue:301,344,404,445`, `logstream/explore/SearchBar.vue:321,350`, `pipeline/PipelinesList.vue:1237`, `alerts/AlertList.vue:2852`, `common/JsonEditor.vue:268`, `iam/users/InvitationList.vue:362`, `iam/users/User.vue:1030`, `functions/AssociatedStreamFunction.vue:725`, `dashboards/panels/PromQLTableChart.vue:333,339`, `Dashboards/ScheduledDashboards.vue:382`, `Dashboards/ViewDashboard.vue:1902` |
| `$secondary` | `plugins/traces/SearchBar.vue:1165`, `pipeline/NodeForm/ScheduledPipeline.vue:2788`, `rum/SearchBar.vue:454` |
| `$accent` | `actionScripts/ActionScripts.vue:852`, `ingestion/rum/Index.vue:184`, `AppAlerts.vue:108`, `ActionScript.vue:69` |
| `$info` | `rum/ErrorDetail.vue:76`, `rum/sessionReplay/SessionLocationColumn.vue:60` |
| `$light-text` | `app.scss:430`, `iam/users/InvitationList.vue:366`, `iam/users/User.vue:1034,1064`, `iam/users/MemberInvitation.vue:207`, `functions/AssociatedStreamFunction.vue:729` |
| `$light-text2` | `plugins/traces/SearchBar.vue:1103`, `logstream/explore/SearchBar.vue:327`, `rum/SearchBar.vue:389` |
| `$border-color` | 20+ Vue files + `app.scss:406,410` |
| `$white` | `pipeline/NodeForm/ScheduledPipeline.vue:2739`, `iam/quota/Quota.vue:1636`, `alerts/FilterGroup.vue:553`, `Dashboards/ViewDashboard.vue:1906` |
| `$input-border` | `alerts/AddAlert.vue:871,875` |
| `$input-bg` | `iam/users/User.vue:1054`, `iam/users/MemberInvitation.vue:197` |
| `$input-field-border-color` | `logstream/schema.vue` (7×), `functions/EnrichmentSchema.vue:267,273` |
| `$grey-4` | `dashboards/settings/VariableAdHocValueSelector.vue` (4× active) |
| `$navbarHeight` | Indirect, via `--navbar-height` CSS var defined in `_quasar-variables.scss:50-52`. Consumed by ~10+ files (`enterprise/components/billings/Billing.vue`, `plugins/traces/Index.vue`, `plugins/logs/Index.vue`, `plugins/logs/SearchHistory.vue`). |

### Unused legacy variables in `_quasar-variables.scss` (52-line shim)

The following declared variables have **no consumers** found (grep) and can be deleted:
- `$positive`, `$negative`, `$warning` (the SCSS scalar; the `--q-warning` CSS var is still used in `app.scss:2277`)
- `$grey`, `$grey-1`, `$grey-2`, `$grey-3`, `$grey-5`, `$grey-6`, `$grey-7`, `$grey-8`, `$grey-9`, `$grey-10` (only `$grey-4` is used)
- `$selected-list-bg`, `$table-footer-opacity`, `$generic-border-radius`, `$button-border-radius`, `$card-border`, `$icon-bg`, `$payment-card-border`, `$webinarHeight`

That trims the shim from 52 lines to roughly 22 lines (the actually-used ones).

**Solution:**
```diff
// web/src/styles/_quasar-variables.scss — remove unused vars:
- $positive: ...; $negative: ...; $warning: ...;
- $grey: ...; $grey-1: ...; $grey-2: ...; $grey-3: ...;
- $grey-5: ...; $grey-6: ...; $grey-7: ...; $grey-8: ...; $grey-9: ...; $grey-10: ...;
- $selected-list-bg: ...; $table-footer-opacity: ...;
- $generic-border-radius: ...; $button-border-radius: ...;
- $card-border: ...; $icon-bg: ...; $payment-card-border: ...; $webinarHeight: ...;
```

## Orphan / Dead SCSS Files

| Path | Lines | Note |
|---|---|---|
| `web/src/styles/index-list.scss` | 139 | No importer found anywhere in `web/src/`. Field-list refactor seems to have moved the styling elsewhere. **Safe to delete.** |
| `web/src/assets/main.css` | 40 | No importer found. Vue scaffold leftover. **Safe to delete.** |
| `web/src/assets/inputs.scss` | 6 | Only imported by `main.css` (also orphan). **Safe to delete.** |
| `web/src/assets/base.css` | 75 | Not imported anywhere in the app's entry chain. Defines Vue scaffold theme + body font-family with "Nunito Sans" first. **Verify and delete or re-link.** |

**Solution:**
```bash
# After confirming no consumers via grep:
- rm web/src/styles/index-list.scss
- rm web/src/assets/main.css
- rm web/src/assets/inputs.scss
- rm web/src/assets/base.css   # only after verifying no implicit consumer
```

## Tokens & Themes

What works:
- `tokens/base.css` — raw palette/spacing/radius/shadow — clean, no cross-references.
- `tokens/semantic.css` — semantic intent tokens (text, surface, border) — uses `@theme inline` so Tailwind generates utilities **and** dark.css overrides apply correctly. Good pattern.
- `tokens/component.css` — per-component design tokens are well-namespaced (`--color-button-primary-*`, `--color-toggle-track-bg`, `--color-table-header-bg`, etc.) and properly registered via the same `@theme inline` pattern.
- `tokens/dark.css` — keyed on `:root.dark, .dark :root, .dark` — matches the `html.dark` toggle from `theme.ts:100`. Works correctly.

What's broken or messy:
- **C1 above**: The old `--o2-*` dark-mode block in `_variables.scss:470` keyed on `.body--dark` is silently inert.
- **Undefined variable**: `_variables.scss:323-324, 506-507` references `var(--o2-theme-elements)` — that variable is never defined. Falls back to the second arg (`white`), but indicates the original design intent is lost.
- **Two parallel token systems** coexist: legacy `--o2-*` (in `_variables.scss`, runtime-overridden by `theme.ts`) and new lib tokens (`--color-*` in `lib/styles/tokens/`). There is no documentation linking them. Components in the codebase reference both vocabularies. Long-term, one should win — likely the lib tokens given the dark-mode story works there.
- **`--tile-bg` variable** referenced in `app.scss:1604 .feature-card` and several Vue files (`HomeViewSkeleton.vue`, `LLMInsightsSkeleton.vue`) is defined only inside `.dark`/`.light` scoped blocks **inside those Vue files** — there is no global fallback. Outside those scopes (e.g. on the `.feature-card` global), `var(--tile-bg)` resolves to nothing (transparent/empty). Result: `feature-card` background is broken globally.
- **Inline dark-mode token overrides in `theme.ts`** (lines 105–144) duplicate-and-conflict with `_variables.scss`'s `.body--dark` definitions. Single source of truth is missing. Easy maintenance bug surface.

**Solution:**
```diff
// web/src/styles/_variables.scss
  :root {
+   --o2-theme-elements: var(--o2-surface-elevated);
+   --tile-bg: var(--o2-card-bg);   /* global default */
    /* ... */
  }
  :root.dark, .dark-theme {
+   --tile-bg: #1f1f1f;
  }
// In theme.ts (lines 105-144) — delete inline overrides duplicating _variables.scss.
```

## Build / Compatibility Issues

- `vite.config.ts:133-136` correctly silences Sass deprecations and uses `additionalData: "@import '@/styles/quasar-variables';\n"` so every `.vue` SCSS block gets `_quasar-variables.scss` prepended. This is the load-bearing path — without it, every `$primary`, `$dark-page`, `$border-color`, etc. in scoped styles would break. Confirmed sufficient.
- `silenceDeprecations: ["import", "global-builtin", "legacy-js-api"]` masks the Sass `@import` → `@use` deprecation. Long-term Sass 2 will remove `@import` — about 20 files in `web/src/styles/` and ~30 Vue scoped styles use `@import`. Migration to `@use`/`@forward` is overdue but not urgent.
- The CSS entry chain (`main.ts:21 → styles/tailwind.css → lib/styles/tokens/*.css`) loads tokens **before** Vue components hydrate. Good ordering.
- `app.scss` imported via `<style lang="scss">` blocks in `MainLayout.vue` and `Login.vue` is processed independently (no hoisting). For a single-app session this is fine; for `Login.vue` mounted before `MainLayout` (the auth flow) the global tokens come from `_variables.scss` (via the SCSS `additionalData`) but the legacy `body--dark` class never gets set, so Login dark-mode is just as broken as the rest.
- No build errors expected post-Quasar removal — selectors targeting non-existent DOM are silently inert. Bundle size impact is the main cost: the dead `.q-*` rules are still emitted in the compiled CSS.

**Solution:**
```diff
// Migrate Sass @import → @use/@forward (medium-term plan):
- @import "variables";
+ @use "variables" as *;
// In Login.vue style block — remove duplicate app.scss import if MainLayout already loads it:
- @import "@/styles/app.scss";
```

## Recommendations

Listed by priority (highest first). All read-only — no code changes made in this audit.

1. **(Critical) Restore dark-mode token activation.** Either (a) apply the `body--dark` class in `applyThemeColors`, (b) rewrite the `.body--dark { … }` selector in `_variables.scss:470` (and `app.scss:545, 1564`) to `:root.dark` or `.dark-theme`, or (c) consolidate all dark tokens into `lib/styles/tokens/dark.css` and delete the legacy block. Option (b) is the smallest patch; option (c) is the correct end state.
2. **(Critical) Add back `@font-face` declarations for "Nunito Sans"** or remove the font references. The cleanest fix: add a `@font-face` block to `app.scss` or load from Google Fonts via `index.html`. Currently the typography is silently degraded.
3. **(Critical) Restore `.o2-input` / `.o2-input-full` rules** (heights, borders, q-field overrides — which would need to be ported to whatever component is now rendering inside that container). Either re-add the styling to `app.scss` (using sibling/descendant Tailwind-prefix selectors) or scrub the class names from the ~15 consumers.
4. **(High) Delete the `index-list.scss` orphan.** Confirm via build/test cycle that nothing breaks. Same for `assets/main.css`, `assets/inputs.scss`, possibly `assets/base.css`.
5. **(High) Sweep `.q-*` selectors out of all SCSS files.** Start with `app.scss` and `logs/logs-page.scss`. Each `.q-btn`, `.q-icon`, `.q-spinner`, `.q-tab*`, `.q-table*`, `.q-tr/td/th`, `.q-toggle*`, `.q-radio*`, `.q-checkbox*`, `.q-field*`, `.q-toolbar`, `.q-tooltip`, `.q-virtual-scroll*`, `.q-position-engine`, `.q-splitter*` rule can be deleted. Roughly **300+ rules of dead code**. Saves ~5–10 KB of compiled CSS and a lot of cognitive overhead.
6. **(High) Trim `_quasar-variables.scss`** to the actually-used set (~22 lines). Remove unused: `$positive`, `$negative`, `$warning`, all `$grey-{1,2,3,5,6,7,8,9,10}` (keep `$grey-4`), `$selected-list-bg`, `$table-footer-opacity`, `$generic-border-radius`, `$button-border-radius`, `$card-border`, `$icon-bg`, `$payment-card-border`, `$webinarHeight`.
7. **(Medium) Fix `--o2-theme-elements`** — define it in `:root` and the dark equivalent, or delete the references in `_variables.scss:323-324, 506-507`.
8. **(Medium) Define `--tile-bg`** at global `:root` (and the dark override) so `.feature-card` background is no longer broken outside the few Vue files that scope it locally.
9. **(Medium) Decouple `app.scss` component skins** (`.organization-menu-o2`, `.default-index-menu`, `.saved-views-dropdown-menu`, `.o2-quasar-app-table`, `.o2-numeric-input*`, `.o2-text-input*`, `.o2-toggle-button-*`, `.o2-search-input`, `.o2-radio-button-*`) into either dedicated partials under `web/src/styles/components/*` or move them into the relevant `.vue` scoped style block. The single-monolith pattern violates the three-layer model.
10. **(Medium) Deduplicate `.ai-hover-btn` / `.ai-btn-active`** — delete the per-component re-definitions in `AddRegexPattern.vue`, `PipelineEditor.vue`, `IncidentDetailDrawer.vue`, `QueryEditorDialog.vue`, `QueryConfig.vue`, `FunctionsToolbar.vue`, etc. Use the canonical version in `app.scss:2217-2255`.
11. **(Medium) Reconcile two parallel token systems.** Document or refactor: when should new code use `--o2-*` vs `--color-*` (lib)? The two vocabularies should converge.
12. **(Low) Plan Sass `@import` → `@use`/`@forward` migration.** ~20 SCSS files and ~30 scoped Vue styles use the deprecated `@import`. Currently masked by `silenceDeprecations` in `vite.config.ts:135`. Migrate before Sass 2 lands.
13. **(Low) Remove the redundant `app.scss` import in `Login.vue:419`** if `MainLayout.vue` is guaranteed to be the only entry that needs it; otherwise document why both need it.

## Class-Level Styling Audit (Styles Folder)

Scope: `web/src/styles/**` + `web/src/assets/**` (excluding image/font binaries). Counts derived from grep over the listed files; no source modifications were made.

### 1. `.q-*` Selectors Still in Styles

App.scss contains **151** top-level + nested `.q-*` selector lines; logs partials add **~120** more. All target Quasar DOM that no longer exists in the UX-revamp (post-Quasar removal — commit `1c38131b`). Representative sample (cap 30):

| File:Line | Selector | Action | Layer |
| --- | --- | --- | --- |
| `web/src/styles/app.scss:58` | `.q-btn` | Remove (dead) | Global |
| `web/src/styles/app.scss:109` | `.q-splitter--vertical` | Remove (dead) | Global |
| `web/src/styles/app.scss:118` | `.q-splitter--horizontal` | Remove (dead) | Global |
| `web/src/styles/app.scss:228` | `.q-tabs` (+ nested `.q-tab`) | Remove (dead) | Global |
| `web/src/styles/app.scss:371-389` | `.q-w-sm/.q-w-md/.q-w-lg/.q-w-xl/.q-w-p50/.q-w-p80` | Remove (Tailwind replaces) | Global |
| `web/src/styles/app.scss:444` | `.q-position-engine` | Remove (dead) | Global |
| `web/src/styles/app.scss:565,576` | `.q-table`, `.q-table__card` | Remove (dead) | Global |
| `web/src/styles/app.scss:682,697` | `.q-virtual-scroll__content`, nested `.q-table` | Remove (dead) | Global |
| `web/src/styles/app.scss:777-812` | `.q-checkbox__bg`, `.q-radio*` | Remove (dead) | Global |
| `web/src/styles/app.scss:822-873` | `.q-field__inner/__control/__prepend/__append`, `.q-icon` | Remove (dead) | Global |
| `web/src/styles/app.scss:1001-1177` | `.q-toggle*` (>40 nested rules) | Remove (dead) | Global |
| `web/src/styles/app.scss:1196-1247` | `.q-field*` overrides | Remove (dead) | Global |
| `web/src/styles/app.scss:1257-1279` | `.q-splitter*` overrides | Remove (dead) | Global |
| `web/src/styles/app.scss:1291` | `.q-input` | Remove (dead) | Global |
| `web/src/styles/app.scss:1320-1385` | `.q-select` + nested | Remove (dead) | Global |
| `web/src/styles/app.scss:1529` | `.q-tooltip` | Remove (dead) | Global |
| `web/src/styles/app.scss:1564` | `.body--dark .q-tooltip` | Remove (dead) | Global |
| `web/src/styles/app.scss:2195,2199` | `.q-field--labeled.q-field--dense .q-field__suffix`, `.q-toggle__inner` | Remove (dead) | Global |
| `web/src/styles/app.scss:2285` | `.q-toolbar` | Remove (dead) | Global |
| `web/src/styles/schema.scss:11-15` | `.q-table__control`, `.q-table` | Remove (dead) | Partial |
| `web/src/styles/schema.scss:94-183` | `.mini-select .q-field*` (15 rules) | Remove (dead) | Partial |
| `web/src/styles/schema.scss:266-273` | `.q-field__control` | Remove (dead) | Partial |
| `web/src/styles/index-list.scss:132` | `.q-table__middle` | Remove (orphan partial) | Partial |
| `web/src/styles/pagination.scss:14,22` | `:deep(.q-btn)`, `.q-pagination__middle .q-btn` | Remove (dead) | Partial |
| `web/src/styles/logs/logs-page.scss:75-262` | `.q-icon/.q-btn/.q-select/.q-field*/.q-splitter*/.q-toggle*/.q-btn-group/.q-btn-dropdown*` (42 selectors) | Remove (dead) | Partial |
| `web/src/styles/logs/search-result.scss` | 87 `.q-*` nested rules | Remove (dead) | Partial |
| `web/src/styles/logs/detail-table.scss:13` | `.q-icon` | Remove (dead) | Partial |
| `web/src/styles/logs/search-schedulerlist.scss:21,27` | `.q-td`, `.custom-table .q-tr > .q-td` | Remove (dead) | Partial |
| `web/src/styles/logs/function-selector.scss:16,43-61` | `:deep(.q-toggle__inner)`, `.q-btn__content .q-icon`, `:deep(.q-btn-dropdown__arrow-container)` | Remove (dead) | Partial |
| `web/src/styles/logs/visualizelogs-query.scss:26` | `:deep(.query-editor-splitter .q-splitter__separator)` | Remove (dead) | Partial |
| +270 more | (all `.q-*`-rooted rules across `app.scss` + `logs/*.scss`) | Remove (dead) | Mixed |

### 2. `var(--q-*)` References

| File:Line | Variable | Replacement |
| --- | --- | --- |
| `web/src/styles/app.scss:53` | `var(--q-primary)` | `var(--o2-primary)` |
| `web/src/styles/app.scss:1739` | `var(--q-primary)` | `var(--o2-primary)` |
| `web/src/styles/app.scss:1792` | `var(--q-primary)` | `var(--o2-primary)` |
| `web/src/styles/app.scss:1811` | `var(--q-primary)` | `var(--o2-primary)` |
| `web/src/styles/app.scss:1952` | `var(--q-primary)` | `var(--o2-primary)` |
| `web/src/styles/app.scss:1968` | `var(--q-primary)` | `var(--o2-primary)` |
| `web/src/styles/app.scss:2277` | `var(--q-warning)` | `var(--o2-status-warning)` or token |
| `web/src/styles/schema.scss:63` | `var(--q-light)` | `var(--o2-secondary-background)` |
| `web/src/styles/schema.scss:69` | `var(--q-primary)` | `var(--o2-primary)` |
| `web/src/styles/logs/search-result.scss:72,76` | `var(--q-primary)` | `var(--o2-primary)` |
| `web/src/styles/logs/search-result.scss:323` | `var(--q-primary)` | `var(--o2-primary)` |
| `web/src/styles/logs/search-result.scss:366` | `var(--q-color-dark, #1e1e2e)` | `var(--o2-primary-background)` |
| `web/src/styles/logs/visualizelogs-query.scss:53` | `var(--q-warning)` | `var(--o2-status-warning)` |
| `web/src/styles/logs/json-preview.scss:75` | `rgba(var(--q-primary-rgb), 0.1)` | `color-mix(in srgb, var(--o2-primary) 10%, transparent)` |
| `web/src/styles/logs/logs-page.scss:552,554` | `var(--q-primary)` | `var(--o2-primary)` |
| `web/src/styles/logs/logs-page.scss:701,717` | `var(--q-primary)` | `var(--o2-primary)` |
| `web/src/styles/logs/tenstack-table.scss:109` | `var(--q-negative)` (commented out) | Delete the dead comment |

Total: **17 active references** to `--q-*` CSS variables (which no longer exist now that Quasar's runtime is gone).

### 3. `body--dark` / `body.body--dark` Selectors

| File:Line | Selector | Replacement |
| --- | --- | --- |
| `web/src/styles/_variables.scss:470` | `.body--dark { … }` (entire dark-token block) | `:root.dark` / `.dark-theme` (or merge into `lib/styles/tokens/dark.css`) |
| `web/src/styles/_variables.scss:646` | comment referring to `.body--dark` selector | Update comment after refactor |
| `web/src/styles/app.scss:545` | `.body--dark { … }` | `:root.dark` (or move tokens out) |
| `web/src/styles/app.scss:1564` | `.body--dark .q-tooltip` | Delete (Quasar tooltip is dead) |
| `web/src/styles/logs/logs-page.scss:442` | `.body--dark { … }` (nested) | `:root.dark &` or O2-token-based selector |
| `web/src/styles/logs/search-result.scss:443` | `.body--dark & { color: #64B5F6; … }` | `:root.dark &` |
| `web/src/styles/logs/search-result.scss:450` | `.body--dark & { color: #EF9A9A; … }` | `:root.dark &` |

7 occurrences. Currently **none active at runtime** because nothing applies the `body--dark` class anymore (see audit body for diagnosis).

### 4. Quasar SCSS Variables ($primary etc.) in Styles

| File:Line | Variable | Replacement |
| --- | --- | --- |
| `web/src/styles/_variables.scss:322` | `#{$primary}` (in `color-mix`) | `var(--o2-primary)` (move expression into `:root`) |
| `web/src/styles/_variables.scss:505` | `#{$primary}` (in `color-mix`, dark block) | `var(--o2-primary)` |
| `web/src/styles/app.scss:406` | `$border-color` | `var(--o2-border)` |
| `web/src/styles/app.scss:410` | `$border-color` | `var(--o2-border)` |
| `web/src/styles/app.scss:430` | `$light-text` | `var(--o2-text-muted)` |
| `web/src/styles/app.scss:732` | `$primary !important` | `var(--o2-primary) !important` |
| `web/src/styles/app.scss:741` | `$primary !important` | `var(--o2-primary) !important` |
| `web/src/styles/logs/tenstack-table.scss:20` | `$primary` | `var(--o2-primary)` |
| `web/src/styles/logs/syntax-guide.scss:53` | `$primary` | `var(--o2-primary)` |
| `web/src/styles/logs/logs-page.scss:329` | `$secondary` | `var(--o2-secondary)` |
| `web/src/styles/logs/logs-page.scss:342` | `$negative !important` | `var(--o2-status-error) !important` |

**11 live usages** outside the `_quasar-variables.scss` declarations file. Once these are migrated, `_quasar-variables.scss` itself can be slimmed (see Section 6 of the audit body).

### 5. Orphan SCSS Files (No Importer)

| File | Reason | Action |
| --- | --- | --- |
| `web/src/styles/index-list.scss` (139 lines) | Zero references across `web/src/**` and Vite/Quasar config. References dead Quasar internals (`.q-table__middle`). | Delete |
| `web/src/styles/fonts/*.woff2` (10 files) | No `@font-face` declaration loads them anywhere (`grep pe0RM` → 0 hits). Dead-weight binaries (~150 KB). | Delete folder, or wire up `@font-face` for Nunito Sans |
| `web/src/assets/inputs.scss` | Not referenced from `main.ts`, `app.scss`, `tailwind.css`, or any Vue `@import` | Verify + delete |
| `web/src/assets/main.css` | Not referenced from entry chain | Verify + delete |
| `web/src/assets/base.css` | Only consumer is `main.css` (also orphan); declares the missing "Nunito Sans" stack | Delete or re-wire if font is wanted |

### 6. Duplicate Class Blocks Across Partials (Consolidation Candidates)

| Files | Duplicated block | Proposed home |
| --- | --- | --- |
| `app.scss:1727`, `logs/search-history.scss:23`, `logs/search-schedulerlist.scss:24`, `logs/logs-page.scss:1199` | `text-overflow: ellipsis` + `overflow: hidden` + `white-space: nowrap` | `_variables.scss` mixin `@mixin truncate-text` |
| `logs/search-history.scss:24`, `logs/search-result.scss:411`, `logs/search-schedulerlist.scss:23`, `logs/logs-page.scss:1197` | `white-space: nowrap` for table cells | Single utility class in `app.scss` or Tailwind `tw-whitespace-nowrap` |
| `logs/detail-table.scss:8,22`, `logs/json-preview.scss:6`, `logs/search-result.scss:253`, `logs/tenstack-table.scss:81` | `font-family: monospace` | One global `.o2-mono` class in `app.scss` |
| `_variables.scss:322`, `_variables.scss:505` | `--o2-scrollbar-thumb-bg: color-mix(in srgb, #{$primary} 20%, white)` (identical in light + dark) | Token in `lib/styles/tokens/semantic.css` so it's not duplicated per mode |
| `app.scss` ::-webkit-scrollbar block (lines 322-346) | Scrollbar reset (single source) | Already canonical — flag for completeness |
| `logs/detail-table.scss:37` (`.detail-table-list`), `logs/logs-page.scss:1108` (`.detail-table-dialog`) | Closely related table-detail layout — share padding/border vars | Move common bits to a `_detail-table-shared.scss` mixin |

### 7. "Nunito Sans" / Other Dead Font References

| File:Line | Reference | Action |
| --- | --- | --- |
| `web/src/assets/base.css:68` | `font-family: 'Nunito Sans', -apple-system, …` on `body` | Add matching `@font-face` (loading the woff2 files in `styles/fonts/`) OR replace with system stack |
| `web/src/styles/logs/tenstack-table.scss:62` | `font-family: "Nunito Sans", sans-serif;` | Same as above |
| `web/src/styles/logs/search-result.scss:297` | `font-family: "Nunito Sans", sans-serif;` | Same as above |
| `web/src/styles/app.scss:537` | `font-family: "Monaco", "Menlo", "Courier New", monospace;` | Keep (system monospace) |
| `web/src/styles/fonts/*.woff2` (10 files) | Font files present, no `@font-face` block consumes them | Delete or wire up |

Net: Nunito Sans is referenced in 3 source files and bundled in 10 woff2 binaries but **no `@font-face` declaration exists in any `*.scss` / `*.css` / `index.html`** — meaning the page renders the next fallback (system sans-serif) silently. Either restore the `@font-face` block or strip all three references.

### 8. Tailwind Misuse in Styles

| File:Line | Issue | Fix |
| --- | --- | --- |
| `web/src/styles/tailwind.css:1` | Uses `@import "tailwindcss" prefix(tw)` — requires every utility class to be prefixed `tw-*`. Mixed adoption across the codebase (some classes Vue side use bare names). | Audit Vue templates for unprefixed Tailwind utilities; standardize |
| `web/src/styles/tailwind.css:25-44` | `@layer base { *, :before, :after { border-color: #e5e7eb; } h5/h6 {...} }` — overrides Quasar/Tailwind preflight with hard-coded grey. Conflicts with O2 token system. | Replace `#e5e7eb` with `var(--o2-border)` |
| `web/src/styles/app.scss:371-389` | `.q-w-sm/.q-w-md/.q-w-lg/.q-w-xl/.q-w-p50/.q-w-p80` — hand-rolled width utilities that duplicate Tailwind `tw-w-*` semantics | Delete; consumers should use `tw-w-32`, `tw-w-1/2`, etc. |
| n/a | No `@apply` directives found in `*.scss` (good — keeps Tailwind isolated) | — |

### 9. Layer Summary

- **Global layer files (entry-loaded):** 3
  - `web/src/styles/tailwind.css` (loaded by `main.ts:21`, re-exports lib tokens + Tailwind base)
  - `web/src/styles/app.scss` (imported from `MainLayout.vue:1193` and `Login.vue:419`)
  - `web/src/styles/_variables.scss` (auto-prepended via Vite `additionalData`)
- **Quasar legacy declarations file:** 1 (`_quasar-variables.scss`, 52 lines — `~22` lines still referenced, rest unused)
- **Component-level partials (imported by Vue files):** 12
  - `pagination.scss`, `schema.scss`, `_field-type-badge.scss`, `_menu-variables.scss`, `_menu-animations.scss`
  - `logs/`: `detail-table.scss`, `function-selector.scss`, `json-preview.scss`, `logs-page.scss`, `search-history.scss`, `search-result.scss`, `search-schedulerlist.scss`, `syntax-guide.scss`, `tenstack-table.scss`, `transform-selector.scss`, `visualizelogs-query.scss`
- **Assets folder (`web/src/assets/`):** 1 active (`styles/log-highlighting.css`, imported by 5 Vue files); 3 likely orphans (`base.css`, `main.css`, `inputs.scss`)
- **Dead/orphan to remove:** **~14 files / folders**
  - `web/src/styles/index-list.scss`
  - `web/src/styles/fonts/` (10 woff2 binaries)
  - `web/src/assets/base.css`, `web/src/assets/main.css`, `web/src/assets/inputs.scss`
- **Migration to `@use`/`@forward` needed:** **~13 SCSS files** in `web/src/styles/` use legacy `@import` (currently silenced by Vite's `silenceDeprecations: ["import", "global-builtin", "legacy-js-api"]`). Plus ~30 Vue scoped styles. Total: **~43 files** to migrate before Sass 2 ships.
- **Dead `.q-*` rule lines to delete:** **~300+** spread across `app.scss` (151), `logs/logs-page.scss` (42), `logs/search-result.scss` (87), `schema.scss` (~20), plus scattered. Estimated compiled-CSS savings: 5–10 KB.

