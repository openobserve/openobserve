// logsPageEP.js
import { expect } from '@playwright/test';
const { chromium } = require('playwright');

export class LogsPageEP {
  constructor(page) {

    this.page = page;

    
  }



async selectStreamDropDown() {
  await this.page.locator('[data-test="logs-search-index-list"]').getByText('arrow_drop_down').click();
  await this.page.waitForTimeout(3000);
}

// Search Job Scheduler Dropdown updated with new locator for more options at the top right of the page 

async searchSchedulerDropdown() {
  await this.page.waitForSelector('[data-test="logs-search-bar-more-options-btn"]');
  await this.page.locator('[data-test="logs-search-bar-more-options-btn"]').click();
}

async searchSchedulerCreate() {
  await this.page.waitForSelector(`[data-test="search-scheduler-create-new-label"]`);
  await this.page.locator(`[data-test="search-scheduler-create-new-label"]`).click();
}

async searchSchedulerSubmit() {
  // Wait for the input field to be visible
  await this.page.waitForSelector('[data-test="search-scheuduler-max-number-of-records-input"]');

  // Click and fill the input field
  const inputField = this.page.locator('[data-test="search-scheuduler-max-number-of-records-input"]');
  await inputField.click();
  await inputField.fill('1000');
  await inputField.press('Enter');

  // Wait for the submit button to be visible and click it
  await this.page.waitForSelector('[data-test="search-scheduler-max-records-submit-btn"]');
  const submitButton = this.page.locator('[data-test="search-scheduler-max-records-submit-btn"]');
  await submitButton.click();

  // Wait for the "Go To Job Scheduler" button to be visible and enabled
  const goToJobSchedulerButtonSelector = { name: 'Go To Job Scheduler' };
  const maxRetries = 500;
  let attempts = 0;

  while (attempts < maxRetries) {
      const goToJobSchedulerButton = this.page.getByRole('button', goToJobSchedulerButtonSelector);

      // Wait for the button to be visible
      await this.page.waitForTimeout(100); // Small delay before checking
      const isVisible = await goToJobSchedulerButton.isVisible();
      const isEnabled = await goToJobSchedulerButton.isEnabled();

      if (isVisible && isEnabled) {
          await goToJobSchedulerButton.click();
          return; // Exit the function if the button is clicked successfully
      } else {
          console.warn(`"Go To Job Scheduler" button is not visible or enabled. Retrying...`);
          attempts++;
          await this.page.waitForTimeout(100); // Wait before retrying
      }
  }

  throw new Error(`"Go To Job Scheduler" button remained invisible or disabled after ${maxRetries} attempts.`);
}



async validateAddJob() {
  await expect(this.page.locator('#q-notify')).toContainText('Job Added Succesfully');
}

async queryJobSearch() {
  const queryEditor = this.page.locator('[data-test="logs-search-bar-query-editor"]').getByRole('textbox');
  // Fill with the new query
  await queryEditor.fill('SELECT * FROM "e2e_automate"');
  // Optional: Wait for any processing or loading after filling the query
  await this.page.waitForTimeout(5000); // Adjust the timeout as needed
}



async clickJobID () {
  const orgId = process.env["ORGNAME"];
  const basicAuthCredentials = Buffer.from(`${process.env["ZO_ROOT_USER_EMAIL"]}:${process.env["ZO_ROOT_USER_PASSWORD"]}`).toString('base64');
  
  const headers = {
    "Authorization": `Basic ${basicAuthCredentials}`,
    "Content-Type": "application/json",
  }

  // Intercept the network request and capture the response
  await this.page.route(
    `${process.env["ZO_BASE_URL"]}/api/${orgId}/search_jobs?type=logs&search_type=UI&use_cache=true`,
    async (route) => {
      const response = await route.continue();
      const responseBody = await response.body();
      const jsonResponse = JSON.parse(responseBody.toString());

      // Assuming the ID is in the response JSON
      const idJob = jsonResponse.trace_id; // Adjust this according to your response structure
      console.log("Job ID Created", idJob);

      // Use the ID to construct the selector
      const rowSelector = `tr[data-test="search-scheduler-table-${idJob}-row"]`;
      const cancelBtnSelector = `${rowSelector} [data-test="search-scheduler-cancel-btn"]`;
      const restartBtnSelector = `${rowSelector} [data-test="search-scheduler-restart-btn"]`;

      // Wait for the row to be visible before clicking
      await this.page.waitForSelector(rowSelector);
      
      // Click the cancel button
      await this.page.locator(cancelBtnSelector).click();
      await this.page.waitForTimeout(2000);
      // Click the confirm button
      await this.page.locator('[data-test="confirm-button"]').click();
      await this.page.waitForTimeout(2000);
      // Click the restart button
      await this.page.locator(restartBtnSelector).click();
      await this.page.waitForTimeout(2000);
      // Continue with your automation steps...
    }
  )

}



 


async searchSchedulerInvalid() {
  await this.page.waitForSelector('[data-test="search-scheuduler-max-number-of-records-input"]');
  await this.page.locator('[data-test="search-scheuduler-max-number-of-records-input"]').click();
  await this.page.locator('[data-test="search-scheuduler-max-number-of-records-input"]').fill('100000000');
  await this.page.locator('[data-test="search-scheuduler-max-number-of-records-input"]').press('Enter');
  await this.page.waitForSelector('[data-test="search-scheduler-max-records-submit-btn"]');
  await this.page.locator('[data-test="search-scheduler-max-records-submit-btn"]').click();
}


async validateInvalidData() {
  await expect(this.page.locator('#q-notify')).toContainText('Job Scheduler should be between 1 and 100000');
  
  
}


async selectIndexStreamDefault() {
  await this.page.locator('[data-test="logs-search-index-list"]').getByText('arrow_drop_down').click();
  await this.page.waitForTimeout(3000);
  await this.page.locator('[data-test="log-search-index-list-stream-toggle-default"] div').first().click();
  await this.page.waitForTimeout(3000);
}

async decryptLogSQL(cipherName) {
  // Construct the SQL query using the passed variable
  const sqlQuery = `SELECT decrypt(log, '${cipherName}') from "default"`;

  try {
    // Wait for the locator to be visible and enabled
    const editorLocator = this.page.locator('[data-test="logs-search-bar-query-editor"]').getByRole('textbox');
    await editorLocator.waitFor({ state: 'visible', timeout: 10000 });
    console.log("SQL Query", sqlQuery);
    // Fill the query editor with the constructed SQL query
    await editorLocator.fill(sqlQuery);
    await this.page.waitForTimeout(5000);
  } catch (error) {
    console.error('Error during SQL decryption process:', error);
    throw error; // Re-throw the error if needed for further handling
  }
}

async validateDecryResult(cipherName) {
  if (!cipherName) {
    throw new Error("cipherName must be provided and cannot be undefined.");
  }
  
  await this.page.waitForTimeout(10000);
  
  const expandMenuLocator = this.page.locator('[data-test="log-table-column-0-_timestamp"] [data-test="table-row-expand-menu"]');
  await expect(expandMenuLocator).toBeVisible();
  await expandMenuLocator.click();
  
  const decryptTextLocator = this.page.locator(`[data-test="log-expand-detail-key-decrypt\\(default\\.log\\,Utf8\\(\\"${cipherName}\\"\\)\\)-text"]`);
  await expect(decryptTextLocator).toContainText(`decrypt(default.log,Utf8("${cipherName}")):`);
}




}