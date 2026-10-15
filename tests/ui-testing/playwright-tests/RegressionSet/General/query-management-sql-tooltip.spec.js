const { test, navigateToBase } = require('../../utils/enhanced-baseFixtures.js');
const testLogger = require('../../utils/test-logger.js');
const PageManager = require('../../../pages/page-manager.js');

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
    await pm.queryManagementPage.mockRunningQueries([
      {
        trace_id: 'qm-tooltip-trace-1',
        status: 'processing',
        user_id: 'root@example.com',
        org_id: 'default',
        stream_type: 'logs',
        search_type: 'ui',
        query_source: 'ui',
        sql: LONG_SQL,
        start_time: 1700000000000000,
        end_time: 1700000600000000,
        created_at: Date.now() * 1000,
        records: 0,
        files: 0,
      },
    ]);

    await pm.queryManagementPage.navigateToQueryManagement(process.env['ORGNAME'] || 'default');
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
