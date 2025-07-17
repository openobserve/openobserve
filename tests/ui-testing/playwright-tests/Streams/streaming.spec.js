import { test, expect } from "../baseFixtures.js";
import PageManager from '../../pages/page-manager.js';

test.describe.configure({ mode: 'parallel' });

test.describe("Streaming for logs", () => {
  let pageManager;

  test.beforeEach(async ({ page }) => {
    pageManager = new PageManager(page);
    await pageManager.loginPage.gotoLoginPage();
    await pageManager.loginPage.loginAsInternalUser();
    await pageManager.loginPage.login(); // Login as root user
    await pageManager.ingestionPage.ingestion();
    await pageManager.ingestionPage.ingestionJoin();
    await pageManager.managementPage.goToManagement();
    await page.waitForTimeout(3000); // Reduced from 5000
    await pageManager.managementPage.checkStreaming();
  });

  test("Run query after selecting two streams after enabling streaming", {
    tag: ['@streaming', '@all', '@streams']
  }, async ({ page }) => {
    await pageManager.logsPage.navigateToLogs();
    await pageManager.logsPage.selectIndexAndStreamJoin();
    await pageManager.logsPage.displayTwoStreams();
    await pageManager.logsPage.selectRunQuery();
  });

  test("Enable Streaming for running query after selecting two streams and SQL Mode On", {
    tag: ['@streaming', '@sqlMode', '@all', '@streams']
  }, async ({ page }) => {
    await pageManager.logsPage.navigateToLogs();
    await pageManager.logsPage.selectIndexAndStreamJoin();
    // await pageManager.logsPage.enableSQLMode();
    await pageManager.logsPage.selectRunQuery();
    await pageManager.logsPage.displayTwoStreams();
  });

  test("Enable Streaming for running query after selecting two streams, selecting field and SQL Mode On", {
    tag: ['@streaming', '@sqlMode', '@all', '@streams']
  }, async ({ page }) => {
    await pageManager.logsPage.navigateToLogs();
    await pageManager.logsPage.selectIndexAndStreamJoin();
    await pageManager.logsPage.kubernetesContainerName();
    // await pageManager.logsPage.enableSQLMode();
    await pageManager.logsPage.selectRunQuery();
    await pageManager.logsPage.validateResult();
  });

  test("Enable Streaming for running query after selecting two streams, SQL Mode On and entering join queries", {
    tag: ['@streaming', '@sqlMode', '@joins', '@all', '@streams']
  }, async ({ page }) => {
    await pageManager.logsPage.navigateToLogs();
    await pageManager.logsPage.selectIndexAndStreamJoin();
    await pageManager.logsPage.kubernetesContainerNameJoin();
    // await pageManager.logsPage.enableSQLMode();
    await pageManager.logsPage.selectRunQuery();
    await page.waitForTimeout(3000); // Wait for query results
    await pageManager.logsPage.displayCountQuery();
    await page.waitForTimeout(3000); // Wait for query results
    await pageManager.logsPage.validateResult();
  });

  test("Enable Streaming for running query after selecting two streams, SQL Mode On and entering join limit", {
    tag: ['@streaming', '@sqlMode', '@joins', '@all', '@streams']
  }, async ({ page }) => {
    await pageManager.logsPage.navigateToLogs();
    await pageManager.logsPage.selectIndexAndStreamJoin();
    await pageManager.logsPage.kubernetesContainerNameJoinLimit();
    // await pageManager.logsPage.enableSQLMode();
    await pageManager.logsPage.selectRunQuery();
    await page.waitForTimeout(3000); // Wait for query results
    await pageManager.logsPage.validateResult();
  });

  test("Enable Streaming for running query after selecting two streams, SQL Mode On and entering join like", {
    tag: ['@streaming', '@sqlMode', '@joins', '@all', '@streams']
  }, async ({ page }) => {
    await pageManager.logsPage.navigateToLogs();
    await pageManager.logsPage.selectIndexAndStreamJoin();
    await pageManager.logsPage.kubernetesContainerNameJoinLike();
    await pageManager.logsPage.enableSQLMode();
    await pageManager.logsPage.selectRunQuery();
    await pageManager.logsPage.validateResult();
  });

  test("Enable Streaming for running query after selecting two streams, SQL Mode On and entering Left join queries", {
    tag: ['@streaming', '@sqlMode', '@joins', '@all', '@streams']
  }, async ({ page }) => {
    await pageManager.logsPage.navigateToLogs();
    await pageManager.logsPage.selectIndexAndStreamJoin();
    await pageManager.logsPage.kubernetesContainerNameLeftJoin();
    await pageManager.logsPage.enableSQLMode();
    await pageManager.logsPage.selectRunQuery();
    await pageManager.logsPage.validateResult();
  });

  test("Enable Streaming for running query after selecting two streams, SQL Mode On and entering Right join queries", {
    tag: ['@streaming', '@sqlMode', '@joins', '@all', '@streams']
  }, async ({ page }) => {
    await pageManager.logsPage.navigateToLogs();
    await pageManager.logsPage.selectIndexAndStreamJoin();
    await pageManager.logsPage.kubernetesContainerNameRightJoin();
    await pageManager.logsPage.enableSQLMode();
    await pageManager.logsPage.selectRunQuery();
    await pageManager.logsPage.validateResult();
  });

  test("Enable Streaming for running query after selecting two streams, SQL Mode On and entering Full join queries", {
    tag: ['@streaming', '@sqlMode', '@joins', '@all', '@streams']
  }, async ({ page }) => {
    await pageManager.logsPage.navigateToLogs();
    await pageManager.logsPage.selectIndexAndStreamJoin();
    await pageManager.logsPage.kubernetesContainerNameFullJoin();
    // await pageManager.logsPage.enableSQLMode();
    await pageManager.logsPage.selectRunQuery();
    await pageManager.logsPage.validateResult();
  });

  test("Enable Streaming for clicking on interesting field icon and display field in editor", {
    tag: ['@streaming', '@interestingFields', '@all', '@streams']
  }, async ({ page }) => {
    await pageManager.logsPage.navigateToLogs();
    await pageManager.logsPage.selectIndexAndStreamJoin();
    await pageManager.logsPage.enableSQLMode();
    await pageManager.logsPage.clickQuickModeToggle();
    await pageManager.logsPage.selectRunQuery();
    await pageManager.logsPage.clickInterestingFields();
    await pageManager.logsPage.validateInterestingFields();
  });

  test("Enable Streaming for clicking on interesting field icon and display query in editor", {
    tag: ['@streaming', '@interestingFields', '@all', '@streams']
  }, async ({ page }) => {
    await pageManager.logsPage.navigateToLogs();
    await pageManager.logsPage.selectIndexAndStreamJoin();
    await pageManager.logsPage.enableSQLMode();
    await pageManager.logsPage.clickQuickModeToggle();
    await pageManager.logsPage.selectRunQuery();
    await pageManager.logsPage.clickInterestingFields();
    await pageManager.logsPage.validateInterestingFieldsQuery();
  });

  test("Enable Streaming for Adding or removing interesting field removes it from editor and results too", {
    tag: ['@streaming', '@interestingFields', '@all', '@streams']
  }, async ({ page }) => {
    await pageManager.logsPage.navigateToLogs();
    await pageManager.logsPage.selectIndexAndStreamJoin();
    // await pageManager.logsPage.enableSQLMode();
    await pageManager.logsPage.clickQuickModeToggle();
    await pageManager.logsPage.selectRunQuery();
    await pageManager.logsPage.clickInterestingFields();
    await pageManager.logsPage.addRemoveInteresting();
  });

  test("Streaming enabled histogram is disabled and run query, results appear and then user switches on Histogram, getting error", {
    tag: ['@streaming', '@histogram', '@all', '@streams']
  }, async ({ page }) => {
    await pageManager.logsPage.navigateToLogs();
    await pageManager.logsPage.selectIndexStreamDefault();
    await pageManager.logsPage.selectRunQuery();
    await pageManager.logsPage.toggleHistogram();
    await pageManager.logsPage.selectRunQuery();

    await pageManager.logsPage.toggleHistogram();
    
    // Check that the error message is not visible
    const errorHeading = page.getByRole('heading', { name: 'Error while fetching' });
    await expect(errorHeading).not.toBeVisible();

    // Ensure that the error details button is also not visible or disabled
    const errorDetailsButton = page.locator('[data-test="logs-page-histogram-error-details-btn"]');
    await expect(errorDetailsButton).not.toBeVisible();
  });

  test("No Histogram should be displayed if Data is not available", {
    tag: ['@streaming', '@histogram', '@all', '@streams']
  }, async ({ page }) => {
    await pageManager.logsPage.navigateToLogs();
    await pageManager.logsPage.selectIndexStreamDefault();
    await pageManager.logsPage.enableSQLMode();
    await pageManager.logsPage.clearAndFillQueryEditor('SELECT count(_timestamp)  FROM "default" where code = 201');
    await page.waitForTimeout(1000);
    await pageManager.logsPage.selectRunQuery();
    await pageManager.streamsPage.expectNoDataFoundForHistogram();
  });
}); 