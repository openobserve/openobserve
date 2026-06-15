/**
 * Test Demo Page End-to-End Tests
 *
 * Tests for the throwaway Test Demo page (/test-demo) — a deterministic,
 * multi-mode UI surface for exercising the E2E Council test-generation pipeline.
 *
 * Features tested:
 * - Page loads with all three sections visible
 * - Fruit select → text output mapping
 * - Cascading country → city selects
 * - Mode toggle (Basic / Advanced) and conditional panel visibility
 * - Combined rule banner (Cherry + Advanced + High priority)
 */

const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const PageManager = require('../../pages/page-manager.js');

test.describe("Test Demo Page testcases", () => {
  test.describe.configure({ mode: 'parallel' });
  let pm;

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    await navigateToBase(page);
    pm = new PageManager(page);
    await pm.testDemoPage.goto(process.env['ORGNAME']);
    await pm.testDemoPage.expectPageVisible();
    testLogger.info('Test setup completed');
  });

  test("should display all sections on page load", {
    tag: ['@test-demo', '@all']
  }, async ({ page }) => {
    testLogger.info('Verifying all sections are visible on page load');

    // Verify page shell
    await pm.testDemoPage.expectPageVisible();

    // Verify all three cards are visible
    await pm.testDemoPage.expectFruitCardVisible();
    await pm.testDemoPage.expectLocationCardVisible();
    await pm.testDemoPage.expectModeCardVisible();

    // Verify initial state outputs
    await pm.testDemoPage.expectFruitOutputText('No fruit selected yet');
    await pm.testDemoPage.expectLocationOutputText('Pick a country to begin');
    await pm.testDemoPage.expectModeOutputText('Basic mode');

    // Verify mode default (Basic active)
    await pm.testDemoPage.expectModeBasicActive();

    testLogger.info('All sections verified on page load');
  });

  test("should update fruit output on fruit selection", {
    tag: ['@test-demo', '@all']
  }, async ({ page }) => {
    testLogger.info('Testing fruit select → output mapping');

    // Select Apple
    await pm.testDemoPage.selectFruit('apple');
    await pm.testDemoPage.expectFruitOutputText('Apple — a crisp red pome');

    // Select Banana
    await pm.testDemoPage.selectFruit('banana');
    await pm.testDemoPage.expectFruitOutputText('Banana — a soft yellow berry');

    // Select Cherry
    await pm.testDemoPage.selectFruit('cherry');
    await pm.testDemoPage.expectFruitOutputText('Cherry — a small red stone fruit');

    testLogger.info('Fruit select → output mapping verified');
  });

  test("should cascade country selection to city select", {
    tag: ['@test-demo', '@all']
  }, async ({ page }) => {
    testLogger.info('Testing cascading country → city selects');

    // Select country: India
    await pm.testDemoPage.selectCountry('india');

    // City select should become enabled
    await pm.testDemoPage.expectCitySelectEnabled();

    // Output should say Pick a city
    await pm.testDemoPage.expectLocationOutputText('Now pick a city');

    // Select city: Bengaluru
    await pm.testDemoPage.selectCity('bengaluru');
    await pm.testDemoPage.expectLocationOutputText('Bengaluru, India');

    // Change country: USA (should reset city)
    await pm.testDemoPage.selectCountry('usa');
    await pm.testDemoPage.expectLocationOutputText('Now pick a city');

    // Select city: New York
    await pm.testDemoPage.selectCity('ny');
    await pm.testDemoPage.expectLocationOutputText('New York, United States');

    testLogger.info('Cascading country → city selects verified');
  });

  test("should show advanced panel on mode toggle", {
    tag: ['@test-demo', '@all']
  }, async ({ page }) => {
    testLogger.info('Testing mode toggle and advanced panel visibility');

    // Verify default: Basic mode active, advanced panel hidden
    await pm.testDemoPage.expectModeBasicActive();
    await pm.testDemoPage.expectAdvancedPanelHidden();

    // Switch to Advanced
    await pm.testDemoPage.clickModeAdvanced();
    await pm.testDemoPage.expectModeAdvancedActive();
    await pm.testDemoPage.expectAdvancedPanelVisible();
    await pm.testDemoPage.expectModeOutputText('Advanced mode');

    // Switch back to Basic
    await pm.testDemoPage.clickModeBasic();
    await pm.testDemoPage.expectModeBasicActive();
    await pm.testDemoPage.expectAdvancedPanelHidden();
    await pm.testDemoPage.expectModeOutputText('Basic mode');

    testLogger.info('Mode toggle and advanced panel visibility verified');
  });

  test("should update priority output in advanced mode", {
    tag: ['@test-demo', '@all']
  }, async ({ page }) => {
    testLogger.info('Testing priority select in advanced mode');

    // Switch to Advanced mode
    await pm.testDemoPage.clickModeAdvanced();
    await pm.testDemoPage.expectAdvancedPanelVisible();

    // Select Low priority
    await pm.testDemoPage.selectPriority('low');
    await pm.testDemoPage.expectPriorityOutputText('Low');

    // Select Medium priority
    await pm.testDemoPage.selectPriority('medium');
    await pm.testDemoPage.expectPriorityOutputText('Medium');

    // Select High priority
    await pm.testDemoPage.selectPriority('high');
    await pm.testDemoPage.expectPriorityOutputText('High');

    testLogger.info('Priority select in advanced mode verified');
  });

  test("should show critical banner when Cherry + Advanced + High", {
    tag: ['@test-demo', '@all']
  }, async ({ page }) => {
    testLogger.info('Testing combined rule banner (Cherry + Advanced + High)');

    // Switch to Advanced mode
    await pm.testDemoPage.clickModeAdvanced();
    await pm.testDemoPage.expectAdvancedPanelVisible();

    // Banner should NOT be visible initially (fruit not selected)
    await pm.testDemoPage.expectCombinedBannerHidden();

    // Select Cherry
    await pm.testDemoPage.selectFruit('cherry');

    // Banner still hidden (priority not High)
    await pm.testDemoPage.expectCombinedBannerHidden();

    // Select High priority → banner should appear
    await pm.testDemoPage.selectPriority('high');
    await pm.testDemoPage.expectCombinedBannerVisible();
    await pm.testDemoPage.expectCombinedBannerContainsText('Critical cherry alert');

    // Change fruit to Apple → banner should disappear
    await pm.testDemoPage.selectFruit('apple');
    await pm.testDemoPage.expectCombinedBannerHidden();

    // Change back to Cherry → banner should reappear
    await pm.testDemoPage.selectFruit('cherry');
    await pm.testDemoPage.expectCombinedBannerVisible();

    // Switch to Basic → banner should disappear (panel hidden)
    await pm.testDemoPage.clickModeBasic();
    await pm.testDemoPage.expectAdvancedPanelHidden();

    testLogger.info('Combined rule banner behavior verified');
  });

  test("should reset city when country changes", {
    tag: ['@test-demo', '@all']
  }, async ({ page }) => {
    testLogger.info('Testing city reset on country change');

    // Select India → Bengaluru
    await pm.testDemoPage.selectCountry('india');
    await pm.testDemoPage.selectCity('bengaluru');
    await pm.testDemoPage.expectLocationOutputText('Bengaluru, India');

    // Change country to Japan (city should reset)
    await pm.testDemoPage.selectCountry('japan');
    // Output should reflect country selected but no city picked
    await pm.testDemoPage.expectLocationOutputText('Now pick a city');

    // Select Tokyo
    await pm.testDemoPage.selectCity('tokyo');
    await pm.testDemoPage.expectLocationOutputText('Tokyo, Japan');

    testLogger.info('City reset on country change verified');
  });
});
