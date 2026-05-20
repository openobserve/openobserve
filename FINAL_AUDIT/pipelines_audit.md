# Pipelines Page — Quasar Removal Audit

## Summary

The Pipelines area underwent a heavy Quasar → O*/Tailwind migration. The bulk
of the visual port is in place, but the refactor introduced several
**runtime-breaking bugs**, **silently-dropped functionality** (props that no
longer exist on the new components), and a large amount of **dead CSS** that
targets selectors Quasar no longer renders (`.body--dark`, `.q-*`, etc.).

The most severe issues are concentrated in:

- `web/src/plugins/pipelines/CustomNode.vue` — every node renders a broken icon
  expression (`io - type`) repeated 6 times.
- `web/src/components/pipelines/PipelineHistory.vue` — infinite-recursion in
  `formatDate`; will stack-overflow the moment the table renders any row.
- `web/src/components/pipeline/PipelinesList.vue` — bulk
  select/clear writes to a `computed` ref (no-op + Vue runtime warning).
- `web/src/plugins/pipelines/useDnD.ts` — all error toasts lost their `error`
  variant; pipeline cycle/duplicate-edge warnings now display as neutral.
- `web/src/plugins/pipelines/useDnD.spec.ts` — file has a SyntaxError (`: {`)
  and will not even parse.

Plus dead CSS, leftover `v-close-popup` directives, leftover `q-table__title`
class hooks (cosmetic), and OIcon `:color="positive|grey|warning"` props that
are silently dropped (icons never change color anymore).

Auditing was read-only against `feat/ux-revamp-main` vs `main`.

## Files Audited

### Plugins (vue-flow integration)
- `web/src/plugins/pipelines/CustomNode.vue` — 662 line diff
- `web/src/plugins/pipelines/PipelineFlow.vue`
- `web/src/plugins/pipelines/CustomEdge.vue`
- `web/src/plugins/pipelines/EdgeWithButton.vue`
- `web/src/plugins/pipelines/DropzoneBackground.vue`
- `web/src/plugins/pipelines/useDnD.ts` + spec

### Components/pipeline (single-pipeline + node forms)
- `web/src/components/pipeline/PipelinesList.vue` — 1145 line diff
- `web/src/components/pipeline/PipelineEditor.vue` — 250 line diff
- `web/src/components/pipeline/PipelineView.vue`
- `web/src/components/pipeline/PipelineDestinationEditor.vue`
- `web/src/components/pipeline/ImportPipeline.vue`
- `web/src/components/pipeline/StreamSelection.vue`
- `web/src/components/pipeline/NodeSidebar.vue`
- `web/src/components/pipeline/FlowChart.vue`
- `web/src/components/pipeline/NodeForm/*.vue` (Stream, Condition, Query, AssociateFunction, ExternalDestination, CreateDestinationForm, ScheduledPipeline, RealtimePipeline, LlmEvaluation, PreviewPromqlQuery)

### Components/pipelines (history + backfill)
- `web/src/components/pipelines/PipelineHistory.vue` — 1030 line diff
- `web/src/components/pipelines/BackfillJobsList.vue` — 531 line diff
- `web/src/components/pipelines/BackfillJobDetails.vue`
- `web/src/components/pipelines/CreateBackfillJobDialog.vue`
- `web/src/components/pipelines/EditBackfillJobDialog.vue`

### Other
- `web/src/components/ResumePipelineDialog.vue`

---

## Critical Issues

### C1. `getIcon(data, io - type)` — every node icon broken (CustomNode.vue)

File: `/Users/ktx/Documents/Projects/openobserve.worktrees/ux-revamp/web/src/plugins/pipelines/CustomNode.vue`
Lines: **508, 612, 697, 770, 843, 917**

```vue
<OIcon :name="getIcon(data, io - type)" size="md" ... />
```

The expression `io - type` is parsed by Vue as the subtraction `io` minus
`type` (both `undefined` in scope) → `NaN`. The original code in `main`
(line 486, etc.) was `getIcon(data, io_type)` using the component prop.

Consequence: `getIcon` receives `NaN` for `ioType`, the lookup in
`pipelineObj.nodeTypes.find(...)` fails, and **every node** (function,
stream, remote stream, query, condition, default) renders with
`name="undefined"`, producing no icon. This affects every pipeline
in the editor on every render.

Fix: replace all 6 occurrences with `io_type`.

**Solution:**
```diff
- <OIcon :name="getIcon(data, io - type)" size="md" ... />
+ <OIcon :name="getIcon(data, io_type)" size="md" ... />
```
Apply at all 6 locations: lines 508, 612, 697, 770, 843, 917.

### C2. Infinite recursion in `formatDate` (PipelineHistory.vue)

File: `/Users/ktx/Documents/Projects/openobserve.worktrees/ux-revamp/web/src/components/pipelines/PipelineHistory.vue`
Lines: **491, 841–846**

```ts
import { formatDate } from "@/utils/date";
...
const formatDate = (timestamp: number) => {
  if (!timestamp) return "-";
  const dateObj = new Date(timestamp / 1000);
  return formatDate(dateObj, "YYYY-MM-DD HH:mm:ss");   // ← recurses into itself
};
```

Original `main` (PipelineHistory.vue:963 / 967) used a different binding —
`date.formatDate(...)` from a namespace import. The migration renamed the
import but kept the local `const formatDate` with the same name, so the
local shadows the import and calls itself.

The function returns `"-"` only for falsy input; the moment a row has a
truthy timestamp, the call recurses and overflows the stack. The History
page will crash as soon as it loads data.

The unit-test `PipelineHistory.spec.ts:592` (`vm.formatDate(1700000000000000)`)
will also hang/throw.

Fix options: rename the local function, or call the imported one via a
namespace import (`import * as dateUtils from "@/utils/date"`).

**Solution:**
```diff
- import { formatDate } from "@/utils/date";
+ import * as dateUtils from "@/utils/date";
  ...
- const formatDate = (timestamp: number) => {
+ const formatTimestamp = (timestamp: number) => {
    if (!timestamp) return "-";
    const dateObj = new Date(timestamp / 1000);
-   return formatDate(dateObj, "YYYY-MM-DD HH:mm:ss");
+   return dateUtils.formatDate(dateObj, "YYYY-MM-DD HH:mm:ss");
  };
```

### C3. `selectedPipelines.value = []` writes to a `computed` (PipelinesList.vue)

File: `/Users/ktx/Documents/Projects/openobserve.worktrees/ux-revamp/web/src/components/pipeline/PipelinesList.vue`
Lines: **582–586** (declaration), assignments at **937, 1013, 1106, 1195**

```ts
const selectedPipelines = computed(() =>
  filteredPipelines.value.filter((p: any) =>
    selectedPipelineIds.value.includes(p.pipeline_id),
  ),
);
...
selectedPipelines.value = [];  // ← computed is read-only
```

`computed()` returns a read-only ref. Assigning to it triggers Vue's
runtime warning ("Write operation failed: computed value is readonly")
and does nothing. The intent is to clear the selection after bulk
delete / pause / resume / export. Today, after any of those actions
the rows remain visually selected and the toolbar action bar stays open.

The correct write is to clear the ID-set: `selectedPipelineIds.value = []`.

**Solution:**
```diff
- selectedPipelines.value = [];
+ selectedPipelineIds.value = [];
```
Apply at all 4 sites: lines 937, 1013, 1106, 1195.

### C4. `useDnD.spec.ts` has a SyntaxError

File: `/Users/ktx/Documents/Projects/openobserve.worktrees/ux-revamp/web/src/plugins/pipelines/useDnD.spec.ts`
Lines: **45–52**

```ts
vi.mock("quasar", () => ({
  : {                              // ← missing identifier
    create: vi.fn(),
  },
  useQuasar: () => ({
    notify: vi.fn(),
  }),
}));
```

The bulk-rewrite stripped the `Notify` key but left the colon. This file
will fail to parse and the entire useDnD test suite will not run.

**Solution:**
```diff
- vi.mock("quasar", () => ({
-   : {
-     create: vi.fn(),
-   },
-   useQuasar: () => ({
-     notify: vi.fn(),
-   }),
- }));
+ vi.mock("@/lib/feedback/Toast/useToast", () => ({
+   toast: vi.fn(),
+ }));
```

### C5. `ScheduledPipeline.spec.js` imports `useQuasar` from a missing package

File: `/Users/ktx/Documents/Projects/openobserve.worktrees/ux-revamp/web/src/components/pipeline/NodeForm/ScheduledPipeline.spec.js`
Lines: **3, 14**

```js
import { useQuasar } from "quasar";
...
vi.mock('quasar', async () => {
  const actual = await vi.importActual('quasar');
  ...
});
```

`quasar` is not in `web/package.json` anymore. Both the static import and
`vi.importActual('quasar')` will fail to resolve. This kills the spec.

Same shape (vi.mock + importOriginal) exists in:
- `web/src/components/pipelines/BackfillJobsList.spec.ts:25`
- `web/src/components/pipelines/EditBackfillJobDialog.spec.ts:43`
- `web/src/components/pipelines/CreateBackfillJobDialog.spec.ts:25`
- `web/src/components/pipeline/PipelineList.spec.js:21`

**Solution:**
```diff
- import { useQuasar } from "quasar";
- vi.mock('quasar', async () => {
-   const actual = await vi.importActual('quasar');
-   return { ...actual, useQuasar: () => ({ notify: vi.fn() }) };
- });
+ vi.mock("@/lib/feedback/Toast/useToast", () => ({ toast: vi.fn() }));
```

### C6. `v-close-popup` directives are inert without Quasar

Files / lines:
- `web/src/components/pipeline/StreamSelection.vue:32` — close icon on the
  Stream Selection drawer
- `web/src/components/pipeline/NodeForm/ExternalDestination.vue:36` — close
  button on the External Destination drawer

`v-close-popup` is a Quasar directive that does nothing without the Quasar
runtime. The corresponding close buttons therefore appear functional
(cursor changes, icon visible) but click does nothing. In StreamSelection
the cancel button at line 110 also lacks an `@click` handler, so cancelling
the Add-Pipeline drawer is impossible from inside the form. Closing relies
on a hosting `ODrawer` from the parent (`PipelinesList.vue:360`) which
exposes its own close affordance, but the in-form close icon and cancel
button are dead.

**Solution:**
```diff
- <OIcon v-close-popup name="close" class="tw:cursor-pointer" />
+ <OIcon name="close" class="tw:cursor-pointer" @click="$emit('cancel')" />
- <OButton label="Cancel" v-close-popup />
+ <OButton label="Cancel" @click="$emit('cancel')" />
```
Apply at StreamSelection.vue:32, 110 and ExternalDestination.vue:36.

### C7. Error toasts in `useDnD.ts` lost the error variant

File: `/Users/ktx/Documents/Projects/openobserve.worktrees/ux-revamp/web/src/plugins/pipelines/useDnD.ts`
Lines: ~153, 220, 231, 242, 405

All `$q.notify({ ... color: "negative" ... })` calls were converted to
`toast({ message, position, timeout })`, dropping the variant. The toast
API accepts `variant: "error"` (see `web/src/lib/feedback/Toast/useToast.ts:8`).
The "Only 1 source node is allowed", "Same type of edges / nodes cannot be
connected", "Only one Incoming Edge to the node is allowed", and
"Adding this edge will create a cycle in the pipeline" messages now appear
as neutral toasts, losing the danger affordance the original UI provided.

**Solution:**
```diff
- toast({ message: "Only 1 source node is allowed", position: "bottom", timeout: 3000 });
+ toast({ message: "Only 1 source node is allowed", variant: "error", position: "bottom", timeout: 3000 });
```
Apply to all error toasts in `useDnD.ts` at lines ~153, 220, 231, 242, 405.

### C8. OIcon `:color` prop silently dropped

File: `/Users/ktx/Documents/Projects/openobserve.worktrees/ux-revamp/web/src/components/pipelines/PipelineHistory.vue`
Lines: **157, 167, 184, 381**

```vue
<OIcon :name="..." :color="row.is_realtime ? 'positive' : 'grey'" .../>
```

`OIcon`'s public prop schema is `name | size | label` only
(`web/src/lib/core/Icon/OIcon.types.ts:5–15`). The `:color` binding is
silently dropped, so realtime/scheduled, silenced/not-silenced and partial
indicators in the History table now look identical instead of colour-coded.

Same issue: `web/src/components/pipelines/CreateBackfillJobDialog.vue:163`
(`:color="..."` with Quasar palette names `orange-4`/`orange`).

**Solution:**
```diff
- <OIcon :name="..." :color="row.is_realtime ? 'positive' : 'grey'" />
+ <OIcon
+   :name="..."
+   :class="row.is_realtime ? 'tw:text-green-500' : 'tw:text-gray-500'"
+ />
- <OIcon name="warning" :color="store.state.theme === 'dark' ? 'orange-4' : 'orange'" size="md" />
+ <OIcon name="warning" class="tw:text-orange-500" size="md" />
```

---

## Logical Issues

### L1. `selectedPipelines = []` no-op (see C3 above)

Knock-on effect: after a successful bulk-delete (PipelinesList.vue:937), the
sticky selection bar at the bottom (`#bottom` slot, line 309) remains open
showing stale counts, even after `getPipelines()` reloads — because the
visible counter is driven by `selectedPipelineIds.length` and the cleanup
function targets the wrong ref.

**Solution:** See C3 — replace `selectedPipelines.value = []` with `selectedPipelineIds.value = []`.

### L2. `selectedPipelines` is filtered against the active tab only

PipelinesList.vue:582 — `selectedPipelines` is computed from
`filteredPipelines`, but selection IDs are kept in `selectedPipelineIds`
which is populated by the table across tab switches. When the user
selects rows on `all`, switches to `scheduled`, and triggers a bulk
action, the count in `selectedPipelines.length` differs from the user's
mental model. (This is pre-existing logic but worth flagging — the
selection model assumes a single tab context.)

**Solution:** Clear `selectedPipelineIds` on tab switch:
```diff
+ watch(() => selectedTab.value, () => {
+   selectedPipelineIds.value = [];
+ });
```

### L3. StreamSelection cancel button has no `@click` handler

`web/src/components/pipeline/StreamSelection.vue:110-114`. Without
`v-close-popup` working, the cancel button cannot close the drawer.

**Solution:**
```diff
- <OButton label="Cancel" v-close-popup />
+ <OButton label="Cancel" @click="$emit('cancel')" />
```

### L4. `vi.mock` shape mismatch in PipelinesList.vue.

`PipelinesList.vue:937` resets `selectedPipelines.value = []` then calls
`await getPipelines()`. Because the assignment is a no-op, on the next
render `selectedPipelineIds` still contains stale IDs. If those IDs are
no longer in the result set the filter just yields an empty array; if
they are still present (e.g. delete partial-failed), they remain
visually checked.

**Solution:** See C3 — fix the ref assignment first.

### L5. Saving toast lacks `variant: "success"` distinction

`useDnD.ts` toasts and `ImportPipeline.vue:685, 709, 746` toasts both
use the default variant, so success and error messages look identical.
Pre-revamp they were colour-coded via Quasar `color`.

**Solution:**
```diff
- toast({ message: "Pipeline imported successfully" });
+ toast({ message: "Pipeline imported successfully", variant: "success" });
- toast({ message: "Failed to import pipeline" });
+ toast({ message: "Failed to import pipeline", variant: "error" });
```

### L6. Dark mode styling for every pipeline component is dead

`.body--dark` is a Quasar class that was applied by the framework. The
new app applies `.dark-theme` on the root (`App.vue:19`). No code in
the repo adds `body--dark` to `document.body` (only test fixtures do).

Affected (all targeting `.body--dark` selectors that will never match):
- `web/src/plugins/pipelines/CustomNode.vue:1180, 1354, 1476, 1600`
  (function-details card, condition-details card, query-details card)
- `web/src/plugins/pipelines/PipelineFlow.vue:299` (edge-help-notification)
- `web/src/components/pipeline/PipelineEditor.vue:1396` (nodes-header,
  vue-flow node default/input/output backgrounds)
- `web/src/components/pipeline/NodeSidebar.vue:273` (entire sidebar dark
  styling — large block, ~50+ rules)
- `web/src/components/pipeline/NodeForm/AssociateFunction.vue:555–605`
  (function-definition card)
- (~175 occurrences across the wider codebase)

Result: the pipeline editor's dark mode is the light style with darker
chrome from `dark-theme`'s globals — node tiles, sidebar tiles,
notification banners, and tooltips don't recolour.

**Solution:**
```diff
- body.body--dark .node-tile { background: #2a2a2a; }
+ html.dark .node-tile { background: #2a2a2a; }
```
Repo-wide find/replace: `body.body--dark` → `html.dark` (or `.dark-theme &` if scoped styles need the parent class).

---

## CSS / Layout Issues

### CSS1. Dead Quasar selectors targeted via `:deep()` / global

Files / line numbers:
- `web/src/components/pipeline/NodeForm/CreateDestinationForm.vue`
  - line 1392 `:deep(.q-field__prepend)` — no longer rendered by OInput
  - line 1398 `.q-btn`
  - line 1412/1416 `.q-field--labeled.showLabelOnTop`
- `web/src/components/pipeline/NodeForm/Stream.vue:489-492`
  `.q-field--labeled.showLabelOnTop.q-select .q-field__control-container .q-field__native > :first-child` — long dead selector chain
- `web/src/components/pipeline/NodeForm/ExternalDestination.vue:272`
  `.q-field__native > :first-child`
- `web/src/components/pipeline/NodeForm/Condition.vue:890`
  `.pipeline-filter-group-wrapper :deep(.q-tabs)`
- `web/src/components/pipeline/NodeForm/ScheduledPipeline.vue`
  - line 2728 `.q-table__control`
  - line 2731 `.q-table__top`
  - line 2737 `.q-tab--active`
  - line 2742 `.q-tab__indicator`
  - line 2746 `.q-tab`
  - line 2760 `.q-btn`
  - line 2787 `.q-btn__content`
- `web/src/plugins/pipelines/PipelineFlow.vue:264`
  `q-btn { display: flex; ... }` — bare-element selector for the (now non-existent) `<q-btn>` custom element
- `web/src/plugins/pipelines/CustomNode.vue:1273, 1280, 1287`
  `.q-dialog__inner` — replaced by ODialog internals; selectors dead
- `web/src/plugins/pipelines/CustomNode.vue:1359` `.q-card-section`
- `web/src/components/pipeline/PipelinesList.vue:25`
  `class="q-table__title tw:font-[600]"` — Quasar class hook is cosmetic
  but referenced by tests via `q-table__title`
- `web/src/components/pipelines/BackfillJobsList.vue:33` — same
- `web/src/components/pipelines/PipelineHistory.vue:34` — same

These don't break anything per-se — they just produce no effect. They
inflate the bundle and confuse subsequent maintenance.

**Solution:**
```diff
- :deep(.q-field__prepend) { ... }
- :deep(.q-field--labeled.showLabelOnTop) { ... }
- .q-table__control { ... }
- .q-tab--active { ... }
- .q-dialog__inner { ... }
- class="q-table__title tw:font-[600]"
+ class="tw:font-[600]"
```
Delete every `q-*` SCSS selector block in the listed files; remove the `q-table__title` class hook from templates.

### CSS2. `align-items: flex-center` is invalid CSS

File: `/Users/ktx/Documents/Projects/openobserve.worktrees/ux-revamp/web/src/components/ResumePipelineDialog.vue:220`

```scss
.resume-radio-align {
  align-items: flex-center;  /* invalid — engines ignore this rule */
}
```

Valid keywords: `flex-start | flex-end | center | baseline | stretch`.
Either `center` or `flex-start` was intended; the rule is currently
ignored.

**Solution:**
```diff
  .resume-radio-align {
-   align-items: flex-center;
+   align-items: center;
  }
```

### CSS3. Invalid `:v-deep` syntax

File: `/Users/ktx/Documents/Projects/openobserve.worktrees/ux-revamp/web/src/components/ResumePipelineDialog.vue:174`

```scss
.q-btn {
  ...
  :v-deep(.q-btn__content){ ... }  /* should be :deep(...) */
}
```

`:v-deep` is not a valid pseudo selector. Vue's scoped CSS uses `:deep()`
or the legacy `::v-deep` / `/deep/`. Also the inner selector targets a
class that no longer exists.

**Solution:** Since `.q-btn` and `.q-btn__content` no longer exist, delete the whole rule:
```diff
- .q-btn {
-   ...
-   :v-deep(.q-btn__content) { ... }
- }
```

### CSS4. Orphaned `.dark-theme-dialog` / `.light-theme-dialog` rules

File: `web/src/components/ResumePipelineDialog.vue:190-218`. The template
no longer applies either class (the old `<q-dialog :class="...">` binding
was removed in the conversion to `<ODialog>`). So the entire light/dark
block is dead.

**Solution:** Delete the orphan rule blocks:
```diff
- .dark-theme-dialog { ... }
- .light-theme-dialog { ... }
```

### CSS5. `class="bg-dark"` / `class="bg-white"` (Quasar utilities)

Files:
- `web/src/components/pipeline/StreamSelection.vue:20`
- `web/src/components/pipeline/NodeForm/Stream.vue:28`
- `web/src/components/pipeline/NodeForm/Condition.vue:29`

`bg-dark` / `bg-white` are Quasar utility classes; without Quasar's CSS
these have no styles. Should be `tw:bg-black` (or similar Tailwind class)
and `tw:bg-white`, ideally driven by theme tokens.

**Solution:**
```diff
- class="bg-dark"
+ class="tw:bg-[var(--o2-background-dark)]"
- class="bg-white"
+ class="tw:bg-white"
```

### CSS6. `q-table__title` class hook left in templates

(See CSS1 — cosmetic only, but combined with the migrated O* surroundings
it produces stylistic drift if any global Quasar CSS was relied on for
font-size/letter-spacing of the title.)

**Solution:** See CSS1 — remove `q-table__title` from all 3 templates (`PipelinesList.vue:25`, `BackfillJobsList.vue:33`, `PipelineHistory.vue:34`).

---

## Component Migration Issues

### M1. OIcon `:color` prop unsupported (see C8)

**Solution:** See C8 — replace with `:class` using Tailwind color utilities.

### M2. ODialog `sub-title` is being used widely but the API is correct
(spot-checked `PipelineHistory.vue:464`, `PipelinesList.vue:400`,
`ResumePipelineDialog.vue:24`). No issues found.

### M3. ODrawer + nested `v-close-popup` (see C6)

The nested drawers (`StreamSelection`, `ExternalDestination`) provide
their own header close button, but the inner content also renders a
manual close icon that depends on the dead `v-close-popup` directive.

**Solution:** See C6 — drop `v-close-popup` and wire `@click="$emit('cancel')"` instead.

### M4. `ImportPipeline.vue` toast variants

Lines 685, 709, 746 fire toasts but without `variant: "success"` /
`variant: "error"`. Pre-revamp these were colour-coded via Quasar's
`type` / `color`.

**Solution:**
```diff
- toast({ message: "Imported successfully" });
+ toast({ message: "Imported successfully", variant: "success" });
- toast({ message: "Import failed" });
+ toast({ message: "Import failed", variant: "error" });
```

### M5. CreateBackfillJobDialog colour tokens

`web/src/components/pipelines/CreateBackfillJobDialog.vue:163`

```vue
<OIcon name="warning" :color="store.state.theme === 'dark' ? 'orange-4' : 'orange'" size="md" />
```

OIcon doesn't accept `:color` (see C8). Even if it did, `orange-4` /
`orange` are Quasar palette names, not Tailwind colours. The intended
amber/orange tint is lost.

**Solution:**
```diff
- <OIcon name="warning" :color="store.state.theme === 'dark' ? 'orange-4' : 'orange'" size="md" />
+ <OIcon
+   name="warning"
+   :class="store.state.theme === 'dark' ? 'tw:text-orange-400' : 'tw:text-orange-500'"
+   size="md"
+ />
```

### M6. `ResumePipelineDialog.vue` `subTitle` uses `convertUnixToQuasarFormat`

`web/src/components/ResumePipelineDialog.vue:24`. The helper still exists
in `web/src/utils/zincutils.ts:1211` (renamed but kept), so this works.
Worth a cleanup later to rename it (`convertUnixToReadableFormat`?), but
not broken.

**Solution:** Rename in `zincutils.ts` and update the import in `ResumePipelineDialog.vue:24`:
```diff
- import { convertUnixToQuasarFormat } from "@/utils/zincutils";
+ import { convertUnixToReadableFormat } from "@/utils/zincutils";
```

---

## Test File Issues

### T1. Syntax error in `useDnD.spec.ts:45-52` (see C4)

The entire useDnD test suite fails to parse. Pipeline drag/drop /
connect / cycle-detection have no functional coverage right now.

**Solution:** See C4 — fix the broken `vi.mock("quasar", ...)` block.

### T2. Broken `quasar` package imports in 6 spec files (see C5)

```
web/src/components/pipeline/PipelineList.spec.js:21
web/src/components/pipeline/NodeForm/ScheduledPipeline.spec.js:3, 13
web/src/components/pipelines/BackfillJobsList.spec.ts:25
web/src/components/pipelines/EditBackfillJobDialog.spec.ts:43
web/src/components/pipelines/CreateBackfillJobDialog.spec.ts:25
```

`vi.mock('quasar', async (importOriginal) => importOriginal())` will
throw at module-resolution time because `quasar` is no longer in
`package.json`. The dependent suites will not run.

**Solution:** See C5 — replace the `vi.mock("quasar", ...)` blocks with `vi.mock("@/lib/feedback/Toast/useToast", () => ({ toast: vi.fn() }))`.

### T3. PipelineHistory.spec.ts:578-596 will hang/throw via formatDate (see C2)

The test invokes the broken `formatDate`. Recursion → stack overflow.

**Solution:** See C2 — fix the local `formatDate` shadowing the import. The spec then no longer recurses.

### T4. `installQuasar()` no-op + lingering references

`web/src/test/unit/helpers/install-quasar-plugin.ts` is now a no-op
shim with a `TODO: REMOVE THIS FILE when unit tests are rewritten`
comment. 17 pipeline-area spec files still import it. Not broken but
indicates incomplete migration.

**Solution:**
```diff
- import { installQuasar } from "@/test/unit/helpers/install-quasar-plugin";
- installQuasar();
```
Repo-wide cleanup in pipeline specs; delete the helper file once all callers are removed.

### T5. PipelineHistory.spec.ts uses Quasar test stubs but the
component no longer needs them
(`O*` components are real Vue components — should be stubbed in
`global.stubs` if needed). Stubs at lines 104, 155 are correct but
`installQuasar()` import is leftover noise.

**Solution:** Drop `installQuasar()` call; keep the `global.stubs` for ODrawer/ODialog if test isolation requires it.

---

## Validations & Other Notes

### V1. Pipeline name validation

`PipelineEditor.vue:32` uses `:error="pipelineNameError"` /
`:error-message="pipelineNameErrorMessage"` on `<OInput>`. This API is
correct for OInput (spot-checked elsewhere). Validation logic appears to
have been preserved across the migration; no immediate issues found.

### V2. Pipeline node form drawers

All NodeForm drawers (Stream, Condition, Query, AssociateFunction,
ExternalDestination, LlmEvaluation, ScheduledPipeline) are wrapped in
ODrawer with `@keydown.stop`. That's correct, but the inner forms still
contain stale Quasar styling and the Cancel buttons in StreamSelection
(see L3) are not wired.

### V3. Pipeline save flow

`PipelinesList.vue:871` (`savePipeline`) and `PipelineEditor.vue` save
flow look intact — they call `pipelineService` and toast on success /
failure. Toast variants are missing (M4) but the data flow is fine.

### V4. Pipeline export / bulk operations

`PipelinesList.vue:996-1019` (`exportBulkPipelines`),
`PipelinesList.vue:1062-1118` (`bulkTogglePipelines`),
`PipelinesList.vue:1128-1196` (`bulkDeletePipelines`). All three call
`selectedPipelines.value = []` at completion — see C3/L1. Functional but
the visible selection never clears.

**Solution:** See C3 — `selectedPipelineIds.value = []`.

### V5. Vue-flow integration

`PipelineFlow.vue`, `CustomEdge.vue`, `EdgeWithButton.vue`,
`DropzoneBackground.vue` — vue-flow plumbing itself looks intact. The
edge cycle-detection and node validation in `useDnD.ts` still works; only
the toast styling is degraded (C7).

---

## Recommendations

Priority 0 (release blockers)
1. **CustomNode.vue:** replace all six `io - type` with `io_type` —
   fastest possible win, restores every node icon.
2. **PipelineHistory.vue:** rename the local `formatDate` (e.g.
   `formatTimestampMicros`) so it no longer shadows the import, or use
   `import * as dateUtils from "@/utils/date"` and call
   `dateUtils.formatDate(...)`. Also re-run / fix
   `PipelineHistory.spec.ts:578-596`.
3. **PipelinesList.vue:** change every `selectedPipelines.value = []`
   (lines 937, 1013, 1106, 1195) to `selectedPipelineIds.value = []`.
4. **useDnD.spec.ts:45-52:** fix the syntax error (`Notify: { create: ... }`
   or just remove the dead key) so the suite can parse.

Priority 1 (functional, user-visible)
5. **useDnD.ts:** add `variant: "error"` to every error toast (lines
   ~153, 220, 231, 242, 405) so cycle / duplicate-edge / source-limit
   warnings look like errors.
6. **PipelineHistory.vue & CreateBackfillJobDialog.vue:** OIcon no longer
   has a `color` prop — translate intent to either `name="<color-variant
   icon>"` or wrap in a coloured span; otherwise rows have no visual cue
   distinguishing realtime/scheduled/silenced/partial.
7. **StreamSelection.vue:** wire `@click="$emit('cancel')"` (or similar)
   on the in-form cancel button and the close icon; drop the inert
   `v-close-popup`.
8. **ExternalDestination.vue:36:** same — close button uses
   `v-close-popup` and does nothing; needs a real `@click` to close the
   parent drawer.

Priority 2 (test infrastructure)
9. Sweep the six spec files that `vi.mock('quasar', ...)` — either remove
   the mock entirely or alias `quasar` to a local stub so module
   resolution succeeds.
10. Delete `installQuasar()` calls + the helper file; rewrite specs to
    only register layout injections via `qLayoutInjections()` as the
    helper's TODO suggests.

Priority 3 (housekeeping, dead CSS)
11. Strip the `.body--dark` rule blocks across all pipeline files (~175
    occurrences project-wide; pipeline area accounts for a large chunk).
    Replace with `.dark-theme &` if those styles are still desired.
12. Strip the `.q-*` selectors from all pipeline files
    (ScheduledPipeline.vue ~2715-2790, Stream.vue 489-496,
    CreateDestinationForm.vue 1390-1419, Condition.vue 890-892,
    ExternalDestination.vue 272, CustomNode.vue 1273/1280/1287/1359,
    PipelineFlow.vue 264).
13. Fix `flex-center` → `center` in ResumePipelineDialog.vue:220.
14. Fix `:v-deep` → `:deep` in ResumePipelineDialog.vue:174 (or just
    delete the whole `.q-btn` block since the selector targets nothing).
15. Delete the orphan `.dark-theme-dialog` / `.light-theme-dialog`
    block in ResumePipelineDialog.vue (no longer applied anywhere).
16. Replace `class="bg-dark"` / `class="bg-white"` with Tailwind /
    theme-aware classes in StreamSelection.vue:20, Stream.vue:28,
    Condition.vue:29.
17. Drop the `q-table__title` class hook from PipelinesList.vue:25,
    PipelineHistory.vue:34, BackfillJobsList.vue:33 — it has no
    associated CSS now.

## Class-Level Styling Audit

### 1. Quasar Class Leftovers
| File:Line | Class | Replacement | Layer |
|-----------|-------|-------------|-------|
| `components/pipeline/PipelinesList.vue:25` | `q-table__title` | drop (dead CSS) | File-scoped |
| `components/pipelines/PipelineHistory.vue:34` | `q-table__title` | drop | File-scoped |
| `components/pipelines/PipelineHistory.vue:258` | `text-weight-medium` | `tw:font-medium` | File-scoped |
| `components/pipelines/PipelineHistory.vue:231` | `tw:mr-md` (invalid token) | `tw:mr-4` | File-scoped |
| `components/pipelines/BackfillJobsList.vue:33` | `q-table__title` | drop | File-scoped |
| `components/pipelines/BackfillJobsList.vue:263` | `text-weight-medium` | `tw:font-medium` | File-scoped |
| `components/pipelines/BackfillJobDetails.vue:73,108,137` | `q-pa-md` | `tw:p-4` | File-scoped |
| `components/pipeline/NodeForm/AssociateFunction.vue:27` | `:class="...'bg-dark' : 'bg-white'"` | `:class="$dark ? 'tw:bg-[var(--o2-bg-dark)]' : 'tw:bg-white'"` or use `dark:` Tailwind variants | File-scoped |
| `components/pipeline/NodeForm/AssociateFunction.vue:93` | `text-weight-medium text-primary` | `tw:font-medium tw:text-[var(--o2-primary)]` | File-scoped |
| `components/pipeline/NodeForm/Condition.vue:29` | `:class="...'bg-dark' : 'bg-white'"` | same theme-aware replacement | File-scoped |
| `components/pipeline/NodeForm/LlmEvaluation.vue:28` | `:class="...'bg-dark' : 'bg-white'"` | same | File-scoped |
| `components/pipeline/NodeForm/Stream.vue:28` | `:class="...'bg-dark' : 'bg-white'"` | same | File-scoped |
| `components/pipeline/NodeForm/ScheduledPipeline.vue:1041` | `:class="...'bg-dark' : 'bg-white'"` | same | File-scoped |
| `components/pipeline/StreamSelection.vue:19` | `class="full-height"` | `tw:h-full` | File-scoped |
| `components/pipeline/StreamSelection.vue:20` | `:class="...'bg-dark' : 'bg-white'"` | same | File-scoped |
| `components/pipeline/PipelinesList.vue:305` | `tw:mr-md` (invalid token) | `tw:mr-4` | File-scoped |
| `components/pipeline/NodeForm/ExternalDestination.vue:36` | `v-close-popup` | OPopup `close()` or `@click` to programmatic close | File-scoped |
| `components/pipeline/StreamSelection.vue:32` | `v-close-popup="true"` | OPopup `close()` | File-scoped |

### 2. Tailwind v4 Misuse
| File:Line | Wrong | Right | Layer |
|-----------|-------|-------|-------|
| `components/pipelines/EditBackfillJobDialog.vue:106` | `tw-mt-2 tw-p-3 tw-bg-orange-100 tw-rounded tw-border tw-border-orange-300` | `tw:mt-2 tw:p-3 tw:bg-orange-100 tw:rounded tw:border tw:border-orange-300` | File-scoped |
| `components/pipelines/EditBackfillJobDialog.vue:109` | `tw-mt-0.5` | `tw:mt-0.5` | File-scoped |
| `components/pipelines/EditBackfillJobDialog.vue:111` | `tw-font-semibold tw-mb-1` | `tw:font-semibold tw:mb-1` | File-scoped |
| `components/pipelines/EditBackfillJobDialog.vue:112` | `tw-mb-2` | `tw:mb-2` | File-scoped |
| `components/pipelines/EditBackfillJobDialog.vue:116` | `tw-font-semibold tw-text-xs tw-mb-1` | `tw:font-semibold tw:text-xs tw:mb-1` | File-scoped |
| `components/pipelines/EditBackfillJobDialog.vue:117` | `tw-ml-5 tw-space-y-0.5 tw-list-disc tw-text-xs` | `tw:ml-5 tw:space-y-0.5 tw:list-disc tw:text-xs` | File-scoped |
| `components/pipelines/BackfillJobDetails.vue:50,84,109` | `tw-grid tw-grid-cols-2 tw-gap-4` | `tw:grid tw:grid-cols-2 tw:gap-4` | File-scoped |
| `components/pipelines/BackfillJobDetails.vue:127` | `tw-mt-3` | `tw:mt-3` | File-scoped |
| `components/pipelines/BackfillJobDetails.vue:137` | `tw-border-red-200 q-pa-md tw-bg-red-50` | `tw:border-red-200 tw:p-4 tw:bg-red-50` | File-scoped |
| `components/pipelines/BackfillJobDetails.vue:139` | `tw-mt-1` | `tw:mt-1` | File-scoped |
| `components/pipelines/BackfillJobDetails.vue:140,142` | `tw-flex-1`, `tw-text-red-800 tw-whitespace-pre-wrap tw-break-words` | colon-prefix variants | File-scoped |
| `components/pipelines/BackfillJobDetails.vue:204` | `flex-column` (Quasar) | `tw:flex-col` | File-scoped |
| `components/pipeline/ImportPipeline.vue:124` | `hover:tw:bg-muted/50` | `tw:hover:bg-muted/50` | File-scoped |
| `components/pipelines/PipelineHistory.vue:412` | `tw:rounded tw:border ... tw:bg-red-500/5` (Quasar palette `red-5`-style ok here) | verify token; if Quasar palette, swap to Tailwind palette | File-scoped |

### 3. Quasar CSS Variables
| File:Line | Variable | Replacement | Layer |
|-----------|----------|-------------|-------|
*(none found)*

### 4. Dead `:deep(.q-*)` / `body.body--dark` / `::v-deep`
| File:Line | Selector | Action | Layer |
|-----------|----------|--------|-------|
| `components/pipelines/PipelineHistory.vue:931` | `:deep(.q-dialog__inner)` | Delete or rewrite for ODialog | File-scoped |
| `components/pipeline/NodeForm/Condition.vue:874,881,890` | `:deep(.q-btn)`, `:deep(.q-btn:not([type=submit]))`, `:deep(.q-tabs)` | Delete (no Quasar elements rendered) | File-scoped |
| `components/pipeline/NodeForm/CreateDestinationForm.vue:1392` | `:deep(.q-field__prepend)` | Delete | File-scoped |
| `components/pipeline/NodeForm/CreateDestinationForm.vue:1398,1412,1416` | `.q-btn`, `.q-field--labeled.showLabelOnTop .q-field__bottom`, `.q-field--labeled.showLabelOnTop` | Delete | File-scoped |
| `components/pipeline/NodeForm/Stream.vue:489-491` | `.q-field--labeled.showLabelOnTop.q-select .q-field__control-container .q-field__native` | Delete | File-scoped |
| `components/pipeline/NodeForm/ScheduledPipeline.vue:2728,2731,2742,2760,2787` | `.q-table__control`, `.q-table__top`, `.q-tab__indicator`, `.q-btn`, `.q-btn__content` | Delete or rewrite for OTable/OTabs/OButton | File-scoped |
| `components/pipeline/NodeForm/ExternalDestination.vue:272` | `.q-field__native > :first-child` | Delete | File-scoped |
| `components/pipeline/NodeSidebar.vue:290-305` | `.q-btn.o2vf_node_default`, `.q-btn--flat` chain | Replace with `.o2vf_node_default` only | File-scoped |
| `plugins/pipelines/PipelineFlow.vue:264` | `q-btn { ... }` | Delete | File-scoped |
| `plugins/pipelines/CustomNode.vue:1273,1280,1287,1359` | `.q-dialog__inner`, `.q-card-section` | Delete | File-scoped |
| `components/ResumePipelineDialog.vue:169` | `.q-btn{...}` | Delete | File-scoped |
| `components/ResumePipelineDialog.vue:174` | `:v-deep(.q-btn__content)` (typo `:v-deep`) | Delete (selector targets nothing now) | File-scoped |
| `components/pipeline/NodeSidebar.vue:273` | `.body--dark { ... }` | `html.dark` or `:root[data-theme=dark]` | File-scoped |
| `plugins/pipelines/CustomNode.vue:1180,1354,1476,1600` | `.body--dark` | `html.dark` | File-scoped |
| `plugins/pipelines/PipelineFlow.vue:299` | `.body--dark .edge-help-notification` | `html.dark .edge-help-notification` | File-scoped |
| `components/pipeline/PipelineEditor.vue:1396` | `.body--dark { ... }` | `html.dark` | File-scoped |
| `components/pipeline/NodeForm/AssociateFunction.vue:555-607` | 8x `.body--dark .X` blocks | Convert to `html.dark .X` | File-scoped |

### 5. Quasar SCSS Variables in Scoped Styles
| File:Line | Variable | Replacement | Layer |
|-----------|----------|-------------|-------|
| `components/pipeline/PipelinesList.vue:1237` | `$dark-page` | `var(--o2-bg-dark)` | File-scoped |
| `components/pipeline/NodeForm/ScheduledPipeline.vue:2694` | `$primary` | `var(--o2-primary)` | File-scoped |
| `components/pipeline/NodeForm/ScheduledPipeline.vue:2738` | `$primary` | `var(--o2-primary)` | File-scoped |
| `components/pipeline/NodeForm/ScheduledPipeline.vue:2757` | `$border-color` | `var(--o2-border)` | File-scoped |
| `components/pipeline/NodeForm/ScheduledPipeline.vue:2788` | `$secondary` | `var(--o2-secondary)` | File-scoped |

### 6. Quasar Directives
| File:Line | Directive | Action |
|-----------|-----------|--------|
| `components/pipeline/NodeForm/ExternalDestination.vue:36` | `v-close-popup` | Replace with OPopup `close()` ref or `@click` handler |
| `components/pipeline/StreamSelection.vue:32` | `v-close-popup="true"` | Same |

### 7. Icon Migration
| File:Line | Issue | Fix |
|-----------|-------|-----|
| `components/pipelines/CreateBackfillJobDialog.vue:163` | `OIcon :color="...'orange-4' : 'orange'"` | OIcon does not support `:color` — use `tw:text-orange-500` (or `dark:tw:text-orange-400`) via `class` |

### 8. Inline `style=` Hot Spots
| File:Line | Inline style | Suggested home |
|-----------|--------------|----------------|
| `components/pipeline/NodeSidebar.vue:44` | `style="width: 170px; justify-content: flex-start"` | scoped `.node-sidebar-item { width: 170px; justify-content: flex-start; }` |
| `plugins/pipelines/CustomNode.vue:505,609,694,767,840,914` | `style="display: flex; align-items: center"` (x6 on `.icon-container`) | Add `display:flex; align-items:center;` to `.icon-container` rule in `<style>` |
| `plugins/pipelines/CustomNode.vue:555` | `style="max-height: 300px; overflow-y: auto"` | scoped class |
| `plugins/pipelines/CustomNode.vue:940` | `style="font-size: 0.85em; color: #666; margin-left: 8px"` | scoped class + theme var |
| `components/pipeline/ImportPipeline.vue:44` | `style="height: calc(100vh - 128px) !important; overflow: auto; resize: none;"` | scoped `.error-report-container` rule |
| `components/pipeline/ImportPipeline.vue:360` | `style="white-space: pre-wrap; word-break: break-word"` | scoped class |
| `components/pipeline/NodeForm/Query.vue:48` | `style="height: 34px !important; border-radius: 3px"` | scoped class |
| `components/pipeline/NodeForm/PreviewPromqlQuery.vue:19` | `style="height: calc(100vh - 220px); width: 100%;"` | scoped class |
| `components/pipeline/NodeForm/ScheduledPipeline.vue:34,93,252,258,432,455,484,521` | many inline width/height/style strings | promote to dedicated scoped classes (`.sched-tabs-host`, `.sched-row-input`, etc.) |

### 9. Duplicate Style Blocks (candidates for partial)
| Files | Duplicated block | Suggested partial |
|-------|------------------|-------------------|
| `AssociateFunction.vue`, `Condition.vue`, `LlmEvaluation.vue`, `Stream.vue`, `StreamSelection.vue`, `ScheduledPipeline.vue` (NodeForm dialogs) | `:class="store.state.theme === 'dark' ? 'bg-dark' : 'bg-white'"` | Promote to a shared `<NodeFormDialog>` wrapper SFC, or move logic into a `useThemeClass()` composable |
| `PipelinesList.vue:25`, `PipelineHistory.vue:34`, `BackfillJobsList.vue:33` | `q-table__title tw:font-[600] ...` header titles | Promote to a shared `<PipelineHeaderTitle>` partial |
| `CustomNode.vue:505/609/694/767/840/914` | `<div class="icon-container" style="display:flex; align-items:center">` (6x) | Move to `.icon-container` scoped rule |
| `AssociateFunction.vue:555-607` | 8x `.body--dark .function-X` blocks | Consolidate into one `html.dark { .function-X { ... } }` parent block |

### 10. Layer Summary
- Global (`app.scss`) changes needed: 0 (all dark-mode switches stay local; `.body--dark` → `html.dark`)
- Component-level partial changes: 2 (NodeForm dialog wrapper, pipeline header title)
- File-level scoped changes: ~70+ (largest cleanup surface)
