// methods: createDashboard, searchDashboard, AddPanel, applyButton

import testLogger from "../../playwright-tests/utils/test-logger.js";

export default class DashboardCreate {
  /**
   * Constructor for the DashboardCreate object
   * @param {Page} page - The page object to interact with
   */
  constructor(page) {
    this.page = page;
    this.dashCreateBtn = this.page.locator('[data-test="dashboard-new"]');
    this.dashName = this.page.locator('[data-test="add-dashboard-name"] input');
    this.submitBtn = this.page.locator(
      '[data-test="dashboard-add-dialog"] [data-test="o-dialog-primary-btn"]'
    );
    this.deleteIcon = this.page.locator('[data-test="dashboard-delete"]');
    this.confirmDelete = this.page.locator(
      '[data-test="dashboard-confirm-dialog"] [data-test="o-dialog-primary-btn"]'
    );
    this.searchDash = this.page.locator('[data-test="dashboard-search"]');
    this.addPanelIfEmptyBtn = this.page.locator(
      '[data-test="dashboard-if-no-panel-add-panel-btn"]'
    );
    this.applyQueryBtn = this.page.locator('[data-test="dashboard-apply"]');
    this.backBtn = this.page.locator('[data-test="dashboard-back-btn"]');
    this.defaultFolderTab = this.page.locator(
      'button[data-test="dashboard-folder-tab-default"]'
    );
    this.defaultDashboardTab = this.page.locator(
      '[data-test="dashboard-tab-default"]'
    );
  }

  // Wait for the default tab inside an opened dashboard to be visible
  async waitForDefaultDashboardTabVisible() {
    await this.defaultDashboardTab.waitFor({ state: "visible" });
  }

  // Wait for the "add panel" button on an empty dashboard to be visible
  async waitForAddPanelIfEmptyVisible(timeout) {
    await this.addPanelIfEmptyBtn.waitFor({ state: "visible", timeout });
  }

  // Wait for the dashboard search input to be visible
  async waitForSearchVisible(timeout = 30000) {
    await this.searchDash.waitFor({ state: "visible", timeout });
  }

  // Wait for the dashboard list table to be visible
  async waitForDashboardTableVisible(timeout = 10000) {
    await this.page
      .locator('[data-test="dashboard-table"]')
      .waitFor({ state: "visible", timeout });
  }

  // Wait for the default folder tab on the dashboard list to be visible
  async waitForDefaultFolderTabVisible() {
    await this.defaultFolderTab.waitFor({ state: "visible" });
  }

  /**
   * A one-line snapshot of what the dashboards list actually rendered, for failure
   * messages. A bare `locator.waitFor` timeout says only "the search box never
   * showed" — this says what was on screen instead.
   */
  async describeDashboardList() {
    const state = await this.page
      .evaluate(() => ({
        url: location.href,
        table: !!document.querySelector('[data-test="dashboard-table"]'),
        importBtn: !!document.querySelector('[data-test="dashboard-import"]'),
        createBtn: !!document.querySelector('[data-test="dashboard-new"]'),
        rows: document.querySelectorAll('[data-test^="dashboard-name-cell-"]').length,
        toast:
          document.querySelector("[data-test-variant]")?.getAttribute("data-test-message") ?? null,
      }))
      .catch((e) => ({ evaluateFailed: e.message }));
    return JSON.stringify(state);
  }

  /**
   * Wait for the dashboards list to be fully interactive.
   *
   * `dashboard-search` lives in the toolbar slot of the dashboard TABLE, so this is
   * really a wait for the list data to have loaded. When that load fails on the
   * shared alpha deployment (a transient on a busy environment) the table never
   * mounts and no amount of extra waiting helps — waitForDashboardPage() upstream
   * only warns and continues when the URL looks right, so a failed load reaches
   * here and then dies on an opaque 30s timeout. That accounted for every failure
   * in a 21-run baseline of the axis spec: 10 of them, all at this one line.
   *
   * Re-navigating re-runs the list fetch and clears it. Fail with what was actually
   * on screen if it still doesn't come up.
   */
  async waitForDashboardUIStable() {
    try {
      await this.#waitForDashboardListControls(30000);
      return;
    } catch {
      // A billing redirect is an environment/account state, not a transient — the
      // app bounces EVERY route to /billings/plans, so re-navigating just lands
      // there again and doubles the wait. Fail immediately and name the cause,
      // rather than reporting it as a dashboards-list timeout.
      this.#assertNotRedirectedToBilling();
      testLogger.warn("Dashboards list did not become interactive, re-opening it", {
        state: await this.describeDashboardList(),
      });
    }

    const orgId =
      process.env["ORGNAME"] ?? this.page.url().match(/org_identifier=([^&]+)/)?.[1];
    // Dashboards.vue expects a `folder` query param — without it the list can fail
    // to render (same reasoning as the goto fallback in dashboardList.menuItem).
    await this.page
      .goto(
        `${process.env["ZO_BASE_URL"]}/web/dashboards?org_identifier=${orgId}&folder=default`,
        { waitUntil: "domcontentloaded" }
      )
      .catch(() => {});

    try {
      await this.#waitForDashboardListControls(30000);
      testLogger.info("Dashboards list became interactive after re-opening it");
    } catch {
      this.#assertNotRedirectedToBilling();
      throw new Error(
        `waitForDashboardUIStable: the dashboards list never became interactive, even after ` +
          `re-opening it. Dashboards list state: ${await this.describeDashboardList()}`
      );
    }
  }

  /**
   * Throw a self-explanatory error when the app has bounced us to the billing page.
   *
   * On cloud deployments an expired trial / lapsed subscription redirects every
   * route to /billings/plans. Every dashboard test then fails somewhere deep in
   * setup on an unrelated-looking selector timeout, which reads as flakiness and
   * sends you hunting through the specs. It is neither flaky nor a test bug — the
   * environment needs its plan renewed.
   */
  #assertNotRedirectedToBilling() {
    const url = this.page.url();
    if (!/\/billings?\//.test(url)) return;
    throw new Error(
      `The app redirected to the billing page (${url}). This is an environment/account ` +
        `state, not a test failure: the org's trial or subscription has lapsed, so every ` +
        `route bounces to /billings/plans and no dashboard test can run. Renew the plan ` +
        `for org "${process.env["ORGNAME"] ?? "(unset)"}" or point ORGNAME at an active org.`
    );
  }

  /** The three controls that together mean "the list is loaded and interactive". */
  async #waitForDashboardListControls(timeout) {
    await this.searchDash.waitFor({ state: "visible", timeout });
    await this.dashCreateBtn.waitFor({ state: "visible", timeout });
    const importBtn = this.page.locator('[data-test="dashboard-import"]');
    await importBtn.waitFor({ state: "visible", timeout: 10000 });
  }

  //Create Dashboard
  async createDashboard(dashboardName) {
    // Wait for the dashboard page to be fully loaded by checking for the search input
    await this.searchDash.waitFor({ state: "visible", timeout: 30000 });

    // Wait for the "New Dashboard" button to be ready and enabled
    await this.dashCreateBtn.waitFor({ state: "visible", timeout: 30000 });

    // Wait for network idle to ensure page is fully loaded
    await this.page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {
      // Ignore timeout - continue anyway
    });

    // Opening the dialog is itself flaky: the list behind this button re-renders
    // as folders/dashboards settle, and a click landing on a button that is
    // being torn down silently no-ops. The dialog is client-side, so a click
    // that lands always opens it — a 30s wait expiring means the CLICK was lost,
    // and waiting longer cannot help. Re-click with a fresh lookup instead.
    const dialogAttempts = 3;
    let dialogError;
    for (let attempt = 1; attempt <= dialogAttempts; attempt++) {
      try {
        // Re-click ONLY when the dialog is genuinely absent. Once it is open,
        // ODialog renders a `fixed inset-0` overlay that covers this button, so
        // a second click cannot land — it fails the actionability check and
        // burns the attempt. Without this guard a dialog that merely opened
        // slowly (just past the per-attempt window) would be turned into a hard
        // failure with a perfectly usable dialog on screen.
        if (!(await this.dashName.isVisible().catch(() => false))) {
          await this.dashCreateBtn.click({ timeout: 10000 });
        }
        await this.dashName.waitFor({ state: "attached", timeout: 15000 });
        await this.dashName.waitFor({ state: "visible", timeout: 15000 });
        dialogError = undefined;
        break;
      } catch (e) {
        dialogError = e;
      }
    }
    if (dialogError) {
      throw new Error(
        `createDashboard: "New Dashboard" dialog did not open after ${dialogAttempts} clicks. Last error: ${dialogError.message}`
      );
    }

    // Wait for the input to be enabled (not disabled)
    await this.page.waitForFunction(
      (selector) => {
        const element = document.querySelector(selector);
        return element && !element.disabled && element.offsetParent !== null;
      },
      '[data-test="add-dashboard-name"] input',
      { timeout: 10000 }
    );

    // Submitting is where this flakes, in two ways that look identical from the
    // outside — an opaque waitForURL timeout with no navigation in the log:
    //
    //   1. AddDashboard.vue seeds OForm from :default-values, and a fill that
    //      lands before that seeding is overwritten with an empty name.
    //   2. The dialog's primary button submits the form by id, and a click
    //      issued while that wiring is still settling silently no-ops.
    //
    // Either way submit is gated by the form's Zod schema, so onSubmit never
    // runs, no POST goes out, and updateDashboardList() — the only thing that
    // routes to /dashboards/view — is never called. Re-assert the name and
    // watch for the create POST, so a lost submit is retried rather than
    // waited out, and a rejected one fails with the actual status.
    //
    // The retry gate matches on the REQUEST, not the response: a request that
    // has been sent but not yet answered still proves the click landed, so a
    // slow server can never be mistaken for a lost submit and re-submitted
    // into a duplicate dashboard.
    const isCreateCall = (target) =>
      /\/api\/[^/]+\/dashboards(?:\?|$)/.test(target.url()) &&
      (target.method?.() ?? target.request().method()) === "POST";

    let createRequest = null;
    let createResponse = null;

    for (let attempt = 1; attempt <= 2; attempt++) {
      // Re-assert on every attempt: if the form seeded over our value, the
      // retry has to repair the field, not just click again.
      if ((await this.dashName.inputValue()) !== dashboardName) {
        await this.dashName.fill(dashboardName);
      }

      const requestPromise = this.page
        .waitForRequest(isCreateCall, { timeout: 10000 })
        .catch(() => null);
      const responsePromise = this.page
        .waitForResponse(isCreateCall, { timeout: 30000 })
        .catch(() => null);

      await this.submitBtn.waitFor({ state: "visible", timeout: 30000 });
      await this.submitBtn.click();

      createRequest = await requestPromise;
      if (createRequest) {
        createResponse = await responsePromise;
        break;
      }

      // Nothing hit the wire. Only retry while the dialog is still open — if it
      // closed, the submit did land and the URL wait below is the right gate.
      const dialogStillOpen = await this.submitBtn
        .isVisible()
        .catch(() => false);
      if (!dialogStillOpen) break;
    }

    if (createResponse && !createResponse.ok()) {
      throw new Error(
        `Dashboard creation failed: POST ${createResponse.url()} returned ${createResponse.status()}`
      );
    }

    // Wait for the success notification to confirm dashboard was created
    // OToast root carries both data-test="o-toast-success" and data-test-message="<text>"
    // so we can assert type + content in one selector (getByText is banned per selector policy)
    await this.page.locator('[data-test-variant="success"][data-test-message="Dashboard added successfully."]').first().waitFor({ state: 'visible', timeout: 15000 }).catch(() => {
      // Toast may have appeared and disappeared before waitFor evaluated — the
      // waitForURL check below is the real gate for whether creation succeeded.
    });

    // Wait for navigation to the new dashboard view page
    await this.page.waitForURL(/\/dashboards\/view/, { timeout: 30000 });

    // Wait for the page to be fully loaded
    await this.page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {
      // Ignore timeout - continue anyway
    });

    // Wait for Vue components to mount — use deterministic check on panel editor or back button
    await this.page.locator('[data-test="dashboard-back-btn"]').waitFor({ state: 'visible', timeout: 15000 });
  }

  //back to dashboard list
  async backToDashboardList() {
    // "Back" is not one hop from everywhere. The panel editor and the
    // dashboard view both render data-test="dashboard-back-btn", but
    // AddPanel.vue's goBack() pushes /dashboards/view while ViewDashboard.vue's
    // goBackToDashboardList() pushes /dashboards — so reaching the list from
    // the editor genuinely takes TWO clicks. On top of that, a click issued
    // mid page-transition can land on a header that is being torn down and
    // silently no-op. Click, re-check the URL, and repeat with a fresh locator
    // lookup until we're on the list.
    //
    // Leaving add_panel with unsaved panel edits fires AddPanel.vue's
    // onBeforeRouteLeave native window.confirm. Playwright auto-dismisses
    // dialogs by default, and a dismissed confirm means next(false) — the
    // route change is cancelled, so every back click no-ops and the loop
    // burns all its attempts still sitting on add_panel. Accept the dialog
    // for the duration of the navigation (same handling as
    // dashboard-multi-sql.js discardPanel()).
    const LIST_URL = /\/dashboards(?:\?|$)/;
    const maxClicks = 4;
    let lastError;

    const dialogHandler = (dialog) => dialog.accept();
    this.page.on("dialog", dialogHandler);
    try {
      for (let attempt = 1; attempt <= maxClicks; attempt++) {
        if (LIST_URL.test(this.page.url())) return;

        const backBtn = this.page.locator('[data-test="dashboard-back-btn"]');
        try {
          await backBtn.waitFor({ state: "visible", timeout: 20000 });
          await backBtn.click({ timeout: 10000 });
        } catch (e) {
          // Header may be remounting between the editor and view pages — fall
          // through to the URL check and try again with a fresh lookup.
          lastError = e;
        }

        try {
          await this.page.waitForURL(LIST_URL, { timeout: 8000 });
          return;
        } catch (e) {
          lastError = e;
        }
      }
    } finally {
      this.page.off("dialog", dialogHandler);
    }

    if (LIST_URL.test(this.page.url())) return;
    throw new Error(
      `backToDashboardList: still at ${this.page.url()} after ${maxClicks} back clicks. Last error: ${lastError?.message}`
    );
  }

  //wait for back button to be visible (no click)
  async waitForBackBtnVisible() {
    await this.backBtn.waitFor({ state: "visible" });
  }

  //Search the Folder
  async searchDashboard(dashboardName) {
    await this.page
      .locator('button[data-test="dashboard-folder-tab-default"]')
      .waitFor({ state: "visible" });

    await this.searchDash.locator('input').click();
    await this.searchDash.locator('input').fill(dashboardName);
  }

  //Delete Dashboard
  async deleteDashboard() {
    await this.page
      .locator('button[data-test="dashboard-folder-tab-default"]')
      .waitFor({ state: "visible" });
    const dashboardRow = this.page.locator('[data-test="dashboard-table"]');
    await dashboardRow.waitFor({ state: "visible" });
    await dashboardRow.locator('[data-test="dashboard-delete"]').first().click();
    const confirmDialog = this.page.locator(
      '[data-test="dashboard-confirm-dialog"]'
    );
    await confirmDialog.waitFor({ state: "visible" });
    const confirmDeleteButton = confirmDialog.locator(
      '[data-test="o-dialog-primary-btn"]'
    );
    await confirmDeleteButton.waitFor({ state: "visible" });
    await confirmDeleteButton.click();
  }

  //Add Panel to dashboard (when dashboard is empty)
  async addPanel() {
    // The empty-state "add panel" button renders as soon as the dashboard has
    // no panels — which is also true while the dashboard GET is still loading.
    // Clicking it that early makes ViewDashboard.vue's addPanelData() read
    // tabs[0] before tabs exist, which throws inside the handler so router.push
    // never runs: the click reports success and the URL never changes, burning
    // every retry below. The tab strip only renders once tabs have loaded, so
    // waiting for it gates the click on the data it depends on.
    await this.defaultDashboardTab
      .waitFor({ state: "visible", timeout: 30000 })
      .catch(() => {
        // Non-fatal: some dashboards legitimately render no tab strip. The
        // retry loop below is still the real gate on navigation succeeding.
      });

    // Retry pattern for clicking add panel button
    const maxRetries = 3;
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      await this.addPanelIfEmptyBtn.waitFor({ state: "visible", timeout: 15000 });
      await this.addPanelIfEmptyBtn.scrollIntoViewIfNeeded();

      // Click the button
      await this.addPanelIfEmptyBtn.click();

      // Wait for URL to contain add_panel
      try {
        await this.page.waitForURL(/add_panel/, { timeout: 10000 });
        break; // Success
      } catch (e) {
        if (attempt === maxRetries) {
          throw new Error(`addPanel: Failed to navigate to add_panel after ${maxRetries} attempts. Last error: ${e.message}`);
        }
        // Retry - the click may not have worked
      }
    }

    // Wait for panel editor to be ready
    await this.page.locator('[data-test="dashboard-apply"]').or(
      this.page.locator('[data-test^="selected-chart-"]').first()
    ).first().waitFor({ state: "visible", timeout: 15000 });
  }

  //Add Panel to dashboard (when dashboard already has panels)
  async addPanelToExistingDashboard() {
    const addPanelBtn = this.page.locator('[data-test="dashboard-panel-add"]');

    // Retry pattern for clicking add panel button
    const maxRetries = 3;
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      await addPanelBtn.waitFor({ state: "visible", timeout: 15000 });
      await addPanelBtn.scrollIntoViewIfNeeded();

      // Click the button
      await addPanelBtn.click();

      // Wait for URL to contain add_panel
      try {
        await this.page.waitForURL(/add_panel/, { timeout: 10000 });
        break; // Success
      } catch (e) {
        if (attempt === maxRetries) {
          throw new Error(`addPanelToExistingDashboard: Failed to navigate to add_panel after ${maxRetries} attempts. Last error: ${e.message}`);
        }
        // Retry - the click may not have worked
      }
    }

    // Wait for panel editor to be ready
    await this.page.locator('[data-test="dashboard-apply"]').or(
      this.page.locator('[data-test^="selected-chart-"]').first()
    ).first().waitFor({ state: "visible", timeout: 15000 });
  }

  //Add Panel - works for both empty and non-empty dashboards
  async addPanelSmart() {
    const addPanelBtn = this.page.locator('[data-test="dashboard-panel-add"]');
    const addPanelIfEmptyBtn = this.addPanelIfEmptyBtn;

    // Determine which button to click
    const addBtnVisible = await addPanelBtn.isVisible({ timeout: 2000 }).catch(() => false);
    const targetBtn = addBtnVisible ? addPanelBtn : addPanelIfEmptyBtn;

    // Retry pattern for clicking add panel button
    const maxRetries = 3;
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      await targetBtn.waitFor({ state: "visible", timeout: 15000 });
      await targetBtn.scrollIntoViewIfNeeded();

      // Click the button
      await targetBtn.click();

      // Wait for URL to contain add_panel
      try {
        await this.page.waitForURL(/add_panel/, { timeout: 10000 });
        break; // Success
      } catch (e) {
        if (attempt === maxRetries) {
          throw new Error(`addPanelSmart: Failed to navigate to add_panel after ${maxRetries} attempts. Last error: ${e.message}`);
        }
        // Retry - the click may not have worked
      }
    }

    // Wait for panel editor to be ready
    await this.page.locator('[data-test="dashboard-apply"]').or(
      this.page.locator('[data-test^="selected-chart-"]').first()
    ).first().waitFor({ state: "visible", timeout: 15000 });
  }

  //Apply dashboard button
  async applyButton() {
    await this.applyQueryBtn.waitFor({ state: "visible", timeout: 15000 });
    await this.applyQueryBtn.click();
  }
}
