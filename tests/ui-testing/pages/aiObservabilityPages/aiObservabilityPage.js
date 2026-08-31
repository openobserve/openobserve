// Copyright 2026 OpenObserve Inc.

const { expect } = require('@playwright/test');
const testLogger = require('../../playwright-tests/utils/test-logger.js');

class AiObservabilityPage {
    /**
     * @param {import('@playwright/test').Page} page
     */
    constructor(page) {
        this.page = page;

        // ── URL building ──────────────────────────────────────────────────────
        this.orgId = process.env['ORGNAME'] || 'default';
        this.baseUrl = (process.env['ZO_BASE_URL'] || 'http://localhost:5080').replace(/\/+$/, '');

        // ── Experiments list ──────────────────────────────────────────────────
        this.experimentsPage = '[data-test="ai-experiments-page"]';
        this.experimentsNewBtn = '[data-test="ai-experiments-new-btn"]';
        this.experimentsEmpty = '[data-test="ai-experiments-empty"]';
        this.experimentsBrowser = '[data-test="ai-experiment-browser"]';
        this.experimentGroup = '[data-test^="ai-experiment-group-"]';

        // ── Experiment detail ─────────────────────────────────────────────────
        this.detailPage = '[data-test="ai-experiment-detail-page"]';
        this.detailMeta = '[data-test="ai-experiment-detail-meta"]';
        this.detailTable = '[data-test="ai-experiment-detail-table"]';

        // ── Experiment compare ────────────────────────────────────────────────
        this.comparePage = '[data-test="ai-experiment-compare-page"]';
        this.comparisonPanel = '[data-test="ai-experiment-comparison"]';
        this.compareEmpty = '[data-test="ai-experiment-compare-empty"]';
    }

    // ── Navigation ────────────────────────────────────────────────────────────

    async gotoExperiments() {
        testLogger.debug('Navigating to AI Observability experiments list');
        await this.page.goto(`${this.baseUrl}/web/ai/experiments?org_identifier=${this.orgId}`);
        await this.page.waitForLoadState('domcontentloaded');
        await this.page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
    }

    async gotoCreateForm() {
        testLogger.debug('Navigating to the new experiment form');
        await this.page.goto(`${this.baseUrl}/web/ai/experiments/new?org_identifier=${this.orgId}`);
        await this.page.waitForLoadState('domcontentloaded');
        await this.page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
    }

    async gotoPlayground() {
        testLogger.debug('Navigating to the AI Observability playground');
        await this.page.goto(`${this.baseUrl}/web/ai/playground?org_identifier=${this.orgId}`);
        await this.page.waitForLoadState('domcontentloaded');
        await this.page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
    }

    async gotoDetail(experimentId) {
        testLogger.debug('Navigating to experiment detail', { experimentId });
        await this.page.goto(`${this.baseUrl}/web/ai/experiments/${experimentId}?org_identifier=${this.orgId}`);
        await this.page.waitForLoadState('domcontentloaded');
        await this.page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
    }

    async gotoCompare(baselineId, candidateId) {
        testLogger.debug('Navigating to experiment comparison', { baselineId, candidateId });
        await this.page.goto(`${this.baseUrl}/web/ai/experiments/compare/${baselineId}/${candidateId}?org_identifier=${this.orgId}`);
        await this.page.waitForLoadState('domcontentloaded');
        await this.page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
    }

    /**
     * Enterprise-availability probe: the /ai/* rail only mounts on the enterprise
     * binary. Returns true when the experiments page shell rendered, false on the
     * OSS build where the route is absent. Callers gate the suite on the result.
     *
     * @returns {Promise<boolean>} true when the AI Observability module rendered
     */
    async probeAvailability() {
        await this.gotoExperiments();
        try {
            await this.page.locator(this.experimentsPage).waitFor({ state: 'visible', timeout: 15000 });
            testLogger.debug('AI Observability module available');
            return true;
        } catch {
            testLogger.debug('AI Observability module not available (likely OSS build)');
            return false;
        }
    }

    // ── Experiments list assertions ───────────────────────────────────────────

    async expectExperimentsPageVisible() {
        await expect(this.page.locator(this.experimentsPage)).toBeVisible();
    }

    async expectNewButtonVisible() {
        await expect(this.page.locator(this.experimentsNewBtn)).toBeVisible();
    }

    async expectEmptyStateVisible() {
        await expect(this.page.locator(this.experimentsEmpty)).toBeVisible();
    }

    async expectExperimentsGroupedVisible() {
        await expect(this.page.locator(this.experimentsBrowser)).toBeVisible();
        await expect(this.page.locator(this.experimentGroup).first()).toBeVisible();
    }

    // ── Experiment detail assertions ──────────────────────────────────────────

    async expectDetailPageVisible() {
        await expect(this.page.locator(this.detailPage)).toBeVisible();
    }

    async expectDetailMetaVisible() {
        await expect(this.page.locator(this.detailMeta)).toBeVisible();
    }

    async expectDetailTableVisible() {
        await expect(this.page.locator(this.detailTable)).toBeVisible();
    }

    // ── Experiment compare assertions ─────────────────────────────────────────

    async expectComparePageVisible() {
        await expect(this.page.locator(this.comparePage)).toBeVisible();
    }

    async expectComparisonOrEmptyVisible() {
        const comparison = this.page.locator(this.comparisonPanel);
        const empty = this.page.locator(this.compareEmpty);
        await expect(comparison.or(empty).first()).toBeVisible();
    }
}

module.exports = { AiObservabilityPage };
