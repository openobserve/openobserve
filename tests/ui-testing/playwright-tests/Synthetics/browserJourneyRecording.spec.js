// Copyright 2026 OpenObserve Inc.
//
// Synthetics Browser Test Journey Recording — E2E coverage for the browser-check
// authoring wizard (gate → extension-setup → editor). Covers the WIRED client-state
// authoring paths; extension-driven behaviors (record/replay/restore) are parked as
// `test.fixme` (no Chrome extension exists in the Playwright environment).
//
// Environment gate: the `synthetics` route tree is registered only on enterprise/cloud
// builds (useEnterpriseRoutes.ts:174) and is guarded by `synthetics_enabled`
// (useEnterpriseRoutes.ts:23-29). On a pure-OSS target the page does not exist, so every
// test self-skips cleanly via the probe in beforeEach — never a hard failure.
const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const PageManager = require('../../pages/page-manager.js');

// Per-worker cache of the environment gate. `null` = not yet probed.
let routeAvailable = null;

test.describe("Synthetics Browser Test Journey Recording testcases", () => {
  test.describe.configure({ mode: 'parallel' });
  let pm;

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    await navigateToBase(page);
    pm = new PageManager(page);

    // Environment gate — probe once per worker, then skip the whole file on OSS.
    if (routeAvailable === null) {
      await pm.syntheticsJourneyPage.gotoList();
      routeAvailable = await pm.syntheticsJourneyPage.isAvailable();
    }
    test.skip(
      !routeAvailable,
      'Synthetics route not registered (OSS build or synthetics_enabled off)',
    );
    testLogger.info('Test setup completed');
  });

  // ───────────────────────────────────────────────────────────────────────────
  // P0 — critical path (WIRED)
  // ───────────────────────────────────────────────────────────────────────────

  test("should move from gate to editor via Build manually without the extension", {
    tag: ['@synthetics-journey-recording', '@synthetics', '@all', '@P0']
  }, async ({ page }) => {
    testLogger.info('Opening the create-browser-test gate');
    await pm.syntheticsJourneyPage.gotoCreate();
    await pm.syntheticsJourneyPage.expectGateVisible();

    await pm.syntheticsJourneyPage.expectGateCtasDisabled();

    await pm.syntheticsJourneyPage.fillGate('https://example.com', `e2e_journey_${Date.now()}`);
    await pm.syntheticsJourneyPage.expectGateCtasEnabled();

    await pm.syntheticsJourneyPage.buildManually();
    await pm.syntheticsJourneyPage.expectEditorVisible();
    testLogger.info('Test completed');
  });

  test("should author a valid journey via Add Step, action/navigate/value and locator commit", {
    tag: ['@synthetics-journey-recording', '@synthetics', '@all', '@P0']
  }, async ({ page }) => {
    testLogger.info('Building a journey manually');
    await pm.syntheticsJourneyPage.gotoCreate();
    await pm.syntheticsJourneyPage.fillGate('https://example.com', `e2e_journey_${Date.now()}`);
    await pm.syntheticsJourneyPage.buildManually();

    await pm.syntheticsJourneyPage.addStep();
    await pm.syntheticsJourneyPage.setStepAction(0, 'navigate');
    await pm.syntheticsJourneyPage.setStepName(0, 'Open site');
    await pm.syntheticsJourneyPage.setStepValue('https://example.com');

    await pm.syntheticsJourneyPage.addStep();
    await pm.syntheticsJourneyPage.setStepName(1, 'Click login');
    await pm.syntheticsJourneyPage.commitLocator('button#login');

    await pm.syntheticsJourneyPage.expectStepCount(2);
    await pm.syntheticsJourneyPage.expectLocatorCandidate('button#login');
    testLogger.info('Test completed');
  });

  test("should block Continue until the first step navigates and element steps name a locator", {
    tag: ['@synthetics-journey-recording', '@synthetics', '@all', '@P0']
  }, async ({ page }) => {
    testLogger.info('Verifying journey validation gates on Continue');
    await pm.syntheticsJourneyPage.gotoCreate();
    await pm.syntheticsJourneyPage.fillGate('https://example.com', `e2e_journey_${Date.now()}`);
    await pm.syntheticsJourneyPage.buildManually();

    // First block: a single click step (not navigate) must be refused.
    await pm.syntheticsJourneyPage.addStep();
    await pm.syntheticsJourneyPage.continueToConfigure();
    await pm.syntheticsJourneyPage.expectToastWithText('First step must be');
    await pm.syntheticsJourneyPage.expectOnJourneyStep();

    // Second block: fix step 1 to navigate, then a locator-less click step is refused.
    await pm.syntheticsJourneyPage.setStepAction(0, 'navigate');
    await pm.syntheticsJourneyPage.setStepValue('https://example.com');
    await pm.syntheticsJourneyPage.addStep();
    await pm.syntheticsJourneyPage.continueToConfigure();
    await pm.syntheticsJourneyPage.expectToastWithText('does not say which element to act on');
    await pm.syntheticsJourneyPage.expectOnJourneyStep();
    testLogger.info('Test completed');
  });

  test("should land on the extension setup checklist when recording without the extension and skip to the editor", {
    tag: ['@synthetics-journey-recording', '@synthetics', '@all', '@P0']
  }, async ({ page }) => {
    testLogger.info('Recording without the extension should reach the setup checklist');
    await pm.syntheticsJourneyPage.gotoCreate();
    await pm.syntheticsJourneyPage.fillGate('https://example.com', `e2e_journey_${Date.now()}`);
    await pm.syntheticsJourneyPage.recordFromGate();

    await pm.syntheticsJourneyPage.expectSetupChecklist();

    await pm.syntheticsJourneyPage.skipExtensionSetup();
    await pm.syntheticsJourneyPage.expectEditorVisible();
    testLogger.info('Test completed');
  });

  // ───────────────────────────────────────────────────────────────────────────
  // P1 — important but non-blocking (WIRED)
  // ───────────────────────────────────────────────────────────────────────────

  test("should mutate the journey list via insert-below, duplicate and delete", {
    tag: ['@synthetics-journey-recording', '@synthetics', '@all', '@P1']
  }, async ({ page }) => {
    testLogger.info('Exercising per-row insert / duplicate / delete');
    await pm.syntheticsJourneyPage.gotoCreate();
    await pm.syntheticsJourneyPage.fillGate('https://example.com', `e2e_journey_${Date.now()}`);
    await pm.syntheticsJourneyPage.buildManually();

    await pm.syntheticsJourneyPage.addStep();
    await pm.syntheticsJourneyPage.expectStepCount(1);

    await pm.syntheticsJourneyPage.insertStepBelow(0);
    await pm.syntheticsJourneyPage.expectStepCount(2);

    await pm.syntheticsJourneyPage.duplicateStepAt(0);
    await pm.syntheticsJourneyPage.expectStepCount(3);

    await pm.syntheticsJourneyPage.deleteStepAt(1);
    await pm.syntheticsJourneyPage.expectStepCount(2);
    testLogger.info('Test completed');
  });

  test("should save the check and return to the list", {
    tag: ['@synthetics-journey-recording', '@synthetics', '@all', '@P1']
  }, async ({ page }) => {
    testLogger.info('Saving requires at least one enabled public browser location');
    const locations = await pm.syntheticsJourneyPage.getEnabledPublicBrowserLocations();
    test.fixme(
      !locations.length,
      'save requires ≥1 enabled public browser location (GET /api/{org}/synthetics/locations returned none)',
    );

    const name = `e2e_journey_${Date.now()}`;
    try {
      await pm.syntheticsJourneyPage.gotoCreate();
      await pm.syntheticsJourneyPage.fillGate('https://example.com', name);
      await pm.syntheticsJourneyPage.buildManually();

      await pm.syntheticsJourneyPage.addStep();
      await pm.syntheticsJourneyPage.setStepAction(0, 'navigate');
      await pm.syntheticsJourneyPage.setStepName(0, 'Open site');
      await pm.syntheticsJourneyPage.setStepValue('https://example.com');
      await pm.syntheticsJourneyPage.addStep();
      await pm.syntheticsJourneyPage.setStepName(1, 'Click login');
      await pm.syntheticsJourneyPage.commitLocator('button#login');

      await pm.syntheticsJourneyPage.continueToConfigure();
      await pm.syntheticsJourneyPage.expectConfigureVisible();
      await pm.syntheticsJourneyPage.selectLocation(locations[0].id);
      await pm.syntheticsJourneyPage.expectDetailsPrefilled(name, 'https://example.com');

      await pm.syntheticsJourneyPage.saveAndExit();
      await pm.syntheticsJourneyPage.expectSavedToast();
      await pm.syntheticsJourneyPage.expectInList(name);
    } finally {
      await pm.syntheticsJourneyPage.deleteCheckByName(name);
    }
    testLogger.info('Test completed');
  });

  test("should refuse duplicate and last-candidate locator deletions", {
    tag: ['@synthetics-journey-recording', '@synthetics', '@all', '@P1']
  }, async ({ page }) => {
    testLogger.info('Verifying locator editor guardrails');
    await pm.syntheticsJourneyPage.gotoCreate();
    await pm.syntheticsJourneyPage.fillGate('https://example.com', `e2e_journey_${Date.now()}`);
    await pm.syntheticsJourneyPage.buildManually();
    await pm.syntheticsJourneyPage.addStep();

    await pm.syntheticsJourneyPage.commitLocator('#submit');
    await pm.syntheticsJourneyPage.expectLocatorCandidateCount(1);

    // Duplicate commit is refused with an inline error.
    await pm.syntheticsJourneyPage.commitLocator('#submit');
    await pm.syntheticsJourneyPage.expectLocatorErrorVisible();
    await pm.syntheticsJourneyPage.expectLocatorCandidateCount(1);

    // Deleting the last candidate is refused with an inline error.
    await pm.syntheticsJourneyPage.clickLocatorDeleteAt(0);
    await pm.syntheticsJourneyPage.expectLocatorErrorVisible();
    await pm.syntheticsJourneyPage.expectLocatorCandidateCount(1);
    testLogger.info('Test completed');
  });

  test("should block Continue on an uncommitted locator draft and pass after Enter", {
    tag: ['@synthetics-journey-recording', '@synthetics', '@all', '@P1']
  }, async ({ page }) => {
    testLogger.info('An uncommitted locator draft must block Continue as locatorDraftPending');
    await pm.syntheticsJourneyPage.gotoCreate();
    await pm.syntheticsJourneyPage.fillGate('https://example.com', `e2e_journey_${Date.now()}`);
    await pm.syntheticsJourneyPage.buildManually();

    await pm.syntheticsJourneyPage.addStep();
    await pm.syntheticsJourneyPage.setStepAction(0, 'navigate');
    await pm.syntheticsJourneyPage.setStepValue('https://example.com');
    await pm.syntheticsJourneyPage.addStep();

    await pm.syntheticsJourneyPage.typeLocatorDraft('#draft');
    await pm.syntheticsJourneyPage.continueToConfigure();
    await pm.syntheticsJourneyPage.expectLocatorDraftPending();
    await pm.syntheticsJourneyPage.expectOnJourneyStep();

    await pm.syntheticsJourneyPage.commitLocator('#draft');
    await pm.syntheticsJourneyPage.continueToConfigure();
    await pm.syntheticsJourneyPage.expectConfigureVisible();
    testLogger.info('Test completed');
  });

  // ───────────────────────────────────────────────────────────────────────────
  // P2 — edge cases (WIRED)
  // ───────────────────────────────────────────────────────────────────────────

  test("should guard against leaving with unsaved changes", {
    tag: ['@synthetics-journey-recording', '@synthetics', '@all', '@P2']
  }, async ({ page }) => {
    testLogger.info('Navigating away mid-edit must confirm before leaving');
    await pm.syntheticsJourneyPage.gotoCreate();
    await pm.syntheticsJourneyPage.fillGate('https://example.com', `e2e_journey_${Date.now()}`);
    await pm.syntheticsJourneyPage.buildManually();

    await pm.syntheticsJourneyPage.addStep();

    await pm.syntheticsJourneyPage.goBack();
    await pm.syntheticsJourneyPage.expectUnsavedDialogVisible();
    await pm.syntheticsJourneyPage.leaveUnsaved();
    testLogger.info('Test completed');
  });

  // ───────────────────────────────────────────────────────────────────────────
  // Data-dependent placeholders (WIRED, blocked by missing test-harness data)
  // ───────────────────────────────────────────────────────────────────────────

  test.fixme("Edit an existing check pre-fills the wizard — data-dependent: needs a seeded check via POST /api/{org}/synthetics (buildCreateBrowserTestPayload has no test-side helper yet)", async () => {
    testLogger.info('Skipped: editing requires a pre-existing check created via the synthetics API');
  });

  // ───────────────────────────────────────────────────────────────────────────
  // Feature-gap placeholders (UNWIRED — extension-only behaviors)
  // ───────────────────────────────────────────────────────────────────────────

  test.fixme('Gate → editor via Record when extension installed — requires OpenObserve Recorder extension, not present in CI (CreateBrowserTest.vue:538-545; useSyntheticsRecorder.ts:263-287)', async () => {
    testLogger.info('Skipped: requires OpenObserve Recorder extension, not present in CI');
  });

  test.fixme('Actual recording captures steps — requires extension startRecording ack (useSyntheticsRecorder.ts:435-473)', async () => {
    testLogger.info('Skipped: requires OpenObserve Recorder extension, not present in CI');
  });

  test.fixme('Replay / preview run — requires extension replay command (useSyntheticsRecorder.ts:694-784)', async () => {
    testLogger.info('Skipped: requires OpenObserve Recorder extension, not present in CI');
  });

  test.fixme('Restore-then-record (record-before / record-from-failure) — requires extension + capability (BrowserJourney.vue:614-707; useSyntheticsRecorder.ts:483-600)', async () => {
    testLogger.info('Skipped: requires OpenObserve Recorder extension, not present in CI');
  });

  test.fixme('Incognito / preflight / replay banners — require extension failure responses (BrowserJourney.vue:1252-1570; replayFailure.ts)', async () => {
    testLogger.info('Skipped: requires OpenObserve Recorder extension, not present in CI');
  });
});
