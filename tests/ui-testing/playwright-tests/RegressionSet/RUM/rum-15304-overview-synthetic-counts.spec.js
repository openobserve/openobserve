// Product Analytics Overview: every summary count leaves synthetic (bot) sessions out, not just the Sessions KPI (#15304).

const { test, expect } = require('../../utils/enhanced-baseFixtures.js');
const testLogger = require('../../utils/test-logger.js');
const PageManager = require('../../../pages/page-manager.js');
const { seedBuilt, SessionBuilder, runAppId, HOUR_MS } = require('../../utils/rum-analytics-ingestion.js');

const TAGS = ['@bug-15304', '@P1', '@regression', '@rumRegression'];
const REAL_USERS = ['r1@e2e.test', 'r2@e2e.test', 'r3@e2e.test', null];
const BOT_USERS = ['b1@e2e.test', 'b2@e2e.test', 'b3@e2e.test'];

/** Real sessions view 2 pages, 3 of 4 with a user; bots view 5 pages, all with a user, so counting bots moves every ratio. */
function buildSyntheticPagesSeed(appId, nowMs) {
  const rows = [];
  const add = (users, sessionType, pages) => users.forEach((user, i) => {
    const session = new SessionBuilder(appId, `${appId}-${sessionType}-${i}`, nowMs - 4 * HOUR_MS + i * 15 * 60 * 1000, { user, sessionType });
    for (let p = 0; p < pages; p++) session.view(`https://shop.example.com/web/p${p}`);
    rows.push(...session.rows);
  });
  add(REAL_USERS, 'user', 2);
  add(BOT_USERS, 'synthetics', 5);
  return {
    rows,
    facts: {
      appId,
      realSessions: REAL_USERS.length,
      botSessions: BOT_USERS.length,
      // 8 real views over 4 real sessions; with bot views counted it read (8 + 15) / 4 = 5.8.
      pagesPerSession: '2.0',
      realUsers: REAL_USERS.filter(Boolean).length,
      // 3 identified of 4 real sessions; with bot sessions counted it read 6 / 4 = 150.0%.
      coverage: '75.0%',
    },
  };
}

test.describe('Product Analytics Overview counts exclude synthetic sessions (#15304)', () => {
  test.describe.configure({ mode: 'parallel' });
  test.use({ timezoneId: 'UTC' });
  let seed = null;

  test.beforeAll(async ({ browser }) => {
    const page = await browser.newPage();
    try {
      seed = await seedBuilt(page, buildSyntheticPagesSeed(runAppId('pa-15304'), Date.now()));
    } finally {
      await page.close();
    }
  });

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    const pa = new PageManager(page).rumProductAnalyticsPage;
    await pa.goto('overview', { app: seed.appId, period: '7d' });
    await expect(pa.syntheticExcluded).toHaveText(`${seed.botSessions} synthetic sessions excluded`, { timeout: 30000 });
  });

  test('Pages per session divides real page views by real sessions only', {
    tag: TAGS,
  }, async ({ page }) => {
    const pa = new PageManager(page).rumProductAnalyticsPage;
    await expect.poll(() => pa.kpiValue('pages-per-session'), { timeout: 30000 }).toBe(seed.pagesPerSession);
    await expect.poll(() => pa.kpiValue('sessions'), { timeout: 30000 }).toBe(String(seed.realSessions));
  });

  test('identity coverage and identified users count real sessions only, so coverage stays at or under 100%', {
    tag: TAGS,
  }, async ({ page }) => {
    const pa = new PageManager(page).rumProductAnalyticsPage;
    await expect.poll(() => pa.kpiValue('identity-coverage'), { timeout: 30000 }).toBe(seed.coverage);
    await expect.poll(() => pa.kpiValue('users'), { timeout: 30000 }).toBe(String(seed.realUsers));
  });
});
