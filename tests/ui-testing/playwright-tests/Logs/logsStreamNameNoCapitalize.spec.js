const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const PageManager = require('../../pages/page-manager.js');
const logData = require("../../fixtures/log.json");
const { ingestTestData } = require('../utils/data-ingestion.js');

// o2-enterprise#1745 regression lock: lowercase stream names render verbatim, no CSS capitalize/uppercase.
test.describe("Logs stream-name capitalisation (o2-enterprise#1745)", () => {
  test.describe.configure({ mode: 'parallel' });
  let pm;
  let streamA;
  let streamB;

  test.beforeAll(async ({ browser }, testInfo) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    const suffix = `${Date.now()}_${testInfo.parallelIndex}`;
    streamA = `logs_lower_a_${suffix}`;
    streamB = `logs_lower_b_${suffix}`;

    await ingestTestData(page, streamA);
    await ingestTestData(page, streamB);
    testLogger.info('E-1745 lowercase streams ingested', { streamA, streamB });

    await context.close();
  });

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    await navigateToBase(page);
    pm = new PageManager(page);
    await page.waitForLoadState('domcontentloaded');
  });

  test("selected lowercase stream names are not auto-capitalised", {
    tag: ['@logsStreamNameCapitalize', '@logs', '@all', '@P2']
  }, async ({ page }) => {
    await page.goto(`${logData.logsUrl}?org_identifier=${process.env["ORGNAME"]}`);
    await page.waitForLoadState('domcontentloaded');

    await pm.logsPage.selectStream(streamA);
    await pm.logsPage.selectStream(streamB, 5, null, true);
    await pm.logsPage.runQueryAndWaitForResults();

    const triggerLabel = await pm.logsPage.getSelectedStreamTriggerLabel();
    testLogger.info('Stream selector label', { triggerLabel });
    expect(triggerLabel).toContain(streamA);
    expect(triggerLabel).toContain(streamB);

    const styles = await pm.logsPage.getRenderedStreamNameStyles();
    const streamNameSurfaces = styles.filter(
      (s) => s.text.includes(streamA) || s.text.includes(streamB)
    );
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
    await cleanupPm.logsPage.deleteStream(streamA);
    await cleanupPm.logsPage.deleteStream(streamB);
    await context.close();
  });
});
