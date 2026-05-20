# About Page — Quasar Removal Audit

## Summary

The About page (`web/src/views/About.vue` + `web/src/components/about/FeatureComparisonTable.vue`) has been migrated from Quasar to OpenObserve's O* component library + Tailwind v4 (`tw:` prefix).

The migration is **functionally usable** — the version/build/commit hero, library links, license details and feature comparison table all render — but the audit surfaced a number of regressions and stale code that need cleanup:

- **Broken Tailwind v4 syntax**: `tw:bg-opacity-10` no longer exists in Tailwind v4; the info-note and no-license-warning panels and the installation_id code block now render as fully opaque, very loud blue/yellow/black backgrounds instead of subtly tinted panels.
- **Dead dark-theme CSS** in FeatureComparisonTable — `:deep(.body--dark …)` no longer matches because Quasar removed the `body--dark` class application; striped-row dark theming is broken in the comparison table.
- **Toast variant lost** in `navigateToLicense` error path: previously a Quasar `notify({ color: 'negative' })` (red), now `toast({ message, timeout })` falls back to default styling — error toast no longer reads as an error.
- **Test suite broken end-to-end**: `FeatureComparisonTable.spec.ts` still imports `installQuasar`, looks for the `QTable` Vue component, asserts on the old Quasar column shape (`columns[1].name`/`.align` instead of `.id`/`.meta.align`), and accesses `wrapper.vm.pagination` / `wrapper.vm.columns` which are not exposed by the now-`<script setup>` component (no `defineExpose`).
- **Stale Quasar CSS custom properties** (`var(--q-primary)`, `var(--q-text-color)`) still hardcoded in both files; these still resolve via the global compatibility shim in `_variables.scss` but are technically a migration leftover.
- **Layout typo**: `tw:flex-col tw:flex-row` on the hero wrapper — contradictory classes, intent was almost certainly `tw:flex-col md:tw:flex-row`.

No `import … from "quasar"` runtime imports remain in the source files; the `useQuasar` hook is gone and `q-page`/`q-icon`/`q-spinner`/`q-badge`/`q-markup-table`/`q-table`/`q-tr`/`q-td` have all been replaced.

## Files Audited

- `/Users/ktx/Documents/Projects/openobserve.worktrees/ux-revamp/web/src/views/About.vue` (102 line diff vs main)
- `/Users/ktx/Documents/Projects/openobserve.worktrees/ux-revamp/web/src/components/about/FeatureComparisonTable.vue` (280 line diff vs main)
- `/Users/ktx/Documents/Projects/openobserve.worktrees/ux-revamp/web/src/components/about/FeatureComparisonTable.spec.ts` (4 line diff vs main — not actually migrated)

Cross-referenced:
- `web/src/lib/core/Table/OTable.{vue,types.ts}` — confirmed `pagination="none"`, `cell-<id>` slots, `meta.cellClass`, `accessorFn`, `size/minSize/maxSize`, `defaultColumns` all valid.
- `web/src/lib/core/Icon/OIcon.icons.ts` — confirmed icon names `workspaces`, `workspace-premium`, `compare-arrows`, `inventory-2`, `backpack`, `code`, `event`, `info`, `warning`, `shield`, `groups`, `javascript`, `language`, `settings` all registered.
- `web/src/lib/core/Badge/OBadge.types.ts` — `success`/`error` variants exist.
- `web/src/lib/core/Button/OButton.types.ts` — `primary` variant exists.
- `web/src/lib/feedback/Spinner/OSpinner.types.ts` — size `md` exists.
- `web/src/lib/feedback/Toast/OToast.types.ts` — `error` variant exists.
- `web/src/locales/languages/en.json` — all `about.*` i18n keys present.
- `web/src/App.vue` — theme is applied via `class="dark-theme | light-theme"` on `<router-view>`, **not** `body--dark`.

## Critical Issues

### C-1. Broken Tailwind v4 opacity (3 places) — License panels render as loud, opaque blocks
**File:** `web/src/views/About.vue`
**Lines:** 126, 186, 194

```html
<!-- L126: License info note -->
<div class="tw:mt-4 tw:p-3 tw:rounded tw:bg-opacity-10" :class="store.state.theme === 'dark' ? 'tw:bg-blue-400' : 'tw:bg-blue-500'">

<!-- L186: No license installed warning -->
<div class="tw:flex tw:items-start tw:gap-3 tw:p-4 tw:rounded tw:bg-opacity-10" :class="store.state.theme === 'dark' ? 'tw:bg-yellow-400' : 'tw:bg-yellow-500'">

<!-- L194: installation_id code chip -->
<code class="tw:px-2 tw:py-1 tw:rounded tw:bg-black tw:bg-opacity-10">
```

`bg-opacity-*` was **removed in Tailwind v4** (`tailwindcss ^4.1.18` per `web/package.json`). The class produces no output, so the bg colors apply at full opacity. Result:
- The "By using OpenObserve, you agree to comply…" note shows on a saturated solid blue background instead of a 10%-tinted panel.
- The "No License Installed" warning is a saturated yellow box.
- The installation_id `<code>` is solid black.

**Fix:** Replace `tw:bg-opacity-10` and the conditional color class with v4 slash-modifier syntax — e.g. `tw:bg-blue-500/10`, `tw:bg-yellow-500/10`, `tw:bg-black/10`. (See `web/src/plugins/traces/TraceEvaluationsView.vue:108` for an existing v4-correct example.)

**Solution:**
```diff
- <div class="tw:mt-4 tw:p-3 tw:rounded tw:bg-opacity-10" :class="store.state.theme === 'dark' ? 'tw:bg-blue-400' : 'tw:bg-blue-500'">
+ <div class="tw:mt-4 tw:p-3 tw:rounded" :class="store.state.theme === 'dark' ? 'tw:bg-blue-400/10' : 'tw:bg-blue-500/10'">

- <div class="... tw:rounded tw:bg-opacity-10" :class="store.state.theme === 'dark' ? 'tw:bg-yellow-400' : 'tw:bg-yellow-500'">
+ <div class="... tw:rounded" :class="store.state.theme === 'dark' ? 'tw:bg-yellow-400/10' : 'tw:bg-yellow-500/10'">

- <code class="tw:px-2 tw:py-1 tw:rounded tw:bg-black tw:bg-opacity-10">
+ <code class="tw:px-2 tw:py-1 tw:rounded tw:bg-black/10">
```

## Logical Issues

### L-1. Error toast lost its error styling on unauthorized "Manage License"
**File:** `web/src/views/About.vue`
**Lines:** 375–378

```ts
toast({
  message: "You are not authorized to manage the license.",
  timeout: 5000,
})
```

Previously (`git show main:web/src/views/About.vue`):
```ts
$q.notify({
  message: "You are not authorized to manage the license.",
  color: 'negative',
  timeout: 5000,
})
```

The migration dropped the `color: 'negative'` → never replaced with `variant: "error"`. The toast now renders with the default neutral styling, so a permission-denied message looks like a generic info notification.

**Fix:** Add `variant: "error"`.

Pre-existing (not a regression): the message is a hardcoded English string. An i18n key `about.not_authorized_manage_license` already exists in `web/src/locales/languages/en.json` and could be wired in opportunistically.

**Solution:**
```diff
  toast({
+   variant: "error",
-   message: "You are not authorized to manage the license.",
+   message: t("about.not_authorized_manage_license"),
    timeout: 5000,
  })
```

### L-2. `currentPlanName` computed value is dead code
**File:** `web/src/components/about/FeatureComparisonTable.vue`
**Lines:** 214–218

`const currentPlanName = computed(...)` is declared but is not used in the template and is not exposed (the file is `<script setup>`). Same as pre-revamp main, but worth flagging during cleanup.

**Solution:**
```diff
- const currentPlanName = computed(() => { /* ... */ });
```

## CSS / Layout Issues

### S-1. Contradictory flex direction in hero row
**File:** `web/src/views/About.vue`
**Line:** 23

```html
<div class="tw:flex tw:flex-col tw:flex-row tw:items-center tw:justify-between tw:gap-8">
```

`tw:flex-col` and `tw:flex-row` are mutually exclusive. The later wins (`flex-row`, which is also the Tailwind default), so `flex-col` is a no-op. The intent was almost certainly the mobile-first stack + desktop row pattern, i.e. `tw:flex-col md:tw:flex-row`. As-is, the logo/version block sits side-by-side with the stats grid even on narrow viewports.

**Solution:**
```diff
- <div class="tw:flex tw:flex-col tw:flex-row tw:items-center tw:justify-between tw:gap-8">
+ <div class="tw:flex tw:flex-col md:tw:flex-row tw:items-center tw:justify-between tw:gap-8">
```

### S-2. Dark-theme striped-row CSS won't apply (`body--dark` no longer added)
**File:** `web/src/components/about/FeatureComparisonTable.vue`
**Lines:** 358–364

```scss
:deep(.body--dark .feature-comparison-table tbody tr:nth-child(even)) {
  background: rgba(255, 255, 255, 0.03);
  &:hover { background: rgba(33, 150, 243, 0.08); }
}
```

`body--dark` was a Quasar-managed class. In the revamp the active theme is communicated via `class="dark-theme | light-theme"` on `<router-view>` (see `web/src/App.vue:19`). No code path applies `body--dark` in this branch (verified via grep — only read by `convertLogData.ts` and `PredefinedThemes.vue`, never written outside of test setup). The dark-mode zebra striping for the feature comparison table therefore never engages.

**Fix:** Either replace the selector with `:deep(.dark-theme .feature-comparison-table tbody tr:nth-child(even))` (or scope using a sibling selector that includes `.dark-theme`) or remove if striping is no longer desired.

**Solution:**
```diff
- :deep(.body--dark .feature-comparison-table tbody tr:nth-child(even)) {
+ :deep(.dark-theme .feature-comparison-table tbody tr:nth-child(even)) {
    background: rgba(255, 255, 255, 0.03);
    &:hover { background: rgba(33, 150, 243, 0.08); }
  }
```

### S-3. Stale `var(--q-primary)` and `var(--q-text-color)` references
**Files / Lines:**
- `web/src/views/About.vue` — `--q-primary` at lines 599, 617, 630, 637 (link-badge, external-link, inline-link styles)
- `web/src/components/about/FeatureComparisonTable.vue` — `--q-text-color` at lines 310, 335

These still resolve because `web/src/styles/_variables.scss` aliases `--q-primary: var(--o2-theme-color);` (lines 366, 517, 550) for back-compat, but they're explicit Quasar leftovers. Replace with the underlying O2 tokens (`--o2-theme-color`, the appropriate `--o2-text-color-*`) for consistency with the rest of the revamp.

**Solution:**
```diff
- color: var(--q-primary);
- color: var(--q-text-color);
+ color: var(--o2-theme-color);
+ color: var(--o2-text-primary);
```

### S-4. `feature-card1` block is dead CSS (pre-existing)
**File:** `web/src/views/About.vue`
**Lines:** 543–555

The `.feature-card1` selector is defined but never referenced in the template (template uses `feature-card`, not `feature-card1`). Already dead in `main`, so not a revamp regression — flagging for cleanup.

**Solution:**
```diff
- .feature-card1 {
-   /* ~12 lines of orphan rules */
- }
```

### S-5. `link-badge` hover transform may now clip
The `.link-badge:hover { transform: translateY(-2px); box-shadow: 0 4px 12px rgba(33, 150, 243, 0.15); }` style still works, but the parent `.tw:flex-wrap tw:gap-2` row has no extra padding to accommodate the hovered card's shadow. Cosmetic — leave as-is unless reviewing visuals.

**Solution:**
```diff
- <div class="tw:flex tw:flex-wrap tw:gap-2">
+ <div class="tw:flex tw:flex-wrap tw:gap-2 tw:py-2">
```

## Component Migration Issues

### M-1. `OIcon` migration looks clean
All `q-icon name="…"` → `OIcon name="…"` translations are sane:
- `workspace_premium` → `workspace-premium`
- `inventory_2` → `inventory-2`
- `compare_arrows` → `compare-arrows`
- `backpack` (sizeless q-icon) → `OIcon name="backpack" size="sm"` (now explicit, good)

Pixel sizes mapped to semantic sizes — mostly sensible:
- `size="32px"` → `size="lg"`
- `size="24px"` → `size="md"`
- `size="16px"`/`size="20px"` → `size="sm"`
- One inconsistency: original `q-icon name="javascript" size="16px"` (L92 today) became `OIcon name="javascript" size="md"` — every other 16px went to `sm`. Verify intent.

**Solution:**
```diff
- <OIcon name="javascript" size="md" />
+ <OIcon name="javascript" size="sm" />
```

### M-2. `q-table` → `OTable` migration is structurally correct
- `:rows` → `:data`
- `pagination` ref `{ rowsPerPage: 0 }` + `hide-pagination` → `pagination="none"` (correct)
- Per-cell `<q-td :props="props">` with conditional `:class="{ 'highlighted-column': … }"` → `meta.cellClass` baked into the column def via `buildType === '...'` ternary (clean idiomatic OTable usage)
- `<template v-slot:body="props">` → `<template #cell-<id>="{ row }">` slots (matches `OTable.vue:461-468`)
- Column shape converted from Quasar (`name`/`field`/`label`/`align`/`style`) to OTable (`id`/`accessorFn`/`header`/`meta.align`/`size`)

One non-broken caveat: `meta.cellClass` is computed once from `const buildType = store.state.zoConfig.build_type` at setup-time (L123). If `build_type` could ever change reactively (it can't in practice — it's a build-time config), highlights would stale. Not a defect for this codebase.

**Solution:** No code change required — `build_type` is a build-time config.

### M-3. `q-badge color="red|green"` → `OBadge variant="error|success"` is correct
**File:** `web/src/views/About.vue` lines 212–214 (license status badge). Variants validated against `OBadge.types.ts`.

**Solution:** No change required — migration is correct.

### M-4. `q-spinner` → `OSpinner`
**Line:** 181. `q-spinner size="40px" color="primary"` → `OSpinner size="md"`. Size mapping is fine; color is no longer settable on OSpinner but the design intentionally bakes color in.

**Solution:** No change required — migration is correct.

### M-5. `q-markup-table` → native `<table>` with Tailwind borders
**Lines:** 203–230, 234–258. Manual port to native table elements with `tw:border-collapse`, `tw:border-[var(--o2-border-color)]` etc. Renders correctly. Verbose but valid; consider extracting a small `OMarkupTable` helper if this pattern recurs (out of scope for this audit).

**Solution:** No change required — migration is correct.

### M-6. `useQuasar()`/`$q.notify` removed cleanly
The `useQuasar` import and `const $q = useQuasar()` line are gone; the single `$q.notify` call has been replaced (see L-1 for the missing variant).

**Solution:** No change required — see L-1 for the missing variant fix.

## Test File Issues

### T-1. `FeatureComparisonTable.spec.ts` is largely unrunnable
**File:** `web/src/components/about/FeatureComparisonTable.spec.ts`
**Diff vs main:** only 4 lines changed (one assertion swapped from `.q-icon` to `OIcon`). The rest is unmodified Quasar-era code.

Specific failures the spec will produce against the migrated component:

1. **L19, L23 — `installQuasar()`** still imported and invoked. The helper file `web/src/test/unit/helpers/install-quasar-plugin.ts` does still exist on this branch, but using it pulls Quasar into the test, which is the opposite of what the migration aims for.
2. **L73, L465 — `wrapper.findComponent({ name: "QTable" })`** will return a non-existent component (the template now renders `OTable`). All `table.exists()` assertions fail.
3. **L113–116 — `wrapper.vm.columns[1].name === "opensource"`** — wrong on two counts: (a) the new column shape uses `id`, not `name`; (b) `columns` is a `<script setup>` top-level constant — without `defineExpose`, it's not accessible on `wrapper.vm`.
4. **L243, L468 — `wrapper.vm.pagination.rowsPerPage`** — no `pagination` ref exists anymore; the table uses `pagination="none"` literal.
5. **L412–415 — `vm.columns[0].align`** — `align` moved into `meta.align`, so this assertion is wrong even if `columns` were exposed.
6. **L223 — `iconWrapper.findComponent({ name: "OIcon" })`** — this is the *one* assertion that was updated and looks correct.

The test file needs a complete rewrite against the new API.

**Solution:**
```diff
- wrapper.findComponent({ name: "QTable" })
+ wrapper.findComponent({ name: "OTable" })
- expect(wrapper.vm.columns[1].name).toBe("opensource")
+ expect(wrapper.vm.columns[1].id).toBe("opensource")
- expect(wrapper.vm.pagination.rowsPerPage).toBe(0)
+ // OTable uses pagination="none" — no per-component value to assert
- vm.columns[0].align
+ vm.columns[0].meta?.align
// Add `defineExpose({ columns })` in component if columns need test access.
```

### T-2. About.vue itself has no spec
`web/src/views/About.vue` has no companion `.spec.ts` in this branch (also true on main). Not a regression, but worth noting given the heavy template surface area.

**Solution:** Not in current scope; flag for a follow-up to add `web/src/views/About.spec.ts`.

## Accessibility

### A-1. Decorative icons missing aria-hidden
All `<OIcon>` instances in About.vue are purely decorative (next to a visible label). They should pass `aria-hidden="true"` (or OIcon should default to it for label-less usage). Several anchors like the GitHub/Website/Cargo.toml link-badges have visible text, so screen-reader users will hear the icon and the duplicated text. Worth confirming with OIcon's default a11y attributes.

**Solution:**
```diff
- <OIcon name="workspaces" size="lg" />
+ <OIcon name="workspaces" size="lg" aria-hidden="true" />
```

### A-2. External link semantics
The `<a href target="_blank">` links to Cargo.toml, package.json, npmjs.com, crates.io, GitHub, Website are missing `rel="noopener noreferrer"`. Already missing on main — not a regression — but recommended for any anchor with `target="_blank"`.

**Solution:**
```diff
- <a :href="link.url" target="_blank">
+ <a :href="link.url" target="_blank" rel="noopener noreferrer">
```

### A-3. Logo `<img>` missing `alt`
**Line:** 25-33. The OpenObserve logo image has no `alt` attribute. Already missing on main, but worth fixing alongside the revamp.

**Solution:**
```diff
- <img :src="logoSrc" />
+ <img :src="logoSrc" alt="OpenObserve logo" />
```

### A-4. Status icons are raw emoji
Inside the comparison table, ✅/❌ are emoji glyphs without any text alternative. Screen readers may or may not announce these depending on locale settings. Add `aria-label` to the `<span class="status-icon">` (e.g. `"Available"` / `"Not available"`) or include visually-hidden text.

**Solution:**
```diff
- <span class="status-icon">{{ available ? "✅" : "❌" }}</span>
+ <span class="status-icon" role="img" :aria-label="available ? t('about.available') : t('about.notAvailable')">
+   {{ available ? "✅" : "❌" }}
+ </span>
```

## Recommendations

Priority order:

1. **(C-1)** Replace the three `tw:bg-opacity-10` usages with Tailwind v4 slash-modifier syntax — this is the only **user-visible rendering bug**.
2. **(L-1)** Add `variant: "error"` to the `toast()` call in `navigateToLicense`.
3. **(S-1)** Fix the contradictory `tw:flex-col tw:flex-row` to `tw:flex-col md:tw:flex-row`.
4. **(S-2)** Replace the `:deep(.body--dark …)` selector with the new `.dark-theme` class (or drop the rule).
5. **(T-1)** Rewrite `FeatureComparisonTable.spec.ts` against OTable/OIcon — strip `installQuasar`, drop `wrapper.vm.columns` access (or add `defineExpose`), and assert against `OTable`/cell slots instead of `QTable`.
6. **(S-3)** Replace `var(--q-primary)` / `var(--q-text-color)` with the underlying `--o2-…` tokens for consistency.
7. Cleanup: remove dead `feature-card1` block, unused `currentPlanName` computed, and the unused `pageData` ref in About.vue setup.
8. **(A-1..A-4)** Apply the accessibility nits — `alt` on logo, `rel="noopener noreferrer"` on external links, `aria-label` on status icons, decorative `aria-hidden` on label-adjacent OIcons.

## Class-Level Styling Audit

### 1. Quasar Class Leftovers
| File:Line | Class | Replacement | Layer |
|---|---|---|---|
| *(none found in About template — all q-* eliminated)* | | | |

### 2. Tailwind v4 Misuse
| File:Line | Wrong | Right | Layer |
|---|---|---|---|
| About.vue:23 | `tw:flex tw:flex-col tw:flex-row` (conflicting) | choose one — drop `tw:flex-col` for horizontal layout | file-scoped |
| About.vue:126 | `tw:bg-opacity-10` | `/10` opacity suffix (e.g., `tw:bg-blue-500/10`) | file-scoped |
| About.vue:186 | `tw:bg-opacity-10` | `/10` opacity suffix | file-scoped |
| About.vue:194 | `tw:bg-opacity-10` | `tw:bg-black/10` | file-scoped |

### 3. Quasar CSS Variables
| File:Line | Variable | Replacement | Layer |
|---|---|---|---|
| About.vue:599 | `var(--q-primary)` | `var(--o2-primary)` | file-scoped |
| About.vue:617 | `var(--q-primary)` | `var(--o2-primary)` | file-scoped |
| About.vue:630 | `var(--q-primary)` | `var(--o2-primary)` | file-scoped |
| About.vue:637 | `var(--q-primary)` | `var(--o2-primary)` | file-scoped |

### 4. Dead `:deep(.q-*)` / `body.body--dark` / `::v-deep`
| File:Line | Selector | Action | Layer |
|---|---|---|---|
| *(none found)* | | | |

### 5. Quasar SCSS Variables in Scoped Styles
| File:Line | Variable | Replacement | Layer |
|---|---|---|---|
| *(none found)* | | | |

### 6. Quasar Directives
| File:Line | Directive | Action |
|---|---|---|
| *(none found)* | | |

### 7. Icon Migration
| File:Line | Issue | Fix |
|---|---|---|
| *(none found)* | | |

### 8. Inline `style=` Hot Spots
| File:Line | Inline style | Suggested home |
|---|---|---|
| About.vue:139 | `min-height: 120px;` | scoped `.about-card-tile` class |

### 9. Duplicate Style Blocks
| Files | Duplicated block | Suggested partial |
|---|---|---|
| About.vue:65,109,140 | repeating `tw:flex tw:items-center tw:gap-3 tw:mb-3` headings | extract `.about-section-heading` class |

### 10. Layer Summary
- Global (`app.scss`) changes needed: 0
- Component-level partial changes: 1 (about-section-heading)
- File-level scoped changes: ~8 (4 q-primary vars, 3 bg-opacity, 1 conflicting flex)
