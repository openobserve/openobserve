// Product Analytics Paths: "Build funnel from this path" must keep every step of the clicked path (#15190, o2-enterprise#2809 P1).

const { test, expect } = require('../../utils/enhanced-baseFixtures.js');
const testLogger = require('../../utils/test-logger.js');
const PageManager = require('../../../pages/page-manager.js');
const { encodeDef } = require('../../../pages/rumPages/rumProductAnalyticsPage.js');
const { seedBuilt, SessionBuilder, runAppId, HOUR_MS } = require('../../utils/rum-analytics-ingestion.js');

const TAGS = ['@bug-15190', '@P1', '@regression', '@rumRegression'];
const ANCHOR = '/web/start';
const DEEP_ROUTE = [ANCHOR, '/web/deals', '/web/search', '/web/product'];
const FULL_PATH = DEEP_ROUTE.map((key) => ['p', key]);

/** Three sessions take the deep route; two skip /web/deals, so a funnel that drops it counts all five at /web/product. */
function buildPathChainSeed(appId, nowMs) {
  const rows = [];
  const routes = [
    ...Array(3).fill(DEEP_ROUTE),
    ...Array(2).fill([ANCHOR, '/web/search', '/web/product', '/web/cart']),
  ];
  routes.forEach((pages, i) => {
    const session = new SessionBuilder(appId, `${appId}-s${i}`, nowMs - 4 * HOUR_MS + i * 10 * 60 * 1000, { user: `c${i}@e2e.test` });
    for (const key of pages) session.view(`https://shop.example.com${key}`);
    rows.push(...session.rows);
  });
  return { rows, facts: { appId, anchorSessions: 5, deepSessions: 3 } };
}

test.describe('Product Analytics Paths: Build funnel from this path keeps the whole path (#15190)', () => {
  test.describe.configure({ mode: 'parallel' });
  test.use({ timezoneId: 'UTC' });
  let seed = null;

  test.beforeAll(async ({ browser }) => {
    const page = await browser.newPage();
    try {
      seed = await seedBuilt(page, buildPathChainSeed(runAppId('pa-15190'), Date.now()));
    } finally {
      await page.close();
    }
  });

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    const pa = new PageManager(page).rumProductAnalyticsPage;
    await pa.goto('paths', { app: seed.appId, period: '7d', anchor: encodeDef(['p', ANCHOR]), inc: 'pages' });
    await pa.expectFlowRendered();
  });

  test('a band click builds a funnel with every step of the clicked path, ending on its session count', {
    tag: TAGS,
  }, async ({ page }) => {
    const pa = new PageManager(page).rumProductAnalyticsPage;
    await pa.clickPathsBand('/web/search', '/web/product', 3, 3);
    await expect(pa.branchDrawer).toBeVisible({ timeout: 30000 });
    await expect(pa.branchSessionsCap).toHaveText(`All ${seed.deepSessions} sessions listed`, { timeout: 30000 });
    testLogger.info('Building a funnel from the band /web/search → /web/product');
    await pa.buildFunnelFromBranch();
    await expect.poll(() => pa.funnelFromUrl()?.s, { timeout: 30000 }).toEqual(FULL_PATH);
    for (const [i, key] of DEEP_ROUTE.entries()) await expect(pa.step(i)).toContainText(key);
    await pa.expectFunnelCounts([seed.anchorSessions, seed.deepSessions, seed.deepSessions, seed.deepSessions]);
  });

  test('a box click builds a funnel with every step that leads into the box, ending on its session count', {
    tag: TAGS,
  }, async ({ page }) => {
    const pa = new PageManager(page).rumProductAnalyticsPage;
    await pa.clickPathsBox('/web/product', 3, 3);
    await expect(pa.branchDrawer).toBeVisible({ timeout: 30000 });
    await expect(pa.branchSessionsCap).toHaveText(`All ${seed.deepSessions} sessions listed`, { timeout: 30000 });
    testLogger.info('Building a funnel from the /web/product box at step 3');
    await pa.buildFunnelFromBranch();
    await expect.poll(() => pa.funnelFromUrl()?.s, { timeout: 30000 }).toEqual(FULL_PATH);
    for (const [i, key] of DEEP_ROUTE.entries()) await expect(pa.step(i)).toContainText(key);
    await pa.expectFunnelCounts([seed.anchorSessions, seed.deepSessions, seed.deepSessions, seed.deepSessions]);
  });
});
