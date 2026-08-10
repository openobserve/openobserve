const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const PageManager = require('../../pages/page-manager.js');

test.describe("Synthetics Extension Setup Checklist testcases", () => {
  test.describe.configure({ mode: 'parallel' });
  let pm;

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    await navigateToBase(page);
    pm = new PageManager(page);
    // Navigate to the extension-setup phase via deep-link shortcut.
    // This is the common entry point for all Context A tests; Context B
    // tests extend from here by skipping and opening the dialog.
    await pm.syntheticsSetupPage.navigateToExtensionSetupPhase();
    testLogger.info('Test setup completed');
  });

  // ═══════════════════════════════════════════════════════════
  //  P0 — Context A: Core sequential gating in CreateBrowserTest
  // ═══════════════════════════════════════════════════════════

  test(
    "should render checklist with Task 1 active and Tasks 2 & 3 locked on deep-link entry",
    { tag: ['@syntheticsExtensionSetup', '@all', '@P0'] },
    async () => {
      testLogger.info('Verifying initial checklist state on deep-link entry');

      await pm.syntheticsSetupPage.expectTask1Active();
      await pm.syntheticsSetupPage.expectTask2Locked();
      await pm.syntheticsSetupPage.expectTask3Locked();
      await pm.syntheticsSetupPage.expectSkipLinkVisible();
      await pm.syntheticsSetupPage.expectOpenRecordBtnDisabled();

      testLogger.info('Test completed: checklist renders with correct initial state');
    },
  );

  test(
    "should complete Task 1 via attestation checkbox and unlock Task 2",
    { tag: ['@syntheticsExtensionSetup', '@all', '@P0'] },
    async () => {
      testLogger.info('Verifying Task 1 completion unlocks Task 2');

      // Pre-condition: Task 1 active, Task 2 locked
      await pm.syntheticsSetupPage.expectTask1Active();
      await pm.syntheticsSetupPage.expectTask2Locked();

      // Action: check install attestation
      await pm.syntheticsSetupPage.acknowledgeInstall();

      // Result: Task 1 done, Task 2 active, Task 3 still locked
      await pm.syntheticsSetupPage.expectTask1Done();
      await pm.syntheticsSetupPage.expectTask2Active();
      await pm.syntheticsSetupPage.expectTask3Locked();

      testLogger.info('Test completed: Task 1 done, Task 2 unlocked');
    },
  );

  test(
    "should complete Task 2 via attestation checkbox and unlock Task 3 in waiting state",
    { tag: ['@syntheticsExtensionSetup', '@all', '@P0'] },
    async () => {
      testLogger.info('Verifying Task 2 completion unlocks Task 3 (waiting state)');

      // Pre-condition: complete Task 1 first
      await pm.syntheticsSetupPage.acknowledgeInstall();
      await pm.syntheticsSetupPage.expectTask1Done();
      await pm.syntheticsSetupPage.expectTask2Active();
      await pm.syntheticsSetupPage.expectTask3Locked();

      // Action: check incognito attestation
      await pm.syntheticsSetupPage.acknowledgeIncognito();

      // Result: Task 2 done, Task 3 in waiting state (connected=false in E2E)
      await pm.syntheticsSetupPage.expectTask2Done();
      await pm.syntheticsSetupPage.expectTask3Waiting();
      // Open Record button stays disabled because setupAllDone requires connected=true
      await pm.syntheticsSetupPage.expectOpenRecordBtnDisabled();

      testLogger.info('Test completed: Task 2 done, Task 3 waiting, Open Record disabled');
    },
  );

  test(
    "should relock Tasks 2 and 3 when undo is clicked on Task 1 install attestation",
    { tag: ['@syntheticsExtensionSetup', '@all', '@P0'] },
    async () => {
      testLogger.info('Verifying undo install relocks downstream tasks');

      // Pre-condition: complete both Task 1 and Task 2
      await pm.syntheticsSetupPage.acknowledgeInstall();
      await pm.syntheticsSetupPage.acknowledgeIncognito();
      await pm.syntheticsSetupPage.expectTask1Done();
      await pm.syntheticsSetupPage.expectTask2Done();
      await pm.syntheticsSetupPage.expectTask3Waiting();

      // Action: click undo on Task 1
      await pm.syntheticsSetupPage.undoInstall();

      // Result: Task 1 back to active, Tasks 2 & 3 back to locked
      await pm.syntheticsSetupPage.expectTask1Active();
      await pm.syntheticsSetupPage.expectTask2Locked();
      await pm.syntheticsSetupPage.expectTask3Locked();

      testLogger.info('Test completed: undo install relocks Tasks 2 and 3');
    },
  );

  // ═══════════════════════════════════════════════════════════
  //  P0 — Context B: ExtensionSetupDialog from Journey toolbar
  // ═══════════════════════════════════════════════════════════

  test(
    "should enter Journey editor after clicking Skip from Context A checklist",
    { tag: ['@syntheticsExtensionSetup', '@all', '@P0'] },
    async () => {
      testLogger.info('Verifying skip link transitions to Journey editor');

      // Action: click Skip link
      await pm.syntheticsSetupPage.clickSkipLink();

      // Result: Journey editor is visible with Record/Replay buttons
      await pm.syntheticsSetupPage.expectJourneyEditorVisible();

      testLogger.info('Test completed: skip link enters Journey editor');
    },
  );

  test(
    "should open ExtensionSetupDialog on Record click with disabled Continue and visible Skip",
    { tag: ['@syntheticsExtensionSetup', '@all', '@P0'] },
    async () => {
      testLogger.info('Verifying dialog opens on Record click with correct initial state');

      // Pre-condition: skip to Journey editor
      await pm.syntheticsSetupPage.clickSkipLink();
      await pm.syntheticsSetupPage.expectJourneyEditorVisible();

      // Action: click Record
      await pm.syntheticsSetupPage.clickJourneyRecordBtn();

      // Result: dialog opens with Continue disabled, Skip visible, progress badge present
      await pm.syntheticsSetupPage.expectDialogVisible();
      await pm.syntheticsSetupPage.expectContinueBtnDisabled();
      await pm.syntheticsSetupPage.expectDialogSkipVisible();
      await pm.syntheticsSetupPage.expectProgressBadgeContains('0');

      testLogger.info('Test completed: dialog opens with correct initial state');
    },
  );

  test(
    "should show Task 3 waiting and keep Continue disabled after completing Tasks 1 & 2 in dialog",
    { tag: ['@syntheticsExtensionSetup', '@all', '@P0'] },
    async () => {
      testLogger.info('Verifying Tasks 1&2 completion in dialog, Task 3 waiting, Continue disabled');

      // Pre-condition: skip to Journey editor, open dialog
      await pm.syntheticsSetupPage.clickSkipLink();
      await pm.syntheticsSetupPage.clickJourneyRecordBtn();
      await pm.syntheticsSetupPage.expectDialogVisible();

      // Action: complete Tasks 1 and 2 inside the dialog
      await pm.syntheticsSetupPage.acknowledgeInstall();
      await pm.syntheticsSetupPage.expectTask2Active();
      await pm.syntheticsSetupPage.acknowledgeIncognito();
      await pm.syntheticsSetupPage.expectTask3Waiting();

      // Result: Continue stays disabled (allDone requires connected=true)
      await pm.syntheticsSetupPage.expectContinueBtnDisabled();

      testLogger.info('Test completed: Tasks 1&2 done, Task 3 waiting, Continue disabled');
    },
  );

  // ═══════════════════════════════════════════════════════════
  //  P1 — Important variations
  // ═══════════════════════════════════════════════════════════

  test(
    "should update progress badge reactively as tasks complete in dialog",
    { tag: ['@syntheticsExtensionSetup', '@all', '@P1'] },
    async () => {
      testLogger.info('Verifying progress badge updates with each task completion');

      // Pre-condition: skip to Journey editor, open dialog
      await pm.syntheticsSetupPage.clickSkipLink();
      await pm.syntheticsSetupPage.clickJourneyRecordBtn();
      await pm.syntheticsSetupPage.expectDialogVisible();

      // Initial: 0 of 3
      await pm.syntheticsSetupPage.expectProgressBadgeContains('0');

      // Complete Task 1: 1 of 3
      await pm.syntheticsSetupPage.acknowledgeInstall();
      await pm.syntheticsSetupPage.expectProgressBadgeContains('1');

      // Complete Task 2: 2 of 3 (never reaches 3 in E2E)
      await pm.syntheticsSetupPage.acknowledgeIncognito();
      await pm.syntheticsSetupPage.expectProgressBadgeContains('2');

      testLogger.info('Test completed: progress badge increments correctly');
    },
  );

  test(
    "should show Skip link for record action and hide it for replay action in dialog",
    { tag: ['@syntheticsExtensionSetup', '@all', '@P1'] },
    async () => {
      testLogger.info('Verifying Skip link visibility for record vs replay');

      // Pre-condition: skip to Journey editor
      await pm.syntheticsSetupPage.clickSkipLink();
      await pm.syntheticsSetupPage.expectJourneyEditorVisible();

      // Record dialog: Skip is visible
      await pm.syntheticsSetupPage.clickJourneyRecordBtn();
      await pm.syntheticsSetupPage.expectDialogSkipVisible();

      // Close dialog
      await pm.syntheticsSetupPage.closeDialog();
      await pm.syntheticsSetupPage.expectDialogHidden();

      // Replay dialog: Skip is NOT visible
      await pm.syntheticsSetupPage.clickJourneyReplayBtn();
      await pm.syntheticsSetupPage.expectDialogSkipHidden();

      testLogger.info('Test completed: Skip visible for record, hidden for replay');
    },
  );

  test(
    "should close dialog via skip link and return to Journey editor without starting a recording",
    { tag: ['@syntheticsExtensionSetup', '@all', '@P1'] },
    async () => {
      testLogger.info('Verifying dialog skip closes dialog and returns to Journey editor');

      // Pre-condition: skip to Journey editor, open record dialog
      await pm.syntheticsSetupPage.clickSkipLink();
      await pm.syntheticsSetupPage.clickJourneyRecordBtn();
      await pm.syntheticsSetupPage.expectDialogVisible();

      // Action: click dialog skip
      await pm.syntheticsSetupPage.clickDialogSkip();

      // Result: dialog closed, back on Journey editor
      await pm.syntheticsSetupPage.expectDialogHidden();
      await pm.syntheticsSetupPage.expectJourneyEditorVisible();

      testLogger.info('Test completed: dialog skip closes dialog, returns to Journey editor');
    },
  );

  test(
    "should keep Open Record button disabled when Task 3 is in waiting state (Tasks 1 & 2 done)",
    { tag: ['@syntheticsExtensionSetup', '@all', '@P1'] },
    async () => {
      testLogger.info('Verifying Open Record stays disabled after Tasks 1&2 complete in Context A');

      // Complete both Task 1 and Task 2 via attestation
      await pm.syntheticsSetupPage.acknowledgeInstall();
      await pm.syntheticsSetupPage.acknowledgeIncognito();
      await pm.syntheticsSetupPage.expectTask1Done();
      await pm.syntheticsSetupPage.expectTask2Done();
      await pm.syntheticsSetupPage.expectTask3Waiting();

      // Open Record button must stay disabled (setupAllDone requires connected=true)
      await pm.syntheticsSetupPage.expectOpenRecordBtnDisabled();

      testLogger.info('Test completed: Open Record stays disabled when Task 3 is waiting');
    },
  );

  test(
    "should relock only Task 3 when undo is clicked on Task 2 incognito attestation, leaving Task 1 done",
    { tag: ['@syntheticsExtensionSetup', '@all', '@P1'] },
    async () => {
      testLogger.info('Verifying undo incognito relocks only Task 3');

      // Pre-condition: complete both Task 1 and Task 2
      await pm.syntheticsSetupPage.acknowledgeInstall();
      await pm.syntheticsSetupPage.acknowledgeIncognito();
      await pm.syntheticsSetupPage.expectTask1Done();
      await pm.syntheticsSetupPage.expectTask2Done();
      await pm.syntheticsSetupPage.expectTask3Waiting();

      // Action: click undo on Task 2
      await pm.syntheticsSetupPage.undoIncognito();

      // Result: Task 2 back to active, Task 3 back to locked, Task 1 still done
      await pm.syntheticsSetupPage.expectTask1Done();
      await pm.syntheticsSetupPage.expectTask2Active();
      await pm.syntheticsSetupPage.expectTask3Locked();

      testLogger.info('Test completed: undo incognito relocks Task 3, Task 1 stays done');
    },
  );

  test(
    "should open Chrome Web Store in a new tab when Install button is clicked",
    { tag: ['@syntheticsExtensionSetup', '@all', '@P1'] },
    async () => {
      testLogger.info('Verifying install button opens a new tab');

      // Action: click install button and capture new page
      const newPage = await pm.syntheticsSetupPage.clickInstallButton();

      // Assert: new tab opened with Chrome Web Store URL
      expect(newPage.url()).toMatch(/chrome\.google\.com\/webstore/);
      // Task 1 should still be active (install not acknowledged)
      await pm.syntheticsSetupPage.expectTask1Active();

      // Cleanup: close the new tab
      await newPage.close();

      testLogger.info('Test completed: install button opens CWS in new tab');
    },
  );

  test(
    "should show contextual blocking hint text below disabled Continue button in dialog",
    { tag: ['@syntheticsExtensionSetup', '@all', '@P1'] },
    async () => {
      testLogger.info('Verifying blocking hint text is contextual');

      // Pre-condition: skip to Journey editor, open dialog
      await pm.syntheticsSetupPage.clickSkipLink();
      await pm.syntheticsSetupPage.clickJourneyRecordBtn();
      await pm.syntheticsSetupPage.expectDialogVisible();

      // With Task 1 active (nothing done): hint should mention install/setup
      await pm.syntheticsSetupPage.expectDialogBlockingHintContains('install');

      // Complete Task 1: hint should now mention incognito
      await pm.syntheticsSetupPage.acknowledgeInstall();
      await pm.syntheticsSetupPage.expectDialogBlockingHintContains('Incognito');

      // Complete Task 2: hint should mention connect/waiting
      await pm.syntheticsSetupPage.acknowledgeIncognito();
      await pm.syntheticsSetupPage.expectDialogBlockingHintContains('Connect');

      testLogger.info('Test completed: blocking hint updates contextually');
    },
  );

  test(
    "should open ExtensionSetupDialog on Replay click without the Skip link",
    { tag: ['@syntheticsExtensionSetup', '@all', '@P1'] },
    async () => {
      testLogger.info('Verifying Replay opens dialog without Skip link');

      // Pre-condition: skip to Journey editor
      await pm.syntheticsSetupPage.clickSkipLink();
      await pm.syntheticsSetupPage.expectJourneyEditorVisible();

      // Action: click Replay
      await pm.syntheticsSetupPage.clickJourneyReplayBtn();

      // Result: dialog opens, Skip is NOT visible, Continue disabled
      await pm.syntheticsSetupPage.expectDialogVisible();
      await pm.syntheticsSetupPage.expectDialogSkipHidden();
      await pm.syntheticsSetupPage.expectContinueBtnDisabled();

      testLogger.info('Test completed: Replay dialog opens without Skip link');
    },
  );

  // ═══════════════════════════════════════════════════════════
  //  P2 — Edge cases
  // ═══════════════════════════════════════════════════════════

  test(
    "should render Task 2 step-by-step instructions list when active",
    { tag: ['@syntheticsExtensionSetup', '@all', '@P2'] },
    async () => {
      testLogger.info('Verifying Task 2 instructions list renders when active');

      // Complete Task 1 to unlock Task 2
      await pm.syntheticsSetupPage.acknowledgeInstall();
      await pm.syntheticsSetupPage.expectTask1Done();
      await pm.syntheticsSetupPage.expectTask2Active();

      // Assert: the instructional ordered list is visible in Task 2
      await pm.syntheticsSetupPage.expectTask2InstructionsVisible();

      testLogger.info('Test completed: Task 2 instructions list visible');
    },
  );

  test(
    "should close dialog via Escape key and return to Journey editor",
    { tag: ['@syntheticsExtensionSetup', '@all', '@P2'] },
    async () => {
      testLogger.info('Verifying dialog closes via Escape and returns to Journey editor');

      // Pre-condition: skip to Journey editor, open dialog
      await pm.syntheticsSetupPage.clickSkipLink();
      await pm.syntheticsSetupPage.clickJourneyRecordBtn();
      await pm.syntheticsSetupPage.expectDialogVisible();

      // Action: press Escape
      await pm.syntheticsSetupPage.closeDialog();

      // Result: dialog hidden, back on Journey editor
      await pm.syntheticsSetupPage.expectDialogHidden();
      await pm.syntheticsSetupPage.expectJourneyEditorVisible();

      testLogger.info('Test completed: Escape closes dialog, returns to Journey editor');
    },
  );

  // ═══════════════════════════════════════════════════════════
  //  fixme — Behaviors requiring connected=true (UNWIRED in E2E)
  //  These all depend on a Chrome Recorder extension being installed
  //  and connected, which is never true in CI/headless browsers.
  //  They are kept as fixme with real assertion bodies so they go
  //  green as soon as the feature is wired (extension available).
  // ═══════════════════════════════════════════════════════════

  test.fixme(
    'Task 1 auto-completes via extension probe — UNWIRED (no extension in CI)',
    { tag: ['@syntheticsExtensionSetup', '@all', '@fixme'] },
    async () => {
      // This would assert that Task 1 shows "Detected automatically" badge
      // and the green checkmark without requiring the attestation checkbox.
      // Source: ExtensionSetupChecklist.vue:77-79 — v-if="connected" badge
      await pm.syntheticsSetupPage.expectTask1Done();
      // The "Detected automatically" badge would replace the Undo button
      await pm.syntheticsSetupPage.expectDetectedAutoBadgeVisible();
    },
  );

  test.fixme(
    'Task 3 completes with green check when extension connected — UNWIRED (no extension in CI)',
    { tag: ['@syntheticsExtensionSetup', '@all', '@fixme'] },
    async () => {
      // This would assert Task 3 shows done state (green check + "Detected automatically" badge)
      // Source: ExtensionSetupChecklist.vue:240-252 — connectDone = connected && incognitoDone
      await pm.syntheticsSetupPage.acknowledgeInstall();
      await pm.syntheticsSetupPage.acknowledgeIncognito();
      // Assert Task 3 is done (green check, no spinner), not waiting
      await pm.syntheticsSetupPage.expectRefreshBtnNotVisible();
    },
  );

  test.fixme(
    'Continue button enables when all three tasks done in dialog — UNWIRED (no extension in CI)',
    { tag: ['@syntheticsExtensionSetup', '@all', '@fixme'] },
    async () => {
      // Source: ExtensionSetupDialog.vue:67 — allDone = connected && incognitoDone
      // With the extension connected, after completing incognito attestation
      // the Continue button should become enabled.
      await pm.syntheticsSetupPage.clickSkipLink();
      await pm.syntheticsSetupPage.clickJourneyRecordBtn();
      await pm.syntheticsSetupPage.acknowledgeInstall();
      await pm.syntheticsSetupPage.acknowledgeIncognito();
      // Assert Continue button is enabled (when connected=true in real extension scenario)
      await pm.syntheticsSetupPage.expectContinueBtnEnabled();
    },
  );

  test.fixme(
    'Open Record button enables and starts recording — UNWIRED (no extension in CI)',
    { tag: ['@syntheticsExtensionSetup', '@all', '@fixme'] },
    async () => {
      // Source: CreateBrowserTest.vue:991-1001 — :disabled="!setupAllDone"
      // setupAllDone requires connected=true in addition to incognitoDone
      await pm.syntheticsSetupPage.acknowledgeInstall();
      await pm.syntheticsSetupPage.acknowledgeIncognito();
      // Assert Open Record button is enabled (requires connected=true)
      await pm.syntheticsSetupPage.expectOpenRecordBtnEnabled();
    },
  );

  test.fixme(
    'Incognito attestation triggers extension re-probe in dialog — UNWIRED (no extension in CI)',
    { tag: ['@syntheticsExtensionSetup', '@all', '@fixme'] },
    async () => {
      // Source: ExtensionSetupDialog.vue:61-66 — watch incognitoDone, emit verify
      // When connected=true and incognito ack is given, the verify event fires
      // and the parent re-probes the extension connection.
      await pm.syntheticsSetupPage.clickSkipLink();
      await pm.syntheticsSetupPage.clickJourneyRecordBtn();
      await pm.syntheticsSetupPage.acknowledgeInstall();
      // After incognito ack, the re-probe would be triggered
      await pm.syntheticsSetupPage.acknowledgeIncognito();
      // In the real scenario, the re-probe succeeds and Task 3 shows done
      testLogger.info('Re-probe would fire here if extension were available');
    },
  );

  test.fixme(
    'Install attestation superseded by live probe — UNWIRED (no extension in CI)',
    { tag: ['@syntheticsExtensionSetup', '@all', '@fixme'] },
    async () => {
      // Source: ExtensionSetupChecklist.vue:77-79 — v-if="connected" for auto-detected badge
      // When the extension is connected, the attestation checkbox is replaced
      // by a "Detected automatically" badge and the Undo button is hidden.
      await pm.syntheticsSetupPage.acknowledgeInstall();
      await pm.syntheticsSetupPage.expectTask1Done();
      // In connected scenario, the undo button would NOT be visible
      // (replaced by auto-detected badge)
      await pm.syntheticsSetupPage.expectDetectedAutoBadgeVisible();
    },
  );
});
