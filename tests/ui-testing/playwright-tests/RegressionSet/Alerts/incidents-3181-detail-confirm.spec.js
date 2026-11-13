// Copyright 2026 OpenObserve Inc.

const { test, expect, navigateToBase } = require('../../utils/enhanced-baseFixtures.js');
const testLogger = require('../../utils/test-logger.js');
const PageManager = require('../../../pages/page-manager.js');
const { api, baseUrl, ingestUrl, orgId, uniqueName } = require('../../utils/oncall-seed.js');

const v2 = () => `${baseUrl()}/api/v2/${orgId()}`;

function incidentAlert(name, stream) {
  return {
    name, stream_type: 'logs', stream_name: stream, is_real_time: false,
    query_condition: {
      type: 'sql', conditions: null, promql: '', promql_condition: null,
      sql: `SELECT service_name, count(*) AS cnt FROM "${stream}" WHERE level = 'error' GROUP BY service_name`,
      search_event_type: 'ui', vrl_function: null, multi_time_range: [],
    },
    trigger_condition: {
      period: 30, operator: '>=', threshold: 1, frequency: 1, cron: '', silence: 0,
      frequency_type: 'minutes', timezone: 'UTC', tolerance_in_secs: 0,
    },
    destinations: [], enabled: true, description: 'ENT#3181 detail confirm',
    creates_incident: true, context_attributes: {}, row_template: '',
  };
}

async function incidentStatus(page, id) {
  const res = await api(page, 'get', `${v2()}/alerts/incidents/${id}`);
  const body = await res.json();
  return (body.incident || body).status;
}

test.describe('Incident detail: Resolve and Reopen confirm before they act (ENT#3181)', {
  tag: ['@incidents', '@enterprise', '@regression', '@incidentsRegression'],
}, () => {
  test.describe.configure({ mode: 'serial' });
  const created = { stream: null, alertId: null, incidentId: null };

  test.beforeAll(async ({ browser }) => {
    const page = await browser.newPage();
    try {
      const config = await (await api(page, 'get', `${baseUrl()}/api/${orgId()}/config`)).json();
      if (config.incidents_enabled !== true) return;
      created.stream = uniqueName('ovn_inc3181_s');
      const rows = [{ _timestamp: Date.now() * 1000, level: 'error', service_name: uniqueName('svc3181'), msg: 'seed' }];
      const ing = await api(page, 'post', `${ingestUrl()}/api/${orgId()}/${created.stream}/_json`, rows);
      expect(ing.ok(), await ing.text()).toBe(true);
      const res = await api(page, 'post', `${v2()}/alerts?folder=default`, incidentAlert(uniqueName('ovn_inc3181'), created.stream));
      expect(res.ok(), await res.text()).toBe(true);
      created.alertId = (await res.json()).id;
      await expect.poll(async () => {
        const list = await (await api(page, 'get', `${v2()}/alerts/incidents?limit=1000`)).json();
        const hit = (list.incidents || []).find((i) => (i.alert_groups || []).some((g) => g.alert_id === created.alertId));
        created.incidentId = hit ? hit.id : null;
        return created.incidentId;
      }, { timeout: 240000, intervals: [5000], message: 'the alert must open an incident' }).not.toBeNull();
    } finally {
      await page.close();
    }
  });

  test.afterAll(async ({ browser }) => {
    const page = await browser.newPage();
    try {
      if (created.alertId) await api(page, 'delete', `${v2()}/alerts/${created.alertId}?folder=default`);
      if (created.incidentId) await api(page, 'patch', `${v2()}/alerts/incidents/${created.incidentId}/update`, { status: 'resolved' });
      if (created.stream) await api(page, 'delete', `${baseUrl()}/api/${orgId()}/streams/${created.stream}?type=logs`);
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
      if (req.method() === 'PATCH' && req.url().includes(`/alerts/incidents/${created.incidentId}/update`)) patches.push(req.postData());
    });

    await pm.incidentsPage.gotoDetail(created.incidentId);
    await expect(pm.incidentsPage.statusAction('Resolve')).toBeVisible({ timeout: 30000 });

    await pm.incidentsPage.statusAction('Resolve').click();
    await pm.incidentsPage.expectConfirmDialog('Resolve incident?');
    expect(patches, 'opening the Resolve confirm must not send a status change').toHaveLength(0);
    await pm.incidentsPage.cancelConfirmDialog();
    expect(patches, 'cancelling the Resolve confirm must not send a status change').toHaveLength(0);
    expect(await incidentStatus(page, created.incidentId)).not.toBe('resolved');

    const resolved = page.waitForResponse((r) => r.request().method() === 'PATCH' && r.url().includes(`/alerts/incidents/${created.incidentId}/update`));
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

    const reopened = page.waitForResponse((r) => r.request().method() === 'PATCH' && r.url().includes(`/alerts/incidents/${created.incidentId}/update`));
    await pm.incidentsPage.statusAction('Reopen').click();
    await pm.incidentsPage.acceptConfirmDialog();
    expect((await reopened).status()).toBe(200);
    expect(patches).toHaveLength(2);
    await expect.poll(() => incidentStatus(page, created.incidentId), { timeout: 15000 }).toBe('open');
  });
});
