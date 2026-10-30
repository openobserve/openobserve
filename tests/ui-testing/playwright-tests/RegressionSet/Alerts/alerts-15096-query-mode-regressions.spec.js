// Copyright 2026 OpenObserve Inc.

/**
 * Alerts — the three bugs found while testing the Choose Query Mode dialog
 *
 *   #15096 — The dialog contradicted itself. An "Alert if" aggregation counts as
 *            Builder content for the lead ("Builder and SQL are both set up."),
 *            but the warning underneath was decided by filter conditions alone,
 *            so it still read "No filters, so every row in {stream} counts". Both
 *            cannot be true, and the warning was the false one: the alert fires
 *            on the aggregation, not on every row.
 *   #15097 — Switching a new alert to Realtime deleted any Compare-with-Past
 *            windows, and switching back did not restore them. The SQL text
 *            survived the same round trip, so the two inputs were treated
 *            inconsistently. The clear was never needed: getAlertPayload already
 *            forces `multi_time_range: []` for any non-SQL type.
 *   #15098 — Saving a metrics alert in PromQL mode deleted its stored SQL
 *            outright, while a Builder-mode save left it alone. The dialog says
 *            "SQL mode is not used", which reads as "kept but not evaluated" —
 *            what Builder does, not what PromQL did.
 *
 * The dialog itself is covered by Alerts/alerts-save-query-mode.spec.js, and the
 * edit-flow fixes from the same PR by alerts-15091-alert-edit-flow.spec.js.
 */

const { test, expect, navigateToBase } = require('../../utils/enhanced-baseFixtures.js');
const testLogger = require('../../utils/test-logger.js');
const PageManager = require('../../../pages/page-manager.js');
const { ensureMetricsIngested } = require('../../utils/shared-metrics-setup.js');
const {
  STREAM, DEST, uniq,
  simpleAlert, createAlert, findAlertId, getAlert,
  deleteAlertInFolder, seedAlertFixturesOnce,
} = require('../../utils/alerts-api-helpers.js');

// Created by ensureMetricsIngested(), the same stream alerts-metrics-notification uses.
const METRICS_STREAM = 'cpu_usage';

const STORED_SQL = `SELECT histogram(_timestamp) as ts, count(*) as cnt FROM "${STREAM}" WHERE status='CRITICAL' GROUP BY ts`;
const METRICS_SQL = `SELECT histogram(_timestamp) as ts, count(*) as cnt FROM "${METRICS_STREAM}" GROUP BY ts`;

/**
 * SQL selected, and Builder holding an aggregation but NO filter conditions.
 * Switching to Builder is what opens the dialog on this shape.
 */
function aggregationOnlyBuilderWithSql(name) {
  const a = simpleAlert(name);
  a.query_condition.type = 'sql';
  a.query_condition.sql = STORED_SQL;
  a.query_condition.aggregation = {
    group_by: [],
    function: 'avg',
    having: { column: 'latency', operator: '>=', value: 1 },
  };
  return a;
}

/** A metrics alert carrying PromQL, a Builder condition and a stored SQL query. */
function metricsAlertWithSql(name) {
  const a = simpleAlert(name);
  a.stream_type = 'metrics';
  a.stream_name = METRICS_STREAM;
  a.query_condition.type = 'promql';
  a.query_condition.promql = METRICS_STREAM;
  a.query_condition.promql_condition = { column: 'value', operator: '>=', value: 1 };
  a.query_condition.sql = METRICS_SQL;
  return a;
}

test.describe('Alerts — query-mode regressions (#15096, #15097, #15098)', {
  tag: ['@alerts', '@alertsQueryModeRegression', '@regression'],
}, () => {
  test.describe.configure({ mode: 'parallel' });

  let pm;
  let created = [];

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    pm = new PageManager(page);
    created = [];
    await seedAlertFixturesOnce(page);
    await navigateToBase(page);
  });

  test.afterEach(async ({ page }) => {
    for (const id of [...created].reverse()) {
      await deleteAlertInFolder(page, id, 'default');
    }
  });

  // Every fixture name carries the `auto_` prefix cleanup.spec.js sweeps.
  async function seed(page, payload) {
    const response = await createAlert(page, payload);
    expect(response.status(), await response.text()).toBe(200);
    const id = await findAlertId(page, payload.name);
    expect(id, `seeded alert ${payload.name} must be listable`).toBeTruthy();
    created.push(id);
    return id;
  }

  test('#15096 an aggregation with no filters is not called empty', async ({ page }) => {
    const id = await seed(page, aggregationOnlyBuilderWithSql(uniq('auto_qm_15096')));

    await pm.alertSaveQueryModePage.openEditor(id);
    // Switching the mode is what makes the dialog ask; an unchanged edit never does.
    await pm.alertSaveQueryModePage.selectQueryMode('custom');
    await pm.alertSaveQueryModePage.clickSave();
    await pm.alertSaveQueryModePage.expectDialogOpen();

    // The lead counts the aggregation as Builder content...
    await pm.alertSaveQueryModePage.expectLead('Builder and SQL are both set up.');
    await pm.alertSaveQueryModePage.expectSaveModeSelected('custom');
    // ...so the warning must not then call the same mode empty. Before the fix it
    // read "No filters, so every row in <stream> counts", which is both a
    // contradiction and untrue: the alert fires on avg(latency) >= 1.
    await pm.alertSaveQueryModePage.expectNoWarning();
    await pm.alertSaveQueryModePage.expectNote('Only Builder mode runs. SQL mode is not used.');

    await pm.alertSaveQueryModePage.confirmSaveMode();
    expect((await getAlert(page, id)).query_condition.type).toBe('custom');
  });

  test('#15097 a Realtime round trip keeps the Compare-with-Past windows', async ({ page }) => {
    await pm.alertSaveQueryModePage.openNewAlert();
    await pm.alertSaveQueryModePage.selectStream(STREAM);
    await pm.alertSaveQueryModePage.selectQueryMode('sql');

    await pm.alertSaveQueryModePage.openAdvancedTab();
    await pm.alertSaveQueryModePage.addCompareWithPastWindow();
    await pm.alertSaveQueryModePage.expectCompareWithPastWindowCount(1);

    // Realtime runs Builder only, so the section goes away while it is selected.
    await pm.alertSaveQueryModePage.selectRealtime();
    await pm.alertSaveQueryModePage.selectScheduled();
    await pm.alertSaveQueryModePage.openAdvancedTab();

    // Before the fix the window was gone for good: cleared on the way to Realtime
    // and never restored. The payload guard already keeps windows off a realtime
    // alert, so clearing the form only ever cost the user their work.
    await pm.alertSaveQueryModePage.expectCompareWithPastWindowCount(1);
    // The type still resets to Builder — that part was never the bug.
    await pm.alertSaveQueryModePage.expectQueryModeSelected('custom');
  });

  test('#15098 a PromQL save keeps the stored SQL', async ({ page }) => {
    await ensureMetricsIngested();
    const id = await seed(page, metricsAlertWithSql(uniq('auto_qm_15098')));

    // The seed is the precondition: the alert really does carry both.
    expect((await getAlert(page, id)).query_condition.sql).toBe(METRICS_SQL);

    await pm.alertSaveQueryModePage.openEditor(id);
    await pm.alertSaveQueryModePage.expectQueryModeSelected('promql');
    // PromQL is selected and holds content, so this saves without asking.
    await pm.alertSaveQueryModePage.clickSave();
    await pm.alertSaveQueryModePage.expectSavedWithoutDialog();

    const saved = await getAlert(page, id);
    expect(saved.query_condition.type).toBe('promql');
    // Before the fix getAlertPayload blanked this whenever the PromQL tab was the
    // selected one, so an untouched save destroyed the user's query.
    expect(saved.query_condition.sql).toBe(METRICS_SQL);
  });
});
