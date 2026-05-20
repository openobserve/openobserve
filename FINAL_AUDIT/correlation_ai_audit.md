# Cross-Linking / AI / Correlation — Quasar Removal Audit

## Summary

Audited the cross-linking, AI assistant, and telemetry correlation components after Quasar removal. The migration is **functionally incomplete** in several places: scoped styles still depend on Quasar CSS variables that no longer resolve, two test files still import literal `quasar` symbols, OSelect is being passed Quasar-only props (`use-input`, `fill-input`, `input-debounce`, `@filter`, slot `v-slot:no-option`) that the O* component does not implement, and several scoped `.scss` blocks target `:deep(.q-field__*)` / `:deep(.q-dark)` / `body.body--dark` selectors that the migrated DOM no longer emits.

Severity buckets observed:
- 1 critical (CrossLinkDialog field-search broken)
- ~50 stale Quasar CSS-var references (`--q-primary`, `--q-page-background`, `--q-hover-color`, `--q-border-color`, `--q-color-grey-2`, `--q-negative`, `--q-text-secondary`, `--q-item-bg`, `--q-item-hover-bg`, `--q-header-bg`, `--q-background`, `--q-primary-rgb`, `--q-primary-text`, `--q-dark`, `--q-negative-rgb`)
- ~7 `:deep(.q-…)` blocks that no longer match anything
- 10+ test files broken (`installQuasar` is not exported anywhere)
- 1 missing helper module reference (`installQuasar`)

## Files Audited

- `/Users/ktx/Documents/Projects/openobserve.worktrees/ux-revamp/web/src/components/cross-linking/CrossLinkUserGuide.vue`
- `/Users/ktx/Documents/Projects/openobserve.worktrees/ux-revamp/web/src/components/cross-linking/CrossLinkManager.vue`
- `/Users/ktx/Documents/Projects/openobserve.worktrees/ux-revamp/web/src/components/cross-linking/CrossLinkDialog.vue`
- `/Users/ktx/Documents/Projects/openobserve.worktrees/ux-revamp/web/src/components/ai_toolsets/AddAiToolset.vue`
- `/Users/ktx/Documents/Projects/openobserve.worktrees/ux-revamp/web/src/components/O2AIChat.vue` (7486 lines)
- `/Users/ktx/Documents/Projects/openobserve.worktrees/ux-revamp/web/src/components/O2AIConfirmDialog.vue`
- `/Users/ktx/Documents/Projects/openobserve.worktrees/ux-revamp/web/src/components/common/O2AIContextAddBtn.vue` (Note: actual path differs from prompt; lives in `components/common/`, not `components/`)
- `/Users/ktx/Documents/Projects/openobserve.worktrees/ux-revamp/web/src/components/TelemetryCorrelationPanel.vue`
- `/Users/ktx/Documents/Projects/openobserve.worktrees/ux-revamp/web/src/plugins/correlation/CorrelatedLogsTable.vue`
- `/Users/ktx/Documents/Projects/openobserve.worktrees/ux-revamp/web/src/plugins/correlation/DimensionFilterEditor.vue`
- `/Users/ktx/Documents/Projects/openobserve.worktrees/ux-revamp/web/src/plugins/correlation/DimensionFiltersBar.vue`
- `/Users/ktx/Documents/Projects/openobserve.worktrees/ux-revamp/web/src/plugins/correlation/TelemetryCorrelationDashboard.vue` (3150 lines)
- `/Users/ktx/Documents/Projects/openobserve.worktrees/ux-revamp/web/src/plugins/correlation/TimeRangeEditor.vue`
- `/Users/ktx/Documents/Projects/openobserve.worktrees/ux-revamp/web/src/views/CorrelationDemo.vue`
- All companion `*.spec.ts` / `*.spec.js` files

## Critical Issues

### 1. `CrossLinkDialog.vue` — Field-search OSelect uses Quasar-only props
File: `web/src/components/cross-linking/CrossLinkDialog.vue` lines 72-94

```
<OSelect
  ...
  use-input
  fill-input
  hide-selected
  input-debounce="0"
  @filter="filterFieldOptions"
  @input-value="onFieldInputValue"
  ...
>
  <template v-slot:no-option>
```

OSelect (`web/src/lib/forms/Select/OSelect.vue`) does NOT implement `use-input`, `fill-input`, `input-debounce`, `@filter`, `@input-value`, or `v-slot:no-option`. The dev-time warning at OSelect line 102 explicitly mentions Quasar-style `useInput` is unsupported. Result: typing in the cross-link field search will not filter options, dropdown shows nothing/everything, and the "+ button" enabled-state branch (line 108 `:disabled="!newFieldName && !fieldInputValue"`) is unreachable via filter typing.

In addition the script references `fieldSelectRef.value?.updateInputValue` (line 194) — that method exists on Quasar QSelect, not on OSelect. Calling `clearFieldInput()` is currently a silent no-op for the input text.

**Solution:**
```diff
  <OSelect
    ...
-   use-input fill-input hide-selected input-debounce="0"
-   @filter="filterFieldOptions"
-   @input-value="onFieldInputValue"
+   searchable
+   :search-debounce="0"
+   @search="onFieldInputValue"
  >
-   <template v-slot:no-option>...</template>
+   <template #empty>...</template>
  </OSelect>
- fieldSelectRef.value?.updateInputValue("", true);
+ fieldInputValue.value = "";
```

### 2. `O2AIChat.vue` — Multi-screen Quasar CSS variable dependency
File: `web/src/components/O2AIChat.vue`

21 references to `--q-*` CSS variables: lines 5675, 5697, 5716, 5720, 5808, 5809, 5868, 5901, 5902, 5996, 6000, 6207, 6210, 6265, 6426, 6465, 6470, 6489, 6516, 6523, 6527. None of these resolve (Quasar's variable shim is gone). The chat surface gets the browser-default unset background and a transparent border on the history sticky search bar (line 5697 `background: var(--q-page-background)` with no fallback).

Specific tokens that no longer resolve:
- `var(--q-primary)` and `var(--q-primary-text)` — used for highlighted text, links, and the BETA badge border (line 6465-6470)
- `var(--q-page-background)` — used for the history sticky search bar bg (5697), history menu (6489), clear-all container (6516)
- `var(--q-hover-color)`, `var(--q-primary-rgb)`, `var(--q-negative)`, `var(--q-negative-rgb)`, `var(--q-dark)`

**Solution:**
```diff
- background: var(--q-page-background);
- color: var(--q-primary-text);
- background: rgba(var(--q-primary-rgb), 0.08);
- color: var(--q-negative);
+ background: var(--o2-bg-color);
+ color: var(--o2-text-primary);
+ background: color-mix(in srgb, var(--o2-primary) 8%, transparent);
+ color: var(--o2-negative);
```

### 3. `O2AIConfirmDialog.vue` — Confirm/Cancel/Always button colours all fall through
File: `web/src/components/O2AIConfirmDialog.vue` lines 503, 509, 514, 515, 521, 527, 532, 533

The `confirm-btn` (lines 503-535) in both light and dark modes uses `var(--q-primary)` for text colour, hover border, focused background, focused border, and focused box-shadow. Without a fallback the buttons render with computed-value invalid colours: the "Allow" / Yes button is not visually distinguishable from the cancel button.

**Solution:**
```diff
  .confirm-btn {
-   color: var(--q-primary);
-   border-color: var(--q-primary);
-   box-shadow: 0 0 0 3px rgba(var(--q-primary-rgb), 0.2);
+   color: var(--o2-primary);
+   border-color: var(--o2-primary);
+   box-shadow: 0 0 0 3px color-mix(in srgb, var(--o2-primary) 20%, transparent);
  }
```

### 4. `TelemetryCorrelationPanel.vue` — Entire stylesheet is Quasar-dependent
File: `web/src/components/TelemetryCorrelationPanel.vue` lines 305, 306, 314, 315, 351, 355, 389, 445, 447, 450, 456

```
.correlation-panel { background: var(--q-background); border-left: 1px solid var(--q-border-color); }
.correlation-header { border-bottom: 1px solid var(--q-border-color); background: var(--q-header-bg); }
.query-item { background: var(--q-item-bg); border: 1px solid var(--q-border-color); ... &:hover { background: var(--q-item-hover-bg); } }
```

None of these variables exist in the new design tokens (the codebase uses `--o2-*` tokens). The whole right-side correlation panel will be unstyled — transparent, borderless, no hover affordance.

**Solution:**
```diff
- .correlation-panel { background: var(--q-background); border-left: 1px solid var(--q-border-color); }
- .correlation-header { background: var(--q-header-bg); }
- .query-item { background: var(--q-item-bg); &:hover { background: var(--q-item-hover-bg); } }
+ .correlation-panel { background: var(--o2-bg-color); border-left: 1px solid var(--o2-border-color); }
+ .correlation-header { background: var(--o2-card-header-bg); }
+ .query-item { background: var(--o2-card-bg); &:hover { background: var(--o2-hover-bg); } }
```

## Logical Issues

### 1. `TelemetryCorrelationPanel.vue` line 224 — unused import causes confusion
```
const { findRelatedTelemetry, error: correlationError, isLoadingServices } = useServiceCorrelation();
```
`isLoadingServices` is destructured but never referenced; the panel's `loading` state is tracked via a local `ref` on line 226. Either wire the composable's loader or drop the import.

**Solution:**
```diff
- const { findRelatedTelemetry, error: correlationError, isLoadingServices } = useServiceCorrelation();
+ const { findRelatedTelemetry, error: correlationError } = useServiceCorrelation();
```

### 2. `CorrelationDemo.vue` (line 130) — query preview dialog never opens
`showQueryDialog` and `queryPreview` are declared (lines 149-150) but no path in `navigateToQuery` (which lives in `TelemetryCorrelationPanel`, not in this demo) sets them; dead state with no consumer. The demo cannot demonstrate the "show generated query" feature its UI advertises.

**Solution:**
```diff
- const showQueryDialog = ref(false);
- const queryPreview = ref(null);
- // and remove related dialog markup
```

### 3. `CrossLinkUserGuide.vue` lines 27-30 — relies on Quasar-era global classes
Template binds `'theme-dark bg-dark'` / `'theme-light bg-white'`. `.bg-white` exists at `web/src/styles/app.scss:401`, but `.bg-dark` is not defined globally and `.theme-dark` / `.theme-light` are scoped local classes (lines 141-147) — they work only because they are scoped + the same element. However the `bg-dark` class still falls through to nothing, so dark-mode background of the floating user guide is whatever bleeds through (likely white).

**Solution:**
```diff
- :class="store.state.theme === 'dark' ? 'theme-dark bg-dark' : 'theme-light bg-white'"
+ :class="store.state.theme === 'dark' ? 'theme-dark tw:bg-gray-800' : 'theme-light tw:bg-white'"
```

### 4. `CrossLinkUserGuide.vue` line 15 — `class="user-guide scroll o2-input"`
`scroll` was a Quasar utility class enabling overflow scroll. With Quasar gone the `max-height: 300px` overflow content will be clipped instead of scrollable. Needs `tw:overflow-y-auto` or a scroll utility from the new design system.

**Solution:**
```diff
- <div class="user-guide scroll o2-input">
+ <div class="user-guide tw:overflow-y-auto o2-input">
```

### 5. `O2AIContextAddBtn.vue` line 9 — bound `props.class` and `props.style`
The component declares `class` and `style` as props. In Vue's standard fall-through behavior `class`/`style` already merge automatically from the parent; declaring them as props can cause the parent's automatic merge to no longer pass through with the same precedence. Combined with `:class="['o2-ai-context-btn', props.class]"` (line 9) the actual rendered class list duplicates the parent class merge and bypasses Vue's normal `inheritAttrs` semantics.

**Solution:**
```diff
- const props = defineProps<{ class?: string; style?: string; ... }>();
- :class="['o2-ai-context-btn', props.class]"
+ const props = defineProps<{ ... }>();   // drop class/style from props
+ class="o2-ai-context-btn"   // Vue auto-merges parent class via inheritAttrs
```

### 6. `CrossLinkUserGuide.vue` button is wrapped in `<div ref="userGuideBtnRef">` but the click handler reads `userGuideBtnRef.value.getBoundingClientRect()` — works, but the popup `position: fixed` positioning ignores scroll offset of any ancestor scroll container and will misposition the guide overlay when the dialog body has scrolled.

**Solution:**
```diff
+ // Use position: absolute relative to a positioned parent, OR
+ // re-read getBoundingClientRect on scroll:
+ const updatePosition = () => {
+   if (!userGuideBtnRef.value) return;
+   const rect = userGuideBtnRef.value.getBoundingClientRect();
+   popupPos.value = { top: rect.bottom, left: rect.left };
+ };
+ onMounted(() => window.addEventListener("scroll", updatePosition, { capture: true }));
```

## CSS / Layout Issues

### Three-Layer CSS Violations

**File-level styles leaking what should be in component layer:**

- `O2AIChat.vue` lines 6433-6461 — `.dark-mode .code-block-header`, `.light-mode .code-block-header`, `.dark-mode-bottom-bar .model-selector`, `.light-mode-bottom-bar .model-selector` are repeated theme-bound styles that belong in a partial/component file. Hardcoded hex values: `#3b3b3b`, `#e1e1e1`, `#ecf0f5`, `#262626`, `#bdbbbb`.
- `TelemetryCorrelationDashboard.vue` lines 2935, 2939, 3067, 3071, 3107, 3110, 3113, 3118, 3121, 3126 — `background: #ffffff !important;` and `body.body--dark { background: #1e1e1e !important; }` repeated three times for `.correlation-dashboard-card`, `.correlation-dashboard-embedded`, `.correlation-header`. Hardcoded white/dark hex values bypass the token system (`--o2-bg-color`, `--o2-card-bg`).
- `O2AIConfirmDialog.vue` lines 432-441 — `.light-mode { background: #ffffff; border: 2px solid #e4e7ec }` and the dark counterpart hardcode tokens. Also lines 466-468, 471-473 hardcode `#1f2937`, `#f3f4f6`, `#6b7280`, `#9ca3af`.
- `O2AIConfirmDialog.vue` lines 485-489 — `border-top: 1px solid #e5e7eb` / `#374151` — hardcoded greys instead of `--o2-border-color`.
- `O2AIConfirmDialog.vue` lines 539-612 — `always-btn` and `cancel-btn` hardcode `#059669`, `#34d399`, `#374151`, `#dc2626`, `#fef2f2`, `#fca5a5`, `#f0fdf4`, `#f87171`, `#ef4444`, `#d1d5db`, `#4b5563`. These should map to `--o2-button-*` tokens.

**Quasar CSS-var pollution / dead variables (no fallback or broken fallback):**
- `O2AIChat.vue` — 21 occurrences of `var(--q-*)`
- `TelemetryCorrelationPanel.vue` — 11 occurrences (lines 305-456)
- `TelemetryCorrelationDashboard.vue` — 5 occurrences (lines 2981, 2996, 2997, 3047, 3050) — these do supply fallbacks (`rgba(0,0,0,0.04)`, `#f5f5f5`, `#e0e0e0`) so they degrade gracefully but still violate the token discipline.
- `CorrelationDemo.vue` — 6 occurrences (lines 205, 213, 214, 224, 241, 251, 256) — all with hex fallbacks, but the demo page still references `--q-dark-page` / `--q-primary` / `--q-text-secondary`.
- `O2AIConfirmDialog.vue` — 10 occurrences of `var(--q-primary)` (no fallback) on focused button styling.

**`:deep(.q-*)` selectors that don't match anything:**
- `DimensionFiltersBar.vue` lines 135-147 — `:deep(.q-field__control)`, `:deep(.q-field__native)`, `:deep(.q-field__append)` styling the dimension dropdown. OSelect emits no `.q-field__*` classes, so the min-height, padding, and font-size tweaks have no effect.
- `CorrelatedLogsTable.vue` lines 1083-1097 — identical three rules, no effect.
- `TelemetryCorrelationDashboard.vue` lines 3084-3097 — identical three rules on `.dimension-dropdown`, no effect.
- `DimensionFilterEditor.vue` lines 258-270 — `:deep(.q-dark) { ... }` — `.q-dark` is Quasar's body class; the migrated codebase does not toggle it. Dark mode adjustments inside this block are dead.

**Escaped Tailwind selectors with double backslashes:**
- `DimensionFilterEditor.vue` lines 253, 259, 263, 267 — `.tw\\:bg-gray-50`, `.tw\\:text-gray-500`, `.tw\\:text-gray-600`. In SCSS the source `\\:` compiles to `\:` (escape-of-colon), so the selector is `.tw\:bg-gray-50` which IS what Tailwind emits — these technically match. But the parent `:deep(.q-dark)` does not, so the dark override is dead.
- `TimeRangeEditor.vue` lines 253, 257, 259, 263, 267 — same pattern, same dead dark override.
- `CorrelatedLogsTable.vue` line 1076 — `.tw\:overflow-auto { scroll-behavior: smooth }` — this works (single backslash form, scoped scss). Verified renders.

**Quasar body class targeting in dark mode (selectors never match):**
- `TelemetryCorrelationDashboard.vue` lines 2968, 3105 — `body.body--dark .metric-splitter-separator { … }` and `body.body--dark { … }`. The new codebase does NOT add `body--dark` to the body element (verified: no `classList.toggle('body--dark')` exists anywhere outside tests; old `.body--dark` selectors only survive in `web/src/styles/app.scss:545` / `_variables.scss:470` / `logs-page.scss` legacy.) Dark-mode style fallthrough for the entire correlation dashboard is broken.
- `O2AIChat.vue` lines 6556, 6572 — same `body.body--dark &` pattern, dark theming dead.

**Solution:**
```diff
- body.body--dark .metric-splitter-separator { ... }
- body.body--dark { ... }
+ html.dark .metric-splitter-separator { ... }
+ html.dark { ... }
// In TelemetryCorrelationDashboard.vue:2935-3126 — replace #ffffff/#1e1e1e hex with tokens:
- background: #ffffff !important;
+ background: var(--o2-bg-color);
- body.body--dark { background: #1e1e1e !important; }
+ html.dark .correlation-dashboard-card { background: var(--o2-bg-color); }
```

**Hardcoded Tailwind grey tokens (theme-agnostic):**
- `DimensionFilterEditor.vue` lines 32, 102, 112, 126 — `tw:text-gray-600`, `tw:text-green-600`, `tw:text-gray-500`, `tw:text-gray-500`, `tw:border-gray-300`, `tw:bg-gray-50`.
- `TimeRangeEditor.vue` lines 43, 131 — `tw:bg-gray-50`, `tw:bg-blue-50`.
- `CorrelationDemo.vue` lines 85, 107, 125 — `tw:text-gray-400`.
- `O2AIChat.vue` line 89, 105, 108 — `tw:text-gray-500`, `tw:text-gray-500`. These should be `tw:text-[var(--o2-text-muted)]` or similar token-bound classes; dark mode in O2AIChat will show light-grey text on near-black background.

**Solution:**
```diff
- class="tw:text-gray-500"
+ class="tw:text-[var(--o2-text-muted)]"
- class="tw:bg-gray-50"
+ class="tw:bg-[var(--o2-surface-muted)]"
- class="tw:text-green-600"
+ class="tw:text-[var(--o2-success)]"
```

**Other layout / global concerns:**
- `CrossLinkUserGuide.vue` line 18 — Inline `style="position: fixed; z-index: 9999; width: 500px; max-height: 300px; border: 1px solid gray; border-radius: 5px;"` — hardcoded `gray` border colour, hardcoded fixed width (no responsive consideration), and `z-index: 9999` is a global-layer concern that should be a token, not inline.
- `O2AIChat.vue` lines 5697, 6489, 6516, 6491, 6518 — `var(--color-separator)` is an undefined token (the new system uses `--o2-border-color`).

**Solution:**
```diff
- style="position: fixed; z-index: 9999; width: 500px; max-height: 300px; border: 1px solid gray; ..."
+ class="tw:fixed tw:z-[var(--o2-z-popup)] tw:w-[500px] tw:max-h-[300px] tw:border tw:border-[var(--o2-border-color)] tw:rounded-md"
- border-color: var(--color-separator);
+ border-color: var(--o2-border-color);
```

## Component Migration Issues

### `CrossLinkDialog.vue` (`web/src/components/cross-linking/CrossLinkDialog.vue`)
- OSelect attributes `use-input` (l.77), `fill-input` (l.78), `hide-selected` (l.79), `input-debounce="0"` (l.80) are all Quasar QSelect props with no OSelect equivalent. They are passed through `$attrs` and silently ignored.
- Event `@filter="filterFieldOptions"` (l.82) and `@input-value="onFieldInputValue"` (l.83) are not OSelect events and never fire.
- `v-slot:no-option` (l.89) is a Quasar QSelect named slot, not an OSelect slot — never rendered.
- `fieldSelectRef.value?.updateInputValue("", true)` (l.195) is a Quasar QSelect method, not on OSelect.

**Solution:** See Critical Issue #1 — replace Quasar props with `searchable`/`searchDebounce`/`@search`, swap `#no-option` for `#empty`, and manage typed text via local ref instead of `updateInputValue`.

### `DimensionFiltersBar.vue` (`web/src/plugins/correlation/DimensionFiltersBar.vue`)
- OTooltip on line 48 is used in child-mode (no default slot) — this DOES work because OTooltip implements the q-tooltip-like child mode (verified in `OTooltip.vue` line 29-49). No issue, but worth noting the pattern is "Quasar-style" by design.

### `CorrelatedLogsTable.vue` (`web/src/plugins/correlation/CorrelatedLogsTable.vue`)
- Line 525 comment `Convert to { label, value } format for q-select with map-options` — orphan comment, the component now uses OSelect via DimensionFiltersBar.

**Solution:**
```diff
- // Convert to { label, value } format for q-select with map-options
+ // Convert to { label, value } format for OSelect (via DimensionFiltersBar)
```

### `O2AIChat.vue`
- Line 6428 `.q-card__section` selector — Quasar BEM class, never produced by the O* equivalents. The image-preview dialog background-override is dead.
- Lines 89-106 `tw:text-gray-500` for empty-state copy — no theme handling, will appear washed-out on the dark surface.

**Solution:**
```diff
- .image-preview-dialog .q-card__section { padding: 0; }
+ // Delete the orphan rule entirely.
- class="tw:text-gray-500"
+ class="tw:text-[var(--o2-text-muted)]"
```

### `O2AIConfirmDialog.vue`
- `<OButton variant="outline" :block="true">` — OButton supports the `block` prop, OK. But the `tabindex="0"/"1"/"2"` on lines 23, 36, 47, 60, 71 conflict with focus-restoration code on lines 264-278. Tabindex >0 is generally considered an accessibility anti-pattern; the keyboard navigation already handles up/down arrows.

**Solution:**
```diff
- <OButton tabindex="1" .../>
- <OButton tabindex="2" .../>
+ <OButton tabindex="0" .../>   <!-- Let DOM order drive tab sequence -->
```

### `TelemetryCorrelationDashboard.vue`
- `<ODrawer :width="90">` (l.22). ODrawer's `width` is typed as `number`. `:width="90"` is interpreted as `90` (units undefined). Verify against ODrawer's implementation — value may be percent vs pixels mismatch (Quasar's q-drawer used px, the new component may use a different convention). Visual review needed.

**Solution:**
```diff
- <ODrawer :width="90" ...>   <!-- 90 what? px? % ? -->
+ <ODrawer :width="900" ...>  <!-- Be explicit; ODrawer expects pixels per its types -->
+ <!-- OR if percent intended: -->
+ <ODrawer class="tw:!w-[90%]" ...>
```

### `AddAiToolset.vue`
- Component looks clean — uses OInput, OSelect, OTextarea, OSeparator with valid props. No Quasar leftovers.
- The `.monaco-editor` and `.monaco-editor-cred` selectors are global Monaco editor selectors targeted via SCSS scoped — they only work because Monaco renders inside the scoped component. OK.
- Uses `var(--o2-border-color)` — properly token-bound.

**Solution:** No change required.

## Test File Issues

### Broken — missing `installQuasar` export
`/Users/ktx/Documents/Projects/openobserve.worktrees/ux-revamp/web/src/test/unit/helpers/install-quasar-plugin.ts` exports only `tempQuasarPlugin`. The following spec files import `installQuasar` and will fail to load:

- `web/src/components/cross-linking/CrossLinkDialog.spec.ts` line 3, 10
- `web/src/components/cross-linking/CrossLinkManager.spec.ts` line 3, 20
- `web/src/components/cross-linking/CrossLinkUserGuide.spec.ts` line 3, 8
- `web/src/components/O2AIChat.spec.ts` line 19, 112
- `web/src/components/O2AIChat.spec.js` line 6, 13
- `web/src/components/common/O2AIContextAddBtn.spec.js` line 3, 26
- `web/src/plugins/correlation/CorrelatedLogsTable.spec.ts` line 19, 92
- `web/src/plugins/correlation/DimensionFilterEditor.spec.ts`
- `web/src/plugins/correlation/DimensionFiltersBar.spec.ts` line 20, 39
- `web/src/plugins/correlation/TelemetryCorrelationDashboard.spec.ts` line 19, 268
- `web/src/plugins/correlation/TimeRangeEditor.spec.ts` line 24, 128

**Solution:**
```diff
- import { installQuasar } from "@/test/unit/helpers/install-quasar-plugin";
- installQuasar();
+ // Either drop, or add to install-quasar-plugin.ts:
+ //   export const installQuasar = tempQuasarPlugin;
```

### Tests importing literal Quasar symbols (will fail — package removed)
- `web/src/plugins/correlation/DimensionFiltersBar.spec.ts` line 19 — `import { QSelect, QBtn, QTooltip } from "quasar";`
- `web/src/plugins/correlation/TimeRangeEditor.spec.ts` lines 19-23 — `import { QInput, QRadio, QIcon } from "quasar";`

**Solution:**
```diff
- import { QSelect, QBtn, QTooltip } from "quasar";
- import { QInput, QRadio, QIcon } from "quasar";
+ // Drop quasar imports — components no longer use Quasar.
+ // If stubs needed: { global: { stubs: { OSelect: true, OButton: true, OTooltip: true } } }
```

### Duplicate spec files
- `O2AIChat.spec.ts` and `O2AIChat.spec.js` both exist for the same component (lines 19 + 6 respectively), both broken. The .js counterpart is stale.

**Solution:**
```bash
- rm web/src/components/O2AIChat.spec.js   # keep the .ts variant only
```

## Recommendations

1. **Fix CrossLinkDialog field-search (critical).** Replace the Quasar-style OSelect with OSelect's actual searchable mode (`searchable` prop, `creatable` if free-form values, slot-based options). Drop `use-input`/`fill-input`/`@filter`/`v-slot:no-option`. Remove the `fieldSelectRef.value?.updateInputValue(...)` call — manage the typed text via the standard `v-model` lifecycle.

2. **Mass-replace `--q-*` CSS variables.** Run a search-and-replace across all 5 files (O2AIChat, O2AIConfirmDialog, TelemetryCorrelationPanel, CorrelationDemo, TelemetryCorrelationDashboard) mapping:
   - `--q-primary` → `--o2-primary`
   - `--q-page-background` / `--q-background` / `--q-dark` → `--o2-bg-color` (or theme-aware)
   - `--q-border-color` → `--o2-border-color`
   - `--q-hover-color` → `--o2-hover-bg`
   - `--q-text-secondary` → `--o2-text-muted`
   - `--q-negative` → `--o2-danger`
   - `--q-header-bg` → `--o2-card-header-bg`
   - `--q-item-bg` / `--q-item-hover-bg` → `--o2-item-bg` / `--o2-item-hover-bg`
   - `--q-color-grey-2` → `--o2-bg-muted`
   - `--q-primary-rgb` / `--q-negative-rgb` → derive from the token system (these are channel splits, no direct equivalent — refactor to alpha-channel utilities)

3. **Remove `:deep(.q-field__*)` and `:deep(.q-dark)` blocks.** Replace `:deep(.q-field__control)` styling in `DimensionFiltersBar.vue` (l.135), `CorrelatedLogsTable.vue` (l.1083), `TelemetryCorrelationDashboard.vue` (l.3084) with OSelect's own size/density props (e.g. `size="sm"`) or a wrapping container style. Replace `:deep(.q-dark)` in `DimensionFilterEditor.vue` and `TimeRangeEditor.vue` with the new dark-mode selector convention (e.g. `:root.dark` or whatever App.vue sets; verify).

4. **Remove `body.body--dark` selectors.** `TelemetryCorrelationDashboard.vue` lines 2968, 3105 and `O2AIChat.vue` lines 6556, 6572 — replace with whatever class App.vue actually applies (currently `'dark-theme'` on root `:class`). Same for `O2AIChat.vue` line 6428 `.q-card__section`.

5. **Replace hardcoded hex values with tokens.** `O2AIConfirmDialog.vue` lines 432-612, `TelemetryCorrelationDashboard.vue` lines 2935-3121, and `O2AIChat.vue` lines 6433-6461 contain ~30+ hardcoded greys, blues, reds, and dark-mode backgrounds that should map to `--o2-*` tokens.

6. **Replace hardcoded `tw:text-gray-*` / `tw:bg-gray-*` / `tw:text-green-600` with token-bound classes.** Files: `DimensionFilterEditor.vue`, `TimeRangeEditor.vue`, `CorrelationDemo.vue`, `O2AIChat.vue`, plus the inline `border: 1px solid gray` in `CrossLinkUserGuide.vue` l.18.

7. **Fix `CrossLinkUserGuide.vue` theme classes.** Replace `'theme-dark bg-dark'` / `'theme-light bg-white'` (l.27-30) with the project's standard theme convention. The `bg-dark` class is undefined globally and falls through to whatever bleeds.

8. **Fix `CrossLinkUserGuide.vue` overflow.** Remove `scroll` class (Quasar utility) and use `tw:overflow-y-auto` since the popup has `max-height: 300px`.

9. **Fix all spec files.** Either (a) delete `installQuasar` calls and switch to `qLayoutInjections()` directly per the TODO comment in `install-quasar-plugin.ts`, or (b) restore an `installQuasar` no-op shim that just provides layout injections. Removing the literal `import { QSelect, QBtn, … } from "quasar"` references in `DimensionFiltersBar.spec.ts` and `TimeRangeEditor.spec.ts` is mandatory since the package is gone.

10. **Delete `O2AIChat.spec.js` (stale duplicate).** Keep `.spec.ts`.

11. **Drop dead state in `CorrelationDemo.vue`.** Either implement the "Show generated query" flow that sets `showQueryDialog`/`queryPreview`, or delete the unused dialog + state.

12. **Remove unused `isLoadingServices`** from `TelemetryCorrelationPanel.vue` line 224.

13. **Audit `tabindex` values in `O2AIConfirmDialog.vue`.** Positive tabindex values (lines 23, 36, 47, 60, 71) hurt accessibility — use `0` for focusable + DOM-order navigation.

14. **Verify `ODrawer :width="90"` semantics** in `TelemetryCorrelationDashboard.vue` line 22 — the prop is typed `number` but may represent vh%, px, or unit-less. Visual smoke test required.

## Class-Level Styling Audit

### 1. Quasar Class Leftovers
| File:Line | Class | Replacement | Layer |
|---|---|---|---|
| CorrelatedLogsTable.vue:1046 | `:deep(.q-field__control)` | remove | file-scoped |
| CorrelatedLogsTable.vue:1051 | `:deep(.q-field__native)` | remove | file-scoped |
| CorrelatedLogsTable.vue:1056 | `:deep(.q-field__append)` | remove | file-scoped |
| DimensionFiltersBar.vue:135 | `:deep(.q-field__control)` | remove | file-scoped |
| DimensionFiltersBar.vue:140 | `:deep(.q-field__native)` | remove | file-scoped |
| DimensionFiltersBar.vue:145 | `:deep(.q-field__append)` | remove | file-scoped |
| TelemetryCorrelationDashboard.vue:3084 | `:deep(.q-field__control)` | remove | file-scoped |
| TelemetryCorrelationDashboard.vue:3089 | `:deep(.q-field__native)` | remove | file-scoped |
| TelemetryCorrelationDashboard.vue:3094 | `:deep(.q-field__append)` | remove | file-scoped |
| TelemetryCorrelationDashboard.vue:160 | `full-height` | `tw:h-full` | file-scoped |

### 2. Tailwind v4 Misuse
| File:Line | Wrong | Right | Layer |
|---|---|---|---|
| TelemetryCorrelationDashboard.vue:247 | `hover:tw:bg-muted/50` | `tw:hover:bg-muted/50` | file-scoped |
| TelemetryCorrelationDashboard.vue:719 | `hover:tw:bg-muted/50` | `tw:hover:bg-muted/50` | file-scoped |

### 3. Quasar CSS Variables
| File:Line | Variable | Replacement | Layer |
|---|---|---|---|
| CorrelationDemo.vue:213 | `var(--q-primary)` | `var(--o2-primary)` | file-scoped |
| CorrelationDemo.vue:224 | `var(--q-primary)` | `var(--o2-primary)` | file-scoped |
| CorrelationDemo.vue:251 | `var(--q-primary)` | `var(--o2-primary)` | file-scoped |
| TelemetryCorrelationPanel.vue:445 | `var(--q-item-bg)` | `var(--o2-bg-elevated)` | file-scoped |
| TelemetryCorrelationPanel.vue:450 | `var(--q-item-hover-bg)` | `var(--o2-hover)` | file-scoped |
| TelemetryCorrelationDashboard.vue:2996 | `var(--q-color-grey-2, #f5f5f5)` | `var(--o2-bg-subtle)` | file-scoped |

### 4. Dead `:deep(.q-*)` / `body.body--dark` / `::v-deep`
| File:Line | Selector | Action | Layer |
|---|---|---|---|
| CorrelatedLogsTable.vue:1046-1056 | 3x `:deep(.q-field__*)` | remove | file-scoped |
| DimensionFiltersBar.vue:135-145 | 3x `:deep(.q-field__*)` | remove | file-scoped |
| TelemetryCorrelationDashboard.vue:3084-3094 | 3x `:deep(.q-field__*)` | remove | file-scoped |

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
| AddAiToolset.vue:17 | `min-height:inherit` | drop |
| AddAiToolset.vue:38 | `height: calc(100vh - 120px); overflow:auto` | scoped `.toolset-form-scroll` class |
| TelemetryCorrelationDashboard.vue:62 | `min-width:120px` | `tw:min-w-[120px]` |
| TelemetryCorrelationDashboard.vue:501,973 | `height: calc(...)` (dynamic) | acceptable but consider class |
| TelemetryCorrelationDashboard.vue:562,566 | `display:flex; flex-direction:column...` | `tw:flex tw:flex-col tw:overflow-auto` |
| TelemetryCorrelationDashboard.vue:588 | `flex:1; min-height:300px` | scoped `.correlation-chart-pane` class |
| TelemetryCorrelationDashboard.vue:885/991/1005 | `width:3.75rem; height:3.75rem` | scoped `.empty-state-icon` class |

### 9. Duplicate Style Blocks
| Files | Duplicated block | Suggested partial |
|---|---|---|
| CorrelatedLogsTable.vue:1046-1058 / DimensionFiltersBar.vue:135-148 / TelemetryCorrelationDashboard.vue:3084-3096 | identical 3x `:deep(.q-field__*)` blocks | delete from all three (dead) |
| TelemetryCorrelationDashboard.vue:247,719 | identical `dimension-list-item tw:border-none! ... hover:tw:bg-muted/50` markup | already `.dimension-list-item` partial; just fix hover order |
| TelemetryCorrelationDashboard.vue:885/991/1005 | identical `width:3.75rem; height:3.75rem` empty state icons | extract `.empty-state-icon` class |

### 10. Layer Summary
- Global (`app.scss`) changes needed: 0
- Component-level partial changes: 2 (`.empty-state-icon` reused 3x in TelemetryCorrelationDashboard)
- File-level scoped changes: ~28 (9 q-field deep blocks, 6 q-css vars, 2 hover order, 1 full-height, 8 inline styles)
