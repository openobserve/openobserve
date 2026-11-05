// Copyright 2026 OpenObserve Inc.
const { test, navigateToBase } = require('../../utils/enhanced-baseFixtures.js');
const testLogger = require('../../utils/test-logger.js');
const { SyntheticsRegressionPage } = require('../../../pages/syntheticsPages/syntheticsRegressionPage.js');

const TAGS = ['@bug-ent3140', '@P2', '@regression', '@syntheticsRegression'];
const START_URL = 'https://example.com/index.html';
const PAGE_TWO_URL = 'https://example.com/page-two.html';
const CAPTURE = { screenshot: 'on-fail', trace: 'on-fail', video: 'off' };
const SKIP_REASON = "Timeout 3000ms exceeded waiting for locator('#cookie-close')";
const NEVER_THERE_ERROR = "Timeout 3000ms exceeded waiting for locator('#never-there')";

function clickStep(id, name, selector, extra = {}) {
  return {
    id,
    action: 'click',
    name,
    locator: { candidates: [{ kind: 'css', value: selector, origin: 'recorded' }, { kind: 'text', value: `${name} text`, origin: 'recorded' }] },
    ...extra,
  };
}

function titleAssertStep(id, name) {
  return { id, action: 'assert', name, assertion: { kind: 'page_title', expected: 'Page two' } };
}

function journeyConfig(steps) {
  return { steps, browser_devices: [{ browser: 'chromium', device: 'desktop' }], timeout_ms: 30000, capture: CAPTURE };
}

function stepResult(stepId, status, durationMs, error) {
  return { step_id: stepId, status, duration_ms: durationMs, ...(error ? { error } : {}) };
}

function startLoad() {
  return { step_id: '_start', status: 'passed', duration_ms: 300, url: START_URL };
}

test.describe('Synthetics run detail reports each step as it ran (#3140)', () => {
  test.describe.configure({ mode: 'parallel' });
  let synthetics;
  let tag;

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    await navigateToBase(page);
    synthetics = new SyntheticsRegressionPage(page);
    tag = synthetics.newRunTag();
  });

  test.afterEach(async ({}, testInfo) => {
    await synthetics.deleteCreated();
    testLogger.testEnd(testInfo.title, testInfo.status);
  });

  // The first step opens the start address, which is the value the bug showed as URL on every later step.
  async function openFailedRunOnSecondPage() {
    const locationId = await synthetics.createProbeLocation(tag);
    const check = await synthetics.createCheck(`synreg${tag}_failed_journey`, 'browser', locationId, {
      target: START_URL,
      config: journeyConfig([
        { id: 'j6-open', action: 'navigate', name: 'Open start page', url: START_URL },
        clickStep('j6-next', 'Next link', '#next'),
        { id: 'j6-goto', action: 'navigate', name: 'Open page two', url: PAGE_TWO_URL },
        titleAssertStep('j6-title', 'Title is Page two'),
        clickStep('j6-fail', 'Never there', '#never-there'),
      ]),
    });
    const run = await synthetics.seedBrowserRunRecord(check, locationId, {
      status: 'failed',
      error: NEVER_THERE_ERROR,
      lastAttemptSteps: [
        stepResult('j6-open', 'passed', 300),
        stepResult('j6-next', 'passed', 120),
        stepResult('j6-goto', 'passed', 400),
        stepResult('j6-title', 'passed', 30),
        stepResult('j6-fail', 'failed', 3000, NEVER_THERE_ERROR),
      ],
      failureDetail: {
        step_id: 'j6-fail',
        step_name: 'Never there',
        step_index: 5,
        error: NEVER_THERE_ERROR,
        candidates_tried: [{ kind: 'css', value: '#never-there', origin: 'recorded', outcome: 'not_found' }],
        settle_signals: [],
      },
    });
    await synthetics.openRunSteps(check, run, 5);
    await synthetics.expectRunStatus('Failed');
    await synthetics.expectRunStepError(5, NEVER_THERE_ERROR);
  }

  test('a skipped optional step is labelled Skipped, does not look passed and says why it was skipped', {
    tag: TAGS,
  }, async () => {
    const locationId = await synthetics.createProbeLocation(tag);
    const check = await synthetics.createCheck(`synreg${tag}_skipped_step`, 'browser', locationId, {
      target: START_URL,
      config: journeyConfig([
        clickStep('s1-next', 'Next link', '#next'),
        clickStep('s2-cookie', 'Close cookie banner', '#cookie-close', { optional: true }),
        titleAssertStep('s3-title', 'Title is Page two'),
      ]),
    });
    const run = await synthetics.seedBrowserRunRecord(check, locationId, {
      status: 'passed',
      startLoad: startLoad(),
      lastAttemptSteps: [
        stepResult('s1-next', 'passed', 120),
        stepResult('s2-cookie', 'skipped', 3000, SKIP_REASON),
        stepResult('s3-title', 'passed', 30),
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
    await openFailedRunOnSecondPage();
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
    await openFailedRunOnSecondPage();
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
