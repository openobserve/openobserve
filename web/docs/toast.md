# OToast — Implementation Spec

**Branch**: `feat/ux-notify`  
**Replaces**: Quasar `useQuasar().notify()` / `Notify.create()`  
**Headless base**: Reka UI `Toast*` primitives (already confirmed)  
**Location**: `web/src/lib/feedback/Toast/`

---

## Why this work exists

Quasar's `Notify` plugin is the last major blocker to removing `quasar` from `src/services/` and `src/utils/`. It is called in two fundamentally different contexts:

1. **Inside Vue components / composables** — via `useQuasar().notify()`
2. **Outside the Vue tree** — via `Notify.create()` in `main.ts`, `httpsearch.ts`, `http.ts`

The replacement must work in **both** contexts. A standard `provide/inject` composable is not enough; the state store must live at module level.

---

## File Contract

```
web/src/lib/feedback/Toast/
├── useToast.ts               ← Module-level singleton API (works outside Vue)
├── useToast.spec.ts          ← Unit tests for the composable
├── OToastProvider.vue        ← Mounted ONCE near app root — renders viewport + all toasts
├── OToastProvider.types.ts
├── OToastProvider.spec.ts
├── OToast.vue                ← Single toast item (rendered by Provider internally)
├── OToast.types.ts
└── OToast.spec.ts
```

No `index.ts`. Import directly by path.

---

## Reka UI Primitives Used

```ts
import {
  ToastProvider,
  ToastViewport,
  ToastRoot,
  ToastTitle,
  ToastDescription,
  ToastAction,
  ToastClose,
} from "reka-ui"
```

> Reka UI is already in `package.json`. No install needed.

`ToastProvider` manages the ARIA live region and swipe direction.  
`ToastViewport` is the `Teleport` target — rendered inside `OToastProvider`.  
`ToastRoot` is the individual toast shell — maps to `OToast`.  
`ToastTitle` / `ToastDescription` carry the text content.  
`ToastAction` renders an accessible action button inside the toast.  
`ToastClose` renders the × dismiss button.

---

## 1 — `useToast.ts`

### Public API

```ts
// Usage inside a Vue component or composable:
import { useToast } from "@/lib/feedback/Toast/useToast"
const { toast } = useToast()

const dismiss = toast({ variant: "success", message: "Saved!" })
dismiss()                                            // close it
dismiss({ variant: "error", message: "Failed!" })   // close + show a new one

// Usage OUTSIDE the Vue tree (services, main.ts):
import { toast } from "@/lib/feedback/Toast/useToast"
toast({ variant: "error", message: "Network error", position: "bottom-right" })
```

### Module-level store shape

```ts
// Internal — not exported
interface ToastRecord {
  id: string
  variant: ToastVariant
  message: string
  title?: string
  timeout: number        // ms; 0 = persistent
  position: ToastPosition
  open: boolean          // Reka controls enter/exit animation via this
  action?: ToastAction
}

// Module-level — survives outside Vue lifecycle
const toastRecords = reactive<ToastRecord[]>([])
```

### `toast()` return type

```ts
type DismissFn = (replacement?: Pick<ToastOptions, "variant" | "message" | "title">) => void
```

When `replacement` is provided, the function closes the current toast **and** immediately fires a new one.

### `useToast()` return type

```ts
interface UseToastReturn {
  toast: (options: ToastOptions) => DismissFn
  toasts: ToastRecord[]     // readonly reactive — consumed by OToastProvider
}
```

### Default timeout per variant

| variant | default `timeout` |
|---------|-------------------|
| `"success"` | `3000` ms |
| `"error"` | `5000` ms |
| `"warning"` | `4000` ms |
| `"info"` | `4000` ms |
| `"loading"` | `0` (persistent — must be dismissed via `DismissFn`) |
| `"default"` | `3000` ms |

---

## 2 — `OToast.types.ts`

```ts
export type ToastVariant =
  | "success"
  | "error"
  | "warning"
  | "info"
  | "loading"
  | "default"

// Positions mirror Quasar's subset actually used in the codebase
export type ToastPosition =
  | "top-center"
  | "top-right"
  | "top-left"
  | "bottom-center"
  | "bottom-right"   // ← global default
  | "bottom-left"

export interface ToastAction {
  label: string
  handler: () => void
}

export interface ToastOptions {
  /** Visual style + icon set */
  variant?: ToastVariant
  /** Primary message text — plain string only (no HTML) */
  message: string
  /** Optional bold title above message */
  title?: string
  /** Auto-dismiss delay in ms. 0 = persistent. Defaults per variant. */
  timeout?: number
  /** Where the toast appears on screen */
  position?: ToastPosition
  /** Optional action button rendered inside the toast */
  action?: ToastAction
}

export interface ToastProps extends ToastOptions {
  id: string
  open: boolean
}

export interface ToastEmits {
  (e: "openChange", value: boolean): void
}
```

**Key decisions:**

- `html` prop is **dropped** — plain strings only (security). The one `html: true` usage in `main.ts` will be rewritten to use `action: { label: "Refresh", handler: () => window.location.reload() }` with a plain `message`.
- `color` / `textColor` props are **dropped** — baked into `variant`.
- `spinner` prop is **dropped** — replaced by `variant: "loading"` which bakes in the spinner.
- `multiLine` prop is **dropped** — text naturally wraps.
- `classes` prop is **dropped** — the `stale-build-notification` class in `main.ts` is unnecessary after the redesign.
- `progress` prop is **dropped** — a progress bar countdown is not part of the new visual design.

---

## 3 — `OToast.vue` (single item)

Renders one `ToastRoot` using Reka UI. Consumes `ToastProps`.

### Visual structure (per variant)

```
┌──────────────────────────────────────────────────┐
│ [icon]  Title (optional)                   [  ×] │
│         Message text                             │
│         [Action Button] (optional)               │
└──────────────────────────────────────────────────┘
```

### Icons per variant

Use `lucide-vue-next` (already in project — confirmed safe):

| variant | lucide icon |
|---------|-------------|
| `success` | `CheckCircle2` |
| `error` | `XCircle` |
| `warning` | `AlertTriangle` |
| `info` | `Info` |
| `loading` | `Loader2` with `tw:animate-spin` |
| `default` | none |

### Tailwind class map structure

Follow the exact variant class-map pattern used in `OButton.vue`:

```ts
const variantClasses: Record<NonNullable<ToastVariant>, string> = {
  success: [
    "tw:bg-toast-success-bg tw:border tw:border-toast-success-border",
    "tw:text-toast-fg",
  ].join(" "),
  error: [...].join(" "),
  // ...
}

const iconColorClasses: Record<NonNullable<ToastVariant>, string> = {
  success: "tw:text-toast-success-icon",
  error:   "tw:text-toast-error-icon",
  // ...
}
```

### Accessibility requirements

- `ToastRoot` gets `role="status"` for `success` / `info` / `loading`; `role="alert"` for `error` / `warning`
- `ToastTitle` is always present (visually hidden if no `title` prop but `message` is set — assistive tech reads it)
- `ToastClose` has `aria-label="Dismiss notification"`
- Keyboard: `Escape` dismisses the focused toast (Reka handles this)
- Swipe-to-dismiss: `swipeDirection="right"` on `ToastProvider`

---

## 4 — `OToastProvider.vue`

Mounted **once** in `web/src/App.vue` (or the app root layout).

```vue
<template>
  <!-- Reka wraps all toasts with the ARIA live region -->
  <ToastProvider swipe-direction="right" :duration="0">

    <!-- Render one OToast per active record -->
    <OToast
      v-for="t in toasts"
      :key="t.id"
      v-bind="t"
      @open-change="(open) => handleOpenChange(t.id, open)"
    />

    <!-- One viewport per position bucket -->
    <ToastViewport
      v-for="pos in activePositions"
      :key="pos"
      :class="viewportPositionClasses[pos]"
    />

  </ToastProvider>
</template>
```

**Position viewports**: Reka UI uses one `ToastViewport` for all toasts by default. To support multiple positions, render one `ToastViewport` per distinct position group and filter toasts per viewport. Toasts with different positions should render in the correct viewport.

> **Simplification allowed**: For the initial implementation it is acceptable to use a single viewport positioned `bottom-right`. The position mapping can be added in a follow-up once the migration is complete. Document this decision in the PR.

**`handleOpenChange`**: When Reka fires `openChange(false)` (after the exit animation finishes), remove the record from `toastRecords`.

---

## 5 — Design Tokens

### Add to `web/src/lib/styles/tokens/component.css` — inside `:root { }`

```css
/* ── Toast ─────────────────────────────────────────────── */
/* success */
--color-toast-success-bg:     var(--color-success-50);
--color-toast-success-border: var(--color-success-500);
--color-toast-success-icon:   var(--color-success-700);

/* error */
--color-toast-error-bg:       var(--color-error-50);
--color-toast-error-border:   var(--color-error-400);
--color-toast-error-icon:     var(--color-error-600);

/* warning */
--color-toast-warning-bg:     var(--color-warning-50);
--color-toast-warning-border: var(--color-warning-400);
--color-toast-warning-icon:   var(--color-warning-600);

/* info */
--color-toast-info-bg:        var(--color-primary-50);
--color-toast-info-border:    var(--color-primary-300);
--color-toast-info-icon:      var(--color-primary-600);

/* loading / default */
--color-toast-loading-bg:     var(--color-surface-overlay);
--color-toast-loading-border: var(--color-border-default);
--color-toast-loading-icon:   var(--color-primary-600);
--color-toast-default-bg:     var(--color-surface-overlay);
--color-toast-default-border: var(--color-border-default);

/* shared foreground */
--color-toast-fg:             var(--color-text-primary);
--color-toast-fg-secondary:   var(--color-text-secondary);
--color-toast-action-text:    var(--color-primary-600);
--color-toast-action-hover:   var(--color-primary-700);
--shadow-toast:               var(--shadow-lg);
```

Also add the same tokens inside `@theme inline { }` in `component.css` (self-referencing, as all other component tokens do):

```css
--color-toast-success-bg:     var(--color-toast-success-bg);
--color-toast-success-border: var(--color-toast-success-border);
/* ... repeat for every token ... */
```

### Add to `web/src/lib/styles/tokens/dark.css` — inside `.dark { }`

```css
/* ── Toast (dark) ───────────────────────────────────────── */
--color-toast-success-bg:     color-mix(in srgb, var(--color-success-700) 25%, var(--color-grey-900));
--color-toast-success-border: var(--color-success-700);
--color-toast-success-icon:   var(--color-success-500);

--color-toast-error-bg:       color-mix(in srgb, var(--color-error-700) 25%, var(--color-grey-900));
--color-toast-error-border:   var(--color-error-600);
--color-toast-error-icon:     var(--color-error-400);

--color-toast-warning-bg:     color-mix(in srgb, var(--color-warning-700) 20%, var(--color-grey-900));
--color-toast-warning-border: var(--color-warning-500);
--color-toast-warning-icon:   var(--color-warning-400);

--color-toast-info-bg:        color-mix(in srgb, var(--color-primary-800) 40%, var(--color-grey-900));
--color-toast-info-border:    var(--color-primary-700);
--color-toast-info-icon:      var(--color-primary-400);

--color-toast-loading-bg:     var(--color-surface-overlay);
--color-toast-loading-border: var(--color-border-default);
--color-toast-action-text:    var(--color-primary-400);
--color-toast-action-hover:   var(--color-primary-300);
```

---

## 6 — App.vue Change (one line)

```vue
<!-- web/src/App.vue — add near the bottom of the template, before </template> -->
<OToastProvider />

<!-- In <script setup>: -->
import OToastProvider from "@/lib/feedback/Toast/OToastProvider.vue"
```

> `OToastProvider` must be mounted **outside** any conditional rendering (not inside `v-if`). Place it as a sibling of the router view, not nested inside a layout component.

---

## 7 — Migration: Call-Site Patterns

### Pattern A — Simple one-shot toast

```ts
// BEFORE
import { useQuasar } from "quasar"
const $q = useQuasar()
$q.notify({ type: "positive", message: "Saved!" })

// AFTER
import { useToast } from "@/lib/feedback/Toast/useToast"
const { toast } = useToast()
toast({ variant: "success", message: "Saved!" })
```

### Pattern B — Loading spinner + dismiss on complete

```ts
// BEFORE
const dismiss = $q.notify({ spinner: true, message: "Loading...", timeout: 0 })
// ... async work ...
dismiss()
// or:
dismiss({ type: "positive", message: "Done!" })

// AFTER
const dismiss = toast({ variant: "loading", message: "Loading..." })
// ... async work ...
dismiss()
// or:
dismiss({ variant: "success", message: "Done!" })
```

### Pattern C — Static Notify.create() in service files

```ts
// BEFORE  (httpsearch.ts, main.ts, http.ts)
import { Notify } from "quasar"
Notify.create({ type: "negative", message: "Bad Request", position: "bottom-right" })

// AFTER
import { toast } from "@/lib/feedback/Toast/useToast"
toast({ variant: "error", message: "Bad Request", position: "bottom-right" })
```

### Pattern D — main.ts chunk-load error (was using html: true + actions)

```ts
// AFTER — use action prop instead of html: true
toast({
  variant: "error",
  message: i18n.global.t("common.chunkLoadErrorMsg"),
  timeout: 0,
  position: "top-center",
  action: {
    label: i18n.global.t("common.refresh"),
    handler: () => window.location.reload(),
  },
})
```

### Type mapping — Quasar → O2

| Quasar `type` | O2 `variant` |
|---------------|-------------|
| `"positive"` | `"success"` |
| `"negative"` | `"error"` |
| `"warning"` | `"warning"` |
| `"info"` | `"info"` |
| absent | `"default"` |
| `spinner: true` | `"loading"` |

### Position mapping

| Quasar `position` | O2 `position` |
|-------------------|--------------|
| `"top"` | `"top-center"` |
| `"bottom"` | `"bottom-center"` |
| `"bottom-right"` | `"bottom-right"` |
| absent | `"bottom-right"` (global default) |

---

## 8 — Migration Scope (all files that need updating)

### Service / utility files (~6 call sites — do first, unblocks Quasar removal from these modules)

| File | Change |
|------|--------|
| `src/main.ts` | `Notify.create(...)` → `toast(...)` — 1 call site, Pattern D |
| `src/services/httpsearch.ts` | `Notify.create(...)` → `toast(...)` — 4 call sites, Pattern C |
| `src/services/http.ts` | `useQuasar()` → `toast` — check call sites |
| `src/test/__mocks__/http.ts` | Update mock to remove `Notify.create` usage |

### Composables (~4 files)

| File | Notes |
|------|-------|
| `src/composables/useTraces.ts` | Pattern A — 2 call sites |
| `src/composables/useStreams.ts` | Pattern A / B — 2 call sites |
| `src/composables/useActions.ts` | Pattern A |
| `src/composables/useAlertForm.ts` | Pattern A — ~5 call sites |

### Views — high density (~15 files)

> Migrate one file at a time. Each PR should be a complete file migration, not a partial one.

| File | Approx. call sites |
|------|--------------------|
| `src/views/Dashboards/Dashboards.vue` | ~10 |
| `src/views/LogStream.vue` | ~8 |
| `src/views/Ingestion.vue` | ~10 |
| `src/views/RUM/UploadSourceMaps.vue` | ~5 |
| `src/views/RUM/SourceMaps.vue` | ~2 |
| `src/views/RUM/AppSessions.vue` | ~2 |
| `src/views/RUM/AppErrors.vue` | ~1 |
| `src/views/UsageTab.vue` | ~2 |
| `src/views/About.vue` | ~1 |
| `src/views/StreamExplorer.vue` | ~2 |
| `src/views/Login.vue` | ~2 |
| `src/views/PromQL/QueryBuilder.vue` | ~3 |
| `src/views/AwsMarketplaceSetup.vue` | ~2 |
| `src/views/AzureMarketplaceSetup.vue` | ~2 |
| `src/views/AddAlertView.vue` | ~2 |
| `src/views/MemberSubscription.vue` | ~1 |
| `src/views/HomeChatHistory.vue` | uses `useQuasar` — check if `notify` is actually called |

### Plugins (~6 files)

| File | Approx. call sites |
|------|--------------------|
| `src/plugins/traces/Index.vue` | ~2 |
| `src/plugins/traces/TraceDetails.vue` | ~3 |
| `src/plugins/traces/TraceDetailsSidebar.vue` | ~4 |
| `src/plugins/traces/ServiceGraphNodeSidePanel.vue` | ~3 |
| `src/plugins/traces/SearchBar.vue` | ~1 |
| `src/plugins/logs/SearchJobInspector.vue` | ~2 |

### Components (~20+ files)

Run this to get the full list before starting:
```powershell
grep -rl "useQuasar\|Notify\.create" web/src/components web/src/enterprise --include="*.vue" --include="*.ts"
```

### After all call sites are migrated

1. Search for any remaining `import { useQuasar } from "quasar"` where `notify` was the **only** usage — remove the `useQuasar` import entirely.
2. Search for any remaining `import { Notify } from "quasar"` — remove.
3. If `useQuasar` is still needed in a file for non-notify purposes (e.g. `q.dialog`), leave the import and note it for the next Quasar removal sprint.

---

## 9 — eslint.config.js

The Quasar notify API is not a template element, so no `no-restricted-syntax` template rule applies. Instead, add a **no-restricted-imports** entry to prevent future `Notify.create` imports:

```js
// web/eslint.config.js — inside the rules object
"no-restricted-imports": [
  "error",
  {
    paths: [
      // existing entries...
      {
        name: "quasar",
        importNames: ["Notify"],
        message: 'Use toast() from "@/lib/feedback/Toast/useToast" instead of Quasar Notify.',
      },
    ],
  },
],
```

> Do not remove or modify existing entries — append only.

---

## 10 — Tests

### `useToast.spec.ts`

- `toast()` adds a record to `toastRecords`
- `toast()` returns a `DismissFn`
- Calling `DismissFn()` sets `open: false` on the record
- Calling `DismissFn({ variant, message })` fires a new toast
- Default `timeout` is applied correctly per variant
- `timeout: 0` is respected (record stays open)
- Generating multiple toasts produces unique `id` values

### `OToast.spec.ts`

- Renders `message` text
- Renders `title` when provided
- Renders the correct icon per `variant`
- Does not render an icon for `variant="default"`
- `loading` variant renders a spinning icon
- Renders the action button when `action` prop is provided
- Calls `action.handler` when action button is clicked
- Emits `openChange(false)` when close button is clicked
- ARIA: `role="alert"` for `error` / `warning`; `role="status"` for others

### `OToastProvider.spec.ts`

- Renders nothing when `toastRecords` is empty
- Renders one `OToast` per record in `toastRecords`
- Removes a record after `openChange(false)` fires

---

## 11 — Definition of Done

- [ ] `useToast.ts` — module-level singleton, `toast()` function exported directly and via `useToast()`
- [ ] `OToast.vue` — all 6 variants render correctly
- [ ] `OToastProvider.vue` — mounted in `App.vue`, renders active toasts
- [ ] Design tokens added to `component.css` (light) and `dark.css` (dark overrides)
- [ ] All tokens verified visually in browser in **both** light and dark mode — icon colors must be fully visible at rest
- [ ] `eslint.config.js` updated with `no-restricted-imports` for `Notify`
- [ ] All tests pass — `useToast.spec`, `OToast.spec`, `OToastProvider.spec`
- [ ] Service files migrated (`main.ts`, `httpsearch.ts`, `http.ts`) — these files no longer import from `quasar` for notification purposes
- [ ] Composables migrated (`useTraces`, `useStreams`, `useActions`, `useAlertForm`)
- [ ] All remaining `$q.notify` / `q.notify` call sites migrated (views, plugins, components, enterprise)
- [ ] No `import { Notify } from "quasar"` remains in the codebase
- [ ] Files that imported `useQuasar` **only** for `notify` no longer import `useQuasar`

---

## Reference Files

| File | Purpose |
|------|---------|
| `web/src/lib/core/Button/OButton.vue` | Variant class-map pattern to follow |
| `web/src/lib/core/Button/OButton.types.ts` | TypeScript types pattern |
| `web/src/lib/styles/tokens/component.css` | Where to add new tokens |
| `web/src/lib/styles/tokens/dark.css` | Where to add dark overrides |
| `web/src/lib/styles/tailwind.css` | Tailwind entry — `prefix(tw)` defined here |
| `web/src/App.vue` | Where to mount `<OToastProvider />` |
