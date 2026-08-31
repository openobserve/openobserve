// Page object for Dashboard Panel Drilldown configuration
// Covers: Logs, URL, byDashboard drilldown types + chart-click trigger

import { expect } from "@playwright/test";

export default class DashboardDrilldownPage {
  constructor(page) {
    this.page = page;

    // Config sidebar — drilldown section
    this.addButton = page.locator('[data-test="dashboard-addpanel-config-drilldown-add-btn"]').first();
    this.popup = page.locator('[data-test="dashboard-drilldown-popup"]');
    this.nameInput = page.locator('[data-test="dashboard-config-panel-drilldown-name-field"]');
    this.logsButton = page.locator('[data-test="dashboard-drilldown-by-logs-btn"]');
    this.urlButton = page.locator('[data-test="dashboard-drilldown-by-url-btn"]');
    this.urlTextarea = page.locator('[data-test="dashboard-drilldown-url-textarea-field"]');
    this.urlErrorMessage = page.locator('[data-test="dashboard-drilldown-url-textarea-error"]');
    this.newTabToggle = page.locator('[data-test="dashboard-drilldown-open-in-new-tab"]');
    this.folderSelect = page.locator('[data-test="dashboard-drilldown-folder-select"]');
    this.dashboardSelect = page.locator('[data-test="dashboard-drilldown-dashboard-select"]');
    this.tabSelect = page.locator('[data-test="dashboard-drilldown-tab-select"]');

    // The clickable part of an OSelect is the trigger <button> INSIDE the
    // `data-test` wrapper — and the `disabled` attribute lives on that button,
    // not on the wrapper. Clicking the wrapper therefore skips Playwright's
    // "enabled" actionability check entirely (a <div> is never disabled) and the
    // click lands on a disabled <button>, where the browser swallows it. Always
    // drive the trigger so the click waits for the select's list to finish loading.
    this.selectTrigger = (baseTestId) =>
      page.locator(`[data-test="${baseTestId}-trigger"]`);
    this.confirmButton = page.locator(
      '[data-test="dashboard-drilldown-popup"] [data-test="o-dialog-primary-btn"]'
    );
    // Unscoped primary dialog button (matches the spec's page-level confirm click).
    this.dialogPrimaryButton = page.locator('[data-test="o-dialog-primary-btn"]');

    // Drilldown popup — variable mapping + passAllVariables toggle
    this.addVariableButton = page.locator('[data-test="dashboard-drilldown-add-variable"]');
    this.passAllVariablesToggle = page.locator('[data-test="dashboard-drilldown-pass-all-variables"]');
    // The variable-mapping OCombobox rows in DrilldownPopUp have no data-test —
    // match by placeholder, scoped to the popup.
    this.variableNameInput = this.popup.getByPlaceholder('Name').first();
    this.variableValueInput = this.popup.getByPlaceholder('Value').first();

    // Dashboard view — first table panel
    this.panelTable = page.locator('[data-test="dashboard-panel-table"]').first();

    // Dashboard view — drilldown trigger overlay
    this.drilldownMenu = page.locator('[data-test="drilldown-menu"]');
    this.drilldownMenuFirstItem = page.locator('[data-test^="drilldown-menu-item"]').first();

    // Per-name factory helpers for OSelect options (use data-test-value lookup, per §4)
    this.folderOptionByValue = (value) =>
      page.locator(`[data-test="dashboard-drilldown-folder-select-option"][data-test-value="${value}"]`);
    this.dashboardOptionByValue = (value) =>
      page.locator(`[data-test="dashboard-drilldown-dashboard-select-option"][data-test-value="${value}"]`);
    this.tabOptionByValue = (value) =>
      page.locator(`[data-test="dashboard-drilldown-tab-select-option"][data-test-value="${value}"]`);
    this.tabOptionAny = () =>
      page.locator('[data-test="dashboard-drilldown-tab-select-option"]');
  }

  generateUniqueDrilldownName(prefix = "u") {
    return `${prefix}_${Date.now()}`;
  }

  /**
   * Get an ARIA-role listbox option by its (exact) accessible name.
   * Used for the folder / dashboard / tab OSelect dropdowns which render
   * role="option" items.
   * @param {string} name - Exact option label
   * @returns {import('@playwright/test').Locator}
   */
  optionByRole(name) {
    return this.page.getByRole("option", { name, exact: true });
  }

  /**
   * Get the first ARIA-role listbox option (used when any option is acceptable).
   * @returns {import('@playwright/test').Locator}
   */
  firstOptionByRole() {
    return this.page.getByRole("option").first();
  }

  /**
   * Open a drilldown OSelect dropdown and wait until its listbox is really open.
   *
   * The three byDashboard selects cascade through async fetches (folders →
   * dashboards → tabs) and each one renders `:disabled` while its own list is in
   * flight. Two things then have to be true before an option can be clicked:
   *
   *  1. the trigger must be enabled — so we click the trigger <button> (which
   *     carries `disabled`) rather than the wrapper <div>, letting Playwright's
   *     actionability check wait out the load instead of firing a click that the
   *     disabled button silently drops;
   *  2. the popover must actually be open — the trigger can flip back to disabled
   *     between the actionability check and the dispatched mouse event (the tab
   *     list is refetched when the dashboard changes), so we assert `data-state`
   *     and re-issue the click if the popover did not open.
   *
   * @param {string} baseTestId - e.g. "dashboard-drilldown-tab-select"
   */
  async openSelectDropdown(baseTestId) {
    const trigger = this.selectTrigger(baseTestId);
    await expect(trigger).toBeEnabled({ timeout: 15000 });

    await expect(async () => {
      if ((await trigger.getAttribute("data-state")) !== "open") {
        await trigger.click();
      }
      await expect(trigger).toHaveAttribute("data-state", "open", { timeout: 2000 });
    }).toPass({ timeout: 20000, intervals: [200, 500, 1000] });
  }

  /**
   * Pick an option out of one of the byDashboard OSelects by its `data-test-value`.
   *
   * The three selects cascade through async refetches (folders -> dashboards ->
   * tabs) driven by watchers in DrilldownPopUp.vue, and the watcher bodies `await`
   * before they touch the form. That leaves two windows where a plain
   * "open the dropdown, click the option" sequence silently does the wrong thing:
   *
   *  1. The refetch has not STARTED yet, so the select still looks idle
   *     (`:disabled` is still false) while its `options` are the previous
   *     dashboard's. Opening it here shows a stale list — the wanted tab is
   *     simply not in it, and the click then waits out its full timeout against
   *     an option that was never going to render in that open session.
   *  2. The dashboard watcher finishes AFTER our click and runs
   *     `setFormField("data.tab", tabList[0].value)`, overwriting the tab we
   *     just chose with the destination's first tab ("Default").
   *
   * So: re-open until the option is really there, and treat the trigger's own
   * `data-test-selected-value` as the proof the choice stuck. Both windows are
   * self-healing on the next attempt because by then the fetch has landed.
   *
   * The search box is used to narrow the list first — the popover virtualises its
   * rows (@tanstack/vue-virtual), so an option far down a long list (the dashboard
   * select sees every dashboard in the folder, including the ones the other
   * parallel workers are creating) has no DOM node until it is scrolled to.
   *
   * @param {string} baseTestId - e.g. "dashboard-drilldown-tab-select"
   * @param {string|null} value - `data-test-value` to pick; null picks the first option
   */
  async selectOptionByValue(baseTestId, value, { timeout = 30000 } = {}) {
    const trigger = this.selectTrigger(baseTestId);
    const search = this.page.locator(`[data-test="${baseTestId}-search"]`);
    const option =
      value === null
        ? this.page.locator(`[data-test="${baseTestId}-option"]`).first()
        : this.page
            .locator(`[data-test="${baseTestId}-option"][data-test-value="${value}"]`)
            .first();

    await expect(async () => {
      await this.openSelectDropdown(baseTestId);

      // Filtering also forces the virtualiser to re-render around the match.
      if (value !== null && (await search.count())) {
        await search.fill(value);
      }

      const appeared = await option
        .waitFor({ state: "visible", timeout: 5000 })
        .then(() => true)
        .catch(() => false);

      if (!appeared) {
        // Close before retrying: the option list only re-reads `options` on the
        // next open, and leaving the popover open would make openSelectDropdown
        // a no-op on the next attempt (it short-circuits on data-state="open").
        await this.page.keyboard.press("Escape");
        await expect(trigger)
          .not.toHaveAttribute("data-state", "open", { timeout: 5000 })
          .catch(() => {});
        throw new Error(
          `${value === null ? "no option" : `"${value}"`} in ${baseTestId} yet (list still loading)`
        );
      }

      await option.click();
      await expect(trigger).not.toHaveAttribute("data-state", "open", { timeout: 5000 });

      if (value !== null) {
        await expect(trigger).toHaveAttribute("data-test-selected-value", value, {
          timeout: 5000,
        });
        // Re-assert after a beat: a watcher still in flight can reset the field
        // right after we read it, and that must fail THIS attempt (so we pick
        // again) rather than leaving the drilldown pointing at the wrong tab.
        await this.page.waitForTimeout(600);
        await expect(trigger).toHaveAttribute("data-test-selected-value", value, {
          timeout: 2000,
        });
      }
    }).toPass({ timeout, intervals: [500, 1000, 2000] });
  }

  /**
   * Wait until no tab-list fetch is in flight, so the NEXT dashboard change
   * actually refetches instead of being swallowed.
   *
   * DrilldownPopUp's loaders go through `useLoading`, whose `execute()` opens with
   * a hard re-entrancy guard — `if (isLoading.value) return;` — so a call made
   * while the previous one is still running is DROPPED, not queued. The tab list
   * is only ever refetched from the `data.dashboard` watcher, so once a drop
   * happens nothing re-triggers it: `tabList` keeps the previously-selected
   * dashboard's tabs for the rest of the popup's life and the wanted tab can
   * never render, no matter how often the dropdown is re-opened.
   *
   * That is exactly what happens on the folder pick: the folder watcher
   * auto-selects `dashboardList[0]`, whose tab fetch is still in flight when the
   * test picks the real destination a moment later.
   *
   * `:disabled` on the tab select mirrors `getTabListLoading.isLoading`, so an
   * enabled trigger is the precondition for `execute()` NOT being dropped, and a
   * non-empty selected value proves the fetch got far enough for the watcher to
   * run `setFormField("data.tab", tabList[0].value)` — enabled-but-unset is the
   * pre-fetch state, not the settled one.
   */
  async waitForTabListIdle() {
    const tabTrigger = this.selectTrigger("dashboard-drilldown-tab-select");
    await this.tabSelect.waitFor({ state: "visible", timeout: 20000 });
    await expect(tabTrigger).toBeEnabled({ timeout: 30000 });
    await expect(tabTrigger).toHaveAttribute("data-test-selected-value", /.+/, {
      timeout: 30000,
    });
  }

  /**
   * Pick the drilldown's destination tab, recovering from a dropped tab-list fetch.
   *
   * waitForTabListIdle() closes the window that causes the drop, but the guard in
   * useLoading is racy by nature, so keep an escape hatch: the watcher only fires
   * when `data.dashboard` CHANGES, so bounce the dashboard select off some other
   * option and back to force a fresh fetch — this time with nothing in flight.
   *
   * @param {string} dashboardTitle - the destination dashboard, for the bounce
   * @param {string|null} tabName
   */
  async selectTabOption(dashboardTitle, tabName) {
    const attempts = 3;
    for (let attempt = 1; attempt <= attempts; attempt++) {
      try {
        await this.selectOptionByValue("dashboard-drilldown-tab-select", tabName ?? null, {
          timeout: 15000,
        });
        return;
      } catch (error) {
        if (attempt === attempts) throw error;
        await this.repickDashboard(dashboardTitle);
      }
    }
  }

  /**
   * Re-select `dashboardTitle` via a different option, so the `data.dashboard`
   * watcher genuinely re-fires and refetches the tab list.
   */
  async repickDashboard(dashboardTitle) {
    const baseTestId = "dashboard-drilldown-dashboard-select";
    const decoy = this.page
      .locator(`[data-test="${baseTestId}-option"]:not([data-test-value="${dashboardTitle}"])`)
      .first();

    await this.openSelectDropdown(baseTestId);
    if (await decoy.count()) {
      await decoy.click();
      await expect(this.selectTrigger(baseTestId)).not.toHaveAttribute("data-state", "open", {
        timeout: 5000,
      });
      // Let the decoy's own fetch finish, or re-picking the destination would be
      // dropped by the very same guard we are working around.
      await this.waitForTabListIdle();
    } else {
      // Folder holds only this dashboard — nothing to bounce off.
      await this.page.keyboard.press("Escape");
    }

    await this.selectOptionByValue(baseTestId, dashboardTitle);
    await this.waitForTabListIdle();
  }

  // Backward-compatible alias for dashboard.spec.js (old signature: folderName, drilldownName, dashboardName, tabName)
  async addDrilldownDashboard(folderName, drilldownName, dashboardName, tabName) {
    return this.addDrilldownByDashboard(drilldownName, folderName, dashboardName, tabName);
  }

  /**
   * Scroll the drilldown Add button into view inside the config sidebar,
   * then open the popup and fill the drilldown name.
   */
  async openPopup(name) {
    await this.addButton.scrollIntoViewIfNeeded();
    await this.addButton.click();
    await this.popup.waitFor({ state: 'visible', timeout: 10000 });
    await this.nameInput.waitFor({ state: 'visible', timeout: 5000 });
    await this.nameInput.fill(name);
  }

  /**
   * Add a Logs drilldown and save it.
   * @param {string} name
   * @param {object} [options]
   * @param {boolean} [options.openInNewTab=false] - Whether to enable open-in-new-tab.
   */
  async addDrilldownByLogs(name, { openInNewTab = false } = {}) {
    await this.openPopup(name);
    await this.logsButton.waitFor({ state: 'visible', timeout: 5000 });
    await this.logsButton.click();
    if (openInNewTab) {
      await this.newTabToggle.waitFor({ state: 'visible', timeout: 5000 });
      await this.newTabToggle.click();
    }
    await this.confirmButton.waitFor({ state: 'visible', timeout: 5000 });
    await this.confirmButton.click();
    await this.popup.waitFor({ state: 'hidden', timeout: 10000 });
  }

  /**
   * Open popup and switch to URL type without saving.
   * Use this when you need to assert URL validation state before saving.
   */
  async openURLPopup(name) {
    await this.openPopup(name);
    await this.urlButton.waitFor({ state: 'visible', timeout: 5000 });
    await this.urlButton.click();
    await this.urlTextarea.waitFor({ state: 'visible', timeout: 5000 });
  }

  /**
   * Add a URL drilldown and save it.
   * @param {string} name
   * @param {string} url
   * @param {object} [options]
   * @param {boolean} [options.openInNewTab=false] - Whether to enable open-in-new-tab.
   */
  async addDrilldownByURL(name, url, { openInNewTab = false } = {}) {
    await this.openURLPopup(name);
    await this.urlTextarea.fill(url);
    if (openInNewTab) {
      await this.newTabToggle.waitFor({ state: 'visible', timeout: 5000 });
      await this.newTabToggle.click();
    }
    await this.confirmButton.waitFor({ state: 'visible', timeout: 5000 });
    await this.confirmButton.click();
    await this.popup.waitFor({ state: 'hidden', timeout: 10000 });
  }

  /**
   * Add a byDashboard drilldown.
   * @param {string} name
   * @param {string} folderName - Folder name (e.g. "default")
   * @param {string} dashboardTitle - Destination dashboard title
   * @param {string|null} [tabName=null] - Tab to select by exact name; null selects first available
   * @param {object} [options]
   * @param {boolean} [options.openInNewTab=false] - Whether to enable open-in-new-tab.
   */
  async addDrilldownByDashboard(name, folderName, dashboardTitle, tabName = null, { openInNewTab = false } = {}) {
    await this.openPopup(name);
    // byDashboard is the default drilldown type
    await this.folderSelect.waitFor({ state: 'visible', timeout: 10000 });
    await this.selectOptionByValue("dashboard-drilldown-folder-select", folderName);

    await this.dashboardSelect.waitFor({ state: 'visible', timeout: 10000 });
    // Drain the folder watcher's auto-selected dashboard BEFORE switching to ours,
    // otherwise our tab fetch is dropped by useLoading's re-entrancy guard.
    await this.waitForTabListIdle();
    await this.selectOptionByValue("dashboard-drilldown-dashboard-select", dashboardTitle);

    await this.tabSelect.waitFor({ state: 'visible', timeout: 10000 });
    await this.selectTabOption(dashboardTitle, tabName ?? null);

    if (openInNewTab) {
      await this.newTabToggle.waitFor({ state: 'visible', timeout: 5000 });
      await this.newTabToggle.click();
    }

    await this.confirmButton.waitFor({ state: 'visible', timeout: 5000 });
    await this.confirmButton.click();
    await this.popup.waitFor({ state: 'hidden', timeout: 10000 });
  }

  /**
   * Click the first data row of a table panel (dashboard view) to open
   * the drilldown popup overlay. Returns the drilldown menu locator.
   * Table panels use DOM row-click events which are reliable in CI.
   */
  async triggerDrilldownFromTable() {
    // Ensure we're on the dashboard view page (savePanel may still be navigating)
    await this.page.waitForURL(url => !url.toString().includes('/add_panel'), { timeout: 15000 });

    // Scroll the table panel into the viewport so virtual-scroll renders rows
    const tablePanel = this.page.locator('[data-test="dashboard-panel-table"]').first();
    await tablePanel.waitFor({ state: 'attached', timeout: 20000 });
    await tablePanel.scrollIntoViewIfNeeded();

    // Rows render directly in tbody, keyed data-test="o2-table-row-<index>".
    // Click the first data row to trigger the @click:dataRow event (emitted as row-click).
    const tableRow = tablePanel.locator('[data-test^="o2-table-row-"]').first();
    await tableRow.waitFor({ state: 'visible', timeout: 30000 });
    await tableRow.click();
    await this.page.waitForTimeout(500);
    return this.drilldownMenu;
  }

  /**
   * Wait for a same-tab byDashboard drilldown to actually land on the destination.
   *
   * `page.waitForURL(/\/dashboards\/view/)` cannot be used for this: the panel we
   * click the drilldown FROM is itself at /dashboards/view, and waitForURL tests
   * the current url first, so it resolves before the router has moved anywhere.
   * That let the test continue while the drilldown's `router.push` was still in
   * flight — the next navigation (sidebar -> dashboards list) then raced it and
   * the late push dropped the page back onto a dashboard view, where the list
   * assertions had nothing to find.
   *
   * The destination's id is generated server-side, so key off "the `dashboard`
   * query param is no longer the one we came from" instead.
   *
   * @param {string} previousUrl - page.url() captured BEFORE clicking the menu item
   */
  async waitForSameTabDashboardNavigation(previousUrl) {
    const previousDashboardId = new URL(previousUrl).searchParams.get("dashboard");
    await this.page.waitForURL(
      (url) =>
        url.pathname.includes("/dashboards/view") &&
        url.searchParams.get("dashboard") !== previousDashboardId,
      { timeout: 20000 }
    );
    // The push has committed; let the destination view mount before the caller
    // navigates again, so we are not racing a half-rendered route once more.
    await this.page.locator('[data-test="dashboard-tab-list"]').waitFor({
      state: "visible",
      timeout: 20000,
    });
    return this.page.url();
  }

  /**
   * Returns locator for the drilldown item at the given index in the config list.
   */
  drilldownItemAt(index) {
    return this.page.locator(`[data-test="dashboard-addpanel-config-drilldown-name-${index}"]`);
  }

  /**
   * Returns locator for the remove button at the given index in the config list.
   */
  removeButtonAt(index) {
    return this.page.locator(`[data-test="dashboard-addpanel-config-drilldown-remove-${index}"]`);
  }
}
