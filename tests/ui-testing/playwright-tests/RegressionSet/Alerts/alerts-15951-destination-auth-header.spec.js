// Copyright 2026 OpenObserve Inc.

const { test, expect, navigateToBase } = require('../../utils/enhanced-baseFixtures.js');
const testLogger = require('../../utils/test-logger.js');
const PageManager = require('../../../pages/page-manager.js');
const { uniqueName } = require('../../utils/oncall-seed.js');
const {
  createHttpTemplate, createHttpDestination, getDestination, deleteDestination, deleteTemplate, isDestinationUpdate,
} = require('../../utils/regression-alert-fixtures.js');

// A ServiceNow-shaped URL is what made the edit form open as prebuilt and drop the header.
const SERVICENOW_URL = 'https://ovn-a.service-now.com/api/now/table/incident';
const HEADERS = { Authorization: 'Bearer ovn-a-token', 'X-Other': 'kept' };

test.describe('Custom webhook destination keeps its Authorization header on edit (#15951)', {
  tag: ['@alerts', '@destinations', '@regression', '@all'],
}, () => {
  test.describe.configure({ mode: 'serial' });
  let templateName;
  let destName;

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    await navigateToBase(page);
    templateName = uniqueName('ovn_a_15951_tmpl');
    destName = uniqueName('ovn_a_15951_dest');
    const tmpl = await createHttpTemplate(page, templateName, '{"text":"{alert_name}"}');
    expect(tmpl.ok(), await tmpl.text()).toBe(true);
    const dest = await createHttpDestination(page, { name: destName, url: SERVICENOW_URL, template: templateName, headers: HEADERS });
    expect(dest.ok(), await dest.text()).toBe(true);
  });

  test.afterEach(async ({ page }) => {
    await deleteDestination(page, destName);
    await deleteTemplate(page, templateName);
  });

  test('the edit form shows both header rows and saving keeps Authorization', { tag: ['@bug-15951', '@P0'] }, async ({ page }) => {
    const pm = new PageManager(page);
    await pm.alertDestinationsPage.navigateToDestinations();
    await pm.alertDestinationsPage.waitForDestinationListReady();
    await pm.alertDestinationsPage.clickEditDestination(destName);

    await pm.alertDestinationsPage.expectHeaderRow('Authorization', HEADERS.Authorization);
    await pm.alertDestinationsPage.expectHeaderRow('X-Other', HEADERS['X-Other']);

    const saved = page.waitForResponse((r) => isDestinationUpdate(r, destName));
    await pm.alertDestinationsPage.clickSave();
    expect((await saved).status()).toBe(200);

    const stored = await getDestination(page, destName);
    expect(stored.headers).toMatchObject(HEADERS);
    expect(stored.type).toBe('http');
  });
});
