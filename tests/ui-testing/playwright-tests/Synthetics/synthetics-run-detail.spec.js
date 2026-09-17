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

// Synthetics run detail over seeded rows — passed, failed, dispatch error, quota row, retries (plan §6); serial on one beforeAll seed.

const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const PageManager = require('../../pages/page-manager.js');
const {
  assertSyntheticsEnabled,
  ensureSyntheticsLocation,
  workerPrefix,
  createCheck,
  deleteChecksByPrefix,
  seedResults,
} = require('../utils/synthetics-helpers.js');

const ORG = process.env['ORGNAME'];
const STEP_COUNT = 3;

test.describe.configure({ mode: 'serial' });

test.describe('Synthetics run detail (seeded)', { tag: ['@synthetics', '@all'] }, () => {
  let pm;
  let check;
  let seeded;

  test.beforeAll(async ({ browser }, testInfo) => {
    test.setTimeout(180000);
    const context = await browser.newContext({ storageState: 'playwright-tests/utils/auth/user.json' });
    const page = await context.newPage();
    await assertSyntheticsEnabled(page);
    await ensureSyntheticsLocation(page);
    check = await createCheck(page, 'browser', testInfo);
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

  test('passed run renders its steps and an empty evidence tab', { tag: ['@P0'] }, async () => {
    const r = pm.syntheticsResultsPage;
    const run = seeded.passedRun;
    await r.gotoRunDetail(ORG, check.id, run.runId, run.executionId);
    await r.expectStatusBadge('Passed');
    await r.openDetailStepsTab();
    await r.expectDetailStepRows(STEP_COUNT);
    await r.openDetailEvidenceTab();
    // Seeded with evidence_key "" — the deterministic no-artifact state.
    await r.expectEvidenceEmpty();
  });

  test('failed run highlights the failed step', { tag: ['@P0'] }, async () => {
    const r = pm.syntheticsResultsPage;
    const run = seeded.failedRun;
    await r.gotoRunDetail(ORG, check.id, run.runId, run.executionId);
    await r.expectStatusBadge('Failed');
    await r.openDetailStepsTab();
    await r.expectDetailStepRows(STEP_COUNT);
    // Failed steps auto-expand; the error card is keyed by the 1-based row number.
    await r.expectFailedStepCard(run.failedStepIndex);
    await r.openStepErrorFullscreen();
  });

  test('dispatch error run shows the error banner and no steps', { tag: ['@P0', '@regression'] }, async () => {
    const r = pm.syntheticsResultsPage;
    const run = seeded.dispatchErrorRun;
    await r.gotoRunDetail(ORG, check.id, run.runId, run.executionId);
    await r.expectStatusBadge('Error');
    await r.expectErrorBanner('Dispatch error');
  });

  test('id-less quota row opens the inline error view without navigating', { tag: ['@P1', '@regression'] }, async ({ page }) => {
    const r = pm.syntheticsResultsPage;
    await r.gotoResults(ORG, check.id);
    await r.expectRunTotal(seeded.rows.length);
    await r.clickStatusFilter('error');
    await r.expectRunTotal(seeded.counts.error);
    const before = page.url();
    // The table is newest-first, so the quota row's index follows from the seeded timestamps.
    const quotaIndex = seeded.quotaErrorRow.timestamp > seeded.dispatchErrorRun.timestamp ? 0 : 1;
    await r.clickRunRow(quotaIndex);
    await r.expectDrawerErrorSource('Quota limit reached');
    expect(page.url()).toBe(before);
  });

  test('retried run offers both attempts', { tag: ['@P2'] }, async () => {
    const r = pm.syntheticsResultsPage;
    const run = seeded.retriedRun;
    await r.gotoRunDetail(ORG, check.id, run.runId, run.executionId);
    await r.expectAttemptSelectVisible();
    await r.openDetailStepsTab();
    await r.expectDetailStepRows(STEP_COUNT);
    // The decided attempt passed; attempt 1 failed on step 3, so switching surfaces its error card.
    await r.expectStepCardCount(STEP_COUNT, 0);
    await r.openAttempt('0');
    await r.expectStepCardCount(STEP_COUNT, 1);
  });

  test('prev/next are disabled (pinned until navigation exists)', { tag: ['@P2'] }, async () => {
    const r = pm.syntheticsResultsPage;
    const run = seeded.passedRun;
    await r.gotoRunDetail(ORG, check.id, run.runId, run.executionId);
    await r.expectPrevNextDisabled();
  });
});
