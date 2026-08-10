const { expect } = require('@playwright/test');
const testLogger = require('../../playwright-tests/utils/test-logger.js');
const { getOrgIdentifier } = require('../../playwright-tests/utils/cloud-auth.js');

class SyntheticsSetupPage {
  constructor(page) {
    this.page = page;

    // ===== ExtensionSetupChecklist shared selectors =====
    this.installBtn = '[data-test="synthetics-setup-install-btn"]';
    this.installAck = '[data-test="synthetics-setup-install-ack"]';
    this.installUndo = '[data-test="synthetics-setup-install-undo"]';
    this.incognitoAck = '[data-test="synthetics-setup-incognito-ack"]';
    this.incognitoUndo = '[data-test="synthetics-setup-incognito-undo"]';
    this.refreshBtn = '[data-test="synthetics-setup-refresh-btn"]';

    // ===== Context A: CreateBrowserTest extension-setup phase =====
    this.skipLink = '[data-test="synthetics-setup-skip-link"]';
    this.openRecordBtn = '[data-test="synthetics-setup-open-record-btn"]';

    // ===== Context B: ExtensionSetupDialog =====
    this.dialog = '[data-test="synthetics-journey-extension-setup-dialog"]';
    this.progressBadge = '[data-test="synthetics-setup-progress"]';
    this.continueBtn = '[data-test="synthetics-setup-continue-btn"]';
    this.dialogSkipLink = '[data-test="synthetics-setup-dialog-skip"]';

    // ===== BrowserJourney toolbar =====
    this.journeyRecordBtn = '[data-test="synthetics-journey-record-btn"]';
    this.journeyReplayBtn = '[data-test="synthetics-journey-replay-btn"]';

    // ===== OStepper (Journey editor step) =====
    this.stepperNav = '[data-test="navbar-main-nav"]';
  }

  // ── Navigation ──────────────────────────────────────────

  /**
   * Navigate to the extension-setup phase via deep-link shortcut.
   * @param {string} url - Target URL to record (default "https://example.com")
   * @param {string} name - Check name (default "TestCheck")
   */
  async navigateToExtensionSetupPhase(url = 'https://example.com', name = 'TestCheck') {
    const orgId = getOrgIdentifier();
    const setupUrl = `/web/synthetics/add?org_identifier=${orgId}&type=browser&url=${encodeURIComponent(url)}&name=${encodeURIComponent(name)}&setup=1`;
    testLogger.info('Navigating to extension setup phase', { url: setupUrl });
    await this.page.goto(setupUrl);
    await this.page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
    // Wait for the checklist to render (the extension probe takes ~500ms)
    await this.page.waitForSelector(this.installBtn, { timeout: 10000 });
    testLogger.info('Extension setup checklist rendered');
  }

  // ── Task 1: Install ─────────────────────────────────────

  async expectTask1Active() {
    await expect(this.page.locator(this.installBtn)).toBeVisible();
    await expect(this.page.locator(this.installAck)).toBeVisible();
    testLogger.info('Task 1 is active (install CTA + checkbox visible)');
  }

  async expectTask1Done() {
    // In E2E, connected is always false, so the "Undo" button is the indicator
    await expect(this.page.locator(this.installUndo)).toBeVisible();
    testLogger.info('Task 1 is done (undo button visible)');
  }

  async acknowledgeInstall() {
    testLogger.info('Acknowledging install via attestation checkbox');
    await this.page.locator(this.installAck).click();
  }

  async undoInstall() {
    testLogger.info('Undoing install attestation');
    await this.page.locator(this.installUndo).click();
  }

  /**
   * Click the "Install from Chrome Web Store" button.
   * Expects a new tab to open — returns the new page.
   */
  async clickInstallButton() {
    testLogger.info('Clicking install (CWS) button');
    const [newPage] = await Promise.all([
      this.page.context().waitForEvent('page'),
      this.page.locator(this.installBtn).click(),
    ]);
    await newPage.waitForLoadState('domcontentloaded');
    return newPage;
  }

  // ── Task 2: Incognito ───────────────────────────────────

  async expectTask2Locked() {
    // When locked, the checkbox and undo are not in the DOM
    await expect(this.page.locator(this.incognitoAck)).not.toBeVisible();
    await expect(this.page.locator(this.incognitoUndo)).not.toBeVisible();
    testLogger.info('Task 2 is locked');
  }

  async expectTask2Active() {
    await expect(this.page.locator(this.incognitoAck)).toBeVisible();
    testLogger.info('Task 2 is active (incognito checkbox visible)');
  }

  async expectTask2Done() {
    await expect(this.page.locator(this.incognitoUndo)).toBeVisible();
    testLogger.info('Task 2 is done (undo button visible)');
  }

  async expectTask2InstructionsVisible() {
    // Task 2 active state includes an <ol> with Chrome settings instructions
    // The ol is inside a .bg-surface-subtle div; assert by checking text content
    // that includes instruction keywords like "Allow" or "Incognito"
    const task2Content = this.page.locator('.bg-surface-subtle .list-decimal');
    await expect(task2Content).toBeVisible();
    testLogger.info('Task 2 instructions list is visible');
  }

  async acknowledgeIncognito() {
    testLogger.info('Acknowledging incognito via attestation checkbox');
    await this.page.locator(this.incognitoAck).click();
  }

  async undoIncognito() {
    testLogger.info('Undoing incognito attestation');
    await this.page.locator(this.incognitoUndo).click();
  }

  // ── Task 3: Connect ─────────────────────────────────────

  async expectTask3Locked() {
    await expect(this.page.locator(this.refreshBtn)).not.toBeVisible();
    testLogger.info('Task 3 is locked');
  }

  async expectTask3Waiting() {
    // In E2E, connected is always false, so Task 3 never reaches "done" —
    // it shows the waiting spinner with the refresh button visible
    await expect(this.page.locator(this.refreshBtn)).toBeVisible();
    testLogger.info('Task 3 is in waiting state (refresh button visible)');
  }

  /**
   * Click the "Refresh page" button in Task 3.
   * WARNING: This navigates away from the checklist (strips setup param).
   */
  async clickRefreshButton() {
    testLogger.info('Clicking refresh page button');
    await this.page.locator(this.refreshBtn).click();
  }

  // ── Context A: CreateBrowserTest specific ────────────────

  async expectSkipLinkVisible() {
    await expect(this.page.locator(this.skipLink)).toBeVisible();
    testLogger.info('Context A skip link is visible');
  }

  async expectOpenRecordBtnDisabled() {
    await expect(this.page.locator(this.openRecordBtn)).toBeDisabled();
    testLogger.info('Open Record button is disabled');
  }

  async clickSkipLink() {
    testLogger.info('Clicking Context A skip link');
    await this.page.locator(this.skipLink).click();
    // After skipping, the Journey editor step renders
    await this.page.waitForSelector(this.journeyRecordBtn, { timeout: 10000 });
    testLogger.info('Journey editor visible after skip');
  }

  async expectJourneyEditorVisible() {
    await expect(this.page.locator(this.journeyRecordBtn)).toBeVisible();
    await expect(this.page.locator(this.journeyReplayBtn)).toBeVisible();
    testLogger.info('Journey editor is visible (Record/Replay buttons present)');
  }

  /**
   * Assert the blocking hint text below the disabled "Open Record" button.
   * @param {string} text - Expected text content (substring match)
   */
  async expectContextABlockingHintContains(text) {
    // The hint is a <p> element below the open-record-btn
    await expect(this.page.getByText(text, { exact: false })).toBeVisible();
    testLogger.info('Context A blocking hint contains expected text', { text });
  }

  // ── Context B: ExtensionSetupDialog specific ─────────────

  async expectDialogVisible() {
    await expect(this.page.locator(this.dialog)).toBeVisible();
    testLogger.info('ExtensionSetupDialog is visible');
  }

  async expectDialogHidden() {
    await expect(this.page.locator(this.dialog)).not.toBeVisible();
    testLogger.info('ExtensionSetupDialog is hidden');
  }

  async expectContinueBtnDisabled() {
    await expect(this.page.locator(this.continueBtn)).toBeDisabled();
    testLogger.info('Continue button is disabled');
  }

  async expectDialogSkipVisible() {
    await expect(this.page.locator(this.dialogSkipLink)).toBeVisible();
    testLogger.info('Dialog skip link is visible');
  }

  async expectDialogSkipHidden() {
    await expect(this.page.locator(this.dialogSkipLink)).not.toBeVisible();
    testLogger.info('Dialog skip link is hidden');
  }

  async clickDialogSkip() {
    testLogger.info('Clicking dialog skip link');
    await this.page.locator(this.dialogSkipLink).click();
    // Wait for dialog to close
    await this.page.waitForSelector(this.dialog, { state: 'hidden', timeout: 5000 }).catch(() => {});
  }

  async clickJourneyRecordBtn() {
    testLogger.info('Clicking Journey Record button');
    await this.page.locator(this.journeyRecordBtn).click();
    // Wait for the dialog to appear
    await this.page.waitForSelector(this.dialog, { timeout: 10000 });
    testLogger.info('ExtensionSetupDialog opened');
  }

  async clickJourneyReplayBtn() {
    testLogger.info('Clicking Journey Replay button');
    await this.page.locator(this.journeyReplayBtn).click();
    // Wait for the dialog to appear
    await this.page.waitForSelector(this.dialog, { timeout: 10000 });
    testLogger.info('ExtensionSetupDialog opened via Replay');
  }

  async closeDialog() {
    testLogger.info('Closing ExtensionSetupDialog via Escape key');
    await this.page.keyboard.press('Escape');
    await this.page.waitForSelector(this.dialog, { state: 'hidden', timeout: 5000 }).catch(() => {});
  }

  // ── Progress badge (dialog only) ────────────────────────

  async expectProgressBadgeContains(text) {
    await expect(this.page.locator(this.progressBadge)).toContainText(text);
    testLogger.info('Progress badge contains expected text', { text });
  }

  /**
   * Assert the blocking hint text below the disabled Continue button in the dialog.
   * @param {string} text - Expected text content (substring match)
   */
  async expectDialogBlockingHintContains(text) {
    // The hint is a <p> element below the continue button inside the dialog footer
    const hintLocator = this.page.locator(this.dialog).getByText(text, { exact: false });
    await expect(hintLocator).toBeVisible();
    testLogger.info('Dialog blocking hint contains expected text', { text });
  }

  // ── Methods for fixme tests (UNWIRED, requires connected=true) ──

  async expectOpenRecordBtnEnabled() {
    await expect(this.page.locator(this.openRecordBtn)).toBeEnabled();
    testLogger.info('Open Record button is enabled');
  }

  async expectContinueBtnEnabled() {
    await expect(this.page.locator(this.continueBtn)).toBeEnabled();
    testLogger.info('Continue button is enabled');
  }

  async expectRefreshBtnNotVisible() {
    await expect(this.page.locator(this.refreshBtn)).not.toBeVisible();
    testLogger.info('Refresh button is not visible (Task 3 done)');
  }

  async expectDetectedAutoBadgeVisible() {
    await expect(this.page.getByText('Detected automatically')).toBeVisible();
    testLogger.info('Detected automatically badge is visible');
  }
}

module.exports = { SyntheticsSetupPage };
