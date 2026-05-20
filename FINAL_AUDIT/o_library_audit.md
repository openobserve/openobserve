# O-Library Core Components — Quasar Removal Audit

## Summary

The audit covers everything in `web/src/lib/core/` (recursive) on `feat/ux-revamp-main`. The core library is intentionally narrow — it contains only the primitives **OButton**, **OButtonGroup**, **OBadge**, **OCard / OCardSection / OCardActions**, **OCollapsible**, **OIcon**, **ONavbar**, **ORefreshButton**, **OSeparator**, **OSplitter**, **OTable** (with 9 sub-components + 12 composables + 3 utils), **OToggleGroup / OToggleGroupItem**, and **OVirtualScroll**. All form, overlay, navigation, feedback, list and data components live outside `core/` (see "Scope clarification" below).

Overall the Quasar removal in `core/` is in good shape: no `q-*` template tags, no `from "quasar"` runtime imports, and replacement primitives are mostly Reka UI–based with token-driven Tailwind classes. There are however four kinds of real defects worth fixing:

1. **Hard-coded `var(--q-primary, …)` CSS tokens** still wired into the OTable tree-mode connector lines and warning row.
2. **Test files in `core/` still call `installQuasar()`** — they couple a Quasar-free library back to the Quasar plugin helper.
3. **Stale Quasar migration `.md` files** were left under `core/Card/` and `core/Separator/` and are shipped with the library.
4. **API gaps vs the Quasar widgets they replace** — most importantly `OButton.loading` has no visual spinner, `OTablePagination` declares but never renders first/last-page buttons, and `OBadge.icon` still expects the Material Symbols *font* (inconsistent with the closed `OIcon.icons.ts` SVG registry).

Other issues are mostly small: dead computeds, scoped `<style>` blocks that fall outside the three-layer policy, missing aria/keyboard polish on a few primitives, app-level coupling that makes the library hard to extract, and zero published documentation / no stories / no README.

## Components Audited

| Path | Replaces | Notable subs/composables |
|---|---|---|
| `web/src/lib/core/Badge/OBadge.vue` | (custom) | — |
| `web/src/lib/core/Button/OButton.vue` | `q-btn` | many variants/sizes baked in |
| `web/src/lib/core/Button/OButtonGroup.vue` | `q-btn-group` | — |
| `web/src/lib/core/Card/OCard.vue` + `OCardSection.vue` + `OCardActions.vue` | `q-card` family | role-based section padding |
| `web/src/lib/core/Collapsible/OCollapsible.vue` | `q-expansion-item` | Reka `CollapsibleRoot`, accordion via `useCollapsibleGroup.ts` |
| `web/src/lib/core/Icon/OIcon.vue` | `q-icon` | closed SVG registry `OIcon.icons.ts` |
| `web/src/lib/core/Navbar/ONavbar.vue` | `q-drawer`/menu list | tightly coupled to app `MenuLink.vue` |
| `web/src/lib/core/RefreshButton/ORefreshButton.vue` | (custom Quasar widget) | uses `OButton` + inline SVG |
| `web/src/lib/core/Separator/OSeparator.vue` | `q-separator` | wraps Reka `Separator` |
| `web/src/lib/core/Splitter/OSplitter.vue` | `q-splitter` | uses `@/composables/useResizer` |
| `web/src/lib/core/Table/OTable.vue` | `q-table` | TanStack table + 9 sub-components + 12 composables + 3 utils |
| `web/src/lib/core/ToggleGroup/OToggleGroup.vue` + `OToggleGroupItem.vue` | `q-btn-toggle` | Reka `ToggleGroupRoot` |
| `web/src/lib/core/VirtualScroll/OVirtualScroll.vue` | `q-virtual-scroll` | own `useVirtualScroll.ts` |

### Scope clarification — components outside `core/`

The audit prompt listed Input, Select, Tooltip, Dialog, Toggle, Checkbox, Tabs, Drawer, Menu, Spinner, and Date* as if they lived under `core/`. They don't — they ship in sibling directories. Re-state for the record (and so a follow-up audit is straightforward):

- `web/src/lib/forms/Input/OInput.vue`, `forms/Select/OSelect.vue` (+ `OSelectGroup`, `OSelectItem`), `forms/Checkbox/OCheckbox.vue` (+ `OCheckboxGroup`), `forms/Radio`, `forms/Switch`, `forms/Slider`, `forms/Range`, `forms/Date`, `forms/Time`, `forms/DateTimeRange`, `forms/File`, `forms/Color`, `forms/Combobox`, `forms/OptionGroup`, `forms/Form`
- `web/src/lib/overlay/Dialog/ODialog.vue`, `overlay/Tooltip/OTooltip.vue`, `overlay/Drawer/ODrawer.vue`, `overlay/Dropdown`
- `web/src/lib/navigation/Tabs/OTabs.vue`, `navigation/Pagination`, `navigation/Stepper`
- `web/src/lib/feedback/Spinner/OSpinner.vue`, `feedback/Toast`, `feedback/Banner`, `feedback/Skeleton`, `feedback/InnerLoading`
- `web/src/lib/lists/FieldList`, `web/src/lib/data/Tree`, `data/ProgressBar`, `data/Timeline`

These are out of scope for this report but are referenced from inside `core/` (e.g. `OTablePagination` imports `OSelect`, `OTableSelectCheckbox` imports `OCheckbox`, `OTableLoading` imports `OInnerLoading` + `OSkeleton`, `OTableError` imports `OBanner`).

## Critical Issues

### 1. Stale `--q-primary` CSS tokens in OTable tree connectors

The tree-mode parent/child connector lines and the leaf endpoint marker still resolve their colour from a Quasar variable that no longer exists. The fallback `#6366f1` will paint everywhere — but the variable name is dead. Five hits:

- `web/src/lib/core/Table/sub-components/OTableBodyCell.vue:314` — `.o2-table-tree-endpoint` (`background-color: var(--q-primary, #6366f1);`)
- `web/src/lib/core/Table/sub-components/OTableBodyCell.vue:335` — `.o2-tree-parent-expanded::after`
- `web/src/lib/core/Table/sub-components/OTableBodyCell.vue:351` — `.o2-tree-child::before`
- `web/src/lib/core/Table/sub-components/OTableBodyCell.vue:367` — `.o2-tree-child::after`
- `web/src/lib/core/Table/sub-components/OTableBodyRow.vue:255` — `.o2-table-tree-warning-cell::after`

Should reference a real token from the new design system (e.g. `var(--color-primary-500)` or a dedicated `--color-table-tree-connector`).

**Solution:**
```diff
-background-color: var(--q-primary, #6366f1);
+background-color: var(--color-table-tree-connector, var(--o2-primary));
```
Apply at all 5 sites. Define `--color-table-tree-connector` in `web/src/lib/styles/tokens/` so consumers can override.

### 2. Spec files in `core/` couple to the Quasar plugin

Three specs still call `installQuasar()`:

- `web/src/lib/core/Splitter/OSplitter.spec.ts:5,16`
- `web/src/lib/core/Table/OTable.spec.ts:6,8`
- `web/src/lib/core/Table/OTable.bench.spec.ts:6,8`

The helper still exists at `web/src/test/unit/helpers/install-quasar-plugin.ts`. A Quasar-free library should not import it. `OTable.spec.ts:306` even has a comment `// The checkbox might be a Quasar component;` which is no longer true.

**Solution:**
```diff
-import { installQuasar } from "@/test/unit/helpers/install-quasar-plugin";
-installQuasar();
+// Quasar-free — no plugin needed
 // ...
-// The checkbox might be a Quasar component; trigger the row click
+// Trigger the row click via OCheckbox
```

### 3. Quasar migration `.md` files shipped inside the library

These were left behind and are inside `src/`, so they end up in the build context:

- `web/src/lib/core/Card/quasar-card-expansion-audit.md`
- `web/src/lib/core/Card/quasar-card-expansion-migration.md`
- `web/src/lib/core/Card/quasar-card-expansion-migration-checklist.md`
- `web/src/lib/core/Separator/quasar-separator-migration.md`
- `web/src/lib/core/Separator/quasar-separator-migration-checklist.md`

Move under `docs/` or delete.

**Solution:**
```bash
git rm web/src/lib/core/Card/quasar-card-expansion-audit.md \
       web/src/lib/core/Card/quasar-card-expansion-migration.md \
       web/src/lib/core/Card/quasar-card-expansion-migration-checklist.md \
       web/src/lib/core/Separator/quasar-separator-migration.md \
       web/src/lib/core/Separator/quasar-separator-migration-checklist.md
```

### 4. `OButton` has `loading` prop but no visible spinner

`web/src/lib/core/Button/OButton.vue:15,272-285` only sets `aria-busy` and `disabled`; the body of the button still shows whatever the caller put in the default slot. Quasar's `q-btn` shows a spinner (and a `loading` slot for custom indicators). Consumers migrating from `q-btn` will silently lose the visual feedback. There is also no `loading` slot to opt into a custom indicator. Recommend rendering `OSpinner` (from `lib/feedback/Spinner`) when `loading=true`, plus a `#loading` slot.

**Solution:**
```diff
 <button :disabled="disabled || loading" :aria-busy="loading">
+  <template v-if="loading">
+    <slot name="loading">
+      <OSpinner size="sm" />
+    </slot>
+  </template>
-  <slot />
+  <slot v-else />
 </button>
```
Import `OSpinner from "@/lib/feedback/Spinner/OSpinner.vue"`.

### 5. `OTablePagination` declares first/last emits but renders only prev/next

`web/src/lib/core/Table/sub-components/OTablePagination.vue:35,38` define `"first-page"` and `"last-page"` emit signatures, but the template (`lines 81–100`) only renders the chevron-left and chevron-right buttons. The wiring chain `OTable.vue:606,609 → pagination.firstPage / lastPage` is similarly never reachable from the UI. There is also no page indicator (no "Page n / m"), so users on long tables cannot jump to a specific page.

**Solution:**
```diff
+<OButton variant="ghost" size="icon-xs" :disabled="page === 1" @click="emit('first-page')">
+  <OIcon name="keyboard-double-arrow-left" />
+</OButton>
 <OButton variant="ghost" size="icon-xs" :disabled="page === 1" @click="emit('prev-page')">
   <OIcon name="chevron-left" />
 </OButton>
+<span class="tw:text-sm tw:px-2">{{ page }} / {{ totalPages }}</span>
 <OButton variant="ghost" size="icon-xs" :disabled="page === totalPages" @click="emit('next-page')">
   <OIcon name="chevron-right" />
 </OButton>
+<OButton variant="ghost" size="icon-xs" :disabled="page === totalPages" @click="emit('last-page')">
+  <OIcon name="keyboard-double-arrow-right" />
+</OButton>
```

### 6. `OBadge.icon` prop expects the Material Symbols font, not the OIcon registry

`web/src/lib/core/Badge/OBadge.vue:149-154` renders the prop as `<span class="material-icons-outlined">{{ icon }}</span>` — i.e. the ligature font.

This contradicts the deliberate design of `OIcon.icons.ts` (line 1-17 of `OIcon.icons.ts` documents "Icons are resolved at build time by unplugin-icons — zero runtime fetches. This keeps the application fully functional in air-gapped environments"). In air-gapped deployments the Material Symbols font may not be available and the badge icon will fall back to literal text (e.g. the word `check`). The same pattern exists in `OCollapsible.vue:116`. Both should switch to `OIcon` and accept an `IconName`.

**Solution:**
```diff
-<span class="material-icons-outlined">{{ icon }}</span>
+<OIcon :name="icon" :size="size === 'sm' ? 'xs' : 'sm'" />
```
Update the `icon` prop type to `IconName` (imported from `@/lib/core/Icon/OIcon.icons`). Apply the same change in `OCollapsible.vue:116`.

### 7. `OBadge` `count: 0` always renders

`web/src/lib/core/Badge/OBadge.vue:24-26` triggers the trailing slot when `props.count !== undefined`. Users binding `:count="unreadCount"` with `unreadCount = 0` will see a `0` chip. q-badge's analogous behaviour hides empty counts. Confirm intent, or add a `hideZeroCount` flag.

**Solution:**
```diff
-<span v-if="count !== undefined">{{ count }}</span>
+<span v-if="count !== undefined && (count !== 0 || showZeroCount)">{{ count }}</span>
```
Add a `showZeroCount?: boolean` prop (default `false`) so consumers can opt-in.

### 8. `OSplitter` separator focus style violates three-layer rule

`web/src/lib/core/Splitter/OSplitter.vue:182-185` hard-codes a `2px outline` with `var(--o2-primary-color)` inside a `<style scoped>` block. The rest of the library uses Tailwind ring tokens (e.g. `tw:focus-visible:ring-2 tw:focus-visible:ring-collapsible-trigger-focus-ring`). Move to a token-driven focus ring class in `app.scss` or component partial.

**Solution:**
```diff
 <div
   role="separator"
-  class="o-splitter-separator"
+  class="o-splitter-separator tw:focus-visible:ring-2 tw:focus-visible:ring-[var(--o2-focus-ring)] tw:focus-visible:outline-none"
 >
 </div>
 <style scoped>
-.o-splitter-separator:focus-visible {
-  outline: 2px solid var(--o2-primary-color);
-}
 </style>
```

### 9. `OSplitter` ships dead code that never reaches the template

- `web/src/lib/core/Splitter/OSplitter.vue:115-123` declares `afterStyle` — never used.
- Lines `126-131` declare `separatorPosition` — never used.

Remove or wire them. Bundle and review noise.

**Solution:**
```diff
-const afterStyle = computed(() => ({ /* dead */ }));
-const separatorPosition = computed(() => /* dead */);
```
Delete both declarations.

### 10. `OSplitter` parses `limits` defensively in a way that breaks `0`-min

`web/src/lib/core/Splitter/OSplitter.vue:89-90` uses `||` for `limits[0]` and `limits[1]`. If a caller supplies `limits: [0, 100]` the `0` is falsy and the fallback (`0` in this branch, but `100` for the max!) takes over. The vertical case is fine because the fallback equals the original; horizontal/edge cases are not. Use nullish coalescing.

**Solution:**
```diff
-const minLimit = props.limits[0] || 0;
-const maxLimit = props.limits[1] || 100;
+const minLimit = props.limits?.[0] ?? 0;
+const maxLimit = props.limits?.[1] ?? 100;
```

## API Gaps vs Quasar

| Quasar | O-Library | Missing Features (relative to commonly used q-* props) |
|---|---|---|
| `q-btn` | `OButton` | No visible spinner for `loading` (only `aria-busy`); no `loading` slot; no `ripple`; no `flat`/`dense`/`outlined` toggles (replaced by `variant=ghost`/`outline` enum, fine but undocumented); no `to`/`href` shortcut (must rely on `as` + `$attrs`); no `tabindex` override slot |
| `q-btn-group` | `OButtonGroup` | No `spread`, no `unelevated`/`outline`/`push`/`flat` group-level style flags; orientation only — visually fine because per-button variant carries the look |
| `q-card` family | `OCard` / `OCardSection` / `OCardActions` | No `flat`/`bordered`/`square` variants; `OCard` is intentionally always-flat (`OCard.types.ts:1`) — fine if documented |
| `q-expansion-item` | `OCollapsible` | No `dense`/`switch-toggle-side`/`expand-icon-toggle`; icon is still a Material Symbols font (`OCollapsible.vue:116`); does not expose `expand-icon` slot |
| `q-icon` | `OIcon` | No `color` prop (relies on `currentColor`); no support for arbitrary icon name (closed `IconName` union by design — fine but adds friction); no `name="img:…"` for image-as-icon |
| `q-separator` | `OSeparator` | No `inset`/`spaced`/`size` props; only vertical/horizontal toggle |
| `q-splitter` | `OSplitter` | No `before`/`after` `min-px`/`max-px` per-pane limits (only one `limits` tuple on the splitter); no `:reverse`; no `:disable` per axis; missing the q-splitter `before`/`after` props that set internal min-sizes |
| `q-table` | `OTable` | Most q-table features ARE present (server pagination/sort, multi-select, tree expansion, virtual scroll, sticky headers, column reorder/resize/pin, footer aggregates). Gaps: **first/last-page buttons not rendered** (emits defined but no UI, `OTablePagination.vue`); no `dense=false` styling helper; no `flat`/`bordered` style toggles distinct from current `bordered` boolean; no fullscreen action; no built-in CSV export; no `binary-state-sort`. Also no built-in row-per-page `selected-rows-label` slot. `OTable.types.ts:246` declares `stickyRowTotals` prop but the template never reads it (only `stickyColTotals` is forwarded). Column-resize emission is debounced (500 ms, `OTable.vue:283`) but state is internal — if `enableColumnResize=false` the sizes still aren't persistent across mounts |
| `q-virtual-scroll` | `OVirtualScroll` | No `virtual-scroll-horizontal`, no `scroll-target-direction`; `scroll-target` is a static prop (not a string selector lookup like q-virtual-scroll's). The exposed `scrollToIndex/scrollToTop/measure` cover the common case |
| `q-btn-toggle` | `OToggleGroup` / `OToggleGroupItem` | No `spread`/`stretch`, no `toggle-color`/`toggle-text-color` (variants encode that), no `clearable` (`OToggleGroup.vue:35-39` actively *prevents* clearing in `single` mode — opinionated but undocumented). `OToggleGroupItem` `xs` size is `h-3` (12 px) which is too small to be a tappable target |

### Minor API observations

- **`ONavbar`** is a thin wrapper around the app-level `MenuLink.vue` (`ONavbar.vue:45`). It is not actually a generic navbar primitive — `linksList` items must match the proprietary `NavItem` shape. Calling it `core` is misleading; either generalise it (accept a slot for each item) or move it to `web/src/components/`.

**Solution (generalise):**
```diff
-<MenuLink v-for="(nav, i) in linksList" :key="nav.name" v-bind="{ ...nav, mini: miniMode }" />
+<slot name="item" v-for="(item, i) in items" :item="item" :index="i">
+  <a :href="item.link">{{ item.title }}</a>
+</slot>
```
Or move `ONavbar.vue` to `web/src/components/Navbar/`.
- **`OBadge.icon`** and **`OCollapsible.icon`** still depend on the Material Symbols font and should be migrated to `OIcon` (see Critical #6).
- **`OTable` highlight** path supports `highlightFields` and `highlightText`, but `OTable.vue:194` reaches into `(props.columns as any).ftsKeys` — `ftsKeys` is not part of `OTableColumnDef[]` (the columns array). This appears to be undeclared dependency on an external augmented array. Add the prop to types or move the data to a real prop.

**Solution:**
```diff
 const props = defineProps<{
   columns: OTableColumnDef[];
+  ftsKeys?: string[];
   ...
 }>();
-const keys = (props.columns as any).ftsKeys;
+const keys = props.ftsKeys;
```
- **`OTableHeader`** receives `stickyColTotals` but `OTable.types.ts:247` documents `stickyRowTotals` too — only the col variant is wired in (`OTable.vue:412`). Either remove the unused prop or wire it.
- **`OTable.tree` mode** mixes `getSubRows` (TanStack-level) and `getChildren` (custom). The two paths can disagree silently. Document that `tree=true` ignores `getSubRows` (`OTable.types.ts:154,164`).
- **`OBtn` `iconLeft`/`iconRight`** force `OIcon size="sm"` (`OButton.vue:292,296`) regardless of button size — looks under-sized in `lg` and `icon-lg` (40 px and 48 px) buttons. Pass a size derived from the parent button size.

**Solution:**
```diff
-<OIcon :name="iconLeft" size="sm" />
+<OIcon :name="iconLeft" :size="iconSize" />
```
Where `iconSize = computed(() => size === 'lg' || size === 'icon-lg' ? 'md' : 'sm')`.
- **`OCard` deliberately offers no styling props** — `OCard.types.ts:1-4` documents this. Consumers must apply layout/sizing via class. Fine, but the convention is undocumented in any README; a one-paragraph doc would prevent re-discovery.

## CSS / Layout Issues

### Three-Layer Violations

The architecture defines three layers: global (`web/src/styles/app.scss`), component-level partials/tokens, and `<style scoped>` in `.vue` files. Findings:

1. **`OSplitter.vue:173-197`** — large `<style scoped>` block that hard-codes a focus outline with `var(--o2-primary-color)` and emits a `:global(.no-select)` rule. The global side effect should live in `app.scss`; the focus ring should use a design token from `lib/styles/tokens/`.

**Solution:**
```diff
-<style scoped>
-:global(.no-select) { user-select: none; }
-.o-splitter-separator:focus-visible { outline: 2px solid var(--o2-primary-color); }
-</style>
+<!-- move `.no-select` to web/src/styles/app.scss -->
+<style scoped>
+/* focus ring now applied via tw:focus-visible:ring-* on the separator element */
+</style>
```
2. **`OTableBodyCell.vue:284-380`** — heavy `<style scoped>` (~95 lines) for tree connector lines, chevron buttons, and copy-button positioning. Most of these are reusable patterns (tree indicators) that belong in a `Table` partial or token file, not buried per-cell. They also include the dead `var(--q-primary, …)` references (Critical #1).

**Solution:**
1. Create `web/src/lib/core/Table/styles/_tree-connectors.scss` with the tree-line rules.
2. Import via `@use` in `OTable.vue`'s scoped style.
3. Replace `var(--q-primary, #6366f1)` with `var(--color-table-tree-connector, var(--o2-primary))` (see Critical #1).
3. **`OTableBodyRow.vue:240-266`** — `<style scoped>` for the tree-warning row with another `var(--q-primary, …)` reference.

**Solution:** same as Critical #1 — replace with the token-driven `var(--color-table-tree-connector, var(--o2-primary))`. Consolidate the warning-cell rule into `_tree-connectors.scss`.
4. **`OCollapsible.vue:154-184`** — `<style>` (note: not even scoped) sets the open/close animation keyframes globally under the `.o-collapsible-content` class. Other consumers of `.o-collapsible-content` would inherit this. Move keyframes to `app.scss` under a namespaced class, or use a `<style scoped>` with `:deep` selectors.

**Solution:**
```diff
-<style lang="scss">
-.o-collapsible-content { animation: ...; }
-@keyframes ... { ... }
-</style>
+<style lang="scss" scoped>
+:deep(.o-collapsible-content) { animation: o2-collapsible-down 200ms ease; }
+</style>
```
Move `@keyframes o2-collapsible-down` / `o2-collapsible-up` to `web/src/styles/app.scss`.
5. **`OTable.vue:585`** uses a hard-coded streaming bar colour via inline class binding `tw:bg-[var(--color-table-streaming-bar)]`. The token is real, so this is OK — but the comment block in OTable mixes hard-coded `2.25rem`/`2.75rem` row-height fallbacks (`OTable.vue:385`) when no token is set. Promote those numbers to the token file.

**Solution:**
```diff
-height: var(--o2-table-row-height, 2.25rem);
+height: var(--o2-table-row-height);
```
Define `--o2-table-row-height: 2.25rem;` (compact) and `--o2-table-row-height-md: 2.75rem;` in `lib/styles/tokens/_table.scss`.

### Dark theme + focus rings

- Most components use semantic token classes (`tw:focus-visible:ring-2 tw:focus-visible:ring-…`). Good.
- `OSplitter` does NOT — see Three-Layer #1.
- `OTableBodyCell.vue:307` falls back to a non-theme-aware color: `rgba(0, 0, 0, 0.05)`. Won't reflect dark mode hover. Should be a token.
- `OTableBodyCell.vue:317` falls back to `#fff` for the leaf endpoint marker's box-shadow — invisible against a dark surface. Same issue.

**Solution:**
```diff
-background-color: rgba(0, 0, 0, 0.05);
+background-color: var(--o2-hover-accent);
-box-shadow: 0 0 0 2px #fff;
+box-shadow: 0 0 0 2px var(--o2-bg-surface);
```

### Misc layout

- `OTablePagination.vue:67` mixes `t('search.showing')` / `t('search.of')` translation calls but uses literal hyphen-minus `-` in the template. Use a single translation key (e.g. `"showing": "{from} - {to} of {total}"`).

**Solution:**
```diff
-{{ t('search.showing') }} {{ from }} - {{ to }} {{ t('search.of') }} {{ total }}
+{{ t('search.paginationLabel', { from, to, total }) }}
```
Add i18n key `"paginationLabel": "Showing {from} - {to} of {total}"`.

- `OTable.vue:343` builds the global filter input by hand (raw `<input>` element). It should use `OInput` from `lib/forms/Input` for consistency (the rest of the app does).

**Solution:**
```diff
-<input v-model="globalFilter" class="…" placeholder="Search…" />
+<OInput v-model="globalFilter" :placeholder="t('search.placeholder')" size="sm">
+  <template #icon-left><OIcon name="search" size="xs" /></template>
+</OInput>
```

- `OBtn` `block` mode (`OButton.vue:259`) switches to `flex`. The `block` prop is undocumented in the API table.

**Solution:** add the prop to the JSDoc/types and the OButton README. Code is fine.

## Accessibility

- **`OButton`** — sets `aria-busy` and `aria-disabled` correctly when loading/disabled (`OButton.vue:284-285`). No spinner means screen readers can announce busy but sighted users see nothing.
- **`OBadge`** — when `clickable=true`, renders as `<button>` (good), with `:tabindex="clickable && !disabled ? 0 : undefined"`. The `<button>` is already tabbable by default — setting `tabindex=0` on a native button is redundant (`OBadge.vue:138`). Harmless but worth tidying.
- **`OIcon`** — toggles between `role="img" + aria-label` and `aria-hidden="true"` based on the `label` prop (`OIcon.vue:30-32`). Good.
- **`OSplitter`** — `role="separator"`, `aria-orientation`, `aria-valuenow/min/max` (`OSplitter.vue:46-50`). Good. The `limits || 100` fallback (Critical #10) feeds the wrong `aria-valuemax` when `limits` is omitted.
- **`OCollapsible`** — relies on Reka's `CollapsibleRoot`/`CollapsibleTrigger` for the ARIA contract. Good. Custom trigger slot bypasses the built-in chevron; document that the consumer must still render an indicator.
- **`OToggleGroupItem`** — `data-[disabled]` styles applied (`OToggleGroupItem.vue:43-45`). Disabled-state aria comes from Reka.
- **`OTable`** — no `role="grid"` / `aria-rowcount` / `aria-colcount` on the `<table>` (`OTable.vue:377-388`). Keyboard navigation is implemented via `useTableKeyboard` but the table element itself does not advertise grid semantics. Skeleton loading carries `role="status" aria-label="Loading data" aria-live="polite"` (`OTableLoading.vue:55-57`) — good. The streaming indicator (`OTable.vue:586`) has `aria-label="Data streaming in progress"` — good.

**Solution:**
```diff
-<table class="o2-table">
+<table class="o2-table" role="grid" :aria-rowcount="totalRows" :aria-colcount="columns.length">
```
- **`OTableExpandButton`** — bare `<button>` with `type="button"` but no `aria-expanded` / `aria-label`. Screen readers cannot tell the row state.

**Solution:**
```diff
-<button type="button" @click="toggle">
+<button type="button"
+        :aria-expanded="expanded"
+        :aria-label="expanded ? 'Collapse row' : 'Expand row'"
+        @click="toggle">
   <OIcon :name="expanded ? 'expand-less' : 'expand-more'" />
 </button>
```
- **`OTableSelectCheckbox`** — delegates aria semantics to `OCheckbox`. Should be fine if `OCheckbox` is wired correctly (out of scope).
- **`OCardActions`** — no `role="toolbar"`; OK because it's a passive wrapper.
- **`ONavbar`** — sets `role="navigation"` and `aria-label="Main navigation"`. Implements ArrowDown/ArrowUp/Tab keyboard with focus trap via `data-test="menu-link-…"` lookups (`ONavbar.vue:64-67`). Coupling to a data-test attribute for focus management is fragile — use `[role="menuitem"]` or refs.

**Solution:**
```diff
-const items = container.value?.querySelectorAll('[data-test^="menu-link-"]');
+const items = container.value?.querySelectorAll('[role="menuitem"]');
```
Also add `role="menuitem"` to each rendered `<a>`/`<router-link>` in `MenuLink.vue`.
- **`ORefreshButton`** — only conveys state through colour of the dot (`ORefreshButton.vue:85-91`) and a `:title=`. Title-attribute tooltips don't show on keyboard focus; add visible text or use `OTooltip`.

**Solution:**
```diff
-<button :title="stateLabel">
-  <span class="dot" :class="stateClass" />
-</button>
+<OTooltip :content="stateLabel">
+  <button :aria-label="stateLabel">
+    <span class="dot" :class="stateClass" aria-hidden="true" />
+  </button>
+</OTooltip>
```

## Test File Issues

- **Quasar plugin still installed** in three core specs:
  - `OSplitter.spec.ts:5,16`
  - `OTable.spec.ts:6,8`
  - `OTable.bench.spec.ts:6,8`
  Drop the `installQuasar()` calls — these components do not depend on the plugin anymore.

**Solution:**
```diff
-import { installQuasar } from "@/test/unit/helpers/install-quasar-plugin";
-installQuasar();
```
Remove from all three spec files.
- **`OTable.spec.ts:306`** carries a stale comment: `// The checkbox might be a Quasar component; trigger the row click`. Clean up.

**Solution:**
```diff
-// The checkbox might be a Quasar component; trigger the row click
+// Trigger the row click via OCheckbox
```
- **Test data file `Icon/OIcon.icons.ts:168`** — comment `// Material Symbols replacements for "@quasar/extras/material-symbols-outlined"` is purely historical; fine to keep but worth noting it's no longer accurate context.
- **No tests for the tree-mode connectors** in `OTableBodyCell.vue` — the `var(--q-primary, …)` issue would have been caught by visual-regression coverage. Bench spec exists (`OTable.bench.spec.ts`, 315 lines) but unit coverage of the tree connector lines and warning row is missing.
- **No tests for `OTablePagination`** as a standalone unit — the first/last-page emit gap would have been spotted.
- **No spec for `OCollapsibleGroup`** accordion coordination (`Collapsible/useCollapsibleGroup.ts`).
- **No spec for `OButtonGroup`** exists as `OButtonGroup.spec.ts:1` — actually, the file exists; verified at `web/src/lib/core/Button/OButtonGroup.spec.ts`.

## Recommendations

1. **Replace `var(--q-primary, #6366f1)` immediately** with a real OpenObserve token in `OTableBodyCell.vue` (4 occurrences) and `OTableBodyRow.vue` (1 occurrence). Critical #1.
2. **Remove `installQuasar()` from `core/` specs** — `OSplitter.spec.ts`, `OTable.spec.ts`, `OTable.bench.spec.ts`. If something fails without it, the component is still indirectly Quasar-dependent and the dependency needs to be tracked down. Critical #2.
3. **Delete or move the `quasar-*-migration*.md` files** out of `web/src/lib/core/`. Critical #3.
4. **Add a visible spinner inside `OButton` when `loading=true`** — either via `OSpinner` import or an inline SVG (same approach `ORefreshButton.vue:121` uses). Add a `#loading` slot for overrides. Critical #4.
5. **Render first/last-page buttons inside `OTablePagination`**, or remove the unused emit/handler chain. Critical #5.
6. **Migrate `OBadge.icon` and `OCollapsible.icon` to `OIcon`** so they work without the Material Symbols font. Critical #6.
7. **Audit `OBadge` `count: 0` behaviour** — confirm the design intent. Critical #7.
8. **Replace `OSplitter`'s scoped focus outline with a token-based ring**. Move keyframes and the `:global(.no-select)` rule to `app.scss`. Critical #8.
9. **Remove dead code in `OSplitter.vue`** (`afterStyle`, `separatorPosition`). Critical #9.
10. **Fix `OSplitter` `limits` fallback** to use `??` instead of `||` so a `0` minimum is preserved. Critical #10.
11. **Move tree-connector CSS** out of per-cell `<style scoped>` into a `Table` partial. Replace `rgba(0,0,0,0.05)` / `#fff` fallbacks with theme tokens so dark mode and hover work.
12. **Add `role="grid"` / `aria-rowcount` / `aria-colcount`** to `OTable.vue`'s `<table>` and `aria-expanded` + `aria-label` to `OTableExpandButton.vue`.
13. **Generalise or relocate `ONavbar`** — its dependency on `@/components/MenuLink.vue` makes it not really a `core` library primitive.
14. **Adopt `OInput` inside `OTable`'s built-in global filter** instead of a raw `<input>` (`OTable.vue:339-346`). Removes a one-off styled input from the library surface.
15. **Add a top-level `README.md`** for `web/src/lib/core/` (and ideally per-component README/Storybook) — there is none today, so onboarding requires reading the .types.ts files. Even a short "Components and what they replace" table would help.
16. **Type the OTable column augmentation `ftsKeys`** — currently `(props.columns as any).ftsKeys` (`OTable.vue:194`) is a hidden contract.
17. **Resize-icon sizing inside `OButton`** — derive `<OIcon size>` from the parent button size (e.g. `lg → md`, `icon-lg → md`).
18. **Sanitize `count` rendering** — `OBadge` should default `count={undefined}` and treat `0` as a hide condition unless explicitly opted in.
19. **Strengthen `OTablePagination` translations** — single key with `{from} - {to} of {total}` placeholders.
20. **Document the opinionated decisions** (no clearable in `OToggleGroup` single mode; always-flat `OCard`; closed `IconName` union; debounced column-size emission) — these are good choices but currently only discoverable by reading code.


## Class-Level Styling Audit

### 1. Quasar Class Leftovers
*(none found — `web/src/lib/core/**/*.vue` has zero `q-*` template tags or `q-*`-prefixed scoped selectors)*

### 2. Bare Quasar Utility Classes
*(none found — all utility classes in `core/` carry the `tw:` prefix; `text-primary-600` in `OButton.vue:156/207` is a Tailwind color utility, not a bare Quasar class)*

### 3. Tailwind v4 Misuse
| File:Line | Wrong | Right | Layer |
|---|---|---|---|
| `web/src/lib/core/Splitter/OSplitter.vue:34` | `'hover:tw:bg-[var(--o2-border-input)]'` | `'tw:hover:bg-[var(--o2-border-input)]'` | File-scoped |
| `web/src/lib/core/Table/sub-components/OTableBodyCell.vue:275` | `group-hover:tw:opacity-100`, `tw:hover:text-[var(--color-text-primary)]` (mixed) | `tw:group-hover:opacity-100` (consistent variant ordering) | File-scoped |
| `web/src/lib/core/Table/sub-components/OTableHeader.vue:367` | `group-hover:tw:opacity-100`, `tw:hover:text-text-primary` (mixed) | `tw:group-hover:opacity-100` | File-scoped |
| `web/src/lib/core/Table/sub-components/OTableHeader.vue:486` | same as above | `tw:group-hover:opacity-100` | File-scoped |

### 4. Quasar CSS Variables
| File:Line | Variable | Replacement | Layer |
|---|---|---|---|
| `web/src/lib/core/Table/sub-components/OTableBodyCell.vue:314` | `var(--q-primary, #6366f1)` (.o2-table-tree-endpoint) | `var(--color-table-tree-connector, var(--o2-primary))` | File-scoped |
| `web/src/lib/core/Table/sub-components/OTableBodyCell.vue:335` | `var(--q-primary, #6366f1)` (.o2-tree-parent-expanded::after) | same | File-scoped |
| `web/src/lib/core/Table/sub-components/OTableBodyCell.vue:351` | `var(--q-primary, #6366f1)` (.o2-tree-child::before) | same | File-scoped |
| `web/src/lib/core/Table/sub-components/OTableBodyCell.vue:367` | `var(--q-primary, #6366f1)` (.o2-tree-child::after) | same | File-scoped |
| `web/src/lib/core/Table/sub-components/OTableBodyRow.vue:255` | `var(--q-primary, #6366f1)` (.o2-table-tree-warning-cell::after) | same | File-scoped |

### 5. Dead `:deep(.q-*)` / `body.body--dark` / `::v-deep`
*(none found in `web/src/lib/core/**/*.vue`)*

### 6. Quasar SCSS Variables in Scoped Styles
*(none found — no `$primary` / `$dark-page` / `$border-color` etc. in `core/`)*

### 7. Quasar Directives
*(none found — no `v-close-popup` / `v-ripple` in `core/`)*

### 8. Icon Migration
*(none found — `OIcon` itself is the registry; no underscored names, no `:color` prop usage in `core/` templates)*

### 9. Inline `style=` Hot Spots
| File:Line | Inline style | Suggested home |
|---|---|---|
| `web/src/lib/core/Table/sub-components/OTablePagination.vue:59` | `style="font-weight: 700"` | `tw:font-bold` |
| `web/src/lib/core/Splitter/OSplitter.vue:21,41` | `:style="beforeStyle"`, `:style="[separatorStyle]"` | OK (computed) |
| `web/src/lib/core/VirtualScroll/OVirtualScroll.vue:92,97,104` | `:style="containerStyle"`, `{ height: `${totalSize}px` }`, virtualization rects | OK (computed — required for v-list) |
| `web/src/lib/core/Table/OTable.vue:367,383,518` | `:style="{ ... }"` (sticky offsets, column widths) | OK (computed) |
| `web/src/lib/core/Table/sub-components/OTableBodyCell.vue:195,210` | computed paddings | OK (computed) |
| `web/src/lib/core/Table/sub-components/OTableHeader.vue:145,196,250,294,419` | column widths / sticky offsets | OK (computed) |
| `web/src/lib/core/Table/sub-components/OTableBodyRow.vue:139,147,217` | row height token + status bar color + tree connector x | OK (computed); status bar could use `--o2-status-bar-bg-*` class set |

### 10. Duplicate Style Blocks (candidates for partial)
| Files | Duplicated block | Suggested partial |
|---|---|---|
| `OTableBodyCell.vue:314,335,351,367`, `OTableBodyRow.vue:255` | Tree-connector / warning-cell color uses `var(--q-primary, #6366f1)` (5 sites, same pattern) | `web/src/lib/core/Table/styles/_tree-connectors.scss` |
| `OTableHeader.vue:367` and `:486` | hover-opacity / column-resize gutter button styles (twin "interactive button" pattern) | Common `.o2-table-header-actionable-btn` mixin |
| `OTableBodyCell.vue:284-380` (~95 lines scoped) | tree indicators, chevron buttons, copy-button positioning | Same `_tree-connectors.scss` + `_table-buttons.scss` |

### 11. Layer Summary
- Global (`app.scss`) changes needed: 1 (`@keyframes` for `OCollapsible`)
- Component-level partial changes: 2 (`Table/styles/_tree-connectors.scss`, `Table/styles/_table-buttons.scss`)
- File-level scoped changes: ~10 (5x `--q-primary` token replacement, 4x `hover:tw:` → `tw:hover:`, 1x `font-weight: 700` inline → utility)

