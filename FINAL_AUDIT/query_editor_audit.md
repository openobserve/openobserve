# Query Editor / Plan — Quasar Removal Audit

## Summary

The Query Editor pipeline (`QueryEditor.vue` → `CodeQueryEditor.vue`), the Query Plan dialog and its tree components, and the Running Queries page have all been migrated from Quasar to O* components + Tailwind `tw:` classes. The Monaco wrapper itself (`CodeQueryEditor.vue`) is intact — `q-icon` and `q-tooltip` were swapped for `OIcon` / `OTooltip`, `debounce` was rerouted from `quasar` to `lodash-es`, and the core Monaco editor logic (autocomplete provider, double-quote validation, Ctrl/Cmd+Enter run, focus/blur trimming, NL-detection debouncer) was left untouched. So the **happy path of typing, running, and auto-completing queries should still work**.

However, the migration left behind a substantial amount of broken or unreachable styling and several files that no longer have a purpose:

- **Dead `:deep(.q-field__control)` / `:deep(.q-field__*)` CSS** in `QueryEditor.vue` (lines 635-678) and `NLModeQueryBar.vue` (lines 487-518). `OInput` does not render any `q-field` class, so all AI input bar styling — white background, padding, dark-mode color overrides — silently fails. The AI bar will fall back to default `OInput` chrome with a purple-gradient wrapper, which is visually inconsistent with the design.
- **Quasar SCSS leftovers in `RunningQueries.vue`**: `:deep(.q-table th)`, `:deep(.q-table td)`, plus a second non-scoped block (`:deep(.q-field__control)` under `.search-field-select`) that target classes `OTable`/`OInput` no longer emit. Same dead-CSS rules are duplicated in `RunningQueriesList.vue` and `SummaryList.vue`. The `.search-field-select` styles also leak globally because they live in `<style lang="scss">` (no `scoped`).
- **Undefined CSS custom properties** referenced in scoped styles: `--q-primary-rgb` (MetricsSummaryCard, QueryPlanNode, json-preview), `--q-dark`, `--q-dark-page` (NLModeQueryBar). These are not declared in `_variables.scss`, so `rgba(var(--q-primary-rgb), 0.1)` renders as `rgba(, 0.1)` which is invalid and falls back to nothing. The metric badges, summary card hover/border, and dark-mode input backgrounds will be missing.
- **Quasar utility classes still in templates** that are no longer defined anywhere: `flex-center` (QueryPlanDialog), `full-height` / `full-width` (QueryPlanDialog, RunningQueriesList, SummaryList — `.full-height` is defined only inside `logs/logs-page.scss`, which is scoped to `plugins/logs/Index.vue`), `text-weight-medium`, `text-weight-bold`, `q-table__title`, `col-auto` (QueryList). The "Loading plan…" spinner in the dialog and the "No data" empty states in the tables will not be centered correctly.
- **`NLModeQueryBar.vue` is dead code.** No file in `web/src/` imports it. Its 528 lines, including AI-bar styling using `--q-dark`/`--q-dark-page`/`.q-dark` selectors that no longer exist, can be deleted.
- **`CollapsibleProjection.vue` is dead code** under `query-plan/`. Nothing imports it (only its own spec).
- **Spec files are fundamentally broken.** All ten Query/Plan spec files still `import { installQuasar } from "@/test/unit/helpers/install-quasar-plugin"`. That helper is now a no-op shim (per its own TODO header). `RunningQueries.spec.ts` and `RunningQueriesList.spec.ts` additionally do `import { QTable } from "quasar"`, which will fail to resolve once `quasar` is removed from `package.json` (and currently `q-table` is stubbed as `QTable` — but the template never renders `<q-table>`, so the stub is unused). `RunningQueriesList.spec.ts` asserts on `wrapper.vm.qTable`, `wrapper.vm.deleteDialog`, `wrapper.vm.lastRefreshed`, `wrapper.vm.pagination`, none of which the migrated component exposes — most assertions will throw.
- **`QueryPlanDialog.vue` has Vue-pragma issue in scoped styles**: `<style lang="scss" scoped>` is used but the migrated templates rely on `.text-weight-medium` (Quasar global), and `body.body--dark .verbose-output` (line 776) is a global descendant selector inside a scoped block — combined with `scoped` this still resolves because of the unscoped attribute selector behavior of body, but the rules duplicate logic that should live in either the global layer or the file scope, not both.
- **Logical regressions found**:
  - `QueryEditor.vue` `handleAIInputEnter` checks `isExecutionIntent` inside `handleAIGenerate`, but the `aiInputText.value.trim()` value never gets re-cleared on a failed AI request after the `setTimeout(..., 2000)` path — works for success, broken for cancel + retry.
  - `QueryPlanDialog.vue` registers a global `document.addEventListener("keydown", handleEscKey)` on open. The `ODialog` has its own ESC handling, so pressing ESC will fire both — this is harmless but redundant and creates a leak window if the dialog is unmounted without `showDialog` being set to false (the listener cleanup is only triggered by the `watch(showDialog)`, not `onUnmounted`).
  - `RunningQueries.vue` retains `:deep(.q-table th), :deep(.q-table td) { padding: 0px 16px; height: 32px; }` in a scoped block — the cells in `OTable` no longer carry `q-table` classes, so the entire table row height/padding override is silently inert. The displayed table uses OTable defaults.
  - `RunningQueries.vue` sets `style="position: sticky; top: 0; z-index: 1000;"` on the title row but the parent has `height: calc(100vh - var(--navbar-height))` and `overflow` is not explicitly set on the wrapper, so the sticky behavior depends entirely on the outer page's overflow context.
  - The toast variant `loading` is referenced via `toast({..., variant: "loading"})` in `RunningQueries.vue` — `loading` is a valid `ToastVariant`, OK.
  - `QueryEditor.vue` `OTooltip` now uses `:content` prop. Tooltips on Send/Close are rendered as **siblings** of the icon inside the button. `OTooltip` supports both default-slot and prop-based content, so this works, but the `OIcon name="stop"` next to `OTooltip :content="..."` inside a single `OButton` means the tooltip is anchored to the button itself (intended), but if `OTooltip` requires a trigger slot, it may not wire correctly. (See `OTooltip` slot details below.)

## Files Audited

- `web/src/components/QueryEditor.vue`
- `web/src/components/CodeQueryEditor.vue` (Monaco wrapper)
- `web/src/components/QueryPlanDialog.vue`
- `web/src/components/NLModeQueryBar.vue` (dead — not imported)
- `web/src/components/query-plan/QueryPlanTree.vue`
- `web/src/components/query-plan/QueryPlanNode.vue`
- `web/src/components/query-plan/MetricsSummaryCard.vue`
- `web/src/components/query-plan/CollapsibleProjection.vue` (dead — not imported)
- `web/src/components/queries/QueryList.vue`
- `web/src/components/queries/RunningQueries.vue`
- `web/src/components/queries/RunningQueriesList.vue`
- `web/src/components/queries/SummaryList.vue`

Spec files audited (read-only):

- `web/src/components/QueryEditor.spec.ts`
- `web/src/components/CodeQueryEditor.spec.ts`
- `web/src/components/QueryPlanDialog.spec.ts`
- `web/src/components/query-plan/QueryPlanNode.spec.ts`
- `web/src/components/query-plan/QueryPlanTree.spec.ts`
- `web/src/components/query-plan/MetricsSummaryCard.spec.ts`
- `web/src/components/query-plan/CollapsibleProjection.spec.ts`
- `web/src/components/queries/QueryList.spec.ts`
- `web/src/components/queries/RunningQueries.spec.ts`
- `web/src/components/queries/RunningQueriesList.spec.ts`
- `web/src/components/queries/SummaryList.spec.ts`

## Critical Issues

1. **`web/src/components/queries/RunningQueriesList.spec.ts:4`** — direct `import { QTable } from 'quasar'` at the top of the test file. If `quasar` is removed from `package.json`, this entire test file fails to compile. The imported `QTable` is referenced at lines 100-105 (`mockQTable` injecting onto `wrapper.vm.qTable`) but `RunningQueriesList.vue` no longer exposes a `qTable` ref — the assertions `expect(wrapper.vm.qTable).toBeDefined()` (line 176) will fail immediately on a green run, before the imported `QTable` is even used.

   **Solution:**
   ```diff
   - import { QTable } from "quasar";
   - // ...
   - const mockQTable = { ... };
   - wrapper.vm.qTable = mockQTable;
   - expect(wrapper.vm.qTable).toBeDefined();
   + // Remove QTable import; assert against new component surface
   + // (selectedRowsModel, handleSelectedIdsUpdate, etc.) via the new OTable instance
   ```

2. **`web/src/components/queries/RunningQueries.spec.ts:19`** — `import { QTable } from "quasar"`. Same risk: hard build break if `quasar` is dropped. The component template has no `<q-table>`, so stubbing it (line 156) is a no-op.

   **Solution:**
   ```diff
   - import { QTable } from "quasar";
   - // ...
   - stubs: { "q-table": QTable, "q-btn": true, ... }
   + // Drop quasar import; replace stubs with O* equivalents or rely on shallow mount
   + stubs: { OTable: true, OButton: true, OInput: true, OSelect: true }
   ```

3. **`web/src/components/queries/RunningQueries.vue:30`** — title `<div class="q-table__title tw:font-[600]" …>` references the Quasar utility `.q-table__title`. With Quasar removed, this class has no global definition anywhere in `web/src/styles/`. The title gets only `tw:font-[600]` styling and loses the original Quasar typography (font size, line height, color).

   **Solution:**
   ```diff
   - <div class="q-table__title tw:font-[600]" …>
   + <div class="tw:text-lg tw:font-semibold tw:leading-6" …>
   ```

4. **`web/src/components/query-plan/MetricsSummaryCard.vue:86, 101, 107, 130, 142, 149, 151`** — every accent color in the Metrics Summary card uses `rgba(var(--q-primary-rgb), …)`. `--q-primary-rgb` is **not defined** in `_variables.scss`, `_quasar-variables.scss`, or `app.scss`. The card background gradient, metric-item background, hover border, primary text color, and dark-mode tints all silently fall back. Expected behavior: header text in primary color and tinted card backgrounds — actual behavior: invisible/transparent backgrounds, default text color.

   **Solution:**
   ```diff
   - background: rgba(var(--q-primary-rgb), 0.1);
   - color: rgba(var(--q-primary-rgb), 0.9);
   + background: color-mix(in srgb, var(--o2-primary) 10%, transparent);
   + color: var(--o2-primary);
   ```
   Or define `--o2-primary-rgb: 89, 98, 246;` in `_variables.scss` and replace `--q-primary-rgb` → `--o2-primary-rgb` site-wide.

5. **`web/src/components/query-plan/QueryPlanNode.vue:217, 279, 283, 342`** — `var(--q-primary)` and `var(--q-primary-rgb)` references. `--q-primary` is aliased in `_variables.scss` (OK), but `--q-primary-rgb` is undefined. The Output-rows / Elapsed-compute metric badges in ANALYZE mode have `background-color: rgba(var(--q-primary-rgb), 0.1)` → invalid color → no background, badges appear unstyled.

   **Solution:**
   ```diff
   - background-color: rgba(var(--q-primary-rgb), 0.1);
   - color: var(--q-primary);
   + background-color: color-mix(in srgb, var(--o2-primary) 10%, transparent);
   + color: var(--o2-primary);
   ```

6. **`web/src/components/QueryEditor.vue:635-650, 665-678`** — `.ai-input-field :deep(.q-field__control)` and friends try to style the AI input bar. `OInput` does not render `q-field__control`. All ~15 declarations (white background, 32px min-height, padding, removed focus border, dark mode background/text/placeholder) are dead. Visual side-effect: AI input loses its bespoke pill chrome and shows the default `OInput` border/background.

   **Solution:**
   ```diff
   - .ai-input-field :deep(.q-field__control) {
   -   background-color: #fff; min-height: 32px; padding: 0 8px;
   - }
   - .body--dark .ai-input-field :deep(.q-field__control) { background-color: #1d1d1d; }
   + .ai-input-field :deep(.o-input__wrapper) {
   +   background-color: var(--o2-card-bg); min-height: 32px; padding: 0 8px;
   + }
   ```

7. **`web/src/components/NLModeQueryBar.vue:487-525`** — duplicates the same broken `:deep(.q-field__control)` rules and adds `.q-dark .ai-input-field :deep(...)` and `.q-dark .ai-bar-streaming` selectors. `.q-dark` is no longer the dark-mode trigger class (the app uses `.body--dark` / theme store state). All dark-mode AI bar styles are dead. (Mitigated only because the file itself is dead.)

   **Solution:**
   ```diff
   - // Delete entire file (528 LOC) - no consumers in web/src/
   - rm web/src/components/NLModeQueryBar.vue
   ```

8. **`web/src/components/queries/RunningQueries.vue:857-862, 878-882`** — `.running-queries-page :deep(.q-table th), :deep(.q-table td) { padding: 0px 16px; height: 32px; }` and `.search-field-select { .q-field__control { padding-left: 12px; … } }`. OTable cells don't carry `q-table` class — the entire 32px row-height override is dead. The second block is in a non-scoped `<style lang="scss">` and leaks `.q-field__control` rules globally, but no element on the page renders that class, so it's only a maintenance hazard, not a visible bug.

   **Solution:**
   ```diff
   - .running-queries-page :deep(.q-table th),
   - .running-queries-page :deep(.q-table td) { padding: 0 16px; height: 32px; }
   - .search-field-select .q-field__control { padding-left: 12px; }
   + .running-queries-page :deep(.o-table__th),
   + .running-queries-page :deep(.o-table__td) { padding: 0 16px; height: 32px; }
   ```

## Logical Issues

### Autocomplete / Syntax Highlighting / Run Query / Cancel — Status

- **Monaco autocomplete provider** (`CodeQueryEditor.vue:907-954`) — unchanged from `main`. Still uses `monaco.languages.registerCompletionItemProvider`. Works.
- **Default SQL keywords/suggestions** (lines 210-355) — unchanged. Works.
- **`vrl` / `promql` language registration** (lines 587-598) — unchanged. Works.
- **Ctrl/Cmd+Enter run-query binding** (lines 710-732) — unchanged. Works.
- **Double-quote validation diagnostic** (lines 1093-1137) — unchanged. Works.
- **`debounce` import** — switched from `quasar` to `lodash-es` (line 73). Behavior identical.
- **NL detection debounce** (lines 390-420) — unchanged. Works.
- **`handleGenerateSQL` AI flow** (lines 427-558) — unchanged. Works, including dashboard/alert/action completion branches.

### Cancel Query (in `RunningQueries`)

- `RunningQueries.vue:672-699` `deleteQuery` calls `SearchService.delete_running_queries(...)`. Works.
- `confirmDeleteAction` (line 701) flows `row.trace_id` → `deleteDialog.data` → `ConfirmDialog`. Works.
- The "Cancel Query" button in `RunningQueriesList.vue:51-58` and `SummaryList.vue:39-48` uses `OButton variant="ghost-destructive"` and emits `delete:query` / `delete:queries`. Wired through to `confirmDeleteAction`/`handleMultiQueryCancel`. Works.

### Query Plan Rendering

- `QueryPlanDialog.vue` `parsePlans` (lines 295-411), `parseSSEResponse` (413-454), and `fetchExplainPlan`/`runAnalyze` are unchanged from `main`. Works.
- `QueryPlanTree.vue` / `QueryPlanNode.vue` — only `q-icon` → `OIcon` swaps. Recursive tree rendering, expand/collapse, truncation handling — all unchanged.
- **Tree alignment bug risk**: `QueryPlanNode.vue:194-198` sets `display: flex; align-items: center; gap: 0; padding: 2px 0; white-space: pre;` on `.node-line`. Inside a flex container, `white-space: pre` on the parent only affects text nodes that are not in `<span>` children; the visual tree connectors (`├─`, `└─`) and indent prefixes inside `<span class="tree-indent">` rely on `font-family: monospace` (inherited from `.query-plan-tree`). The container itself is no longer `display: block`, so the connector characters may not align column-by-column with deeply nested children. This was not caused by the migration, but is worth flagging since query-plan layouts visually regressed in some prior reviews.

### `QueryEditor.vue` AI Send Button Tooltip

- Lines 51-54: `<OTooltip v-if="props.disableAi && props.disableAiReason" :content="props.disableAiReason" />` and `<OTooltip v-else-if="!aiInputText.trim()" :content="..." />` are rendered **as siblings of `<OIcon>` inside `<OButton>`**. `OTooltip` (`web/src/lib/overlay/Tooltip/OTooltip.vue`) is a wrapper around Reka's `TooltipRoot` + `TooltipTrigger`, so the tooltip will look for a trigger slot. When placed naked inside a button without a trigger, the tooltip portal still mounts but may not have anything to anchor to (depending on `OTooltip`'s implementation when used "embedded" — it tends to wrap the parent's content as the trigger when no default slot is provided). This pattern is used throughout the file and matches the migration in other O* components, but it deserves a smoke test — `OTooltip` was not designed for "naked sibling" placement in older versions.

### QueryPlanDialog ESC Handler Leak

- `QueryPlanDialog.vue:617-626` adds `document.addEventListener("keydown", handleEscKey)` only when the dialog opens, and removes it when it closes. If the parent unmounts the dialog while `showDialog === true` (e.g., navigation away), the listener is never removed. Add an explicit `onBeforeUnmount` cleanup.

   **Solution:**
   ```diff
   + import { onBeforeUnmount } from "vue";
   + onBeforeUnmount(() => {
   +   document.removeEventListener("keydown", handleEscKey);
   + });
   ```

### NLModeQueryBar `o2-color-primary` (dead-code logic)

- `NLModeQueryBar.vue:246` pushes `'o2-color-primary'` class for the run-query button. The global `.o2-color-primary` class is defined, but the file is unused anyway. No impact.

## CSS / Layout Issues

### Three-Layer CSS Violations

1. **Global pollution from "scoped" files**:
   - `RunningQueries.vue` has TWO `<style>` blocks: one `scoped`, one **non-scoped** (lines 869-884). The non-scoped block defines `.running-queries-page .search-input` and `.search-field-select .q-field__control` globally. The `.search-field-select` rule will apply to any element named `.search-field-select` anywhere in the app.
   - `RunningQueriesList.vue` has the **identical** non-scoped block (lines 266-280). It is a duplicate of the rules in `RunningQueries.vue`. If both files are mounted, the same global rules are registered twice.
   - `SummaryList.vue` has the **identical** non-scoped block (lines 188-202). Triple-duplicate. Promote to global layer once or delete entirely (the selectors target non-existent classes).
   - `CodeQueryEditor.vue` has a `<style lang="scss">` (no scoped) at the bottom (lines 1438-1460) that defines `.logs-query-editor` and `.highlight-error` globally — that's intentional (they need to leak into Monaco's DOM), but the comment is missing.

   **Solution:**
   ```diff
   - <style lang="scss"> // non-scoped block in RunningQueries/RunningQueriesList/SummaryList
   -   .running-queries-page .search-input { ... }
   -   .search-field-select .q-field__control { ... }
   - </style>
   + // Delete duplicates; promote shared styles to web/src/styles/_running-queries.scss
   ```

2. **Hardcoded dark mode tokens** instead of CSS variables:
   - `QueryPlanDialog.vue:670-717` — hardcoded `#f5f5f5`, `#181a1b`, `#f8f9fa`, `#ffffff`, `#1d1d1d`, `#e0e0e0`, `#121212`, `#1e1e1e`, `#3d3d3d` for both `pane-header-light` / `pane-header-dark` and `sql-query-content-light` / `sql-query-content-dark` variants. Should use `--o2-bg-secondary`, `--o2-card-bg`, `--o2-text-primary`, `--o2-border-color`.
   - `QueryPlanDialog.vue:770-782` — `.verbose-output` (light + `body.body--dark .verbose-output`) duplicates the same hardcoded palette.
   - `QueryPlanNode.vue:201-353` — every color is hardcoded `rgba(0, 0, 0, 0.X)` or `rgba(255, 255, 255, 0.X)`. Should use semantic tokens.
   - `QueryPlanTree.vue:64, 74` — `rgba(0, 0, 0, 0.02)` and `rgba(255, 255, 255, 0.03)` instead of `--o2-bg-subtle`.

   **Solution:**
   ```diff
   - background: #f5f5f5; color: #181a1b; border: 1px solid #e0e0e0;
   - background: rgba(0, 0, 0, 0.02);
   + background: var(--o2-bg-secondary);
   + color: var(--o2-text-primary);
   + border: 1px solid var(--o2-border-color);
   + background: var(--o2-bg-subtle);
   ```

3. **Promotion candidates** (duplicated styles that should be in the global layer):
   - The **AI gradient / hover/active styles** are repeated across `QueryEditor.vue` (`.ai-floating-button`, `.ai-send-button`, `.ai-stop-button`, `.ai-input-bar`) and `NLModeQueryBar.vue` (`.o2-ai-generate-button`, `.ai-input-bar`, `.ai-bar-streaming`) using slightly different gradient stops and shadow values. Promote a single `o-ai-button` and `o-ai-input-bar` partial to `web/src/lib/` or `web/src/styles/_ai.scss`.
   - The **streaming preview card** (`.streaming-preview-card`, `.streaming-preview-content`, `.animated-dots`, `@keyframes ellipsis`, `.slide-up-*` transitions) in `CodeQueryEditor.vue` (lines 1290-1426) duplicates O2 AI Assistant styling — same component should be reused.
   - The `q-table` / `q-field__control` `:deep()` rules duplicated across three files are dead and should simply be deleted.

4. **`body.body--dark` selector inside `<style scoped>`**:
   - `QueryPlanTree.vue:72-77`, `QueryPlanNode.vue:312-356`, `MetricsSummaryCard.vue:140-158` use `.body--dark { … }` inside scoped blocks. In Vue's scoped CSS, this compiles to `.body--dark[data-v-hash] …`, which **does not match `<body class="body--dark">`** because the body element doesn't get the scoped attribute. The dark-mode rules in all three files are silently inert. Use `:global(.body--dark) &` (Tailwind 4) or move to global file.

   **Solution:**
   ```diff
   - .body--dark .my-node { background: #2a2a2a; }
   + :global(html.dark) .my-node { background: var(--o2-card-bg); }
   ```

### File-Level Layer Issues

- `QueryEditor.vue:546` — `outline-color: transparent;` on `.query-editor` is intended to remove focus outline, but `outline-style: none` is more reliable. Minor.
- `CodeQueryEditor.vue:1192` — `#editor { width: 100%; height: 78%; … }` references an ID `editor` but the actual editor uses `props.editorId` (default `"editor"`, but often overridden). The `78%` height is a magic number — when the parent is `100%` tall this leaves 22% empty space. Probably stale from a non-Monaco layout.
- `QueryEditor.vue:556-587` — `.ai-floating-button` uses `linear-gradient(...)` with `!important` 11 times. Tailwind-equivalent classes (`tw:bg-gradient-to-br`, etc.) would let us drop most of the `!important`.

### Tailwind Inconsistencies

- `QueryPlanDialog.vue:124, 150, 163` — `tw:text-gray-400`. Tailwind 4 in this project's design system uses `--o2-text-muted` or `--o2-text-secondary`. Hard color names diverge from theme.
- `QueryPlanDialog.vue:39, 68` — `tw:text-base tw:font-medium text-weight-medium` — both Tailwind `tw:font-medium` AND Quasar `text-weight-medium` applied. The Quasar one is dead.
- `MetricsSummaryCard.vue:20` — same `tw:text-sm tw:font-medium text-weight-bold` collision (`tw:font-medium` and `text-weight-bold` are contradictory, and the Quasar one is dead anyway).

**Solution:**
```diff
- <div class="tw:text-gray-400">
- <div class="tw:text-base tw:font-medium text-weight-medium">
- <div class="tw:text-sm tw:font-medium text-weight-bold">
+ <div class="tw:text-[var(--o2-text-secondary)]">
+ <div class="tw:text-base tw:font-medium">
+ <div class="tw:text-sm tw:font-bold">
```

## Component Migration Issues

### `QueryEditor.vue`

- `OSpinner variant="dots" size="xs"` (line 16) — confirmed `OSpinner` accepts `variant="dots"` (used elsewhere).
- `OTooltip :content="..."` (lines 26, 52, 53, 64, 104) used as a sibling element rather than wrapped trigger. This pattern works for the new `OTooltip` only because it auto-finds the parent. Worth verifying interactively (no e2e provided in this audit).
- `OInput :class="aiInputFieldClass"` (line 31) plus the `:deep(.q-field__control)` styling in `<style>` is the broken pair noted above.

### `CodeQueryEditor.vue`

- `OIcon size="md"` wrapping `<img>` (line 35) — `OIcon` expects a `name` prop normally, but here it's used purely as a sized wrapper. May still work, but it's an odd pattern; if `OIcon` switches to rendering an `<svg>` regardless of slot content, the wrapped image might disappear. The change is **smaller** than the corresponding `q-icon size="20px"` → had explicit slot — verify visual.
- Imports: `OButton`, `OIcon`, `OTooltip` — all present.

### `QueryPlanDialog.vue`

- `ODialog v-model:open="showDialog" size="full"` (line 19) — replaces `<q-dialog v-model="showDialog" maximized>`. The `size="full"` variant of `ODialog` is supported (`web/src/lib/overlay/Dialog/ODialog.vue:135-160`).
- `OSplitter v-model="splitterPosition" :horizontal="false"` (line 26) — `OSplitter` uses `modelValue` and `update:modelValue`, so v-model works. `:horizontal="false"` is the explicit default. OK.
- `OTabs v-model="activeTab" dense class="tw:text-gray-500" align="left"` (line 135) — `dense` is a valid prop. The `tw:text-gray-500` overrides the tab color globally for inactive tabs; the active tab color comes from inside `OTabs`. Visual regression risk: inactive tab text always gray-500 instead of muted theme token.
- `OBanner variant="error" icon="error" :content="error"` (line 103) — `OBanner` accepts `content` prop and `icon` prop. OK.
- `OCard` / `OCardSection role="body"` (lines 116-128) — explicit `role="body"` was added. OK.

### `query-plan/MetricsSummaryCard.vue`

- `<OCardSection role="body">` plus `tw:text-sm tw:font-medium text-weight-bold` mixed classes (line 20). The Tailwind `font-medium` (500) and the (now-dead) Quasar `text-weight-bold` (700) contradict each other — the result is `font-medium` (500).

### `query-plan/QueryPlanNode.vue`

- `OIcon name="format-list-numbered" size="xs"` and `OIcon name="schedule" size="xs"` (lines 56, 60) — sizes "xs" must exist in `OIcon`'s size map.

### `RunningQueries.vue`

- Title row marker `q-table__title` (line 30) — dead Quasar class.
- Uses `OToggleGroup` / `OToggleGroupItem`, `OSelect`, `OInput`, `OButton`, `OIcon`, `ODrawer`, `ConfirmDialog`, `toast()`. All wired correctly.
- `OSelect :options="searchFieldOptions" labelKey="label" valueKey="value"` (lines 56-64) — verify `OSelect` accepts `labelKey`/`valueKey` (this is non-standard for the OpenObserve `OSelect`, but seems to be supported per other migrations).
- Filter input uses `<template #icon-left>` on `OInput` — correct slot name (`OInput.vue:235`).

### `RunningQueriesList.vue` & `SummaryList.vue`

- Migrated to `OTable` with `columns: OTableColumnDef[]`. Correct prop names: `data`, `columns`, `row-key`, `selection`, `pagination`, `page-size`, `page-size-options`, `sorting`, `filter-mode`, `default-columns`, `show-global-filter`, `selected-ids` / `v-model:selected-ids`.
- Empty/bottom slots use `#empty`, `#cell-*`, `#bottom` — correct OTable slot names.
- Both files have the same triple-duplicated non-scoped `<style>` block (Quasar leftover).

### `QueryList.vue`

- Uses `OCard`, `OCardSection role="header"`, `OSeparator`, `OButton variant="ghost" icon-left="close"`, `OTable`. All wired correctly.
- `col-auto` class (line 15) — dead Quasar class.
- `o2-table-hide-header :deep(thead) { display: none; }` (line 177) — verify OTable still wraps headers in a `<thead>` element (it does), so this still works.

### Unused / Dead Components

- `web/src/components/NLModeQueryBar.vue` — **528 lines, not imported by any file in `web/src/`** outside its own internal references. Delete.
- `web/src/components/query-plan/CollapsibleProjection.vue` and its spec — **not imported anywhere** outside its own spec. Delete both.

## Test File Issues

### Hard Imports of Quasar

- `web/src/components/queries/RunningQueries.spec.ts:19` — `import { QTable } from "quasar"`.
- `web/src/components/queries/RunningQueriesList.spec.ts:4` — `import { QTable } from "quasar"`.

If `quasar` is dropped from `package.json` (the stated migration goal), both files fail to compile.

### Reliance on `installQuasar` no-op shim

Every spec file in scope imports `installQuasar` from `@/test/unit/helpers/install-quasar-plugin`. The helper still exists but its own header says: *"TODO: REMOVE THIS FILE when unit tests are rewritten. All references to `tempQuasarPlugin()` in spec files should be replaced with direct `qLayoutInjections()` calls."* These tests are not yet rewritten.

### Stub Mismatches

Many spec files still stub Quasar components that the migrated templates no longer render:

- `RunningQueries.spec.ts:156-169` stubs `q-table`, `q-btn`, `q-input`, `q-select`, `q-tab`, `q-tab-panels`, `q-tabs`, `q-card`, `q-card-section`, `q-card-actions`, `q-separator`, `q-tooltip`, `OIcon` (as `true`). None of `q-table`, `q-btn`, etc., are rendered by the migrated `RunningQueries.vue`; the stubs are unused and `OIcon: true` will replace OIcon with a void element, breaking icon-related assertions.
- `QueryPlanDialog.spec.ts:140-150` stubs `q-splitter`, `q-separator`, `OIcon`, `q-space`, `q-tooltip`, `q-banner`, `q-card`, `q-card-section`. The current template uses `OSplitter`, `OSeparator`, `OBanner`, `OCard`, `OCardSection`, `OIcon`, `OTooltip` — none are stubbed. The `q-*` stubs are dead.
- `QueryEditor.spec.ts:52-58` defines `vi.mock("quasar", ...)` — the QueryEditor component itself no longer imports anything from `quasar`, so the mock target may be unresolved at module-load time once `quasar` is removed.

### Assertions on Non-Existent VM Properties

- `RunningQueriesList.spec.ts:174-178` — `wrapper.vm.qTable` is asserted, but the migrated `RunningQueriesList.vue` does not expose `qTable` from `setup()`. Test will fail.
- `RunningQueriesList.spec.ts:186-205` — `wrapper.vm.deleteDialog`, `wrapper.vm.lastRefreshed`, `wrapper.vm.resultTotal`, `wrapper.vm.selectedPerPage`, `wrapper.vm.pagination`, `wrapper.vm.showListSchemaDialog`. The migrated component exposes only `t`, `store`, `columns`, `confirmDeleteAction`, `listSchema`, `showListSchemaDialog`, `schemaData`, `loadingState`, `isMetaOrg`, `selectedRowsModel`, `selectedRowIds`, `handleSelectedIdsUpdate`, `handleMultiQueryCancel`, `getDuration`, `durationFormatter`. All of `deleteDialog`, `lastRefreshed`, `resultTotal`, `selectedPerPage`, `pagination` are now in the parent `RunningQueries.vue` only.

### Dead Spec

- `web/src/components/query-plan/CollapsibleProjection.spec.ts` tests a component that no code imports. Delete the spec when deleting the component.

## Accessibility

- `QueryEditor.vue:8-67` — AI input bar uses `OInput`, `OButton`, `OTooltip`. `<img :src="nlpIcon" alt="AI" />` has an alt; the streaming row also has `alt="AI"`. OK.
- `QueryEditor.vue:103` — `<img :src="nlpIcon" alt="AI Mode" />` inside `OButton` with tooltip. OK.
- `QueryPlanDialog.vue:31-46` — pane header is `<div>` with `<OIcon name="code">` and a text label `<div class="… tw:font-medium">SQL Query</div>`. Should be `<h2>` or similar heading for screen-reader navigation. (Same for the right pane header.)
- `QueryPlanDialog.vue:89-99` — loading state uses `tw:flex flex-center` (broken — `flex-center` undefined) for the spinner; the loading copy is in a `<div>`, not announced via `aria-live`. Screen-reader users won't hear "Loading plan…" updates.
- `QueryPlanTree.vue:18-31` — outer `<div class="query-plan-tree">` lacks `role="tree"` and child `<div class="tree-node">` lacks `role="treeitem"`. The expand/collapse element is a `<span>` with `@click` (line 28-34 of `QueryPlanNode.vue`) — should be `<button>` or have `role="button"` + `tabindex="0"` + `@keydown.enter/space`. Currently keyboard users cannot expand/collapse plan nodes.
- `MetricsSummaryCard.vue` — uses `OCard`/`OCardSection` with text content. No live region, no semantic headings. The text "Execution Summary" is just a div with custom font weight.
- `RunningQueries.vue` filter row — `OSelect` and `OInput` rely on their internal a11y. The "Refresh" button has visible text. OK.
- `OTable` empty state contains `<NoData />`; `OSpinner` does not announce "Loading". Consider `aria-live="polite"`.

## Recommendations

1. **Delete unused files** (low-risk, removes 600+ LOC):
   - `web/src/components/NLModeQueryBar.vue`
   - `web/src/components/query-plan/CollapsibleProjection.vue` + spec

2. **Remove dead `:deep(.q-*)` CSS** from:
   - `QueryEditor.vue` (lines 635-678)
   - `NLModeQueryBar.vue` (covered by deletion above)
   - `RunningQueries.vue` scoped (lines 857-862) and non-scoped (869-884) blocks
   - `RunningQueriesList.vue` (lines 266-280 + the scoped `:deep(.q-btn:before)` at 252-257)
   - `SummaryList.vue` (lines 174-202)

3. **Define `--q-primary-rgb` in `_variables.scss`** (or migrate all consumers to a new `--o2-primary-rgb`). Affects:
   - `query-plan/MetricsSummaryCard.vue` (5 sites)
   - `query-plan/QueryPlanNode.vue` (2 sites)
   - `web/src/styles/logs/json-preview.scss:75`

4. **Replace Quasar utility classes** still in templates:
   - `q-table__title` → `tw:text-lg tw:font-semibold` (RunningQueries.vue:30)
   - `flex-center` → `tw:flex tw:items-center tw:justify-center` (QueryPlanDialog.vue:89)
   - `full-height` / `full-width` → `tw:h-full` / `tw:w-full` everywhere (avoid relying on the logs-page-scoped definitions)
   - `text-weight-medium` / `text-weight-bold` → already accompanied by `tw:font-medium` / `tw:font-bold` redundantly; delete the Quasar names
   - `col-auto` → `tw:ml-auto` (QueryList.vue:15)

   **Solution:**
   ```diff
   - <div class="q-table__title tw:font-[600]">
   - <div class="flex-center">Loading…</div>
   - <div class="full-height full-width">
   - <span class="text-weight-medium">Title</span>
   - <div class="col-auto">
   + <div class="tw:text-lg tw:font-semibold tw:leading-6">
   + <div class="tw:flex tw:items-center tw:justify-center">Loading…</div>
   + <div class="tw:h-full tw:w-full">
   + <span class="tw:font-medium">Title</span>
   + <div class="tw:ml-auto">
   ```

5. **Fix `body.body--dark` selectors inside scoped styles** in `QueryPlanTree.vue`, `QueryPlanNode.vue`, `MetricsSummaryCard.vue` — move to a non-scoped block or use `:global(.body--dark) &`.

6. **Hardcoded color tokens** — replace `#f5f5f5`, `#181a1b`, `#1e1e1e`, `rgba(0,0,0,0.X)` etc. in `QueryPlanDialog.vue` (lines 670-782) and `QueryPlanNode.vue` (lines 201-353) with `--o2-*` semantic tokens.

7. **Promote AI gradient styles** to a global partial (`web/src/styles/_ai.scss`). Currently duplicated across `QueryEditor.vue`, `NLModeQueryBar.vue`, and `CodeQueryEditor.vue`.

8. **Rewrite spec files**:
   - Drop `import { QTable } from "quasar"` from `RunningQueries.spec.ts` and `RunningQueriesList.spec.ts`.
   - Remove `vi.mock("quasar", ...)` from `QueryEditor.spec.ts`.
   - Re-derive assertions in `RunningQueriesList.spec.ts` against the new VM surface (no `qTable`, `deleteDialog`, `lastRefreshed`, etc.).
   - Replace `q-table`/`q-btn`/etc. stubs with the corresponding `O*` component stubs or rely on shallow-mount.

9. **Add `onBeforeUnmount` cleanup for ESC handler** in `QueryPlanDialog.vue` (lines 617-626).

10. **Accessibility**: add `role="tree"` / `role="treeitem"` / `aria-expanded` to `QueryPlanTree.vue` and `QueryPlanNode.vue`, and replace clickable `<span class="expand-icon">` with a real `<button>`. Add `aria-live="polite"` to the dialog's loading state in `QueryPlanDialog.vue`.

11. **Dead Monaco-related declaration in `CodeQueryEditor.vue:1189-1193`** — the `#editor { … height: 78%; }` rule references an ID `editor` that may collide with other editors on the page or simply be stale. Verify whether any user-visible editor still relies on this and prefer a class-based selector.

## Class-Level Styling Audit

### 1. Quasar Class Leftovers
| File:Line | Class | Replacement | Layer |
| --- | --- | --- | --- |
| `QueryPlanDialog.vue:25` | `full-height` | `tw:h-full` | File |
| `QueryPlanDialog.vue:26` | `full-height` | `tw:h-full` | File |
| `QueryPlanDialog.vue:29` | `full-height` | `tw:h-full` | File |
| `QueryPlanDialog.vue:39` | `text-weight-medium` | `tw:font-medium` (redundant) | File |
| `QueryPlanDialog.vue:59` | `full-height` | `tw:h-full` | File |
| `QueryPlanDialog.vue:68` | `text-weight-medium` | `tw:font-medium` (redundant) | File |
| `QueryPlanDialog.vue:89` | `flex-center` / `full-height` | `tw:items-center tw:justify-center` / `tw:h-full` | File |
| `MetricsSummaryCard.vue:20` | `text-weight-bold` | `tw:font-bold` (redundant) | File |
| `QueryList.vue:15` | `col-auto` | `tw:flex-none` | File |
| `RunningQueries.vue:30` | `q-table__title` | `tw:text-base` (custom title style) | File |
| `RunningQueriesList.vue:35` | `full-height` | `tw:h-full` | File |
| `RunningQueriesList.vue:38` | `full-height` | `tw:h-full` | File |
| `SummaryList.vue:32` | `full-height` | `tw:h-full` | File |
| `SummaryList.vue:35` | `full-height` | `tw:h-full` | File |

### 2. Tailwind v4 Misuse
| File:Line | Wrong | Right | Layer |
| --- | --- | --- | --- |
| *(none found)* | | | |

### 3. Quasar CSS Variables
| File:Line | Variable | Replacement | Layer |
| --- | --- | --- | --- |
| `QueryEditor.vue:657` | `var(--q-primary)` | `var(--o2-primary)` | File |
| `NLModeQueryBar.vue:445` | `var(--q-dark-page)` | `var(--o2-bg-primary)` | File |
| `NLModeQueryBar.vue:508` | `var(--q-primary)` | `var(--o2-primary)` | File |
| `NLModeQueryBar.vue:517,521` | `var(--q-dark)` | `var(--o2-bg-primary)` | File |
| `QueryPlanNode.vue:217` | `var(--q-primary)` | `var(--o2-primary)` | File |
| `QueryPlanNode.vue:279,283,342` | `var(--q-primary-rgb)` / `var(--q-primary)` | Define `--o2-primary-rgb` in `_variables.scss` or use `color-mix()` | Global + File |
| `CollapsibleProjection.vue:124` | `var(--q-primary)` | `var(--o2-primary)` (file is dead — delete) | File |
| `MetricsSummaryCard.vue:86,101,106,130,142,146,150` | `var(--q-primary-rgb)` / `var(--q-primary)` | Define `--o2-primary-rgb` in `_variables.scss` or use `color-mix()` | Global + File |

### 4. Dead `:deep(.q-*)` / `body.body--dark` / `::v-deep`
| File:Line | Selector | Action | Layer |
| --- | --- | --- | --- |
| `QueryEditor.vue:635-678` | `:deep(.q-field__control)`, `:deep(.q-field__native)`, `:deep(.q-field__prepend)` (~7 rules) | Remove — `OInput` does not render `.q-field`; rebuild AI bar styles around `OInput` chrome | File |
| `NLModeQueryBar.vue:487-518` | `:deep(.q-field__control)`, `:deep(.q-field__native)`, `:deep(.q-field__prepend)`, `.q-dark .ai-input-field` (~7 rules) | Remove — file is dead code | File |
| `QueryPlanDialog.vue:776` | `body.body--dark .verbose-output` | Replace with `html.dark .verbose-output` (move out of scoped) | File |
| `RunningQueries.vue:857-858` | `:deep(.q-table th)`, `:deep(.q-table td)` | Remove — `OTable` does not emit `.q-table`; override via `OTable` API | File |
| `RunningQueries.vue:877` | `.q-field__control` (inside `.search-field-select`) | Remove — `OInput`/`OSelect` do not emit `.q-field` | File |
| `RunningQueriesList.vue:254` | `:deep(.q-btn:before)` | Remove — `OButton` has no `q-btn:before` | File |
| `RunningQueriesList.vue:274` | `.q-field__control` | Remove | File |
| `SummaryList.vue:176` | `:deep(.q-btn:before)` | Remove | File |
| `SummaryList.vue:196` | `.q-field__control` | Remove | File |

### 5. Quasar SCSS Variables in Scoped Styles
| File:Line | Variable | Replacement | Layer |
| --- | --- | --- | --- |
| *(none found)* | | | |

### 6. Quasar Directives
| File:Line | Directive | Action |
| --- | --- | --- |
| *(none found)* | | |

### 7. Icon Migration
| File:Line | Issue | Fix |
| --- | --- | --- |
| *(none found — all `OIcon` names use hyphens; no `:color` props)* | | |

### 8. Inline `style=` Hot Spots
| File:Line | Inline style | Suggested home |
| --- | --- | --- |
| `QueryEditor.vue:7` | `:style="rootStyle"` (dynamic) | Keep — bound to JS; OK |
| `QueryList.vue:4` | `min-width: 480px; max-width: 800px` | Move to scoped `.query-list` partial or `_query-list.scss` |
| `RunningQueries.vue:21` | `min-height: inherit; height: calc(100vh - var(--navbar-height));` | Move to scoped `.running-queries-page` rule |
| `RunningQueries.vue:27` | `position: sticky; top: 0; z-index: 1000;` | Move to `.running-queries-sticky-header` class |
| `RunningQueries.vue:103` | `height: calc(100vh - var(--navbar-height) - 92px)` | Move to `.card-container` scoped class (it already exists) |
| `SummaryList.vue:28` | `width: 100%` | Replace with `tw:w-full` |

### 9. Duplicate Style Blocks
| Files | Duplicated block | Suggested partial |
| --- | --- | --- |
| `QueryEditor.vue` + `NLModeQueryBar.vue` + `CodeQueryEditor.vue` | AI gradient bar styles (`.ai-bar-streaming`, `.ai-input-field`) | Move to `web/src/styles/_ai-bar.scss` |
| `RunningQueries.vue` + `RunningQueriesList.vue` + `SummaryList.vue` | `:deep(.q-btn:before)`, `.q-field__control` blocks | Delete from all three (no longer matches DOM) |

### 10. Layer Summary
- Global (`app.scss` / `_variables.scss`) changes needed: **1** (declare `--o2-primary-rgb` or migrate `var(--q-primary-rgb)` usages to `color-mix(in srgb, var(--o2-primary) 10%, transparent)`)
- Component-level partial changes: **1** (create `_ai-bar.scss` for AI input/streaming gradients shared across QueryEditor + NLModeQueryBar + CodeQueryEditor)
- File-level scoped changes: **12** (delete dead `:deep(.q-*)` + Quasar `var(--q-*)` references across QueryEditor, NLModeQueryBar, QueryPlanDialog, QueryPlanNode, MetricsSummaryCard, CollapsibleProjection, RunningQueries, RunningQueriesList, SummaryList; replace `full-height`/`flex-center`/`text-weight-*`/`col-auto`/`q-table__title` with `tw:*` equivalents; move inline `style=` blocks into scoped rules)
