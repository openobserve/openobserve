const { test, expect, navigateToBase } = require('../../utils/enhanced-baseFixtures.js');
const testLogger = require('../../utils/test-logger.js');
const PageManager = require('../../../pages/page-manager.js');
const {
  assertSyntheticsEnabled,
  ensureSyntheticsLocation,
  createCheck,
  seedRuns,
  cleanupWorkerEntities,
} = require('../../utils/synthetics-helpers.js');

const ORG = process.env['ORGNAME'];
const DEAD_LETTER_HEADLINE = 'no probe claimed the check for this location before its schedule window closed';
const DEAD_LETTER_ERROR = `${DEAD_LETTER_HEADLINE} (phase: never claimed; 0 dispatch attempt(s)); a probe may be unable to reach the callback endpoint http://localhost:5080`;
const PASSED_STEPS = [
  { step_id: 'step-navigate', status: 'passed', duration_ms: 420, error: '', screenshot_key: '' },
  { step_id: 'step-title', status: 'passed', duration_ms: 35, error: '', screenshot_key: '' },
];

test.describe('Run detail headline, status and step states (#16327, #16328, #16329)', () => {
  test.describe.configure({ mode: 'parallel' });
  let pm;
  let check;
  let failedRun;
  let deadLetterRun;
  let unknownStepRun;
  let idlessDeadLetterRow;

  test.beforeAll(async ({ browser }, testInfo) => {
    test.setTimeout(180000);
    const context = await browser.newContext({ storageState: 'playwright-tests/utils/auth/user.json' });
    const page = await context.newPage();
    await assertSyntheticsEnabled(page);
    await ensureSyntheticsLocation(page);
    check = await createCheck(page, 'browser', testInfo);
    [failedRun, deadLetterRun, unknownStepRun, idlessDeadLetterRow] = await seedRuns(page, check, [
      { template: 'browser_failed', ageSec: 60 },
      { template: 'error_dispatch', ageSec: 120, overrides: { error: DEAD_LETTER_ERROR } },
      {
        template: 'browser_passed',
        ageSec: 180,
        overrides: {
          last_attempt_steps: [
            ...PASSED_STEPS,
            { step_id: 'step-url', status: 'interrupted', duration_ms: 12, error: '', screenshot_key: '' },
          ],
        },
      },
      { template: 'error_quota', ageSec: 240, overrides: { error_source: 'dispatch', error: DEAD_LETTER_ERROR } },
    ]);
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

  test(
    'a failed run shows no Passed badge while it is still loading',
    {
      tag: ['@bug-16327', '@P1', '@regression', '@syntheticsRegression'],
    },
    async () => {
      const r = pm.syntheticsResultsPage;
      const hold = await r.holdRunQuery(failedRun.runId);
      testLogger.info('Opening the failed run with its query held back', { runId: failedRun.runId });
      await r.openRunDetailPage(ORG, check.id, failedRun.runId, failedRun.executionId);
      try {
        await hold.held;
        await r.expectNoStatusBadgeFor(2000);
      } finally {
        hold.release();
      }
      testLogger.info('Releasing the run query');
      await r.expectStatusBadge('Failed');
    },
  );

  test(
    'a dead-letter error headline is complete, not cut at "(phase"',
    {
      tag: ['@bug-16328', '@P2', '@regression', '@syntheticsRegression'],
    },
    async () => {
      const r = pm.syntheticsResultsPage;
      testLogger.info('Opening the dead-letter run', { runId: deadLetterRun.runId });
      await r.gotoRunDetail(ORG, check.id, deadLetterRun.runId, deadLetterRun.executionId);
      await r.expectStatusBadge('Error');
      await r.expectErrorHeadline(DEAD_LETTER_HEADLINE);
    },
  );

  test(
    'an id-less dead-letter row opened from the results list shows the complete headline',
    {
      tag: ['@bug-16328', '@P2', '@regression', '@syntheticsRegression'],
    },
    async () => {
      const r = pm.syntheticsResultsPage;
      testLogger.info('Filtering the results to error runs', { checkId: check.id });
      await r.gotoResults(ORG, check.id);
      await r.clickStatusFilter('error');
      await r.expectRunTotal(2);
      testLogger.info('Opening the id-less row in the drawer', { timestamp: idlessDeadLetterRow.timestamp });
      // Newest first: the id-less row is seeded older than the other error run.
      await r.clickRunRow(1);
      await r.expectDrawerErrorSource('Dispatch error');
      await r.expectDrawerErrorHeadline(DEAD_LETTER_HEADLINE);
    },
  );

  test(
    'a step with an unknown result has a readable number, not a muted one',
    {
      tag: ['@bug-16329', '@P2', '@regression', '@syntheticsRegression'],
    },
    async () => {
      const r = pm.syntheticsResultsPage;
      testLogger.info('Opening the run whose last step has an unknown result', { runId: unknownStepRun.runId });
      await r.gotoRunDetail(ORG, check.id, unknownStepRun.runId, unknownStepRun.executionId);
      await r.openDetailStepsTab();
      await r.expectDetailStepRows(3);
      const dot = r.stepDotWithBadge(2, 'Unknown');
      await expect(dot).toHaveText('3', { timeout: 30000 });
      await expect(dot).toHaveClass(/(^|\s)text-text-secondary(\s|$)/);
      await expect(dot).toHaveClass(/(^|\s)border-text-secondary(\s|$)/);
      await expect(dot).not.toHaveClass(/text-text-muted/);
    },
  );
});
