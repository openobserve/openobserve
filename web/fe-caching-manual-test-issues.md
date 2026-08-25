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
| §6.8/6.9 dependency graph / anomaly | no multi-dependency or anomaly data (§6.5 history now tested in `_meta` — see failure #6) |
| §6.7 External alert sources | not present in nav on this build |
| §7 SLO happy paths | SLOs disabled server-side (see failure #1) |
| §9 pipeline editor flows / history | no pipelines on the org; editor too heavy to script safely |
| ~~§10.2 Enrichment tables~~ | ~~org has none~~ **now verified in `_meta` — PASS** |
| §16 Trace DAG cache | pentest: no `/traces/{id}/details` endpoint (404 for ALL traces). o2latestmain: endpoint works and trace details render (Waterfall/Flame/Trace Graph tabs, no re-query on the client-built graph) — but the DAG tab needs spans with flattened `gen_ai_*` columns, and this backend stores custom span attributes in `_all` only, so `hasLLMSpans` is false even for an ingested gen_ai trace. Needs a genuinely LLM-instrumented env |
| §21 RUM, §22.3a LLM Insights, §22.4 Billing | no RUM/LLM/billing data on either env (RUM page loads clean on o2latestmain, zero sessions). ~~§22.1 Online Evals~~ **tested on o2latestmain — PASS**: cold visit fetches score_configs+scorers+eval_jobs+providers once; scorers/jobs tab revisits fire zero requests |
| §11 Synthetics, §13 Actions, §15.2 Nodes | still disabled/gated on o2latestmain too (`synthetics_enabled=false`; Actions blank; Nodes redirects to General even in `_meta`) |
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
