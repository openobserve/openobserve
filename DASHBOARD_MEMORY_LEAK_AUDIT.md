# Dashboard memory-leak audit

**Date:** 2026-08-31
**Branch:** `fix/dashboard-navigation-memory-leak`
**Tested build:** `main` @ `6b7f9eef57` (includes PR #13970), production bundles
**Backend:** `o2.introspect.internal.zinclabs.dev` (staging), accessed read-only

---

## 1. Executive summary

Navigating the app leaks memory that garbage collection cannot reclaim. There
are **two independent leaks**, not one:

| Leak | Status |
|---|---|
| **A. Route-change leak** — every route change stranded the previous view's component tree | **FIXED** (0 nodes/iteration, was 650) |
| **B. Dashboard-open leak** — opening a dashboard retains 5.71 MB / 2,697 DOM nodes | **NOT FIXED — cause not identified** |

Leak A was a discarded cleanup function: `onMounted(() => { …; return () => cleanup(); })`.
Vue **ignores** the return value of `onMounted` — that is React's `useEffect`
idiom. One orphaned `document` listener per navigation held its component's
setup scope and, through a template ref, the whole detached page tree.

Leak B is separately reproducible, perfectly linear, and **still open**. It is
the one users are reporting.

---

## 2. What is fixed and verified

Measured on production builds, forced GC before every sample.

| Metric | Before | After |
|---|---|---|
| Home ↔ dashboard **list** | 1.12 MB / 650 nodes per iteration | **0.43 MB / 0 nodes** |
| Leaked IntersectionObservers | +3 per dashboard open | **0** |
| Leaked IndexedDB connections | +3 per dashboard open | **0** |
| Leaked `window "load"` listeners | +15 per dashboard open | **0** |

### 2.1 `onMounted` cleanup discarded — `RichTextInput.vue`

`web/src/components/RichTextInput.vue`

```js
onMounted(() => {
  document.addEventListener("click", handleClickOutside);
  return () => { document.removeEventListener("click", handleClickOutside); };  // discarded
});
```

Fixed by hoisting the handler and removing it in its own `onUnmounted`.
This alone took route-change leakage to zero.

### 2.2 `ChartRenderer` IntersectionObserver never disconnected

`web/src/components/dashboards/panels/ChartRenderer.vue`

Both disconnect paths were guarded by `if (chartRef.value)`, but Vue nulls
template refs **before** unmounted hooks run, so the guard never passed. Now
disconnects unconditionally.

### 2.3 `setupPanelObservers` async race

`web/src/views/Dashboards/RenderDashboardCharts.vue`

`disconnect()` → `await nextTick()` → assign meant two concurrent callers both
passed the null check and the second orphaned the first's observer. Disconnect
now happens immediately before reassignment.

### 2.4 IndexedDB connection per transaction

`web/src/composables/dashboard/usePanelCache.ts`

`initDB()` opened a fresh `IDBDatabase` on every read/write and never closed
it (measured 66 opened, 0 closed). Now memoises one connection, with
`onclose`/`onversionchange` invalidation and no caching of a failed open.

### 2.5 `window "load"` listener per call

`web/src/utils/storage.ts`

`useLocalStorage()` added an anonymous `load` listener on each of ~107 call
sites. Since `load` had already fired in an SPA the inner `storage` listener
was usually never registered — pure retention. Replaced with one shared
`storage` listener dispatching through a `Map` keyed by storage key.

> **Behaviour note:** cross-tab `storage` sync was effectively dead and is now
> live. That is the evident original intent, but it is newly-active behaviour.
> Deleting the listener entirely would also fix the leak with no behaviour
> change, if that is preferred.

### 2.6 `AbortError` skipped stream cleanup

`web/src/composables/useStreamingSearch.ts` — the abort path never called
`cleanUpListeners(traceId)`, the un-fixed sibling of what PR #13970 fixed on
the success path. Minor (`TraceRecord: 1 → 0` in the heap), fixed for
correctness.

**Verification:** Prettier, ESLint, `vue-tsc` clean; 353 unit tests passing
across `usePanelCache`, `usePanelDataLoader`, `PanelSchemaRenderer`,
`RenderDashboardCharts`.

---

## 3. Leak B — dashboard open — STILL OPEN

**Reproducible and linear:** 5.71 MB and 2,697 DOM nodes per dashboard open,
identical before and after every fix above. Six opens: 56.4 → 84.9 MB.

### What is known

- The DOM is **detached, not in-document**. In-document element count is
  constant at 2,177 across opens while CDP's node count climbs — so this is
  retention, not nodes accumulating in a container.
- Anchored by **Vue VNodes** (`Object.el` ×46,579, `.anchor` ×10,007), i.e. by
  retained component instances (`.subTree` / `.vnode` ×11,007 after 4 opens).
- ~904 event listeners retained per open, riding on the detached DOM.

### What has been ruled OUT

- Leaked `IntersectionObserver` / `ResizeObserver` / `MutationObserver` — zero
  undisconnected on the dashboard-open path.
- Leaked `window` / `document` listeners — zero growing on that path.
- Uncleared `setInterval` — zero.
- IndexedDB connections — fixed, flat.
- The `traceMap` streaming layer — `TraceRecord: 1 → 0`.
- Portal/teleport accumulation — in-document count is flat.

### Recommended next step

Heap-retainer analysis stalled: the retainer histogram keeps surfacing Vue's own
internals (`system / Context .instance`, `Object .ctx`, `native_bind .i`) that
belong to the dead subtree rather than an external anchor. Correctly separating
"dead tree internals" from "live anchor" needs a full reachability pass from GC
roots excluding the dead set, which the current scripts do not do.

A faster route is **empirical bisection**: open a dashboard with panel content
progressively stubbed (no ECharts, no panel data loader, no variables) and find
which layer's removal makes the 2,697 nodes/open disappear. That converges in a
handful of runs, where heap archaeology has not converged in many.

---

## 4. Third-party leak: `@tanstack/vue-form`

`node_modules/@tanstack/vue-form/dist/esm/useForm.js`

```js
onMounted(formApi.mount);   // FormApi.mount() RETURNS a cleanup fn — discarded
```

The same discarded-cleanup bug as §2.1, upstream. Each form mount leaks 3
`window` listeners (`form-devtools:request-form-state` / `-reset` /
`-force-submit`) plus a store subscription.

Cannot be wrapped from `useOForm` — the library captures `formApi.mount` by
value before the instance is returned. Needs `patch-package` or an upstream PR.

**Impact (nodes per route-change iteration, after §2 fixes):**

| Route pair | Before | After | Remaining cause |
|---|---|---|---|
| home ↔ dashboards | 650 | **0** | — |
| home ↔ streams | 4,701 | 4,051 | `form-devtools` ×3/iter |
| home ↔ logs | 2,088 | 1,438 | `form-devtools` ×3/iter, `cancelQuery` ×1/iter |

Note this makes **streams the worst-affected route in the product**, roughly 6×
the dashboard list. This is not a dashboards-specific problem.

---

## 5. Relationship to PR #13970

All five claims in PR #13970 verified against its diff: cheapest-first
timestamp-alias check, lazy panel mounting, cache restore behind the visibility
gate, `deep: true` watch removed, AbortController released on completion.

Measured before/after on production builds:

| | Pre-#13970 | Current `main` | Change |
|---|---|---|---|
| MB per dashboard open | 10.69 | 5.68 | −47% |
| DOM nodes per open | 8,147 | 2,697 | −67% |
| Leaked observers / IDB / listeners | +3 / +3 / +15 | +3 / +3 / +15 | unchanged |

**#13970 halved leak B without fixing any of its causes** — the same objects
leaked at the same rate; what changed is how much each dragged with it (the
`deep: true` watch removal being the likely bulk, matching `Dep` as the third
largest heap grower at +277,976).

It introduced no new leaks. `panelMountObserver`, which it added, is clean:
pre-PR `setupPanelObservers` created one observer and leaked 1/open; post-PR it
creates two and still leaks exactly 1/open.

All four defects in §2.2–§2.5 predate #13970 (files byte-identical across it).

---

## 6. Method

Playwright + Chrome DevTools Protocol.

- **Read-only.** Interceptor aborted every non-GET `/api/` call except searches.
  Result across all runs: `0 blocked mutating requests`.
- **Auth** captured via an interactive browser login; no password handled by the
  tooling.
- **GC forced** six times per sample. Everything reported survived it.
- **SPA-internal navigation** by clicking real nav elements — `page.goto()`
  reloads the document and resets the heap.

### Validity guards added after two false negatives

| Failure | Symptom | Guard |
|---|---|---|
| Hand-built URLs → nothing rendered | `canaries=0/0` | assert `grid items > 0` |
| `page.goto()` reloaded the document | `IntersectionObserver.created = 0` after 21 dashboards rendered | per-context `epoch` + counter monotonicity |

`framenavigated` is **not** a reload detector — Vue Router's `pushState` fires
it for in-app route changes and flags a correct run as invalid.

---

## 7. Corrections — claims made during this audit that were wrong

Recorded so the numbers are not misread later.

1. **"966 MB / 100 MB per cycle"** — dev-server artifact. Vite dev carries Vue's
   HMR runtime and unminified closures; it inflated the leak ~17× (control) and
   ~5.7× (treatment). All figures above are production builds.
2. **"It's a global route-change leak, not dashboard-specific"** — true on dev
   (control 59% of cost), false in production (control 20%). The dev build
   inverted the conclusion.
3. **"The `traceMap` streaming leak is the headline cause"** — false.
   `TraceRecord: 1 → 0`; that layer cleans up correctly.
4. **"Leaked IntersectionObservers pin the DOM and component trees"** — false,
   and asserted with more confidence than the evidence supported. Removing the
   observers entirely changed the DOM leak by **zero nodes**. They were a real
   leak, but not this one. The retainer BFS returning "no path to Window" should
   have prompted doubt rather than been read as confirmation.
5. **"The dashboard navigation leak is fixed"** — overstated. The dashboard
   *list* navigation was fixed; **opening a dashboard was not**, and that is the
   reported symptom.

---

## 8. Not measured

- **Scaling with panel count.** The measured dashboards are small (3–7 panels).
  One attempt produced a negative slope — too few distinct panel counts and a
  scroll that never mounted extra panels — and was discarded rather than
  reported. The clean signal that did emerge: leaked observers tracked
  `(chart panels mounted) + 1` exactly. MB/open did **not** track panel count
  (6.0 / 3.26 / 5.09 MB for 3 / 4 / 4 mounted), so a per-panel MB constant would
  be false precision.
- **Impatient navigation** (leaving mid-load, the only path that exercises
  `AbortError`). Implemented, not needed — the settled path leaked enough.

---

## 9. Harness

In the session scratchpad; all run standalone against any deployment.

| Script | Purpose |
|---|---|
| `capture-auth.mjs` | Interactive login → saved session |
| `isolate.mjs` | Control vs treatment (list-only vs dashboard-open) |
| `route-bisect.mjs` | Leak per route pair + which global listeners grow |
| `listener-origins.mjs` | **Names the file** adding listeners that are never removed |
| `dash-listener-origins.mjs` | Same for the dashboard-open path, plus observers and timers |
| `which-observer.mjs` | Names observers alive and never disconnected |
| `where-dom.mjs` | Detached vs in-document classification |
| `snapshot-reader.mjs` | Streaming `.heapsnapshot` parser (leaking snapshots exceed Node's max string length) |
| `heap-report.mjs`, `retainer-histogram.mjs`, `climb.mjs`, `dead-instances.mjs` | Heap analysis (see §3 caveat) |

`listener-origins.mjs` and `which-observer.mjs` are the natural CI regression
tests: both fail loudly and name the source file.
