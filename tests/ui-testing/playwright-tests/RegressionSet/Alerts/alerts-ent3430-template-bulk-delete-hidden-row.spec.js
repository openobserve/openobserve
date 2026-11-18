// Copyright 2026 OpenObserve Inc.

const { test, expect, navigateToBase } = require('../../utils/enhanced-baseFixtures.js');
const testLogger = require('../../utils/test-logger.js');
const PageManager = require('../../../pages/page-manager.js');

test.describe('Alert Templates bulk delete skips a row the search hides (o2-enterprise#3430)', {
  tag: ['@alerts', '@templates', '@regression', '@all'],
}, () => {
  let pm;
  let names = [];

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    await navigateToBase(page);
    pm = new PageManager(page);
    names = [];
  });

  test.afterEach(async () => {
    for (const name of names) await pm.alertTemplatesPage.deleteTemplateViaApi(name);
  });

  test('a template the search hides after select all is not bulk deleted', { tag: ['@bug-ent3430', '@P1'] }, async () => {
    // A selection must not outlive the filter that hides its row.
    const prefix = `e2e_3430_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const hidden = `${prefix}_hidden`;
    const shown = `${prefix}_shown`;
    names = [hidden, shown];
    for (const name of names) {
      expect(await pm.alertTemplatesPage.createTemplateViaApi(name)).toBe(true);
    }

    await pm.alertTemplatesPage.navigateToTemplates();
    await pm.alertTemplatesPage.waitForTemplateListReady();
    await pm.alertTemplatesPage.filterTemplateList(prefix);
    await pm.alertTemplatesPage.expectTemplateRowsShown(names);
    await pm.alertTemplatesPage.selectAllShownTemplates(names);

    await pm.alertTemplatesPage.filterTemplateList(shown);
    await pm.alertTemplatesPage.expectTemplateRowHidden(hidden);
    const sent = await pm.alertTemplatesPage.bulkDeleteSelectedTemplates();

    expect(sent).toEqual([shown]);
    await expect.poll(() => pm.alertTemplatesPage.templateStatusViaApi(shown), { timeout: 15000 }).toBe(404);
    expect(await pm.alertTemplatesPage.templateStatusViaApi(hidden)).toBe(200);
  });
});
