// ENT#2120: the import folder cannot be changed while an import runs, so the dashboard lands in the folder it was started for.
const { test, expect, navigateToBase } = require('../../utils/enhanced-baseFixtures.js');
const testLogger = require('../../utils/test-logger.js');
const PageManager = require('../../../pages/page-manager.js');
const {
  orgIdentifier,
  createDashboardFolder,
  deleteDashboardFolder,
  dashboardsInFolder,
  deleteDashboardsTitled,
} = require('../../utils/dashboard-seed-api.js');

test.describe('Dashboard import folder lock (ENT#2120)', { tag: ['@dashboards', '@regression', '@P2'] }, () => {
  test('the folder picker is locked while an import runs and the import lands in the chosen folder', async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    const stamp = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
    const title = `ovn_c_2120_${stamp}`;
    let folderId = null;
    try {
      folderId = await createDashboardFolder(`ovn_c_2120_${stamp}`, 'ent2120');

      await navigateToBase(page);
      const pm = new PageManager(page);
      await page.goto(`${process.env.ZO_BASE_URL}/web/dashboards/import?org_identifier=${orgIdentifier()}&folder=${folderId}`);
      await pm.dashboardImport.ensureFileTabActive(30000);
      await pm.dashboardImport.uploadDashboardJson(`${title}.json`, {
        version: 8,
        dashboardId: `${stamp}`,
        title,
        description: 'ENT#2120',
        variables: { list: [], showDynamicFilters: false },
        tabs: [{ tabId: 'default', name: 'Default', panels: [] }],
      });
      await pm.dashboardImport.jsonFileEditor.waitFor({ state: 'visible', timeout: 15000 });

      const newFolderBtn = pm.dashboardImport.newFolderButton;
      await expect(pm.dashboardImport.folderSelect).toBeVisible();
      await expect(newFolderBtn).toBeEnabled();
      await pm.dashboardImport.clickFolderSelect();
      await expect(pm.dashboardImport.folderOptions.first(), 'positive control: the folder list opens before the import').toBeVisible({ timeout: 10000 });
      await page.keyboard.press('Escape');
      await expect(pm.dashboardImport.folderOptions).toHaveCount(0);

      let release;
      const held = new Promise((r) => { release = r; });
      const posts = [];
      await page.route(new RegExp(`/api/${orgIdentifier()}/dashboards(\\?|$)`), async (route) => {
        if (route.request().method() !== 'POST') return route.continue();
        posts.push(new URL(route.request().url()).searchParams.get('folder'));
        await held;
        await route.continue();
      });

      await pm.dashboardImport.importButtonByRole.click();
      await expect.poll(() => posts.length, { timeout: 15000 }).toBe(1);
      await expect(newFolderBtn, 'new-folder is locked mid-import').toBeDisabled();
      await expect(pm.dashboardImport.folderSelectTrigger, 'folder picker is locked mid-import').toBeDisabled();
      await pm.dashboardImport.clickFolderSelect();
      await expect(pm.dashboardImport.folderOptions, 'the folder list must not open mid-import').toHaveCount(0);

      release();
      expect(posts).toEqual([folderId]);
      await expect.poll(async () => (await dashboardsInFolder(folderId)).some((d) => d.title === title), { timeout: 20000 }).toBe(true);
      await page.unrouteAll({ behavior: 'ignoreErrors' });
    } finally {
      if (folderId) {
        await deleteDashboardsTitled(folderId, title);
        await deleteDashboardFolder(folderId);
      }
    }
  });
});
