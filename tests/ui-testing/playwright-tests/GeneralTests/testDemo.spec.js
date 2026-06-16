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
    await pm.testDemoPage.navigateToTestDemo();
    testLogger.info('Test setup completed');
  });

  // ========================================================================
  // P0 — Critical path: page renders and each section works independently
  // ========================================================================

  // TC01
  test("should render page with all three cards visible", {
    tag: ['@test-demo', '@all', '@P0']
  }, async ({ page }) => {
    testLogger.info('Verifying page renders with title and all cards');
    await pm.testDemoPage.expectPageVisible();
    await pm.testDemoPage.expectTitleVisible();
    await pm.testDemoPage.expectAllCardsVisible();
    testLogger.info('Test completed');
  });

  // TC02
  test("should show fruit select default empty state", {
    tag: ['@test-demo', '@all', '@P0']
  }, async ({ page }) => {
    testLogger.info('Verifying fruit card default empty state');
    await pm.testDemoPage.expectFruitTriggerPlaceholder('Select a fruit');
    await pm.testDemoPage.expectFruitOutputText('No fruit selected yet.');
    testLogger.info('Test completed');
  });

  // TC03
  test("should select Apple fruit and update output", {
    tag: ['@test-demo', '@all', '@P0']
  }, async ({ page }) => {
    testLogger.info('Selecting Apple fruit');
    await pm.testDemoPage.selectFruitOption('apple');
    await pm.testDemoPage.expectFruitOutputText('Apple — a crisp red pome. (You selected option A.)');
    await pm.testDemoPage.expectFruitTriggerShowsLabel('Apple');
    await pm.testDemoPage.expectFruitTriggerSelectedValue('apple');
    testLogger.info('Test completed');
  });

  // TC04
  test("should switch fruit to Banana then Cherry", {
    tag: ['@test-demo', '@all', '@P0']
  }, async ({ page }) => {
    testLogger.info('Switching fruit to Banana then Cherry');
    await pm.testDemoPage.selectFruitOption('banana');
    await pm.testDemoPage.expectFruitOutputText('Banana — a soft yellow berry. (You selected option B.)');

    await pm.testDemoPage.selectFruitOption('cherry');
    await pm.testDemoPage.expectFruitOutputText('Cherry — a small red stone fruit. (You selected option C.)');
    testLogger.info('Test completed');
  });

  // TC05
  test("should show location default state with city disabled", {
    tag: ['@test-demo', '@all', '@P0']
  }, async ({ page }) => {
    testLogger.info('Verifying location card default state');
    await pm.testDemoPage.expectLocationOutputText('Pick a country to begin.');
    await pm.testDemoPage.expectCountryTriggerPlaceholder('Select a country');
    await pm.testDemoPage.expectCityTriggerDisabled();
    testLogger.info('Test completed');
  });

  // TC06
  test("should enable city after selecting country India", {
    tag: ['@test-demo', '@all', '@P0']
  }, async ({ page }) => {
    testLogger.info('Selecting country India and verifying city enabled');
    await pm.testDemoPage.selectCountryOption('india');
    await pm.testDemoPage.expectLocationOutputText('Country: India. Now pick a city.');
    await pm.testDemoPage.expectCityTriggerEnabled();
    testLogger.info('Test completed');
  });

  // TC07
  test("should select India → Bengaluru and show full cascading output", {
    tag: ['@test-demo', '@all', '@P0']
  }, async ({ page }) => {
    testLogger.info('Selecting country India and city Bengaluru');
    await pm.testDemoPage.selectCountryOption('india');
    await pm.testDemoPage.selectCityOption('bengaluru');
    await pm.testDemoPage.expectLocationOutputText('You selected Bengaluru, India.');
    await pm.testDemoPage.expectCityTriggerShowsLabel('Bengaluru');
    testLogger.info('Test completed');
  });

  // TC08
  test("should show mode card default Basic state", {
    tag: ['@test-demo', '@all', '@P0']
  }, async ({ page }) => {
    testLogger.info('Verifying mode card default Basic state');
    await pm.testDemoPage.expectModeOutputText('Basic mode — minimal controls. Switch to Advanced for more.');
    await pm.testDemoPage.expectBasicModeActive();
    await pm.testDemoPage.expectAdvancedPanelNotInDOM();
    testLogger.info('Test completed');
  });

  // TC09
  test("should switch to Advanced mode and show priority panel", {
    tag: ['@test-demo', '@all', '@P0']
  }, async ({ page }) => {
    testLogger.info('Switching to Advanced mode');
    await pm.testDemoPage.clickModeAdvanced();
    await pm.testDemoPage.expectModeOutputText('Advanced mode — extra controls are visible below.');
    await pm.testDemoPage.expectAdvancedModeActive();
    await pm.testDemoPage.expectAdvancedPanelVisible();
    await pm.testDemoPage.expectPriorityOutputText('No priority selected.');
    await pm.testDemoPage.expectPriorityTriggerPlaceholder('Select a priority');
    testLogger.info('Test completed');
  });

  // TC10
  test("should select High priority in Advanced mode", {
    tag: ['@test-demo', '@all', '@P0']
  }, async ({ page }) => {
    testLogger.info('Selecting High priority in Advanced mode');
    await pm.testDemoPage.clickModeAdvanced();
    await pm.testDemoPage.selectPriorityOption('high');
    await pm.testDemoPage.expectPriorityOutputText('Priority set to High.');
    await pm.testDemoPage.expectPriorityTriggerShowsLabel('High');
    testLogger.info('Test completed');
  });

  // ========================================================================
  // P1 — Important variations: combined banner and cross-section interactions
  // ========================================================================

  // TC11
  test("should show combined banner when Cherry + Advanced + High", {
    tag: ['@test-demo', '@all', '@P1']
  }, async ({ page }) => {
    testLogger.info('Setting up combined banner conditions: Cherry + Advanced + High');
    await pm.testDemoPage.selectFruitOption('cherry');
    await pm.testDemoPage.clickModeAdvanced();
    await pm.testDemoPage.selectPriorityOption('high');
    await pm.testDemoPage.expectCombinedBannerVisible();
    await pm.testDemoPage.expectCombinedBannerText('Critical cherry alert — Cherry selected at High priority.');
    await pm.testDemoPage.expectCombinedBannerIconVisible();
    testLogger.info('Test completed');
  });

  // TC12
  test("should hide combined banner when fruit changes away from Cherry", {
    tag: ['@test-demo', '@all', '@P1']
  }, async ({ page }) => {
    testLogger.info('Setting up banner then switching fruit to Apple');
    await pm.testDemoPage.selectFruitOption('cherry');
    await pm.testDemoPage.clickModeAdvanced();
    await pm.testDemoPage.selectPriorityOption('high');
    await pm.testDemoPage.expectCombinedBannerVisible();

    await pm.testDemoPage.selectFruitOption('apple');
    await pm.testDemoPage.expectCombinedBannerNotInDOM();
    testLogger.info('Test completed');
  });

  // TC13
  test("should hide combined banner when priority changes from High", {
    tag: ['@test-demo', '@all', '@P1']
  }, async ({ page }) => {
    testLogger.info('Setting up banner then switching priority to Medium');
    await pm.testDemoPage.selectFruitOption('cherry');
    await pm.testDemoPage.clickModeAdvanced();
    await pm.testDemoPage.selectPriorityOption('high');
    await pm.testDemoPage.expectCombinedBannerVisible();

    await pm.testDemoPage.selectPriorityOption('medium');
    await pm.testDemoPage.expectCombinedBannerNotInDOM();
    await pm.testDemoPage.expectPriorityOutputText('Priority set to Medium.');
    testLogger.info('Test completed');
  });

  // TC14
  test("should hide combined banner and advanced panel on toggle to Basic", {
    tag: ['@test-demo', '@all', '@P1']
  }, async ({ page }) => {
    testLogger.info('Setting up banner then toggling to Basic');
    await pm.testDemoPage.selectFruitOption('cherry');
    await pm.testDemoPage.clickModeAdvanced();
    await pm.testDemoPage.selectPriorityOption('high');
    await pm.testDemoPage.expectCombinedBannerVisible();

    await pm.testDemoPage.clickModeBasic();
    await pm.testDemoPage.expectAdvancedPanelNotInDOM();
    await pm.testDemoPage.expectCombinedBannerNotInDOM();
    await pm.testDemoPage.expectModeOutputText('Basic mode — minimal controls. Switch to Advanced for more.');
    testLogger.info('Test completed');
  });

  // TC15
  test("should NOT show combined banner when conditions not fully met", {
    tag: ['@test-demo', '@all', '@P1']
  }, async ({ page }) => {
    testLogger.info('Setting Cherry + Advanced + Low — banner should NOT appear');
    await pm.testDemoPage.selectFruitOption('cherry');
    await pm.testDemoPage.clickModeAdvanced();
    await pm.testDemoPage.selectPriorityOption('low');
    await pm.testDemoPage.expectCombinedBannerNotInDOM();
    testLogger.info('Test completed');
  });

  // TC16
  test("should reset city when country changes", {
    tag: ['@test-demo', '@all', '@P1']
  }, async ({ page }) => {
    testLogger.info('Selecting India → Bengaluru, then switching country to USA');
    await pm.testDemoPage.selectCountryOption('india');
    await pm.testDemoPage.selectCityOption('bengaluru');
    await pm.testDemoPage.expectLocationOutputText('You selected Bengaluru, India.');

    await pm.testDemoPage.selectCountryOption('usa');
    await pm.testDemoPage.expectLocationOutputText('Country: United States. Now pick a city.');
    await pm.testDemoPage.expectCityTriggerPlaceholder('Select a city');
    await pm.testDemoPage.expectCityTriggerEnabled();
    testLogger.info('Test completed');
  });

  // TC17
  test("should show all sections independently correct simultaneously", {
    tag: ['@test-demo', '@all', '@P1']
  }, async ({ page }) => {
    testLogger.info('Setting Banana + India/Bengaluru + Advanced/Low');
    await pm.testDemoPage.selectFruitOption('banana');
    await pm.testDemoPage.selectCountryOption('india');
    await pm.testDemoPage.selectCityOption('bengaluru');
    await pm.testDemoPage.clickModeAdvanced();
    await pm.testDemoPage.selectPriorityOption('low');

    await pm.testDemoPage.expectFruitOutputText('Banana — a soft yellow berry. (You selected option B.)');
    await pm.testDemoPage.expectLocationOutputText('You selected Bengaluru, India.');
    await pm.testDemoPage.expectModeOutputText('Advanced mode — extra controls are visible below.');
    await pm.testDemoPage.expectPriorityOutputText('Priority set to Low.');
    await pm.testDemoPage.expectCombinedBannerNotInDOM();
    testLogger.info('Test completed');
  });

  // TC18
  test("should show correct city options for each country", {
    tag: ['@test-demo', '@all', '@P1']
  }, async ({ page }) => {
    testLogger.info('Verifying city options for India, USA, Japan');

    // India
    await pm.testDemoPage.selectCountryOption('india');
    await pm.testDemoPage.expectCityOptionsVisible(['Bengaluru', 'Mumbai']);

    // USA
    await pm.testDemoPage.selectCountryOption('usa');
    await pm.testDemoPage.expectCityOptionsVisible(['San Francisco', 'New York']);

    // Japan
    await pm.testDemoPage.selectCountryOption('japan');
    await pm.testDemoPage.expectCityOptionsVisible(['Tokyo', 'Osaka']);

    testLogger.info('Test completed');
  });

  // ========================================================================
  // P2 — Edge cases and defensive checks
  // ========================================================================

  // TC19
  test("should have exactly 3 fruit options with no clear option", {
    tag: ['@test-demo', '@all', '@P2']
  }, async ({ page }) => {
    testLogger.info('Verifying fruit options count (no blank/clear option)');
    await pm.testDemoPage.selectFruitOption('apple');
    // After selecting, reopen and verify exactly 3 options
    await pm.testDemoPage.openFruitDropdown();
    await pm.testDemoPage.expectFruitOptionsCount(3);
    await pm.testDemoPage.expectFruitTriggerShowsLabel('Apple');
    testLogger.info('Test completed');
  });

  // TC20
  test("should fully remove advanced panel from DOM on Basic toggle (v-if)", {
    tag: ['@test-demo', '@all', '@P2']
  }, async ({ page }) => {
    testLogger.info('Verifying v-if DOM removal for advanced panel');
    await pm.testDemoPage.clickModeAdvanced();
    await pm.testDemoPage.expectAdvancedPanelVisible();

    await pm.testDemoPage.clickModeBasic();
    await pm.testDemoPage.expectAdvancedPanelNotInDOM();

    await pm.testDemoPage.clickModeAdvanced();
    await pm.testDemoPage.expectAdvancedPanelVisible();
    testLogger.info('Test completed');
  });

  // TC21
  test("should be immediately interactive with no loading states", {
    tag: ['@test-demo', '@all', '@P2']
  }, async ({ page }) => {
    testLogger.info('Verifying page has no loading delays');
    // Immediately click fruit trigger after page load — should open without delay
    await pm.testDemoPage.openFruitDropdown();
    await pm.testDemoPage.expectFruitPopoverVisible();
    testLogger.info('Test completed');
  });
});
