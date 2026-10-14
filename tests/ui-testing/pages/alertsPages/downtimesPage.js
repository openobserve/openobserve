// Copyright 2026 OpenObserve Inc.

// Page object for Alerts → Downtimes: list, create/edit, detail, quick-mute dialog, org banner and the synthetics row mute.

import { expect } from '@playwright/test';
const testLogger = require('../../playwright-tests/utils/test-logger.js');

const ORG = () => process.env.ORGNAME || 'default';

export class DowntimesPage {
  constructor(page) {
    this.page = page;

    // List
    this.listPage = '[data-test="downtime-list-page"]';
    this.listSearchField = '[data-test="downtime-list-search-field"]';
    this.listScopeThis = '[data-test="downtime-list-scope-this"]';
    this.listScopeAll = '[data-test="downtime-list-scope-all"]';
    this.bulkCancelBtn = '[data-test="downtime-list-bulk-cancel"]';
    this.moveDialog = '[data-test="downtime-list-move-dialog"]';
    this.moveFolderSelect = 'downtimes-index-dropdown-stream_type';
    this.tableRow = '[data-test^="o2-table-row-"]';
    this.rowCheckbox = '[data-test="o2-table-select-cell"] button[role="checkbox"]';
    this.confirmDialog = '[data-test="confirm-dialog"]';
    this.folderDeleteDialog = '[data-test="dashboard-confirm-delete-folder-dialog"]';
    this.folderMoreIcon = '[data-test="dashboard-more-icon"]';
    this.folderDeleteItem = '[data-test="dashboard-delete-folder-icon"]';
    this.dialogPrimary = '[data-test="o-dialog-primary-btn"]';
    this.dialogSecondary = '[data-test="o-dialog-secondary-btn"]';
    this.toastMessage = '[data-test="o-toast-message"]';
    this.toastAction = '[data-test="o-toast-action-btn"]';

    // Create / edit
    this.addRoot = '[data-test="add-downtime"]';
    this.nameTrigger = '[data-test="add-downtime-name-trigger"]';
    this.nameInput = '[data-test="add-downtime-name-input"]';
    this.nameValue = '[data-test="add-downtime-name-value"]';
    this.saveBtn = '[data-test="add-downtime-save"]';
    this.cancelBtn = '[data-test="add-downtime-cancel"]';
    this.checkScheduleBanner = '[data-test="add-downtime-check-schedule"]';
    this.staleBanner = '[data-test="add-downtime-stale-banner"]';
    this.reloadBtn = '[data-test="add-downtime-reload"]';
    this.activeBanner = '[data-test="add-downtime-active-banner"]';
    this.noModule = '[data-test="add-downtime-no-module"]';
    this.reasonField = '[data-test="add-downtime-reason-field"]';
    this.muteAllDialog = '[data-test="add-downtime-mute-all-dialog"]';
    this.previewIncomplete = '[data-test="add-downtime-preview-incomplete"]';
    this.conditionSection = '[data-test="downtime-condition"]';
    this.conditionAdd = '[data-test="downtime-condition-add"]';
    this.conditionColumn = 'alert-conditions-select-column';
    this.conditionOperator = 'alert-conditions-operator-select';
    this.conditionValueCombobox = '[data-test="alert-conditions-value-combobox-input"]';
    this.conditionValueInput = '[data-test="alert-conditions-value-input-field"]';
    this.resourceDimension = '[data-test="downtime-resource-picker-dimension-trigger"]';
    this.resourceLoad = '[data-test="downtime-resource-picker-load"]';
    this.resourceTable = '[data-test="downtime-resource-picker-table"]';
    this.summarySentence = '[data-test="downtime-summary-sentence"]';
    this.durationField = '[data-test="downtime-schedule-duration-field"]';
    this.notifySection = '[data-test="downtime-notify"]';
    this.notifyDestinations = 'alert-destinations-select';
    this.notifyLeadField = '[data-test="downtime-notify-lead-field"]';
    this.incidentModeNone = '[data-test="downtime-target-alerts-incident-mode-none"]';
    this.folderInlineSelect = 'inline-select-folder-dropdown';

    // Detail
    this.detailStatus = '[data-test="downtime-detail-status"]';
    this.detailTitle = '[data-test="downtime-detail-title"]';
    this.detailOccurrences = '[data-test="downtime-detail-occurrences"]';
    this.scheduleBand = '[data-test="downtime-schedule-band"]';
    this.detailAffectedAlerts = '[data-test="downtime-detail-affected-alerts"]';
    this.detailSuppressedTable = '[data-test="downtime-detail-suppressed-table"]';
    this.detailSuppressedEmpty = '[data-test="downtime-detail-suppressed-empty"]';
    this.detailNotificationsTable = '[data-test="downtime-detail-notifications-table"]';
    this.detailNotificationsEmpty = '[data-test="downtime-detail-notifications-empty"]';
    this.detailNotFound = '[data-test="downtime-detail-not-found"]';
    this.detailMuteHour = '[data-test="downtime-detail-mute-hour"]';
    this.detailSendTest = '[data-test="downtime-detail-send-test"]';
    this.detailEndNow = '[data-test="downtime-detail-end-now"]';
    this.detailExtend = '[data-test="downtime-detail-extend"]';
    this.detailExtendUntil = '[data-test="downtime-detail-extend-until"]';
    this.detailExtendDialog = '[data-test="downtime-detail-extend-dialog"]';

    // Quick mute dialog
    this.quickMuteDialog = '[data-test="quick-mute-dialog"]';
    this.quickMuteCustomPreset = '[data-test="quick-mute-preset-custom"]';
    this.quickMuteReason = '[data-test="quick-mute-reason-field"]';

    // Org banner: ids carry `:` and `,`, and the CTA suffix differs between builds, so only prefixes are used.
    this.bannerBody = '[data-test^="announcement-banner-body-downtime:"]';
    this.bannerCountdown = '[data-test^="announcement-banner-countdown-downtime:"]';
    this.bannerCta = '[data-test^="announcement-banner-cta-downtime:"]';
    this.bannerDismiss = '[data-test^="announcement-banner-dismiss-downtime:"]';

    // Synthetics list
    this.syntheticsTable = 'synthetic-monitoring-monitors-table';
  }

  // ------------------------------------------------------------------ shared helpers

  async _openSelect(dataTest, scope = this.page) {
    const trigger = scope.locator(`[data-test="${dataTest}-trigger"]`).first();
    await expect(trigger).toBeVisible({ timeout: 15000 });
    for (let i = 0; i < 5; i++) {
      if ((await trigger.getAttribute('aria-expanded')) === 'true') return trigger;
      await trigger.click();
      await expect(trigger).toHaveAttribute('aria-expanded', 'true', { timeout: 2000 }).catch(() => {});
    }
    await expect(trigger).toHaveAttribute('aria-expanded', 'true');
    return trigger;
  }

  /** Pick `value` in an OSelect and verify the trigger committed it (virtualized options can drop a click). */
  async _pickOption(dataTest, value, { scope = this.page, label = null, multiple = false } = {}) {
    const trigger = await this._openSelect(dataTest, scope);
    const option = this.page.locator(`[data-test="${dataTest}-option"][data-test-value="${value}"]`).first();
    if (!(await option.isVisible())) {
      const search = this.page.locator(`[data-test="${dataTest}-search"]`).first();
      if (await search.isVisible()) await search.fill(label ?? String(value));
    }
    await expect(option).toBeVisible({ timeout: 15000 });
    await option.click();
    if (multiple) await this.page.keyboard.press('Escape');
    await expect(trigger).toHaveAttribute('data-test-selected-value', multiple ? new RegExp(`(^|,)${value}(,|$)`) : String(value));
  }

  async _setDate(dataTest, date) {
    const group = this.page.locator(`[data-test="${dataTest}-group"]`).first();
    const parts = { month: String(date.getMonth() + 1).padStart(2, '0'), day: String(date.getDate()).padStart(2, '0'), year: String(date.getFullYear()) };
    for (const [part, value] of Object.entries(parts)) {
      const segment = group.locator(`[data-reka-date-field-segment="${part}"]`);
      await segment.click();
      await this.page.keyboard.type(value);
    }
  }

  async _setTime(dataTest, hhmm) {
    const input = this.page.locator(`[data-test="${dataTest}"] input`).first();
    await input.fill(hhmm);
    await input.press('Tab');
  }

  async expectNoToast(text) {
    await expect(this.page.locator(this.toastMessage).filter({ hasText: text })).toHaveCount(0);
  }

  async expectToast(text) {
    await expect(this.page.locator(this.toastMessage).filter({ hasText: text }).first()).toBeVisible({ timeout: 20000 });
  }

  /** Counts full page loads from now on, to prove a UI change happened without a reload. */
  trackNavigations() {
    const tracker = { count: 0 };
    this.page.on('load', () => { tracker.count += 1; });
    return tracker;
  }

  async expectUrl(pattern) {
    await expect(this.page).toHaveURL(pattern, { timeout: 20000 });
  }

  async clickToastAction(text) {
    const toast = this.page.locator('[data-test^="o-toast-"][data-test-message]').filter({ hasText: text }).first();
    await toast.locator(this.toastAction).click();
  }

  // ------------------------------------------------------------------ list

  async gotoList(folderId, query = {}) {
    const q = new URLSearchParams({ org_identifier: ORG(), folder: folderId, ...query });
    await this.page.goto(`/web/downtimes?${q}`);
    await expect(this.page.locator(this.listPage)).toBeVisible({ timeout: 30000 });
    testLogger.navigation('Downtimes list', { folderId });
  }

  row(id) {
    return this.page.locator(this.tableRow).filter({ has: this.page.locator(`[data-test="downtime-list-${id}-name"]`) });
  }

  rowCell(id, column) {
    return this.row(id).locator(`[data-test="o2-table-cell-${column}"]`);
  }

  async expectRowVisible(id) {
    await expect(this.page.locator(`[data-test="downtime-list-${id}-name"]`)).toBeVisible({ timeout: 20000 });
  }

  async expectRowHidden(id) {
    await expect(this.page.locator(`[data-test="downtime-list-${id}-name"]`)).toHaveCount(0, { timeout: 20000 });
  }

  async expectRowStatus(id, text, { timeout = 20000 } = {}) {
    await expect(this.rowCell(id, 'status')).toHaveText(text, { timeout });
  }

  async expectRowWhen(id, pattern) {
    await expect(this.rowCell(id, 'when')).toHaveText(pattern);
  }

  async expectTargetsCell(id, { contains, notContains }) {
    const cell = this.page.locator(`[data-test="downtime-list-${id}-targets"]`);
    if (contains) await expect(cell).toContainText(contains);
    if (notContains) await expect(cell).not.toContainText(notContains);
  }

  async clickStatTile(status) {
    await this.page.locator(`[data-test="downtime-summary-${status}"]`).click();
  }

  async expectStatTileCount(status, count) {
    await expect(this.page.locator(`[data-test="downtime-summary-${status}"]`)).toHaveText(new RegExp(`(^|\\D)${count}(\\D|$)`));
  }

  async setType(type) {
    const item = this.page.locator(`[data-test="downtime-list-type-${type}"]`);
    await item.click();
    await expect(item).toHaveAttribute('data-state', 'on');
  }

  async search(term) {
    await this.page.locator(this.listSearchField).fill(term);
  }

  async setScope(scope) {
    const item = this.page.locator(scope === 'all' ? this.listScopeAll : this.listScopeThis);
    await item.click();
    await expect(item).toHaveAttribute('data-state', 'on');
  }

  async extendPreset(id, preset) {
    await this.page.locator(`[data-test="downtime-list-${id}-extend"]`).click();
    await this.page.locator(`[data-test="downtime-list-${id}-extend-${preset}"]`).click();
  }

  async expectExtendDisabled(id) {
    await expect(this.page.locator(`[data-test="downtime-list-${id}-extend"]`)).toBeDisabled();
  }

  async clickEndNow(id) {
    await this.page.locator(`[data-test="downtime-list-${id}-end-now"]`).click();
  }

  async clickCancel(id) {
    await this.page.locator(`[data-test="downtime-list-${id}-cancel"]`).click();
  }

  async expectConfirm({ title, ok, cancel }) {
    const dialog = this.page.locator(this.confirmDialog).filter({ visible: true });
    await expect(dialog).toBeVisible();
    if (title) await expect(dialog).toContainText(title);
    if (ok) await expect(dialog.locator(this.dialogPrimary)).toHaveText(ok);
    if (cancel) await expect(dialog.locator(this.dialogSecondary)).toHaveText(cancel);
  }

  async confirm() {
    const dialog = this.page.locator(this.confirmDialog).filter({ visible: true });
    await dialog.locator(this.dialogPrimary).click();
    await expect(dialog).toBeHidden();
  }

  async dismissConfirm() {
    const dialog = this.page.locator(this.confirmDialog).filter({ visible: true });
    await dialog.locator(this.dialogSecondary).click();
    await expect(dialog).toBeHidden();
  }

  async openMore(id) {
    await this.page.locator(`[data-test="downtime-list-${id}-more"]`).click();
  }

  async expectMoreItemAbsent(id, item) {
    await expect(this.page.locator(`[data-test="downtime-list-${id}-move"]`)).toBeVisible();
    await expect(this.page.locator(`[data-test="downtime-list-${id}-${item}"]`)).toHaveCount(0);
  }

  async closeMenu() {
    await this.page.keyboard.press('Escape');
  }

  async deleteRow(id) {
    await this.openMore(id);
    await this.page.locator(`[data-test="downtime-list-${id}-delete"]`).click();
    await this.confirm();
  }

  async duplicateRow(id) {
    await this.page.locator(`[data-test="downtime-list-${id}-duplicate"]`).click();
    await expect(this.page.locator(this.addRoot)).toBeVisible({ timeout: 30000 });
  }

  async moveRow(id, folderId) {
    await this.openMore(id);
    await this.page.locator(`[data-test="downtime-list-${id}-move"]`).click();
    const dialog = this.page.locator(this.moveDialog);
    await expect(dialog).toBeVisible();
    await this._pickOption(this.moveFolderSelect, folderId);
    await dialog.locator(this.dialogPrimary).click();
    await expect(dialog).toBeHidden({ timeout: 15000 });
  }

  async deleteFolderFromSidebar(folderId) {
    const tab = this.page.locator(`[data-test="dashboard-folder-tab-${folderId}"]`);
    await tab.hover();
    await tab.locator(this.folderMoreIcon).click();
    await this.page.locator(this.folderDeleteItem).click();
    await this.page.locator(this.folderDeleteDialog).locator(this.dialogPrimary).click();
  }

  async expectFolderInSidebar(folderId, present = true) {
    const tab = this.page.locator(`[data-test="dashboard-folder-tab-${folderId}"]`);
    if (present) await expect(tab).toBeVisible();
    else await expect(tab).toHaveCount(0, { timeout: 15000 });
  }

  async selectRows(ids) {
    for (const id of ids) {
      const box = this.row(id).locator(this.rowCheckbox);
      await box.click();
      await expect(box).toHaveAttribute('data-state', 'checked');
    }
  }

  async bulkCancel() {
    await this.page.locator(this.bulkCancelBtn).click();
    await this.confirm();
  }

  async rowBox(id) {
    return this.row(id).boundingBox();
  }

  async cellBox(id, column) {
    return this.rowCell(id, column).boundingBox();
  }

  async actionsBox(id) {
    return this.page.locator(`[data-test="downtime-list-${id}-actions"]`).boundingBox();
  }

  /** Visible Duplicate controls for a row: the desktop icon button plus any open-menu item. */
  async visibleDuplicateControlCount(id) {
    // Wait for the open menu so a menu-only Duplicate cannot be missed.
    await expect(this.page.locator(`[data-test="downtime-list-${id}-move"]`)).toBeVisible();
    return this.page.locator(`[data-test="downtime-list-${id}-duplicate"], [data-test="downtime-list-${id}-duplicate-menu"]`)
      .filter({ visible: true }).count();
  }

  async visibleMenuItemCount(text) {
    return this.page.locator('[role="menuitem"]').filter({ hasText: text, visible: true }).count();
  }

  // ------------------------------------------------------------------ create / edit

  async gotoAdd(folderId, query = {}) {
    const q = new URLSearchParams({ org_identifier: ORG(), folder_id: folderId, ...query });
    await this.page.goto(`/web/downtimes/add?${q}`);
    await expect(this.page.locator(this.addRoot)).toBeVisible({ timeout: 30000 });
    await expect(this.page.locator(this.saveBtn)).toBeEnabled({ timeout: 30000 });
  }

  async gotoEdit(id, folderId) {
    await this.page.goto(`/web/downtimes/${id}/edit?org_identifier=${ORG()}&folder=${folderId}`);
    await expect(this.page.locator(this.addRoot)).toBeVisible({ timeout: 30000 });
  }

  async expectOnListUrl(folderId) {
    await expect(this.page).toHaveURL(new RegExp(`/downtimes\\?.*folder=${folderId}`), { timeout: 20000 });
    await expect(this.page.locator(this.listPage)).toBeVisible();
  }

  async expectNameError(text) {
    await expect(this.page.locator('[data-test="add-downtime-name-error"]')).toHaveText(text, { timeout: 15000 });
  }

  async expectOnAddPage() {
    await expect(this.page).toHaveURL(/\/downtimes\/add/);
    await expect(this.page.locator(this.addRoot)).toBeVisible();
  }

  async setName(name, { pressEnterTimes = 0 } = {}) {
    await this.page.locator(this.nameTrigger).click();
    const input = this.page.locator(this.nameInput);
    await input.fill(name);
    for (let i = 0; i < pressEnterTimes; i++) {
      // The first Enter commits the inline edit and hides the input; later presses go to whatever holds focus.
      if (await input.isVisible()) await input.press('Enter');
      else await this.page.keyboard.press('Enter');
      await this.page.waitForTimeout(1000);
    }
    if (await input.isVisible()) await input.press('Tab');
  }

  async expectTitle(textOrPattern) {
    await expect(this.page.locator(this.nameValue).first()).toHaveText(textOrPattern);
  }

  async toggleModule(module) {
    await this.page.locator(`[data-test="add-downtime-module-${module}"]`).click();
  }

  async expectModulePressed(module, pressed = true) {
    await expect(this.page.locator(`[data-test="add-downtime-module-${module}"]`)).toHaveAttribute('data-state', pressed ? 'on' : 'off');
  }

  async openTab(tab) {
    const item = this.page.locator(`[data-test="add-downtime-tab-${tab}"]`);
    await item.click();
    await expect(item).toHaveAttribute('data-state', 'on');
  }

  async expectActiveTab(tab) {
    await expect(this.page.locator(`[data-test="add-downtime-tab-${tab}"]`)).toHaveAttribute('data-state', 'on');
  }

  async addSpecificItems(module, ids) {
    await this.page.locator(`[data-test="downtime-target-${module}-add-items"]`).click();
    for (const id of ids) await this._pickOption(`downtime-target-${module}-ids`, id, { multiple: true });
  }

  async expectSpecificItemSelected(module, id) {
    await expect(this.page.locator(`[data-test="downtime-target-${module}-ids-trigger"]`))
      .toHaveAttribute('data-test-selected-value', new RegExp(`(^|,)${id}(,|$)`), { timeout: 20000 });
  }

  /** Narrow a module to exactly these folders, dropping the default "All folders" (`__all__`). */
  async setTargetFolders(module, folderIds) {
    const dt = `downtime-target-${module}-folders`;
    const trigger = await this._openSelect(dt);
    for (const id of folderIds) {
      await this.page.locator(`[data-test="${dt}-option"][data-test-value="${id}"]`).first().click();
    }
    if (/(^|,)__all__(,|$)/.test((await trigger.getAttribute('data-test-selected-value')) ?? '')) {
      await this.page.locator(`[data-test="${dt}-option"][data-test-value="__all__"]`).first().click();
    }
    await this.page.keyboard.press('Escape');
    await expect(trigger).toHaveAttribute('data-test-selected-value', folderIds.join(','));
  }

  /** Deselect every folder, leaving the module with no folder at all. */
  async clearTargetFolders(module) {
    const dt = `downtime-target-${module}-folders`;
    const trigger = await this._openSelect(dt);
    const selected = ((await trigger.getAttribute('data-test-selected-value')) ?? '').split(',').filter(Boolean);
    for (const value of selected) {
      await this.page.locator(`[data-test="${dt}-option"][data-test-value="${value}"]`).first().click();
    }
    await this.page.keyboard.press('Escape');
    await expect(trigger).toHaveAttribute('data-test-selected-value', '');
  }

  async openCondition() {
    await this.page.locator(this.conditionAdd).click();
    await expect(this.page.locator(this.conditionSection).locator(`[data-test="${this.conditionColumn}-trigger"]`).first()).toBeVisible();
  }

  /** Fill condition row `index` (0-based); a falsy key leaves the dimension unset. */
  async fillConditionRow(index, { key, operator = '=', value }) {
    const section = this.page.locator(this.conditionSection);
    if (key) {
      const trigger = section.locator(`[data-test="${this.conditionColumn}-trigger"]`).nth(index);
      await trigger.click();
      const option = this.page.locator(`[data-test="${this.conditionColumn}-option"][data-test-value="${key}"]`).first();
      await expect(option).toBeVisible({ timeout: 15000 });
      await option.click();
      await expect(trigger).toHaveAttribute('data-test-selected-value', key);
    }
    if (operator && operator !== '=') {
      const opTrigger = section.locator(`[data-test="${this.conditionOperator}-trigger"]`).nth(index);
      await opTrigger.click();
      await this.page.locator(`[data-test="${this.conditionOperator}-option"][data-test-value="${operator}"]`).first().click();
      // The operator select is a non-listbox OSelect, which renders no data-test-selected-value.
      await expect(opTrigger).toHaveText(operator);
    }
    if (value !== undefined) {
      const combo = section.locator(this.conditionValueCombobox).nth(index);
      const input = (await combo.count()) > 0 ? combo : section.locator(this.conditionValueInput).nth(index);
      await input.fill(value);
      await input.press('Escape');
    }
  }

  async expectConditionRow(index, { key, operator, value }) {
    const section = this.page.locator(this.conditionSection);
    await expect(section.locator(`[data-test="${this.conditionColumn}-trigger"]`).nth(index)).toHaveAttribute('data-test-selected-value', key);
    await expect(section.locator(`[data-test="${this.conditionOperator}-trigger"]`).nth(index)).toHaveText(operator);
    const combo = section.locator(this.conditionValueCombobox).nth(index);
    const input = (await combo.count()) > 0 ? combo : section.locator(this.conditionValueInput).nth(index);
    await expect(input).toHaveValue(value);
  }

  async expectPreviewIncomplete(text) {
    await expect(this.page.locator(this.previewIncomplete)).toHaveText(text);
  }

  async expectPreviewIncludes(module, name, included = true) {
    const block = this.page.locator(`[data-test="downtime-preview-${module}"]`);
    if (included) await expect(block).toContainText(name, { timeout: 20000 });
    else await expect(block).not.toContainText(name);
  }

  async expectSummary(textOrPattern) {
    await expect(this.page.locator(this.summarySentence)).toHaveText(textOrPattern);
  }

  async expectSummaryContains(text) {
    await expect(this.page.locator(this.summarySentence)).toContainText(text, { timeout: 15000 });
  }

  async expectSummaryNotContains(text) {
    await expect(this.page.locator(this.summarySentence)).not.toContainText(text);
  }

  async expectResourceDimension(value) {
    await expect(this.page.locator(this.resourceDimension)).toHaveAttribute('data-test-selected-value', value);
  }

  async loadResources() {
    await this.page.locator(this.resourceLoad).click();
  }

  async expectResourceListed(value) {
    await expect(this.page.locator(this.resourceTable)).toContainText(value, { timeout: 30000 });
  }

  async setRepeat(repeat) {
    const item = this.page.locator(`[data-test="downtime-schedule-repeat-${repeat}"]`);
    await item.click();
    await expect(item).toHaveAttribute('data-state', 'on');
  }

  async toggleWeekday(isoDay) {
    await this.page.locator(`[data-test="downtime-schedule-weekday-${isoDay}"]`).click();
  }

  async expectWeekdayPressed(isoDay, pressed) {
    await expect(this.page.locator(`[data-test="downtime-schedule-weekday-${isoDay}"]`)).toHaveAttribute('data-state', pressed ? 'on' : 'off');
  }

  async expectScheduleTimes(start, end) {
    await expect(this.page.locator('[data-test="downtime-schedule-start-time"] input').first()).toHaveValue(start);
    await expect(this.page.locator('[data-test="downtime-schedule-end-time"] input').first()).toHaveValue(end);
  }

  /** A one-time window from two local `Date`s. */
  async setOnceWindow(start, end) {
    const hhmm = (d) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    await this._setDate('downtime-schedule-start-date', start);
    await this._setTime('downtime-schedule-start-time', hhmm(start));
    await this._setDate('downtime-schedule-end-date', end);
    await this._setTime('downtime-schedule-end-time', hhmm(end));
  }

  async setDuration(text) {
    await this.page.locator(this.durationField).fill(text);
    await this.page.locator(this.durationField).press('Tab');
  }

  async setReason(text) {
    await this.openTab('advanced');
    await this.page.locator(this.reasonField).fill(text);
  }

  async chooseIncidentModeNone() {
    await this.page.locator(this.incidentModeNone).click();
  }

  async pickNotifyDestination(name) {
    const section = this.page.locator(this.notifySection);
    const trigger = await this._openSelect(this.notifyDestinations, section);
    await this.page.locator(`[data-test="${this.notifyDestinations}-option"]`).filter({ hasText: name }).first().click();
    await this.page.keyboard.press('Escape');
    await expect(trigger).toHaveAttribute('data-test-selected-value', new RegExp(name));
  }

  async expectNotifyEventChecked(event, checked = true) {
    await expect(this.page.locator(`[data-test="downtime-notify-event-${event}-btn"]`)).toHaveAttribute('data-state', checked ? 'checked' : 'unchecked');
  }

  async expectNotifyLead(value) {
    await expect(this.page.locator(this.notifyLeadField)).toHaveValue(value);
  }

  async save() {
    await this.page.locator(this.saveBtn).click();
  }

  async cancelCreate() {
    await this.page.locator(this.cancelBtn).click();
  }

  async expectCheckScheduleNudge() {
    await expect(this.page.locator(this.checkScheduleBanner)).toBeVisible();
  }

  async expectErrorText(text) {
    await expect(this.page.getByText(text, { exact: true }).first()).toBeVisible({ timeout: 15000 });
  }

  async expectNoModuleHint(text) {
    await expect(this.page.locator(this.noModule)).toHaveText(text);
  }

  async expectMuteAllDialog({ title, present = [], absent = [] }) {
    const dialog = this.page.locator(this.muteAllDialog);
    await expect(dialog).toBeVisible();
    if (title) await expect(dialog).toContainText(title);
    for (const m of present) await expect(dialog.locator(`[data-test="add-downtime-mute-all-module-${m}"]`)).toBeVisible();
    for (const m of absent) await expect(dialog.locator(`[data-test="add-downtime-mute-all-module-${m}"]`)).toHaveCount(0);
  }

  async muteAllCancel() {
    await this.page.locator(this.muteAllDialog).locator(this.dialogSecondary).click();
    await expect(this.page.locator(this.muteAllDialog)).toBeHidden();
  }

  async muteAllConfirm() {
    await this.page.locator(this.muteAllDialog).locator(this.dialogPrimary).click();
  }

  async expectActiveEditBanner(prefix) {
    await expect(this.page.locator(this.activeBanner)).toContainText(prefix);
  }

  async expectStaleBanner(text) {
    await expect(this.page.locator(this.staleBanner)).toContainText(text, { timeout: 20000 });
  }

  async reloadStale() {
    await this.page.locator(this.reloadBtn).click();
  }

  // ------------------------------------------------------------------ detail

  async gotoDetail(id, folderId) {
    const folder = folderId ? `&folder=${folderId}` : '';
    await this.page.goto(`/web/downtimes/${id}?org_identifier=${ORG()}${folder}`);
    await expect(this.page.locator(`${this.detailTitle}, ${this.detailNotFound}`).first()).toBeVisible({ timeout: 30000 });
  }

  async expectOnDetail(id) {
    await expect(this.page).toHaveURL(new RegExp(`/downtimes/${id}(\\?|$)`), { timeout: 20000 });
  }

  async expectDetailStatus(text) {
    await expect(this.page.locator(this.detailStatus)).toHaveText(text, { timeout: 20000 });
  }

  async expectScheduleBand() {
    await expect(this.page.locator(this.detailOccurrences).locator(this.scheduleBand)).toBeVisible();
  }

  async openDetailTab(tab) {
    const item = this.page.locator(`[data-test="downtime-detail-tab-${tab}"]`);
    await item.click();
    await expect(item).toHaveAttribute('data-state', 'active');
  }

  async expectDetailTabLabel(tab, pattern) {
    await expect(this.page.locator(`[data-test="downtime-detail-tab-${tab}"]`)).toHaveText(pattern, { timeout: 20000 });
  }

  async expectAffectedAlertsContain(name) {
    await expect(this.page.locator(this.detailAffectedAlerts)).toContainText(name);
  }

  async expectNotificationsEmpty(text) {
    await expect(this.page.locator(this.detailNotificationsEmpty)).toContainText(text);
  }

  async expectSuppressedEmpty(text) {
    await expect(this.page.locator(this.detailSuppressedEmpty)).toContainText(text);
  }

  async expectSuppressedRowFor(alertName) {
    await expect(this.page.locator(this.detailSuppressedTable).locator(this.tableRow).filter({ hasText: alertName }).first()).toBeVisible({ timeout: 20000 });
  }

  async expectNotificationRows(result, count) {
    await expect(this.page.locator(this.detailNotificationsTable).locator(this.tableRow).filter({ hasText: result })).toHaveCount(count, { timeout: 20000 });
  }

  async expectNotFound(text) {
    await expect(this.page.locator(this.detailNotFound)).toContainText(text);
  }

  async muteForHourFromDetail() {
    await this.page.locator(this.detailMuteHour).click();
  }

  async sendTestFromDetail() {
    await this.page.locator(this.detailSendTest).click();
  }

  async endNowFromDetail() {
    await this.page.locator(this.detailEndNow).click();
    await this.confirm();
  }

  async extendUntilFromDetail(end) {
    await this.page.locator(this.detailExtend).click();
    await this.page.locator(this.detailExtendUntil).click();
    const dialog = this.page.locator(this.detailExtendDialog);
    await expect(dialog).toBeVisible();
    const hhmm = `${String(end.getHours()).padStart(2, '0')}:${String(end.getMinutes()).padStart(2, '0')}`;
    await this._setDate('extend-downtime-end-date', end);
    await this._setTime('extend-downtime-end-time', hhmm);
    await dialog.locator(this.dialogPrimary).click();
    await expect(dialog).toBeHidden({ timeout: 15000 });
  }

  // ------------------------------------------------------------------ quick mute dialog

  async expectQuickMuteDialog(visible = true) {
    if (visible) await expect(this.page.locator(this.quickMuteDialog)).toBeVisible();
    else await expect(this.page.locator(this.quickMuteDialog)).toHaveCount(0);
  }

  async cancelQuickMute() {
    await this.page.locator(this.quickMuteDialog).locator(this.dialogSecondary).click();
    await expect(this.page.locator(this.quickMuteDialog)).toBeHidden();
  }

  /** Custom end, reason and filing folder, then the primary "Mute until …" button. */
  async quickMuteCustom({ end, reason, folderId }) {
    const dialog = this.page.locator(this.quickMuteDialog);
    await dialog.locator(this.quickMuteCustomPreset).click();
    await this._setDate('quick-mute-end-date', end);
    await this._setTime('quick-mute-end-time', `${String(end.getHours()).padStart(2, '0')}:${String(end.getMinutes()).padStart(2, '0')}`);
    await dialog.locator(this.quickMuteReason).fill(reason);
    await this._pickOption(this.folderInlineSelect, folderId, { scope: dialog });
    const primary = dialog.locator(this.dialogPrimary);
    await expect(primary).toHaveText(/^Mute until /);
    await primary.click();
    await expect(dialog).toBeHidden({ timeout: 15000 });
  }

  // ------------------------------------------------------------------ org banner

  /** The banner body whose id names this downtime; a combined banner lists every active id, so this works on a shared org too. */
  bannerById(downtimeId) {
    return this.page.locator(`${this.bannerBody}[data-test*="${downtimeId}"]`);
  }

  async expectBannerById(downtimeId, visible = true, { timeout = 20000 } = {}) {
    if (visible) await expect(this.bannerById(downtimeId).first()).toBeVisible({ timeout });
    else await expect(this.bannerById(downtimeId)).toHaveCount(0, { timeout });
  }

  async clearDismissedBanners() {
    await this.page.evaluate(() => {
      try { localStorage.removeItem('o2_dismissed_announcements'); } catch { /* storage may be blocked */ }
    });
  }

  async expectBannerText(pattern) {
    await expect(this.page.locator(this.bannerBody).first()).toContainText(pattern, { timeout: 20000 });
  }

  async expectBannerCountdown(pattern) {
    await expect(this.page.locator(this.bannerCountdown).first()).toHaveText(pattern, { timeout: 20000 });
  }

  async clickBannerCta(label) {
    const cta = this.page.locator(this.bannerCta).filter({ hasText: label }).first();
    await expect(cta).toBeVisible();
    await cta.click();
  }

  async dismissBanner(downtimeId) {
    await this.page.locator(`${this.bannerDismiss}[data-test*="${downtimeId}"]`).first().click();
    await expect(this.bannerById(downtimeId)).toHaveCount(0, { timeout: 10000 });
  }

  // ------------------------------------------------------------------ synthetics list

  async gotoSynthetics() {
    await this.page.goto(`/web/synthetic-monitoring?org_identifier=${ORG()}`);
    await expect(this.page.locator(`[data-test="${this.syntheticsTable}"]`)).toBeVisible({ timeout: 30000 });
  }

  /** The synthetics row ⋯ is not unique per row, so scope it to the row holding the check name. */
  syntheticsRow(name) {
    return this.page.locator(`[data-test="${this.syntheticsTable}"]`).locator(this.tableRow).filter({ hasText: name });
  }

  async expectSyntheticMuted(checkId, muted = true) {
    const chip = this.page.locator(`[data-test="${this.syntheticsTable}-${checkId}-muted"]`);
    if (muted) await expect(chip).toBeVisible({ timeout: 20000 });
    else await expect(chip).toHaveCount(0);
  }

  async muteSyntheticRow(name, preset) {
    await this.syntheticsRow(name).locator(`[data-test="${this.syntheticsTable}-more-btn"]`).click();
    await this.page.locator(`[data-test="${this.syntheticsTable}-mute-${preset}"]`).click();
  }
}

export default DowntimesPage;
