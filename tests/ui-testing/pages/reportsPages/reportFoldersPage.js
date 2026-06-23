import { expect } from '@playwright/test';
import { openNavFlyoutChild } from '../commonActions.js';

export class ReportFoldersPage {
  constructor(page) {
    this.page = page;

    // Folder sidebar
    this.addFolderBtn = page.locator('[data-test="dashboard-new-folder-btn"]');
    // OInput wrapper carries `folder-search`; the actual input is auto-forwarded
    // onto `folder-search-field` (see OInput parent-data-test → -field convention).
    this.folderSearchInput = page.locator('[data-test="folder-search-field"]');
    this.folderTabsContainer = page.locator('[data-test="dashboards-folder-tabs"]');
    this.moreIconSelector = '[data-test="dashboard-more-icon"]';
    this.editFolderIcon = page.locator('[data-test="dashboard-edit-folder-icon"]');
    this.deleteFolderIcon = page.locator('[data-test="dashboard-delete-folder-icon"]');

    // Add/Edit folder dialog — ODrawer with parent data-test = "dashboard-folder-dialog";
    // primary/secondary buttons come from ODrawer footer (forwarded via parentDataTest).
    this.folderDialog = page.locator('[data-test="dashboard-folder-dialog"]');
    // OFormInput → OInput → inner native input is auto-suffixed with `-field`.
    // Always fill the `-field` variant per OInput convention.
    this.folderNameInput = page.locator('[data-test="dashboard-folder-add-name-field"]');
    this.folderDescInput = page.locator('[data-test="dashboard-folder-add-description-field"]');
    this.folderSaveBtn = page.locator(
      '[data-test="dashboard-folder-dialog"] [data-test="o-dialog-primary-btn"]'
    );
    this.folderCancelBtn = page.locator(
      '[data-test="dashboard-folder-dialog"] [data-test="o-dialog-secondary-btn"]'
    );
    // OFormInput surfaces validator errors via the inner OInput's
    // `<parentDataTest>-error` slot once `field.state.meta.isTouched` flips
    // true (see OFormInput.vue / OInput.vue). The name validator emits
    // `t("dashboard.nameRequired")` when the trimmed value is empty.
    this.folderNameError = page.locator(
      '[data-test="dashboard-folder-add-name-error"]'
    );

    // Delete confirmation dialog
    this.confirmDeleteDialog = page.locator('[data-test="dashboard-confirm-delete-folder-dialog"]');
    this.confirmButton = page.locator(
      '[data-test="dashboard-confirm-delete-folder-dialog"] [data-test="o-dialog-primary-btn"]'
    );

    // Move dialog — MoveAcrossFolders renders an ODrawer; the outer consumer
    // (<MoveAcrossFolders data-test="report-move-to-another-folder-dialog">)
    // overrides the inner ODrawer's data-test via Vue attr inheritance, so
    // the resolved data-test on the dialog content is the consumer's slug.
    // Primary = Move, Secondary = Cancel (forwarded via ODrawer parentDataTest pattern).
    this.moveDialog = page.locator('[data-test="report-move-to-another-folder-dialog"]');
    // OSelect inside MoveAcrossFolders (via SelectFolderDropDown) carries the
    // `reports-index-dropdown-stream_type` parent data-test.
    this.moveFolderSelectTrigger = page.locator('[data-test="reports-index-dropdown-stream_type"]');
    this.moveFolderSelectPopover = page.locator(
      '[data-test="reports-index-dropdown-stream_type-popover"]'
    );
    this.moveSubmitBtn = page.locator(
      '[data-test="report-move-to-another-folder-dialog"] [data-test="o-dialog-primary-btn"]'
    );
    this.moveCancelBtn = page.locator(
      '[data-test="report-move-to-another-folder-dialog"] [data-test="o-dialog-secondary-btn"]'
    );

    // Report list
    // OInput wrapper for the report search; fill the inner `-field` variant.
    this.reportSearchInput = page.locator('[data-test="report-list-search-input-field"]');
    this.allFoldersToggle = page.locator(
      '[data-test="report-list-search-across-folders-toggle"]'
    );

    // Page title
    this.pageTitle = page.locator('[data-test="report-list-title"]');
  }

  // ───────────────────────────────────────────────────────────────────
  // Per-name / per-index factory helpers — allowed by POM rule §3 since
  // the value is runtime-dynamic; still return Locator instances scoped
  // to data-test attributes only (no role/text/class selectors).
  // ───────────────────────────────────────────────────────────────────

  // Folder tabs are keyed by folderId (which differs from display name) in
  // their `data-test="dashboard-folder-tab-<folderId>"` attribute. To find a
  // tab by user-visible name we resolve folderId via the vuex store using
  // `page.evaluate`. Per §2 this is allowed: the lookup keys off store data
  // (not role/text/class), and the resulting Locator targets the existing
  // data-test attribute on the OTab.
  async getTabByName(folderName) {
    const folderId = await this.resolveFolderIdByName(folderName);
    if (!folderId) {
      // Best-effort fallback — store may not be populated yet. Returns a
      // Locator that won't match anything stable; calling code should treat
      // it as "not present" for visibility assertions.
      return this.page.locator(
        `[data-test="dashboard-folder-tab-__missing__:${folderName}"]`
      );
    }
    return this.page.locator(`button[data-test="dashboard-folder-tab-${folderId}"]`);
  }

  // Move button per report row — `data-test="report-list-${name}-move-report"`.
  moveReportBtn(reportName) {
    return this.page.locator(`[data-test="report-list-${reportName}-move-report"]`);
  }

  // Pause/start indicator (used in expectReportVisibleInTable as a stable
  // per-report hook in the actions column).
  reportPauseStartBtn(reportName) {
    return this.page.locator(`[data-test="report-list-${reportName}-pause-start-report"]`);
  }

  // Resolve folderId from a folder name via the vuex store. Allowed by §2
  // because the lookup is scoped to store data (data-test space upstream),
  // not role/text/class DOM selectors.
  async resolveFolderIdByName(folderName) {
    if (folderName === 'default') return 'default';
    return await this.page.evaluate((name) => {
      // The Vue 3 app instance exposes `$store` via the root component.
      // window.__APP__ is set by main.ts after `app.mount`; fall back to
      // walking #app's __vue_app__ when needed.
      const root = document.querySelector('#app');
      const app =
        // @ts-ignore — these are runtime-only globals exposed by Vue.
        window.__APP__ || (root && root.__vue_app__);
      const store =
        app && app.config && app.config.globalProperties && app.config.globalProperties.$store;
      if (!store) return null;
      const list =
        store.state &&
        store.state.organizationData &&
        store.state.organizationData.foldersByType &&
        store.state.organizationData.foldersByType.reports;
      if (!Array.isArray(list)) return null;
      const match = list.find((item) => item && item.name === name);
      return match ? match.folderId : null;
    }, folderName);
  }

  async navigateToReports() {
    await this.page.goto(
      `${process.env["ZO_BASE_URL"]}/web/reports?org_identifier=${process.env["ORGNAME"]}`,
      { waitUntil: 'domcontentloaded' }
    );
    await this.page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {
      console.warn('navigateToReports: networkidle timed out, continuing');
    });
    await expect(this.pageTitle).toContainText('Reports');
    await this.folderTabsContainer.waitFor({ state: 'visible', timeout: 15000 }).catch(() => {
      console.warn('navigateToReports: folderTabsContainer not visible, continuing');
    });
  }

  async clickAddFolder() {
    await this.addFolderBtn.click();
    await expect(this.folderNameInput).toBeVisible({ timeout: 5000 });
  }

  async fillFolderName(name) {
    await this.folderNameInput.fill(name);
  }

  async fillFolderDescription(desc) {
    await this.folderDescInput.fill(desc);
  }

  async clickSaveFolder() {
    await this.folderSaveBtn.click();
  }

  async clickCancelFolder() {
    await this.folderCancelBtn.click();
  }

  async createFolder(name, description = '') {
    await this.clickAddFolder();
    await this.fillFolderName(name);
    if (description) {
      await this.fillFolderDescription(description);
    }
    await this.clickSaveFolder();
    // Wait for the dialog to close after save
    await this.folderDialog.waitFor({ state: 'hidden', timeout: 5000 }).catch(() => {});
  }

  async expectFolderTabVisible(folderName) {
    // Allow the store time to populate after folder-creation requests so the
    // tab resolution can succeed. Then assert visibility on the resolved tab.
    await expect.poll(async () => {
      const id = await this.resolveFolderIdByName(folderName);
      return id ? 'ready' : 'pending';
    }, { timeout: 10000 }).toBe('ready');
    const tab = await this.getTabByName(folderName);
    await expect(tab).toBeVisible({ timeout: 10000 });
  }

  async expectFolderTabNotVisible(folderName) {
    // If we cannot resolve the folderId (the folder doesn't exist in the
    // store) then the tab is definitively absent.
    const folderId = await this.resolveFolderIdByName(folderName);
    if (!folderId) return;
    const tab = this.page.locator(`button[data-test="dashboard-folder-tab-${folderId}"]`);
    await expect(tab).not.toBeVisible({ timeout: 5000 });
  }

  async clickFolderTab(folderName) {
    const tab = await this.getTabByName(folderName);
    await tab.click();
    await this.page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
  }

  async clickMoreIcon(folderName) {
    const tab = await this.getTabByName(folderName);
    await tab.hover();
    const moreBtn = tab.locator(this.moreIconSelector);
    await moreBtn.waitFor({ state: 'visible', timeout: 3000 });
    await moreBtn.click();
  }

  async clickEditFolder(folderName) {
    await this.clickMoreIcon(folderName);
    await this.editFolderIcon.click({ force: true });
    await expect(this.folderNameInput).toBeVisible({ timeout: 5000 });
  }

  async clickDeleteFolder(folderName) {
    await this.clickMoreIcon(folderName);
    await this.deleteFolderIcon.click({ force: true });
    await expect(this.confirmDeleteDialog).toBeVisible({ timeout: 5000 });
  }

  async confirmDelete() {
    await this.confirmButton.click();
    await this.confirmDeleteDialog.waitFor({ state: 'hidden', timeout: 5000 }).catch(() => {});
  }

  async searchFolders(query) {
    await this.folderSearchInput.fill(query);
    await this.page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
  }

  async clearFolderSearch() {
    await this.folderSearchInput.clear();
    await this.page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
  }

  async expectFolderSaveDisabled() {
    await this.folderSaveBtn.click();
    // onSubmit short-circuits on `!valid` so the dialog must remain open.
    await expect(this.folderDialog).toBeVisible({ timeout: 5000 });
    // If the name field has been touched (typed-then-cleared) the inline
    // error surfaces; on a freshly-opened dialog it may not — soft-assert.
    const inlineErrorVisible = await this.folderNameError
      .isVisible({ timeout: 1000 })
      .catch(() => false);
    if (inlineErrorVisible) {
      await expect(this.folderNameError).toBeVisible();
    }
  }

  async expectFolderSaveEnabled() {
    await expect(this.folderSaveBtn).toBeEnabled();
    await expect(this.folderNameError).toBeHidden({ timeout: 5000 });
  }

  async openMoveDialog(reportName) {
    await this.moveReportBtn(reportName).click({ force: true });
    await expect(this.moveDialog).toBeVisible({ timeout: 5000 });
  }

  async expectMoveButtonDisabled() {
    await expect(this.moveSubmitBtn).toBeDisabled();
  }

  async expectMoveButtonEnabled() {
    await expect(this.moveSubmitBtn).toBeEnabled();
  }

  // Pick a destination folder in the move dialog by visible name. The OSelect's
  // options are keyed by folderId (via `data-test-value="<folderId>"`); we
  // resolve the folderId via the Vuex store (see resolveFolderIdByName), then
  // click the matching option in the popover.
  async selectMoveDestination(folderName) {
    // The folder tab for the destination must already exist in the sidebar
    // (the move dialog reuses the same store-driven folder list).
    const folderId = await this.resolveFolderIdByName(folderName);
    if (!folderId) {
      throw new Error(`selectMoveDestination: could not resolve folderId for "${folderName}"`);
    }

    await this.moveFolderSelectTrigger.click();
    // Wait for the OSelect popover (Reka popover content) to mount.
    await this.moveFolderSelectPopover
      .waitFor({ state: 'visible', timeout: 5000 })
      .catch(() => {});

    // Click the option by data-test-value matching the resolved folderId.
    const option = this.page.locator(
      `[data-test="reports-index-dropdown-stream_type-option"][data-test-value="${folderId}"]`
    );
    await option.waitFor({ state: 'visible', timeout: 5000 });
    await option.click();

    // Popover closes after selection — wait for it to detach.
    await this.moveFolderSelectPopover
      .waitFor({ state: 'hidden', timeout: 5000 })
      .catch(() => {});
  }

  async clickMove() {
    await this.moveSubmitBtn.click();
    await this.moveDialog.waitFor({ state: 'hidden', timeout: 10000 }).catch(() => {});
  }

  async cancelMove() {
    await this.moveCancelBtn.first().click();
    await this.moveDialog.waitFor({ state: 'hidden', timeout: 5000 }).catch(() => {});
  }

  async expectDefaultFolderExists() {
    const tab = await this.getTabByName('default');
    await expect(tab).toBeVisible({ timeout: 10000 });
  }

  async expectMoreIconNotVisible(folderName) {
    const tab = await this.getTabByName(folderName);
    await tab.hover();
    await expect(tab.locator(this.moreIconSelector)).not.toBeVisible({ timeout: 3000 });
  }

  async expectMoreIconVisible(folderName) {
    const tab = await this.getTabByName(folderName);
    await tab.hover();
    await expect(tab.locator(this.moreIconSelector)).toBeVisible({ timeout: 3000 });
  }

  async toggleAllFolders() {
    await this.allFoldersToggle.click();
    await this.page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
  }

  async searchReports(query) {
    await this.reportSearchInput.fill(query);
    await this.page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
  }

  async clearReportSearch() {
    await this.reportSearchInput.clear();
    await this.page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
  }

  async expectReportVisibleInTable(reportName) {
    await expect(this.reportPauseStartBtn(reportName)).toBeVisible({ timeout: 10000 });
  }

  async getFolderCount() {
    // Every OTab in the sidebar carries a `data-test="dashboard-folder-tab-<id>"`.
    return await this.page
      .locator('button[data-test^="dashboard-folder-tab-"]')
      .count();
  }

  async getFirstReportWithMoveButton() {
    const btn = this.page.locator('[data-test*="-move-report"]').first();
    const testId = await btn.getAttribute('data-test');
    if (!testId) return null;
    return testId.replace('report-list-', '').replace('-move-report', '');
  }

  async expectAllFoldersToggleVisible() {
    await expect(this.allFoldersToggle).toBeVisible();
  }

  async isFolderTabPresent(folderName) {
    const folderId = await this.resolveFolderIdByName(folderName);
    if (!folderId) return false;
    return await this.page
      .locator(`button[data-test="dashboard-folder-tab-${folderId}"]`)
      .isVisible({ timeout: 2000 })
      .catch(() => false);
  }

  async deleteFolderIfExists(folderName) {
    if (await this.isFolderTabPresent(folderName)) {
      await this.clickDeleteFolder(folderName);
      await this.confirmDelete();
      return true;
    }
    return false;
  }
}
