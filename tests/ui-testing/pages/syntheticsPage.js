/**
 * SyntheticsPage — Page object for the Synthetics module (browser test creation,
 * extension setup, journey editor).
 *
 * This is the first Synthetics E2E page object. It covers:
 *   - Gate phase (URL + name inputs, Record / Build Manually buttons)
 *   - Extension Setup phase (checklist, incognito toggle, Open Recorder, Skip)
 *   - Editor phase (journey record/replay buttons, extension setup dialog)
 */
"use strict";

const { expect } = require("@playwright/test");
const testLogger = require("../playwright-tests/utils/test-logger.js");

class SyntheticsPage {
  constructor(page) {
    this.page = page;

    // ── Gate phase locators ──
    this.urlInput = '[data-test="synthetics-create-url-input"]';
    this.nameInput = '[data-test="synthetics-create-name-input"]';
    this.recordBtn = '[data-test="synthetics-create-record-btn"]';
    this.buildBtn = '[data-test="synthetics-create-build-btn"]';
    this.backBtn = '[data-test="synthetics-create-back-btn"]';

    // ── Extension Setup phase locators ──
    this.installBtn = '[data-test="synthetics-setup-install-btn"]';
    this.incognitoSwitch = '[data-test="synthetics-setup-incognito-switch"]';
    this.openRecorderBtn = '[data-test="synthetics-setup-open-record-btn"]';
    this.skipLink = '[data-test="synthetics-setup-skip-link"]';

    // ── Editor / Journey locators ──
    this.journeyRecordBtn = '[data-test="synthetics-journey-record-btn"]';
    this.journeyReplayBtn = '[data-test="synthetics-journey-replay-btn"]';
    this.journeyAddStepBtn = '[data-test="synthetics-journey-add-step-btn"]';

    // ── Extension Setup Dialog locators ──
    this.dialog = '[data-test="synthetics-journey-extension-setup-dialog"]';
    this.dialogPrimaryBtn =
      '[data-test="synthetics-journey-extension-setup-dialog"] [data-test="o-dialog-primary-btn"]';
    this.dialogSecondaryBtn =
      '[data-test="synthetics-journey-extension-setup-dialog"] [data-test="o-dialog-secondary-btn"]';
  }

  // ──────────────────────────────────────────────
  //  Gate phase actions
  // ──────────────────────────────────────────────

  /** Wait for the gate phase to be fully rendered. */
  async waitForGatePhase() {
    await expect(this.page.locator(this.urlInput)).toBeVisible({ timeout: 15000 });
    testLogger.info("Gate phase visible");
  }

  /** Type a value into the starting URL input. */
  async enterStartUrl(url) {
    await this.page.locator(this.urlInput).fill(url);
    // Blur to trigger validation by clicking the name input
    await this.page.locator(this.nameInput).click();
    testLogger.info(`Entered start URL: ${url}`);
  }

  /** Clear the URL input. */
  async clearUrlInput() {
    await this.page.locator(this.urlInput).clear();
    await this.page.locator(this.nameInput).click();
    testLogger.info("Cleared URL input");
  }

  /** Click the "Record Journey" button. */
  async clickRecordJourney() {
    await this.page.locator(this.recordBtn).click();
    testLogger.info("Clicked Record Journey button");
  }

  /** Click the "Build Manually" button. */
  async clickBuildManually() {
    await this.page.locator(this.buildBtn).click();
    testLogger.info("Clicked Build Manually button");
  }

  /** Expect the name input to be visible. */
  async expectNameInputVisible() {
    await expect(this.page.locator(this.nameInput)).toBeVisible();
    testLogger.info("Name input is visible");
  }

  /** Expect the back button/link to be visible. */
  async expectBackBtnVisible() {
    await expect(this.page.locator(this.backBtn)).toBeVisible();
    testLogger.info("Back button is visible");
  }

  /** Expect both Record and Build buttons to be disabled (empty/invalid URL). */
  async expectGateButtonsDisabled() {
    await expect(this.page.locator(this.recordBtn)).toBeDisabled();
    await expect(this.page.locator(this.buildBtn)).toBeDisabled();
    testLogger.info("Gate buttons are disabled");
  }

  /** Expect both Record and Build buttons to be enabled (valid URL). */
  async expectGateButtonsEnabled() {
    await expect(this.page.locator(this.recordBtn)).toBeEnabled();
    await expect(this.page.locator(this.buildBtn)).toBeEnabled();
    testLogger.info("Gate buttons are enabled");
  }

  /** Expect the URL error message to be visible (invalid URL entered). */
  async expectUrlErrorVisible() {
    // The URL validation error renders as the error-message slot of OInput
    // or a sibling text. Look for a red/destructive text element near the input.
    const errorLocator = this.page.locator(
      '[data-test="synthetics-create-url-input"] ~ .text-status-destructive, ' +
      '[data-test="synthetics-create-url-input"] + * .text-status-destructive, ' +
      '.text-status-destructive'
    ).first();
    await expect(errorLocator).toBeVisible({ timeout: 5000 });
    testLogger.info("URL error message is visible");
  }

  /** Expect the URL error message to be absent. */
  async expectUrlErrorNotVisible() {
    const errorLocator = this.page.locator(
      '[data-test="synthetics-create-url-input"] ~ .text-status-destructive, ' +
      '[data-test="synthetics-create-url-input"] + * .text-status-destructive, ' +
      '.text-status-destructive'
    );
    await expect(errorLocator).toHaveCount(0);
    testLogger.info("URL error message is not visible");
  }

  // ──────────────────────────────────────────────
  //  Extension Setup phase actions
  // ──────────────────────────────────────────────

  /** Wait for the extension-setup phase to be fully rendered. */
  async waitForExtensionSetupPhase() {
    await expect(this.page.locator(this.installBtn)).toBeVisible({ timeout: 15000 });
    testLogger.info("Extension setup phase visible");
  }

  /** Click the "Install" button (Step 1 — opens Chrome Web Store). */
  async clickInstallExtension() {
    await this.page.locator(this.installBtn).click();
    testLogger.info("Clicked Install extension button");
  }

  /** Toggle the incognito switch. Works in both full-page checklist and dialog. */
  async toggleIncognito() {
    await this.page.locator(this.incognitoSwitch).click();
    testLogger.info("Toggled incognito switch");
  }

  /** Expect the incognito switch to be visible. */
  async expectIncognitoSwitchVisible() {
    await expect(this.page.locator(this.incognitoSwitch)).toBeVisible();
    testLogger.info("Incognito switch is visible");
  }

  /** Expect the "Open Recorder" button to be visible. */
  async expectOpenRecorderBtnVisible() {
    await expect(this.page.locator(this.openRecorderBtn)).toBeVisible();
    testLogger.info("Open Recorder button is visible");
  }

  /** Expect the "Skip for now" link to be visible. */
  async expectSkipLinkVisible() {
    await expect(this.page.locator(this.skipLink)).toBeVisible();
    testLogger.info("Skip for now link is visible");
  }

  /** Expect the Install button to be hidden (not in current phase). */
  async expectInstallBtnHidden() {
    await expect(this.page.locator(this.installBtn)).toBeHidden({ timeout: 5000 });
    testLogger.info("Install button is hidden");
  }

  /** Click the "Skip for now" link. */
  async clickSkipForNow() {
    await this.page.locator(this.skipLink).click();
    testLogger.info("Clicked Skip for now");
  }

  /** Click the "Open Recorder" button. */
  async clickOpenRecorder() {
    await this.page.locator(this.openRecorderBtn).click();
    testLogger.info("Clicked Open Recorder button");
  }

  /** Expect Step 3 to be dimmed (opacity-60 class applied). */
  async expectStep3Dimmed() {
    const dimmed = this.page.locator(".opacity-60").filter({ has: this.page.locator("h4") }).first();
    await expect(dimmed).toBeVisible();
    testLogger.info("Step 3 is dimmed (opacity-60)");
  }

  /** Expect Step 3 to NOT be dimmed (opacity-60 class removed). */
  async expectStep3NotDimmed() {
    const dimmed = this.page.locator(".opacity-60").filter({ has: this.page.locator("h4") });
    await expect(dimmed).toHaveCount(0);
    testLogger.info("Step 3 is not dimmed");
  }

  /** Expect the "Open Recorder" button to be disabled. */
  async expectOpenRecorderDisabled() {
    await expect(this.page.locator(this.openRecorderBtn)).toBeDisabled();
    testLogger.info("Open Recorder button is disabled");
  }

  /** Expect the Record button to be in loading/disabled state (during probe). */
  async expectRecordButtonLoading() {
    await expect(this.page.locator(this.recordBtn)).toBeDisabled({ timeout: 2000 });
    testLogger.info("Record button is in loading/disabled state");
  }

  // ──────────────────────────────────────────────
  //  Editor / Journey phase actions
  // ──────────────────────────────────────────────

  /** Wait for the editor phase to render (journey add-step button visible). */
  async waitForEditorPhase() {
    await expect(this.page.locator(this.journeyAddStepBtn)).toBeVisible({ timeout: 15000 });
    testLogger.info("Editor phase visible");
  }

  /** Click the Record button in the journey toolbar. */
  async clickJourneyRecordBtn() {
    await this.page.locator(this.journeyRecordBtn).click();
    testLogger.info("Clicked Journey Record button");
  }

  /** Click the Replay button in the journey toolbar. */
  async clickJourneyReplayBtn() {
    await this.page.locator(this.journeyReplayBtn).click();
    testLogger.info("Clicked Journey Replay button");
  }

  /** Expect the Journey Record button to be visible. */
  async expectJourneyRecordBtnVisible() {
    await expect(this.page.locator(this.journeyRecordBtn)).toBeVisible();
    testLogger.info("Journey Record button is visible");
  }

  // ──────────────────────────────────────────────
  //  Extension Setup Dialog actions
  // ──────────────────────────────────────────────

  /** Expect the extension setup dialog to be visible. */
  async expectSetupDialogVisible() {
    await expect(this.page.locator(this.dialog)).toBeVisible({ timeout: 10000 });
    testLogger.info("Extension setup dialog is visible");
  }

  /** Expect the extension setup dialog to NOT be visible. */
  async expectSetupDialogNotVisible() {
    await expect(this.page.locator(this.dialog)).toBeHidden({ timeout: 5000 });
    testLogger.info("Extension setup dialog is not visible");
  }

  /** Click the dialog's secondary (Cancel) button to dismiss it. */
  async closeSetupDialog() {
    await this.page.locator(this.dialogSecondaryBtn).click();
    await expect(this.page.locator(this.dialog)).toBeHidden({ timeout: 5000 });
    testLogger.info("Closed extension setup dialog");
  }

  /** Expect the dialog's primary button to be disabled. */
  async expectDialogPrimaryDisabled() {
    await expect(this.page.locator(this.dialogPrimaryBtn)).toBeDisabled();
    testLogger.info("Dialog primary button is disabled");
  }
}

module.exports = SyntheticsPage;
