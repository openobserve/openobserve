// Copyright 2026 OpenObserve Inc.

const { test, expect, navigateToBase } = require('../../utils/enhanced-baseFixtures.js');
const testLogger = require('../../utils/test-logger.js');
const PageManager = require('../../../pages/page-manager.js');
const { api, baseUrl, ingestUrl, orgId, uniqueName } = require('../../utils/oncall-seed.js');

const HOUR_US = 3600 * 1_000_000;

function quietAlert(name, stream) {
  return {
    name, stream_type: 'logs', stream_name: stream, is_real_time: false,
    query_condition: {
      type: 'custom',
      conditions: { version: 2, conditions: { filterType: 'group', logicalOperator: 'AND', conditions: [] } },
      sql: null, promql: null, promql_condition: null, aggregation: null,
      vrl_function: null, search_event_type: null, multi_time_range: [],
    },
    trigger_condition: {
      period: 10, operator: '>=', threshold: 1000000, frequency: 60, cron: '',
      frequency_type: 'minutes', silence: 10, timezone: 'UTC', align_time: true,
    },
    destinations: [], context_attributes: {}, row_template: '', enabled: false,
  };
}

test.describe('Alert list: search survives a delete, and the list loads no long history (ENT#529, ENT#988)', {
  tag: ['@alerts', '@regression', '@all'],
}, () => {
  test.describe.configure({ mode: 'serial' });
  const term = uniqueName('ovn_a_529').toLowerCase();
  const names = [`${term}_one`, `${term}_two`];
  const created = { stream: null, ids: [] };
  const v2 = () => `${baseUrl()}/api/v2/${orgId()}`;

  test.beforeAll(async ({ browser }) => {
    const page = await browser.newPage();
    try {
      created.stream = uniqueName('ovn_a_529_s');
      const ing = await api(page, 'post', `${ingestUrl()}/api/${orgId()}/${created.stream}/_json`, [{ level: 'info', msg: 'seed' }]);
      expect(ing.ok(), await ing.text()).toBe(true);
      for (const name of names) {
        const res = await api(page, 'post', `${v2()}/alerts?folder=default`, quietAlert(name, created.stream));
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
      for (const id of created.ids) await api(page, 'delete', `${v2()}/alerts/${id}?folder=default`);
      if (created.stream) await api(page, 'delete', `${baseUrl()}/api/${orgId()}/streams/${created.stream}?type=logs`);
    } finally {
      await page.close();
    }
  });

  test('loading the alert list sends no alert-history request spanning more than 12 hours', { tag: ['@bug-988', '@P2'] }, async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    const spans = [];
    page.on('request', (req) => {
      const url = new URL(req.url());
      if (!/\/alerts\/history/.test(url.pathname)) return;
      const start = Number(url.searchParams.get('start_time'));
      const end = Number(url.searchParams.get('end_time'));
      spans.push({ url: req.url(), hours: start && end ? (end - start) / HOUR_US : null });
    });
    await navigateToBase(page);
    const pm = new PageManager(page);
    await pm.alertsPage.navigateToAlertsPage();
    await pm.alertsPage.searchAlert(term);
    await pm.alertsPage.expectAlertRowVisible(names[0], 20000);
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});

    testLogger.info('alert-history requests sent by the list', { count: spans.length });
    const long = spans.filter((s) => s.hours === null || s.hours > 12);
    expect(long, `alert-history requests from the list: ${JSON.stringify(spans)}`).toEqual([]);
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
