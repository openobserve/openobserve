// Copyright 2026 OpenObserve Inc.

const { randomUUID } = require('crypto');
const { test, expect, navigateToBase } = require('../../utils/enhanced-baseFixtures.js');
const testLogger = require('../../utils/test-logger.js');
const PageManager = require('../../../pages/page-manager.js');
const { api, urls, simpleAlert } = require('../../utils/alerts-api-helpers.js');

test.describe('Template form shows the server reason under Applies to (#16697)', {
  tag: ['@alerts', '@templates', '@regression', '@all'],
}, () => {
  let pm;
  let created;

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    created = { folderId: null, seed: null, template: null };
    await navigateToBase(page);
    pm = new PageManager(page);
  });

  test.afterEach(async () => {
    if (created.folderId) {
      for (const alert of await pm.apiCleanup.fetchAlertsInFolder(created.folderId)) {
        await pm.apiCleanup.deleteAlert(alert.alert_id, created.folderId);
      }
      await pm.apiCleanup.deleteFolder(created.folderId);
    }
    if (created.template) await pm.apiCleanup.deleteAlertTemplate(created.template);
    if (created.seed) {
      await pm.apiCleanup.deleteAlertDestination(created.seed.destinationName);
      await pm.apiCleanup.deleteAlertTemplate(created.seed.templateName);
      await pm.apiCleanup.deleteStream(created.seed.streamName);
    }
  });

  test('narrowing Applies to away from a kind an alert uses shows the refusal under the field', { tag: ['@bug-16697', '@P2'] }, async ({ page }) => {
    const seed = `e2e_16697_${Date.now()}_${randomUUID().slice(0, 8)}`;
    const folder = await pm.apiCleanup.createAlertFolder(seed);
    created.folderId = folder.folderId;
    created.seed = {};
    await pm.apiCleanup.seedAlertsInFolder(folder.folderId, 0, seed, { sink: created.seed });

    const templateName = `${seed}_override`;
    const tpl = await api(page, 'post', `${urls().v1}/alerts/templates`, {
      name: templateName, body: '{"text":"{alert_name}"}', type: 'http', title: '', applies_to: ['alert'],
    });
    expect(tpl.status(), await tpl.text()).toBe(200);
    created.template = templateName;

    const alertName = `${seed}_bound`;
    const payload = Object.assign(simpleAlert(alertName), {
      stream_name: created.seed.streamName,
      destinations: [created.seed.destinationName],
      template: templateName,
      enabled: false,
    });
    const alert = await api(page, 'post', `${urls().v2}/alerts?folder=${folder.folderId}`, payload);
    expect(alert.status(), await alert.text()).toBe(200);

    await pm.alertTemplatesPage.navigateToTemplates();
    await pm.alertTemplatesPage.waitForTemplateListReady();
    await pm.alertTemplatesPage.clickEditButton(templateName);
    await pm.alertTemplatesPage.expectAppliesToSelected(['alert']);
    await pm.alertTemplatesPage.toggleAppliesToKinds(['incident', 'alert']);
    await pm.alertTemplatesPage.expectAppliesToSelected(['incident']);

    expect(await pm.alertTemplatesPage.submitTemplateAndWaitForSave(templateName)).toBe(400);
    await pm.alertTemplatesPage.expectAppliesToError(['template is used for alert', `alert '${alertName}'`]);
    expect(await pm.alertTemplatesPage.templateAppliesToViaApi(templateName)).toEqual(['alert']);
  });
});
