# Test Setup Contract: Online Evals Job Preview Window (24h → 1h)  (area: Traces)

> Concrete data/state preconditions for the `onlineEvalsPreviewWindow.spec.js` E2E spec.
> Read by the **Engineer** (implement setup), the **Healer**, and the **Refiner**.

## Streams / data the spec must establish

Tag each item by SCOPE so the Engineer puts it in the right place:

- **`default`** **[shared/read-only]** — a traces stream with spans ingested **in the last hour**.
  Fields (from the seeded OTLP traces): `trace_id`, `span_id`, `service.name`,
  `service.version`, `environment`, `http.method`, `http.url`, `http.status_code`,
  `user.id`, `request.id`, `operation_name`/`span_name` (via `name`), `duration`.
  Why: every behavior that reads it — span-scope `COUNT(*)` and trace-scope
  `COUNT(DISTINCT "trace_id")` both resolve to a positive count from this stream.
  - **No `session_id` is seeded** ⇒ session-scope `COUNT(DISTINCT "session_id")` returns 0.
    Session-scope assertions must target the **suffix text** ("sessions matched · last 1h"),
    never a positive count.

No per-test streams are required for the headline assertions (span/trace/session suffix text).
The 20 seeded traces live in the org's `default` stream; a single read-only stream suffices.

## How to create it (copy these EXACT patterns — do NOT invent setup)

- **Traces are already seeded by global setup** — `ingestTraces(page, 20)` at
  `tests/ui-testing/playwright-tests/utils/global-setup.js:124` (POST OTLP `/api/{org}/v1/traces`,
  see `tests/ui-testing/playwright-tests/utils/trace-ingestion.js:255-317`). The spec can reuse
  `default` with **no extra ingestion**.
- **If a spec needs fresh traces anyway** (e.g. to guarantee recency within the 1h window):
  `const { ingestTraces } = require('../utils/trace-ingestion.js');` then
  `await ingestTraces(page, 20);` (from a `beforeAll`). Same pattern as `global-setup.js`.
- **Auth/org:** `ORGNAME=default`; auth state is established by the login fixture
  (`tests/ui-testing/playwright-tests/utils/enhanced-baseFixtures.js` → `navigateToBase(page)`);
  request-level auth uses `getAuthHeaders()` from
  `tests/ui-testing/playwright-tests/utils/cloud-auth.js`.
- **Navigation:** the page is embedded in the AI Observability shell.
  - Via rail: click `[data-test="ai-secondary-nav-eval-jobs"]` (source
    `web/src/enterprise/views/AIObservability/Index.vue:159`).
  - Via URL (fastest, mirrors `tracesPage.navigateToTracesUrl` at
    `tests/ui-testing/pages/tracesPages/tracesPage.js:780`):
    `${ZO_BASE_URL}/web/ai/evaluations?tab=jobs&org_identifier=default`
    (route name `aiEvaluations`, path `ai/evaluations` — `web/src/enterprise/composables/router.ts:153-159`).
  - Open the create form: click `[data-test="eval-job-list-add-btn"]` (pushes `?action=add`,
    mounts `JobFormPage`).
- **Timing / readiness:** the matched-target count query is **debounced 400 ms** after the stream
  value settles (`useJobMatchedTargets.ts:10,94-101`) and streams over HTTP. Do NOT assert a
  fixed sleep — wait for the suffix text to appear inside
  `[data-test="job-preview-matched-targets"]`:
  `await expect(page.locator('[data-test="job-preview-matched-targets"]')).toContainText('last 1h')`.
  The "last 1h" suffix only renders in the count branch (the hint/loading/error branches never
  contain it), so its visibility doubles as the "query settled with a count" gate.
- **Stream selection:** `[data-test="job-form-stream-select"]` is an `OFormSelect`/`OSelect`
  popover (virtualised options). Follow the `tracesPage.selectTraceStream` pattern
  (`tests/ui-testing/pages/tracesPages/tracesPage.js:237-319`): open the popover, wait for the
  option by `data-test-value`, click it. The stream list loads async on mount
  (`JobFormPage.vue:594-597` → `loadTraceStreams`), so wait for the `default` option before
  opening/selecting.

## Preconditions / toggles

- **English locale** — the `last 1h` copy exists only in `en-US.json`
  (`web/src/locales/languages/en-US.json:11515,11521,11527`). Other locales still read `24h`.
  Default locale is `en`; do not switch language in this spec.
- **Non-SQL-mode is irrelevant** here — the preview always runs its own SQL via `useLLMStreamQuery`
  regardless of the Traces page's SQL toggle.
- **Filter completeness:** on a fresh create form the filter group is empty, and
  `isJobFilterComplete(emptyGroup)` returns **true** (`web/src/enterprise/components/onlineEvals/utils/jobFilter.ts:98-110`),
  so `filterReady` is true and selecting a stream immediately fires the count. No filter setup
  is needed for the headline assertions.

## Gotchas (so the Healer/Engineer don't rediscover them)

- **`SKIP_INGESTION=true` or cleanup-only runs skip trace seeding** (`global-setup.js:107-131`).
  If a worker runs this spec under either, `default` has no traces → the count resolves to 0 and
  the suffix still shows "last 1h" (assertion still passes on suffix text), but a positive-count
  assertion would fail. Prefer asserting the suffix text; if a positive count is asserted, ingest
  in the spec's `beforeAll`.
- **The count number is not independently tagged** — the count and suffix are plain spans inside
  `[data-test="job-preview-matched-targets"]`. Assert on the container's `textContent`
  (the existing unit spec does exactly this: `JobPreviewPanel.spec.ts:46`).
- **Stream schema loads async too** (`loadStreamFields`, `JobFormPage.vue:594-597`), but it only
  feeds the filter-builder field list; the basic count query does not depend on it.
- **Session scope returns 0** (no `session_id` in seeded traces). Do not assert a session count > 0.
- **`e2e_automate` and other log streams are excluded from the trace stream list** by
  `getStreams("traces", …)`; `default` is the reliable trace stream. Reserved names
  (`_evaluator`, `_llm_scores`, `usage`, `stats`, `triggers`, `errors`, `data_retention_usage`)
  are filtered out of the select (`JobFormPage.vue:519-527`).
- **The 1h window means global-setup traces age out** — global setup runs before the tests; if a
  suite start is delayed > 1h after global ingestion, `default` traces fall outside the 1h window
  and the count becomes 0. This does **not** break the suffix-text assertion, but re-ingesting
  fresh traces in `beforeAll` (via `ingestTraces`) guards the positive-count path.
