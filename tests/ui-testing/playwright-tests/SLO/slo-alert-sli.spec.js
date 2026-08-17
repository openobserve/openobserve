/**
 * SLO — the `alert` SLI type
 *
 * The third SLI shape, and the only one whose source is another object rather
 * than a query. Its SLI is "was the source alert at level Ok", so the SLO can
 * only measure time the source was actually evaluating — which is why the
 * server is strict about what may be a source at all.
 *
 * `source_alert_ineligibility` (config/src/meta/slo/mod.rs) rejects a source
 * that is an SLO alert or composite, not scheduled, grouped, cron-driven,
 * silence-gated, or whose frequency exceeds the SLO's slice interval. The
 * fixture builds one that satisfies every clause and ASSERTS the server agrees
 * before any test runs, so an eligibility drift fails as a fixture error rather
 * than as an inexplicably empty picker.
 *
 * Ineligible alerts are deliberately still listed, disabled and carrying the
 * server's reason — "your alert is not here" is a worse answer than "here is
 * why you cannot pick it" — and that is asserted too.
 */

const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const PageManager = require('../../pages/page-manager.js');
const {
  seedMinimalStream,
  seedNotificationDestination,
  seedEligibleSourceAlert,
  createSloViaApi,
  countDefinition,
  deleteSlosByPrefix,
  deleteFixturesByPrefix,
  uniqueName,
} = require('../utils/slo-seed.js');

const PREFIX = 'e2e_slo_alertsli';
const ORG = process.env['ORGNAME'];
const workerPrefix = (testInfo) => `${PREFIX}_w${testInfo.workerIndex}`;

test.describe.configure({ mode: 'serial' });

test.describe('SLO alert SLI', { tag: ['@slo', '@sloAlertSli', '@all'] }, () => {
  let pm;
  const shared = { destination: null, source: null, stream: null };

  test.beforeAll(async ({ browser }, testInfo) => {
    test.setTimeout(5 * 60 * 1000);
    const context = await browser.newContext();
    const page = await context.newPage();

    const base = uniqueName(workerPrefix(testInfo));
    shared.destination = await seedNotificationDestination(page, base);
    shared.source = await seedEligibleSourceAlert(page, base, shared.destination);
    shared.stream = uniqueName(`${workerPrefix(testInfo)}_stream`);
    await seedMinimalStream(page, shared.stream, { records: 30 });

    testLogger.info('Alert-SLI fixtures ready', { source: shared.source.name });
    await context.close();
  });

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    await navigateToBase(page);
    pm = new PageManager(page);
  });

  test.afterAll(async ({ browser }, testInfo) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await deleteSlosByPrefix(page, `${workerPrefix(testInfo)}_`).catch(() => {});
    // SLOs first (they may reference the destination), then everything else.
    await deleteFixturesByPrefix(page, `${workerPrefix(testInfo)}_`).catch(() => {});
    await context.close();
  });

  // ------------------------------------------------------------------- P0

  test('the alert SLI offers its source picker with a hint', {
    tag: ['@P0', '@smoke'],
  }, async () => {
    await pm.sloFormPage.gotoNew(ORG);
    await pm.sloFormPage.selectSliType('alert');

    await expect(
      pm.sloFormPage.page.locator(pm.sloFormPage.locators.alertSource),
    ).toBeVisible({ timeout: 20000 });
    await pm.sloFormPage.expectAlertSourceHintVisible();
  });

  /**
   * The whole point of the type: an SLO whose source is an alert.
   *
   * Saving proves the picker committed a real `alert_id` — `SliConfig::Alert`
   * carries exactly that one field, and the flat form model still holds the
   * stream keys the other SLI types use, so sending those would be a 422.
   */
  test('creates an alert-sourced SLO through the form', {
    tag: ['@P0', '@smoke'],
  }, async ({}, testInfo) => {
    const name = uniqueName(workerPrefix(testInfo));

    await pm.sloFormPage.gotoNew(ORG);
    await pm.sloFormPage.setName(name);
    await pm.sloFormPage.selectSliType('alert');
    await pm.sloFormPage.selectAlertSource(shared.source.alertId, shared.source.name);
    await pm.sloFormPage.setTarget(99);
    await pm.sloFormPage.selectWindow(604800);
    await pm.sloFormPage.selectSlice(300);
    await pm.sloFormPage.saveExpectingSuccess();

    await pm.sloListPage.goto(ORG);
    await pm.sloListPage.expectRowVisible(name);
  });

  test('the stored definition carries only the alert id', {
    tag: ['@P0'],
  }, async ({}, testInfo) => {
    const name = uniqueName(workerPrefix(testInfo));
    await pm.sloFormPage.gotoNew(ORG);
    await pm.sloFormPage.setName(name);
    await pm.sloFormPage.selectSliType('alert');
    await pm.sloFormPage.selectAlertSource(shared.source.alertId, shared.source.name);
    await pm.sloFormPage.saveExpectingSuccess();

    await pm.sloListPage.goto(ORG);
    await pm.sloListPage.openRow(name);
    await pm.sloDetailPage.openTab('config');

    const stored = await pm.sloDetailPage.readConfigJson();
    const asText = JSON.stringify(stored);
    expect(asText).toContain(shared.source.alertId);
    // The other SLI types' keys must not ride along — `SliConfig::Alert` has
    // exactly one field, and a spare key is a 422.
    expect(asText, 'an alert config must not carry stream keys').not.toContain('good_expr');
  });

  // ------------------------------------------------------------------- P1

  /**
   * An alert-sourced SLO names its source on the detail page, and shows the
   * availability ribbon: for this SLI the first question is whether the source
   * was running at all, and the ribbon is the only place that answer lives.
   */
  test('detail view names the source alert', {
    tag: ['@P1'],
  }, async ({}, testInfo) => {
    const name = uniqueName(workerPrefix(testInfo));
    await pm.sloFormPage.gotoNew(ORG);
    await pm.sloFormPage.setName(name);
    await pm.sloFormPage.selectSliType('alert');
    await pm.sloFormPage.selectAlertSource(shared.source.alertId, shared.source.name);
    await pm.sloFormPage.saveExpectingSuccess();

    await pm.sloListPage.goto(ORG);
    await pm.sloListPage.openRow(name);
    await pm.sloDetailPage.expectDetailVisible();
    await pm.sloDetailPage.expectSourceAlertVisible();
  });

  /**
   * An ineligible source is LISTED but not selectable, with the server's reason
   * folded into its label.
   *
   * A silence-gated alert is used because it violates exactly one clause, so a
   * failure here points at that clause rather than at any of the other five.
   */
  test('an ineligible alert is offered but cannot be chosen', {
    tag: ['@P1', '@validation'],
  }, async ({ page }, testInfo) => {
    const { getAuthHeaders, getOrgIdentifier } = require('../utils/cloud-auth.js');
    const base = (process.env.INGESTION_URL || process.env.ZO_BASE_URL || '').replace(/\/$/, '');
    const org = getOrgIdentifier();

    // Same shape as the eligible fixture, but silence-gated.
    const name = uniqueName(`${workerPrefix(testInfo)}_gated`);
    // Reuse the module's stream rather than seeding another: eligibility is
    // decided from the alert's OWN fields, so the source stream needs to exist
    // but not to contain anything in particular.
    const srcStream = shared.stream;

    const res = await page.request.post(`${base}/api/v2/${org}/alerts?folder=default`, {
      headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
      data: {
        name,
        stream_type: 'logs',
        stream_name: srcStream,
        is_real_time: false,
        query_condition: {
          type: 'custom',
          conditions: {
            version: 2,
            conditions: { filterType: 'group', logicalOperator: 'AND', conditions: [] },
          },
          sql: null, promql: null, promql_condition: null, aggregation: null,
          vrl_function: null, search_event_type: null, multi_time_range: [],
        },
        trigger_condition: {
          period: 5, operator: '>=', threshold: 1,
          frequency: 5, frequency_type: 'minutes', cron: '',
          silence: 30, // the single disqualifying field
          timezone: 'UTC', align_time: true,
        },
        destinations: [shared.destination],
        context_attributes: {}, row_template: '', enabled: true,
      },
    });
    expect(res.ok(), `could not create the gated alert: ${await res.text()}`).toBe(true);
    const gatedId = (await res.json()).id;

    // The server must agree it is ineligible, otherwise this asserts nothing.
    const listed = await page.request.get(`${base}/api/${org}/alerts/slo-eligible`, {
      headers: getAuthHeaders(),
    });
    const body = await listed.json();
    const rows = Array.isArray(body) ? body : (body.list ?? []);
    const row = rows.find((a) => a.alert_id === gatedId);
    expect(row, 'the gated alert must still be LISTED, not filtered out').toBeTruthy();
    expect(row.eligible, 'a silence-gated alert must be ineligible').toBe(false);
    expect(row.reason, 'the server must say WHY it cannot be used').toBeTruthy();

    // And the form must present it that way: visible, disabled, reason shown.
    await pm.sloFormPage.gotoNew(ORG);
    await pm.sloFormPage.selectSliType('alert');
    await pm.sloFormPage.expectAlertSourceOptionDisabled(gatedId, name);
  });

  /**
   * An alert SLI cannot be grouped: the SLI is the source alert's level, and a
   * single alert has one level — there is nothing to group BY.
   */
  test('an alert SLI SLO cannot be saved with a group-by', {
    tag: ['@P1', '@validation', '@negative'],
  }, async ({ page }, testInfo) => {
    const { getAuthHeaders, getOrgIdentifier } = require('../utils/cloud-auth.js');
    const base = (process.env.INGESTION_URL || process.env.ZO_BASE_URL || '').replace(/\/$/, '');

    const res = await page.request.post(`${base}/api/${getOrgIdentifier()}/slos`, {
      headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
      data: {
        name: uniqueName(workerPrefix(testInfo)),
        description: 'grouped alert sli',
        sli_type: 'alert',
        config: { alert_id: shared.source.alertId },
        group_by: ['service'],
        groups_estimate: 3,
        window_secs: 604800,
        slice_interval_secs: 300,
        target: 99,
        tags: [],
        enabled: true,
      },
    });
    expect(
      res.status(),
      `a grouped alert SLI should be refused, got ${res.status()}: ${await res.text()}`,
    ).toBeGreaterThanOrEqual(400);
  });

  /**
   * The SLO's slice interval bounds how infrequent its source may be: a source
   * evaluated less often than once per slice leaves slices unmeasured. The
   * fixture's source runs every 300s, so a 60s-slice SLO must be refused.
   */
  test('a slice finer than the source cadence is refused', {
    tag: ['@P1', '@validation', '@negative'],
  }, async ({ page }, testInfo) => {
    const { getAuthHeaders, getOrgIdentifier } = require('../utils/cloud-auth.js');
    const base = (process.env.INGESTION_URL || process.env.ZO_BASE_URL || '').replace(/\/$/, '');

    const res = await page.request.post(`${base}/api/${getOrgIdentifier()}/slos`, {
      headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
      data: {
        name: uniqueName(workerPrefix(testInfo)),
        description: 'too fine a slice',
        sli_type: 'alert',
        config: { alert_id: shared.source.alertId },
        group_by: null,
        groups_estimate: null,
        window_secs: 604800,
        // The source fires every 300s; a 60s slice cannot be measured from it.
        slice_interval_secs: 60,
        target: 99,
        tags: [],
        enabled: true,
      },
    });
    expect(
      res.status(),
      `a 60s slice over a 300s source should be refused, got ${res.status()}`,
    ).toBeGreaterThanOrEqual(400);
  });

  test('an alert SLI SLO appears under the alert type filter', {
    tag: ['@P2'],
  }, async ({ page }, testInfo) => {
    const name = uniqueName(workerPrefix(testInfo));
    await createSloViaApi(page, {
      name,
      description: 'alert sli',
      sli_type: 'alert',
      config: { alert_id: shared.source.alertId },
      group_by: null,
      groups_estimate: null,
      window_secs: 604800,
      slice_interval_secs: 300,
      target: 99,
      tags: ['e2e'],
      enabled: true,
    });

    await pm.sloListPage.goto(ORG);
    await pm.sloListPage.expectRowVisible(name);
    await pm.sloListPage.filterByType('alert');
    await pm.sloListPage.expectRowVisible(name);
  });
});
