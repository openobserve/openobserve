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

// SyntheticsListPage — SyntheticMonitoring.vue + MonitorTable.vue; rows are scoped by the `…-name-<id>` span, never by name.

import { expect } from '@playwright/test';
import { selectOSelectOption } from '../alertsPages/oselectHelpers.js';
import { openNavFlyoutChild } from '../commonActions.js';
const testLogger = require('../../playwright-tests/utils/test-logger.js');

const TABLE = 'synthetic-monitoring-monitors-table';

export class SyntheticsListPage {
  constructor(page) {
    this.page = page;
    this.locators = this._initializeLocators();
  }

  _initializeLocators() {
    return {
      newCheckButton: '[data-test="synthetic-monitoring-new-check-btn"]',
      typePickerModal: '[data-test="synthetic-monitoring-check-type-picker-modal"]',
      folderList: '[data-test="synthetic-monitoring-folder-list"]',
      searchField: '[data-test="synthetic-monitoring-search-input-field"]',
      table: `[data-test="${TABLE}"]`,
      emptyState: `[data-test="${TABLE}-empty-state"]`,
      row: '[data-test^="o2-table-row-"]',
      deleteSelectedButton: `[data-test="${TABLE}-delete-selected-btn"]`,
      pauseSelectedButton: `[data-test="${TABLE}-pause-selected-btn"]`,
      enableSelectedButton: `[data-test="${TABLE}-enable-selected-btn"]`,
      triggerSelectedButton: `[data-test="${TABLE}-trigger-selected-btn"]`,
      bulkDeleteDialog: '[data-test="synthetic-monitoring-bulk-delete-dialog"]',
      duplicateDialog: '[data-test="synthetic-monitoring-duplicate-dialog"]',
      duplicateNameField: '[data-test="synthetic-monitoring-duplicate-name-input-field"]',
      moveDialog: '[data-test="synthetic-monitoring-move-dialog"]',
      moveFolderSelect: '[data-test="synthetics-index-dropdown-stream_type"]',
      confirmDialogPrimary: '[data-test="confirm-dialog-provider"] [data-test="o-dialog-primary-btn"]',
      dialogPrimary: '[data-test="o-dialog-primary-btn"]',
      toastMessage: '[data-test="o-toast-message"]',
      privateLocationsTable: '[data-test="synthetics-private-locations-table"]',
      setupAgentButton: '[data-test="synthetic-monitoring-setup-agent-btn"]',
    };
  }

  typeCard(type) { return `[data-test="check-type-picker-row-card-${type}"]`; }
  nameCell(id) { return `[data-test="${TABLE}-name-${id}"]`; }
  rowSelect(index) { return `[data-test="o2-table-select-${index}"]`; }
  rowAction(action) { return `[data-test="${TABLE}-${action}"]`; }

  // ---------------------------------------------------------------- navigation

  async goto(orgId, { folder = null, section = null } = {}) {
    const params = new URLSearchParams({ org_identifier: orgId });
    if (folder) params.set('folder', folder);
    if (section) params.set('section', section);
    await this.page.goto(`/web/synthetics?${params.toString()}`);
    await expect(this.page.locator(this.locators.newCheckButton)).toBeVisible({ timeout: 30000 });
    testLogger.navigation('Synthetics list');
  }

  // The unfiltered list is 20 rows a page and sorted by name, so row actions first narrow to the check.
  async gotoCheck(orgId, check) {
    await this.goto(orgId);
    await this.search(check.name);
    await this.expectRowVisible(check.id);
  }

  async openFromSidebar() {
    await openNavFlyoutChild(this.page, 'synthetics');
    await expect(this.page).toHaveURL(/\/synthetics/, { timeout: 30000 });
  }

  // ------------------------------------------------------------------- actions

  async openTypePicker() {
    await this.page.locator(this.locators.newCheckButton).click();
    await expect(this.page.locator(this.locators.typePickerModal)).toBeVisible({ timeout: 15000 });
  }

  async pickType(type) {
    await this.page.locator(this.typeCard(type)).click();
    await expect(this.page).toHaveURL(new RegExp(`/synthetics/add\\?.*type=${type}`), { timeout: 15000 });
  }

  async search(text) {
    const field = this.page.locator(this.locators.searchField).first();
    await field.waitFor({ state: 'visible', timeout: 15000 });
    await field.fill(text);
  }

  getRow(id) {
    return this.page.locator(this.locators.row).filter({ has: this.page.locator(this.nameCell(id)) });
  }

  async openResults(id) {
    await this.page.locator(this.nameCell(id)).click();
    await expect(this.page).toHaveURL(new RegExp(`/synthetics/${id}/results`), { timeout: 15000 });
  }

  async clickEdit(id) {
    await this.getRow(id).locator(this.rowAction('edit-btn')).click();
    await expect(this.page).toHaveURL(new RegExp(`/synthetics/edit/${id}`), { timeout: 15000 });
  }

  // The button's data-test flips with the check state, so the caller names the one it expects.
  async clickToggle(id, action) {
    const btn = this.getRow(id).locator(this.rowAction(`${action}-btn`));
    await btn.waitFor({ state: 'visible', timeout: 15000 });
    await btn.click();
  }

  async openMoreMenu(id) {
    await this.getRow(id).locator(this.rowAction('more-btn')).click();
  }

  async runNow(id) {
    await this.openMoreMenu(id);
    await this.page.locator(this.rowAction('run-item')).click();
  }

  async deleteSingle(id) {
    await this.openMoreMenu(id);
    await this.page.locator(this.rowAction('delete-item')).click();
    await this.page.locator(this.locators.confirmDialogPrimary).click();
    testLogger.info('Synthetics check deleted via UI', { id });
  }

  // Duplicate is a per-row icon button, not an item of the more menu.
  async duplicate(id, newName) {
    await this.getRow(id).locator(this.rowAction('duplicate-btn')).click();
    const dialog = this.page.locator(this.locators.duplicateDialog);
    await expect(dialog).toBeVisible({ timeout: 15000 });
    await this.page.locator(this.locators.duplicateNameField).fill(newName);
    await dialog.locator(this.locators.dialogPrimary).click();
    await expect(dialog).toHaveCount(0, { timeout: 20000 });
  }

  async moveToFolder(id, folderId) {
    await this.openMoreMenu(id);
    await this.page.locator(this.rowAction('move-item')).click();
    const dialog = this.page.locator(this.locators.moveDialog);
    await expect(dialog).toBeVisible({ timeout: 15000 });
    await selectOSelectOption(this.page, this.locators.moveFolderSelect, folderId);
    await dialog.locator(this.locators.dialogPrimary).click();
    await expect(dialog).toHaveCount(0, { timeout: 20000 });
  }

  async selectRows(indexes) {
    for (const i of indexes) {
      await this.page.locator(this.rowSelect(i)).click();
    }
  }

  async bulkDelete() {
    await this.page.locator(this.locators.deleteSelectedButton).click();
    const dialog = this.page.locator(this.locators.bulkDeleteDialog);
    await expect(dialog).toBeVisible({ timeout: 15000 });
    await dialog.locator(this.locators.dialogPrimary).click();
  }

  async bulkPause() { await this.page.locator(this.locators.pauseSelectedButton).click(); }
  async bulkEnable() { await this.page.locator(this.locators.enableSelectedButton).click(); }
  async bulkTrigger() { await this.page.locator(this.locators.triggerSelectedButton).click(); }

  // ---------------------------------------------------------------- assertions

  async expectListVisible() {
    await expect(this.page.locator(this.locators.newCheckButton)).toBeVisible();
    await expect(this.page.locator(this.locators.folderList)).toBeVisible();
  }

  async expectTypeCards(types) {
    for (const type of types) {
      await expect(this.page.locator(this.typeCard(type))).toBeVisible({ timeout: 15000 });
    }
  }

  async expectRowVisible(id) {
    await expect(this.page.locator(this.nameCell(id))).toBeVisible({ timeout: 30000 });
  }

  // Never reloads: search and folder filters are asserted with this.
  async expectRowAbsent(id) {
    await expect(this.page.locator(this.nameCell(id))).toHaveCount(0, { timeout: 30000 });
  }

  async expectRowName(id, name) {
    await expect(this.page.locator(this.nameCell(id))).toHaveText(name, { timeout: 30000 });
  }

  async expectRowCount(count) {
    await expect(this.page.locator(this.locators.row)).toHaveCount(count, { timeout: 30000 });
  }

  async expectEmptyState() {
    await expect(this.page.locator(this.locators.emptyState)).toBeVisible({ timeout: 30000 });
    await expect(this.page.locator(this.locators.row)).toHaveCount(0);
  }

  async expectToggleState(id, action) {
    await expect(this.getRow(id).locator(this.rowAction(`${action}-btn`))).toBeVisible({ timeout: 20000 });
  }

  // OSS falls back to the checks table when `?section=private` is requested.
  async expectPrivateSectionAbsent() {
    await expect(this.page.locator(this.locators.table)).toBeVisible({ timeout: 30000 });
    await expect(this.page.locator(this.locators.privateLocationsTable)).toHaveCount(0);
    await expect(this.page.locator(this.locators.setupAgentButton)).toHaveCount(0);
  }

  async expectToast(text) {
    await expect(this.page.locator(this.locators.toastMessage).filter({ hasText: text }).first())
      .toBeVisible({ timeout: 20000 });
  }
}

export default SyntheticsListPage;
