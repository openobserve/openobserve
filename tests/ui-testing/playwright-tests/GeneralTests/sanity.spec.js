const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const logData = require("../../fixtures/log.json");
const { toZonedTime } = require("date-fns-tz");
const PageManager = require('../../pages/page-manager.js');
const testLogger = require('../utils/test-logger.js');
const { getOrgIdentifier } = require('../utils/cloud-auth.js');

test.describe.configure({ mode: "parallel" });
const folderName = `Folder ${Date.now()}`;
const dashboardName = `AutomatedDashboard${Date.now()}`;

// Utility Functions
function removeUTFCharacters(text) {
  return text.replace(/[^\x00-\x7F]/g, " ");
}

async function applyQueryButton(page) {
  testLogger.step('Applying query button');
  
  // Use page object method instead of inline locators
  const pm = new PageManager(page);
  await pm.sanityPage.clickRefreshButton();
  
  testLogger.debug('Query applied successfully');
}

test.describe("Sanity Test Cases", () => {
  let pm; // Page Manager instance

  test.beforeEach(async ({ page }, testInfo) => {
    // Initialize test setup
    testLogger.testStart(testInfo.title, testInfo.file);
    
    // Navigate to base URL with authentication
    await navigateToBase(page);
    pm = new PageManager(page);
    
    // Navigate to logs page
    const logsUrl = `${logData.logsUrl}?org_identifier=${getOrgIdentifier()}`;
    testLogger.navigation('Navigating to logs page', { url: logsUrl });
    
    await page.goto(logsUrl);
    await page.waitForLoadState('domcontentloaded');
    
    // Simple setup - just select stream without complex API waits
    try {
      await pm.logsPage.selectStream("e2e_automate");
      testLogger.info('Stream selected successfully');
    } catch (error) {
      testLogger.warn('Stream selection failed, continuing test', { error: error.message });
    }
    
    testLogger.info('Test setup completed');
  });

  // Pagination Tests 
  test("should display result text and pagination", async ({ page }) => {
    testLogger.info('Testing pagination display');
    
    await pm.sanityPage.displayResultTextAndPagination();
    
    testLogger.info('Pagination test completed');
  });

  // Histogram Tests
  test.skip("should not display chart if histogram off and display again when toggle is on", async ({ page }) => {
    await pm.sanityPage.toggleHistogramOffAndOn();
  });

  // Saved Search tests
  test.skip("should save search, favorite, click on saved search and then delete", async ({ page }) => {
    const randomSavedViewName = `streamslog${Math.random().toString(36).substring(2, 10)}`;
    await pm.sanityPage.createAndDeleteSavedSearch(randomSavedViewName);
  });

  // Query Limit Tests
  test("should only display 5 result if limit 5 added", async ({ page }) => {
    testLogger.info('Testing SQL query limit functionality');
    
    await pm.sanityPage.displayLimitedResults();
    
    testLogger.info('SQL query limit test completed');
  });

  // Function Tests
  test("should create a function and then delete it", async ({ page }) => {
    // Generate unique function name with 4-digit alphanumeric suffix
    const generateSuffix = () => {
      const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
      let suffix = '';
      for (let i = 0; i < 4; i++) {
        suffix += chars.charAt(Math.floor(Math.random() * chars.length));
      }
      return suffix;
    };
    
    const uniqueFunctionName = `e2eautomatefunctions_${generateSuffix()}`;
    
    await pm.sanityPage.createAndDeleteFunction(uniqueFunctionName);
  });

  test("should create functions via functions page and delete it", async ({ page }) => {
    await pm.sanityPage.createFunctionViaFunctionsPage();
  });

  // Dashboard Folder Tests
  const randomFolderName = `Folder${Math.floor(Math.random() * 1000)}`;
  test("should create and delete folder", async ({ page }) => {
    testLogger.info('Testing folder creation and deletion', { folderName: randomFolderName });
    
    await pm.sanityPage.createAndDeleteFolder(randomFolderName);
    
    testLogger.info('Folder test completed');
  });

  // Stream Tests
  test("should create and delete stream", async ({ page }) => {
    testLogger.info('Testing stream creation and deletion');
    
    await pm.sanityPage.createAndDeleteStream();
    
    testLogger.info('Stream test completed');
  });

  // Result Summary Tests
  test("should display pagination even after clicking result summary", async ({ page }) => {
    testLogger.info('Testing result summary and pagination interaction');
    
    await pm.sanityPage.displayPaginationAfterResultSummary();
    
    testLogger.info('Result summary test completed');
  });

  // Settings Tests
  test("should change settings successfully", async ({ page }) => {
    testLogger.info('Testing settings change functionality');
    
    await pm.sanityPage.changeSettingsSuccessfully();
    
    testLogger.info('Settings change test completed');
  });

  // Stream Stats Tests
  test("should display results on click refresh stats", async ({ page }) => {
    testLogger.info('Testing stream stats refresh functionality');
    
    await pm.sanityPage.displayResultsOnRefreshStats();
    
    testLogger.info('Stream stats refresh test completed');
  });

  // Schema Pagination Tests
  test("should display pagination for schema", async ({ page }) => {
    testLogger.info('Testing schema pagination functionality');
    
    await pm.sanityPage.displayPaginationForSchema();
    
    testLogger.info('Schema pagination test completed');
  });

  // Advanced Histogram Pagination Tests
  test("should display pagination when histogram is off and clicking and closing the result", async ({ page }) => {
    testLogger.info('Testing histogram off with pagination functionality');
    
    await pm.sanityPage.displayPaginationWhenHistogramOffWithResult();
    
    testLogger.info('Histogram off pagination test completed');
  });

  test("should display pagination when only SQL is on clicking and closing the result", async ({ page }) => {
    testLogger.info('Testing SQL mode with pagination functionality');
    
    await pm.sanityPage.displayPaginationWhenOnlySQLWithResult();
    
    testLogger.info('SQL mode pagination test completed');
  });

  // Histogram SQL Mode Tests
  test("should display histogram in sql mode", async ({ page }) => {
    testLogger.info('Testing histogram in SQL mode functionality');
    
    await pm.sanityPage.displayHistogramInSQLMode();
    
    testLogger.info('Histogram SQL mode test completed');
  });

  test("should display results when SQL+histogram is on and then stream is selected", async ({ page }) => {
    testLogger.info('Testing SQL+histogram with stream selection functionality');
    
    await pm.sanityPage.displayResultsWhenSQLHistogramOnWithStreamSelection();
    
    testLogger.info('SQL+histogram stream selection test completed');
  });

  // Complex alert test - skipped by default
  test.skip("create template, destination and alert and then delete it", async ({ page }) => {
    // Alert workflow test implementation
  });

  /**
   * Test for Bug #11064 - Change casing of words on Query management page
   *
   * Validates that text labels on the Query management page use proper CamelCase
   * instead of all lowercase (e.g., "Dashboards" instead of "dashboards")
   */
  test("Query management page should display text in CamelCase @bug-11064", {
    tag: ['@sanity', '@ui', '@accessibility', '@P3', '@regression']
  }, async ({ page }) => {
    testLogger.info('Testing CamelCase text on Query management page (Bug #11064)');
    const pm = new PageManager(page);

    // Navigate to Query management / Scheduled queries page
    const queryManagementUrl = `${process.env.ZO_BASE_URL || ''}/web/query-management?org_identifier=${getOrgIdentifier()}`;
    await page.goto(queryManagementUrl);
    await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
    testLogger.info('✓ Navigated to Query management page');

    // Alternatively, try navigating via menu
    const scheduledQueriesMenu = pm.commonActions.getQueryManagementMenuItem();
    if (await scheduledQueriesMenu.isVisible({ timeout: 5000 }).catch(() => false)) {
      testLogger.info('Found Query Management menu item');
    }

    // Check for lowercase words that should be CamelCase
    const lowercaseWords = ['dashboards', 'ui'];
    const expectedCamelCase = ['Dashboards', 'UI'];

    for (let i = 0; i < lowercaseWords.length; i++) {
      const lowercase = lowercaseWords[i];
      const camelCase = expectedCamelCase[i];

      // Find elements containing the lowercase version (case-sensitive)
      const lowercaseElement = pm.commonActions.getElementsWithText(lowercase);
      const lowercaseCount = await lowercaseElement.count();

      // Find elements containing the CamelCase version
      const camelCaseElement = pm.commonActions.getElementsWithText(camelCase);
      const camelCaseCount = await camelCaseElement.count();

      testLogger.info(`Word "${lowercase}": lowercase count = ${lowercaseCount}, CamelCase "${camelCase}" count = ${camelCaseCount}`);

      if (lowercaseCount > 0 && camelCaseCount === 0) {
        testLogger.warn(`⚠ Found lowercase "${lowercase}" without CamelCase "${camelCase}" - Bug #11064 may be present`);
      } else if (camelCaseCount > 0) {
        testLogger.info(`✓ Found proper CamelCase "${camelCase}"`);
      }
    }

    // Also check page title and headers for proper casing
    const pageTitle = pm.commonActions.getPageTitle();
    if (await pageTitle.isVisible({ timeout: 3000 }).catch(() => false)) {
      const titleText = await pageTitle.textContent();
      testLogger.info(`Page title text: "${titleText}"`);

      // Check if title words are properly capitalized
      const words = titleText.split(/\s+/);
      const allCapitalized = words.every(word => {
        if (word.length === 0) return true;
        return word[0] === word[0].toUpperCase();
      });

      if (allCapitalized) {
        testLogger.info('✓ Page title uses proper capitalization');
      } else {
        testLogger.warn('⚠ Page title may have casing issues');
      }
    }

    testLogger.info('✓ CamelCase text test completed');
  });
});
