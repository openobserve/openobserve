// Copyright 2026 OpenObserve Inc.

/**
 * Alert Chart Error State  [P0 + P1]
 *
 * The alert detail page renders an evaluation chart (AlertGroupChart) with three
 * mutually exclusive states: panel / error / empty. This spec covers the error
 * state — surfaced when the alert references a stream that no longer exists —
 * plus the reachable happy path (panel renders) and the range toggle.
 *
 * Alerts are created via the API. createAlert DOES validate the stream up
 * front, so the error state is produced by creating the alert over a fresh
 * stream and then deleting that stream — the chart's generate_sql then fails
 * exactly as it does for a stream deleted after the alert was saved. Asserted
 * through the UI. All selectors live in pm.alertDetailPage; shared API
 * plumbing lives in ../utils/alerts-api-helpers.js.
 */

const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const PageManager = require('../../pages/page-manager.js');
const {
  uniq, simpleAlert, multiAlert,
  createAlert, findAlertId, deleteAlerts, seedAlertFixtures, ingest, deleteStream,
} = require('../utils/alerts-api-helpers.js');

/** Create an alert through the API and return its id (asserts the create succeeded). */
async function createAlertViaApi(page, name, payload) {
  const r = await createAlert(page, payload);
  expect(r.status(), await r.text()).toBe(200);
  const id = await findAlertId(page, name);
  expect(id).toBeTruthy();
  return id;
}

test.describe('Alert Chart Error State testcases', {
  tag: ['@alerts', '@alert-chart-error-state'],
}, () => {
  test.describe.configure({ mode: 'parallel' });
  let pm;
  const created = [];

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    pm = new PageManager(page);
    await navigateToBase(page);
  });

  test.afterEach(async ({ page }) => {
    await deleteAlerts(page, created);
    created.length = 0;
  });

  test('the chart shows the backend error when the alert references a missing stream', { tag: ['@all', '@P0'] }, async ({ page }) => {
    testLogger.info('Creating an alert over a stream that is then deleted to trigger the chart error state');
    // The create endpoint validates the stream up front, so an alert can only
    // be created over a stream that exists. Create a fresh unique stream, save
    // the alert over it, then delete the stream — generate_sql (the chart)
    // then 400s exactly as it would for a stream deleted after the fact.
    const stream = `alert_chart_missing_${uniq('x')}`;
    await ingest(page, stream, [{ city: 'bangalore', latency: 890, status: 500 }]);
    const name = uniq('chart_missing');
    const id = await createAlertViaApi(page, name, { ...simpleAlert(name), stream_name: stream });
    created.push(id);
    const del = await deleteStream(page, stream);
    expect(del.status(), await del.text()).toBe(200);

    await pm.alertDetailPage.open(id);
    await pm.alertDetailPage.expectTitle(name);
    await pm.alertDetailPage.expectChartErrorVisible('does not exist');
    testLogger.info('Test completed');
  });

  test('the chart renders the panel for a valid alert', { tag: ['@all', '@P0'] }, async ({ page }) => {
    testLogger.info('Seeding fixtures and creating a valid scheduled alert over the shared stream');
    await seedAlertFixtures(page);
    const name = uniq('chart_panel');
    const id = await createAlertViaApi(page, name, multiAlert(name));
    created.push(id);

    await pm.alertDetailPage.open(id);
    await pm.alertDetailPage.expectTitle(name);
    await pm.alertDetailPage.expectChartPanelVisible();
    testLogger.info('Test completed');
  });

  test('changing the chart range re-runs the build without erroring', { tag: ['@all', '@P1'] }, async ({ page }) => {
    testLogger.info('Seeding fixtures and creating a valid scheduled alert for the range toggle');
    await seedAlertFixtures(page);
    const name = uniq('chart_range');
    const id = await createAlertViaApi(page, name, multiAlert(name));
    created.push(id);

    await pm.alertDetailPage.open(id);
    await pm.alertDetailPage.expectTitle(name);
    await pm.alertDetailPage.expectChartPanelVisible();

    await pm.alertDetailPage.selectChartRange('6h');
    await pm.alertDetailPage.expectChartPanelVisible();

    await pm.alertDetailPage.selectChartRange('24h');
    await pm.alertDetailPage.expectChartPanelVisible();
    testLogger.info('Test completed');
  });
});
