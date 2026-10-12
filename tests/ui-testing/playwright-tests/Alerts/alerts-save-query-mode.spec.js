// Copyright 2026 OpenObserve Inc.

/**
 * Alerts — the Choose Query Mode dialog
 *
 * Only the SELECTED query mode runs, but every mode's text is stored on the
 * alert. Before #15090 an empty Builder saved over a stored SQL query matched
 * every row in the stream while the SQL never ran (#15037). Save now asks which
 * mode the alert uses whenever more than one is in play — "in play" meaning the
 * selected mode plus every mode that holds content.
 *
 * The rule that decides whether the dialog opens is the easy thing to get wrong:
 * `confirmedSaveMode` is seeded from the alert's SAVED type, and `askForSaveMode`
 * bails when the selected mode both matches it and holds content. So an edit that
 * does not change the mode never asks, even when another mode holds content. One
 * test below pins that negative on purpose — a change that makes an unchanged
 * edit start prompting would be a regression, not a fix.
 *
 * Content is judged by `modesWithContent`: a complete Builder condition counts,
 * and SQL counts unless it is exactly the `SELECT * FROM "<stream>"` starter the
 * form writes into an empty SQL tab.
 *
 * The edit-flow fixes that shipped alongside the dialog (#15091, #15092, #15093)
 * live in RegressionSet/Alerts/alerts-15091-alert-edit-flow.spec.js.
 */

const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const PageManager = require('../../pages/page-manager.js');
const {
  STREAM, DEST, uniq,
  simpleAlert, createAlert, findAlertId, getAlert,
  deleteAlertInFolder, seedAlertFixturesOnce,
} = require('../utils/alerts-api-helpers.js');

// A real query, not the `SELECT * FROM "<stream>"` starter, so it counts as content.
const STORED_SQL = `SELECT histogram(_timestamp) as ts, count(*) as cnt FROM "${STREAM}" WHERE status='CRITICAL' GROUP BY ts`;

const builderCondition = () => ({
  version: 2,
  conditions: {
    filterType: 'group',
    logicalOperator: 'AND',
    conditions: [
      { filterType: 'condition', column: 'city', operator: '=', value: 'paris', logicalOperator: 'AND' },
    ],
  },
});

/** Builder is selected but empty, while a real SQL query sits in the other tab — the #15037 shape. */
function builderEmptyWithSql(name) {
  const a = simpleAlert(name);
  a.query_condition.type = 'custom';
  a.query_condition.sql = STORED_SQL;
  return a;
}

/** SQL is selected and a Builder condition is also set up — both modes hold content. */
function sqlWithBuilderCondition(name) {
  const a = simpleAlert(name);
  a.query_condition.type = 'sql';
  a.query_condition.sql = STORED_SQL;
  a.query_condition.conditions = builderCondition();
  return a;
}

test.describe('Alerts — Choose Query Mode on save', {
  tag: ['@alerts', '@alertsSaveQueryMode'],
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

  // Every fixture name carries the `auto_` prefix cleanup.spec.js sweeps, so an
  // interrupted run leaves nothing behind for the next one to trip over.
  async function seed(page, payload) {
    const response = await createAlert(page, payload);
    expect(response.status(), await response.text()).toBe(200);
    const id = await findAlertId(page, payload.name);
    expect(id, `seeded alert ${payload.name} must be listable`).toBeTruthy();
    created.push(id);
    return id;
  }

  async function trackCreated(page, name) {
    const id = await findAlertId(page, name);
    expect(id, `alert ${name} must exist after save`).toBeTruthy();
    created.push(id);
    return id;
  }

  test('an empty Builder over stored SQL asks, and the SQL pick saves type sql', async ({ page }) => {
    const name = uniq('auto_qm_sqlpick');
    const id = await seed(page, builderEmptyWithSql(name));

    await pm.alertSaveQueryModePage.openEditor(id);
    // The editor must open on the mode the alert was saved with.
    await pm.alertSaveQueryModePage.expectQueryModeSelected('custom');

    await pm.alertSaveQueryModePage.clickSave();
    await pm.alertSaveQueryModePage.expectDialogOpen();

    // Builder is selected but holds nothing, so it is named first and warned about.
    await pm.alertSaveQueryModePage.expectLead('Builder is selected but empty. SQL is set up.');
    await pm.alertSaveQueryModePage.expectSaveModeSelected('custom');
    await pm.alertSaveQueryModePage.expectWarning(`No filters, so every row in ${STREAM} counts`);
    await pm.alertSaveQueryModePage.expectNote('Only Builder mode runs. SQL mode is not used.');

    await pm.alertSaveQueryModePage.pickSaveMode('sql');
    // Switching the pick re-words the consequence and drops the empty-Builder warning.
    await pm.alertSaveQueryModePage.expectNote('Only SQL mode runs.');
    await pm.alertSaveQueryModePage.expectNoWarning();
    await pm.alertSaveQueryModePage.expectPrimaryButtonLabel('Save with SQL Mode');

    await pm.alertSaveQueryModePage.confirmSaveMode();

    const saved = await getAlert(page, id);
    expect(saved.query_condition.type).toBe('sql');
    expect(saved.query_condition.sql).toBe(STORED_SQL);
    // An edit never retargets the stream.
    expect(saved.stream_name).toBe(STREAM);
  });

  test('the Builder pick saves type custom and leaves the stored SQL in place', async ({ page }) => {
    const name = uniq('auto_qm_builderpick');
    const id = await seed(page, builderEmptyWithSql(name));

    await pm.alertSaveQueryModePage.openEditor(id);
    await pm.alertSaveQueryModePage.clickSave();
    await pm.alertSaveQueryModePage.expectDialogOpen();

    await pm.alertSaveQueryModePage.expectPrimaryButtonLabel('Save with Builder Mode');
    await pm.alertSaveQueryModePage.confirmSaveMode();

    const saved = await getAlert(page, id);
    expect(saved.query_condition.type).toBe('custom');
    // Builder mode keeps the other tab's text rather than destroying it.
    expect(saved.query_condition.sql).toBe(STORED_SQL);
  });

  test('Cancel saves nothing and asks again on the next Save', async ({ page }) => {
    const name = uniq('auto_qm_cancel');
    const id = await seed(page, builderEmptyWithSql(name));

    await pm.alertSaveQueryModePage.openEditor(id);
    await pm.alertSaveQueryModePage.clickSave();
    await pm.alertSaveQueryModePage.expectDialogOpen();

    await pm.alertSaveQueryModePage.cancelSaveMode();
    // Cancel abandons the save outright — still on the editor, mode untouched.
    await pm.alertSaveQueryModePage.expectOnEditor();
    await pm.alertSaveQueryModePage.expectQueryModeSelected('custom');

    const afterCancel = await getAlert(page, id);
    expect(afterCancel.query_condition.type).toBe('custom');

    // Cancel records no answer, so the next Save has to ask again.
    await pm.alertSaveQueryModePage.clickSave();
    await pm.alertSaveQueryModePage.expectDialogOpen();
  });

  test('an edit that does not change the mode never asks, even with both modes set up', async ({ page }) => {
    const name = uniq('auto_qm_unchanged');
    const id = await seed(page, sqlWithBuilderCondition(name));

    await pm.alertSaveQueryModePage.openEditor(id);
    await pm.alertSaveQueryModePage.expectQueryModeSelected('sql');

    // SQL is selected, matches the saved type and holds content: the user already
    // answered this question when they saved it, so Save must go straight through.
    await pm.alertSaveQueryModePage.clickSave();
    await pm.alertSaveQueryModePage.expectSavedWithoutDialog();

    const saved = await getAlert(page, id);
    expect(saved.query_condition.type).toBe('sql');
  });

  test('switching the mode on that same alert asks, and names both modes', async ({ page }) => {
    const name = uniq('auto_qm_switch');
    const id = await seed(page, sqlWithBuilderCondition(name));

    await pm.alertSaveQueryModePage.openEditor(id);
    await pm.alertSaveQueryModePage.selectQueryMode('custom');
    await pm.alertSaveQueryModePage.clickSave();
    await pm.alertSaveQueryModePage.expectDialogOpen();

    // Both hold content, so neither is called empty and there is no warning.
    await pm.alertSaveQueryModePage.expectLead('Builder and SQL are both set up.');
    await pm.alertSaveQueryModePage.expectNoWarning();
    await pm.alertSaveQueryModePage.expectNote('Only Builder mode runs. SQL mode is not used.');
    // The toggle starts on the selected mode and never moves on its own.
    await pm.alertSaveQueryModePage.expectSaveModeSelected('custom');

    await pm.alertSaveQueryModePage.confirmSaveMode();
    expect((await getAlert(page, id)).query_condition.type).toBe('custom');
  });

  test('Enter in the alert name opens the dialog on a new alert', async ({ page }) => {
    const name = uniq('auto_qm_enter');

    await pm.alertSaveQueryModePage.openNewAlert();
    await pm.alertSaveQueryModePage.selectStream(STREAM);
    await pm.alertSaveQueryModePage.addBuilderCondition('city', 'paris');
    await pm.alertSaveQueryModePage.selectDestination(DEST);
    // Opening the SQL tab after the stream is already chosen leaves it empty.
    await pm.alertSaveQueryModePage.selectQueryMode('sql');

    // Enter goes through OFormInlineEdit's requestSubmit(), which bypasses the
    // Save button's handler entirely — it has to reach the same gate.
    await pm.alertSaveQueryModePage.setName(name, { submit: true });

    await pm.alertSaveQueryModePage.expectDialogOpen();
    await pm.alertSaveQueryModePage.expectLead('SQL is selected but empty. Builder is set up.');
    await pm.alertSaveQueryModePage.expectWarning('No query written yet');
    await pm.alertSaveQueryModePage.expectNote('Only SQL mode runs. Builder mode is not used.');

    // Nothing is sent while the question is open.
    expect(await findAlertId(page, name)).toBeFalsy();
  });

  test('field errors come before the dialog', async ({ page }) => {
    const name = uniq('auto_qm_fielderr');
    const id = await seed(page, builderEmptyWithSql(name));

    await pm.alertSaveQueryModePage.openEditor(id);
    await pm.alertSaveQueryModePage.clearDestination();

    await pm.alertSaveQueryModePage.clickSave();
    // The form's own validation wins: no point asking which query to run when
    // the alert cannot be saved at all.
    await pm.alertSaveQueryModePage.expectDialogClosed();
    await pm.alertSaveQueryModePage.expectValidationToast();

    await pm.alertSaveQueryModePage.selectDestination(DEST);
    await pm.alertSaveQueryModePage.clickSave();
    await pm.alertSaveQueryModePage.expectDialogOpen();
  });

  test('a Builder-only new alert saves without asking', async ({ page }) => {
    const name = uniq('auto_qm_builderonly');

    await pm.alertSaveQueryModePage.openNewAlert();
    await pm.alertSaveQueryModePage.selectStream(STREAM);
    await pm.alertSaveQueryModePage.addBuilderCondition('city', 'paris');
    await pm.alertSaveQueryModePage.selectDestination(DEST);
    // The SQL tab is never opened, so only one mode is ever in play.
    await pm.alertSaveQueryModePage.setName(name, { submit: true });

    await pm.alertSaveQueryModePage.expectSavedWithoutDialog();

    const id = await trackCreated(page, name);
    expect((await getAlert(page, id)).query_condition.type).toBe('custom');
  });

  test('the auto-filled starter SQL does not count as a second mode', async ({ page }) => {
    const name = uniq('auto_qm_starter');

    await pm.alertSaveQueryModePage.openNewAlert();
    // Opening the SQL tab BEFORE the stream is what makes the form auto-write
    // `SELECT * FROM "<stream>"`. The other order leaves the tab empty.
    await pm.alertSaveQueryModePage.selectQueryMode('sql');
    await pm.alertSaveQueryModePage.selectStream(STREAM);
    await pm.alertSaveQueryModePage.expectSqlContains(`SELECT * FROM "${STREAM}"`);

    await pm.alertSaveQueryModePage.selectQueryMode('custom');
    await pm.alertSaveQueryModePage.addBuilderCondition('city', 'paris');
    await pm.alertSaveQueryModePage.selectDestination(DEST);
    await pm.alertSaveQueryModePage.setName(name, { submit: true });

    // The starter is boilerplate the form wrote, not a query the user chose.
    await pm.alertSaveQueryModePage.expectSavedWithoutDialog();

    const id = await trackCreated(page, name);
    expect((await getAlert(page, id)).query_condition.type).toBe('custom');
  });

  test('a Realtime alert never asks and saves as custom', async ({ page }) => {
    const name = uniq('auto_qm_realtime');

    await pm.alertSaveQueryModePage.openNewAlert();
    await pm.alertSaveQueryModePage.selectStream(STREAM);
    await pm.alertSaveQueryModePage.selectQueryMode('sql');
    await pm.alertSaveQueryModePage.setSql(STORED_SQL);

    // Realtime runs Builder only, so the mode toggle goes away and the question
    // stops applying — even though the SQL text is still carried in the form.
    await pm.alertSaveQueryModePage.selectRealtime();
    await pm.alertSaveQueryModePage.expectModeToggleHidden();

    await pm.alertSaveQueryModePage.addBuilderCondition('city', 'paris');
    await pm.alertSaveQueryModePage.selectDestination(DEST);
    await pm.alertSaveQueryModePage.setName(name, { submit: true });

    await pm.alertSaveQueryModePage.expectSavedWithoutDialog();

    const id = await trackCreated(page, name);
    const saved = await getAlert(page, id);
    expect(saved.is_real_time).toBe(true);
    expect(saved.query_condition.type).toBe('custom');
    // Compare-with-Past only runs with SQL, so it is never sent for another type.
    expect(saved.query_condition.multi_time_range).toEqual([]);
  });

  test('the detail page shows no condition for a Builder alert that still stores SQL', async ({ page }) => {
    const builderId = await seed(page, builderEmptyWithSql(uniq('auto_qm_detbuilder')));
    const sqlId = await seed(page, sqlWithBuilderCondition(uniq('auto_qm_detsql')));

    // The stored SQL never runs on a Builder alert, so showing it here would
    // claim the alert watches something it does not.
    await pm.alertSaveQueryModePage.openDetailConfiguration(builderId);
    await pm.alertSaveQueryModePage.expectDetailConditionEmpty();

    // A SQL alert still shows the query it actually evaluates.
    await pm.alertSaveQueryModePage.openDetailConfiguration(sqlId);
    await pm.alertSaveQueryModePage.expectDetailConditionShowsSql();
  });
});
