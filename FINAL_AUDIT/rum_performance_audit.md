# RUM Performance Page — Quasar Removal Audit

## Summary

Audited the RUM Performance pages (Performance Summary / Web Vitals / Errors / API dashboards plus the host AppPerformance shell and MetricCard) on the `feat/ux-revamp-main` branch vs `main`. The migration off Quasar is mostly mechanical (q-page → div, q-spinner-hourglass → OSpinner, q-icon → OIcon, q-tooltip → OTooltip, q-linear-progress → OProgressBar). However several non-trivial defects were introduced:

- A broken icon name in `MetricCard.vue` (`check_circle` is not registered — only `check-circle`).
- All status-color hints on icons are lost because `OIcon` does not accept a `color` prop.
- The web-vitals info-banner background relies on Quasar utility classes (`bg-indigo-7`, `bg-indigo-2`) that no longer resolve under the Tailwind `tw:` prefix.
- A stray `q-pb` Quasar leftover plus several stale Quasar utility classes (`relative-position`, `full-width`, `text-dark`) and several `q-table` deep selectors that target components that no longer render `.q-table`/`.q-btn`.
- 4 of 4 performance spec files have selectors that will no longer match (`.q-pb-lg.flex.items-center`, `.OIcon`, `text-dark` etc).
- A leftover `WebVitalsDashboard.spec.ts.backup` file that should be deleted.

## Files Audited

| Path | Change Summary |
|---|---|
| `web/src/views/RUM/AppPerformance.vue` | q-icon→OIcon via icon-left, q-tooltip→OTooltip, q-* utilities → tw:* |
| `web/src/components/rum/performance/PerformanceSummary.vue` | q-spinner-hourglass→OSpinner, q-* utilities → tw:* |
| `web/src/components/rum/performance/WebVitalsDashboard.vue` | q-page→div, q-icon→OIcon, q-spinner-hourglass→OSpinner |
| `web/src/components/rum/performance/ErrorsDashboard.vue` | q-page→div, q-spinner-hourglass→OSpinner |
| `web/src/components/rum/performance/ApiDashboard.vue` | q-spinner-hourglass→OSpinner |
| `web/src/components/rum/common/performance/MetricCard.vue` | q-icon→OIcon, q-linear-progress→OProgressBar |
| `web/src/components/rum/common/PerformanceMetrics.vue` | `text-grey-6` → `tw:text-gray-400` |
| `web/src/composables/rum/usePerformance.ts` | No change |
| `web/src/components/rum/common/performance/{Action,View,Resource,Error}PerformanceMetrics.vue` | No change (uses MetricCard) |
| Spec files: AppPerformance, PerformanceSummary, WebVitalsDashboard, ErrorsDashboard, ApiDashboard, MetricCard, PerformanceMetrics | Stubs removed/renamed; several selectors not updated |
| `web/src/components/rum/performance/WebVitalsDashboard.spec.ts.backup` | Leftover backup file (~35 KB) |

## Critical Issues

### C1. `check_circle` icon is not in the icon registry → broken "good" status icon

`web/src/components/rum/common/performance/MetricCard.vue:146`
```js
const icons = {
  good: "check_circle",          // <- underscore, NOT in registry
  "needs-improvement": "warning",
  poor: "error",
};
```

The new `OIcon` registry only has `"check-circle"` (hyphen) — see `web/src/lib/core/Icon/OIcon.icons.ts:314`. There is no key `"check_circle"`. When `status === "good"`, the icon name resolves to an entry that does not exist in `iconRegistry`, so `<component :is="iconComponent">` becomes `<component :is="undefined">` and Vue renders an empty `<!---->`.

Net effect: every "good" Web Vital / API metric card loses its check-mark indicator. The yellow/red ones still work because `"warning"` and `"error"` exist in the registry (`OIcon.icons.ts:376` and `:326`).

**Solution:**
```diff
  const icons = {
-   good: "check_circle",
+   good: "check-circle",
    "needs-improvement": "warning",
    poor: "error",
  };
```

### C2. `OIcon` ignores the `:color` prop → all status color hints are lost

`web/src/components/rum/common/performance/MetricCard.vue:25-40`
```vue
<OIcon v-if="icon" :name="icon" size="sm" :color="statusColor" />
...
<OIcon v-if="status" :name="statusIcon" size="sm" :color="statusColor" />
```

`statusColor` returns Quasar palette names (`positive`, `warning`, `negative`, `grey` — see lines 154-164). `OIcon` (`web/src/lib/core/Icon/OIcon.types.ts`) only accepts `name`, `size`, `label`. There is no `color` prop. The attribute falls through to the root `<span>` as `color="positive"` which has no effect on SVG fill — SVG inherits `currentColor`. So **every metric icon in the card renders in the inherited text color, not green/yellow/red**.

Recommendation: either add a `color`/`tone` prop to `OIcon` that maps to Tailwind text-color classes, or set the icon container color in the MetricCard via `:class` that maps `props.status → text-green-600 / text-yellow-600 / text-red-600`.

**Solution:**
```diff
- <OIcon v-if="icon" :name="icon" size="sm" :color="statusColor" />
- <OIcon v-if="status" :name="statusIcon" size="sm" :color="statusColor" />
+ <span :class="statusTextClass">
+   <OIcon v-if="icon" :name="icon" size="sm" />
+ </span>
+ <span :class="statusTextClass">
+   <OIcon v-if="status" :name="statusIcon" size="sm" />
+ </span>
+ // computed:
+ const statusTextClass = computed(() => ({
+   good: "tw:text-[var(--o2-positive)]",
+   "needs-improvement": "tw:text-[var(--o2-warning)]",
+   poor: "tw:text-[var(--o2-negative)]",
+ }[props.status ?? ""] ?? "tw:text-gray-400"));
```

### C3. Web Vitals info-banner has no background under Tailwind prefix mode

`web/src/components/rum/performance/WebVitalsDashboard.vue:27`
```vue
:class="store.state.theme === 'dark' ? 'bg-indigo-7' : 'bg-indigo-2'"
```

The Tailwind setup uses `prefix(tw)` (`web/src/styles/tailwind.css:1`), so the only Tailwind utility names are of the form `tw:bg-indigo-*`. `bg-indigo-2` / `bg-indigo-7` are **Quasar palette utilities** (Quasar uses numeric scales 1–14) that no longer exist now that Quasar's CSS is gone. The banner now has no background tint in either theme — the highlighted "Learn more about Web Vitals" pill is invisible against the page background.

Recommendation: change to `tw:bg-indigo-900/20` (dark) / `tw:bg-indigo-50` (light) — both classes already appear in the compiled CSS and are referenced elsewhere in the codebase.

**Solution:**
```diff
- :class="store.state.theme === 'dark' ? 'bg-indigo-7' : 'bg-indigo-2'"
+ :class="store.state.theme === 'dark' ? 'tw:bg-indigo-900/20' : 'tw:bg-indigo-50'"
```

### C4. Stray `q-pb` Quasar leftover

`web/src/components/rum/performance/PerformanceSummary.vue:34`
```vue
<div class="tw:flex tw:items-center q-pb tw:pt-3 tw:text-base tw:font-medium tw:font-bold">
```

`q-pb` is an incomplete/stripped Quasar class (was probably `q-pb-md` or similar). It's effectively dead. Also note the redundant pair `tw:font-medium tw:font-bold` — only the latter will win.

**Solution:**
```diff
- <div class="tw:flex tw:items-center q-pb tw:pt-3 tw:text-base tw:font-medium tw:font-bold">
+ <div class="tw:flex tw:items-center tw:pb-4 tw:pt-3 tw:text-base tw:font-bold">
```

## Logical Issues

### L1. `progress-bar-default` will *always* show green on "good" metrics — but loses neutral state

`web/src/components/rum/common/performance/MetricCard.vue:170-178`
```js
const progressVariant = computed(() => {
  if (!props.status) return "default";
  const map: Record<string, string> = {
    good: "default",
    "needs-improvement": "warning",
    poor: "danger",
  };
  return map[props.status] || "default";
});
```

`OProgressBar` only has three variants: `default`, `warning`, `danger` (see `web/src/lib/data/ProgressBar/OProgressBar.vue:23-27`). The old code used `q-linear-progress :color="statusColor"` where `statusColor` was `"positive"` (green) on `good` and `"grey"` on no status — i.e. two visually distinct states. Now both no-status and good-status map to `"default"`, so a metric without a status renders the **same color** as a "good" metric, which is misleading. Minor UX regression.

**Solution:**
Either (a) add a `success` variant to `OProgressBar`, or (b) override the bar's color via wrapper class:
```diff
- const progressVariant = computed(() => {
-   if (!props.status) return "default";
-   const map = { good: "default", "needs-improvement": "warning", poor: "danger" };
-   return map[props.status] || "default";
- });
+ const progressVariant = computed(() => {
+   const map: Record<string, string> = {
+     good: "success", "needs-improvement": "warning", poor: "danger",
+   };
+   return map[props.status ?? ""] || "default";
+ });
```
(Requires adding `success` to OProgressBar variants.)

### L2. Dead `.q-btn` deep-selector styles in AppPerformance

`web/src/views/RUM/AppPerformance.vue:456-467`
```scss
:deep(.app-performance-auto-refresh-interval) {
  .q-btn {
    height: 1.9rem !important;
    min-height: 1.9rem !important;
    border-radius: 0.375rem !important;
    padding: 0.125rem 0.25rem !important;
    &:hover { background-color: var(--o2-hover-accent); }
  }
}
```

`AutoRefreshInterval.vue` was migrated to render `<OButton>`, which does **not** add a `.q-btn` class. None of these declarations apply, so the auto-refresh button no longer gets the custom 1.9 rem compact sizing/padding/hover. Visual sizing inside the toolbar row may now be inconsistent with the neighbouring refresh button.

**Solution:**
```diff
  :deep(.app-performance-auto-refresh-interval) {
-   .q-btn {
+   .o-button {
      height: 1.9rem !important;
      min-height: 1.9rem !important;
      border-radius: 0.375rem !important;
      padding: 0.125rem 0.25rem !important;
      &:hover { background-color: var(--o2-hover-accent); }
    }
  }
```

### L3. Dead `.q-table` styles in `ApiDashboard.vue`, `WebVitalsDashboard.vue`, `PerformanceSummary.vue`, `AppPerformance.vue`

Examples:
- `web/src/views/RUM/AppPerformance.vue:440-445`
- `web/src/components/rum/performance/ApiDashboard.vue:325-330, 347-362`
- `web/src/components/rum/performance/WebVitalsDashboard.vue:278-283`
- `web/src/components/rum/performance/PerformanceSummary.vue:343-348`
- `web/src/components/rum/performance/ErrorsDashboard.vue:197-203`

All target `.q-table`/`.q-table__top`. RUM performance does not render any QTable anymore — this is leftover cruft that increases file size with no effect. Safe to delete.

**Solution:**
```diff
- :deep(.q-table) { ... }
- :deep(.q-table__top) { padding: 0; }
+ // Delete these dead :deep(.q-*) blocks entirely
```

### L4. Loss of "hourglass" spinner visual

All four performance dashboards swapped `<q-spinner-hourglass>` for `<OSpinner size="md">`. `OSpinner` only offers `ring` (default) and `dots` variants (`web/src/lib/feedback/Spinner/OSpinner.vue:7`). The hourglass animation is gone. Not a bug per se, but it's a deliberate visual regression worth flagging since the dashboards take time to load and the spinner is the primary affordance.

**Solution:**
```diff
- <OSpinner size="md" />
+ <OSpinner variant="dots" size="md" />
```
Or add an `hourglass` variant to `OSpinner` if the original animation is required.

## CSS / Layout Issues

### CSS1. Quasar utility classes still in source — no Tailwind equivalent rendered

| File:line | Class | Status |
|---|---|---|
| `WebVitalsDashboard.vue:20` | `relative-position` | Quasar utility — **NOT** in built CSS (`text-dark` and `relative-position` are absent from `dist/assets/index-*.css`). Replace with `tw:relative`. |
| `WebVitalsDashboard.vue:27` | `bg-indigo-7` / `bg-indigo-2` | See C3. |
| `WebVitalsDashboard.vue:40` | `text-white` (still works — it survives in built CSS) vs `tw:text-gray-800` (light) | Inconsistent: one is legacy Quasar, the other tailwind. Use `tw:text-white` for symmetry. |
| `ErrorsDashboard.vue:20` | `relative-position` | Same as above. |
| `ApiDashboard.vue:21` | `relative-position` | Same as above. |
| `PerformanceSummary.vue:20` | `relative-position` | Same as above. |
| `PerformanceSummary.vue:34` | `q-pb` | See C4. |

**Solution:**
```diff
- <div class="relative-position">
- <span class="text-white">
- <span class="text-dark">
+ <div class="tw:relative">
+ <span class="tw:text-white">
+ <span class="tw:text-gray-800">
```

### CSS2. OIcon's extra `material-symbols-outlined` class is misleading

`web/src/components/rum/performance/WebVitalsDashboard.vue:32`
```vue
<OIcon name="info" size="sm" class="material-symbols-outlined tw:mr-1" />
```

OIcon renders an `~icons/material-symbols/info-outline` import, not a Material Symbols font glyph. The `material-symbols-outlined` class is a dead Quasar/Material-icons-font leftover that does nothing now. Same pattern likely exists elsewhere — safe to drop.

**Solution:**
```diff
- <OIcon name="info" size="sm" class="material-symbols-outlined tw:mr-1" />
+ <OIcon name="info" size="sm" class="tw:mr-1" />
```

### CSS3. AppPerformance has a `card-container` `:deep` rule that may not target anything

`web/src/views/RUM/AppPerformance.vue:447-454`

`.card-container` is a class on the outer wrapper of the template, but `:deep(.card-container)` (scoped style) only applies to children. Since `.card-container` is on the same root element of this component, this rule may not fire. Was this rule supposed to target nested `.card-container` inside `router-view` children? In the migration the wrapper element class kept its old name, but the inner content layout was rewritten — worth visually verifying that the shadow/padding override still applies.

**Solution:**
```diff
- :deep(.card-container) { /* targets children, not root */ }
+ // For root element, drop :deep wrapper:
+ .card-container { /* applies via scoped attribute on root */ }
+ // Or use :global if needed for nested card containers in router-view
```

## Component Migration Issues

### M1. `<OIcon>` registration in WebVitalsDashboard has a formatting glitch (cosmetic)

`web/src/components/rum/performance/WebVitalsDashboard.vue:96-102`
```js
components: {
  RenderDashboardCharts,
  OSpinner,
  OIcon,
},                      <-- closing brace is flush-left
```
Closing brace is mis-indented but valid JS.

**Solution:**
```diff
  components: {
    RenderDashboardCharts,
    OSpinner,
    OIcon,
- },
+ },
```
(Run prettier/eslint --fix to normalize.)

### M2. `<OTooltip>` placement inside `<OButton>` works but is non-obvious

`web/src/views/RUM/AppPerformance.vue:42-50`
```vue
<OButton icon-left="refresh" ...>
  <OTooltip :content="..." />
</OButton>
```

`OTooltip` in child mode (no default slot) attaches to its `parentElement` via a hidden anchor span (`web/src/lib/overlay/Tooltip/OTooltip.vue:36-50`). This works because the anchor is rendered inside the OButton's default slot, so `parentElement` is the OButton root. Functional. A more readable pattern would be `<OTooltip :content="...">…OButton…</OTooltip>` wrapping or `aria-label`+`title` directly on the button.

**Solution:**
```diff
- <OButton icon-left="refresh" ...>
-   <OTooltip :content="..." />
- </OButton>
+ <OTooltip :content="...">
+   <OButton icon-left="refresh" ... />
+ </OTooltip>
```

### M3. `OIcon` does not accept `color` — silent drop, not a Vue warning

Repeats of C2. Affects every status-icon and primary-icon usage in `MetricCard.vue`.

**Solution:** See C2 fix — wrap OIcon in a span with `tw:text-[var(--o2-positive|warning|negative)]` class.

## Test File Issues

### T1. `WebVitalsDashboard.spec.ts:229` — selector `.q-pb-lg.flex.items-center` no longer exists

```js
it("should show loading spinner when isLoading has items", async () => {
  ...
  const loadingDiv = wrapper.find(".q-pb-lg.flex.items-center");
  expect(loadingDiv.exists()).toBe(true);   // ⇒ false now
});
```

The loading container was migrated to `tw:pb-4 tw:flex tw:items-center …`. Test will fail. Replace with `[data-test=...]` or `.tw\\:pb-4.tw\\:flex.tw\\:items-center`.

**Solution:**
```diff
- const loadingDiv = wrapper.find(".q-pb-lg.flex.items-center");
+ const loadingDiv = wrapper.find("[data-test='web-vitals-loading']");
```
(Add `data-test="web-vitals-loading"` to the loading div in the source for stable selection.)

### T2. `WebVitalsDashboard.spec.ts:426, :438, :441` — `bg-indigo-*` / `text-dark` no longer applied

```js
expect(infoSection.classes()).toContain("bg-indigo-7");  // still passes (string match on class attr)
expect(externalLink.classes()).toContain("text-dark");   // <- FAILS, source now uses tw:text-gray-800
```

`text-dark` was changed to `tw:text-gray-800` in source — this assertion now fails. The `bg-indigo-*` ones pass only because Vue mirrors the class string into the DOM, but they no longer correspond to any real CSS rule (see C3).

**Solution:**
```diff
- expect(infoSection.classes()).toContain("bg-indigo-7");
- expect(externalLink.classes()).toContain("text-dark");
+ expect(infoSection.classes()).toContain("tw:bg-indigo-900/20");
+ expect(externalLink.classes()).toContain("tw:text-gray-800");
```

### T3. `ApiDashboard.spec.ts:287` — same stale `.q-pb-lg` selector

```js
const loadingDiv = wrapper.find(".q-pb-lg.flex.items-center");
expect(loadingDiv.exists()).toBe(true);   // ⇒ false now
```

**Solution:**
```diff
- const loadingDiv = wrapper.find(".q-pb-lg.flex.items-center");
+ const loadingDiv = wrapper.find("[data-test='api-dashboard-loading']");
```

### T4. `MetricCard.spec.ts` queries `.OIcon` — real OIcon does not add that class

`web/src/components/rum/common/performance/MetricCard.spec.ts:47, 59, 153, 172, 191`

```js
const icon = wrapper.find('.OIcon[aria-hidden="true"]');   // never matches
const icons = wrapper.findAll('.OIcon');                   // always 0
```

The new `OIcon.vue` renders `<span class="tw:inline-flex tw:shrink-0 tw:items-center tw:justify-center tw:align-middle tw:size-4">` — no `.OIcon` class. The test was mechanically rewritten from `.q-icon` → `.OIcon` (Quasar's q-icon had a `.q-icon` selector, but the new OIcon does not have an equivalent class hook). All `.OIcon`-based assertions in this file will silently fail (return empty/false). Fix by either:
1. Adding `class="OIcon"` to the OIcon root in OIcon.vue (would benefit selectors across the codebase), OR
2. Using `wrapper.findComponent(OIcon)` / `wrapper.findAll(...)` by component name, OR
3. Targeting `[aria-hidden="true"]` alone.

**Solution:**
```diff
- const icon = wrapper.find('.OIcon[aria-hidden="true"]');
- const icons = wrapper.findAll('.OIcon');
+ import OIcon from "@/lib/core/Icon/OIcon.vue";
+ const icon = wrapper.findComponent(OIcon);
+ const icons = wrapper.findAllComponents(OIcon);
```

### T5. `WebVitalsDashboard.spec.ts:107` — leftover odd indentation in stubs block

```js
stubs: {
            "OIcon": {
  name: "OIcon",
  ...
},
```

The indentation has 12 spaces of leading whitespace pushed in by what looks like a mechanical edit. Cosmetic only — the stub still works.

**Solution:** Run `npx prettier --write web/src/components/rum/performance/WebVitalsDashboard.spec.ts`.

### T6. Leftover `WebVitalsDashboard.spec.ts.backup` (~35 KB)

`web/src/components/rum/performance/WebVitalsDashboard.spec.ts.backup`

Contains old Quasar-based stubs (`q-page`, `q-icon`, `q-spinner-hourglass`). Not picked up by Vitest because of the `.backup` extension, but pollutes the repo and is sometimes mistakenly searched. Delete.

**Solution:**
```diff
- rm web/src/components/rum/performance/WebVitalsDashboard.spec.ts.backup
```

### T7. AppPerformance.spec.ts has odd indentation after QPage removal

`web/src/views/RUM/AppPerformance.spec.ts:161, 272, 297`

```js
stubs: {
                    QSeparator: {
  template: '<hr class="q-separator" />',
},
```

24 spaces of leading whitespace — same mechanical-edit artifact as T5. Cosmetic.

**Solution:** Run `npx prettier --write web/src/views/RUM/AppPerformance.spec.ts`.

## Accessibility

### A1. Refresh button has no accessible label

`web/src/views/RUM/AppPerformance.vue:42-50`

The button has only `icon-left="refresh"` and an `OTooltip` (visual only). No `aria-label`, no visible text. Screen-readers will announce "button" with no name. The old Quasar version had the same issue, so this is **pre-existing**, not a regression. Worth fixing while in the area:

```vue
<OButton
  icon-left="refresh"
  :aria-label="isVariablesChanged ? t('dashboard.refreshToApplyVariableChanges') : t('dashboard.refresh')"
  ...
```

**Solution:**
```diff
- <OButton icon-left="refresh" ...>
+ <OButton
+   icon-left="refresh"
+   :aria-label="isVariablesChanged ? t('dashboard.refreshToApplyVariableChanges') : t('dashboard.refresh')"
+   ...
+ >
```

### A2. Loading state has no live-region semantics

All four dashboard files render a `<div v-show="isLoading.length">…</div>` block. The OSpinner inside already has `role="status" aria-label="Loading"` (`OSpinner.vue:38-40`), so this is acceptable. No regression.

**Solution:** No action needed - OSpinner already provides `role="status"` and `aria-label`.

## Recommendations

1. **Critical fixes (block release):**
   - Change `"check_circle"` → `"check-circle"` in `MetricCard.vue:146`.
   - Replace `bg-indigo-7` / `bg-indigo-2` with `tw:bg-indigo-900/20` / `tw:bg-indigo-50` in `WebVitalsDashboard.vue:27`.
   - Re-introduce a color/tone affordance for OIcon (or apply `text-*` classes in MetricCard wrapper) so good/needs-improvement/poor icons are visually distinguishable.
   - Update the four failing tests (T1, T2, T3, T4) so CI does not silently start green-skipping these checks.

2. **Cleanup:**
   - Drop `q-pb`, `relative-position`, `full-width`, `text-dark`, `material-symbols-outlined` leftovers (replace `relative-position` with `tw:relative`).
   - Delete the dead `.q-table` and `.q-btn` `:deep` blocks in all five files.
   - Delete `web/src/components/rum/performance/WebVitalsDashboard.spec.ts.backup`.
   - Normalize spec-file indentation (T5, T7).

3. **Behavioural improvements:**
   - Add `aria-label` to the refresh OButton in AppPerformance.
   - Decide whether `OProgressBar` needs a `success` variant so that "good" no longer collapses into "default".
   - Consider exposing an hourglass/segmented variant on `OSpinner` or accept the simpler ring as the new design.

4. **Verification once fixes land:**
   - Run `npm run test -- web/src/components/rum/performance web/src/views/RUM web/src/components/rum/common/performance` and confirm all suites pass.
   - Open the WebVitals tab in both light & dark themes — confirm the info banner has a visible background.
   - Open the Performance Summary tab with a "good" metric — confirm a green check-circle icon appears.
   - Hover the AppPerformance refresh button — confirm tooltip appears and sizing matches the auto-refresh button to its left.

## Class-Level Styling Audit

### 1. Quasar Class Leftovers
| File:Line | Class | Replacement | Layer |
| --- | --- | --- | --- |
| `PerformanceSummary.vue:34` | `q-pb` (leftover stripped of suffix) | Remove (extra `tw:pt-3` already exists) | File |
| `WebVitalsDashboard.vue:20` | `relative-position` | `tw:relative` | File |
| `WebVitalsDashboard.vue:27` | `bg-indigo-7` / `bg-indigo-2` | `tw:bg-indigo-700` / `tw:bg-indigo-200` | File |
| `PerformanceSummary.vue:20` | `relative-position` | `tw:relative` | File |
| `ApiDashboard.vue:21` | `relative-position` | `tw:relative` | File |
| `ErrorsDashboard.vue:20` | `relative-position` | `tw:relative` | File |
| `AppPerformance.vue:440-444` | `.q-table { &__top { ... } }` (scoped) | Remove — `OTable` does not emit `.q-table__top` | File |
| `AppPerformance.vue:457` | `.q-btn` (inside `:deep(.app-performance-auto-refresh-interval)`) | Replace with `OButton`-targeted selector (e.g. `.o-button` or class on the wrapper) | File |
| `PerformanceSummary.vue:343-347` | `.q-table { &__top { ... } }` (scoped) | Remove | File |
| `WebVitalsDashboard.vue:278-282` | `.q-table { &__top { ... } }` (scoped) | Remove | File |
| `ErrorsDashboard.vue:197-201` | `.q-table { &__top { ... } }` (scoped) | Remove | File |
| `ApiDashboard.vue:325-329` | `.q-table { &__top { ... } }` (scoped) | Remove | File |

### 2. Tailwind v4 Misuse
| File:Line | Wrong | Right | Layer |
| --- | --- | --- | --- |
| *(none found)* | | | |

### 3. Quasar CSS Variables
| File:Line | Variable | Replacement | Layer |
| --- | --- | --- | --- |
| *(none found)* | | | |

### 4. Dead `:deep(.q-*)` / `body.body--dark` / `::v-deep`
| File:Line | Selector | Action | Layer |
| --- | --- | --- | --- |
| `AppPerformance.vue:440` | `.q-table` (scoped non-`:deep`, but inert because `OTable` does not emit `.q-table`) | Remove | File |
| `AppPerformance.vue:457` | `:deep(.app-performance-auto-refresh-interval) .q-btn` | Replace inner `.q-btn` with the actual OButton class | File |
| `PerformanceSummary.vue:343` | `.q-table` (scoped) | Remove | File |
| `WebVitalsDashboard.vue:278` | `.q-table` (scoped) | Remove | File |
| `ErrorsDashboard.vue:197` | `.q-table` (scoped) | Remove | File |
| `ApiDashboard.vue:325` | `.q-table` (scoped) | Remove | File |

### 5. Quasar SCSS Variables in Scoped Styles
| File:Line | Variable | Replacement | Layer |
| --- | --- | --- | --- |
| `AppPerformance.vue:442` | `$border-color` | `var(--o2-border-color)` | File |
| `PerformanceSummary.vue:345` | `$border-color` | `var(--o2-border-color)` | File |
| `WebVitalsDashboard.vue:280` | `$border-color` | `var(--o2-border-color)` | File |
| `ErrorsDashboard.vue:199` | `$border-color` | `var(--o2-border-color)` | File |
| `ApiDashboard.vue:327` | `$border-color` | `var(--o2-border-color)` | File |

### 6. Quasar Directives
| File:Line | Directive | Action |
| --- | --- | --- |
| *(none found)* | | |

### 7. Icon Migration
| File:Line | Issue | Fix |
| --- | --- | --- |
| `MetricCard.vue:146` | `good: "check_circle"` — `check_circle` is not in the OIcon registry | Replace with `good: "check-circle"` |
| MetricCard (general) | `OIcon` no longer accepts a `color` prop — status-color hints on good/warning/poor icons are lost | Replace via per-status CSS class on the icon wrapper (`.metric-icon--good { color: var(--o2-success) }`) |

### 8. Inline `style=` Hot Spots
| File:Line | Inline style | Suggested home |
| --- | --- | --- |
| *(none found)* | | |

### 9. Duplicate Style Blocks
| Files | Duplicated block | Suggested partial |
| --- | --- | --- |
| `AppPerformance.vue:440-444` + `PerformanceSummary.vue:343-347` + `WebVitalsDashboard.vue:278-282` + `ErrorsDashboard.vue:197-201` + `ApiDashboard.vue:325-329` (×5) | `.q-table { &__top { border-bottom: 1px solid $border-color; justify-content: flex-end; } }` | Delete in all five files — `OTable` does not emit `.q-table__top`. If a "table top action bar" is still needed, define it once in `_rum-performance.scss` against the actual OTable class |
| `WebVitalsDashboard.vue:57` + `PerformanceSummary.vue:50` + `ApiDashboard.vue:41` + `ErrorsDashboard.vue:39` | `tw:pb-4 tw:flex tw:items-center tw:justify-center tw:text-center tw:absolute tw:w-full tw:h-[calc(100vh-15.625rem)] tw:top-0` (spinner placeholder block) | Extract to a `.rum-dashboard-loading` utility class in `_rum-performance.scss` |

### 10. Layer Summary
- Global (`app.scss` / `_variables.scss`) changes needed: **0**
- Component-level partial changes: **2** (consolidate the dashboard loading-overlay class and the dashboard top-action border into `web/src/styles/_rum-performance.scss`; centralize MetricCard status-color CSS so icons can drop the removed `color` prop)
- File-level scoped changes: **12** (delete `.q-table { &__top }` blocks across 5 dashboards; replace `.q-btn` inside `AppPerformance.vue:457`; fix `bg-indigo-7/2` → `tw:bg-indigo-700/200`; convert `relative-position` → `tw:relative` in 4 files; remove stray `q-pb` token in `PerformanceSummary.vue:34`; replace `$border-color` SCSS var with `var(--o2-border-color)` in 5 files; fix `check_circle` → `check-circle` and add per-status icon color CSS in `MetricCard.vue`)
