// traceDetailsScores.spec.js
// Tests for OpenObserve Traces — the Trace Details Sidebar "Scores" block gate.
// On an OSS build (`config.isEnterprise`/`config.isCloud` are "false") the real
// evaluator Scores block (Scores label + TraceScoreChips) must never render,
// while the surrounding LLM metrics row (model / tokens / cost) still does for
// a real LLM span. Each test ingests its own span and drives the open-sidebar
// flow, exactly as traceGenAiParts.spec.js does.

const { test, expect, navigateToBase, generateUUID } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const PageManager = require('../../pages/page-manager.js');

test.describe("Trace Details Sidebar Scores Block testcases", () => {
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
   * Navigate to the freshly-ingested span and open its sidebar: select stream →
   * 15m → run search → open trace → click the target span in the tree. The
   * stream-list is fetched once on page load, so a stream ingested afterward is
   * absent from the selector options — re-navigate with the stream query param
   * to refresh the list and auto-select the freshly-ingested stream first.
   */
  async function openSpanSidebar(pm, streamName, spanName) {
    await pm.tracesPage.navigateToTracesUrlWithStream(streamName);
    await pm.tracesPage.setTimeRange('15m');
    await pm.tracesPage.runTraceSearch();
    await pm.tracesPage.waitForTraceSearchResults();
    await pm.tracesPage.clickFirstTraceResult();
    const clicked = await pm.tracesPage.clickTraceTreeSpanByOperationName(spanName);
    expect(clicked).toBeTruthy();
  }

  test("OSS LLM span shows the LLM metrics row and hides the Scores block", {
    tag: ['@trace-details-scores-gate', '@traces', '@all', '@P0']
  }, async ({ page }) => {
    testLogger.info('Testing OSS negative gate: LLM metrics row renders, Scores block hidden');

    const suffix = generateUUID();
    const streamName = `trace_scores_gate_${suffix}`;
    const spanName = `chat ${suffix}`;

    await pm.genAiTracesIngestionPage.ingestGenAiSpan(streamName, {
      name: spanName,
      kind: 2,
      attributes: {
        'gen_ai.operation.name': 'chat',
        // Required to reach the LLM metrics row (`:247` gate) — the positive
        // control the negative "Scores absent" assertion is measured against.
        'gen_ai.response.model': 'gpt-4',
        'gen_ai.input.messages': JSON.stringify([
          { role: 'user', parts: [{ type: 'text', content: 'hello' }] },
        ]),
        'gen_ai.output.messages': JSON.stringify([
          { role: 'assistant', parts: [{ type: 'text', content: 'hi' }] },
        ]),
      },
    });
    await pm.genAiTracesIngestionPage.pollForSpan(streamName, spanName);

    await openSpanSidebar(pm, streamName, spanName);
    await pm.tracesPage.expectPreviewTabVisible();

    await pm.tracesPage.expectObservationBadgeVisible();
    await pm.tracesPage.expectLlmMetricsRowVisible();
    await pm.tracesPage.expectScoresBlockAbsent();

    testLogger.info('Test completed');
  });

  test("Non-LLM span shows no observation badge and no Scores block", {
    tag: ['@trace-details-scores-gate', '@traces', '@all', '@P1']
  }, async ({ page }) => {
    testLogger.info('Testing non-LLM control: no observation badge, no Scores block');

    const suffix = generateUUID();
    const streamName = `trace_scores_gate_${suffix}`;
    const spanName = `plain ${suffix}`;

    await pm.genAiTracesIngestionPage.ingestGenAiSpan(streamName, {
      name: spanName,
      kind: 2,
      attributes: { 'service.name': 'plain-service' },
    });
    await pm.genAiTracesIngestionPage.pollForSpan(streamName, spanName);

    await openSpanSidebar(pm, streamName, spanName);

    await pm.tracesPage.expectTraceDetailsSidebarVisible();
    await pm.tracesPage.expectObservationBadgeHidden();
    await pm.tracesPage.expectScoresBlockAbsent();

    testLogger.info('Test completed');
  });

  test("LLM span without a response model shows the badge but no metrics row / Scores", {
    tag: ['@trace-details-scores-gate', '@traces', '@all', '@P2']
  }, async ({ page }) => {
    testLogger.info('Testing row gate: LLM span without gen_ai_response_model');

    const suffix = generateUUID();
    const streamName = `trace_scores_gate_${suffix}`;
    const spanName = `chat ${suffix}`;

    await pm.genAiTracesIngestionPage.ingestGenAiSpan(streamName, {
      name: spanName,
      kind: 2,
      attributes: { 'gen_ai.operation.name': 'chat' },
    });
    await pm.genAiTracesIngestionPage.pollForSpan(streamName, spanName);

    await openSpanSidebar(pm, streamName, spanName);

    await pm.tracesPage.expectObservationBadgeVisible();
    await pm.tracesPage.expectLlmMetricsRowHidden();
    await pm.tracesPage.expectScoresBlockAbsent();

    testLogger.info('Test completed');
  });
});
