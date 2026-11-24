// Copyright 2026 OpenObserve Inc.
// openobserve#16811: the incident Alert Graph lays alerts out in firing order, flags the first, ends in a team lane and opens a side panel.
const { randomUUID } = require('crypto');
const { test, expect, navigateToBase } = require('../../utils/enhanced-baseFixtures.js');
const testLogger = require('../../utils/test-logger.js');
const PageManager = require('../../../pages/page-manager.js');
const { api, urls } = require('../../utils/alerts-api-helpers.js');
const { readOrgConfig, resolveIncident } = require('../../utils/regression-alert-fixtures.js');

const iso = (msAgo) => new Date(Date.now() - msAgo).toISOString().replace(/\.\d{3}Z$/, 'Z');

const alertmanagerBody = (alerts) => ({
  version: '4', status: 'firing', receiver: 'o2', groupLabels: {}, commonLabels: {}, commonAnnotations: {},
  externalURL: 'http://am.test.invalid',
  alerts: alerts.map(({ name, service, startsAt }) => ({
    status: 'firing', labels: { alertname: name, service, severity: 'critical' }, annotations: {},
    startsAt, endsAt: '0001-01-01T00:00:00Z', generatorURL: 'http://am.test.invalid/graph',
    fingerprint: randomUUID().replace(/-/g, '').slice(0, 16),
  })),
});

test.describe('Incident Alert Graph shows how the incident unfolded (#16811)', {
  tag: ['@incidents', '@enterprise', '@regression', '@incidentsRegression'],
}, () => {
  let pm;
  const created = { integrationId: null, incidentId: null };

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    await navigateToBase(page);
    pm = new PageManager(page);
    const config = await readOrgConfig(page);
    expect(config.incidents_enabled, 'incidents must be enabled on this server; this spec runs only in the ENT overlay').toBe(true);
  });

  test.afterEach(async ({ page }) => {
    if (created.incidentId) await resolveIncident(page, created.incidentId);
    if (created.integrationId) await api(page, 'delete', `${urls().v2}/incidents/integrations/${created.integrationId}`);
    created.integrationId = null;
    created.incidentId = null;
  });

  test('two external alerts unfold in firing order with the first flagged, a team lane and a side panel', { tag: ['@bug-16811', '@P2'] }, async ({ page }) => {
    const seed = `e2e_16811_${Date.now()}_${randomUUID().slice(0, 6)}`;
    const integration = await api(page, 'post', `${urls().v2}/incidents/integrations`, {
      name: seed, source_type: 'alertmanager', destinations: [],
    });
    expect(integration.status(), await integration.text()).toBe(200);
    const { id, url } = await integration.json();
    created.integrationId = id;

    const first = `${seed}_first`;
    const second = `${seed}_second`;
    const service = `${seed}_svc`;
    const base = urls().v2.replace(/\/api\/v2\/.*$/, '');
    const posted = await api(page, 'post', `${base}${url}`, alertmanagerBody([
      { name: first, service, startsAt: iso(3 * 60 * 1000) },
      { name: second, service, startsAt: iso(60 * 1000) },
    ]));
    expect(posted.status(), await posted.text()).toBe(202);

    const list = await api(page, 'get', `${urls().v2}/alerts/incidents?limit=50`);
    expect(list.status()).toBe(200);
    const incident = ((await list.json()).incidents || []).find((i) => (i.title || '').startsWith(first));
    expect(incident, 'the two alerts must open one incident titled by the first').toBeTruthy();
    created.incidentId = incident.id;
    expect(incident.alert_count).toBe(2);
    const detail = await (await api(page, 'get', `${urls().v2}/alerts/incidents/${incident.id}`)).json();
    const idOf = (name) => detail.triggers.find((t) => t.alert_name === name).alert_id;
    const firstCard = `alert-${idOf(first)}`;
    const secondCard = `alert-${idOf(second)}`;

    await pm.incidentsPage.gotoDetail(incident.id);
    await pm.incidentsPage.openAlertGraph();
    await pm.incidentsPage.expectUnfoldCardTitle(firstCard, first);
    await pm.incidentsPage.expectUnfoldCardTitle(secondCard, second);
    await pm.incidentsPage.expectUnfoldCardTag(firstCard, 'First to fire');
    await pm.incidentsPage.expectUnfoldCardTag(secondCard, null);
    expect(await pm.incidentsPage.unfoldCardIsLeftOf(firstCard, secondCard)).toBe(true);
    await pm.incidentsPage.expectUnfoldCardTitle('team-open', 'Still open');

    await pm.incidentsPage.openUnfoldCard(secondCard);
    await pm.incidentsPage.expectAlertPanel(second, 'Fired once');
  });
});
