
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
        // Wait for the IAM menu link to be visible
        await this.page.waitForSelector('[data-test="menu-link-\\/iam-item"]');
        await this.page.locator('[data-test="menu-link-\\/iam-item"]').click();

        await this.page.goto(process.env["ZO_BASE_URL"] + "/web/iam/organizations?org_identifier=default");
        await this.page.waitForTimeout(10000);
    
   
    }
    


    async clickAddOrg() {
        await this.page.goto(process.env["ZO_BASE_URL"] + "/web/iam/organizations?action=add&org_identifier=default");
        await this.page.waitForTimeout(10000);
    }

    async fillOrgName(orgName) {
        await this.page.waitForSelector('[data-test="org-name"]');
        await this.page.locator('[data-test="org-name"]').fill(orgName);
    }

    async clickSaveOrg() {
        await this.page.waitForSelector('[data-test="add-org"]');
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
    
    async verifyOrgNotExists(expect) {
        const mainSection = this.page.locator('[data-test="iam-page"]').getByRole('main');
        const textContent = await mainSection.textContent();
        console.log('Main section text:', textContent); // Debugging line
        await expect(mainSection).toContainText('No data available');
    }
    
    async verifyOrgExists(orgName) {

        await expect(this.page.locator('tbody')).toContainText(orgName);

    }
    


}
