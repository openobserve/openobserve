import { expect } from '@playwright/test';
const testLogger = require('../../playwright-tests/utils/test-logger.js');

export class CrossLinkPage {
    constructor(page) {
        this.page = page;

        // Navigation selectors
        this.streamsMenuItem = '[data-test="menu-link-\\/streams-item"]';
        this.streamSearchPlaceholder = 'Search Stream';
        this.streamDetailButton = 'Stream Detail';

        // CrossLinkManager selectors (VERIFIED from CrossLinkManager.vue)
        this.addCrossLinkBtn = '[data-test="add-cross-link-btn"]';
        this.crossLinkList = '[data-test="cross-link-list"]';
        this.crossLinkEmpty = '[data-test="cross-link-empty"]';

        // CrossLinkDialog selectors (VERIFIED from CrossLinkDialog.vue)
        // CrossLinkDialog is rendered via <ODialog data-test="cross-link-dialog" ...>.
        // After the ODialog migration the in-dialog Save/Cancel buttons were
        // removed and replaced by ODialog's built-in primary/secondary footer
        // buttons. Scope by the parent data-test to avoid matching other dialogs.
        this.crossLinkDialog = '[data-test="cross-link-dialog"]';
        // CrossLinkDialog renders the Name/URL fields through OInput, which forwards
        // the consumer-supplied data-test onto the inner <input> as `${parent}-field`.
        // Filling the wrapper div fails (not an <input>), so target the -field hook.
        this.crossLinkNameInput = '[data-test="cross-link-name-input-field"]';
        this.crossLinkUrlInput = '[data-test="cross-link-url-input-field"]';
        // Field input is an OSelect (or fallback OInput) — its wrapper holds the data-test.
        this.crossLinkFieldInput = '[data-test="cross-link-field-input"]';
        this.crossLinkAddFieldBtn = '[data-test="cross-link-add-field-btn"]';
        this.crossLinkCancelBtn = '[data-test="cross-link-dialog"] [data-test="o-dialog-secondary-btn"]';
        this.crossLinkSaveBtn = '[data-test="cross-link-dialog"] [data-test="o-dialog-primary-btn"]';
        this.crossLinkHelpBtn = '[data-test="cross-link-help-btn"]';

        // Schema update button
        this.schemaUpdateSettingsBtn = '[data-test="schema-update-settings-button"]';

        // Organization Settings page selectors
        this.settingsMenuItem = '[data-test="menu-link-/settings-item"]';
        this.orgSettingsSaveBtn = '[data-test="add-alert-submit-btn"]';

        // Logs result-table expand toggle — kept as a Locator class member so
        // callers don't reach into raw `page.locator(...)` from the spec.
        this.firstLogRowExpand = page
            .locator('[data-test="table-row-expand-menu"]')
            .first();
    }

    // Dynamic selectors
    crossLinkItem(idx) {
        return `[data-test="cross-link-item-${idx}"]`;
    }

    crossLinkItemName(idx) {
        return `[data-test="cross-link-item-name-${idx}"]`;
    }

    crossLinkItemUrl(idx) {
        return `[data-test="cross-link-item-url-${idx}"]`;
    }

    crossLinkEditBtn(idx) {
        return `[data-test="cross-link-edit-${idx}"]`;
    }

    crossLinkDeleteBtn(idx) {
        return `[data-test="cross-link-delete-${idx}"]`;
    }

    crossLinkFieldChip(idx) {
        return `[data-test="cross-link-field-chip-${idx}"]`;
    }

    logDetailRow(fieldName) {
        return `[data-test="log-detail-row-${fieldName}"]`;
    }

    logDetailsCrossLinkMenuItem(crossLinkName) {
        return `[data-test="log-details-cross-link-${crossLinkName}"]`;
    }

    // Navigation methods
    async navigateToStreams() {
        testLogger.debug('Navigating to streams page via URL');
        const orgId = process.env["ORGNAME"] || 'default';
        await this.page.goto(`${process.env["ZO_BASE_URL"] || 'http://localhost:5080'}/web/streams?org_identifier=${orgId}`);
        await this.page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
        await this.page.waitForTimeout(2000);
    }

    async searchStream(streamName) {
        testLogger.debug('Searching for stream', { streamName });
        // Resolve the search input via its dedicated data-test wrapper
        // (see LogStream.vue: data-test="streams-search-stream-input").
        const wrapper = this.page.locator('[data-test="streams-search-stream-input"]');
        await wrapper.waitFor({ state: 'visible', timeout: 10000 });
        const inputInside = this.page.locator('[data-test="streams-search-stream-input"] input');
        await inputInside.click();
        await inputInside.fill(streamName);
        await this.page.waitForTimeout(1500);
    }

    async openStreamDetail() {
        testLogger.debug('Opening stream details');
        // Resolve the schema/Stream Detail action button via its data-test
        // (see LogStream.vue: data-test="log-stream-schema-btn").
        const btn = this.page.locator('[data-test="log-stream-schema-btn"]').first();
        await btn.waitFor({ state: 'visible', timeout: 15000 });
        await btn.click();
        // Wait for the schema panel dialog to fully render with tabs
        await this.page.waitForTimeout(3000);
    }

    async isCrossLinkingTabVisible() {
        testLogger.debug('Checking if cross-linking tab is visible');
        const tab = this.page.locator('[data-test="schema-cross-linking-tab"]');
        try {
            await tab.waitFor({ state: 'visible', timeout: 5000 });
            return true;
        } catch {
            return false;
        }
    }

    async clickCrossLinkingTab() {
        testLogger.debug('Clicking cross-linking tab');
        const tab = this.page.locator('[data-test="schema-cross-linking-tab"]');
        await tab.waitFor({ state: 'visible', timeout: 10000 });
        await tab.click();
        // Wait for cross-link tab content to render
        await this.page.waitForTimeout(2000);
    }

    // CrossLinkManager methods
    async clickAddCrossLink() {
        testLogger.debug('Clicking add cross-link button');
        await this.page.locator(this.addCrossLinkBtn).click();
    }

    async expectEmptyState() {
        testLogger.debug('Expecting empty state');
        await expect(this.page.locator(this.crossLinkEmpty)).toBeVisible();
    }

    async expectCrossLinkListVisible() {
        testLogger.debug('Expecting cross-link list visible');
        await expect(this.page.locator(this.crossLinkList).first()).toBeVisible();
    }

    async expectCrossLinkItemVisible(idx) {
        // Stream-level and org-level CrossLinkManager both render the same
        // per-row data-test; scope to the first match (stream/editable list).
        await expect(this.page.locator(this.crossLinkItem(idx)).first()).toBeVisible();
    }

    async clickEditCrossLink(idx) {
        testLogger.debug('Clicking edit cross-link', { idx });
        await this.page.locator(this.crossLinkEditBtn(idx)).first().click();
    }

    async clickDeleteCrossLink(idx) {
        testLogger.debug('Clicking delete cross-link', { idx });
        await this.page.locator(this.crossLinkDeleteBtn(idx)).first().click();
    }

    // CrossLinkDialog methods

    /**
     * Wait for the CrossLinkDialog to be fully visible and interactive.
     * Waits for the name input to appear, indicating the dialog has rendered.
     */
    async waitForDialog() {
        testLogger.debug('Waiting for cross-link dialog to render');
        await this.page.locator(this.crossLinkNameInput).waitFor({ state: 'visible', timeout: 15000 });
    }

    async fillCrossLinkName(name) {
        testLogger.debug('Filling cross-link name', { name });
        const input = this.page.locator(this.crossLinkNameInput);
        await input.click();
        await input.fill(name);
    }

    async fillCrossLinkUrl(url) {
        testLogger.debug('Filling cross-link URL', { url });
        const input = this.page.locator(this.crossLinkUrlInput);
        await input.click();
        await input.fill(url);
    }

    /**
     * Read the current value of the cross-link name input inside the dialog.
     * OInput exposes the fillable inner `<input>` via the `${parent}-field`
     * data-test (`cross-link-name-input-field`).
     */
    async getCrossLinkNameValue() {
        return this.page.locator(this.crossLinkNameInput).inputValue();
    }

    /**
     * Read the current value of the cross-link URL input inside the dialog.
     */
    async getCrossLinkUrlValue() {
        return this.page.locator(this.crossLinkUrlInput).inputValue();
    }

    async fillFieldInput(fieldName) {
        testLogger.debug('Filling field input', { fieldName });
        // CrossLinkDialog renders OCombobox (streams, with suggestions) or OInput
        // (org-level, no suggestions). OCombobox inner input uses the `-input` suffix;
        // OInput uses `-field`. Match whichever is present.
        const inputField = this.page.locator('[data-test="cross-link-field-input-input"], [data-test="cross-link-field-input-field"]');
        await inputField.waitFor({ state: 'visible', timeout: 10000 });
        await inputField.click();
        await inputField.fill(fieldName);
    }

    async clickAddFieldBtn() {
        testLogger.debug('Clicking add field button');
        await this.page.locator(this.crossLinkAddFieldBtn).click();
    }

    async addField(fieldName) {
        testLogger.debug('Adding field', { fieldName });
        await this.fillFieldInput(fieldName);
        // The dialog's "+ Add" button always reads the current `newFieldName`
        // (kept in sync by OCombobox's @update:model-value on each typed
        // character) and commits the chip via the dialog's `addField`. This
        // works for both free-text and listbox-picked values without
        // depending on Enter propagating through reka-ui's portal layout —
        // suite mode previously raced the Enter-bubbling path. The popover
        // overlay sits BELOW the add button in z-order, so clicking it is
        // safe even while the popover is open.
        await this.clickAddFieldBtn();
        await this.page.waitForTimeout(300);
    }

    async expectFieldChipVisible(idx) {
        // CrossLinkManager emits `cross-link-field-chip-<idx>` on the badges
        // inside each list item AND inside the open dialog — scope to the
        // dialog so the "is the user's just-added chip visible inside the
        // open form" assertion isn't confused by chips already rendered in
        // the existing cross-link list.
        await expect(
            this.page.locator(
                `${this.crossLinkDialog} [data-test="cross-link-field-chip-${idx}"]`,
            ),
        ).toBeVisible({ timeout: 10000 });
    }

    async removeFieldChip(idx) {
        testLogger.debug('Removing field chip', { idx });
        // Scope the remove control to the dialog — the same data-test is
        // emitted on the badges inside each list item too.
        await this.page
            .locator(
                `${this.crossLinkDialog} [data-test="cross-link-field-chip-remove-${idx}"]`,
            )
            .click();
    }

    async clickSave() {
        testLogger.debug('Clicking save button');
        await this.page.locator(this.crossLinkSaveBtn).click();
    }

    async clickCancel() {
        testLogger.debug('Clicking cancel button');
        await this.page.locator(this.crossLinkCancelBtn).click();
    }

    async clickHelp() {
        testLogger.debug('Clicking help button');
        await this.page.locator(this.crossLinkHelpBtn).click();
    }

    async expectSaveDisabled() {
        testLogger.debug('Expecting save button disabled');
        await expect(this.page.locator(this.crossLinkSaveBtn)).toBeDisabled();
    }

    async expectSaveEnabled() {
        testLogger.debug('Expecting save button enabled');
        await expect(this.page.locator(this.crossLinkSaveBtn)).toBeEnabled();
    }

    async expectDialogVisible() {
        testLogger.debug('Expecting dialog visible');
        await this.waitForDialog();
    }

    async expectDialogNotVisible() {
        testLogger.debug('Expecting dialog not visible');
        await expect(this.page.locator(this.crossLinkDialog)).toBeHidden({ timeout: 5000 });
    }

    async clickUpdateSettings() {
        testLogger.debug('Clicking update settings button');
        await this.page.locator(this.schemaUpdateSettingsBtn).click();
        await this.page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    }

    // Composite workflows
    async navigateToStreamCrossLinkTab(streamName) {
        testLogger.debug('Navigating to stream cross-link tab', { streamName });
        await this.navigateToStreams();
        await this.searchStream(streamName);
        await this.openStreamDetail();
        await this.clickCrossLinkingTab();
    }

    async addCrossLink({ name, url, fields = [] }) {
        testLogger.debug('Adding complete cross-link', { name, url, fields });
        await this.clickAddCrossLink();
        await this.expectDialogVisible();
        await this.fillCrossLinkName(name);
        await this.fillCrossLinkUrl(url);
        for (const field of fields) {
            await this.addField(field);
        }
        await this.clickSave();
    }

    async getCrossLinkItemText(idx) {
        // Both stream-level and org-level CrossLinkManager render their items
        // with the same `cross-link-item-<idx>` data-test. Scope to the FIRST
        // matching list (the stream-level / editable manager, which is the
        // primary surface the tests interact with). Org-level read-only chips
        // have their own per-name lookup via `findCrossLinkItemIndexByName`.
        return await this.page
            .locator(this.crossLinkItem(idx))
            .first()
            .textContent();
    }

    async getCrossLinkItemNameText(idx) {
        return await this.page.locator(this.crossLinkItemName(idx)).first().textContent();
    }

    async getCrossLinkItemUrlText(idx) {
        return await this.page.locator(this.crossLinkItemUrl(idx)).first().textContent();
    }

    async getFieldChipsCount(idx) {
        // Count the field chips rendered inside the first matching cross-link
        // item (scoped to the stream-level / editable list — the org-level
        // read-only manager also renders an item with the same idx).
        return await this.page
            .locator(this.crossLinkItem(idx))
            .first()
            .locator('[data-test^="cross-link-field-chip-"]')
            .count();
    }

    async getFieldChipText(itemIdx, chipIdx) {
        return await this.page
            .locator(this.crossLinkItem(itemIdx))
            .first()
            .locator(this.crossLinkFieldChip(chipIdx))
            .textContent();
    }

    /**
     * Read the text of a field chip rendered inside the CrossLinkDialog
     * (NOT scoped to any cross-link list item). Used during edit-pre-population
     * checks to confirm the dialog chips reflect the saved cross-link.
     */
    async getDialogFieldChipText(chipIdx) {
        return this.page
            .locator(
                `${this.crossLinkDialog} [data-test="cross-link-field-chip-${chipIdx}"]`,
            )
            .textContent();
    }

    /**
     * Find the cross-link item index by its name (by matching the item-name
     * data-test value). Returns -1 if not found.
     */
    async findCrossLinkItemIndexByName(name) {
        const names = await this.page
            .locator('[data-test^="cross-link-item-name-"]')
            .all();
        for (let i = 0; i < names.length; i++) {
            const txt = (await names[i].textContent()) || '';
            if (txt.includes(name)) {
                const attr = await names[i].getAttribute('data-test');
                const match = attr && attr.match(/cross-link-item-name-(\d+)/);
                if (match) return Number(match[1]);
            }
        }
        return -1;
    }

    /**
     * Wait for and click a cross-link option inside the JsonPreview field
     * action dropdown after opening the field's include/exclude dropdown.
     */
    async clickLogCrossLinkMenuItem(crossLinkName, timeout = 5000) {
        testLogger.debug('Clicking log cross-link menu item', { crossLinkName });
        const item = this.page.locator(this.logDetailsCrossLinkMenuItem(crossLinkName));
        await item.waitFor({ state: 'visible', timeout });
        await item.click();
    }

    // Organization-level cross-link methods

    async navigateToOrgSettings() {
        testLogger.debug('Navigating to Organization Settings page via URL');
        const orgId = process.env["ORGNAME"] || 'default';
        await this.page.goto(`${process.env["ZO_BASE_URL"] || 'http://localhost:5080'}/web/settings/organization?org_identifier=${orgId}`);
        await this.page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
        await this.page.waitForTimeout(3000);
        // Scroll to Cross-Linking Configuration section if it exists
        const addBtn = this.page.locator(this.addCrossLinkBtn);
        try {
            await addBtn.scrollIntoViewIfNeeded({ timeout: 5000 });
        } catch {
            // Button may not exist if feature is disabled
        }
    }

    async clickOrgSettingsSave() {
        testLogger.debug('Clicking org settings save button');
        await this.page.locator(this.orgSettingsSaveBtn).click();
        await this.page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
        await this.page.waitForTimeout(1000);
    }

    // ============================================================
    // Log details cross-link helpers (used by multi-stream specs)
    // ============================================================

    /**
     * Get the field action button (include/exclude dropdown trigger) for a given
     * field name inside the expanded log row. Relies on the field row carrying
     * `data-test="log-detail-row-<key>"` defined in JsonPreview.vue.
     */
    fieldActionBtnForKey(fieldName) {
        return this.page.locator(
            `[data-test="log-detail-row-${fieldName}"] [data-test="log-details-include-exclude-field-btn"]`
        );
    }

    /**
     * Open the include/exclude/cross-link dropdown for a given field row inside
     * an expanded log details panel.
     */
    async openFieldActionDropdown(fieldName) {
        testLogger.debug('Opening field action dropdown', { fieldName });
        const btn = this.fieldActionBtnForKey(fieldName);
        await btn.waitFor({ state: 'visible', timeout: 10000 });
        await btn.click();
        await this.page.waitForTimeout(1500);
    }

    /**
     * Whether a named cross-link option appears in the field action dropdown.
     */
    async isLogCrossLinkVisible(crossLinkName) {
        return this.page
            .locator(`[data-test="log-details-cross-link-${crossLinkName}"]`)
            .isVisible()
            .catch(() => false);
    }

    /**
     * Poll until a single named cross-link appears in the field-action dropdown.
     * Mirrors the `expectCrossLinksFromBothStreams` pattern: re-opens the
     * dropdown on every iteration so a late-arriving `result_schema?cross_linking=true`
     * response can be picked up. Returns true if visible within the timeout,
     * false otherwise (callers do their own `expect()` assertion).
     */
    async expectLogCrossLinkVisible(fieldName, crossLinkName, opts = {}) {
        const timeout = opts.timeout ?? 20000;
        const intervals = opts.intervals ?? [1000, 1500, 2000];
        try {
            await expect
                .poll(
                    async () => {
                        await this.openFieldActionDropdown(fieldName);
                        await this.page.waitForTimeout(500);
                        const visible = await this.isLogCrossLinkVisible(crossLinkName);
                        if (!visible) {
                            await this.closeFieldActionDropdown();
                        }
                        return visible;
                    },
                    { timeout, intervals },
                )
                .toBe(true);
            return true;
        } catch {
            return false;
        }
    }

    /**
     * Close any open field-action dropdown via Escape — keyed off the spec
     * pattern that opens, inspects, then re-opens the dropdown on each poll.
     */
    async closeFieldActionDropdown() {
        await this.page.keyboard.press('Escape').catch(() => {});
        await this.page.waitForTimeout(300);
    }

    /**
     * Expand the first log row (chevron toggle that reveals the per-row JSON
     * preview / field-action panel). Encapsulates the inline locator that
     * the multi-stream spec used to inline.
     */
    async expandFirstLogRow() {
        // The table renders after the search API responds — allow up to 30 s
        // on CI where UNION ALL queries can be slow to return rows.
        await this.firstLogRowExpand.waitFor({ state: 'visible', timeout: 30000 });
        await this.firstLogRowExpand.click();
        await this.page.waitForTimeout(2000);
    }

    /**
     * Begin capturing `result_schema?cross_linking=true` requests so the
     * caller can assert that one request fires per selected stream. Useful
     * for network-level regression tests that don't need to inspect the
     * response payload.
     */
    captureCrossLinkRequests() {
        const captured = [];
        const handler = (req) => {
            const url = req.url();
            if (url.includes('result_schema') && url.includes('cross_linking=true')) {
                captured.push(url);
            }
        };
        this.page.on('request', handler);
        return {
            getUrls: () => captured.slice(),
            getCount: () => captured.length,
            stop: () => this.page.off('request', handler),
        };
    }

    /**
     * Begin capturing `result_schema?cross_linking=true` responses so the
     * caller can later assert how many fired. The cross-link dropdown depends
     * on these responses landing (one per selected stream) before
     * `searchObj.data.crossLinks` is fully populated.
     *
     * Returns a small handle with `getCount()` + `waitForAtLeast(n)` helpers,
     * so the spec doesn't need to manage its own response array.
     */
    captureCrossLinkResponses() {
        const captured = [];
        const bodies = [];
        const handler = (resp) => {
            const url = resp.url();
            if (url.includes('result_schema') && url.includes('cross_linking=true')) {
                captured.push(resp);
                // Eagerly read body so callers can inspect stream_links payloads
                // without racing the GC; failures are swallowed because the body
                // capture is purely diagnostic and must never break the test.
                resp.json()
                    .then((body) => {
                        bodies.push({ url, body });
                    })
                    .catch(() => {
                        bodies.push({ url, body: null });
                    });
            }
        };
        this.page.on('response', handler);
        const handle = {
            getCount: () => captured.length,
            getBodies: () => bodies.slice(),
            waitForAtLeast: async (n, opts = {}) => {
                const timeout = opts.timeout ?? 8000;
                const interval = opts.interval ?? 500;
                const start = Date.now();
                while (Date.now() - start < timeout && captured.length < n) {
                    await this.page.waitForTimeout(interval);
                }
                return captured.length;
            },
            /**
             * Reset the captured buffers so the same handle can be reused after
             * re-firing the query (e.g. when the initial result_schema responses
             * return empty stream_links and the test wants a fresh attempt).
             */
            reset: () => {
                captured.length = 0;
                bodies.length = 0;
            },
            /**
             * Count the number of captured response bodies whose
             * `cross_links.stream_links` contains at least one entry. The
             * result_schema endpoint returns the merged structure at the top
             * level (NOT nested under `data`) — `data` is the axios layer in
             * useSearchBar that we don't see here. Eventually-consistent:
             * callers should await `waitForAtLeast(n)` before reading this to
             * ensure bodies have been parsed.
             */
            getNonEmptyCount: () =>
                bodies.filter(
                    (b) => (b.body?.cross_links?.stream_links ?? []).length > 0,
                ).length,
            stop: () => this.page.off('response', handler),
        };
        return handle;
    }

    /**
     * Poll until cross-links from BOTH provided streams appear in the
     * field-action dropdown for `fieldName`. Re-opens the dropdown on every
     * failed iteration so a late-arriving `result_schema` response can be
     * picked up. Wraps the previous inline `expect.poll` block.
     */
    async expectCrossLinksFromBothStreams(fieldName, crossLinkA, crossLinkB, opts = {}) {
        const timeout = opts.timeout ?? 20000;
        const intervals = opts.intervals ?? [1000, 1500, 2000];
        const message =
            opts.message ??
            'Cross-links from both streams should appear in field action dropdown';
        await expect
            .poll(
                async () => {
                    await this.openFieldActionDropdown(fieldName);
                    await this.page.waitForTimeout(500);
                    const hasA = await this.isLogCrossLinkVisible(crossLinkA);
                    const hasB = await this.isLogCrossLinkVisible(crossLinkB);
                    if (!hasA || !hasB) {
                        await this.closeFieldActionDropdown();
                    }
                    return { hasA, hasB };
                },
                { timeout, intervals, message },
            )
            .toEqual({ hasA: true, hasB: true });
    }

    // ============================================================
    // Dashboard panel drilldown menu helpers
    // ============================================================

    drilldownMenu() {
        return this.page.locator('[data-test="drilldown-menu"]');
    }

    drilldownMenuItem(name) {
        return this.page.locator(`[data-test="drilldown-menu-item-${name}"]`);
    }

    async isDrilldownMenuVisible() {
        return this.drilldownMenu().isVisible().catch(() => false);
    }

    async isDrilldownMenuItemVisible(name) {
        return this.drilldownMenuItem(name).isVisible().catch(() => false);
    }

    async clickDrilldownMenuItem(name, timeout = 5000) {
        testLogger.debug('Clicking drilldown menu item', { name });
        const item = this.drilldownMenuItem(name);
        await item.waitFor({ state: 'visible', timeout });
        await item.click();
    }

    /**
     * Locate a cross-link item by its name (used for org read-only items in
     * stream schema where the index can vary based on existing items).
     * Uses the per-name data-test on the item title.
     */
    async findCrossLinkItemByName(name) {
        const idx = await this.findCrossLinkItemIndexByName(name);
        if (idx === -1) return null;
        return this.page.locator(this.crossLinkItem(idx));
    }

    async crossLinkItemEditBtnLocatorByIdx(idx) {
        return this.page.locator(this.crossLinkEditBtn(idx));
    }

    async crossLinkItemDeleteBtnLocatorByIdx(idx) {
        return this.page.locator(this.crossLinkDeleteBtn(idx));
    }

    // ── Locator getters for assertions in spec files ──────────────────────────

    getCrossLinkDialogLocator() {
        return this.page.locator(this.crossLinkDialog);
    }

    getCrossLinkSaveBtnLocator() {
        return this.page.locator(this.crossLinkSaveBtn);
    }

    /**
     * Click the first non-empty data cell in the rendered dashboard table panel.
     * Uses the `dashboard-data-row-cell` data-test attribute emitted by
     * TenstackTable so we never depend on raw <td> selectors.
     */
    async clickFirstDashboardTableCell() {
        testLogger.debug('Clicking first dashboard table cell to trigger drilldown');
        await this.page.evaluate(() => {
            const cells = document.querySelectorAll(
                '[data-test="dashboard-panel-table"] [data-test="dashboard-data-row-cell"]'
            );
            for (const cell of cells) {
                if (cell.offsetParent !== null && cell.textContent && cell.textContent.trim()) {
                    cell.click();
                    return;
                }
            }
        });
    }

    /**
     * Delete all existing cross-links on the current page (stream or org settings).
     * Only deletes items that have a visible delete button (i.e., editable items).
     * Org-level read-only items (which have no delete button) are skipped.
     */
    async deleteAllCrossLinks() {
        testLogger.debug('Deleting all existing cross-links');
        let count = await this.page.locator('[data-test^="cross-link-delete-"]').count();
        while (count > 0) {
            await this.clickDeleteCrossLink(0);
            await this.page.waitForTimeout(500);
            count = await this.page.locator('[data-test^="cross-link-delete-"]').count();
        }
        testLogger.debug('All deletable cross-links deleted', { remaining: count });
    }
}
