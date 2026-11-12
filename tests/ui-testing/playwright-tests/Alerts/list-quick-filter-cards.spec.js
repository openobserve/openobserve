// Copyright 2026 OpenObserve Inc.

const { randomUUID } = require('crypto');
const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const PageManager = require('../../pages/page-manager.js');

// Quick filter cards (#16553). Alerts count one folder; Pipelines and Public links count the
// whole org, so their expected numbers are read from the API and the shard must not create either.
test.describe.configure({ mode: 'parallel' });

test.describe('List quick filter cards', { tag: ['@quickFilterCards', '@all'] }, () => {
  let pm;
  let created;

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    created = { folderId: null, alertSeed: null, pipelines: null, dashboard: null, links: [] };
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
    }
    if (created.pipelines) {
      await pm.apiCleanup.deletePipelinesByName(created.pipelines.pipelines.map((p) => p.name));
      for (const stream of created.pipelines.streams) await pm.apiCleanup.deleteStream(stream);
    }
    for (const link of created.links) await pm.apiCleanup.deletePublicLink(link.dashboardId, link.id);
    if (created.dashboard) await pm.apiCleanup.deleteDashboard(created.dashboard.dashboardId, created.dashboard.folderId);
  });

  test('QFC-01 alert cards count the folder by state and filter the rows', { tag: ['@P1'] }, async () => {
    const seed = `e2e_qfc_alerts_${Date.now()}_${randomUUID().slice(0, 8)}`;
    const folder = await pm.apiCleanup.createAlertFolder(seed);
    created.folderId = folder.folderId;
    created.alertSeed = {};
    const seeded = await pm.apiCleanup.seedAlertsInFolder(folder.folderId, 3, seed, { enabledCount: 2, sink: created.alertSeed });
    const [active1, active2, paused] = seeded.alerts.map((a) => a.name);
    const qfc = pm.quickFilterCardsPage;

    await pm.alertsPage.gotoAlertListFolder(folder.folderId);
    const counts = { failed: 0, firing: 0, acknowledged: 0, recent: 0, active: 2, paused: 1, total: 3 };
    for (const [key, count] of Object.entries(counts)) await qfc.expectCardCount('alerts', key, count);
    await qfc.expectRows('alerts', { count: 3, shown: [active1, active2, paused] });
    await qfc.expectCardSelected('alerts', 'total', true);

    await qfc.clickCard('alerts', 'active');
    await qfc.expectCardSelected('alerts', 'active', true);
    await qfc.expectCardSelected('alerts', 'total', false);
    await qfc.expectRows('alerts', { count: 2, shown: [active1, active2], hidden: [paused] });
    // Counts are folder totals, so a filter must not shrink the other cards.
    await qfc.expectCardCount('alerts', 'paused', 1);
    await qfc.expectCardCount('alerts', 'total', 3);

    await qfc.clickCard('alerts', 'active');
    await qfc.expectCardSelected('alerts', 'active', false);
    await qfc.expectCardSelected('alerts', 'total', true);
    await qfc.expectRows('alerts', { count: 3, shown: [active1, active2, paused] });

    await qfc.clickCard('alerts', 'paused');
    await qfc.expectCardSelected('alerts', 'paused', true);
    await qfc.expectRows('alerts', { count: 1, shown: [paused], hidden: [active1, active2] });

    await qfc.clickCard('alerts', 'firing');
    await qfc.expectCardSelected('alerts', 'firing', true);
    await qfc.expectCardSelected('alerts', 'paused', false);
    await qfc.expectRows('alerts', { count: 0, hidden: [active1, active2, paused] });

    await qfc.clickCard('alerts', 'total');
    await qfc.expectCardSelected('alerts', 'firing', false);
    await qfc.expectCardSelected('alerts', 'total', true);
    await qfc.expectRows('alerts', { count: 3, shown: [active1, active2, paused] });
  });

  test('QFC-02 pipeline cards count the org by state and filter the rows', { tag: ['@P1'] }, async () => {
    const seed = `e2e_qfc_pipes_${Date.now()}_${randomUUID().slice(0, 8)}`;
    created.pipelines = { pipelines: [], streams: [] };
    await pm.apiCleanup.seedPipelinesMix(seed, 2, 1, created.pipelines);
    const [active1, active2, paused] = created.pipelines.pipelines.map((p) => p.name);
    const expected = await pm.apiCleanup.pipelineNamesByState();
    expect(expected.active, 'seeded enabled pipelines read back as active').toEqual(expect.arrayContaining([active1, active2]));
    expect(expected.paused, 'seeded disabled pipeline reads back as paused').toContain(paused);
    const qfc = pm.quickFilterCardsPage;

    await qfc.gotoPipelines();
    for (const key of ['errored', 'paused', 'active', 'total']) {
      await qfc.expectCardCount('pipelines', key, expected[key].length);
    }
    await qfc.expectRows('pipelines', { count: expected.total.length, shown: [active1, active2, paused] });
    await qfc.expectCardSelected('pipelines', 'total', true);

    await qfc.clickCard('pipelines', 'active');
    await qfc.expectCardSelected('pipelines', 'active', true);
    await qfc.expectCardSelected('pipelines', 'total', false);
    await qfc.expectRows('pipelines', { count: expected.active.length, shown: [active1, active2], hidden: [paused] });
    await qfc.expectCardCount('pipelines', 'total', expected.total.length);

    await qfc.clickCard('pipelines', 'active');
    await qfc.expectCardSelected('pipelines', 'active', false);
    await qfc.expectCardSelected('pipelines', 'total', true);
    await qfc.expectRows('pipelines', { count: expected.total.length, shown: [active1, active2, paused] });

    await qfc.clickCard('pipelines', 'paused');
    await qfc.expectCardSelected('pipelines', 'paused', true);
    await qfc.expectRows('pipelines', { count: expected.paused.length, shown: [paused], hidden: [active1, active2] });

    await qfc.clickCard('pipelines', 'total');
    await qfc.expectCardSelected('pipelines', 'paused', false);
    await qfc.expectCardSelected('pipelines', 'total', true);
    await qfc.expectRows('pipelines', { count: expected.total.length, shown: [active1, active2, paused] });
  });

  test('QFC-03 public link cards count the org by status and filter the rows', { tag: ['@P1'] }, async () => {
    const seed = `e2e_qfc_links_${Date.now()}_${randomUUID().slice(0, 8)}`;
    created.dashboard = await pm.apiCleanup.createMinimalDashboard(`${seed}_dash`);
    const dash = created.dashboard.dashboardId;
    const unseen1 = await pm.apiCleanup.createPublicLink(dash, `${seed}_unseen1`);
    created.links.push(unseen1);
    const unseen2 = await pm.apiCleanup.createPublicLink(dash, `${seed}_unseen2`);
    created.links.push(unseen2);
    const paused = await pm.apiCleanup.createPublicLink(dash, `${seed}_paused`);
    created.links.push(paused);
    await pm.apiCleanup.pausePublicLink(dash, paused.id);
    // The server refuses a past expiry, so the link is created close to it and waited on.
    const expired = await pm.apiCleanup.createPublicLink(dash, `${seed}_expired`, { expiresAt: (Date.now() + 15000) * 1000 });
    created.links.push(expired);
    await expect.poll(() => pm.apiCleanup.publicLinkStatus(expired.id), { timeout: 60000, intervals: [2000] }).toBe('expired');

    const expected = await pm.apiCleanup.publicLinkIdsByStatus();
    // Only the querier knows when a live link needs attention, so live links would make that card unpredictable.
    expect(expected.live, 'org must hold no live public links').toEqual([]);
    expect(expected.not_viewed).toEqual(expect.arrayContaining([unseen1.id, unseen2.id]));
    expect(expected.paused).toContain(paused.id);
    expect(expected.expired).toContain(expired.id);
    const ids = [unseen1.id, unseen2.id, paused.id, expired.id];
    const qfc = pm.quickFilterCardsPage;

    await qfc.gotoPublicLinks();
    await qfc.expectCardCount('publicLinks', 'live', 0);
    await qfc.expectCardCount('publicLinks', 'not-viewed', expected.not_viewed.length);
    await qfc.expectCardCount('publicLinks', 'paused', expected.paused.length);
    await qfc.expectCardCount('publicLinks', 'attention', 0);
    await qfc.expectCardCount('publicLinks', 'expired', expected.expired.length);
    await qfc.expectCardCount('publicLinks', 'all', expected.all.length);
    await qfc.expectRows('publicLinks', { count: expected.all.length, shown: ids });
    await qfc.expectCardSelected('publicLinks', 'all', true);

    await qfc.clickCard('publicLinks', 'not-viewed');
    await qfc.expectCardSelected('publicLinks', 'not-viewed', true);
    await qfc.expectCardSelected('publicLinks', 'all', false);
    await qfc.expectRows('publicLinks', { count: expected.not_viewed.length, shown: [unseen1.id, unseen2.id], hidden: [paused.id, expired.id] });
    await qfc.expectCardCount('publicLinks', 'all', expected.all.length);

    await qfc.clickCard('publicLinks', 'paused');
    await qfc.expectCardSelected('publicLinks', 'paused', true);
    await qfc.expectRows('publicLinks', { count: expected.paused.length, shown: [paused.id], hidden: [unseen1.id, unseen2.id, expired.id] });

    await qfc.clickCard('publicLinks', 'expired');
    await qfc.expectCardSelected('publicLinks', 'expired', true);
    await qfc.expectRows('publicLinks', { count: expected.expired.length, shown: [expired.id], hidden: [unseen1.id, unseen2.id, paused.id] });

    await qfc.clickCard('publicLinks', 'all');
    await qfc.expectCardSelected('publicLinks', 'expired', false);
    await qfc.expectCardSelected('publicLinks', 'all', true);
    await qfc.expectRows('publicLinks', { count: expected.all.length, shown: ids });
  });
});
