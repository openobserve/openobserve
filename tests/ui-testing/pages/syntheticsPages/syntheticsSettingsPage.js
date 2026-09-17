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

// SyntheticsSettingsPage — Settings → Synthetics Locations (meta org only) and IAM → Synthetics Tokens.

import { expect } from '@playwright/test';
import { selectOSelectOption } from '../alertsPages/oselectHelpers.js';
const testLogger = require('../../playwright-tests/utils/test-logger.js');

export class SyntheticsSettingsPage {
  constructor(page) {
    this.page = page;
    this.locators = this._initializeLocators();
  }

  _initializeLocators() {
    return {
      locationsTab: '[data-test="synthetics-locations-tab"]',
      addButton: '[data-test="synthetics-locations-add-btn"]',
      formDrawer: '[data-test="synthetics-location-form-drawer"]',
      labelField: '[data-test="synthetics-location-label-input-field"]',
      providerSelect: '[data-test="synthetics-location-provider-select"]',
      customProviderField: '[data-test="synthetics-location-custom-provider-input-field"]',
      regionField: '[data-test="synthetics-location-region-input-field"]',
      drawerPrimary: '[data-test="o-drawer-primary-btn"]',
      confirmDialogPrimary: '[data-test="confirm-dialog-provider"] [data-test="o-dialog-primary-btn"]',
      importButton: '[data-test="synthetics-locations-import-btn"]',
      importJsonInput: '[data-test="synthetics-locations-import-json-input"]',
      importJsonButton: '[data-test="synthetics-locations-import-json-btn"]',
      // Tokens
      createTokenButton: '[data-test="synthetics-tokens-create-btn"]',
      tokenNameField: '[data-test="synthetics-token-name-input-field"]',
      tokenNameError: '[data-test="synthetics-token-name-input-error"]',
      revealDialog: '[data-test="o-dialog-panel"]:has([data-test="synthetics-token-copy-btn"])',
      generalSettingsTab: '[data-test="general-settings-tab"]',
      dialogPrimary: '[data-test="o-dialog-primary-btn"]',
      dialogSecondary: '[data-test="o-dialog-secondary-btn"]',
      toastMessage: '[data-test="o-toast-message"]',
    };
  }

  locationButton(id, action) { return `[data-test="synthetics-locations-${id}-${action}-btn"]`; }
  importError(i) { return `[data-test="synthetics-locations-import-error-${i}"]`; }
  tokenToggle(name) { return `[data-test="synthetics-token-${name}-toggle"]`; }

  // ---------------------------------------------------------------- navigation

  async gotoLocations(orgId = '_meta') {
    await this.page.goto(`/web/settings/synthetics_locations?org_identifier=${orgId}`);
    await expect(this.page.locator(this.locators.addButton)).toBeVisible({ timeout: 30000 });
    testLogger.navigation('Synthetics locations settings');
  }

  async gotoSettings(orgId) {
    await this.page.goto(`/web/settings?org_identifier=${orgId}`);
    await this.page.waitForLoadState('domcontentloaded');
  }

  async gotoTokens(orgId) {
    await this.page.goto(`/web/iam/syntheticsTokens?org_identifier=${orgId}`);
    await expect(this.page.locator(this.locators.createTokenButton)).toBeVisible({ timeout: 30000 });
    testLogger.navigation('Synthetics tokens');
  }

  // --------------------------------------------------------- location actions

  async openAddForm() {
    await this.page.locator(this.locators.addButton).click();
    await expect(this.page.locator(this.locators.formDrawer)).toBeVisible({ timeout: 15000 });
  }

  async openEditForm(id) {
    await this.page.locator(this.locationButton(id, 'edit')).click();
    await expect(this.page.locator(this.locators.formDrawer)).toBeVisible({ timeout: 15000 });
  }

  async fillLocationForm({ label, provider, customProvider, region }) {
    if (label !== undefined) await this.page.locator(this.locators.labelField).fill(label);
    if (provider) await selectOSelectOption(this.page, this.locators.providerSelect, provider);
    if (customProvider !== undefined) await this.page.locator(this.locators.customProviderField).fill(customProvider);
    if (region !== undefined) await this.page.locator(this.locators.regionField).fill(region);
  }

  async submitLocationForm() {
    const drawer = this.page.locator(this.locators.formDrawer);
    await drawer.locator(this.locators.drawerPrimary).click();
    await expect(drawer).toBeHidden({ timeout: 20000 });
  }

  async toggleLocation(id, action) {
    await this.page.locator(this.locationButton(id, action)).click();
  }

  async deleteLocation(id) {
    await this.page.locator(this.locationButton(id, 'delete')).click();
    await this.page.locator(this.locators.confirmDialogPrimary).click();
  }

  // Parsing is debounced on input, so validation errors can be asserted before the import runs.
  async pasteImportJson(json) {
    await this.page.locator(this.locators.importButton).click();
    const input = this.page.locator(this.locators.importJsonInput);
    await input.waitFor({ state: 'visible', timeout: 15000 });
    await input.fill(json);
  }

  async runImport() { await this.page.locator(this.locators.importJsonButton).click(); }

  // ----------------------------------------------------------- token actions

  async openCreateTokenDialog() {
    await this.page.locator(this.locators.createTokenButton).click();
    await this.page.locator(this.locators.tokenNameField).waitFor({ state: 'visible', timeout: 15000 });
  }

  async createToken(name) {
    const responsePromise = this.page.waitForResponse(
      (r) => r.request().method() === 'POST' && /\/agent-tokens(\?|$)/.test(r.url()),
      { timeout: 30000 },
    );
    await this.openCreateTokenDialog();
    await this.page.locator(this.locators.tokenNameField).fill(name);
    await this.page.locator(this.locators.dialogPrimary).first().click();
    const response = await responsePromise;
    return { status: response.status(), text: await response.text().catch(() => '') };
  }

  // Submits the create dialog without waiting for a request; used when the form itself rejects the name.
  async submitTokenName(name) {
    await this.openCreateTokenDialog();
    await this.page.locator(this.locators.tokenNameField).fill(name);
    await this.page.locator(this.locators.dialogPrimary).first().click();
  }

  async expectTokenNameError(text) {
    await expect(this.page.locator(this.locators.tokenNameError)).toContainText(text, { timeout: 10000 });
  }

  // The reveal dialog is persistent and only closes through its own Close button.
  async closeRevealDialog() {
    const close = this.page.locator(this.locators.revealDialog).locator(this.locators.dialogSecondary);
    await close.waitFor({ state: 'visible', timeout: 15000 });
    await close.click();
  }

  async toggleToken(name) {
    await this.page.locator(this.tokenToggle(name)).click();
  }

  // ---------------------------------------------------------------- assertions

  async expectLocationRow(id) {
    await expect(this.page.locator(this.locationButton(id, 'edit'))).toBeVisible({ timeout: 30000 });
  }

  async expectLocationRowAbsent(id) {
    await expect(this.page.locator(this.locationButton(id, 'edit'))).toHaveCount(0, { timeout: 30000 });
  }

  async expectLocationToggle(id, action) {
    await expect(this.page.locator(this.locationButton(id, action))).toBeVisible({ timeout: 30000 });
  }

  async expectTokenRow(name) {
    await expect(this.page.locator(this.tokenToggle(name))).toBeVisible({ timeout: 30000 });
  }

  async expectImportError(index, text) {
    await expect(this.page.locator(this.importError(index))).toContainText(text, { timeout: 15000 });
  }

  // The general tab proves the rail rendered before an absent tab is asserted.
  async expectLocationsTabCount(count) {
    await expect(this.page.locator(this.locators.generalSettingsTab)).toBeVisible({ timeout: 30000 });
    await expect(this.page.locator(this.locators.locationsTab)).toHaveCount(count, { timeout: 15000 });
  }

  async expectToast(text) {
    await expect(this.page.locator(this.locators.toastMessage).filter({ hasText: text }).first())
      .toBeVisible({ timeout: 20000 });
  }
}

export default SyntheticsSettingsPage;
