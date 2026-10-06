const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const PageManager = require('../../pages/page-manager.js');
const { DETAIL_METRIC, RELATED_METRIC, seedDetailMetrics } = require('../utils/metrics-explore-seed.js');
const { getDashboardJson, deleteDashboard } = require('../utils/exemplar-fixtures.js');
const { waitForDashboardPage } = require('../Dashboards/utils/dashCreation.js');

const QUERY_EDITOR = '[data-test="dashboard-panel-query-editor"]';
const A = `sum by (method)(rate(${RELATED_METRIC}[5m]))`;
const B = `sum by (method)(rate(${DETAIL_METRIC}[5m]))`;
const FORMULA = 'A / B * 100';
const COMBINED = `(${A}) / (${B}) * 100`;

async function editorText(page, value) {
  return page.evaluate(
    ({ selector, next }) => {
      const host = [...document.querySelectorAll(selector)].find((el) => el.offsetParent !== null);
      const editor = window.monaco?.editor?.getEditors?.().find((e) => host?.contains(e.getDomNode()));
      if (!editor) return null;
      if (next !== undefined) {
        editor.focus();
        editor.setValue(next);
      }
      return editor.getValue();
    },
    { selector: QUERY_EDITOR, next: value },
  );
}

/** Focused, so the next click blurs the editor and flushes its debounced text into the panel, as typing does. */
async function typeIntoCurrentTab(page, text) {
  await expect.poll(() => editorText(page), { timeout: 15000 }).not.toBeNull();
  await editorText(page, text);
}

function sentQueries(page) {
  const sent = [];
  page.on('request', (req) => {
    const url = new URL(req.url());
    if (url.pathname.endsWith('/prometheus/api/v1/query_range')) sent.push(url.searchParams.get('query'));
  });
  return sent;
}

test.describe('Metrics PromQL formulas', () => {
  let dashboardId;

  test.beforeAll(async ({ request }) => {
    await seedDetailMetrics(request);
  });

  test.afterAll(async () => {
    await deleteDashboard(dashboardId);
  });

  test.afterEach(async ({}, testInfo) => {
    testLogger.testEnd(testInfo.title, testInfo.status);
  });

  test('A / B * 100 over hidden inputs runs as one query, saves to a dashboard and survives a reload', {
    tag: ['@metrics', '@dashboards', '@P1', '@all'],
  }, async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    await navigateToBase(page);
    const pm = new PageManager(page);
    const builder = pm.metricsBuilderPage;
    await pm.metricsPage.gotoMetricsPage();
    await builder.builderModeBtn.waitFor({ state: 'visible', timeout: 30000 });

    await builder.switchToCustomMode();
    await typeIntoCurrentTab(page, A);

    await page.locator('[data-test="dashboard-panel-query-tab-add"]').click();
    await builder.switchToCustomMode();
    await typeIntoCurrentTab(page, B);

    await page.locator('[data-test="dashboard-panel-query-tab-add-formula"]').click();
    await typeIntoCurrentTab(page, FORMULA);

    for (const index of [0, 1]) {
      const eye = page.locator(`[data-test="dashboard-panel-query-tab-visibility-${index}"]`);
      await eye.click();
      await expect(eye).toHaveAttribute('data-test-hidden', 'true');
    }

    const sent = sentQueries(page);
    await builder.clickRunQuery();
    await expect.poll(() => sent, { timeout: 30000 }).toContain(COMBINED);
    await expect(page.locator('[data-test="chart-renderer"] canvas').first()).toBeVisible({ timeout: 30000 });
    await expect(page.locator('[data-test="no-data"]')).toHaveCount(0);
    expect(sent.filter((q) => q === A || q === B)).toEqual([]);

    const panelTitle = `Error ratio ${Date.now().toString(36)}`;
    expect(await builder.clickAddToDashboard()).toBe(true);
    await builder.selectDashboardFolder('default');
    await builder.createNewDashboardInDialog(`e2e_formula_${Date.now().toString(36)}`);
    await builder.selectDashboardTab('Default');
    expect(await builder.fillPanelTitle(panelTitle)).toBe(true);
    expect(await builder.clickDashboardAdd()).toBe(true);
    await waitForDashboardPage(page);
    await expect.poll(() => new URL(page.url()).searchParams.get('dashboard'), { timeout: 15000 }).toBeTruthy();
    dashboardId = new URL(page.url()).searchParams.get('dashboard');

    // A reload may draw the panel from the browser's result cache, so it is checked by what it draws.
    await page.reload();
    const savedChart = builder.getPanelContainerByTitle(panelTitle);
    await expect(savedChart.locator('[data-test="chart-renderer"] canvas').first()).toBeVisible({ timeout: 30000 });
    await expect(savedChart.locator('[data-test="panel-schema-renderer-error-message"]')).toHaveCount(0);
    await expect(savedChart.locator('[data-test="no-data"]')).toHaveCount(0);

    const saved = await getDashboardJson(dashboardId);
    const dash = saved[`v${saved.version}`] || saved;
    const savedPanel = dash.tabs.flatMap((tab) => tab.panels).find((p) => p.title === panelTitle);
    expect(savedPanel.queries.map((q) => q.config.hide ?? false)).toEqual([true, true, false]);
    expect(savedPanel.queries.map((q) => q.config.ref ?? null)).toEqual(['A', 'B', null]);
    expect(savedPanel.queries[2].config.formula).toBe(FORMULA);

    // The inputs were typed in code mode, so each one's metric comes from its text, not the inherited stream pick.
    await savedChart.hover();
    await page.locator(`[data-test="dashboard-edit-panel-${panelTitle}-dropdown"]`).click();
    await page.locator('[data-test="dashboard-create-alert-from-panel"]').click();
    for (const metric of [RELATED_METRIC, DETAIL_METRIC]) {
      await expect(page.locator(`[data-test="create-alert-stream-option-${metric}"]`)).toBeVisible({ timeout: 15000 });
    }
    await page.locator('[data-test="create-alert-from-source-dialog"] [data-test="o-dialog-primary-btn"]').click();
    await page.waitForURL(/alerts\/add.*prefill=panel/, { timeout: 30000 });
    await expect
      .poll(() => page.evaluate((text) => !!window.monaco?.editor?.getEditors?.().some((e) => e.getValue() === text), COMBINED), {
        timeout: 30000,
      })
      .toBe(true);
  });
});
