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

  test("should auto-update SQL query FROM clause when stream changes", {
    tag: ['@smoke', '@P0']
  }, async ({ page }) => {
    testLogger.info('Testing basic stream change updates query FROM clause');

    // Navigate to pipelines
    await pageManager.pipelinesPage.openPipelineMenu();
    await page.waitForTimeout(1000);

    // Add new pipeline
    await pageManager.pipelinesPage.addPipeline();

    // Drag Query button to canvas - opens Query form dialog
    await pageManager.pipelinesPage.dragStreamToTarget(pageManager.pipelinesPage.queryButton);
    await page.waitForTimeout(500);

    // Wait for scheduled pipeline form dialog to load
    await page.locator('[data-test="scheduled-pipeline-tabs"]').waitFor({ state: 'visible', timeout: 10000 });
    await page.waitForTimeout(1000);

    // Expand "Build Query" section
    const buildQuerySection = page.locator('text=Build Query').first();
    await buildQuerySection.waitFor({ state: 'visible', timeout: 5000 });
    await buildQuerySection.click();
    await page.waitForTimeout(500);

    // Select stream type (logs)
    testLogger.info('Selecting stream type: logs');
    await page.getByLabel(/Stream Type/i).click();
    await page.waitForTimeout(500);
    await page.getByRole("option", { name: "logs", exact: true }).click();
    await page.waitForTimeout(1000);

    // Select first stream (e2e_automate)
    testLogger.info('Selecting first stream: e2e_automate');
    await page.getByLabel(/Stream Name/i).click();
    await page.waitForTimeout(500);
    await page.getByLabel(/Stream Name/i).fill('e2e_automate');
    await page.waitForTimeout(1000);
    await page.getByRole("option", { name: "e2e_automate", exact: true }).click();
    await page.waitForTimeout(1000);

    // Verify default query generated
    const sqlEditor = page.locator('[data-test="scheduled-pipeline-sql-editor"]');
    await expect(sqlEditor).toBeVisible({ timeout: 10000 });

    // Get query text from Monaco editor
    const queryText1Raw = await page.locator('.monaco-editor .view-lines').textContent();
    const queryText1 = queryText1Raw?.trim().replace(/\s+/g, ' '); // Normalize whitespace
    testLogger.info(`Initial query: ${queryText1}`);
    expect(queryText1).toMatch(/FROM\s+"e2e_automate"/); // Use regex to handle potential spacing

    // Change stream to k8s_json
    testLogger.info('Changing stream to k8s_json');
    await page.getByLabel(/Stream Name/i).click();
    await page.waitForTimeout(500);
    await page.getByLabel(/Stream Name/i).fill('k8s_json');
    await page.waitForTimeout(1000);
    await page.getByRole("option", { name: "k8s_json", exact: true }).click();
    await page.waitForTimeout(2000); // Wait for watcher to trigger

    // Verify query updated
    const queryText2Raw = await page.locator('.monaco-editor .view-lines').textContent();
    const queryText2 = queryText2Raw?.trim().replace(/\s+/g, ' '); // Normalize whitespace
    testLogger.info(`Updated query: ${queryText2}`);

    expect(queryText2).toMatch(/FROM\s+"k8s_json"/); // Use regex to handle potential spacing
    expect(queryText2).not.toMatch(/FROM\s+"e2e_automate"/);

    testLogger.info('✅ Test passed: FROM clause auto-updated correctly');
  });

  test("should preserve WHERE clause when stream changes", {
    tag: ['@functional', '@P1']
  }, async ({ page }) => {
    testLogger.info('Testing WHERE clause preservation');

    await pageManager.pipelinesPage.openPipelineMenu();
    await page.waitForTimeout(1000);
    await pageManager.pipelinesPage.addPipeline();

    // Drag Query button to canvas - opens Query form dialog
    await pageManager.pipelinesPage.dragStreamToTarget(pageManager.pipelinesPage.queryButton);
    await page.waitForTimeout(500);

    // Wait for scheduled pipeline form dialog to load
    await page.locator('[data-test="scheduled-pipeline-tabs"]').waitFor({ state: 'visible', timeout: 10000 });
    await page.waitForTimeout(1000);

    // Expand "Build Query" section
    const buildQuerySection2 = page.locator('text=Build Query').first();
    await buildQuerySection2.waitFor({ state: 'visible', timeout: 5000 });
    await buildQuerySection2.click();
    await page.waitForTimeout(500);

    // Select stream type (logs)
    await page.getByLabel(/Stream Type/i).click();
    await page.waitForTimeout(500);
    await page.getByRole("option", { name: "logs", exact: true }).click();
    await page.waitForTimeout(1000);

    // Select stream
    await page.getByLabel(/Stream Name/i).click();
    await page.waitForTimeout(500);
    await page.getByLabel(/Stream Name/i).fill('e2e_automate');
    await page.waitForTimeout(1000);
    await page.getByRole("option", { name: "e2e_automate", exact: true }).click();
    await page.waitForTimeout(1000);

    // Edit query to add WHERE clause
    testLogger.info('Adding WHERE clause to query');
    const monacoEditor = page.locator('.monaco-editor .inputarea').first();
    await monacoEditor.click({ force: true }); // Force click to bypass element interception
    await page.waitForTimeout(500);

    // Select all and replace with query containing WHERE
    await page.keyboard.press('Control+A');
    await page.keyboard.press('Delete');
    await page.keyboard.type('SELECT * FROM "e2e_automate" WHERE status = \'error\'');
    await page.waitForTimeout(1000);

    // Verify WHERE clause is in query
    let queryTextRaw = await page.locator('.monaco-editor .view-lines').textContent();
    let queryText = queryTextRaw?.trim().replace(/\s+/g, ' ');
    testLogger.info(`Query with WHERE: ${queryText}`);
    expect(queryText).toContain('WHERE');
    expect(queryText).toContain('status');

    // Change stream
    testLogger.info('Changing stream to k8s_json');
    await page.getByLabel(/Stream Name/i).click();
    await page.waitForTimeout(500);
    await page.getByLabel(/Stream Name/i).fill('k8s_json');
    await page.waitForTimeout(1000);
    await page.getByRole("option", { name: "k8s_json", exact: true }).click();
    await page.waitForTimeout(2000);

    // Verify FROM updated but WHERE preserved
    const queryText2Raw = await page.locator('.monaco-editor .view-lines').textContent();
    queryText = queryText2Raw?.trim().replace(/\s+/g, ' '); // Normalize whitespace
    testLogger.info(`Updated query: ${queryText}`);

    expect(queryText).toMatch(/FROM\s+["']k8s_json["']/); // Use regex for flexible quote matching
    expect(queryText).toContain('WHERE');
    expect(queryText).toContain('status');

    testLogger.info('✅ Test passed: WHERE clause preserved');
  });

  test("should preserve complex query clauses when stream changes", {
    tag: ['@functional', '@P1']
  }, async ({ page }) => {
    testLogger.info('Testing complex query preservation (SELECT, WHERE, ORDER BY, LIMIT)');

    await pageManager.pipelinesPage.openPipelineMenu();
    await page.waitForTimeout(1000);
    await pageManager.pipelinesPage.addPipeline();

    // Drag Query button to canvas - opens Query form dialog
    await pageManager.pipelinesPage.dragStreamToTarget(pageManager.pipelinesPage.queryButton);
    await page.waitForTimeout(500);

    // Wait for scheduled pipeline form dialog to load
    await page.locator('[data-test="scheduled-pipeline-tabs"]').waitFor({ state: 'visible', timeout: 10000 });
    await page.waitForTimeout(1000);

    // Expand "Build Query" section
    const buildQuerySection3 = page.locator('text=Build Query').first();
    await buildQuerySection3.waitFor({ state: 'visible', timeout: 5000 });
    await buildQuerySection3.click();
    await page.waitForTimeout(500);

    // Select stream type (logs)
    await page.getByLabel(/Stream Type/i).click();
    await page.waitForTimeout(500);
    await page.getByRole("option", { name: "logs", exact: true }).click();
    await page.waitForTimeout(1000);

    // Select stream
    await page.getByLabel(/Stream Name/i).click();
    await page.waitForTimeout(500);
    await page.getByLabel(/Stream Name/i).fill('e2e_automate');
    await page.waitForTimeout(1000);
    await page.getByRole("option", { name: "e2e_automate", exact: true }).click();
    await page.waitForTimeout(1000);

    // Create complex query
    testLogger.info('Creating complex query with SELECT, WHERE, ORDER BY, LIMIT');
    const monacoEditor = page.locator('.monaco-editor .inputarea').first();
    await monacoEditor.click({ force: true }); // Force click to bypass element interception
    await page.waitForTimeout(500);

    await page.keyboard.press('Control+A');
    await page.keyboard.press('Delete');
    const complexQuery = 'SELECT field1, field2, COUNT(*) as total FROM "e2e_automate" WHERE status = \'error\' GROUP BY field1 ORDER BY total DESC LIMIT 100';
    await page.keyboard.type(complexQuery);
    await page.waitForTimeout(1000);

    // Verify complex query
    let queryTextRaw = await page.locator('.monaco-editor .view-lines').textContent();
    let queryText = queryTextRaw?.trim().replace(/\s+/g, ' ');
    testLogger.info(`Complex query: ${queryText}`);
    expect(queryText).toContain('SELECT field1, field2');
    expect(queryText).toContain('COUNT(*)');
    expect(queryText).toContain('WHERE');
    expect(queryText).toContain('GROUP BY');
    expect(queryText).toContain('ORDER BY');
    expect(queryText).toContain('LIMIT 100');

    // Change stream
    testLogger.info('Changing stream while preserving all clauses');
    await page.getByLabel(/Stream Name/i).click();
    await page.waitForTimeout(500);
    await page.getByLabel(/Stream Name/i).fill('k8s_json');
    await page.waitForTimeout(1000);
    await page.getByRole("option", { name: "k8s_json", exact: true }).click();
    await page.waitForTimeout(2000);

    // Verify all clauses preserved
    queryTextRaw = await page.locator('.monaco-editor .view-lines').textContent();
    queryText = queryTextRaw?.trim().replace(/\s+/g, ' ');
    testLogger.info(`Updated complex query: ${queryText}`);

    expect(queryText).toMatch(/FROM\s+["']k8s_json["']/);
    expect(queryText).toContain('SELECT field1, field2');
    expect(queryText).toContain('COUNT(*)');
    expect(queryText).toContain('WHERE');
    expect(queryText).toContain('GROUP BY');
    expect(queryText).toContain('ORDER BY');
    expect(queryText).toContain('LIMIT 100');

    testLogger.info('✅ Test passed: All query clauses preserved');
  });

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
    await page.locator('[data-test="scheduled-pipeline-tabs"]').waitFor({ state: 'visible', timeout: 10000 });
    await page.waitForTimeout(1000);

    // Verify query is empty initially (or not visible)
    testLogger.info('Verifying empty state');

    // Expand "Build Query" section
    const buildQuerySection4 = page.locator('text=Build Query').first();
    await buildQuerySection4.waitFor({ state: 'visible', timeout: 5000 });
    await buildQuerySection4.click();
    await page.waitForTimeout(500);

    // Select stream type (logs)
    await page.getByLabel(/Stream Type/i).click();
    await page.waitForTimeout(500);
    await page.getByRole("option", { name: "logs", exact: true }).click();
    await page.waitForTimeout(1000);

    // Select first stream
    await page.getByLabel(/Stream Name/i).click();
    await page.waitForTimeout(500);
    await page.getByLabel(/Stream Name/i).fill('e2e_automate');
    await page.waitForTimeout(1000);
    await page.getByRole("option", { name: "e2e_automate", exact: true }).click();
    await page.waitForTimeout(1000);

    // Verify default query generated
    const sqlEditor = page.locator('[data-test="scheduled-pipeline-sql-editor"]');
    await expect(sqlEditor).toBeVisible({ timeout: 10000 });

    const queryTextRaw = await page.locator('.monaco-editor .view-lines').textContent();
    const queryText = queryTextRaw?.trim().replace(/\s+/g, ' ');
    testLogger.info(`Default query: ${queryText}`);

    expect(queryText).toMatch(/SELECT \* FROM\s+["']e2e_automate["']/);

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
    await page.locator('[data-test="scheduled-pipeline-tabs"]').waitFor({ state: 'visible', timeout: 10000 });
    await page.waitForTimeout(1000);

    // Expand "Build Query" section
    const buildQuerySection5 = page.locator('text=Build Query').first();
    await buildQuerySection5.waitFor({ state: 'visible', timeout: 5000 });
    await buildQuerySection5.click();
    await page.waitForTimeout(500);

    // Select stream type (metrics) - PromQL only enabled for metrics
    await page.getByLabel(/Stream Type/i).click();
    await page.waitForTimeout(500);
    await page.getByRole("option", { name: "metrics", exact: true }).click();
    await page.waitForTimeout(1000);

    // Select a metrics stream in SQL tab
    await page.getByLabel(/Stream Name/i).click();
    await page.waitForTimeout(500);
    // Note: We'll use any available metrics stream
    const streamOptions = page.getByRole("option").filter({ hasText: /^[a-z0-9_]+$/ }).first();
    await streamOptions.click();
    await page.waitForTimeout(2000);

    // Get SQL query text
    let queryTextRaw = await page.locator('.monaco-editor .view-lines').textContent();
    let queryText = queryTextRaw?.trim().replace(/\s+/g, ' ');
    testLogger.info(`Initial SQL query: ${queryText}`);
    expect(queryText).toMatch(/FROM\s+["'][a-z0-9_]+["']/); // Should have a FROM clause

    // Switch to PromQL tab (now enabled because we selected metrics)
    testLogger.info('Switching to PromQL tab');
    const promqlTab = page.locator('[data-test="scheduled-pipeline-tabs"]').getByRole('button', { name: /PromQL/i });
    await promqlTab.waitFor({ state: 'visible', timeout: 5000 });
    await promqlTab.click();
    await page.waitForTimeout(1000);

    // Verify we're on PromQL tab
    testLogger.info('Verifying PromQL tab active');

    // Switch back to SQL tab
    testLogger.info('Switching back to SQL tab');
    const sqlTab = page.locator('[data-test="scheduled-pipeline-tabs"]').getByRole('button', { name: /SQL/i });
    await sqlTab.click();
    await page.waitForTimeout(1000);

    // Verify SQL query still exists (tab switching doesn't affect SQL query)
    queryTextRaw = await page.locator('.monaco-editor .view-lines').textContent();
    queryText = queryTextRaw?.trim().replace(/\s+/g, ' ');
    testLogger.info(`SQL query after tab switch: ${queryText}`);
    expect(queryText).toMatch(/FROM\s+["'][a-z0-9_]+["']/); // Should still have FROM clause

    testLogger.info('✅ Test passed: PromQL tab independent of SQL watcher');
  });

  test("should not overwrite manual query edits (manual edit protection)", {
    tag: ['@edgeCase', '@P2']
  }, async ({ page }) => {
    testLogger.info('Testing manual edit protection');

    await pageManager.pipelinesPage.openPipelineMenu();
    await page.waitForTimeout(1000);
    await pageManager.pipelinesPage.addPipeline();

    // Drag Query button to canvas - opens Query form dialog
    await pageManager.pipelinesPage.dragStreamToTarget(pageManager.pipelinesPage.queryButton);
    await page.waitForTimeout(500);

    // Wait for scheduled pipeline form dialog to load
    await page.locator('[data-test="scheduled-pipeline-tabs"]').waitFor({ state: 'visible', timeout: 10000 });
    await page.waitForTimeout(1000);

    // Expand "Build Query" section
    const buildQuerySection6 = page.locator('text=Build Query').first();
    await buildQuerySection6.waitFor({ state: 'visible', timeout: 5000 });
    await buildQuerySection6.click();
    await page.waitForTimeout(500);

    // Select stream type (logs)
    await page.getByLabel(/Stream Type/i).click();
    await page.waitForTimeout(500);
    await page.getByRole("option", { name: "logs", exact: true }).click();
    await page.waitForTimeout(1000);

    // Select stream
    await page.getByLabel(/Stream Name/i).click();
    await page.waitForTimeout(500);
    await page.getByLabel(/Stream Name/i).fill('e2e_automate');
    await page.waitForTimeout(1000);
    await page.getByRole("option", { name: "e2e_automate", exact: true }).click();
    await page.waitForTimeout(1000);

    // Verify default query
    let queryTextRaw = await page.locator('.monaco-editor .view-lines').textContent();
    let queryText = queryTextRaw?.trim().replace(/\s+/g, ' ');
    expect(queryText).toMatch(/FROM\s+["']e2e_automate["']/);

    // Manually change FROM clause to different stream
    testLogger.info('Manually changing FROM clause to "manual_stream"');
    const monacoEditor = page.locator('.monaco-editor .inputarea').first();
    await monacoEditor.click({ force: true }); // Force click to bypass element interception
    await page.waitForTimeout(500);

    await page.keyboard.press('Control+A');
    await page.keyboard.press('Delete');
    await page.keyboard.type('SELECT * FROM "manual_stream"');
    await page.waitForTimeout(1000);

    // Verify manual edit
    queryTextRaw = await page.locator('.monaco-editor .view-lines').textContent();
    queryText = queryTextRaw?.trim().replace(/\s+/g, ' ');
    expect(queryText).toMatch(/FROM\s+["']manual_stream["']/);

    // Change dropdown to k8s_json
    testLogger.info('Changing dropdown to k8s_json (should NOT update query)');
    await page.getByLabel(/Stream Name/i).click();
    await page.waitForTimeout(500);
    await page.getByLabel(/Stream Name/i).fill('k8s_json');
    await page.waitForTimeout(1000);
    await page.getByRole("option", { name: "k8s_json", exact: true }).click();
    await page.waitForTimeout(2000);

    // Verify query unchanged (manual edit protected)
    queryTextRaw = await page.locator('.monaco-editor .view-lines').textContent();
    queryText = queryTextRaw?.trim().replace(/\s+/g, ' ');
    testLogger.info(`Query after dropdown change: ${queryText}`);

    expect(queryText).toMatch(/FROM\s+["']manual_stream["']/);
    expect(queryText).not.toMatch(/FROM\s+["']k8s_json["']/);

    testLogger.info('✅ Test passed: Manual edits protected');
  });
});
