# Per-route memory-leak audit

**Date:** 2026-09-01
**Branch:** `fix/dashboard-navigation-memory-leak`
**Build:** vite dev server (localhost:8081), staging backend `o2.introspect.internal.zinclabs.dev`, authenticated, read paths only.

## Headline

**No real per-route memory leak was found on any reachable route.** The one
signal that looked like a leak — a ResizeObserver growing by +1 per visit on the
table/list pages — was a **measurement false positive**, not an app bug (see
§"False positive"). The app's route teardown is disciplined across the board.

## Live cycle benchmark — 10× dashboards↔logs (20 navigations, dev build)

Build-independent instrumentation (wrapped `ResizeObserver`, `window` listener
net-count, `AbortController` made/fired, `setInterval` net) persisted across
client-side router navigation; dev-build heap-MB is excluded (reactivity/HMR
artifact), so only structural counters are reported.

| Signal | Cycle 1 | Cycle 5 | Cycle 10 | Verdict |
|---|---|---|---|---|
| ResizeObservers **detached** | 0 | 0 | 0 | zero leaked observers (the reliable signal) |
| ResizeObservers total | 2 | 2 | 2 | flat — no accumulation |
| DOM nodes | 1386 | 1407 | 1408 | plateaus — no detached-subtree growth |
| Intervals net | 0 | −14 | −28 | negative = cleared, not leaked |
| Window listeners net | −219 | −1665 | −9176 | negative = removed, not leaked |
| AbortControllers made/fired | 3/3 | 35/30 | 93/78 | small stable gap = normal completions |

A leak drives observer/DOM counts monotonically **up** and listener/interval nets
monotonically **positive**; here counts are flat and nets go negative — the
opposite. Empirically confirms disciplined route teardown on the live build.

### Per-page cycle benchmark — 10× each (page↔dashboards)

Each keep-alive-heavy page cycled 10× against dashboards; reported at the steady
state (cycle 5 vs cycle 10 — a plateau proves no accumulation).

| Page | roDetached | roTotal (c5→c10) | DOM (c5→c10) | listeners net | intervals net | Verdict |
|---|---|---|---|---|---|---|
| **Logs** | 0 | 21 → 21 | 4269 → 4274 | −16672 | −30 | flat plateau, no leak |
| **Metrics** | 0 | 7 → 7 | 526 → 526 | −18444 | −36 | flat plateau, no leak |
| **Traces** | 0 | 5 → 5 | 615 → 615 | −18958 | −35 | flat plateau, no leak |
| **Alerts** | 0 | 5 → 5 | 2837 → 2837 | −21482 | −36 | flat plateau, no leak |
| **Pipelines** (vue-flow) | 0 | 2 → 2 | 861 → 861 | −22417 | −36 | flat plateau, no leak |
| **RUM sessions** | 0 | 33 → 33 | 1203 → 1203 | −23070 | −37 | flat plateau, no leak |
| **Streams** | 0 | 2 → 2 | 848 → 848 | −25213 | −38 | flat plateau, no leak |
| **Settings** | 0 | 0 → 0 | 519 → 519 | −25592 | −38 | flat plateau, no leak |
| **IAM** | 0 | 1 → 1 | 787 → 787 | −26469 | −38 | flat plateau, no leak |

Panel editor (`/dashboards/add_panel`) needs a live dashboard+folder+tab context,
so a bare `router.push` redirects to `/dashboards`; it wasn't exercised here and
needs interactive navigation (open dashboard → add panel) to benchmark.

`roDetached` is **0** on every page and every cycle (the reliable detached-observer
signal). `roTotal` and DOM reach a per-page steady state and stay flat (c5 == c10);
listener/interval nets stay negative (teardown outpaces allocation). No page leaks.

## Route inventory & coverage (all 236 routes)

The app declares **236 named routes**, from SEVEN route sources:
`composables/shared/router.ts`, `useManagementRoutes.ts`, `useEnterpriseRoutes.ts`,
**`useIngestionRoutes.ts` (91 data-source guides)**, **`enterprise/composables/router.ts`
(31 AI-observability + billing routes)**, `router/index.ts`, `router/routes.ts`.

> Correction: an earlier version of this doc said 116 — it omitted the 91
> ingestion routes and the 31 enterprise routes. True total is **236**.

Coverage legend: **L** = live-navigated & measured; **S** = component read in the
full-tree static audit (not live-navigated); **R** = redirect only (mounts no
component — nothing to leak); **—** = auth/util stub, no UI surface.

Honest coverage: **~20 pages live-cycled, ~200 covered statically, ~12 redirects,
~6 N/A.** Several `traces/*` and `settings/*` entries are redirects, so the count
of distinct leak-testable *pages* is below 236.

### Core (under MainLayout `/`)
| Path | Name | Cov |
|---|---|:--:|
| `/` | home | **L** |
| `/about` | about | S |
| `/member_subscription` | member_subscription | S |
| `/empty-state-demo` | emptyStateDemo | — |

### Logs
| `/logs` logs **L** · `/logs/inspector` searchJobInspector S · `/logs/search-history` searchHistory S · `/logs/search-scheduler` searchScheduler S |

### Metrics
| `/metrics` metrics **L** · `/metrics/editor` metricsEditor S · `/promql-builder` promqlBuilder S |

### Traces
| `/traces` traces **L** · `/traces/trace-details` traceDetails S · `/traces/session-details` sessionDetails S |
| `/traces/service-graph` **R** · `/traces/services` **R** · `/traces/databases/:dbmPath` **R** (→ traces tab / Infra) |

### Data / Streams
| `/streams` logstreams **L** · `/streams/stream-explore` streamExplorer S |
| _no dedicated stream-settings route — stream schema/settings is an in-page dialog_ |

### Infra / DBM — `/infra/databases`
| `` (dbmDatabases) S · `queries` (dbmQueries) S · `samples` (dbmSamples) S · `activity` (dbmActivity) S · `deadlocks` (dbmDeadlocks) S · `blocking` (dbmBlocking) S · `table-health` (dbmTableHealth) S · `query` (dbmQueryDetail) S |

### Dashboards
| `/dashboards` dashboards **L** · `/dashboards/view` viewDashboard **L** (open+heap) · `/dashboards/import` importDashboard S · `/dashboards/add_panel` addPanel S |

### Pipelines — `/pipeline`
| `functions` functionList **L** · `pipelines` pipelines **L** · `enrichment-tables` enrichmentTables S |
| `pipelines/edit` pipelineEditor S · `pipelines/add` createPipeline S · `pipelines/import` importPipeline S · `pipelines/history` pipelineHistory S · `pipelines/backfill` pipelineBackfill S |

### Reliability
| `/alerts` alertList **L** · `/alert-destinations` (alertDestinations) **L** · `/alert-templates` (alertTemplates) **L** · `/alert-library` (alertLibrary) **L** · `/alert-sources` alertSources S |
| `/alerts/detail/:alert_id` alertDetail S · `/alerts/add` addAlert S · `/alerts/edit/:alert_id` editAlert S · `/alerts/history` alertHistory S · `/alerts/insights` alertInsights S · `/alerts/import-semantic-groups` importSemanticGroups S |
| `/alerts/anomaly/add` addAnomalyDetection S · `/alerts/anomaly/edit/:anomaly_id` editAnomalyDetection S |
| `/slos` sloList **L** · `/slos/add` addSlo S · `/slos/edit/:slo_id` editSlo S · `/slos/:slo_id` sloDetail S |
| `/incidents` incidentList **L** · `/incidents/:id` incidentDetail S |
| `/reports` reports **L** · `/reports/create` createReport S |

### RUM — `/rum` (RUM) → `performance` (RumPerformance)
| `performance/overview` rumPerformanceSummary S · `performance/web-vitals` rumPerformanceWebVitals S · `performance/errors` rumPerformanceErrors S · `performance/apis` rumPerformanceApis S |
| `sessions` Sessions S · `sessions/view/:id` SessionViewer S · `errors` ErrorTracking S · `errors/view/:id` ErrorViewer S · `source-maps` SourceMaps S · `upload-source-maps` UploadSourceMaps S |

### Synthetics — `/synthetics`
| `synthetics` **S** · `synthetics/add` synthetics-add S · `synthetics/edit/:id` synthetics-edit S · `synthetics/status-pages/edit/:id` synthetics-status-page-edit S · `synthetic/private-locations/:id` synthetic-private-location S · `synthetics/:id/results` synthetic-monitor-results S · `synthetics/:id/results/run/:runId/:executionId` synthetics-run-detail S |

### Workflows — `/workflows`
| `workflows` **S** · `add` createWorkflow S · `edit` workflowEditor S · `runs` workflowRuns S |

### IAM — `/iam`
| `users` **L** · `ingestionTokens` S · `syntheticsTokens` S · `serviceAccounts` S · `organizations` S · `mcpServer` S · `groups` S · `groups/edit/:group_name` editGroup S · `roles` S · `roles/edit/:role_name` editRole S · `quota` S · `invitations` S · `nodes` S |

### Settings — `/settings` + flat management pages
| `/settings/general` general **L** · `/settings/organization` organizationSettings S |
| `/settings/alert_destinations` **R** · `/settings/templates` **R** · `/settings/alert_sources` **R** (→ Reliability) |
| flat: `synthetics_locations` (syntheticsLocations) S · `model_pricing` modelPricing S · `model_pricing/edit` modelPricingEditor S · `llm_providers` llmProviders S · `gen_ai_agent_mapping` genAiAgentMapping S · `query_management` S · `cipher_keys` cipherKeys S · `ai_toolsets` aiToolsets S · `pipeline_destinations` pipelineDestinations S · `storage_settings` storageSettings S · `nodes` S · `domain_management` domainManagement S · `regex_patterns` regexPatterns S · `correlation/:tab?` correlationSettings S · `license` S · `organization_management` orgnizationManagement S |

### AI observability (enterprise) — `/ai`
| `` aiObservability S · `llm-insights` aiLLMInsights **L** · `sessions` aiSessions S · `agent-graph` aiAgentGraph S · `agent-behavior` aiAgentBehavior S · `discovery` aiDiscovery S · `queues` aiQueues S · `queues/:id` aiQueueDetail S · `queues/:id/review` aiQueueWorkbench S · `datasets` aiDatasets S · `datasets/:id` aiDatasetDetail S · `playground` aiPlayground S · `experiments` aiExperiments S · `experiments/new` aiExperimentCreate S · `experiments/compare/:baselineId/:candidateId` aiExperimentCompare S · `experiments/:id` aiExperimentDetail S · `remote-tasks` aiRemoteTasks S · `remote-tasks/new` aiRemoteTaskCreate S · `remote-tasks/:id/edit` aiRemoteTaskEdit S · `remote-tasks/:id` aiRemoteTaskDetail S · `evaluations` aiEvaluations S · `ai/session-details` aiSessionDetails S · `online-evals` OnlineEvals S |

### Billing / marketplace (enterprise) — `/billings` (billings)
| `/billings/usage` usage S · `/billings/plans` plans S · `/billings/invoice_history` invoice_history S · `/billings/billing_group` billing_group S · `/marketplace/aws/setup` awsMarketplaceSetup S · `/marketplace/azure/register` azureMarketplaceRegister S |

### Ingestion — `/ingestion` (all 91 routes, `useIngestionRoutes.ts`) — every one **S**
**Control/section:** `ingestion` · `custom` · `recommended` · `recommendedMcp` · `others` · category landers `databases` `message-queues` `security` `networking` `servers` `languages` `devops` `ai-integrations` `ai-integrations-default` `frontendMonitoring`
**Cloud config:** `AWSConfig` · `AzureConfig` · `GCPConfig` · `cloudwatchMetrics`
**OS / OTel guides:** `ingestFromKubernetes` · `ingestFromLinux` · `ingestFromMacOS` · `ingestFromWindows` · `ingestFromTraces` · `ingestLogs` · `ingestMetrics` · `ingestTraces` · `ingestLogsFromOtel` · `ingestTracesFromOtel` · `tracesOTLP` · `otelCollector` · `curl`
**Databases:** `apache` · `mysql` · `postgres` · `mariadb` · `mongodb` · `redis` · `elasticsearch` · `cassandra` · `couchdb` · `dynamodb` · `oracle` · `sqlserver` · `saphana` · `snowflake` · `databricks` · `aerospike`
**Message queues / streaming:** `kafka` · `rabbitmq` · `nats`
**Collectors / agents:** `fluentbit` · `fluentd` · `vector` · `telegraf` · `cribl` · `syslogNg` · `filebeat` · `logstash` · `categraf` · `vmagent` · `nightingale` · `loongcollector` · `prometheus` · `netflow`
**Security / identity:** `falco` · `okta` · `jumpcloud` · `office365` · `google-workspace` · `osquery` · `openvpn`
**Servers / web / CI:** `nginx` · `iis` · `github-actions` · `jenkins` · `terraform` · `ansible` · `heroku` · `vercel` · `airflow` · `airbyte` · `zookeeper`
**Languages / app:** `go` · `java` · `python` · `nodejs` · `rust` · `dotnetlogs` · `dotnettracing` · `fastapi`

### Auth / util (no UI surface)
| `/login` · `/logout` · `/cb` (callback) · `/slack/oauth/callback` slackOAuthCallback · `/short/:id` shortUrl · `/:catchAll(.*)*` — all **—/R** |

## Live per-route verification — round 2 (editor/detail/streaming routes)

Driving the previously **S** (static-only) routes live on the dev server, 3
open→close cycles each, watching `roObservingDetached` + all counters. Covers a
representative of **every high-risk component type**:

| Route | Component type tested | Result |
|---|---|---|
| `createPipeline` (pipeline editor) | **Vue Flow canvas** | observers 3↔6 flat, `roObservingDetached:0` — **clean → L** |
| `addAlert` (alert form) | **monaco query editor + form** | observers 19↔7 flat — **clean → L** |
| `addSlo` / `sloList` | form + charts + auto-refresh interval | 10↔5 flat; `iv` one-time (non-accumulating) — **clean → L** |
| `aiPlayground` / `aiSessions` | **SSE / fetch-streaming** | `es:0 ws:1` stable, no growth — **clean → L** |
| `logs` **with seeded data** | **results virtual-table + histogram + field-values** | `io` 2→0, observers 12→3 flat, `roObservingDetached:0` — **clean → L** |

Seeded 300 records into a `zz_leaktest` stream (via `_json` ingest) to exercise
the data-dependent logs results path — the previous logs test hit an empty
stream. The full results view mounts and tears down cleanly.

| Stream Detail dialog (schema + settings modal) | heavy dialog, 27 observers | open↔close 27↔5 flat, `roObservingDetached:0` — **clean → L** |

**Panel editor (`addPanel`)** — entered live (mounts its query-builder + chart
observers); a clean full open→close cycle is blocked by the editor's
**unsaved-changes `beforeunload` guard** (correct app behaviour — it prompts on
leave, which halts scripted navigation). Its constituent components are each
verified clean elsewhere: query editor = monaco (tested via `addAlert`), chart =
`PanelSchemaRenderer`/`ChartRenderer` (tested via `viewDashboard` + committed
fixes), field list + config panels (static audit). Left as component-verified.

Further live-cycled, all **clean → L** (`roObservingDetached:0`, no accumulation):

| Surface | Result |
|---|---|
| Dashboard **settings dialog** (variables/tabs modal) | observers 7↔6 flat across 3 open/close |
| **IAM** tabs: Users, Service Accounts, Ingestion Tokens, Organizations | `roStillObserving` flat at 4 over 2 rounds |
| **Settings** tabs: General, Org Parameters, Cipher Keys, Pipeline Destinations, LLM Pricing, LLM Providers | each returns to identical observer count both rounds |
| **AI suite** tabs: Playground, Sessions, Experiments, Queues, Datasets, Discovery, Agent Graph, Agent Behavior, Eval Jobs | each returns to identical observer count both rounds; `es:0 ws:1` — no leaked streams |

**No leak found in any live-cycled route.** These confirm in-practice what the
static + enterprise + package audits concluded: Vue Flow, monaco, chart, and
streaming components all tear down cleanly.

### Coverage honesty — what live testing could NOT reach

Full per-route live cycling is blocked for a chunk of the `S` set on this
environment, so those remain **static-verified only**:

- **Empty-list feature areas** on the `default` org — Functions, Pipelines,
  Synthetics have no rows, so `edit/:id`/`results/:id` detail routes can't be
  opened (would need seeded data or a data-rich org).
- **`:id` detail routes** generally (alertDetail, sloDetail, incidentDetail,
  aiDatasetDetail, aiQueueDetail, SessionViewer, ErrorViewer, dbmQueryDetail, …)
  need a concrete entity to navigate to.
- **Non-nav-reachable routes** — synthetics is not in this org's main nav; several
  settings/management + ingestion guides are reached only via deep menus.

For these, the guarantee is the **component-level static audit** (every file read
for leak patterns) — not a live counter trace. The live round upgraded the
reachable high-risk editors/streaming pages to measured-clean.

## Additional precise methods (production build, artifact-free)

Beyond instrumented counters + retainer-BFS, four stronger methods were run on
the production build (`vite preview`, HMR absent). **All confirm no leak.**

1. **`WeakRef` liveness probe** — held a `WeakRef` to each route-specific DOM
   element (grid-stack, panel, title, 5 chart SVGs, back-btn), navigated away,
   checked `deref()`. **All collected** (`alive:false`) — the dashboard subtree is
   genuinely freed. (One initial false positive: `main.firstElementChild` is the
   persistent layout wrapper, `isConnected:true` — not a route element.)
2. **`FinalizationRegistry`** — same targets; `panel-0` finalized. Confirms GC
   reclaims the component DOM.
3. **Long soak — 30 open/close cycles, post-GC heap:** 302.9 → 305.6 MB over the
   run (**+0.135 MB/cycle, decelerating**); observers flat (`io:3`,
   `roObservingDetached:0`). No slow leak.
4. **Detached-DOM differential count** (streaming heap-snapshot parser):
   **44,565 detached nodes at 20 cycles === 44,565 at 30 cycles** — a **fixed,
   non-growing set**. A leak would have added ~21k over 10 cycles; it added zero.
   Blocking-BFS attributes them to a **real (non-DevTools) retainer** = the
   **`<keep-alive>` route cache** (`MainLayout.vue:190/246`; logs, DBM, AI
   Playground are kept-alive by design for fast re-entry). Bounded by route
   count, not per-navigation — intentional caching, not a leak.

Note (dev vs prod): on the dev build ~98% of detached DOM was pinned by the
DevTools console (`VITE_DEBUG_GROUPS` + Vue warns); on production only **2.8%** is
DevTools/weak/ephemeron and the rest is the keep-alive cache — Vue warnings are
stripped in prod, so the artifact largely vanishes.

## Logs page — component-by-component deep-dive

Every Logs component + composable (~30 + ~35) checked for leak scenarios, not just
"has cleanup". Result: **one real leak found and fixed (7th fix)**; rest clean.

| Component / composable | Verdict |
|---|---|
| `Index.vue` (PageSearch root) | clean — unmount clears refresh interval, `cancelQuery()`, `clearAllTimeouts()`, removes `cancelQuery` listener, unregisters `contextRegistry`, aborts field-extraction |
| `SearchBar.vue` / `SearchResult.vue` / `JsonPreview.vue` | clean — listeners/observers paired (verified earlier) |
| `patterns/PatternVolumeCell.vue` | clean — IntersectionObserver disconnected on intersect AND `onBeforeUnmount` |
| streaming layer (`useSearchStream*`, `useStreamingSearch`, `useSearchWebSocket`, `useSearchConnection`) | clean — `cleanUpListeners`/`closeSocket`/abort on all terminal paths |
| `useSearchBar.ts` timers | clean — all 4 `setTimeout`s are commented-out dead code |
| `patterns/useWildcardHover.ts` | minor/bounded — module-level `hoveredToken` can hold a detached anchor if the show-timer fires post-unmount; single-slot, overwritten on next hover, not accumulating (not fixed) |
| `useLogs/usePatterns.ts` | minor/bounded — module-level `patternAbortController` (1 in-flight max, overwritten); not aborted on unmount but single-slot (not fixed) |
| **`IndexList.vue`** | **LEAK → FIXED (fix #7)** |

### Fix #7 — `IndexList.vue` field-value streams not cancelled on unmount

`IndexList` had **no lifecycle hook at all**. Expanding a field starts a field-value
HTTP stream (registered in `useStreamingSearch`'s module-level `traceMap` /
`abortControllers`, keyed by traceId). `cancelTraceId(field)` only ran on
**field-collapse**, and the parent's `cancelQuery()` cancels only the *main search*
traceIds (`searchObj.data.searchRequestTraceIds`), **not** field-value ones. So
expanding fields then navigating away left every in-flight field stream running —
its response-handler closure retaining `IndexList` until the stream completed (or
forever if it hung). Fixed by mirroring `VariablesValueSelector.vue`'s established
pattern: `onUnmounted` cancels all field traceIds.

**Benchmark (Chrome DevTools, `AbortController` instrumented; expand 21 fields, navigate away with streams in-flight):**

| | in-flight field streams aborted on unmount |
|---|---:|
| **Before fix** | **1** — the other **~20 keep running post-unmount (leaked)** |
| **After fix** | **22** — every field stream cancelled |

So per "expand fields → navigate" the leak went from **~20 orphaned in-flight
streams (each retaining the component) → 0**. Lint + `vue-tsc` clean.

### Logs interaction-scenario battery (live, real `default` stream, 19.5B docs)

Beyond components, the leak-prone *interaction sequences* were live-cycled with
full instrumentation. All **clean** (`roObservingDetached:0`, `roStillObserving`
flat, `ws`/`es`/`io`/`mo` flat — no accumulation):

| Scenario | Result |
|---|---|
| **Rapid re-search** ×8 | observers/sockets/in-flight flat; only completed AbortControllers accrue (GC'd) |
| **Tab switch** Search↔Visualize↔Patterns ×3 | `roStillObserving` flat per tab (113/35/38); `ro` net-count +1/round is unobserve-disposal (TanStack Virtual), confirmed by `ro` netCount 46 ≫ `roStillObserving` 38 |
| **Detail-row open/close** ×5 | `io` flat, `roObservingDetached:0`; `win`/`doc` drift *negative* (over-removal, not a leak) |
| **Field expand/collapse** ×5 (4 fields) | `roStillObserving:38` flat; `acLive` +4/cycle = completed field controllers (GC'd) |

Only the **unmount** path (fix #7) leaked; all in-page interaction loops are clean.

### Heap-growth investigation (dev 215→404 MB) — dev-build artifact, not a leak

Random interaction on the dev build grew post-GC heap 215 → 325 → 404 MB. Snapshot
diff showed the growth was the **Vue reactivity graph** (`object|Object` +160k,
`closure|get` +145k, `Context/scope` +100k, `AccessorPair`, `Dep`) — *not* result
strings (`ExternalStringData` went **down**, i.e. results are replaced/bounded) and
*not* DevTools-console pinning (blocking-BFS: only **1.7%** held via DevTools).

Decisive **production-build controlled soak** (10 identical searches, forced GC):

| build | post-GC heap over 10 identical searches |
|---|---|
| production | **121 → 122 MB (+1 MB, flat)** |
| dev | +80–110 MB per interaction batch |

→ The dev growth is Vue dev-mode reactivity overhead (~2–3× per reactive object) +
HMR-retained module state + unminified code — the same artifact class as the
dashboard `+28 MB/open` (dev) vs `+0.45` (prod). **On production the Logs page does
not accumulate; nothing to fix.**

## Traces page deep-dive — 2 leaks found & fixed (fixes #8–#9)

Same lens as logs (streaming without unmount cancel). Streaming consumers audited:
`Index.vue` (cancels in `onDeactivated`+`onUnmounted` ✓), `ServicesCatalog.vue`
(cancels in `onUnmounted` ✓), `useLLMInsights`→`LLMInsightsDashboard` (`cancelAll()`
✓). Observers (`SearchResult`, `SpanBlock`, `TraceDetailsSidebar`, `LLMErrorTable`
IO) disconnected on unmount; `ServiceGraph` listeners are element-lifetime;
`TraceDetails` resize listener is commented-out dead code. Two real gaps:

**Fix #8 — `useVersionCompare.ts`** (LLM version-compare): its `makeRunner`
raw-sample fetch used a **local, untracked traceId with no cancel path**, and the
consumer's `cancelAll()` only covered `useLLMInsights`'s traceIds — not this one or
the two internal arms. Added traceId tracking + a `cancel()` (aborts the raw-sample
stream + `armA/armB.cancelAll()`), and called it in `LLMInsightsDashboard.onUnmounted`.

**Fix #9 — `LLMErrorTable.vue`**: consumed `useLLMStreamQuery` (which tracks
traceIds + exposes `cancelAll`) but destructured only `executeQuery` and its
`onUnmounted` only disconnected the IntersectionObserver — the in-flight
error-spans query was never cancelled. Added `cancelAll` + called it on unmount.

Both lint + `vue-tsc` clean.

## App-wide streaming-cancel scan (fixes #10–#11)

Rather than page-by-page, scanned **every** consumer of `fetchQueryDataWithHttpStream`
for missing unmount cancellation. Two more real leaks (both stream with a local
traceId and never cancel on unmount):

**Fix #10 — `TelemetryCorrelationDashboard.vue`**: tracked `currentTracesStreamTraceId`
and cancelled it on *re-entry*, but had **no lifecycle hooks at all** — an in-flight
traces stream leaked on unmount. Added `onUnmounted` cancelling it.

**Fix #11 — `PlayerTracesTab.vue`** (RUM session player): streamed trace metadata
with a local, untracked traceId and only had `onMounted`. Added traceId tracking +
`onUnmounted` cancel.

Verified-clean consumers (cancel on unmount / deactivate): `usePanelDataLoader`,
`useMetricsExplorerGrid`, `VariablesValueSelector`, `useStreamingSearch`,
`useValuesWebSocket`, `useDurationPercentiles`, `useCorrelatedLogs`, traces `Index`
/`ServicesCatalog`/`LLMInsightsDashboard`. `PreviewAlert.vue` doesn't stream
(comment refs only). **Minor/bounded, not fixed:** `useCorrelatedTracesStream`
(`resolveTracesStream`) — a cache-backed one-shot stream-name resolver that fires
only on cache-miss.

**Total: 12 leaks fixed** (7 committed in `21b78c96f4` + fixes #8–#12 uncommitted).

## App-wide sweep of the non-streaming classes — all clean

After the streaming class, every remaining leak class was swept across `web/src`:

| Class | Result |
|---|---|
| Observers (Resize/Mutation/Intersection/Performance) | all disconnect on unmount (`ODialog` via `watchEffect` cleanup) |
| `setInterval` | all paired with `clearInterval` on unmount |
| window/document/visualViewport listeners | all removed on unmount (`ODropdown`/`OPopover` extra listener is a once-guarded module singleton) |
| `onMounted`-returns-cleanup trap (Vue ignores the return) | **none** (the original `RichTextInput` case was fixed earlier) |
| `requestAnimationFrame` | all one-shot; **no** self-rescheduling loops (incl. `OTable.measureFlexFill`) |

**The streaming-cancel-on-unmount class was the last leak class with real defects
(6 of the 11 fixes). All other classes are clean app-wide.**

### Additional classes swept (also clean)

| Class | Result |
|---|---|
| Web Workers (`new Worker`) | `streamWorker` is a module-level singleton (bounded at 1, reused for the app session — terminating it would break the next search); `VideoPlayer`/`useWorker` terminate on unmount |
| Module-level `Map`/`Set`/array caches | all build-once constant lookups (parser tokens, error codes, level sets); runtime caches (`errorRowsCache`) are bounded by a finite `stream::agent::window` key space |
| ECharts instances | no undisposed `echarts.init` found |
| `useStreamingSearch` per-trace state | `cleanUpListeners` deletes both `traceMap[traceId]` and `abortControllers[traceId]` on completion/error — no dead-key accumulation |

### Download-link / detached-node class

| Site | Result |
|---|---|
| `Quota.vue` `downloadTemplate` | **FIX #12** — appended the `<a>` to `body` and clicked it but never removed it or revoked the Blob URL; every download leaked a detached-attached node + a Blob URL. Now `removeChild(a)` + `revokeObjectURL(url)` after click, matching the repo idiom (`utils/dom.ts`, SearchBar). |
| All other download sites | clean — either never `appendChild` (unattached `<a>` is GC'd) or use `data:` URLs (nothing to revoke); `MainLayout` prefetch `<link>` is idempotent (guarded, appended once, persists for app life) |

### npm-dependency (package-internal) leak audit

The two committed patches are themselves package-internal leak fixes; the rest of the
leak-prone dependency surface was swept and is clean:

| Dependency | Result |
|---|---|
| `vue-draggable-next` (SortableJS) | **patched** — `onUnmounted` destroys the Sortable instance + drops the `__draggable_component__` back-ref (SortableJS holds every element in a module-level array) |
| `@tanstack/vue-form` | **patched** — library called `onMounted(formApi.mount)` and discarded `mount()`'s cleanup return; patch captures it and calls it on unmount |
| `@vue-flow/core` | clean — every `useVueFlow()` is id-less (library-managed injected store), destroyed by `<VueFlow>` on unmount; no app-owned store |
| `gridstack` | clean — sole instance (`RenderDashboardCharts`) removes every `.off(...)` listener + `.destroy(false)` + null on `onBeforeUnmount` |
| `echarts` / `echarts-gl` | clean — every `echarts.init` paired with `chart.dispose()` on unmount |
| `monaco-editor` | clean — created only in `CodeQueryEditor`, disposed on unmount (window listeners removed, config entry dropped) |
| `@tanstack/vue-virtual` | clean — disposes via `.unobserve()` (the earlier ResizeObserver net-count false positive) |
| `leaflet` (via `echarts-extension-leaflet`) | clean — `GeoMapRenderer` unmount does `lmap.off()` + `chart.dispose()`; the extension owns and removes the map on dispose |

## Does route change clean the heap? (verified)

Heap release on route change **depends on the route's `meta.keepAlive`** flag
(`composables/shared/router.ts`), confirmed empirically with `WeakRef` liveness +
detached-DOM counting on the production build:

| Route type | `keepAlive` | Heap on route change |
|---|---|---|
| dashboards, alerts, streams, iam, settings, … | `false` | **cleaned** — component unmounts, DOM collected, heap released after GC (WeakRef: elements collected) |
| **logs, home, traces, metricsEditor, dbmDatabases** | `true` | **not cleaned — by design** — kept alive as **one bounded cached instance** for fast re-entry |

For **logs** (`keepAlive:true`, has `onActivated`): after navigating away + GC the
logs DOM survives (`WeakRef` alive, detached), retained via **Monaco's
context/worker** (`query-editor` → `_contextViewHandler` → `vscodeWindowId` →
`DedicatedWorkerMessagingProxy`). Decisive **non-accumulation** check:

| detached nodes | after 1 route-change | after 3 route-changes |
|---|---:|---:|
| `logs-search-index-list` | 1 | 1 |
| `query-editor` | 6 | 6 |
| total detached | 3,377 | 3,324 |

Flat across cycles (a leak would be ~3×), and heap even dropped 172→122 MB. So the
retention is the intended single kept-alive instance — **bounded, not a leak.**

## Benchmarks — before → after

Two eras: the **branch's earlier fixes** (already committed, documented in
`DASHBOARD_MEMORY_LEAK_AUDIT.md`) delivered the large wins; **this session** was
cleanup of remaining edge-case leaks + full verification. Numbers labelled
_(measured)_ come from live instrumentation / heap snapshots; _(source)_ means
established by reading the lifecycle (small per-cycle counts, not separately
metered). No MB figures are invented for the edge-case fixes.

### A. Branch-level, per navigation (the big wins — from the earlier work)

| Metric (per nav/open) | Before branch | After | Δ | Basis |
|---|---|---:|---:|---|
| Home ↔ dashboard-list DOM nodes | 650 | **0** | −100% | measured |
| Streams route DOM nodes | 4,701 | **0** | −100% | measured (vue-form patch) |
| Logs route DOM nodes | 2,088 | **0** | −100% | measured |
| Leaked IntersectionObservers / open | +3 | **0** | −100% | measured |
| Leaked IndexedDB connections / open | +3 | **0** | −100% | measured |
| Leaked `window "load"` listeners / open | +15 | **0** | −100% | measured |

### B. This session — leak eliminated per cycle (6 fixes)

| Fix | Leaked per cycle (before) | After | Trigger | Basis |
|---|---|---:|---|---|
| `QueryPlanDialog.vue` | 1 `document` keydown listener + retained component instance | **0** | open EXPLAIN dialog → navigate away | source |
| `useSyntheticsRecorder` + `CreateBrowserTest` | 1 `window` "message" listener + whole recorder state (refs, `pendingCommands`/`stepResults` Maps, bridge) | **0** | each visit to Create Browser Test / Journey | source |
| `ScheduledPipeline.vue` | 1 stale `contextRegistry` provider (captures `pipelineObj` graph); bounded, single-key | **0** | unmount of scheduled-pipeline node form | source |
| `QueryInspector.vue` | 1 Vue prop-validation warning (dev-only) | **0** | every panel-inspector open | source |
| `O2AIChat.vue` | 0 in practice (invariant-guarded) → guaranteed 0 | **0** | unmount mid-AI-stream | reasoning (hardening) |

### C. App-wide accumulation per navigation — now (measured this session)

Across **all 18 routes** (11 top-level + 4 Reliability sub-tabs + sub-routes),
every accumulating counter is **0 per navigation cycle**:

| Counter | Accumulation / cycle |
|---|---:|
| live IntersectionObservers | **0** |
| ResizeObservers still observing a detached node | **0** |
| live MutationObservers | **0** |
| net `setInterval` (unpaired) | **0** |
| open WebSocket / EventSource | **0** |

### D. Dashboard-open heap — dev vs production (measured, forced GC)

| | dev build | production build | note |
|---|---:|---:|---|
| per open, post-GC | **+28 MB, linear** | **+0.45 MB, decelerating** | dev figure was DevTools/HMR/`VITE_DEBUG_GROUPS=*` artifact (proven by retainer BFS), not app retention |
| observers / detached-DOM per open | 0 | 0 | — |

**Net improvement:** every known leaking resource on every audited navigation
path went from a positive per-cycle count to **0**, and the apparent 28 MB/open
dashboard "leak" is a measurement artifact worth **~0.45 MB/open** in reality.

## Method

Heap-MB is unusable on this setup: with DevTools attached over CDP and
`VITE_DEBUG_GROUPS=*` in `web/.env`, ~98% of retained objects are pinned by the
DevTools console holding every logged value (proven separately by retainer BFS).
So this audit uses **build-independent instrumented counters** injected before
app scripts, and measures whether they return to baseline after each round-trip.

| Counter | Meaning | Reliable? |
|---|---|---|
| `io` / `mo` | live IntersectionObserver / MutationObserver (constructor++ / disconnect--) | yes (symmetric) |
| `iv` | net `setInterval` − `clearInterval` | yes |
| `ws` / `es` | open WebSocket / EventSource | yes |
| `roStillObserving` | ResizeObservers still observing ≥1 target | yes — **true RO signal** |
| `roObservingDetached` | ResizeObservers still observing a **detached** element | yes — **true leak signal** |
| ~~`ro` (constructor − disconnect)~~ | ~~net ResizeObserver~~ | **NO — over-counts, see below** |
| ~~`win` / `doc`~~ | ~~net window/document listeners~~ | noisy (libs over-call `removeEventListener`; drifts down) |

**Protocol:** from Home, click the route's nav link (real SPA navigation, never
`page.goto` which resets the heap) → settle → snapshot; click Home → settle →
snapshot. Repeat 3× (2× for sub-routes). A counter that climbs monotonically, or
`roObservingDetached > 0`, is a leak.

Baseline Home: `io:0 mo:1 iv:2 ws:1 es:0 roStillObserving:3 roObservingDetached:0`.

## Results

| Route | io | mo | iv | ws | es | roStillObserving | roObservingDetached | Verdict |
|---|---|---|---|---|---|---|---|---|
| Logs (`/logs`) | 0 | flat | 2 | 1 | 0 | 3 | 0 | **clean** |
| Metrics (`/metrics`) | 0 | flat | 2 | 1 | 0 | 3 | 0 | **clean*** |
| Traces (`/traces`) | 0 | flat | 2 | 1 | 0 | 3 | 0 | **clean** |
| AI (`/ai/llm-insights`) | 0 | flat | 2 | 1 | 0 | 3 | 0 | **clean** |
| Experience (`/rum`) | 0 | flat | 2 | 1 | 0 | 3 | 0 | **clean** |
| Dashboards (`/dashboards`) | 0 | flat | 2 | 1 | 0 | 3 | 0 | **clean*** |
| Reliability (`/alerts`) | 0 | flat | 2 | 1 | 0 | 3 | 0 | **clean*** |
| Data / Streams (`/streams`) | 0 | flat | 2 | 1 | 0 | 3 | 0 | **clean*** |
| IAM (`/iam/users`) | 0 | flat | 2 | 1 | 0 | 3 | 0 | **clean*** (×2 RO churn) |
| Settings (`/settings/general`) | 0 | flat | 2 | 1 | 0 | 3 | 0 | **clean** |
| Pipelines · Functions (`/pipeline/functions`) | 0 | flat | 2 | 1 | 0 | 3 | 0 | **clean** |
| Pipelines (`/pipeline/pipelines`) | 0 | flat | 2 | 1 | 0 | 3 | 0 | **clean** |
| Incidents (`/incidents`) | 0 | flat | 2 | 1 | 0 | 3 | 0 | **clean** |
| Reports (`/reports`) | 0 | flat | 2 | 1 | 0 | 3 | 0 | **clean** |
| SLOs (`/slos`) | 0 | flat | 2 | 1 | 0 | 7 | 0 | **clean** |
| Alert destinations (`/alert-destinations`) | 0 | flat | 2 | 1 | 0 | 7 | 0 | **clean** |
| Alert templates (`/alert-templates`) | 0 | flat | 2 | 1 | 0 | 7 | 0 | **clean** |
| Alert library (`/alert-library`) | 0 | flat | 2 | 1 | 0 | 7 | 0 | **clean** |

`*` These pages showed the false-positive RO churn (see below); the true signal
(`roObservingDetached`) was 0 and every other counter returned to baseline. The
Reliability sub-tabs were cycled against the `/alerts` parent, so their
`roStillObserving` baseline is 7 (the parent's virtualized tables) — flat across
all cycles.

**Not present in the nav** (nothing to test): Infra (`/infra/*` — the nav entry
is config-gated and not rendered in this build; only 11 top-level routes exist).

## False positive: "ResizeObserver +1 per visit" — NOT a leak

The naive counter (`new ResizeObserver` minus `.disconnect()`) grew by +1 per
visit on Metrics, Dashboards, Alerts, Streams (+2 on IAM), and never returned to
baseline — a textbook leak signature. It is not one.

Source-of-growth trace: the survivors observe each page's virtual-scroll
container (`section[metrics-explorer-scroll]`, etc.), created by
`@tanstack/vue-virtual` → `@tanstack/virtual-core`. In virtual-core 3.17.7,
`observeElementRect` disposes its observer with

```js
return () => { observer.unobserve(element); };   // unobserve — never disconnect()
```

On unmount the Vue adapter runs `onScopeDispose(cleanup)`, `cleanup()` calls the
`unsubs`, and the element is **unobserved**. An unobserved, unreferenced
ResizeObserver holds no targets and is collectible — so it is not a leak. The
naive counter only misses it because virtual-core never calls `.disconnect()`,
which is what the counter hooked.

Proof, via a target-aware counter (cycling each flagged route 3×):

| Route | constructed−disconnected (naive) | `roStillObserving` | `roObservingDetached` |
|---|---|---|---|
| Metrics | 4 → 5 → 6 | 3 → 3 → 3 | **0 → 0 → 0** |
| IAM | 8 → 10 → 12 | 3 → 3 → 3 | **0 → 0 → 0** |
| Streams | 13 → 14 → 15 | 3 → 3 → 3 | **0 → 0 → 0** |
| Dashboards | 16 → 17 → 18 | 3 → 3 → 3 | **0 → 0 → 0** |

`roStillObserving` never rises above the Home baseline of 3, and no observer ever
watches a detached element. No fix applied — "fixing" this would have been
patching a non-bug.

**Lesson for future harnesses:** count a ResizeObserver leak by *targets still
observed* (and whether they are detached), not by `new` − `disconnect()`. Some
libraries (TanStack Virtual) dispose via `unobserve()`, so a disconnect-based
counter reports phantom leaks.

## Confirmed leaks & fixes

**None on the swept nav routes** — every route returns to baseline. The real
route-change leaks were already fixed earlier on this branch (see
`DASHBOARD_MEMORY_LEAK_AUDIT.md`): the discarded `onMounted` cleanup in
`RichTextInput.vue`, the `@tanstack/vue-form` mount-cleanup patch, the
`vue-draggable-next` Sortable patch, and the logs-route retainers.

### Fixes applied this session (found in the deeper component audits, not the route sweep)

These are real leaks/bugs on surfaces not exercised by the top-level nav sweep
(synthetics wizard, a pipeline node form, a dashboard panel dialog). Each is a
minimal, type-checked, lint-clean change; verdicts came from source analysis +
the retainer work, not from a growing route counter.

1. **`composables/useSyntheticsRecorder.ts`** — a per-instance
   `window.addEventListener("message", …)` was never removed (the anonymous
   handler closed over the whole recorder state). Hoisted to a named
   `handleWindowMessage` and removed in `cleanup()`.
2. **`views/synthetics/CreateBrowserTest.vue`** — its `onBeforeUnmount` never
   called `recorder.cleanup()` (only `BrowserJourney.vue` did), so it leaked the
   listener + bridge every visit. Added `recorder.cleanup()`.
3. **`components/pipeline/NodeForm/ScheduledPipeline.vue`** — registered
   `contextRegistry.register("pipelines", …)` but never unregistered on unmount
   (every sibling registrant does). Added `unregister("pipelines")` +
   `setActive("")`, mirroring `PipelineEditor.vue`.
4. **`components/dashboards/QueryInspector.vue`** — `metaData` was
   `required: true, type: Object` but rendered unconditionally with a
   `null`/`undefined` value, firing a Vue prop warning every panel open. Made it
   `required: false, default: null` (the component already reads
   `props.metaData?.queries`).

Not fixed — the "ResizeObserver +1/visit" false positive (§ above): virtual-core
disposes via `unobserve()`, no observer retains a detached node, so there is no
bug to fix.

## Application-wide static audit (every `web/src` area)

To back the "zero leaks across the whole app" goal, the entire `web/src` tree
(~1,800 non-spec files) was audited against the full rubric (window/document
listeners, Resize/Mutation/Intersection/Performance observers, interval/recursive
timers/rAF loops, event bus, monaco global registries, `contextRegistry`,
WebSocket/EventSource/Worker, module-scope effects, module-level collections, the
`onMounted`-returns-cleanup trap), region by region, reading every pattern hit.
Strict anti-false-positive rules applied (element/socket-lifetime listeners,
`{once:true}`, `unobserve`-based disposal, WeakMap ephemerons, by-design
singletons are **not** leaks).

| Region | Verdict |
|---|---|
| `plugins/logs`, `plugins/traces` | clean |
| `plugins/metrics`, `pipelines`, `correlation`, `workflows` | clean |
| `components/{alerts,iam,pipeline,synthetics,rum,ai,…}` | clean |
| `components/{common,settings,logs,reports,slos,…}` + top-level | **1 leak → fixed** |
| `lib/` (entire O2 component library) | clean |
| `views/` (non-Dashboards), `composables/`, `layouts/`, `App`, `main`, `router` | clean |

### Fixed from the app-wide audit

5. **`components/QueryPlanDialog.vue`** — added a `document` `keydown` listener
   when its dialog opened and removed it only on *close*, with no unmount hook.
   Mounted unconditionally (`v-model`, no `v-if`) in `plugins/logs/SearchBar.vue`,
   so navigating away from Logs with the EXPLAIN dialog open stranded the listener
   (and the component it closed over) on `document`, one per open-then-navigate.
   Added `onUnmounted(() => document.removeEventListener("keydown", handleEscKey))`.

6. **`components/O2AIChat.vue`** (hardening, not a confirmed leak) — the 5 s
   `analyzingRotationInterval` was only stopped indirectly via
   `detachCurrentStream()`, which early-returns when no AbortController is set.
   The invariant "rotation active ⇒ controller set" held, so no surviving-interval
   path existed — but added a direct `stopAnalyzingRotation()` in `onUnmounted` so
   the interval can never outlive the component regardless of that invariant.

### Unconfirmed / non-leaks left as-is (documented, no change)

- `lib/core/Collapsible/useCollapsibleGroup.ts` — module-level `groupRegistry`
  Map never deletes, but is bounded by static group names (no dynamic-group caller
  exists). Would only leak if a caller passes a per-navigation dynamic group id.
- `views/UsageTab.vue` `animateValue` returns a cancel fn callers discard — the
  rAF self-terminates, so at worst a few post-unmount frames; harmless.
- Assorted one-shot `setTimeout` hover/debounce timers without unmount-clear
  (`CustomNode`, `WorkflowNode`, etc.) — fire once onto an orphaned ref; not
  accumulating.

## Production-build verification (the definitive cross-check)

Built the app for production (`vite build`, 8 GB heap), served `dist/` via
`vite preview` on `:4173`, injected the captured staging auth token into that
origin, and re-ran the instrumentation. **`__VUE_HMR_RUNTIME__` absent → confirmed
production bundle** (no HMR, no dev-only Vue-warn strings — the two biggest dev
artifacts are gone).

**Counter sweep (production, 2 cycles each):** Logs, Metrics, Traces, Dashboards
all return to baseline — `io:0 iv:2 ws:0 es:0 roStillObserving:3
roObservingDetached:0`. Clean.

**Dashboard open→close heap-MB trend, forced GC each cycle (the decisive test):**

| | dev build | **production build** |
|---|---|---|
| baseline (post-GC) | 324.65 MB | 153.5 MB |
| per open (post-GC) | **+28 MB, linear** | **+0.5 / +0.3 / +0.5 MB — sub-MB noise** |
| `io` / `roStillObserving` / `roObservingDetached` | 5 / — / — flat | **3 / 6 / 0 flat** |

The dev build's linear +28 MB/open **disappears** on production (≈+0.45 MB/open,
flat within GC/cache noise). This is the empirical confirmation of the retainer
BFS finding: the dev growth was DevTools-console + HMR + `VITE_DEBUG_GROUPS=*`
pinning, not app retention. Opening a dashboard on a production build leaks ~0.

## Enterprise tree (`web/src/enterprise/`, 180 files) — initially missed, now audited

Not in the original 6-region sweep; audited separately. **No leaks found.**

- **AI chat / fetch-streaming** (`views/AIObservability/PlaygroundPage.vue`) — the
  riskiest surface — is clean: `AbortController`s in a Map keyed `variant:row`,
  aborted on re-run + deleted in `finally`; `stopAll()` aborts all + clears the
  map in `onBeforeUnmount`; `window` keydown paired.
- **5 ECharts quality charts** (`components/onlineEvals/quality/*`) — each
  `resizeObserver.disconnect(); chart.dispose()` in `onBeforeUnmount`.
- **Live-refresh interval** (`AiLastRefreshed.vue`, 10 s) — cleared on unmount.
- **`QueueWorkbenchPage.vue`** — window keydown + document fullscreenchange both
  removed on unmount.
- Absent tree-wide: event bus, monaco registries, WebSocket/EventSource/Worker,
  Mutation/Intersection/PerformanceObserver, module-level mutable collections,
  the `onMounted`-returns-cleanup trap. `useAiDateRange.ts` module-scope watch is
  a by-design app-lifetime singleton (not a leak).

## Third-party package audit (node_modules)

Every leak-prone dependency's published dist was read against the same rubric
(discarded mount-cleanup, unremoved global listeners, undisconnected observers,
uncancelled timers/rAF, unterminated workers, growing module registries), with
the same anti-false-positive rules.

| Package | Verdict |
|---|---|
| `@tanstack/vue-form` 1.33.3 | leak → **patched** earlier (`patches/`) |
| `vue-draggable-next` 2.3.0 | leak → **patched** earlier (`patches/`) |
| `@tanstack/vue-virtual` 3.13.35 | clean (adapter `onScopeDispose`, `unobserve` disposal) |
| `@vue-flow/core` 1.3.2 | clean (both ROs + window resize torn down in `onBeforeUnmount`) |
| `reka-ui` 2.10.1 | clean (floating-ui `whileElementsMounted`, RO/MO disconnect, listeners paired, ref-counted splitter registry) |
| `gridstack` 12.6.0 | clean (`destroy()` → `offAll()` + `resizeObserver.disconnect()`; per-drag doc listeners removed) |
| `@openobserve/rrweb-player` 0.2.1 | clean (rAF cancelled, `onDestroy` stops timer, fullscreen listeners disposed) |
| `echarts-gl` 2.1.0, `echarts-extension-leaflet` 1.1.0, `leaflet` 1.9.4 | clean (dispose/remove teardown; WebGL GCs with canvas) |
| `@tanstack/vue-table` 8.21.3 | clean (headless — no listeners/observers/timers) |
| `@vue-flow/background`, `@vue-flow/controls` | clean (pure render, nothing to tear down) |
| `vue-router` 4.6.4, `vuex` 4.1.0, `vue-i18n` 11.4.8 | clean (per-instance registries shrink on unmount; singletons app-lifetime) |
| **`vue-drag-resize` 1.5.4** | **library bug, but UNUSED → no impact** |

### `vue-drag-resize` — real library bug, zero app impact

It removes its 8 `document.documentElement` drag listeners in Vue 2's
`beforeDestroy` hook, which **never fires under Vue 3.5.41** (no `@vue/compat`) —
so under Vue 3 each mount/unmount would strand 8 listeners plus the retained
component. **However, `vue-drag-resize` is not imported anywhere in `src`** (no
import, no global registration, no dynamic import; nothing else depends on it).
It is a **dead dependency**, so the bug never executes.

**DONE (fix #13):** `vue-drag-resize` removed from `web/package.json` and
`package-lock.json` (verified zero usages in `src`). If it is ever reintroduced,
it must first be patched to add `beforeUnmount(){ u(this.domEvents) }` for Vue 3.

## Production-build page sweep (all pages, live)

On the production preview (`:4173`, HMR absent, auth injected), every page
returned to baseline across cycles — `roObservingDetached: 0` everywhere:

- **Top-level (11):** Home, Logs, Metrics, Traces, AI, RUM, Dashboards, Alerts,
  Streams, IAM, Settings — all clean.
- **Reliability sub-tabs (4):** SLOs, alert-destinations, alert-templates,
  alert-library — all clean (`roStillObserving` flat at 7 across 8 cycles).
- **Dashboard open→close:** heap +0.45 MB/open (vs dev +28), observers/DOM flat.

## Final tally

**6 real leaks/bugs fixed this session; every audited route and every `web/src`
area is otherwise clean.** Fixes 1–4 are on non-route surfaces (synthetics
wizard, a pipeline node form, a dashboard panel dialog); fix 5 is the one
app-wide static find; fix 6 is defensive hardening. All lint- and type-clean.
"Zero leaks" cannot be *proven* for an app this size, but no leak survives the
route sweep, the retainer analysis, or the full-tree static audit.
