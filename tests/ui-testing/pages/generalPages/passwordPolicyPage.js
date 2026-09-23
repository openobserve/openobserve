// Copyright 2026 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

import { expect } from "@playwright/test";

// Page Object Model for the Settings → Password Policy page.
// The page is enterprise + meta-org gated (`visible: isEnt && meta` in
// settings/index.vue) and reads/puts the policy for the _meta org.
export class PasswordPolicyPage {
  constructor(page) {
    this.page = page;

    // ── Form / readiness ──────────────────────────────────────────────────────
    this.form = "#password-policy-form";

    // ── Section rows (OSettingRow data-test attributes) ───────────────────────
    this.minLengthRow = '[data-test="settings-password-policy-min-length"]';
    this.maxLengthRow = '[data-test="settings-password-policy-max-length"]';
    this.requireUppercaseRow = '[data-test="settings-password-policy-require-uppercase"]';
    this.requireSpecialRow = '[data-test="settings-password-policy-require-special"]';
    this.specialCharSetRow = '[data-test="settings-password-policy-special-char-set"]';
    this.rotationDaysRow = '[data-test="settings-password-policy-rotation-days"]';
    this.rotationWarningDaysRow = '[data-test="settings-password-policy-rotation-warning-days"]';
    this.historyCountRow = '[data-test="settings-password-policy-history-count"]';
    this.lockoutThresholdRow = '[data-test="settings-password-policy-lockout-threshold"]';
    this.lockoutStartSecsRow = '[data-test="settings-password-policy-lockout-start-secs"]';
    this.cookieMaxAgeRow = '[data-test="settings-password-policy-cookie-max-age"]';
    this.applyToRootRow = '[data-test="settings-password-policy-apply-to-root"]';

    // ── Cross-field error messages (rendered in the pair footer, not the field) ──
    this.maxLengthError = '[data-test="settings-password-policy-max-length-error"]';
    this.rotationWarningDaysError =
      '[data-test="settings-password-policy-rotation-warning-days-error"]';

    // ── Lockout preview ────────────────────────────────────────────────────────
    this.lockoutPreview = '[data-test="settings-password-policy-lockout-preview"]';

    // ── Native inputs (OFormInput has no data-test, so target by name) ─────────
    this.minLengthInput = `${this.minLengthRow} input[name="min_length"]`;
    this.maxLengthInput = `${this.maxLengthRow} input[name="max_length"]`;
    this.rotationDaysInput = `${this.rotationDaysRow} input[name="rotation_days"]`;
    this.rotationWarningDaysInput =
      `${this.rotationWarningDaysRow} input[name="rotation_warning_days"]`;
    this.lockoutThresholdInput = `${this.lockoutThresholdRow} input[name="lockout.threshold"]`;
    this.lockoutStartSecsInput = `${this.lockoutStartSecsRow} input[name="lockout.start_secs"]`;

    // ── Switches / actions ─────────────────────────────────────────────────────
    this.requireSpecialSwitch = `${this.requireSpecialRow} button[role="switch"]`;
    this.saveBtn = '[data-test="settings-password-policy-save-btn"]';
  }

  /**
   * Navigate straight to the password-policy sub-route in the _meta org (the only
   * org the page renders in). Returns true when the form mounts, false otherwise so
   * callers can gate the suite to a clean SKIP on a non-enterprise/OSS build.
   */
  async navigateToPasswordPolicy() {
    const baseUrl = process.env["ZO_BASE_URL"] || "http://localhost:5080";
    await this.page.goto(`${baseUrl}/web/settings/password_policy?org_identifier=_meta`);
    await this.page.waitForLoadState("networkidle", { timeout: 12000 }).catch(() => {});
    try {
      await this.page.locator(this.minLengthRow).waitFor({ state: "visible", timeout: 20000 });
      return true;
    } catch {
      return false;
    }
  }

  // ── Readiness / visibility locators ────────────────────────────────────────

  getFormLocator() {
    return this.page.locator(this.form);
  }

  getMinLengthLocator() {
    return this.page.locator(this.minLengthRow);
  }

  getMaxLengthLocator() {
    return this.page.locator(this.maxLengthRow);
  }

  getRequireUppercaseLocator() {
    return this.page.locator(this.requireUppercaseRow);
  }

  getRequireSpecialLocator() {
    return this.page.locator(this.requireSpecialRow);
  }

  getRotationDaysLocator() {
    return this.page.locator(this.rotationDaysRow);
  }

  getHistoryCountLocator() {
    return this.page.locator(this.historyCountRow);
  }

  getLockoutThresholdLocator() {
    return this.page.locator(this.lockoutThresholdRow);
  }

  getCookieMaxAgeLocator() {
    return this.page.locator(this.cookieMaxAgeRow);
  }

  getApplyToRootLocator() {
    return this.page.locator(this.applyToRootRow);
  }

  getSpecialCharSetLocator() {
    return this.page.locator(this.specialCharSetRow);
  }

  getLockoutPreviewLocator() {
    return this.page.locator(this.lockoutPreview);
  }

  getLockoutStartSecsInputLocator() {
    return this.page.locator(this.lockoutStartSecsInput);
  }

  getMaxLengthErrorLocator() {
    return this.page.locator(this.maxLengthError);
  }

  getRotationWarningDaysErrorLocator() {
    return this.page.locator(this.rotationWarningDaysError);
  }

  // ── Field editing ──────────────────────────────────────────────────────────

  async fillMinLength(value) {
    await this.page.locator(this.minLengthInput).fill(String(value));
  }

  async fillMaxLength(value) {
    await this.page.locator(this.maxLengthInput).fill(String(value));
  }

  async fillRotationDays(value) {
    await this.page.locator(this.rotationDaysInput).fill(String(value));
  }

  async fillRotationWarningDays(value) {
    await this.page.locator(this.rotationWarningDaysInput).fill(String(value));
  }

  async fillLockoutThreshold(value) {
    await this.page.locator(this.lockoutThresholdInput).fill(String(value));
  }

  // ── Switch ─────────────────────────────────────────────────────────────────

  /**
   * Drive the require_special switch to the desired state. Idempotent, and guards
   * the toggle by asserting aria-checked reaches the target so a silently-ignored
   * click cannot yield a false green.
   */
  async setRequireSpecial(on) {
    const btn = this.page.locator(this.requireSpecialSwitch);
    await btn.waitFor({ state: "visible", timeout: 10000 });
    const isOn = (await btn.getAttribute("aria-checked")) === "true";
    if (isOn !== on) {
      await btn.click();
    }
    await expect(btn).toHaveAttribute("aria-checked", on ? "true" : "false");
  }

  // ── Actions ────────────────────────────────────────────────────────────────

  async clickSave() {
    await this.page.locator(this.saveBtn).click();
  }
}
