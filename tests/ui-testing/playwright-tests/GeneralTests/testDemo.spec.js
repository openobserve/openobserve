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
    await pm.testDemoPage.navigateToPage();
    testLogger.info('Test Demo page setup completed');
  });

  // ── TC01: Page loads via direct URL ──
  test("should load the Test Demo page and display all three section cards", {
    tag: ['@test-demo', '@all']
  }, async ({ page }) => {
    testLogger.info('Verifying page root, title, and all section cards are visible');

    await pm.testDemoPage.expectPageLoaded();
    await pm.testDemoPage.expectTitleContains("TEST — Demo Page");
    await pm.testDemoPage.expectFruitCardVisible();
    await pm.testDemoPage.expectLocationCardVisible();
    await pm.testDemoPage.expectModeCardVisible();

    testLogger.info('Test completed: page loads with all sections visible');
  });

  // ── TC02: Fruit select — default state and all three options ──
  test("should show default fruit output and update correctly for apple, banana, and cherry", {
    tag: ['@test-demo', '@all']
  }, async ({ page }) => {
    testLogger.info('Verifying default fruit output and all three fruit selections');

    // Default state
    await pm.testDemoPage.expectFruitOutputText("No fruit selected yet.");

    // Select Apple
    await pm.testDemoPage.selectFruit("apple");
    await pm.testDemoPage.expectFruitOutputText("Apple — a crisp red pome. (You selected option A.)");

    // Select Banana
    await pm.testDemoPage.selectFruit("banana");
    await pm.testDemoPage.expectFruitOutputText("Banana — a soft yellow berry. (You selected option B.)");

    // Select Cherry
    await pm.testDemoPage.selectFruit("cherry");
    await pm.testDemoPage.expectFruitOutputText("Cherry — a small red stone fruit. (You selected option C.)");

    testLogger.info('Test completed: all fruit selections produce correct output');
  });

  // ── TC03: Cascading location — full country→city flow ──
  test("should cascade country to city: city disabled initially, enabled after country, and combined output correct", {
    tag: ['@test-demo', '@all']
  }, async ({ page }) => {
    testLogger.info('Verifying cascading country→city behavior');

    // City starts disabled
    await pm.testDemoPage.expectCitySelectDisabled();
    await pm.testDemoPage.expectLocationOutput("Pick a country to begin.");

    // Select Japan → city enabled
    await pm.testDemoPage.selectCountry("japan");
    await pm.testDemoPage.expectLocationOutput("Country: Japan. Now pick a city.");
    await pm.testDemoPage.expectCitySelectEnabled();

    // Select Tokyo → combined output
    await pm.testDemoPage.selectCity("tokyo");
    await pm.testDemoPage.expectLocationOutput("You selected Tokyo, Japan.");

    // Change country to USA → city resets
    await pm.testDemoPage.selectCountry("usa");
    await pm.testDemoPage.expectLocationOutput("Country: United States. Now pick a city.");

    // Select San Francisco → combined output
    await pm.testDemoPage.selectCity("sf");
    await pm.testDemoPage.expectLocationOutput("You selected San Francisco, United States.");

    testLogger.info('Test completed: cascading location flow works correctly');
  });

  // ── TC04: Mode toggle and advanced panel visibility ──
  test("should default to Basic mode, switch to Advanced to reveal panel, and back to Basic to hide it", {
    tag: ['@test-demo', '@all']
  }, async ({ page }) => {
    testLogger.info('Verifying mode toggle and advanced panel visibility');

    // Default: Basic mode
    await pm.testDemoPage.expectModeOutput("Basic mode — minimal controls.");
    await pm.testDemoPage.expectAdvancedPanelNotInDOM();

    // Switch to Advanced
    await pm.testDemoPage.switchToAdvanced();
    await pm.testDemoPage.expectModeOutput("Advanced mode — extra controls are visible below.");
    await pm.testDemoPage.expectAdvancedPanelVisible();
    await pm.testDemoPage.expectPriorityOutput("No priority selected.");

    // Switch back to Basic
    await pm.testDemoPage.switchToBasic();
    await pm.testDemoPage.expectAdvancedPanelNotInDOM();
    await pm.testDemoPage.expectModeOutput("Basic mode — minimal controls.");

    testLogger.info('Test completed: mode toggle shows/hides advanced panel correctly');
  });

  // ── TC05: Combined critical banner — all three conditions ──
  test("should show combined banner only when mode=advanced, fruit=cherry, AND priority=high", {
    tag: ['@test-demo', '@all']
  }, async ({ page }) => {
    testLogger.info('Verifying combined critical banner trigger conditions');

    // Set up: Advanced + Cherry + High
    await pm.testDemoPage.switchToAdvanced();
    await pm.testDemoPage.selectFruit("cherry");
    await pm.testDemoPage.selectPriority("high");

    // Banner visible
    await pm.testDemoPage.expectCombinedBannerVisible();
    await pm.testDemoPage.expectCombinedBannerContainsText("Critical cherry alert — Cherry selected at High priority.");

    // Break one condition: change priority to Low → banner hidden
    await pm.testDemoPage.selectPriority("low");
    await pm.testDemoPage.expectCombinedBannerNotVisible();

    // Change priority back to High, change fruit to Apple → banner hidden
    await pm.testDemoPage.selectPriority("high");
    await pm.testDemoPage.selectFruit("banana");
    await pm.testDemoPage.expectCombinedBannerNotVisible();

    // Reset fruit to Cherry, switch to Basic → banner hidden
    await pm.testDemoPage.selectFruit("cherry");
    await pm.testDemoPage.switchToBasic();
    await pm.testDemoPage.expectCombinedBannerNotVisible();

    // Switch back to Advanced → banner reappears (fruit and priority preserved)
    await pm.testDemoPage.switchToAdvanced();
    await pm.testDemoPage.expectCombinedBannerVisible();

    testLogger.info('Test completed: combined banner conditions verified');
  });

  // ── TC06: Sidebar navigation access ──
  test("should navigate to Test Demo page via sidebar TEST nav item", {
    tag: ['@test-demo', '@all']
  }, async ({ page }) => {
    testLogger.info('Verifying sidebar navigation to Test Demo page');

    // Click the sidebar TEST nav item
    await pm.homePage.testDemoMenu.waitFor({ state: 'visible', timeout: 10000 });
    await pm.homePage.testDemoMenu.click();

    // Wait for page load
    await pm.testDemoPage.expectPageLoaded();

    // Verify URL and title
    await expect(page).toHaveURL(/\/test-demo/);
    await expect(page).toHaveTitle("OpenObserve - Test Demo");

    testLogger.info('Test completed: sidebar navigation works correctly');
  });

  // ── TC07: City options change per country ──
  test("should show correct city options for each country: India, USA, Japan", {
    tag: ['@test-demo', '@all']
  }, async ({ page }) => {
    testLogger.info('Verifying city options are correct per country');

    // Select India → Bengaluru
    await pm.testDemoPage.selectCountry("india");
    await pm.testDemoPage.selectCity("bengaluru");
    await pm.testDemoPage.expectLocationOutput("You selected Bengaluru, India.");

    // Select USA → New York
    await pm.testDemoPage.selectCountry("usa");
    await pm.testDemoPage.selectCity("ny");
    await pm.testDemoPage.expectLocationOutput("You selected New York, United States.");

    // Select Japan → Osaka
    await pm.testDemoPage.selectCountry("japan");
    await pm.testDemoPage.selectCity("osaka");
    await pm.testDemoPage.expectLocationOutput("You selected Osaka, Japan.");

    testLogger.info('Test completed: city options per country verified');
  });

  // ── TC08: Priority selector output for all three levels ──
  test("should show correct priority output for Low, Medium, and High", {
    tag: ['@test-demo', '@all']
  }, async ({ page }) => {
    testLogger.info('Verifying priority selector output for all levels');

    await pm.testDemoPage.switchToAdvanced();

    // Low
    await pm.testDemoPage.selectPriority("low");
    await pm.testDemoPage.expectPriorityOutput("Priority set to Low.");

    // Medium
    await pm.testDemoPage.selectPriority("medium");
    await pm.testDemoPage.expectPriorityOutput("Priority set to Medium.");

    // High
    await pm.testDemoPage.selectPriority("high");
    await pm.testDemoPage.expectPriorityOutput("Priority set to High.");

    testLogger.info('Test completed: all priority levels produce correct output');
  });

  // ── TC09: Page state resets on reload ──
  test("should reset all selections to defaults on page reload", {
    tag: ['@test-demo', '@all']
  }, async ({ page }) => {
    testLogger.info('Verifying page state resets on reload');

    // Make selections across all sections
    await pm.testDemoPage.selectFruit("cherry");
    await pm.testDemoPage.expectFruitOutputText("Cherry — a small red stone fruit. (You selected option C.)");

    await pm.testDemoPage.selectCountry("japan");
    await pm.testDemoPage.selectCity("tokyo");
    await pm.testDemoPage.expectLocationOutput("You selected Tokyo, Japan.");

    await pm.testDemoPage.switchToAdvanced();
    await pm.testDemoPage.selectPriority("high");
    await pm.testDemoPage.expectPriorityOutput("Priority set to High.");

    // Reload the page
    await page.reload();
    await pm.testDemoPage.expectPageLoaded();

    // All state should reset to defaults
    await pm.testDemoPage.expectFruitOutputText("No fruit selected yet.");
    await pm.testDemoPage.expectLocationOutput("Pick a country to begin.");
    await pm.testDemoPage.expectCitySelectDisabled();
    await pm.testDemoPage.expectModeOutput("Basic mode — minimal controls.");
    await pm.testDemoPage.expectAdvancedPanelNotInDOM();

    testLogger.info('Test completed: page state resets on reload');
  });

  // ── TC10: Mode toggle retains priority value (P2) ──
  test("should retain priority value when toggling from Advanced to Basic and back", {
    tag: ['@test-demo']
  }, async ({ page }) => {
    testLogger.info('Verifying priority value persistence across mode toggles');

    // In Advanced mode, select Medium
    await pm.testDemoPage.switchToAdvanced();
    await pm.testDemoPage.selectPriority("medium");
    await pm.testDemoPage.expectPriorityOutput("Priority set to Medium.");

    // Switch to Basic → advanced panel gone
    await pm.testDemoPage.switchToBasic();
    await pm.testDemoPage.expectAdvancedPanelNotInDOM();

    // Switch back to Advanced → priority preserved
    await pm.testDemoPage.switchToAdvanced();
    await pm.testDemoPage.expectPriorityOutput("Priority set to Medium.");

    testLogger.info('Test completed: priority value persists across mode toggles');
  });

  // ── TC11: Combined banner — partial conditions (P2) ──
  test("should NOT show combined banner when fewer than all three conditions hold", {
    tag: ['@test-demo']
  }, async ({ page }) => {
    testLogger.info('Verifying combined banner is hidden under partial conditions');

    await pm.testDemoPage.switchToAdvanced();

    // Cherry + Low → hidden
    await pm.testDemoPage.selectFruit("cherry");
    await pm.testDemoPage.selectPriority("low");
    await pm.testDemoPage.expectCombinedBannerNotVisible();

    // Apple + High → hidden
    await pm.testDemoPage.selectFruit("banana");
    await pm.testDemoPage.selectPriority("high");
    await pm.testDemoPage.expectCombinedBannerNotVisible();

    testLogger.info('Test completed: partial conditions correctly hide banner');
  });

  // ── TC12: City select disabled when no country selected (P2) ──
  test("should have city select genuinely disabled when no country is selected", {
    tag: ['@test-demo']
  }, async ({ page }) => {
    testLogger.info('Verifying city select disabled state without country');

    // No country selected → city disabled
    await pm.testDemoPage.expectCitySelectDisabled();

    // Select a country → city enabled
    await pm.testDemoPage.selectCountry("japan");
    await pm.testDemoPage.expectCitySelectEnabled();

    testLogger.info('Test completed: city select disabled state verified');
  });

  // ── TC13: Page subtitle renders correctly (P2) ──
  test("should display the page subtitle with descriptive text", {
    tag: ['@test-demo']
  }, async ({ page }) => {
    testLogger.info('Verifying page subtitle is visible');

    await pm.testDemoPage.expectSubtitleVisible();

    testLogger.info('Test completed: subtitle visible');
  });
});
