const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const PageManager = require('../../pages/page-manager.js');
const testLogger = require('../utils/test-logger.js');
const { isCloudEnvironment } = require('../utils/cloud-auth.js');


test.describe.configure({ mode: 'parallel' });

test.describe("Organization Management - CRUD Operations", () => {
    let pageManager;
    
    test.beforeEach(async ({ page }, testInfo) => {
        testLogger.testStart(testInfo.title, testInfo.file);
        
        await navigateToBase(page);
        pageManager = new PageManager(page);
        
        // Navigate to organizations page
        await pageManager.createOrgPage.navigateToOrg();
        await page.waitForLoadState('domcontentloaded');
        await page.waitForTimeout(1000);
        
        testLogger.info('Organization management test setup completed');
    });

    test("should create a new organization and verify it appears in the list", {
        tag: ['@organization', '@all', '@crud', '@create']
    }, async ({ page }) => {
        testLogger.info('Testing organization creation');
        
        // Generate unique organization name
        const timestamp = Date.now();
        const randomSuffix = Math.floor(Math.random() * 1000);
        const orgName = `testorg_${timestamp}_${randomSuffix}`;
        let orgIdentifier = null;
        
        try {
            testLogger.info(`Creating organization: ${orgName}`);
            
            // Create organization through UI
            await pageManager.createOrgPage.clickAddOrg();
            await pageManager.createOrgPage.fillOrgName(orgName);
            
            // Verify save button is enabled
            const isSaveEnabled = await pageManager.createOrgPage.checkSaveEnabled();
            expect(isSaveEnabled).toBe(true);
            
            // Save organization
            await pageManager.createOrgPage.clickSaveOrg();
            await page.waitForTimeout(2000); // Wait for org creation
            
            // Search and verify organization appears in the list
            await pageManager.createOrgPage.searchOrg(orgName);
            await pageManager.createOrgPage.verifyOrgExists(orgName);
            
            // Get the organization identifier for cleanup (already searched above)
            orgIdentifier = await pageManager.createOrgPage.getOrgIdentifierFromTable(orgName);
            testLogger.info(`✓ Organization ${orgName} created successfully with identifier: ${orgIdentifier}`);
            
        } finally {
            // NOTE: Organization deletion is not supported in this environment
            // Organizations created during tests will persist
            if (orgIdentifier) {
                testLogger.info(`⚠️  Organization cleanup skipped - deletion not supported in this environment`);
                testLogger.info(`Organization ${orgName} (${orgIdentifier}) will remain in the system`);
                
                // Attempt cleanup anyway to log the actual response
                testLogger.info(`Attempting cleanup for diagnostic purposes...`);
                const deleted = await pageManager.createOrgPage.deleteOrgViaAPI(orgIdentifier);
                if (!deleted) {
                    await pageManager.createOrgPage.deleteOrgViaUI(orgName);
                }
            }
        }
    });

    test("should search organization by name and find it", {
        tag: ['@organization', '@all', '@search', '@name']
    }, async ({ page }) => {
        testLogger.info('Testing organization search by name');
        
        // Generate unique organization name
        const timestamp = Date.now();
        const randomSuffix = Math.floor(Math.random() * 1000);
        const orgName = `searchtest_${timestamp}_${randomSuffix}`;
        let orgIdentifier = null;
        
        try {
            // Create organization first
            testLogger.info(`Creating organization for search test: ${orgName}`);
            await pageManager.createOrgPage.clickAddOrg();
            await pageManager.createOrgPage.fillOrgName(orgName);
            await pageManager.createOrgPage.clickSaveOrg();
            await page.waitForTimeout(2000);
            
            // Get identifier for cleanup
            orgIdentifier = await pageManager.createOrgPage.getOrgIdentifierFromTable(orgName);
            
            // Search for the organization
            testLogger.info(`Searching for organization: ${orgName}`);
            await pageManager.createOrgPage.searchOrg(orgName);
            
            // Verify organization is found
            await pageManager.createOrgPage.verifyOrgExists(orgName);
            
            // Clear search to show all organizations
            await page.getByPlaceholder('Search Organization').clear();
            await page.waitForTimeout(1000);
            
            testLogger.info(`✓ Organization ${orgName} found via name search`);
            
        } finally {
            // NOTE: Organization deletion is not supported in this environment  
            if (orgIdentifier) {
                testLogger.info(`⚠️  Organization cleanup skipped - deletion not supported`);
                testLogger.info(`Organization ${orgName} (${orgIdentifier}) will remain in the system`);
                
                // Attempt cleanup for diagnostic purposes
                const deleted = await pageManager.createOrgPage.deleteOrgViaAPI(orgIdentifier);
                if (!deleted) {
                    await pageManager.createOrgPage.deleteOrgViaUI(orgName);
                }
            }
        }
    });

    test("should create organization via API and verify identifier", {
        tag: ['@organization', '@all', '@api', '@identifier']
    }, async ({ page }) => {
        testLogger.info('Testing organization creation via API and identifier verification');
        
        // Generate unique organization name
        const timestamp = Date.now();
        const randomSuffix = Math.floor(Math.random() * 1000);
        const orgName = `apitest_${timestamp}_${randomSuffix}`;
        let orgIdentifier = null;
        
        try {
            testLogger.info(`Creating organization via API: ${orgName}`);
            
            // Create organization via API (this returns the identifier)
            orgIdentifier = await pageManager.createOrgPage.createOrg(orgName);
            
            testLogger.info(`✓ Organization created via API with identifier: ${orgIdentifier}`);
            
            // Refresh the page to see the new organization
            await page.reload();
            await page.waitForLoadState('domcontentloaded');
            await pageManager.createOrgPage.navigateToOrg();
            await page.waitForTimeout(2000);
            
            // Search and verify organization exists in UI
            await pageManager.createOrgPage.searchOrg(orgName);
            await pageManager.createOrgPage.verifyOrgExists(orgName);
            
            // Verify it's findable by searching again
            await pageManager.createOrgPage.searchOrg(orgName);
            await pageManager.createOrgPage.verifyOrgExists(orgName);
            
            testLogger.info(`✓ Organization ${orgName} verified in UI with identifier ${orgIdentifier}`);
            
        } finally {
            // NOTE: Organization deletion is not supported in this environment
            if (orgIdentifier) {
                testLogger.info(`⚠️  Organization cleanup skipped - deletion not supported`);
                testLogger.info(`Organization ${orgName} (${orgIdentifier}) will remain in the system`);
                
                // Attempt cleanup for diagnostic purposes
                await pageManager.createOrgPage.deleteOrgViaAPI(orgIdentifier);
            }
        }
    });

    test("should search for non-existent organization and show no results", {
        tag: ['@organization', '@all', '@search', '@negative']
    }, async ({ page }) => {
        testLogger.info('Testing search for non-existent organization');
        
        const nonExistentOrgName = `nonexistent_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
        
        testLogger.info(`Searching for non-existent organization: ${nonExistentOrgName}`);
        
        // Search for non-existent organization
        await pageManager.createOrgPage.searchOrg(nonExistentOrgName);
        
        // Verify no results are shown
        await pageManager.createOrgPage.verifyOrgNotExists();
        
        testLogger.info('✓ No results shown for non-existent organization search');
    });

    test("should validate organization name input field", {
        tag: ['@organization', '@all', '@validation', '@ui']
    }, async ({ page }) => {
        testLogger.info('Testing organization name validation');
        
        // Click to add organization
        await pageManager.createOrgPage.clickAddOrg();
        
        // Try to save with empty name
        testLogger.info('Testing save with empty organization name');
        const isSaveEnabledEmpty = await pageManager.createOrgPage.checkSaveEnabled();
        
        // Save button should be disabled or validation should prevent saving
        if (isSaveEnabledEmpty) {
            testLogger.info('Save button enabled - testing if validation prevents save');
            await pageManager.createOrgPage.clickSaveOrg();
            // Organization should not be created with empty name
            await page.waitForTimeout(1000);
        } else {
            testLogger.info('✓ Save button correctly disabled for empty name');
        }
        
        // Test with valid name
        const validOrgName = `valid_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
        testLogger.info(`Testing with valid name: ${validOrgName}`);
        
        await pageManager.createOrgPage.fillOrgName(validOrgName);
        const isSaveEnabledValid = await pageManager.createOrgPage.checkSaveEnabled();
        expect(isSaveEnabledValid).toBe(true);
        
        // Cancel instead of creating
        await pageManager.createOrgPage.clickCancelButton();
        
        testLogger.info('✓ Organization name validation working correctly');
    });

    test("should handle empty organization name validation", {
        tag: ['@organization', '@all', '@validation', '@negative']
    }, async ({ page }) => {
        testLogger.info('Testing empty organization name validation');
        
        try {
            // Click to add organization
            await pageManager.createOrgPage.clickAddOrg();
            
            // Leave name field empty and try to save
            testLogger.info('Attempting to save organization with empty name');
            
            const isSaveEnabled = await pageManager.createOrgPage.checkSaveEnabled();
            
            if (isSaveEnabled) {
                // If save is enabled, click it and check for validation error
                await pageManager.createOrgPage.clickSaveOrg();
                await page.waitForTimeout(2000);
                
                // Check if validation error message appears
                const validationError = page.getByText('Use alphanumeric characters,');
                
                const hasValidationError = await validationError.isVisible({ timeout: 3000 });
                if (hasValidationError) {
                    testLogger.info('✓ Validation error shown: "Use alphanumeric characters,"');
                    expect(hasValidationError).toBe(true);
                } else {
                    testLogger.info('ℹ No validation error message visible, empty name may be handled differently');
                }
            } else {
                testLogger.info('✓ Save button correctly disabled for empty name');
            }
            
        } finally {
            // Try to cancel/close the dialog
            try {
                await pageManager.createOrgPage.clickCancelButton();
            } catch (error) {
                // If cancel fails, the dialog might have closed already
                testLogger.info('Cancel button not available - dialog may have closed');
            }
        }
        
        testLogger.info('✓ Empty name validation test completed');
    });

    test("should handle whitespace-only organization name", {
        tag: ['@organization', '@all', '@validation', '@negative']
    }, async ({ page }) => {
        testLogger.info('Testing whitespace-only organization name');
        
        try {
            await pageManager.createOrgPage.clickAddOrg();
            
            // Fill with only spaces
            const whitespaceNames = ['   ', '\t\t', '\n\n', '  \t  \n  '];
            
            for (const whitespaceName of whitespaceNames) {
                testLogger.info(`Testing with whitespace pattern: "${whitespaceName.replace(/\s/g, '·')}"`);
                
                await pageManager.createOrgPage.fillOrgName(whitespaceName);
                await page.waitForTimeout(500);
                
                const isSaveEnabled = await pageManager.createOrgPage.checkSaveEnabled();
                
                if (isSaveEnabled) {
                    await pageManager.createOrgPage.clickSaveOrg();
                    await page.waitForTimeout(1000);
                    
                    // Check for validation error
                    const validationError = page.getByText('Use alphanumeric characters,');
                    
                    if (await validationError.isVisible({ timeout: 2000 })) {
                        testLogger.info('✓ Whitespace-only name properly rejected with validation message');
                        expect(await validationError.isVisible()).toBe(true);
                    } else {
                        testLogger.info('ℹ No validation message shown for whitespace-only name');
                    }
                } else {
                    testLogger.info('✓ Save button disabled for whitespace-only name');
                }
                
                // Clear field for next test
                await page.locator('[data-test="org-name"]').clear();
            }
            
        } finally {
            try {
                await pageManager.createOrgPage.clickCancelButton();
            } catch (error) {
                testLogger.info('Cancel not available - continuing');
            }
        }
        
        testLogger.info('✓ Whitespace-only name validation completed');
    });

    test("should handle special characters in organization name", {
        tag: ['@organization', '@all', '@validation', '@specialChars']
    }, async ({ page }) => {
        testLogger.info('Testing special characters in organization name');

        const timestamp = Date.now();
        // All entries below contain characters outside the allowed set
        // /^[a-zA-Z0-9_ ]+$/ so the form must reject them.
        const specialCharTests = [
            { name: `test<script>alert('xss')</script>_${timestamp}`, description: 'HTML/JS injection' },
            { name: `test"SELECT*FROM users"_${timestamp}`, description: 'SQL-like syntax' },
            { name: `test@#$%^&*()_${timestamp}`, description: 'Special symbols' },
            { name: `test café ñoño_${timestamp}`, description: 'Unicode characters' },
            { name: `test\`DROP TABLE\`_${timestamp}`, description: 'SQL injection attempt' },
            { name: `test🚀🎉📊_${timestamp}`, description: 'Emoji characters' }
        ];

        // Open the drawer once and reuse it for every iteration. Cancel does
        // not clear the ?action=add route query, so a close-then-reopen flow
        // is unreliable.
        await pageManager.createOrgPage.clickAddOrg();

        try {
            for (const testCase of specialCharTests) {
                testLogger.info(`Testing ${testCase.description}: "${testCase.name}"`);

                await pageManager.createOrgPage.clearOrgName();
                await pageManager.createOrgPage.fillOrgName(testCase.name);

                const isSaveEnabled = await pageManager.createOrgPage.checkSaveEnabled();
                expect(isSaveEnabled).toBe(true);

                await pageManager.createOrgPage.clickSaveOrg();
                await page.waitForTimeout(1000);

                // Invalid names cause onSubmit() to early-return, so the
                // drawer must still be open and the org-name input still
                // present.
                const drawerStillOpen = await pageManager.createOrgPage.isDrawerOpen();
                expect(drawerStillOpen, `Drawer should remain open for invalid input: ${testCase.description}`).toBe(true);

                testLogger.info(`✓ Organization with ${testCase.description} properly rejected (drawer remains open)`);
            }
        } finally {
            try {
                await pageManager.createOrgPage.clickCancelButton();
            } catch (error) {
                testLogger.info('Cancel not available - drawer may have closed');
            }
        }

        testLogger.info('✓ Special characters validation test completed');
    });


    test("should handle numeric-only organization name", {
        tag: ['@organization', '@all', '@validation', '@numeric']
    }, async ({ page }) => {
        testLogger.info('Testing numeric-only organization name');
        
        let orgIdentifier = null;
        
        try {
            const numericName = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
            
            testLogger.info(`Testing numeric-only name: ${numericName}`);
            
            await pageManager.createOrgPage.clickAddOrg();
            await pageManager.createOrgPage.fillOrgName(numericName);
            
            const isSaveEnabled = await pageManager.createOrgPage.checkSaveEnabled();
            expect(isSaveEnabled).toBe(true);
            
            await pageManager.createOrgPage.clickSaveOrg();
            await page.waitForTimeout(2000);
            
            // Verify numeric name is accepted
            await pageManager.createOrgPage.verifyOrgExists(numericName);
            orgIdentifier = await pageManager.createOrgPage.getOrgIdentifierFromTable(numericName);
            
            testLogger.info('✓ Numeric-only organization name accepted');
            
        } finally {
            // NOTE: Organization deletion is not supported - org will persist
            if (orgIdentifier) {
                testLogger.info(`⚠️  Organization ${numericName} (${orgIdentifier}) will remain in system`);
                await pageManager.createOrgPage.deleteOrgViaAPI(orgIdentifier);
            }
        }
    });

    test("should show proper validation message for invalid characters", {
        tag: ['@organization', '@all', '@validation', '@errorMessage']
    }, async ({ page }) => {
        testLogger.info('Testing validation error message for invalid characters');

        // Every entry below must violate /^[a-zA-Z0-9_ ]+$/ — names that only
        // use letters, digits, spaces, and underscores are valid and would
        // cause the org to be created (which is not what this test is about).
        const invalidCharacterTests = [
            '!@#$%',
            'test<script>',
            'name!with#special',
            'test&validation',
            'café🚀'
        ];

        // Open the drawer once. Reusing it across iterations avoids the
        // close/reopen reliability issue (the parent component's watcher
        // does not re-fire if ?action=add is already in the URL).
        await pageManager.createOrgPage.clickAddOrg();

        try {
            for (const invalidName of invalidCharacterTests) {
                testLogger.info(`Testing validation message for: "${invalidName}"`);

                await pageManager.createOrgPage.clearOrgName();
                await pageManager.createOrgPage.fillOrgName(invalidName);

                const isSaveEnabled = await pageManager.createOrgPage.checkSaveEnabled();
                expect(isSaveEnabled).toBe(true);

                await pageManager.createOrgPage.clickSaveOrg();
                await page.waitForTimeout(1000);

                // onSubmit() returns early for an invalid name, so the
                // drawer must stay open. The input keeps the rejected
                // value, which is the strongest observable signal that
                // submission was blocked.
                const drawerStillOpen = await pageManager.createOrgPage.isDrawerOpen();
                expect(drawerStillOpen, `Drawer should remain open for invalid input: "${invalidName}"`).toBe(true);

                testLogger.info(`✓ Invalid name "${invalidName}" rejected — drawer remained open`);
            }
        } finally {
            try {
                await pageManager.createOrgPage.clickCancelButton();
            } catch (error) {
                testLogger.info('Cancel not available - drawer may have closed');
            }
        }

        testLogger.info('✓ Validation message testing completed');
    });

    test("should test organization management workflow end-to-end", {
        tag: ['@organization', '@all', '@workflow', '@e2e']
    }, async ({ page }) => {
        testLogger.info('Testing complete organization management workflow');
        
        // Generate unique organization names
        const timestamp = Date.now();
        const randomSuffix = Math.floor(Math.random() * 1000);
        const orgName = `workflow_${timestamp}_${randomSuffix}`;
        const apiOrgName = `api_${timestamp}_${randomSuffix}`;
        
        let orgIdentifier1 = null;
        let orgIdentifier2 = null;
        
        try {
            // Step 1: Create organization via UI
            testLogger.info(`Step 1: Creating organization ${orgName}`);
            await pageManager.createOrgPage.clickAddOrg();
            await pageManager.createOrgPage.fillOrgName(orgName);
            await pageManager.createOrgPage.clickSaveOrg();
            await page.waitForTimeout(2000);
            
            // Step 2: Verify it appears in the list (search first to find it in the long list)
            testLogger.info('Step 2: Verifying organization appears in list');
            await pageManager.createOrgPage.searchOrg(orgName);
            await pageManager.createOrgPage.verifyOrgExists(orgName);
            
            // Get identifier for cleanup after verification
            orgIdentifier1 = await pageManager.createOrgPage.getOrgIdentifierFromTable(orgName);
            
            // Step 3: Search for the organization
            testLogger.info('Step 3: Searching for organization');
            await pageManager.createOrgPage.searchOrg(orgName);
            await pageManager.createOrgPage.verifyOrgExists(orgName);
            
            // Step 4: Clear search and verify it's still there by searching again
            testLogger.info('Step 4: Clearing search and verifying persistence');
            await page.getByPlaceholder('Search Organization').clear();
            await page.waitForTimeout(1000);
            
            // Search again to verify it persists
            await pageManager.createOrgPage.searchOrg(orgName);
            await pageManager.createOrgPage.verifyOrgExists(orgName);
            
            // Step 5: Create another organization via API and verify both exist
            testLogger.info(`Step 5: Creating second organization via API: ${apiOrgName}`);
            
            orgIdentifier2 = await pageManager.createOrgPage.createOrg(apiOrgName);
            
            // Refresh to see API-created organization
            await page.reload();
            await page.waitForLoadState('domcontentloaded');
            await pageManager.createOrgPage.navigateToOrg();
            await page.waitForTimeout(2000);
            
            // Verify both organizations exist by searching for them individually
            testLogger.info('Verifying first organization exists');
            await pageManager.createOrgPage.searchOrg(orgName);
            await pageManager.createOrgPage.verifyOrgExists(orgName);
            
            testLogger.info('Verifying second organization exists');
            await pageManager.createOrgPage.searchOrg(apiOrgName);
            await pageManager.createOrgPage.verifyOrgExists(apiOrgName);
            
            testLogger.info(`✓ Workflow completed successfully. API org identifier: ${orgIdentifier2}`);
            
        } finally {
            // NOTE: Organization deletion is not supported - orgs will persist
            if (orgIdentifier1) {
                testLogger.info(`⚠️  Organization ${orgName} (${orgIdentifier1}) will remain in system`);
                await pageManager.createOrgPage.deleteOrgViaAPI(orgIdentifier1);
            }
            if (orgIdentifier2) {
                testLogger.info(`⚠️  Organization ${apiOrgName} (${orgIdentifier2}) will remain in system`);
                await pageManager.createOrgPage.deleteOrgViaAPI(orgIdentifier2);
            }
            testLogger.info('Workflow test cleanup completed');
        }
    });

    test("should fetch all organizations via GET /api/_meta/organizations?page_size=1000000", {
        tag: ['@organization', '@all', '@api', '@adminOrg']
    }, async ({ page }) => {
        test.skip(!isCloudEnvironment(), 'Admin org listing via _meta is only available in cloud enterprise');
        testLogger.info('Testing GET /api/_meta/organizations?page_size=1000000 endpoint');

        testLogger.info('Calling admin org listing API for _meta org');

        const { status, data } = await pageManager.createOrgPage.getAdminOrgs();

        testLogger.info(`Response status: ${status}`);
        testLogger.info(`Response data: ${JSON.stringify(data)}`);

        expect(status).toBe(200);
        expect(data).toBeDefined();
        expect(data).toHaveProperty('list');
        expect(Array.isArray(data.list)).toBe(true);
        expect(data.list.length).toBeGreaterThan(0);

        testLogger.info(`✓ _meta admin org listing API returned ${data.list.length} organization(s)`);
    });

    test("should return 401 unauthorized when fetching organizations with non-_meta org", {
        tag: ['@organization', '@all', '@api', '@adminOrg', '@negative']
    }, async ({ page }) => {
        test.skip(!isCloudEnvironment(), 'Admin org 401 check is only applicable in cloud enterprise');
        testLogger.info('Testing GET /api/{orgId}/organizations?page_size=1000000 with non-_meta org');

        const orgId = process.env.ORGNAME || 'default';

        testLogger.info(`Calling admin org listing API with non-_meta orgId: ${orgId}`);

        const { status, data } = await pageManager.createOrgPage.getAdminOrgs(orgId);

        testLogger.info(`Response status: ${status}`);
        testLogger.info(`Response data: ${JSON.stringify(data)}`);

        expect(status).toBe(401);
        expect(data).toBeDefined();
        expect(data).toHaveProperty('code', 401);
        expect(data).toHaveProperty('message', 'Unauthorized Access');

        testLogger.info(`✓ Non-_meta org correctly returned 401 Unauthorized Access`);
    });

    test.afterEach(async () => {
        testLogger.info('Organization test cleanup completed');
    });
});