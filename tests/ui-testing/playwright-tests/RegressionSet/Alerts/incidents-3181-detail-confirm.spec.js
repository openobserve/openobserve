// Copyright 2026 OpenObserve Inc.

const { test, expect, navigateToBase } = require('../../utils/enhanced-baseFixtures.js');
const testLogger = require('../../utils/test-logger.js');
const PageManager = require('../../../pages/page-manager.js');
const { uniqueName } = require('../../utils/oncall-seed.js');
const {
  incidentAlert, readOrgConfig, ingestLogs, deleteLogStream, createAlertInDefaultFolder, deleteAlertInDefaultFolder,
  findIncidentIdForAlert, incidentStatus, resolveIncident, isIncidentStatusUpdate,
} = require('../../utils/regression-alert-fixtures.js');

test.describe('Incident detail: Resolve and Reopen confirm before they act (ENT#3181)', {
  tag: ['@incidents', '@enterprise', '@regression', '@incidentsRegression'],
}, () => {
  test.describe.configure({ mode: 'serial' });
  const created = { stream: null, alertId: null, incidentId: null };

  test.beforeAll(async ({ browser }) => {
    const page = await browser.newPage();
    try {
      const config = await readOrgConfig(page);
      if (config.incidents_enabled !== true) return;
      created.stream = uniqueName('ovn_inc3181_s');
      const rows = [{ _timestamp: Date.now() * 1000, level: 'error', service_name: uniqueName('svc3181'), msg: 'seed' }];
      const ing = await ingestLogs(page, created.stream, rows);
      expect(ing.ok(), await ing.text()).toBe(true);
      const res = await createAlertInDefaultFolder(page, incidentAlert(uniqueName('ovn_inc3181'), created.stream));
      expect(res.ok(), await res.text()).toBe(true);
      created.alertId = (await res.json()).id;
      await expect.poll(async () => {
        created.incidentId = await findIncidentIdForAlert(page, created.alertId);
        return created.incidentId;
      }, { timeout: 240000, intervals: [5000], message: 'the alert must open an incident' }).not.toBeNull();
    } finally {
      await page.close();
    }
  });

  test.afterAll(async ({ browser }) => {
    const page = await browser.newPage();
    try {
      if (created.alertId) await deleteAlertInDefaultFolder(page, created.alertId);
      if (created.incidentId) await resolveIncident(page, created.incidentId);
      if (created.stream) await deleteLogStream(page, created.stream);
    } finally {
      await page.close();
    }
  });

  test('Resolve and Reopen each open a confirm and send nothing until confirmed', { tag: ['@bug-3181', '@P3'] }, async ({ page }, testInfo) => {
    test.skip(!created.incidentId, 'incidents are not enabled on this server');
    testLogger.testStart(testInfo.title, testInfo.file);
    await navigateToBase(page);
    const pm = new PageManager(page);
    const patches = [];
    page.on('request', (req) => {
      if (isIncidentStatusUpdate(req, created.incidentId)) patches.push(req.postData());
    });

    await pm.incidentsPage.gotoDetail(created.incidentId);
    await expect(pm.incidentsPage.statusAction('Resolve')).toBeVisible({ timeout: 30000 });

    await pm.incidentsPage.statusAction('Resolve').click();
    await pm.incidentsPage.expectConfirmDialog('Resolve incident?');
    expect(patches, 'opening the Resolve confirm must not send a status change').toHaveLength(0);
    await pm.incidentsPage.cancelConfirmDialog();
    expect(patches, 'cancelling the Resolve confirm must not send a status change').toHaveLength(0);
    expect(await incidentStatus(page, created.incidentId)).not.toBe('resolved');

    const resolved = page.waitForResponse((r) => isIncidentStatusUpdate(r.request(), created.incidentId));
    await pm.incidentsPage.statusAction('Resolve').click();
    await pm.incidentsPage.acceptConfirmDialog();
    expect((await resolved).status()).toBe(200);
    expect(patches).toHaveLength(1);
    await expect.poll(() => incidentStatus(page, created.incidentId), { timeout: 15000 }).toBe('resolved');

    await expect(pm.incidentsPage.statusAction('Reopen')).toBeVisible({ timeout: 15000 });
    await pm.incidentsPage.statusAction('Reopen').click();
    await pm.incidentsPage.expectConfirmDialog('Reopen incident?');
    expect(patches, 'opening the Reopen confirm must not send a status change').toHaveLength(1);
    await pm.incidentsPage.cancelConfirmDialog();
    expect(patches).toHaveLength(1);
    expect(await incidentStatus(page, created.incidentId)).toBe('resolved');

    const reopened = page.waitForResponse((r) => isIncidentStatusUpdate(r.request(), created.incidentId));
    await pm.incidentsPage.statusAction('Reopen').click();
    await pm.incidentsPage.acceptConfirmDialog();
    expect((await reopened).status()).toBe(200);
    expect(patches).toHaveLength(2);
    await expect.poll(() => incidentStatus(page, created.incidentId), { timeout: 15000 }).toBe('open');
  });
});
