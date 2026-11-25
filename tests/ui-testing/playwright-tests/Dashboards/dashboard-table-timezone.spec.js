// ENT#1491 + OSS#9855: a table panel shows (and copies) histogram timestamps in the browser's or the dashboard's chosen timezone, not UTC.
const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const PageManager = require('../../pages/page-manager.js');
const { DashboardPanelTablePage } = require('../../pages/dashboardPages/dashboard-panel-table.js');
const { orgIdentifier, formatInZone, seedTimezoneTablePanel, deleteSeededTablePanel } = require('../utils/dashboard-seed-api.js');

test.describe('Table timestamps follow the browser timezone (ENT#1491)', { tag: ['@dashboards', '@regression', '@P1'] }, () => {
  test.use({ timezoneId: 'Asia/Kolkata' });

  test('cell and copied value read in Asia/Kolkata', async ({ page, context }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    const seeded = await seedTimezoneTablePanel(page, `${Date.now()}${Math.floor(Math.random() * 1000)}`);
    try {
      await context.grantPermissions(['clipboard-read', 'clipboard-write']);
      await navigateToBase(page);
      const panelTable = new DashboardPanelTablePage(page);
      await panelTable.gotoDashboardView(seeded.dashboardId, { org: orgIdentifier(), period: '1h' });
      const expected = formatInZone(seeded.rowMs, 'Asia/Kolkata');
      expect(expected, 'Kolkata differs from UTC').not.toBe(formatInZone(seeded.rowMs, 'UTC'));
      await expect(panelTable.cell(expected)).toBeVisible({ timeout: 60000 });
      await expect(panelTable.cell(formatInZone(seeded.rowMs, 'UTC'))).toHaveCount(0);

      await panelTable.copyCell(expected, 'x_axis_1');
      await expect.poll(() => page.evaluate(() => navigator.clipboard.readText()), { timeout: 5000 }).toBe(expected);
    } finally {
      await deleteSeededTablePanel(page, seeded);
    }
  });
});

test.describe('Table timestamps follow the dashboard timezone (OSS#9855)', { tag: ['@dashboards', '@regression', '@P1'] }, () => {
  test.use({ timezoneId: 'UTC' });

  test('picking Asia/Bangkok on the dashboard shifts the cell to UTC+7', async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    const seeded = await seedTimezoneTablePanel(page, `${Date.now()}${Math.floor(Math.random() * 1000)}`);
    try {
      await navigateToBase(page);
      const pm = new PageManager(page);
      const panelTable = new DashboardPanelTablePage(page);
      await panelTable.gotoDashboardView(seeded.dashboardId, { org: orgIdentifier(), period: '1h' });
      await expect(panelTable.cell(formatInZone(seeded.rowMs, 'UTC'))).toBeVisible({ timeout: 60000 });

      await pm.dateTimePickerPage.selectTimezone('Asia/Bangkok');

      const expected = formatInZone(seeded.rowMs, 'Asia/Bangkok');
      await expect(panelTable.cell(expected)).toBeVisible({ timeout: 60000 });
      await expect(panelTable.cell(formatInZone(seeded.rowMs, 'UTC'))).toHaveCount(0);
    } finally {
      await deleteSeededTablePanel(page, seeded);
    }
  });
});
