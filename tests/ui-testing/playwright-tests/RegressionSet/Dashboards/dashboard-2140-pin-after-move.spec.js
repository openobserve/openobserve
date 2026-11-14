// ENT#2140: a dashboard pinned to Home and then moved to another folder must open on Home from its new folder.
const { test, expect, navigateToBase } = require('../../utils/enhanced-baseFixtures.js');
const testLogger = require('../../utils/test-logger.js');
const { getAuthHeaders, getOrgIdentifier } = require('../../utils/cloud-auth.js');
const PageManager = require('../../../pages/page-manager.js');
const { DashboardPanelTablePage } = require('../../../pages/dashboardPages/dashboard-panel-table.js');

const BASE = (process.env.INGESTION_URL || process.env.ZO_BASE_URL).replace(/\/$/, '');
const UI = process.env.ZO_BASE_URL.replace(/\/$/, '');
const ORG = () => getOrgIdentifier() || process.env.ORGNAME || 'default';
const PIN_KEY = 'home_dashboard';

async function api(method, path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

async function createFolder(name) {
  const { status, body } = await api('POST', `/api/v2/${ORG()}/folders/dashboards`, { name, description: 'ent2140' });
  if (status >= 400) throw new Error(`create folder ${name} -> ${status}`);
  return body.folderId || body.folder_id;
}

async function createDashboard(title, folderId) {
  const { status, body } = await api('POST', `/api/${ORG()}/dashboards?folder=${folderId}`, {
    version: 8,
    title,
    description: 'ent2140',
    variables: { list: [], showDynamicFilters: false },
    tabs: [{
      tabId: 'default',
      name: 'Default',
      panels: [{
        id: 'Panel_ent2140',
        type: 'table',
        title: 'ent2140 panel',
        description: '',
        queryType: 'sql',
        config: { show_legends: true },
        queries: [{
          query: 'SELECT count(*) as "cnt" FROM "e2e_automate"',
          vrlFunctionQuery: '',
          customQuery: true,
          fields: {
            stream: 'e2e_automate',
            stream_type: 'logs',
            x: [],
            y: [{ label: '', alias: 'cnt', column: 'cnt', type: 'custom', color: null, functionName: null, args: [] }],
            z: [],
            filter: { filterType: 'group', logicalOperator: 'AND', conditions: [] },
          },
          config: { promql_legend: '' },
        }],
        layout: { x: 0, y: 0, w: 48, h: 10, i: 1 },
      }],
    }],
  });
  if (status >= 400) throw new Error(`create dashboard -> ${status}: ${JSON.stringify(body)}`);
  const inner = body[`v${body.version}`] || body;
  return inner.dashboardId || inner.dashboard_id;
}

test.describe('Dashboard pinned to Home survives a folder move (ENT#2140)', { tag: ['@dashboards', '@regression', '@P2'] }, () => {
  test('moving a pinned dashboard keeps Home opening it from the new folder', async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    test.setTimeout(180000);
    const stamp = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
    const title = `ovn_c_2140_${stamp}`;
    const before = await api('GET', `/api/${ORG()}/settings/v2/${PIN_KEY}`);
    const created = { folders: [], dashboardId: null };
    try {
      const folderA = await createFolder(`ovn_c_2140_a_${stamp}`);
      created.folders.push(folderA);
      const folderB = await createFolder(`ovn_c_2140_b_${stamp}`);
      created.folders.push(folderB);
      created.dashboardId = await createDashboard(title, folderB);

      await navigateToBase(page);
      const pm = new PageManager(page);
      await page.goto(`${UI}/web/dashboards?org_identifier=${ORG()}&folder=${folderB}`);
      await expect(pm.dashboardList.dashboardRow(title)).toBeVisible({ timeout: 30000 });

      const pinSaved = await pm.dashboardList.setHomeFromRowMenu(title, ORG());
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

      await expect.poll(async () => {
        const { body } = await api('GET', `/api/${ORG()}/settings/v2/${PIN_KEY}`);
        return body?.setting_value?.dashboardId ?? body?.dashboardId;
      }, { timeout: 15000, message: 'the pin must not be dropped' }).toBe(created.dashboardId);
      expect(pageErrors).toEqual([]);
    } finally {
      const prior = before.status < 400 ? before.body : null;
      const priorValue = prior?.setting_value ?? null;
      if (priorValue) {
        await api('POST', `/api/${ORG()}/settings/v2`, { setting_key: PIN_KEY, setting_value: priorValue, setting_category: 'ui' });
      } else {
        await api('DELETE', `/api/${ORG()}/settings/v2/${PIN_KEY}`);
      }
      if (created.dashboardId) {
        for (const f of created.folders) await api('DELETE', `/api/${ORG()}/dashboards/${created.dashboardId}?folder=${f}`);
      }
      for (const f of created.folders) await api('DELETE', `/api/v2/${ORG()}/folders/dashboards/${f}`);
    }
  });
});
