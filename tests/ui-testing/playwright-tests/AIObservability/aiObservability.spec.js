// aiObservability.spec.js
// E2E tests for the AI Observability module (LLM Experiments & Playground).
// Smoke/navigation coverage: each of the module's primary sections loads with
// its key controls, and the two creation entry points (New Experiment, New
// Dataset) open their editors. No pre-seeded data is required — these tests
// verify the pages mount and their chrome/controls render.

const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const PageManager = require('../../pages/page-manager.js');

test.describe("AI Observability testcases", () => {
  test.describe.configure({ mode: 'parallel' });
  let pm;

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    await navigateToBase(page);
    pm = new PageManager(page);
    testLogger.info('Test setup completed');
  });

  test("should load the AI Observability module shell with secondary navigation", {
    tag: ['@ai-observability', '@all']
  }, async ({ page }) => {
    testLogger.info('Navigating to AI Observability module');
    await pm.aiObservabilityPage.navigateToModule();

    await pm.aiObservabilityPage.expectSectionRailVisible();
    await pm.aiObservabilityPage.expectSecondaryNavItemVisible('experiments');
    await pm.aiObservabilityPage.expectSecondaryNavItemVisible('playground');
    await pm.aiObservabilityPage.expectSecondaryNavItemVisible('datasets');
    testLogger.info('Test completed');
  });

  test("should load the Experiments page with header and New Experiment button", {
    tag: ['@ai-observability', '@all']
  }, async ({ page }) => {
    testLogger.info('Navigating to Experiments page');
    await pm.aiObservabilityPage.navigateToExperiments();

    await pm.aiObservabilityPage.expectExperimentsPageVisible();
    await pm.aiObservabilityPage.expectNewExperimentBtnVisible();
    testLogger.info('Test completed');
  });

  test("should open the New Experiment create form from the Experiments page", {
    tag: ['@ai-observability', '@all']
  }, async ({ page }) => {
    testLogger.info('Navigating to Experiments page');
    await pm.aiObservabilityPage.navigateToExperiments();
    await pm.aiObservabilityPage.expectNewExperimentBtnVisible();

    await pm.aiObservabilityPage.clickNewExperiment();
    await pm.aiObservabilityPage.expectCreateFormVisible();
    testLogger.info('Test completed');
  });

  test("should load the Datasets page with header and New Dataset button", {
    tag: ['@ai-observability', '@all']
  }, async ({ page }) => {
    testLogger.info('Navigating to Datasets page');
    await pm.aiObservabilityPage.navigateToDatasets();

    await pm.aiObservabilityPage.expectDatasetsPageVisible();
    await pm.aiObservabilityPage.expectNewDatasetBtnVisible();
    testLogger.info('Test completed');
  });

  test("should open and dismiss the New Dataset create drawer", {
    tag: ['@ai-observability', '@all']
  }, async ({ page }) => {
    testLogger.info('Navigating to Datasets page');
    await pm.aiObservabilityPage.navigateToDatasets();
    await pm.aiObservabilityPage.expectNewDatasetBtnVisible();

    await pm.aiObservabilityPage.clickNewDataset();
    await pm.aiObservabilityPage.expectDatasetCreateDrawerVisible();
    await pm.aiObservabilityPage.expectDatasetCreateNameVisible();

    await pm.aiObservabilityPage.closeDatasetCreateDrawer();
    await pm.aiObservabilityPage.expectDatasetCreateDrawerHidden();
    testLogger.info('Test completed');
  });

  test("should load the Playground page with Run All button", {
    tag: ['@ai-observability', '@all']
  }, async ({ page }) => {
    testLogger.info('Navigating to Playground page');
    await pm.aiObservabilityPage.navigateToPlayground();

    await pm.aiObservabilityPage.expectPlaygroundPageVisible();
    await pm.aiObservabilityPage.expectRunAllBtnVisible();
    testLogger.info('Test completed');
  });

  test("should load the Quality page in the online evaluations section", {
    tag: ['@ai-observability', '@all']
  }, async ({ page }) => {
    testLogger.info('Navigating to Quality (online evals) page');
    await pm.aiObservabilityPage.navigateToQuality();

    await pm.aiObservabilityPage.expectQualityPageVisible();
    testLogger.info('Test completed');
  });
});
