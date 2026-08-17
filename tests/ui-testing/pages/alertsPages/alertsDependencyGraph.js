// Copyright 2026 OpenObserve Inc.

import { expect } from '@playwright/test';
const testLogger = require('../../playwright-tests/utils/test-logger.js');

/**
 * Page object for the Alert Notification Dependency Graph surface: the "Used by"
 * column (DependencyUsageCell) on the Alert Destinations / Alert Templates lists
 * and the DependencyImpactDialog it opens. Host-page navigation stays on
 * `alertDestinationsPage` / `alertTemplatesPage`; this object owns only the
 * graph-specific selectors and interactions so specs never touch a raw locator.
 */
export class AlertsDependencyGraphPage {
    constructor(page) {
        this.page = page;

        // Static dialog + list selectors (name-independent).
        this.impactBody = '[data-test="dependency-impact-body"]';
        this.impactSearchField = '[data-test="dependency-impact-search-field"]';
        this.impactLaneDestination = '[data-test="dependency-impact-lane-destination"]';
        this.impactLaneAlert = '[data-test="dependency-impact-lane-alert"]';
        this.impactDirect = '[data-test="dependency-impact-direct"]';

        // Confirm dialog, toasts and the OTable loading skeleton.
        this.confirmPrimaryBtn = '[data-test="confirm-dialog"] [data-test="o-dialog-primary-btn"]';
        this.errorToast = '[data-test-variant="error"]';
        this.tableSkeleton = '[data-test="o2-table-skeleton-body"]';
    }

    // ==========================================================================
    // LOCATORS (name-interpolated)
    // ==========================================================================

    /** The whole "Used by" cell for a destination/template — click opens the dialog. */
    usedByCell(name) {
        return this.page.locator(`[data-test="used-by-${name}"]`);
    }

    /** Alert-count badge (`<count> alerts`) on a destination/template row. */
    usedByAlertBadge(name) {
        return this.page.locator(`[data-test="used-by-${name}-alert"]`);
    }

    /** Destination-count badge on a template row. */
    usedByDestinationBadge(name) {
        return this.page.locator(`[data-test="used-by-${name}-destination"]`);
    }

    /** "Unused" chip on an orphan destination/template row. */
    usedByUnusedChip(name) {
        return this.page.locator(`[data-test="used-by-${name}-unused"]`);
    }

    /** One entity row inside the impact dialog. */
    impactRow(name) {
        return this.page.locator(`[data-test="dependency-impact-row-${name}"]`);
    }

    /** A destination card in the destinations lane (template focus). */
    impactCard(name) {
        return this.page.locator(`[data-test="dependency-impact-card-${name}"]`);
    }

    /** A per-destination alert group box in the alerts lane (template focus). */
    impactGroup(name) {
        return this.page.locator(`[data-test="dependency-impact-group-${name}"]`);
    }

    /** Hover-revealed "open in new tab" button on an entity row. */
    impactOpenBtn(name) {
        return this.page.locator(`[data-test="dependency-impact-open-${name}"]`);
    }

    /** Hover-revealed delete button on an entity row. */
    impactDeleteBtn(name) {
        return this.page.locator(`[data-test="dependency-impact-delete-${name}"]`);
    }

    // ==========================================================================
    // WAIT HELPERS
    // ==========================================================================

    /**
     * Wait for the host list table to finish loading. The "Used by" cell renders a
     * neutral graph icon while the graph is empty (loading) — never a false
     * "Unused" — so badge/chip assertions must run only after the skeleton clears.
     */
    async waitForTableLoaded() {
        await this.page
            .locator(this.tableSkeleton)
            .first()
            .waitFor({ state: 'hidden', timeout: 30000 })
            .catch(() => {});
        testLogger.debug('Dependency graph host table finished loading');
    }

    // ==========================================================================
    // LIST CELL ASSERTIONS
    // ==========================================================================

    async expectUsedByAlertBadge(name, count) {
        const badge = this.usedByAlertBadge(name);
        await expect(badge).toBeVisible({ timeout: 30000 });
        await expect(badge).toContainText(String(count));
    }

    async expectUsedByDestinationBadge(name, count) {
        const badge = this.usedByDestinationBadge(name);
        await expect(badge).toBeVisible({ timeout: 30000 });
        await expect(badge).toContainText(String(count));
    }

    async expectUnusedChip(name) {
        const chip = this.usedByUnusedChip(name);
        await expect(chip).toBeVisible({ timeout: 30000 });
        await expect(chip).toContainText('Unused');
    }

    // ==========================================================================
    // DIALOG INTERACTIONS / ASSERTIONS
    // ==========================================================================

    /** Click a row's "Used by" cell and wait for the impact dialog body. */
    async openImpactDialog(name) {
        await this.usedByCell(name).click();
        await expect(this.page.locator(this.impactBody)).toBeVisible({ timeout: 30000 });
    }

    async expectImpactBodyVisible() {
        await expect(this.page.locator(this.impactBody)).toBeVisible({ timeout: 30000 });
    }

    async expectImpactRowVisible(name) {
        await expect(this.impactRow(name)).toBeVisible({ timeout: 30000 });
    }

    /** Assert an entity row is absent (e.g. filtered out or deleted). */
    async expectImpactRowAbsent(name) {
        await expect(this.impactRow(name)).toHaveCount(0, { timeout: 30000 });
    }

    async expectImpactCardVisible(name) {
        await expect(this.impactCard(name)).toBeVisible({ timeout: 30000 });
    }

    async expectImpactGroupVisible(name) {
        await expect(this.impactGroup(name)).toBeVisible({ timeout: 30000 });
    }

    /** Assert the "Uses this template directly" section is visible and holds the given alert row. */
    async expectDirectSectionContainsRow(name) {
        const direct = this.page.locator(this.impactDirect);
        await expect(direct).toBeVisible({ timeout: 30000 });
        await expect(direct.locator(`[data-test="dependency-impact-row-${name}"]`)).toBeVisible({
            timeout: 30000,
        });
    }

    /** Destination focus renders a flat alert list — the destinations lane is absent. */
    async expectDestinationsLaneAbsent() {
        await expect(this.page.locator(this.impactLaneDestination)).toHaveCount(0, { timeout: 30000 });
    }

    async expectDestinationsLaneVisible() {
        await expect(this.page.locator(this.impactLaneDestination)).toBeVisible({ timeout: 30000 });
    }

    /** The alerts lane renders in every impact dialog (flat list on a destination focus). */
    async expectImpactLaneAlertVisible() {
        await expect(this.page.locator(this.impactLaneAlert)).toBeVisible({ timeout: 30000 });
    }

    /** Type into the dialog search (replaces any prior value). */
    async searchImpact(term) {
        const field = this.page.locator(this.impactSearchField);
        await field.waitFor({ state: 'visible', timeout: 30000 });
        await field.fill(term);
    }

    /** Assert the search empty state ("No matches.") is shown. */
    async expectNoMatchesVisible() {
        await expect(this.page.getByText('No matches.', { exact: true }).first()).toBeVisible({
            timeout: 30000,
        });
    }

    /**
     * Delete an entity from the impact dialog: hover its row (the delete control
     * is opacity-0 until group-hover), click delete, then confirm.
     */
    async deleteImpactEntity(name) {
        const row = this.impactRow(name);
        await row.hover();
        await this.impactDeleteBtn(name).click();
        await this.page.locator(this.confirmPrimaryBtn).click();
    }

    /** Hover an entity row and click its open-in-new-tab button. */
    async clickOpenEntity(name) {
        const row = this.impactRow(name);
        await row.hover();
        await this.impactOpenBtn(name).click();
    }

    /** Assert an error toast surfaced (e.g. a 409 delete block). */
    async expectErrorToastVisible() {
        await expect(this.page.locator(this.errorToast).first()).toBeVisible({ timeout: 30000 });
    }

    /** Assert a popup page navigated to a route matching `pattern` (open-in-new-tab). */
    async expectPopupUrl(popupPage, pattern) {
        await expect(popupPage).toHaveURL(pattern, { timeout: 30000 });
    }
}
