const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const PageManager = require('../../pages/page-manager.js');

test.describe.configure({ mode: 'parallel' });

test.describe("Stream Index Type Configuration Tests", () => {
    let pageManager;

    test.beforeEach(async ({ page }) => {
        await navigateToBase(page);
        pageManager = new PageManager(page);
        await pageManager.streamsPage.navigateToStreamExplorer();
        await pageManager.streamsPage.waitForUI(3000); // Increased timeout for CI
    });

    // Stream Detail Index Type Configuration Tests (3 focused tests)
    test("should open stream detail and access index type options", {
        tag: ['@streams', '@indexType', '@streamDetail', '@smoke', '@all']
    }, async ({ page }) => {
        try {
            await pageManager.streamsPage.searchStream("e2e_automate");
            await pageManager.streamsPage.waitForUI(2000);
            await pageManager.streamsPage.expectStreamExistsExact("e2e_automate");
            
            await pageManager.streamsPage.openStreamDetail("e2e_automate");
            await pageManager.streamsPage.waitForUI(3000);
            await pageManager.streamsPage.searchForField("log"); // Added this line like other working tests
            await pageManager.streamsPage.waitForUI(1000);
            
            const availableOptions = await pageManager.streamsPage.verifyIndexTypeOptions();
            expect(availableOptions.length).toBeGreaterThanOrEqual(1);
            expect(availableOptions).toContain('Secondary index'); // More specific assertion
            console.log('✅ Available options found:', availableOptions);
        } catch (error) {
            console.log('Stream test error details:', error.message);
            console.log('Current URL:', page.url());
            throw error;
        }
    });

    test("should allow secondary index selection for log field", {
        tag: ['@streams', '@indexType', '@validation', '@all']
    }, async ({ page }) => {
        try {
            await pageManager.streamsPage.searchStream("e2e_automate");
            await pageManager.streamsPage.waitForUI(2000);
            await pageManager.streamsPage.expectStreamExistsExact("e2e_automate");
            
            await pageManager.streamsPage.openStreamDetail("e2e_automate");
            await pageManager.streamsPage.waitForUI(3000);
            await pageManager.streamsPage.searchForField("log");
            await pageManager.streamsPage.waitForUI(1000);
            
            // Verify secondary index option is available and selectable
            const availableOptions = await pageManager.streamsPage.verifyIndexTypeOptions();
            expect(availableOptions).toContain('Secondary index');
            
            // Select secondary index (available option in usertest)
            await pageManager.streamsPage.selectSecondaryIndex();
            await pageManager.streamsPage.waitForUI(1000);
            
            console.log('✅ Successfully selected secondary index for log field');
        } catch (error) {
            console.log('Secondary index test error details:', error.message);
            console.log('Current URL:', page.url());
            throw error;
        }
    });

    test("should verify secondary index is available option", {
        tag: ['@streams', '@indexType', '@clearingMechanism', '@all']
    }, async ({ page }) => {
        try {
            await pageManager.streamsPage.searchStream("e2e_automate");
            await pageManager.streamsPage.waitForUI(2000);
            await pageManager.streamsPage.expectStreamExistsExact("e2e_automate");
            
            await pageManager.streamsPage.openStreamDetail("e2e_automate");
            await pageManager.streamsPage.waitForUI(3000);
            await pageManager.streamsPage.searchForField("log");
            await pageManager.streamsPage.waitForUI(1000);
            
            // Verify that Secondary index option is available
            const availableOptions = await pageManager.streamsPage.verifyIndexTypeOptions();
            expect(availableOptions).toContain('Secondary index');
            console.log('✅ Available index type options:', availableOptions);
            
            // Test clicking Secondary index option
            await pageManager.streamsPage.selectSecondaryIndex();
            await pageManager.streamsPage.waitForUI(500);
            
            console.log('✅ Successfully selected secondary index option');
        } catch (error) {
            console.log('Index option test error details:', error.message);
            console.log('Current URL:', page.url());
            throw error;
        }
    });



});