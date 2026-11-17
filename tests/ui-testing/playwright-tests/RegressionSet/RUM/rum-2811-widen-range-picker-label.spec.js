const { test, expect } = require('../../utils/enhanced-baseFixtures.js');
const testLogger = require('../../utils/test-logger.js');
const PageManager = require('../../../pages/page-manager.js');
const { seedBuilt, buildFunnelSessions, runAppId } = require('../../utils/rum-analytics-ingestion.js');

const TAGS = ['@bug-2811', '@P1', '@regression', '@rumRegression'];

test.describe('Product Analytics date picker follows "Show the past 30 days" (ENT#2809 #2811)', () => {
  test.use({ timezoneId: 'UTC' });
  let appId = null;

  // Rows are hours old, so the last 15 minutes are empty and the past 30 days are not.
  test.beforeAll(async ({ browser }) => {
    const page = await browser.newPage();
    try {
      ({ appId } = await seedBuilt(page, buildFunnelSessions(runAppId('pa-2811'), Date.now())));
    } finally {
      await page.close();
    }
  });

  test.beforeEach(async ({}, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
  });

  test('the picker label moves from Past 15 Minutes to Past 30 Days', { tag: TAGS }, async ({ page }) => {
    const pa = new PageManager(page).rumProductAnalyticsPage;
    await pa.goto('overview', { app: appId, period: '15m' });
    await expect(pa.overviewEmpty).toBeVisible({ timeout: 30000 });
    await expect(pa.datePicker).toContainText('Past 15 Minutes');

    await pa.widenRangeBtn.click();

    await expect.poll(() => pa.query().get('period')).toBe('30d');
    await expect(pa.rankedRow('pages', 0, 'key')).toBeVisible({ timeout: 30000 });
    await expect(pa.datePicker).toContainText('Past 30 Days');
    await expect(pa.datePicker).not.toContainText('15 Minutes');
  });
});
