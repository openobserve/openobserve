# Dashboard memory-leak audit

**Date:** 2026-08-31
**Branch:** `fix/dashboard-navigation-memory-leak`
**Tested build:** `main` @ `6b7f9eef57` (includes PR #13970), production bundles
**Backend:** `o2.introspect.internal.zinclabs.dev` (staging), accessed read-only

---

## 1. Executive summary

| Finding | Status |
|---|---|
| **Route-change leak** — each navigation stranded the previous view's component tree | **FIXED** — 650 → **0** nodes/iteration |
| Leaked IntersectionObservers / IndexedDB connections / `window "load"` listeners | **FIXED** — all **0** |
| **Dashboard-open leak, "5.71 MB / 2,697 nodes per open"** | **DOES NOT EXIST** — it was a measurement artifact (§7.1) |
| **`@tanstack/vue-form` leak** — streams 4,051 nodes/navigation | **FIXED** via patch-package — streams now **0** |
| **Logs route** — retains 1,438 nodes/navigation | **REAL, OPEN** — cause not yet identified (§4.2) |

The route-change leak was a discarded cleanup function:
`onMounted(() => { …; return () => cleanup(); })`. Vue **ignores** what
`onMounted` returns — that is React's `useEffect` idiom. One orphaned `document`
listener per navigation held its component's setup scope and, through a template
ref, the whole detached page tree.

**After the fixes, opening a dashboard leaks 0 DOM nodes.** Verified over 8
consecutive opens on a production build: node count pinned at 8,452, live
IntersectionObservers 0, IndexedDB connections flat at 7, heap growth
decelerating (0.46 → 0.15 MB per open — caches settling, not linear growth).

The largest real leak was **not in dashboards**: `@tanstack/vue-form` discarded
the cleanup returned by `FormApi.mount()`, costing streams ~6× what the dashboard
list ever did. It is now patched and streams measures 0. The logs route still
retains 1,438 nodes per navigation from an unidentified cause.

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

## 3. The dashboard-open leak was a measurement artifact

For most of this investigation, opening a dashboard appeared to retain 5.71 MB
and 2,697 DOM nodes, perfectly linearly. It does not.

A forward BFS from the GC roots (the correct retainer algorithm — see §7.2)
produced this path for every "leaked" `ViewDashboard` instance:

```
synthetic (GC roots) -> (Global handles) -> <N / DevTools console>
  -> <div gs-id="panel-0"> -> .grid-stack-item-content -> ...
  -> <symbol _vei> -> .onMouseover closure -> context -> ViewDashboard
```

`Global handles / DevTools console` pinning a panel div is a **Playwright
`ElementHandle`**. The harness called `page.waitForSelector(".grid-stack-item")`
on every dashboard open and never disposed the returned handle. Each handle
pinned that panel's DOM and, through Vue's `_vei` event invoker, the entire
`ViewDashboard` component tree.

Replacing it with `page.waitForFunction(...)`, which returns no handle, changed
the result from 2,697 nodes/open to **0**.

This retroactively explains every anomaly in the investigation: the perfect
linearity (one handle per open), no growth in listeners/observers/timers,
vue-router bookkeeping being clean, ECharts disposing correctly yet nodes still
"leaking", and the control arm reading 0 — it used `waitForFunction` only.

**Lesson for future harnesses:** `waitForSelector`, `$`, `$$` and
`evaluateHandle` all return handles that pin DOM until disposed. In a
memory-measurement harness use `waitForFunction` or `locator().waitFor()`, or
dispose every handle explicitly.

### Which measurements this invalidates

The artifact was present in **both arms** of the before/after #13970 comparison,
so the relative improvement there is still directionally valid but the absolute
per-open figures were inflated. The route-bisect and control measurements used
`waitForFunction` only and are unaffected — including the 650 → 0 result for the
route-change fix, and the streams/logs figures in §4.

### Post-fix state, measured correctly

Committed code, production build, 8 consecutive dashboard opens:

| Metric | Result |
|---|---|
| DOM nodes per open | **0** (pinned at 8,452) |
| Live IntersectionObservers | **0** |
| IndexedDB connections | flat at 7 |
| JS heap per open | 0.43 MB, decelerating (0.46 → 0.15) — caches settling |
| Event listeners per open | +30 — small, partly `@tanstack/vue-form` (§4) |

---

## 4. Third-party leak: `@tanstack/vue-form`

`node_modules/@tanstack/vue-form/dist/esm/useForm.js`

```js
onMounted(formApi.mount);   // FormApi.mount() RETURNS a cleanup fn — discarded
```

The same discarded-cleanup bug as §2.1, upstream. Each form mount leaks 3
`window` listeners (`form-devtools:request-form-state` / `-reset` /
`-force-submit`) plus a store subscription.

It cannot be wrapped from `useOForm` — the library captures `formApi.mount` by
value when registering the hook, so a wrapper applied to the returned instance
is never called. **Fixed via `patch-package`** (`web/patches/@tanstack+vue-form+1.33.3.patch`)
with a `postinstall` hook so `npm ci` reapplies it:

```js
let __o2MountCleanup;
onMounted(() => { __o2MountCleanup = formApi.mount(); });
onUnmounted(() => { if (typeof __o2MountCleanup === "function") __o2MountCleanup(); });
```

To be raised upstream; the patch is a stopgap until that lands.

**Impact (DOM nodes retained per route-change iteration, production build):**

| Route pair | Before §2 | After §2 | After vue-form patch |
|---|---|---|---|
| home ↔ dashboards | 650 | **0** | **0** |
| home ↔ **streams** | 4,701 | 4,051 | **0** |
| home ↔ logs | 2,088 | 1,438 | 1,438 |

Streams was the worst-affected route in the product — roughly 6× the dashboard
list — and is now clean. All `form-devtools:*` listeners are gone from every
route. 395 form unit tests pass against the patched library, including the
reset-on-remount and submit-state suites.

### 4.1 `cancelQuery` listener re-added after unmount — fixed

`web/src/composables/dashboard/usePanelDataLoader.ts`

`window.addEventListener("cancelQuery", …)` was registered inside `loadData()`.
A late stream callback can invoke `loadData()` after `onUnmounted` has already
removed the listener, re-adding it permanently. Moved to `onMounted` so the
add/remove pair is symmetric. `window:cancelQuery` no longer grows.

### 4.2 Still open: logs retains 1,438 nodes per navigation

Not `form-devtools`, not `cancelQuery` — both are now flat while the node count
still grows. No window/document listener grows on that route any more, so the
retainer is something else on the logs page. Use `leaked-components.mjs` against
a logs-cycle snapshot to name the leaked component, as was done for dashboards
in §3.

---

## 5. Relationship to PR #13970

All five claims in PR #13970 verified against its diff: cheapest-first
timestamp-alias check, lazy panel mounting, cache restore behind the visibility
gate, `deep: true` watch removed, AbortController released on completion.

Measured before/after on production builds:

| | Pre-#13970 | Current `main` | Change |
|---|---|---|---|
| MB per dashboard open* | 10.69 | 5.68 | −47% |
| DOM nodes per open* | 8,147 | 2,697 | −67% |
| Leaked observers / IDB / listeners | +3 / +3 / +15 | +3 / +3 / +15 | unchanged |

\* Both arms include the harness artifact of §3, so the *relative* change is
meaningful but the absolute per-open numbers are inflated. The observer / IDB /
listener counts are instrumented directly and are unaffected.

**#13970 roughly halved the per-open cost without fixing any of its causes** — the same objects
leaked at the same rate; what changed is how much each dragged with it (the
`deep: true` watch removal being the likely bulk, matching `Dep` as the third
largest heap grower at +277,976).

It introduced no new leaks. `panelMountObserver`, which it added, is clean:
pre-PR `setupPanelObservers` created one observer and leaked 1/open; post-PR it
creates two and still leaks exactly 1/open.

All four defects in §2.2–§2.5 predate #13970 (files byte-identical across it).

Note that with the artifact removed, the post-fix dashboard-open leak is 0 nodes,
so what #13970 improved was largely load-time cost rather than retention.

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
