/**
 * Synthetics Extension Setup Dialog — E2E spec
 *
 * Tests the three-phase wizard (gate → extension-setup → editor) in
 * CreateBrowserTest.vue, the ExtensionSetupChecklist component, and the
 * ExtensionSetupDialog modal triggered from BrowserJourney.vue.
 *
 * No Chrome extension exists in Playwright's Chromium, so the `connected`
 * state can never be reached. This spec focuses on what IS reachable:
 * phase transitions, rendering, disabled states, and the skip/build bypasses.
 */

const { test, expect, navigateToBase } = require("../utils/enhanced-baseFixtures.js");
const testLogger = require("../utils/test-logger.js");
const PageManager = require("../../pages/page-manager.js");
const { getOrgIdentifier } = require("../utils/cloud-auth.js");

test.describe("Synthetics Extension Setup testcases", () => {
  test.describe.configure({ mode: "parallel" });
  let pm;

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    await navigateToBase(page);
    pm = new PageManager(page);

    const BASE = process.env["ZO_BASE_URL"];
    await page.goto(
      `${BASE}/web/synthetics/add?type=browser&org_identifier=${getOrgIdentifier()}`,
    );
    await page.waitForLoadState("networkidle", { timeout: 30000 }).catch(() => {});

    testLogger.info("Synthetics extension setup test setup completed");
  });

  // ════════════════════════════════════════════════════════════════
  // P0 — Critical Path Scenarios
  // ════════════════════════════════════════════════════════════════

  test(
    "should render gate phase with URL, Name inputs and disabled buttons",
    { tag: ["@synthetics-extension-setup", "@all"] },
    async ({ page }) => {
      testLogger.info("Verifying gate phase renders correctly");

      await pm.syntheticsPage.waitForGatePhase();
      await pm.syntheticsPage.expectNameInputVisible();
      await pm.syntheticsPage.expectBackBtnVisible();
      await pm.syntheticsPage.expectGateButtonsDisabled();

      testLogger.info("Gate phase renders with all expected controls");
    },
  );

  test(
    "should validate gate URL — show error on invalid, enable buttons on valid",
    { tag: ["@synthetics-extension-setup", "@all"] },
    async () => {
      testLogger.info("Testing gate URL validation");

      await pm.syntheticsPage.waitForGatePhase();

      // Enter invalid URL — triggers validation on blur
      await pm.syntheticsPage.enterStartUrl("not-a-url");
      await pm.syntheticsPage.expectUrlErrorVisible();

      // Clear the URL — error should disappear, buttons disabled
      await pm.syntheticsPage.clearUrlInput();
      await pm.syntheticsPage.expectUrlErrorNotVisible();
      await pm.syntheticsPage.expectGateButtonsDisabled();

      // Enter valid URL — error gone, buttons enabled
      await pm.syntheticsPage.enterStartUrl("https://example.com");
      await pm.syntheticsPage.expectUrlErrorNotVisible();
      await pm.syntheticsPage.expectGateButtonsEnabled();

      testLogger.info("Gate URL validation works correctly");
    },
  );

  test(
    'should transition to extension-setup phase after clicking "Record Journey"',
    { tag: ["@synthetics-extension-setup", "@all"] },
    async () => {
      testLogger.info("Testing Record Journey → extension-setup transition");

      await pm.syntheticsPage.waitForGatePhase();
      await pm.syntheticsPage.enterStartUrl("https://example.com");

      // Click Record — probeExtension runs (timeout 4s, returns false w/o extension)
      await pm.syntheticsPage.clickRecordJourney();

      // Wait for the extension-setup phase to render
      await pm.syntheticsPage.waitForExtensionSetupPhase();

      // Verify all expected elements are present
      await pm.syntheticsPage.expectIncognitoSwitchVisible();
      await pm.syntheticsPage.expectOpenRecorderBtnVisible();
      await pm.syntheticsPage.expectSkipLinkVisible();
      await pm.syntheticsPage.expectOpenRecorderDisabled();
      await pm.syntheticsPage.expectStep3Dimmed();

      testLogger.info("Extension setup phase renders correctly after Record Journey");
    },
  );

  test(
    'should skip extension setup via "Build Manually" and go directly to editor phase',
    { tag: ["@synthetics-extension-setup", "@all"] },
    async () => {
      testLogger.info("Testing Build Manually bypass");

      await pm.syntheticsPage.waitForGatePhase();
      await pm.syntheticsPage.enterStartUrl("https://example.com");

      // Click Build Manually — should go directly to editor
      await pm.syntheticsPage.clickBuildManually();
      await pm.syntheticsPage.waitForEditorPhase();

      // Verify no extension setup checklist is shown
      await pm.syntheticsPage.expectInstallBtnHidden();
      // Journey Record button should be visible in the editor
      await pm.syntheticsPage.expectJourneyRecordBtnVisible();

      testLogger.info("Build Manually goes directly to editor phase");
    },
  );

  test(
    'should transition to editor phase after clicking "Skip for now"',
    { tag: ["@synthetics-extension-setup", "@all"] },
    async () => {
      testLogger.info("Testing Skip for now path");

      // Reach extension-setup phase first
      await pm.syntheticsPage.waitForGatePhase();
      await pm.syntheticsPage.enterStartUrl("https://example.com");
      await pm.syntheticsPage.clickRecordJourney();
      await pm.syntheticsPage.waitForExtensionSetupPhase();

      // Click Skip for now
      await pm.syntheticsPage.clickSkipForNow();
      await pm.syntheticsPage.waitForEditorPhase();

      // Verify extension setup is gone
      await pm.syntheticsPage.expectInstallBtnHidden();

      testLogger.info("Skip for now transitions to editor phase");
    },
  );

  // ════════════════════════════════════════════════════════════════
  // P1 — Important Variations
  // ════════════════════════════════════════════════════════════════

  test(
    "should show Step 3 dimmed initially and un-dim after incognito toggle",
    { tag: ["@synthetics-extension-setup", "@all"] },
    async () => {
      testLogger.info("Testing Step 3 dimming state machine");

      // Reach extension-setup phase
      await pm.syntheticsPage.waitForGatePhase();
      await pm.syntheticsPage.enterStartUrl("https://example.com");
      await pm.syntheticsPage.clickRecordJourney();
      await pm.syntheticsPage.waitForExtensionSetupPhase();

      // Step 3 should be dimmed initially
      await pm.syntheticsPage.expectStep3Dimmed();

      // Toggle incognito — Step 3 should no longer be dimmed
      await pm.syntheticsPage.toggleIncognito();
      await pm.syntheticsPage.expectStep3NotDimmed();

      testLogger.info("Incognito toggle correctly controls Step 3 dimming");
    },
  );

  test(
    'should keep "Open Recorder" disabled even after incognito toggle (no extension)',
    { tag: ["@synthetics-extension-setup", "@all"] },
    async () => {
      testLogger.info("Testing Open Recorder stays disabled without extension");

      // Reach extension-setup phase
      await pm.syntheticsPage.waitForGatePhase();
      await pm.syntheticsPage.enterStartUrl("https://example.com");
      await pm.syntheticsPage.clickRecordJourney();
      await pm.syntheticsPage.waitForExtensionSetupPhase();

      // Open Recorder should be disabled before any action
      await pm.syntheticsPage.expectOpenRecorderDisabled();

      // Toggle incognito — Open Recorder should STILL be disabled
      // (extensionReady is still false — no Chrome extension in Playwright)
      await pm.syntheticsPage.toggleIncognito();
      await pm.syntheticsPage.expectOpenRecorderDisabled();

      testLogger.info("Open Recorder stays disabled without extension connected");
    },
  );

  test(
    "should open Chrome Web Store in new tab when Install button is clicked",
    { tag: ["@synthetics-extension-setup", "@all"] },
    async ({ page }) => {
      testLogger.info("Testing Install button opens new tab");

      // Reach extension-setup phase
      await pm.syntheticsPage.waitForGatePhase();
      await pm.syntheticsPage.enterStartUrl("https://example.com");
      await pm.syntheticsPage.clickRecordJourney();
      await pm.syntheticsPage.waitForExtensionSetupPhase();

      // Set up listener for new page/tab before clicking
      const pagePromise = page.context().waitForEvent("page");

      await pm.syntheticsPage.clickInstallExtension();

      // Verify a new page was opened
      const newPage = await pagePromise;
      testLogger.info(`New tab opened: ${newPage.url()}`);
      // The URL should be the Chrome Web Store (or custom URL from config)
      await expect(newPage.url()).toMatch(/^https?:\/\//);

      // Clean up the new page — close it
      await newPage.close();
      testLogger.info("Install button opens new tab successfully");
    },
  );

  test(
    "should open extension setup dialog from Journey Record button",
    { tag: ["@synthetics-extension-setup", "@all"] },
    async () => {
      testLogger.info("Testing extension setup dialog from Record button");

      // Reach editor phase via Build Manually
      await pm.syntheticsPage.waitForGatePhase();
      await pm.syntheticsPage.enterStartUrl("https://example.com");
      await pm.syntheticsPage.clickBuildManually();
      await pm.syntheticsPage.waitForEditorPhase();

      // Click Record in the journey toolbar
      await pm.syntheticsPage.clickJourneyRecordBtn();

      // Verify the setup dialog opens
      await pm.syntheticsPage.expectSetupDialogVisible();
      // The primary button should be disabled (connected is false)
      await pm.syntheticsPage.expectDialogPrimaryDisabled();

      testLogger.info("Extension setup dialog opens from Journey Record button");
    },
  );

  test(
    "should open extension setup dialog from Journey Replay button",
    { tag: ["@synthetics-extension-setup", "@all"] },
    async () => {
      testLogger.info("Testing extension setup dialog from Replay button");

      // Reach editor phase via Build Manually
      await pm.syntheticsPage.waitForGatePhase();
      await pm.syntheticsPage.enterStartUrl("https://example.com");
      await pm.syntheticsPage.clickBuildManually();
      await pm.syntheticsPage.waitForEditorPhase();

      // The Replay button is disabled when there are zero steps
      // (BrowserJourney: :disabled="readonly || modelValue.length === 0").
      // Add a blank step so the button becomes clickable.
      await pm.syntheticsPage.clickJourneyAddStepBtn();

      // Click Replay in the journey toolbar
      await pm.syntheticsPage.clickJourneyReplayBtn();

      // Verify the setup dialog opens
      await pm.syntheticsPage.expectSetupDialogVisible();
      // The primary button should be disabled (connected is false)
      await pm.syntheticsPage.expectDialogPrimaryDisabled();

      testLogger.info("Extension setup dialog opens from Journey Replay button");
    },
  );

  test(
    "should keep dialog primary button disabled after incognito toggle (no extension)",
    { tag: ["@synthetics-extension-setup", "@all"] },
    async () => {
      testLogger.info("Testing dialog primary button stays disabled");

      // Reach editor and open the dialog via Record
      await pm.syntheticsPage.waitForGatePhase();
      await pm.syntheticsPage.enterStartUrl("https://example.com");
      await pm.syntheticsPage.clickBuildManually();
      await pm.syntheticsPage.waitForEditorPhase();
      await pm.syntheticsPage.clickJourneyRecordBtn();
      await pm.syntheticsPage.expectSetupDialogVisible();

      // Primary button should be disabled initially
      await pm.syntheticsPage.expectDialogPrimaryDisabled();

      // Toggle incognito inside the dialog — button should STAY disabled
      await pm.syntheticsPage.toggleIncognito();
      await pm.syntheticsPage.expectDialogPrimaryDisabled();

      testLogger.info("Dialog primary button stays disabled without extension");
    },
  );

  // ════════════════════════════════════════════════════════════════
  // P2 — Edge Cases & Nice-to-Have
  // ════════════════════════════════════════════════════════════════

  test(
    "should persist incognito toggle state across dialog close/reopen",
    { tag: ["@synthetics-extension-setup", "@all"] },
    async () => {
      testLogger.info("Testing incognito state persistence across dialog close/reopen");

      // Reach editor and open the dialog via Record
      await pm.syntheticsPage.waitForGatePhase();
      await pm.syntheticsPage.enterStartUrl("https://example.com");
      await pm.syntheticsPage.clickBuildManually();
      await pm.syntheticsPage.waitForEditorPhase();
      await pm.syntheticsPage.clickJourneyRecordBtn();
      await pm.syntheticsPage.expectSetupDialogVisible();

      // Toggle incognito ON in the dialog
      await pm.syntheticsPage.toggleIncognito();
      // Step 3 in the dialog checklist should no longer be dimmed
      await pm.syntheticsPage.expectStep3NotDimmed();

      // Close the dialog
      await pm.syntheticsPage.closeSetupDialog();
      await pm.syntheticsPage.expectSetupDialogNotVisible();

      // Reopen the dialog
      await pm.syntheticsPage.clickJourneyRecordBtn();
      await pm.syntheticsPage.expectSetupDialogVisible();

      // Incognito toggle should still be ON, Step 3 should NOT be dimmed
      await pm.syntheticsPage.expectStep3NotDimmed();

      testLogger.info("Incognito state persists across dialog close/reopen");
    },
  );

  test(
    "should show loading state on Record button during extension probe",
    { tag: ["@synthetics-extension-setup", "@all"] },
    async () => {
      testLogger.info("Testing Record button loading state during probe");

      await pm.syntheticsPage.waitForGatePhase();
      await pm.syntheticsPage.enterStartUrl("https://example.com");

      // Click Record — this triggers probeExtension which takes up to 4 seconds
      await pm.syntheticsPage.clickRecordJourney();

      // After clicking, the button should be disabled while probing
      // probeExtension has a 4-second timeout in E2E (no extension installed)
      await pm.syntheticsPage.expectRecordButtonLoading();

      // Wait for the probe to complete and phase to transition
      await pm.syntheticsPage.waitForExtensionSetupPhase();

      testLogger.info("Record button showed loading state during probe");
    },
  );
});
