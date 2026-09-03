// rumTraceTimeRange.spec.js
// RUM Trace Time Range (Indexed Trace Window) — RUM → distributed-trace correlation.
//
// Verifies that a RUM session event carrying a trace id (`_o2_trace_id`) links to
// the backend distributed trace via the trace time index (`traces/time_range`):
//   1. Session viewer → Traces tab lists the correlated trace and opens embedded
//      TraceDetails over the indexed window.
//   2. Event drawer → "View Trace" navigates to the standalone trace-details route
//      with the canonical padded trace id and the indexed (padded ±1 min) window.
//   Plus the P1/P2 variations: empty state when no trace ids, legacy zero-stripped
//   id normalization, and filtering a trace id with no matching backend trace.
//
// Each test seeds its OWN correlated session (unique session/trace/action ids) so
// the tests are fully independent and safe under `mode: 'parallel'`.

const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const PageManager = require('../../pages/page-manager.js');
const { seedCorrelatedSession } = require('../utils/rum-trace-correlation-seed.js');

test.describe('RUM Trace Time Range testcases', () => {
  test.describe.configure({ mode: 'parallel' });
  let pm;

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    await navigateToBase(page);
    pm = new PageManager(page);
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
    testLogger.info('Test setup completed');
  });

  test("Traces tab lists the correlated trace and opens embedded TraceDetails over the indexed window", {
    tag: ['@rumTraceTimeRange', '@traces', '@all', '@P0'],
  }, async ({ page }) => {
    testLogger.info('Seeding correlated RUM session + trace');
    const seed = await seedCorrelatedSession(page, { withBackendTrace: true });

    await pm.rumTraceCorrelationPage.openSessionViewer(seed.sessionId, {
      startMs: seed.startMs,
      endMs: seed.endMs,
    });
    await pm.rumTraceCorrelationPage.openTracesTab();

    await pm.rumTraceCorrelationPage.expectTracesTableVisible();
    await pm.rumTraceCorrelationPage.expectTraceCountBadgeContains('1');
    await pm.rumTraceCorrelationPage.expectSingleTraceRow();

    await pm.rumTraceCorrelationPage.clickFirstTraceRow();
    await pm.rumTraceCorrelationPage.expectEmbeddedTraceDetails();

    await pm.rumTraceCorrelationPage.expectBackFromTraceDetail();
    testLogger.info('Test completed');
  });

  test("Event drawer 'View Trace' navigates to standalone trace details over the indexed window", {
    tag: ['@rumTraceTimeRange', '@traces', '@all', '@P0'],
  }, async ({ page }) => {
    testLogger.info('Seeding correlated RUM session + trace');
    const seed = await seedCorrelatedSession(page, { withBackendTrace: true });

    await pm.rumTraceCorrelationPage.openSessionViewer(seed.sessionId, {
      startMs: seed.startMs,
      endMs: seed.endMs,
    });

    await pm.rumTraceCorrelationPage.openFirstActionEvent();
    await pm.rumTraceCorrelationPage.expectEventDrawerVisible();
    await pm.rumTraceCorrelationPage.expectViewTraceBtnVisible();

    const popup = await pm.rumTraceCorrelationPage.clickViewTrace();
    await pm.rumTraceCorrelationPage.expectTraceDetailsUrl(popup, seed.traceId);
    await pm.rumTraceCorrelationPage.expectTraceDetailsTreeOn(popup);
    testLogger.info('Test completed');
  });

  test("Traces tab shows the empty state when the session has no trace ids", {
    tag: ['@rumTraceTimeRange', '@traces', '@all', '@P1'],
  }, async ({ page }) => {
    testLogger.info('Seeding RUM session WITHOUT a trace id');
    const seed = await seedCorrelatedSession(page, { includeTraceId: false });

    await pm.rumTraceCorrelationPage.openSessionViewer(seed.sessionId, {
      startMs: seed.startMs,
      endMs: seed.endMs,
    });
    await pm.rumTraceCorrelationPage.openTracesTab();

    await pm.rumTraceCorrelationPage.expectTracesEmptyVisible();
    await pm.rumTraceCorrelationPage.expectTracesTableAbsent();
    testLogger.info('Test completed');
  });

  test("Legacy zero-stripped trace id is normalized and still correlates", {
    tag: ['@rumTraceTimeRange', '@traces', '@all', '@P1'],
  }, async ({ page }) => {
    testLogger.info('Seeding RUM session with a legacy zero-stripped trace id');
    const seed = await seedCorrelatedSession(page, { withBackendTrace: true, legacyStrippedId: true });

    await pm.rumTraceCorrelationPage.openSessionViewer(seed.sessionId, {
      startMs: seed.startMs,
      endMs: seed.endMs,
    });
    await pm.rumTraceCorrelationPage.openTracesTab();

    await pm.rumTraceCorrelationPage.expectTracesTableVisible();
    await pm.rumTraceCorrelationPage.expectTraceCountBadgeContains('1');
    await pm.rumTraceCorrelationPage.expectSingleTraceRow();
    testLogger.info('Test completed');
  });

  test("Trace id present but no backend trace is filtered out of the list", {
    tag: ['@rumTraceTimeRange', '@traces', '@all', '@P2'],
  }, async ({ page }) => {
    testLogger.info('Seeding RUM session with a trace id but NO backend trace');
    const seed = await seedCorrelatedSession(page, { withBackendTrace: false });

    await pm.rumTraceCorrelationPage.openSessionViewer(seed.sessionId, {
      startMs: seed.startMs,
      endMs: seed.endMs,
    });
    await pm.rumTraceCorrelationPage.openTracesTab();

    await pm.rumTraceCorrelationPage.expectTracesEmptyVisible();
    await pm.rumTraceCorrelationPage.expectTracesTableAbsent();
    testLogger.info('Test completed');
  });
});
