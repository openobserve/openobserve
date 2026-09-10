// aiObservabilityMonitor.spec.js
// Tests for the OSS "AI Observability" Monitor module (`/web/ai`): the left-rail
// nav entry, the LLM Insights dashboard (KPI strip + recent-errors table), the
// Sessions list (server-paginated `gen_ai.conversation.id`-grouped rows) and
// session detail navigation, plus the OSS-only gating (rail shows only Monitor
// items; every enterprise/cloud affordance is absent).

const { test, navigateToBase, generateUUID } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const PageManager = require('../../pages/page-manager.js');

test.describe("AI Observability Monitor testcases", () => {
  test.describe.configure({ mode: 'parallel' });
  let pm;

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    await navigateToBase(page);
    pm = new PageManager(page);
    await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
    testLogger.info('Test setup completed');
  });

  test.afterEach(async ({ page }, testInfo) => {
    testLogger.testEnd(testInfo.title, testInfo.status);
  });

  test("should show the AI Observability nav entry after Traces and open LLM Insights", {
    tag: ['@ai-observability-monitor-oss', '@traces', '@all', '@P0']
  }, async ({ page }) => {
    testLogger.info('Testing AI Observability nav entry visibility and navigation');

    await pm.aiObservabilityPage.expectAiNavItemVisible();
    await pm.aiObservabilityPage.clickAiNavItem();
    await pm.aiObservabilityPage.expectLlmInsightsPageVisible();

    testLogger.info('Test completed');
  });

  test("should render the LLM Insights KPI strip and recent-errors table for an ingested LLM stream", {
    tag: ['@ai-observability-monitor-oss', '@traces', '@all', '@P0']
  }, async ({ page }) => {
    testLogger.info('Testing LLM Insights KPI strip + recent-errors table');

    const suffix = generateUUID();
    const streamName = `llm_insights_${suffix}`;
    const spanName = `chat ${suffix}`;

    await pm.genAiTracesIngestionPage.ingestGenAiSpan(streamName, {
      name: spanName,
      kind: 2,
      attributes: {
        'gen_ai.operation.name': 'chat',
        'gen_ai.response.model': 'gpt-4o',
        'gen_ai.usage.cost': '0.05',
        'gen_ai.usage.total_tokens': '150',
        'gen_ai.usage.input_tokens': '100',
        'gen_ai.usage.output_tokens': '50',
        'gen_ai.input.messages': JSON.stringify([{ role: 'user', content: 'hello' }]),
      },
    });
    await pm.genAiTracesIngestionPage.pollForSpan(streamName, spanName);

    await pm.aiObservabilityPage.navigateToLlmInsightsForStream(streamName);

    await pm.aiObservabilityPage.expectLlmInsightsPageVisible();
    await pm.aiObservabilityPage.expectKpiCardCount(5);
    await pm.aiObservabilityPage.expectRecentErrorsTableVisible();
    await pm.aiObservabilityPage.expectLlmEmptyStateNotVisible();
    await pm.aiObservabilityPage.expectLlmErrorStateNotVisible();

    testLogger.info('Test completed');
  });

  test("should list an ingested conversation in Sessions and open its detail on row click", {
    tag: ['@ai-observability-monitor-oss', '@traces', '@all', '@P0']
  }, async ({ page }) => {
    testLogger.info('Testing Sessions list + session detail navigation');

    const suffix = generateUUID();
    const streamName = `sessions_${suffix}`;
    const conversationId = `conv-${suffix}`;

    await pm.genAiTracesIngestionPage.ingestGenAiSession(streamName, conversationId, 2, { baseName: `chat-${suffix}` });
    await pm.genAiTracesIngestionPage.pollForSession(streamName, conversationId, 2);

    await pm.aiObservabilityPage.navigateToSessionsForStream(streamName);
    await pm.aiObservabilityPage.expectSessionsPageVisible();
    await pm.aiObservabilityPage.expectSessionsTableVisible();
    await pm.aiObservabilityPage.expectSessionStatusBadgeVisible(conversationId);

    await pm.aiObservabilityPage.clickSessionRow(conversationId);
    await pm.aiObservabilityPage.expectSessionDetailVisible();

    testLogger.info('Test completed');
  });

  test("should show only Monitor rail items and hide the Agent toggle on OSS", {
    tag: ['@ai-observability-monitor-oss', '@traces', '@all', '@P1']
  }, async ({ page }) => {
    testLogger.info('Testing OSS rail gating (Monitor-only + no Agent toggle)');

    await pm.aiObservabilityPage.navigateToLlmInsights();
    await pm.aiObservabilityPage.expectLlmInsightsPageVisible();
    await pm.aiObservabilityPage.expectSectionRailVisible();
    await pm.aiObservabilityPage.expectRailMonitorOnly();
    await pm.aiObservabilityPage.expectAgentToggleHidden();

    testLogger.info('Test completed');
  });

  test("should show the consolidated empty state when no LLM streams exist", {
    tag: ['@ai-observability-monitor-oss', '@traces', '@all', '@P1']
  }, async ({ page }) => {
    testLogger.info('Testing LLM Insights consolidated empty state');

    const hasStreams = await pm.aiObservabilityPage.llmStreamsExist();
    test.skip(hasStreams, 'Org already has LLM streams — the empty state only holds on a fresh org');

    await pm.aiObservabilityPage.navigateToLlmInsights();
    await pm.aiObservabilityPage.expectLlmEmptyStateVisible();

    testLogger.info('Test completed');
  });

  test("should show the no-streams empty state in Sessions when no LLM streams exist", {
    tag: ['@ai-observability-monitor-oss', '@traces', '@all', '@P1']
  }, async ({ page }) => {
    testLogger.info('Testing Sessions no-streams empty state');

    const hasStreams = await pm.aiObservabilityPage.llmStreamsExist();
    test.skip(hasStreams, 'Org already has LLM streams — the empty state only holds on a fresh org');

    await pm.aiObservabilityPage.navigateToSessions();
    await pm.aiObservabilityPage.expectSessionsNoStreamsEmptyVisible();

    testLogger.info('Test completed');
  });

  test("should re-fetch LLM Insights on refresh without entering the error state", {
    tag: ['@ai-observability-monitor-oss', '@traces', '@all', '@P1']
  }, async ({ page }) => {
    testLogger.info('Testing LLM Insights refresh');

    const suffix = generateUUID();
    const streamName = `llm_insights_${suffix}`;
    const spanName = `chat ${suffix}`;

    await pm.genAiTracesIngestionPage.ingestGenAiSpan(streamName, {
      name: spanName,
      kind: 2,
      attributes: {
        'gen_ai.operation.name': 'chat',
        'gen_ai.usage.total_tokens': '150',
        'gen_ai.usage.cost': '0.05',
      },
    });
    await pm.genAiTracesIngestionPage.pollForSpan(streamName, spanName);

    await pm.aiObservabilityPage.navigateToLlmInsightsForStream(streamName);
    await pm.aiObservabilityPage.expectKpiCardRowVisible();

    await pm.aiObservabilityPage.clickLlmRefresh();
    await pm.aiObservabilityPage.expectKpiCardRowVisible();
    await pm.aiObservabilityPage.expectLlmErrorStateNotVisible();

    testLogger.info('Test completed');
  });

  test("should show an error status badge on a session whose turn span is ERROR", {
    tag: ['@ai-observability-monitor-oss', '@traces', '@all', '@P1']
  }, async ({ page }) => {
    testLogger.info('Testing session error status badge');

    const suffix = generateUUID();
    const streamName = `sessions_${suffix}`;
    const conversationId = `conv-${suffix}`;

    await pm.genAiTracesIngestionPage.ingestGenAiSession(streamName, conversationId, 2, {
      baseName: `chat-${suffix}`,
      errorOnTurn: 1,
    });
    await pm.genAiTracesIngestionPage.pollForSession(streamName, conversationId, 2);

    await pm.aiObservabilityPage.navigateToSessionsForStream(streamName);
    await pm.aiObservabilityPage.expectSessionsTableVisible();
    await pm.aiObservabilityPage.expectSessionStatusBadgeError(conversationId);

    testLogger.info('Test completed');
  });

  test("should show multiple turns in the session detail for a multi-turn conversation", {
    tag: ['@ai-observability-monitor-oss', '@traces', '@all', '@P2']
  }, async ({ page }) => {
    testLogger.info('Testing multi-turn session detail');

    const suffix = generateUUID();
    const streamName = `sessions_${suffix}`;
    const conversationId = `conv-${suffix}`;

    await pm.genAiTracesIngestionPage.ingestGenAiSession(streamName, conversationId, 3, { baseName: `chat-${suffix}` });
    await pm.genAiTracesIngestionPage.pollForSession(streamName, conversationId, 3);

    await pm.aiObservabilityPage.navigateToSessionsForStream(streamName);
    await pm.aiObservabilityPage.expectSessionsTableVisible();
    await pm.aiObservabilityPage.clickSessionRow(conversationId);
    await pm.aiObservabilityPage.expectSessionDetailVisible();
    await pm.aiObservabilityPage.expectSessionTurnCountAtLeast(2);

    testLogger.info('Test completed');
  });
});
