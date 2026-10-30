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

import { expect } from '@playwright/test';

export class LogsSavedFunctionPage {
  constructor(page) {
    this.page = page;

    this.functionEditor = '[data-test="logs-vrl-function-editor"]';
    this.saveFunctionButton = '[data-test="logs-search-bar-save-function-btn"]';
    this.functionDropdown = '[data-test="logs-search-bar-function-dropdown"]';

    this.savedFunctionDialog = '[data-test="search-bar-store-state-saved-function-dialog"]';
    this.updateConfirmDialog = '[data-test="search-bar-function-update-confirm-dialog"]';
    this.dialogPrimaryButton = '[data-test="o-dialog-primary-btn"]';

    this.nameInput = '[data-test="saved-function-name-input-field"]';
    this.updateModeButton = '[data-test="saved-function-action-toggle"] button[value="update"]';
    this.nameSelectTrigger = '[data-test="saved-function-name-select-trigger"]';
  }

  savedFunctionItem(name) {
    return `[data-test="logs-search-saved-function-${name}"]`;
  }

  nameSelectOption(name) {
    return `[data-test="saved-function-name-select-option"][data-test-value="${name}"]`;
  }

  async openLogs(org, stream) {
    const url =
      `/web/logs?org_identifier=${org}&stream=${stream}&stream_type=logs` +
      '&period=15m&refresh=0&sql_mode=false&quick_mode=false&show_histogram=true&fn_editor=true';
    await this.page.goto(url, { waitUntil: 'domcontentloaded' });
    await this.page
      .locator(`${this.functionEditor} .monaco-editor`)
      .first()
      .waitFor({ state: 'visible', timeout: 60000 });
  }

  async setFunctionBody(text) {
    const editor = this.page.locator(`${this.functionEditor} .monaco-editor`).first();
    await editor.click();
    await this.page.keyboard.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A');
    // Typed, not filled: SearchBar reads tempFunctionContent from Monaco's change events, which a direct value write never fires.
    const textarea = this.page.locator(`${this.functionEditor} .monaco-editor textarea`);
    await textarea.pressSequentially(text);
    await expect.poll(() => this.functionBody(), { timeout: 15000 }).toContain(text);
    // CodeQueryEditor holds the edit for its 500ms debounce; blur flushes it to tempFunctionContent, which the save dialog gates on.
    await textarea.blur();
  }

  async functionBody() {
    const text = await this.page.locator(`${this.functionEditor} .view-lines`).first().innerText();
    return text.replace(/\u00a0/g, ' ').trim();
  }

  async openSaveDialog() {
    await this.page.locator(this.saveFunctionButton).click();
    await this.page.locator(this.savedFunctionDialog).waitFor({ state: 'visible', timeout: 30000 });
  }

  async submitDialog(dialog) {
    await this.page.locator(`${dialog} ${this.dialogPrimaryButton}`).click();
  }

  async createFunction(name) {
    await this.openSaveDialog();
    await this.page.locator(this.nameInput).fill(name);
    await this.submitDialog(this.savedFunctionDialog);
    await this.page.locator(this.savedFunctionDialog).waitFor({ state: 'hidden', timeout: 30000 });
  }

  async overwriteFunction(name) {
    await this.openSaveDialog();
    await this.page.locator(this.updateModeButton).click();
    await this.page.locator(this.nameSelectTrigger).click();
    await this.page.locator(this.nameSelectOption(name)).click();
    await this.submitDialog(this.savedFunctionDialog);
    await this.page.locator(this.updateConfirmDialog).waitFor({ state: 'visible', timeout: 30000 });
    await this.submitDialog(this.updateConfirmDialog);
    await this.page.locator(this.savedFunctionDialog).waitFor({ state: 'hidden', timeout: 30000 });
  }

  async applySavedFunction(name) {
    await this.page.locator(this.functionDropdown).click();
    await this.page.locator(this.savedFunctionItem(name)).click();
  }
}
