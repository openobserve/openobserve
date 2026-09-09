// traceScoreChips.spec.js
// Tests for OpenObserve Traces — TraceScoreChips rendering in the trace-details
// sidebar. `TraceScoreChips` renders real evaluator scores for an LLM span inside
// Row 2 (the LLM metrics row) of TraceDetailsSidebar. Each score renders as a
// metric chip (Score Config name + formatted value); the first 2 chips show inline
// and extras fold behind a "+N more" dropdown; hovering a chip shows a
// TraceScoreDetail tooltip; and an empty "Not scored yet" tag renders when no
// scores exist.
//
// The headline behaviours (actual chip values, "+N more" overflow, empty tag) are
// data-gated behind the enterprise eval runner (`_llm_scores`), so the OSS CI run
// only asserts the WIRED wiring smoke test (the "Scores" section mounts for an LLM
// span) and records the data-gated behaviours as `test.fixme` placeholders so the
// gap is surfaced rather than green-washed.

const { test, expect, navigateToBase, generateUUID } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const PageManager = require('../../pages/page-manager.js');

test.describe("Traces Score Chips testcases", () => {
  test.describe.configure({ mode: 'parallel' });
  let pm;

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    await navigateToBase(page);
    pm = new PageManager(page);
    await pm.tracesPage.navigateToTracesUrl();
    await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
    testLogger.info('Test setup completed');
  });

  test.afterEach(async ({ page }, testInfo) => {
    testLogger.testEnd(testInfo.title, testInfo.status);
  });

  /**
   * Ingest an LLM span and open its trace-details sidebar so Row 2 (the LLM
   * metrics row) renders. Row 2 is gated on `isLLMSpan && llmMetrics &&
   * span.gen_ai_response_model`, so the span MUST carry `gen_ai.response.model`.
   */
  async function openLLMMetricsRow(pm, streamName, spanName) {
    await pm.genAiTracesIngestionPage.ingestGenAiSpan(streamName, {
      name: spanName,
      kind: 2,
      attributes: {
        'gen_ai.operation.name': 'chat',
        'gen_ai.response.model': 'gpt-4o',
      },
    });
    await pm.genAiTracesIngestionPage.pollForSpan(streamName, spanName);

    await pm.tracesPage.navigateToTracesUrlWithStream(streamName);
    await pm.tracesPage.setTimeRange('15m');
    await pm.tracesPage.runTraceSearch();
    await pm.tracesPage.waitForTraceSearchResults();
    await pm.tracesPage.clickFirstTraceResult();
    const clicked = await pm.tracesPage.clickTraceTreeSpanByOperationName(spanName);
    expect(clicked).toBeTruthy();
  }

  test("should render the Scores section in the LLM metrics row for an LLM span", {
    tag: ['@traceScoreChips', '@traces', '@all', '@P0']
  }, async ({ page }) => {
    testLogger.info('Testing the Scores section renders in the LLM metrics row for an LLM span');

    const suffix = generateUUID();
    const streamName = `trace_score_chips_${suffix}`;
    const spanName = `chat ${suffix}`;

    await openLLMMetricsRow(pm, streamName, spanName);

    await pm.tracesPage.expectLlmMetricsRowVisible();
    await pm.tracesPage.expectScoresLabelVisible();
    await pm.tracesPage.expectNoTracesSearchError();

    testLogger.info('Test completed');
  });

  test.fixme("should render the empty 'Not scored yet' state when the span has no scores — not wired: TraceDetails.vue:1659-1669 (showAnnotateButtons gate)", {
    tag: ['@traceScoreChips', '@traces', '@all', '@P1']
  }, async ({ page }) => {
    testLogger.info('Testing the empty "Not scored yet" state for an LLM span with no scores');

    const suffix = generateUUID();
    const streamName = `trace_score_chips_${suffix}`;
    const spanName = `chat ${suffix}`;

    await openLLMMetricsRow(pm, streamName, spanName);

    await pm.tracesPage.expectScoresEmptyVisible();
    await pm.tracesPage.expectScoresEmptyContains('Not scored yet');

    testLogger.info('Test completed');
  });

  test.fixme("should render a score chip with config name and formatted value — not wired: useTraceScoreChips.ts:64-74 (_llm_scores data-gated)", {
    tag: ['@traceScoreChips', '@traces', '@all', '@P2']
  }, async ({ page }) => {
    testLogger.info('Testing a score chip renders with config name and formatted value');

    const suffix = generateUUID();
    const streamName = `trace_score_chips_${suffix}`;
    const spanName = `chat ${suffix}`;

    await openLLMMetricsRow(pm, streamName, spanName);

    await pm.tracesPage.expectScoreChipVisible();

    testLogger.info('Test completed');
  });

  test.fixme("should fold >2 chips behind a '+N more' overflow listing all scores — not wired: TraceScoreChips.vue:109,124-125 (MAX_VISIBLE_CHIPS data-gated)", {
    tag: ['@traceScoreChips', '@traces', '@all', '@P2']
  }, async ({ page }) => {
    testLogger.info('Testing the "+N more" overflow folds extra chips and lists all scores');

    const suffix = generateUUID();
    const streamName = `trace_score_chips_${suffix}`;
    const spanName = `chat ${suffix}`;

    await openLLMMetricsRow(pm, streamName, spanName);

    await pm.tracesPage.expectScoreChipsOverflowVisible();
    await pm.tracesPage.clickScoreChipsOverflow();
    await pm.tracesPage.expectScoreChipsOverflowPanelVisible();
    await pm.tracesPage.expectScoreChipsOverflowTitleContains('All scores');

    testLogger.info('Test completed');
  });

  test.fixme("should show description / reasoning / scored-at on chip hover — not wired: TraceScoreChips.vue:50-52 + TraceScoreDetail.vue (data-gated)", {
    tag: ['@traceScoreChips', '@traces', '@all', '@P2']
  }, async ({ page }) => {
    testLogger.info('Testing the score-detail tooltip shows on chip hover');

    const suffix = generateUUID();
    const streamName = `trace_score_chips_${suffix}`;
    const spanName = `chat ${suffix}`;

    await openLLMMetricsRow(pm, streamName, spanName);

    await pm.tracesPage.expectScoreChipVisible();
    await pm.tracesPage.hoverScoreChip();
    await pm.tracesPage.expectScoreChipTooltipVisible();

    testLogger.info('Test completed');
  });
});
