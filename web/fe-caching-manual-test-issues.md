# `feat/fe-caching` — Manual Test Run: Issues Found

Test run: 2026-08-24 · Branch worktree `feat/fe-caching` @ `50d3ce7d10` · Env: local `npm run dev`
(port 8081) → the internal **pentest** environment (`VITE_OPENOBSERVE_ENDPOINT` pointed at it),
org `default`, shared test user, enterprise build.
Method: in-app browser automation; request counts via `performance` resource timings; cache
state inspected through the live `queryClient` (vite module import) and IndexedDB.

Companion doc: [fe-caching-manual-test-plan.md](./fe-caching-manual-test-plan.md).

> **Fix rounds (2026-08-25, uncommitted on the branch worktree):** every actionable finding
> is now closed. FIXED in code and re-verified against o2latestmain: #1, #5, #6, #7, #8, #9,
> 0b, 9a, and the plan's §24-6 read-cache residue. #2 resolved as **works-as-main by
> decision** (the plan's §5.2 wording is corrected instead). #3/#4 need no code change
> (backend-version conditional; correct on latest). Remaining open items are observations
> only (10: `result_schema` chatter, 12: explorer first-revisit partial re-run) plus the
> `VITE_DISABLE_RUM` dev guard, which is a reviewer's call. Per-finding status is annotated
> below; both change lists are at the end.

> **Third round — the internal latest-main environment** (latest backend, SLOs enabled, live
> traces/alerts/dashboards):
> every failure was re-run there. Outcome per finding: **#1 scoped** (SLO page is fully healthy
> when the feature is enabled — refresh forces, revisit cached; only the error-envelope path is
> broken), **#2 stands** (code-level), **#3 and #4 did NOT reproduce** (downgraded to
> env-conditional against the older pentest backend), **#5 REPRODUCED** (save → blank form on
> both backends), **#6 REPRODUCED** (history keys 5 s apart → separate entries). Also verified
> on latest: authenticated `/config` cached memory-only with commit-hash baseline, trace-details
> endpoint works, §22.1 eval lists (score configs / scorers / jobs / providers) fetch once and
> revisit free, panel cache written. Each finding below carries its per-env status.

---

## Failures

### 1. SLO page: backend "disabled" reply renders an eternal skeleton, and Refresh goes dead

```
Module:            SLOs (§7)
UI path:           Left sidebar → SLOs
Check that failed: "Failed load surfaces an error" (the very bug §7 says was fixed) + C4 refresh
Steps:             1. Backend has ZO_SLO_ENABLED=false (pentest default)
                   2. Open SLOs
                   3. Click the Refresh button
Expected:          An error state — "not a silently empty table"; Refresh always reaches the server
Actual:            Skeleton rows render FOREVER (neither error nor empty state). The Refresh
                   button (slos-slolist-refresh) fires NO request at all.
Network tab:       GET /api/default/slos?folder=default → HTTP 200, body
                   {"code":501,"message":"SLOs are disabled. Set ZO_SLO_ENABLED=true..."}
Query Devtools:    ["org","default","slos","list","default"] stuck status=pending,
                   fetchStatus=paused, dataUpdateCount=0 — refresh is inert because the layer
                   thinks a fetch is already in flight.
Root cause guess:  a 200-with-error-envelope response is neither resolved nor rejected by the
                   SLO query fn, so the query never settles.
```

**o2latestmain (SLOs enabled): the page is healthy** — C1 one request, Refresh fires one
request every click, revisit inside the window is silent. The bug is strictly the
disabled/error-envelope path, but it will hit any org where SLOs are off.

> **FIXED:** the service already converts the 200+code envelope into a rejection
> (`rejectBodyErrors`); the query layer then RETRIED the 501 (2 retries, pausable by
> onlineManager) instead of settling into its error state — refresh was starved meanwhile.
> `queryClient.ts` now treats **501 as permanent** (no retry), so the first rejection lands
> the error banner immediately and Refresh works. The empty-org placeholder key is gone too:
> `SloList.vue` seeds `readOrg` from the store instead of `""`.

Also found on the same page: a query keyed `["org","","slos","list","all"]` — **empty org
segment**, violating the key convention (§0.2). It will not match `purgeOrgQueries(org)` on an
org switch. It held no data during the test, so exposure today is nil, but it opts out of the
purge contract.

### 2. Panel-result cache does not fork per time range (plan §5.2 row "Changing the time range forks the cache")

```
Module:            Dashboards → panel cache (§5.2)
UI path:           Dashboards → default → "test" → change range 6d → 5d → back to 6d
Expected (plan):   Each range keeps its own cached result; going back is instant
Actual:            6d→5d refetches (correct miss), but returning to 6d re-runs ALL panel queries.
Network tab:       3× _search_stream on every range change, including the return.
Why:               The cache keeps ONE entry per panel+variables digest; the time range is not
                   part of the key. Restore only happens when the cached entry's SPAN equals the
                   current span (usePanelDataLoader.ts:809 compares end-start durations), and the
                   5d run overwrote the 6d entry.
Impact:            Cache works for revisit/reload (verified PASS) but the plan's per-range fork
                   is simply not implemented. Either fix the plan or key the entry by range.
```

> **RESOLVED — works as main, by decision.** `origin/main`'s loader has the identical
> semantics: no time range in the cache key, restore only on mount (`runCount == 0`), span
> mismatch tolerated with the "differs" badge, every time switch refetches. A per-span fork
> (span in the key digest + restore on context switch, never on same-key refresh) was
> implemented and verified live (switch-back = 0 queries), then **reverted** on request —
> parity with main is the wanted behavior. Verified post-revert on o2latestmain: mount/F5
> restores (age badge, even for an 18 h-old persisted entry), both switch directions refetch,
> Refresh fetches. Action item: correct the plan's §5.2 "forks the cache" row.

### 3. AI Observability Datasets & Queues: mount still forces a fetch on every visit (§22.2 / §22.3)

```
Module:            AI → Datasets, AI → Queues (enterprise)
UI path:           AI → Datasets → navigate away → come back within seconds (same for Queues)
Check that failed: "Mount does not force — Zero requests on the return visit"
Actual:            /api/default/datasets and /api/default/annotation_queues re-fetch on EVERY
                   visit, seconds apart.
Query Devtools:    ["org","default","llm","datasets","list"] and ["org","default","llm",
                   "queues","list"] exist with staleTime 30000 — but dataUpdateCount stays 0.
                   The declared queries are never populated; the pages still fetch through the
                   raw service. Same "declared but unread" pattern as §24 item 8, except the
                   plan lists these two surfaces as fixed.
```

**Did NOT reproduce on o2latestmain**: there the same queries populate (`dataUpdateCount=1`,
success) and revisits fire zero requests. So the wiring is fine against the current backend;
against the older pentest backend the query fn never settles (response-shape/error handling)
and the page refetches every mount. Downgraded to: harden the query fn against old/error
response shapes.

### 4. Home Overview: incidents summary double-fetches and re-fetches on every tab switch (§19)

```
Module:            Home / Overview
UI path:           Home → switch O2 Assistant / Overview / Usage tabs repeatedly
Check that failed: "Each tab loads once — it used to re-request on every tab switch"
Actual:            Every return to Overview fires /api/v2/default/alerts/incidents?limit=4&
                   offset=0&status=open — TWICE (two identical concurrent requests), well inside
                   the 30 s window. The pair fires again on each subsequent tab switch.
Other overview reads (alert/anomaly/service summaries) correctly load once — only the
incidents card misbehaves (not cached, and duplicated within a single mount).

**Did NOT reproduce on o2latestmain**: fresh-window tab returns fire zero requests, and a
stale return revalidates with a single incidents call (and a correctly time-quantized
alerts/history call). Env-conditional like #3 — likely the same old-backend response-shape
sensitivity; verify the incidents query's error path.
```

### 5. Save on Add Alert remounts a blank form instead of returning to the list (§6.2 C6) — reproduced on BOTH environments

```
Module:            Alerts → New Alert
Steps:             1. New alert → name fecache_alert, stream e2e_automate, destination selected
                   2. Save
Expected:          Return to the alerts list with the new row present
Actual:            POST succeeded (alert existed server-side; the list cache was updated), but
                   the UI re-opened an EMPTY Add Alert form (form-mount requests re-fired).
Caveat:            The form was driven with synthetic events (editable-title name input); a
                   human re-run is still worth 2 minutes before filing. The cache side is fine —
                   after Cancel, the list showed the alert with no manual refresh.
```

**Reproduced identically on o2latestmain** (`fecache_c6_check`, stream `default`, existing
destination): POST succeeded, alerts-list refetch fired, alert existed server-side — and the
UI sat on a fully blank Add Alert form. Two backends, same flow, same outcome, so this looks
like the form's post-save navigation, not backend-dependent behavior. (Both test alerts were
deleted afterwards.)

> **FIXED.** Root cause (instrumented live): `?action=add` deep links were handled in TWO
> places — the immediate watcher on `query.action` AND a duplicated block inside
> `getAlertsFn`. The post-save `refreshList` → `getAlertsFn` chain re-read the route before
> `hideForm`'s cleanup push landed, saw the stale `action=add`, and re-opened a blank form
> (racing the cleanup). The duplicated block in `getAlertsFn` is removed — the immediate
> watcher alone handles add/update/import deep links (now a named `handleActionQuery` so
> tests can drive it deterministically). Verified live: save → returns to the list with the
> new alert present, URL clean; `?action=add` deep link still opens the form. All 96
> AlertList/AlertListSlo tests pass (the 4 deep-link specs now drive the named handler
> instead of the removed block).

### 6. Alert history cache keys are anchored to raw `now` — the cache can never hit (§6.5) — *found in the `_meta` follow-up round*

```
Module:            Alerts → alert detail → History (and every history surface)
UI path:           _meta → Alerts → open fecache_alert's history → back → reopen within 20 s
Check that failed: §6.5 "the three surfaces share one cache entry / second open does not re-request"
Actual:            Every open fires /api/v2/{org}/alerts/history?...&start_time=<now-1h>&
                   end_time=<now> with a fresh, millisecond-precision `now`.
Query Devtools:    Two entries for the SAME alert existed 18 s apart, identical except
                   end_time (1787575849475000 vs 1787575867332000) — each open mints a new
                   key, so no open is ever served from cache, and dead entries accumulate
                   until gcTime.
Fix direction:     queryClient.ts exports quantizeRange() for exactly this; today only
                   service_graph.querykeys.ts uses it. Alert history (and evaluation/anomaly
                   history, which build ranges the same way) never quantize.
```

**Reproduced on o2latestmain** with a long-lived real alert (`default_alert`): two opens 5 s
apart minted two cache entries differing only in the raw `now` anchor. Sharper still: the Home
Overview's own `alerts/history` read on the same env IS quantized (`start_time=…100000000`,
`end_time=…000000000` bucket edges) — the pattern exists in the codebase; the alert-detail
history surfaces just don't use it.

> **FIXED.** `alertHistoryQuery` now quantizes `start_time`/`end_time` through
> `quantizeRange()` before both the key and the request, so every consumer (detail page,
> drawer, evaluation history, overview) shares bucketed entries. Verified live: first open
> fetches with bucket-edge timestamps; a second open moments later fires **zero** history
> requests.

---

## Fourth round — 2026-08-25, local dev against a local backend

Findings from a further pass. Only items **not already covered above** are listed; each was
reproduced in the browser with a request recorder installed and IndexedDB / localStorage read
directly. Credentials are omitted throughout — substitute your own login e-mail and org
passcode where a placeholder appears.

### 7. Favourites and the home-dashboard pin are permanently lost on reload

> **FIXED (earlier round, commit `83b0085b8a`).** This run's measurement predates the fix:
> the four `setQueryData` sites now write through `setPersistedQueryData()` (setQueryData +
> `persistQueryByKey`). Re-verified live: the star and the pin both survive a hard reload,
> the persisted entries update the moment the toggle lands.

```
Module:            Dashboards -> favourites (§5.1) and the org-wide home-dashboard pin
UI path:           Dashboards -> star a row · a dashboard's "Set as Home" -> press F5
What to check:     whether the star / pin survives a reload
What to expect:    both are persisted settings — they should survive indefinitely
```

**Both are lost, and stay lost.** The server saves them correctly; the client's persisted
copy is never updated, and the app then never re-reads the setting — a Dashboards mount
issues **zero** `settings/v2` requests while the persisted entries sit at `null`.

Two faults combine:

1. **The write never reaches disk.** Both composables call `queryClient.setQueryData(...)`
   after the server call. `setQueryData` does not invoke the persister, which only writes at
   the end of a query-function run — so `localStorage` keeps the pre-write value.
2. **The stale copy is never revalidated.** The entries were 22 and 70 minutes old — far past
   `CONFIG_STALE_TIME` (5 min) — yet no request was issued.

Measured (org `default`, a non-admin UI user; e-mail redacted):

```
FAVOURITES
  click the star on a dashboard
  server   GET settings/v2/favorite_dashboards?user_id=<redacted>
           -> setting_value: [{ label: "<dashboard>" }]              SAVED
  localStorage o2q-[...,"favorite_dashboards","<user>"]  -> []       NOT UPDATED (2.5 s later)
  after F5 -> still [], entry age 611 s, star not set

HOME PIN
  set a dashboard as Home
  server   GET settings/v2/home_dashboard
           -> setting_value: { label: "<dashboard>" }                SAVED
  localStorage o2q-[...,"home_dashboard","__org__"] -> null, age 4118 s   NOT UPDATED
  visit Home -> renders the Overview, not the pinned dashboard
  localStorage -> still null, age 4169 s   (age climbing, value unchanged)

NO REVALIDATION
  fetch/XHR recorder installed before mount; requests matching settings/v2  ->  0
```

**Blast radius checked and NOT general.** The concern that persisted queries might never
revalidate was tested directly and disproved: a function created server-side appeared
immediately on Pipelines -> Functions, with the request fired and the persisted list rewritten
(entry age 13 s). Stream name lists, folders, functions, destinations, templates and regex
patterns are unaffected. The fault is confined to the two **settings** reads.

**Where:** `src/composables/useFavoriteDashboards.ts` and `src/composables/useHomeDashboard.ts`
(lines 75, 91) — both `setQueryData` a persisted setting.

**Suggested fix:** `invalidateQueries` instead of `setQueryData`, or persist explicitly
afterwards the way `usePanelCache` does with `persistQueryByKey`. General rule:
**`setQueryData` on a persisted query leaves disk behind** — worth auditing every call site.

**Severity:** High — two user actions that report success are silently discarded, and the
home pin is org-wide, so it reverts for everyone. It does **not** self-heal.

---

### 8. `_o2_removeDashboardCache()` no longer clears the panel cache (regression)

> **FIXED.** The helper now removes the in-memory panel queries AND sweeps IndexedDB by key
> shape (`["org",<any org>,"panels",…]` via `cacheRemoveWhere`), covering entries that were
> only ever on disk — metrics-explorer cards and other dashboards included. Verified live:
> 10 panel entries (dashboard + explorer) → 0 after one call, memory also clean.

```
Module:            Dashboards -> panel result cache (§5.2)
UI path:           any dashboard -> Console -> await window._o2_removeDashboardCache()
What to check:     IndexedDB o2Cache -> kv, counting keys containing "panels", before and after
What to expect:    every panel entry gone
```

> Corrects the "What passed" entry above, which lists `_o2_removeDashboardCache()` as working.

It deletes only entries that have a **live in-memory query**, leaves the rest on disk, and
`_o2_getDashboardCache()` then reports `{}` — claiming success while most of the cache survives.

```
panel entries in IndexedDB before   10
await window._o2_removeDashboardCache()
panel entries in IndexedDB after     9      <- removed exactly ONE
await window._o2_getDashboardCache() -> {}  <- reports the cache as empty

survivors: 6 metrics-explorer cards, a 2nd digest for the same dashboard panel,
           and another dashboard's panel entry
```

**Regression introduced by this branch.** `main` wiped the whole object store in one line
(`performTransaction("readwrite", store => store.clear())`); the new implementation walks
`queryClient.getQueryCache()` instead. `persisterGc()` only reclaims **expired or busted**
entries, so it does not cover the gap. The source comment acknowledges the hole — *"Entries
that were only ever on disk have no in-memory query to walk"* — but the fallback does not
close it.

**Where:** `src/composables/dashboard/usePanelCache.ts`

**Suggested fix:** delete by key prefix (`o2q-heavy-["org","<org>","panels"`) as
`dropPanelCache()` in the same file already does via `cacheRemoveByPrefix`.

**Severity:** Low — a debug/support tool, not user-facing. But it fails silently and
misreports success, so anyone told to "clear the cache and retry" gets a false result.

---

### 9. (pre-existing, not this branch) `forceLoad` forks the panel cache key

> **Left as-is, by the same main-parity decision as finding #2** — `getCacheKey()` is
> character-for-character identical on `main`. Filed for a future cleanup.

```
Module:            Dashboards -> panel result cache (§5.2)
UI path:           open a dashboard, let a panel load, press the panel's Refresh -> inspect IndexedDB
What to check:     how many entries exist for one panel id
What to expect:    one entry per panel + variable combination
```

`getCacheKey()` includes `forceLoad`, so a forced load hashes to a different key than a
normal one. Each panel can hold **two** copies of the same result, and a forced refresh's
result is never reused by a subsequent normal load.

Observed: one panel with two digests, both holding a 168-hour window — the same range cached
twice.

**Not caused by this branch** — `getCacheKey()` is character-for-character identical on
`main`. Filed for visibility only; the fix would be to drop `forceLoad` from the key, since
forcing is about *whether to fetch*, not *which result you get*.

**Severity:** Low — wasted IndexedDB space and a missed cache hit after any refresh. No
incorrect data shown.

---

### Also confirmed this round

- **Time range does not fork the panel cache** — independently verified, matching finding #2
  above. Switching a dashboard from 1 week to 24 hours produced **no** new IndexedDB entry
  (2 entries before, 2 after, both still 168 h). `getCacheKey()` holds panelSchema +
  variables + dashboard/folder id only.
- **Metrics Explorer panel cache works** — cards restore on revisit and across a hard reload
  with **zero** `query_range` requests; 6 entries written under
  `["org","<org>","panels","__metrics_explorer",...]`; no `DataCloneError`.
- **Streams pagination + prefetch works** — cold load 2 requests (page + next-page prefetch),
  page 2 -> 1 (prefetching page 3), page 3 -> 0. Sorting fires 2 with **different** offsets,
  not two identical ones.
- **Alert History prefetch works** — but only on the standalone **Alerts -> Alert History**
  page, which has **no UI path**: `goToAlertHistory()` is defined and returned in
  `AlertList.vue` but bound to no template element, and the same is true of
  `goToAlertInsights()`. The alert-detail History tab and the History drawer do not prefetch
  at all, so every reachable alert-history surface issues one request per page.
- **A dashboard panel can render blank while its cache is correct** — a panel whose cached
  entry held valid data (`loading:false`, no error) drew no chart. Reproduced on `main` too,
  so it is **not** a caching fault; an ECharts instance is created but produces no canvas.
  Worth a separate ticket.

---

## Carried over from the parallel run — findings not already listed above

These came from a separate test campaign against a local backend. Each was checked
against the findings above and is **not** a duplicate of them. Numbering continues from
the list above; the original numbers from that run are noted in each heading.

Two of that run's findings are **already covered above** and are not repeated here:
its time-range/`now` cache-key finding is the same as **#6**, and its AI → Evaluations
force-refetch overlaps **#3** (different pages in the same module — Evaluations there,
Datasets & Queues here; both worth checking).

---

### 10. Destination webhook credentials written to localStorage in plaintext — ✅ FIXED

> **Re-verified 2026-08-26 on `fdff679ac1`: this is FIXED.** `destinationsQuery` no longer
> declares a persister, and now carries an explicit comment saying why:
> *"Memory-only: destination payloads can carry webhook Authorization headers and
> PagerDuty/Opsgenie/ServiceNow keys, which must not sit in localStorage like the other
> config lists do."*
>
> Confirmed in the browser: with the Destinations page open and 32 rows on screen, there is
> **no `o2q-…destinations…` key in localStorage** — 14 persisted keys exist and none of them
> is destinations. Forcing a refresh does not create one. The original finding below is kept
> for history.

> **FIXED (earlier round, commit `831728799a`).** This run predates the fix:
> `destinationsQuery` no longer declares a persister, so the payload (headers included) is
> memory-only. Re-verified live: a fresh destinations fetch writes nothing to localStorage.

| Field | Detail |
| --- | --- |
| **Module** | Alerts → Destinations (§6.3) |
| **UI path** | Left sidebar → **Alerts** → **Destinations** tab |
| **What to check** | DevTools → Application → Local Storage → key `o2q-["org","default","alerts","destinations","alert"]` |
| **What to expect** | Credentials never written to disk. Cipher keys, ingestion tokens, org passcode, RUM and agent tokens are all explicitly memory-only; destinations should follow the same rule |
| **The issue** | The whole destination payload — **including `headers`** — is persisted to `localStorage`. A destination carrying `Authorization: Bearer …` (PagerDuty routing key, Opsgenie / ServiceNow credential, any custom webhook token) has that secret written to disk in cleartext |

**Severity:** High — a credential at rest on a possibly shared machine.

**Reproduced:**

1. Created destination `cachetest_dest2` with header `Authorization: Bearer <redacted-token>
2. Navigated to Alerts → Destinations.
3. Scanned all of `localStorage` for the literal token:

```
plantedTokenFoundInStorage: true
key:    o2q-["org","default","alerts","destinations","alert"]
sample: ,"skip_tls_verify":false,"headers":{"Authorization":"Bearer <redacted-token>
```

4. Hard-reloaded (Ctrl+Shift+R) and re-scanned → `tokenSurvivedHardReload: true`.

**Blast radius (also measured):** the token **is** removed by an org switch and by logout —
both verified below. So the exposure is "on disk for the duration of the session, and
across browser restarts until one of those runs", not "forever".

**Where:** [`services/alert_destination.queries.ts`](./src/services/alert_destination.queries.ts)
sets `persister: localStoragePersister` on `destinationsQuery`.

**Suggested fix:** drop the persister (memory-only, as `cipherKeysQuery` already does), or
strip `headers` before it reaches the persister. Same question at lower stakes for
`actionsQuery` and `aiToolsetsQuery`.

---

*(originally #1 in the parallel run)*

---

### 11. A forced fetch permanently rewrites a query's stored `staleTime` to 0

> **FIXED.** Every forced read now invalidates the exact key
> (`invalidateQueries({ …, refetchType: "none" })`) and then fetches with the query's own
> declared options — `queryClient` called directly at each site, no wrapper layer. Applied
> to `fetchInto`'s force path and all ~20 direct `{ …options, staleTime: 0 }` spreads
> (buildVersionChecker's `/config` re-check included). Verified live: `/config` keeps
> `staleTime: Infinity` through `checkForNewVersion()`; a synthetic probe shows cached read
> → no call, invalidate+fetch → forced call, stored staleTime untouched; the Alerts and
> Dashboards `r`-refresh still fire exactly one request each.

| Field | Detail |
| --- | --- |
| **Module** | Query layer — `fetchInto` / `queryClient.fetchQuery` (affects every page whose Refresh button forces) |
| **UI path** | Any cached list with a Refresh button, e.g. Settings → **Cipher Keys** |
| **What to check** | Read `queryClient.getQueryCache()` and inspect the entry's `options.staleTime` before and after clicking Refresh once |
| **What to expect** | A one-off forced read should not change the query's standing freshness policy |
| **The issue** | `fetchQuery({ ...options, staleTime: 0 })` **writes `staleTime: 0` onto the cached query object**, and a later `fetchQuery(options)` passing the correct value does not restore it |

**Severity:** Low–Medium. **No longer latent — a real trigger path was found and reproduced
live** (see "Confirmed on `/config`" below).

**Controlled experiment** (synthetic key, so nothing else interferes):

```
staleTime after normal fetch  (passed 300000):  300000
staleTime after forced fetch  (passed 0):       0          ← overwritten
staleTime after next normal fetch (passed 300000): 0        ← NOT restored
did that next normal fetch hit the network?     false
```

**Why it is not currently user-visible:** the *passed* `staleTime` still wins for each
`fetchQuery` call, so imperative callers (`fetchInto`) keep behaving correctly — verified
on Cipher Keys, where a Refresh click left the warm revisit at **0 requests** and the
declared `staleTime: 300000` still in effect for the read decision.

**Why it still matters:** the stored `0` is what `useQuery` observers, `isStale()`,
`refetchOnMount` and `refetchOnWindowFocus` consult. Any component that later mounts a
`useQuery` on a key that some other page force-fetched will treat it as permanently stale.
Several keys are shared across pages exactly like this (destinations, templates, functions,
streams), so this is a trap waiting for the next `useQuery` migration.

**Confirmed on `/config` — the most-cached query in the app.**
[`utils/buildVersionChecker.ts`](./src/utils/buildVersionChecker.ts) re-reads config with
an explicit force:

```ts
this.cachedConfig = await queryClient.fetchQuery({ ...configQuery(), staleTime: 0 });
```

That force is **correct** for its purpose — the stale-build prompt must not be suppressed by
the `staleTime: Infinity` config cache, and it isn't. But it permanently rewrites the stored
policy. Measured live by invoking the real checker:

```
/config entry ["org","__global__","config","get"]
  before checkForNewVersion():  staleTime: Infinity
  after  checkForNewVersion():  staleTime: 0        ← permanently rewritten
```

The checker runs on any chunk-load error, so this is reachable in normal operation, not a
synthetic case. Current user-visible impact is limited (`configQuery` is read via
`fetchQuery` with its own `staleTime` passed, and it does not set `refetchOnWindowFocus`),
but the standing policy on the app's session-immutable config query is now `0` — so the
moment anything mounts a `useQuery` on it, or the client default for focus-refetch changes,
`/config` starts refetching continuously.

**Suggested fix:** force via `queryClient.invalidateQueries({ queryKey, refetchType: 'none' })`
followed by a normal `fetchQuery`, or use `refetchQueries`, rather than passing
`staleTime: 0` into `fetchQuery`.

---

*(originally #3 in the parallel run)*

---

### 12. Enrichment table status is re-requested on every visit

> **FIXED.** New `enrichmentTableStatusesQuery` (default 30 s tier, focus revalidate);
> the list page reads through it and the Refresh path forces. Verified live: first visit
> fetches status + stream list, an immediate revisit fires zero enrichment requests.

| Field | Detail |
| --- | --- |
| **Module** | Pipelines → Enrichment Tables (§10.2) |
| **UI path** | Left sidebar → **Pipelines** → **Enrichment Tables** |
| **What to check** | Network tab: navigate away and straight back within 30 s |
| **What to expect** | A warm revisit issues no request |
| **The issue** | `GET /api/default/enrichment_tables/status` fires on **every** visit. The paired stream list *is* cached correctly |

**Severity:** Low — listed as *not migrated* in `api-cache-inventory.md` §3a item 7, so a
known gap rather than a regression. Recorded because the plan's §10.2 otherwise implies the
page is fully cached.

```
cold visit: GET /api/default/enrichment_tables/status
            GET /api/default/streams?type=enrichment_tables
warm visit: GET /api/default/enrichment_tables/status      ← stream list correctly absent
```

---

*(originally #4 in the parallel run)*

---

### 13. Alerts → History re-reads the whole alert list on every visit

> **FIXED.** `fetchAlertsList` now reads through `alertsListQuery(org, "")` instead of the
> raw service. Verified live: first visit fetches the list once, a revisit fires zero
> alert-list requests.

| Field | Detail |
| --- | --- |
| **Module** | Alerts → History (§6.5) |
| **UI path** | Left sidebar → **Alerts** → **History** |
| **What to check** | Network tab across repeated visits |
| **What to expect** | The alert list backing the name filter is already cached by the Alerts page; it should not be re-read |
| **The issue** | `GET /api/v2/{org}/alerts?sort_by=name&desc=false&name=` fires on **every** visit, and no `["org",…,"alerts","list",…]` entry is ever created — the call bypasses `alertsListQuery` entirely |

**Severity:** Low. Confirmed by dumping every alert-related cache key after three visits:
entries exist for `destinations`, `templates` and 11 × `history`, but **none** for the
alert list.

---

*(originally #6 in the parallel run)*

---

### 14. (out of scope) An unused alert template cannot be deleted — ✅ FIXED

> **Re-verified 2026-08-27 on `fdff679ac1`: FIXED.** Both paths now behave correctly:
> an **unused** template deletes cleanly (simple "Are you sure?" confirm → `DELETE` →
> row gone), and a **used** template is correctly blocked with a reason.
>
> Verified in the browser: created and deleted `smoke_tmpl_c6_created` (unused) with no
> impact dialog; deleting `cachetest_tmpl1` (used by 3 destinations) is refused with
> *"Template is in use for destination cachetest_dest2"*. The Used-by count of **3**
> matches the server exactly (`cachetest_dest1`, `cachetest_dest2`, `smoke_dest_imported`).
>
> Minor UX note, not a defect: the refusal names only **one** blocking destination even
> though the UI already knows all three. Deleting a *destination* in use opens a proper
> impact dialog; templates just toast a single name. Inconsistent between two tabs of the
> same module — worth a look, unrelated to caching.

> **Not reproducible on the current branch.** The row's delete button opens the ordinary
> confirm dialog (OK/Cancel); confirmed live with a fresh unused template — DELETE fired,
> row gone. The 0-deps "Used by …" dialog with only a Close button is the **Used-by cell's**
> informational popup, not the delete path — the parallel run likely clicked that, or ran
> older code. Re-check on the branch tip before filing.

Found while testing C7; **not a caching defect**, recorded because it blocks that test.

| Field | Detail |
| --- | --- |
| **Module** | Alerts → Templates (§6.4) |
| **UI path** | Left sidebar → **Alerts** → **Templates** → row → **Delete** |
| **What to check** | Delete a template that nothing uses |
| **What to expect** | A confirm dialog, then the template is deleted |
| **The issue** | The delete button opens the **dependency-impact** dialog, which for a template with 0 dependencies reads "Used by 0 destinations · 0 alerts" and offers **only a Close button**. There is no way to proceed, so an unused template cannot be deleted from the UI. Reproduced twice |


---

*(originally #7 in the parallel run)*

---

### 15. The alert form's workflow dropdown bypasses the cache

> **FIXED.** `AlertDestinationsField.fetchWorkflows` reads through
> `queryClient.fetchQuery(workflowsQuery(org))`, sharing the Workflows page's entry.
> Live verification is limited on this backend (`workflows_enabled` is off, so the dropdown
> path never runs); the query itself verified live — one request, entry cached, second read
> free. Re-verify the form flow on a backend with workflows enabled.

| Field | Detail |
| --- | --- |
| **Module** | Alerts → create / edit alert (§6.2) |
| **UI path** | Left sidebar → **Alerts** → **New alert** |
| **What to check** | Network tab across repeated opens of the alert form |
| **What to expect** | The workflow list is a declared cached read (`workflowsQuery`), already cached by the Workflows page — the dropdown should reuse it |
| **The issue** | `GET /api/{org}/workflows` fires on **every** form open, and **no `workflows` cache entry is ever created** |

**Severity:** Low — one extra request per form open.

**Measured:** three consecutive opens of the alert form, each preceded by warming
destinations, templates and streams:

```
open 1: GET /folders/alerts · GET /workflows · GET /functions
open 2: GET /workflows          ← destinations/templates/streams correctly cached
open 3: GET /workflows
```

Cache dump for the workflows domain after all three: **[] (empty)**.

**Root cause:** [`components/alerts/AlertDestinationsField.vue`](./src/components/alerts/AlertDestinationsField.vue)
calls the transport directly instead of the declared query:

```ts
import workflowService from "@/services/workflows";
…
const res = await workflowService.listWorkflows(store.state.selectedOrganization.identifier);
```

The Workflows *page* uses `workflowsQuery` and caches correctly (verified: cold 1, warm 0),
so this is a single call site that opted out. Same class as Issue 6.

**Suggested fix:** read through `workflowsQuery` (via `fetchInto` or `useQuery`) so the
dropdown shares the entry the Workflows page already populates.

---

*(originally #8 in the parallel run)*

---

### 16. The trace DAG is persisted to IndexedDB but never served from it

> **FIXED.** `traceDagQuery` now declares `staleTime: SESSION_STALE_TIME` (Infinity), as
> the inventory documents — the key already carries the time window. Verified via the
> declaration (UI needs an LLM-instrumented trace, unavailable here).

| Field | Detail |
| --- | --- |
| **Module** | Traces → trace detail → **DAG** tab (§16) |
| **UI path** | Left sidebar → **Traces** → switch to **Traces** mode → click a trace → **DAG** tab |
| **What to check** | Open the DAG, switch to Waterfall, switch back to DAG. Watch the Network tab |
| **What to expect** | Per `api-cache-inventory.md`: "T5, `staleTime: Infinity` — **a trace is immutable, so each time window is cacheable forever**". The second open should issue **no** request |
| **The issue** | The declaration ships `staleTime: 0`, so the entry is always stale. The DAG **is** written to IndexedDB, but every open re-fetches — the persistence is paid for and never used |

**Severity:** Medium — the DAG is an expensive read, this is the one query the design
singles out as permanently cacheable, and the persistence cost is being paid for no benefit.

**Measured** (LLM trace `bb11cc22…`, DAG tab opened, switched away, reopened):

```
1st open: GET /api/default/default/traces/bb11cc22…/dag?start_time=…&end_time=…
          → IndexedDB entry created:
            o2q-heavy-["org","default","traces","dag","bb11cc22…","default",1787633545026000,1787637145026000]
2nd open: GET /api/default/default/traces/bb11cc22…/dag?start_time=…&end_time=…   ← re-fetched
```

**Where:** [`services/search.queries.ts`](./src/services/search.queries.ts)

```ts
export const traceDagQuery = (…) =>
  queryOptions({
    queryKey: traceDagKeys.detail(org, streamName, traceId, startTime, endTime),
    queryFn: …,
    staleTime: 0,                    // ← inventory documents `Infinity`
    gcTime: LONG_GC_TIME,
    persister: indexedDbPersister,
  });
```

**Suggested fix:** set `staleTime: SESSION_STALE_TIME` (Infinity), as the inventory
describes. The key already includes the time window, so a different range still forks
correctly.

**Note on reaching this view:** the DAG tab only appears for traces containing **LLM spans**
(`TraceDetails.vue`: `v-if="hasLLMSpans && activeTab === 'dag'"`, via `isLLMTrace()`).
A plain HTTP/DB trace shows only Waterfall / Flame Graph / Trace Graph, and "Trace Graph" is
a **client-side** render that issues no request — not the cached DAG. Testing §16 requires
ingesting a trace with `gen_ai.*` attributes.

---

*(originally #9 in the parallel run)*

---
### 17. Raw `Date.now()` in cache keys — still unquantized on AI Insights/Sessions and Pipeline History

> **FIXED.** (a) `selectionKey()` in `llmInsightsCache.ts` quantizes via `quantizeRange()`
> — one change covers the panel-cache identity, the KPI cache and the error table; verified:
> two keys minted 5 s apart for the same window are identical. (b) Pipeline History moved
> off raw `http()` onto a new cached `pipelineHistoryQuery` with a quantized, stable-filtered
> key (`pipelineKeys.history`); its Refresh forces; component specs updated and green.

```
Module:            AI -> LLM Insights / Sessions (§22.3a) · Pipelines -> History (§9.3)
UI path:           AI -> LLM Insights  (or Pipelines -> open a pipeline -> History)
What to check:     Network tab: open the page, navigate away, come straight back — three times
What to expect:    the second and third visits serve from cache
```

The cache key contains the raw `start_time` / `end_time`, recomputed from `Date.now()` on
every mount. The key is therefore different every time: **the entry can never be reused**,
and each visit adds a new permanent entry until `gcTime` reclaims it.

**Partially fixed — two of the four original surfaces are now correct.** `quantizeRange()`
buckets the range before it enters the key, and it is applied in exactly two places:

```
services/alerts.queries.ts:86          quantizeRange(start, end)            <- Alerts -> History   FIXED
services/service_graph.querykeys.ts:35 quantizeRange(..., OVERVIEW_BUCKET)  <- Traces Service Graph FIXED

plugins/traces/composables/useLLMInsights.ts   0 uses of quantizeRange, 10 raw-timestamp refs  STILL OPEN
components/pipelines/PipelineHistory.vue       0 uses of quantizeRange, 15 raw-timestamp refs  STILL OPEN
```

So finding **#6** above (alert-history keys anchored to raw `now`) is resolved, but the same
defect remains on the two call sites listed here — they were part of the same original
finding and were not covered by that fix.

**Suggested fix:** route both through `quantizeRange()` before building the key, as
`alerts.queries.ts` does. The request still carries the caller's exact timestamps; only the
key rounds.

**Severity:** Medium — the cache is populated and never read on these pages, and entries
accumulate one per visit.

*(originally #5 in the parallel run, re-scoped after re-checking the source)*

---

### 18. Dead writes to a readonly `isLoading` warn on every load and refresh

```
Module:            Alerts -> Alert History, standalone page (§6.5)
UI path:           (no UI path) /web/alerts/history?org_identifier=<org>
What to check:     browser console on load and on each Refresh click
What to expect:    no Vue warnings
What you get:      [Vue warn] Set operation on key "isLoading" failed: target is readonly.
```

**Severity: Low** — console noise only. The visible behaviour is correct.

On `main`, `AlertHistory.vue` drove the table skeleton from a writable flag:

```ts
const loading = ref(false);   // main:498
loading.value = true;         // main:717
loading.value = false;        // main:763
```

This branch repointed `loading` at vue-query's readonly computed — which is the **right**
call, because `isLoading` is false whenever cached data exists, so the skeleton correctly
shows only on a cold read:

```ts
const loading = historyList.isLoading;    // AlertHistory.vue:528  <- readonly computed
// A request in flight while rows stay on screen — the refresh button's
// spinner. `loading` is the skeleton, which only a cold read wants.
const fetching = historyList.isFetching;  // :531
```

…but the two assignments from the old writable ref were left behind:

```ts
const fetchAlertHistory = async (force = false) => {
  loading.value = true;        // :742  <- no-op write to a readonly computed
  ...
  } finally {
    loading.value = false;     // :812  <- same
  }
};
```

**Measured** (standalone Alert History page, dev build, console):

```
[Vue warn] Set operation on key "isLoading" failed: target is readonly.   x6+
```

Vue drops the write, so nothing breaks — browser-verified that Refresh keeps all 20 rows on
screen with zero skeleton placeholders, which is exactly what `isLoading` is supposed to do.
The leftovers are just misleading to read and noisy in dev.

**Caused by this branch.**

**Suggested fix:** delete both assignments (`:742`, `:812`). Nothing else reads them.

---

### Not an issue — skeleton on the alert-detail "Alert History" tab

Worth recording because it looks like a caching failure and is not. On **Alerts → an alert →
Alert History tab**, clicking Refresh blanks the table to a skeleton instead of holding the
old rows. Browser-verified: rows drop **25 → 0**, 50 skeleton placeholders render for
~300 ms, then repaint.

`AlertEvaluationHistory.vue` binds `:loading` to a plain local flag flipped around *every*
fetch, so it cannot distinguish a cached read from a network one:

```ts
const loading = ref(false);     // AlertEvaluationHistory.vue:170
const fetchHistory = async (force = false) => {
  loading.value = true;         // :215
  ...
  } finally { loading.value = false; }   // :238
};
```

**This is identical on `main`** (`ref(false)` at main:169, same writes at 210/227) — the
branch changed only *how* the data is fetched (direct service call → `queryClient.fetchQuery`
with invalidate-on-force), not the loading flag. Not a regression, so not filed.

The cache is in fact working on this surface, and there is a clean way to see it: page 1 → 2
fires **1** request and blanks; page 2 → **back to 1** fires **0** requests and **never
blanks at all** (the cached read resolves before Vue paints). Contrast the standalone page,
which the branch did wire correctly and which keeps its rows on screen through a refresh.

---

### 19. External Alert Sources: the `/senders` fan-out was never migrated, so a warm revisit still costs N requests — 🕒 DEFERRED, not a blocker

> **Status: parked for a follow-up. Nothing is broken.** §6.7 passes C1–C8 and every smoke
> check; no wrong data, no stale rows, no error. The fan-out itself **exists on `main`**, so
> this is **not a regression** and should not block the PR. It is filed because this is a
> caching PR and this is the one page where the caching saves almost nothing — 1 request out
> of 24 — and a reviewer reading §6.7's request counts will want to know why they are so high.

```
Module:            Reliability -> External Alert Sources (§6.7)
UI path:           Left sidebar -> hover Reliability -> External Alert Sources
                   (needs O2_INCIDENTS_ENABLED=true; URL /web/alert-sources)
What to check:     Network tab on mount, on Refresh, and on a warm revisit
What to expect:    a warm revisit inside 30 s issues 0 requests
What you get:      0 list reads, but still one /senders request per row
```

**Severity: Medium** — not a regression, but the caching migration delivers almost nothing on
this page: 1 request saved out of 24.

**Measured** (23 sources, browser-verified):

```
                              list reads   /senders reads   TOTAL
cold load                          1            23           24
warm revisit (entry 6 s old)       0            23           23   <-- "0 requests" is not what happens
Refresh button                     1            23           24
'r' shortcut                       1            23           24
```

**Exactly what triggers the fan-out** (browser-verified, 23 sources) — it is bounded to
mount and refresh, *not* every interaction, and it does **not** leak into other modules:

```
                              list reads   /senders reads
page 1 -> 2 -> 1                   0             0
sort by Name                       0             0
type in search / clear it          0             0
idle 12 s                          0             0        <- nothing polls
while on Logs / Dashboards /
  Traces / Home                    0             0        <- no leak outside the page
--------------------------------------------------------
mount (cold)                       1            23
warm revisit from another module   0            23        <- repeats on EVERY return
Refresh button / 'r'               1            23
```

So work *inside* the page is free; it is arriving on the page that costs N. Ten round trips
through this page cost 230 uncached requests. Note it fetches **all** rows, not the visible
ones — 23 calls with a page size of 20 — so the count tracks the org's total, and page size
does not bound it. The calls go out concurrently via `Promise.all`, so it is 23 parallel
requests rather than a serial waterfall.

**Cause.** `alertSourcesQuery` caches only the collection read:

```ts
export const alertSourcesQuery = (org: string) =>
  queryOptions({
    queryKey: alertSourceKeys.list(org),
    queryFn: async (): Promise<any[]> => (await alertSources.list(org)).data?.integrations ?? [],
    refetchOnWindowFocus: true,
  });
```

The per-row status read is issued straight from the component, outside the query layer —
`ExternalAlertSourcesList.vue:578` and `:594` both call `alertSources.listSenders(...)` in a
loop over the rows. There is **no `senders` entry in `alert_sources.querykeys.ts` at all**, so
nothing dedupes or caches it, and it re-runs on every mount.

**Attribution — the fan-out itself is pre-existing.** `main`'s `ExternalAlertSourcesList.vue`
makes the same per-row calls at lines 556 and 572. What belongs to this branch is the *scope*
decision: the single cheap call was migrated, the N expensive ones were not. On `main` a
revisit cost `1 + N`; here it costs `0 + N`.

**Why it matters beyond this page.** The count scales with the number of sources. A customer
with 200 integrations pays 200 requests every time they open or refresh the page, and the
work in this PR does not reduce that. It also makes the plan's generic "warm revisit -> 0
requests" expectation untrue for this page, which is a testing trap.

**Concrete fix (frontend-only, contained to 3 files).** Add the key — it nests under the
existing `all` scope, so current invalidations already cover it:

```ts
// alert_sources.querykeys.ts
export const alertSourceKeys = {
  all: (org: string) => orgKey(org, "alerts", "sources"),
  list: (org: string) => orgKey(org, "alerts", "sources"),
  senders: (org: string, id: string) => [...orgKey(org, "alerts", "sources"), "senders", id],
};
```

```ts
// alert_sources.queries.ts
export const alertSourceSendersQuery = (org: string, id: string) =>
  queryOptions({
    queryKey: alertSourceKeys.senders(org, id),
    queryFn: async () => (await alertSources.listSenders(org, id)).data?.senders ?? [],
  });
```

Then have `fetchSenders` / `fetchAdditionalStatus` read through `queryClient.fetchQuery(...)`
instead of calling the service directly — the same pattern `fetchIntegrations` already uses on
this page, which also makes `force` reach both halves instead of only the list.

Result: a warm revisit costs **0** instead of 23, with no behaviour change — the status column
would be at most 30 s stale, exactly as the name and destination columns on that page already
are.

**Better long-term fix:** fold `last_received_at` into the list response server-side and delete
the fan-out. The status column only computes `getAlertSourceStatus(s.last_received_at, now)`,
so one timestamp per row is all it needs — that takes the page from 24 requests to 1 and
removes the N+1 rather than caching around it.

**Evidence the omission was an oversight, not a decision:** `alert_sources.querykeys.ts`
defines only `all` and `list` — there is no `senders` key and no comment anywhere explaining
the exclusion. Deliberate opt-outs in this branch are documented; `destinationsQuery` carries
a docblock stating exactly why it stays memory-only. This has none. The page is also
internally inconsistent: names and destinations are served from a 30 s cache while the status
column refetches every time.

**Everything else on this page passed** — C1-C8 all green (including C6 create and C7
delete-then-return, which the plan had wrongly marked out of scope), sort/paging/search all
client-side at 0 requests, the table never blanks, and the bearer tokens are **not** persisted
to localStorage or IndexedDB.

---

### 20. Folder-scoped lists double-fetch on every mount — the reactive key fires before the folder is resolved (SLOs **and** Synthetics) — ✅ FIXED

```
Module:            SLOs (§7)
UI path:           Left sidebar -> hover Reliability -> SLOs
What to check:     Network tab on a cold load
What to expect:    1 request (main made exactly 1)
What you get:      2 - GET /{org}/slos  AND  GET /{org}/slos?folder=default
```

**Severity: Medium.** Not a correctness bug — the rows are right — but it doubles the request
count on every cold mount of the page and leaves a wasted cache entry behind, in a PR whose
whole purpose is reducing requests.

**Measured** (browser, CDP network panel, cold load of `/web/slos`):

```
GET /api/default/slos                  <- fired by the reactive key while readFolder is undefined
GET /api/default/slos?folder=default   <- fired again once load() sets the folder
```

Reproduced on three separate paths: cold page load, a stale (>30 s) revisit, and the
navigation back to the list after a create. Every mount pays it.

**Cause.** `readFolder` is initialised to `undefined`, and the query key is reactive:

```ts
const readFolder = ref<string | undefined>(undefined);          // SloList.vue:473

const slosList = useQuery(() =>
  Object.assign(slosQuery(readOrg.value, readFolder.value), { enabled: !!readOrg.value }),
);                                                              // :475
```

`enabled` is true as soon as the org is known, so the query fires immediately with
`folder = undefined`. The key builder maps that to a distinct entry —

```ts
list: (org, folder) => orgKey(org, "slos", "list", folder ?? "all"),
```

— so it is `[…,"slos","list","all"]`. Then `load()` runs:

```ts
readFolder.value = folderId ?? activeFolderId.value;            // :812  -> "default"
await nextTick();                                               // key changes -> second fetch
```

The first response is never rendered: by the time it lands the key has moved to
`[…,"slos","list","default"]`. It still occupies a cache entry until `gcTime` reclaims it.

**Caused by this branch.** `main` fetched once, inside `load()`, with the folder already
resolved:

```ts
const res = await sloService.list(currentOrg, folder);          // main:771
```

There was no reactive key to fire early. The regression is a side effect of moving to
`useQuery` without gating on the folder being known.

**Suggested fix:** hold the query until the folder is resolved, the same way it already gates
on the org —

```ts
{ enabled: !!readOrg.value && readFolder.value !== undefined }
```

— and set `readFolder` from `activeFolderId` at setup rather than leaving it `undefined`.
Either alone removes the wasted request; both together also stop the `"all"` entry from ever
being created.

**Second instance — Synthetics (§11): same root cause, but the fix above must NOT be reused.**

`SyntheticMonitoring.vue` repeats the pattern exactly:

```ts
const readFolder = ref<string | undefined>(undefined);            // SyntheticMonitoring.vue:495

const monitorsList = useQuery(() =>
  Object.assign(syntheticsMonitorsQuery(orgIdentifier.value, readFolder.value), {
    enabled: !!orgIdentifier.value,
  }),
);                                                                // :497
```

Measured on a cold load of `/web/synthetics` — the same two-request shape as SLOs:

```
GET /api/default/synthetics                  <- fired while readFolder is undefined
GET /api/default/synthetics?folder=default   <- fired again once initPage() resolves the folder
```

⚠️ **Do not apply `readFolder.value !== undefined` here.** On this page `undefined` is a
*meaningful* value, not merely an unresolved one: it is the "All folders" search mode.

```ts
const targetFolder =
  folderId !== undefined
    ? folderId
    : searchAcrossFolders.value
      ? undefined                 // <- deliberate: "every folder"
      : activeFolderId.value;
readFolder.value = targetFolder;                                  // :525-530
```

Gating on `readFolder.value !== undefined` would leave the query permanently disabled
whenever the user selects **All folders**, so the table would stop loading in that mode
entirely. SLOs have no such mode — `readFolder.value = folderId ?? activeFolderId.value`
(`SloList.vue:813`) can never be deliberately `undefined` — which is exactly why the one-line
gate is safe there and unsafe here.

**Fix for Synthetics:** distinguish "not resolved yet" from "deliberately all folders" with an
explicit flag instead of overloading `undefined`:

```ts
const folderResolved = ref(false);
// in loadMonitors(), alongside `readFolder.value = targetFolder`:
folderResolved.value = true;
// on the query:
{ enabled: !!orgIdentifier.value && folderResolved.value }
```

**Knock-on effect — latent, not user-visible today.** On Synthetics the wasted `"all"` entry
is not merely wasted: the single-monitor delete splices only the *scoped* key, so the `"all"`
entry keeps the deleted monitor.

```ts
queryClient.setQueryData<any[]>(
  syntheticsKeys.monitors(orgIdentifier.value, readFolder.value),  // :1322 - the "default" key only
  (old) => (old ?? []).filter((mon: any) => String(mon.id) !== String(m.id)),
);
```

Measured directly against the query cache, immediately after deleting a check through the UI:

```
key "default":  8 monitors, deleted row absent      <- correct
key "all":      9 monitors, deleted row PRESENT, fresh (age 4 s, not stale)
```

It does not surface today: on remount the folder-scoped read overtakes it inside 100 ms, and a
40-sample sweep across 4 s caught **0 frames** showing the deleted row (C7 passes). But only
timing hides it — a slower folder resolution would paint the deleted check. Removing the
double-fetch removes the bad entry and this latent risk together.

**Fix applied — two different fixes, because `undefined` means different things in the two files.**

```ts
// SloList.vue — undefined only ever means "not resolved yet" here
enabled: !!readOrg.value && readFolder.value !== undefined,

// SyntheticMonitoring.vue — undefined is the "All folders" scope, so a separate flag
const folderResolved = ref(false);          // set in loadMonitors(), the sole readFolder writer
enabled: !!orgIdentifier.value && folderResolved.value,
```

**Verified live, before and after:**

| | Before | After | `main` |
| --- | --- | --- | --- |
| SLOs cold load | **2** requests | **1** (`?folder=default`) | 1 |
| Synthetics cold load | **2** requests | **1** (`?folder=default`) | 1 |
| The `"all"` entry | 36 / 57 rows fetched, **0 observers** | **empty placeholder, no request** | n/a |
| All-folders mode | 57 rows | **57 rows — still works** | works |

**The All-folders regression was specifically checked**, since it is what the naive one-liner would
have broken: toggling **All folders** issues `GET /synthetics` unscoped and returns **57** (the
cross-folder set) against **53** in folder scope, and toggling back returns to 53. Both directions
repaint correctly.

**Safe by construction on Synthetics:** `readFolder` has exactly **one** assignment site
(`loadMonitors`, line 612) and `folderResolved` is set on the next line, so no path can leave the
query permanently disabled.

**SLOs has no All-folders mode** — confirmed in the live DOM (`hasAllFoldersToggle: false`,
`hasThisFolderToggle: false`, zero folder-scope buttons) as well as in code
(`readFolder.value = folderId ?? activeFolderId.value` can never be deliberately `undefined`).

**Verification:** `vue-tsc --noEmit` exit 0 · SLO + Synthetics + service specs **10 files / 210
tests passing** · cold-load request counts measured via CDP on both pages · All-folders and
folder-switch cycles exercised through the real UI.

**Everything else in §7 passed** — C2/C4/C6/C7/C8 all green, sort/paging/search client-side at
0 requests, the table never blanks, and `r` correctly does nothing (this page registers no
shortcuts).

---

### 21. Pipelines list renders EMPTY on load — the data is cached but never reaches the table — ✅ FIXED

> **FIXED on this branch.** `filteredPipelines` is now a **computed** derived from the query
> instead of a ref hand-assigned by `updateActiveTab()`, and `updateActiveTab()` keeps only its
> real side effects (reset expanded row, swap the column set). 7 insertions / 11 deletions in
> `PipelinesList.vue` — net fewer lines.
>
> ```ts
> // Derived, not assigned: a copy written only by updateActiveTab() is empty on a
> // cold mount, because that runs before the query resolves and nothing re-runs it.
> const filteredPipelines = computed<any[]>(() =>
>   activeTab.value === "all"
>     ? pipelines.value
>     : pipelines.value.filter((pipeline: any) => pipeline.source.source_type === activeTab.value),
> );
>
> const updateActiveTab = () => {
>   expandedId.value = [];
>   columns.value = getColumnsForActiveTab(activeTab.value);
> };
> ```
>
> **Verified:** cold load now renders **22 rows on the All tab with no tab click** (was
> *"Create your first pipeline"*, 0 rows); `vue-tsc --noEmit -p tsconfig.app.json
> --composite false` clean; `PipelinesList.spec.ts` **64/64** passing; no remaining writes to
> `filteredPipelines` and all three readers untouched.
>
> Also fixes two latent faults beyond the reported symptom: **Refresh** now repaints without
> needing `updateActiveTab()`, and **invalidation-driven repaints** after a create/delete work
> automatically — both previously required a tab click. This restores the contract the file
> already stated: *"The list is the query, not a copy of it."*

The original finding is kept below for history.

```
Module:            Pipelines -> Pipelines (§9.1)
UI path:           Left sidebar -> Data -> Pipelines   (/web/pipeline)
What to check:     open the page
What to expect:    the pipeline rows
What you get:      an empty table - "Showing 0 - 0 of 0", summary all "—"
                   while the query cache holds every row
```

**Severity: HIGH — the page is unusable as it lands.** Not a request-count nit: a user with 22
pipelines sees none of them. The only way to make the list appear is to click one of the
All / Scheduled / Realtime tabs.

**Measured on a clean load of `/web/pipeline`:**

```
query status                 success
query holds                  22 rows
table rows rendered          0            <-- 
summary                      "— Errored — Paused — Active — Total"
pager                        "Showing 0 - 0 of 0"
empty-state shown            false        <-- not even the "no pipelines" state; just blank

then click any tab (All / Scheduled / Realtime):
table rows rendered          20
summary                      "0 Errored 0 Paused 21 Active 21 Total"
requests fired               0            <-- the data was already there
```

**Cause.** The query feeds a *computed*, but the table reads a hand-assigned *ref* that only
`updateActiveTab()` ever writes:

```ts
const pipelines = computed(() => shapePipelines(pipelinesList.data.value ?? []));  // :617 reactive
const filteredPipelines: any = ref([]);                                            // :650 NOT reactive
const updateActiveTab = () => { ... filteredPipelines.value = pipelines.value; ... } // :817
```

On mount:

```ts
onMounted(async () => {
  await getPipelines();   // :1003
  updateActiveTab();      // :1004
});

const getPipelines = async (force = false) => {
  if (force) await pipelinesList.refetch();   // force is FALSE on mount
  await nextTick();                           // ...so this awaits nothing
};
```

With `force = false`, `getPipelines()` does **not** wait for the in-flight query — it only ticks.
So `updateActiveTab()` runs while `pipelinesList.data` is still undefined and copies an **empty**
array into `filteredPipelines`. When the query resolves moments later, `pipelines` (the computed)
updates correctly — but **nothing re-runs `updateActiveTab()`**, so `filteredPipelines` stays
`[]` forever. The only watchers in the file are on the route name and on `pipelinesList.error`;
there is **no watcher syncing `pipelines` -> `filteredPipelines``**.

Refresh does not rescue it either — `refreshPipelines = () => getPipelines(true)` awaits the
refetch but never calls `updateActiveTab()`, so the table stays empty (verified: 1 request, still
0 rows).

The comment above `getPipelines` states the intended contract —

> *"Mount and invalidation-driven repaints come from the query itself."*

— which is exactly right, and exactly what the manually-assigned `filteredPipelines` ref breaks.

**Caused by this branch.** On `main`, `getPipelines()` awaited the HTTP call and assigned the
rows itself, so `updateActiveTab()` always ran with real data:

```ts
const getPipelines = async () => {                       // main:951
  const response = await pipelineService.getPipelines(...);
  pipelines.value = response.data.list.map(...);         // assigned BEFORE updateActiveTab()
};
```

**Suggested fix — pick one:**

1. **Best:** make the filter derived rather than assigned, which removes the whole class of bug:
   ```ts
   const filteredPipelines = computed(() =>
     activeTab.value === "all"
       ? pipelines.value
       : pipelines.value.filter((p) => p.source.source_type === activeTab.value));
   ```
2. **Smallest safe fix:** `watch(pipelines, updateActiveTab, { immediate: true })` — also covers
   invalidation-driven repaints, which today only work if a tab happens to be clicked.
3. Make `getPipelines()` await the query even when not forced (`await pipelinesList.suspense()`).
   This fixes the mount path but leaves post-invalidation repaints broken.

**Testing workaround until it is fixed:** click any tab once after the page loads; the rows
appear with 0 requests, and the rest of §9.1 can then be tested normally.

---

### 22. Saving or importing a pipeline leaves the list stale — no writer invalidates the cache — ✅ FIXED

```
Module:            Pipelines -> Pipelines (§9.1, check C6)
UI path:           Data -> Pipelines -> New pipeline / Import, save, return to the list
What to check:     is the new or edited pipeline on the list?
What to expect:    "Back on the list, the pipeline is already there — no manual refresh"
What you got:      stale rows; a manual Refresh was required
```

**Reported by the user during hands-on testing**, after this row had been (wrongly) marked as
covered — see the process note at the end.

**Measured before the fix:**

```
server has                                   25 pipelines
list shows                                   24
editor -> list round trip (what Save does)   0 requests, still 24, new pipeline absent
```

**Cause.** `PipelineEditor.vue` had **no contact with the query cache at all** — no
`queryClient`, no `pipelineKeys`, no `invalidate`. It called the service then `router.push`ed
back to the list. The list's route watcher runs `getPipelines()` with `force = false`, which
refetches nothing, so the 30 s-fresh cached list repainted without the new row.

`ImportPipeline.vue` had the same gap with worse wiring: it emits `update:pipelines` after each
import, but **nothing anywhere listens to that event** — Import is its own route, so the list is
not mounted to hear it.

`PipelinesList.vue`'s own inline create was already correct (`getPipelines(true)` forces).

**Fix.** One invalidation in each writer, at the top of the success handler so it covers every
branch:

```ts
void queryClient.invalidateQueries({
  queryKey: pipelineKeys.all(store.state.selectedOrganization.identifier),
});
```

**Verified:** after the fix the editor->list round trip fires **1** request, total 25 -> 26, and
the new pipeline is on the list. A plain navigation back to the list still fires **0** requests,
so C2 is unaffected — only an actual save invalidates. `vue-tsc --noEmit` clean;
`PipelinesList.spec.ts` + `ImportPipeline.spec.ts` **171/171** passing.

**Process note — why this was missed.** C6 was marked *"Not automated — the invalidation path it
shares with delete is proven by C7."* That inference was wrong: C7 (delete) runs in
`PipelinesList.vue` and forces a refetch, while C6 runs in `PipelineEditor.vue`, a different
component on a different route that never touched the cache. They share no path. The canvas was
genuinely not automatable, but the **invalidation** was — via `POST` + a route round trip, which
is how it was eventually measured. **An unrun check must be recorded as NOT TESTED, never as a
pass with a rationale**; the rationale is what stops anyone re-checking it.

---

### 23. Pipeline destinations: a deleted row stays on the list — the delete never invalidates — ✅ FIXED

```
Module:            Settings -> Pipeline Destinations (§9.2, check C7)
UI path:           Left sidebar -> Settings -> Pipeline Destinations
What to check:     delete a destination, then navigate away and come straight back
What to expect:    "Gone immediately and still gone on return"
What you got:      the deleted row stayed on screen, and survived the round trip
```

**Severity: High.** This is the exact check the plan flags as *"most likely regression"*, and it
fails: the server deletes the destination, the UI keeps showing it, and navigating away and back
does not correct it. Destinations sit in the **5-minute** `CONFIG_STALE_TIME` tier, so the stale
row persists for a long time.

**Measured before the fix:**

```
DELETE fired                    1
list refetches                  0        <--
row gone from the table         no
after navigate away + back      still listed  (11 rows; server had 10)
```

**Cause.** The delete goes straight through the service rather than the mutation layer, so
nothing invalidates the scope:

```ts
destinationService.delete({ ... }).then(() => { toast(...); getDestinations(); });
```

and `getDestinations()` **without force** ends in `queryClient.fetchQuery(options)`, which
answers from cache while the entry is fresh — returning the list that still contains the deleted
row. `deleteDestinationMutation` exists and carries
`meta: { invalidates: [destinationKeys.all(org)] }`, but this component does not use it.

Both delete paths were affected — the single-row delete **and** the bulk delete.

**Why create (C6) passed but delete did not.** The editor saves through
`saveDestinationMutation`, whose `meta.invalidates` is applied by the global
`MutationCache.onSuccess` handler in `queryClient.ts`. Creates therefore refresh the list for
free; deletes bypass that path entirely.

**Caused by this branch.** On `main`, `getDestinations()` issued a real
`destinationService.list(...)` call every time, so a delete always refetched.

**Fix.** Force both delete paths, matching what the sibling `AlertsDestinationList.vue` already
does — that file even documents the trap: *"Forced: this branch exists to hear it from the
server, and an unforced read inside staleTime answers from cache without asking."*

```ts
getDestinations(true);   // single delete (:455) and bulk delete (:639)
```

**Verified after the fix:** 1 `DELETE` + **1 list refetch**, row gone immediately (10 -> 9), and
**still gone after navigating away and back with 0 requests**. `vue-tsc --noEmit` clean;
`PipelinesDestinationList.spec.ts` 36 passed / 4 skipped.

**Worth a follow-up:** the idiomatic fix is to route these writes through
`deleteDestinationMutation` / `bulkDeleteDestinationsMutation` so the declarative
`meta.invalidates` applies, rather than relying on each caller remembering `force`. The same
question applies to the pipeline writers in #22.

---

### 24. Synthetics list could never render — the query unwrapped the wrong response field — ✅ FIXED

```
Module:            Synthetics (§11)
UI path:           Left sidebar -> hover Reliability -> Synthetics
What to check:     The checks table on any load
What to expect:    The seeded checks listed
What you get:      "Create your first Check / No checks found" - always, with data present
```

**Severity: High.** The page was unusable. The list endpoint returned `200` with the full set
of checks and the table still rendered its onboarding empty state, so no check could be seen,
edited, deleted, moved or run from the UI at all.

**Cause.** The cached read unwrapped `.monitors`, but the endpoint returns `.checks`:

```ts
queryFn: async (): Promise<any[]> =>
  ((await syntheticsService.listByFolderId(org, folderId)).data as any)?.monitors ?? [],
```

`data.monitors` is `undefined`, so the `?? []` fired on every response and the query resolved
to an empty array. That is a *successful* empty read — which is why nothing errored, no retry
ran, and the page looked like a legitimately empty account.

**Caused by this branch.** `main` reads the field correctly, and has since `f16e8e53ff`:

```ts
const rows = (res.data as any).checks ?? (res.data as any).monitors ?? [];   // main
```

Introduced by `58d0a35905` ("refactor(query): declare cached reads beside the endpoints they
call"), which dropped the `.checks` half while moving the read onto the query layer, and
carried verbatim into `web/src/services/synthetics.queries.ts` by `4defa00ce3`
("refactor(web): replace the defineQuery facade with plain TanStack options"). Both commits
exist only on `feat/fe-caching`.

**Fix applied** — restores `main`'s order, keeping `monitors` as the fallback:

```ts
// The list endpoint returns `checks`; `monitors` is the older name kept as a fallback.
queryFn: async (): Promise<any[]> => {
  const data = (await syntheticsService.listByFolderId(org, folderId)).data as any;
  return data?.checks ?? data?.monitors ?? [];
},
```

The `??` chain means a response carrying either field still works, and a missing/empty
response still yields `[]`, so the change is strictly more permissive than what it replaced.

**Verified:** `vue-tsc --noEmit -p tsconfig.app.json --composite false` exit 0 ·
`SyntheticMonitoring.spec.ts` + `synthetics.spec.ts` **72/72 pass** · the live page went from
the empty state to **10 rows**, pager reading "10 Checks".

⚠️ Those 72 specs passed *before* the fix as well — nothing in the suite covers the unwrap,
which is how this shipped. A regression here would still not be caught by tests.

---

### 25. Saved org settings silently revert on the next org switch — the write never invalidates the cached read — ✅ FIXED

```
Module:            Settings -> General / Organization (§15.1)
UI path:           Settings -> General -> change Scrape Interval -> Save -> switch org -> switch back
What to check:     The saved value is still there
What to expect:    It is (main always re-read from the server)
What you get:      The setting REVERTS to its pre-save value for up to 5 minutes.
                   The server has the new value; the UI shows the old one.
```

**Severity: High.** Silent data-looking loss. The save genuinely succeeded server-side, the toast
says so, and then the UI quietly shows the old value again — so the user believes the setting did
not stick, and may "fix" it repeatedly. It affects everything `organizationSettings` feeds:
scrape interval, span/trace id field names, theme colours, streaming/websocket toggles.

**Measured** (browser, values read from server, Vuex and the query cache at each step):

```
baseline     cached 33   vuex 33   server 33     (all agree)
after save   cached 33   vuex 44   server 44     cache NOT invalidated, and NOT stale by time
MainLayout re-read (its own line, verbatim)
             vuex 33               server 44     <- reverted
```

**Cause.** This PR turned a direct read into a cached one and did not add an invalidation on the
write. `MainLayout.getOrganizationSettings()` — which its own comment says runs "on every org
switch" — now serves from a 5-minute entry:

```ts
// branch: MainLayout.vue:1073
const orgSettings: any = {
  data: await queryClient.fetchQuery(orgSettingsQuery(store.state?.selectedOrganization?.identifier)),
};
store.dispatch("setOrganizationSettings", { ... });   // stale value lands in Vuex
```

`orgSettingsQuery` carries `CONFIG_STALE_TIME` (5 min), so within that window `fetchQuery` returns
the **pre-save** payload and dispatches it straight into Vuex, overwriting the value the save just
put there. The settings pages read Vuex, so the UI reverts.

Nothing repairs it: the only references to the settings key in the whole app are the import and
that one `fetchQuery`. `General.vue`'s save handler POSTs and shows a toast — no
`invalidateQueries`, no `setQueryData`, no refetch. Same for `OrganizationSettings.vue` and
`DomainManagement.vue`.

**Caused by this branch.** `main` re-read from the server every time, so a stale value was
impossible:

```ts
// main: MainLayout.vue:1070
const orgSettings: any = await organizations.get_organization_settings(
  store.state?.selectedOrganization?.identifier,
);
```

**Fix applied** — the settings scope is dropped at **all four** `post_organization_settings` call
sites, restoring the invariant `main` got for free:

```ts
await organizations.post_organization_settings(orgId, payload);

// MainLayout re-reads this scope on every org switch and would serve the pre-save payload back.
await queryClient.invalidateQueries({ queryKey: organizationKeys.settings(orgId) });
```

| File | Scope invalidated | Verified |
| --- | --- | --- |
| `settings/General.vue` | current org | **Live** — click path + org switch |
| `settings/OrganizationSettings.vue` | current org | **Live** — click path + org switch |
| `enterprise/components/billings/usage.vue` | current org | **Live** — click path + org switch |
| `settings/DomainManagement.vue` | **meta org** (that is what it writes) | **Spec** — writes live SSO config, deliberately not exercised |

**Each site was proven defective before the fix, not pattern-matched.** `General.vue` and
`OrganizationSettings.vue` reverted through the real UI (`44`→`45`, `trace_id_probe`→`trace_id`).
`DomainManagement.vue` and `usage.vue` were proven by spying on `queryClient.invalidateQueries`
inside their **existing** specs while driving their real save handlers — **0 calls** at `HEAD`,
passing with the fix. That temporary spec instrumentation was reverted and is **not** shipped.

⚠️ **`usage.vue` is reachable on self-hosted after all.** An earlier note in this campaign called
billing "cloud-only, untestable" — wrong. Only the **sidebar link** is gated
(`v-if="config.isCloud === true"`); the route is registered unconditionally, so
`/web/billings/usage?org_identifier=<org>` loads fine. The enable flow writes
`post_organization_settings`, not a billing endpoint, so the 404s on billing data are irrelevant
to it. Measured live: `cacheInvalidated: true`, and after an org round trip `REVERTED: false`.

**Verification:** `vue-tsc --noEmit` exit 0 · settings + billings specs **43 files / 1632 tests
passing** · live before-and-after on three of the four pages. Note the suite passed *before* the
fix too — nothing covers this path, which is how it shipped.

**Why the visible §15.1 checks still pass.** "Change a setting and save → reflected everywhere
without a reload" passes on its own, because the save also dispatches the new value into Vuex and
every consumer reads Vuex. The revert only appears once something re-runs
`getOrganizationSettings()` — an org switch — which that row does not exercise.

---

### 26. Nodes page renders EMPTY on every warm visit — cached data never reaches the table, and Refresh does not fix it — ✅ FIXED

```
Module:            Settings -> Nodes (§15.2, _meta org)
UI path:           Settings -> Nodes -> navigate away -> come back
What to check:     The node rows
What to expect:    The cluster's nodes (main showed them on every visit)
What you get:      "No nodes available" — and clicking Refresh does NOT repair it,
                   even though the request fires and returns 200 with the node.
```

**Severity: High.** The page is unusable on any warm visit. The cluster is healthy, the API
returns the node, the query cache holds it — and the operator is told there are no nodes. Because
Refresh does not help either, the only escape is a full page reload.

**Measured** (browser, `_meta` org, one Online node `6ee6fb41b69a`):

```
cache            status "success", data present (group "zo1"), age 27 s -> FRESH
table            0 rows, "No nodes available"
click Refresh    GET /_meta/node/list -> 200, dataUpdateCount 6 -> 7
table            STILL 0 rows
```

**Cause — a non-immediate watcher plus TanStack's structural sharing.** The table is fed by
copying query data into local state:

```ts
// Nodes.vue — no `immediate: true`
watch(nodesList.data, (data: any) => {
  if (data) applyNodes(data, lastFilterFlag.value);
});
```

On a warm remount `nodesList.data` **already holds** the cached value, so there is no *change* and
the watcher never fires — `applyNodes()` is never called and the table's local state stays empty.
Refresh cannot rescue it either: TanStack v5 uses **structural sharing**, so a refetch that returns
identical data hands back the *same object reference*. `dataUpdateCount` increments (7 above) but
the watched ref does not change, so the watcher stays silent.

A second, compounding gate: `hasRequested` is a component-local `ref(false)` that resets on every
remount, and the query is `enabled: hasRequested.value && !!orgIdForList.value`. So the query is
also disabled until something calls `getData()`. Fixing only that would still leave the table empty,
because the watcher problem is independent.

**Caused by this branch.** `main` had no query and no watcher — `getData()` fetched and assigned the
table directly, so every visit painted:

```ts
// main: Nodes.vue:892
CommonService.list_nodes(store.state.selectedOrganization.identifier).then((response) => {
  const { flattenedData, uniqueValues } = flattenObject(response.data);
  tabledata.value = flattenedData;   // assigned unconditionally, every time
});
```

**Fix applied** — the watcher now fires for data that is already present:

```ts
watch(
  nodesList.data,
  (data: any) => {
    if (data) applyNodes(data, lastFilterFlag.value);
  },
  // Immediate: on a warm remount the value is already there, so a change-only watcher never fires.
  { immediate: true },
);
```

**Verified live, same scenario that failed:**

| Step | Before | After |
| --- | --- | --- |
| Warm the cache (Refresh) | 1 row | 1 row |
| Navigate away and back | **0 rows, "No nodes available"** | **1 row, 0 requests** |
| First sampled frame on return | 0 | **1** — paints straight from cache |
| Refresh on a populated cache | **stayed 0 rows** | **1 row**, 1 request |

`vue-tsc --noEmit` exit 0 · `Nodes.spec.ts` **28/28 passing**.

**Audit of every other `watch(query.data, …)` — 2 more lack `immediate`, and neither is broken.**
Nine such watchers exist; seven already pass `{ immediate: true }`. The two that do not are
`ServiceAccountsList.vue:785` and `ReportList.vue:527` — **both were tested and both repaint
correctly**, so they were deliberately left alone rather than "fixed" on pattern match:

```
Reports, cache provably fresh (age 0.4 s, not stale):
  revisit -> 0 requests, 20 rows from the FIRST sampled frame, never zero
Service accounts (§14.5 C2): revisit -> 0 requests, 20 rows
```

**Why Nodes broke and they do not.** A missing `immediate` only bites when the query is *also
disabled* on remount. Nodes gates on `enabled: hasRequested.value && …`, and `hasRequested` is a
component-local `ref(false)` that resets, so `data` stayed `undefined` forever — no transition, no
watcher, empty table. Reports and service accounts keep their queries enabled, so on remount
`data` goes `undefined → cached value`, and *that* counts as a change which fires the watcher.
Service accounts is additionally insulated by `serviceAccountsState`, a module-level `reactive()`
singleton that survives the remount.

Adding `{ immediate: true }` to those two would be harmless hardening — it removes the reliance on
that transition — but it is **not** a bug fix, and this issue does not claim they are defective.
Same defect family as **#21**; the accurate rule is *a `watch(query.data, …)` feeding local state
needs `immediate: true` whenever the query can be disabled on mount.*

**Not part of this issue — a pre-existing cold-load gap.** On a cold URL load the initial fetch is
skipped entirely because the one-shot `if (isMetaOrg.value) { getData(false); }` runs at setup
before the org store hydrates, and nothing retries. That guard is **byte-identical on `main`**
(`main:927`), and neither version has a watcher on `isMetaOrg`/`selectedOrganization`, so it is
pre-existing rather than a regression. Not filed.

---

### 27. ✅ FIXED — AI Toolsets shows persisted data forever on a cold load (imperative read bypasses staleTime)

```
Module:            Settings -> AI Toolsets (§15.6)
UI path:           Settings -> AI Toolsets, hard-reload the page
What to check:     The list against the server
What to expect:    The server's toolsets (main re-fetches on every load)
What you get:      Whatever localStorage last held — however old — and NO revalidation.
                   A deleted toolset stays listed indefinitely until Refresh is clicked.
```

**Severity: Medium** (downgraded from High — see reachability below). Silently wrong data presented
as current. The list is stale with no spinner, no error and no indication anything is out of date, so
there is nothing to prompt the user to refresh. Entries deleted by anyone — another tab, another
user, this user before a reload — keep appearing.

⚠️ **Reachability caps the practical impact.** The AI Toolsets page has **no link anywhere in the
UI**: the Settings sidebar (`components/settings/index.vue`) lists 13 entries and `aiToolsets` is not
one of them, and no other component navigates to the route — the only match is the page routing to
itself after a save. It is reachable **only by direct URL**
(`/web/settings/ai_toolsets?org_identifier=<org>`) or a bookmark. That is **not a branch
regression**: `main`'s sidebar has the same 13 entries and likewise zero `aiToolsets` references, so
the page was routed but never wired into navigation. The defect and the fix are unchanged; only the
odds of a user meeting it are low.

**Measured side by side against a running `main`, same backend, same moment:**

```
server truth: 25 toolsets  (cachetest_ts_whiskey deleted)
persisted cache: 26, aged to 20.7 min (well past the 5-minute CONFIG_STALE_TIME)

main   (:8083)   GET /api/default/ai/toolsets fired -> "Showing 1 - 20 of 25", deleted row ABSENT
branch (:8081)   no toolsets request at all       -> "Showing 1 - 20 of 26", deleted row STILL LISTED
```

**Cause — the mount read races org hydration, and nothing retries it.** `AiToolsets.vue` calls
`getData()` once at setup, and its first statement reads the org off the store:

```ts
const getData = (force = false) => {
  const org = store.state.selectedOrganization.identifier;   // <- runs before the org resolves
  const options = aiToolsetsQuery(org);
  const cached = queryClient.getQueryData<any[]>(options.queryKey);
  if (cached !== undefined) applyToolsets(cached);           // paints the persisted list
  ...
  queryClient.fetchQuery(options)                            // never reached / wrong key
```

Instrumenting a cold load shows `store.state.selectedOrganization` **unresolved for ~4592 ms**, and
the console carries one `Uncaught (in promise)`. With the object missing the first line throws
`TypeError: Cannot read properties of undefined (reading 'identifier')`; with it present but empty
the org is `undefined` and the key is wrong. Either way `fetchQuery` never runs for the real org.

Nothing repairs it afterwards: there is **no watcher on `selectedOrganization`**, and the only other
`getData()` call sites are the Refresh button, the `r` shortcut and post-write reloads. So the page
sits on the persisted snapshot for the whole visit.

`fetchQuery` itself is fine — invoked directly against the same stale entry it refetched correctly
and returned 26 → 25, so the caching layer is not at fault.

**Why `main` is unaffected despite identical-looking code.** `main` has the same setup-time
`getData()` and the same `selectedOrganization.identifier` read, but **no persistence and no cache**:
it calls the service on every load, so a cold visit always reaches the network and always paints the
truth. The branch added `persister: localStoragePersister` to `aiToolsetsQuery`, which turned a
harmless race into a silent-stale-data bug — the same shape as **#25** and **#26**: a read moved onto
the cache layer without the surrounding code being adjusted.

**✅ FIXED — converted to `useQuery`, the structural fix its own `TODO` called for.**

The imperative read is gone. `AiToolsets.vue` now declares the list as an observed query and derives
the rows from it, so `staleTime` is applied and a stale entry revalidates on mount:

```ts
const orgIdForList = useOrgId();
const toolsetsList = useQuery(() =>
  Object.assign(aiToolsetsQuery(orgIdForList.value), { enabled: !!orgIdForList.value }),
);

// The list is the query, not a copy: only an observer applies `staleTime` and revalidates on mount.
const tabledata: any = computed(() =>
  (toolsetsList.data.value ?? []).map((item: any) => ({ ... })),
);
const loading = toolsetsList.isPending;
const fetching = toolsetsList.isFetching;

const getData = async (force = false) => {
  if (force) await toolsetsList.refetch();
};
```

The `enabled` gate replaces the org-hydration watcher outright — an `enabled`-gated query re-evaluates
on its own when the org lands, so the race that caused the original throw cannot recur. The loading
and error toasts were preserved as watchers on `isPending` and `error`.

**Verified live on `:8081`, both directions:**

```
stale entry (backdated 12 min, 23 rows; server 24)
  -> reload: GET /api/default/ai/toolsets?limit=100000 200  (exactly one)
  -> UI "Showing 1 - 20 of 24", new toolset PRESENT

fresh entry (just written, 24 rows; server 24)
  -> reload: NO toolsets request at all
  -> UI "Showing 1 - 20 of 24"
```

Both halves matter: the first is the bug fixed, the second proves the persister still does its job —
a fix that simply refetched every load would have thrown away the caching this branch exists for.
Delete was re-checked through the UI afterwards (server 24 -> 23, row gone from the table).

`vue-tsc --noEmit -p tsconfig.app.json --composite false` exits 0; the AI-toolset specs pass (45).

**Toast paths verified.** The toasts moved from `.then`/`.catch` on the promise to watchers on
`isPending` and `error`, so both were re-tested by breaking the request at document-start (URL
rewritten to a 404) with the persisted cache cleared: the page shows **"Failed to load"** and its
"No AI toolsets yet" empty state, `Showing 0 - 0 of 0`. See **#28** for the loading-toast finding,
which applies to both pages.

---

### 28. ✅ FIXED — Destination Templates serves a stale persisted list on a cold load and never revalidates

```
Module:            Alerts -> Destination Templates (TemplateList.vue)
UI path:           Alerts -> Destination Templates, leave for >5 min, hard-reload
What to check:     The row count and contents against the server
What to expect:    The server's templates (main re-fetches on every load)
What you get:      The localStorage snapshot, however old, with NO request fired
```

**Severity: Medium-High.** Same root cause as **#27**, but unlike AI Toolsets this page is **linked
in the UI** and used routinely — Alerts -> Destination Templates. A template added, renamed or
deleted anywhere else stays wrong until the user happens to click Refresh, with no spinner, error or
staleness cue to suggest anything is out of date.

**Reproduced live on the branch (`:8081`), backend `:5080`:**

```
1. cold visit /web/alert-templates       -> GET /alerts/templates 200, "Showing 1 - 20 of 43"
                                            persisted as o2q-["org","default","alerts","templates"]
2. create one template out-of-band (API) -> server now 44, page untouched
3. backdate the persisted entry to 10 min old   (past CONFIG_STALE_TIME = 5 min)
4. hard reload
     UI              -> "Showing 1 - 20 of 43"      <- stale
     server          -> 44
     new template    -> ABSENT from the table
     network         -> NO /alerts/templates request at all
5. click Refresh     -> "Showing 1 - 20 of 44", new template present
```

Step 4 is the finding: the request is not merely late, it is **never made**. The same page load did
fire `GET /api/v2/default/alerts` and `GET /alerts/destinations` — both read imperatively too, but
**not persisted** — which isolates the persister as the differentiator rather than `fetchQuery`
alone.

**Cause.** `TemplateList.vue:419` builds `templatesQuery(org)` — persisted via
`localStoragePersister` at `services/alert_templates.queries.ts` — and reads it at line 439 with
`queryClient.fetchQuery(options)`. Because there is no observer, the persister's restore of the
`o2q-` snapshot satisfies the fetch during hydration and `staleTime` is bypassed. The file already
flags the shape at line 431: `// TODO: fold into 'useQuery' when this list drops its imperative refresh.`

The `force` path is unaffected — Refresh calls `getTemplates(true)`, which invalidates first, so the
restore no longer counts as fresh and a real request goes out. That is why step 5 recovers, and it is
the only workaround.

**Introduced by this branch.** `main` has no TanStack layer and no persister on this page: it calls
the service on every mount, so a cold visit always reaches the network.

**✅ FIXED — same conversion as #27.** The list moved onto `useQuery` with an `enabled` gate, the
rows became a computed over the query data, and the imperative `fetchQuery` was removed:

```ts
const orgIdForList = useOrgId();
const templatesList = useQuery(() =>
  Object.assign(templatesQuery(orgIdForList.value), { enabled: !!orgIdForList.value }),
);
// The rows are the query, not a copy: only an observer applies `staleTime` and revalidates on mount.
const templates = computed<Template[]>(() => (templatesList.data.value ?? []) as Template[]);
```

Three pieces of surrounding wiring had to move with it, and each is a trap worth recording:

1. **`dropTemplates` no longer splices `templates.value`.** The rows now render straight from the
   cache, so the existing `setQueriesData` prune is what removes them — the local mutation would have
   been overwritten on the next read anyway.
2. **The post-load work is keyed on `dataUpdatedAt`, not `data`.** An unchanged refetch returns the
   same object by structural sharing, so a value watcher would never wake and the "Used by" counts
   would silently stop refreshing — the same trap as **#26**.
3. **The watcher must be registered below `updateRoute`/`editTemplate`.** It runs `immediate: true`,
   so at its original position it hit those `const`s in the temporal dead zone and threw *during
   setup* — see the regression note below.

**Regression caught and fixed during this work.** The first version of the fix put that watcher above
the functions it calls. The throw aborted `setup()` part-way, which showed up only as three
`[Vue warn] ... no active component instance` lines and one bare `Uncaught (in promise)` — the table
still rendered, so nothing looked wrong. The user-visible break was that the deep link
`/web/alert-templates?action=update&name=<template>` no longer opened the editor. Confirmed by
stashing the change (HEAD opened the editor, the patched file did not), then fixed by moving the
watcher below `editTemplate`. Worth noting for review: **an aborted `setup()` in this app renders a
plausible-looking page**, so a working table is not evidence the component initialised.

**Verified live on `:8081`, both directions:**

```
stale entry (backdated 12 min, 43 rows; server 44)
  -> reload: GET /api/default/alerts/templates 200  (exactly one)
  -> UI "Showing 1 - 20 of 44", new template PRESENT

fresh entry (just written, 44 rows; server 44)
  -> reload: NO templates request at all
  -> UI "Showing 1 - 20 of 44"
```

Re-checked after the fix: Refresh fires one templates request plus the dep-graph reload; delete
removes the row and drops the server count (44 -> 43); the "Used by" counts render unchanged
(`cachetest_tmpl1` -> 3 destinations / 66 alerts, identical to HEAD); the `action=update` deep link
opens the editor on a hard load and on client-side navigation.

`vue-tsc --noEmit -p tsconfig.app.json --composite false` exits 0; `TemplateList.spec.ts` passes 6/6,
including "drops the deleted row in place", which covers the `dropTemplates` change directly.

**Toast paths verified — including one non-finding worth recording.**

*Error toast (rewired from `.catch` to a watcher on `error`):* with the cache cleared and the list
request rewritten to a 404 at document-start, the page shows **"Error while pulling templates."** and
the empty state, `Showing 0 - 0 of 0`. Correct.

*Loading toast:* with the cache cleared and the list request artificially delayed by 3 s, the
"Please wait while loading templates..." toast **never appears**. That looked like a regression from
moving it onto an `isPending` watcher — but it does **not** appear on HEAD either. Confirmed by
stashing the change and re-running the identical harness against the unmodified file, verifying via
the served module that it really was the old code (`fetchQuery` present, `useQuery` absent): same
result, no toast, across a 3 s pending window. So the missing loading toast is **pre-existing
behaviour on this page, not caused by the conversion**, and per the no-`main`-bugs rule it is not
filed as a branch issue. The table's own `:loading` skeleton still covers the cold-load cue.

---

### 29. Query Management calls `/api/undefined/...` when opened by URL outside the meta org

```
Module:            Settings -> Query Management (§15.9)
UI path:           direct URL /web/settings/query_management?org_identifier=<non-meta org>
What to check:     the request the page fires on mount
What to expect:    GET /api/_meta/query_manager/status   (what main sends)
What you get:      GET /api/undefined/query_manager/status -> page renders no table and no toolbar
```

**Severity: Low.** Real branch regression, but on a path the UI never produces. The Settings sidebar
entry is `visible: isEnt && meta` (`components/settings/index.vue:328`), so the link only appears
while in the `_meta` org — and in `_meta` the page works correctly. Reaching the broken state needs a
hand-edited or bookmarked URL carrying a non-meta `org_identifier`.

**Measured side by side, same backend, same moment:**

```
branch (:8081)  /web/settings/query_management?org_identifier=default
                  -> GET /api/undefined/query_manager/status   (reproduced 2/2)
                  -> no table, no toolbar, no Refresh button; nothing retries

main   (:8083)  same URL
                  -> GET /api/_meta/query_manager/status
```

**Cause — a mount-time race on `zoConfig`, not the cache layer.** `RunningQueries.vue:587` passes the
store value straight into the call with no guard:

```ts
SearchService.get_running_queries(store.state.zoConfig.meta_org)
```

Instrumenting the same page *after* it settles shows `zoConfig` **does** arrive — `meta_org: "_meta"`,
78 keys populated — so the value was simply not there yet when the component mounted. Nothing re-runs
the read afterwards, and the component renders no toolbar in that state, so there is no Refresh to
recover with.

**Why it is the branch's, despite the file being untouched.** `RunningQueries.vue` differs from `main`
by one cosmetic line only — two `zincutils` imports merged into one — which cannot change behaviour:

```
-import { durationFormatter } from "@/utils/zincutils";
+import { durationFormatter, getDuration } from "@/utils/zincutils";
-import { getDuration } from "@/utils/zincutils";
```

What changed is *when* `zoConfig` lands: this branch moved MainLayout's bootstrap onto the cache layer
(`MainLayout.vue`, +31/−11 vs main — the same file and area as **#25**), which reordered hydration. A
page that reads `zoConfig` at mount now runs before it is populated.

**Scope — narrow.** 20 `zoConfig.meta_org` reads exist across components, but almost all are either
equality comparisons (`=== selectedOrganization.identifier`, which is simply false while unhydrated
and gates the call) or run inside post-mount handlers. `RunningQueries.vue:587` is the one that feeds
it directly into a service call at mount with no guard. `DomainManagement.vue:638` looks similar but
is protected by exactly such a comparison first.

**Suggested fix.** Guard the read and re-run it when the org resolves — the same shape used for the
**#27** fix:

```ts
watch(
  () => store.state.zoConfig?.meta_org,
  (org) => { if (org) getRunningQueries(); },
  { immediate: true },
);
```

**Not fixed** — filed only. Left alone deliberately: it is outside §15.9's stated check, it is not a
caching defect, and the affected path is unreachable through the UI.

---

### 30. ⏸️ OPEN (deferred) — An ingested stream never appears in the stream dropdown

```
Module:            anything reading streams via useStreams (§16/§17 RUM, Logs pickers, dashboards, alerts)
UI path:           create/ingest a new stream, then open a page that lists or detects streams
What to check:     whether the new stream is visible
What to expect:    it appears (main re-reads the stream list every time)
What you get:      the stale localStorage list, served with NO request. Most visible on RUM:
                   instrumenting an app leaves RUM showing "Instrument a web app" as if disabled.
```

**Severity: Medium-High.** This is the **third instance of the #27/#28 class and by far the widest**:
`useStreams` backs the Logs stream picker, RUM enablement detection, dashboard panel editors and alert
stream selectors. Unlike #27 (unreachable page) and #28 (one list), this one silently hides *data
that exists*, on surfaces users hit constantly.

**Found while unblocking §17's RUM row.** After ingesting RUM events into a new `_rumdata` logs
stream, the RUM page kept showing its "not instrumented" onboarding screen.

**Measured on the branch (`:8081`):**

```
server            _rumdata EXISTS (listed by /api/default/streams?type=logs; schema resolves)
persisted entry   o2q-["org","default","streams","nameList","logs"]
                    age 29.44 min   (staleTime = CONFIG_STALE_TIME = 5 min -> long stale)
                    58 streams, _rumdata ABSENT
page load         ZERO /api/default/streams requests issued by the app
UI                "Instrument a web app" / "Enable Session Replay" — RUM reads as disabled
```

Removing **only** that one localStorage key and reloading fixed it completely: RUM came up with
Overview / Vitals / Errors / API tabs and live data (`Total Sessions 2`, `Session with Errors 2`).
That isolates the persisted entry as the sole cause.

**Cause — the same shape as #27/#28.** `streamNameListQuery` (`services/stream.queries.ts:23`) is
declared with `staleTime: CONFIG_STALE_TIME` **and** `persister: localStoragePersister`, but
`useStreams.ts:103` (and `:128`) reads it imperatively:

```ts
queryClient.fetchQuery(
  streamNameListQuery(store.state.selectedOrganization.identifier, streamType),
)
```

`fetchQuery` has no observer, so during hydration the persister's restore satisfies it as a completed
fetch and `staleTime` is never consulted — the restored entry keeps its original `dataUpdatedAt`.
Nothing revalidates it, so the stale list is served until something explicitly invalidates the scope
or the persister's 24 h `maxAge` finally rejects the entry.

**Confirmed branch-caused.** `main` (`:8083`) has no cache layer at all — verified live:
`hasQueryClient: false` and `streamNameListQuery` does not exist there. It re-reads the stream list on
every visit, so the same backend and the same `_rumdata` stream show RUM **enabled immediately**.
(That origin does carry leftover `o2q-` keys from an earlier build, but nothing on `main` reads them.)

**ROOT CAUSE of the whole #27 / #28 / #30 class — found here, in the library.** The persister *does*
have a revalidate-on-restore feature, and it is on by default (`refetchOnRestore: true`). It never
fires for these reads because of how it is gated
(`@tanstack/query-persist-client-core@5.101.4`, `createPersister.js:106`):

```js
if (refetchOnRestore === "always" || refetchOnRestore === true && query.isStale()) {
  query.fetch();
}
```

and `query.isStale()` in `@tanstack/query-core` (`query.js:130`) is:

```js
isStale() {
  if (this.getObserversCount() > 0) {
    return this.observers.some((observer) => observer.getCurrentResult().isStale);
  }
  return this.state.data === void 0 || this.state.isInvalidated;   // <- observerless path
}
```

With **zero observers** — which is exactly what `fetchQuery` gives you — a freshly restored entry has
`data` defined and `isInvalidated` false, so `isStale()` returns **false** and the refetch is skipped.
`staleTime` is never consulted. So *any* persisted query read imperatively silently serves stale data:
the defect is structural, not a mistake at any one call site. Note `isStaleByTime()` (the method that
does honour `staleTime`) is right next to it and is **not** what the gate uses.

**⏸️ DEFERRED — diagnosed and reproduced, fix NOT applied. Tracked for a later pass.**

A fix was written and verified, then **reverted on request** so the team can decide the shape of it.
The working tree is back at the branch state, i.e. the defect is live. Everything below is the
handover.

**Reproduce it in the UI (verified end to end).** The essential ordering is that the stream must be
created *after* the saved copy was written — reload Logs in between and the copy refreshes, hiding it.

```
1. Open Logs (/web/logs?org_identifier=default) and let it load.   <- writes the saved copy
2. DevTools > Console — age that copy past the 5-minute window:

   const k = 'o2q-["org","default","streams","nameList","logs"]';
   const o = JSON.parse(localStorage.getItem(k));
   o.state.dataUpdatedAt = Date.now() - 20*60*1000;
   localStorage.setItem(k, JSON.stringify(o));

3. Console — create a NEW stream by INGESTING (never through the UI; a UI action would
   invalidate and mask the bug). Reads the passcode from the session, nothing to paste:

   (async () => {
     const API = "http://localhost:5080", org = "default";
     const stream = "repro_" + Date.now().toString().slice(-6);          // must be a fresh name
     const email = document.querySelector("#app").__vue_app__.config.globalProperties.$store.state.userInfo.email;
     const j = await (await fetch(`${API}/api/${org}/passcode`, { credentials: "include" })).json();
     const r = await fetch(`${API}/api/${org}/${stream}/_json`, {
       method: "POST",
       headers: { "Content-Type": "application/json",
                  Authorization: "Basic " + btoa(email + ":" + j.data.passcode) },
       body: JSON.stringify([{ level: "info", msg: "repro" }]),
     });
     console.log("ingest:", r.status, "| LOOK FOR:", stream);
   })();

4. Ctrl+Shift+R, open the stream dropdown.
     -> the new stream is MISSING
     -> Network shows NO GET /api/{org}/streams?type=logs at all
5. Application > Local Storage > delete that o2q- key > reload -> it appears, request fires.
```

Gotchas that cost time: `curl` on Windows PowerShell is an alias for `Invoke-WebRequest` (no `-u`/`-d`)
and mangles single-quoted JSON — use the Console instead. And a deleted stream name is blocked for a
while ("stream [x] is being deleted"), so never reuse a name.

**Same root cause, bigger symptom — RUM.** `RealUserMonitoring.vue:290` decides whether RUM is set up
purely by asking whether a `_rumdata` stream exists. Ingest RUM events, and RUM still shows its
"Instrument a web app" onboarding screen as though nothing were configured.

**Why `staleTime` never applies — three settings, and the wrong one governs.**

| setting | question it answers | layer | survives reload |
| --- | --- | --- | --- |
| `staleTime` (5 min) | is my in-memory data fresh enough to skip fetching? | memory | no |
| `gcTime` (30 min) | how long do I keep unused data in RAM? | memory | no |
| `maxAge` (**24 h**) | how old may a **stored** copy be before I refuse it? | **disk** | **yes** |

On a reload the in-memory cache is empty, so `staleTime` correctly says "no data, go fetch" — and then
the **persister is the fetch**. It compares the entry against `maxAge` (24 h, not the 5-minute
`staleTime`), finds it acceptable, and returns it. `fetchQuery` treats that as a freshly-fetched
result; nothing checks the age of a fetch result. The library's own safety net,
`refetchOnRestore -> query.isStale()`, then also passes, because without an observer `isStale()` only
reports "data missing" or "invalidated". **`staleTime` is never compared to anything.**

So for an observerless read, `maxAge` is silently promoted from "outer safety bound" to "the only
freshness policy" — a job it was not designed for, and at 24 hours does badly.

**Why streams specifically, when templates/folders/functions are fine.** Those are all created *by the
app*, and every mutation declares `meta: { invalidates: [...] }`; invalidation sets `isInvalidated`,
which is the other half of `isStale()`'s observerless check — so the refetch fires and the disk copy is
rewritten correctly. Stream invalidation exists too (`useStreams.ts:70`, `:495`, `LogStream.vue:979`) —
but only for what the app *does*: force-refresh and delete. A stream created by **ingestion** happens
entirely outside the browser, so there is no mutation, no event, and nothing that could ever invalidate.
It is a missing *event*, not a missing mechanism.

**Recommended fix (written and verified before reverting).** Add a persister tier whose `maxAge`
matches the freshness window, and point `streamNameListQuery` at it:

```ts
export const configWindowPersister = experimental_createQueryPersister<string>({
  storage: safeLocalStorage,
  maxAge: CONFIG_STALE_TIME,   // 5 min — NOT the 24 h the other tiers use
  prefix: LS_PREFIX,
  buster: PERSIST_BUSTER,
});
```

`maxAge` is checked in `isExpiredOrBusted` unconditionally, with no observer required, so past the
window the entry is discarded and the real `queryFn` runs. Measured, both halves:

```
fresh entry (< 5 min), hard reload  -> 0 stream requests, picker painted from disk
stale entry (12 min) + new stream   -> 1 GET /streams?type=logs, new stream VISIBLE
```

Better than the two alternatives: the current code does 0 requests but serves stale data; simply
deleting the persister is correct but costs a request on *every* reload.

**The ideal version, for the later pass.** The mismatch is possible because `staleTime` and `maxAge`
are authored independently and nothing records how a query is meant to be read. Encoding that in the
declaration removes the whole class:

```ts
observedConfigQuery({...})    // read with useQuery      -> long maxAge, observer revalidates
imperativeConfigQuery({...})  // read with fetchQuery    -> maxAge === staleTime
```

plus a test that fails when a query declared for `useQuery` is passed to
`fetchQuery`/`prefetchQuery`/`ensureQueryData`. That test would have caught **#27, #28 and #30** before
any of them shipped — all four were this same mismatch. Degrades correctly for the session tier:
`traceDagQuery` has `staleTime: Infinity`, so a matched `maxAge` is infinite too and the immutable
trace copy is kept forever, which is right.

**Not recommended:** converting `useStreams` to `useQuery`. `getStreams()` has **52 call sites**, all
imperative and awaited, many inside loops, conditionals and event handlers where a composable cannot be
called. The refactor carries far more risk than the defect.

**Known residual, whatever fix is chosen:** none of this covers changes made outside the tab — another
user, the API, Terraform. Those wait out the freshness window. Normal cache behaviour, but worth being
a stated decision rather than a later surprise.

---

#### 30a. The same class — six more `persister` + `fetchQuery` pairs, DEFERRED with #30

**Not fixed. Recorded here so #30 and these are reviewed together.**

The defect needs **three** ingredients, not two:

1. the query declares a **`persister`** — a copy is restored from storage on load;
2. it is read through an imperative **`fetchQuery`** — no observer;
3. **nothing invalidates that scope when the data changes.**

(1)+(2) alone remove the safety net: on restore, the persister's revalidation check is
`query.isStale()`, which without observers only asks *"data missing?"* / *"invalidated?"* and never
consults `staleTime`. (3) is what decides whether anyone notices — an `invalidateQueries` sets
`isInvalidated`, which **is** one of the two things that check looks at, so the refetch fires and the
on-disk copy is rewritten correctly.

`fetchQuery` on its own is **not** the bug: it honours `staleTime` correctly for data already in
memory, which is why warm navigation behaves. Only the restore-from-disk path bypasses it.

| Query | persisted | read via | invalidated on write | status |
| --- | --- | --- | --- | --- |
| `streamNameListQuery` | ✅ | `fetchQuery` | ❌ **impossible** — a stream is created by *ingestion*, outside the browser | **#30, live defect** |
| `providersQuery` | was ✅ | `fetchQuery` | ❌ create/update/delete are direct service calls (`ProviderFormPage.vue:314/316`, `LlmProvidersSettings.vue:353`) | **fixed under #31** — persister dropped |
| `templatesQuery` | ✅ | `fetchQuery` ×5 | ✅ template mutations declare `invalidates` | at risk, currently masked |
| `foldersQuery` | ✅ | `fetchQuery` ×2 | ✅ `refreshFolderLists()` (`commons.ts:988`) | at risk, currently masked |
| `functionsQuery` | ✅ | `fetchQuery` | ✅ 3 jstransform mutations | at risk, currently masked |
| `queryFunctionsQuery` | ✅ | `fetchQuery` | ✅ shares the `orgKey(org,"functions")` root with `functionKeys.all`, so it is swept by prefix | at risk, currently masked |
| `settingQuery` | ✅ | `fetchInto` | ✅ favourites invalidate; home dashboard write-throughs | at risk, currently masked |
| `resourcesQuery` | ✅ | `fetchQuery` ×2 | ❌ `iamKeys.resources` is a sibling of `roles`/`groups`, not covered by their invalidations | no practical risk — RBAC resource *types* are static |

"Currently masked" means the bug is present but invisible **only because every writer happens to
invalidate**. Each is one refactor — a write moved off the mutation helper, a new writer added — away
from behaving exactly like #30.

**Two ways this was demonstrated for real, not theorised:**

- **#30** — a stream created by ingestion never appeared in the Logs picker or RUM.
- **#31** — removing an unrelated forced reload immediately exposed `providersQuery`, because that
  force was the only thing refreshing it. A newly created LLM provider would have stayed invisible on
  the Evaluations page. The persister had to be dropped there in the same change.

**The rule worth adopting, whatever is done about the individual entries:** *never pair `persister:`
with an imperative `fetchQuery` read unless every writer of that data invalidates the scope — and
never when the data can be created outside the app.* A unit test asserting that pairing would have
caught **#27, #28, #30 and #31** before any shipped.

---

### 31. ⏸️ OPEN (deferred) — Evaluations cold load fetches three lists twice (§22.1 C1)

```
Module:            AI -> Evaluations (§22.1)
UI path:           /web/ai/evaluations?org_identifier=<org>  (a cold load)
What to check:     Network — request count per list on the first load
What to expect:    1 request per list  (what main does)
What you get:      score_configs, scorers and eval_jobs each fetched TWICE; providers once
```

**Severity: Low.** Three redundant requests on each cold load of the page. No stale or wrong data —
both rounds hit the server and the second wins — so this is waste, not incorrectness. It is however
exactly the "two identical requests" pattern §1.1 of the plan calls out as the double-fire signature.

**Measured, branch vs `main`, same backend, reproduced twice:**

```
branch (:8081)   /api/default/score_configs   x2      (~845 ms and ~1395 ms)
                 /api/default/scorers         x2
                 /api/default/eval_jobs       x2
                 /api/default/providers       x1

main   (:8083)   each of the four             x1
```

The two rounds are distinguishable: the first carries **only the three lists**, the second carries
**providers + the same three**. The second matches `useOnlineEvalsData.loadAll()`, which fetches all
four together via `Promise.allSettled` (`useOnlineEvalsData.ts:50-53`) and is called un-forced from
`OnlineEvals.vue:832` (`onBeforeMount`). The first round's caller was **not** isolated — see below.

**Warm behaviour is correct**, which is what makes this waste rather than a cache defect:

```
revisit (past staleTime)  -> 3 requests   (the three lists; providers still cached)
revisit (within 30 s)     -> 0 requests
refresh button x2         -> 4 requests each click  (forced read, correct)
```

**ROOT CAUSE — `loadAll()` runs twice on mount, and the second run forces.** Found by temporarily
wrapping `queryClient.fetchQuery`/`invalidateQueries` and `loadAll` to capture caller stacks (the XHR
hook alone only reaches the axios chunk, and cache introspection is unavailable on this page — the §19
different-module-instance trap):

```
t=0      loadAll(org, force=false)   <- OnlineEvals.vue onBeforeMount
t=1552   loadAll(org, force=TRUE)    <- QualityPage.vue refreshAll() -> emit("reload-configs")
                                        <- parent @reload-configs="loadAll(orgId, true)"
                                        <- reloadQuality() <- @ready (QualityPage onMounted)
```

Both call sites are individually reasonable. `onBeforeMount` loads the four shared lists; QualityPage's
`refreshAll()` asks the parent to re-read the score-configs list first, because its aggregates "bail
out early when the list is empty" (its own comment). But on **mount** that list is already being
fetched, and `force: true` invalidates the entries the first call just wrote — so all four are fetched
again.

**⏸️ FIX WRITTEN AND VERIFIED, THEN REVERTED ON REQUEST.** The working tree is back at branch state, so
the duplicate is live. Everything below is the handover — the change was measured working before it was
backed out, and it is two small edits plus one line.

**The fix — the mount trigger no longer forces.** A user-initiated Refresh still must force; only the
`@ready` mount path should not:

```ts
// QualityPage.vue
async function refreshAll(reloadConfigs?: boolean) {
  if (reloadConfigs !== false) emit("reload-configs");   // `!== false`: a stray event arg still reloads
  ...
}

// OnlineEvals.vue
async function reloadQuality(onMount = false) { ... await qualityPageRef.value?.refreshAll?.(!onMount); }
// template:  @ready="reloadQuality(true)"
```

`reloadQuality()` from the Refresh button and from the date-window watcher still pass `onMount = false`,
so both still force. The ref's exposed type needed widening to `(reloadConfigs?: boolean)`.

**A second change is required with it — the first version introduced a stale-data risk.** With the forced round
removed, `providers` stopped being refetched on mount and was instead **restored from its persisted
entry**. `providersQuery` was declared `staleTime: CONFIG_STALE_TIME` **+ `persister:
localStoragePersister`**, and it is read observerless through `fetchInto` — the exact **#30** shape, so
a restored entry is served past `staleTime` without revalidation.

That would normally be covered by write-invalidation, but nothing invalidates this scope:

```
ProviderFormPage.vue:314/316   providers.update / providers.create   direct service calls
LlmProvidersSettings.vue:353   providers.delete                      direct service call
online-evals.service.queries.ts  only 2 mutations declare `invalidates`, both job-active
```

So a newly created LLM provider could have stayed invisible on the Evaluations page — a regression the
forced round had been masking. The persister was therefore dropped from `providersQuery` (its
`staleTime` is unchanged, so warm navigation still costs nothing):

```ts
staleTime: CONFIG_STALE_TIME,
gcTime: LONG_GC_TIME,
// Not persisted: read observerless via `fetchInto`, and no provider write
// invalidates this scope — a restored entry would outlive `staleTime`.
```

**Verified live on `:8081` — the fix, and the three behaviours it must not break:**

```
cold load      7 requests -> 4   one per list (score_configs · scorers · eval_jobs · providers)
                                  — the same shape `main` issues
Refresh button 4 requests -> 4   still forces all four, unchanged
warm revisit   0 requests -> 0   unchanged
page renders clean, 0 error notifications
```

`vue-tsc --noEmit` exits 0; **1822/1822** specs pass across the online-evals and services suites.

⚠️ The old `o2q-["org","default","onlineEvals","providers"]` key remains in `localStorage` as inert
residue — nothing reads or writes it now, exactly as with the streams entry in #30.

---

### Verified fixed — not filed

- **AI -> Evaluations force-refetching on every visit** (originally #2 in the parallel run)
  is **fixed**. `OnlineEvals.vue` now mounts with `await loadAll(orgId.value)` — no force —
  and the comment states the contract: *"Mount reads the cache; only the refresh button and
  post-write reloads force."* The forced path (`loadAll(orgId, true)`) is reached only via
  `@reload-configs`, which `QualityPage.vue` emits from `refreshAll()` — a refresh-button
  handler, not a mount hook. Re-checked in source; no longer reproducible.

---

## Security / review-note confirmations (§24)

7. **Destinations persisted in plaintext — confirmed on disk** (§24 item 1). The localStorage key
   `o2q-["org","default","alerts","destinations","alert"]` holds full destination payloads
   (`url`, `method`, `headers{}`, `template`, ...). Webhook Authorization headers / PagerDuty
   routing keys would sit in plaintext until org-switch/logout. The §18 sweep confirmed
   passcode, RUM token and ingestion-token *values* are NOT on disk (memory only) — destinations
   are the outlier. Needs a product decision.
   > **FIXED:** `destinationsQuery` no longer declares a persister — memory-only, matching
   > cipher keys/tokens. Verified live: a fresh destinations fetch writes nothing to
   > localStorage. (AI Toolsets / Action Scripts stay persisted — their list payloads carry
   > no credentials.) Cost: one extra request after a hard reload.

8. **Org-switch purge only cleans the org being left.** Switching default→test_ purged all of
   default's o2q-/IndexedDB entries ✓, but 7 o2q- keys + 20 field-value rows for `_meta` (from a
   previous session) survived the switch and would have sat there until 24 h max-age. Logout
   does clear everything (verified). Low stakes; worth purging all-but-current instead.
   > **FIXED:** new `purgePersistedExceptOrg(keepOrg)` (localStorage scan + IndexedDB
   > `cacheRemoveWhere` full-store sweep + `fieldValueDB.clearAllExceptOrg`) runs on every
   > org switch via `purgeOrgQueries(previous, next)`. Global-scope entries are kept.
   > Verified live: seeded stale-org keys in localStorage and o2FieldValues were swept;
   > current-org and `__global__` entries survived. The purge paths now also clear the
   > in-memory field-value read cache (§24 item 6's one-line fix — org switch AND logout),
   > closing the 60 s same-org residue window.

9. **Deleting a whole dashboard leaves its panels' IndexedDB entries orphaned.** Panel delete
   correctly drops its cache entry (verified), but dashboard delete does not drop the panels'
   entries under that dashboard id ("test - Copy" entries remained after deletion). They age out
   in 24 h; still, cheap to prune.
   > **FIXED:** new `dropDashboardPanelCache()` in `usePanelCache.ts` (prefix removal at the
   > dashboard level, mirroring `dropPanelCache`), called from `deleteDashboardById` and the
   > bulk-delete eviction path in `utils/commons.ts`. Verified live: deleting a dashboard now
   > removes all of its panels' o2Cache entries; other dashboards' entries untouched.

---

## Minor observations

0. **Dev-mode CORS break when the backend has RUM enabled.** o2latestmain's `/config` enables
   RUM, so the FE's RUM SDK (`allowedTracingUrls` on `API_ENDPOINT + "/api"` in `main.ts`)
   injects `x-openobserve-sampling-priority` / trace-propagation headers into every API XHR.
   Cross-origin (localhost dev → remote API) that fails CORS preflight — the backend's
   `Access-Control-Allow-Headers` doesn't include the SDK's own headers — and EVERY API call
   dies after the RUM init. Same-origin production is unaffected. Pentest never showed this
   because its RUM is off. For this test run the worktree got a local-only guard
   (`VITE_DISABLE_RUM` in `main.ts` — **not for commit**). Worth either adding the propagator
   headers to the backend CORS allow-list or documenting the dev workaround.
0b. Navigating away from an alert-detail page fired a stray `GET /api/v2/{org}/alerts/undefined`
   (observed once on o2latestmain) — an id watcher runs with `undefined` during teardown.
   Harmless 4xx, but it is an uncached request with a garbage key.
   > **FIXED (defensively):** `alerts.get_by_alert_id` now rejects locally on a falsy id,
   > so no caller can put `/alerts/undefined` on the wire.

9a. `/web/logout` as a deep link renders the 404 page (sign-out works only through the avatar
   menu). §24 item 6's analysis ("logout is a route change") assumes the /logout route exists.
   > **FIXED.** Two bugs: (a) the `/logout` record had no `component`, so vue-router silently
   > dropped it from the route table (hence the 404 with the guard never running); (b) its
   > redirect was a bare `"/login"`, which ignores the `/web/` base. The record now carries
   > the Login component (never renders — the guard hard-navigates first), redirects to
   > `getPath() + "login"`, and the clears run in a try/finally so a throw can't strand the
   > page. Verified live: `/web/logout` clears the session and lands on `/web/login`.
10. `result_schema` is fetched 4× on every dashboard open (once per panel + one), uncached —
    outside the plan's scope, but it is the only repeated chatter left on a warm dashboard.
11. Plan wording: the SQL function catalogue (§4 "once per session") is actually config-tier
    (5 min) — a refetch after the window was observed. Behavior is fine; the plan overstates it.
12. Metrics Explorer (§4A): first revisit re-ran 3/5 card queries (cards whose earlier run
    returned no data / crossed the range quantum); second revisit restored all 5 from cache with
    zero requests. Net PASS, but "repaint immediately rather than re-running every query" is
    only fully true from the second revisit of a given window.

---

## What passed (condensed)

> The full pass-by-pass evidence behind this summary — C1–C8 transcripts, the storage-hygiene
> checks and the coverage ledger — is in the **Appendix** at the end of this file.

- **§2.2 Org switch**: org A's localStorage/IndexedDB purged, org B isolated, in-memory kept on
  switch-back (instant paint, 0 requests). **§2.3 Logout**: ALL o2q- keys + o2Cache +
  o2FieldValues cleared. **§18**: no passcode/RUM/ingestion-token values anywhere on disk.
- **§3 Streams**: C1–C8 all pass (incl. delete-stays-gone, search+refresh preservation, sort =
  1 request, tab returns free); deleted stream vanishes from the alert-form stream dropdown.
- **§5 Dashboards**: r/refresh fixed (1 request), per-folder cache, create/duplicate/delete all
  write through (the shipped delete-reappear bug is fixed); panel cache is genuinely written
  (no DataCloneError), revisit + F5 restore without queries, `_o2_removeDashboardCache()` and
  panel-delete pruning work.
- **§6 Alerts**: refresh re-enables, search survives refresh, toggle updates in place, C7 on
  alerts/destinations/templates; form dropdowns (stream/template/destination) all served from
  cache with 0 requests and reflect writes instantly.
- **§8 Reports**: exactly one request per refresh (was two), search survives `r`, rows never blank.
- **§10.1 Functions**: the shipped blank-second-visit bug is fixed; r works; C7 clean.
- **§12 Workflows** (r absent by design, refresh + revisit correct), **§14 IAM** (users/roles
  shared read, service-accounts mount no longer forces, ingestion-tokens r fixed, quota module
  list loaded once), **§15** (model-pricing cached + bespoke sessionStorage caches gone; license
  and query-management deliberately always fresh).
- **§4/§4.1**: log search never cached (every run hits the server); field-value cache: expand →
  fetch once, re-expand instant (0 requests), run-query harvest writes org|type|stream|field
  rows to o2FieldValues in the background.
- **§19/§20**: overview reads (other than incidents), ingestion tokens/passcode cached in memory
  only. **§23**: console clean (no DataCloneError / recursive-update / unhandled rejections);
  the config-404 errors once per mount, no retry storm.

## Still untested — the definitive list

Everything below is what has NOT been verified across all five rounds, and what it takes to
test it. Anything not listed here has been tested and passes (or is a filed finding above).

### Needs a backend flag flipped

| Surface | Plan § | What it needs | Notes |
| --- | --- | --- | --- |
| ~~Synthetics list + monitor CRUD + results~~ | §11 | — | ✅ **UNBLOCKED and tested 2026-09-01** — flag enabled, C1–C8 all measured (plan §11). Surfaced **Issue 24** (list could never render) and a 2nd instance of **Issue 20** |
| ~~Synthetics agent tokens~~ | §11.1 | — | ✅ **TESTED 2026-09-01** — all 4 rows pass, incl. the tokens-never-persisted check (**0 leaks** across localStorage/sessionStorage/3 IndexedDB stores). See plan §11.1 |
| Actions list caching + CRUD + Logs menu | §13 | `ZO_ACTIONS_ENABLED=true` | page renders; `getAllActions` correctly no-ops while off — the `r` fix and cache path are unexercised |
| Alert-form workflow dropdown (form flow) | §6.2 / finding #15 | `workflows_enabled=true` | the fix is in and verified at the query layer; the actual dropdown flow never runs while off |

### Needs data no reachable org has

| Surface | Plan § | What it needs | Notes |
| --- | --- | --- | --- |
| Trace DAG cache | §16 | a backend serving `/traces/{id}/dag` AND traces with populated `gen_ai_*` columns | endpoint 404s for every trace on both envs; verified meanwhile that the 404 is neither cached nor retried |
| LLM Insights charts / KPI / error table | §22.3a | gen_ai-instrumented traces | `selectionKey` quantization verified as a pure function; the panel-cache repaint flow needs real charts |
| Incidents: status-filter forks, pagination | §6.6 | actual incidents | endpoint works, 0 incidents in every org |
| Anomaly detection lists + history | §6.9 | anomaly alerts | none configured anywhere |
| Alert-detail History pagination prefetch | §6.5 | an alert with >25 history rows | quantized caching verified; the standalone page's prefetch was verified in the parallel run, but that page has no UI entry |
| RUM sessions pagination + refresh | §21 | RUM traffic | page loads clean, zero sessions |
| Billing (usage, invoices, checkout URLs) | §22.4 | a cloud deployment (`isCloud=true`) | routes absent on-prem |
| Pipeline editor flows, per-pipeline History UI | §9.1/9.3 | at least one pipeline | `pipelineHistoryQuery` is spec-covered; the page flow was never clicked through |
| Import flows (dashboard/alert/destination/template/pipeline) | §5.5, §6.3/6.4, §9.1 | file-upload interaction | write-through after import is the same invalidation path as create, which passes everywhere |

### Needs infrastructure this harness cannot provide

| Surface | Plan § | What it needs |
| --- | --- | --- |
| New-deploy detection prompt | §2.1a | a live redeploy of the backend while the app is open |
| Field-value residue across users | §2.3 / §24-6 | a second, RBAC-restricted user in the same org (the fix — read-cache cleared on purge — is in; the two-user scenario itself is unverified) |
| Offline → back online refetch | §23 | DevTools network toggling (not available in the in-app browser) |
| localStorage quota-full degradation | §23 | an org with enough streams to blow the ~5 MB budget |
| Multi-tab convergence | §23 | two simultaneous app tabs |
| Private-browsing storage fallback | §23 | a private window |

### Small UI gaps never clicked through

- §5.4 annotations (drag-select flow), §5.6 dashboard picker inside the Reports form,
  §14.7 org cleanup-tasks polling dialog (control not present on these builds),
  §15.5 built-in regex patterns tab (not present), §15.1 org-settings save propagation,
  bulk-delete flows for roles/groups/functions (single-delete verified everywhere).

---

## Not testable / follow-up rounds

> **Second round in `_meta`** (org with live self-monitoring data, plus data we
> created): §10.2 Enrichment tables is now **VERIFIED — PASS** (uploaded `fecache_enrich`;
> rows stayed on screen through Refresh with the search filter intact, no remount; delete
> clean). §6.5 Alert history became testable (created a firing alert) and produced failure
> #6 above. The §14.7 cleanup-tasks dialog is not present on this build. The _meta test
> entities (alert/destination/template/enrichment table) were deleted afterwards.

| Area | Reason |
| --- | --- |
| §2.1a new-deploy detection | needs a live redeploy of pentest |
| §2.3 field-value residue across users (§24-6) | needs a second, RBAC-restricted user |
| ~~§6.8 dependency graph~~ | **now verified on the latest-main env — PASS**: one `include_dependencies=true` read shared by the Destinations and Templates tabs (28 Used-by cells, zero extra reads) and the impact dialog opens with no request. §6.9 anomaly still has no data |
| §6.7 External alert sources | not present in nav on this build |
| §7 SLO happy paths | SLOs disabled server-side (see failure #1) |
| §9 pipeline editor flows / history | no pipelines on the org; editor too heavy to script safely |
| ~~§10.2 Enrichment tables~~ | ~~org has none~~ **now verified in `_meta` — PASS** |
| §16 Trace DAG cache | pentest: no `/traces/{id}/details` endpoint. o2latestmain: details works, but `/traces/{id}/dag` itself 404s for every trace (driven directly through `traceDagQuery` — the component's own path), and no org holds spans with populated `gen_ai_*` columns, so the DAG tab cannot appear. Verified meanwhile: the 404 is not cached and not retried (one call per fetch). Needs a backend with the /dag endpoint and LLM-instrumented traces |
| §21 RUM, §22.3a LLM Insights, §22.4 Billing | no RUM/LLM/billing data on either env (RUM page loads clean on o2latestmain, zero sessions). ~~§22.1 Online Evals~~ **tested on o2latestmain — PASS**: cold visit fetches score_configs+scorers+eval_jobs+providers once; scorers/jobs tab revisits fire zero requests |
| ~~§11 Synthetics~~, §13 Actions | **Synthetics is no longer blocked** — enabled and fully tested on 2026-09-01, see plan §11; §11.1 agent tokens also tested and passing. Actions remains off on every reachable env: the page renders via direct URL but `getAllActions` correctly returns `[]` without a request while `actions_enabled` is unset — no caching to exercise, and no wasted traffic |
| ~~§15.2 Nodes~~ | **now verified — PASS** (the page needs the `_meta` org selected, not just the URL param): cold 1 request/7 nodes, revisit 0, `r` forces 1, the node filter survives refresh with its filtered rows, and no `o2q-` key is written (memory-only by design) |
| §23 offline / quota-full / multi-tab | not reproducible in the in-app browser harness |
| Pagination/prefetch checks (§3, §6.5, §9.3) | no surface had >1 page of data |

## Environment notes

- `GET /api/{org}/config` → **404 on pentest** (backend older than the branch expects?). The FE
  tolerates it: query errors once per mount, no retry storm, app fully works. It also means the
  §2.1 "config fetched once" test degrades to "404s once per mount" here.
- Test data created and cleaned up: stream `fecache_c6`, dashboard `fecache_dash`,
  `test - Copy`, template `fecache_tmpl`, destination `fecache_dest`, alert `fecache_alert`,
  function `fecache_fn` (all deleted). Three log rows were ingested into `e2e_automate`
  (`job=fecache_test|other_job`) to give field-value/search tests data in range — left in place.
- The session ends **logged out** (the logout-purge test was run last); log back in via
  "Login as internal user" with the shared test account.
- **Third-round env**: the worktree `web/.env` now points at the internal latest-main
  environment with `VITE_DISABLE_RUM=true`, and `src/main.ts` carries the matching local-only RUM guard
  (see Minor observation 0) — **revert the main.ts line before committing anything from this
  worktree**. o2latestmain test entities (`fecache_c6_check` alert, gen_ai trace spans under
  service `fecache-llm-agent`) — the alert was deleted; the trace spans remain (immutable,
  harmless).

---

## Fix round — change list (uncommitted, on the `feat/fe-caching` worktree)

| File | Change | Finding |
| --- | --- | --- |
| `src/composables/query/queryClient.ts` | 501 added to the no-retry statuses (permanent "feature disabled") | #1 |
| `src/views/slos/SloList.vue` | `readOrg` seeded from the store instead of `""` — no empty-org placeholder key | #1 |
| `src/services/alerts.queries.ts` | `alertHistoryQuery` quantizes start/end via `quantizeRange()` (key + request) | #6 |
| `src/components/alerts/AlertList.vue` | Removed the duplicated `?action=…` deep-link block from `getAlertsFn`; the immediate watcher (now a named `handleActionQuery`) is the single handler | #5 |
| `src/components/alerts/AlertListSlo.spec.ts` | Deep-link specs drive `handleActionQuery` directly (the route object is not reactive in tests) | #5 |
| `src/composables/dashboard/usePanelCache.ts` | New `dropDashboardPanelCache()` — dashboard-level prefix prune | #9 |
| `src/utils/commons.ts` | `deleteDashboardById` + bulk-delete eviction call the new prune | #9 |
| `src/main.ts` | RUM init skipped when `VITE_DISABLE_RUM=true` (dev aid for the CORS trap in observation 0 — reviewer's call whether to keep) | obs. 0 |

**Second fix round** (same worktree) — everything previously left open is now addressed:

| File | Change | Finding |
| --- | --- | --- |
| `src/services/alert_destination.queries.ts` | Persister removed — destinations cached in memory only | #7 |
| `src/composables/query/persisters.ts` | New `purgePersistedExceptOrg(keepOrg)` — org-switch sweep of every other org's localStorage/IndexedDB/field-value residue (global scope kept) | #8 |
| `src/composables/query/idbStorage.ts` | New `cacheRemoveWhere(predicate)` full-store sweep | #8 |
| `src/composables/fieldValueDB.ts` | New `clearAllExceptOrg(keepOrg)` | #8 |
| `src/composables/fieldValueStore.ts` | New `clearReadCache()`; called (lazily) from both purge paths | §24-6 |
| `src/composables/query/queryClient.ts` | `purgeOrgQueries(previous, next)` runs the sweep; both purge paths clear the field-value read cache (lazy import — the test setup loads this module eagerly) | #8, §24-6 |
| `src/layouts/MainLayout.vue` | Passes the new org into `purgeOrgQueries` | #8 |
| `src/services/alerts.ts` | `get_by_alert_id` rejects locally on a falsy id | 0b |
| `src/composables/shared/router.ts` | `/logout` route registrable again (component added; vue-router silently drops component-less records), base-aware redirect, try/finally | 9a |
| `src/composables/shared/router.spec.ts` | zincutils mock gains `getPath` | 9a |
| `fe-caching-manual-test-plan.md` | §5.2 range/variables rows corrected to main semantics; §4 catalogue wording (5-min window); §6.3 security note and §24 items 1/6 marked resolved | #2, #11 |

Not changed, by decision: #2 (main parity kept — the plan text is now corrected instead),
#3/#4 (no code change needed; correct on the current backend, standard error-retry against
the old one — and 501s no longer retry), minor 10/12 (observations, out of scope).

Verification (both rounds): `vue-tsc` clean; eslint clean on all changed files; vitest —
fetchInto 5/5, usePanelCache 26/26, usePanelDataLoader 87/87, AlertList 70/70, AlertListSlo
26/26, SloList delete/export + commons 88/91 (3 pre-existing skips), alerts service 55/55,
fieldValueDB/fieldValueStore(+serverFetch) + alert_destination + router suites 146/146,
shared router 201/201. Live re-verified on o2latestmain: SLO refresh/revisit, alert
save→list, history second-open = 0 requests, dashboard mount/F5 restore + both time-switch
directions refetch (main parity), dashboard-delete cache prune, destinations absent from
localStorage after a fresh fetch, stale-org sweep (seeded entries removed, current org +
global kept), `/web/logout` clears the session and lands on the login page.

---

## Appendix — first-campaign evidence

> Merged in from `web/docs/fe-caching-test-issues.md` so the two files hold the same
> content. This is the **earlier** test campaign, written before the issues above were
> renumbered: its Issues 1–12 are the same findings that appear above as #7–#17 and in
> *Verified fixed — not filed*. Where this appendix and the sections above disagree on a
> count or a verdict, **the sections above are newer and win** — they were re-verified on
> `fdff679ac1`. Kept for the pass-by-pass evidence and the coverage ledger, which the
> condensed sections above summarise rather than reproduce.

### Blocked — could not be tested on this build

All three behave identically: the endpoint fails, the query sits in `error` state, and an
errored query is always stale, so the page re-requests on every visit. That is TanStack
behaving **correctly** for a failed read, not a caching defect — but it cannot be
distinguished from one until the endpoint is reachable.

| # | Module | UI path | Endpoint | Status |
| --- | --- | --- | --- | --- |
| B1 | Alerts → Sources (§6.7) | Alerts → **Sources** | `GET /api/v2/{org}/incidents/integrations` | **403 Forbidden** |
| B2 | IAM → Roles / Groups (§14.2, §14.3) | IAM → **Roles** / **User Groups** | `GET /{org}/roles`, `/groups`, `/users/roles/all` | **500 — "OpenFGA store not initialized yet"** |
| B3 | Billing (§22.4) | **Billing** → Usage / Invoice History | `/billings/invoices`, `/list_subscription`, `/data_usage/30days` | **404** (cloud-only) |
| B4 | Actions (§13) | **Actions** | `GET /{org}/actions` | **400 — "Failed to get http client"**; the actions backend is not configured, so the page issues no requests at all |

**Retry policy verified as a side-effect:** 403 and 404 produced **exactly one** request per
visit (no retry), while the 500s produced **two** (one retry). That matches the client's
`retry` rule — 4xx never retried, 5xx retried once — so the retry configuration is correct.

Also not exercised, for lack of data rather than a defect:

| Module | Why |
| --- | --- |
| Metrics Explorer panel cache (§4A) | No metric streams on this instance |
| Synthetics (§11, §11.1) | Feature not enabled on this build — `/synthetics` redirects to Home and Synthetics is absent from the sidebar |
| Traces → trace DAG (§16) | No trace data on this instance |
| §2.4 reload persistence for panels | Covered indirectly — panel restore verified via IndexedDB |

---

### Passed — verified working

Every result below is a measured request count, not an inspection.

### Cache-first navigation (C1 / C2)

Cold visit fetches once; warm revisit within the freshness window issues **zero** requests.

| Module | UI path | Cold | Warm |
| --- | --- | --- | --- |
| Streams | Streams | 2 | **0** |
| Dashboards | Dashboards | 1 | **0** |
| Alerts | Alerts | 1 | **0** |
| Alert Destinations | Alerts → Destinations | 1 | **0** |
| Alert Templates | Alerts → Templates | 0 (shared w/ Alerts) | **0** |
| Incidents | Alerts → Incidents | 1 | **0** |
| SLOs | SLOs | 1 | **0** |
| Reports | Reports | 2 | **0** |
| Pipelines | Pipelines → Pipelines | 1 | **0** |
| Functions | Pipelines → Functions | 1 | **0** |
| Workflows | Workflows | 1 | **0** |
| ~~Actions~~ | Actions | — | — | ⛔ **corrected: blocked, not passed** — see B4 |
| Settings → General / Org | Settings → General | 0 (persisted) | **0** |
| Settings → Cipher Keys | Settings → Cipher Keys | 1 | **0** |
| Settings → Regex Patterns | Settings → Regex Patterns | 1 | **0** |
| Settings → AI Toolsets | Settings → AI Toolsets | 1 | **0** |
| Settings → Model Pricing | Settings → Model Pricing | 1 | **0** |
| IAM → Users | IAM → Users | 1 | **0** |
| IAM → Service Accounts | IAM → Service Accounts | 1 | **0** |
| IAM → Ingestion Tokens | IAM → Ingestion Tokens | 1 | **0** |
| Home / Overview | Home | 3 | **0** |
| AI → Datasets | AI → Datasets | 1 | **0** |
| AI → Queues | AI → Queues | 1 | **0** |
| Metrics (stream list) | Metrics | 1 | **0** |
| Traces (stream list) | Traces | 1 | **0** |
| Data sources / Ingestion | Data sources | 2 | **0** |
| MCP Server | IAM → MCP Server | 1 | **0** |
| Pipeline Destinations | Settings → Pipeline Destinations | 1 | **0** (3 consecutive runs) |
| Built-in patterns | Settings → Regex Patterns → Built-in | 1 | **0** |

Notable: **Alert Templates issues 0 requests even on first visit** — the Alerts page had
already populated that entry, confirming the shared-cache design.
**IAM → Service Accounts** at 0 on revisit confirms the "stop forcing a refetch on mount"
fix. **Home → 0 on revisit** confirms the "Overview tab re-requesting on every tab switch"
fix. **AI Datasets / Queues → 0** confirms the "fetched on every visit" fix.

### Cached paint actually renders rows

Zero requests is only correct if rows still appear. This is the regression test for the
"FunctionList painted nothing from its second visit onward" bug:

| Module | Rows visit 1 | Rows visit 2 (cached) | Requests visit 2 |
| --- | --- | --- | --- |
| Functions | 5 | **5** | 0 |
| Alerts | 5 | **5** | 0 |
| Destinations | 3 | **3** | 0 |
| Templates | 11 | **11** | 0 |
| Streams | 4 | **4** | 0 |

### C4 — Refresh button reaches the server

All 14 pages tested issued **exactly one** request per click, including every page the
branch repaired:

Functions · Alerts · Alert Destinations · Alert Templates · Reports · Pipelines · SLOs ·
Workflows · Cipher Keys · Regex Patterns · AI Toolsets · Model Pricing · Service Accounts ·
Ingestion Tokens · Streams

### C5 — `r` keyboard shortcut (real keypresses)

Each sent as a genuine key event with focus on `body`. Every one reached the server:

| Page | Request issued |
| --- | --- |
| Streams | `GET /streams…` |
| Functions | `GET /functions…` |
| Dashboards | `GET /dashboards…` |
| Alerts | `GET /v2/alerts…` |
| Reports | `GET /v2/reports…` |
| Alert Destinations | `GET /alerts/destinations…` |
| Alert Templates | `GET /alerts/templates` |
| Service Accounts | `GET /service_accounts` |
| Ingestion Tokens | `GET /ingestion-tokens` |

This is the check that was broken on 11 pages before the branch.

### C6 — create through the UI updates the list

Created a function via **Pipelines → Functions → New function** (name + Monaco body → Save):

```
POST /api/default/functions
GET  /api/default/functions?…      ← single invalidation-driven refetch
row "cachetest_ui_created" present: true      (no manual refresh)
```

### C7 — delete removes the row and it stays gone

The single most likely regression. Each delete done **through the UI**, then navigated away
and back:

| Module | Deleted | After delete | On return | Verdict |
| --- | --- | --- | --- | --- |
| Functions | `cachetest_fn_delete_me` | row gone; `DELETE` + 1 refetch | row gone, **0 requests** | ✅ |
| Alerts | `cachetest_alert4_delete_me` | row gone; `DELETE` only, **no refetch** | row gone, **0 requests** | ✅ |
| Dashboards | `cachetest_dash2` | row gone; `DELETE` only | row gone, list not refetched | ✅ |
| Streams | `cachetest_delete_me` | row gone; `DELETE` | row gone after invalidation refetch | ✅ |

Alerts and Dashboards prune the cache in place (`setQueriesData`) rather than refetching —
better than the plan requires.

### C8 — search survives a refresh

| Module | Term | Rows while filtered | After Refresh | Requests |
| --- | --- | --- | --- | --- |
| Alerts | `alert2` | 1 (`cachetest_alert2`) | identical, term retained | 1 |
| Reports | `cachetest` | 1 (`cachetest_report1`) | identical, term retained | **1** |

Reports issuing **1** request confirms the "one request per refresh, not two" fix.

### §5.2 — Dashboard panel result cache (IndexedDB)

The headline feature, previously broken by `DataCloneError`. Tested with a real SQL panel
added to `cachetest_dash1`.

| Check | Result |
| --- | --- |
| Panel result written to IndexedDB | ✅ `o2q-heavy-["org","default","panels","default","7497574026311630848","cachetestpanel1","yyupok"]` |
| Store is **not** empty | ✅ 5 entries |
| No `DataCloneError` in console | ✅ none |
| Revisit restores from cache | ✅ **0 API calls**, chart rendered, panel title present |
| Cold load after clearing cache does fetch | ✅ 1 × `POST /_search_stream` + 1 × annotations |
| `window._o2_removeDashboardCache()` | ✅ cleared; next load re-ran the query |

The one console warning on the dashboard — `Invalid prop … "metaData" … got Undefined` on
`QueryInspector` — appears on a **cold** load too, so it is pre-existing and unrelated.

### §2.2 — Organization switch purge

| Check | Result |
| --- | --- |
| `default` keys present before switch | 12 `o2q-` keys |
| After switching to `_meta` | **0** `default` keys remain |
| Planted destination token | **gone** |
| `_meta` shows its own data | ✅ 0 functions — no leak from `default` |
| Switching back to `default` | ✅ only 3 requests — in-memory cache correctly retained |

### §2.3 — Logout purge

| Check | Result |
| --- | --- |
| `o2q-` localStorage keys | **0** |
| Planted destination token | **gone** |
| IndexedDB `o2Cache` (panel results) | **0 entries** |
| IndexedDB `o2FieldValues` | **0 entries** |

Two keys (`home_dashboard`, `organizations/settings`) were briefly observed after a logout,
but tracing showed they are **re-written by app bootstrap after** the purge, not survivors —
they contain no credentials and are not a defect.

### §4.1 — Field-value autocomplete cache

Initially appeared broken (0 IndexedDB entries), but that was an empty time window, not a
defect. After re-ingesting data inside the visible range:

| Check | Result |
| --- | --- |
| Entries written by Run Query capture | ✅ `code`, `level`, `service`, `user` |
| Stored entry contents | ✅ `default\|logs\|cachetest_logs\|level` → `["info","warn","error"]`, `source: "mixed"`, expiry set |
| Field expansion renders values | ✅ `info 20 / warn 20 / error 20` |
| Purged on org switch / logout | ✅ (see above) |

The sidebar still calls `_values_stream` on each expand — correct: it shows **live counts**,
while the IndexedDB cache feeds autocomplete suggestions.

### §17 — Search is NOT cached (negative test)

Running the **identical** query twice on Logs → each run issued fresh requests:

```
run 1:  POST /_search_stream (histogram)  +  POST /_search_stream (results)
run 2:  POST /_search_stream (histogram)  +  POST /_search_stream (results)
```

Log search is correctly served from the server every time, never from the frontend cache.

**Measurement note:** the in-page `fetch`/`XHR` recorder does **not** observe
`_search_stream` reliably (it is a streaming transport, and the recorder is also wiped by
a full page navigation). An intermediate reading of "0 search calls on the second run" was
a recorder artifact, not caching — confirmed against the DevTools network panel, which is
what the numbers above come from. Request counts elsewhere in this document were taken
between SPA navigations, where the recorder is accurate, and the headline ones were
cross-checked against the network panel.

### Second-pass results (sections not covered in the first run)

| Section | Check | Result |
| --- | --- | --- |
| §17 **Dashboard save hash** | Edit dashboard settings → Save, twice in a row | ✅ **PASS** — 1st save used the live hash `7755509…`, 2nd used the rotated `5923483…`; no conflict, both "updated". The optimistic-concurrency hash is correctly **not** cached |
| §18 **Full credentials sweep** | Visited every credential-bearing page, then searched both storages for the real secret values | ✅ **PASS** — org passcode, RUM token, ingestion token and service-account token all **clean** in localStorage and sessionStorage. Only destinations leak (Issue 1) |
| §19 Home tab switching | Overview ⇄ Usage, four switches | ✅ **PASS** — **0 requests** on every switch (confirms the "re-requesting on every tab switch" fix) |
| §19 Home service graph | Three Home visits | ✅ **PASS** — 1, 0, 0 requests; key correctly quantized |
| §3 Stream-type tabs | Logs → Metrics → Logs → Metrics | ✅ **PASS** — 1 request on first Metrics, **0** thereafter both ways |
| §3 Sort | Three successive sort-header clicks | ✅ **PASS** — exactly 1 request per distinct sort state |
| §3 C8 search survives refresh | Filter `cachetest_app` → Refresh | ✅ **PASS** — term and filtered row preserved |
| §6.6 Incidents status filters | Switch filters back and forth | ✅ **PASS** — 0 requests on every switch |
| §6.3 C7 destination delete | Delete → navigate away → return | ✅ **PASS** — gone, stays gone, **0 requests** on return |
| §8 C7 report delete | Delete → navigate away → return | ✅ **PASS** — gone, stays gone, **0 requests** on return |
| §9.2 Pipeline destinations | Three consecutive visits | ✅ **PASS** — 0 requests each |
| §20 Data sources | Cold vs warm | ✅ **PASS** — ingestion-tokens + rumtoken cold, **0** warm |
| §14.8 MCP Server | Cold vs warm | ✅ **PASS** — passcode cold, **0** warm |
| §15.5 Built-in patterns | Cold vs warm | ✅ **PASS** |
| §15.8 License | Cold vs warm | ✅ **PASS by design** — re-reads every visit (`staleTime: 0`; carries live usage counters) |
| §15.9 Query management | Cold vs warm | ✅ **PASS by design** — deliberately uncached |
| §14.7 Organizations | Cold vs warm | ⚠️ re-fetches every visit — expected: `orgListQuery` is one of the declared-but-unread queries (plan §24 item 8) |
| §21 RUM Sessions | Cold vs warm | Inconclusive — 0 requests either way (search-driven, no RUM data on this instance) |
| §6.5 Alert History | Three visits | ❌ **Issue 5 + Issue 6** |
| §22.3a LLM Insights | Cold vs warm | ❌ **Issue 5** (`gen_ai/agents` time-range key) |
| §16 Traces Service Graph | Cold vs warm | ❌ **Issue 5** (raw timestamps at this call site) |
| §9.3 Pipeline History | Cold vs warm | ❌ **Issue 5**; also `GET /pipelines` fires twice on cold |
| §16 Services Catalog | Cold vs warm | Search-driven (`_search_stream`) — correctly uncached per §17 |
| §6.4 C7 template delete | Delete an unused template | ⛔ **Blocked by Issue 7** — no way to confirm deletion |
| §15.2 Nodes, §14.4 Quota | Navigate | ⛔ `_meta`-scoped; both redirect away in the `default` org |

### Third-pass results (remaining reachable consumers)

| Surface | Check | Result |
| --- | --- | --- |
| §4 Saved views (Logs → More → List Saved Views) | open, close, reopen | ✅ **PASS** — 1 × `GET /savedviews` then **0** |
| §4 Function editor (Logs → More → Function Editor) | toggle 3× | ✅ **PASS** — **0** requests; reuses the functions list already cached by the Functions page |
| §4 SQL autocomplete catalogue | type in the SQL editor | ✅ **PASS** — **0** requests; `queryFunctions` catalogue already cached |
| §5.1 Favourites + home dashboard | cold vs warm | ✅ **PASS** — 4 cold (home_dashboard, folders, favourites, list) → **0** warm |
| §14.7 Cleanup-dialog polling | code-verified | ✅ **Correct by construction** — `refetchInterval: props.open && !isComplete ? 5000 : false`, so it cannot poll while closed. **Not UI-exercised**: the dialog is only reachable for an org pending deletion, which would require destructively deleting an org |
| §11.1 Synthetics agent tokens | navigate | ⛔ redirects to Home — Synthetics disabled on this build |
| §13 Actions | navigate | ⛔ **B4** — endpoint 400, page issues no requests |

**Live cache inventory at end of testing:** 24 entries across 13 domains
(config, organizations, settings, streams, functions, iam, alerts, folders, dashboards,
panels, anomalyDetection, traces, search), **0 in error state**, every key correctly rooted
at `["org","<id>",…]`.

### Fourth pass — the last reachable gaps

| Section | Check | Result |
| --- | --- | --- |
| §5.5 Import dashboard | Imported a real dashboard JSON through the UI | ✅ **PASS** — `POST /dashboards` + exactly **one** invalidation refetch; the imported dashboard appears in the list with **no manual refresh** |
| §5.3 Add panel (UI builder) | Opened Add Panel 3× after warming Streams | ✅ **PASS** — stream dropdown served from cache; **0 requests** on all three opens (the first open's `query_functions` + per-stream schema were cold reads) |
| §6.2 Alert create form | Opened the form 3× after warming destinations/templates/streams | ✅ **PASS for destinations, templates and streams** — all cache-served. ❌ workflows re-fetches → **Issue 8** |
| §2.1a Build-version checker | Invoked the real `checkForNewVersion()` and watched the `/config` cache entry | ✅ correctly forces past the config cache (detection not suppressed) · ❌ **rewrites `/config` staleTime Infinity → 0** — live confirmation of **Issue 3** |

### Fifth pass — unblocking the previously-blocked sections

Four of the eight blocked sections were unblocked by seeding data or switching org.

| Section | How it was unblocked | Result |
| --- | --- | --- |
| §4A **Metrics Explorer** | Ingested a metric stream (`cachetest_cpu_usage`, 60 points) | ✅ **PASS** — explorer card writes `o2q-heavy-[…,"panels","__metrics_explorer",…]` to IndexedDB; **3 consecutive visits = 0 requests** |
| §16 **Trace DAG** | Ingested an OTLP trace with `gen_ai.*` attributes (the DAG tab only appears for LLM traces) | ⚠️ persistence works, serving does not → **Issue 9** |
| §15.2 **Nodes** | Switched to the `_meta` org | ✅ **PASS** — cold 1 × `/node/list`, warm **0** |
| §14.4 **Quota** | Switched to the `_meta` org | ✅ **PASS (plan corrected)** — 1 request per visit; see the correction below |

**Test-plan correction — §14.4 Quota.** The plan says "the module list is **loaded once**,
not on every visit". That over-read commit `ec9313eda7`, whose own message describes a
**double-load within a single mount** (`onMounted` assigned `selectedOrganization`, which
triggered the watcher, and then loaded the list itself as well). The fix made that one call
instead of two — it did **not** put the list on the query layer. Measured: exactly **1**
`module_list` request per visit across 3 visits, and **zero** quota cache entries. That is
correct behaviour for the fix that shipped; the plan's expectation was wrong, not the app.
`fe-caching-manual-test-plan.md` §14.4 should read "one request per visit, not two".

**Still blocked (backend configuration, not testable from the frontend):**

| Section | Exact reason |
| --- | --- |
| §6.7 Alert Sources | `403 — "External alert sources not enabled"` (feature flag) |
| §14.2/§14.3 IAM Roles, Groups | `500 — "OpenFGA store not initialized yet"` |
| §13 Actions | `400 — "Failed to get http client"` (actions backend not configured) |
| §11 Synthetics | feature disabled — absent from the sidebar, `/synthetics` redirects to Home |
| §22.4 Billing | `404` — cloud-only endpoints |

### Storage hygiene

| Check | Result |
| --- | --- |
| Every cache key rooted at `["org","<id>",…]` | ✅ all keys correctly shaped |
| `sessionStorage` empty | ✅ no `regex_patterns_cache_*` / `model_pricing_cache_*` — the deleted bespoke caches really are gone |
| Retry policy | ✅ 4xx never retried, 5xx retried once |

---

### Investigated and dismissed — not issues

| Observation | Why it is not a defect |
| --- | --- |
| `alerts/deduplication/semantic-groups` called ~45× in one session | Not reproducible on a clean page load (**0** calls). The repeats were driven by my own repeated field-expansions and Run Query clicks. `utils/semanticGroupsCache.ts` has a 5-minute TTL cache with in-flight dedup |
| Field-value IndexedDB store empty | The time window contained no data. After re-ingesting inside the visible range, entries were written correctly (see below) |
| Dashboards fetching 3 config reads on a "warm" revisit | Those queries had genuinely aged past their 5-minute window. Re-probed 4× back-to-back: visits 2–4 issued **0** requests |
| Two `o2q-` keys present after logout | Re-written by app bootstrap **after** the purge, not survivors; contain no credentials |
| `QueryInspector` `metaData=undefined` Vue warning | Appears on a cold load too — pre-existing, unrelated to caching |

---

### Coverage ledger — what was and was NOT tested

Updated after the **second pass**, which targeted the sections the first run missed.

Legend: **Full** = the section's own checks exercised · **Core** = C1/C2 (+ some C4/C5/C7) ·
**None** = not exercised · **Blocked** = environment/feature/data unavailable.

| Section | Status | Notes |
| --- | --- | --- |
| §2.1 Login / app config | Core | `/config` observed cached |
| §2.1a Build-version checker | Core+ | Cannot be end-to-end tested (needs a mid-session deploy), but its **caching behaviour was verified**: it correctly forces past the `staleTime: Infinity` config cache, and doing so **triggers Issue 3 on `/config`** — reproduced live |
| §2.2 Org switch | **Full** | incl. cross-org leak check + switch-back cost |
| §2.3 Logout purge | **Full** | localStorage + both IndexedDB stores |
| §2.4 Reload persistence | Core | token survival + panel restore verified |
| §3 Streams | **Full** | C1,C2,C4,C5,C7,C8 + type tabs + sort |
| §4 Logs surfaces | **Full** | field values, saved views, function editor and SQL catalogue all verified; Actions menu blocked (B4) |
| §4.1 Field-value cache | **Full** | both writers + read path |
| §4A Metrics Explorer | **Full** | unblocked by ingesting metrics — 3 visits, 0 requests |
| §5.1 Dashboard list | **Full** | C1,C2,C5,C7 + favourites + home dashboard. (move not run) |
| §5.2 Panel cache | **Full** | write, restore, cold-load, manual clear |
| §5.3 Add / edit panel (UI builder) | **Full** | 3 opens, 0 requests — stream dropdown cache-served |
| §5.4 Annotations | Core | cold 1 / warm 0; **key is time-ranged — latent Issue 5**; add/edit/delete not run |
| §5.5 Import dashboard | **Full** | UI import → 1 invalidation refetch → row present, no manual refresh |
| §5.6 Dashboard picker | Core | opens with **0 requests** (cache-served); option rendering not verified |
| §6.1 Alerts list | **Full** | C1,C2,C4,C5,C7,C8 |
| §6.2 Alert create / edit form | **Full** | destinations/templates/streams cache-served; workflows → **Issue 8** |
| §6.3 Destinations | **Full** | C1,C2,C4,C5,C7 + security probe |
| §6.4 Templates | Core+ | C1,C2,C4,C5. **C7 blocked by Issue 7** |
| §6.5 Alert history | **Full** | → **Issue 5 + Issue 6** |
| §6.6 Incidents | Core+ | C1,C2 + status filters |
| §6.7 Alert sources | **Blocked** | 403 |
| §6.8 Dependency graph | Core | shared read observed; three-surface check not run |
| §6.9 Anomaly detection | Core | via Home |
| §7 SLOs | Core | C1,C2,C4. **C7 not run — seeding blocked by a nested config schema** |
| §8 Reports | **Full** | C1,C2,C4,C7,C8 |
| §9.1 Pipelines | Core | **detail, import not run** (no pipelines seeded) |
| §9.2 Pipeline destinations | **Full** | 3 consecutive runs, 0 requests |
| §9.3 Pipeline history | **Full** | → **Issue 5**; also duplicate `GET /pipelines` on cold |
| §10.1 Functions | **Full** | C1,C2,C4,C5,C6,C7 |
| §10.2 Enrichment tables | Core | Issue 4; refresh-keeps-rows still untested (no data) |
| §11 Synthetics | **Blocked** | feature not enabled on this build |
| §12 Workflows | Core | C1,C2,C4 |
| §13 Actions | **Blocked** | endpoint 400 — corrected from an earlier false pass |
| §14.1 Users | Core | |
| §14.2 / §14.3 Roles, Groups | **Blocked** | 500 OpenFGA |
| §14.4 Quota | **Full** | unblocked in `_meta` — 1 req/visit; **plan expectation corrected** |
| §14.5 Service accounts | Core+ | C1,C2,C4,C5 |
| §14.6 Ingestion tokens | Core+ | C1,C2,C4,C5 |
| §14.7 Organizations | Core+ | re-fetch expected (`orgListQuery` unread); **polling code-verified, dialog UI-unreachable** |
| §14.8 MCP Server | **Full** | cold 1 / warm 0 |
| §15.1 General / Org | Core | |
| §15.2 Nodes | **Full** | unblocked in `_meta` — cold 1, warm 0 |
| §15.3 Cipher Keys | Core+ | C1,C2,C4 + staleTime experiment |
| §15.4 Regex Patterns | Core+ | C1,C2,C4 + sessionStorage |
| §15.5 Built-in patterns | **Full** | cold 1 / warm 0 |
| §15.6 AI Toolsets | Core | C1,C2,C4 |
| §15.7 Model Pricing | Core+ | C1,C2,C4 + sessionStorage. **"newly saved model appears" not run** |
| §15.8 License | **Full** | re-reads by design |
| §15.9 Query management | **Full** | uncached by design |
| §16 Traces | **Full** | stream list cached; service graph → **Issue 5**; **DAG unblocked → Issue 9**; services catalog search-driven |
| §17 Negative tests | **Full** | log search not cached ✅ · **dashboard save hash ✅ (twice, no conflict)** · billing URLs blocked |
| §18 Credentials sweep | **Full** | all 4 testable secrets clean; only destinations leak |
| §19 Home / Overview | **Full** | tab switching + service graph + usage |
| §20 Data sources / Ingestion | **Full** | cold 2 / warm 0 |
| §21 RUM | Inconclusive | search-driven, no RUM data |
| §22.1 Online Evals | **Full** | → **Issue 2** |
| §22.2 / §22.3 AI Datasets, Queues | Core | C1,C2 |
| §22.3a LLM Insights | **Full** | → **Issue 5** |
| §22.4 Billing | **Blocked** | 404 cloud-only |
| §23 Resilience | Core+ | retry policy ✅ · **storage-quota failure degrades cleanly, 0 uncaught errors** ✅ · offline/multi-tab not run |

### Where it stands

- **Fully exercised:** 34 sections (was 7)
- **Core contract:** ~20 sections
- **Not exercised:** 0 — §2.1a's caching behaviour is verified; only its end-to-end prompt needs a real deploy
- **Blocked by environment/data:** 5 sections — all backend configuration (alert sources 403, OpenFGA 500, Actions 400, Synthetics disabled, Billing cloud-only)

Everything still unexercised is either blocked by this instance (no traces/metrics/RUM data,
Synthetics off, OpenFGA down, billing cloud-only, `_meta`-scoped pages) or a create/import
**form** flow whose caching contract is already covered by the C6 test that passed on
Functions. The caching layer has now been exercised on every surface this environment can reach.

### Note on session bounces during testing

Several times the app jumped to `/web/login` mid-run and the whole cache was purged. The
user confirmed they were logging out and back in during the session, which accounts for
these. Worth knowing regardless: on **any** 401, `services/http.ts` calls
`store.dispatch("logout")` → `purgeAllQueries()` → `window.location.reload()`, so a single
transient 401 discards every persisted list **and** all cached panel results, even when the
session immediately recovers. Correct for a real logout; an expensive cold start after a
blip. Not filed as a defect — flagging it as a design consequence worth a decision.
