// Copyright 2026 OpenObserve Inc.

/**
 * Alerts — edit-flow regressions fixed in #15090
 *
 * Three separate bugs, all in how the alert editor reconciles what the user is
 * looking at with what is actually stored:
 *
 *   #15091 — In Edit Alert the Stream Name field is locked, but a change to the
 *            SQL `FROM` table still moved it. The form then sent the new stream,
 *            the backend ignored it and kept the old one, and the saved alert
 *            showed one stream while querying another.
 *   #15092 — In Add Alert the stream field follows the query's `FROM` table. A
 *            table that does not exist made the lookup fail with the in-flight
 *            flag still set, so every later `FROM` change was skipped until the
 *            page reloaded.
 *   #15093 — The editor reads the alert from a detail cache that stays fresh for
 *            60 seconds, and a save from the list did not invalidate it. Reopening
 *            within the minute showed the pre-save copy, and saving again wrote
 *            those stale values back over the edit.
 *
 * The Choose Query Mode dialog that shipped in the same PR is covered by
 * Alerts/alerts-save-query-mode.spec.js.
 */

const { test, expect, navigateToBase } = require('../../utils/enhanced-baseFixtures.js');
const testLogger = require('../../utils/test-logger.js');
const PageManager = require('../../../pages/page-manager.js');
const {
  STREAM, uniq,
  simpleAlert, createAlert, findAlertId, getAlert,
  deleteAlertInFolder, seedAlertFixturesOnce,
} = require('../../utils/alerts-api-helpers.js');

// A second real stream to retarget the FROM table at. Ingested by global setup
// on every run, so it exists on any server the suite is pointed at.
const OTHER_STREAM = 'e2e_automate';
const MISSING_STREAM = 'auto_qm_stream_that_does_not_exist';

const STORED_SQL = `SELECT histogram(_timestamp) as ts, count(*) as cnt FROM "${STREAM}" WHERE status='CRITICAL' GROUP BY ts`;

/** SQL mode with a Builder condition also present, so a mode-preserving save never prompts. */
function sqlAlert(name) {
  const a = simpleAlert(name);
  a.query_condition.type = 'sql';
  a.query_condition.sql = STORED_SQL;
  a.query_condition.conditions = {
    version: 2,
    conditions: {
      filterType: 'group',
      logicalOperator: 'AND',
      conditions: [
        { filterType: 'condition', column: 'city', operator: '=', value: 'paris', logicalOperator: 'AND' },
      ],
    },
  };
  return a;
}

test.describe('Alerts — edit-flow regressions (#15091, #15092, #15093)', {
  tag: ['@alerts', '@alertsEditFlowRegression', '@regression'],
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

  test('#15091 editing the SQL FROM table leaves the locked stream alone', async ({ page }) => {
    const id = await seed(page, sqlAlert(uniq('auto_qm_15091')));

    await pm.alertSaveQueryModePage.openEditor(id);
    await pm.alertSaveQueryModePage.expectStreamName(STREAM);

    // On a new alert the stream field follows the query's FROM table. On an edit
    // the field is locked and the backend ignores a stream change, so following
    // it would only desynchronise what the user sees from what is stored.
    //
    // Column list, not `SELECT *`: the form rejects star queries outright, and
    // that gate would block the save before the assertions below mean anything.
    await pm.alertSaveQueryModePage.setSql(
      `SELECT histogram(_timestamp) as ts, count(*) as cnt FROM "${OTHER_STREAM}" GROUP BY ts`,
    );
    await page.waitForTimeout(2000); // past the 1s sync debounce

    await pm.alertSaveQueryModePage.expectStreamName(STREAM);

    await pm.alertSaveQueryModePage.clickSave();
    // Selected mode is unchanged and holds content, so this saves without asking.
    await pm.alertSaveQueryModePage.expectSavedWithoutDialog();
    expect((await getAlert(page, id)).stream_name).toBe(STREAM);
  });

  test('#15092 the stream name keeps following the query after a stream that does not exist', async ({ page }) => {
    await pm.alertSaveQueryModePage.openNewAlert();
    await pm.alertSaveQueryModePage.selectStream(STREAM);
    await pm.alertSaveQueryModePage.selectQueryMode('sql');

    // The lookup for a missing stream fails. Before the fix the in-flight flag
    // stayed set, so every later FROM change was skipped for the rest of the page.
    await pm.alertSaveQueryModePage.setSql(`SELECT count(*) FROM "${MISSING_STREAM}"`);
    await pm.alertSaveQueryModePage.expectStreamName(MISSING_STREAM);

    // The field is set before the stream lookup is awaited, so the name above
    // appears while the failing request is still in flight — and a second edit
    // arriving in that window is dropped by the in-flight guard rather than
    // queued. Let the failure land first, so this test exercises the fix (the
    // flag is reset in a finally) and not the guard.
    await page.waitForTimeout(3000);

    await pm.alertSaveQueryModePage.setSql(`SELECT count(*) FROM "${OTHER_STREAM}"`);
    await pm.alertSaveQueryModePage.expectStreamName(OTHER_STREAM);
  });

  test('#15093 reopening right after a save shows the saved values', async ({ page }) => {
    const id = await seed(page, sqlAlert(uniq('auto_qm_15093')));

    await pm.alertSaveQueryModePage.openEditor(id);
    await pm.alertSaveQueryModePage.setThreshold('4');
    await pm.alertSaveQueryModePage.clickSave();
    await pm.alertSaveQueryModePage.expectSavedWithoutDialog();

    // The editor reads the alert from a detail cache that stays fresh for 60s.
    // Reopening immediately is the whole point: before the fix this showed the
    // pre-save copy, and saving again wrote the stale value back over the edit.
    await pm.alertSaveQueryModePage.openEditor(id);
    await pm.alertSaveQueryModePage.expectThreshold('4');
  });
});
