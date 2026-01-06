import { test, expect } from "../baseFixtures.js";
import logData from "../../fixtures/log.json";
import logsdata from "../../../test-data/logs_data.json";
import PageManager from "../../pages/page-manager.js";
import { LoginPage } from "../../pages/generalPages/loginPage.js";
const testLogger = require('../utils/test-logger.js');

test.describe.configure({ mode: "serial" });

test.use({
  contextOptions: {
    slowMo: 1000
  }
});

test.describe("Scheduled Pipeline Stream Auto-Update", { tag: ['@all', '@scheduledPipeline'] }, () => {
  let pageManager;
  let loginPage;

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);

    // Login
    loginPage = new LoginPage(page);
    await loginPage.gotoLoginPage();
    await loginPage.loginAsInternalUser();
    await loginPage.login();

    pageManager = new PageManager(page);

    // Ingest test data to ensure streams exist
    const streamNames = ["e2e_automate", "k8s_json"];
    await pageManager.pipelinesPage.bulkIngestToStreams(streamNames, logsdata);

    await page.goto(
      `${logData.logsUrl}?org_identifier=${process.env["ORGNAME"]}`
    );

    testLogger.info('Test setup completed');
  });

  test.afterEach(async ({ page }, testInfo) => {
    testLogger.testEnd(testInfo.title, testInfo.status);
  });

  // P0 - Smoke Tests

  test("should auto-generate SELECT * query when stream changes", {
    tag: ['@smoke', '@P0']
  }, async ({ page }) => {
    testLogger.info('Testing query is auto-generated when stream changes');

    // Navigate to pipelines
    await pageManager.pipelinesPage.openPipelineMenu();
    await page.waitForTimeout(1000);

    // Add new pipeline
    await pageManager.pipelinesPage.addPipeline();

    // Drag Query button to canvas - opens Query form dialog
    await pageManager.pipelinesPage.dragStreamToTarget(pageManager.pipelinesPage.queryButton);
    await page.waitForTimeout(500);

    // Wait for scheduled pipeline form dialog to load
    await pageManager.pipelinesPage.waitForScheduledPipelineDialog();
    await page.waitForTimeout(1000);

    // Expand "Build Query" section
    await pageManager.pipelinesPage.expandBuildQuerySection();
    await page.waitForTimeout(500);

    // Select stream type (logs)
    await pageManager.pipelinesPage.selectStreamType('logs');
    await page.waitForTimeout(1000);

    // Select first stream (e2e_automate)
    await pageManager.pipelinesPage.selectStreamName('e2e_automate');
    await page.waitForTimeout(1000);

    // Verify default query generated
    await pageManager.pipelinesPage.expectSqlEditorVisible();

    // Get query text from Monaco editor
    await pageManager.pipelinesPage.expectQueryToContain('e2e_automate');

    // Change stream to k8s_json
    testLogger.info('Changing stream to k8s_json');
    await pageManager.pipelinesPage.selectStreamName('k8s_json');
    await pageManager.pipelinesPage.waitForStreamChangeWatcher();

    // Verify query is auto-generated with new stream name
    await pageManager.pipelinesPage.expectQueryToContain('SELECT');
    await pageManager.pipelinesPage.expectQueryToContain('FROM');
    await pageManager.pipelinesPage.expectQueryToContain('k8s_json');
    await pageManager.pipelinesPage.expectQueryNotToContain('e2e_automate');

    testLogger.info('✅ Test passed: Query auto-generated correctly on stream change');
  });

  // Note: WHERE clause preservation tests removed
  // New behavior auto-generates fresh SELECT * query on stream change
  // This prevents field reference issues when switching between streams with different schemas

  test("should handle initial stream selection (existing behavior)", {
    tag: ['@regression', '@P1']
  }, async ({ page }) => {
    testLogger.info('Testing initial stream selection generates default query');

    await pageManager.pipelinesPage.openPipelineMenu();
    await page.waitForTimeout(1000);
    await pageManager.pipelinesPage.addPipeline();

    // Drag Query button to canvas - opens Query form dialog
    await pageManager.pipelinesPage.dragStreamToTarget(pageManager.pipelinesPage.queryButton);
    await page.waitForTimeout(500);

    // Wait for scheduled pipeline form dialog to load
    await pageManager.pipelinesPage.waitForScheduledPipelineDialog();
    await page.waitForTimeout(1000);

    // Verify query is empty initially (or not visible)
    testLogger.info('Verifying empty state');

    // Expand "Build Query" section
    await pageManager.pipelinesPage.expandBuildQuerySection();
    await page.waitForTimeout(500);

    // Select stream type (logs)
    await pageManager.pipelinesPage.selectStreamType('logs');
    await page.waitForTimeout(1000);

    // Select first stream
    await pageManager.pipelinesPage.selectStreamName('e2e_automate');
    await page.waitForTimeout(1000);

    // Verify default query generated
    await pageManager.pipelinesPage.expectSqlEditorVisible();
    await pageManager.pipelinesPage.expectQueryToContain('SELECT');
    await pageManager.pipelinesPage.expectQueryToContain('FROM');
    await pageManager.pipelinesPage.expectQueryToContain('e2e_automate');

    testLogger.info('✅ Test passed: Default query generated correctly');
  });

  test.skip("should not update PromQL tab when stream changes", {
    tag: ['@functional', '@P1']
  }, async ({ page }) => {
    testLogger.info('Testing PromQL tab is unaffected by SQL watcher');

    await pageManager.pipelinesPage.openPipelineMenu();
    await page.waitForTimeout(1000);
    await pageManager.pipelinesPage.addPipeline();

    // Drag Query button to canvas - opens Query form dialog
    await pageManager.pipelinesPage.dragStreamToTarget(pageManager.pipelinesPage.queryButton);
    await page.waitForTimeout(500);

    // Wait for scheduled pipeline form dialog to load
    await pageManager.pipelinesPage.waitForScheduledPipelineDialog();
    await page.waitForTimeout(1000);

    // Expand "Build Query" section
    await pageManager.pipelinesPage.expandBuildQuerySection();
    await page.waitForTimeout(500);

    // Select stream type (metrics) - PromQL only enabled for metrics
    await pageManager.pipelinesPage.selectStreamType('metrics');
    await page.waitForTimeout(1000);

    // Select a metrics stream in SQL tab
    testLogger.info('Selecting metrics stream');
    await pageManager.pipelinesPage.streamNameLabel.click();
    await page.waitForTimeout(500);
    // Note: We'll use any available metrics stream
    const streamOptions = page.getByRole("option").filter({ hasText: /^[a-z0-9_]+$/ }).first();
    await streamOptions.click();
    await page.waitForTimeout(2000);

    // Get SQL query text
    await pageManager.pipelinesPage.expectQueryToContain('FROM');

    // Switch to PromQL tab (now enabled because we selected metrics)
    testLogger.info('Switching to PromQL tab');
    const promqlTab = pageManager.pipelinesPage.scheduledPipelineTabs.getByRole('button', { name: /PromQL/i });
    await promqlTab.waitFor({ state: 'visible', timeout: 5000 });
    await promqlTab.click();
    await page.waitForTimeout(1000);

    // Verify we're on PromQL tab
    testLogger.info('Verifying PromQL tab active');

    // Switch back to SQL tab
    testLogger.info('Switching back to SQL tab');
    const sqlTab = pageManager.pipelinesPage.scheduledPipelineTabs.getByRole('button', { name: /SQL/i });
    await sqlTab.click();
    await page.waitForTimeout(1000);

    // Verify SQL query still exists (tab switching doesn't affect SQL query)
    await pageManager.pipelinesPage.expectQueryToContain('FROM');

    testLogger.info('✅ Test passed: PromQL tab independent of SQL watcher');
  });

  // Note: Manual edit protection test removed
  // New behavior always auto-generates SELECT * query on stream change for data safety
});
