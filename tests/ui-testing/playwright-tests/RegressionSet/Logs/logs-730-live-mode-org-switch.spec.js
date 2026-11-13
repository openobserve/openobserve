const { test, expect, navigateToBase } = require('../../utils/enhanced-baseFixtures.js');
const testLogger = require('../../utils/test-logger.js');
const PageManager = require('../../../pages/page-manager.js');
const { waitForStreamData } = require('../../utils/data-ingestion.js');
const { orgId, ensureOrg, ingestLogRowsFetch, deleteStreamQuietly } = require('../../utils/regression-seed-api.js');

// Self-hosted has no org delete, so one stable second org is reused instead of a new one per run.
const OTHER_ORG_NAME = 'e2e_live_mode_org_switch';
const STREAM = `ovn_b2_live_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

test.describe('Logs live mode survives an org switch and back (ENT#730)', () => {
  test.describe.configure({ mode: 'serial' });
  let pm;
  let otherOrg;

  test.beforeAll(async () => {
    otherOrg = await ensureOrg(OTHER_ORG_NAME);
    const now = Date.now();
    const rows = Array.from({ length: 30 }, (_, i) => ({
      _timestamp: (now - i * 20_000) * 1000,
      level: i % 3 === 0 ? 'error' : 'info',
      message: `ovn-b2 live mode row ${i}`,
    }));
    await ingestLogRowsFetch(STREAM, rows);
    testLogger.info(`Ingested ${rows.length} rows into ${STREAM}; second org ${otherOrg}`);
  });

  test.afterAll(async () => {
    await deleteStreamQuietly(STREAM, 'logs');
  });

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    await navigateToBase(page);
    pm = new PageManager(page);
  });

  test('after live mode, a switch to another org and back, search and histogram both run and the histogram renders', {
    tag: ['@bug-730', '@P2', '@regression', '@logsRegression'],
  }, async ({ page }) => {
    await waitForStreamData(page, STREAM, 30);
    await page.goto(`${process.env.ZO_BASE_URL}/web/logs?org_identifier=${orgId()}&stream_type=logs&stream=${STREAM}&period=15m&refresh=0&sql_mode=false&quick_mode=false&show_histogram=true`);
    const refresh = pm.logsAutoRefreshPage;
    await pm.logsPage.applyQueryAndWaitForSearchResponse();
    await refresh.expectHistogramRendered();

    await refresh.openPopover();
    await refresh.pickInterval(60);
    await expect(page).toHaveURL(/[?&]refresh=60(&|$)/);
    await refresh.closePopover();
    await refresh.expectTriggerLabel(/1\s*m|60/i);

    await refresh.switchOrg(otherOrg);
    testLogger.info(`Refresh trigger in the other org: ${await refresh.getTriggerLabel()}`);

    const searches = refresh.trackStreamSearches(STREAM);
    await refresh.switchOrg(orgId());
    testLogger.info(`Refresh trigger back in the first org: ${await refresh.getTriggerLabel()}`);
    await pm.logsPage.selectStream(STREAM, 3, 0, true);
    await pm.logsPage.applyQueryAndWaitForSearchResponse();

    await expect.poll(() => searches.filter((s) => s.org === orgId() && !s.histogram).length, {
      timeout: 30000, message: 'the results search must fire after returning to the org',
    }).toBeGreaterThan(0);
    await expect.poll(() => searches.filter((s) => s.org === orgId() && s.histogram).length, {
      timeout: 30000, message: 'the histogram search must fire after returning to the org',
    }).toBeGreaterThan(0);
    await refresh.expectHistogramRendered();
    await refresh.expectHistogramHasData();
  });
});
