const { test, expect, navigateToBase } = require('../../utils/enhanced-baseFixtures.js');
const testLogger = require('../../utils/test-logger.js');
const PageManager = require('../../../pages/page-manager.js');
const { ingestRows, waitForSearchable } = require('../../utils/auto-run-helpers.js');
const { ingestTestData } = require('../../utils/data-ingestion.js');
const { getOrgIdentifier } = require('../../utils/cloud-auth.js');

const ORG = getOrgIdentifier() || 'default';
const RID = Math.random().toString(36).slice(2, 7);
const NEW_STREAM = `e2e_16223_${RID}`;
const MARKER = `restored-16223-${RID}`;

const runInFlight = '[data-test="logs-search-bar-refresh-btn"][class*="bg-cancel-query-bg"]';
const runPending = '[data-test="logs-search-bar-refresh-btn"][data-run-pending="true"]';
const recentButton = '[data-test="logs-search-bar-recent-searches-btn"]';
const drawer = '[data-test="recent-searches-drawer"]';
const drawerSearch = '[data-test="recent-searches-search"] input';
const drawerRows = '[data-test^="recent-searches-drawer-row-"]';
const resultRows = '[data-test="logs-search-result-logs-table"] tbody tr';

const logsUrl = (stream) =>
  `/web/logs?org_identifier=${ORG}&stream=${stream}&stream_type=logs&period=15m` +
  '&refresh=0&sql_mode=false&quick_mode=false&show_histogram=false';

// openobserve#16223: restoring a recent search checked its stream against a list cached before the stream existed, so it read "not found".
test.describe('Recent search restores a stream created after the list was cached (#16223)', () => {
  test('a recent search on a newer stream restores it and runs', {
    tag: ['@bug-16223', '@P2', '@regression', '@logsRegression', '@recentSearches'],
  }, async ({ page, context }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    await navigateToBase(page);
    await ingestTestData(page);
    const pm = new PageManager(page);

    await page.goto(logsUrl('e2e_automate'));
    await pm.logsPage.waitForStreamFieldsLoaded('kubernetes_pod_name');
    testLogger.info('stream list cached in this tab; now the new stream is created');

    await ingestRows(page.request, ORG, NEW_STREAM, Array.from({ length: 3 }, (_, i) => ({
      _timestamp: (Date.now() - (i + 1) * 1000) * 1000,
      level: 'info',
      message: `${MARKER} ${i}`,
    })));
    await waitForSearchable(page.request, ORG, NEW_STREAM, 3);

    // A second tab loads after the stream exists; only a search the user edits and runs is recorded.
    const other = await context.newPage();
    await other.goto(logsUrl(NEW_STREAM));
    await expect(other.locator(resultRows).first()).toBeVisible({ timeout: 60000 });
    await expect(other.locator(runInFlight)).toHaveCount(0, { timeout: 60000 });
    // The query input is remembered per browser, so switch the filter builder back to the editor when it shows.
    const builderToggle = other.locator('[data-test="logs-search-bar-filter-builder-toggle"]');
    if ((await builderToggle.getAttribute('aria-pressed').catch(() => null)) === 'true') await builderToggle.click();
    await new PageManager(other).logsPage.fillQueryEditor("level='info'");
    await expect(other.locator(runPending)).toBeVisible({ timeout: 10000 });
    const recorded = other.waitForResponse(
      (r) => r.request().method() === 'POST' && new URL(r.url()).pathname.endsWith('/query_history') && r.ok(),
      { timeout: 60000 },
    );
    await other.locator(runPending).click();
    await recorded;
    await other.close();

    await page.locator(recentButton).click();
    await expect(page.locator(drawer)).toBeVisible({ timeout: 15000 });
    await page.locator(drawer).locator(drawerSearch).fill(NEW_STREAM);
    // The search re-renders the list when its answer lands, and a click on a row it replaces is lost.
    await expect(page.locator(drawer).locator(drawerRows)).toHaveCount(1, { timeout: 15000 });
    const row = page.locator(drawer).locator(drawerRows).filter({ hasText: NEW_STREAM });
    await expect(row).toBeVisible();
    await row.click();

    await expect(page.locator(resultRows).filter({ hasText: MARKER }).first(), 'the restored search runs on the new stream').toBeVisible({ timeout: 60000 });
    await expect(page.getByText('streams were not found')).toHaveCount(0);
    expect(new URL(page.url()).searchParams.get('stream')).toBe(NEW_STREAM);
  });
});
