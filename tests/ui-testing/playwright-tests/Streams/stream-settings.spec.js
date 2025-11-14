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

    // Stream Detail Index Type Configuration Tests (2 focused tests)
    test("should check FTS and secondary index options are available", {
        tag: ['@streams', '@indexType', '@streamDetail', '@smoke', '@all']
    }, async ({ page }) => {
        await pageManager.streamsPage.searchStream("e2e_automate");
        await pageManager.streamsPage.expectStreamExistsExact("e2e_automate");
        
        await pageManager.streamsPage.openStreamDetail("e2e_automate");
        await pageManager.streamsPage.searchForField("job");
        
        const availableOptions = await pageManager.streamsPage.verifyIndexTypeOptions();
        expect(availableOptions.length).toBeGreaterThan(0);
    });

    test("should show validation error when selecting both index types", {
        tag: ['@streams', '@indexType', '@validation', '@all']
    }, async () => {
        await pageManager.streamsPage.searchStream("e2e_automate");
        await pageManager.streamsPage.expectStreamExistsExact("e2e_automate");
        
        await pageManager.streamsPage.openStreamDetail("e2e_automate");
        await pageManager.streamsPage.searchForField("level");
        
        // Select both index types (this should cause validation error)
        await pageManager.streamsPage.selectFullTextSearch();
        await pageManager.streamsPage.selectSecondaryIndex();
        await pageManager.streamsPage.clickUpdateSettingsButton();
        
        // STRICT ASSERTION: Verify validation error appears - this should fail if no error shown
        await pageManager.streamsPage.expectValidationErrorVisible();
    });

    test.afterAll(async ({ page }) => {
        // Refresh page after all tests complete
        await page.reload();
        console.log('✅ Page refreshed after all tests completed');
    });



});