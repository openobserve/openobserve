# Settings Page — Quasar Removal Audit

## Summary

Audited 7 Settings-page Vue files plus their adjacent specs (~3,000 lines changed between `main` and `feat/ux-revamp-main`). The Quasar→Tailwind/O\* migration is mostly mechanical, but several critical defects slipped through:

- **AiToolsets.vue is non-compilable** — `NoData`, `ConfirmDialog`, `AddAiToolset`, `OTable`, `OTableColumnDef`, and `aiToolsetsService` are all referenced (as components, type, and service) but their **import statements were removed** in commit `1c38131b25`. The page will throw at Vue mount and the service calls will throw `ReferenceError`.
- **OrganizationManagement.vue Revoke action has a corrupted icon name** — `<OIcon name="tw:block" />` (line 90). The original `block` was clobbered when a global `tw:` prefix sweep accidentally rewrote the icon prop. Renders nothing (Vue warns "Invalid icon name") instead of the block glyph.
- **Six `:disable` bindings in Nodes.vue** (lines 292, 302, 333, 343, 374, 384) — Quasar prop name `disable`; the new `OInput` requires `disabled`. The min/max number inputs for TCP established/close-wait/wait-time are **never disabled** even when their toggle is off, so users can edit values that have no effect.
- **License.vue still uses Quasar-style icon names and pixel sizes** — `name="check_circle"` (line 293, snake_case not in registry) and `size="18px"` (lines 285, 294, OIcon only accepts `xs|sm|md|lg|xl`).
- **All 6 audited spec files import `installQuasar` from `install-quasar-plugin.ts`** — but that helper only exports `tempQuasarPlugin` now. Every settings spec fails at module load.

Several minor issues (leftover `text-primary`, `q-table__title`, `text-green-6`, `column`, `bg-primary`, `float-right`, `positive-increase-light`, `data-test="cipher-keys-list-title"` on the Nodes page header, an Echarts `position: "top-center"` typo in UsageTab.vue) round out the findings.

`web/src/views/OverviewTab.vue` is unchanged between branches (0-line diff) — nothing to audit there.

## Files Audited

- `web/src/components/settings/index.vue` (38-line diff)
- `web/src/components/settings/License.vue` (371-line diff)
- `web/src/components/settings/Nodes.vue` (1,137-line diff)
- `web/src/components/settings/OrganizationManagement.vue` (645-line diff)
- `web/src/components/settings/AiToolsets.vue` (226-line diff)
- `web/src/views/UsageTab.vue` (113-line diff)
- `web/src/views/OverviewTab.vue` (0-line diff — unchanged)
- Spec files: `index.spec.ts`, `License.spec.ts`, `Nodes.spec.ts`, `OrganizationManagement.spec.ts`, `settingsIndex.spec.ts`, `web/src/views/UsageTab.spec.ts`

Supporting types/registries inspected to validate component contracts: `OIcon.types.ts`, `OIcon.icons.ts`, `OTab.vue`, `OBadge.types.ts`, `OInput.types.ts`, `OTextarea.types.ts`, `OProgressBar.types.ts`, `OSpinner.types.ts`, `OCardSection.types.ts`, `ODialog.types.ts`, `OTable.types.ts`, `OTooltip.types.ts`, `OSplitter.types.ts`, `OCollapsible.types.ts`, `useToast.ts`, `install-quasar-plugin.ts`.

## Critical Issues

### 1. AiToolsets.vue — missing imports cause runtime/compile failure

`/Users/ktx/Documents/Projects/openobserve.worktrees/ux-revamp/web/src/components/settings/AiToolsets.vue`

Six identifiers are used but never imported (the diff at commit `1c38131b25` removed the original imports and never re-added them in O\*-form):

- L52, L90 — `<OTable>` component (used in template; registered in `components: { OTable }` L145; **no `import` statement**)
- L63 — `<NoData />` (template); registered L138; **no import**
- L95 — `<AddAiToolset />` (template); registered L140; **no import**
- L100 — `<ConfirmDialog />` (template); registered L139; **no import**
- L157 — `columns: OTableColumnDef[]` (type) — **type import missing**
- L209, L308 — `aiToolsetsService.list(...)` / `.delete(...)` — **service import missing**

Repro: `web/src/services/ai_toolsets.ts`, `web/src/components/ai_toolsets/AddAiToolset.vue`, `web/src/components/ConfirmDialog.vue`, `web/src/components/shared/grid/NoData.vue`, and `web/src/lib/core/Table/OTable.vue` (+ `OTable.types.ts`) all exist on disk — only the `import` lines need to be re-added. Until then, navigating to the AI Toolsets settings tab will render a blank table at best and a Vue mount error at worst.

**Solution:** (file-level — `AiToolsets.vue`)
```diff
  import OBadge from "@/lib/core/Badge/OBadge.vue";
  import OInput from "@/lib/forms/Input/OInput.vue";
  import { toast } from "@/lib/feedback/Toast/useToast";
+ import NoData from "@/components/shared/grid/NoData.vue";
+ import ConfirmDialog from "@/components/ConfirmDialog.vue";
+ import AddAiToolset from "@/components/ai_toolsets/AddAiToolset.vue";
+ import OTable from "@/lib/core/Table/OTable.vue";
+ import type { OTableColumnDef } from "@/lib/core/Table/OTable.types";
+ import aiToolsetsService from "@/services/ai_toolsets";
```
Restores all six missing references (5 components + 1 service + 1 type) so the page compiles and mounts.

### 2. OrganizationManagement.vue — Revoke-contract icon name corrupted to `tw:block`

`/Users/ktx/Documents/Projects/openobserve.worktrees/ux-revamp/web/src/components/settings/OrganizationManagement.vue:90`

```
<OIcon name="tw:block" size="xs" />
```

The original `<q-icon name="block" />` (the universal-prohibition glyph) was rewritten to `tw:block` — almost certainly by a global rename that targeted the Tailwind class `block`. `tw:block` is not in the `OIcon.icons.ts` registry; OIcon will warn at render and produce no glyph. The Revoke action button still works, but its icon disappears.

Confirmed: `block` IS in the registry (`/web/src/lib/core/Icon/OIcon.icons.ts` — `"block": Block`), so the fix is a one-character revert.

**Solution:** (file-level — `OrganizationManagement.vue:90`)
```diff
- <OIcon name="tw:block" size="xs" />
+ <OIcon name="block" size="xs" />
```
Revert the bogus `tw:` prefix that was inserted by a Tailwind sweep — `name` is a prop value, not a CSS class.

### 3. AiToolsets.vue & OrganizationManagement.vue use `OBadge` variants that no longer apply

Not a hard break, but worth flagging:

- `AiToolsets.vue:128-133` — `KIND_VARIANTS = { skill: "primary-soft", generic: "default" }` — both are valid `BadgeVariant` strings, so this is correct. (Previously `KIND_COLORS = { mcp: "blue-7", cli: "green-7", ... }` was passed straight to `q-badge :color="..."`; that wouldn't have worked anyway.)

**Solution:** (file-level — `AiToolsets.vue`, if visual differentiation matters)
```diff
  const KIND_VARIANTS: Record<string, string> = {
    mcp: "primary",
-   cli: "success",
-   skill: "primary-soft",
+   cli: "success",
+   skill: "warning",
    generic: "default",
  };
```
Optional — only swap `skill` away from a blue tint if design wants mcp/skill kept visually distinct (use any non-blue OBadge variant such as `warning` or `destructive`).

## Logical Issues

### 4. Nodes.vue — TCP toggle min/max inputs cannot be disabled

`/Users/ktx/Documents/Projects/openobserve.worktrees/ux-revamp/web/src/components/settings/Nodes.vue`, lines 292, 302, 333, 343, 374, 384.

```
<OInput
  :disable="!establishedToggle"   ← Quasar prop name, no longer recognized
  data-test="nodes-filter-established-min"
  type="number" ...
/>
```

`OInput.types.ts:28` declares `disabled?: boolean` — the only accepted name. `:disable` is forwarded to the DOM as a stray attribute and ignored. Affected fields: established min/max, close-wait min/max, wait-time min/max. Sibling `ORange` calls below correctly use `:disabled` (lines 312, 353, 394), so the inconsistency is internal to the same template.

**Solution:** (file-level — `Nodes.vue`, six occurrences L292/302/333/343/374/384)
```diff
- <OInput :disable="!establishedToggle" ... />
+ <OInput :disabled="!establishedToggle" ... />
- <OInput :disable="!closewaitToggle"  ... />
+ <OInput :disabled="!closewaitToggle"  ... />
- <OInput :disable="!waittimeToggle"   ... />
+ <OInput :disabled="!waittimeToggle"   ... />
```
Use `Edit` with `replace_all: true` on the literal `:disable="` → `:disabled="` to fix all six in one pass.

### 5. Nodes.vue — `ref="qTable"` no longer bound to anything

Template `Nodes.vue:449` declares `ref="qTable"`, but `qTable` is not declared in `setup()` and was deliberately removed from the return statement. Vue will log a binding warning. The previous Quasar code used `qTable.value.setPagination(...)` from `changePagination`, which has been deleted. No active call site uses the ref now, so this is just dead syntax — but it should be removed.

**Solution:** (file-level — `Nodes.vue:449`)
```diff
  <OTable
    class="tw:flex-1 tw:min-h-0"
-   ref="qTable"
    data-test="nodes-main-table"
```
Removes the orphan ref binding.

### 6. Nodes.vue — wrong `data-test` on header title

`Nodes.vue:427` — `data-test="cipher-keys-list-title"` on the nodes page heading. Copy-paste leftover from CipherKeys.vue. Will fail E2E selectors that target this page.

**Solution:** (file-level — `Nodes.vue:427`)
```diff
  <div
    class="tw:flex tw:flex-col q-table__title tw:items-start"
-   data-test="cipher-keys-list-title"
+   data-test="nodes-list-title"
  >
```
Aligns the test selector with the page identity.

### 7. License.vue — `name="check_circle"` is not in the icon registry

`/Users/ktx/Documents/Projects/openobserve.worktrees/ux-revamp/web/src/components/settings/License.vue:293`

```
<OIcon
  v-else-if="..."
  name="check_circle"           ← snake_case Quasar name
  size="18px"                   ← invalid size token
  class="tw:text-amber-500 tw:flex-shrink-0"
/>
```

The registry uses kebab-case (`check-circle`). OIcon will warn "Unknown icon name" and render nothing. Visible regression: the amber "limit-exceeded but under threshold" indicator on the license-usage card never shows an icon.

The neighbour OIcon at line 297-302 correctly uses `name="check-circle" size="sm"`, so this is just a missed rename on one branch of the v-if/v-else-if/v-else chain.

**Solution:** (file-level — `License.vue:293-294`)
```diff
  <OIcon
    v-else-if="..."
-   name="check_circle"
-   size="18px"
+   name="check-circle"
+   size="sm"
    class="tw:text-amber-500 tw:flex-shrink-0"
  />
```
Use kebab-case names (per `OIcon.icons.ts`) and the size enum (`xs|sm|md|lg|xl`).

### 8. License.vue — `size="18px"` is an unsupported OIcon size

Same file, lines 285 and 294.

```
<OIcon name="warning" size="18px" ... />
<OIcon name="check_circle" size="18px" ... />
```

`OIcon.types.ts:12` — `size?: "xs" | "sm" | "md" | "lg" | "xl"`. Closest match: `size="sm"` (16px) or `size="md"` (24px). Currently TypeScript will flag the literal, and at runtime the icon falls back to the default `md`.

**Solution:** (file-level — `License.vue:285, 294`)
```diff
- <OIcon name="warning"      size="18px" ... />
+ <OIcon name="warning"      size="sm"   ... />
- <OIcon name="check_circle" size="18px" ... />
+ <OIcon name="check-circle" size="sm"   ... />
```
`sm` (16px) is the nearest size token to 18px in the OIcon registry.

### 9. License.vue — `textarea[placeholder=...]` focus selector is brittle

`License.vue:541-543` (pre-existing, but worth knowing in the refactor):

```
const textarea = document.querySelector(
  'textarea[placeholder="Paste new license key here..."]',
);
```

Selector hardcodes the English placeholder. Will break in any non-English locale. Recommend giving `<OTextarea>` an `id` and using `getElementById`.

**Solution:** (file-level — `License.vue` template + script)
```diff
- <OTextarea ...placeholder="Paste new license key here..." />
+ <OTextarea id="license-key-textarea" ...placeholder="Paste new license key here..." />

- const textarea = document.querySelector(
-   'textarea[placeholder="Paste new license key here..."]',
- );
+ const textarea = document.getElementById("license-key-textarea") as HTMLTextAreaElement | null;
```
Locale-stable selector; survives any future placeholder translation.

### 10. UsageTab.vue — `position: "top-center"` is not a valid Echarts label position

`/Users/ktx/Documents/Projects/openobserve.worktrees/ux-revamp/web/src/views/UsageTab.vue:1024`

```
label: {
  show: true,
  position: "top-center",  ← was "top" on main
  fontSize: 14,
  ...
}
```

Echarts `series.label.position` accepts `top | bottom | left | right | inside | insideLeft | insideRight | insideTop | insideBottom | center` (plus relative position arrays). `top-center` will be treated as unknown and Echarts will fall back to the default position (`inside` for bar series). Likely an unintentional rename.

**Solution:** (file-level — `UsageTab.vue:1024`)
```diff
  label: {
    show: true,
-   position: "top-center",
+   position: "top",
    fontSize: 14,
```
`top` matches the previous behaviour on `main`. Only valid Echarts positions are accepted.

### 11. UsageTab.vue — bar-segment colors were removed

`UsageTab.vue:934-942`:

```js
{
  value: healthyAlerts,
  name: "Success Alerts",
  itemStyle: { },     ← previously: { color: "#15ba73" }
},
{
  value: failedAlerts,
  name: "Failed Alerts",
  itemStyle: { },     ← previously: { color: "#db373a" }
},
```

The two-bar Alerts chart in the Usage tab no longer assigns green/red to success/failure segments. The chart will fall back to Echarts default palette. Whether this is the intended new look or an accidental scrub during the Quasar pass should be confirmed with design.

**Solution:** (file-level — `UsageTab.vue:934-942`)
```diff
  {
    value: healthyAlerts,
    name: "Success Alerts",
-   itemStyle: { },
+   itemStyle: { color: "#15ba73" },
  },
  {
    value: failedAlerts,
    name: "Failed Alerts",
-   itemStyle: { },
+   itemStyle: { color: "#db373a" },
  },
```
Restores the green/red semantic coding for success vs. failure (matching `main`). Confirm with design before merging.

### 12. OrganizationManagement.vue — `<OInput type="date">` falls back to text input

`/Users/ktx/Documents/Projects/openobserve.worktrees/ux-revamp/web/src/components/settings/OrganizationManagement.vue:168`

```
<OInput
  v-model="contractEndDate"
  type="date"
  data-test="contract-end-date-input"
/>
```

`OInput.types.ts:15-23` — `InputType = "text" | "password" | "email" | "number" | "search" | "url" | "tel" | "textarea"`. `"date"` is **not** in the union. The contract-end-date picker silently becomes a plain text input; the user can no longer pick a date from a native calendar picker, and `dateToMicros(new Date(dateStr))` (line 333) will choke on free-form input.

This affects both the Create-External-Contract and Extend-External-Contract dialogs.

**Solution:** (file-level — `OrganizationManagement.vue:166-170`)
```diff
- <OInput
-   v-model="contractEndDate"
-   type="date"
-   data-test="contract-end-date-input"
- />
+ <input
+   v-model="contractEndDate"
+   type="date"
+   data-test="contract-end-date-input"
+   class="tw:w-full tw:px-3 tw:py-2 tw:border tw:border-[var(--o2-border-color)] tw:rounded tw:bg-[var(--o2-input-bg)] tw:text-[var(--o2-text-primary)] focus:tw:outline-none focus:tw:border-[var(--o2-primary)]"
+ />
```
Falls back to the native `<input type="date">` until `OInput.InputType` is extended. The Tailwind classes mirror the O2 design tokens (component-level surface defined in `web/src/styles`); long-term fix is to add `"date"` to `OInput.types.ts` `InputType` union.

### 13. License.vue — License Key modal `OTextarea v-model="licenseData.key"`

`License.vue:420-426`. The modal lets the user "copy" the key via the existing `copyLicenseKey()` flow, but it also two-way binds `licenseData.key` to the textarea. With `readonly` set this should be a no-op, but if `readonly` is ever toggled off the v-model would mutate the loaded license data in place. Pre-existing risk, not caused by the migration — flagging for future cleanup.

**Solution:** (file-level — `License.vue:420-426`)
```diff
- <OTextarea v-model="licenseData.key" readonly ... />
+ <OTextarea :model-value="licenseData.key" readonly ... />
```
Use one-way `:model-value` instead of `v-model` so the read-only modal cannot accidentally mutate the loaded license object.

## CSS / Layout Issues

### 14. Quasar utility classes left behind across all five page files

These have no effect now that Quasar's stylesheet is removed (or only a small CSS-reset effect):

- `License.vue:55`, `License.vue:201` — `class="text-green-6 tw:mr-2"` (q-color class on a now-vanished palette).
- `Nodes.vue:36` — `:class="filterApplied ? 'text-primary' : ''"` — `text-primary` is Quasar, not Tailwind.
- `Nodes.vue:426` — `class="tw:flex tw:flex-col q-table__title tw:items-start"` — `q-table__title` styling no longer exists.
- `OrganizationManagement.vue:21` — `class="q-table__title"` — same as above.
- `OrganizationManagement.vue:132` — `class="float-left tw:font-bold"`. `float-left` was a Quasar helper; should be `tw:float-left`.
- `OrganizationManagement.vue:133` — `class="float-right tw:gap-1"` — same.
- `OrganizationManagement.vue:141-142` — `'bg-primary text-white'` / `'bg-white text-gray-700 border-gray-3'` — Quasar color tokens used as if Tailwind, so the active "selected week" pill no longer highlights.
- `UsageTab.vue` — extensive surviving Quasar classes: `column` (lines 99, 140, 181, 224, 267, 314, 379, 510, 569), `positive-increase-dark` / `positive-increase-light` (defined in the page's `<style>` so still OK), `tile-content`/`feature-card` (defined in `<style>`), and `text-title` / `text-subtitle` / `details-container` / `home-stat-row` (all defined in the page's `<style>` so still OK).
- `UsageTab.vue:90, 131, 172, 215, 258, 302, 363` — `tile-content rounded-borders tw:text-center column tw:justify-between` — `column` and `rounded-borders` were Quasar classes. `tw:rounded` was added (line 90+) but the bare `column` class still expects Quasar's `flex-direction: column` rule.

Net effect: most of the listed cases are cosmetic (the tiles still flex correctly because the surrounding card has display rules), but the **week-picker pills in the Extend-Trial dialog visually fail to highlight the selected week** — that's a real regression.

**Solution:** (file-level — Quasar utility classes; CSS layer = **file-level** `<template>` since these are inline utility classes, not in scoped style blocks)

`License.vue:55, 201` — green icon color
```diff
- class="text-green-6 tw:mr-2"
+ class="tw:text-green-600 tw:mr-2"
```

`Nodes.vue:36` — primary text color
```diff
- :class="filterApplied ? 'text-primary' : ''"
+ :class="filterApplied ? 'tw:text-[var(--o2-primary)]' : ''"
```

`Nodes.vue:426` and `OrganizationManagement.vue:21` — drop `q-table__title`
```diff
- class="tw:flex tw:flex-col q-table__title tw:items-start"
+ class="tw:flex tw:flex-col tw:text-base tw:font-semibold tw:items-start"
```

`OrganizationManagement.vue:132-133` — float helpers
```diff
- <div class="float-left tw:font-bold">Week(s)</div>
- <div class="float-right tw:gap-1">
+ <div class="tw:float-left tw:font-bold">Week(s)</div>
+ <div class="tw:float-right tw:gap-1">
```

`OrganizationManagement.vue:141-142` — selected-week pill highlighting (the real regression)
```diff
  extendedTrial === page
-   ? 'bg-primary text-white'
-   : 'bg-white text-gray-700 border-gray-3',
+   ? 'tw:bg-[var(--o2-primary)] tw:text-white'
+   : 'tw:bg-white tw:text-gray-700 tw:border tw:border-gray-300',
```

`UsageTab.vue` — `column` and `rounded-borders` survivors (L90, 131, 172, 215, 258, 302, 363)
```diff
- class="tile-content rounded-borders tw:text-center column tw:justify-between"
+ class="tile-content tw:rounded tw:text-center tw:flex tw:flex-col tw:justify-between"
```
The `tile-content`, `feature-card`, `home-stat-row`, `details-container`, `text-title`, `text-subtitle`, and `positive-increase-*` classes are defined in the page's own `<style>` and stay; only the Quasar utilities (`column`, `rounded-borders`) get translated.

### 15. License.vue — license-info `<table>` is hand-rolled with `tw:border-[var(--o2-border-color)]`

The Quasar `q-markup-table` markup was migrated to a raw `<table>` with `tw:border-collapse tw:border tw:border-solid tw:border-[var(--o2-border-color)]` and per-row/per-cell border classes (e.g., L81, L83-84, L89-90, …). Confirm that `--o2-border-color` is defined as a CSS variable on both light/dark themes. If it's not (e.g., it was only declared inside `body--dark`), the borders won't render. Spot-check on the rendered page recommended.

The `compact-table` style scope still applies (defined L981-987), so the cell padding is fine.

**Solution:** (CSS layer = **global** `web/src/styles/app.scss`)
```diff
+ :root {
+   --o2-border-color: #e0e0e0;
+ }
+ body.dark, [data-theme="dark"] {
+   --o2-border-color: #3a3a3a;
+ }
```
Ensure `--o2-border-color` is declared at the `:root` level (light) AND inside the dark-theme selector so the License-info `<table>` renders borders on both themes. If the variable is already declared in the global theme file, no change needed — but verify before merging.

### 16. UsageTab.vue — `class="rounded-borders"` survives

Lines 90, 131, 172, 215, 258, 302, 363, 442, 525. `rounded-borders` is Quasar's class for `border-radius: 4px`. The diff added `tw:rounded` (which is `border-radius: 0.25rem`) — so corners still round. The leftover class is dead but the page renders the same.

**Solution:** (file-level — `UsageTab.vue` template, `replace_all` the literal ` rounded-borders` → ``)
```diff
- class="tile-content rounded-borders tw:text-center column tw:justify-between"
+ class="tile-content tw:rounded tw:text-center tw:flex tw:flex-col tw:justify-between"
```
Strip the dead `rounded-borders` class on all nine sites in a single `replace_all`. Already covered by the sweep in finding #14.

### 17. index.vue — odd `"settings": "settings"` literal in setup return

`/Users/ktx/Documents/Projects/openobserve.worktrees/ux-revamp/web/src/components/settings/index.vue:426`

```
return {
  ...
  storePreviousStoreModel,
  "settings": "settings",
};
```

This was previously `outlinedSettings` (re-exported for template use). The replacement is meaningless: a constant string `"settings"` is exposed under the key `settings`, but nothing in the template consumes it. Harmless, but leaves cruft in the component public API. Should just be deleted.

**Solution:** (file-level — `index.vue:426`)
```diff
      storePreviousStoreModel,
-     "settings": "settings",
    };
```
Just removes the no-op literal from the setup return.

## Component Migration Issues

### 18. index.vue — many tab icons still use Quasar snake_case names

`index.vue:43, 57, 84, 96, 110, 153, 167, 181, 195, 208, 239` use `icon="query_stats"`, `icon="hub"`, `icon="domain"`, `icon="location_on"`, `icon="person_pin_circle"`, `icon="paid"`, `icon="key"`, `icon="smart_toy"`, `icon="card_membership"`, `icon="lan"`, `icon="group_work"`, etc.

This isn't strictly a bug — `OTab.vue:111-114` has a fallback path that renders unknown names as a `<span class="material-icons-outlined">{{ icon }}</span>` glyph, **only** if `material-icons-outlined` font CSS is still loaded by the app shell. If a future cleanup removes that font, these icons all disappear silently. Recommend migrating to the kebab-case OIcon registry equivalents (`query-stats`, `hub`, `location-on`, `paid`, `key`, `smart-toy`, `lan`, `group-work` are already registered).

The tab labels that work natively today via OIcon: `domain`, `card_membership`, `person_pin_circle` — none of these are in `OIcon.icons.ts`. Those will *always* fall back to the material-icons font.

**Solution:** (file-level — `index.vue`, ~11 tab definitions)
```diff
- icon="query_stats"
+ icon="query-stats"
- icon="location_on"
+ icon="location-on"
- icon="person_pin_circle"
+ icon="person-pin-circle"
- icon="smart_toy"
+ icon="smart-toy"
- icon="card_membership"
+ icon="card-membership"
- icon="group_work"
+ icon="group-work"
```
Snake_case → kebab-case for all OTab `icon` props. `hub`, `domain`, `paid`, `key`, `lan` are already single words and need no change. **Component-level follow-up:** register any still-missing icons (`card-membership`, `person-pin-circle`) in `web/src/lib/core/Icon/OIcon.icons.ts` so they don't depend on the Material Icons font fallback.

### 19. Nodes.vue — `OCheckbox` is given `type="checkbox"` (Quasar legacy attr)

`Nodes.vue:288, 321, 362`. Harmless — OCheckbox just ignores unknown attrs — but it indicates the migration was a blind text replacement (`q-checkbox` → `OCheckbox`) that didn't drop the now-meaningless `type` prop.

**Solution:** (file-level — `Nodes.vue`, three sites)
```diff
  <OCheckbox
-   type="checkbox"
    v-model="establishedToggle"
    :label="t('nodes.establishedLabel')"
  />
```
Drop the legacy `type="checkbox"` prop from all three OCheckbox usages.

### 20. Nodes.vue — main `OTable` data-test mismatch and pagination assumption

The status section's `<OTable>` no longer carries the explicit max-height/overflow styling that the old `q-table` had (`'width: 100%; height: calc(100vh - 115px); overflow-y: auto;'`). The new flex layout handles it via the wrapping `tw:flex-1 tw:min-h-0` div, but the parent's height constraint via the `OSplitter` is `style="overflow: hidden; height: calc(100vh - 64px)"` (changed from `40px`). On pages with the global usage banner, this delta could push the bottom rows below the viewport. Visual verification recommended.

**Solution:** (file-level — `Nodes.vue` OSplitter wrapper)
```diff
- style="overflow: hidden; height: calc(100vh - 64px)"
+ style="overflow: hidden; height: calc(100vh - var(--o2-chrome-offset, 64px))"
```
Use a CSS variable to track the global chrome height (header + optional usage banner). **Global layer (`web/src/styles/app.scss`)** can then set `--o2-chrome-offset` per layout (`64px` default, `110px` when the usage banner is mounted). Avoids each page needing to know about the banner.

### 21. OrganizationManagement.vue — confirmation dialog removed `"persistent: true, cancel: true"` semantics

`L489-516, L527-552`: the `$q.dialog(...)` flow had `persistent: true` (Esc/outside-click ignored) and explicit `cancel: true`. The migration to `await confirm({ title, message })` uses a generic `useConfirmDialog`; verify that the resulting dialog also blocks Esc/outside-click for destructive operations like "Revoke contract" and "Enable storage settings". If `useConfirmDialog` defaults to non-persistent, accidental dismissals are now possible.

**Solution:** (file-level — `OrganizationManagement.vue` confirm calls)
```diff
- await confirm({ title: "Revoke Contract", message: "..." });
+ await confirm({ title: "Revoke Contract", message: "...", persistent: true });
```
Pass `persistent: true` for destructive actions so accidental Esc / outside-click cannot dismiss. **Component-level follow-up:** if `useConfirmDialog` does not yet support a `persistent` option, add it in `web/src/composables/useConfirmDialog.ts` and propagate to the underlying `ODialog`.

### 22. AiToolsets.vue — `KIND_VARIANTS` mapping changes the visual coding

Original `q-badge` colors (`KIND_COLORS`):

```
mcp: "blue-7",       cli: "green-7",     skill: "purple-7",   generic: "grey-7"
```

New OBadge variants:

```
mcp: "primary",      cli: "success",     skill: "primary-soft", generic: "default"
```

`primary` and `primary-soft` will both render blueish — `mcp` and `skill` are now no longer visually distinct, where they were blue vs purple before. Confirm with design that this collapse is intentional.

**Solution:** (file-level — `AiToolsets.vue:128-133`)
```diff
  const KIND_VARIANTS: Record<string, string> = {
    mcp: "primary",
    cli: "success",
-   skill: "primary-soft",
+   skill: "warning",   // or another non-blue OBadge variant per design
    generic: "default",
  };
```
Re-introduces a hue separation between `mcp` (blue) and `skill`. If the design system needs a new "purple" variant, add it to `OBadge.types.ts` (component-level) and `OBadge.vue` styles.

## Test File Issues

### 23. All six audited spec files import a symbol that no longer exists

`/Users/ktx/Documents/Projects/openobserve.worktrees/ux-revamp/web/src/test/unit/helpers/install-quasar-plugin.ts` now only exports `tempQuasarPlugin`. There is **no exported `installQuasar`**. Every settings spec does:

```
import { installQuasar } from "@/test/unit/helpers/install-quasar-plugin";
installQuasar();   // or installQuasar({ plugins: { ... } });
```

Affected files:

- `web/src/components/settings/Nodes.spec.ts:18, 21`
- `web/src/components/settings/License.spec.ts:3, 7`
- `web/src/components/settings/OrganizationManagement.spec.ts:18, 21`
- `web/src/components/settings/settingsIndex.spec.ts:3, ~6`
- `web/src/components/settings/index.spec.ts:18, 24`
- `web/src/views/UsageTab.spec.ts:18, ~22`

Plus 16 more across the broader `web/src/components/settings/*.spec.ts` (`AddRegexPattern`, `BuiltInPatternsTab`, `CipherKeys`, `CorrelationSettings`, `DiscoveredServices`, `DomainManagement`, `DomainManagement.integration`, `General`, `ImportRegexPattern`, `ModelPricingEditor`, `ModelPricingList`, `NoRegexPatterns`, `OrgStorageSettings`, `OrganizationSettings`, `ServiceIdentityConfig`, `ServiceIdentitySetup`, `TestModelMatchDialog`).

The helper file itself contains a `TODO: REMOVE THIS FILE when unit tests are rewritten` comment (L16) — the intent is clear, but the migration is incomplete. Until specs are rewritten, `vitest` cannot load any of them — they error at the import line with `SyntaxError: The requested module ... does not provide an export named 'installQuasar'`.

**Solution:** (component-level — `web/src/test/unit/helpers/install-quasar-plugin.ts`)
```diff
  export const tempQuasarPlugin = { ... };
+ // Backwards-compat shim until the full spec rewrite lands.
+ // Spec files importing `installQuasar()` will be no-ops with the new harness.
+ export const installQuasar = (_opts?: unknown): void => {
+   /* no-op: O* components do not require a Quasar global install */
+ };
```
Provide an `installQuasar` no-op export so the dozens of unrewritten spec files can at least load. Long-term: replace each `installQuasar()` call with the new test setup and delete this shim once the TODO is satisfied.

### 24. Nodes.spec.ts stubs Quasar components that no longer appear in the template

`Nodes.spec.ts:152-163` registers global stubs for `q-splitter`, `q-table`, `q-expansion-item`, `q-card`, `q-card-section`, `q-checkbox`, `q-range`, `q-tooltip`, `q-list`, `q-btn`, `q-td`, `QTablePagination`. The migrated `Nodes.vue` uses `OSplitter`, `OTable`, `OCollapsible`, `OCheckbox`, `ORange`, `OTooltip`, `OButton`, etc. Even when import errors are fixed, this spec will mount an empty tree.

Same pattern applies to the other five specs to varying degrees.

**Solution:** (file-level — each `*.spec.ts` `global.stubs` block)
```diff
  global: {
    stubs: {
-     "q-splitter": true,
-     "q-table": true,
-     "q-expansion-item": true,
-     "q-card": true,
-     "q-card-section": true,
-     "q-checkbox": true,
-     "q-range": true,
-     "q-tooltip": true,
-     "q-list": true,
-     "q-btn": true,
-     "q-td": true,
-     QTablePagination: true,
+     OSplitter: true,
+     OTable: true,
+     OCollapsible: true,
+     OCheckbox: true,
+     ORange: true,
+     OTooltip: true,
+     OButton: true,
+     OInput: true,
+     OIcon: true,
+     NoData: true,
    },
  },
```
Update each spec's stub list to mirror the O* components used by the migrated SFC. Anything else still renders as a real component.

## Validations

Confirmation dialogs (Revoke contract, Enable storage) and the date input in OrganizationManagement.vue were migrated mechanically; no client-side validation is present in the audited files. The change from `q-input type="date"` to `OInput type="date"` (which falls back to text) **removes the implicit date validation** the native picker provided. There is no other date-format check before `dateToMicros(...)` is invoked at OrganizationManagement.vue:333.

Recommend either:

1. Extend `OInput.InputType` to include `"date"` (see `OInput.types.ts:15-23`), or
2. Add a `<input type="date">` directly and wrap it with the design-system styles outside `OInput`.

## Accessibility

No regressions found beyond what's already documented. The new components (OTab, ODialog, OTooltip) use `reka-ui` underneath which provides correct ARIA wiring out of the box. The hand-rolled License-info `<table>` is semantic HTML and is preferable to the previous `q-markup-table`. The Extend-Trial week-picker uses bare `<span>` elements for the four week numbers (OrganizationManagement.vue:134-146), which is **not keyboard-accessible** (no `tabindex`, no `role="radio"`, no `aria-checked`) — this was already true on main, so it's not a regression, but the migration would have been a natural moment to introduce `<OToggleGroup>` or `<button>`s.

## Recommendations

Priority order:

1. **(CRITICAL)** Re-add the six missing imports in `AiToolsets.vue` (NoData, ConfirmDialog, AddAiToolset, OTable, OTableColumnDef type, aiToolsetsService). One PR. Smoke-test the page mount.
2. **(CRITICAL)** Fix `OIcon name="tw:block"` → `name="block"` in OrganizationManagement.vue:90.
3. **(HIGH)** Replace `:disable` with `:disabled` on the 6 OInput sites in Nodes.vue (lines 292, 302, 333, 343, 374, 384) — restores the TCP filter toggle behavior.
4. **(HIGH)** Decide whether `OInput` should accept `type="date"` natively, or migrate the two date inputs in OrganizationManagement.vue away from OInput.
5. **(HIGH)** Rewrite all settings spec files: replace `installQuasar` import + call with the new pattern, and update Quasar component stubs to O\* equivalents. Until then those test files block CI.
6. **(MEDIUM)** Fix License.vue:293 — `name="check_circle"` → `name="check-circle"`, and License.vue:285, 294 — `size="18px"` → `size="sm"`.
7. **(MEDIUM)** Restore Echarts segment colors on the Alerts chart in UsageTab.vue:934-942, and revert the `position: "top-center"` → `position: "top"` typo at UsageTab.vue:1024 (or confirm intent with design).
8. **(MEDIUM)** Re-style the week-picker pills in OrganizationManagement.vue:138-143 so the "selected" state actually highlights with Tailwind tokens (`tw:bg-primary tw:text-white` etc.).
9. **(LOW)** Sweep the remaining Quasar utility classes (`text-primary`, `text-green-6`, `column`, `q-table__title`, `float-left`, `float-right`, `rounded-borders`, `positive-increase-*`) — most are dead, but they obscure code review.
10. **(LOW)** Migrate the snake_case Material Icon names in `index.vue` (`query_stats`, `domain`, `location_on`, `person_pin_circle`, `card_membership`, `smart_toy`, `group_work`, `lan`, `key`, `paid`, `hub`) to the kebab-case OIcon registry equivalents. Register `card-membership`, `domain`, `person-pin-circle` in `OIcon.icons.ts` if missing.
11. **(LOW)** Remove `ref="qTable"` from Nodes.vue:449 (no longer bound), fix `data-test="cipher-keys-list-title"` on Nodes.vue:427 → `data-test="nodes-list-title"`, and delete the no-op `"settings": "settings"` in index.vue:426.
12. **(LOW)** Verify `useConfirmDialog`'s default modality matches Quasar's `persistent: true` for destructive flows.

## Class-Level Styling Audit

### 1. Quasar Class Leftovers
| File:Line | Class | Replacement | Layer |
|---|---|---|---|
| AiToolsets.vue:26 | `q-table__title` | `tw:text-base tw:font-semibold` | file-scoped |
| AiToolsets.vue:359 | `.q-table` selector | remove dead | file-scoped |
| settings/index.vue:20 | `q-table__title` (commented) | safe to remove | file-scoped |
| Nodes.vue:33 | `float-right` | `tw:float-right` | file-scoped |
| Nodes.vue:36 | `text-primary` | `tw:text-[var(--o2-primary)]` | file-scoped |
| Nodes.vue:426 | `q-table__title` | drop / use tw class | file-scoped |
| OrganizationManagement.vue:21 | `q-table__title` | drop | file-scoped |
| OrganizationManagement.vue:132 | `float-left` | `tw:float-left` | file-scoped |
| OrganizationManagement.vue:133 | `float-right` | `tw:float-right` | file-scoped |
| NoData.vue:19 | `column flex-center` (Quasar utilities) | `tw:flex tw:flex-col tw:items-center tw:justify-center` | file-scoped |

### 2. Tailwind v4 Misuse
| File:Line | Wrong | Right | Layer |
|---|---|---|---|
| *(none found)* | | | |

### 3. Quasar CSS Variables
| File:Line | Variable | Replacement | Layer |
|---|---|---|---|
| *(none found)* | | | |

### 4. Dead `:deep(.q-*)` / `body.body--dark` / `::v-deep`
| File:Line | Selector | Action | Layer |
|---|---|---|---|
| OverviewTab.vue:871 | `body.body--dark` | replace with `html.dark` | file-scoped |

### 5. Quasar SCSS Variables in Scoped Styles
| File:Line | Variable | Replacement | Layer |
|---|---|---|---|
| AiToolsets.vue:361 | `$border-color` | `var(--o2-border)` | file-scoped |

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
| AiToolsets.vue:19 | `min-height:inherit; height: calc(100vh - 88px)` | scoped `.toolsets-shell` class |
| AddAiToolset.vue:17 | `min-height:inherit` | drop |
| AddAiToolset.vue:38 | `height: calc(100vh - 120px); overflow:auto` | scoped `.toolset-form-scroll` class |
| License.vue:49 | `height:200px` | `tw:h-[200px]` |
| License.vue:195 | `min-height:150px` | `tw:min-h-[150px]` |
| License.vue:393 | `font-size:10px` | `tw:text-[10px]` |
| License.vue:425 | `font-family:monospace; font-size:12px` | scoped `.license-code` class |
| Nodes.vue:25 | `overflow:hidden; height: calc(100vh - 64px)` | scoped `.nodes-shell` class |
| Nodes.vue:28 | `height: calc(100vh - 64px)` | scoped class |
| Nodes.vue:30 | `font-size:18px` | `tw:text-lg` |
| Nodes.vue:435 | `width:400px` | `tw:w-[400px]` |
| OrganizationManagement.vue:18 | `min-height:inherit` | drop |
| settings/index.vue:32 | `height: calc(100vh - var(--navbar-height) - 15px)` | scoped `.settings-card-shell` class |
| settings/index.vue:223 | `width:24px; height:24px` | `tw:w-6 tw:h-6` |
| NoData.vue:20 | `font-size:1.5rem; margin:20vh auto 2rem` | scoped `.no-data-text` class |

### 9. Duplicate Style Blocks
| Files | Duplicated block | Suggested partial |
|---|---|---|
| AiToolsets.vue:19 / Nodes.vue:25 / settings/index.vue:32 | repeated `height: calc(100vh - ...)` viewport-fill shells | extract `.settings-page-shell` mixin |
| AiToolsets.vue:23 / OrganizationManagement.vue:20 | identical `tw:flex tw:justify-between tw:items-center tw:px-4 tw:py-3 tw:h-[68px] tw:border-b-[1px]` toolbar | extract `.settings-page-header` class |

### 10. Layer Summary
- Global (`app.scss`) changes needed: 0
- Component-level partial changes: 2 (`.settings-page-shell`, `.settings-page-header`)
- File-level scoped changes: ~26 (10 q-* class leftovers, 1 body.body--dark, 1 SCSS var, 14 inline styles)
