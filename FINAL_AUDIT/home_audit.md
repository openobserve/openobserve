# Home Page — Quasar Removal Audit

## Summary

Audit scope covers the Home landing page, the AI chat sidebar, and the chat-history sidebar after the Quasar→O* migration. Routes touched: `/home` (HomeView with three tabs: AI Assistant, Overview, Usage). Components in scope:

- `web/src/views/HomeView.vue` — Home shell + tab bar (drag-reorder).
- `web/src/views/HomeChatHistory.vue` — Left-rail history list inside the AI tab.
- `web/src/components/O2AIChat.vue` — Main AI chat surface (911 lines changed). This is by far the biggest area of risk.
- `web/src/components/O2AIConfirmDialog.vue` — In-line confirmation dialog (2-line diff per `1c38131b25`).
- `web/src/components/shared/HomeViewSkeleton.vue` — Loading skeleton rendered before data arrives.
- Unit tests for the above.

There is **no `web/src/components/home/` directory** in the worktree (it does not exist on `main` either) — the audit scope item is moot.

Overall the migration is mostly mechanical (q-* → O*, `$q.notify` → `toast`, `useQuasar` → `useConfirmDialog`/`useToast`). The script side is clean, but the template/style side has several real bugs that will surface at runtime:

- An orphaned `<OTooltip>` left behind by the `<q-icon>` → `<OIcon />` self-close that will throw a render-time `TypeError` on every tool-call block that does not have a `navigationAction`.
- `OIcon` does not accept a `color` prop, so every status icon in the chat (success/warning/error/positive/negative) renders in the default color — semantic color information is lost.
- An icon name (`radio-button-unchecked`) is used but is not registered in `OIcon.icons.ts` — the "Auto Navigation" toggle has no icon in its default (off) state.
- All three Home-related spec files import `{ installQuasar }` from a helper that no longer exports it — every Home unit test will throw at import time.
- The loading skeleton (`HomeViewSkeleton.vue`) still uses bare `.column` / `.row` / `text-title` Quasar utility classes that no longer have any CSS behind them — the skeleton layout is partially flattened.
- ~25 references to undefined Quasar CSS variables (`--q-page-background`, `--q-primary-text`, `--q-hover-color`, `--q-primary-rgb`, `--q-negative`, `--q-negative-rgb`, `--q-dark`, `--q-separator-color`) remain in `O2AIChat.vue`'s style block. None of these are defined in `web/src/styles/_variables.scss` — only `--q-primary` survives. Colors and backgrounds in the chat header/footer/clear-all button silently fall back to `unset`.

## Files Audited

| Path | Diff stat | Notes |
|---|---|---|
| `/Users/ktx/Documents/Projects/openobserve.worktrees/ux-revamp/web/src/views/HomeView.vue` | +37 / -27 | `q-page` → `div`, `q-icon` → `OIcon`, `.q-separator` selector → `[role="separator"]`. Cosmetic. |
| `/Users/ktx/Documents/Projects/openobserve.worktrees/ux-revamp/web/src/views/HomeChatHistory.vue` | +10 / -10 | `useQuasar` → `useConfirmDialog`. Clean. |
| `/Users/ktx/Documents/Projects/openobserve.worktrees/ux-revamp/web/src/components/O2AIChat.vue` | +461 / -450 | Major rewrite. **Multiple bugs — see below.** |
| `/Users/ktx/Documents/Projects/openobserve.worktrees/ux-revamp/web/src/components/O2AIConfirmDialog.vue` | +2 / -1 | One icon swap. Clean. |
| `/Users/ktx/Documents/Projects/openobserve.worktrees/ux-revamp/web/src/components/shared/HomeViewSkeleton.vue` | +189 / -139 | Layout rewrite. **Lost `.column` flex behavior.** |
| `/Users/ktx/Documents/Projects/openobserve.worktrees/ux-revamp/web/src/test/unit/HomeView.spec.ts` | +4 / -8 | Now imports a function that is no longer exported. |
| `/Users/ktx/Documents/Projects/openobserve.worktrees/ux-revamp/web/src/components/O2AIChat.spec.js` | +1 / -2 | Imports `installQuasar`; helper no longer exports it. |
| `/Users/ktx/Documents/Projects/openobserve.worktrees/ux-revamp/web/src/components/O2AIChat.spec.ts` | +274 / -1 | Adds stubs for ODialog/ODrawer/etc. Still imports `installQuasar`. |
| `/Users/ktx/Documents/Projects/openobserve.worktrees/ux-revamp/web/src/components/shared/HomeViewSkeleton.spec.ts` | unchanged | Still calls `installQuasar()` from a helper that no longer exports it. |

## Critical Issues

### C1. Render-time TypeError on every tool call without a navigation action
**File:** `/Users/ktx/Documents/Projects/openobserve.worktrees/ux-revamp/web/src/components/O2AIChat.vue`
**Lines:** 426–437

In `main`, `<q-tooltip>` was a **child** of `<q-icon>` with `v-if="block.navigationAction && !block.pendingConfirmation"` on the parent, so when `navigationAction` was undefined the tooltip was never rendered.

In `HEAD` the `<q-icon>` migrated to `<OIcon />` and was self-closed at line 436, but the old child `<q-tooltip>{{ block.navigationAction.label }}</q-tooltip>` was converted to `<OTooltip :content="block.navigationAction.label" />` and **left as an orphan sibling** with no `v-if`:

```vue
<OIcon
  v-if="block.navigationAction && !block.pendingConfirmation"
  name="open-in-new"
  ...
 />
  <OTooltip :content="block.navigationAction.label" />   <-- no v-if, throws when navigationAction is undefined
<OIcon
  v-if="hasToolCallDetails(block) && !block.pendingConfirmation"
  ...
/>
```

Result: every tool-call block in the v-for loop that does not have a `navigationAction` will hit `block.navigationAction.label` → `TypeError: cannot read properties of undefined`. Because OTooltip in "child mode" attaches to its parent element, the tooltip would also bind to the entire `<div class="tool-call-header">` instead of the icon — wrong target even when it renders.

**Fix:** wrap in `<template v-if="block.navigationAction && !block.pendingConfirmation">` (or use the default-slot wrapper form of OTooltip with the icon as the trigger).

**Solution:**
```diff
- <OIcon
-   v-if="block.navigationAction && !block.pendingConfirmation"
-   name="open-in-new"
-   ...
-  />
-   <OTooltip :content="block.navigationAction.label" />
+ <template v-if="block.navigationAction && !block.pendingConfirmation">
+   <OIcon name="open-in-new" ... >
+     <OTooltip :content="block.navigationAction.label" />
+   </OIcon>
+ </template>
```

### C2. `installQuasar` no longer exported — every Home unit test fails at import
**Files:**
- `/Users/ktx/Documents/Projects/openobserve.worktrees/ux-revamp/web/src/test/unit/HomeView.spec.ts:18`
- `/Users/ktx/Documents/Projects/openobserve.worktrees/ux-revamp/web/src/components/O2AIChat.spec.ts:19`
- `/Users/ktx/Documents/Projects/openobserve.worktrees/ux-revamp/web/src/components/O2AIChat.spec.js:6`
- `/Users/ktx/Documents/Projects/openobserve.worktrees/ux-revamp/web/src/components/shared/HomeViewSkeleton.spec.ts:19`

The helper `web/src/test/unit/helpers/install-quasar-plugin.ts` only exports `tempQuasarPlugin()` now (file comment explicitly says `// TODO: REMOVE THIS FILE when unit tests are rewritten`). All four spec files import `{ installQuasar }` (a named import that resolves to `undefined`) and then call `installQuasar()` at module scope — that throws a `TypeError: installQuasar is not a function` at test collection time. Every Home spec file is broken.

**Solution:**
```diff
- import { installQuasar } from "@/test/unit/helpers/install-quasar-plugin";
- installQuasar();
+ // Either drop entirely, or re-export `installQuasar` as an alias in
+ // install-quasar-plugin.ts:  export const installQuasar = tempQuasarPlugin;
```

### C3. `OIcon` does not accept a `color` prop — semantic colors silently dropped
**File:** `/Users/ktx/Documents/Projects/openobserve.worktrees/ux-revamp/web/src/components/O2AIChat.vue`
**Lines:** 397–417, 884, 930

The diff carried over Quasar's `:color="primary|warning|negative|positive"` bindings on `<OIcon>`, but the `OIcon` component (`/Users/ktx/Documents/Projects/openobserve.worktrees/ux-revamp/web/src/lib/core/Icon/OIcon.vue`) only accepts `name`, `size`, and `label` — `color` is ignored. So the tool-call header icon that should be green for success / yellow for pending-confirm / red for failure now renders in the default text color regardless of state. Users cannot visually distinguish a successful tool call from a failed one in the chat. Same impact for `name="description"` (line 884) and `name="warning"` (line 930).

**Fix:** swap the `:color` binding for a Tailwind text-color class on `<OIcon>` or wrap in a status-colored span.

**Solution:**
```diff
- <OIcon :color="block.success ? 'positive' : block.warning ? 'warning' : 'negative'" name="..." />
+ <OIcon
+   :class="block.success ? 'tw:text-green-500' : block.warning ? 'tw:text-yellow-500' : 'tw:text-red-500'"
+   name="..."
+ />
```

### C4. `radio-button-unchecked` icon is not in the OIcon registry
**File:** `/Users/ktx/Documents/Projects/openobserve.worktrees/ux-revamp/web/src/components/O2AIChat.vue`
**Lines:** 1334–1338

The "Auto Navigation" toggle uses `:name="isAutoNavigationEnabled ? 'check-circle' : 'radio-button-unchecked'"`. Grep of `/Users/ktx/Documents/Projects/openobserve.worktrees/ux-revamp/web/src/lib/core/Icon/OIcon.icons.ts` confirms `radio-button-unchecked` is not registered. `OIcon` does `<component :is="iconRegistry[name]">` — when the name is missing, the `<component>` `:is` resolves to `undefined`, and Vue renders nothing (and may warn). The default state of the toggle (off) shows no icon, only the "Auto Navigation" label.

**Solution:**
```diff
// web/src/lib/core/Icon/OIcon.icons.ts
+ import RadioButtonUnchecked from "~icons/material-symbols/radio-button-unchecked";
  // and in the iconRegistry map:
+   "radio-button-unchecked": RadioButtonUnchecked,
```

## Logical Issues

### L1. "Clear all conversations" button no longer closes the dropdown menu
**File:** `/Users/ktx/Documents/Projects/openobserve.worktrees/ux-revamp/web/src/components/O2AIChat.vue`
**Line:** 121

Previously: `@click.stop="clearAllConversations; titleMenuOpen = false;"` (compound statement that also closed the menu). The migration replaced this with `@click.stop="clearAllConversations"` and removed `titleMenuOpen` entirely. The confirmation dialog now appears, but the chat history dropdown menu stays open behind it until the user manually clicks away. Reka-ui's DropdownMenu only auto-closes via `@select` on `DropdownMenuItem`; the clear-all button is plain `OButton`, so nothing closes the menu. The same regression applies to the title (chat-name) being clicked on a list item — previously `titleMenuOpen = false` was added explicitly to `@click`; now relies on `ODropdownItem`'s `@select`, which should still close it via reka-ui semantics, so the loadChat path is fine, but the clear-all path is not.

**Solution:**
```diff
- <ODropdown @update:open="(v) => v && loadHistory()">
+ <ODropdown v-model:open="titleMenuOpen" @update:open="(v) => v && loadHistory()">
   ...
-  <OButton @click.stop="clearAllConversations" ...>
+  <OButton @click.stop="() => { clearAllConversations(); titleMenuOpen = false; }" ...>
```

### L2. Delete-chat button inside `ODropdownItem` may also trigger select
**File:** `/Users/ktx/Documents/Projects/openobserve.worktrees/ux-revamp/web/src/components/O2AIChat.vue`
**Lines:** 76–103

The delete button (line 93–101) sits inside `<ODropdownItem @select="loadChat(chat.id)">` (line 80). It uses `@click.stop="deleteChat(chat.id)"`. Reka-ui's `DropdownMenuItem` emits `@select` from a `pointerup`/`keydown` handler that does not always bubble through a DOM `click` (Reka uses a `defaultOpen`/`pointer` model). The `.stop` modifier prevents DOM `click` bubbling but does **not** prevent Reka's `@select` from firing, because Reka listens on the item root, not on the inner button. In practice clicking "delete" inside an item often both deletes the chat **and** loads the deleted (or another) chat, leaving the chat panel in an inconsistent state. Worth testing manually.

**Fix:** call `e.preventDefault()` on the inner pointerdown, or move the delete control outside the `DropdownMenuItem`, or use `@select.prevent` on the parent when the click target is the delete button.

**Solution:**
```diff
- <ODropdownItem @select="loadChat(chat.id)">
+ <ODropdownItem @select="(e) => deletingId === chat.id ? e.preventDefault() : loadChat(chat.id)">
     ...
-    <OButton @click.stop="deleteChat(chat.id)">
+    <OButton @pointerdown.stop.prevent @click.stop="deleteChat(chat.id)">
```

### L3. `toggleExpand` flow change is intentional but breaks the existing icon meaning
**File:** `/Users/ktx/Documents/Projects/openobserve.worktrees/ux-revamp/web/src/components/O2AIChat.vue`
**Lines:** 3431–3444

`toggleExpand` was rewritten to cycle through three states: `(closed → open inline sidebar → expanded overlay → inline sidebar)`. The icon binding at line 153–160 only switches on `store.state.isAiChatExpanded`, so when the chat is closed entirely, the icon shows `open-in-full` even though the click action will *open* the panel (not expand it). The keyboard shortcut tooltip text (Collapse/Expand) is also wrong in the closed state. Functional but UX-confusing.

**Solution:**
```diff
- :name="store.state.isAiChatExpanded ? 'close-fullscreen' : 'open-in-full'"
+ :name="!store.state.isAiChatOpen ? 'chat' : store.state.isAiChatExpanded ? 'close-fullscreen' : 'open-in-full'"
- :content="store.state.isAiChatExpanded ? t('chat.collapse') : t('chat.expand')"
+ :content="!store.state.isAiChatOpen ? t('chat.open') : store.state.isAiChatExpanded ? t('chat.collapse') : t('chat.expand')"
```

### L4. Mock of `quasar` package in spec file is now dead code (low priority)
**File:** `/Users/ktx/Documents/Projects/openobserve.worktrees/ux-revamp/web/src/components/O2AIChat.spec.ts`
**Lines:** 84–88

`vi.mock("quasar", ...)` mocks `useQuasar` — the source no longer imports anything from `"quasar"` (verified by grep). The mock is inert but should be removed for clarity.

**Solution:**
```diff
- vi.mock("quasar", async () => {
-   const actual = await vi.importActual("quasar");
-   return { ...actual, useQuasar: () => ({ notify: vi.fn() }) };
- });
```

## CSS / Layout Issues

### S1. Undefined Quasar CSS variables — colors silently drop to `unset`
**File:** `/Users/ktx/Documents/Projects/openobserve.worktrees/ux-revamp/web/src/components/O2AIChat.vue`

Style block references:
- `var(--q-primary-text)` at lines 5675, 5720, 6265
- `var(--q-page-background)` at lines 5697, 6489, 6516
- `var(--q-hover-color)` at line 5716
- `var(--q-primary-rgb)` at lines 5808, 5809, 5901, 6207
- `var(--q-negative)` at line 6523
- `var(--q-negative-rgb)` at line 6527
- `var(--q-dark)` at line 6426
- `var(--q-separator-color)` (none directly, but `[role="separator"]` selector was previously paired with it)

Of these, **only `--q-primary` is defined** in `/Users/ktx/Documents/Projects/openobserve.worktrees/ux-revamp/web/src/styles/_variables.scss` (lines 366, 517, 550). The rest resolve to `initial` → chat header / footer / clear-all button lose their intended backgrounds and colors. Most fall back to transparent or inherited, so the chat will look "skinnier than expected" and feedback button hover states won't show.

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

### S2. Bare `.column` / `.row` / `.text-title` Quasar utility classes in the loading skeleton
**File:** `/Users/ktx/Documents/Projects/openobserve.worktrees/ux-revamp/web/src/components/shared/HomeViewSkeleton.vue`
**Lines:** 28, 36, 60, 67, 85, 92, 128, 138, 180, 190

The diff replaced most `row` usages with `tw:flex tw:justify-between tw:items-center`, but **left `column` everywhere unchanged** (e.g. line 28: `class="tile-content tw:rounded tw:text-center column tw:justify-between"`). Quasar's CSS that provided `.column { display: flex; flex-direction: column; }` is gone. There is no global `.column` rule in `web/src/styles/`. The "tile-content", "functions-dashboards-column inner", and "stats column" sub-blocks lose vertical flex stacking. While the parent `.functions-dashboards-column` is fine (defined locally), the inner skeletons collapse to block flow.

`.text-title` is defined locally (line 340) so that one is OK.

**Solution:**
```diff
- class="tile-content tw:rounded tw:text-center column tw:justify-between"
+ class="tile-content tw:rounded tw:text-center tw:flex tw:flex-col tw:justify-between"
```

### S3. `.q-card__section` selector is dead
**File:** `/Users/ktx/Documents/Projects/openobserve.worktrees/ux-revamp/web/src/components/O2AIChat.vue`
**Line:** 6428

The CSS still has a `.q-card__section { ... }` rule scoped under `.image-preview-dialog`. The migration replaced `q-card` with `ODialog`, so this selector never matches. Dead code — remove it.

**Solution:**
```diff
- .image-preview-dialog {
-   .q-card__section { padding: 0; }
- }
```

### S4. `.OIcon` selector typo (PascalCase as a class)
**File:** `/Users/ktx/Documents/Projects/openobserve.worktrees/ux-revamp/web/src/components/O2AIChat.vue`
**Line:** 6583

CSS rule:
```scss
.OIcon { font-size: 18px; animation: bounce 2s infinite; font-weight: bold; }
```
This is a direct mechanical rename from `.q-icon { ... }`. `.OIcon` is **not** a class that the component emits — `OIcon` renders `<span class="tw:inline-flex tw:shrink-0 tw:items-center tw:justify-center tw:align-middle …">` and never has a class named `OIcon`. The bounce animation that this rule was driving (likely an empty-state attention nudge) is dead.

**Solution:**
```diff
- .OIcon { font-size: 18px; animation: bounce 2s infinite; font-weight: bold; }
+ /* Apply animation via a wrapping class on the parent element instead:
+    <OIcon class="bouncing-icon" /> + .bouncing-icon { animation: bounce 2s infinite; } */
```

### S5. `--color-tabs-bar-border` / `--color-tabs-*` variables in HomeView are not vetted
**File:** `/Users/ktx/Documents/Projects/openobserve.worktrees/ux-revamp/web/src/views/HomeView.vue`
**Lines:** 255–314

The tab bar styles depend on `--color-tabs-bar-border`, `--color-tabs-inactive-text`, `--color-tabs-hover-text`, `--color-tabs-hover-bg`, `--color-tabs-active-text`, `--color-tabs-indicator`, `--color-tabs-active-bg`. These are not part of this diff (out of audit scope to verify defs) but worth confirming they exist in the active design-token set; otherwise the home tabs will be invisible/borderless.

**Solution:**
```diff
+ // Verify via:  grep -rn "color-tabs-" web/src/lib/styles/tokens/
+ // If missing, add to lib/styles/tokens/component.css under @theme inline:
+   --color-tabs-bar-border: var(--o2-border-color);
+   --color-tabs-active-text: var(--o2-primary);
+   /* ... etc for all 7 vars */
```

## Component Migration Issues

### M1. `OTooltip` placed as sibling rather than child of `OIcon` (broad pattern)
Multiple `<OIcon ... /> <OTooltip ... />` pairs throughout `O2AIChat.vue` (lines 99–100, 141–142, 437, 549–550, 646–647, 670–671, 693–694, 820–821, 862–863, 911–912, 1050, 1106–1107, 1119–1120, 1212–1213, 1287, 1322, 1352).

Where the OTooltip sits *inside* an `<OButton>`, this works (the tooltip uses its anchor span to attach to the OButton root) — so the buttons' tooltips will show on the button surface, which is correct.

Where the OTooltip sits next to a *bare* `<OIcon />` (lines 437, 1050, 1287), the tooltip attaches to the **container parent**, not the icon, so hover anywhere on that parent triggers it. Most of these are OK because the icon is the only child of a small container — but C1 above is the one place where it is also gated by a v-if that no longer applies.

**Solution:**
```diff
- <OIcon name="info" />
- <OTooltip content="Helpful info" />
+ <OIcon name="info">
+   <OTooltip content="Helpful info" />
+ </OIcon>
```

### M2. `<OIcon />` inside an `<OButton>` no longer auto-binds the `aria-label` from a tooltip
Most icon-only buttons in `O2AIChat.vue` use `<OIcon> + <OTooltip content="…" />` to convey label. With Quasar, `q-btn` would set `aria-label` from the `q-tooltip` content. With OButton/OTooltip there is no such auto-coupling. Buttons like "Edit title", "Add new chat", "Close", "Stop", and the thumbs-up/thumbs-down feedback buttons (lines 144, 165, 1095–1121, 1377–1383) have no `aria-label`, `title`, or text content. Accessibility regression.

**Solution:**
```diff
- <OButton @click="editTitle">
+ <OButton :aria-label="t('chat.editTitle')" @click="editTitle">
    <OIcon name="edit" />
    <OTooltip :content="t('chat.editTitle')" />
  </OButton>
```

### M3. `HomeChatHistory.vue` icon-only `OButton`s rely on `:title` rather than `aria-label`
**File:** `/Users/ktx/Documents/Projects/openobserve.worktrees/ux-revamp/web/src/views/HomeChatHistory.vue`
**Lines:** 101–106, 146–151, 182–186

The "New chat" and "Delete chat" buttons set `:title="t('chatHistory.newChat')"` and `:title="t('chatHistory.delete')"` — this is a native HTML `title` attribute (browser tooltip), works for accessibility *some* of the time. The "Clear search" button (line 146) has neither `title` nor `aria-label`. Minor a11y nit.

**Solution:**
```diff
- <OButton :title="t('chatHistory.newChat')" @click="newChat">
+ <OButton :aria-label="t('chatHistory.newChat')" :title="t('chatHistory.newChat')" @click="newChat">
- <OButton @click="clearSearch">  <!-- line 146 -->
+ <OButton :aria-label="t('chatHistory.clearSearch')" @click="clearSearch">
```

### M4. `ODropdown` open state no longer two-way bound
**File:** `/Users/ktx/Documents/Projects/openobserve.worktrees/ux-revamp/web/src/components/O2AIChat.vue`
**Line:** 26

Previously `<ODropdown v-model:open="titleMenuOpen" @update:open="(v) => v && loadHistory()">` — the parent could close the menu by setting `titleMenuOpen = false`. Now it's `<ODropdown @update:open="(v) => v && loadHistory()">` with no two-way binding. This is intentional (the `titleMenuOpen` ref was removed), but it ties into L1 above: there is no programmatic way for the clear-all click handler to close the menu.

**Solution:**
```diff
- <ODropdown @update:open="(v) => v && loadHistory()">
+ <ODropdown v-model:open="titleMenuOpen" @update:open="(v) => v && loadHistory()">
+ // in setup(): const titleMenuOpen = ref(false);
```

## Test File Issues

### T1. All four Home spec files import a function that no longer exists
See C2 above. **Concrete remediation:** either (a) re-export `installQuasar` from `install-quasar-plugin.ts` as an alias for `tempQuasarPlugin` for transitional compatibility, or (b) rewrite the four spec files to use `tempQuasarPlugin()` (or drop it entirely if no Quasar wiring is needed).

**Solution:**
```diff
// web/src/test/unit/helpers/install-quasar-plugin.ts
  export function tempQuasarPlugin() { /* ... */ }
+ export const installQuasar = tempQuasarPlugin; // transitional alias
```

### T2. `Quasar`/`Notify` no longer importable in `HomeView.spec.ts`
Already corrected in this PR — the old `import { Quasar, Notify } from "quasar"` is gone. But the file now ships the broken `installQuasar` call.

**Solution:** See T1 — re-export `installQuasar` as alias for `tempQuasarPlugin`, or remove the call entirely from `HomeView.spec.ts:18`.

### T3. `O2AIChat.spec.ts` adds extensive ODialog/ODrawer stubs but never actually mounts them
Lines 144–215 of the spec define `ODialog`/`ODrawer` stubs. These never get registered as `global.stubs` because the `installQuasar()` import error throws first. Once T1 is fixed, the stubs should run and the new assertions for "edit title dialog", "history drawer", and "image preview" should be exercised.

**Solution:** No source change required — once T1 is fixed (installQuasar alias added), the stubs registered in `global: { stubs: { ODialog, ODrawer, ... } }` will activate and the new assertions will run as intended.

## Recommendations

Priority order (highest impact first):

1. **Fix C1 immediately** — wrap the orphan `OTooltip` in a `<template v-if>` matching its old parent's condition (or use a default-slot OTooltip with the OIcon as the trigger). This is a Vue render TypeError on the most common chat path.
2. **Fix C2** — re-export `installQuasar` as an alias in `install-quasar-plugin.ts` (one-line change) to un-break the test suite. The TODO at the top of that file suggests test rewrites are queued, but the alias is a safe transitional step.
3. **Fix C3** — add a Tailwind text-color class to status icons in the tool-call header, or extend `OIcon` to accept a `color`/`tone` prop. Without this, success vs. failure of every AI tool call is visually indistinguishable.
4. **Fix C4** — add `radio-button-unchecked` to `OIcon.icons.ts`. Trivial.
5. **Fix S1** — sweep the `O2AIChat.vue` style block and replace `--q-page-background`, `--q-primary-text`, `--q-hover-color`, `--q-primary-rgb`, `--q-negative`, `--q-negative-rgb`, `--q-dark` with the new `--color-*` / `--o2-*` token names. Confirm `--color-separator` is correct (line 5692, 5740, 6492).
6. **Fix S2** — add `tw:flex tw:flex-col` everywhere `class="… column …"` survives in `HomeViewSkeleton.vue` (10+ lines).
7. **Fix L1** — restore menu close on clear-all by adding a model binding or imperative `closeMenu()` call.
8. **Investigate L2** — manually test "delete chat from dropdown" and either prevent the parent select or restructure DOM.
9. **Fix M2 / M3** — add explicit `aria-label` (or `:label` via OIcon) to every icon-only button in the chat header, the chat input row, and the chat-history sidebar. Roughly 12 buttons in `O2AIChat.vue` and 3 in `HomeChatHistory.vue`.
10. **Cleanup S3, S4, L4** — remove dead `.q-card__section` and `.OIcon` selectors and the now-inert `vi.mock("quasar")`.

## Class-Level Styling Audit

### 1. Quasar Class Leftovers
| File:Line | Class | Replacement | Layer |
|---|---|---|---|
| HomeViewSkeleton.vue:28 | `column` (bare) | `tw:flex tw:flex-col` | file-scoped |
| HomeViewSkeleton.vue:36 | `column` | `tw:flex tw:flex-col` | file-scoped |
| HomeViewSkeleton.vue:60 | `column` | `tw:flex tw:flex-col` | file-scoped |
| HomeViewSkeleton.vue:67 | `column` | `tw:flex tw:flex-col` | file-scoped |
| HomeViewSkeleton.vue:85 | `column` | `tw:flex tw:flex-col` | file-scoped |
| HomeViewSkeleton.vue:92 | `column` | `tw:flex tw:flex-col` | file-scoped |
| HomeViewSkeleton.vue:128 | `column` | `tw:flex tw:flex-col` | file-scoped |
| HomeViewSkeleton.vue:138 | `column` | `tw:flex tw:flex-col` | file-scoped |
| HomeViewSkeleton.vue:180 | `column` | `tw:flex tw:flex-col` | file-scoped |
| HomeViewSkeleton.vue:190 | `column` | `tw:flex tw:flex-col` | file-scoped |
| O2AIChat.vue:6428 | `.q-card__section` | remove (dead selector) | file-scoped |

### 2. Tailwind v4 Misuse
| File:Line | Wrong | Right | Layer |
|---|---|---|---|
| O2AIChat.vue:180 | `hover:tw:bg-muted/50` | `tw:hover:bg-muted/50` | file-scoped |

### 3. Quasar CSS Variables
| File:Line | Variable | Replacement | Layer |
|---|---|---|---|
| O2AIChat.vue:5675 | `var(--q-primary-text)` | `var(--o2-text-primary)` | file-scoped |
| O2AIChat.vue:5697 | `var(--q-page-background)` | `var(--o2-bg-page)` | file-scoped |
| O2AIChat.vue:5716 | `var(--q-hover-color)` | `var(--o2-hover)` | file-scoped |
| O2AIChat.vue:5720 | `var(--q-primary-text)` | `var(--o2-text-primary)` | file-scoped |
| O2AIChat.vue:5808-5809 | `var(--q-primary-rgb)` | `color-mix(in srgb, var(--o2-primary) 5%/10%, transparent)` | file-scoped |
| O2AIChat.vue:5868 | `var(--q-primary)` | `var(--o2-primary)` | file-scoped |
| O2AIChat.vue:5901-5902 | `var(--q-primary-rgb)` / `var(--q-primary)` | `var(--o2-primary)` | file-scoped |
| O2AIChat.vue:5996-6000 | `var(--q-primary)` | `var(--o2-primary)` | file-scoped |
| O2AIChat.vue:6207-6210 | `var(--q-primary-rgb)` / `var(--q-primary)` | `var(--o2-primary)` | file-scoped |
| O2AIChat.vue:6265 | `var(--q-primary-text)` | `var(--o2-text-primary)` | file-scoped |
| O2AIChat.vue:6426 | `var(--q-dark)` | `var(--o2-bg-elevated)` | file-scoped |
| O2AIChat.vue:6465-6470 | `var(--q-primary)` | `var(--o2-primary)` | file-scoped |
| O2AIChat.vue:6489 | `var(--q-page-background)` | `var(--o2-bg-page)` | file-scoped |
| O2AIChat.vue:6516 | `var(--q-page-background)` | `var(--o2-bg-page)` | file-scoped |
| O2AIChat.vue:6523-6527 | `var(--q-negative)` / `var(--q-negative-rgb)` | `var(--o2-danger)` | file-scoped |

### 4. Dead `:deep(.q-*)` / `body.body--dark` / `::v-deep`
| File:Line | Selector | Action | Layer |
|---|---|---|---|
| O2AIChat.vue:6556 | `body.body--dark &` | replace with `html.dark &` | file-scoped |
| O2AIChat.vue:6572 | `body.body--dark &` | replace with `html.dark &` | file-scoped |
| O2AIChat.vue:6428 | `.q-card__section` | remove | file-scoped |

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
| *(none found — icons already use kebab-case and no `:color` prop)* | | |

### 8. Inline `style=` Hot Spots
| File:Line | Inline style | Suggested home |
|---|---|---|
| HomeView.vue:23 | `max-height: calc(100vh - var(--navbar-height) - 18px)` | scoped `.home-tabs-content` class |
| O2AIChat.vue:16 | `:style="{ height: headerHeight... }"` | acceptable (dynamic value) |
| O2AIChat.vue:246 | `max-width: 100%; max-height: 80vh; object-fit: contain` | scoped `.preview-image` class |
| O2AIChat.vue:274 | `:style="centeredStart ? { top:'calc(50% - 150px)' } : {}"` | acceptable (dynamic) |
| O2AIChat.vue:353 | `background-color: transparent` | drop or use `tw:bg-transparent` |
| O2AIChat.vue:1255 | `display: none` | use `tw:hidden` |
| HomeViewSkeleton.vue:4 | `display: flex; flex-direction: column; height: calc(100vh - 52px)` | scoped `.skeleton-root` class |
| HomeViewSkeleton.vue:127 | `gap: 16px` | `tw:gap-4` |
| HomeViewSkeleton.vue:155 | `width: 100%; height: 100%; border-radius: 8px` | scoped utility class |
| HomeViewSkeleton.vue:179 | `gap: 16px` | `tw:gap-4` |
| HomeViewSkeleton.vue:207 | `width: 100%; height: 100%; border-radius: 8px` | scoped utility class |

### 9. Duplicate Style Blocks
| Files | Duplicated block | Suggested partial |
|---|---|---|
| HomeViewSkeleton.vue:28,60,85 | `class="…tw:rounded tw:text-center column tw:justify-between"` x3 | extract `.skeleton-tile` class |
| HomeViewSkeleton.vue:155, 207 | identical `width:100%;height:100%;border-radius:8px` style | extract `.skeleton-chart` partial |

### 10. Layer Summary
- Global (`app.scss`) changes needed: 0
- Component-level partial changes: 2 (`HomeViewSkeleton.vue` skeleton-tile/skeleton-chart extraction)
- File-level scoped changes: ~28 (q-* vars, body.body--dark, bare `column`, hover order, inline styles)
