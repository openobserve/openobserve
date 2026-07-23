import { expect } from '@playwright/test';

class UnflattenedPage {
    constructor(page) {
        this.page = page;

        // Sidebar / navigation
        this.streamsMenu = page.locator('[data-test="menu-link-\\/streams-item"]');

        // Streams list (LogStream.vue)
        // OInput inner native input — always target the `-field` variant for fill
        this.searchStreamInput = page.locator('[data-test="streams-search-stream-input-field"]');

        // Schema dialog (schema.vue)
        this.configurationTab = page.locator('[data-test="schema-configuration-tab"]');
        // Store Original Data toggle wrapper — OSwitch renders an inner button with data-state="checked|unchecked"
        this.storeOriginalDataToggle = page.locator('[data-test="log-stream-store-original-data-toggle-btn"]');
        this.storeOriginalDataToggleInner = page.locator('[data-test="log-stream-store-original-data-toggle-btn"] [data-state]');
        this.schemaUpdateButton = page.locator('[data-test="schema-update-settings-button"]');
        this.closeButton = page.locator('[data-test="schema-cancel-button"]').first();
        // OToast success message body
        this.streamSettingsUpdatedSnackbar = page.locator('[data-test="o-toast-message"]');

        // Logs explorer
        this.dateTimeButton = page.locator('[data-test="date-time-btn"]');
        this.relativeTab = page.locator('[data-test="date-time-relative-tab"]');
        this.logTableRowExpandMenu = page.locator('[data-test="log-table-column-1-_timestamp"] [data-test="table-row-expand-menu"]');
        // FTS default-column feature: first cell may be the generic "source"
        // column OR an FTS column (body/message/log). Target whichever first-row
        // cell is rendered; a click bubbles to the row handler that opens detail.
        this.logSourceColumn = page.locator('[data-test^="log-table-column-0-"]').first();
        this.o2IdText = page.locator('[data-test="log-detail-json-content"] [data-test="log-expand-detail-key-_o2_id"]');
        this.unflattenedTab = page.locator('[data-test="log-detail-json-content"] [data-test="tab-unflattened"]');
        this.closeDialog = page.locator('[data-test="logs-search-result-detail-dialog"] [data-test="o-drawer-close-btn"]');
        // OFieldList inner search input — scope under the logs index list to avoid
        // collision with the dashboard panel-editor field list also on the page.
        this.indexFieldSearchInput = page.locator('[data-test="logs-search-index-list"] [data-test="o-field-list-search-field"]');
        this.utilitiesMenuButton = page.locator('[data-test="logs-search-bar-utilities-menu-btn"]');
        this.sqlModeToggle = page.locator('[data-test="logs-search-bar-sql-mode-toggle-btn"]');
        this.logsSearchBarQueryEditor = page.locator('[data-test="logs-search-bar-query-editor"]');
        // FieldListPagination receives data-test-prefix="logs-page" from IndexList.vue,
        // so the rendered data-test is `${prefix}-all-fields-btn`.
        this.allFieldsButton = page.locator('[data-test="logs-page-all-fields-btn"]');
        this.logsSearchBarRefreshButton = page.locator('[data-test="logs-search-bar-refresh-btn"]');
        this.logDetailJsonContent = page.locator('[data-test="log-detail-json-content"]');
        this.allLogDetailKeys = page.locator('[data-test="log-detail-json-content"] [data-test^="log-expand-detail-key-"]');
        this.timestampDropdown = page.locator('[data-test="log-detail-json-content"] [data-test="log-expand-detail-key-_timestamp"]');
        // Explore action on the streams table row — when only one row is filtered, .first() is deterministic
        this.exploreButton = page.locator('[data-test="log-stream-explore-btn"]').first();
    }

    /**
     * Open the stream schema/detail dialog for the named stream from the
     * Streams list. Walks up from the per-name name cell (deterministic
     * data-test) to the OTable row, hovers to reveal the action buttons,
     * then clicks the schema button.
     */
    async openStreamDetail(streamName) {
        // Wait for stream list to populate after search
        await this.page.waitForTimeout(2000);

        // Resolve the row containing the named stream via the per-name cell data-test,
        // then walk up the DOM to the OTable row (data-test^="o2-table-row-").
        const nameCell = this.page.locator(`[data-test="log-stream-name-cell-${streamName}"]`).first();
        const row = nameCell.locator(`xpath=ancestor::*[starts-with(@data-test,'o2-table-row-')]`).first();

        // The schema button is hidden until the row is hovered.
        // Hover first to make it visible, then click with force as a fallback.
        await row.hover();
        const detailBtn = row.locator('[data-test="log-stream-schema-btn"]').first();
        await detailBtn.click({ force: true, timeout: 15000 });

        // Wait for the dialog to render — the Schema settings tab signals the dialog is ready
        await this.page.locator('[data-test="schema-settings-tab"]').first().waitFor({ state: 'visible', timeout: 15000 });
    }

    async isStoreOriginalDataEnabled() {
        // OSwitch exposes `data-state="checked"` when ON, `"unchecked"` when OFF.
        await this.storeOriginalDataToggleInner.first().waitFor({ state: 'visible', timeout: 10000 });
        const state = await this.storeOriginalDataToggleInner.first().getAttribute('data-state');
        const isEnabled = state === 'checked';

        console.log('DEBUG: Toggle data-state:', state);
        console.log('DEBUG: Is enabled?', isEnabled);

        return isEnabled;
    }

    async ensureStoreOriginalDataDisabled() {
        const isEnabled = await this.isStoreOriginalDataEnabled();
        console.log('DEBUG: ensureStoreOriginalDataDisabled - isEnabled:', isEnabled);

        if (isEnabled) {
            console.log('DEBUG: Toggle is enabled, disabling it now');
            await this.storeOriginalDataToggle.click();
            await this.page.waitForTimeout(500);
            await this.schemaUpdateButton.waitFor({ state: "visible", timeout: 5000 });
            await this.schemaUpdateButton.click();
            await this.streamSettingsUpdatedSnackbar.waitFor({ state: "visible", timeout: 10000 });
            await this.page.waitForTimeout(1000);
            console.log('DEBUG: Toggle disabled successfully');
            return true;
        }
        console.log('DEBUG: Toggle is already disabled, no action needed');
        return false;
    }

    async clickInterestingFieldButton(fieldName) {
        // Scope under the logs index list to avoid potential collision with the
        // dashboard panel-editor field list (which also exposes interesting-field
        // controls in some layouts).
        const btn = this.page
            .locator(`[data-test="logs-search-index-list"] [data-test="log-search-index-list-interesting-${fieldName}-field-btn"]`)
            .first();
        await btn.waitFor({ state: 'visible' });
        // Force-click: an adjacent tooltip icon path intermittently intercepts
        // pointer events at the moment of click; force bypasses the overlay.
        await btn.click({ force: true });
    }

    async expectQueryEditorContainsText(textOrRegex) {
        await this.logsSearchBarQueryEditor.waitFor({ state: 'visible', timeout: 15000 }).catch(() => {});
        await expect(this.logsSearchBarQueryEditor).toContainText(textOrRegex, { timeout: 10000 });
    }

    /**
     * Wait for an interesting-field toggle button's `title` to flip to
     * "Remove from interesting fields" — the DOM-side proxy for
     * `field.isInterestingField === true`. Used instead of reading Vue state
     * because `__vueParentComponent` is dev-only in Vue 3 and undefined in
     * production builds.
     */
    async expectFieldMarkedAsInteresting(fieldName, opts = {}) {
        const { timeout = 10000 } = opts;
        const btn = this.page.locator(
            `[data-test="logs-search-index-list"] [data-test="log-search-index-list-interesting-${fieldName}-field-btn"]`
        ).first();
        await expect(btn).toHaveAttribute('title', /remove from interesting fields/i, { timeout });
    }

    /**
     * Switch to SQL mode.
     *
     * The SQL mode toggle button was removed from the UI — SQL mode is now
     * auto-detected from query content (SELECT...FROM = SQL ON).
     * This method reads the current interesting fields and selected stream from
     * Vue component state, then writes a SELECT query into the Monaco editor so
     * that the interesting fields appear in the editor (matching previous behavior).
     */
    async toggleSqlMode() {
        // Read the set of "interesting" fields from the DOM instead of walking
        // `__vueParentComponent`, which is dev-only and undefined in production
        // builds (the build CI ships). Each interesting-field toggle button's
        // `title` flips to "Remove from interesting fields" when active. Read the
        // active stream from the URL — `?stream=` is set on every navigation.
        const appState = await this.page.evaluate(() => {
            const btnSelector = '[data-test="logs-search-index-list"] [data-test^="log-search-index-list-interesting-"][data-test$="-field-btn"]';
            const fields = Array.from(document.querySelectorAll(btnSelector))
                .filter(b => /remove from interesting fields/i.test(b.getAttribute('title') || ''))
                .map(b => {
                    const m = (b.getAttribute('data-test') || '').match(/^log-search-index-list-interesting-(.+)-field-btn$/);
                    return m ? m[1] : null;
                })
                .filter(Boolean);
            // De-duplicate (FieldRow renders the same button twice — once in the
            // default slot and once in the `#actions` slot).
            const uniqueFields = Array.from(new Set(fields));
            const stream = new URLSearchParams(window.location.search).get('stream') || null;
            return { fields: uniqueFields, stream };
        });

        const timestamp = '_timestamp';
        const fields = appState?.fields || [];
        // Fallback chain: URL `?stream=` → first selected stream chip on the page.
        // We avoid a hardcoded stream name so this helper is reusable beyond the
        // single test that currently calls it.
        let stream = appState?.stream;
        if (!stream) {
            const chipText = await this.page
                .locator('[data-test="logs-search-bar-streamname-select-stream-button"]')
                .first()
                .textContent()
                .catch(() => null);
            stream = (chipText || '').trim() || 'e2e_automate';
        }
        const allFields = fields.includes(timestamp) ? fields : [timestamp, ...fields];
        const sql = allFields.length > 1
            ? `SELECT ${allFields.join(',')} FROM "${stream}" ORDER BY ${timestamp} DESC`
            : `SELECT * FROM "${stream}"`;

        // Write the SQL into the Monaco editor via the .inputarea
        await this.logsSearchBarQueryEditor.waitFor({ state: 'visible', timeout: 10000 });
        await this.logsSearchBarQueryEditor.click();
        const inputArea = this.logsSearchBarQueryEditor.locator('.inputarea');
        await inputArea.waitFor({ state: 'visible', timeout: 5000 });
        await this.page.keyboard.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A');
        await inputArea.fill(sql);
        await this.page.waitForTimeout(600);
    }

    async ensureStoreOriginalDataEnabled() {
        const isEnabled = await this.isStoreOriginalDataEnabled();
        console.log('DEBUG: ensureStoreOriginalDataEnabled - isEnabled:', isEnabled);

        if (!isEnabled) {
            console.log('DEBUG: Toggle is disabled, enabling it now');
            await this.storeOriginalDataToggle.click();
            await this.page.waitForTimeout(500);
            await this.schemaUpdateButton.waitFor({ state: "visible", timeout: 5000 });
            await this.schemaUpdateButton.click();
            await this.streamSettingsUpdatedSnackbar.waitFor({ state: "visible", timeout: 10000 });
            await this.page.waitForTimeout(1000);
            console.log('DEBUG: Toggle enabled successfully');
            return true;
        }
        console.log('DEBUG: Toggle is already enabled, no action needed');
        return false;
    }

    /**
     * Open the log detail drawer for the row at index `rowIndex` (0-based, as
     * rendered by the virtualized table).  Clicks the source cell to trigger
     * the row's click handler, which opens the side detail drawer.
     *
     * Do NOT click the expand button first.  Clicking the expand button inserts
     * a new virtual row at rowIndex+1 in the TenstackTable, which shifts all
     * subsequent row indices by 1.  After row 0 is expanded,
     * log-table-column-1-_timestamp no longer exists (index 1 is the inline
     * expanded-content row), so findRowWithO2Id breaks after the first row and
     * never scans the rest of the table.
     */
    async openLogRowDetail(rowIndex) {
        // Clicking any cell in the row bubbles up to the <tr> @click handler
        // (handleDataRowClick → emits click:dataRow → openLogDetails in
        // SearchResult.vue), which opens the side detail drawer. With the FTS
        // default-column feature the first cell may be the generic "source"
        // column OR an FTS column (body/message/log), so target whichever
        // first cell of this row is rendered rather than "source" only.
        const sourceCell = this.page.locator(`[data-test^="log-table-column-${rowIndex}-"]`).first();
        await sourceCell.waitFor({ state: 'visible', timeout: 15000 });
        await sourceCell.click();
        // Wait for the detail drawer to be open — deterministic on drawer state.
        await this.page
            .locator('[data-test="logs-search-result-detail-dialog"][data-state="open"]')
            .waitFor({ state: 'visible', timeout: 10000 });
        // JSON content renders asynchronously after the drawer opens. Wait for the
        // first detail key to actually render instead of a fixed 3s sleep — the keys
        // appearing IS the signal callers need before probing for _o2_id, and the
        // fixed sleep made findRowWithO2Id's 15-row scan cost ~1.5 minutes per
        // attempt (the dominant share of the 5-minute-timeout flake on CI).
        await this.allLogDetailKeys
            .first()
            .waitFor({ state: 'visible', timeout: 10000 })
            .catch(() => {});
    }

    /**
     * Close the log detail drawer if it is open. Uses Escape as the fallback
     * when the close button is intercepted by an overlay.
     */
    async closeLogDetailDrawerIfOpen() {
        const detailDialog = this.page.locator(
            '[data-test="logs-search-result-detail-dialog"][data-state="open"]'
        );
        if (await detailDialog.isVisible().catch(() => false)) {
            await this.closeDialog.click().catch(async () => {
                await this.page.keyboard.press('Escape');
            });
            await detailDialog.waitFor({ state: 'hidden', timeout: 5000 }).catch(() => {});
        }
    }

    /**
     * Iterate through the first `maxRows` log rows and return the index of the
     * first row whose detail contains the `_o2_id` field.  Leaves the detail
     * drawer OPEN on the matching row so the caller can continue interacting
     * with the `_o2_id` element.  Returns -1 if no row in the range contains
     * `_o2_id`.
     *
     * Pass `deadlineAt` (an absolute `Date.now()` value) to cap how long the
     * sweep may run.  Each row costs a drawer open plus a probe, so a 15-row
     * sweep on a slow runner could otherwise outlive the whole test timeout and
     * get the test killed mid-action instead of returning -1.
     */
    async findRowWithO2Id(maxRows = 5, { deadlineAt = null } = {}) {
        for (let rowIndex = 0; rowIndex < maxRows; rowIndex++) {
            if (deadlineAt && Date.now() >= deadlineAt) {
                console.warn(`findRowWithO2Id: time budget reached after scanning ${rowIndex} row(s)`);
                break;
            }
            const expandBtn = this.page.locator(
                `[data-test="log-table-column-${rowIndex}-_timestamp"] [data-test="table-row-expand-menu"]`
            );
            // Stop if the row doesn't exist (table shorter than maxRows).
            if (!(await expandBtn.isVisible().catch(() => false))) {
                break;
            }
            await this.openLogRowDetail(rowIndex);
            // Probe for _o2_id with a short timeout — rows that pre-date the
            // schema change won't have it.
            const found = await this.o2IdText
                .waitFor({ state: 'visible', timeout: 3000 })
                .then(() => true)
                .catch(() => false);
            if (found) {
                return rowIndex;
            }
            await this.closeLogDetailDrawerIfOpen();
        }
        return -1;
    }

    /**
     * Poll the search API until at least one record in the stream exposes the
     * `_o2_id` field. This is the deterministic readiness signal that "Store
     * Original Data" has taken effect and the freshly-ingested rows carrying
     * `_o2_id` are queryable.
     *
     * Replaces blind `waitForTimeout` schema-propagation sleeps and the UI-level
     * re-ingestion retry loop. Both were the dominant source of the unflattened
     * timeout flake: under contended CI runners the indexing lag grew and the
     * 5-attempt UI loop (≈30s of row probing + re-ingest per attempt) ballooned
     * past the 5-minute per-test budget. Gating on the backend instead lets the
     * subsequent single UI scan find `_o2_id` on the first attempt.
     *
     * Returns true as soon as `_o2_id` appears; false if it never appears within
     * `timeout` (caller may fall back to its own UI retry).
     */
    async waitForO2IdQueryable({ streamName = 'e2e_automate', timeout = 90000, pollInterval = 2000 } = {}) {
        const { getAuthHeaders, getOrgIdentifier } = require('../../playwright-tests/utils/cloud-auth.js');
        // Prefer INGESTION_URL like waitForStreamAvailable does: on CI both point at the
        // same server, but in local setups ZO_BASE_URL can be a frontend dev server that
        // does not serve /api/* (it returns an HTML hint page with HTTP 200, which made
        // this gate silently poll uselessly for its entire budget).
        const baseUrl = (process.env.INGESTION_URL || process.env.ZO_BASE_URL || '').replace(/\/$/, '');
        const orgId = getOrgIdentifier();
        const headers = getAuthHeaders();
        const deadline = Date.now() + timeout;

        while (Date.now() < deadline) {
            try {
                const end = Date.now() * 1000;            // microseconds
                const start = end - 60 * 60 * 1000 * 1000; // last hour
                const resp = await this.page.request.post(
                    `${baseUrl}/api/${orgId}/_search?type=logs`,
                    {
                        headers: { ...headers, 'Content-Type': 'application/json' },
                        // Bound each poll so a hung backend can't stall the loop past
                        // the next interval; we just retry on the next tick.
                        timeout: 10000,
                        data: {
                            query: {
                                sql: `SELECT * FROM "${streamName}" ORDER BY _timestamp DESC`,
                                start_time: start,
                                end_time: end,
                                from: 0,
                                size: 5,
                            },
                        },
                    }
                );
                if (resp.ok()) {
                    const body = await resp.json().catch(() => null);
                    if (body === null) {
                        // HTTP 200 but not JSON — almost certainly the wrong endpoint
                        // (e.g. a frontend dev server). Surface it instead of silently
                        // burning the whole gate budget.
                        console.warn('waitForO2IdQueryable: response OK but not JSON — wrong endpoint? (will retry)');
                    }
                    const hits = Array.isArray(body?.hits) ? body.hits : [];
                    if (hits.some((h) => h && Object.prototype.hasOwnProperty.call(h, '_o2_id'))) {
                        return true;
                    }
                }
            } catch (e) {
                // Transient backend/network error — keep polling until the deadline,
                // but surface it so a persistent misconfig (bad auth/endpoint) is
                // visible in the log instead of silently burning the full timeout.
                console.warn(`waitForO2IdQueryable poll error (will retry): ${e?.message || e}`);
            }
            await this.page.waitForTimeout(pollInterval);
        }
        return false;
    }
}
export default UnflattenedPage;
