// ENT#2140: a dashboard pinned to Home and then moved to another folder must open on Home from its new folder.
const { test, expect, navigateToBase } = require('../../utils/enhanced-baseFixtures.js');
const testLogger = require('../../utils/test-logger.js');
const PageManager = require('../../../pages/page-manager.js');
const { DashboardPanelTablePage } = require('../../../pages/dashboardPages/dashboard-panel-table.js');
const {
  orgIdentifier,
  createDashboard,
  deleteDashboard,
  pinnedCountDashboard,
  createDashboardFolder,
  deleteDashboardFolder,
  readHomePin,
  pinnedHomeDashboardId,
  restoreHomePin,
} = require('../../utils/dashboard-seed-api.js');

const UI = process.env.ZO_BASE_URL.replace(/\/$/, '');

test.describe('Dashboard pinned to Home survives a folder move (ENT#2140)', { tag: ['@dashboards', '@regression', '@P2'] }, () => {
  test('moving a pinned dashboard keeps Home opening it from the new folder', async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    test.setTimeout(180000);
    const stamp = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
    const title = `ovn_c_2140_${stamp}`;
    const before = await readHomePin(page);
    const created = { folders: [], dashboardId: null };
    try {
      const folderA = await createDashboardFolder(page, `ovn_c_2140_a_${stamp}`, 'ent2140');
      created.folders.push(folderA);
      const folderB = await createDashboardFolder(page, `ovn_c_2140_b_${stamp}`, 'ent2140');
      created.folders.push(folderB);
      created.dashboardId = await createDashboard(page, pinnedCountDashboard(title), folderB);

      await navigateToBase(page);
      const pm = new PageManager(page);
      await page.goto(`${UI}/web/dashboards?org_identifier=${orgIdentifier()}&folder=${folderB}`);
      await expect(pm.dashboardList.dashboardRow(title)).toBeVisible({ timeout: 30000 });

      const pinSaved = await pm.dashboardList.setHomeFromRowMenu(title, orgIdentifier());
      expect(pinSaved.ok()).toBeTruthy();
      await expect(pm.dashboardList.homeIndicator(title)).toBeVisible({ timeout: 15000 });

      const moved = await pm.dashboardList.moveRowToFolder(title, folderA);
      expect(moved.ok()).toBeTruthy();

      const reads = [];
      page.on('request', (r) => {
        if (r.url().includes(`/dashboards/${created.dashboardId}`) && r.method() === 'GET') reads.push(new URL(r.url()).searchParams.get('folder'));
      });
      const pageErrors = [];
      page.on('pageerror', (e) => pageErrors.push(e.message));
      await pm.homePage.openPinnedDashboardTab(title);

      await expect.poll(() => reads, { timeout: 30000, message: 'Home should read the pinned dashboard' }).toContain(folderA);
      expect(reads, 'Home must not ask for the dashboard in its old folder').not.toContain(folderB);
      await expect(new DashboardPanelTablePage(page).panelContainer).toBeVisible({ timeout: 30000 });

      await expect.poll(() => pinnedHomeDashboardId(page), { timeout: 15000, message: 'the pin must not be dropped' }).toBe(created.dashboardId);
      expect(pageErrors).toEqual([]);
    } finally {
      await restoreHomePin(page, before);
      if (created.dashboardId) {
        for (const f of created.folders) await deleteDashboard(page, created.dashboardId, f);
      }
      for (const f of created.folders) await deleteDashboardFolder(page, f);
    }
  });
});
