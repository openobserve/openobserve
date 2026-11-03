// tracesGroups.spec.js
// Group by select under the query editor in the Spans view, and the Groups table it shows.

const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const PageManager = require('../../pages/page-manager.js');
const { ingestTraces } = require('../utils/trace-ingestion.js');

test.describe("Traces Groups view testcases", () => {
  test.describe.configure({ mode: 'serial' });
  let pm;

  test.beforeAll(async ({ browser }) => {
    test.setTimeout(120000);
    const context = await browser.newContext({
      storageState: 'playwright-tests/utils/auth/user.json',
    });
    const page = await context.newPage();
    try {
      await ingestTraces(page, 6, { forceScenario: 'success' });
    } catch (e) {
      testLogger.warn('Groups trace seeding failed (continuing)', { error: e.message });
    } finally {
      await context.close();
    }
  });

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    await navigateToBase(page);
    pm = new PageManager(page);
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    await pm.tracesPage.navigateToTraces();
    await pm.tracesPage.isStreamSelectVisible();
    await pm.tracesPage.selectTraceStream('default');
    await pm.tracesPage.switchToSpansMode();
    await pm.tracesPage.setTimeRange('15m');
    await pm.tracesPage.setQueryEditorValue('');
  });

  test.afterEach(async ({ }, testInfo) => {
    testLogger.testEnd(testInfo.title, testInfo.status);
  });

  test("P1: Group by service_name shows the Groups table and keeps it in the link", {
    tag: ['@tracesGroups', '@traces', '@query', '@P1', '@all']
  }, async ({ page }) => {
    await expect(pm.tracesPage.getGroupByValue()).toHaveText('None');

    await pm.tracesPage.pickGroupBy('service_name');

    await expect(pm.tracesPage.getGroupsTable()).toBeVisible({ timeout: 20000 });
    await expect(pm.tracesPage.getGroupsValues().first()).toBeVisible({ timeout: 20000 });
    await expect(page.locator('[data-test="traces-search-result-pagination"]')).toHaveCount(0);
    await expect(page).toHaveURL(/[?&]view=groups(&|$)/, { timeout: 10000 });
    await expect(page).toHaveURL(/[?&]group_by=service_name(&|$)/);

    await page.reload();
    await pm.tracesPage.isStreamSelectVisible();
    await expect(pm.tracesPage.getGroupByValue()).toHaveText('service_name', { timeout: 20000 });
    await expect(pm.tracesPage.getGroupsTable()).toBeVisible({ timeout: 20000 });
  });

  test("P1: Clicking a group adds its filter and shows the span list at once", {
    tag: ['@tracesGroups', '@traces', '@query', '@P1', '@all']
  }, async ({ page }) => {
    await pm.tracesPage.pickGroupBy('service_name');
    const first = pm.tracesPage.getGroupsValues().first();
    await expect(first).toBeVisible({ timeout: 20000 });
    const service = (await first.textContent()).trim();

    await pm.tracesPage.getGroupsRowByValue(service).click();

    await expect(pm.tracesPage.getGroupByValue()).toHaveText('None');
    await pm.tracesPage.expectQueryEditorValue(`service_name = '${service}'`);
    await expect(pm.tracesPage.getGroupsTable()).toHaveCount(0, { timeout: 20000 });
    await expect(page.locator(pm.tracesPage.searchResultList)).toBeVisible({ timeout: 20000 });
  });

  test("P2: Exclude term from the row menu stays in the Groups view", {
    tag: ['@tracesGroups', '@traces', '@P2', '@all']
  }, async () => {
    await pm.tracesPage.pickGroupBy('service_name');
    const first = pm.tracesPage.getGroupsValues().first();
    await expect(first).toBeVisible({ timeout: 20000 });
    const service = (await first.textContent()).trim();

    await pm.tracesPage.openGroupsRowMenu(service);
    await expect(pm.tracesPage.getGroupsMenuItem('open-traces')).toBeVisible();
    await pm.tracesPage.getGroupsMenuItem('exclude-term').click();

    await pm.tracesPage.expectQueryEditorValue(`service_name != '${service}'`);
    await expect(pm.tracesPage.getGroupByValue()).toHaveText('service_name');
    await expect(pm.tracesPage.getGroupsTable()).toBeVisible();
  });

  test("P2: Turning SQL mode on sets Group by back to None and disables it", {
    tag: ['@tracesGroups', '@tracesSqlMode', '@traces', '@P2', '@all']
  }, async () => {
    await pm.tracesPage.pickGroupBy('service_name');
    await expect(pm.tracesPage.getGroupsTable()).toBeVisible({ timeout: 20000 });

    await pm.tracesPage.toggleSqlModeFromToolbar();

    await pm.tracesPage.expectSqlMode(true);
    await expect(pm.tracesPage.getGroupByValue()).toHaveText('None');
    await expect(pm.tracesPage.getGroupBySelect()).toBeDisabled();
  });
});
