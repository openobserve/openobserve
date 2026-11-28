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

// SecretsPage — Settings → Secrets & variables: list, create drawer, secret drawer tabs and lifecycle dialogs.

import { expect } from '@playwright/test';
import { selectOSelectOption } from '../alertsPages/oselectHelpers.js';
const testLogger = require('../../playwright-tests/utils/test-logger.js');

export class SecretsPage {
  constructor(page) {
    this.page = page;
    this.locators = {
      newButton: '[data-test="secrets-page-new-btn"]',
      table: '[data-test="secrets-page-table"]',
      searchField: '[data-test="secrets-page-search-field"]',
      showDeleted: '[data-test="secrets-page-show-deleted"]',
      tabVariable: '[data-test="secrets-page-tab-variable"]',
      tabSecret: '[data-test="secrets-page-tab-secret"]',
      createDrawer: '[data-test="secret-create-drawer"]',
      createName: '[data-test="secret-create-name-field"]',
      createValue: '[data-test="secret-create-value-field"]',
      createDescription: '[data-test="secret-create-description-field"]',
      createSubmit: '[data-test="secret-create-submit"]',
      drawer: '[data-test="secret-drawer"]',
      drawerTabs: '[data-test="secret-drawer-tabs"]',
      drawerMore: '[data-test="secret-drawer-more"]',
      drawerRename: '[data-test="secret-drawer-rename"]',
      drawerDelete: '[data-test="secret-drawer-delete"]',
      drawerRestore: '[data-test="secret-drawer-restore"]',
      drawerPurge: '[data-test="secret-drawer-purge"]',
      deletedBanner: '[data-test="secret-drawer-deleted-banner"]',
      deleteDialog: '[data-test="secret-delete-dialog"]',
      deleteConsumers: '[data-test="secret-delete-consumers"]',
      deleteForce: '[data-test="secret-delete-force"]',
      deleteConfirm: '[data-test="secret-delete-confirm"]',
      renameDialog: '[data-test="secret-rename-dialog"]',
      renameName: '[data-test="secret-rename-name-field"]',
      renameConfirm: '[data-test="secret-rename-confirm"]',
      purgeDialog: '[data-test="secret-purge-dialog"]',
      purgeName: '[data-test="secret-purge-name-field"]',
      purgeConfirm: '[data-test="secret-purge-confirm"]',
      policyTab: '[data-test="secret-policy-tab"]',
      policyHosts: '[data-test="secret-policy-hosts"]',
      policySave: '[data-test="secret-policy-save"]',
      policyPinReason: '[data-test="secret-policy-pin-reason-field"]',
      policyAnyHostWarning: '[data-test="secret-policy-any-host-warning"]',
      accessTab: '[data-test="secret-access-tab"]',
      accessRoleSelect: '[data-test="secret-access-role-select"]',
      accessAddRole: '[data-test="secret-access-add-role"]',
      accessSave: '[data-test="secret-access-save"]',
      usageTab: '[data-test="secret-usage-tab"]',
      refusal: '[data-test="secret-save-refusal"]',
      refusalCode: '[data-test="secret-save-refusal-code"]',
      refusalUsage: '[data-test="secret-save-refusal-usage"]',
      toast: '[data-test="o-toast-message"]',
    };
  }

  row(name) {
    return this.page.locator(`[data-test="secrets-page-row-${name}-name"]`);
  }
  createType(type) {
    return `[data-test="secret-create-type-${type}"]`;
  }
  valueRow(env = '_org') {
    return this.page.locator(`[data-test="secret-value-row-${env}"]`);
  }
  valueStatus(env = '_org') {
    return this.page.locator(`[data-test="secret-value-row-${env}-status"]`);
  }
  valueReplace(env = '_org') {
    return this.page.locator(`[data-test="secret-value-row-${env}-replace"]`);
  }
  valueInput(env = '_org') {
    return this.page.locator(`[data-test="secret-value-row-${env}-input-field"]`);
  }
  valueSave(env = '_org') {
    return this.page.locator(`[data-test="secret-value-row-${env}-save"]`);
  }
  variableValue(env = '_org') {
    return this.page.locator(`[data-test="secret-value-row-${env}-variable-value"]`);
  }
  policyType(type) {
    return this.page.locator(`[data-test="secret-policy-type-${type}-enabled"]`);
  }
  pinMode(mode) {
    return this.page.locator(`[data-test="secret-policy-pin-mode"] [data-test-value="${mode}"]`);
  }
  tagRemove(root, index) {
    return root.locator(`[data-test="tag-remove-${index}"]`);
  }
  accessGrant(role, right) {
    return this.page.locator(`[data-test="secret-access-${role}-${right}"]`);
  }
  usageRow(i) {
    return this.page.locator(`[data-test="secret-usage-row-${i}"]`);
  }
  toastWith(variant) {
    return this.page.locator(`[data-test-variant="${variant}"] ${this.locators.toast}`);
  }

  async goto(org = process.env.ORGNAME) {
    await this.page.goto(`/web/settings/secrets?org_identifier=${org}`);
    await expect(this.page.locator(this.locators.newButton)).toBeVisible({ timeout: 30000 });
    testLogger.navigation('Secrets & variables');
  }

  async openKindTab(kind) {
    await this.page.locator(kind === 'variable' ? this.locators.tabVariable : this.locators.tabSecret).click();
  }

  async search(text) {
    await this.page.locator(this.locators.searchField).fill(text);
  }

  async openCreate(kind) {
    await this.openKindTab(kind);
    await this.page.locator(this.locators.newButton).click();
    await expect(this.page.locator(this.locators.createDrawer)).toBeVisible();
  }

  async fillCreate({ name, value, description, types = [], useRoles = [], hosts = [] }) {
    const drawer = this.page.locator(this.locators.createDrawer);
    await drawer.locator(this.locators.createName).fill(name);
    await drawer.locator(this.locators.createValue).fill(value);
    if (description) await drawer.locator(this.locators.createDescription).fill(description);
    for (const type of types) {
      const box = drawer.locator(`${this.createType(type)} [role="checkbox"]`);
      if ((await box.getAttribute('aria-checked')) !== 'true') await box.click();
      await expect(box).toHaveAttribute('aria-checked', 'true');
    }
    for (const role of useRoles) await this.addTag(drawer.locator('[data-test="secret-create-roles-use"]'), role);
    for (const host of hosts) await this.addTag(drawer.locator('[data-test="secret-create-hosts"]'), host);
  }

  async addTag(root, text) {
    const field = root.locator('[data-test="tag-input-field"]').first();
    await field.fill(text);
    await field.press('Enter');
    await expect(root.getByText(text, { exact: true }).first()).toBeVisible();
  }

  // A successful create closes the form and opens the new secret's drawer.
  async submitCreate() {
    await this.page.locator(this.locators.createSubmit).click();
    await expect(this.page.locator(this.locators.createDrawer)).toBeHidden({ timeout: 15000 });
    await expect(this.page.locator(this.locators.drawerTabs)).toBeVisible({ timeout: 15000 });
  }

  async openSecret(name, { deleted = false } = {}) {
    if (deleted) await this.setShowDeleted(true);
    await this.search(name);
    await this.row(name).click();
    await expect(this.page.locator(this.locators.drawer)).toBeVisible();
    await expect(this.page.locator(this.locators.drawerTabs)).toBeVisible({ timeout: 15000 });
  }

  async setShowDeleted(on) {
    const box = this.page.locator(`${this.locators.showDeleted} [role="checkbox"]`);
    if ((await box.getAttribute('aria-checked')) !== String(on)) await box.click();
    await expect(box).toHaveAttribute('aria-checked', String(on));
  }

  async openDrawerTab(tab) {
    await this.page.locator(`${this.locators.drawerTabs} [data-test="secret-drawer-tab-${tab}"]`).click();
  }

  async closeDrawer() {
    await this.page.locator(`${this.locators.drawer} [data-test="o-drawer-close-btn"]`).click();
    await expect(this.page.locator(this.locators.drawer)).toBeHidden();
  }

  async replaceValue(value, env = '_org') {
    await this.valueReplace(env).click();
    await expect(this.valueInput(env)).toHaveValue('');
    await this.valueInput(env).fill(value);
    await this.valueSave(env).click();
  }

  async addPolicyHost(host) {
    await this.addTag(this.page.locator(this.locators.policyHosts), host);
  }

  async setPinMode(mode) {
    await this.pinMode(mode).click();
    await expect(this.pinMode(mode)).toHaveAttribute('data-state', 'checked');
  }

  async savePolicy() {
    await this.page.locator(this.locators.policySave).click();
  }

  async addAccessRole(role) {
    await selectOSelectOption(this.page, this.locators.accessRoleSelect, role, { search: true });
    await this.page.locator(this.locators.accessAddRole).click();
    await expect(this.accessGrant(role, 'see')).toBeVisible();
  }

  async setGrant(role, right) {
    const box = this.accessGrant(role, right).locator('[role="checkbox"]');
    if ((await box.getAttribute('aria-checked')) !== 'true') await box.click();
    await expect(box).toHaveAttribute('aria-checked', 'true');
  }

  async openMore(action) {
    await this.page.locator(this.locators.drawerMore).click();
    await this.page.locator(action === 'rename' ? this.locators.drawerRename : this.locators.drawerDelete).click();
  }

  async confirmDelete({ force }) {
    const dialog = this.page.locator(this.locators.deleteDialog);
    if (force) {
      const box = dialog.locator(`${this.locators.deleteForce} [role="checkbox"]`);
      await box.click();
      await expect(box).toHaveAttribute('aria-checked', 'true');
    }
    await this.page.locator(this.locators.deleteConfirm).click();
  }

  async rename(newName) {
    await this.openMore('rename');
    await expect(this.page.locator(this.locators.renameDialog)).toBeVisible();
    await this.page.locator(this.locators.renameName).fill(newName);
    await this.page.locator(this.locators.renameConfirm).click();
    await expect(this.page.locator(this.locators.renameDialog)).toBeHidden();
  }

  async purge(name) {
    await this.page.locator(this.locators.drawerPurge).click();
    await expect(this.page.locator(this.locators.purgeDialog)).toBeVisible();
    await this.page.locator(this.locators.purgeName).fill(name);
    await this.page.locator(this.locators.purgeConfirm).click();
  }
}
