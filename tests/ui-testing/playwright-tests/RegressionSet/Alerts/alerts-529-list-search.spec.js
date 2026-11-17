// Copyright 2026 OpenObserve Inc.

const { test, expect, navigateToBase } = require('../../utils/enhanced-baseFixtures.js');
const testLogger = require('../../utils/test-logger.js');
const PageManager = require('../../../pages/page-manager.js');
const { uniqueName } = require('../../utils/oncall-seed.js');
const {
  quietAlert, ingestLogs, deleteLogStream, createAlertInDefaultFolder, deleteAlertInDefaultFolder,
} = require('../../utils/regression-alert-fixtures.js');

test.describe('Alert list: search survives a delete (ENT#529)', {
  tag: ['@alerts', '@regression', '@all'],
}, () => {
  test.describe.configure({ mode: 'serial' });
  const term = uniqueName('ovn_a_529').toLowerCase();
  const names = [`${term}_one`, `${term}_two`];
  const created = { stream: null, ids: [] };

  test.beforeAll(async ({ browser }) => {
    const page = await browser.newPage();
    try {
      created.stream = uniqueName('ovn_a_529_s');
      const ing = await ingestLogs(page, created.stream, [{ level: 'info', msg: 'seed' }]);
      expect(ing.ok(), await ing.text()).toBe(true);
      for (const name of names) {
        const res = await createAlertInDefaultFolder(page, quietAlert(name, created.stream));
        expect(res.ok(), await res.text()).toBe(true);
        created.ids.push((await res.json()).id);
      }
    } finally {
      await page.close();
    }
  });

  test.afterAll(async ({ browser }) => {
    const page = await browser.newPage();
    try {
      for (const id of created.ids) await deleteAlertInDefaultFolder(page, id);
      if (created.stream) await deleteLogStream(page, created.stream);
    } finally {
      await page.close();
    }
  });

  test('deleting a searched alert keeps the search term and the filtered list', { tag: ['@bug-529', '@P2'] }, async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    await navigateToBase(page);
    const pm = new PageManager(page);
    await pm.alertsPage.navigateToAlertsPage();
    await pm.alertsPage.searchAlert(term);
    await pm.alertsPage.expectAlertRowVisible(names[0], 20000);
    await pm.alertsPage.expectAlertRowVisible(names[1], 20000);

    await pm.alertsPage.deleteAlertByRow(names[0]);

    await pm.alertsPage.expectAlertSearchValue(term);
    await pm.alertsPage.expectAlertRowVisible(names[1], 20000);
    await pm.alertsPage.expectAlertRowCount(1);
  });
});
