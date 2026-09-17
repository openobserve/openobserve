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

// Synthetics results over seeded rows (plan §4.2, §5); serial on one beforeAll seed that leaves the 15 m window 12 min after seeding, so never waitForTimeout here.

const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const PageManager = require('../../pages/page-manager.js');
const {
  assertSyntheticsEnabled,
  ensureSyntheticsLocation,
  workerPrefix,
  createCheck,
  getCheck,
  deleteChecksByPrefix,
  waitForCheck,
  startOneHourAhead,
  seedResults,
} = require('../utils/synthetics-helpers.js');

const ORG = process.env['ORGNAME'];

test.describe.configure({ mode: 'serial' });

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
    const context = await browser.newContext({ storageState: 'playwright-tests/utils/auth/user.json' });
    const page = await context.newPage();
    await deleteChecksByPrefix(page, workerPrefix(testInfo));
    await context.close();
  });

  test('KPI tiles reflect the seeded mix', { tag: ['@P0', '@regression'] }, async () => {
    const r = pm.syntheticsResultsPage;
    await r.gotoResults(ORG, check.id);
    for (const key of ['last-run', 'pass-rate', 'p95-duration', 'retry-rate']) await r.expectKpiVisible(key);
    // `warning-runs` renders instead of `flaky-rate` because the check has retries: 0.
    await r.expectKpiValue('warning-runs', seeded.counts.warning);
    await r.expectKpiValue('failed-runs', seeded.counts.failed);
    await r.expectKpiValue('error-runs', seeded.counts.error);
  });

  test('runs table lists every seeded run', { tag: ['@P0'] }, async () => {
    const r = pm.syntheticsResultsPage;
    await r.gotoResults(ORG, check.id);
    await r.expectRunTotal(seeded.rows.length);
    await r.expectFirstPageRows(10);
  });

  test('status filter "error" isolates error-class runs', { tag: ['@P1', '@regression'] }, async () => {
    const r = pm.syntheticsResultsPage;
    await r.gotoResults(ORG, check.id);
    await r.expectRunTotal(seeded.rows.length);
    await r.clickStatusFilter('error');
    await r.expectRunTotal(seeded.counts.error);
    await r.clickStatusFilter('all');
    await r.expectRunTotal(seeded.rows.length);
  });

  test('status filters "fail" and "pass"', { tag: ['@P1'] }, async () => {
    const r = pm.syntheticsResultsPage;
    await r.gotoResults(ORG, check.id);
    await r.expectRunTotal(seeded.rows.length);
    await r.clickStatusFilter('fail');
    await r.expectRunTotal(seeded.counts.failed);
    await r.clickStatusFilter('pass');
    await r.expectRunTotal(seeded.counts.passed);
    await r.clickStatusFilter('all');
    await r.expectRunTotal(seeded.rows.length);
  });

  test('steps tab aggregates the step stream', { tag: ['@P1'] }, async () => {
    const r = pm.syntheticsResultsPage;
    await r.gotoResults(ORG, check.id);
    await r.expectRunTotal(seeded.rows.length);
    await r.openStepsTab();
    await r.expectSectionRowCount(3);
    await r.expectStepsErrorNote();
  });

  test('status timeline renders with scroll controls', { tag: ['@P2'] }, async () => {
    const r = pm.syntheticsResultsPage;
    await r.gotoResults(ORG, check.id);
    await r.expectTimelineVisible();
  });

  test('changing the window re-queries every surface', { tag: ['@P1'] }, async ({ page }, testInfo) => {
    const winCheck = await createCheck(page, 'browser', testInfo);
    await seedResults(page, winCheck, 'passed-only', [-2, -2, -2, -10, -10]);
    const r = pm.syntheticsResultsPage;
    await r.gotoResults(ORG, winCheck.id);
    await r.setRelativeWindow('5-m');
    await r.expectRunTotal(3);
    await r.setRelativeWindow('15-m');
    await r.expectRunTotal(5);
  });

  test('empty states: no rows, and rows outside the window', { tag: ['@P1'] }, async ({ page }, testInfo) => {
    const r = pm.syntheticsResultsPage;
    await r.gotoResults(ORG, emptyCheck.id);
    await r.expectPageEmpty();

    const oldCheck = await createCheck(page, 'browser', testInfo);
    await seedResults(page, oldCheck, 'passed-only', [-40]);
    await r.gotoResults(ORG, oldCheck.id);
    await r.expectPageEmpty();
    await r.setRelativeWindow('1-h');
    await r.expectRunTotal(1);
  });

  test('http rows open the protocol run summary', { tag: ['@P1'] }, async ({ page }, testInfo) => {
    const httpCheck = await createCheck(page, 'http', testInfo);
    await seedResults(page, httpCheck, 'http-mixed', [-1, -2, -3]);
    const r = pm.syntheticsResultsPage;
    await r.gotoResults(ORG, httpCheck.id);
    await r.expectRunTotal(5);
    await r.clickRunRow(0);
    await r.expectProtocolSummary();
  });

  test('run now from the results header reaches the scheduler', { tag: ['@P1'] }, async ({ page }, testInfo) => {
    const runCheck = await createCheck(page, 'http', testInfo, { enabled: true, start: startOneHourAhead() });
    expect((await getCheck(page, runCheck.id)).body.last_triggered_at).toBe(0);
    const r = pm.syntheticsResultsPage;
    await r.gotoResults(ORG, runCheck.id, { name: runCheck.name });
    await r.triggerRun();
    await r.expectToast(`Run queued for "${runCheck.name}"`);
    await waitForCheck(page, runCheck.id, (c) => Number(c.last_triggered_at) > 0, { timeoutMs: 30000 });
  });
});
