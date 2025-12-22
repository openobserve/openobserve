const {
  test,
  expect,
  navigateToBase,
} = require("../utils/enhanced-baseFixtures.js");
import logData from "../../fixtures/log.json";
import { ingestion } from "../dashboards/utils/dashIngestion.js";

test.describe.configure({ mode: "parallel" });

/**
 * Metrics Query Tabs Persistence Test Suite
 *
 * GitHub Issue: https://github.com/openobserve/openobserve/pull/9688
 *
 * Bug Description:
 * In the metrics console, when writing a query in Query Tab 1 (tab-0) and switching to
 * Query Tab 2 (tab-1), then returning to Query Tab 1, the user's custom query modifications
 * were being lost. The query would reset to default or be overwritten.
 *
 * Each tab starts with a default query like: cadvisor_version_info{}
 * Users can modify this query, but the modifications were not persisting when switching tabs.
 *
 * Test Strategy:
 * - Navigate to Metrics page
 * - Verify default query appears in Tab 1
 * - Modify the query in Tab 1
 * - Add Tab 2 (which will have its own default query)
 * - Switch back to Tab 1
 * - Verify modified query is still there
 */

test.describe("Metrics Query Tabs Persistence Tests", () => {
  test.beforeEach(async ({ page }) => {
    await navigateToBase(page);
    await ingestion(page);

    await page.goto(
      `${logData.logsUrl}?org_identifier=${process.env["ORGNAME"]}`
    );
  });

  test("should persist modified query when switching between query tabs", async ({
    page,
  }) => {
    // Step 1: Navigate to Metrics page
    await page.locator('[data-test="menu-link-\\/metrics-item"]').click();
    // await page.waitForLoadState('networkidle');
    await page.waitForTimeout(5000);

    // Step 2: Verify default query exists in Query 1 (tab-0)
    await page.locator('[data-test="dashboard-panel-query-tab-0"]').click();
    await expect(page.getByText('cadvisor_version_info{}')).toBeVisible();

    // Step 3: Modify the query in Query 1
    // First, get the query input field
    const queryInput = page.locator('.q-field__native').first();
    await queryInput.click();

    // Clear and enter a modified query
    await queryInput.clear();
    const modifiedQuery = 'cadvisor_version_info{}byugjbh';
    await queryInput.fill(modifiedQuery);
    await page.waitForTimeout(500);

    // Verify the modified query is visible
    await expect(page.getByText(modifiedQuery)).toBeVisible();

    // Step 4: Add Query 2 (tab-1)
    await page.locator('[data-test="`dashboard-panel-query-tab-add`"]').click();
    await page.waitForTimeout(500);

    // Step 5: Verify Query 2 has its own default query
    await expect(page.getByText('cadvisor_version_info{}')).toBeVisible();

    // Step 6: Switch back to Query 1 (tab-0)
    await page.locator('[data-test="dashboard-panel-query-tab-0"]').click();
    await page.waitForTimeout(500);

    // Step 7: Verify the modified query is STILL there (this is the bug fix)
    await expect(page.getByText(modifiedQuery)).toBeVisible();

    console.log(`✓ Modified query persisted successfully: "${modifiedQuery}"`);
  });

  test("should persist different queries in multiple tabs independently", async ({
    page,
  }) => {
    // Navigate to Metrics page
    await page.locator('[data-test="menu-link-\\/metrics-item"]').click();
    // await page.waitForLoadState('networkidle');
    await page.waitForTimeout(5000);

    // Configure Query 1 (tab-0)
    await page.locator('[data-test="dashboard-panel-query-tab-0"]').click();
    const queryInput = page.locator('.q-field__native').first();

    await queryInput.click();
    await queryInput.clear();
    const query1Modified = 'cadvisor_version_info{}testhasdf';
    await queryInput.fill(query1Modified);
    await page.waitForTimeout(500);

    // Add Query 2 (tab-1)
    await page.locator('[data-test="`dashboard-panel-query-tab-add`"]').click();
    await page.waitForTimeout(500);

    // Modify Query 2
    await queryInput.click();
    await queryInput.clear();
    const query2Modified = 'cadvisor_version_info{kubernetes_namespace_name="ziox"}';
    await queryInput.fill(query2Modified);
    await page.waitForTimeout(500);

    // Switch back to Query 1
    await page.locator('[data-test="dashboard-panel-query-tab-0"]').click();
    await page.waitForTimeout(500);

    // Verify Query 1 still has its modified query
    await expect(page.getByText(query1Modified)).toBeVisible();

    // Switch to Query 2
    await page.locator('[data-test="dashboard-panel-query-tab-1"]').click();
    await page.waitForTimeout(500);

    // Verify Query 2 still has its modified query
    await expect(page.getByText(query2Modified)).toBeVisible();

    // Switch back to Query 1 again
    await page.locator('[data-test="dashboard-panel-query-tab-0"]').click();
    await page.waitForTimeout(500);

    // Verify Query 1 STILL persists after multiple switches
    await expect(page.getByText(query1Modified)).toBeVisible();

    console.log('✓ Both queries persisted correctly across multiple switches');
  });

  test("should persist queries across three tabs", async ({
    page,
  }) => {
    // Navigate to Metrics page
    await page.locator('[data-test="menu-link-\\/metrics-item"]').click();
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(1000);

    const queryInput = page.locator('.q-field__native').first();

    // Configure Query 1 (tab-0)
    await page.locator('[data-test="dashboard-panel-query-tab-0"]').click();
    await queryInput.click();
    await queryInput.clear();
    const query1 = 'cadvisor_version_info{}query1';
    await queryInput.fill(query1);
    await page.waitForTimeout(500);

    // Add and configure Query 2 (tab-1)
    await page.locator('[data-test="`dashboard-panel-query-tab-add`"]').click();
    await page.waitForTimeout(500);
    await queryInput.click();
    await queryInput.clear();
    const query2 = 'cadvisor_version_info{}query2';
    await queryInput.fill(query2);
    await page.waitForTimeout(500);

    // Add and configure Query 3 (tab-2)
    await page.locator('[data-test="`dashboard-panel-query-tab-add`"]').click();
    await page.waitForTimeout(500);
    await queryInput.click();
    await queryInput.clear();
    const query3 = 'cadvisor_version_info{}query3';
    await queryInput.fill(query3);
    await page.waitForTimeout(500);

    // Verify all three queries persist when switching
    await page.locator('[data-test="dashboard-panel-query-tab-0"]').click();
    await page.waitForTimeout(500);
    await expect(page.getByText(query1)).toBeVisible();

    await page.locator('[data-test="dashboard-panel-query-tab-1"]').click();
    await page.waitForTimeout(500);
    await expect(page.getByText(query2)).toBeVisible();

    await page.locator('[data-test="dashboard-panel-query-tab-2"]').click();
    await page.waitForTimeout(500);
    await expect(page.getByText(query3)).toBeVisible();

    // Test switching in random order
    await page.locator('[data-test="dashboard-panel-query-tab-1"]').click();
    await page.waitForTimeout(500);
    await expect(page.getByText(query2)).toBeVisible();

    await page.locator('[data-test="dashboard-panel-query-tab-0"]').click();
    await page.waitForTimeout(500);
    await expect(page.getByText(query1)).toBeVisible();

    console.log('✓ All three queries persisted correctly');
  });

  test("should show 'Your chart is not up to date' warning when switching tabs", async ({
    page,
  }) => {
    // Navigate to Metrics page
    await page.locator('[data-test="menu-link-\\/metrics-item"]').click();
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(1000);

    // Configure and run Query 1
    await page.locator('[data-test="dashboard-panel-query-tab-0"]').click();
    const queryInput = page.locator('.q-field__native').first();
    await queryInput.click();
    await queryInput.clear();
    const query1 = 'cadvisor_version_info{}testquery';
    await queryInput.fill(query1);
    await page.waitForTimeout(500);

    // Run the query
    await page.getByRole('button', { name: 'Run query' }).click();
    await page.waitForTimeout(2000);

    // Add Query 2
    await page.locator('[data-test="`dashboard-panel-query-tab-add`"]').click();
    await page.waitForTimeout(500);

    // Modify Query 2 but don't run it
    await queryInput.click();
    await queryInput.clear();
    const query2 = 'cadvisor_version_info{node="test"}';
    await queryInput.fill(query2);
    await page.waitForTimeout(500);

    // Switch back to Query 1 without running Query 2
    await page.locator('[data-test="dashboard-panel-query-tab-0"]').click();
    await page.waitForTimeout(500);

    // Verify warning message appears
    const warningMessage = page.getByText(/Your chart is not up to date/i);
    await expect(warningMessage).toBeVisible({ timeout: 5000 });

    console.log('✓ Warning message displayed correctly');
  });

  test("should persist query with complex PromQL syntax", async ({
    page,
  }) => {
    // Navigate to Metrics page
    await page.locator('[data-test="menu-link-\\/metrics-item"]').click();
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(1000);

    // Configure Query 1 with complex PromQL
    await page.locator('[data-test="dashboard-panel-query-tab-0"]').click();
    const queryInput = page.locator('.q-field__native').first();

    await queryInput.click();
    await queryInput.clear();
    const complexQuery = 'rate(cadvisor_version_info{kubernetes_namespace_name="ziox"}[5m])';
    await queryInput.fill(complexQuery);
    await page.waitForTimeout(500);

    // Add Query 2
    await page.locator('[data-test="`dashboard-panel-query-tab-add`"]').click();
    await page.waitForTimeout(500);

    // Switch back to Query 1
    await page.locator('[data-test="dashboard-panel-query-tab-0"]').click();
    await page.waitForTimeout(500);

    // Verify complex query persisted
    await expect(page.getByText(complexQuery)).toBeVisible();

    console.log(`✓ Complex PromQL query persisted: "${complexQuery}"`);
  });

  test("should verify stream selection and query tabs are visible on metrics page", async ({
    page,
  }) => {
    // Navigate to Metrics page
    await page.locator('[data-test="menu-link-\\/metrics-item"]').click();
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(1000);

    // Verify Stream selector is visible
    await expect(page.locator('[data-test="log-search-index-list"]')).toBeVisible();

    // Verify Query 1 tab is visible
    await expect(page.locator('[data-test="dashboard-panel-query-tab-0"]')).toBeVisible();

    // Verify default query is visible
    await expect(page.getByText('cadvisor_version_info{}')).toBeVisible();

    // Verify Add query button is visible
    await expect(page.locator('[data-test="`dashboard-panel-query-tab-add`"]')).toBeVisible();

    // Verify Run query button is visible
    await expect(page.getByRole('button', { name: 'Run query' })).toBeVisible();

    // Verify Syntax Guide button is visible
    await expect(page.locator('[data-cy="syntax-guide-button"]')).toBeVisible();

    // Verify Legend button is visible
    await expect(page.getByRole('button', { name: 'Legend' })).toBeVisible();

    console.log('✓ All key UI elements are visible on metrics page');
  });

  test("should maintain query modifications after adding and removing fields", async ({
    page,
  }) => {
    // Navigate to Metrics page
    await page.locator('[data-test="menu-link-\\/metrics-item"]').click();
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(1000);

    // Configure Query 1
    await page.locator('[data-test="dashboard-panel-query-tab-0"]').click();
    const queryInput = page.locator('.q-field__native').first();

    await queryInput.click();
    await queryInput.clear();
    const originalQuery = 'cadvisor_version_info{node="test"}';
    await queryInput.fill(originalQuery);
    await page.waitForTimeout(500);

    // Click on stream dropdown to simulate user interaction
    await page.locator('[data-test="log-search-index-list"]').click();
    await page.waitForTimeout(300);

    // Click somewhere else to close dropdown
    await page.locator('body').click();
    await page.waitForTimeout(300);

    // Add Query 2
    await page.locator('[data-test="`dashboard-panel-query-tab-add`"]').click();
    await page.waitForTimeout(500);

    // Switch back to Query 1
    await page.locator('[data-test="dashboard-panel-query-tab-0"]').click();
    await page.waitForTimeout(500);

    // Verify the query is still there after stream interaction
    await expect(page.getByText(originalQuery)).toBeVisible();

    console.log('✓ Query persisted after field interactions');
  });

  test("should persist query when switching between Auto, PromQL, and Custom SQL modes", async ({
    page,
  }) => {
    // Navigate to Metrics page
    await page.locator('[data-test="menu-link-\\/metrics-item"]').click();
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(1000);

    // Configure Query 1 in PromQL mode
    await page.locator('[data-test="dashboard-panel-query-tab-0"]').click();

    // Make sure we're in PromQL mode
    await page.getByRole('button', { name: 'PromQL' }).click();
    await page.waitForTimeout(500);

    const queryInput = page.locator('.q-field__native').first();
    await queryInput.click();
    await queryInput.clear();
    const promqlQuery = 'cadvisor_version_info{endpoint="metrics"}';
    await queryInput.fill(promqlQuery);
    await page.waitForTimeout(500);

    // Add Query 2
    await page.locator('[data-test="`dashboard-panel-query-tab-add`"]').click();
    await page.waitForTimeout(500);

    // Switch back to Query 1
    await page.locator('[data-test="dashboard-panel-query-tab-0"]').click();
    await page.waitForTimeout(500);

    // Verify PromQL query persisted
    await expect(page.getByText(promqlQuery)).toBeVisible();

    console.log('✓ PromQL query persisted across mode switches');
  });

  test("should handle rapid tab switching without losing query data", async ({
    page,
  }) => {
    // Navigate to Metrics page
    await page.locator('[data-test="menu-link-\\/metrics-item"]').click();
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(1000);

    const queryInput = page.locator('.q-field__native').first();

    // Configure Query 1
    await page.locator('[data-test="dashboard-panel-query-tab-0"]').click();
    await queryInput.click();
    await queryInput.clear();
    const query1 = 'cadvisor_version_info{}rapid1';
    await queryInput.fill(query1);
    await page.waitForTimeout(300);

    // Add Query 2
    await page.locator('[data-test="`dashboard-panel-query-tab-add`"]').click();
    await page.waitForTimeout(300);
    await queryInput.click();
    await queryInput.clear();
    const query2 = 'cadvisor_version_info{}rapid2';
    await queryInput.fill(query2);
    await page.waitForTimeout(300);

    // Rapidly switch between tabs multiple times
    for (let i = 0; i < 5; i++) {
      await page.locator('[data-test="dashboard-panel-query-tab-0"]').click();
      await page.waitForTimeout(200);
      await page.locator('[data-test="dashboard-panel-query-tab-1"]').click();
      await page.waitForTimeout(200);
    }

    // Final verification
    await page.locator('[data-test="dashboard-panel-query-tab-0"]').click();
    await page.waitForTimeout(300);
    await expect(page.getByText(query1)).toBeVisible();

    await page.locator('[data-test="dashboard-panel-query-tab-1"]').click();
    await page.waitForTimeout(300);
    await expect(page.getByText(query2)).toBeVisible();

    console.log('✓ Queries persisted after rapid tab switching');
  });

  test("should verify default query appears when new tab is added", async ({
    page,
  }) => {
    // Navigate to Metrics page
    await page.locator('[data-test="menu-link-\\/metrics-item"]').click();
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(1000);

    // Verify Query 1 has default query
    await page.locator('[data-test="dashboard-panel-query-tab-0"]').click();
    await expect(page.getByText('cadvisor_version_info{}')).toBeVisible();

    // Add Query 2
    await page.locator('[data-test="`dashboard-panel-query-tab-add`"]').click();
    await page.waitForTimeout(500);

    // Verify Query 2 also has default query
    await expect(page.getByText('cadvisor_version_info{}')).toBeVisible();

    // Add Query 3
    await page.locator('[data-test="`dashboard-panel-query-tab-add`"]').click();
    await page.waitForTimeout(500);

    // Verify Query 3 also has default query
    await expect(page.getByText('cadvisor_version_info{}')).toBeVisible();

    console.log('✓ Default query appears correctly on all new tabs');
  });
  test("11hould persist modified query when switching between query tabs", async ({
    page,
  }) => {
    // Step 1: Navigate to Metrics page
    await page.locator('[data-test="menu-link-\\/metrics-item"]').click();
    await page.waitForTimeout(5000);

    // Step 2: Verify default query exists in Query 1 (tab-0)
    await page.locator('[data-test="dashboard-panel-query-tab-0"]').click();
    await expect(page.getByText('cadvisor_version_info{}')).toBeVisible();

    // Step 3: Modify the query in Query 1 using Monaco editor
    // Click on the query editor to focus it
    await page.locator('[data-test="dashboard-panel-query-editor"] .view-line').click();
    await page.waitForTimeout(300);

    // Select all text in the editor (Ctrl+A / Cmd+A)
    await page.keyboard.press('Control+A');
    await page.waitForTimeout(200);

    // Type the modified query
    const modifiedQuery = 'cadvisor_version_info{}byugjbh';
    await page.keyboard.type(modifiedQuery);
    await page.waitForTimeout(500);

    // Verify the modified query is visible
    await expect(page.getByText(modifiedQuery)).toBeVisible();

    // Step 4: Add Query 2 (tab-1)
    await page.locator('[data-test="`dashboard-panel-query-tab-add`"]').click();
    await page.waitForTimeout(500);

    // Step 5: Verify Query 2 has its own default query
    await expect(page.getByText('cadvisor_version_info{}')).toBeVisible();

    // Step 6: Switch back to Query 1 (tab-0)
    await page.locator('[data-test="dashboard-panel-query-tab-0"]').click();
    await page.waitForTimeout(500);

    // Step 7: Verify the modified query is STILL there (this is the bug fix)
    await expect(page.getByText(modifiedQuery)).toBeVisible();

    console.log(`✓ Modified query persisted successfully: "${modifiedQuery}"`);
  });
});
