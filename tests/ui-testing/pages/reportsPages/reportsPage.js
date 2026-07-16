import { expect } from '@playwright/test';
import {
  dateTimeButtonLocator, relative30SecondsButtonLocator, absoluteTabLocator,
  Past30SecondsValue, openNavFlyoutChild
} from '../commonActions.js';

export class ReportsPage {
  constructor(page) {
    this.page = page;

    // Navigation locators (data-test only). The MainLayout side-nav builds
    // each entry's data-test as `menu-link-${link}-item`, so the Home link
    // (`link: "/"`) becomes `menu-link-/-item` (escaped CSS: `menu-link-\\/-item`).
    this.reportListTitle = page.locator('[data-test="report-list-title"]');
    this.reportListTable = page.locator('[data-test="report-list-table"]');
    this.scheduledTab = page.locator('[data-test="tab-shared"]');

    // Create-report flow locators
    this.addReportButton = page.locator('[data-test="report-list-add-report-btn"]');
    this.reportNameInputField = page.locator('[data-test="add-report-name-input-field"]');
    this.descriptionInputField = page.locator('[data-test="add-report-description-input-field"]');

    // Step-1 dashboard pickers (OSelect triggers use data-test-selected-value attribute)
    this.dashboardFolderSelect = page.locator('[data-test="add-report-dashboard-folder-select"]');
    this.dashboardFolderTrigger = page.locator('[data-test="add-report-dashboard-folder-select"] [data-test-selected-value]');
    this.dashboardFolderPopover = page.locator('[data-test="add-report-dashboard-folder-select-popover"]');
    this.dashboardFolderOption = (value) => page.locator(`[data-test="add-report-dashboard-folder-select-option"][data-test-value="${value}"]`);

    this.dashboardNameSelect = page.locator('[data-test="add-report-dashboard-name-select"]');
    this.dashboardNameTrigger = page.locator('[data-test="add-report-dashboard-name-select"] [data-test-selected-value]');
    this.dashboardNamePopover = page.locator('[data-test="add-report-dashboard-name-select-popover"]');
    this.dashboardNameOptions = page.locator('[data-test="add-report-dashboard-name-select-option"]');

    this.dashboardTabSelect = page.locator('[data-test="add-report-dashboard-tab-select"]');
    this.dashboardTabTrigger = page.locator('[data-test="add-report-dashboard-tab-select"] [data-test-selected-value]');
    this.dashboardTabPopover = page.locator('[data-test="add-report-dashboard-tab-select-popover"]');
    this.dashboardTabOption = (value) => page.locator(`[data-test="add-report-dashboard-tab-select-option"][data-test-value="${value}"]`);

    // Step navigation buttons
    this.continueButtonStep1 = page.locator('[data-test="add-report-step1-continue-btn"]');
    this.continueButtonStep2 = page.locator('[data-test="add-report-step2-continue-btn"]');

    // Step-2 frequency buttons
    this.frequencyOnceBtn = page.locator('[data-test="add-report-schedule-frequency-once-btn"]');
    this.frequencyHoursBtn = page.locator('[data-test="add-report-schedule-frequency-hours-btn"]');
    this.frequencyDaysBtn = page.locator('[data-test="add-report-schedule-frequency-days-btn"]');
    this.frequencyWeeksBtn = page.locator('[data-test="add-report-schedule-frequency-weeks-btn"]');
    this.frequencyMonthsBtn = page.locator('[data-test="add-report-schedule-frequency-months-btn"]');
    this.frequencyCustomBtn = page.locator('[data-test="add-report-schedule-frequency-custom-btn"]');
    this.frequencyCronBtn = page.locator('[data-test="add-report-schedule-frequency-cron-btn"]');
    this.scheduleNowBtn = page.locator('[data-test="add-report-schedule-scheduleNow-btn"]');
    this.scheduleLaterBtn = page.locator('[data-test="add-report-schedule-scheduleLater-btn"]');

    // Schedule-later inputs — ODate forwards consumer data-test to its outer wrapper <div>
    // via v-bind="$attrs"; the interactable role="group" segments container carries
    // `${parentDataTest}-group` (added to ODate.vue). OTime places data-test directly
    // on its role="group" element (compound selector ok).
    this.scheduleStartDateField = page.locator('[data-test="add-report-schedule-start-date-field-group"]');
    this.scheduleStartTimeField = page.locator('[data-test="add-report-schedule-start-time-field"][role="group"]');
    this.scheduleTimezoneSelect = page.locator('[data-test="add-report-schedule-start-timezone-select"]');
    this.scheduleTimezoneTrigger = page.locator('[data-test="add-report-schedule-start-timezone-select"] [data-test-selected-value]');
    this.scheduleTimezonePopover = page.locator('[data-test="add-report-schedule-start-timezone-select-popover"]');
    this.scheduleTimezoneOption = (value) => page.locator(`[data-test="add-report-schedule-start-timezone-select-option"][data-test-value="${value}"]`);

    // Share step
    this.titleInputField = page.locator('[data-test="add-report-share-title-input-field"]');
    this.recipientsInputField = page.locator('[data-test="add-report-share-recipients-input-field"]');

    // Save / cancel
    this.saveButton = page.locator('[data-test="add-report-save-btn"]');
    this.cancelButton = page.locator('[data-test="add-report-cancel-btn"]');

    // ── Report Format section ──────────────────────────────────────────────
    this.reportFormatSection = page.locator('[data-test="add-report-format-section"]');

    // Report Type OSelect (trigger + popover + per-option)
    this.reportTypeSelect = page.locator('[data-test="add-report-type-select"]');
    this.reportTypeTrigger = page.locator('[data-test="add-report-type-select"] [data-test-selected-value]');
    this.reportTypePopover = page.locator('[data-test="add-report-type-select-popover"]');
    // OSelect always stamps data-test-value on options (unconditional), but
    // data-test-concatenated attrs are only emitted when OSelect receives a
    // direct data-test prop. This instance lacks it — match by value only.
    this.reportTypeOption = (value) => page.locator(`[data-test-value="${value}"]`).first();

    // Attachment Type OSelect (hidden when CSV is selected)
    this.attachmentTypeSelect = page.locator('[data-test="add-report-attachment-type-select"]');

    // Custom Dimensions expandable section (hidden when CSV is selected)
    this.customDimensionsSection = page.locator('[data-test="add-report-custom-dimensions-section"]');

    // PNG warning banner (visible only when PNG is selected)
    this.pngNoteBanner = page.locator('[data-test="add-report-png-note"]');

    // Toasts (OToast variants)
    this.toastSuccess = page.locator('[data-test-variant="success"]');
    this.toastError = page.locator('[data-test-variant="error"]');
    this.toastMessage = page.locator('[data-test="o-toast-message"]');

    // Common time-range locators (used by Logs/Reports/Dashboards screens, exported as data-test)
    this.dateTimeButton = dateTimeButtonLocator;
    this.relative30SecondsButton = page.locator(relative30SecondsButtonLocator);
    this.absoluteTab = absoluteTabLocator;

    // Header / profile / logout
    this.profileButton = page.locator('[data-test="header-my-account-profile-icon"]');
    this.signOutButton = page.locator('[data-test="menu-link-logout-item"]');

    // Report list — search + row actions
    this.reportSearchInput = page.locator('[data-test="report-list-search-input"]');
    this.reportSearchInputField = page.locator('[data-test="report-list-search-input-field"]');
    // Scope-based row resolution: find the per-name cell (added in ReportList.vue
    // §6 source edit), walk up to the OTable row, then locate the action button
    // within. More robust than relying on a standalone embedded-name data-test
    // which can race the rendering of the row.
    this.reportRow = (reportName) => page.locator(`[data-test="report-list-name-cell-${reportName}"]`)
        .locator('xpath=ancestor::*[starts-with(@data-test,"o2-table-row-")]').first();
    this.pauseStartReportBtn = (reportName) => this.reportRow(reportName).locator('[data-test$="-pause-start-report"]');
    this.editReportBtn = (reportName) => this.reportRow(reportName).locator('[data-test$="-edit-report"]');
    this.deleteReportBtn = (reportName) => this.reportRow(reportName).locator('[data-test$="-delete-report"]');

    // Confirm dialog (delete)
    this.confirmDialog = page.locator('[data-test="confirm-dialog"]');
    this.confirmPrimaryBtn = page.locator('[data-test="confirm-dialog"] [data-test="o-dialog-primary-btn"]');
    this.confirmSecondaryBtn = page.locator('[data-test="confirm-dialog"] [data-test="o-dialog-secondary-btn"]');

    // Multi-org / organization switcher (used by reportsPageDefaultMultiOrg)
    this.orgSelectTrigger = page.locator('[data-test="navbar-organizations-select"] [data-test-selected-value]');
    this.orgSearchInputField = page.locator('[data-test="organization-search-input-field"]');
    this.orgMenuItemLabel = page.locator('[data-test="organization-menu-item-label-item-label"]');

    // Date/Time locators wrapped as Locator (the constants are CSS selector strings)
    this.dateTimeButtonLocator = page.locator(dateTimeButtonLocator);
    this.absoluteTabLocator = page.locator(absoluteTabLocator);
    this.absoluteStartTimeField = page.locator('[data-test="date-time-absolute-start-time-field"]');
    this.absoluteEndTimeField = page.locator('[data-test="date-time-absolute-end-time-field"]');
  }

  // Returns the search-input locator preferring the inner -field variant when present
  reportSearchField() {
    return this.reportSearchInputField;
  }

  async navigateToReports() {
    await openNavFlyoutChild(this.page, 'reports');
    await expect(this.reportListTitle).toContainText('Reports');
    await this.scheduledTab.click({ force: true });
  }

  async goToReports() {
    await openNavFlyoutChild(this.page, 'reports');
    await expect(this.reportListTitle).toContainText('Reports');
  }

  async reportsPageDefaultMultiOrg() {
    await this.orgSelectTrigger.click({ force: true });
    await this.page.waitForTimeout(2000);

    // Search for the organization
    await this.orgSearchInputField.fill('defaulttestmulti');
    await this.page.waitForTimeout(2000);

    // Click the organization from search results
    await this.orgMenuItemLabel.first().click({ force: true });
  }

  async reportsPageURLValidation() {
    // TODO: fix this test
    // await expect(this.page).not.toHaveURL(/default/);
  }

  async reportsURLValidation() {
    await expect(this.page).toHaveURL(/report/);
  }

  async createReportAddReportButton() {
    await this.addReportButton.waitFor({ state: 'visible', timeout: 10000 });
    await this.addReportButton.click({ force: true });
  }

  async createReportReportNameInput(TEST_REPORT_NAME) {
    await this.reportNameInputField.waitFor({ state: 'visible', timeout: 10000 });
    await this.reportNameInputField.fill(TEST_REPORT_NAME);
    await this.page.waitForTimeout(5000);
  }

  async createReportFolderInput() {
    // Open folder popover (PopoverTrigger inside the OSelect wrapper)
    await this.dashboardFolderTrigger.click({ force: true });
    await this.dashboardFolderPopover.waitFor({ state: 'visible', timeout: 10000 });
    await this.page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    // Folder value === "default"
    const opt = this.dashboardFolderOption('default');
    await opt.waitFor({ state: 'visible', timeout: 10000 });
    await opt.click({ force: true });
    await this.dashboardFolderPopover.waitFor({ state: 'hidden', timeout: 5000 }).catch(() => {});
  }

  async createReportDashboardInput(dashboardName) {
    // Open dashboard popover, find option whose label matches dashboardName, click it
    await this.dashboardNameTrigger.click({ force: true });
    await this.dashboardNamePopover.waitFor({ state: 'visible', timeout: 10000 });
    await this.page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});

    // Wait until at least one option is rendered
    await this.dashboardNameOptions.first().waitFor({ state: 'visible', timeout: 15000 });

    // Pick option by its text content (scoped to data-test list), via evaluate using data-test attrs only
    const clicked = await this.page.evaluate((name) => {
      const opts = Array.from(
        document.querySelectorAll('[data-test="add-report-dashboard-name-select-option"]')
      );
      for (const el of opts) {
        const text = (el.textContent || '').trim();
        if (text === name || text.includes(name)) {
          el.scrollIntoView({ block: 'center' });
          (el).dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
          (el).click();
          return true;
        }
      }
      return false;
    }, dashboardName);

    if (!clicked) {
      // Fallback: click the first option
      await this.dashboardNameOptions.first().click({ force: true });
    }
    await this.dashboardNamePopover.waitFor({ state: 'hidden', timeout: 5000 }).catch(() => {});
    await this.page.waitForTimeout(500);
  }

  async createReportDashboardTabInput() {
    await this.dashboardTabTrigger.click({ force: true });
    await this.dashboardTabPopover.waitFor({ state: 'visible', timeout: 10000 });
    await this.page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    const opt = this.dashboardTabOption('default');
    await opt.waitFor({ state: 'visible', timeout: 10000 });
    await opt.click({ force: true });
    await this.dashboardTabPopover.waitFor({ state: 'hidden', timeout: 5000 }).catch(() => {});
  }

  async createReportContinueButtonStep1() {
    await this.continueButtonStep1.click({ force: true });
    await this.page.waitForTimeout(3000);
  }

  async createReportOnce() {
    await this.frequencyOnceBtn.click({ force: true });
  }

  async createReportHours() {
    await this.frequencyHoursBtn.click({ force: true });
  }

  async createReportDays() {
    await this.frequencyDaysBtn.click({ force: true });
  }

  async createReportWeeks() {
    await this.frequencyWeeksBtn.click({ force: true });
  }

  async createReportMonths() {
    await this.frequencyMonthsBtn.click({ force: true });
  }

  async createReportCustom() {
    await this.frequencyCustomBtn.click({ force: true });
  }

  async createReportCron() {
    await this.frequencyCronBtn.click({ force: true });
  }

  async createReportDateTime() {
    // Start Date + Start Time are REQUIRED + format-checked on the non-cron
    // "Schedule Later" tab (CreateReport.schema date/time rule), so both must be
    // entered with well-formed values or the save is blocked.

    // ODate is a Reka segmented field (no native <input>). reka-ui defaults its
    // locale to "en", which ICU resolves to en-US → segment order is
    // MONTH / DAY / YEAR (deterministic; independent of the runner's OS locale).
    // Click the field, walk to the leftmost (month) segment with ArrowLeft, then
    // type the segments in M/D/Y order so Reka auto-advances and emits ISO
    // YYYY-MM-DD (here: 2027-12-29). Typing the day (29) into the month segment
    // first misplaces the digits and leaves `date` empty/invalid, which blocks
    // the step-2 -> step-3 advance (goToStep validates date/time).
    await this.scheduleStartDateField.click({ force: true });
    await this.page.keyboard.press('ArrowLeft');
    await this.page.keyboard.press('ArrowLeft'); // 3 segments -> 2 lefts reaches month from any start
    await this.page.keyboard.type('12');   // month
    await this.page.keyboard.type('29');   // day
    await this.page.keyboard.type('2027'); // year
    await this.page.keyboard.press('Escape');

    // OTime wraps a (visually hidden) native <input type="time"> inside its field
    // group — fill it directly with a 24h HH:MM value (matches the schema's
    // reportTimeRegex). force:true because the native input is visually hidden.
    await this.scheduleStartTimeField.waitFor({ state: 'visible', timeout: 5000 });
    const timeInput = this.scheduleStartTimeField.locator('input[type="time"]');
    await timeInput.fill('10:30', { force: true });
  }

  async createReportZone() {
    await this.scheduleTimezoneTrigger.click({ force: true });
    await this.scheduleTimezonePopover.waitFor({ state: 'visible', timeout: 10000 });
    await this.page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    const opt = this.scheduleTimezoneOption('UTC');
    await opt.waitFor({ state: 'visible', timeout: 10000 });
    await opt.click({ force: true });
    await this.scheduleTimezonePopover.waitFor({ state: 'hidden', timeout: 5000 }).catch(() => {});
  }

  async setTimeZone(zone) {
    await this.scheduleTimezoneTrigger.click({ force: true });
    await this.scheduleTimezonePopover.waitFor({ state: 'visible', timeout: 10000 });
    await this.scheduleTimezoneOption(zone).click({ force: true });
  }

  async setTimeIST() {
    await this.scheduleTimezoneTrigger.click({ force: true });
    await this.scheduleTimezonePopover.waitFor({ state: 'visible', timeout: 10000 });
    await this.scheduleTimezoneOption('Asia/Calcutta').click({ force: true });
  }

  async createReportScheduleLater() {
    await this.scheduleLaterBtn.click({ force: true });
  }

  async createReportContinueButtonStep2() {
    await this.continueButtonStep2.click({ force: true });
  }

  async createReportFillDetail() {
    await this.titleInputField.fill('reporterTest');
    await this.recipientsInputField.fill(process.env["ZO_ROOT_USER_EMAIL"]);
  }

  async createReportSaveButton() {
    await this.saveButton.click({ force: true });
  }

  async verifyReportCreated(reportName) {
    // Wait for save success toast
    await this.toastSuccess.first().waitFor({ state: 'visible', timeout: 30000 });
    await expect(this.toastSuccess.first()).toBeVisible({ timeout: 5000 });

    // Navigate to reports list. waitForLoadState('networkidle') is insufficient
    // here because Vue's onBeforeMount API call starts AFTER the browser idles —
    // wait for the reports GET response explicitly so data is in the table before
    // we attempt to search.
    const reportsApiPromise = this.page.waitForResponse(
      (resp) =>
        /\/api\/[^/]+\/reports(\?|$)/.test(resp.url()) &&
        resp.request().method() === 'GET' &&
        resp.status() === 200,
      { timeout: 30000 }
    ).catch(() => null);
    await this.page.goto(process.env["ZO_BASE_URL"] + "/web/reports?org_identifier=" + process.env["ORGNAME"]);
    await reportsApiPromise;

    // Search for the report and verify the action button is present
    await this.reportSearchInputField.fill(reportName);
    await expect(this.pauseStartReportBtn(reportName)).toBeVisible({ timeout: 15000 });
  }

  async createReport(dashboardName) {
    await this.createReportAddReportButton();
    await this.createReportReportNameInput('rreport1');
    await this.createReportFolderInput();
    await this.createReportDashboardInput(dashboardName);
    await this.createReportDashboardTabInput();
    await this.continueButtonStep1.click({ force: true });
    await this.continueButtonStep2.click({ force: true });
    await this.titleInputField.fill('reporterTest');
    await this.recipientsInputField.fill(process.env["ZO_ROOT_USER_EMAIL"]);
    await this.saveButton.click({ force: true });
  }

  async verifyReportSaved() {
    await expect(this.toastSuccess.first()).toBeVisible({ timeout: 10000 });
  }

  async deleteReport(reportName) {
    await this.reportSearchInputField.fill(reportName);
    await this.deleteReportBtn(reportName).click({ force: true });
    await this.confirmPrimaryBtn.waitFor({ state: 'visible', timeout: 10000 });
    await this.confirmPrimaryBtn.click();
  }

  async setTimeToPast30Seconds() {
    // Set the time filter to the last 30 seconds
    await this.dateTimeButtonLocator.click({ force: true });
    await this.relative30SecondsButton.click({ force: true });
  }

  async verifyTimeSetTo30Seconds() {
    // Verify that the time filter displays "Past 30 Seconds"
    await expect(this.dateTimeButtonLocator).toContainText(Past30SecondsValue);
  }

  async setDateTime() {
    await expect(this.dateTimeButtonLocator).toBeVisible();
    await this.dateTimeButtonLocator.click({ force: true });
    await this.absoluteTabLocator.click({ force: true });
    await this.page.waitForTimeout(1000);
  }

  async fillTimeRange(startTime, endTime) {
    // Absolute-tab calendar — first day cell, then access_time input (left untouched: this method isn't used by reportsScheduleNow)
    await this.absoluteTabLocator.click({ force: true });
    await this.absoluteStartTimeField.fill(startTime);
    await this.absoluteEndTimeField.fill(endTime);
  }

  async verifyDateTime(startTime, endTime) {
    await expect(this.dateTimeButtonLocator).toContainText(`${startTime} - ${endTime}`);
  }

  async signOut() {
    await this.profileButton.click({ force: true });
    await this.signOutButton.click({ force: true });
  }

  async pauseReport(reportName) {
    const btn = this.pauseStartReportBtn(reportName);
    await this.reportSearchInputField.fill(reportName);
    const visible = await btn.isVisible().catch(() => false);

    // Cross-cluster (super-cluster / SC) propagation race:
    // After SC login the active org may differ from ORGNAME (the org the report
    // was created in). Use page.goto with an explicit org_identifier rather than
    // page.reload so every retry lands on the correct org. Also wait for
    // networkidle so the reports API response is fully loaded before we search.
    if (!visible) {
      const origin = new URL(this.page.url()).origin;
      const reportsUrl = `${origin}/web/reports?org_identifier=${process.env["ORGNAME"]}`;
      await expect.poll(async () => {
        await this.page.goto(reportsUrl, { waitUntil: 'domcontentloaded' });
        await this.page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => {});
        await this.reportListTable.waitFor({ state: 'visible', timeout: 10000 });
        await this.page.waitForFunction(() => {
          const t = document.querySelector('[data-test="report-list-table"]');
          if (!t) return false;
          const text = t.textContent || '';
          return /Showing \d+ - \d+/.test(text) || !!document.querySelector('[data-test="o2-empty-state"]');
        }, { timeout: 10000 });
        await this.reportSearchInputField.fill(reportName);
        return await btn.waitFor({ state: 'visible', timeout: 3000 }).then(() => true).catch(() => false);
      }, {
        intervals: [3000, 5000, 5000, 10000, 10000, 15000],
        timeout: 120000,
      }).toBe(true);
    }

    await btn.click();
    // Wait for stopped/success toast
    await this.toastSuccess.first().waitFor({ state: 'visible', timeout: 10000 });
    await expect(this.toastSuccess.first()).toBeVisible({ timeout: 5000 });
  }

  async updateReport(reportName) {
    // Search for the report
    await this.reportSearchInputField.fill(reportName);
    await this.page.waitForTimeout(1000);

    // Click edit button
    await this.editReportBtn(reportName).click();

    // Wait for edit form to fully load
    await this.page.waitForTimeout(3000);

    // Update description (inner -field of the OInput wrapper)
    await this.descriptionInputField.click();
    await this.descriptionInputField.fill('Report Updated');

    // Click save button
    await this.saveButton.click();

    // Wait for save to process — gate on the reports list page returning to
    // a state where the search input is visible (proves navigation back from
    // the edit form completed and ReportList re-mounted). Replaces the legacy
    // 2s waitForTimeout which raced the navigation under CI load.
    await this.reportSearchInputField.waitFor({ state: 'visible', timeout: 30000 });

    // Search for the report to filter and verify the update appears
    await this.reportSearchInputField.fill(reportName);

    // Verify the updated description appears in the report row description
    // cell. Use OTable's column-scoped cell data-test (`o2-table-cell-<id>`)
    // and assert table contents via toContainText — no hasText filters.
    await this.reportListTable.waitFor({ state: 'visible', timeout: 15000 });
    await expect(this.reportListTable).toContainText('Report Updated', { timeout: 15000 });
  }

  // async logedOut() {
  //   await this.page.locator('[data-test="header-my-account-profile-icon"]').click({ force: true });
  //   await this.page.waitForSelector('[data-test="menu-link-logout-item"]');
  //   await this.page.locator('[data-test="menu-link-logout-item"]').click();
  // }

  async loggedOut() {
    // Click on the profile icon
    await this.profileButton.click();

    // Wait for the logout menu item to be attached to the DOM
    await this.signOutButton.waitFor({ state: 'attached', timeout: 10000 });
    // Wait for element to be visible instead of hard wait
    await this.signOutButton.waitFor({ state: 'visible', timeout: 5000 });
    // Now click the logout item
    await this.signOutButton.click({ force: true });
  }

  async notAvailableReport(reportName) {
    await this.reportSearchInputField.fill(reportName);
    await this.reportListTable.waitFor({ state: 'visible', timeout: 10000 });
    await expect(this.page.locator('[data-test="o2-empty-state"]')).toBeVisible();
  }

  // ── Report Format section helpers ───────────────────────────────────────

  async selectReportType(value) {
    // Open the report type dropdown by clicking the trigger.
    // NOTE: This OSelect lacks a direct `data-test` prop (the attribute is on
    // the parent <div> instead), so the popover and option children do NOT have
    // data-test-concatenated attributes. We locate options by data-test-value
    // instead, which OSelect always renders unconditionally.
    await this.reportTypeTrigger.waitFor({ state: 'visible', timeout: 10000 });
    await this.reportTypeTrigger.click();
    // Click the desired option — gating on its visibility confirms the popover opened
    const opt = this.reportTypeOption(value);
    await opt.waitFor({ state: 'visible', timeout: 10000 });
    await opt.click();
    // Wait for popover to close after selection (gate on option disappearing)
    await opt.waitFor({ state: 'hidden', timeout: 5000 }).catch(() => {});
    // Allow Vue reactivity to settle
    await this.page.waitForTimeout(300);
  }

  async selectDashboardDefaults(dashboardName) {
    await this.createReportFolderInput();
    await this.createReportDashboardInput(dashboardName);
    await this.createReportDashboardTabInput();
  }

  // ── Visibility assertion helpers (no raw selectors leak into specs) ─────

  async expectReportFormatSectionVisible() {
    await expect(this.reportFormatSection).toBeVisible({ timeout: 15000 });
  }

  async expectAttachmentTypeVisible() {
    await expect(this.attachmentTypeSelect).toBeVisible({ timeout: 5000 });
  }

  async expectAttachmentTypeHidden() {
    await expect(this.attachmentTypeSelect).not.toBeVisible({ timeout: 5000 });
  }

  async expectCustomDimensionsVisible() {
    await expect(this.customDimensionsSection).toBeVisible({ timeout: 5000 });
  }

  async expectCustomDimensionsHidden() {
    await expect(this.customDimensionsSection).not.toBeVisible({ timeout: 5000 });
  }

  async expectPngNoteVisible() {
    await expect(this.pngNoteBanner).toBeVisible({ timeout: 5000 });
  }

  async expectPngNoteHidden() {
    await expect(this.pngNoteBanner).not.toBeVisible({ timeout: 5000 });
  }

  async expectReportTypeOptionVisible(value) {
    // Open the popover, assert the option is visible, then close it.
    // Same note as selectReportType: popover/option data-test attrs are missing
    // because OSelect lacks a direct data-test prop. Use data-test-value instead.
    await this.reportTypeTrigger.waitFor({ state: 'visible', timeout: 10000 });
    await this.reportTypeTrigger.click();
    const opt = this.reportTypeOption(value);
    await expect(opt).toBeVisible({ timeout: 5000 });
    // Close popover by pressing Escape
    await this.page.keyboard.press('Escape');
    await opt.waitFor({ state: 'hidden', timeout: 5000 }).catch(() => {});
  }

  async expectReportTypeOptionSelected(value) {
    // Verify the selected value display shows the expected label
    const labelMap = { csv: 'CSV (Data)', pdf: 'PDF (default)', png: 'PNG (Image)' };
    const expectedLabel = labelMap[value] || value;
    await expect(this.reportTypeTrigger).toContainText(expectedLabel, { timeout: 10000 });
  }

}
