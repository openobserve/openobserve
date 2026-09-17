const { test, expect, navigateToBase } = require('../../utils/enhanced-baseFixtures.js');
const testLogger = require('../../utils/test-logger.js');
const PageManager = require('../../../pages/page-manager.js');
const { ingestTraces } = require('../../utils/trace-ingestion.js');

const TRACE_STREAM = 'default';

test.describe("Traces span-kind badges", () => {
  test.describe.configure({ mode: 'serial' });
  let pm;

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    await navigateToBase(page);
    pm = new PageManager(page);
    // Every generated trace carries a SERVER root, a CLIENT hop and a SERVER leaf,
    // so both badge kinds are guaranteed present in each trace tree.
    await ingestTraces(page, 6, { forceScenario: 'success' });
    await page.waitForLoadState('domcontentloaded');
    testLogger.info('Span-kind badge setup completed');
  });

  test("the trace tree must mark each span with its span kind", {
    tag: ['@bug-11280', '@P0', '@regression', '@tracesRegression', '@tracesRegressionSpanKind']
  }, async () => {
    await pm.tracesPage.navigateToTraces();
    await pm.tracesPage.selectTraceStream(TRACE_STREAM);
    await pm.tracesPage.runTraceSearch();
    await pm.tracesPage.openFirstTraceWaterfall();

    const serverBadges = await pm.tracesPage.countSpanKindBadges('server');
    const clientBadges = await pm.tracesPage.countSpanKindBadges('client');
    testLogger.info(`Span-kind badges — server: ${serverBadges}, client: ${clientBadges}`);

    expect(serverBadges,
      'Bug #11280: a SERVER span must be identifiable as such in the trace tree'
    ).toBeGreaterThan(0);

    expect(clientBadges,
      'Bug #11280: a CLIENT span must be identifiable as such in the trace tree'
    ).toBeGreaterThan(0);

    testLogger.info('PASSED: span kinds are badged in the trace tree (Bug #11280)');
  });
});
