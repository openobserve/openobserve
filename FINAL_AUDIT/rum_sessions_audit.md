# RUM Sessions Page — Quasar Removal Audit

## Summary

The Quasar removal refactor across the RUM Sessions surface (session list, session viewer, replay player, sidebar) is largely structural and mechanical, but introduces several functional regressions and a swath of cosmetic leftovers.

The most consequential findings are:

1. **OSplitter direction is inverted** in `AppSessions.vue` and `SessionsList.vue`. The Quasar `q-splitter vertical` (vertical divider → side‑by‑side panels) was rewritten as OSplitter `:horizontal="true"` (horizontal divider → stacked panels). Field sidebar and table now render top/bottom instead of left/right.
2. **`SessionViewer.vue` root layout is broken.** The outer wrapper changed from `class="row"` (Quasar `display: flex; flex-wrap: wrap;`) to `class="tw:flex"` (default `flex-direction: row; flex-wrap: nowrap;`). The header and the player+sidebar block now squeeze side‑by‑side instead of stacking vertically.
3. **`FrustrationBadge.vue` and `FrustrationEventBadge.vue` render empty badges** — the `:label="count"` / `:label="getBadgeLabel(type)"` props from Quasar `q-badge` were dropped during migration. `OBadge` requires the value in the default slot; the slot was left empty.
4. **`VideoPlayer.vue` speed selector is broken** because `OSelect` emits the option's primitive `value` (a `number`), but the original code stores and consumes `playerState.speed` as an object `{label, value}` and calls `setSpeed(speed)` expecting `speed.value`.

In addition, every audited file still contains Quasar-only utility class names (`row`, `col-12`, `col-auto`, `float-right`, `float-left`, `full-height`, `full-width`, `relative-position`, `inline`, `bg-primary`, `bg-red-3`, `align-center`, `text-grey-…` etc.) and large blocks of `.q-…` selectors in scoped/global SCSS — none of these resolve to anything now that Quasar's CSS is gone.

Spec files for every audited component remain wired to Quasar (`installQuasar`, `import * as quasar from "quasar"`, `q-select`/`q-toggle`/`q-splitter` stubs, deleted `AppTable`/`FieldList` mocks).

## Files Audited

- `/Users/ktx/Documents/Projects/openobserve.worktrees/ux-revamp/web/src/views/RUM/RealUserMonitoring.vue` (22-line diff)
- `/Users/ktx/Documents/Projects/openobserve.worktrees/ux-revamp/web/src/views/RUM/AppSessions.vue` (195-line diff) — primary Sessions view
- `/Users/ktx/Documents/Projects/openobserve.worktrees/ux-revamp/web/src/views/RUM/SessionViewer.vue` (54-line diff) — session replay viewer
- `/Users/ktx/Documents/Projects/openobserve.worktrees/ux-revamp/web/src/components/rum/SessionsList.vue` (118-line diff) — dead component (no live importers)
- `/Users/ktx/Documents/Projects/openobserve.worktrees/ux-revamp/web/src/components/rum/SearchBar.vue` (33-line diff) — only imported by dead `SessionsList.vue`
- `/Users/ktx/Documents/Projects/openobserve.worktrees/ux-revamp/web/src/components/rum/VideoPlayer.vue` (81-line diff) — rrweb-player host
- `/Users/ktx/Documents/Projects/openobserve.worktrees/ux-revamp/web/src/components/rum/PlayerEventsSidebar.vue` (93-line diff)
- `/Users/ktx/Documents/Projects/openobserve.worktrees/ux-revamp/web/src/components/rum/FrustrationBadge.vue`
- `/Users/ktx/Documents/Projects/openobserve.worktrees/ux-revamp/web/src/components/rum/FrustrationEventBadge.vue`
- `/Users/ktx/Documents/Projects/openobserve.worktrees/ux-revamp/web/src/components/rum/EventDetailDrawer.vue`
- `/Users/ktx/Documents/Projects/openobserve.worktrees/ux-revamp/web/src/components/rum/EventDetailDrawerContent.vue` (162-line diff, sampled)
- `/Users/ktx/Documents/Projects/openobserve.worktrees/ux-revamp/web/src/components/rum/sessionReplay/SessionLocationColumn.vue` (25-line diff)
- `/Users/ktx/Documents/Projects/openobserve.worktrees/ux-revamp/web/src/components/rum/ResourceDetailDrawer.vue` (84-line diff, sampled)

rrweb-player wiring itself (`@openobserve/rrweb-player` import, `new rrwebPlayer(...)`, event listeners, web-worker CSS proxy) is intact.

## Critical Issues

### C1. OSplitter direction inverted (sessions page layout broken)

`AppSessions.vue:63-68` — was `q-splitter ... vertical` (vertical divider, left/right panels). Now:

```vue
<OSplitter
  class="tw:pl-[0.625rem]! tw:h-[calc(100%-8.125rem)]"
  v-model="splitterModel"
  unit="px"
  :horizontal="true"
>
```

`OSplitter.vue:8-10` confirms `horizontal=true` applies `tw:flex-col` and renders a top/bottom split with a 4px horizontal resize handle. The intended layout is sidebar (250px) on the left and the sessions table on the right; the user now sees a 250px tall header strip with the table below it. The same bug is present at `SessionsList.vue:20-25` (dead code, but identical mistake).

The two `#before` / `#after` template blocks themselves are still labeled "before/after" but visual semantics flipped, so verifying empirically may be misleading until this is corrected.

**Solution:**
```diff
  <OSplitter
    class="tw:pl-[0.625rem]! tw:h-[calc(100%-8.125rem)]"
    v-model="splitterModel"
    unit="px"
-   :horizontal="true"
+   :horizontal="false"
  >
```

### C2. SessionViewer outer wrapper switches from `row+wrap` to flex-row-nowrap

`SessionViewer.vue:18`:

```vue
<div class="tw:flex qp-2 tw:h-full tw:px-[0.625rem]">
```

Originally `<div class="row qp-2 ...">`. Quasar's `.row` is `display: flex; flex-wrap: wrap;`. After conversion, default `tw:flex` is `flex-direction: row; flex-wrap: nowrap;`, so the two children (header on line 19, player container on line 72) are placed **side by side** rather than stacked. The first child also has `tw:w-full` and so does the second — combined width 200% with no wrap forces horizontal squash. Fix: `tw:flex tw:flex-col` or `tw:flex tw:flex-wrap`.

(Note: `qp-2` is a pre-existing dangling class name on both branches — likely meant `q-pa-sm`. Not caused by this refactor but worth cleaning up.)

**Solution:**
```diff
- <div class="tw:flex qp-2 tw:h-full tw:px-[0.625rem]">
+ <div class="tw:flex tw:flex-col tw:p-2 tw:h-full tw:px-[0.625rem]">
```

### C3. FrustrationBadge renders an empty badge — count never shown

`FrustrationBadge.vue:19-25`:

```vue
<OBadge
  v-if="count > 0"
  :variant="badgeVariant"
  class="frustration-badge"
  :data-test="`frustration-badge-${severity}`"
>
</OBadge>
```

Original main branch used `<q-badge :label="count" ...>` plus a nested `<q-tooltip>` for the count description. The migration kept the props/computeds (`tooltipText`, `severity`) but emitted an empty `<OBadge />`, so the user sees a coloured pill with no number. The `OTooltip` import on line 34 is unused (no `OTooltip` element rendered anywhere). Fix: put `{{ count }}` in the default slot (and bring back tooltip behaviour, e.g. wrap in `<OTooltip>` or rely on `title`).

**Solution:**
```diff
- <OBadge
-   v-if="count > 0"
-   :variant="badgeVariant"
-   class="frustration-badge"
-   :data-test="`frustration-badge-${severity}`"
- >
- </OBadge>
+ <OTooltip :content="tooltipText">
+   <OBadge
+     v-if="count > 0"
+     :variant="badgeVariant"
+     class="frustration-badge"
+     :data-test="`frustration-badge-${severity}`"
+   >
+     {{ count }}
+   </OBadge>
+ </OTooltip>
```

### C4. FrustrationEventBadge renders empty badges — label and tooltip lost

`FrustrationEventBadge.vue:22-29`:

```vue
<OBadge
  v-for="(type, index) in frustrationTypes"
  ...
>
</OBadge>
```

Original used `:label="getBadgeLabel(type)"` and a nested `<q-tooltip>` calling `getTooltipText(type)`. Now `getBadgeLabel` and `getTooltipText` are still defined but never referenced anywhere in the template, so each frustration tag renders as a blank coloured pill. `OTooltip` import on line 37 is unused.

**Solution:**
```diff
- <OBadge v-for="(type, index) in frustrationTypes" ... >
- </OBadge>
+ <OTooltip v-for="(type, index) in frustrationTypes" :key="index" :content="getTooltipText(type)">
+   <OBadge :variant="getBadgeVariant(type)">
+     {{ getBadgeLabel(type) }}
+   </OBadge>
+ </OTooltip>
```

### C5. VideoPlayer speed selector broken (`speed.value` undefined after first change)

`VideoPlayer.vue:133-138`, `530-532`:

```vue
<OSelect
  class="speed-selector"
  v-model="playerState.speed"
  :options="speedOptions"
  @update:model-value="setSpeed"
/>
```

```ts
const setSpeed = (speed: { label: string; value: number }) => {
  player.value?.setSpeed(speed.value);
};
```

`speedOptions` are `{label, value}` objects and `playerState.speed` is initialised to `{label: "4x", value: 4}`. `OSelect.vue:307-318` (`handleUpdate`) resolves to `opt.value` (the primitive). So after the first user interaction:

- `playerState.speed` is rewritten from `{label, value}` to plain `4`.
- `setSpeed(4)` evaluates `4.value` → `undefined` → `rrwebPlayer.setSpeed(undefined)` → no-op or runtime error inside the player.
- The trigger's display label that depends on the object shape (`{{ playerState.speed.label }}` etc., if anywhere) becomes stale.

Fix options: (a) bind `v-model="playerState.speed.value"` and `:options="speedOptions"` then have `setSpeed(value: number)` call `player.value?.setSpeed(value)`; (b) keep object behaviour by manually looking up the option in `setSpeed`. Option (a) is cleaner.

**Solution:**
```diff
- <OSelect
-   class="speed-selector"
-   v-model="playerState.speed"
-   :options="speedOptions"
-   @update:model-value="setSpeed"
- />
- const setSpeed = (speed: { label: string; value: number }) => {
-   player.value?.setSpeed(speed.value);
- };
+ <OSelect
+   class="speed-selector"
+   v-model="playerState.speed.value"
+   :options="speedOptions"
+   @update:model-value="setSpeed"
+ />
+ const setSpeed = (value: number) => {
+   player.value?.setSpeed(value);
+ };
```

## Logical Issues

### L1. AppSessions scroll-end pagination dead-code

`AppSessions.vue:648-656` — `handleScrollEnd` increments `sessionState.data.resultGrid.currentPage` but the actual `getSessions()` call is commented out (`// getSessions();`). The `from`/page handling in `getSessions` (line 431) uses `Object.keys(sessionState.data.sessions).length`, not `currentPage`, so even if it were called, pagination wouldn't be wired correctly. This is a pre-existing logic gap, but worth flagging since the refactor changed the trigger semantics (was Quasar `virtual-scroll`'s `scroll` with `scrollData.to`, now `scroll-end`).

**Solution:**
```diff
  const handleScrollEnd = () => {
    sessionState.data.resultGrid.currentPage += 1;
-   // getSessions();
+   getSessions(sessionState.data.resultGrid.currentPage);
  };
```
(And update `getSessions(page)` to use `page * pageSize` as the `from` offset instead of relying on session count.)

### L2. Row click navigation semantics changed

`AppSessions.vue:643-646`: `@row-click` on `OTable` now navigates to SessionViewer for **any** row click. Previously, `AppTable` emitted a `cell-click` only when the action play column was clicked. The `cell-action_play` slot just renders the play icon without its own click handler, so the play icon and the rest of the row both navigate, but elements like the location/frustration cells are no longer guarded against accidental navigation. Not a hard bug, but a behaviour change worth confirming with design.

**Solution:**
```diff
- <OTable @row-click="handleRowClick" ... />
+ <OTable ... >
+   <template #cell-action_play="{ row }">
+     <OButton variant="ghost" size="sm" @click.stop="handleRowClick(row)">
+       <OIcon name="play-circle-filled" />
+     </OButton>
+   </template>
+ </OTable>
```

### L3. `getSessions` called on mount before `dateTime` is hydrated

`AppSessions.vue:344-354` and `restoreUrlQueryParams` (lines 706-724). `restoreUrlQueryParams` only writes to `sessionState.data.datetime` and never copies into the local `dateTime` ref. The first `getSessions()` therefore runs with `dateTime.value = {startTime: 0, endTime: 0, ...}`. The DateTime component emits `updateDateChange` on its own internal init which eventually triggers another `getSessions` for relative ranges (line 632), but absolute ranges set via URL never get used by the first request. This is preexisting but the refactor did not fix it.

**Solution:**
```diff
  const restoreUrlQueryParams = () => {
    // populate sessionState.data.datetime from URL query
    sessionState.data.datetime = { startTime, endTime, type, ... };
+   dateTime.value = { ...sessionState.data.datetime };  // sync local ref
  };
```

### L4. `SessionsList.vue` + `SearchBar.vue` are dead code

Neither is referenced by a router config or any active view. The only consumers are their own `*.spec.ts` files. They still contain the same C1 splitter inversion and broken Quasar references. Consider deleting them or wiring them in — leaving them in the tree makes audits noisier and tests will keep failing.

**Solution:**
```diff
- rm web/src/components/rum/SessionsList.vue web/src/components/rum/SessionsList.spec.ts
- rm web/src/components/rum/SearchBar.vue web/src/components/rum/SearchBar.spec.ts
```

### L5. `OTooltip` imported but unused (FrustrationBadge / FrustrationEventBadge)

See C3/C4. The leftover imports will trigger lint warnings and slightly bloat the bundle.

**Solution:**
```diff
- import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
+ // Either remove unused import OR wire it into the template per C3/C4 fix
```

## CSS / Layout Issues

### S1. Mass orphaned `.q-…` selectors in scoped/global SCSS

The following selectors target Quasar internals that no longer exist after Quasar removal — they're effectively dead CSS:

- `AppSessions.vue:755-826` — `.q-field__native`, `.q-field__input`, `.q-table tbody td`, `.q-splitter__after`, `.q-table__top`, `.q-table__control`, `.q-field__control-container`, `.q-btn__content`, `.q-icon` (the latter two were renamed to `.OIcon`, which doesn't exist either; OIcon renders its own internal markup).
- `SessionsList.vue:149-191` — same selectors duplicated.
- `VideoPlayer.vue:619-632` — `.q-field__control`, `.q-field__marginal`, `.q-field__native` (targeting the speed selector which is now OSelect).
- `SearchBar.vue:343-468` — large block of `.q-toggle__*`, `.q-field*`, `.q-btn*`, `.q-btn-group`, `.q-btn-dropdown__arrow-container`, `.OIcon` selectors.
- `PlayerEventsSidebar.vue:275-286` — `.q-field__control .q-field__native span`.

These were left untouched. None render anything now. They should be either deleted or rewritten against the actual O* component DOM (typically using `:deep()` selectors against `.o-select__*`, `.o-input__*`, etc.).

**Solution:**
```diff
- :deep(.q-field__native), :deep(.q-field__input) { padding: 0 8px; }
- :deep(.q-table tbody td) { height: 32px; }
- :deep(.q-btn__content) { gap: 4px; }
+ :deep(.o-input__field) { padding: 0 8px; }
+ :deep(.o-table__td) { height: 32px; }
+ :deep(.o-button) { gap: 4px; }
```

### S2. Leftover Quasar utility classes (not migrated to `tw:` equivalents)

Found in production code (i.e. not just SCSS):

- `AppSessions.vue:23,26` — `align-center` (Quasar) sitting next to `tw:flex tw:justify-between/end`. Should be `tw:items-center`.
- `SearchBar.vue:20,27,30,38,51` — `float-right`, `float-left`, `col-auto`. Float layouts likely produce a different visual result than the original Quasar grid; Tailwind doesn't ship `float-right`/`float-left` utilities (they exist as `tw:float-right` but bare `float-right` does nothing).
- `SessionViewer.vue:75` — `full-height`. Should be `tw:h-full`.
- `VideoPlayer.vue:18,48` — `full-height`, `relative-position`. Should be `tw:h-full`, `tw:relative`.
- `PlayerEventsSidebar.vue:18,61` — `relative-position`. Same.
- `VideoPlayer.vue:52,62` — `bg-primary` (Quasar colour class). Likely intended `tw:bg-[var(--o2-primary-btn-bg)]` or similar.
- `PlayerEventsSidebar.vue:90` — `bg-red-3` (Quasar palette). No equivalent in current Tailwind config; will render no background colour.
- `EventDetailDrawerContent.vue:58` — `col-auto` on the close button wrapper.

**Solution:**
```diff
- <div class="align-center">
- <div class="float-right col-auto">
- <div class="full-height relative-position bg-primary">
- <div class="bg-red-3">
+ <div class="tw:items-center">
+ <div class="tw:float-right tw:ml-auto">
+ <div class="tw:h-full tw:relative tw:bg-[var(--o2-primary)]">
+ <div class="tw:bg-red-300">
```

### S3. `tw:` classes that won't resolve to anything visible

- `VideoPlayer.vue:439-446` — `getEventMarkerClass()` returns `"bg-frustration-marker"` (a scoped class — defined in the file's own `<style scoped lang="scss">` block at line 613, good), `"bg-red-5"` (Quasar palette, no replacement), or `"bg-secondary"` (Quasar palette, no replacement). Event markers on the playback bar will be unstyled for non-frustration events.
- `PlayerEventsSidebar.vue:90` — `bg-red-3` on error event badges, same problem.

**Solution:**
```diff
- const getEventMarkerClass = (type: string) => {
-   if (type === "frustration") return "bg-frustration-marker";
-   if (type === "error") return "bg-red-5";
-   return "bg-secondary";
- };
+ const getEventMarkerClass = (type: string) => {
+   if (type === "frustration") return "bg-frustration-marker";
+   if (type === "error") return "tw:bg-red-500";
+   return "tw:bg-gray-400";
+ };
```

### S4. SessionViewer `OSeparator vertical` inside a `tw:w-1/4 tw:flex` container

`SessionViewer.vue:83-89`:

```vue
<div class="tw:w-1/4 tw:flex">
  <OSeparator vertical class="tw:h-full" />
  <PlayerEventsSidebar .../>
</div>
```

The outer flex container is `tw:flex` (default row). `OSeparator vertical` will produce a vertical divider line which is correct, but the sidebar is set to `tw:w-1/4` (25%). With the C2 root layout bug (whole page flex-row), the side panel may not actually consume 25% of the page width.

**Solution:**
```diff
- <div class="tw:w-1/4 tw:flex">
+ <div class="tw:w-1/4 tw:flex tw:flex-shrink-0">
   <OSeparator vertical class="tw:h-full" />
   <PlayerEventsSidebar .../>
  </div>
```
(Also fix C2 first so the outer container is `tw:flex tw:flex-col`.)

## Component Migration Issues

### M1. `q-spinner-hourglass` → `OSpinner`

- `AppSessions.vue:92-96`, `VideoPlayer.vue:24-28`, `RealUserMonitoring.vue:24-28` — migrated correctly with `size="md"` and `data-test`. No functional issue.

**Solution:** No action needed. Optionally upgrade to `variant="dots"` for visual continuity.

### M2. `q-icon name="snake_case"` → `OIcon name="kebab-case"`

- All audited files use kebab-case names (`play-circle-filled`, `arrow-back-ios-new`, `calendar-month`, `sentiment-very-dissatisfied`, `location-on`, `arrow-forward`, `replay-10`, `forward-10`, `pause-circle-filled`). Assuming the OIcon component honours the Material Symbol kebab-case → snake_case mapping internally, this is fine. If it doesn't (e.g. expects underscores), every icon will silently fail to render. Worth a smoke test.

### M3. `q-toggle` → `OSwitch`

- `VideoPlayer.vue:127-132` — migrated correctly. `OSwitch` supports `label`, `v-model`, `update:model-value`.

### M4. `q-select` → `OSelect`

- `VideoPlayer.vue:133-138` — see C5 (speed regression).
- `PlayerEventsSidebar.vue:62-71` — previously used `q-select` with a manual `v-slot:option` rendering `q-checkbox` + `q-item-label`. The new `OSelect` with `multiple` plus `labelKey="label" valueKey="value"` should render checkboxes itself, so this is largely a clean simplification. Worth verifying selectAll/checkbox behaviour visually.

### M5. `q-input` → `OInput`

- `PlayerEventsSidebar.vue:53-60` — dropped `size="xs" filled borderless dense debounce="1"`. The new `OInput` does not support `debounce` natively (the original keystroke-debounce of 1ms was effectively immediate anyway, so probably fine). The clearable + placeholder behaviour matches.

### M6. `q-separator` → `OSeparator`

- `SessionViewer.vue:84`, `PlayerEventsSidebar.vue:73` — `OSeparator` supports `vertical` and `class`, migrated correctly.

### M7. `q-splitter vertical` → `OSplitter :horizontal="true"`

- See C1. Semantically reversed in both audited files.

### M8. `useQuasar` / `q.notify` → `toast` from `@/lib/feedback/Toast/useToast`

- `AppSessions.vue:536-540, 610-616` — `position: "bottom-center"` is OK. `color: "negative"` was correctly dropped (the `toast` API likely infers severity from another field — verify whether error toasts now look like info toasts since severity is lost in the migration).

### M9. `date.formatDate` from quasar → `formatDate` from `@/utils/date`

- `AppSessions.vue:687`, `SessionViewer.vue:610` — both updated. Assuming `@/utils/date.formatDate` accepts `(timestamp, pattern)` with Quasar-style tokens (e.g. `MMM DD, YYYY HH:mm:ss Z`) the behaviour will match. Worth a spot check — `Z` token rendering of timezone differs between Quasar (`+05:30`) and date-fns (`GMT+0530`) or others.

**Solution:** Verify timezone format renders identically. If using `date-fns`, ensure pattern uses the equivalent tokens:
```diff
- formatDate(ts, "MMM DD, YYYY HH:mm:ss Z")
+ formatDate(ts, "MMM dd, yyyy HH:mm:ss XXX")  // date-fns equivalent
```

### M10. `Navigation`, `Tag` from `lucide-vue-next` → string icon names

- `PlayerEventsSidebar.vue:146-163` — tab icons changed from Vue components to string names (`"navigation"`, `"label"`). The `AppTabs` component presumably feeds these to OIcon, but `label` is not a Material Symbol name — likely should be `"sell"` or `"label-outline"`. Worth verifying.

**Solution:**
```diff
- { name: "actions", icon: "navigation", ... },
- { name: "errors", icon: "label", ... },
+ { name: "actions", icon: "navigation", ... },  // ok if registered
+ { name: "errors", icon: "sell", ... },  // or "label-outline"
```

## Test File Issues

The following spec files still depend on Quasar and on components that no longer exist. They will fail or produce false-positive coverage:

- `/Users/ktx/Documents/Projects/openobserve.worktrees/ux-revamp/web/src/views/RUM/AppSessions.spec.ts`
  - Line 7, 139: `import { installQuasar }` + `installQuasar()`.
  - Lines 207-214: stubs that render `q-btn`, `q-separator`, `q-splitter` HTML — these stubs do not match the real OSplitter/OButton DOM.
  - Lines 240-246, 660-661, 802-803: stubs for `FieldList` and `AppTable` components that no longer exist (file `SearchFieldList.vue` is the new name, and `OTable` replaced `AppTable`).
  - Line 311: `wrapper.find(".q-splitter")` — selector won't match OSplitter.

- `/Users/ktx/Documents/Projects/openobserve.worktrees/ux-revamp/web/src/views/RUM/SessionViewer.spec.ts`
  - Line 5, 8: `installQuasar`.

- `/Users/ktx/Documents/Projects/openobserve.worktrees/ux-revamp/web/src/components/rum/SessionsList.spec.ts`
  - Line 36: `import * as quasar from "quasar"`.
  - Lines 77-86: mocks for `SearchFieldList` (ok) and `AppTable` (deleted).
  - Lines 203-416: assertions like `findComponent({ name: "FieldList" })`, `{ name: "AppTable" }`.

- `/Users/ktx/Documents/Projects/openobserve.worktrees/ux-revamp/web/src/components/rum/SearchBar.spec.ts:27` — `import * as quasar from "quasar"`.

- `/Users/ktx/Documents/Projects/openobserve.worktrees/ux-revamp/web/src/components/rum/VideoPlayer.spec.ts:19, 168-170, 177-179, 293, 298` — `quasar` import; stubs and selectors for `q-toggle` and `q-select`.

- `/Users/ktx/Documents/Projects/openobserve.worktrees/ux-revamp/web/src/components/rum/PlayerEventsSidebar.spec.ts:19, 118-120` — `quasar` import; `q-select` stub.

- `/Users/ktx/Documents/Projects/openobserve.worktrees/ux-revamp/web/src/components/rum/EventDetailDrawerContent.spec.ts:19`, `ErrorDetail.spec.ts:19`, `ErrorsList.spec.ts:19`, `ResourceDetailDrawer.spec.ts:19`, `sessionReplay/SessionLocationColumn.spec.ts:19` — all start with `import * as quasar from "quasar"`. Each will fail at import-time if `quasar` is no longer resolvable.

The unit tests across the RUM Sessions surface are effectively offline and will need a coordinated migration to mount OSplitter, OSelect, OSwitch, OTable, OInput, OBadge, OSeparator stubs and to drop the `installQuasar` helper.

**Solution (applies to all listed test files):**
```diff
- import { installQuasar } from "@/test/unit/helpers/install-quasar-plugin";
- import * as quasar from "quasar";
- installQuasar();
- stubs: { "q-btn": true, "q-splitter": true, "q-toggle": true, "q-select": true,
-          "FieldList": true, "AppTable": true }
- wrapper.find(".q-splitter")
+ // Drop quasar imports entirely
+ stubs: { OButton: true, OSplitter: true, OSwitch: true, OSelect: true,
+          SearchFieldList: true, OTable: true }
+ wrapper.findComponent({ name: "OSplitter" })
```

## Accessibility

- `SessionViewer.vue:21-27` — the "go back" button is a plain `<div>` with `@click="router.back()"`. It is not focusable, has no `role="button"`, no `tabindex`, and the only label is the `title` attribute. Keyboard users cannot return to the sessions list from the viewer. Should be a `<OButton>` (icon-sm, ghost) or at minimum a `<button>` element.
- `VideoPlayer.vue:97-118` — replay/play/skip controls are plain `<OIcon>` elements with `@click`. Same issue: not focusable, no aria-label, no `role="button"`. The play/pause icon name toggles correctly but a screen reader has no way of announcing playback state.
- `VideoPlayer.vue:41-43` — the `#player` element (rrweb canvas host) is a clickable `<div>` with `@click="togglePlay"`. No keyboard alternative.
- `VideoPlayer.vue:46-50, 73-75` — playback bar and event markers use clickable `<div>`s with no role/aria.
- `PlayerEventsSidebar.vue:78-114` — event rows are clickable `<div>`s. Should be focusable list items or buttons.
- `AppSessions.vue:116-122` — "play" action column relies on the entire row click handler; there is no per-row focusable button for the play action. Keyboard users cannot trigger navigation without using full-row enter behaviour (which OTable may or may not support).

## Recommendations

In rough priority order:

1. **Fix C1**: change `:horizontal="true"` → `:horizontal="false"` (or remove the prop, since the default is `false`) on the two OSplitter usages (`AppSessions.vue:63-68`, `SessionsList.vue:20-25`). Verify the field sidebar lands on the left.
2. **Fix C2**: replace `tw:flex` with `tw:flex tw:flex-col` on the SessionViewer root wrapper (`SessionViewer.vue:18`). The header (line 19) and the player block (line 72) must stack vertically.
3. **Fix C3/C4**: put the count/label back into the OBadge default slot in both `FrustrationBadge.vue` and `FrustrationEventBadge.vue`. Remove unused `OTooltip` imports — or, if tooltips are still desired, wrap the badge in `<OTooltip :content="tooltipText"><OBadge>...</OBadge></OTooltip>`.
4. **Fix C5**: bind `OSelect` v-model to a primitive (`playerState.speed.value`) instead of the option object, and update `setSpeed` accordingly. Keep `speedOptions` as is.
5. **Clean up Quasar utility classes** in `SearchBar.vue` (`float-right`, `float-left`, `col-auto`), `AppSessions.vue` (`align-center`), `SessionViewer.vue` (`full-height`, `qp-2`), `VideoPlayer.vue` (`full-height`, `relative-position`, `bg-primary`, `bg-red-5`, `bg-secondary`), `PlayerEventsSidebar.vue` (`relative-position`, `bg-red-3`), and `EventDetailDrawerContent.vue` (`col-auto`).
6. **Remove or rewrite the orphaned `.q-…` SCSS blocks** in `AppSessions.vue:755-826`, `SessionsList.vue:149-191`, `VideoPlayer.vue:619-632`, `SearchBar.vue:343-468`, `PlayerEventsSidebar.vue:275-286`. Where the styling was load-bearing (e.g. the speed selector's compact height), reintroduce it against the O* component DOM via `:deep()`.
7. **Decide on `SessionsList.vue` + `SearchBar.vue`** — they're unreachable from the router; either wire them in or delete them along with their spec files.
8. **Verify M9** (`formatDate` token compatibility) and **M10** (icon name `"label"`) with a quick visual smoke test.
9. **Spec rewrite pass** (Test File Issues section). At minimum, change `installQuasar()` to mount the global O* registration helper and replace `q-*` stubs/queries. Tests for the dead `AppTable`/`FieldList` should be removed or rewritten against `OTable`/`SearchFieldList`.
10. **Accessibility pass** on SessionViewer, VideoPlayer, PlayerEventsSidebar — convert clickable `<div>`s to buttons / focusable elements with `aria-label`s.

## Class-Level Styling Audit

### 1. Quasar Class Leftovers
| File:Line | Class | Replacement | Layer |
| --- | --- | --- | --- |
| `SearchBar.vue:20,27,30,38,51` | `float-right`, `float-left`, `col-auto` | `tw:float-right`, `tw:float-left`, `tw:flex-none` | File |
| `SearchBar.vue:348-453` | `.q-toggle__inner`, `.q-toggle__label`, `.q-field`, `.q-btn-group`, `.q-btn`, `.q-btn-dropdown__arrow-container`, `.q-btn__content` (scoped) | Remove — O* equivalents do not emit these | File |
| `SessionsList.vue:21` | `full-height` | `tw:h-full` | File |
| `SessionsList.vue:152-188` | `.q-field__native`, `.q-field__input`, `.q-table__top`, `.q-table__control`, `.q-field__control-container` (scoped) | Remove — dead orphan | File |
| `AppSessions.vue:23,26` | `align-center` | `tw:items-center` | File |
| `AppSessions.vue:758-807` | `.q-field__native`, `.q-field__input`, `.q-table__top`, `.q-table__control`, `.q-field__control-container`, `.q-btn__content` (scoped) | Remove | File |
| `SessionViewer.vue:75` | `full-height` | `tw:h-full` | File |
| `VideoPlayer.vue:18` | `full-height` | `tw:h-full` | File |
| `VideoPlayer.vue:48` | `relative-position` | `tw:relative` | File |
| `VideoPlayer.vue:52,62` | `bg-primary` | `tw:bg-[var(--o2-primary)]` | File |
| `VideoPlayer.vue:621-627` | `.q-field__control`, `.q-field__marginal`, `.q-field__native` (scoped) | Remove — `OSelect` does not emit `.q-field*` | File |
| `PlayerEventsSidebar.vue:18,61` | `relative-position` | `tw:relative` | File |
| `PlayerEventsSidebar.vue:90` | `bg-red-3` | `tw:bg-red-300` | File |
| `PlayerEventsSidebar.vue:276-277` | `.q-field__control`, `.q-field__native` (scoped) | Remove | File |
| `EventDetailDrawerContent.vue:58` | `col-auto` | `tw:flex-none` | File |

### 2. Tailwind v4 Misuse
| File:Line | Wrong | Right | Layer |
| --- | --- | --- | --- |
| `AppSessions.vue:120` | `hover:tw:text-[var(--o2-primary-btn-bg)]` | `tw:hover:text-[var(--o2-primary-btn-bg)]` | File |
| `SessionViewer.vue:22` | `hover:tw:text-[var(--o2-primary-btn-bg)]` | `tw:hover:text-[var(--o2-primary-btn-bg)]` | File |
| `SessionsList.vue:44` | `hover:tw:text-[var(--o2-primary-btn-bg)]` | `tw:hover:text-[var(--o2-primary-btn-bg)]` | File |
| `VideoPlayer.vue:100,110,116` | `hover:tw:text-[var(--o2-primary-btn-bg)]` (×3) | `tw:hover:text-[var(--o2-primary-btn-bg)]` | File |
| `EventDetailDrawerContent.vue:303` | `hover:tw:bg-[#e0e0e0]` | `tw:hover:bg-[#e0e0e0]` | File |

### 3. Quasar CSS Variables
| File:Line | Variable | Replacement | Layer |
| --- | --- | --- | --- |
| `AppSessions.vue:821` | `var(--q-primary)` | `var(--o2-primary)` | File |

### 4. Dead `:deep(.q-*)` / `body.body--dark` / `::v-deep`
| File:Line | Selector | Action | Layer |
| --- | --- | --- | --- |
| `AppSessions.vue:758-807` | scoped `.q-field*`, `.q-table*`, `.q-btn__content` block | Remove | File |
| `SessionsList.vue:152-188` | scoped `.q-field*`, `.q-table*` block (orphan file) | Remove | File |
| `SearchBar.vue:348-453` | scoped `.q-toggle*`, `.q-field`, `.q-btn-group`, `.q-btn`, `.q-btn-dropdown__arrow-container` block | Remove (only imported by dead `SessionsList`) | File |
| `VideoPlayer.vue:621-627` | scoped `.q-field*` block | Remove | File |
| `PlayerEventsSidebar.vue:276-277` | scoped `.q-field*` block | Remove | File |

### 5. Quasar SCSS Variables in Scoped Styles
| File:Line | Variable | Replacement | Layer |
| --- | --- | --- | --- |
| `SearchBar.vue:384` | `$dark-page` | `var(--o2-bg-primary)` | File |
| `SearchBar.vue:410` | `$dark-page` | `var(--o2-bg-primary)` | File |
| `SearchBar.vue:454` | `$secondary` | `var(--o2-secondary)` | File |
| `SessionLocationColumn.vue:60` | `$info` | `var(--o2-info)` | File |

### 6. Quasar Directives
| File:Line | Directive | Action |
| --- | --- | --- |
| *(none found)* | | |

### 7. Icon Migration
| File:Line | Issue | Fix |
| --- | --- | --- |
| *(no underscored OIcon names or `:color` props in source)* | | |
| `FrustrationBadge.vue` / `FrustrationEventBadge.vue` (general) | `:label` prop dropped during migration — slot is empty | Place `{{ count }}` / `{{ getBadgeLabel(type) }}` in default slot |

### 8. Inline `style=` Hot Spots
| File:Line | Inline style | Suggested home |
| --- | --- | --- |
| `SessionViewer.vue:58,63` | `color: #fb923c` (×2) | Move to scoped `.frustration-marker` rule or use `tw:text-orange-400` |

### 9. Duplicate Style Blocks
| Files | Duplicated block | Suggested partial |
| --- | --- | --- |
| `AppSessions.vue:758-807` + `SessionsList.vue:152-188` | Dead `.q-field*`/`.q-table*` scoped block | Delete both (SessionsList is dead) |
| `VideoPlayer.vue:621-627` + `PlayerEventsSidebar.vue:276-277` | Dead `.q-field*` scoped block | Delete both |
| `SearchBar.vue:348-453` (~5 sub-blocks) | Quasar toggle/btn-group/btn scoped block | Delete entire block — SearchBar only used by dead `SessionsList` |
| Multiple files (RUM) | `tw:cursor-pointer hover:tw:text-[var(--o2-primary-btn-bg)]` icon-hover pattern | Extract to a `.session-action-icon` utility class in `_rum-sessions.scss` |

### 10. Layer Summary
- Global (`app.scss` / `_variables.scss`) changes needed: **0**
- Component-level partial changes: **1** (extract a `.session-action-icon` hover utility into `web/src/styles/_rum-sessions.scss` to dedupe `hover:tw:text-…` rules across SessionViewer/SessionsList/AppSessions/VideoPlayer)
- File-level scoped changes: **15** (delete dead `.q-*` scoped blocks in AppSessions/SessionsList/SearchBar/VideoPlayer/PlayerEventsSidebar; flip `hover:tw:` → `tw:hover:` in 5+ files; replace `$dark-page`/`$secondary`/`$info` SCSS vars; replace `var(--q-primary)` with `var(--o2-primary)`; convert `float-*`, `align-center`, `full-height`, `relative-position`, `col-auto`, `bg-primary`, `bg-red-3` to `tw:*` equivalents)
