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

// SecretConsumersPage — the secret picker and write-only slots in alert destinations, synthetics checks,
// AI toolsets and the private-location agent setup drawer.

import { expect } from '@playwright/test';
import { selectOSelectOption } from '../alertsPages/oselectHelpers.js';

export class SecretConsumersPage {
  constructor(page) {
    this.page = page;
    this.locators = {
      destAddButton: '[data-test="alert-destination-list-add-alert-btn"]',
      destTitle: '[data-test="add-destination-title"]',
      destTypeSelector: '[data-test="prebuilt-destination-selector"]',
      destNameField: '[data-test="add-destination-name-input-field"]',
      destTemplateSelect: '[data-test="add-destination-template-select"]',
      destUrlField: '[data-test="add-destination-url-input-field"]',
      destSubmit: '[data-test="add-destination-submit-btn"]',
      destTest: '[data-test="destination-test-button"]',
      destTestSaveFirst: '[data-test="destination-test-save-first"]',
      destTestStatusOnly: '[data-test="destination-test-status-only"]',
      pickerSearch: '[data-test="secret-picker-search-field"]',
      checkUrlField: '[data-test="synthetics-check-details-url-input-field"]',
      checkUrlError: '[data-test="synthetics-check-details-url-input-error"]',
      checkSave: '[data-test="synthetics-create-save-btn"]',
      toolsetSave: '[data-test="ai-toolset-save-btn"]',
      toolsetCliNoSecrets: '[data-test="ai-toolset-cli-no-secrets"]',
      toolsetAutomation: '[data-test="ai-toolset-automation"]',
      locationSetupButton: '[data-test="synthetics-private-location-detail-setup-btn"]',
      setupDrawer: '[data-test="synthetics-agent-setup-drawer"]',
      setupInstallCmd: '[data-test="synthetics-agent-setup-install-cmd"]',
      setupTokenSelect: '[data-test="synthetics-agent-setup-token-select"]',
      setupInsertToken: '[data-test="synthetics-agent-setup-insert-token"]',
      setupNewToken: '[data-test="synthetics-agent-setup-new-token"]',
      setupAskAdmin: '[data-test="synthetics-agent-setup-ask-admin"]',
    };
  }

  destHeaderKey(index) {
    return this.page.locator(`[data-test="add-destination-header-${index}-key"] [data-test$="-key-input-field"]`);
  }
  destHeaderValue(index) {
    return this.page.locator(`[data-test="add-destination-header-${index}-value"] [data-test$="-value-input-field"]`);
  }
  destPicker(index) {
    return this.page.locator(`[data-test="add-destination-header-${index}-secret-picker-trigger"]`);
  }
  destEditButton(name) {
    return this.page.locator(`[data-test="alert-destination-list-${name}-update-destination"]`);
  }
  pickerItem(name) {
    return this.page.locator(`[data-test="secret-picker-item-${name}"]`);
  }
  checkHeaderValue(i) {
    return this.page.locator(`[data-test="synthetics-check-http-header-value-${i}"]`);
  }
  checkHeaderReplace(i) {
    return this.page.locator(`[data-test="synthetics-check-http-header-value-${i}-replace"]`);
  }
  checkHeaderPicker(i) {
    return this.page.locator(`[data-test="synthetics-check-http-header-${i}-secret-picker-trigger"]`);
  }
  toolsetHeaderKey(i) {
    return this.page.locator(`[data-test="ai-toolset-header-${i}-key-field"]`);
  }
  toolsetHeaderValue(i) {
    return this.page.locator(`[data-test="ai-toolset-header-${i}-value-field"]`);
  }
  toolsetHeaderRemove(i) {
    return this.page.locator(`[data-test="ai-toolset-header-${i}-remove"]`);
  }
  toolsetPicker(i) {
    return this.page.locator(`[data-test="ai-toolset-header-${i}-secret-picker-trigger"]`);
  }

  async gotoDestinations(org = process.env.ORGNAME) {
    await this.page.goto(`/web/alert-destinations?org_identifier=${org}`);
    await expect(this.page.locator(this.locators.destAddButton)).toBeEnabled({ timeout: 30000 });
  }

  async startCustomDestination(name) {
    await this.page.locator(this.locators.destAddButton).click();
    await expect(this.page.locator(this.locators.destTitle)).toBeVisible();
    const card = this.page.locator(
      `${this.locators.destTypeSelector} [data-test="destination-type-card"][data-type="custom"]`,
    );
    await card.click();
    await expect(this.page.locator(this.locators.destUrlField)).toBeVisible();
    await this.page.locator(this.locators.destNameField).fill(name);
    await selectOSelectOption(this.page, this.locators.destTemplateSelect, 'prebuilt_default', { search: true });
  }

  async pickSecret(trigger, name) {
    await trigger.click();
    await this.page.locator(this.locators.pickerSearch).fill(name);
    await this.pickerItem(name).click();
    await expect(this.pickerItem(name)).toBeHidden();
  }

  async saveDestination() {
    await this.page.locator(this.locators.destSubmit).click();
    await expect(this.page.locator(this.locators.destTitle)).toBeHidden({ timeout: 30000 });
  }

  async openDestination(name) {
    await this.destEditButton(name).click();
    await expect(this.page.locator(this.locators.destTitle)).toBeVisible();
  }

  async gotoCheckEdit(id, org = process.env.ORGNAME) {
    await this.page.goto(`/web/synthetics/edit/${id}?org_identifier=${org}`);
    await expect(this.page.locator(this.locators.checkUrlField)).toBeVisible({ timeout: 30000 });
  }

  async gotoToolsetEdit(id, org = process.env.ORGNAME) {
    await this.page.goto(`/web/settings/ai_toolsets?org_identifier=${org}&action=edit&id=${id}`);
    await expect(this.page.locator(this.locators.toolsetSave)).toBeVisible({ timeout: 30000 });
  }

  async openAgentSetup(locationId, org = process.env.ORGNAME) {
    await this.page.goto(`/web/synthetic/private-locations/${locationId}?org_identifier=${org}`);
    await this.page.locator(this.locators.locationSetupButton).click();
    await expect(this.page.locator(this.locators.setupInstallCmd).first()).toBeVisible({ timeout: 30000 });
  }

  // The inserted token is real; it is masked on screen before any capture and never logged.
  async maskInstallToken() {
    await this.page
      .locator(this.locators.setupInstallCmd)
      .first()
      .evaluate((el) => {
        el.innerHTML = el.innerHTML.replace(/o2syn_[A-Za-z0-9_-]+/g, 'o2syn_&lt;masked&gt;');
      });
  }
}
