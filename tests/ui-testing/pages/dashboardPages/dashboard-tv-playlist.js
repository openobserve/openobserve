//Dashboard TV Playlist Page Object
//Methods: Select dashboards in the list, Playlist dialog (reorder, remove, search, settings, open, copy link), TV player (strip, controls, states)

import { expect } from "@playwright/test";

export default class DashboardTvPlaylistPage {
  constructor(page) {
    this.page = page;

    // Dashboards list
    this.bulkPlaylistBtn = page.locator('[data-test="dashboard-list-tv-playlist-btn"]');

    // Setup dialog
    this.dialog = page.locator('[data-test="dashboard-playlist-dialog"]');
    this.dialogOpenBtn = this.dialog.locator('[data-test="o-dialog-primary-btn"]');
    this.dialogCopyLinkBtn = this.dialog.locator('[data-test="o-dialog-secondary-btn"]');
    this.dialogCancelBtn = this.dialog.locator('[data-test="o-dialog-neutral-btn"]');
    this.searchInput = page.locator('[data-test="dashboard-playlist-search-field"]');
    this.searchResults = page.locator('[data-test="dashboard-playlist-results"]');
    this.itemsList = page.locator('[data-test="dashboard-playlist-items"]');
    this.itemCount = page.locator('[data-test="dashboard-playlist-count"]');
    this.emptyPlaylist = page.locator('[data-test="dashboard-playlist-empty"]');
    this.intervalTrigger = page.locator('[data-test="dashboard-playlist-interval-trigger"]');
    this.intervalOption = page.locator('[data-test="dashboard-playlist-interval-option"]');
    this.periodTrigger = page.locator('[data-test="dashboard-playlist-period-trigger"]');
    this.periodOption = page.locator('[data-test="dashboard-playlist-period-option"]');
    this.fitSwitch = page.locator('[data-test="dashboard-playlist-fit-btn"]');

    // TV player
    this.tvRoot = page.locator('[data-test="dashboard-tv-playlist"]');
    this.invalidLink = page.locator('[data-test="dashboard-tv-invalid"]');
    this.player = page.locator('[data-test="dashboard-playlist-player"]');
    this.strip = page.locator('[data-test="dashboard-playlist-strip"]');
    this.stripTitle = page.locator('[data-test="dashboard-playlist-title"]');
    this.stripCurrent = page.locator('[data-test="dashboard-playlist-current"]');
    this.stripPosition = page.locator('[data-test="dashboard-playlist-position"]');
    this.stripTimeRange = page.locator('[data-test="dashboard-playlist-time-range"]');
    this.prevBtn = page.locator('[data-test="dashboard-playlist-prev"]');
    this.pauseBtn = page.locator('[data-test="dashboard-playlist-pause"]');
    this.nextBtn = page.locator('[data-test="dashboard-playlist-next"]');
    this.exitBtn = page.locator('[data-test="dashboard-playlist-exit"]');
    this.intervalNotice = page.locator('[data-test="dashboard-playlist-interval-notice"]');
    this.emptyState = page.locator('[data-test="dashboard-playlist-empty-state"]');
    this.shownFrame = page.locator('iframe[data-test^="dashboard-playlist-frame-"][data-role="shown"]');
    this.dashboardsListSearch = page.locator('[data-test="dashboard-search-field"]');
  }

  // ── Per-row / per-item factories ───────────────────────────────────────

  getRowCheckbox(dashboardName) {
    return this.page
      .locator(`[data-test="dashboard-name-cell-${dashboardName}"]`)
      .locator("xpath=ancestor::*[starts-with(@data-test,'o2-table-row-')]")
      .locator('label[data-test^="o2-table-select-"]');
  }

  getItem(index) {
    return this.page.locator(`[data-test="dashboard-playlist-item-${index}"]`);
  }

  getItemUpBtn(index) {
    return this.page.locator(`[data-test="dashboard-playlist-up-${index}"]`);
  }

  getItemDownBtn(index) {
    return this.page.locator(`[data-test="dashboard-playlist-down-${index}"]`);
  }

  getItemRemoveBtn(index) {
    return this.page.locator(`[data-test="dashboard-playlist-remove-${index}"]`);
  }

  getSearchResult(dashboardId) {
    return this.page.locator(`[data-test="dashboard-playlist-result-${dashboardId}"]`);
  }

  getSearchResultAddBtn(dashboardId) {
    return this.page.locator(`[data-test="dashboard-playlist-add-${dashboardId}"]`);
  }

  getThemeItem(theme) {
    return this.page.locator(`[data-test="dashboard-playlist-theme-${theme}"]`);
  }

  // ── URL builders ───────────────────────────────────────────────────────

  buildEntries(dashboards, folderId) {
    return dashboards.map((d) => ({ dashboardId: d.dashboardId, folderId }));
  }

  buildTvUrl({ entries, interval, slide, period } = {}) {
    const params = new URLSearchParams({ org_identifier: process.env["ORGNAME"] });
    if (entries) {
      params.set(
        "playlist",
        entries.map((e) => `${e.dashboardId}:${e.folderId}`).join(",")
      );
    }
    if (interval) params.set("interval", interval);
    if (slide) params.set("slide", String(slide));
    if (period) params.set("period", period);
    return `${process.env["ZO_BASE_URL"]}/web/dashboards/tv?${params.toString()}`;
  }

  // ── Dashboards list ────────────────────────────────────────────────────

  async gotoFolder(folderId) {
    await this.page.goto(
      `${process.env["ZO_BASE_URL"]}/web/dashboards?org_identifier=${process.env["ORGNAME"]}&folder=${folderId}`
    );
    await this.dashboardsListSearch.waitFor({ state: "visible", timeout: 30000 });
  }

  async selectDashboards(dashboardNames) {
    for (const name of dashboardNames) {
      const checkbox = this.getRowCheckbox(name);
      await checkbox.waitFor({ state: "visible", timeout: 15000 });
      await checkbox.click();
    }
  }

  async openPlaylistDialog() {
    await this.bulkPlaylistBtn.waitFor({ state: "visible", timeout: 10000 });
    await this.bulkPlaylistBtn.click();
    await expect(this.dialog).toBeVisible();
  }

  // ── Setup dialog actions ───────────────────────────────────────────────

  async moveItemDown(index) {
    await this.getItemDownBtn(index).click();
  }

  async moveItemUp(index) {
    await this.getItemUpBtn(index).click();
  }

  async removeItem(index) {
    await this.getItemRemoveBtn(index).click();
  }

  async searchDashboards(term) {
    await this.searchInput.fill(term);
    await expect(this.searchResults).toBeVisible();
  }

  async addSearchResult(dashboardId) {
    const addBtn = this.getSearchResultAddBtn(dashboardId);
    await addBtn.waitFor({ state: "visible", timeout: 15000 });
    await addBtn.click();
  }

  async selectInterval(seconds) {
    await this.intervalTrigger.click();
    await this.intervalOption.and(this.page.locator(`[data-test-value="${seconds}"]`)).click();
  }

  async selectPeriod(value) {
    await this.periodTrigger.click();
    await this.periodOption.and(this.page.locator(`[data-test-value="${value}"]`)).click();
  }

  async selectTheme(theme) {
    await this.getThemeItem(theme).click();
  }

  async toggleFit() {
    await this.fitSwitch.click();
  }

  // "Copied" only appears after the clipboard write, so waiting out the previous one makes it a fresh signal.
  async copyLink() {
    await expect(this.dialogCopyLinkBtn).not.toContainText("Copied");
    await this.dialogCopyLinkBtn.click();
    await expect(this.dialogCopyLinkBtn).toContainText("Copied");
    return this.page.evaluate(() => navigator.clipboard.readText());
  }

  // window.open uses noopener, so the TV tab arrives as a context page, not a popup.
  async openPlaylist() {
    const [tvPage] = await Promise.all([
      this.page.context().waitForEvent("page"),
      this.dialogOpenBtn.click(),
    ]);
    await tvPage.waitForLoadState("domcontentloaded");
    return tvPage;
  }

  // ── Setup dialog assertions ────────────────────────────────────────────

  async expectItemTitles(titles) {
    await expect(this.itemsList.locator('[data-test^="dashboard-playlist-item-"]')).toHaveCount(
      titles.length
    );
    for (let i = 0; i < titles.length; i++) {
      await expect(this.getItem(i)).toContainText(titles[i]);
    }
  }

  async expectCountText(text) {
    await expect(this.itemCount).toHaveText(text);
  }

  async expectMoveButtonsAtEdges(lastIndex) {
    await expect(this.getItemUpBtn(0)).toBeDisabled();
    await expect(this.getItemDownBtn(lastIndex)).toBeDisabled();
  }

  async expectEmptyPlaylist() {
    await expect(this.emptyPlaylist).toBeVisible();
    await expect(this.dialogOpenBtn).toBeDisabled();
    await expect(this.dialogCopyLinkBtn).toBeDisabled();
  }

  async expectSearchResultAdded(dashboardId) {
    await expect(this.getSearchResult(dashboardId)).toContainText("Added");
    await expect(this.getSearchResultAddBtn(dashboardId)).toHaveCount(0);
  }

  async expectDefaultSettings() {
    await expect(this.intervalTrigger).toHaveText("1 min");
    await expect(this.periodTrigger).toHaveText("Past 1 Hour");
    await expect(this.getThemeItem("current")).toHaveAttribute("aria-pressed", "true");
    await expect(this.fitSwitch).toHaveAttribute("aria-checked", "false");
  }

  async expectDialogClosed() {
    await expect(this.dialog).toBeHidden();
  }

  // ── TV player actions ──────────────────────────────────────────────────

  async gotoPlaylist(options) {
    await this.page.goto(this.buildTvUrl(options));
    await expect(this.tvRoot).toBeVisible({ timeout: 30000 });
  }

  async clickNext() {
    await this.nextBtn.click();
  }

  async clickPrev() {
    await this.prevBtn.click();
  }

  async togglePause() {
    await this.pauseBtn.click();
  }

  async clickExit() {
    await this.exitBtn.click();
  }

  async pressKey(key) {
    await this.page.keyboard.press(key);
  }

  // ── TV player assertions ───────────────────────────────────────────────

  // Each slide is a full app boot inside an iframe, so the first frame can take a while on a cold server.
  async expectPlayerReady(timeout = 60000) {
    await expect(this.player).toBeVisible({ timeout: 30000 });
    await expect(this.strip).toBeVisible();
    await expect(this.shownFrame).toHaveCount(1, { timeout });
  }

  async expectSlide(title, current, total, timeout = 60000) {
    await expect(this.stripTitle).toHaveText(title, { timeout });
    await expect(this.stripCurrent).toHaveText(String(current), { timeout });
    await expect(this.stripPosition).toContainText(`of ${total}`, { timeout });
  }

  async expectSlideParam(slide, timeout = 15000) {
    await expect
      .poll(() => new URL(this.page.url()).searchParams.get("slide"), { timeout })
      .toBe(String(slide));
  }

  async expectPaused(paused) {
    const label = paused ? "Resume rotation" : "Pause rotation";
    await expect(this.pauseBtn).toHaveAttribute("aria-label", label);
    if (paused) await expect(this.stripCurrent).toBeHidden();
    else await expect(this.stripCurrent).toBeVisible();
  }

  // Proves absence of rotation: a full interval plus margin must pass with the slide unchanged.
  async expectSlideHeldWhilePaused(title, slide, holdMs) {
    await this.page.waitForTimeout(holdMs);
    await this.expectSlideParam(slide);
    await expect(this.stripTitle).toHaveText(title);
    await this.expectPaused(true);
  }

  async expectTimeRangeLabelVisible() {
    await expect(this.stripTimeRange).toBeVisible();
  }

  async expectControlsVisible() {
    for (const control of [this.prevBtn, this.pauseBtn, this.nextBtn, this.exitBtn]) {
      await expect(control).toBeVisible();
    }
  }

  async expectExitedToDashboards() {
    await this.page.waitForURL(/\/web\/dashboards(\?|$)/, { timeout: 15000 });
    await expect(this.tvRoot).toBeHidden();
    await expect(this.dashboardsListSearch).toBeVisible({ timeout: 30000 });
  }

  async expectInvalidLink() {
    await expect(this.invalidLink).toBeVisible();
    await expect(this.invalidLink).toContainText("This playlist link names no dashboards");
    await expect(this.player).toHaveCount(0);
  }

  async clickInvalidLinkAction() {
    await this.invalidLink.getByRole("button", { name: "Go to dashboards" }).click();
  }

  async expectIntervalNotice(text) {
    await expect(this.intervalNotice).toBeVisible();
    await expect(this.intervalNotice).toContainText(text);
  }

  async expectEmptyState() {
    await expect(this.emptyState).toBeVisible({ timeout: 60000 });
    await expect(this.emptyState).toContainText(
      "None of the playlist's dashboards are available"
    );
  }

  async expectIntervalParam(value, timeout = 15000) {
    await expect
      .poll(() => new URL(this.page.url()).searchParams.get("interval"), { timeout })
      .toBe(value);
  }
}
