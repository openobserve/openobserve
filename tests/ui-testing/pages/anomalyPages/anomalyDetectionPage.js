// Copyright 2026 OpenObserve Inc.

/** Anomaly detection is an alert TYPE, not a module: list actions reuse the shared `alert-list-*` hooks and only the wizard body carries `anomaly-*` ones. */

const { expect } = require('@playwright/test');
const testLogger = require('../../playwright-tests/utils/test-logger.js');
const MonacoEditorHelper = require('../../playwright-tests/utils/MonacoEditorHelper.js');
const { cleanupTestAnomalies: apiCleanupTestAnomalies } = require('../../playwright-tests/utils/api-helper.js');

class AnomalyDetectionPage {
    /**
     * @param {import('@playwright/test').Page} page
     * @param {object} [commonActions]
     */
    constructor(page, commonActions) {
        this.page = page;
        this.commonActions = commonActions;
        this.monaco = new MonacoEditorHelper(page);

        this.selectors = {
            // Navigation
            alertsMenuLink: '[data-test="menu-link-\\/alerts-item"]',
            // OToggleGroupItem in AlertList.vue renders `alert-list-tab-<value>`.
            // The tab is only in `alertTabs` when zoConfig.anomaly_detection_enabled
            // is true, so its presence IS the feature check — do not probe the
            // ?tab= query param, which AlertList never rewrites on fallback.
            anomalyTab: '[data-test="alert-list-tab-anomalyDetection"]',
            listPage: '[data-test="alert-list-page"]',
            // Anomalies share the alert table; there is no anomaly-specific one.
            listTable: '[data-test="alert-list-table"]',
            addBtn: '[data-test="alert-list-add-alert-btn"]',
            searchInput: '[data-test="alert-list-search-input"]',

            // Wizard topbar
            // OFormInlineEdit: click -trigger to reveal -input; -error carries
            // the validation message.
            nameTrigger: '[data-test="add-anomaly-name-input-trigger"]',
            nameInput: '[data-test="add-anomaly-name-input-input"]',
            nameValue: '[data-test="add-anomaly-name-input-value"]',
            nameError: '[data-test="add-anomaly-name-input-error"]',
            streamTypeSelect: '[data-test="add-alert-stream-type-select-dropdown"]',
            streamNameSelect: '[data-test="add-alert-stream-name-select-dropdown"]',

            // Wizard chrome
            saveBtn: '[data-test="add-alert-submit-btn"]',
            cancelBtn: '[data-test="add-alert-cancel-btn"]',
            configTab: '[data-test="add-alert-tab-anomaly-config"]',
            alertingTab: '[data-test="add-alert-tab-anomaly-alerting"]',

            // Detection config step
            queryTabs: '[data-test="anomaly-query-tabs"]',
            filterRow: '[data-test="anomaly-filter-row"]',
            filterRowRemove: '[data-test="anomaly-filter-row-remove"]',
            filterAdd: '[data-test="anomaly-filter-add"]',
            customSql: '[data-test="anomaly-custom-sql"]',
            customSqlRequiredError: '[data-test="anomaly-custom-sql-required-error"]',
            customSqlTimestampError: '[data-test="anomaly-custom-sql-timestamp-alias-error"]',
            detectionFunction: '[data-test="anomaly-detection-function"]',
            detectionFunctionField: '[data-test="anomaly-detection-function-field"]',
            histogramIntervalValue: '[data-test="anomaly-histogram-interval-value"]',
            histogramIntervalUnit: '[data-test="anomaly-histogram-interval-unit"]',
            histogramIntervalError: '[data-test="anomaly-histogram-interval-error"]',
            scheduleIntervalValue: '[data-test="anomaly-schedule-interval-value"]',
            scheduleIntervalUnit: '[data-test="anomaly-schedule-interval-unit"]',
            scheduleIntervalError: '[data-test="anomaly-schedule-interval-error"]',
            detectionWindowValue: '[data-test="anomaly-detection-window-value"]',
            detectionWindowUnit: '[data-test="anomaly-detection-window-unit"]',
            detectionWindowError: '[data-test="anomaly-detection-window-error"]',
            trainingWindow: '[data-test="anomaly-training-window"]',
            retrainInterval: '[data-test="anomaly-retrain-interval"]',
            sensitivityTier: '[data-test="anomaly-sensitivity-tier"]',
            sensitivityPercentile: '[data-test="anomaly-sensitivity-percentile"]',
            sensitivityError: '[data-test="anomaly-sensitivity-error"]',
            sensitivityHint: '[data-test="anomaly-sensitivity-hint"]',
            sqlPreview: '[data-test="anomaly-sql-preview"]',

            // Alerting step
            prioritySelect: '[data-test="anomaly-priority-select"]',
            tagsInput: '[data-test="anomaly-tags-input"]',
            alertEnabled: '[data-test="anomaly-alert-enabled"]',
            destination: '[data-test="anomaly-destination"]',
            destinationError: '[data-test="anomaly-destination-error"]',
            refreshDestinations: '[data-test="anomaly-refresh-destinations"]',

            // Right rail
            dataPreviewChart: '[data-test="anomaly-data-preview-chart"]',
            dataPreviewEmpty: '[data-test="anomaly-data-preview-empty"]',
            summaryScrollBtn: '[data-test="anomaly-summary-scroll-btn"]',

            // Detection charts (AlertDetail)
            detectionCharts: '[data-test="alerts-anomalydetectionchart"]',
            detectionChartsRange: '[data-test="alerts-anomalydetectionchart-range"]',

            toast: '[data-test="o-toast-message"]',
            toastDismiss: '[data-test="o-toast-dismiss"]',

            // Row-scoped hooks (shared alert-list family)
            rowName: (name) => `[data-test="alert-list-${name}-name-cell"]`,
            rowEdit: (name) => `[data-test="alert-list-${name}-update-alert"]`,
            rowDelete: (name) => `[data-test="alert-list-${name}-delete-alert"]`,
            rowClone: (name) => `[data-test="alert-list-${name}-clone-alert"]`,
            rowPause: (name) => `[data-test="alert-list-${name}-pause-start-alert"]`,
            rowMoreOptions: (name) => `[data-test="alert-list-${name}-more-options"]`,
            rowTriggerDetection: (name) => `[data-test="alert-list-${name}-trigger-detection"]`,
            rowRetrain: (name) => `[data-test="alert-list-${name}-retrain-anomaly"]`,

            sensitivityTierItem: (pct) => `[data-test="anomaly-sensitivity-tier-${pct}"]`,
            queryTab: (mode) => `[data-test="anomaly-query-tab-${mode}"]`,
            filterField: (idx) => `[data-test="anomaly-filter-field-${idx}"]`,
            filterOperator: (idx) => `[data-test="anomaly-filter-operator-${idx}"]`,
            filterValue: (idx) => `[data-test="anomaly-filter-value-${idx}"]`,
            chartRangeItem: (v) => `[data-test="alerts-anomalydetectionchart-range-${v}"]`,
            chartPanel: (key) => `[data-test="alerts-anomalydetectionchart-${key}"]`,
            chartPanelBody: (key) => `[data-test="alerts-anomalydetectionchart-${key}-panel"]`,
            chartPanelEmpty: (key) => `[data-test="alerts-anomalydetectionchart-${key}-empty"]`,
        };
    }

    // Navigation & feature availability

    /**
     * True when the build/backend exposes anomaly detection.
     *
     * AlertList silently coerces activeTab back to "all" when the feature is
     * off but LEAVES ?tab=anomalyDetection in the URL, so reading the query
     * param back is a tautology. The rendered tab is the only honest signal.
     */
    async isAnomalyDetectionAvailable() {
        await this.page.locator(this.selectors.alertsMenuLink).click();
        await this.page.locator(this.selectors.listPage).waitFor({ state: 'visible', timeout: 30000 });
        const visible = await this.page
            .locator(this.selectors.anomalyTab)
            .waitFor({ state: 'visible', timeout: 5000 })
            .then(() => true)
            .catch(() => false);
        testLogger.info('Anomaly detection availability', { visible });
        return visible;
    }

    async navigateToAnomalyTab() {
        await this.page.locator(this.selectors.alertsMenuLink).click();
        await this.page.locator(this.selectors.listPage).waitFor({ state: 'visible', timeout: 30000 });
        const tab = this.page.locator(this.selectors.anomalyTab);
        await tab.waitFor({ state: 'visible', timeout: 15000 });
        await tab.click();
        await expect(tab).toHaveAttribute('data-state', 'on', { timeout: 10000 });
        await this.page.locator(this.selectors.listTable).waitFor({ state: 'visible', timeout: 30000 });
        testLogger.info('Anomaly Detection tab loaded');
    }

    /**
     * Open the Add wizard.
     *
     * The Add button renders disabled until the org's destinations have loaded,
     * so clicking on sight is a race: the click lands on a dead button and the
     * wizard never opens.
     */
    async openAddAnomalyWizard() {
        const addBtn = this.page.locator(this.selectors.addBtn);
        await expect(addBtn).toBeEnabled({ timeout: 30000 });
        await addBtn.click();
        await this.page.locator(this.selectors.streamTypeSelect).waitFor({ state: 'visible', timeout: 15000 });
        testLogger.info('Add Anomaly wizard opened');
    }

    // Shared O2 control drivers

    /**
     * Narrow a just-opened OSelect popover to `term`.
     *
     * Searchable OSelects render their options through a virtual list, so an
     * option outside the rendered window is absent from the DOM entirely and no
     * amount of waiting will surface it. Typing into the filter is the only way
     * to reach one reliably once an org has accumulated rows.
     */
    async _filterOpenSelect(dataTest, term) {
        const search = this.page.locator(`[data-test="${dataTest}-search"]`);
        if (await search.count()) {
            await search.fill(String(term));
        }
    }

    /**
     * Pick an OSelect option by its underlying value.
     *
     * OSelect stamps data-test-value on each option, so matching on the value
     * survives translation of the visible label.
     */
    async selectOptionByValue(selectSelector, value) {
        const dataTest = this._dataTestOf(selectSelector);
        await this.page.locator(`${selectSelector} [data-test$="-trigger"]`).click();
        await this._filterOpenSelect(dataTest, value);
        const option = this.page.locator(
            `[data-test="${dataTest}-option"][data-test-value="${value}"]`,
        );
        await option.waitFor({ state: 'visible', timeout: 10000 });
        await option.click();
    }

    /** Pick an OSelect option by its rendered label (use when the value is opaque). */
    async selectOptionByLabel(selectSelector, label) {
        const dataTest = this._dataTestOf(selectSelector);
        await this.page.locator(`${selectSelector} [data-test$="-trigger"]`).click();
        await this._filterOpenSelect(dataTest, label);
        const option = this.page
            .locator(`[data-test="${dataTest}-option"]`)
            .filter({ hasText: label })
            .first();
        await option.waitFor({ state: 'visible', timeout: 10000 });
        await option.click();
    }

    /** Extract the bare data-test value out of a `[data-test="x"]` selector. */
    _dataTestOf(selector) {
        const match = selector.match(/\[data-test="([^"]+)"\]/);
        if (!match) throw new Error(`Not a data-test selector: ${selector}`);
        return match[1];
    }

    /** Fill the inner input of an OFormInput (OInput suffixes it with -field). */
    async fillFormInput(selector, value) {
        const input = this.page.locator(`${selector} [data-test$="-field"]`).first();
        await input.waitFor({ state: 'visible', timeout: 10000 });
        await input.fill(String(value));
        await input.blur();
    }

    async getFormInputValue(selector) {
        return this.page.locator(`${selector} [data-test$="-field"]`).first().inputValue();
    }

    // Wizard topbar

    /** OFormInlineEdit renders as text until its trigger is clicked. */
    async fillAnomalyName(name) {
        const trigger = this.page.locator(this.selectors.nameTrigger);
        if (await trigger.isVisible({ timeout: 3000 }).catch(() => false)) {
            await trigger.click();
        }
        const input = this.page.locator(this.selectors.nameInput);
        await input.waitFor({ state: 'visible', timeout: 10000 });
        await input.fill(name);
        // Blur, never Enter: OInlineEdit commits on both, but Enter also SUBMITS
        // the owning form, which runs a premature save and leaves a 30s error
        // toast covering the wizard footer for every step that follows.
        await input.blur();
        await expect(this.page.locator(this.selectors.nameValue)).toContainText(name, {
            timeout: 10000,
        });
        testLogger.info('Filled anomaly name', { name });
    }

    async selectStreamType(streamType = 'logs') {
        await this.selectOptionByValue(this.selectors.streamTypeSelect, streamType);
    }

    async selectStreamName(streamName) {
        await this.selectOptionByValue(this.selectors.streamNameSelect, streamName);
    }

    async fillBasicSetup(name, streamType, streamName) {
        await this.selectStreamType(streamType);
        await this.selectStreamName(streamName);
        await this.fillAnomalyName(name);
    }

    // Wizard tabs

    async openConfigTab() {
        await this.page.locator(this.selectors.configTab).click();
        await this.page.locator(this.selectors.queryTabs).waitFor({ state: 'visible', timeout: 10000 });
    }

    async openAlertingTab() {
        await this.page.locator(this.selectors.alertingTab).click();
        await this.page.locator(this.selectors.alertEnabled).waitFor({ state: 'visible', timeout: 10000 });
    }

    // Detection config

    /**
     * Select the query mode.
     *
     * Per-item data-tests landed with the anomaly revamp; on builds without
     * them the toggle items are reachable only by their label, so fall back to
     * that rather than failing on an older deployment.
     *
     * @param {'filters'|'custom_sql'} mode
     */
    async selectQueryMode(mode) {
        const tab = this.page.locator(this.selectors.queryTab(mode));
        if (await tab.count()) {
            await tab.click();
            await expect(tab).toHaveAttribute('data-state', 'on', { timeout: 5000 });
            return;
        }
        const label = mode === 'custom_sql' ? 'SQL' : 'Builder';
        const legacyTab = this.page
            .locator(`${this.selectors.queryTabs} button`)
            .filter({ hasText: label })
            .first();
        await legacyTab.click();
        await expect(legacyTab).toHaveAttribute('data-state', 'on', { timeout: 5000 });
    }

    /**
     * Replace the SQL editor's contents.
     *
     * Monaco's select-all only lands once the editor has focus, and that is
     * racy right after the pane renders — a missed clear types the new query in
     * FRONT of the seeded default and the save dies on a parser error. So clear
     * until the editor is verifiably empty, then type.
     */
    async setCustomSql(sql) {
        const container = this.page.locator(this.selectors.customSql);
        await container.waitFor({ state: 'visible', timeout: 15000 });
        await this.clearCustomSql();
        await this.monaco.type(container, sql);
    }

    /** Empty the SQL editor, confirming it actually emptied. */
    async clearCustomSql() {
        const container = this.page.locator(this.selectors.customSql);
        await container.waitFor({ state: 'visible', timeout: 15000 });
        for (let attempt = 1; attempt <= 5; attempt++) {
            // Click the editor body first: select-all is a no-op until Monaco
            // actually holds focus, and under parallel load that lags the
            // element being visible.
            await container.locator('.monaco-editor').first().click({ force: true });
            await this.page.waitForTimeout(200 * attempt);
            await this.monaco.clear(container);
            const left = ((await this.monaco.getContent(container)) || '').replace(/\s|\u00a0/g, '');
            if (left === '') return;
            testLogger.warn('Monaco clear did not take; retrying', { attempt, left });
        }
        throw new Error('Could not clear the SQL editor after 5 attempts');
    }


    async getSqlPreviewText() {
        return this.monaco.getContent(this.page.locator(this.selectors.sqlPreview));
    }

    async selectDetectionFunction(fn) {
        await this.selectOptionByValue(this.selectors.detectionFunction, fn);
    }

    async selectDetectionFunctionField(field) {
        await this.selectOptionByValue(this.selectors.detectionFunctionField, field);
    }

    /** @param {'m'|'h'} unit */
    async setHistogramInterval(value, unit = 'm') {
        await this.fillFormInput(this.selectors.histogramIntervalValue, value);
        await this.selectOptionByValue(this.selectors.histogramIntervalUnit, unit);
    }

    /** @param {'m'|'h'} unit */
    async setScheduleInterval(value, unit = 'm') {
        await this.fillFormInput(this.selectors.scheduleIntervalValue, value);
        await this.selectOptionByValue(this.selectors.scheduleIntervalUnit, unit);
    }

    /** @param {'m'|'h'} unit */
    async setDetectionWindow(value, unit = 'h') {
        await this.fillFormInput(this.selectors.detectionWindowValue, value);
        await this.selectOptionByValue(this.selectors.detectionWindowUnit, unit);
    }

    /** Blank the resolution field, to exercise a mid-edit invalid interval. */
    async clearHistogramInterval() {
        await this.fillFormInput(this.selectors.histogramIntervalValue, '');
    }

    async setTrainingWindow(days) {
        await this.fillFormInput(this.selectors.trainingWindow, days);
    }

    /** @param {0|1|7|14} days 0 means "Never". */
    async selectRetrainInterval(days) {
        await this.selectOptionByValue(this.selectors.retrainInterval, days);
    }

    // Filters

    getFilterRows() {
        return this.page.locator(this.selectors.filterRow);
    }

    /**
     * Append one filter row. Value is skipped for Is Null / Is Not Null, whose
     * value input is not rendered at all.
     */
    async addFilter(field, operator = '=', value = null) {
        const before = await this.getFilterRows().count();
        await this.page.locator(this.selectors.filterAdd).click();
        await expect(this.getFilterRows()).toHaveCount(before + 1, { timeout: 10000 });

        const idx = before;
        await this.selectOptionByValue(this.selectors.filterField(idx), field);
        if (operator !== '=') {
            await this.selectOptionByValue(this.selectors.filterOperator(idx), operator);
        }
        if (value !== null) {
            await this.fillFormInput(this.selectors.filterValue(idx), value);
        }
        testLogger.info('Added filter', { field, operator, value });
    }

    async removeFilter(index = 0) {
        await this.page.locator(this.selectors.filterRowRemove).nth(index).click();
    }

    // Sensitivity

    /**
     * Pick a sensitivity tier.
     *
     * The tier toggle arrived with the anomaly revamp; builds before it expose a
     * plain threshold slider instead. Left at its default there so the flows
     * that merely pass through this step still run.
     *
     * @param {95|97|99} percentile
     * @returns {Promise<boolean>} whether the tier control was present
     */
    async selectSensitivityTier(percentile) {
        const tier = this.page.locator(this.selectors.sensitivityTierItem(percentile));
        if (!(await tier.count())) {
            testLogger.info('Sensitivity tiers absent on this build; keeping the default threshold');
            return false;
        }
        await tier.click();
        return true;
    }

    /** True when the build exposes the revamped tier/percentile sensitivity controls. */
    async hasSensitivityTiers() {
        return (await this.page.locator(this.selectors.sensitivityTier).count()) > 0;
    }

    /** Tier toggle and percentile input share the `threshold` field. */
    async setSensitivityPercentile(percentile) {
        await this.fillFormInput(this.selectors.sensitivityPercentile, percentile);
    }

    async getSensitivityPercentile() {
        return this.getFormInputValue(this.selectors.sensitivityPercentile);
    }

    async getActiveSensitivityTier() {
        const active = this.page.locator(
            `${this.selectors.sensitivityTier} [data-state="on"]`,
        );
        if ((await active.count()) === 0) return null;
        const dataTest = await active.first().getAttribute('data-test');
        return dataTest ? Number(dataTest.replace('anomaly-sensitivity-tier-', '')) : null;
    }

    getSensitivityHintLocator() {
        return this.page.locator(this.selectors.sensitivityHint);
    }

    getSensitivityErrorLocator() {
        return this.page.locator(this.selectors.sensitivityError);
    }

    // Alerting step

    /** @param {1|2|3|4|5} priority */
    async selectPriority(priority) {
        await this.selectOptionByValue(this.selectors.prioritySelect, priority);
    }

    async addTags(tags) {
        const input = this.page.locator(`${this.selectors.tagsInput} input`).first();
        await input.waitFor({ state: 'visible', timeout: 10000 });
        for (const tag of tags) {
            await input.fill(tag);
            await input.press('Enter');
        }
    }

    /**
     * Set the notifications switch to `enabled`.
     *
     * OSwitch toggles from a click handler on its WRAPPER, not on the inner
     * role=switch button, so a click on the button is not self-evidently a
     * state change. Assert the end state — silently leaving this on makes the
     * save fail much later with "At least one destination is required".
     */
    async toggleNotifications(enabled) {
        const root = this.page.locator(this.selectors.alertEnabled);
        const sw = root.locator('[role="switch"]');
        await sw.waitFor({ state: 'visible', timeout: 10000 });
        if (((await sw.getAttribute('aria-checked')) === 'true') === enabled) return;
        await root.click();
        await expect(sw).toHaveAttribute('aria-checked', String(enabled), { timeout: 5000 });
    }

    /**
     * Destination is a searchable multi-select, so the popover stays open
     * between picks and each name has to be filtered for in turn — the list is
     * virtualized and an org accumulates far more destinations than it renders.
     */
    async selectDestinations(names) {
        await this.page.locator(`${this.selectors.destination} [data-test$="-trigger"]`).click();
        for (const name of names) {
            await this._filterOpenSelect('anomaly-destination', name);
            const option = this.page.locator(
                `[data-test="anomaly-destination-option"][data-test-value="${name}"]`,
            );
            await option.waitFor({ state: 'visible', timeout: 10000 });
            await option.click();
        }
        await this.page.keyboard.press('Escape');
    }

    /** Falls back to the button's title on builds predating its data-test. */
    async refreshDestinations() {
        const btn = this.page.locator(this.selectors.refreshDestinations);
        if (await btn.count()) {
            await btn.click();
            return;
        }
        await this.page
            .locator('.step-anomaly-alerting button[title="Refresh latest Destinations"]')
            .first()
            .click();
    }

    getDestinationErrorLocator() {
        return this.page.locator(this.selectors.destinationError);
    }

    // Save / cancel

    async save() {
        await this.page.locator(this.selectors.saveBtn).click();
    }

    /**
     * Save and prove it landed.
     *
     * Without this the create tests navigate away regardless and a rejected
     * save shows up much later as a missing table row, which says nothing about
     * why. Failing here surfaces the actual validation toast instead.
     */
    async saveAndExpectSuccess() {
        await this.save();
        const failure = this.getToastLocator(/error|fail|fix the highlighted fields|required/i);
        const saveBtn = this.page.locator(this.selectors.saveBtn);
        // Race the two outcomes so a rejection is reported in the toast's own
        // words rather than as a later, meaningless "row not found".
        const outcome = await Promise.race([
            failure
                .first()
                .waitFor({ state: 'visible', timeout: 30000 })
                .then(() => 'rejected')
                .catch(() => null),
            saveBtn
                .waitFor({ state: 'hidden', timeout: 30000 })
                .then(() => 'saved')
                .catch(() => null),
        ]);
        if (outcome === 'rejected') {
            throw new Error(`Save was rejected: ${(await failure.first().innerText()).trim()}`);
        }
        if (outcome !== 'saved') {
            throw new Error('Save neither completed nor reported an error');
        }
    }

    /**
     * Error toasts live 30s and stack over the wizard footer, where they
     * intercept the click meant for Cancel. Best-effort: the dismiss hook is
     * absent on older builds, so callers must not depend on this clearing them.
     */
    async dismissToasts() {
        const closers = this.page.locator(this.selectors.toastDismiss);
        try {
            for (let i = await closers.count(); i > 0; i = await closers.count()) {
                await closers.first().click({ timeout: 3000 });
                await expect(closers).toHaveCount(i - 1, { timeout: 3000 });
            }
        } catch {
            testLogger.info('Toast dismiss unavailable; falling back to a forced click');
        }
    }

    /**
     * Cancel is teardown, not an assertion: a toast still covering the footer
     * must not fail a test that already proved its point, so the click is
     * forced past any overlay once the dismiss attempt is done.
     */
    async cancel() {
        await this.dismissToasts();
        const btn = this.page.locator(this.selectors.cancelBtn);
        await btn.waitFor({ state: 'visible', timeout: 15000 });
        await btn.click({ force: true });
    }

    getStreamTypeSelectLocator() { return this.page.locator(this.selectors.streamTypeSelect); }
    getListTableLocator() { return this.page.locator(this.selectors.listTable); }
    getCustomSqlTimestampErrorLocator() { return this.page.locator(this.selectors.customSqlTimestampError); }
    getCustomSqlRequiredErrorLocator() { return this.page.locator(this.selectors.customSqlRequiredError); }
    getDetectionFunctionFieldLocator() { return this.page.locator(this.selectors.detectionFunctionField); }
    getSqlPreviewLocator() { return this.page.locator(this.selectors.sqlPreview); }
    getTagsInputLocator() { return this.page.locator(this.selectors.tagsInput); }
    getDestinationLocator() { return this.page.locator(this.selectors.destination); }
    getNameValueLocator() { return this.page.locator(this.selectors.nameValue); }

    /** The OSelect trigger, which carries the selected label. */
    getPriorityTriggerLocator() {
        return this.page.locator(`${this.selectors.prioritySelect} [data-test$="-trigger"]`);
    }

    /** @param {'1h'|'6h'|'24h'} range */
    getChartRangeItemLocator(range) {
        return this.page.locator(this.selectors.chartRangeItem(range));
    }

    getSaveBtnLocator() {
        return this.page.locator(this.selectors.saveBtn);
    }

    getNameErrorLocator() {
        return this.page.locator(this.selectors.nameError);
    }

    /**
     * Toast node narrowed by text.
     *
     * Toasts stack and error toasts live 30s, so an unrelated earlier toast is
     * very likely still on screen; the bare selector would trip strict mode.
     */
    getToastLocator(hasText) {
        return this.page.locator(this.selectors.toast).filter({ hasText });
    }

    // Right rail — data preview & summary

    getDataPreviewChartLocator() {
        return this.page.locator(this.selectors.dataPreviewChart);
    }

    getDataPreviewEmptyLocator() {
        return this.page.locator(this.selectors.dataPreviewEmpty);
    }

    /** The preview debounces edits by 600ms, so allow for that plus the query. */
    async waitForDataPreview(timeout = 30000) {
        await this.getDataPreviewChartLocator().waitFor({ state: 'visible', timeout });
    }

    // List row actions

    getRow(name) {
        return this.page.locator(this.selectors.rowName(name));
    }

    /** OInput puts the real <input> behind a -field suffix; the wrapper is a div. */
    async searchAnomaly(name) {
        await this.fillFormInput(this.selectors.searchInput, name);
        await this.page.waitForTimeout(1000);
    }

    async openEdit(name) {
        await this.page.locator(this.selectors.rowEdit(name)).click();
        await this.page.locator(this.selectors.saveBtn).waitFor({ state: 'visible', timeout: 15000 });
    }

    async openDetail(name) {
        await this.page.locator(this.selectors.rowName(name)).click();
    }

    async togglePause(name) {
        await this.page.locator(this.selectors.rowPause(name)).click();
    }

    async triggerDetection(name) {
        await this.page.locator(this.selectors.rowMoreOptions(name)).click();
        await this.page.locator(this.selectors.rowTriggerDetection(name)).click();
    }

    async retrain(name) {
        await this.page.locator(this.selectors.rowMoreOptions(name)).click();
        await this.page.locator(this.selectors.rowRetrain(name)).click();
    }

    /** Delete lives in the row's overflow menu, not on the row itself. */
    async deleteAnomaly(name) {
        await this.page.locator(this.selectors.rowMoreOptions(name)).click();
        await this.page.locator(this.selectors.rowDelete(name)).click();
        const confirm = this.page.locator(
            '[data-test="confirm-dialog"] [data-test="o-dialog-primary-btn"]',
        );
        await confirm.waitFor({ state: 'visible', timeout: 10000 });
        await confirm.click();
    }

    // Detection charts (AlertDetail)

    getDetectionChartsLocator() {
        return this.page.locator(this.selectors.detectionCharts);
    }

    /** @param {'metric'|'score'|'deviation'} key */
    getChartPanelLocator(key) {
        return this.page.locator(this.selectors.chartPanel(key));
    }

    /** @param {'metric'|'score'|'deviation'} key */
    getChartBodyLocator(key) {
        return this.page.locator(this.selectors.chartPanelBody(key));
    }

    /** @param {'metric'|'score'|'deviation'} key */
    getChartEmptyLocator(key) {
        return this.page.locator(this.selectors.chartPanelEmpty(key));
    }

    async selectChartRange(value) {
        const range = this.page.locator(this.selectors.detectionChartsRange);
        await range.waitFor({ state: 'visible', timeout: 15000 });
        await this.page.locator(this.selectors.chartRangeItem(value)).click();
    }

    // Cleanup

    /**
     * Delete every anomaly whose name contains `pattern`, via the API.
     *
     * Used from afterAll where there is no signed-in UI session to drive; the
     * helper authenticates from env vars.
     */
    async cleanupTestAnomalies(pattern) {
        try {
            const deleted = await apiCleanupTestAnomalies(this.page, pattern);
            testLogger.info('Cleaned up test anomalies', { pattern, deleted });
            return deleted;
        } catch (e) {
            testLogger.warn('API cleanup failed', { pattern, error: e.message });
            return 0;
        }
    }

    /** Best-effort teardown — a missing row is not a failure. */
    async cleanupAnomaly(name) {
        try {
            await this.navigateToAnomalyTab();
            await this.searchAnomaly(name);
            if (await this.getRow(name).isVisible({ timeout: 3000 }).catch(() => false)) {
                await this.deleteAnomaly(name);
                testLogger.info('Cleaned up anomaly', { name });
            }
        } catch (e) {
            testLogger.warn('Cleanup failed', { name, error: e.message });
        }
    }
}

module.exports = { AnomalyDetectionPage };
