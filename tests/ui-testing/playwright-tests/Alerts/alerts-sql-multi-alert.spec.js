// Copyright 2026 OpenObserve Inc.

/**
 * Alerts SQL Multi Alert — SQL-tab Simple/Multi condition block  [P0/P1/P2]
 *
 * Drives the SQL tab's Simple vs Multi choice end-to-end (the surface the
 * grouped `alerts-multialert-ui.spec.js` does not touch): toggle → value-column
 * dropdown (sourced from the query's own /result_schema projections) →
 * operator/value → save. On save the payload pins `function = "count"`, and the
 * backend derives `group_by` from the SQL query's own GROUP BY clause (the
 * M-10 any-group-count gate, threshold >= 1); Simple mode drops `aggregation`
 * entirely. A SQL multi alert therefore requires a GROUP BY in the query.
 *
 * All headline behaviours are WIRED per the reachability trace, so every
 * scenario is a normal green test. The stream + destination are seeded by
 * `seedAlertFixtures` (shared, read-only); each test creates a uniquely-named
 * alert and deletes it in `afterEach`.
 *
 * All UI selectors live in page objects (pm.alertsPage); shared API plumbing
 * lives in ../utils/alerts-api-helpers.js.
 */

const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const PageManager = require('../../pages/page-manager.js');
const { getOrgIdentifier } = require('../utils/cloud-auth.js');
const {
  BASE, STREAM, DEST, uniq,
  createAlert, findAlertId, getAlert, deleteAlerts, seedAlertFixtures, sqlMultiAlert,
} = require('../utils/alerts-api-helpers.js');

/** Create a SQL multi alert through the API and return its id (asserts the create succeeded). */
async function createSqlMultiViaApi(page, name) {
  const r = await createAlert(page, sqlMultiAlert(name));
  expect(r.status(), await r.text()).toBe(200);
  return findAlertId(page, name);
}

/** Register a POST /alerts response probe; resolves null when the save never fires. */
function alertSavePost(page, timeout = 30000) {
  return page
    .waitForResponse((r) => r.url().includes('/alerts') && r.request().method() === 'POST', { timeout })
    .catch(() => null);
}

test.describe('Alerts SQL Multi Alert testcases', {
  tag: ['@alerts', '@sql-multi-alert', '@all'],
}, () => {
  test.describe.configure({ mode: 'parallel' });
  let pm;
  const created = [];

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    pm = new PageManager(page);
    await seedAlertFixtures(page);
    await navigateToBase(page);
  });

  test.afterEach(async ({ page }) => {
    await deleteAlerts(page, created);
    created.length = 0;
  });

  test('should create a SQL multi alert end-to-end and pin the payload', {
    tag: ['@P0', '@smoke'],
  }, async ({ page }) => {
    const name = uniq('p0_sqlmulti');
    await page.goto(`${BASE}/web/alerts?org_identifier=${getOrgIdentifier()}`);

    await pm.alertsPage.setupScheduledAlertWizardToStep2(STREAM, name);
    await pm.alertsPage.runSqlAndCloseEditor(`SELECT latency FROM "${STREAM}" GROUP BY latency`);
    await pm.alertsPage.removeResidualPortals();

    await pm.alertsPage.selectMultiAlertMode();
    await pm.alertsPage.selectSqlAggColumn('latency');
    await pm.alertsPage.selectSqlAggOperator('>');
    await pm.alertsPage.fillSqlAggValue(500);
    await pm.alertsPage.selectDestinationByName(DEST);

    const savePromise = alertSavePost(page);
    await pm.alertsPage.submitAlertForm();
    const resp = await savePromise;
    expect(resp && resp.ok(), 'SQL multi alert save must reach the API and succeed').toBeTruthy();

    await pm.alertsPage.expectAlertVisibleInList(name);
    const id = await findAlertId(page, name);
    expect(id, 'saved SQL multi alert must have an id').toBeTruthy();
    created.push(id);

    const stored = await getAlert(page, id);
    expect(stored, 'getAlert must return the saved alert').not.toBeNull();
    expect(stored.query_condition.aggregation.function).toBe('count');
    expect(stored.query_condition.aggregation.group_by).toEqual(['latency']);
    expect(stored.query_condition.aggregation.multi_alert).toBe(true);
    expect(stored.query_condition.aggregation.having.column).toBe('latency');
    expect(stored.trigger_condition.threshold).toBeGreaterThanOrEqual(1);
  });

  test('should swap the Simple "No. of events" row for the "Alert if [column]" row when Multi is chosen', {
    tag: ['@P0'],
  }, async ({ page }) => {
    const name = uniq('p0_toggle');
    await page.goto(`${BASE}/web/alerts?org_identifier=${getOrgIdentifier()}`);

    await pm.alertsPage.setupScheduledAlertWizardToStep2(STREAM, name);
    await pm.alertsPage.clickSqlTab();

    await pm.alertsPage.expectSimpleNoOfEventsRowVisible();
    await pm.alertsPage.expectSqlAggColumnSelectHidden();

    await pm.alertsPage.selectMultiAlertMode();

    await pm.alertsPage.expectSqlAggColumnSelectVisible();
    await pm.alertsPage.expectSimpleNoOfEventsRowHidden();
  });

  test('should show the Multi toggle selected and the stored column when editing a SQL multi alert', {
    tag: ['@P1'],
  }, async ({ page }) => {
    const name = uniq('p1_edit');
    const id = await createSqlMultiViaApi(page, name);
    expect(id).toBeTruthy();
    created.push(id);

    await page.goto(`${BASE}/web/alerts?org_identifier=${getOrgIdentifier()}&action=update&alert_id=${id}&folder=default`);

    await pm.alertsPage.expectMultiAlertSelected();
    await pm.alertsPage.expectSqlAggColumnSelected('latency');
  });

  test('should save a Simple SQL count alert with aggregation dropped to null', {
    tag: ['@P1'],
  }, async ({ page }) => {
    const name = uniq('p1_simple');
    await page.goto(`${BASE}/web/alerts?org_identifier=${getOrgIdentifier()}`);

    await pm.alertsPage.setupScheduledAlertWizardToStep2(STREAM, name);
    await pm.alertsPage.clickSqlTab();
    await pm.alertsPage.setAlertIfOperator('>=');
    await pm.alertsPage.setAlertIfThreshold(1);
    await pm.alertsPage.runSqlAndCloseEditor(`SELECT count(*) AS cnt FROM "${STREAM}"`);
    await pm.alertsPage.removeResidualPortals();
    await pm.alertsPage.selectDestinationByName(DEST);

    const savePromise = alertSavePost(page);
    await pm.alertsPage.submitAlertForm();
    const resp = await savePromise;
    expect(resp && resp.ok(), 'simple SQL count alert save must succeed').toBeTruthy();

    await pm.alertsPage.expectAlertVisibleInList(name);
    const id = await findAlertId(page, name);
    expect(id, 'saved simple SQL alert must have an id').toBeTruthy();
    created.push(id);

    const stored = await getAlert(page, id);
    expect(stored, 'getAlert must return the saved alert').not.toBeNull();
    expect(stored.query_condition.aggregation).toBeNull();
  });

  test('should block save with a required-column error when Multi has no value column', {
    tag: ['@P2'],
  }, async ({ page }) => {
    const name = uniq('p2_nocol');
    await page.goto(`${BASE}/web/alerts?org_identifier=${getOrgIdentifier()}`);

    await pm.alertsPage.setupScheduledAlertWizardToStep2(STREAM, name);
    await pm.alertsPage.clickSqlTab();
    await pm.alertsPage.selectMultiAlertMode();

    const savePromise = alertSavePost(page, 5000);
    await pm.alertsPage.submitAlertForm();
    await pm.alertsPage.expectSqlAggColumnRequiredError();
    const resp = await savePromise;
    expect(resp, 'no POST should fire when the value column is empty').toBeNull();
  });

  test('should show the HAVING-clause warning banner when the user SQL carries its own HAVING', {
    tag: ['@P2'],
  }, async ({ page }) => {
    const name = uniq('p2_having');
    await page.goto(`${BASE}/web/alerts?org_identifier=${getOrgIdentifier()}`);

    await pm.alertsPage.setupScheduledAlertWizardToStep2(STREAM, name);
    await pm.alertsPage.clickSqlTab();
    await pm.alertsPage.selectMultiAlertMode();
    await pm.alertsPage.runSqlAndCloseEditor(`SELECT city, count(*) AS cnt FROM "${STREAM}" GROUP BY city HAVING count(*) > 0`);
    await pm.alertsPage.removeResidualPortals();

    await pm.alertsPage.expectSqlHavingClauseWarningVisible();
  });

  test('should clear the chosen column when the query edit drops that projection', {
    tag: ['@P2'],
  }, async ({ page }) => {
    const name = uniq('p2_clearcol');
    await page.goto(`${BASE}/web/alerts?org_identifier=${getOrgIdentifier()}`);

    await pm.alertsPage.setupScheduledAlertWizardToStep2(STREAM, name);
    await pm.alertsPage.clickSqlTab();
    await pm.alertsPage.selectMultiAlertMode();
    await pm.alertsPage.runSqlAndCloseEditor(`SELECT latency FROM "${STREAM}"`);
    await pm.alertsPage.removeResidualPortals();
    await pm.alertsPage.selectSqlAggColumn('latency');
    await pm.alertsPage.expectSqlAggColumnSelected('latency');

    await pm.alertsPage.runSqlAndCloseEditor(`SELECT city FROM "${STREAM}"`);
    await pm.alertsPage.removeResidualPortals();

    await pm.alertsPage.expectSqlAggColumnCleared();
  });
});
