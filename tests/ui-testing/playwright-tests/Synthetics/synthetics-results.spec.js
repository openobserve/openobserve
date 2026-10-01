// Copyright 2026 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

// Synthetics results over seeded rows; each worker seeds its own check in beforeAll, and rows leave the 15 m window 12 min after seeding, so never waitForTimeout here.

const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const PageManager = require('../../pages/page-manager.js');
const {
  assertSyntheticsEnabled,
  ensureSyntheticsLocation,
  createCheck,
  getCheck,
  waitForCheck,
  startOneHourAhead,
  seedResults,
  cleanupWorkerEntities,
} = require('../utils/synthetics-helpers.js');

const ORG = process.env['ORGNAME'];

test.describe.configure({ mode: 'parallel' });

test.describe('Synthetics results (seeded)', { tag: ['@synthetics', '@all'] }, () => {
  let pm;
  let check;
  let emptyCheck;
  let seeded;

  test.beforeAll(async ({ browser }, testInfo) => {
    test.setTimeout(180000);
    const context = await browser.newContext({ storageState: 'playwright-tests/utils/auth/user.json' });
    const page = await context.newPage();
    await assertSyntheticsEnabled(page);
    await ensureSyntheticsLocation(page);
    check = await createCheck(page, 'browser', testInfo);
    emptyCheck = await createCheck(page, 'browser', testInfo);
    seeded = await seedResults(page, check, 'mixed', [-1, -2, -3]);
    await context.close();
  });

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    await navigateToBase(page);
    pm = new PageManager(page);
  });

  test.afterAll(async ({ browser }, testInfo) => {
    await cleanupWorkerEntities(browser, testInfo);
  });

  test('KPI tiles reflect the seeded mix', { tag: ['@P0', '@regression'] }, async () => {
    const r = pm.syntheticsResultsPage;
    testLogger.info('Opening the results page', { checkId: check.id });
    await r.gotoResults(ORG, check.id);
    testLogger.info('Verifying the KPI tiles match the seeded counts');
    for (const key of ['last-run', 'pass-rate', 'p95-duration', 'retry-rate']) await r.expectKpiVisible(key);
    // `warning-runs` renders instead of `flaky-rate` because the check has retries: 0.
    await r.expectKpiValue('warning-runs', seeded.counts.warning);
    await r.expectKpiValue('failed-runs', seeded.counts.failed);
    await r.expectKpiValue('error-runs', seeded.counts.error);
    const { passed, warning, failed } = seeded.counts;
    // Error runs mean the check could not run, so the page leaves them out of the pass rate.
    await r.expectKpiValue('pass-rate', `${(((passed + warning) / (passed + warning + failed)) * 100).toFixed(1)}%`);
  });

  test('runs table lists every seeded run', { tag: ['@P0'] }, async () => {
    const r = pm.syntheticsResultsPage;
    testLogger.info('Opening the results page', { checkId: check.id });
    await r.gotoResults(ORG, check.id);
    testLogger.info('Verifying the runs table lists every seeded run');
    await r.expectRunTotal(seeded.rows.length);
    await r.expectFirstPageRows(10);
  });

  test('status filter "error" isolates error-class runs', { tag: ['@P1', '@regression'] }, async () => {
    const r = pm.syntheticsResultsPage;
    testLogger.info('Opening the results page', { checkId: check.id });
    await r.gotoResults(ORG, check.id);
    await r.expectRunTotal(seeded.rows.length);
    testLogger.info('Filtering by error status');
    await r.clickStatusFilter('error');
    await r.expectRunTotal(seeded.counts.error);
    testLogger.info('Clearing the status filter');
    await r.clickStatusFilter('all');
    await r.expectRunTotal(seeded.rows.length);
  });

  test('status filters "fail" and "pass"', { tag: ['@P1'] }, async () => {
    const r = pm.syntheticsResultsPage;
    testLogger.info('Opening the results page', { checkId: check.id });
    await r.gotoResults(ORG, check.id);
    await r.expectRunTotal(seeded.rows.length);
    testLogger.info('Filtering by fail status');
    await r.clickStatusFilter('fail');
    await r.expectRunTotal(seeded.counts.failed);
    testLogger.info('Filtering by pass status');
    await r.clickStatusFilter('pass');
    await r.expectRunTotal(seeded.counts.passed);
    testLogger.info('Clearing the status filter');
    await r.clickStatusFilter('all');
    await r.expectRunTotal(seeded.rows.length);
  });

  test('steps tab aggregates the step stream', { tag: ['@P1'] }, async () => {
    const r = pm.syntheticsResultsPage;
    testLogger.info('Opening the results page', { checkId: check.id });
    await r.gotoResults(ORG, check.id);
    await r.expectRunTotal(seeded.rows.length);
    testLogger.info('Verifying the steps tab');
    await r.openStepsTab();
    await r.expectSectionRowCount(3);
    await r.expectStepsErrorNote();
  });

  test('status timeline renders with scroll controls', { tag: ['@P2'] }, async () => {
    const r = pm.syntheticsResultsPage;
    testLogger.info('Opening the results page', { checkId: check.id });
    await r.gotoResults(ORG, check.id);
    testLogger.info('Verifying the status timeline is visible');
    await r.expectTimelineVisible();
  });

  test('changing the window re-queries every surface', { tag: ['@P1'] }, async ({ page }, testInfo) => {
    testLogger.info('Seeding passed runs inside and outside the 5 minute window');
    const winCheck = await createCheck(page, 'browser', testInfo);
    // Seeding waits up to 2 min for rows to be searchable; -0.5 keeps them inside the 5 m window past that wait.
    await seedResults(page, winCheck, 'passed-only', [-0.5, -0.5, -0.5, -10, -10]);
    testLogger.info('Opening the results page', { checkId: winCheck.id });
    const r = pm.syntheticsResultsPage;
    await r.gotoResults(ORG, winCheck.id);
    testLogger.info('Switching between the 5 and 15 minute windows');
    await r.setRelativeWindow('5-m');
    await r.expectRunTotal(3);
    await r.setRelativeWindow('15-m');
    await r.expectRunTotal(5);
  });

  test('empty states: no rows, and rows outside the window', { tag: ['@P1'] }, async ({ page }, testInfo) => {
    testLogger.info('Opening the results page for a check with no rows', { checkId: emptyCheck.id });
    const r = pm.syntheticsResultsPage;
    await r.gotoResults(ORG, emptyCheck.id);
    await r.expectPageEmpty();

    testLogger.info('Seeding a run outside the default window');
    const oldCheck = await createCheck(page, 'browser', testInfo);
    await seedResults(page, oldCheck, 'passed-only', [-40]);
    testLogger.info('Verifying the run appears only in the 1 hour window');
    await r.gotoResults(ORG, oldCheck.id);
    await r.expectPageEmpty();
    await r.setRelativeWindow('1-h');
    await r.expectRunTotal(1);
  });

  test('http rows open the protocol run summary', { tag: ['@P1'] }, async ({ page }, testInfo) => {
    testLogger.info('Seeding HTTP runs via the API');
    const httpCheck = await createCheck(page, 'http', testInfo);
    await seedResults(page, httpCheck, 'http-mixed', [-1, -2, -3]);
    testLogger.info('Opening the results page');
    const r = pm.syntheticsResultsPage;
    await r.gotoResults(ORG, httpCheck.id);
    await r.expectRunTotal(5);
    testLogger.info('Verifying the first run opens the protocol summary');
    await r.clickRunRow(0);
    await r.expectProtocolSummary();
  });

  test('run now from the results header reaches the scheduler', { tag: ['@P1'] }, async ({ page }, testInfo) => {
    testLogger.info('Seeding an enabled HTTP check via the API');
    const runCheck = await createCheck(page, 'http', testInfo, { enabled: true, start: startOneHourAhead() });
    expect((await getCheck(page, runCheck.id)).body.last_triggered_at).toBe(0);
    testLogger.info('Running the check from the results header');
    const r = pm.syntheticsResultsPage;
    await r.gotoResults(ORG, runCheck.id, { name: runCheck.name });
    await r.triggerRun();
    await r.expectToast(`Run queued for "${runCheck.name}"`);
    testLogger.info('Verifying the scheduler claimed the check');
    await waitForCheck(page, runCheck.id, (c) => Number(c.last_triggered_at) > 0, { timeoutMs: 30000 });
  });
});
