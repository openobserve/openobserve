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
    // Factory: returns the name-cell for a specific dashboard (Dashboards.vue line 202:
    // :data-test="`dashboard-name-cell-${value}`"). Used to confirm the correct row
    // is visible after search filtering completes before clicking delete.
    this.getDashboardNameCell = (name) => page.locator(`[data-test="dashboard-name-cell-${name}"]`);
    // Toast surface (deletion confirmation, etc.).
    this.toastMessage = page.locator('[data-test="o-toast-message"]');
    this.confirmButton = page.locator('[data-test="dashboard-confirm-dialog"] [data-test="o-dialog-primary-btn"]');
    this.searchAcrossFoldersToggle = page.locator('[data-test="dashboard-search-across-folders-toggle"]');

    // Dashboard create dialog locators
    // OInput wraps the dialog name field — the wrapper carries
    // `add-dashboard-name`, and the inner native <input> exposes the
    // `-field` suffix (per AGENT_RULES §4). Always fill the `-field` variant.
    this.dashboardAddDialog = page.locator('[data-test="dashboard-add-dialog"]');
    this.dashboardNameWrapper = page.locator('[data-test="add-dashboard-name"]');
    this.dashboardNameInput = page.locator('[data-test="add-dashboard-name-field"]');
    this.dashboardSubmitButton = page.locator('[data-test="dashboard-add-dialog"] [data-test="o-dialog-primary-btn"]');

    // Dashboard view/edit locators
    this.addPanelBtn = page.locator('[data-test="dashboard-if-no-panel-add-panel-btn"]');
    this.dashboardPanelNameInput = page.locator('[data-test="dashboard-panel-name-field"]');
    this.savePanelButton = page.locator('[data-test="dashboard-panel-save"]');
    this.applyButton = page.locator('[data-test="dashboard-apply"]');
    this.shareButton = page.locator('[data-test="dashboard-share-btn"]');

    // Stream & field selection locators
    // `index-dropdown-stream` is an OSelect (PanelFieldList.vue) — clicking the
    // wrapper opens a popover that exposes `${parent}-popover`, `${parent}-search`
    // (the filter input), and `${parent}-option` (with `data-test-value="<value>"`).
    this.streamDropdown = page.locator('[data-test="index-dropdown-stream"]');
    // OSelect popover surface — wait for visibility before interacting with the
    // search input or option list.
    this.streamDropdownPopover = page.locator('[data-test="index-dropdown-stream-popover"]');
    // OSelect inner filter input (ListboxFilter). Forward `${parent}-search`
    // stream options.
    this.streamDropdownSearch = page.locator('[data-test="index-dropdown-stream-search"]');
    // OInput wraps the stream-name filter; the wrapper carries
    // `index-dropdown-stream` and the inner native <input> exposes the
    // `-field` suffix (per AGENT_RULES §4). Always fill the `-field` variant.
    this.streamDropdownInput = page.locator('[data-test="index-dropdown-stream-field"]');
    // OSelect stamps every ListboxItem with `${parent}-option` and
    // `data-test-value="<value>"` — `e2e_automate` is the stream this PO
    // always exercises, so we hoist its option locator to a class member.
    this.streamOptionE2eAutomate = page
      .locator('[data-test="index-dropdown-stream-option"][data-test-value="e2e_automate"]')
      .first();
    // OFieldList (PanelFieldList.vue → OFieldList.vue) exposes its search box via an
    // OInput wrapper: `o-field-list-search` is the wrapper, `o-field-list-search-field`
    // is the inner native <input> (auto-derived `-field` suffix per AGENT_RULES §4 —
    // always fill the `-field` variant). The legacy `index-field-search-input`
    // / `data-cy` Cypress attribute no longer exists post-revamp.
    this.fieldSearchInput = page.locator('[data-test="o-field-list-search-field"]');
    // Field-list "add to Y-axis / breakdown" buttons resolved by per-field
    // `data-test` prefix/suffix patterns (no element/text predicates).
    // Post-revamp OFieldRow exposes per-field rows as
    // `data-test="o-field-list-row-${field.name}"` (OFieldList.vue line ~66) —
    // the legacy `field-list-item-` prefix no longer exists.
    this.kubernetesContainerHashYButton = page
      .locator(
        '[data-test="o-field-list-row-kubernetes_container_hash"] [data-test="dashboard-add-y-data"]',
      )
      .first();
    this.kubernetesContainerImageBButton = page
      .locator(
        '[data-test="o-field-list-row-kubernetes_container_image"] [data-test="dashboard-add-b-data"]',
      )
      .first();

    // Date/Time locators — wrapped to `Locator` instances so methods don't
    // need to call `page.locator(...)` inline.
    this.dateTimeButton = page.locator(dateTimeButtonLocator);
    this.relative30SecondsButton = page.locator(relative30SecondsButtonLocator);
    this.absoluteTab = page.locator(absoluteTabLocator);

    // Share / view dashboard locators
    this.shareSuccessToast = page.locator('[data-test-variant="success"]');
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

    // Wait for dialog with retry mechanism.
    // ODrawer keeps the panel mounted across open/close cycles — `state:
    // 'attached'` alone is unreliable (resolves true even when the dialog is
    // closed). Reka stamps `data-state="open"`/`"closed"` on the panel; gate
    // the retry on the open-state attribute instead.
    const openPanel = this.page.locator('[data-test="dashboard-add-dialog"][data-state="open"]');
    let isDialogOpen = await openPanel
      .waitFor({ state: 'attached', timeout: 5000 })
      .then(() => true)
      .catch(() => false);

    if (!isDialogOpen) {
      // First retry: click the button again
      await this.addDashboardButton.click();
      isDialogOpen = await openPanel
        .waitFor({ state: 'attached', timeout: 5000 })
        .then(() => true)
        .catch(() => false);

      if (!isDialogOpen) {
        throw new Error('Dashboard name field is not visible after clicking the add dashboard button twice');
      }
    }

    // Wait for the input to be fully ready (use the inner `-field` input
    // — that's the actual fillable element).
    // NOTE: `AddDashboard` is registered with `defineAsyncComponent(() => import(...))`
    // in Dashboards.vue, so the inner form (OFormInput + OInput) only mounts after
    // the dynamic import resolves. Under test load (ingestion in beforeEach can
    // saturate the network) the import + mount can take >10s. Give it 30s.
    await this.dashboardNameInput.waitFor({ state: 'visible', timeout: 30000 });

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

    // Wait for navigation to the new dashboard view page.
    // Some environments (e.g. pentest) may not navigate to /dashboards/view/
    // after creation — catch the timeout so the caller can still use the
    // dashboard that was successfully created.
    await this.page.waitForURL(/\/dashboards\/view/, { timeout: 30000 }).catch(() => {});

    // Wait for the page to be fully loaded (may be no-op if navigation didn't happen)
    await this.page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});

    // Only proceed with panel setup if we actually landed on the view page
    const onViewPage = this.page.url().includes('/dashboards/view/');
    if (!onViewPage) {
      // Dashboard was created but we stayed on the list page — caller likely
      // only needs the dashboard to exist (e.g. for report creation).
      return;
    }

    // Wait for Vue components to mount
    await this.page.waitForTimeout(2000);

    // Wait for and click the "Add Panel" button
    await this.addPanelBtn.waitFor({ state: 'visible', timeout: 15000 });
    await this.addPanelBtn.click();

    // Wait for panel configuration to load
    await this.page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    await this.page.waitForTimeout(3000);

    // Click on Stream dropdown — OSelect opens a popover with a search input
    // and option list.
    await this.streamDropdown.click();
    await this.streamDropdownPopover.waitFor({ state: "visible", timeout: 15000 });

    // Type stream name to filter — fill the OSelect inner search input
    // (`${parent}-search`, per AGENT_RULES §4).
    await this.streamDropdownSearch.waitFor({ state: "visible", timeout: 10000 });
    await this.streamDropdownSearch.press("ControlOrMeta+a");
    await this.streamDropdownSearch.press("Backspace");
    await this.streamDropdownSearch.fill("e2e_automate");

    // Select e2e_automate stream option via the class-member locator.
    await this.streamOptionE2eAutomate.waitFor({ state: "visible", timeout: 15000 });
    await this.streamOptionE2eAutomate.click();

    // Use search to find fields - more reliable than scrolling
    await this.fieldSearchInput.waitFor({ state: 'visible', timeout: 10000 });

    // Search for kubernetes_container_hash and add to Y-axis
    await this.fieldSearchInput.click();
    await this.fieldSearchInput.fill('kubernetes_container_hash');
    const hashRow = this.page.locator('[data-test="o-field-list-row-kubernetes_container_hash"]').first();
    await hashRow.waitFor({ state: 'visible', timeout: 10000 });
    await hashRow.hover();
    await this.kubernetesContainerHashYButton.waitFor({ state: 'visible', timeout: 10000 });
    await this.kubernetesContainerHashYButton.click({ force: true });

    // Clear search and add kubernetes_container_image to B-axis (breakdown)
    await this.fieldSearchInput.fill('');
    await this.fieldSearchInput.fill('kubernetes_container_image');
    const imageRow = this.page.locator('[data-test="o-field-list-row-kubernetes_container_image"]').first();
    await imageRow.waitFor({ state: 'visible', timeout: 10000 });
    await imageRow.hover();
    await this.kubernetesContainerImageBButton.waitFor({ state: 'visible', timeout: 10000 });
    await this.kubernetesContainerImageBButton.click({ force: true });

    // Clear search
    await this.fieldSearchInput.fill('');
    await this.dashboardPanelNameInput.waitFor({ state: 'visible', timeout: 10000 });
    await this.dashboardPanelNameInput.click();
    await this.dashboardPanelNameInput.fill(this.panelName);
    // Do NOT press Enter here. Post UX revamp the panel-name field is an
    // OFormInput inside <OForm id="add-panel-form"> (AddPanel.vue) whose only
    // input it is, so Enter triggers the form's implicit submit → onSave →
    // savePanelChangesToDashboard, which saves the panel and navigates away,
    // detaching the Apply button mid-flow (see reports E2E timeouts on
    // [data-test="dashboard-apply"]). The legacy q-input ignored Enter;
    // .fill() already commits the title through OFormInput's reactive binding,
    // so no key press is needed to "commit" the name.
    await expect(this.applyButton).toBeVisible();
    await this.applyButton.click();
    await this.page.waitForTimeout(5000);
  }
  async deleteDashboard() {
    await this.page.reload();
    await this.page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    await this.page.waitForTimeout(5000);

    // Search for the dashboard before deleting. `dashboardSearch` is the
    // OInput wrapper <div> (not fillable); fill the inner `-field` native
    // input via `dashboardSearchInput` per AGENT_RULES §4.
    await this.dashboardSearchInput.fill(this.dashboardName);
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

    // Wait for the specific name cell to confirm the search result is rendered.
    // Dashboards.vue stamps each title cell with
    // data-test="dashboard-name-cell-${value}" — this resolves only once the
    // search filter has re-rendered the table with the correct row.
    const nameCell = this.getDashboardNameCell(dashboardName);
    await nameCell.waitFor({ state: 'visible', timeout: 20000 });

    // Walk up from the confirmed name cell to its containing table row via
    // XPath ancestor. This avoids the CI race where the row's o2-table-row-N
    // data-test attribute hasn't been stamped yet when we try to hover
    // [data-test="o2-table-row-0"] directly — same approach as dashboard-import.js:260.
    const dashboardRow = nameCell.locator(
      'xpath=ancestor::*[starts-with(@data-test, "o2-table-row-")][1]'
    );
    const deleteButton = dashboardRow.locator('[data-test="dashboard-delete"]');

    // Row action buttons are CSS-hidden until hover — reveal before clicking.
    await dashboardRow.hover();
    await deleteButton.waitFor({ state: 'visible', timeout: 10000 });
    await deleteButton.click();

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
    // Wait for the dashboard list to fully load.
    await this.addDashboardButton.waitFor({ state: 'visible', timeout: 10000 });

    // Dashboards.vue stamps data-test="dashboard-name-cell-${name}" on every
    // row's name cell. After deletion the cell should not exist at all —
    // check this directly instead of relying on a text-search filter (which
    // is unreliable with parallel test workers creating their own dashboards).
    const dashboardCell = this.page.locator(`[data-test="dashboard-name-cell-${this.dashboardName}"]`);

    const isCellGone = await dashboardCell.isVisible().then(() => false).catch(() => true);
    if (!isCellGone) {
      await expect.poll(async () => {
        await this.page.reload();
        await this.addDashboardButton.waitFor({ state: 'visible', timeout: 10000 });
        const visible = await dashboardCell.isVisible().catch(() => false);
        return !visible;
      }, {
        intervals: [2000, 3000, 5000, 5000],
        timeout: 60000,
      }).toBe(true);
    }
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

  // Custom chart Monaco editor (data-test="dashboard-markdown-editor-query-editor").
  // Drive the model via Monaco's API and confirm the value COMMITS into the panel
  // schema (dashboardPanelData.data.customChartContent) — see _setEditorAndCommit.
  async setCustomChartCode(code) {
    await this._setEditorAndCommit(
      '[data-test="dashboard-markdown-editor-query-editor"]',
      'customChartContent',
      code
    );
  }

  // Dashboard panel SQL query editor (data-test="dashboard-panel-query-editor").
  // Drive the model via Monaco and confirm it COMMITS into
  // dashboardPanelData.data.queries[i].query before Apply.
  async setDashboardPanelQuery(sql) {
    await this._setEditorAndCommit(
      '[data-test="dashboard-panel-query-editor"]',
      'query',
      sql
    );
  }

  /**
   * Set a Monaco editor's value AND confirm it has committed into the panel
   * schema (`dashboardPanelData.data.*`) — the source of truth Apply validates.
   *
   * Why a re-set loop and not a single setValue + wait:
   * CodeQueryEditor debounces its `update:query` emit (500ms). When an adjacent
   * reactive change (e.g. setting customChartContent) re-renders/re-creates the
   * editor, the pending debounced emit from our first setValue is discarded, so
   * the value never reaches the schema and the query stays "". That left Apply
   * showing "Please enter query for custom chart" and the unsafe-code validation
   * (gated behind a non-empty query) never ran — the custom-charts flake. So each
   * iteration we RE-set the model (re-arming the debounce) and re-check the
   * committed schema value until it lands, surviving editor re-creation. The Vue
   * vnode walk is the prod-safe way to read state (`__vueParentComponent` is
   * dev-only in Vue 3).
   *
   * @param {string} selector  data-test selector of the editor host
   * @param {'query'|'customChartContent'} field
   * @param {string} value
   */
  async _setEditorAndCommit(selector, field, value, timeout = 20000) {
    // Each attempt: (1) set the Monaco model so the editor visibly shows the
    // value, and (2) write the value DIRECTLY into every reactive
    // dashboardPanelData instance — the state Apply validates. Direct assignment
    // is deterministic; it sidesteps the 500ms debounced update:query emit that
    // gets dropped when an adjacent reactive change re-creates the editor (which
    // left the schema query empty -> "Please enter query for custom chart" ->
    // unsafe-code validation never ran). Returns once a re-read confirms it stuck.
    const applyAndCheck = () =>
      this.page.evaluate(
        ({ selector, field, value }) => {
          const norm = (s) => (typeof s === 'string' ? s.trim() : '');
          // (1) editor model (display only)
          const host = document.querySelector(selector);
          const editor =
            host && window.monaco?.editor?.getEditors
              ? window.monaco.editor.getEditors().find((ed) => {
                  const dom = ed.getDomNode?.();
                  return dom && host.contains(dom);
                })
              : null;
          if (editor && editor.getValue() !== value) editor.setValue(value);

          // (2) write + verify the reactive panel state on every instance found
          const app = document.querySelector('#app');
          if (!app || !app._vnode) return false;
          const visited = new Set();
          let anyMatched = false;
          const walk = (node, depth) => {
            if (!node || depth > 80 || visited.has(node)) return;
            visited.add(node);
            const dpd = node.component?.setupState?.dashboardPanelData;
            if (dpd && dpd.data) {
              if (field === 'customChartContent') {
                dpd.data.customChartContent = value;
                if (norm(dpd.data.customChartContent) === norm(value)) anyMatched = true;
              } else {
                const idx = dpd.layout?.currentQueryIndex ?? 0;
                if (dpd.data.queries?.[idx]) {
                  dpd.data.queries[idx].query = value;
                  if (norm(dpd.data.queries[idx].query) === norm(value)) anyMatched = true;
                }
              }
            }
            if (node.component?.subTree) walk(node.component.subTree, depth + 1);
            if (Array.isArray(node.children)) {
              for (const c of node.children) if (c && typeof c === 'object') walk(c, depth + 1);
            }
          };
          walk(app._vnode, 0);
          return anyMatched;
        },
        { selector, field, value }
      );

    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      if (await applyAndCheck()) {
        // Let Vue reactivity flush before the next step / Apply.
        await this.page.waitForTimeout(300);
        return;
      }
      await this.page.waitForTimeout(400);
    }
    throw new Error(`_setEditorAndCommit: '${field}' never committed into the panel schema within ${timeout}ms`);
  }

}


