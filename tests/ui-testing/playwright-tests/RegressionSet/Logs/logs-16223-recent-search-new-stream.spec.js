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
    const otherPm = new PageManager(other);
    await other.goto(logsUrl(NEW_STREAM));
    await otherPm.logsPage.waitForSearchResultRows(60000);
    await otherPm.logsPage.expectNoQueryInFlight(60000);
    await otherPm.logsPage.ensureQueryEditorMode();
    await otherPm.logsPage.fillQueryEditor("level='info'");
    const recorded = other.waitForResponse(
      (r) => r.request().method() === 'POST' && new URL(r.url()).pathname.endsWith('/query_history') && r.ok(),
      { timeout: 60000 },
    );
    await otherPm.logsPage.runPendingQuery();
    await recorded;
    await other.close();

    await pm.logsPage.openRecentSearchesDrawer();
    await pm.logsPage.filterRecentSearches(NEW_STREAM, 1);
    await pm.logsPage.clickRecentSearchRow(NEW_STREAM);

    // The pre-fix restore threw "streams were not found" before searching, so the marker rows are the proof.
    await pm.logsPage.expectResultRowWithText(MARKER);
    expect(new URL(page.url()).searchParams.get('stream')).toBe(NEW_STREAM);
  });
});
