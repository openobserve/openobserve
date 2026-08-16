// Copyright 2026 OpenObserve Inc.
//
// Page object for the Synthetics Browser Test journey recorder (CreateBrowserTest wizard).
// Drives the gate → extension-setup → editor (Journey + Configure) flow purely through
// `data-test` selectors. All selector strings live here as properties; the spec only calls
// `pm.syntheticsJourneyPage.<method>()`.
import { expect } from '@playwright/test';
import { getAuthHeaders, getOrgIdentifier } from '../../playwright-tests/utils/cloud-auth.js';

export class SyntheticsJourneyPage {
  constructor(page) {
    this.page = page;

    // ── List page (SyntheticMonitoring) ────────────────────────────────────
    this.newCheckBtn = '[data-test="synthetic-monitoring-new-check-btn"]';
    this.monitorsTable = '[data-test="synthetic-monitoring-monitors-table"]';

    // ── Gate phase ──────────────────────────────────────────────────────────
    this.urlInputField = '[data-test="synthetics-create-url-input-field"]';
    this.nameInputField = '[data-test="synthetics-create-name-input-field"]';
    this.recordBtn = '[data-test="synthetics-create-record-btn"]';
    this.buildBtn = '[data-test="synthetics-create-build-btn"]';
    this.continueBtn = '[data-test="synthetics-create-continue-btn"]';
    this.saveBtn = '[data-test="synthetics-create-save-btn"]';
    this.backBtn = '[data-test="synthetics-create-back-btn"]';
    this.unsavedDialog = '[data-test="synthetics-create-unsaved-dialog"]';
    this.unsavedLeaveBtn = '[data-test="synthetics-create-unsaved-dialog"] [data-test="o-dialog-primary-btn"]';

    // ── Extension setup phase ───────────────────────────────────────────────
    this.setupInstallBtn = '[data-test="synthetics-setup-install-btn"]';
    this.setupOpenRecordBtn = '[data-test="synthetics-setup-open-record-btn"]';
    this.setupSkipLink = '[data-test="synthetics-setup-skip-link"]';

    // ── Journey editor (toolbar / step list) ────────────────────────────────
    this.addStepBtn = '[data-test="synthetics-journey-add-step-btn"]';
    this.stepActionSelectTrigger = '[data-test="synthetics-journey-step-action-select-trigger"]';
    this.stepNameInputField = '[data-test="synthetics-journey-step-name-input-field"]';
    this.stepValueInputField = '[data-test="synthetics-journey-step-value-input-field"]';
    this.stepInsertBtn = '[data-test="synthetics-journey-step-insert-btn"]';
    this.stepDuplicateBtn = '[data-test="synthetics-journey-step-duplicate-btn"]';
    this.stepDeleteBtn = '[data-test="synthetics-journey-step-delete-btn"]';

    // ── Locator bundle editor ───────────────────────────────────────────────
    this.locatorOverrideInputField = '[data-test="synthetics-journey-step-locator-override-input-field"]';
    this.locatorOverrideError = '[data-test="synthetics-journey-step-locator-override-input-error"]';
    this.locatorRow = '[data-test="synthetics-journey-step-locator-row"]';
    this.locatorError = '[data-test="synthetics-journey-step-locator-error"]';
    this.locatorDeleteBtn = '[data-test="synthetics-journey-step-locator-delete-btn"]';

    // ── Configure step ──────────────────────────────────────────────────────
    this.detailsNameInputField = '[data-test="synthetics-check-details-name-input-field"]';
    this.detailsUrlInputField = '[data-test="synthetics-check-details-url-input-field"]';

    // ── Toasts / dialogs ────────────────────────────────────────────────────
    this.toastMessage = '[data-test="o-toast-message"]';
    this.confirmDialogPrimary = '[data-test="confirm-dialog"] [data-test="o-dialog-primary-btn"]';
  }

  orgIdentifier() {
    return getOrgIdentifier() || process.env['ORGNAME'] || 'default';
  }

  // ── Navigation ───────────────────────────────────────────────────────────

  async gotoList() {
    await this.page.goto(
      `${process.env['ZO_BASE_URL']}/web/synthetics?org_identifier=${this.orgIdentifier()}`,
      { waitUntil: 'domcontentloaded' },
    );
    await this.page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
  }

  async gotoCreate() {
    await this.page.goto(
      `${process.env['ZO_BASE_URL']}/web/synthetics/add?type=browser&org_identifier=${this.orgIdentifier()}`,
      { waitUntil: 'domcontentloaded' },
    );
    await this.page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
  }

  /**
   * Environment gate: the synthetics route tree is registered only on enterprise/cloud
   * builds (useEnterpriseRoutes.ts:174). Returns true when the list page renders.
   */
  async isAvailable() {
    return await this.page
      .locator(this.newCheckBtn)
      .isVisible({ timeout: 8000 })
      .catch(() => false);
  }

  // ── Gate phase ───────────────────────────────────────────────────────────

  async expectGateVisible() {
    await expect(this.page.locator(this.urlInputField)).toBeVisible({ timeout: 15000 });
  }

  async fillGate(url, name) {
    await this.page.locator(this.urlInputField).fill(url);
    await this.page.locator(this.nameInputField).fill(name);
  }

  async expectGateCtasDisabled() {
    await expect(this.page.locator(this.recordBtn)).toBeDisabled();
    await expect(this.page.locator(this.buildBtn)).toBeDisabled();
  }

  async expectGateCtasEnabled() {
    await expect(this.page.locator(this.recordBtn)).toBeEnabled();
    await expect(this.page.locator(this.buildBtn)).toBeEnabled();
  }

  async buildManually() {
    await this.page.locator(this.buildBtn).click();
  }

  async recordFromGate() {
    await this.page.locator(this.recordBtn).click();
  }

  async expectEditorVisible() {
    await expect(this.page.locator(this.addStepBtn)).toBeVisible({ timeout: 15000 });
  }

  // ── Extension setup phase ────────────────────────────────────────────────

  async expectSetupChecklist() {
    // The probe (≈500ms + 4s command timeout) lands here; wait generously.
    await expect(this.page.locator(this.setupInstallBtn)).toBeVisible({ timeout: 15000 });
    await expect(this.page.locator(this.setupOpenRecordBtn)).toBeDisabled();
  }

  async skipExtensionSetup() {
    await this.page.locator(this.setupSkipLink).click();
  }

  // ── Journey step CRUD ────────────────────────────────────────────────────

  async addStep() {
    await this.page.locator(this.addStepBtn).click();
  }

  async setStepAction(stepIndex, action) {
    await this.page.locator(this.stepActionSelectTrigger).nth(stepIndex).click();
    const option = this.page.locator(
      `[data-test="synthetics-journey-step-action-select-option"][data-test-value="${action}"]`,
    );
    await option.click();
  }

  async setStepName(stepIndex, name) {
    await this.page.locator(this.stepNameInputField).nth(stepIndex).fill(name);
  }

  async setStepValue(value) {
    await this.page.locator(this.stepValueInputField).first().fill(value);
  }

  async insertStepBelow(stepIndex) {
    await this.page.locator(this.stepInsertBtn).nth(stepIndex).click();
  }

  async duplicateStepAt(stepIndex) {
    await this.page.locator(this.stepDuplicateBtn).nth(stepIndex).click();
  }

  async deleteStepAt(stepIndex) {
    await this.page.locator(this.stepDeleteBtn).nth(stepIndex).click();
    await this.page.locator(this.confirmDialogPrimary).click();
    await this.page
      .locator('[data-test="confirm-dialog"]')
      .waitFor({ state: 'hidden', timeout: 5000 })
      .catch(() => {});
  }

  async expectStepCount(count) {
    await expect(this.page.locator(this.stepDeleteBtn)).toHaveCount(count);
  }

  // ── Locator bundle editing ───────────────────────────────────────────────

  /** Type into the "add your own" locator input WITHOUT committing (a pending draft). */
  async typeLocatorDraft(selector) {
    await this.page.locator(this.locatorOverrideInputField).first().fill(selector);
  }

  /** Commit the draft locator: type it and press Enter (addOwn). */
  async commitLocator(selector) {
    const input = this.page.locator(this.locatorOverrideInputField).first();
    await input.fill(selector);
    await input.press('Enter');
  }

  async expectLocatorCandidate(selector) {
    await expect(
      this.page.locator(this.locatorRow).filter({ hasText: selector }).first(),
    ).toBeVisible({ timeout: 5000 });
  }

  async expectLocatorCandidateCount(count) {
    await expect(this.page.locator(this.locatorRow)).toHaveCount(count);
  }

  async expectLocatorErrorVisible() {
    await expect(this.page.locator(this.locatorError)).toBeVisible({ timeout: 5000 });
  }

  async expectLocatorDraftPending() {
    await expect(this.page.locator(this.locatorOverrideError)).toContainText(
      'Press Enter or +',
      { timeout: 5000 },
    );
  }

  async clickLocatorDeleteAt(stepIndex) {
    await this.page.locator(this.locatorDeleteBtn).nth(stepIndex).click();
  }

  // ── Continue / Configure ─────────────────────────────────────────────────

  async continueToConfigure() {
    await this.page.locator(this.continueBtn).click();
  }

  async expectOnJourneyStep() {
    await expect(this.page.locator(this.addStepBtn)).toBeVisible();
    // OStepper is a wizard: CheckConfigure (details inputs) is unmounted off-step.
    await expect(this.page.locator(this.detailsNameInputField)).toHaveCount(0);
  }

  async expectConfigureVisible() {
    await expect(this.page.locator(this.detailsNameInputField)).toBeVisible({ timeout: 10000 });
  }

  async expectDetailsPrefilled(name, url) {
    await expect(this.page.locator(this.detailsNameInputField)).toHaveValue(name);
    await expect(this.page.locator(this.detailsUrlInputField)).toHaveValue(url);
  }

  async selectLocation(locationId) {
    await this.page.locator(`[data-test="synthetics-check-locations-option-${locationId}"]`).click();
  }

  async saveAndExit() {
    await this.page.locator(this.saveBtn).click();
  }

  async expectSavedToast() {
    await expect(
      this.page.locator(this.toastMessage).filter({ hasText: 'Check saved successfully.' }).first(),
    ).toBeVisible({ timeout: 15000 });
  }

  async expectInList(name) {
    await this.page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
    await expect(
      this.page.getByText(name, { exact: false }).first(),
    ).toBeVisible({ timeout: 15000 });
  }

  async expectToastWithText(text) {
    await expect(
      this.page.locator(this.toastMessage).filter({ hasText: text }).first(),
    ).toBeVisible({ timeout: 10000 });
  }

  // ── Unsaved-changes guard ────────────────────────────────────────────────

  async goBack() {
    await this.page.locator(this.backBtn).click();
  }

  async expectUnsavedDialogVisible() {
    await expect(this.page.locator(this.unsavedDialog)).toBeVisible({ timeout: 10000 });
  }

  async leaveUnsaved() {
    await this.page.locator(this.unsavedLeaveBtn).click();
  }

  // ── API helpers ──────────────────────────────────────────────────────────

  /**
   * Enabled public browser locations (mirrors CreateBrowserTest.vue:311-322).
   * Empty when the endpoint is unavailable or no usable location exists.
   */
  async getEnabledPublicBrowserLocations() {
    const resp = await this.page.request.get(
      `${process.env['ZO_BASE_URL']}/api/${this.orgIdentifier()}/synthetics/locations`,
      { headers: getAuthHeaders() },
    );
    if (!resp.ok()) return [];
    const body = await resp.json().catch(() => ({}));
    const locations = body?.data?.locations ?? body?.locations ?? [];
    return locations.filter(
      (l) => l.enabled !== false && (l.kind !== 'private' || (l.types ?? []).includes('browser')),
    );
  }

  /** Best-effort cleanup: delete the created check by name (never throws). */
  async deleteCheckByName(name) {
    try {
      const org = this.orgIdentifier();
      const listResp = await this.page.request.get(
        `${process.env['ZO_BASE_URL']}/api/${org}/synthetics`,
        { headers: getAuthHeaders() },
      );
      if (!listResp.ok()) return;
      const body = await listResp.json().catch(() => ({}));
      const checks = body?.data ?? body?.list ?? [];
      const match = checks.find((c) => c.name === name);
      if (!match) return;
      await this.page.request.delete(
        `${process.env['ZO_BASE_URL']}/api/${org}/synthetics/${match.id}?folder=${match.folder_id || 'default'}`,
        { headers: getAuthHeaders() },
      );
    } catch (_) {
      // Cleanup is best-effort; a failure here must not fail the test.
    }
  }
}

export default SyntheticsJourneyPage;
