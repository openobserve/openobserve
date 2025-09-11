
const { expect } = require('@playwright/test');

export class CreateOrgPage {
    constructor(page) {
        this.page = page;
    }
    async createOrg(newOrgName) {
        const basicAuthCredentials = Buffer.from(`${process.env["ZO_ROOT_USER_EMAIL"]}:${process.env["ZO_ROOT_USER_PASSWORD"]}`).toString('base64');
        const headers = {
            "Authorization": `Basic ${basicAuthCredentials}`,
            "Content-Type": "application/json",
        };

        let newOrgBody = {
            "name": newOrgName,
        }

        const fetchResponse = await fetch(
            `${process.env.INGESTION_URL}/api/organizations`,
            {
                method: "POST",
                headers: headers,
                body: JSON.stringify(newOrgBody),
            }
        );
        try {
            const response = await fetchResponse;
            const contentType = response.headers.get("content-type");
            if (contentType && contentType.includes("application/json")) {
                const jsonData = await response.json();
                console.log(response.status);
                console.log(jsonData);
                return jsonData.identifier;
                // Process JSON data here
            } else {
                const textData = await response.text();
                console.log("Response is not JSON:", textData);
                return textData;
                // Handle the non-JSON response here
            }
        } catch (error) {
            console.error("Failed to parse JSON response:", error);
            return "";
        }
    }

    async navigateToOrg() {

        await this.page.locator('[data-test="menu-link-\\/iam-item"]').click();
        await this.page.locator('[data-test="iam-organizations-tab"]').click();        
    }


    async clickAddOrg() {
        await this.page.locator('[data-test="Add Organization"]').click();
    }

    async fillOrgName(orgName) {
        //check if element is visible before filling
        const orgNameField = this.page.locator('[data-test="org-name"]');
        await orgNameField.waitFor({ state: 'visible' });
        await orgNameField.fill(orgName);
    }

    async clickSaveOrg() {
        await this.page.locator('[data-test="add-org"]').click();
    }

    async checkSaveEnabled() {
        const saveButton = this.page.locator('[data-test="add-org"]');
        
        // Check if the button is enabled
        const isEnabled = await saveButton.isEnabled();
        
        if (!isEnabled) {
            console.error('The "Add Organization" button is not enabled.');
            return false; // Return false to indicate the button is not enabled
        }
        
        return true; // Return true if the button is enabled
    }
    
    async clickCancelButton() {
        const cancelButton = this.page.locator('[data-test="cancel-organizations-modal"]');
        
        // Check if the button is visible and enabled before clicking
        const isVisible = await cancelButton.isVisible();
        const isEnabled = await cancelButton.isEnabled();
        
        if (isVisible && isEnabled) {
            await cancelButton.click();
        } else {
            console.error('The "Cancel" button is not visible or enabled.');
            throw new Error('Attempted to click "Cancel" button, but it is not visible or enabled.');
        }
    }
    

    async searchOrg(orgName) {
        await this.page.getByPlaceholder('Search Organization').click();
        await this.page.getByPlaceholder('Search Organization').fill(orgName);
        await this.page.waitForTimeout(5000);
    }
    
    async verifyOrgNotExists() {
        const mainSection = this.page.locator('[data-test="iam-page"]').getByRole('main');
        const textContent = await mainSection.textContent();
        console.log('Main section text:', textContent); // Debugging line
        await expect(mainSection).toContainText('No data available');
    }
    
    async verifyOrgExists(orgName) {
        await expect(this.page.locator('tbody')).toContainText(orgName);
    }

    async deleteOrgViaAPI(orgIdentifier) {
        console.log(`⚠️  WARNING: Organization deletion may not be supported in this environment`);
        
        const basicAuthCredentials = Buffer.from(`${process.env["ZO_ROOT_USER_EMAIL"]}:${process.env["ZO_ROOT_USER_PASSWORD"]}`).toString('base64');
        const headers = {
            "Authorization": `Basic ${basicAuthCredentials}`,
            "Content-Type": "application/json",
        };

        try {
            const fetchResponse = await fetch(
                `${process.env.INGESTION_URL}/api/organizations/${orgIdentifier}`,
                {
                    method: "DELETE",
                    headers: headers,
                }
            );
            
            console.log(`Delete org API response - Status: ${fetchResponse.status}`);
            const responseText = await fetchResponse.text();
            console.log(`Delete org API response - Body: ${responseText}`);
            
            if (fetchResponse.ok) {
                console.log(`✓ Organization ${orgIdentifier} deletion API call succeeded`);
                return true;
            } else if (fetchResponse.status === 403) {
                console.log(`✗ Organization deletion forbidden (403) - deletion not allowed in this environment`);
                return false;
            } else if (fetchResponse.status === 404) {
                console.log(`ℹ Organization ${orgIdentifier} not found (404) - may already be deleted`);
                return true; // Consider 404 as success since org doesn't exist
            } else {
                console.log(`✗ Failed to delete organization ${orgIdentifier}: Status ${fetchResponse.status} - ${responseText}`);
                return false;
            }
        } catch (error) {
            console.error(`✗ Error during organization deletion API call:`, error);
            return false;
        }
    }

    async deleteOrgViaUI(orgName) {
        console.log(`⚠️  WARNING: UI deletion may not be supported - delete buttons might not exist`);
        
        try {
            // Search for the organization first
            await this.searchOrg(orgName);
            await this.page.waitForTimeout(1000);
            
            // Check if any delete buttons exist in the table at all
            const anyDeleteButtons = this.page.locator('[data-test*="delete"]', '[title*="delete" i]', 'button:has-text("Delete")');
            const deleteButtonCount = await anyDeleteButtons.count();
            console.log(`Found ${deleteButtonCount} delete buttons in the organization table`);
            
            if (deleteButtonCount === 0) {
                console.log(`✗ No delete buttons found in organization table - deletion likely not supported in UI`);
                return false;
            }
            
            // Look for delete button in the organization row
            const deleteButton = this.page.locator(`[data-test="org-delete-${orgName}"]`).or(
                this.page.locator('tbody tr').filter({ hasText: orgName }).locator('[data-test*="delete"]')
            );
            
            if (await deleteButton.isVisible({ timeout: 5000 })) {
                console.log(`Found delete button for organization ${orgName}, attempting to click...`);
                await deleteButton.click();
                await this.page.waitForTimeout(1000);
                
                // Confirm deletion if confirmation dialog appears
                const confirmButton = this.page.locator('[data-test="confirm-delete"]').or(
                    this.page.getByRole('button', { name: /delete|confirm|yes/i })
                );
                
                if (await confirmButton.isVisible({ timeout: 3000 })) {
                    console.log(`Confirmation dialog appeared, confirming deletion...`);
                    await confirmButton.click();
                    await this.page.waitForTimeout(2000);
                    
                    // Check if organization is actually gone
                    await this.searchOrg(orgName);
                    const stillExists = await this.page.locator('tbody tr').filter({ hasText: orgName }).isVisible({ timeout: 2000 });
                    
                    if (stillExists) {
                        console.log(`✗ Organization ${orgName} still exists after UI deletion - deletion may be restricted`);
                        return false;
                    } else {
                        console.log(`✓ Organization ${orgName} successfully deleted via UI`);
                        return true;
                    }
                } else {
                    console.log(`✗ No confirmation dialog appeared for ${orgName} deletion`);
                    return false;
                }
            } else {
                console.log(`✗ Delete button not found for organization ${orgName}`);
                return false;
            }
        } catch (error) {
            console.error(`✗ Failed to delete organization ${orgName} via UI:`, error);
            return false;
        }
    }

    async getOrgIdentifierFromTable(orgName) {
        const maxRetries = 3;
        const retryDelay = 1000;
        
        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
                console.log(`Attempting to get identifier for ${orgName} (attempt ${attempt}/${maxRetries})`);
                
                // Ensure we search for the organization first to make it visible
                await this.searchOrg(orgName);
                await this.page.waitForLoadState('networkidle', { timeout: 5000 });
                
                // Wait for table to be stable
                await this.page.locator('tbody tr').first().waitFor({ state: 'visible', timeout: 5000 });
                
                // Find the row containing the organization name with exact match
                const orgRow = this.page.locator('tbody tr').filter({ hasText: new RegExp(`\\b${orgName}\\b`) });
                
                if (!(await orgRow.isVisible({ timeout: 3000 }))) {
                    console.log(`Organization row not visible for ${orgName} on attempt ${attempt}`);
                    if (attempt < maxRetries) {
                        await this.page.waitForTimeout(retryDelay);
                        continue;
                    }
                    return null;
                }
                
                // Get all cell text content at once for analysis
                const cellTexts = await orgRow.locator('td').allTextContents();
                console.log(`Row data for ${orgName}:`, cellTexts);
                
                // Find identifier using multiple strategies with improved patterns
                let identifier = null;
                
                // Strategy 1: Look for UUID pattern (32 chars, alphanumeric)
                for (let i = 0; i < cellTexts.length; i++) {
                    const text = cellTexts[i]?.trim();
                    if (!text || text === orgName) continue;
                    
                    // Check for standard UUID pattern (32 chars, alphanumeric)
                    if (/^[a-zA-Z0-9]{32}$/.test(text)) {
                        identifier = text;
                        console.log(`Found UUID identifier: ${identifier}`);
                        break;
                    }
                }
                
                // Strategy 2: Look for shorter hash pattern (16-24 chars)
                if (!identifier) {
                    for (let i = 0; i < cellTexts.length; i++) {
                        const text = cellTexts[i]?.trim();
                        if (!text || text === orgName) continue;
                        
                        // Check for shorter hash pattern
                        if (/^[a-zA-Z0-9]{16,24}$/.test(text)) {
                            identifier = text;
                            console.log(`Found hash identifier: ${identifier}`);
                            break;
                        }
                    }
                }
                
                // Strategy 3: Use positional approach - identifier typically in second column
                if (!identifier && cellTexts.length >= 2) {
                    const secondCol = cellTexts[1]?.trim();
                    // Validate it's not a common non-identifier value
                    if (secondCol && 
                        secondCol !== orgName && 
                        secondCol.length >= 8 && 
                        secondCol.length <= 50 &&
                        !/^(active|inactive|enabled|disabled|default|admin|user|root|true|false|\d{4}-\d{2}-\d{2})$/i.test(secondCol) &&
                        !/\s/.test(secondCol)) {
                        identifier = secondCol;
                        console.log(`Using positional identifier: ${identifier}`);
                    }
                }
                
                if (identifier) {
                    console.log(`Successfully found identifier for ${orgName}: ${identifier}`);
                    return identifier;
                }
                
                console.log(`No suitable identifier found for ${orgName} on attempt ${attempt}`);
                if (attempt < maxRetries) {
                    await this.page.waitForTimeout(retryDelay);
                }
                
            } catch (error) {
                console.error(`Error getting identifier for ${orgName} on attempt ${attempt}:`, error.message);
                if (attempt < maxRetries) {
                    await this.page.waitForTimeout(retryDelay);
                }
            }
        }
        
        console.warn(`Failed to get identifier for ${orgName} after ${maxRetries} attempts`);
        return null;
    }

}
