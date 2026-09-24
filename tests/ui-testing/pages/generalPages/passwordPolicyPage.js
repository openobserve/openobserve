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

// Enterprise + meta-org gated Settings → Password Policy page (_meta org only).
export class PasswordPolicyPage {
  constructor(page) {
    this.page = page;

    this.form = "#password-policy-form";
    // OSS redirect target when the enterprise page is absent.
    this.generalSettingsTab = '[data-test="general-settings-tab"]';

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

    this.maxLengthError = '[data-test="settings-password-policy-max-length-error"]';
    this.rotationWarningDaysError =
      '[data-test="settings-password-policy-rotation-warning-days-error"]';

    this.lockoutPreview = '[data-test="settings-password-policy-lockout-preview"]';

    this.notAdminEmptyState = '[data-test="password-policy-not-admin-empty-state"]';
    this.loadErrorEmptyState = '[data-test="password-policy-load-error-empty-state"]';

    // OFormInput has no data-test, so target the native input by name.
    this.minLengthInput = `${this.minLengthRow} input[name="min_length"]`;
    this.maxLengthInput = `${this.maxLengthRow} input[name="max_length"]`;
    this.rotationDaysInput = `${this.rotationDaysRow} input[name="rotation_days"]`;
    this.rotationWarningDaysInput =
      `${this.rotationWarningDaysRow} input[name="rotation_warning_days"]`;
    this.lockoutThresholdInput = `${this.lockoutThresholdRow} input[name="lockout.threshold"]`;
    this.lockoutStartSecsInput = `${this.lockoutStartSecsRow} input[name="lockout.start_secs"]`;

    this.requireSpecialSwitch = `${this.requireSpecialRow} button[role="switch"]`;
    this.saveBtn = '[data-test="settings-password-policy-save-btn"]';
  }

  // Returns true when the form mounts; false only after positively confirming the OSS
  // redirect to general settings, so a crash, hung load, or auth redirect throws instead.
  async navigateToPasswordPolicy() {
    const baseUrl = process.env["ZO_BASE_URL"] || "http://localhost:5080";
    await this.page.goto(`${baseUrl}/web/settings/password_policy?org_identifier=_meta`);
    await this.page.waitForLoadState("networkidle", { timeout: 12000 }).catch(() => {});

    const visibleWithin = async (selector, timeout = 2000) => {
      try {
        await this.page.locator(selector).waitFor({ state: "visible", timeout });
        return true;
      } catch {
        return false;
      }
    };

    if (await visibleWithin(this.minLengthRow, 20000)) {
      return true;
    }
    if (await visibleWithin(this.form)) {
      throw new Error("Password Policy form mounted but the min-length row did not render");
    }
    if (await visibleWithin(this.loadErrorEmptyState)) {
      throw new Error("Password Policy page failed to load its policy (load-error state)");
    }
    if (await visibleWithin(this.notAdminEmptyState)) {
      throw new Error("Password Policy page denied access (not-admin state)");
    }
    // Skip only on a confirmed OSS build: the route redirected to general settings.
    if (await visibleWithin(this.generalSettingsTab)) {
      return false;
    }
    throw new Error(
      "Password Policy route neither rendered nor redirected to general settings — " +
        `unexpected landing at ${this.page.url()}`,
    );
  }

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

  // Idempotent; asserts aria-checked reaches the target so a swallowed click can't pass.
  async setRequireSpecial(on) {
    const btn = this.page.locator(this.requireSpecialSwitch);
    await btn.waitFor({ state: "visible", timeout: 10000 });
    const isOn = (await btn.getAttribute("aria-checked")) === "true";
    if (isOn !== on) {
      await btn.click();
    }
    await expect(btn).toHaveAttribute("aria-checked", on ? "true" : "false");
  }

  async clickSave() {
    await this.page.locator(this.saveBtn).click();
  }
}
