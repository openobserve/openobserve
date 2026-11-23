// logs-13243-scheduler-survives-search.spec.js
// Logs Regression — the search scheduler survives a logs search (#13243, bug 2)
//
// The scheduler list used to render under `v-show="showSearchScheduler"` in the
// logs Index.vue, and that flag was driven purely by the `action=search_scheduler`
// URL query param. Running a search rewrote the URL WITHOUT that param, so the
// flag flipped to false and the list — with its "Get Jobs" button — became
// display:none while still sitting in the DOM. It never recovered on its own, so
// the whole search-scheduler flow was unreachable after any search.
//
// It is fixed structurally: the scheduler is its own route now
// (`routeToSearchSchedule` pushes `searchScheduler`), so there is no param left
// for a search to strip. This pins that — a search first, THEN the scheduler,
// which is the order that used to break.
//
// The button is asserted CLICKABLE, not just present: the failure mode was an
// element that existed with display:none, which `toBeAttached` would not catch.

const { test, expect, navigateToBase } = require('../../utils/enhanced-baseFixtures.js');
const testLogger = require('../../utils/test-logger.js');

const GET_JOBS_BTN = '[data-test="search-scheduler-get-jobs-btn"]';

function logsUrl() {
  const baseUrl = (process.env['ZO_BASE_URL'] || '').replace(/\/+$/, '');
  const org = process.env['ORGNAME'] || 'default';
  return `${baseUrl}/web/logs?org_identifier=${org}&stream_type=logs&period=15m`;
}

// Enterprise-gated: the scheduler route guard and the toolbar button are both
// behind config.isEnterprise, so this cannot run on an OSS build.
test.describe('Search scheduler after a logs search (#13243)', { tag: '@enterprise' }, () => {
  test.describe.configure({ mode: 'serial' });

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    await navigateToBase(page);
    await page.goto(logsUrl());
    await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
  });

  test.afterEach(async ({}, testInfo) => {
    testLogger.testEnd(testInfo.title, testInfo.status);
  });

  test('P1: Get Jobs is reachable and clickable after running a search', {
    tag: ['@logs', '@jobScheduler', '@regression', '@P1', '@all'],
  }, async ({ page }) => {
    // Run a search, which is what used to strip the scheduler out of the URL.
    const runQuery = page.getByRole('button', { name: /Run query/i }).first();
    await runQuery.waitFor({ state: 'visible', timeout: 30000 });
    await runQuery.click();
    await page.waitForTimeout(5000);

    // Reach the scheduler the way the toolbar does.
    await page.locator('[data-test="logs-search-bar-more-options-btn"]').click();
    await page.locator('[data-test="search-scheduler-list-btn"]').click();
    await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});

    const getJobs = page.locator(GET_JOBS_BTN);
    await expect(getJobs).toBeVisible({ timeout: 30000 });

    // display:none was the exact failure, so assert the computed style too —
    // a hidden-but-attached button is what the bug produced.
    const display = await getJobs.evaluate((el) => getComputedStyle(el).display);
    expect(display, 'the Get Jobs button must not be display:none').not.toBe('none');

    // And it must actually do something: the list request is the proof.
    const jobsResponse = page.waitForResponse(
      (resp) => resp.url().includes('/search_jobs') && resp.request().method() === 'GET',
      { timeout: 30000 },
    );
    await getJobs.click();
    expect((await jobsResponse).status()).toBe(200);
  });
});
