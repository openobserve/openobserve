// Workflow folders page object — folders for Workflows + folder-scoped RBAC (merged #14421).
// Plan: .claude/commands/nvpworkflow/workflow-folders-automation.md
//
// The folder rail, the add/edit dialog and the move dialog are the SHARED components
// (FolderList.vue / AddFolder.vue / MoveAcrossFolders.vue), so under Workflows they still
// carry `dashboard-*` data-tests. Only the list-side and editor-side selectors are
// workflow-specific. Do not "fix" the dashboard-prefixed names — they are what ships.
//
// Two conventions that bite:
//   * OInput forwards the real <input> to a `-field`-suffixed data-test; filling the wrapper
//     is a silent no-op.
//   * Folder tabs are keyed by folderId, NOT display name, so a name -> tab lookup goes
//     through the vuex store (resolveFolderIdByName).

const { expect } = require('@playwright/test');
const { getOrgIdentifier } = require('../../playwright-tests/utils/cloud-auth.js');

const LIST_TIMEOUT_MS = 45000;   // K10: the workflows list GET is slow
const DIALOG_TIMEOUT_MS = 10000;
const EDITOR_TIMEOUT_MS = 30000; // the editor mounts a canvas; slower than a dialog

class WorkflowFoldersPage {
  constructor(page) {
    this.page = page;

    // ---------- folder rail (shared FolderList.vue) ----------
    this.addFolderBtn = page.locator('[data-test="dashboard-new-folder-btn"]').first();
    this.folderSearchInput = page.locator('[data-test="folder-search-field"]');
    this.folderTabsContainer = page.locator('[data-test="dashboards-folder-tabs"]');
    this.moreIconSelector = '[data-test="dashboard-more-icon"]';
    this.editFolderIcon = page.locator('[data-test="dashboard-edit-folder-icon"]');
    this.deleteFolderIcon = page.locator('[data-test="dashboard-delete-folder-icon"]');

    // ---------- add / edit folder dialog (shared AddFolder.vue) ----------
    this.folderDialog = page.locator('[data-test="dashboard-folder-dialog"]');
    this.folderNameInput = page.locator('[data-test="dashboard-folder-add-name-field"]');
    this.folderDescInput = page.locator('[data-test="dashboard-folder-add-description-field"]');
    this.folderSaveBtn = page.locator(
      '[data-test="dashboard-folder-dialog"] [data-test="o-dialog-primary-btn"]'
    );
    this.folderCancelBtn = page.locator(
      '[data-test="dashboard-folder-dialog"] [data-test="o-dialog-secondary-btn"]'
    );
    this.folderNameError = page.locator('[data-test="dashboard-folder-add-name-error"]');

    // ---------- delete confirmation ----------
    this.confirmDeleteDialog = page.locator('[data-test="dashboard-confirm-delete-folder-dialog"]');
    this.confirmDeleteBtn = page.locator(
      '[data-test="dashboard-confirm-delete-folder-dialog"] [data-test="o-dialog-primary-btn"]'
    );

    // ---------- move dialog ----------
    // The consumer's data-test overrides the inner ODialog's via attr inheritance, so the
    // resolved slug on the dialog content is WorkflowsList.vue's, not "move-across-folders-dialog".
    this.moveDialog = page.locator('[data-test="workflow-move-to-another-folder-dialog"]');
    this.moveCurrentFolderInput = page.locator('[data-test="workflows-folder-move-name-field"]');
    this.moveFolderSelectTrigger = page.locator('[data-test="workflows-index-dropdown-stream_type"]');
    this.moveFolderSelectPopover = page.locator(
      '[data-test="workflows-index-dropdown-stream_type-popover"]'
    );
    this.moveNewFolderBtn = page.locator('[data-test="workflows-folder-move-new-add"]');
    this.moveSubmitBtn = page.locator(
      '[data-test="workflow-move-to-another-folder-dialog"] [data-test="o-dialog-primary-btn"]'
    );
    this.moveCancelBtn = page.locator(
      '[data-test="workflow-move-to-another-folder-dialog"] [data-test="o-dialog-secondary-btn"]'
    );

    // ---------- workflow list ----------
    this.listPage = page.locator('[data-test="workflows-list-page"]');
    this.listSearchInput = page.locator('[data-test="workflow-list-search-input-field"]');
    this.searchScopeCurrent = page.locator('[data-test="workflow-list-search-scope-current"]');
    this.searchAcrossFoldersToggle = page.locator(
      '[data-test="workflow-list-search-across-folders-toggle"]'
    );
    this.listRefreshBtn = page.locator('[data-test="workflow-list-refresh"]');
    this.listTabs = page.locator('[data-test="workflow-list-tabs"]');
    this.draftTag = page.locator('[data-test="workflow-list-draft-tag"]');
    // Prefix match: folder tabs are keyed by folderId, so a count needs the family, not one id.
    this.anyFolderTab = page.locator('button[data-test^="dashboard-folder-tab-"]');

    // ---------- editor (reached from a folder's list) ----------
    this.editorPage = page.locator('[data-test="workflow-editor-page"]');
    this.editorNameValue = page.locator('[data-test="workflow-editor-name-value"]');

    // ---------- editor folder picker (create only) ----------
    this.editorFolderDropdown = page.locator('[data-test="workflow-editor-folder"]');
    this.inlineFolderTrigger = page.locator('[data-test="inline-select-folder-dropdown"]');
    this.inlineFolderAddBtn = page.locator('[data-test="inline-select-folder-dropdown-add"]');
    this.inlineFolderDialog = page.locator('[data-test="inline-select-folder-dropdown-dialog"]');
  }

  // ---------- per-name factories ----------

  moveWorkflowBtn(workflowName) {
    return this.page.locator(`[data-test="workflow-list-${workflowName}-move"]`);
  }

  workflowRowAnchor(workflowName) {
    // The view control is the only per-row element rendered unconditionally. Pause/start and
    // move are both `v-if="!row.is_draft"` — drafts aren't runnable and can't be moved — so
    // anchoring on either silently breaks every draft assertion.
    return this.page.locator(`[data-test="workflow-list-${workflowName}-view"]`);
  }

  listTab(value) {
    return this.page.locator(`[data-test="workflow-list-tab-${value}"]`);
  }

  // ---------- store-backed folder id lookup ----------

  // Folder tabs carry `data-test="dashboard-folder-tab-<folderId>"`, and folderId is not the
  // display name, so resolve it through the store the app already populates. Keying off store
  // data (never role/text/class) keeps the resulting locator in data-test space.
  async resolveFolderIdByName(folderName) {
    if (folderName === 'default') return 'default';
    return await this.page.evaluate((name) => {
      const root = document.querySelector('#app');
      // @ts-ignore — runtime-only globals exposed by Vue.
      const app = window.__APP__ || (root && root.__vue_app__);
      const store =
        app && app.config && app.config.globalProperties && app.config.globalProperties.$store;
      if (!store) return null;
      const list =
        store.state &&
        store.state.organizationData &&
        store.state.organizationData.foldersByType &&
        store.state.organizationData.foldersByType.workflows;
      if (!Array.isArray(list)) return null;
      const match = list.find((item) => item && item.name === name);
      return match ? match.folderId : null;
    }, folderName);
  }

  async getTabByName(folderName) {
    const folderId = await this.resolveFolderIdByName(folderName);
    if (!folderId) {
      // The store may not be populated yet. Return a locator that cannot match, so
      // visibility assertions read as "not present" rather than throwing here.
      return this.page.locator(`[data-test="dashboard-folder-tab-__missing__:${folderName}"]`);
    }
    return this.page.locator(`button[data-test="dashboard-folder-tab-${folderId}"]`);
  }

  // ---------- navigation ----------

  async goToList(folderId) {
    const org = getOrgIdentifier();
    const folderParam = folderId ? `&folder=${folderId}` : '';
    await this.page.goto(
      `${process.env.ZO_BASE_URL}/web/workflows?org_identifier=${org}${folderParam}`,
      { timeout: 60000 }
    );
    await this.waitForListReady();
  }

  async waitForListReady() {
    // K10: the list GET is slow; wait for the page container plus the end of "Loading data".
    await this.listPage.first().waitFor({ state: 'visible', timeout: LIST_TIMEOUT_MS });
    await this.page
      .locator('text=Loading data')
      .waitFor({ state: 'detached', timeout: LIST_TIMEOUT_MS })
      .catch(() => {});
    await this.folderTabsContainer.waitFor({ state: 'visible', timeout: DIALOG_TIMEOUT_MS }).catch(() => {});
  }

  // The folder is carried in the URL, so read it back from there rather than from the rail —
  // this is what catches a router.push that replaced the query and dropped `folder`.
  folderIdFromUrl() {
    return new URL(this.page.url()).searchParams.get('folder');
  }

  async expectFolderInUrl(folderId) {
    await expect
      .poll(() => this.folderIdFromUrl(), { timeout: DIALOG_TIMEOUT_MS })
      .toBe(folderId);
  }

  // ---------- folder CRUD ----------

  async clickAddFolder() {
    await this.addFolderBtn.click();
    await expect(this.folderNameInput).toBeVisible({ timeout: DIALOG_TIMEOUT_MS });
  }

  async createFolder(name, description = '') {
    await this.clickAddFolder();
    await this.folderNameInput.fill(name);
    if (description) await this.folderDescInput.fill(description);
    await this.folderSaveBtn.click();
    await this.folderDialog.waitFor({ state: 'hidden', timeout: DIALOG_TIMEOUT_MS }).catch(() => {});
  }

  async cancelFolderDialog() {
    await this.folderCancelBtn.click();
    await expect(this.folderDialog).toBeHidden({ timeout: DIALOG_TIMEOUT_MS });
  }

  async expectFolderSaveBlockedOnEmptyName() {
    await this.folderSaveBtn.click();
    // onSubmit short-circuits on an invalid form, so the dialog must still be open.
    await expect(this.folderDialog).toBeVisible({ timeout: DIALOG_TIMEOUT_MS });
  }

  async expectFolderTabVisible(folderName) {
    await expect
      .poll(async () => ((await this.resolveFolderIdByName(folderName)) ? 'ready' : 'pending'), {
        timeout: DIALOG_TIMEOUT_MS,
      })
      .toBe('ready');
    const tab = await this.getTabByName(folderName);
    await expect(tab).toBeVisible({ timeout: DIALOG_TIMEOUT_MS });
  }

  async expectFolderTabNotVisible(folderName) {
    const folderId = await this.resolveFolderIdByName(folderName);
    if (!folderId) return; // unresolvable == definitively absent
    await expect(
      this.page.locator(`button[data-test="dashboard-folder-tab-${folderId}"]`)
    ).not.toBeVisible({ timeout: DIALOG_TIMEOUT_MS });
  }

  async expectDefaultFolderExists() {
    await expect(await this.getTabByName('default')).toBeVisible({ timeout: DIALOG_TIMEOUT_MS });
  }

  async clickFolderTab(folderName) {
    const tab = await this.getTabByName(folderName);
    await tab.click();
    await this.page.waitForLoadState('networkidle', { timeout: DIALOG_TIMEOUT_MS }).catch(() => {});
  }

  async clickMoreIcon(folderName) {
    const tab = await this.getTabByName(folderName);
    await tab.hover();
    const moreBtn = tab.locator(this.moreIconSelector);
    await moreBtn.waitFor({ state: 'visible', timeout: 5000 });
    await moreBtn.click();
  }

  async expectMoreIconNotVisible(folderName) {
    const tab = await this.getTabByName(folderName);
    await tab.hover();
    await expect(tab.locator(this.moreIconSelector)).not.toBeVisible({ timeout: 3000 });
  }

  async renameFolder(folderName, newName) {
    await this.clickMoreIcon(folderName);
    await this.editFolderIcon.waitFor({ state: 'visible', timeout: 5000 });
    await this.editFolderIcon.click();
    await expect(this.folderNameInput).toBeVisible({ timeout: DIALOG_TIMEOUT_MS });
    await this.folderNameInput.fill(newName);
    await this.folderSaveBtn.click();
    await this.folderDialog.waitFor({ state: 'hidden', timeout: DIALOG_TIMEOUT_MS }).catch(() => {});
  }

  async clickDeleteFolder(folderName) {
    await this.clickMoreIcon(folderName);
    await this.deleteFolderIcon.waitFor({ state: 'visible', timeout: 5000 });
    await this.deleteFolderIcon.click();
    await expect(this.confirmDeleteDialog).toBeVisible({ timeout: DIALOG_TIMEOUT_MS });
  }

  async confirmDeleteFolder() {
    await this.confirmDeleteBtn.click();
    await this.confirmDeleteDialog.waitFor({ state: 'hidden', timeout: DIALOG_TIMEOUT_MS }).catch(() => {});
    await this.page.waitForLoadState('networkidle', { timeout: DIALOG_TIMEOUT_MS }).catch(() => {});
  }

  async searchFolders(query) {
    await this.folderSearchInput.fill('');
    await this.folderSearchInput.fill(query);
    await this.page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
  }

  async folderTabCount() {
    return await this.anyFolderTab.count();
  }

  // ---------- move ----------

  async openMoveDialog(workflowName) {
    // The move control is rendered per-row but revealed on hover, so reveal it
    // before clicking rather than bypassing actionability with force.
    await this.workflowRowAnchor(workflowName).hover();
    await this.moveWorkflowBtn(workflowName).waitFor({ state: 'visible', timeout: 5000 });
    await this.moveWorkflowBtn(workflowName).click();
    await expect(this.moveDialog).toBeVisible({ timeout: DIALOG_TIMEOUT_MS });
  }

  async selectMoveDestination(folderName) {
    const folderId = await this.resolveFolderIdByName(folderName);
    if (!folderId) {
      throw new Error(`selectMoveDestination: could not resolve folderId for "${folderName}"`);
    }
    await this.moveFolderSelectTrigger.click();
    await this.moveFolderSelectPopover.waitFor({ state: 'visible', timeout: 5000 }).catch(() => {});
    const option = this.page.locator(
      `[data-test="workflows-index-dropdown-stream_type-option"][data-test-value="${folderId}"]`
    );
    // This select is NOT searchable, and OSelect virtualizes its options, so a destination
    // below the fold is simply absent from the DOM. Page the list down until it renders
    // rather than waiting on an element that will never appear on its own.
    for (let i = 0; i < 20; i += 1) {
      if (await option.isVisible().catch(() => false)) break;
      await this.moveFolderSelectPopover.press('PageDown').catch(() => {});
    }
    await option.waitFor({ state: 'visible', timeout: DIALOG_TIMEOUT_MS });
    await option.click();
    await this.moveFolderSelectPopover.waitFor({ state: 'hidden', timeout: 5000 }).catch(() => {});
  }

  async clickMove() {
    await this.moveSubmitBtn.click();
    // Hard assert: the dialog only closes once the PATCH resolves, so swallowing this
    // would let a failed move pass here and break a later test instead.
    await expect(this.moveDialog).toBeHidden({ timeout: 15000 });
    await this.page
      .locator('[data-test="o-dialog-overlay"]')
      .waitFor({ state: 'hidden', timeout: 3000 })
      .catch(() => {});
    await this.page.waitForLoadState('networkidle', { timeout: DIALOG_TIMEOUT_MS }).catch(() => {});
  }

  async cancelMove() {
    await this.moveCancelBtn.first().click();
    await this.moveDialog.waitFor({ state: 'hidden', timeout: 5000 }).catch(() => {});
    await this.page
      .locator('[data-test="o-dialog-overlay"]')
      .waitFor({ state: 'hidden', timeout: 3000 })
      .catch(() => {});
  }

  // Submit stays disabled while the destination equals the source — the dialog's
  // only signal that nothing would happen.
  async expectMoveDisabled() {
    await expect(this.moveSubmitBtn).toBeDisabled();
  }

  async expectMoveEnabled() {
    await expect(this.moveSubmitBtn).toBeEnabled();
  }

  async moveWorkflowToFolder(workflowName, destinationFolderName) {
    await this.openMoveDialog(workflowName);
    await this.selectMoveDestination(destinationFolderName);
    await this.expectMoveEnabled();
    await this.clickMove();
  }

  // ---------- list search / scope ----------

  async searchWorkflows(query) {
    // Clear first — fill()-ing the value the model already holds is a no-op.
    await this.listSearchInput.fill('');
    await this.listSearchInput.fill(query);
    await this.page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
  }

  async clearWorkflowSearch() {
    await this.listSearchInput.fill('');
    await this.page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
  }

  async setSearchScopeAllFolders() {
    await this.searchAcrossFoldersToggle.click();
    await this.page.waitForLoadState('networkidle', { timeout: DIALOG_TIMEOUT_MS }).catch(() => {});
  }

  async setSearchScopeCurrentFolder() {
    await this.searchScopeCurrent.click();
    await this.page.waitForLoadState('networkidle', { timeout: DIALOG_TIMEOUT_MS }).catch(() => {});
  }

  async isSearchAcrossFoldersActive() {
    const state = await this.searchAcrossFoldersToggle.getAttribute('data-state');
    return state === 'on' || state === 'active';
  }

  async refreshList() {
    await this.listRefreshBtn.click({ timeout: 5000 });
    await this.page.waitForLoadState('networkidle', { timeout: DIALOG_TIMEOUT_MS }).catch(() => {});
  }

  async selectListTab(value) {
    await this.listTab(value).click();
    await this.page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
  }

  // ---------- row assertions ----------

  async expectWorkflowVisible(workflowName) {
    // Refresh then re-search on each attempt: the list GET is slow and cached, so
    // re-typing alone cannot pull in a row the page has not fetched.
    await expect(async () => {
      if (await this.workflowRowAnchor(workflowName).isVisible().catch(() => false)) return;
      await this.refreshList();
      await this.searchWorkflows(workflowName);
      await expect(this.workflowRowAnchor(workflowName)).toBeVisible({ timeout: 5000 });
    }).toPass({ timeout: LIST_TIMEOUT_MS });
  }

  async expectWorkflowNotVisible(workflowName) {
    await expect(this.workflowRowAnchor(workflowName)).not.toBeVisible({ timeout: 5000 });
  }

  async expectDraftTagOnRow(workflowName) {
    await expect(this.workflowRowAnchor(workflowName)).toBeVisible({ timeout: DIALOG_TIMEOUT_MS });
    await expect(this.draftTag.first()).toBeVisible({ timeout: DIALOG_TIMEOUT_MS });
  }

  // Moving a DRAFT between folders is not supported — move_workflows only touches the
  // workflows table, so the list keeps the button published-only.
  async expectMoveUnavailableForDraft(workflowName) {
    await expect(this.moveWorkflowBtn(workflowName)).toHaveCount(0);
  }

  // ---------- editor, entered from a folder's list ----------

  // The row's edit control is the way into the editor from a folder listing; owning it here
  // keeps the folder-round-trip specs (WFF-UI-11/12) free of raw selectors.
  editWorkflowBtn(workflowName) {
    return this.page.locator(`[data-test="workflow-list-${workflowName}-edit"]`);
  }

  async openEditorFromRow(workflowName) {
    await this.editWorkflowBtn(workflowName).click();
    await this.expectEditorVisible();
  }

  async expectEditorVisible() {
    await expect(this.editorPage).toBeVisible({ timeout: EDITOR_TIMEOUT_MS });
  }

  async expectEditorNameContains(workflowName) {
    await expect(this.editorNameValue).toContainText(workflowName, { timeout: EDITOR_TIMEOUT_MS });
  }

  // Re-enter the editor by its own URL — the cold-load path a refresh takes.
  async reloadCurrentUrl() {
    await this.page.goto(this.page.url(), { timeout: 60000 });
  }

  // ---------- editor folder picker ----------

  // OSelect VIRTUALIZES its option list — only the visible window is in the DOM — so an
  // option below the fold never becomes visible and the click times out. Orgs accumulate
  // folders, so this fails as a function of how many folders exist, not of the code under
  // test. This select is `searchable`, so filter by name first: that collapses the list to
  // one row regardless of how many folders there are.
  async selectFolderInEditor(folderName) {
    const folderId = await this.resolveFolderIdByName(folderName);
    if (!folderId) {
      throw new Error(`selectFolderInEditor: could not resolve folderId for "${folderName}"`);
    }
    await this.inlineFolderTrigger.click();
    const search = this.page.locator('[data-test="inline-select-folder-dropdown-search"]');
    if (await search.isVisible({ timeout: 2000 }).catch(() => false)) {
      await search.fill(folderName);
    }
    const option = this.page.locator(
      `[data-test="inline-select-folder-dropdown-option"][data-test-value="${folderId}"]`
    );
    await option.waitFor({ state: 'visible', timeout: DIALOG_TIMEOUT_MS });
    await option.click();
  }

  // The picker renders only while creating; on an existing workflow the folder is static text.
  async expectEditorFolderPickerVisible() {
    await expect(this.editorFolderDropdown).toBeVisible({ timeout: DIALOG_TIMEOUT_MS });
  }

  async expectEditorFolderPickerHidden() {
    await expect(this.editorFolderDropdown).toBeHidden({ timeout: DIALOG_TIMEOUT_MS });
  }
}

module.exports = WorkflowFoldersPage;
