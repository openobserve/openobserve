// llmInsightsPanels.spec.js
// Tests for the Traces LLM Insights dashboard — model-grouped panels.
// Feature: model-grouped panels (cost-trend, token-trend, latency-by-model,
// spans-by-model, tokens-by-model) scope to spans that carry
// gen_ai_response_model and drop the synthetic "unknown" model bucket.

const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const PageManager = require('../../pages/page-manager.js');

test.describe("LLM Insights model filter testcases", () => {
  test.describe.configure({ mode: 'parallel' });
  let pm;

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);

    await navigateToBase(page);
    pm = new PageManager(page);
    await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});

    await pm.llmInsightsPage.navigateToLLMInsights();

    testLogger.info('Test setup completed');
  });

  test.afterEach(async ({ }, testInfo) => {
    testLogger.testEnd(testInfo.title, testInfo.status);
  });

  test("should render the LLM Insights dashboard and settle into a terminal state", {
    tag: ['@llm-insights-model-filter', '@traces', '@all']
  }, async ({ page }) => {
    testLogger.info('Verifying the LLM Insights dashboard renders');

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

  // UNWIRED — the assertion needs gen_ai trace data (model-carrying generation
  // spans alongside model-less tool/evaluator spans) so the model-grouped panels
  // actually render with real models. The E2E harness seeds no gen_ai data:
  // trace-ingestion.js:generateTrace emits HTTP spans without any gen_ai_* field,
  // and no setup contract prescribes an LLM ingestion helper. Kept as a fixme so
  // the spec ships honest coverage that turns green once that data exists.
  test.fixme("should scope the model-grouped panels to spans with a model (no 'unknown' bucket) — not wired: no gen_ai trace data seeded in the E2E harness (trace-ingestion.js emits HTTP spans without gen_ai_* fields)", {
    tag: ['@llm-insights-model-filter', '@traces', '@all']
  }, async ({ page }) => {
    testLogger.info('Verifying model-grouped panels exclude spans without a model');

    // Real assertion body kept intact. Once gen_ai data is present, the three
    // horizontal-bar model panels must render (their titles are DOM text) with
    // real model categories only. The model category labels themselves are drawn
    // on an ECharts canvas, so the "no 'unknown' bucket" invariant is verified at
    // the SQL-config level by llmInsightsPanels.spec.ts (unit) — E2E guards that
    // the scoped queries still render instead of erroring.
    await pm.llmInsightsPage.expectSpansByModelPanelVisible();
    await pm.llmInsightsPage.expectTokensByModelPanelVisible();
    await pm.llmInsightsPage.expectLatencyByModelPanelVisible();

    testLogger.info('Test completed');
  });
});
