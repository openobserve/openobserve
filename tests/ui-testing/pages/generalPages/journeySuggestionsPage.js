/**
 * Journey Suggestions Toolbar Chip — Page Object
 *
 * Covers the JourneySuggestions chip/panel inside the BrowserJourney editor
 * toolbar (Create Browser Test wizard). All selectors are data-test backed.
 */

import { expect } from '@playwright/test';

export class JourneySuggestionsPage {
  constructor(page) {
    this.page = page;

    // ── Chip (toolbar badge) ────────────────────────────────────────────
    this.suggestionsChip = page.locator(
      '[data-test="synthetics-journey-suggestions-chip"]',
    );

    // ── Popover panel ───────────────────────────────────────────────────
    this.suggestionsPanel = page.locator(
      '[data-test="synthetics-journey-suggestions-panel"]',
    );

    // ── Suggestion cards ────────────────────────────────────────────────
    this.zeroAssertionCard = page.locator(
      '[data-test="synthetics-journey-suggestion-zero-assertion"]',
    );
    this.zeroAssertionActionBtn = page.locator(
      '[data-test="synthetics-journey-suggestion-action-zero-assertion"]',
    );
    this.noTestAttrCard = page.locator(
      '[data-test="synthetics-journey-suggestion-no-test-attribute"]',
    );

    // ── Footer ──────────────────────────────────────────────────────────
    this.nonblockingFooter = page.locator(
      '[data-test="synthetics-journey-suggestions-nonblocking"]',
    );

    // ── Parent toolbar controls ─────────────────────────────────────────
    this.addStepBtn = page.locator(
      '[data-test="synthetics-journey-add-step-btn"]',
    );

    // ── Step row actions ────────────────────────────────────────────────
    this.stepDeleteBtns = page.locator(
      '[data-test="synthetics-journey-step-delete-btn"]',
    );
  }

  // ==================== Navigation ====================

  /**
   * Navigates to the Create Browser Test wizard and waits for the
   * journey editor toolbar to be visible.
   */
  async navigateToSyntheticsAdd() {
    const syntheticsUrl = `/web/synthetics/add?type=browser&org_identifier=${process.env["ORGNAME"]}`;
    await this.page.goto(syntheticsUrl);
    await this.page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
    // Wait for the editor toolbar
    await expect(this.addStepBtn).toBeVisible({ timeout: 15000 });
  }

  // ==================== Chip ====================

  /** Returns true if the suggestions chip is visible on the page. */
  async isChipVisible() {
    return await this.suggestionsChip.isVisible().catch(() => false);
  }

  async expectChipVisible() {
    await expect(this.suggestionsChip).toBeVisible({ timeout: 10000 });
  }

  async expectChipHidden() {
    await expect(this.suggestionsChip).not.toBeVisible({ timeout: 10000 });
  }

  /** Returns the chip's aria-label text (e.g. "1 suggestion for this journey"). */
  async getChipAriaLabel() {
    return await this.suggestionsChip.getAttribute('aria-label');
  }

  // ==================== Popover / Panel ====================

  /** Opens the suggestions popover by clicking the chip. Assumes chip is visible. */
  async openSuggestions() {
    await this.suggestionsChip.click();
    await expect(this.suggestionsPanel).toBeVisible({ timeout: 10000 });
  }

  async expectPanelVisible() {
    await expect(this.suggestionsPanel).toBeVisible({ timeout: 5000 });
  }

  async expectPanelHidden() {
    await expect(this.suggestionsPanel).not.toBeVisible({ timeout: 10000 });
  }

  // ==================== Suggestion Cards ====================

  async expectZeroAssertionCardVisible() {
    await expect(this.zeroAssertionCard).toBeVisible({ timeout: 5000 });
  }

  async expectNoTestAttrCardVisible() {
    await expect(this.noTestAttrCard).toBeVisible({ timeout: 5000 });
  }

  /** Clicks the "Add an assertion" action button inside the zero-assertion card. */
  async clickAddAssertion() {
    await expect(this.zeroAssertionActionBtn).toBeVisible({ timeout: 5000 });
    await this.zeroAssertionActionBtn.click();
  }

  // ==================== Footer ====================

  async expectFooterVisible() {
    await expect(this.nonblockingFooter).toBeVisible({ timeout: 5000 });
  }

  // ==================== Step Management ====================

  /** Clicks the "Add Step" button in the journey toolbar. */
  async clickAddStep() {
    await expect(this.addStepBtn).toBeVisible({ timeout: 5000 });
    await this.addStepBtn.click();
    // Wait for at least one delete button to appear (indicates a step was added)
    await expect(this.stepDeleteBtns.first()).toBeVisible({ timeout: 5000 });
  }

  /**
   * Deletes a step by index.  'first' → first delete btn, 'last' → last.
   * After deletion, waits for the delete button count to drop by one.
   */
  async deleteStep(which = 'last') {
    const beforeCount = await this.stepDeleteBtns.count();
    if (which === 'first') {
      await this.stepDeleteBtns.first().click();
    } else if (which === 'last') {
      await this.stepDeleteBtns.last().click();
    } else {
      await this.stepDeleteBtns.nth(which).click();
    }
    // Wait until one fewer delete button exists (the step was removed).
    await expect(async () => {
      const afterCount = await this.stepDeleteBtns.count();
      expect(afterCount).toBe(beforeCount - 1);
    }).toPass({ timeout: 8000 });
  }

  // ==================== Step Count ====================

  /** Returns the number of delete buttons visible (one per step row). */
  async getStepDeleteCount() {
    return await this.stepDeleteBtns.count();
  }

  // ==================== Tooltip ====================

  /**
   * Hovers the suggestions chip and asserts a tooltip with the expected text
   * appears. Pass `visible: false` to assert the tooltip does NOT appear
   * (e.g. when popover is open and tooltip is disabled).
   */
  async expectTooltipText(expectedText, options = { visible: true }) {
    await this.suggestionsChip.hover();
    const tooltip = this.page.getByRole('tooltip');
    if (options.visible) {
      await expect(tooltip).toBeVisible({ timeout: 5000 });
      await expect(tooltip).toContainText(expectedText);
    } else {
      await expect(tooltip).not.toBeVisible({ timeout: 3000 });
    }
  }
}
