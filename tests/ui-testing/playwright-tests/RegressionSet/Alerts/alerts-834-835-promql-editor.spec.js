const { test, expect, navigateToBase } = require('../../utils/enhanced-baseFixtures.js');
const testLogger = require('../../utils/test-logger.js');
const PageManager = require('../../../pages/page-manager.js');
const {
  orgId, ingestPromCounter, createPromqlPanelDashboard, deleteDashboardQuietly, deleteStreamQuietly,
} = require('../../utils/regression-seed-api.js');

const suffix = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const METRIC = `ovn_b2_promql_${suffix}_total`;
const PROMQL = `sum(rate(${METRIC}[5m]))`;

test.describe('PromQL editor opened from a dashboard panel alert (ENT#834, ENT#835)', () => {
  test.describe.configure({ mode: 'serial' });
  let dashboardId;
  let pm;

  test.beforeAll(async () => {
    await ingestPromCounter(METRIC, 'ovn-b2');
    dashboardId = await createPromqlPanelDashboard(`ovn-b2-promql-${suffix}`, METRIC, PROMQL);
    testLogger.info(`Created dashboard ${dashboardId} for ${METRIC}`);
  });

  test.afterAll(async () => {
    if (dashboardId) await deleteDashboardQuietly(dashboardId);
    await deleteStreamQuietly(METRIC, 'metrics');
  });

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    await navigateToBase(page);
    pm = new PageManager(page);
  });

  test('Run query sends the PromQL text as query=, not [object Object] (ENT#835)', {
    tag: ['@bug-835', '@P1', '@regression', '@alertsRegression'],
  }, async () => {
    const dialog = pm.alertPromqlEditorDialogPage;
    await dialog.openFromDashboardPanel(process.env.ZO_BASE_URL, orgId(), dashboardId);
    await dialog.expectEditorText(PROMQL);

    const response = await dialog.runQueryAndCaptureRangeResponse();
    const sent = new URL(response.url()).searchParams.get('query');
    expect(sent).toBe(PROMQL);
    expect(response.url()).not.toContain('%5Bobject%20Object%5D');
    expect(response.status()).toBe(200);
    // The response is an event stream; pre-fix it carried the parse error instead of samples.
    expect(await response.text()).not.toContain('unexpected character');
    await dialog.expectEventsFound();
  });

  test('wheel scrolling inside the PromQL editor does not scroll endlessly (ENT#834)', {
    tag: ['@bug-834', '@P2', '@regression', '@alertsRegression'],
  }, async () => {
    const dialog = pm.alertPromqlEditorDialogPage;
    const resizeErrors = dialog.collectResizeObserverErrors();

    await dialog.openFromDashboardPanel(process.env.ZO_BASE_URL, orgId(), dashboardId);
    await dialog.expectEditorText(PROMQL);
    const before = await dialog.measureEditor();

    await dialog.wheelOverEditor(10, 2000);
    // Pre-fix the editor kept growing after the wheel stopped, so it must hold its size over consecutive reads.
    await dialog.expectEditorSteadyAt(before.height);
    await dialog.expectFirstLineInsideEditor();
    expect(resizeErrors).toEqual([]);
  });
});
