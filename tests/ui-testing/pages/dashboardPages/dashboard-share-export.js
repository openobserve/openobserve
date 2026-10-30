//Dashboard Share and Export Page Object
//Methods: Share dashboard, Export dashboard

const { expect } = require("@playwright/test");
const {
  getVariableSelector,
  getVariableSelectorInner,
  getEditVariableBtn,
  getVariableLoadingIndicator,
  SELECTORS,
} = require("./dashboard-selectors.js");

export default class DashboardShareExportPage {
  constructor(page) {
    this.page = page;
    this.shareBtn = page.locator('[data-test="dashboard-share-btn"]');
    this.exportBtn = page.locator('[data-test="dashboard-download-btn"]');
    this.backBtn = page.locator('[data-test="dashboard-back-btn"]');
    this.addPanelEmptyBtn = page.locator(
      '[data-test="dashboard-if-no-panel-add-panel-btn"]'
    );
    this.dashboardNameTitle = page.locator('[data-test="dashboard-name-title"]');
    this.toastSuccess = page.locator('[data-test-variant="success"]');
    // Scoped success toast for the share-link "Link Copied Successfully!" message —
    // multiple success toasts can coexist (e.g. "Dashboard added successfully."
    // and "Link Copied Successfully!"), so we key off OToast's data-test-message
    // attribute (set in `web/src/lib/feedback/Toast/OToast.vue`) to avoid the
    // strict-mode "resolves to 2 elements" error.
    this.toastSuccessShareLink = page.locator(
      '[data-test-variant="success"][data-test-message*="Link Copied"]'
    );
    this.toastMessage = page.locator('[data-test="o-toast-message"]');
    this.dateTimeBtn = page.locator('[data-test="date-time-btn"]');
    this.absoluteTab = page.locator('[data-test="date-time-absolute-tab"]');
    this.settingBtn = page.locator('[data-test="dashboard-setting-btn"]');
    this.settingsTabTab = page.locator('[data-test="dashboard-settings-tab-tab"]');
    this.tabListContainer = page.locator(
      '[data-test="dashboard-tab-list-container"]'
    );
  }

  //share dashboard
  async shareDashboard() {
    await this.backBtn.waitFor({
      state: "visible",
    });
    await this.shareBtn.click();
  }

  //Wait for share success toast (Link copied successfully)
  //Uses the scoped toastSuccessShareLink locator so we don't collide with
  //an overlapping "Dashboard added successfully." toast (strict-mode safe).
  async waitForShareSuccess(timeout = 10000) {
    await expect(this.toastSuccessShareLink).toBeVisible({ timeout });
  }

  //Returns the share success toast locator for assertion in specs
  //Returns the scoped "Link Copied" toast — callers that just want
  //to assert presence/absence of the share toast specifically use this.
  getShareSuccessToast() {
    return this.toastSuccessShareLink;
  }

  //Read the short URL copied to clipboard after share
  //Polls clipboard until it contains "/short/" (share button is async)
  async getCopiedUrl(page, timeout = 15000) {
    const target = page || this.page;
    const start = Date.now();
    let lastValue = "";
    while (Date.now() - start < timeout) {
      lastValue = await target.evaluate(() => navigator.clipboard.readText());
      if (lastValue && lastValue.includes("/short/")) {
        return this.normalizeShareHost(lastValue);
      }
      await target.waitForTimeout(250);
    }
    return this.normalizeShareHost(lastValue);
  }

  /**
   * Rewrite a copied share URL onto the host the test is actually running against.
   *
   * The backend's short-URL service bakes in its own externally-facing hostname,
   * which is NOT the host under test: on alpha it hands back
   * `alpha.common-dev.external.zinclabs.dev` while the suite runs against
   * `alpha.common-dev.internal.zinclabs.dev`. The saved SSO session is scoped to
   * the host that issued it, so following the returned link lands on an
   * unauthenticated origin and the app bounces to the Dex login page — the
   * dashboard never renders, and every test here failed waiting for
   * `dashboard-back-btn`. Two of them additionally leaked their dashboard,
   * because cleanup's in-app "back" button does not exist on the login screen.
   *
   * dashboardPage.verifyShareDashboardLink() already does this rewrite for the
   * same reason; this is the same fix for the share/export page object.
   *
   * The path (including `/short/<id>`) is preserved, so assertions on it still
   * hold — only the origin changes.
   */
  normalizeShareHost(url) {
    const baseUrl = process.env.ZO_BASE_URL || "";
    if (!url || !baseUrl) return url;
    try {
      const target = new URL(url);
      const base = new URL(baseUrl);
      if (target.host === base.host) return url;
      target.protocol = base.protocol;
      target.host = base.host;
      return target.toString();
    } catch {
      // Not an absolute URL (e.g. the clipboard never populated) — hand it back
      // unchanged so the caller's own assertion reports the real problem.
      return url;
    }
  }

  //Wait for the dashboard view page to be fully loaded
  async waitForDashboardViewLoaded(page, timeout = 15000) {
    const target = page || this.page;
    await target
      .locator('[data-test="dashboard-back-btn"]')
      .waitFor({ state: "visible", timeout });
  }

  //Wait for dashboard add panel button to be visible (empty dashboard view)
  async waitForEmptyDashboardView(timeout = 15000) {
    await this.addPanelEmptyBtn.waitFor({ state: "visible", timeout });
  }

  //Verify the dashboard title is visible with the given name
  async verifyDashboardNameVisible(name, page, timeout = 10000) {
    const target = page || this.page;
    const title = target.locator('[data-test="dashboard-name-title"]');
    await expect(title).toBeVisible({ timeout });
    await expect(title).toHaveText(name, { timeout });
  }

  //Click share button directly (idempotent variant used inside tests after settings)
  async clickShareButton() {
    await this.shareBtn.waitFor({ state: "visible" });
    await this.shareBtn.click();
  }

  //Open the date-time picker and switch to the Absolute tab
  async openAbsoluteDateTime() {
    await this.dateTimeBtn.click();
    await this.absoluteTab.click();
  }

  //Open settings drawer and switch to the Tab section
  async openSettingsTabSection() {
    await this.settingBtn.click();
    await this.settingsTabTab.waitFor({ state: "visible" });
    await this.settingsTabTab.click();
  }

  //Click a dashboard tab by its name (uses data-test-tab-name attribute)
  async clickTabByName(tabName, timeout = 15000) {
    const tab = this.page.locator(
      `[data-test-tab-name="${tabName}"]`
    );
    await tab.waitFor({ state: "visible", timeout });
    await tab.click();
  }

  //Locator for the edit-variable button of a saved dashboard variable
  getEditVariableButton(variableName) {
    return this.page.locator(getEditVariableBtn(variableName));
  }

  //Locator for a dashboard variable selector on the dashboard view
  getVariableSelectorLocator(variableName) {
    return this.page.locator(getVariableSelector(variableName));
  }

  //Locator for a dashboard variable's loading indicator
  getVariableLoadingIndicatorLocator(variableName) {
    return this.page.locator(getVariableLoadingIndicator(variableName));
  }

  //Locator for the inner (select) element of a dashboard variable dropdown
  getVariableDropdownInner(variableName) {
    return this.page.locator(getVariableSelectorInner(variableName));
  }

  //Locator for the open dropdown menu
  getMenu() {
    return this.page.locator(SELECTORS.MENU);
  }

  //Locator for the first role=option entry in an open menu
  getFirstRoleOption() {
    return this.page.locator(SELECTORS.ROLE_OPTION).first();
  }

  //Navigate to a URL using a separate playwright page (new tab context)
  async openInNewPage(url) {
    const context = this.page.context();
    const newPage = await context.newPage();
    await newPage.goto(url);
    return newPage;
  }

  //Export dashboard
  async exportDashboard() {
    await this.backBtn.waitFor({
      state: "visible",
    });
    await this.exportBtn.click();
  }
}
