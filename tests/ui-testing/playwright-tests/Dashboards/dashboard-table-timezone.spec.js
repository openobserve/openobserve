// ENT#1491 + OSS#9855: a table panel shows (and copies) histogram timestamps in the browser's or the dashboard's chosen timezone, not UTC.
const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const { getAuthHeaders, getOrgIdentifier } = require('../utils/cloud-auth.js');
const PageManager = require('../../pages/page-manager.js');
const { DashboardPanelTablePage } = require('../../pages/dashboardPages/dashboard-panel-table.js');

const BASE = (process.env.INGESTION_URL || process.env.ZO_BASE_URL).replace(/\/$/, '');
const ORG = () => getOrgIdentifier() || process.env.ORGNAME || 'default';
const headers = () => ({ ...getAuthHeaders(), 'Content-Type': 'application/json' });

function fmt(ms, timeZone) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}:${p.second}`;
}

async function seedTablePanel(stamp) {
  const stream = `ovn_c_tz_${stamp}`;
  // a whole minute 10 minutes ago, so the 1-minute histogram bucket equals the row time
  const rowMs = Math.floor((Date.now() - 10 * 60 * 1000) / 60000) * 60000;
  const ing = await fetch(`${BASE}/api/${ORG()}/${stream}/_json`, { method: 'POST', headers: headers(), body: JSON.stringify([{ _timestamp: rowMs * 1000, msg: 'tz' }]) });
  if (!ing.ok) throw new Error(`ingest ${ing.status}`);
  const res = await fetch(`${BASE}/api/${ORG()}/dashboards?folder=default`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({
      version: 8,
      title: `ovn_c_tz_${stamp}`,
      description: 'ENT#1491 OSS#9855',
      variables: { list: [], showDynamicFilters: false },
      tabs: [{
        tabId: 'default',
        name: 'Default',
        panels: [{
          id: 'Panel_tz',
          type: 'table',
          title: 'tz table',
          description: '',
          queryType: 'sql',
          config: { show_legends: true },
          queries: [{
            query: `SELECT histogram(_timestamp, '1 minute') as "x_axis_1", count(*) as "y_axis_1" FROM "${stream}" GROUP BY x_axis_1`,
            vrlFunctionQuery: '',
            customQuery: true,
            fields: {
              stream,
              stream_type: 'logs',
              x: [{ label: 'Time', alias: 'x_axis_1', column: '_timestamp', type: 'build', functionName: 'histogram', args: [], color: null }],
              y: [{ label: 'Count', alias: 'y_axis_1', column: 'y_axis_1', type: 'custom', functionName: null, args: [], color: null }],
              z: [],
              filter: { filterType: 'group', logicalOperator: 'AND', conditions: [] },
            },
            config: { promql_legend: '' },
          }],
          layout: { x: 0, y: 0, w: 48, h: 12, i: 1 },
        }],
      }],
    }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`create dashboard ${res.status}: ${JSON.stringify(body)}`);
  return { stream, rowMs, dashboardId: (body[`v${body.version}`] || body).dashboardId };
}

async function cleanup({ stream, dashboardId }) {
  if (dashboardId) await fetch(`${BASE}/api/${ORG()}/dashboards/${dashboardId}?folder=default`, { method: 'DELETE', headers: getAuthHeaders() }).catch(() => {});
  await fetch(`${BASE}/api/${ORG()}/streams/${stream}?type=logs`, { method: 'DELETE', headers: getAuthHeaders() }).catch(() => {});
}

test.describe('Table timestamps follow the browser timezone (ENT#1491)', { tag: ['@dashboards', '@regression', '@P1'] }, () => {
  test.use({ timezoneId: 'Asia/Kolkata' });

  test('cell and copied value read in Asia/Kolkata', async ({ page, context }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    const seeded = await seedTablePanel(`${Date.now()}${Math.floor(Math.random() * 1000)}`);
    try {
      await context.grantPermissions(['clipboard-read', 'clipboard-write']);
      await navigateToBase(page);
      const panelTable = new DashboardPanelTablePage(page);
      await panelTable.gotoDashboardView(seeded.dashboardId, { org: ORG(), period: '1h' });
      const expected = fmt(seeded.rowMs, 'Asia/Kolkata');
      expect(expected, 'Kolkata differs from UTC').not.toBe(fmt(seeded.rowMs, 'UTC'));
      await expect(panelTable.cell(expected)).toBeVisible({ timeout: 60000 });
      await expect(panelTable.cell(fmt(seeded.rowMs, 'UTC'))).toHaveCount(0);

      await panelTable.copyCell(expected, 'x_axis_1');
      await expect.poll(() => page.evaluate(() => navigator.clipboard.readText()), { timeout: 5000 }).toBe(expected);
    } finally {
      await cleanup(seeded);
    }
  });
});

test.describe('Table timestamps follow the dashboard timezone (OSS#9855)', { tag: ['@dashboards', '@regression', '@P1'] }, () => {
  test.use({ timezoneId: 'UTC' });

  test('picking Asia/Bangkok on the dashboard shifts the cell to UTC+7', async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    const seeded = await seedTablePanel(`${Date.now()}${Math.floor(Math.random() * 1000)}`);
    try {
      await navigateToBase(page);
      const pm = new PageManager(page);
      const panelTable = new DashboardPanelTablePage(page);
      await panelTable.gotoDashboardView(seeded.dashboardId, { org: ORG(), period: '1h' });
      await expect(panelTable.cell(fmt(seeded.rowMs, 'UTC'))).toBeVisible({ timeout: 60000 });

      await pm.dateTimePickerPage.selectTimezone('Asia/Bangkok');

      const expected = fmt(seeded.rowMs, 'Asia/Bangkok');
      await expect(panelTable.cell(expected)).toBeVisible({ timeout: 60000 });
      await expect(panelTable.cell(fmt(seeded.rowMs, 'UTC'))).toHaveCount(0);
    } finally {
      await cleanup(seeded);
    }
  });
});
