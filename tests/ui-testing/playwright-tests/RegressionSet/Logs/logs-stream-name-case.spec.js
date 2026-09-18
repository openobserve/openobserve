const { test, expect, navigateToBase } = require('../../utils/enhanced-baseFixtures.js');
const testLogger = require('../../utils/test-logger.js');
const PageManager = require('../../../pages/page-manager.js');
const logData = require("../../../fixtures/log.json");
const { ingestTestData } = require('../../utils/data-ingestion.js');

// o2-enterprise#1745 regression lock: lowercase stream names render verbatim, no CSS capitalize/uppercase.
test.describe("Logs stream-name capitalisation (o2-enterprise#1745)", () => {
  test.describe.configure({ mode: 'parallel' });
  let pm;
  let stream;

  test.beforeAll(async ({ browser }, testInfo) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    stream = `logs_lower_${Date.now()}_${testInfo.parallelIndex}`;

    await ingestTestData(page, stream);
    testLogger.info('o2-enterprise#1745 lowercase stream ingested', { stream });

    await context.close();
  });

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    await navigateToBase(page);
    pm = new PageManager(page);
    await page.waitForLoadState('domcontentloaded');
  });

  test("selected lowercase stream name is not auto-capitalised", {
    tag: ['@bug-ent-1745', '@P2', '@regression', '@logsRegression', '@logsRegressionStreamNameCase']
  }, async ({ page }) => {
    await page.goto(`${logData.logsUrl}?org_identifier=${process.env["ORGNAME"]}`);
    await page.waitForLoadState('domcontentloaded');

    await pm.logsPage.selectStream(stream);
    await pm.logsPage.runQueryAndWaitForResults();

    const triggerLabel = await pm.logsPage.getSelectedStreamTriggerLabel();
    testLogger.info('Stream selector label', { triggerLabel });
    expect(triggerLabel).toContain(stream);

    const styles = await pm.logsPage.getRenderedStreamNameStyles();
    const streamNameSurfaces = styles.filter((s) => s.text.includes(stream));
    expect(streamNameSurfaces.length).toBeGreaterThan(0);

    for (const surface of streamNameSurfaces) {
      testLogger.info('Stream-name surface', surface);
      expect(surface.text).not.toMatch(/[A-Z]/);
      expect(surface.textTransform).not.toMatch(/capitalize|uppercase/i);
    }
  });

  test.afterAll(async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    const cleanupPm = new PageManager(page);
    await cleanupPm.logsPage.deleteStream(stream);
    await context.close();
  });
});
