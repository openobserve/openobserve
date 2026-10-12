import { expect } from '@playwright/test';

/**
 * Page object for the Announcement Banners management UI (settings area).
 *
 * All selectors are data-test attributes sourced from the feature source files
 * (web/src/components/settings/AnnouncementBannerList.vue, AnnouncementBannerEditor.vue,
 * AnnouncementMessageField.vue, announcements/AnnouncementBannerStrip.vue and
 * web/src/components/settings/index.vue). The feature is enterprise-gated: the
 * settings route is only registered when config.isEnterprise === "true"
 * (web/src/composables/shared/useManagementRoutes.ts), the tab is only rendered
 * for the meta org (web/src/components/settings/index.vue), and the backend
 * endpoints return 403 without the `enterprise` cargo feature
 * (src/handler/http/request/announcements/mod.rs).
 */
export class AnnouncementBannersPage {
  constructor(page) {
    this.page = page;

    // ==== Navigation (settings area) ====
    this.settingsMenuItem = '[data-test="menu-link-settings-item"]';
    this.announcementTab = '[data-test="announcement-banners-tab"]';

    // ==== List view ====
    this.settingsRoot = '[data-test="announcement-banners-settings"]';
    this.addBannerBtn = '[data-test="announcement-banners-add-btn"]';
    this.emptyState = '[data-test="announcement-banners-list-empty"]';
    this.listTable = '[data-test="announcement-banners-list"]';
    this.previewSection = '[data-test="announcement-banners-preview"]';
    this.previewMessage = '[data-test="announcement-banners-preview"] [data-test="announcement-bar-message"]';

    // ==== Delete confirmation dialog ====
    this.deleteDialog = '[data-test="announcement-banners-delete-dialog"]';
    this.deleteCancelBtn = '[data-test="announcement-banners-delete-cancel"]';
    this.deleteConfirmBtn = '[data-test="announcement-banners-delete-confirm"]';

    // ==== Editor ====
    this.editorPage = '[data-test="announcement-editor-page"]';
    this.editorTitle = '[data-test="announcement-editor-title"]';
    this.editorSaveBtn = '[data-test="announcement-editor-save"]';
    this.editorCancelBtn = '[data-test="announcement-editor-cancel"]';
    this.messageInput = '[data-test="announcement-editor-message"]';
    this.editorError = '[data-test="announcement-editor-error"]';
  }

  // ==== Dynamic row selectors (indexed by banner position in the config) ====
  rowMessage(index) {
    return `[data-test="announcement-banners-row-message-${index}"]`;
  }

  rowStatus(index) {
    return `[data-test="announcement-banners-row-status-${index}"]`;
  }

  rowEdit(index) {
    return `[data-test="announcement-banners-row-edit-${index}"]`;
  }

  rowDelete(index) {
    return `[data-test="announcement-banners-row-delete-${index}"]`;
  }

  // ==== Navigation ====
  async navigateToAnnouncements() {
    await this.page.locator(this.settingsMenuItem).click();
    await expect(this.page.locator(this.announcementTab)).toBeVisible();
    await this.page.locator(this.announcementTab).click();
    await expect(this.page.locator(this.settingsRoot)).toBeVisible();
  }

  // ==== List actions ====
  async clickAddBanner() {
    await this.page.locator(this.addBannerBtn).click();
  }

  async clickEditBanner(index) {
    await this.page.locator(this.rowEdit(index)).click();
  }

  async deleteBanner(index) {
    await this.page.locator(this.rowDelete(index)).click();
    await expect(this.page.locator(this.deleteDialog)).toBeVisible();
    await this.page.locator(this.deleteConfirmBtn).click();
  }

  // ==== Editor actions ====
  async fillMessage(text) {
    await this.page.locator(this.messageInput).locator('textarea').fill(text);
  }

  async saveBanner() {
    await this.page.locator(this.editorSaveBtn).click();
  }

  // ==== Assertions ====
  async expectSettingsVisible() {
    await expect(this.page.locator(this.settingsRoot)).toBeVisible();
  }

  async expectAddBannerButtonVisible() {
    await expect(this.page.locator(this.addBannerBtn)).toBeVisible();
  }

  async expectEditorVisible() {
    // The message field only renders once the editor has loaded its config,
    // so it doubles as the "editor is ready to interact with" signal.
    await expect(this.page.locator(this.messageInput)).toBeVisible();
  }

  async expectRowVisible(index) {
    await expect(this.page.locator(this.rowMessage(index))).toBeVisible();
  }

  async expectRowHidden(index) {
    await expect(this.page.locator(this.rowMessage(index))).not.toBeVisible();
  }

  async expectRowMessage(index, text) {
    await expect(this.page.locator(this.rowMessage(index))).toContainText(text);
  }

  async expectRowStatus(index, text) {
    await expect(this.page.locator(this.rowStatus(index))).toContainText(text);
  }

  async expectLivePreviewContains(text) {
    await expect(this.page.locator(this.previewMessage)).toContainText(text);
  }

  async expectMessageRequiredError() {
    await expect(this.page.locator(this.messageInput)).toHaveClass(/q-field--error/);
  }
}
