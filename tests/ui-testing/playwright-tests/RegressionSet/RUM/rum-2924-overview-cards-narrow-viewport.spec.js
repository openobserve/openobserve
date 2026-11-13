const { test, expect } = require('../../utils/enhanced-baseFixtures.js');
const testLogger = require('../../utils/test-logger.js');
const PageManager = require('../../../pages/page-manager.js');
const { seedBuilt, buildFunnelSessions, runAppId } = require('../../utils/rum-analytics-ingestion.js');

const TAGS = ['@bug-2924', '@P1', '@regression', '@rumRegression'];
const NARROW = { width: 864, height: 900 };
const CARDS = [
  { key: 'sessions', label: 'Sessions' },
  { key: 'users', label: 'Identified users' },
  { key: 'pages-per-session', label: 'Pages per session' },
  { key: 'identity-coverage', label: 'Sessions with a user id' },
];

test.describe('Product Analytics Overview summary cards below 1024px (ENT#2924 P1-26)', () => {
  test.use({ timezoneId: 'UTC' });
  let appId = null;

  test.beforeAll(async ({ browser }) => {
    const page = await browser.newPage();
    try {
      ({ appId } = await seedBuilt(page, buildFunnelSessions(runAppId('pa-2924'), Date.now())));
    } finally {
      await page.close();
    }
  });

  test.beforeEach(async ({}, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
  });

  test('every summary card keeps a readable label beside its number at 864px', { tag: TAGS }, async ({ page }) => {
    const pa = new PageManager(page).rumProductAnalyticsPage;
    await page.setViewportSize(NARROW);
    await pa.goto('overview', { app: appId, period: '7d' });
    expect(await page.evaluate(() => window.innerWidth), 'the page must really be laid out below 1024px').toBe(NARROW.width);
    await expect.poll(() => pa.kpiValue('sessions'), { timeout: 30000 }).toBe('6');

    for (const { key, label } of CARDS) {
      const { cardBox, labelBox } = await pa.expectKpiLabelVisible(key, label);
      expect(labelBox.width, `the "${label}" label must have room to be read`).toBeGreaterThan(24);
      expect(labelBox.x, `the "${label}" label must start inside its card`).toBeGreaterThanOrEqual(cardBox.x);
      expect(labelBox.x + labelBox.width, `the "${label}" label must end inside its card`).toBeLessThanOrEqual(cardBox.x + cardBox.width);
      expect(labelBox.y, `the "${label}" label must sit inside its card`).toBeGreaterThanOrEqual(cardBox.y);
      expect(labelBox.y + labelBox.height, `the "${label}" label must sit inside its card`).toBeLessThanOrEqual(cardBox.y + cardBox.height);
    }
  });
});
