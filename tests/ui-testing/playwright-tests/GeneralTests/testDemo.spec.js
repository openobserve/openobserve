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
    await pm.testDemoPage.navigate();
    testLogger.info('Test Demo page setup completed');
  });

  // ============================================================
  // P0 — Critical path (page loads + core workflows)
  // ============================================================

  test("should load the page and render all three sections", {
    tag: ['@test-demo', '@all'],
  }, async ({ page }) => {
    testLogger.info('Verifying page renders with all three section cards');

    await pm.testDemoPage.expectPageVisible();
    await pm.testDemoPage.expectTitleContains('Test Demo');
    await pm.testDemoPage.expectFruitCardVisible();
    await pm.testDemoPage.expectLocationCardVisible();
    await pm.testDemoPage.expectModeCardVisible();

    testLogger.info('Test completed: all sections rendered');
  });

  test("should update fruit output when selecting different fruits", {
    tag: ['@test-demo', '@all'],
  }, async ({ page }) => {
    testLogger.info('Verifying default fruit output');

    await pm.testDemoPage.expectFruitOutputContains('No fruit selected yet.');

    testLogger.info('Selecting Apple');
    await pm.testDemoPage.selectFruit('Apple');
    await pm.testDemoPage.expectFruitOutputContains('Apple — a crisp red pome.');

    testLogger.info('Selecting Banana');
    await pm.testDemoPage.selectFruit('Banana');
    await pm.testDemoPage.expectFruitOutputContains('Banana — a curved yellow tropical fruit.');

    testLogger.info('Selecting Cherry');
    await pm.testDemoPage.selectFruit('Cherry');
    await pm.testDemoPage.expectFruitOutputContains('Cherry — a small red drupe.');

    testLogger.info('Test completed: fruit selection works for all three fruits');
  });

  test("should cascade country/city selection and reset city on country change", {
    tag: ['@test-demo', '@all'],
  }, async ({ page }) => {
    testLogger.info('Verifying city is disabled when no country selected');
    await pm.testDemoPage.expectCityTriggerDisabled();

    testLogger.info('Selecting country: India');
    await pm.testDemoPage.selectCountry('India');
    await pm.testDemoPage.expectLocationOutputContains('Country: India. Now pick a city.');
    await pm.testDemoPage.expectCityTriggerEnabled();

    testLogger.info('Selecting city: Bengaluru');
    await pm.testDemoPage.selectCity('Bengaluru');
    await pm.testDemoPage.expectLocationOutputContains('You selected Bengaluru, India.');

    testLogger.info('Changing country to United States — city should reset');
    await pm.testDemoPage.selectCountry('United States');
    await pm.testDemoPage.expectLocationOutputContains('Country: United States. Now pick a city.');

    testLogger.info('Test completed: cascading country/city with reset works');
  });

  // ============================================================
  // P1 — Important variations and mode toggle
  // ============================================================

  test("should toggle mode between Basic and Advanced and show/hide advanced panel", {
    tag: ['@test-demo', '@all'],
  }, async ({ page }) => {
    testLogger.info('Verifying default state: Basic mode, advanced panel hidden');
    await pm.testDemoPage.expectModeOutputContains('Basic mode');
    await pm.testDemoPage.expectAdvancedPanelNotInDOM();

    testLogger.info('Switching to Advanced mode');
    await pm.testDemoPage.clickModeAdvanced();
    await pm.testDemoPage.expectModeOutputContains('Advanced mode');
    await pm.testDemoPage.expectAdvancedPanelVisible();

    testLogger.info('Switching back to Basic mode');
    await pm.testDemoPage.clickModeBasic();
    await pm.testDemoPage.expectModeOutputContains('Basic mode');
    await pm.testDemoPage.expectAdvancedPanelHidden();

    testLogger.info('Test completed: mode toggle works correctly');
  });

  test("should select priority in advanced panel and update output", {
    tag: ['@test-demo', '@all'],
  }, async ({ page }) => {
    testLogger.info('Switching to Advanced mode');
    await pm.testDemoPage.clickModeAdvanced();

    testLogger.info('Verifying default priority output');
    await pm.testDemoPage.expectPriorityOutputContains('No priority selected.');

    testLogger.info('Selecting High priority');
    await pm.testDemoPage.selectPriority('High');
    await pm.testDemoPage.expectPriorityOutputContains('Priority set to High.');

    testLogger.info('Selecting Medium priority');
    await pm.testDemoPage.selectPriority('Medium');
    await pm.testDemoPage.expectPriorityOutputContains('Priority set to Medium.');

    testLogger.info('Selecting Low priority');
    await pm.testDemoPage.selectPriority('Low');
    await pm.testDemoPage.expectPriorityOutputContains('Priority set to Low.');

    testLogger.info('Test completed: priority selection works');
  });

  test("should show combined banner only when fruit=Cherry, priority=High, and mode=Advanced", {
    tag: ['@test-demo', '@all'],
  }, async ({ page }) => {
    testLogger.info('Setting up conditions: Advanced mode + Cherry + High priority');
    await pm.testDemoPage.clickModeAdvanced();
    await pm.testDemoPage.selectFruit('Cherry');
    await pm.testDemoPage.selectPriority('High');

    testLogger.info('Verifying combined banner is visible');
    await pm.testDemoPage.expectCombinedBannerVisible();
    await pm.testDemoPage.expectCombinedBannerContains('Critical cherry alert');

    testLogger.info('Breaking Cherry condition — banner should hide');
    await pm.testDemoPage.selectFruit('Apple');
    await pm.testDemoPage.expectCombinedBannerHidden();

    testLogger.info('Restoring Cherry — banner should reappear');
    await pm.testDemoPage.selectFruit('Cherry');
    await pm.testDemoPage.expectCombinedBannerVisible();

    testLogger.info('Breaking High condition — banner should hide');
    await pm.testDemoPage.selectPriority('Low');
    await pm.testDemoPage.expectCombinedBannerHidden();

    testLogger.info('Restoring High — banner should reappear');
    await pm.testDemoPage.selectPriority('High');
    await pm.testDemoPage.expectCombinedBannerVisible();

    testLogger.info('Breaking Advanced mode condition — banner should hide');
    await pm.testDemoPage.clickModeBasic();
    await pm.testDemoPage.expectCombinedBannerHidden();

    testLogger.info('Test completed: combined banner three-condition AND logic works');
  });

  test("should preserve priority state across mode toggles", {
    tag: ['@test-demo', '@all'],
  }, async ({ page }) => {
    testLogger.info('Setting up: Advanced mode + Cherry + High priority');
    await pm.testDemoPage.clickModeAdvanced();
    await pm.testDemoPage.selectFruit('Cherry');
    await pm.testDemoPage.selectPriority('High');
    await pm.testDemoPage.expectCombinedBannerVisible();

    testLogger.info('Switching to Basic mode — banner and panel hidden');
    await pm.testDemoPage.clickModeBasic();
    await pm.testDemoPage.expectAdvancedPanelHidden();
    await pm.testDemoPage.expectCombinedBannerHidden();

    testLogger.info('Switching back to Advanced — priority should be preserved');
    await pm.testDemoPage.clickModeAdvanced();
    await pm.testDemoPage.expectPriorityOutputContains('Priority set to High.');
    await pm.testDemoPage.expectCombinedBannerVisible();

    testLogger.info('Test completed: priority state persists across mode toggles');
  });

  // ============================================================
  // P2 — Edge cases and cross-section interaction
  // ============================================================

  test("should exercise all three sections together without cross-contamination", {
    tag: ['@test-demo', '@all'],
  }, async ({ page }) => {
    testLogger.info('Selecting Cherry in fruit section');
    await pm.testDemoPage.selectFruit('Cherry');
    await pm.testDemoPage.expectFruitOutputContains('Cherry');

    testLogger.info('Selecting Japan → Tokyo in location section');
    await pm.testDemoPage.selectCountry('Japan');
    await pm.testDemoPage.selectCity('Tokyo');
    await pm.testDemoPage.expectLocationOutputContains('You selected Tokyo, Japan.');

    testLogger.info('Switching to Advanced mode');
    await pm.testDemoPage.clickModeAdvanced();
    await pm.testDemoPage.expectAdvancedPanelVisible();

    testLogger.info('Selecting High priority — banner should appear (Cherry + High)');
    await pm.testDemoPage.selectPriority('High');
    await pm.testDemoPage.expectCombinedBannerVisible();

    testLogger.info('Switching to Basic — banner gone; location and fruit unchanged');
    await pm.testDemoPage.clickModeBasic();
    await pm.testDemoPage.expectCombinedBannerHidden();
    await pm.testDemoPage.expectFruitOutputContains('Cherry');
    await pm.testDemoPage.expectLocationOutputContains('You selected Tokyo, Japan.');

    testLogger.info('Changing fruit to Banana — break Cherry condition');
    await pm.testDemoPage.selectFruit('Banana');

    testLogger.info('Switching to Advanced — banner should NOT appear, priority preserved');
    await pm.testDemoPage.clickModeAdvanced();
    await pm.testDemoPage.expectCombinedBannerHidden();
    await pm.testDemoPage.expectPriorityOutputContains('Priority set to High.');

    testLogger.info('Verifying location output still shows Tokyo, Japan');
    await pm.testDemoPage.expectLocationOutputContains('You selected Tokyo, Japan.');

    testLogger.info('Test completed: no cross-contamination between sections');
  });

  test("should reset all state when navigating away and back", {
    tag: ['@test-demo', '@all'],
  }, async ({ page }) => {
    testLogger.info('Setting up non-default state');
    await pm.testDemoPage.selectFruit('Cherry');
    await pm.testDemoPage.clickModeAdvanced();
    await pm.testDemoPage.selectPriority('High');

    testLogger.info('Navigating away from test-demo');
    await page.goto('/');
    await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});

    testLogger.info('Navigating back to test-demo');
    await pm.testDemoPage.navigate();

    testLogger.info('Verifying state was reset to defaults');
    await pm.testDemoPage.expectFruitOutputContains('No fruit selected yet.');
    await pm.testDemoPage.expectAdvancedPanelNotInDOM();
    await pm.testDemoPage.expectCityTriggerDisabled();

    testLogger.info('Test completed: state resets on navigation away and back');
  });

  test("should verify OSelect popovers are teleported and close when option is selected", {
    tag: ['@test-demo', '@all'],
  }, async ({ page }) => {
    testLogger.info('Opening fruit dropdown and verifying popover at global scope');
    await pm.testDemoPage.fruitSelectTrigger.click();
    await pm.testDemoPage.expectFruitPopoverVisible();

    testLogger.info('Selecting Apple and verifying popover closes');
    const appleOption = pm.testDemoPage.getFruitOption('Apple');
    await appleOption.click();
    await pm.testDemoPage.expectFruitPopoverHidden();

    testLogger.info('Opening country dropdown and verifying popover at global scope');
    await pm.testDemoPage.countrySelectTrigger.click();
    await pm.testDemoPage.expectCountryPopoverVisible();

    testLogger.info('Selecting India and verifying popover closes');
    const indiaOption = pm.testDemoPage.getCountryOption('India');
    await indiaOption.click();
    await pm.testDemoPage.expectCountryPopoverHidden();

    testLogger.info('Test completed: popovers are teleported and destroyed on close');
  });
});
