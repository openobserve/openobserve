// Copyright 2026 OpenObserve Inc.

const { randomUUID } = require('crypto');
const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const PageManager = require('../../pages/page-manager.js');
const { api, urls, ingest, simpleAlert } = require('../utils/alerts-api-helpers.js');
const { waitFiring } = require('../utils/alert-ack-mute-helpers.js');

test.describe('Alerts list opens on the Firing tile (#16884)', {
  tag: ['@alerts', '@quickFilterCards', '@all'],
}, () => {
  let pm;
  let created;

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    created = { folderId: null, alertSeed: null };
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
    if (created.alertSeed) {
      await pm.apiCleanup.deleteAlertDestination(created.alertSeed.destinationName);
      await pm.apiCleanup.deleteAlertTemplate(created.alertSeed.templateName);
      await pm.apiCleanup.deleteStream(created.alertSeed.streamName);
      if (created.alertSeed.firingStream) await pm.apiCleanup.deleteStream(created.alertSeed.firingStream);
    }
  });

  test('a fresh Alerts visit opens on Firing; nothing firing offers Show all alerts', { tag: ['@P1'] }, async ({ page }) => {
    test.setTimeout(6 * 60 * 1000);
    const seed = `e2e_qfc_firing_${Date.now()}_${randomUUID().slice(0, 8)}`;
    const folder = await pm.apiCleanup.createAlertFolder(seed);
    created.folderId = folder.folderId;
    created.alertSeed = {};
    const seeded = await pm.apiCleanup.seedAlertsInFolder(folder.folderId, 2, seed, { sink: created.alertSeed });
    const quiet = seeded.alerts.map((a) => a.name);
    const qfc = pm.quickFilterCardsPage;

    await qfc.gotoAlertsFolderUnfiltered(folder.folderId);
    await qfc.expectCardSelected('alerts', 'firing', true);
    await qfc.expectCardSelected('alerts', 'total', false);
    await qfc.expectAlertsNoFiringEmptyState();
    await qfc.expectRows('alerts', { count: 0, hidden: quiet });
    await qfc.showAllAlertsFromEmptyState();
    await qfc.expectCardSelected('alerts', 'total', true);
    await qfc.expectRows('alerts', { count: 2, shown: quiet });

    const firing = { name: `${seed}_fires`, stream: `${seed}_fires_s`, folder: folder.folderId };
    firing.feed = () => ingest(page, firing.stream, [{ i: 1 }, { i: 2 }, { i: 3 }]);
    created.alertSeed.firingStream = firing.stream;
    await firing.feed();
    const payload = Object.assign(simpleAlert(firing.name), {
      stream_name: firing.stream,
      destinations: [created.alertSeed.destinationName],
    });
    Object.assign(payload.trigger_condition, { frequency: 1, period: 1, threshold: 1, silence: 0 });
    const resp = await api(page, 'post', `${urls().v2}/alerts?folder=${folder.folderId}`, payload);
    expect(resp.status(), await resp.text()).toBe(200);
    await waitFiring(page, firing);

    await qfc.gotoAlertsFolderUnfiltered(folder.folderId);
    await qfc.expectCardSelected('alerts', 'firing', true);
    await qfc.expectRows('alerts', { count: 1, shown: [firing.name], hidden: quiet });
  });
});
