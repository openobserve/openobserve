import { expect } from '@playwright/test';
import {
  dateTimeButtonLocator, relative30SecondsButtonLocator, absoluteTabLocator,
  Past30SecondsValue
} from '../commonActions.js';
export class DashboardPage {
  constructor(page) {
    this.page = page;
    const timestamp = Date.now();
    const randomSuffix = Math.floor(Math.random() * 10000);
    this.dashboardName = `dash${timestamp}${randomSuffix}`;
    this.panelName = `p${timestamp}${randomSuffix}`;

    // Navigation & Menu locators
    this.dashboardsMenuItem = page.locator('[data-test="menu-link-\\/dashboards-item"]');
    this.profileButton = page.locator('[data-test="header-my-account-profile-icon"]');
    this.signOutButton = page.locator('[data-test="menu-link-logout-item"]');
    this.logoutMenuItem = page.locator('[data-test="menu-link-logout-item"]');

    // Dashboard list locators
    this.addDashboardButton = page.locator('[data-test="dashboard-new"]');
    this.dashboardSearch = page.locator('[data-test="dashboard-search"]');
    // The OInput wrapper carries `data-test="dashboard-search"`; the inner
    // <input> element carries the `-field` suffix and is the fillable target.
    this.dashboardSearchInput = page.locator('[data-test="dashboard-search-field"]');
    this.dashboardTable = page.locator('[data-test="dashboard-table"]');
    this.dashboardDelete = page.locator('[data-test="dashboard-delete"]');
    // First row of the OTable — exposed as `o2-table-row-0` by TenstackTable.
    this.firstTableRow = page.locator('[data-test="o2-table-row-0"]');
    // Delete button scoped to the first row.
    this.firstRowDeleteButton = this.firstTableRow.locator('[data-test="dashboard-delete"]');
    // Toast surface (deletion confirmation, etc.).
    this.toastMessage = page.locator('[data-test="o-toast-message"]');
    this.confirmButton = page.locator('[data-test="dashboard-confirm-dialog"] [data-test="o-dialog-primary-btn"]');
    this.searchAcrossFoldersToggle = page.locator('[data-test="dashboard-search-across-folders-toggle"] div').nth(2);

    // Dashboard create dialog locators
    // OInput wraps the dialog name field — the wrapper carries
    // `add-dashboard-name`, and the inner native <input> exposes the
    // `-field` suffix (per AGENT_RULES §4). Always fill the `-field` variant.
    this.dashboardAddDialog = page.locator('[data-test="dashboard-add-dialog"]');
    this.dashboardNameWrapper = page.locator('[data-test="add-dashboard-name"]');
    this.dashboardNameInput = page.locator('[data-test="add-dashboard-name-field"]');
    this.dashboardSubmitButton = page.locator('[data-test="dashboard-add-dialog"] [data-test="o-drawer-primary-btn"]');

    // Dashboard view/edit locators
    this.addPanelBtn = page.locator('[data-test="dashboard-if-no-panel-add-panel-btn"]');
    this.dashboardPanelNameInput = page.locator('[data-test="dashboard-panel-name"]');
    this.savePanelButton = page.locator('[data-test="dashboard-panel-save"]');
    this.applyButton = page.locator('[data-test="dashboard-apply"]');
    this.shareButton = page.locator('[data-test="dashboard-share-btn"]');

    // Stream & field selection locators
    this.streamDropdown = page.locator('[data-test="index-dropdown-stream"]');
    // OSelect stamps every ListboxItem with `${parent}-option` and
    // `data-test-value="<value>"` — `e2e_automate` is the stream this PO
    // always exercises, so we hoist its option locator to a class member.
    this.streamOptionE2eAutomate = page
      .locator('[data-test="index-dropdown-stream-option"][data-test-value="e2e_automate"]')
      .first();
    this.fieldSearchInput = page.locator('[data-test="index-field-search-input"]');
    // Field-list "add to Y-axis / breakdown" buttons resolved by per-field
    // `data-test` prefix/suffix patterns (no element/text predicates).
    this.kubernetesContainerHashYButton = page
      .locator(
        '[data-test^="field-list-item-"][data-test$="-kubernetes_container_hash"] [data-test="dashboard-add-y-data"]',
      )
      .first();
    this.kubernetesContainerImageBButton = page
      .locator(
        '[data-test^="field-list-item-"][data-test$="-kubernetes_container_image"] [data-test="dashboard-add-b-data"]',
      )
      .first();

    // Date/Time locators — wrapped to `Locator` instances so methods don't
    // need to call `page.locator(...)` inline.
    this.dateTimeButton = page.locator(dateTimeButtonLocator);
    this.relative30SecondsButton = page.locator(relative30SecondsButtonLocator);
    this.absoluteTab = page.locator(absoluteTabLocator);

    // Share / view dashboard locators
    this.shareSuccessToast = page.locator('[data-test="o-toast-success"]');
    this.dashboardBackBtn = page.locator('[data-test="dashboard-back-btn"]');
    this.dashboardNameTitle = page.locator('[data-test="dashboard-name-title"]');

    // Date-time picker — calendar cells carry `data-test="daterangecalendar-cell-<ISO>"`
    // (e.g. `daterangecalendar-cell-2026-05-01`). Selecting any cell whose ISO
    // suffix ends with `-01` reliably hits the first-of-month for the rendered
    // month grid without relying on visible-text predicates.
    this.dateTimePickerDayOne = page
      .locator('[data-test^="daterangecalendar-cell-"][data-test$="-01"]')
      .first();
    // OTime exposes its trigger via `data-test="datetime-start-time"` /
    // `data-test="datetime-end-time"` (forwarded onto the PopoverTrigger in
    // OTime.vue and wired into DateTime.vue's two <OTime> instances).
    this.dateTimePickerStartTime = page.locator(
      '[data-test="datetime-start-time"]',
    );
    this.dateTimePickerEndTime = page.locator(
      '[data-test="datetime-end-time"]',
    );

    // Organization locators — declared before any locators that scope into
    // the dropdown so we don't read `undefined` during construction.
    this.orgDropdown = page.locator('[data-test="navbar-organizations-select"]');

    // Organization selector — trigger button now carries
    // `data-test="navbar-organizations-select-trigger"` and each org row
    // exposes `data-test-org-identifier="<identifier>"` (see Header.vue).
    this.orgDropdownArrow = page.locator(
      '[data-test="navbar-organizations-select-trigger"]',
    );
    this.orgOptionDefaultTestMulti = page.locator(
      '[data-test-org-identifier="defaulttestmulti"]',
    );

    // Custom chart locators
    this.customChartItem = page.locator('[data-test="selected-chart-custom_chart-item"]');
    this.markdownEditor = page.locator('[data-test="dashboard-markdown-editor-query-editor"]');
  }
  async navigateToDashboards() {
    await this.page.waitForSelector('[data-test="menu-link-\\/dashboards-item"]');
    await this.dashboardsMenuItem.click();
    // Wait for navigation to complete by checking URL
    await this.page.waitForURL('**/dashboards**', { timeout: 10000 });
    // Wait for the dashboard page to load by checking for a key element
    await this.page.waitForSelector('[data-test="dashboard-new"]', { timeout: 10000 });
  }
  async createDashboard() {
    // Wait for the dashboard page to be fully loaded
    await this.page.waitForSelector('[data-test="dashboard-new"]');
    await this.page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});

    await this.addDashboardButton.click();

    // Wait for dialog with retry mechanism
    // Use deterministic waitFor — wait on the drawer dialog being attached
    // (mounts in a portal); the wrapper + inner `-field` follow.
    let isDialogOpen = await this.dashboardAddDialog
      .waitFor({ state: 'attached', timeout: 5000 })
      .then(() => true)
      .catch(() => false);

    if (!isDialogOpen) {
      // First retry: click the button again
      await this.addDashboardButton.click();
      isDialogOpen = await this.dashboardAddDialog
        .waitFor({ state: 'attached', timeout: 5000 })
        .then(() => true)
        .catch(() => false);

      if (!isDialogOpen) {
        throw new Error('Dashboard name field is not visible after clicking the add dashboard button twice');
      }
    }

    // Wait for the input to be fully ready (use the inner `-field` input
    // — that's the actual fillable element).
    await this.dashboardNameInput.waitFor({ state: 'visible', timeout: 10000 });

    // Fill the dashboard name
    await this.dashboardNameInput.fill(this.dashboardName);

    // Wait for Vue to process the input and enable the button
    // Wait for submit button to be visible
    await this.dashboardSubmitButton.waitFor({ state: 'visible', timeout: 30000 });

    // Use Playwright's built-in expect to wait for button to be enabled
    await expect(this.dashboardSubmitButton).toBeEnabled({ timeout: 15000 });

    // Click submit button
    await this.dashboardSubmitButton.click();

    // Wait for the success notification to confirm dashboard was created
    await this.toastMessage.first().waitFor({ state: 'visible', timeout: 15000 });

    // Wait for navigation to the new dashboard view page
    await this.page.waitForURL(/\/dashboards\/view/, { timeout: 30000 });

    // Wait for the page to be fully loaded
    await this.page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});

    // Wait for Vue components to mount
    await this.page.waitForTimeout(2000);

    // Wait for and click the "Add Panel" button
    await this.addPanelBtn.waitFor({ state: 'visible', timeout: 15000 });
    await this.addPanelBtn.click();

    // Wait for panel configuration to load
    await this.page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    await this.page.waitForTimeout(3000);

    // Click on Stream dropdown - use data-test selector used in other dashboard tests
    await this.streamDropdown.click();
    await this.page.waitForTimeout(500);

    // Type stream name to filter
    await this.streamDropdown.press("Control+a");
    await this.streamDropdown.fill("e2e_automate");
    await this.page.waitForTimeout(1500);

    // Select e2e_automate stream option via the class-member locator.
    await this.streamOptionE2eAutomate.waitFor({ state: "visible", timeout: 15000 });
    await this.streamOptionE2eAutomate.click();

    // Use search to find fields - more reliable than scrolling
    await this.fieldSearchInput.waitFor({ state: 'visible', timeout: 10000 });

    // Search for kubernetes_container_hash and add to Y-axis
    await this.fieldSearchInput.click();
    await this.fieldSearchInput.fill('kubernetes_container_hash');
    await this.page.waitForTimeout(1000);

    await this.kubernetesContainerHashYButton.waitFor({ state: 'visible', timeout: 10000 });
    await this.kubernetesContainerHashYButton.click();

    // Clear search and add kubernetes_container_image to B-axis (breakdown)
    await this.fieldSearchInput.fill('');
    await this.fieldSearchInput.fill('kubernetes_container_image');
    await this.page.waitForTimeout(1000);

    await this.kubernetesContainerImageBButton.waitFor({ state: 'visible', timeout: 10000 });
    await this.kubernetesContainerImageBButton.click();

    // Clear search
    await this.fieldSearchInput.fill('');
    await this.dashboardPanelNameInput.waitFor({ state: 'visible', timeout: 10000 });
    await this.dashboardPanelNameInput.click();
    await this.dashboardPanelNameInput.fill(this.panelName);
    await this.dashboardPanelNameInput.press('Enter');
    await expect(this.applyButton).toBeVisible();
    await this.applyButton.click();
    await this.page.waitForTimeout(5000);
  }
  async deleteDashboard() {
    await this.page.reload();
    await this.page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    await this.page.waitForTimeout(5000);

    // Search for the dashboard before deleting
    await this.dashboardSearch.fill(this.dashboardName);
    await this.page.waitForTimeout(2000);

    await this.dashboardDelete.click({ force: true });
    await this.page.waitForTimeout(2000);
    await this.confirmButton.click();
    // Toast appears after the dashboard is deleted — assert via data-test
    // hook rather than role="alert".
    await expect(this.toastMessage.first()).toBeVisible();
  }

  async deleteSearchedDashboard(dashboardName) {
    // Search the dashboard by name. All locators are class members.
    await this.dashboardSearchInput.click();
    await this.dashboardSearchInput.fill(dashboardName);
    await this.page.waitForTimeout(1000);

    // Click the delete action on the first filtered row.
    await this.firstTableRow.waitFor({ state: "visible", timeout: 10000 });
    await this.firstRowDeleteButton.click();

    // Confirm and verify the toast surface appears.
    await this.confirmButton.click();
    await expect(this.toastMessage.first()).toBeVisible();
  }

  async setTimeToPast30Seconds() {
    // Set the time filter to the last 30 seconds
    await this.dateTimeButton.click();
    await this.relative30SecondsButton.click();
  }
  async verifyTimeSetTo30Seconds() {
    // Verify that the time filter displays "Past 30 Seconds"
    await expect(this.dateTimeButton).toContainText(Past30SecondsValue);
  }
  async verifyShareDashboardLink(randomDashboardName){
    await this.shareButton.click();
    // Success toast container — ShareButton.vue triggers it after the
    // short-URL API resolves AND the clipboard write completes.
    await this.shareSuccessToast
      .last()
      .waitFor({ state: "visible", timeout: 15000 });
    // Poll for clipboard text to absorb the microtask gap between toast
    // render and clipboard becoming readable.
    let copiedUrl = "";
    await expect
      .poll(
        async () => {
          copiedUrl = await this.page.evaluate(() =>
            navigator.clipboard.readText()
          );
          return copiedUrl;
        },
        { timeout: 10000, intervals: [200, 400, 800] }
      )
      .not.toBe("");
    // The backend's short-URL service can bake in an external host (e.g.
    // production ingestion endpoint). Rewrite to the test base URL so we
    // exercise the same local instance the rest of the test runs against.
    const baseUrl = process.env.ZO_BASE_URL || "";
    if (baseUrl) {
      try {
        const target = new URL(copiedUrl);
        const base = new URL(baseUrl);
        target.protocol = base.protocol;
        target.host = base.host;
        copiedUrl = target.toString();
      } catch (e) {
        // If parsing fails, fall back to original URL.
      }
    }
    await this.page.goto(copiedUrl);
    // Wait for the dashboard view scaffolding to mount, then assert title.
    await this.dashboardBackBtn.waitFor({ state: "visible", timeout: 30000 });
    await expect(this.dashboardNameTitle).toContainText(randomDashboardName, {
      timeout: 30000,
    });
  }
  async setDateTime() {
    await expect(this.dateTimeButton).toBeVisible();
    await this.dateTimeButton.click();
    await this.absoluteTab.click();
    await this.page.waitForTimeout(2000);
  }
  async fillTimeRange(startTime, endTime) {
    // Day cells and OTime triggers are now selected via data-test only
    // (`daterangecalendar-cell-*` for the calendar, `datetime-start-time` /
    // `datetime-end-time` for the OTime triggers). The new OTime renders a
    // clock-face popover (not a text input), so we click the trigger to
    // open the picker — full clock-face time entry is performed by callers
    // via the clock-face helpers when a precise time is required.
    await this.dateTimePickerDayOne.click();
    await this.dateTimePickerStartTime.click();
    await this.page.keyboard.type(startTime);
    await this.dateTimePickerDayOne.click();
    await this.dateTimePickerEndTime.click();
    await this.page.keyboard.type(endTime);
  }
  async verifyDateTime(startTime, endTime) {
    await expect(this.dateTimeButton).toContainText(`${startTime} - ${endTime}`);
  }

  async dashboardPageDefaultMultiOrg() {
    await this.orgDropdownArrow.click();
    await this.orgOptionDefaultTestMulti.click();
  }

  async dashboardPageURLValidation() {
    // TODO: Fix this test
    // await expect(this.page).not.toHaveURL(/default/);
  }

  async dashboardURLValidation() {
    await expect(this.page).toHaveURL(/dashboard/);
  }

  async signOut() {
    await this.profileButton.click();
    await this.signOutButton.click();
  }


  async loggedOut() {
    // Click on the profile icon
    await this.profileButton.click({ force: true });

    // Wait for the logout menu item to be present in the DOM with reasonable timeout
    await this.logoutMenuItem.waitFor({ state: 'attached', timeout: 10000 });

    // Wait for element to be visible instead of hard wait
    await this.logoutMenuItem.waitFor({ state: 'visible', timeout: 5000 });

    // Now click the logout item
    await this.logoutMenuItem.click({ force: true });
  }

  async notAvailableDashboard() {
    // Wait for the dashboard add button to be visible
    await this.addDashboardButton.waitFor({ state: 'visible', timeout: 10000 });

    // Click on the search input
    await this.dashboardSearch.click();

    // Fill the search input with the dashboard name
    await this.dashboardSearch.fill(this.dashboardName);

    // Check that the dashboard table contains the text 'No data available'
    await expect(this.dashboardTable).toContainText('No data available');

    // Click on the toggle for searching across folders
    await this.searchAcrossFoldersToggle.click();

    // Check again that the dashboard table contains the text 'No data available'
    await expect(this.dashboardTable).toContainText('No data available');

    // Click on the toggle again
    await this.searchAcrossFoldersToggle.click();

    // Final check that the dashboard table still contains the text 'No data available'
    await expect(this.dashboardTable).toContainText('No data available');
  }

  async addCustomChart() {
    await this.dashboardsMenuItem.waitFor({ state: 'visible', timeout: 10000 });
    await this.dashboardsMenuItem.click();

    await this.addDashboardButton.waitFor({ state: 'visible', timeout: 10000 });
    await this.page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    await this.addDashboardButton.click();

    // Wait for dialog and fill name
    await this.dashboardNameInput.waitFor({ state: 'visible', timeout: 10000 });
    await this.dashboardNameInput.fill("Customcharts");

    // Wait for submit button to be enabled
    await expect(this.dashboardSubmitButton).toBeEnabled({ timeout: 15000 });
    await this.dashboardSubmitButton.click();

    // Wait for success and navigation
    await this.toastMessage.first().waitFor({ state: 'visible', timeout: 15000 });
    await this.page.waitForURL(/\/dashboards\/view/, { timeout: 30000 });
    await this.page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});

    // Add panel and select custom chart
    await this.addPanelBtn.waitFor({ state: 'visible', timeout: 15000 });
    await this.addPanelBtn.click();
    await this.customChartItem.waitFor({ state: 'visible', timeout: 10000 });
    await this.customChartItem.click();

    // Clear Monaco editor content
    await this.markdownEditor.locator('.monaco-editor').waitFor({ state: 'visible', timeout: 10000 });
    await this.markdownEditor.locator('.monaco-editor').click();

    const modifier = process.platform === 'darwin' ? 'Meta' : 'Control';
    await this.page.keyboard.press(`${modifier}+A`);
    await this.page.keyboard.press('Delete');
  }


}


