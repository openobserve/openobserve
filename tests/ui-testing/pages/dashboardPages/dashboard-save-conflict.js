// Dashboard Save Conflict Page Object
// The shared dialog a dashboard save opens on a 409 (someone else saved first), the "Not saved" banner,
// and the view/editor actions the save-conflict specs use to trigger it.
const testLogger = require('../../playwright-tests/utils/test-logger.js');
const { getOrgIdentifier } = require('../../playwright-tests/utils/cloud-auth.js');
import { expect } from '@playwright/test';
import DashboardactionPage from './dashboard-panel-actions';

export default class DashboardSaveConflict {
  constructor(page) {
    this.page = page;
    this.panelActions = new DashboardactionPage(page);

    this.dialog = page.locator('[data-test="dashboard-save-conflict-dialog"]');
    this.closeBtn = this.dialog.locator('[data-test="o-dialog-close-btn"]');
    this.loading = page.locator('[data-test="dashboard-save-conflict-loading"]');
    this.savedBy = page.locator('[data-test="dashboard-save-conflict-saved-by"]');
    this.myChange = page.locator('[data-test="dashboard-save-conflict-my-change"]');
    this.stillUnresolvedNotice = page.locator('[data-test="dashboard-save-conflict-still-unresolved"]');
    this.panelTouched = page.locator('[data-test="dashboard-save-conflict-panel-touched"]');
    this.panelUntouched = page.locator('[data-test="dashboard-save-conflict-panel-untouched"]');

    this.reloadBtn = page.locator('[data-test="dashboard-save-conflict-reload"]');
    this.overwriteBtn = page.locator('[data-test="dashboard-save-conflict-overwrite"]');
    this.mergeBtn = page.locator('[data-test="dashboard-save-conflict-merge"]');
    this.backBtn = page.locator('[data-test="dashboard-save-conflict-back"]');

    this.overwriteConfirm = page.locator('[data-test="dashboard-save-conflict-confirm"]');
    this.confirmOverwriteBtn = page.locator('[data-test="dashboard-save-conflict-confirm-overwrite"]');

    this.mergeReview = page.locator('[data-test="dashboard-save-conflict-review"]');
    this.saveMergedBtn = page.locator('[data-test="dashboard-save-conflict-save-merged"]');
    this.discardMergeBtn = page.locator('[data-test="dashboard-save-conflict-discard-merge"]');

    this.unsavedBanner = page.locator('[data-test="dashboard-unsaved-conflict-banner"]');
    this.resolveBtn = page.locator('[data-test="dashboard-unsaved-conflict-resolve"]');

    this.panelMenuItems = page.locator('[data-test^="dashboard-edit-panel-"][data-test$="-dropdown"]');
    this.confirmDeleteBtn = page.locator('[data-test="confirm-dialog"] [data-test="o-dialog-primary-btn"]');

    this.addTabBtn = page.locator('[data-test="dashboard-tab-add-btn"]');
    this.addTabDialog = page.locator('[data-test="dashboard-tab-settings-add-tab-dialog"]');
    this.addTabNameInput = this.addTabDialog.locator('[data-test="dashboard-add-tab-name-field"]');
    this.addTabSaveBtn = this.addTabDialog.locator('[data-test="o-dialog-primary-btn"]');

    this.panelSaveBtn = page.locator('[data-test="dashboard-panel-save"]');
  }

  /**
   * A row in "What changed since you loaded".
   * @param {'panel'|'tab'|'variable'|'settings'} kind
   * @param {'added'|'changed'|'removed'} change - ignored for settings, which only has "changed"
   */
  changeRow(kind, change = 'changed') {
    const key = kind === 'settings' ? 'settings-changed' : `${kind}-${change}`;
    return this.dialog.locator(`[data-test="dashboard-save-conflict-change-${key}"]`);
  }

  /** Opens a dashboard in view mode and waits for its panels to render. */
  async openDashboard(dashboardId, { tabId = 'default', folderId = 'default' } = {}) {
    const org = getOrgIdentifier();
    const url = `${process.env.ZO_BASE_URL}/web/dashboards/view?org_identifier=${org}&dashboard=${dashboardId}&folder=${folderId}&tab=${tabId}`;
    testLogger.info('Opening dashboard for save-conflict test', { dashboardId });
    await this.page.goto(url, { waitUntil: 'domcontentloaded' });
    await this.waitForPanels();
  }

  /** Titles of the panels currently on screen, read from the panel menu data-tests. */
  async visiblePanelTitles() {
    return this.panelMenuItems.evaluateAll((nodes) =>
      nodes.map((n) => n.getAttribute('data-test').replace(/^dashboard-edit-panel-/, '').replace(/-dropdown$/, '')),
    );
  }

  /** Deletes a panel from the dashboard view (panel menu → Delete → OK). */
  async deletePanel(panelTitle) {
    await this.panelActions.selectPanelAction(panelTitle, 'Delete');
    await this.confirmDeleteBtn.click();
  }

  /** Opens a panel in the panel editor and waits until it can be saved. */
  async openPanelEditor(panelTitle) {
    await this.panelActions.selectPanelAction(panelTitle, 'Edit');
    await this.page.waitForURL(/add_panel/, { timeout: 30000 });
    await expect(this.panelSaveBtn).toBeEnabled({ timeout: 60000 });
  }

  /** Waits for a dashboard view to show its panels, e.g. after a reload. */
  async waitForPanels() {
    await this.panelMenuItems.first().waitFor({ state: 'visible', timeout: 60000 });
  }

  /** Adds a tab from the tab bar's "+" button; the Add Tab dialog's Save triggers the dashboard save. */
  async addTab(tabName) {
    if (!(await this.addTabDialog.isVisible().catch(() => false))) {
      await this.addTabBtn.click();
    }
    await this.addTabNameInput.waitFor({ state: 'visible', timeout: 10000 });
    await this.addTabNameInput.fill(tabName);
    await this.addTabSaveBtn.click();
  }

  /** Clicks Save in the panel editor without waiting for navigation; on a conflict the editor stays open. */
  async clickPanelSave() {
    await this.panelSaveBtn.waitFor({ state: 'visible' });
    await this.panelSaveBtn.click();
  }

  /** Waits until the conflict dialog has loaded the server copy and shows its choices. */
  async waitForDialog() {
    await this.dialog.waitFor({ state: 'visible', timeout: 30000 });
    await this.loading.waitFor({ state: 'hidden', timeout: 30000 });
    await this.reloadBtn.waitFor({ state: 'visible', timeout: 30000 });
  }

  async waitForDialogClosed() {
    await this.dialog.waitFor({ state: 'hidden', timeout: 30000 });
  }

  /** Closes the dialog with ✕, keeping the unsaved edit. */
  async close() {
    await this.closeBtn.click();
    await this.waitForDialogClosed();
  }

  async reload() {
    await this.reloadBtn.click();
    await this.waitForDialogClosed();
  }

  /** Overwrite → confirmation step; returns the confirmation text so callers can assert what it promises. */
  async startOverwrite() {
    await this.overwriteBtn.click();
    await this.overwriteConfirm.waitFor({ state: 'visible', timeout: 10000 });
    return this.overwriteConfirm.innerText();
  }

  async confirmOverwrite() {
    await this.confirmOverwriteBtn.click();
    await this.waitForDialogClosed();
  }

  /** Merge → preview step. */
  async merge() {
    await this.mergeBtn.click();
    await this.mergeReview.waitFor({ state: 'visible', timeout: 10000 });
  }

  async saveMerged() {
    await this.saveMergedBtn.click();
    await this.waitForDialogClosed();
  }

  async resolveFromBanner() {
    await this.resolveBtn.click();
    await this.waitForDialog();
  }
}
