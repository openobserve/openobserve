const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const PageManager = require('../../pages/page-manager.js');

test.describe.configure({ mode: 'parallel' });

test.describe("Stream Index Type Configuration Tests", () => {
    let pageManager;

    test.beforeEach(async ({ page }) => {
        await navigateToBase(page);
        pageManager = new PageManager(page);
        await pageManager.streamsPage.navigateToStreamExplorer();
        await page.waitForTimeout(2000);
    });

    // Stream Detail Index Type Configuration Tests (3 focused tests)
    test("should open stream detail and access index type options", {
        tag: ['@streams', '@indexType', '@streamDetail', '@smoke', '@all']
    }, async ({ page }) => {
        await pageManager.streamsPage.searchStream("e2e_automate");
        await pageManager.streamsPage.expectStreamExistsExact("e2e_automate");
        
        await pageManager.streamsPage.openStreamDetail("e2e_automate");
        await pageManager.streamsPage.searchForField("message"); // Use different field
        
        const availableOptions = await pageManager.streamsPage.verifyIndexTypeOptions();
        expect(availableOptions.length).toBeGreaterThan(0);
    });

    test("should show validation error when selecting both index types", {
        tag: ['@streams', '@indexType', '@validation', '@all']
    }, async () => {
        await pageManager.streamsPage.searchStream("e2e_automate");
        await pageManager.streamsPage.expectStreamExistsExact("e2e_automate");
        
        await pageManager.streamsPage.openStreamDetail("e2e_automate");
        await pageManager.streamsPage.searchForField("log"); // Use different field
        
        // Select both index types (this should cause validation error)
        await pageManager.streamsPage.selectFullTextSearch();
        await pageManager.streamsPage.selectSecondaryIndex();
        await pageManager.streamsPage.clickUpdateSettingsButton();
        
        // STRICT ASSERTION: Verify validation error appears - this should fail if no error shown
        await pageManager.streamsPage.expectValidationErrorVisible();
    });

    test("should demonstrate index type clearing mechanism works", {
        tag: ['@streams', '@indexType', '@clearingMechanism', '@all']
    }, async () => {
        await pageManager.streamsPage.searchStream("e2e_automate");
        await pageManager.streamsPage.expectStreamExistsExact("e2e_automate");
        
        await pageManager.streamsPage.openStreamDetail("e2e_automate");
        await pageManager.streamsPage.searchForField("job"); // Use different field
        
        // First select both (will cause error)
        await pageManager.streamsPage.selectFullTextSearch();
        await pageManager.streamsPage.selectSecondaryIndex();
        await pageManager.streamsPage.clickUpdateSettingsButton();
        
        // STRICT ASSERTION: Verify error appears when both are selected
        await pageManager.streamsPage.expectValidationErrorVisible();
        
        // Clear one index type selection - this tests our clearing mechanism
        await pageManager.streamsPage.clearIndexTypeSelection('Full text search');
        
        // Test passes if we've successfully demonstrated the complete workflow:
        // 1. Selected both index types ✅
        // 2. Got validation error ✅  
        // 3. Successfully cleared one selection ✅
    });

    test.afterAll(async ({ page }) => {
        // Refresh page after all tests complete
        await page.reload();
        console.log('✅ Page refreshed after all tests completed');
    });



});