// A PromQL table drilldown fills ${row.field.<label>} from the clicked row, even in the default Timestamp mode (#15914, fixed by #16631).

const { test, expect } = require('../../utils/enhanced-baseFixtures.js');
const testLogger = require('../../utils/test-logger.js');
const PageManager = require('../../../pages/page-manager.js');
const { getAuthHeaders } = require('../../utils/cloud-auth.js');
const { ingestBase } = require('../../utils/ingest-url.js');
const { BASE, ORG, createDashboard, deleteCreatedDashboards } = require('../../utils/dashboard-auto-run-fixtures.js');

const METRIC = 'e2e_16631_pod_restarts';
const POD = 'checkout-7f9c';

// One series only, so whichever Timestamp-mode row is clicked carries this pod label.
async function ingestPodGauge(request) {
  const now = Date.now();
  const rows = Array.from({ length: 6 }, (_, i) => ({
    __name__: METRIC,
    __type__: 'gauge',
    pod: POD,
    namespace: 'shop',
    _timestamp: now - (6 - i) * 30000,
    value: i + 1,
  }));
  const res = await request.post(`${ingestBase(BASE)}/api/${ORG()}/ingest/metrics/_json`, {
    headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
    data: rows,
  });
  expect(res.ok(), `Precondition: metrics ingest must succeed (HTTP ${res.status()})`).toBe(true);
  await expect.poll(async () => {
    const q = await request.get(`${BASE}/api/${ORG()}/prometheus/api/v1/query?query=${encodeURIComponent(METRIC)}`, { headers: getAuthHeaders() });
    const body = await q.json().catch(() => ({}));
    return body?.data?.result?.length || 0;
  }, { timeout: 60000, message: 'Precondition: the gauge must be queryable' }).toBeGreaterThan(0);
}

function promqlTablePanel(targetTitle) {
  return {
    id: 'Panel_16631',
    type: 'table',
    title: 'pod restarts',
    description: '',
    queryType: 'promql',
    config: {
      show_legends: true,
      legends_position: null,
      drilldown: [{
        name: 'Open pod',
        type: 'byDashboard',
        targetBlank: false,
        findBy: 'name',
        data: {
          url: '',
          folder: 'default',
          dashboard: targetTitle,
          tab: 'Default',
          passAllVariables: false,
          variables: [{ name: 'pod', value: '${row.field.pod}' }],
        },
      }],
    },
    queries: [{
      query: METRIC,
      vrlFunctionQuery: '',
      customQuery: true,
      fields: {
        stream: METRIC,
        stream_type: 'metrics',
        x: [],
        y: [],
        z: [],
        filter: { filterType: 'group', logicalOperator: 'AND', conditions: [] },
      },
      config: { promql_legend: '' },
    }],
    layout: { x: 0, y: 0, w: 96, h: 10, i: 1 },
  };
}

const podVariable = {
  type: 'textbox',
  name: 'pod',
  label: 'pod',
  value: 'default-pod',
  options: [],
  hideOnDashboard: false,
};

test.describe('PromQL table drilldown reads the clicked row (#15914)', () => {
  test.afterAll(async () => {
    await deleteCreatedDashboards();
  });

  test('a Timestamp-mode row passes its pod label, not the ${row.field.pod} text', {
    tag: ['@bug-15914', '@P2', '@regression', '@dashboardRegression'],
  }, async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    const pm = new PageManager(page);
    await ingestPodGauge(page.request);

    const runId = `${Date.now()}_${testInfo.repeatEachIndex}`;
    const targetTitle = `e2e_16631_target_${runId}`;
    await createDashboard(targetTitle, { panels: [], variables: [podVariable] });
    const sourceId = await createDashboard(`e2e_16631_source_${runId}`, { panels: [promqlTablePanel(targetTitle)] });

    await pm.dashboardPanelActions.openDashboardById(sourceId);
    const sourceUrl = page.url();
    const menu = await pm.dashboardDrilldown.triggerDrilldownFromTable();
    await expect(menu).toBeVisible({ timeout: 10000 });
    await pm.dashboardDrilldown.drilldownMenuFirstItem.click();
    const landed = await pm.dashboardDrilldown.waitForSameTabDashboardNavigation(sourceUrl);

    expect(new URL(landed).searchParams.get('var-pod'), 'the target must filter on the clicked row\'s pod').toBe(POD);
    testLogger.testEnd(testInfo.title, 'passed');
  });
});
