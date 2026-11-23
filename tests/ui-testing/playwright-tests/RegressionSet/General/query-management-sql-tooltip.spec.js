// Copyright 2026 OpenObserve Inc.
//
// Query Management ("Running Queries") is enterprise-only and meta-org-only:
// an OSS build redirects /settings/query_management to the enterprise-locked
// page, and an enterprise build redirects any non-meta org back to General
// Settings. The page therefore has to be reached as `_meta` on an enterprise
// build, and the landing tab is User Summary — the per-query rows (and their
// Query List drawer) only exist under the All Queries tab.

const { test, navigateToBase } = require('../../utils/enhanced-baseFixtures.js');
const testLogger = require('../../utils/test-logger.js');
const PageManager = require('../../../pages/page-manager.js');

// Long enough to exceed QueryList's 300-char wrap threshold, so the SQL cell
// truncates and grows the cut-off tooltip this test is about.
const LONG_SQL = `SELECT ${Array.from({ length: 60 }, (_, i) => `col_${i}`).join(', ')} FROM "default" WHERE code = 500`;

test.describe("Query Management SQL tooltip Regression", () => {
  test.describe.configure({ mode: 'serial' });
  let pm;

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    await navigateToBase(page);
    pm = new PageManager(page);
  });

  test("the full-query tooltip stays anchored to the SQL value while it fades out @bug-2873 @P3 @regression @queryManagement", async ({ page }) => {
    const edition = await pm.editionFeaturesPage.detectEdition();
    test.skip(edition === 'opensource', `Query Management is enterprise-only (detected: ${edition})`);

    const now = Date.now() * 1000;
    // The response shape must match the API: SQL and the time range live under
    // `query`, scan counters under `scan_stats`. RunningQueries flattens both
    // before handing a row to the Query List drawer.
    await pm.queryManagementPage.stubRunningQueries('_meta', [
      {
        trace_id: 'qm-tooltip-trace-1',
        status: 'processing',
        user_id: 'tooltip.user@example.com',
        org_id: '_meta',
        stream_type: 'logs',
        // The All Queries tab filters by search type, and defaults to dashboards.
        search_type: 'dashboards',
        work_group: 'default',
        created_at: now - 5000000,
        started_at: now - 5000000,
        query: { sql: LONG_SQL, start_time: now - 60000000, end_time: now },
        scan_stats: { files: 1, records: 1, original_size: 1, compressed_size: 1 },
        search_event_context: { folder_name: 'f', dashboard_name: 'd' },
      },
    ]);

    await pm.queryManagementPage.navigateToRunningQueries('_meta');
    await pm.queryManagementPage.selectQueryTypeTab('all');
    await pm.queryManagementPage.openFirstQueryDetails();

    const sqlCell = pm.queryManagementPage.sqlValueCell('SELECT col_0');
    await pm.queryManagementPage.hoverUntilTooltipShown(sqlCell);
    const anchorBox = await sqlCell.boundingBox();

    await pm.queryManagementPage.startSamplingBubbleRects();
    await page.mouse.move(5, 5);
    await pm.queryManagementPage.tooltipBubble.waitFor({ state: 'detached', timeout: 5000 });
    const rects = await pm.queryManagementPage.stopSamplingBubbleRects();

    testLogger.info(`sampled ${rects.length} bubble frames while closing`);
    // A bubble parked at the viewport origin sits far left of the SQL cell it belongs to.
    const strayFrames = rects.filter((r) => r.left < anchorBox.x - 200);
    test.expect(strayFrames, 'bubble left its anchor while closing').toEqual([]);
  });
});
