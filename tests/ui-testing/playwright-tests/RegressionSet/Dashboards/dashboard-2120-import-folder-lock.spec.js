// ENT#2120: the import folder cannot be changed while an import runs, so the dashboard lands in the folder it was started for.
const { test, expect, navigateToBase } = require('../../utils/enhanced-baseFixtures.js');
const testLogger = require('../../utils/test-logger.js');
const PageManager = require('../../../pages/page-manager.js');
const { getAuthHeaders, getOrgIdentifier } = require('../../utils/cloud-auth.js');

const BASE = (process.env.INGESTION_URL || process.env.ZO_BASE_URL).replace(/\/$/, '');
const ORG = () => getOrgIdentifier() || process.env.ORGNAME || 'default';

async function api(method, path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

async function dashboardsIn(folderId) {
  const { body } = await api('GET', `/api/${ORG()}/dashboards?folder=${folderId}`);
  return (body.dashboards || body.list || []).map((d) => {
    const inner = d[`v${d.version}`] || d;
    return { id: inner.dashboardId || d.dashboard_id, title: inner.title || d.title };
  });
}

test.describe('Dashboard import folder lock (ENT#2120)', { tag: ['@dashboards', '@regression', '@P2'] }, () => {
  test('the folder picker is locked while an import runs and the import lands in the chosen folder', async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    const stamp = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
    const title = `ovn_c_2120_${stamp}`;
    let folderId = null;
    try {
      const created = await api('POST', `/api/v2/${ORG()}/folders/dashboards`, { name: `ovn_c_2120_${stamp}`, description: 'ent2120' });
      expect(created.status, `create folder ${created.status}`).toBeLessThan(400);
      folderId = created.body.folderId;

      await navigateToBase(page);
      const pm = new PageManager(page);
      await page.goto(`${process.env.ZO_BASE_URL}/web/dashboards/import?org_identifier=${ORG()}&folder=${folderId}`);
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

      let release;
      const held = new Promise((r) => { release = r; });
      const posts = [];
      await page.route(new RegExp(`/api/${ORG()}/dashboards(\\?|$)`), async (route) => {
        if (route.request().method() !== 'POST') return route.continue();
        posts.push(new URL(route.request().url()).searchParams.get('folder'));
        await held;
        await route.continue();
      });

      await pm.dashboardImport.importButtonByRole.click();
      await expect.poll(() => posts.length, { timeout: 15000 }).toBe(1);
      await expect(newFolderBtn, 'new-folder is locked mid-import').toBeDisabled();
      await pm.dashboardImport.tryOpenFolderSelect();
      await expect(pm.dashboardImport.folderOptions, 'the folder list must not open mid-import').toHaveCount(0);

      release();
      expect(posts).toEqual([folderId]);
      await expect.poll(async () => (await dashboardsIn(folderId)).some((d) => d.title === title), { timeout: 20000 }).toBe(true);
      await page.unrouteAll({ behavior: 'ignoreErrors' });
    } finally {
      if (folderId) {
        for (const d of await dashboardsIn(folderId)) {
          if (d.title === title) await api('DELETE', `/api/${ORG()}/dashboards/${d.id}?folder=${folderId}`);
        }
        await api('DELETE', `/api/v2/${ORG()}/folders/dashboards/${folderId}`);
      }
    }
  });
});
