import { test, expect } from "./baseFixtures";
import logData from "../../ui-testing/cypress/fixtures/log.json";
import logsdata from "../../test-data/logs_data.json";
import { LogsPage } from '../pages/logsPage.js';

test.describe.configure({ mode: 'serial' });
const streamName = `stream${Date.now()}`;

async function login(page) {
  await page.goto(process.env["ZO_BASE_URL"]);
  if (await page.getByText('Login as internal user').isVisible()) {
    await page.getByText('Login as internal user').click();
}
  await page.waitForTimeout(1000);
  await page
    .locator('[data-cy="login-user-id"]')
    .fill(process.env["ZO_ROOT_USER_EMAIL"]);
  //Enter Password
  await page.locator('label').filter({ hasText: 'Password *' }).click();
  await page
    .locator('[data-cy="login-password"]')
    .fill(process.env["ZO_ROOT_USER_PASSWORD"]);
  await page.locator('[data-cy="login-sign-in"]').click();
}

async function ingestion(page) {
  const orgId = process.env["ORGNAME"];
  const streamName = "e2e_automate";
  const basicAuthCredentials = Buffer.from(
    `${process.env["ZO_ROOT_USER_EMAIL"]}:${process.env["ZO_ROOT_USER_PASSWORD"]}`
  ).toString('base64');

  const headers = {
    "Authorization": `Basic ${basicAuthCredentials}`,
    "Content-Type": "application/json",
  };
  const response = await page.evaluate(async ({ url, headers, orgId, streamName, logsdata }) => {
    const fetchResponse = await fetch(`${url}/api/${orgId}/${streamName}/_json`, {
      method: 'POST',
      headers: headers,
      body: JSON.stringify(logsdata)
    });
    return await fetchResponse.json();
  }, {
    url: process.env.INGESTION_URL,
    headers: headers,
    orgId: orgId,
    streamName: streamName,
    logsdata: logsdata
  });
  console.log(response);
}

test.describe.serial("Schema testcases", () => {
  let logsPage;
  // let logData;
  function removeUTFCharacters(text) {
    // console.log(text, "tex");
    // Remove UTF characters using regular expression
    return text.replace(/[^\x00-\x7F]/g, " ");
  }
  async function applyQueryButton(page) {
    // click on the run query button
    // Type the value of a variable into an input field
    const search = page.waitForResponse(logData.applyQuery);
    await page.waitForTimeout(3000);
    await page.locator("[data-test='logs-search-bar-refresh-btn']").click({
      force: true,
    });
    // get the data from the search variable
    await expect.poll(async () => (await search).status()).toBe(200);
  }

  test.beforeEach(async ({ page }) => {
    await login(page);
    logsPage = new LogsPage(page);
    await page.waitForTimeout(1000)
    await ingestion(page);
    await page.waitForTimeout(2000)

    await page.goto(
      `${logData.logsUrl}?org_identifier=${process.env["ORGNAME"]}`
    );
    const allsearch = page.waitForResponse("**/api/default/_search**");
    await logsPage.selectStreamAndStreamTypeForLogs("e2e_automate"); 
    await applyQueryButton(page);
  });

  test('should add a new field and delete it from schema', async ({ page }) => {
    // Generate random field name
    const randomPrefix = Math.random().toString(36).substring(2, 7);
    const fieldName = `${randomPrefix}_newtest`;
    await page.locator('[data-test="menu-link-\\/streams-item"]').click();
    await page.getByPlaceholder('Search Stream').click();
    await page.getByPlaceholder('Search Stream').fill('e2e_automate');
    await page.waitForTimeout(1000);
    await page.getByRole('button', { name: 'Stream Detail' }).first().click();
    await page.locator('[data-test="tab-allFields"]').click();
    await page.locator('[data-test="schema-stream-delete-kubernetes_annotations_kubectl_kubernetes_io_default_container-field-fts-key-checkbox"]').click();
    await page.locator('[data-test="schema-stream-delete-kubernetes_annotations_kubernetes_io_psp-field-fts-key-checkbox"]').click();
    await page.locator('[data-test="schema-add-field-button"]').click();
    await page.locator('[data-test="schema-update-settings-button"]').click();
    await page.locator('[data-test="schema-add-fields-title"]').click();
    
    await page.getByPlaceholder('Name *').click();
    await page.getByPlaceholder('Name *').fill(fieldName);
    console.log(`Filled field name: ${fieldName}`);
    
    // Check if data type field exists
    const dataTypeField = page.getByPlaceholder('Data Type *');
    const hasDataType = await dataTypeField.isVisible({ timeout: 2000 }).catch(() => false);
    
    if (hasDataType) {
        await dataTypeField.click();
        await page.waitForTimeout(500);
        
        // Try to select Utf8 or first available option
        const utf8Option = page.getByRole('option', { name: 'Utf8' });
        if (await utf8Option.isVisible({ timeout: 2000 }).catch(() => false)) {
            await utf8Option.click();
            console.log('Selected Utf8 data type');
        } else {
            const firstOption = page.getByRole('option').first();
            if (await firstOption.isVisible({ timeout: 2000 })) {
                await firstOption.click();
                console.log('Selected first available data type');
            }
        }
    }
    
    await page.locator('[data-test="schema-update-settings-button"]').click();
    console.log('Clicked schema-update-settings-button');
    await page.locator('[data-test="schema-field-search-input"]').fill(fieldName)
    await page.waitForTimeout(1000);
    await page.locator(`[data-test="schema-stream-delete-${fieldName}-field-fts-key-checkbox"]`).click();
    await page.locator('[data-test="schema-add-field-button"]').click();
    console.log('Clicked schema-add-field-button');
    await page.locator('[data-test="schema-update-settings-button"]').click();
    console.log('Clicked final schema-update-settings-button');
    
    // Wait and confirm the field was added successfully
    await page.waitForTimeout(8000);
    await page.waitForLoadState('networkidle');
    
    // Close any dialog first to refresh the view
    await page.keyboard.press('Escape');
    await page.waitForTimeout(1000);
    
    // Reopen stream details to get fresh schema view
    await page.getByRole('button', { name: 'Stream Detail' }).first().click();
    await page.locator('[data-test="tab-schemaFields"]').click();
    await page.waitForTimeout(3000);
    
    // Debug: Check if schema table is loading
    const schemaTable = page.locator('[data-test*="schema"]').first();
    const schemaTableExists = await schemaTable.isVisible({ timeout: 5000 }).catch(() => false);
    console.log(`Schema table visible: ${schemaTableExists}`);
    
    // Debug: Check for loading indicators
    const loadingIndicator = await page.locator('text=Loading').isVisible({ timeout: 2000 }).catch(() => false);
    console.log(`Loading indicator present: ${loadingIndicator}`);
    
    // Wait for any loading to complete
    if (loadingIndicator) {
      await page.waitForSelector('text=Loading', { state: 'hidden', timeout: 10000 });
      console.log('Loading completed');
    }
    
    console.log(`Looking for field: ${fieldName}`);
    
    // Check if the cell exists, if not try refreshing or navigating back
    const fieldCell = page.getByRole('cell', { name: fieldName }).first();
    try {
        await fieldCell.waitFor({ state: 'visible', timeout: 10000 });
        await fieldCell.click();
    } catch (error) {
        // If cell not found, try refreshing the page or navigating back to schema
        console.log(`${fieldName} cell not found, trying to refresh schema view`);
        
        console.log(`Field ${fieldName} not found in initial load, checking alternative approaches`);
        
        // If the schema table is empty, the field might still be getting added
        // Skip the click attempt and proceed directly to deletion verification
        console.log('Skipping field click due to empty schema table in CI/CD environment');
        
        // Instead of clicking the cell, proceed with a different approach
        // The field was created successfully based on the API calls
        // Try to delete it by searching for it first
        await page.keyboard.press('Escape');
        await page.waitForTimeout(2000);
        
        // Navigate fresh to stream details
        await page.locator('[data-test="menu-link-\\/streams-item"]').click();
        await page.waitForTimeout(1000);
        await page.getByPlaceholder('Search Stream').click();
        await page.getByPlaceholder('Search Stream').fill('e2e_automate');
        await page.waitForTimeout(1000);
        await page.getByRole('button', { name: 'Stream Detail' }).first().click();
        
        // Try different tabs to find the field
        const allFieldsTab = page.locator('[data-test="tab-allFields"]');
        const schemaFieldsTab = page.locator('[data-test="tab-schemaFields"]');
        
        if (await allFieldsTab.isVisible({ timeout: 3000 })) {
            console.log('Using allFields tab');
            await allFieldsTab.click();
        } else if (await schemaFieldsTab.isVisible({ timeout: 3000 })) {
            console.log('Using schemaFields tab');
            await schemaFieldsTab.click();
        }
        
        await page.waitForTimeout(3000);
        
        // Search for the field in the search box if available
        const searchBox = page.locator('[data-test="schema-field-search-input"]');
        if (await searchBox.isVisible({ timeout: 2000 })) {
            await searchBox.fill(fieldName);
            await page.waitForTimeout(1000);
        }
        
        // Try to find the field again after proper navigation
        const fieldCell = page.getByRole('cell', { name: fieldName }).first();
        if (await fieldCell.isVisible({ timeout: 5000 })) {
            console.log(`Found field ${fieldName} after alternative navigation`);
            await fieldCell.click();
        } else {
            throw new Error(`TEST FAILED: Field "${fieldName}" was not created successfully. Field is not visible in schema table after all navigation attempts.`);
        }
    }
    
    // Take screenshot before deletion
    await page.screenshot({ path: `test-results/before-deletion-${fieldName}.png`, fullPage: true });
    
    await page.locator(`[data-test="schema-stream-delete-${fieldName}-field-fts-key-checkbox"]`).first().click();
    await page.locator('[data-test="schema-delete-button"]').click();
    
    // Take screenshot of delete confirmation dialog
    await page.screenshot({ path: `test-results/delete-confirmation-${fieldName}.png`, fullPage: true });
    
    await page.locator('[data-test="confirm-button"]').click();
    await page.waitForTimeout(2000);
    console.log(`Attempted to delete field: ${fieldName}`);
    
    // Verify field was deleted
    await page.locator('button').filter({ hasText: 'close' }).first().click();
    await page.waitForTimeout(1000);
    await page.getByRole('button', { name: 'Stream Detail' }).first().click();
    await page.locator('[data-test="tab-schemaFields"]').click();
    await page.waitForTimeout(2000);
    
    // Take screenshot of schema table after deletion
    await page.screenshot({ path: `test-results/schema-after-deletion-${fieldName}.png`, fullPage: true });
    
    // Check if field still exists
    const deletedFieldExists = await page.getByRole('cell', { name: fieldName }).first().isVisible({ timeout: 3000 }).catch(() => false);
    console.log(`Field ${fieldName} still exists after deletion: ${deletedFieldExists}`);
    
    if (!deletedFieldExists) {
      console.log(`✅ Field ${fieldName} successfully deleted`);
      console.log('✅ Add and delete field test completed successfully');
    } else {
      console.log(`❌ Field ${fieldName} still exists after deletion attempt`);
      
      // Take final failure screenshot
      await page.screenshot({ path: `test-results/DELETION-FAILED-${fieldName}.png`, fullPage: true });
      
      throw new Error(`TEST FAILED: Field "${fieldName}" still exists after deletion attempt. Deletion process failed.`);
    }
  });

  test('stream schema settings updated to be displayed under logs', async ({ page }) => {
    await page.locator('[data-test="menu-link-\\/streams-item"]').click();
    await page.getByPlaceholder('Search Stream').click();
    await page.getByPlaceholder('Search Stream').fill('e2e_automate');
    await page.waitForTimeout(1000);
    await page.getByRole('button', { name: 'Stream Detail' }).first().click();
    await page.locator('[data-test="schema-stream-delete-kubernetes_annotations_kubectl_kubernetes_io_default_container-field-fts-key-checkbox"]').click();
    await page.locator('[data-test="schema-stream-delete-kubernetes_annotations_kubernetes_io_psp-field-fts-key-checkbox"]').click();
    await page.locator('[data-test="schema-add-field-button"]').click();
    await page.locator('[data-test="schema-update-settings-button"]').click();
    
    // Handle schema fields tab visibility issues in CI/CD
    const schemaFieldsTab = page.locator('[data-test="tab-schemaFields"]');
    const allFieldsTab = page.locator('[data-test="tab-allFields"]');
    
    if (await schemaFieldsTab.isVisible({ timeout: 3000 }) && await schemaFieldsTab.isEnabled({ timeout: 1000 })) {
        await schemaFieldsTab.click();
    } else if (await allFieldsTab.isVisible({ timeout: 3000 })) {
        console.log('Schema fields tab not available, using all fields tab');
        await allFieldsTab.click();
    } else {
        console.log('Neither schema fields nor all fields tab available, proceeding without tab switch');
    }
    await page.getByRole('cell', { name: 'kubernetes_annotations_kubectl_kubernetes_io_default_container' }).click();
    await page.getByRole('cell', { name: 'kubernetes_annotations_kubernetes_io_psp' }).click();
    await page.waitForTimeout(1000);
    await ingestion(page);
    await page.waitForTimeout(2000);
    await page.locator('button').filter({ hasText: 'close' }).first().click();
    await page.getByRole('button', { name: 'Explore' }).first().click();
    await page.waitForTimeout(1000);
    // await page.locator('[data-test="date-time-btn"]').click();
    // await page.locator('[data-test="date-time-relative-tab"]').click();
    // await page.locator('[data-test="date-time-relative-15-m-btn"]').click();
    await page.waitForTimeout(2000);
    // await page.locator('[data-test="logs-search-bar-refresh-btn"]').click();
    await page.locator('[data-test="log-table-column-1-_timestamp"] [data-test="table-row-expand-menu"]').click();
    await page.waitForTimeout(1000);

    await page.locator('[data-test="logs-user-defined-fields-btn"]').click();
    // await page.locator('[data-test="log-search-index-list-interesting-_all-field-btn"]').last().click({force: true});

    await applyQueryButton(page);
     await page.getByText(/^arrow_drop_down_all:.*$/).click();
    await page.locator('[data-test="log-search-index-list-field-search-input"]').click();
    await page.locator('[data-test="log-search-index-list-field-search-input"]').fill('_timestamp');
    await page.locator('[data-test="log-search-index-list-fields-table"]').getByTitle('_timestamp').click();
    await page.locator('[data-test="log-search-index-list-field-search-input"]').click();
    await page.locator('[data-test="log-search-index-list-field-search-input"]').fill('_all');
    await page.locator('[data-test="log-search-index-list-fields-table"]').getByTitle('_all')
    await page.locator('[data-test="logs-all-fields-btn"]').click();
    await page.locator('[data-test="log-search-index-list-field-search-input"]').click();
    await page.locator('[data-test="log-search-index-list-fields-table"]').getByTitle('_all')
    await page.locator('[data-test="log-search-index-list-field-search-input"]').click();
    await page.locator('[data-test="log-search-index-list-field-search-input"]').fill('_timestamp');
    await page.locator('[data-test="log-search-index-list-fields-table"]').getByTitle('_timestamp').click();

    await page.waitForSelector('[data-test="log-expand-detail-key-_all"]', { state: 'visible' });
    await page.locator('[data-test="logs-search-bar-query-editor"]').locator('.monaco-editor').click();
    await page.keyboard.type("str_match(_all, \'test\')");
    await page.waitForTimeout(2000);
    await page.locator('[data-test="logs-search-bar-refresh-btn"]').click();
    await page.waitForTimeout(2000);
    const errorMessage = page.locator('[data-test="logs-search-error-message"]');
    await expect(errorMessage).not.toBeVisible();
    await page.locator('[data-test="menu-link-\\/streams-item"]').click();
    await page.getByPlaceholder('Search Stream').click();
    await page.getByPlaceholder('Search Stream').fill('e2e_automate');
    await page.waitForTimeout(1000);
    await page.getByRole('button', { name: 'Stream Detail' }).first().click();
    await page.locator('[data-test="tab-schemaFields"]').click();
    await page.locator('[data-test="schema-stream-delete-kubernetes_annotations_kubectl_kubernetes_io_default_container-field-fts-key-checkbox"]').click();
    await page.locator('[data-test="schema-stream-delete-kubernetes_annotations_kubernetes_io_psp-field-fts-key-checkbox"]').click();
    await page.locator('[data-test="schema-add-field-button"]').click();
    await page.locator('[data-test="schema-update-settings-button"]').click();
    await page.waitForTimeout(3000);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(1000);
    await ingestion(page);
    await page.waitForTimeout(2000);
    await page.getByRole('button', { name: 'Explore' }).first().click();
    await page.waitForTimeout(2000);
    await page.locator('[data-test="logs-search-bar-refresh-btn"]').click();
    await page.waitForTimeout(2000);
    await page.locator('[data-test="log-table-column-1-_timestamp"] [data-test="table-row-expand-menu"]').click();
    await page.getByText('arrow_drop_down_timestamp:').click();
  });

  test('should display stream details on navigating from blank stream to stream with details', async ({ page }) => {
    await page.locator('[data-test="menu-link-\\/streams-item"]').click();
    await page.locator('[data-test="log-stream-add-stream-btn"]').click();
    await page.getByLabel('Name *').click();
    await page.getByLabel('Name *').fill(streamName);
    await page.locator('.q-form > div:nth-child(2) > .q-field > .q-field__inner > .q-field__control > .q-field__control-container > .q-field__native').click();
    await page.getByRole('option', { name: 'Logs' }).locator('div').nth(2).click();
    await page.locator('[data-test="save-stream-btn"]').click();
    await page.waitForTimeout(1000);
    await page.locator('[data-test="menu-link-\\/-item"]').click();
    await page.locator('[data-test="menu-link-\\/logs-item"]').click();
    await page.locator('#fnEditor').locator('.monaco-editor').click()
    await page.locator('[data-test="log-search-index-list-select-stream"]').click();
    await page.locator('[data-test="log-search-index-list-select-stream"]').fill(streamName);
    await page.getByText(streamName).click();
    // await page.getByRole('option', { name: streamName }).locator('div').nth(2).click();
    await page.waitForTimeout(1000);
    await page.locator('[data-test="log-search-index-list-select-stream"]').click();
    await page.locator('[data-test="log-search-index-list-select-stream"]').fill('e2e_automate');
    // await page.getByRole('option', { name: 'e2e_automate' }).locator('div').nth(2).click();
    await page.getByText('e2e_automate').click();
    await page.waitForTimeout(4000);
    await page.locator('[data-test="logs-search-bar-refresh-btn"]').click();
    await page.waitForTimeout(2000);
    await page.waitForSelector('text=Loading...', { state: 'hidden' });
    await page.locator('[data-test="log-search-index-list-fields-table"]').getByTitle('_timestamp').click()
    await page.locator('[data-test="menu-link-\\/streams-item"]').click();
    await page.getByPlaceholder('Search Stream').click();
    await page.getByPlaceholder('Search Stream').fill(streamName);
    await page.waitForTimeout(1000);
    await page.locator('[data-test="log-stream-refresh-stats-btn"]').click();
    await page.getByPlaceholder('Search Stream').click();
    await page.getByPlaceholder('Search Stream').click();
    await page.getByRole('button', { name: 'Delete' }).click();
    await page.getByRole('button', { name: 'Ok' }).click();
  });
})