const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const PageManager = require('../../pages/page-manager.js');

const QUERY_EDITOR = '[data-test="dashboard-panel-query-editor"]';

/** The Monaco editor inside the visible query editor, so the legend or any other editor is never touched. */
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
async function setCodeQuery(builder, page, query) {
  await builder.switchToCustomMode();
  await expect.poll(() => editorText(page), { timeout: 15000 }).not.toBeNull();
  await editorText(page, query);
}

test.describe('Metrics PromQL builder round-trip', () => {
  test.afterEach(async ({}, testInfo) => {
    testLogger.testEnd(testInfo.title, testInfo.status);
  });

  async function openEditor(page, testInfo) {
    testLogger.testStart(testInfo.title, testInfo.file);
    await navigateToBase(page);
    const pm = new PageManager(page);
    await pm.metricsPage.gotoMetricsPage();
    await pm.metricsBuilderPage.builderModeBtn.waitFor({ state: 'visible', timeout: 30000 });
    return pm;
  }

  for (const query of [
    'sum by (job)(rate(http_requests_total{code=~"5.."}[5m]))',
    'avg by (instance)(node_load1{job="node"}) * 100',
  ]) {
    test(`switches ${query} to the builder and back unchanged`, {
      tag: ['@metrics', '@builder', '@P1', '@all'],
    }, async ({ page }, testInfo) => {
      const pm = await openEditor(page, testInfo);
      const builder = pm.metricsBuilderPage;
      await setCodeQuery(builder, page, query);

      await builder.builderModeBtn.click();
      await expect(builder.builderModeBtn).toHaveAttribute('data-state', 'on', { timeout: 15000 });
      await expect(page.locator(builder.confirmDialogOk)).toHaveCount(0);
      await expect(builder.operationChips.first()).toBeVisible({ timeout: 15000 });

      await builder.customModeBtn.click();
      await expect(builder.customModeBtn).toHaveAttribute('data-state', 'on', { timeout: 15000 });
      await expect.poll(() => editorText(page), { timeout: 15000 }).toBe(query);
    });
  }

  test('keeps a query the builder cannot show in code mode, with the reason', {
    tag: ['@metrics', '@builder', '@P2', '@all'],
  }, async ({ page }, testInfo) => {
    const pm = await openEditor(page, testInfo);
    const builder = pm.metricsBuilderPage;
    const query = 'max without (instance)(node_load1)';
    await setCodeQuery(builder, page, query);

    await builder.builderModeBtn.click();
    const refusal = page.locator('[data-test="dashboard-panel-query-errors"]');
    await expect(refusal).toContainText('The builder cannot show a without (…) grouping', { timeout: 15000 });
    await expect(refusal).toBeInViewport();
    await expect(builder.customModeBtn).toHaveAttribute('data-state', 'on');
    expect(await editorText(page)).toBe(query);

    await editorText(page, 'max(node_load1)');
    await refusal.click();
    await expect(refusal).toHaveCount(0, { timeout: 15000 });
  });
});
