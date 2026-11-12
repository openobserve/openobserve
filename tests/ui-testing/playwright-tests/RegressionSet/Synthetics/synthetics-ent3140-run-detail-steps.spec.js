// Copyright 2026 OpenObserve Inc.
const { test, navigateToBase } = require('../../utils/enhanced-baseFixtures.js');
const testLogger = require('../../utils/test-logger.js');
const PageManager = require('../../../pages/page-manager.js');

const TAGS = ['@bug-ent3140', '@P2', '@regression', '@syntheticsRegression'];
const START_URL = 'https://example.com/index.html';
const PAGE_TWO_URL = 'https://example.com/page-two.html';
const SKIP_REASON = "Timeout 3000ms exceeded waiting for locator('#cookie-close')";
const NEVER_THERE_ERROR = "Timeout 3000ms exceeded waiting for locator('#never-there')";
const FAILED_JOURNEY = { startUrl: START_URL, pageTwoUrl: PAGE_TWO_URL, error: NEVER_THERE_ERROR };

test.describe('Synthetics run detail reports each step as it ran (#3140)', () => {
  test.describe.configure({ mode: 'parallel' });
  let synthetics;
  let tag;

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    await navigateToBase(page);
    synthetics = new PageManager(page).syntheticsRegressionPage;
    tag = synthetics.newRunTag();
  });

  test.afterEach(async ({}, testInfo) => {
    await synthetics.deleteCreated();
    testLogger.testEnd(testInfo.title, testInfo.status);
  });

  test('a skipped optional step is labelled Skipped, does not look passed and says why it was skipped', {
    tag: TAGS,
  }, async () => {
    const locationId = await synthetics.createProbeLocation(tag);
    const check = await synthetics.createCheck(`synreg${tag}_skipped_step`, 'browser', locationId, {
      target: START_URL,
      config: synthetics.journeyConfig([
        synthetics.clickStep('s1-next', 'Next link', '#next'),
        synthetics.clickStep('s2-cookie', 'Close cookie banner', '#cookie-close', { optional: true }),
        synthetics.titleAssertStep('s3-title', 'Title is Page two'),
      ]),
    });
    const run = await synthetics.seedBrowserRunRecord(check, locationId, {
      status: 'passed',
      startLoad: synthetics.startLoad(START_URL),
      lastAttemptSteps: [
        synthetics.stepResult('s1-next', 'passed', 120),
        synthetics.stepResult('s2-cookie', 'skipped', 3000, SKIP_REASON),
        synthetics.stepResult('s3-title', 'passed', 30),
      ],
    });

    await synthetics.openRunSteps(check, run, 3);
    await synthetics.expectRunStatus('Passed');
    await synthetics.expectRunStepDotsDiffer(1, 0);
    await synthetics.expectRunStepBadge(1, 'Skipped');
    await synthetics.expectNoRunStepBadge(0);
    await synthetics.expectNoRunStepBadge(2);
    await synthetics.expectSkippedStepCount(1);

    await synthetics.expandRunStep(1);
    await synthetics.expectRunStepField(1, 'Status', 'Skipped');
    await synthetics.expectRunStepField(1, 'Skip reason', SKIP_REASON);
  });

  test('Selector shows the locator of a step, the step id stays under Step ID, and a step with no locator has no Selector', {
    tag: TAGS,
  }, async () => {
    await synthetics.openFailedRunOnSecondPage(tag, FAILED_JOURNEY);
    await synthetics.expectRunStepField(4, 'Selector', '#never-there');
    await synthetics.expectRunStepField(4, 'Step ID', 'j6-fail');

    await synthetics.expandRunStep(1);
    await synthetics.expectRunStepField(1, 'Selector', '#next');

    await synthetics.expandRunStep(3);
    await synthetics.expectRunStepField(3, 'Step ID', 'j6-title');
    await synthetics.expectNoRunStepField(3, 'Selector');
  });

  test('a failed step does not show the start address as its URL, and a navigate step shows its own target', {
    tag: TAGS,
  }, async () => {
    await synthetics.openFailedRunOnSecondPage(tag, FAILED_JOURNEY);
    await synthetics.expectRunStepPanelOmits(4, START_URL);
    await synthetics.expectNoRunStepField(4, 'URL');
    await synthetics.expectNoRunStepField(4, 'Target URL');

    await synthetics.expandRunStep(2);
    await synthetics.expectRunStepField(2, 'Target URL', PAGE_TWO_URL);
    await synthetics.expectRunStepPanelOmits(2, START_URL);

    await synthetics.expandRunStep(0);
    await synthetics.expectRunStepField(0, 'Target URL', START_URL);
    await synthetics.expectNoRunStepField(0, 'Selector');
  });
});
