// Copyright 2026 OpenObserve Inc.

const { test, expect, navigateToBase } = require('../../utils/enhanced-baseFixtures.js');
const testLogger = require('../../utils/test-logger.js');
const PageManager = require('../../../pages/page-manager.js');
const { api, baseUrl, orgId, uniqueName } = require('../../utils/oncall-seed.js');

// A ServiceNow-shaped URL is what made the edit form open as prebuilt and drop the header.
const SERVICENOW_URL = 'https://ovn-a.service-now.com/api/now/table/incident';
const HEADERS = { Authorization: 'Bearer ovn-a-token', 'X-Other': 'kept' };

test.describe('Custom webhook destination keeps its Authorization header on edit (#15951)', {
  tag: ['@alerts', '@destinations', '@regression', '@all'],
}, () => {
  test.describe.configure({ mode: 'serial' });
  const v1 = () => `${baseUrl()}/api/${orgId()}`;
  let templateName;
  let destName;

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    await navigateToBase(page);
    templateName = uniqueName('ovn_a_15951_tmpl');
    destName = uniqueName('ovn_a_15951_dest');
    const tmpl = await api(page, 'post', `${v1()}/alerts/templates`, { name: templateName, type: 'http', title: '', body: '{"text":"{alert_name}"}' });
    expect(tmpl.ok(), await tmpl.text()).toBe(true);
    const dest = await api(page, 'post', `${v1()}/alerts/destinations`, {
      name: destName, url: SERVICENOW_URL, method: 'post', type: 'http', skip_tls_verify: false,
      template: templateName, headers: HEADERS,
    });
    expect(dest.ok(), await dest.text()).toBe(true);
  });

  test.afterEach(async ({ page }) => {
    await api(page, 'delete', `${v1()}/alerts/destinations/${destName}`);
    await api(page, 'delete', `${v1()}/alerts/templates/${templateName}`);
  });

  test('the edit form shows both header rows and saving keeps Authorization', { tag: ['@bug-15951', '@P0'] }, async ({ page }) => {
    const pm = new PageManager(page);
    await pm.alertDestinationsPage.navigateToDestinations();
    await pm.alertDestinationsPage.waitForDestinationListReady();
    await pm.alertDestinationsPage.clickEditDestination(destName);

    await pm.alertDestinationsPage.expectHeaderRow('Authorization', HEADERS.Authorization);
    await pm.alertDestinationsPage.expectHeaderRow('X-Other', HEADERS['X-Other']);

    const saved = page.waitForResponse((r) => r.request().method() === 'PUT' && r.url().includes(`/alerts/destinations/${destName}`));
    await pm.alertDestinationsPage.clickSave();
    expect((await saved).status()).toBe(200);

    const stored = await (await api(page, 'get', `${v1()}/alerts/destinations/${destName}`)).json();
    expect(stored.headers).toMatchObject(HEADERS);
    expect(stored.type).toBe('http');
  });
});
