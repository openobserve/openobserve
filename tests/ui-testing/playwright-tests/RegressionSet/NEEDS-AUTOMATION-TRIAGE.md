# `Needs-Automation` triage — closed issues

Queue for the 85 closed `openobserve/openobserve` issues labelled
`Needs-Automation` as of 2026-09-15. Audited by cross-referencing every
`#NNNN` mention and `@bug-NNNN` tag across `playwright-tests/`, `pages/` and
`api-testing/`.

Keep this file updated as rows move. The label on the issue is the source of
truth for "done"; this file is the working queue and the reasoning behind the
calls that are **not** going to be automated.

## Conventions this queue assumes

- One spec per **theme** (2–5 related issues), not one per issue and not
  appended to the `*-bugs.spec.js` buckets. See `../../ci-matrix/README.md`
  for how a spec joins a shard.
- Every test carries `@bug-NNNN` — hyphenated. `@bugNNNN` silently breaks
  tag-based coverage queries; six specs had drifted and were normalised.
- A new spec must be added to `run_files` in
  `tests/ui-testing/ci-matrix/ci_matrix_regression.json` or it never runs.

## Done — automated (10 tests, 10 issues)

| Issue | Spec | Test |
|---|---|---|
| #12703 | `Traces/traces-filter-reset.spec.js` | reset clears the error-only `span_status` filter |
| #2067  | `Pipelines/enrichment-lifecycle.spec.js` | duplicate name refused, original data intact |
| #2937  | `Pipelines/enrichment-lifecycle.spec.js` | list reflects create/delete with no refresh |
| #12647 <br> #9498 | `Pipelines/pipeline-preview-bounds.spec.js` | row View preview stays inside the viewport |
| #11534 | `DataSources/datasources-regression.spec.js` | all 6 AI categories present; Frameworks lists integrations and renders docs |
| #7030  | `Pipelines/pipeline-export.spec.js` | bulk export appears on selection and the downloaded JSON carries node definitions |
| #7332  | `Logs/logs-multistream-share-url.spec.js` | multi-stream selection restored from a short link — CI only; **verified green in CI** |
| #11353 | `Logs/logs-histogram-severity.spec.js` | backend nominates `severity` as the breakdown field and groups by `zo_sql_breakdown` |
| #11441 | `Logs/logs-histogram-severity.spec.js` | a numeric severity leaves the query histogram-eligible and the chart renders |

#9498 and #12647 are the same bug filed twice.

## Already covered — LABELS SWITCHED 2026-09-15 (20)

All 20 moved `Needs-Automation` → `Automation-Complete` on 2026-09-15. The two
labels are mutually exclusive by convention — 0 of the 96 pre-existing
`Automation-Complete` issues carried both — so the switch removes one and adds
the other. Closed `Needs-Automation` went 85 → 65.

Verified by locating each `@bug-NNNN` tag's enclosing `test(`, then confirming
the tag exists in `git show main:<file>` so nothing added on this branch is
counted. Line numbers are as of `main`.

| Issue | Test location |
|---|---|
| #4288  | `RegressionSet/Alerts/alerts-bugs.spec.js:332` |
| #4342  | `RegressionSet/Alerts/alerts-bugs.spec.js:298` |
| #5839  | `RegressionSet/Logs/logs-bugs.spec.js:1515` |
| #7671  | `RegressionSet/Streams/streams-regression.spec.js:262` |
| #8641  | `RegressionSet/Logs/logs-bugs.spec.js:1475` |
| #8928  | `RegressionSet/Logs/logs-bugs.spec.js:242` |
| #9325  | `RegressionSet/General/ui-regression.spec.js:115` |
| #9354  | `RegressionSet/Streams/streams-regression.spec.js:226` |
| #9565  | `RegressionSet/General/ui-regression.spec.js:149` |
| #10872 | `RegressionSet/Alerts/alerts-regression.spec.js:370` |
| #10899 | `RegressionSet/Alerts/alerts-regression.spec.js:278` |
| #11231 | `RegressionSet/Reports/reports-regression-bugs.spec.js:28` |
| #11315 | `RegressionSet/Alerts/alerts-bugs.spec.js:256` |
| #11483 | `RegressionSet/Pipelines/pipeline-regression.spec.js:513` |
| #11604 | `RegressionSet/General/landing-regression.spec.js:28` |
| #11682 | `RegressionSet/DataSources/datasources-regression.spec.js:29` |

Four of the 20 were invisible to a tag-based audit. Tags have now been added so
the next sweep finds them (`--grep @bug-NNNN` resolves for all four):

| Issue | Test location | Was missed because | Tag added |
|---|---|---|---|
| #14038 | `Alerts/alerts-priority-tags.spec.js:186`, `:211` | issue cited only in a comment | on both frequency tests |
| #13224 | `Dashboards/dashboard-favorites.spec.js` (9 tests) | spec never cited the issue at all | on the `describe` — the tests carry no tag arrays |
| #4483  | `RegressionSet/Logs/logs-bugs.spec.js:1853` | duplicate of #5277, which is what the test was tagged with | `@bug-4483` alongside `@bug-5277` |
| #11463 | `web/src/components/traces/FlameGraphView.spec.ts:482` | unit test, and correctly so — the flame graph is a canvas | comment reference (Vitest has no tag mechanism) |

### Partially covered (2)

| Issue | What exists | What is missing |
|---|---|---|
| #7030  | `Pipelines/pipelines.spec.js:78` covers the empty-name error | bulk export — **added on this branch** |
| #10270 | `Logs/logspage.spec.js:498` drives the exact repro (`limit` + Search Around) | asserts only that something rendered; the bug is the **count** |

### Further label-flip candidates found while picking the next batch (2)

| Issue | Existing coverage |
|---|---|
| #9875 | `web/src/components/alerts/AddAlert.schema.spec.ts:87` — tests `name: "bad name"` (a space) plus `:`/`#`/`%`, which is exactly the PR #11366 fix |
| #7280 | `web/src/components/reports/ReportList.spec.ts:574` — "should remove the report from lists after successful delete" |

### Looked covered, is not (1)

`#5745` — `tests/api-testing/tests/alerts/test_v2.py:381` explicitly declines to
assert `last_triggered_at` *because of this bug*. The comment is stale now the
issue is closed. Moved to the API queue.

## Blocked on a skip, not on missing work (3)

A test exists but does not run. Each needs a decision, not authoring.

| Issue | State | Blocker |
|---|---|---|
| #9996  | `test.skip` in `Logs/logs-bugs.spec.js` | "timing out in current test environment (selectStream failures)" |
| #10103 | `test.skip` in `Logs/logs-bugs.spec.js` | no reason recorded |
| #9550  | `test.skip` in `Logs/logs-bugs.spec.js` | VRL computed field never appears after the transform — product issue |

#9550 existed **only** in an untracked, gitignored `.bak` file and was recovered
into the live tree in this batch. `Logs/logstable.spec.js` claimed it had
"moved to RegressionSet/logs-regression.spec.js"; it had not.

## Environment-gated (1)

`#7332` is automated but **cannot run where `web_url` is unset**. Multi-stream
state is deliberately NOT in the address bar — only the first stream reaches
`window.location`, verified against o2latestmain — because the selection is
held server-side against the **short link**, which is what the fix addressed
(the issue's closing verification cites a `/web/short/…` URL). So the test has
to click Share, and `ShareButton` is disabled when `web_url` is empty
(components/common/ShareButton.vue). The regression workflow sets `ZO_WEB_URL`,
so it runs in CI; it is the one spec in this batch not verified locally.

Anyone writing a share-URL test: assert on restored **app state** (the index
list), never on the shared URL's query string.

## Better as a unit test, not E2E (2)

| Issue | Why |
|---|---|
| #11463 | The flame graph is an ECharts **canvas** (`renderItem` → `fillRect`), so no per-span DOM geometry exists to assert. Already covered: `FlameGraphView.spec.ts` — "should include spans with tiny duration using minimum 0.1% width", plus zero-duration and all-tiny cases. **No E2E needed.** |
| #11615 | Needs a click on a canvas-drawn span. `TraceDetails.spec.ts` already exercises `updateSelectedSpan` but never asserts `activeTab` is unchanged — a two-line unit assertion there is deterministic where a coordinate click is not. |

## Remaining UI queue (19)

Ordered roughly by value over setup cost. `ENT` = service-graph / SLO /
Incidents surface, ships in `ci_matrix*.ent.json`, so it needs a paired
o2-enterprise PR on the **same branch name**.

| Issue | Area | Note |
|---|---|---|
| #11392 | Traces | **attempted and withdrawn.** Shared-URL params. On the CI build the address bar carries `query=` EMPTY even with the filter applied and the index list showing it — four retries, all empty — while the same flow writes the base64 query against o2latestmain. Any address-bar assertion is environment-dependent until that difference is explained. The short-link path (as used for #7332) is the likely route. |
| #11619 | Alerts | logs/traces must not preselect a condition value |
| #9875  | Alerts | alert name from a dashboard panel contains a space and fails validation |
| #10202 | Alerts | test-destination on the update page errors; custom destination cannot test/preview |
| #11167 | Alerts | VRL results wrong on apply-query |
| #12411 | Alerts | column resize + show/hide, persisted. **Awkward for E2E as it stands:** the resize handle is a bare `.resizer` div with no `data-test`, and no column preference appears in `localStorage` after toggling, so persistence has no observable surface. Add a `data-test` to the resizer and confirm where prefs are stored before automating. |
| #12090 | Alerts | Associate Query: removing a filter re-adds the field name |
| #2812  | Functions | confirmation on deleting a function from a stream association |
| #7280  | Reports | deleted report still listed until refresh |
| #7401  | Reports | pause/resume does not re-trigger a cached report |
| #11441 | Logs | no histogram when `severity` is numeric |
| #11353 | Logs | automatic stacked breakdown histogram |
| #10270 | Logs | search-around returns inconsistent counts. Partially covered: `Logs/logspage.spec.js:498` drives the exact repro (`limit` + Search Around) but asserts only that *something* rendered. The gap is a **count** assertion — extend that test rather than writing a new one. |
| #10602 | Logs | limit count, stream tooltip, stream-list scroll |
| #7689  | Logs | histogram API fires before all data calls finish (needs request-order interception) |
| #11351 | Logs/Metrics/Traces | needs a shard with `O2_PERSIST_LAST_SELECTED_STREAM` |
| #11280 | Traces | sort triggers a backend call; span kind in the tree; no 2500 cap |
| #13224 | Dashboards | favourite dashboards (localStorage) |
| #11360 | Traces | pod/node metrics tabs — needs metrics data alongside traces |
| #11590 | Traces `ENT` | service-details operations table duration sort |
| #12611 | Incidents `ENT` | quick status filter tabs |
| #14269 | SLO `ENT` | error message inconsistent with other pages |

## API queue (9) — feature folders, NOT `tests/regression/`

**Do not put these in `tests/api-testing/tests/regression/`.** That folder is
not a general regression suite: `api-testing.yml` runs the main integration
pass with `--ignore=tests/regression`, and the `api_regression_tests` job runs a
**hardcoded 4-leg matrix** over two join specs with specific
`ZO_FEATURE_JOIN_MATCH_ONE_ENABLED` / `ZO_UTF8_VIEW_ENABLED` combinations. A new
file dropped there never runs until someone adds a matrix leg. Reserve it for
env-flag-sensitive tests.

New API regressions belong in the feature folder that the main integration run
already collects: `tests/streams/`, `tests/alerts/`, `tests/pipelines/`,
`tests/search/`, `tests/rum/`, `tests/dashboards/`.

These are API-surface bugs; several cannot be reached from the UI at all.

| Issue | Note |
|---|---|
| #14331 | `delete_fields` must reject the reserved `_timestamp` — issue states it is API-only |
| #6443  | reject a second realtime pipeline on a stream that already has one |
| #4795  | float value in an alert condition panics the job runtime |
| #7502  | `ORDER BY` ignored when the SQL has derived filters |
| #6771  | page-count API fails for a distinct query |
| #3864  | `MAX(_timestamp) as latest_timestamp` |
| #11219 | report folders API + RBAC |
| #12351 | `env` field missing in ingested RUM events — `tests/rum/` |
| #5745  | `last_triggered_at` null after a trigger. NOT covered: `tests/alerts/test_v2.py:381` explicitly declines to assert it *because of this bug*. The comment is stale now the issue is closed — assert it and delete the note. |

## Not recommended (23)

The repo has a `Not-an-Automation-Candidate` label (20 issues already use it)
which is the natural home for these — **not yet applied**.

Pixel-cosmetic, inherently intermittent, perf-shaped, or umbrella issues with
no single assertable outcome. Automating these buys flake, not coverage.

- **Cosmetic / layout only:** #10072 #11029 #11267 #11318 #1760 #1777 #2188 #4333 #4345 #12452
- **Intermittent / race by nature:** #3827 #4232 #9385 #9664
- **Perf-shaped:** #11444
- **Umbrella, no single outcome:** #11169 #11171 #11198 #11404 #9450 #9742
- **Not reachable from the product:** #11688 — the issue itself states the
  vulnerable `buildSearch()` output is dead code and cannot be triggered
  through the UI. A lint or unit guard is the only meaningful cover.
- **Needs SSO/dex infrastructure:** #11229

## Gotcha: reading streamed responses

The logs histogram arrives over `POST /_search_stream?…&is_ui_histogram=true` as
SSE. Do NOT read it from Playwright's `response` event: Chrome releases the body
once the app has consumed it, so `response.text()` intermittently fails with
"No data found for resource" — a test that passes alone and fails in a suite.
`logs-histogram-severity.spec.js` patches `fetch` via `addInitScript` and
`tee()`s the stream instead, which is deterministic and leaves the app's
progressive rendering untouched.

## Known gaps worth a separate pass

- 21 `test.skip` occurrences live in `RegressionSet/` — 7 whole tests disabled
  outright and 14 runtime `test.skip(true, …)` bail-outs. They read as
  coverage in the suite but assert nothing.
- Page-object helpers exist for bugs whose tests were never written:
  `getPreviewBoundingBox`/`hoverPipelineRow` (#9498, used by this batch) and
  `expectPromqlConditionRow*`/`getPromqlConditionValue` (unused by any test).
