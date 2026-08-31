// Copyright 2026 OpenObserve Inc.
// AI Observability Experiments — E2E tests
//
// Covers the /ai/* rail's Experiments + Playground surfaces: the experiments
// list shell, the create/clone form (sections + validation), and the playground
// bench (render + reset confirmation).
//
// Data-dependent scenarios (grouped list, detail, compare, clone) are recorded as
// test.fixme — they need seeded datasets/experiments/providers/scorers that no
// setup contract provided at generation time. The bodies stay intact so they go
// green once a global-setup seed exists.

const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const PageManager = require('../../pages/page-manager.js');

// AI Observability is enterprise-only — its /ai/* routes are absent on the OSS
// binary. Cache the availability probe so only the first test in a worker pays
// the navigation cost; the rest skip immediately on OSS and run fully on ENT.
const featureAvailable = {};

// Seeded fixture ids the data-dependent (fixme) tests will use once global-setup
// provides them. Sourced from env so the Healer can point them at real records.
const SEEDED_EXPERIMENT_ID = process.env['AI_EXPERIMENT_ID'] || 'exp_seed_001';
const SEEDED_BASELINE_ID = process.env['AI_BASELINE_ID'] || 'exp_seed_baseline';
const SEEDED_CANDIDATE_ID = process.env['AI_CANDIDATE_ID'] || 'exp_seed_candidate';

test.describe('AI Observability Experiments testcases', () => {
  test.describe.configure({ mode: 'parallel' });
  let pm;

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    await navigateToBase(page);
    pm = new PageManager(page);
    if (featureAvailable['ai-observability'] === false) {
      test.skip(true, 'AI Observability is an enterprise-only feature — absent in the OSS build');
      return;
    }
    featureAvailable['ai-observability'] = await pm.aiObservabilityPage.probeAvailability();
    if (!featureAvailable['ai-observability']) {
      test.skip(true, 'AI Observability is an enterprise-only feature — absent in the OSS build');
      return;
    }
    testLogger.info('Test setup completed');
  });

  test('should render the experiments page shell with the new experiment button', {
    tag: ['@ai-observability-experiments', '@all', '@P0', '@smoke'],
  }, async ({ page }) => {
    testLogger.info('Verifying the experiments list shell renders');
    await pm.aiObservabilityPage.gotoExperiments();
    await pm.aiObservabilityPage.expectExperimentsPageVisible();
    await pm.aiObservabilityPage.expectNewButtonVisible();
    testLogger.info('Experiments page shell verified');
  });

  test('should load the create experiment form with identity, task and scorers sections', {
    tag: ['@ai-observability-experiments', '@all', '@P0', '@smoke'],
  }, async ({ page }) => {
    testLogger.info('Verifying the create experiment form mounts');
    await pm.experimentFormPage.gotoCreateForm();
    await pm.experimentFormPage.expectCreateTitleVisible();
    await pm.experimentFormPage.expectSectionsVisible();
    await pm.experimentFormPage.expectSubmitButtonVisible();
    testLogger.info('Create experiment form sections verified');
  });

  test('should surface validation errors when the create form is submitted empty', {
    tag: ['@ai-observability-experiments', '@all', '@P1', '@validation'],
  }, async ({ page }) => {
    testLogger.info('Verifying empty-submit validation on the create form');
    await pm.experimentFormPage.gotoCreateForm();
    await pm.experimentFormPage.expectSubmitButtonVisible();
    await pm.experimentFormPage.clickSubmit();
    await pm.experimentFormPage.expectNameErrorVisible();
    // The form must stay mounted — a blocked submit never navigates away.
    await pm.experimentFormPage.expectCreateTitleVisible();
    testLogger.info('Empty-submit validation verified');
  });

  test('should render the playground bench with the run-all control and variable bar', {
    tag: ['@ai-observability-experiments', '@all', '@P0', '@smoke'],
  }, async ({ page }) => {
    testLogger.info('Verifying the playground bench renders');
    await pm.playgroundPage.gotoPlayground();
    await pm.playgroundPage.expectPlaygroundPageVisible();
    await pm.playgroundPage.expectTitleVisible();
    await pm.playgroundPage.expectRunAllButtonVisible();
    await pm.playgroundPage.expectVariableBarVisible();
    await pm.playgroundPage.expectWindowCountVisible();
    testLogger.info('Playground bench verified');
  });

  test('should ask for confirmation before resetting the playground', {
    tag: ['@ai-observability-experiments', '@all', '@P2'],
  }, async ({ page }) => {
    testLogger.info('Verifying the playground reset confirmation');
    await pm.playgroundPage.gotoPlayground();
    await pm.playgroundPage.expectPlaygroundPageVisible();
    await pm.playgroundPage.clickReset();
    await pm.playgroundPage.expectConfirmDialogVisible();
    await pm.playgroundPage.clickConfirmCancel();
    await pm.playgroundPage.expectConfirmDialogHidden();
    await pm.playgroundPage.expectPlaygroundPageVisible();
    testLogger.info('Playground reset confirmation verified');
  });

  test.fixme('should render the experiments list grouped by dataset — data-blocked: needs a seeded dataset with experiments', {
    tag: ['@ai-observability-experiments', '@all', '@P0', '@smoke'],
  }, async ({ page }) => {
    testLogger.info('Verifying the experiments list groups by dataset');
    await pm.aiObservabilityPage.gotoExperiments();
    await pm.aiObservabilityPage.expectExperimentsPageVisible();
    await pm.aiObservabilityPage.expectExperimentsGroupedVisible();
    testLogger.info('Experiments list grouping verified');
  });

  test.fixme('should render the experiment detail page with meta and results table — data-blocked: needs a seeded experiment', {
    tag: ['@ai-observability-experiments', '@all', '@P0', '@smoke'],
  }, async ({ page }) => {
    testLogger.info('Verifying the experiment detail page renders');
    await pm.aiObservabilityPage.gotoDetail(SEEDED_EXPERIMENT_ID);
    await pm.aiObservabilityPage.expectDetailPageVisible();
    await pm.aiObservabilityPage.expectDetailMetaVisible();
    await pm.aiObservabilityPage.expectDetailTableVisible();
    testLogger.info('Experiment detail page verified');
  });

  test.fixme('should render the compare page for a baseline and candidate pair — data-blocked: needs two seeded experiments', {
    tag: ['@ai-observability-experiments', '@all', '@P0', '@smoke'],
  }, async ({ page }) => {
    testLogger.info('Verifying the compare page renders');
    await pm.aiObservabilityPage.gotoCompare(SEEDED_BASELINE_ID, SEEDED_CANDIDATE_ID);
    await pm.aiObservabilityPage.expectComparePageVisible();
    await pm.aiObservabilityPage.expectComparisonOrEmptyVisible();
    testLogger.info('Compare page verified');
  });

  test.fixme('should lock the dataset and show the clone title when cloning an experiment — data-blocked: needs a seeded cloneable experiment', {
    tag: ['@ai-observability-experiments', '@all', '@P1', '@clone'],
  }, async ({ page }) => {
    testLogger.info('Verifying the clone form locks the dataset');
    await pm.experimentFormPage.gotoCloneForm(SEEDED_EXPERIMENT_ID);
    await pm.experimentFormPage.expectCloneTitleVisible();
    await pm.experimentFormPage.expectDatasetSelectDisabled();
    testLogger.info('Clone form dataset lock verified');
  });
});
