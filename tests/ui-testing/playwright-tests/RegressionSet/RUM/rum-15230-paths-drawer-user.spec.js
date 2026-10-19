// Product Analytics Paths: the sessions drawer a band opens names each session's user, not "Unknown user" (#15230).

const { test, expect } = require('../../utils/enhanced-baseFixtures.js');
const testLogger = require('../../utils/test-logger.js');
const PageManager = require('../../../pages/page-manager.js');
const { encodeDef, funnelParam } = require('../../../pages/rumPages/rumProductAnalyticsPage.js');
const { seedBuilt, SessionBuilder, runAppId, HOUR_MS } = require('../../utils/rum-analytics-ingestion.js');

const TAGS = ['@bug-15230', '@P2', '@regression', '@rumRegression'];
const USERS = ['a1@e2e.test', 'a2@e2e.test', 'a3@e2e.test'];
// The anonymous session proves the label is read per session rather than one value for the whole drawer.
const EXPECTED_LABELS = [...USERS, 'Unknown user'].sort();
// Every session leaves after /web/b, so the chart's last column is the step-2 "Left the app" box.
const MAX_DEPTH = 2;

/** Three identified sessions and one anonymous one, each viewing /web/a then /web/b and never /web/c. */
function buildDrawerUsersSeed(appId, nowMs) {
  const rows = [];
  [...USERS, null].forEach((user, i) => {
    const session = new SessionBuilder(appId, `${appId}-s${i}`, nowMs - 3 * HOUR_MS + i * 10 * 60 * 1000, { user });
    session.view('https://shop.example.com/web/a').view('https://shop.example.com/web/b');
    rows.push(...session.rows);
  });
  return { rows, facts: { appId, sessions: 4 } };
}

test.describe('Product Analytics Paths sessions drawer shows the user (#15230)', () => {
  test.describe.configure({ mode: 'parallel' });
  test.use({ timezoneId: 'UTC' });
  let seed = null;

  test.beforeAll(async ({ browser }) => {
    const page = await browser.newPage();
    try {
      seed = await seedBuilt(page, buildDrawerUsersSeed(runAppId('pa-15230'), Date.now()));
    } finally {
      await page.close();
    }
  });

  test.beforeEach(async ({}, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
  });

  test('a band from a page anchor lists each session under its user', {
    tag: TAGS,
  }, async ({ page }) => {
    const pa = new PageManager(page).rumProductAnalyticsPage;
    await pa.goto('paths', { app: seed.appId, period: '7d', anchor: encodeDef(['p', '/web/a']), inc: 'pages' });
    await pa.expectFlowRendered();
    await pa.clickPathsBand('/web/a', '/web/b', 1, MAX_DEPTH);
    await expect(pa.branchDrawer).toBeVisible({ timeout: 30000 });
    await expect(pa.branchSessionsCap).toHaveText(`All ${seed.sessions} sessions listed`, { timeout: 30000 });
    const labels = await pa.branchUserLabels(seed.sessions);
    testLogger.info('Drawer user labels', { labels });
    expect(labels.sort()).toEqual(EXPECTED_LABELS);
  });

  test('a band in the paths of a funnel step\'s dropped sessions lists each session under its user', {
    tag: TAGS,
  }, async ({ page }) => {
    const pa = new PageManager(page).rumProductAnalyticsPage;
    await pa.goto('funnels', { app: seed.appId, period: '7d', funnel: funnelParam([['p', '/web/a'], ['p', '/web/c']]) });
    await pa.expectFunnelCounts([seed.sessions, 0]);
    await pa.openDropoff(0);
    await pa.openDroppedSessionsPaths();
    await expect(pa.pathsSessionFilter).toHaveText(/^\s*step 1\s*\/web\/a\s*$/, { timeout: 30000 });
    await pa.openPathsCohort();
    await expect(pa.pathsCohortPopover).toContainText('Reached /web/a, then did not reach /web/c.');
    await expect(pa.pathsCohortPopover).toContainText(`${seed.sessions} sessions`, { timeout: 30000 });
    await pa.closePopovers();
    await pa.expectFlowRendered();
    await pa.clickPathsBand('/web/a', '/web/b', 1, MAX_DEPTH);
    await expect(pa.branchDrawer).toBeVisible({ timeout: 30000 });
    await expect(pa.branchSessionsCap).toHaveText(`All ${seed.sessions} sessions listed`, { timeout: 30000 });
    const labels = await pa.branchUserLabels(seed.sessions);
    testLogger.info('Cohort drawer user labels', { labels });
    expect(labels.sort()).toEqual(EXPECTED_LABELS);
  });
});
