// aiObservabilityPage.js
// Page object for the AI Observability module (LLM Experiments & Playground).
// Selectors verified against web/src/enterprise/views/AIObservability/*.vue and
// web/src/enterprise/components/onlineEvals/QualityPage.vue.
//
// Strict selector policy:
//   - data-test only (no element/class/text/role locators)
//   - All locators live in the constructor as class members
//   - Navigation goes straight to the /web/ai/<section> SPA route (auth is
//     established by navigateToBase in the spec's beforeEach)

import { expect } from '@playwright/test';

export class AIObservabilityPage {
  constructor(page) {
    this.page = page;

    // =====================================================================
    // Module shell — the secondary (left) section rail rendered by the AI
    // Observability shell (Index.vue / SectionRail).
    // =====================================================================
    this.sectionRail = page.locator('[data-test="section-rail"]');

    // =====================================================================
    // Experiments page (ExperimentsPage.vue / ExperimentBrowser.vue)
    // =====================================================================
    this.experimentsPage = page.locator('[data-test="ai-experiments-page"]');
    this.newExperimentBtn = page.locator('[data-test="ai-experiments-new-btn"]');
    // Create form title (ExperimentForm.vue) — proof the create route mounted.
    this.experimentFormTitle = page.locator('[data-test="ai-experiment-form-title"]');

    // =====================================================================
    // Datasets page (DatasetsPage.vue)
    // =====================================================================
    this.datasetsPage = page.locator('[data-test="ai-datasets-page"]');
    this.newDatasetBtn = page.locator('[data-test="ai-datasets-new-btn"]');
    // Create/edit drawer (ODrawer) and its name input + built-in close button.
    this.datasetCreateDrawer = page.locator('[data-test="ai-datasets-create-drawer"]');
    this.datasetCreateName = page.locator('[data-test="ai-datasets-create-name"]');
    this.datasetDrawerCloseBtn = page.locator(
      '[data-test="ai-datasets-create-drawer"] [data-test="o-drawer-close-btn"]',
    );

    // =====================================================================
    // Playground page (PlaygroundPage.vue)
    // =====================================================================
    this.playgroundPage = page.locator('[data-test="ai-playground-page"]');
    this.playgroundRunAllBtn = page.locator('[data-test="ai-playground-run-all-btn"]');

    // =====================================================================
    // Quality page (online evals — QualityPage.vue)
    // =====================================================================
    this.qualityPage = page.locator('[data-test="quality-page"]');

    // =====================================================================
    // Factory locators — runtime-bound (allowed by POM strict policy)
    // =====================================================================
    /** @param {string} key — one of "playground" | "experiments" | "datasets" | "quality" | … */
    this.secondaryNavItem = (key) => page.locator(`[data-test="ai-secondary-nav-${key}"]`);
  }

  // =========================================================================
  // NAVIGATION
  // =========================================================================

  /** Build a /web/ai/<section> URL bound to the configured org. */
  _aiUrl(section) {
    const baseUrl = (process.env['ZO_BASE_URL'] || '').replace(/\/+$/, '');
    const org = process.env['ORGNAME'] || 'default';
    const tail = section ? `/${section}` : '/';
    return `${baseUrl}/web/ai${tail}?org_identifier=${org}`;
  }

  async navigateTo(section) {
    await this.page.goto(this._aiUrl(section), { timeout: 60000 });
    // SPA routes settle on domcontentloaded; element waits below gate on mount.
    await this.page.waitForLoadState('domcontentloaded');
  }

  async navigateToModule() {
    await this.navigateTo('');
  }

  async navigateToExperiments() {
    await this.navigateTo('experiments');
  }

  async navigateToDatasets() {
    await this.navigateTo('datasets');
  }

  async navigateToPlayground() {
    await this.navigateTo('playground');
  }

  async navigateToQuality() {
    await this.navigateTo('evaluations');
  }

  // =========================================================================
  // MODULE SHELL
  // =========================================================================

  async expectSectionRailVisible() {
    await expect(this.sectionRail).toBeVisible({ timeout: 15000 });
  }

  async expectSecondaryNavItemVisible(key) {
    await expect(this.secondaryNavItem(key)).toBeVisible({ timeout: 15000 });
  }

  // =========================================================================
  // EXPERIMENTS
  // =========================================================================

  async expectExperimentsPageVisible() {
    await expect(this.experimentsPage).toBeVisible({ timeout: 15000 });
  }

  async expectNewExperimentBtnVisible() {
    await expect(this.newExperimentBtn).toBeVisible({ timeout: 15000 });
  }

  async clickNewExperiment() {
    await this.newExperimentBtn.click();
  }

  async expectCreateFormVisible() {
    await expect(this.experimentFormTitle).toBeVisible({ timeout: 15000 });
  }

  // =========================================================================
  // DATASETS
  // =========================================================================

  async expectDatasetsPageVisible() {
    await expect(this.datasetsPage).toBeVisible({ timeout: 15000 });
  }

  async expectNewDatasetBtnVisible() {
    await expect(this.newDatasetBtn).toBeVisible({ timeout: 15000 });
  }

  async clickNewDataset() {
    await this.newDatasetBtn.click();
  }

  async expectDatasetCreateDrawerVisible() {
    await expect(this.datasetCreateDrawer).toBeVisible({ timeout: 15000 });
  }

  async expectDatasetCreateNameVisible() {
    await expect(this.datasetCreateName).toBeVisible({ timeout: 15000 });
  }

  async closeDatasetCreateDrawer() {
    await this.datasetDrawerCloseBtn.click();
  }

  async expectDatasetCreateDrawerHidden() {
    await expect(this.datasetCreateDrawer).toBeHidden({ timeout: 15000 });
  }

  // =========================================================================
  // PLAYGROUND
  // =========================================================================

  async expectPlaygroundPageVisible() {
    await expect(this.playgroundPage).toBeVisible({ timeout: 15000 });
  }

  async expectRunAllBtnVisible() {
    await expect(this.playgroundRunAllBtn).toBeVisible({ timeout: 15000 });
  }

  // =========================================================================
  // QUALITY (online evals)
  // =========================================================================

  async expectQualityPageVisible() {
    await expect(this.qualityPage).toBeVisible({ timeout: 15000 });
  }
}
