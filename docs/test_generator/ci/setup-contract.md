# Test Setup Contract: AI Observability Header Redesign  (area: AIObservability)

## Streams / data the spec must establish

Tag each item by SCOPE so the Engineer puts it in the right place:
- **`[shared/read-only]`** — every test just READS it the same way → set up ONCE / use a pre-seeded stream.
- **`[per-test]`** — only one test needs it, or a test MUTATES it → set up INSIDE that test, uniquely named.

### Header presence + navigation tests (no data needed)

These tests verify the header chrome renders on page load. No data is required — the AiPageShell header always renders, and the AiLastRefreshed indicator simply stays hidden when `lastRunAt` is null.

**Precondition**: The AI Observability menu item is visible (gated on `online_evals_enabled` flag). This is an enterprise config flag that must be enabled in the deployment being tested.

### Last-refreshed indicator + refresh behavior tests

For the last-refreshed indicator to appear and the Refresh button to exercise real data loading, the child components need data to query successfully:

- **`[shared/read-only]`** `_traces_llm` or equivalent trace stream — fields: standard OTEL trace fields including `span_name`, `span_kind`, `trace_id`, `duration`, plus GenAI-specific fields like `gen_ai.request.model`, `gen_ai.usage.input_tokens`, `gen_ai.usage.output_tokens`, `gen_ai.system`. Why: The LLM Insights page, Sessions page, and Agent Behavior page all query traces data to stamp `lastRunAt`. Without successful query results, the child components may never set `lastRunAt`, keeping the indicator permanently hidden.

- **`[shared/read-only]`** GenAI agent mapping data — the Agent Graph and Agent Behavior pages call `genAiAgentMappingService.listAgents()` to resolve their agent lists. Without agents, these pages show empty states (Agent Graph shows "No agents" empty state; Agent Behavior may not fully initialize). The header still renders but the child may not expose `lastRunAt`.

- **`[per-test: Quality tab header]`** Online evals score configs + evaluator trace data — the Quality tab's `reloadQuality` sequence calls `genAiAgentMappingService.listAgents()` + `QualityPage.refreshAll()`. Without evaluator data, the quality KPIs load as zeros, but the refresh should still settle and stamp `lastRunAt`.

### Simplification for initial header-only tests

**RECOMMENDATION**: For the initial spec (`aiPageHeader.spec.js`), start with tests that verify **header presence + selector correctness + navigation** across the five pages (LLM Insights, Sessions, Agent Graph, Agent Behavior, Quality). These tests do NOT require ingested LLM/trace data — the header renders even against empty data. The last-refreshed indicator will be hidden (which is a valid state to assert).

Then add data-dependent tests (refresh flow, staleness indicator dot colors, relative time ticking) once the LLM trace ingestion pattern is established.

## How to create it (copy these EXACT patterns — do NOT invent setup)

### Auth / Org
- Use the standard auth state: `ORGNAME=default` with the standard worker auth / login pattern.
- Reference: `tests/ui-testing/playwright-tests/Logs/logspage.spec.js` or any existing spec for the `beforeAll` login pattern.

### Ingestion (for LLM trace data — future tests)
- The existing ingestion helper is `pm.ingestionPage.ingestion()` which POSTs `logsdata` to `e2e_automate` stream. This ingests **log data**, not trace data.
- For LLM/trace data, a new ingestion helper or test-data file would need to be created. The O2 API endpoint for traces is `POST /api/{org_id}/{stream_name}/_json` (same as logs), but the payload must contain OTEL trace fields.
- Reference pattern: `tests/ui-testing/pages/generalPages/ingestionPage.js:52-78` (`ingestion()` method)
- Reference: `tests/ui-testing/pages/generalPages/ingestionPage.js:140-164` (`ingestionMultiOrgStream` for stream-specific ingestion)

### Navigation
- Navigate to AI pages via direct URL or via the left navbar:
  ```js
  // Direct URL
  await page.goto('/ai/llm-insights?org_identifier=default');
  await page.goto('/ai/sessions?org_identifier=default');
  await page.goto('/ai/agent-graph?org_identifier=default');
  await page.goto('/ai/agent-behavior?org_identifier=default');
  await page.goto('/ai/evaluations?org_identifier=default&tab=quality');
  ```
- Or navigate via clicking the left-rail nav:
  ```js
  await page.click('[data-test="menu-link-aiObservability-item"]');
  // Then click a secondary rail item:
  await page.click('[data-test="ai-secondary-nav-sessions"]');
  ```
- Reference: `tests/ui-testing/pages/generalPages/homePage.js` for the `openNavFlyoutChild` pattern.

### Timing / Waits
- After navigating to an AI page, wait for the OPageLayout to render:
  ```js
  await page.waitForSelector('[data-test="ai-sessions-page"]');
  ```
- Child components may load asynchronously; the header itself renders synchronously. For header presence tests, waiting for the `-page` selector is sufficient.

## Preconditions / Toggles

- **`online_evals_enabled`** config flag must be `true` for the AI Observability nav link to appear. This is an enterprise flag. If tests run against an OSS deployment where this flag is false, the nav link won't appear and the `/ai/*` routes will 404.
- **Non-SQL mode**: Not applicable — this feature doesn't have SQL mode toggling.
- **Dark/light mode**: The header components are theme-agnostic; no special toggle needed.

## Gotchas (so the Healer/Engineer don't rediscover them)

- **The AI Observability nav link may not appear**: The "AI Monitoring" nav link is dynamically inserted in `MainLayout.vue:715-732` only when `isOnlineEvalsEnabled` is true. The Engineer must verify this flag is enabled in the test environment. If the flag is false, a direct URL navigation test still works (the routes are always registered), but the nav-link-based navigation tests would fail.

- **Agent Graph / Agent Behavior pages may show empty states without data**: These pages call `genAiAgentMappingService.listAgents()` on mount. If the org has no GenAI agent data, they show empty states. The header still renders, but the child components may not expose `lastRunAt`. For header-only tests this is fine (assert the indicator is hidden).

- **Quality tab date picker echo-guard**: The Quality tab's DateTimePickerDashboard emits `update:modelValue` once on mount, which would trigger a second `reloadQuality` on top of the `@ready` one. OnlineEvals has a `qualityDateEchoPending` flag to swallow this echo. If the Engineer writes a test that enters the Quality tab and immediately clicks Refresh, they must account for the fact that the `@ready` reload may still be in flight — the Refresh button guard prevents double-firing, but the spinner may already be spinning.

- **The `AiLastRefreshed` colored dot and time text have no data-test selectors**: Only the root span has `[data-test]`. Tests that need to assert dot color or time text must use CSS class selectors (e.g., `.bg-refresh-dot-fresh`) or add new data-test attributes. The `NEEDS SELECTOR` section of the Feature Design Document lists two candidates.

- **`lastRunAt` stamping is asynchronous**: The indicator only appears after the child component's fetch settles. In a test with real data, the flow is: click Refresh → button spins → fetch completes → `lastRunAt` is stamped → indicator appears. Without real data, the fetch may complete with an empty result and still stamp `lastRunAt` (depends on the child component's implementation). The Engineer should verify this behavior against the actual deployment.

- **Cross-page date state leakage**: `useAiDateRange` is a module-level singleton. If one test changes the date picker to a custom range and a subsequent test expects the default "Past 15 minutes", the shared state may carry over. Each test should navigate fresh or reset the date state to the default before asserting.
