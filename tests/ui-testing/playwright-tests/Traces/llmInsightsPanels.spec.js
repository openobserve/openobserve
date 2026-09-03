// llmInsightsPanels.spec.js
// Tests for the Traces LLM Insights dashboard — model-grouped panels.
// Feature: model-grouped panels (cost-trend, token-trend, latency-by-model,
// spans-by-model, tokens-by-model) scope to spans that carry
// gen_ai_response_model and drop the synthetic "unknown" model bucket.

const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const PageManager = require('../../pages/page-manager.js');
const { getAuthHeaders, getOrgIdentifier } = require('../utils/cloud-auth.js');
const { generateHexId } = require('../utils/trace-ingestion.js');

// The model names seeded into the default traces stream. The model-grouped
// panels must surface every one of these and never a synthetic "unknown" (or
// null/empty) bucket — which is exactly what the model-less span below would
// produce if the scoped `gen_ai_response_model IS NOT NULL` filter regressed.
const SEEDED_MODELS = ['gpt-4o', 'claude-3-5-sonnet', 'gpt-4o-mini'];

// Seed minimal OTLP gen_ai spans so the model-grouped panels have real
// model-carrying data to render. Mirrors model-pricing.spec.js's
// buildLlmOtlpPayload: gen_ai.operation.name + gen_ai.response.model mark the
// span as LLM and give it a model; the backend derives total tokens
// (input+output) and cost (model pricing). Ingested into the default traces
// stream, whose ingestion path flips is_llm_stream=true on the first gen_ai span.
function buildLlmOtlpPayload(modelName, inputTokens, outputTokens, durationMs = 1500) {
  const startNs = BigInt(Date.now()) * 1000000n;
  const endNs = startNs + BigInt(durationMs) * 1000000n;
  return {
    resourceSpans: [
      {
        resource: {
          attributes: [
            { key: 'service.name', value: { stringValue: 'e2e-llm-insights' } },
            { key: 'service.version', value: { stringValue: '1.0.0' } },
          ],
        },
        scopeSpans: [
          {
            scope: { name: 'opentelemetry-instrumentation-genai', version: '1.0.0' },
            spans: [
              {
                traceId: generateHexId(16),
                spanId: generateHexId(8),
                name: `gen_ai.chat.completions ${modelName}`,
                kind: 3, // CLIENT
                startTimeUnixNano: String(startNs),
                endTimeUnixNano: String(endNs),
                attributes: [
                  { key: 'gen_ai.operation.name', value: { stringValue: 'chat' } },
                  { key: 'gen_ai.system', value: { stringValue: 'openai' } },
                  { key: 'gen_ai.request.model', value: { stringValue: modelName } },
                  { key: 'gen_ai.response.model', value: { stringValue: modelName } },
                  { key: 'gen_ai.usage.input_tokens', value: { intValue: inputTokens } },
                  { key: 'gen_ai.usage.output_tokens', value: { intValue: outputTokens } },
                ],
                status: { code: 1 }, // OK
              },
            ],
          },
        ],
      },
    ],
  };
}

// A gen_ai tool span with NO model attributes — `gen_ai.operation.name` marks
// it as gen_ai, but it carries no `gen_ai.response.model`. Under the OLD SQL
// (`COALESCE(gen_ai_response_model, 'unknown')`) this span buckets as the
// synthetic "unknown" model; the scoped filter must drop it entirely. This is
// the span that makes the "no 'unknown' bucket" assertion falsifiable.
function buildModelLessGenAiSpan(durationMs = 800) {
  const startNs = BigInt(Date.now()) * 1000000n;
  const endNs = startNs + BigInt(durationMs) * 1000000n;
  return {
    resourceSpans: [
      {
        resource: {
          attributes: [
            { key: 'service.name', value: { stringValue: 'e2e-llm-insights' } },
            { key: 'service.version', value: { stringValue: '1.0.0' } },
          ],
        },
        scopeSpans: [
          {
            scope: { name: 'opentelemetry-instrumentation-genai', version: '1.0.0' },
            spans: [
              {
                traceId: generateHexId(16),
                spanId: generateHexId(8),
                name: 'gen_ai.execute_tool run_search',
                kind: 3, // CLIENT
                startTimeUnixNano: String(startNs),
                endTimeUnixNano: String(endNs),
                attributes: [
                  { key: 'gen_ai.operation.name', value: { stringValue: 'execute_tool' } },
                  { key: 'gen_ai.system', value: { stringValue: 'openai' } },
                  { key: 'gen_ai.tool.name', value: { stringValue: 'run_search' } },
                ],
                status: { code: 1 }, // OK
              },
            ],
          },
        ],
      },
    ],
  };
}

// Ingest all seeded spans and FAIL the run if any ingestion errors — a
// soft-fail here would let the panel-title assertions pass against a totally
// empty dashboard. Then poll the search API until the seeded spans (the three
// models AND the model-less execute_tool span) are queryable, so the panels
// mount only after the data they query is actually searchable.
async function seedLlmSpans(request) {
  const orgId = getOrgIdentifier() || 'default';
  const baseUrl = (process.env.ZO_BASE_URL || '').replace(/\/+$/, '');
  const headers = getAuthHeaders();
  const models = [
    { name: 'gpt-4o', input: 1200, output: 340 },
    { name: 'claude-3-5-sonnet', input: 900, output: 210 },
    { name: 'gpt-4o-mini', input: 700, output: 150 },
  ];

  const payloads = models.map((m) => buildLlmOtlpPayload(m.name, m.input, m.output));
  payloads.push(buildModelLessGenAiSpan());

  for (let i = 0; i < payloads.length; i++) {
    const res = await request.post(`${baseUrl}/api/${orgId}/v1/traces`, {
      headers,
      data: payloads[i],
    });
    if (res.status() !== 200) {
      throw new Error(`LLM span ingestion returned ${res.status()}: ${(await res.text()).slice(0, 300)}`);
    }
  }

  // Poll until the seeded data is queryable — a non-persisting ingestion must
  // fail the run, not silently yield an empty dashboard.
  const nowUs = Date.now() * 1000;
  const startUs = nowUs - 5 * 60 * 1_000_000; // 5 min back
  const endUs = nowUs + 5 * 60 * 1_000_000; // 5 min forward
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const res = await request.post(`${baseUrl}/api/${orgId}/_search?type=traces`, {
      headers,
      data: {
        query: {
          sql: 'SELECT gen_ai_response_model, gen_ai_operation_name FROM default WHERE gen_ai_operation_name IS NOT NULL',
          start_time: startUs,
          end_time: endUs,
          size: 200,
        },
      },
    });
    if (res.status() === 200) {
      const body = await res.json();
      const hits = body?.hits ?? [];
      const models = new Set(
        hits.map((h) => h.gen_ai_response_model).filter((m) => m != null && m !== ''),
      );
      const hasModelLessSpan = hits.some(
        (h) =>
          h.gen_ai_operation_name === 'execute_tool' &&
          (h.gen_ai_response_model == null || h.gen_ai_response_model === ''),
      );
      if (SEEDED_MODELS.every((m) => models.has(m)) && hasModelLessSpan) return;
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  throw new Error('Seeded LLM spans (models + model-less tool span) did not become queryable within 30s');
}

test.describe("LLM Insights model filter testcases", () => {
  test.describe.configure({ mode: 'parallel' });

  test.beforeAll(async ({ request }) => {
    await seedLlmSpans(request);
  });

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);

    await navigateToBase(page);
    await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});

    testLogger.info('Test setup completed');
  });

  test.afterEach(async ({ }, testInfo) => {
    testLogger.testEnd(testInfo.title, testInfo.status);
  });

  test("should render the LLM Insights dashboard and settle into a terminal state", {
    tag: ['@llm-insights-model-filter', '@traces', '@all']
  }, async ({ page }) => {
    testLogger.info('Verifying the LLM Insights dashboard renders');

    const pm = new PageManager(page);
    await pm.llmInsightsPage.navigateToLLMInsights();

    // The shell must mount regardless of whether LLM data is present in the org.
    await pm.llmInsightsPage.expectShellVisible();

    // The dashboard fetches asynchronously: poll until it lands on panel content
    // (LLM data present) or one of the no-data/error states — never stuck on the
    // skeleton. This guards the model-scoped panel config from breaking page load.
    await expect.poll(
      () => pm.llmInsightsPage.isTerminalStateVisible(),
      { timeout: 45000, intervals: [1000, 2000, 3000, 4000] },
    ).toBe(true);

    testLogger.info('Test completed');
  });

  // The model-grouped panels need gen_ai trace data (model-carrying generation
  // spans) so the horizontal-bar model panels render with real model categories.
  // seedLlmSpans (beforeAll) ingests gen_ai spans carrying gen_ai.response.model
  // AND one model-less execute_tool span into the default traces stream. The
  // scoped filter must surface only the seeded models — the model-less span
  // would otherwise bucket as the synthetic "unknown" model.
  test("should scope the model-grouped panels to spans with a model (no 'unknown' bucket)", {
    tag: ['@llm-insights-model-filter', '@traces', '@all']
  }, async ({ page }) => {
    testLogger.info('Verifying model-grouped panels exclude spans without a model');

    const pm = new PageManager(page);
    // Start capturing the model-grouped panels' search responses BEFORE
    // navigation so no panel query is missed.
    const captureModelPanels = pm.llmInsightsPage.startModelPanelCapture();
    await pm.llmInsightsPage.navigateToLLMInsights();

    // The three horizontal-bar model panels must render (their titles are DOM
    // text) with real model categories only.
    await pm.llmInsightsPage.expectSpansByModelPanelVisible();
    await pm.llmInsightsPage.expectTokensByModelPanelVisible();
    await pm.llmInsightsPage.expectLatencyByModelPanelVisible();

    // Wait for every model-grouped panel query to answer, then read the model
    // categories they actually bucketed.
    await expect
      .poll(
        () => captureModelPanels().then((s) => s.respondedPanelIds.length),
        { timeout: 45000, intervals: [1000, 2000, 3000, 4000] },
      )
      .toBe(pm.llmInsightsPage.modelGroupedPanelIds.length);

    const { models } = await captureModelPanels();

    // The panels must surface every seeded model (proving the seed persisted
    // and the queries returned real data — not an empty dashboard) …
    for (const seeded of SEEDED_MODELS) {
      expect(models, `model-grouped panels must include seeded model "${seeded}"`).toContain(seeded);
    }

    // … and never a null/empty or synthetic "unknown" bucket — the model-less
    // execute_tool span must be dropped by the scoped filter.
    for (const model of models) {
      expect(model, 'model-grouped panels must not emit a null/empty model bucket').toBeTruthy();
      expect(
        String(model).trim().toLowerCase(),
        'model-grouped panels must not emit an "unknown" model bucket',
      ).not.toBe('unknown');
    }

    testLogger.info('Test completed');
  });
});
