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
  await this.page.waitForSelector('[data-test="search-scheuduler-max-number-of-records-input"]');

  const inputField = this.page.locator('[data-test="search-scheuduler-max-number-of-records-input"]');
  await inputField.click();
  await inputField.fill('1000');

  await this.page.waitForSelector('[data-test="search-scheduler-max-records-submit-btn"]');

  // Intercept the POST response BEFORE clicking to capture the created job ID
  const jobResponsePromise = this.page.waitForResponse(
    resp => resp.url().includes('/search_jobs') && resp.request().method() === 'POST',
    { timeout: 15000 }
  );
  await this.page.locator('[data-test="search-scheduler-max-records-submit-btn"]').click();

  const jobResponse = await jobResponsePromise;
  const body = await jobResponse.json();
  const match = body.message?.match(/\[Job_Id: (.+?)\]/);
  return match ? match[1] : null;
}

async validateAddJob(jobId) {
  // Wait for the notification — it fires only after the job creation API call succeeds
  await expect(this.page.locator('#q-notify')).toContainText('Job Added Succesfully', { timeout: 15000 });

  // Navigate to the scheduler list
  await this.page.locator('[data-test="logs-search-bar-more-options-btn"]').click();
  await this.page.locator('[data-test="search-scheduler-list-btn"]').click();
  await this.page.getByRole('button', { name: 'Get Jobs' }).click();

  // Resolve trace_id for the specific job we created, then assert that exact row
  const { getAuthHeaders, getOrgIdentifier } = require('../../playwright-tests/utils/cloud-auth.js');
  const orgId = getOrgIdentifier();
  const listResponse = await this.page.request.get(
    `${process.env["ZO_BASE_URL"]}/api/${orgId}/search_jobs?type=logs&search_type=UI&use_cache=true`,
    { headers: getAuthHeaders() }
  );
  const jobs = await listResponse.json();
  const job = jobs.find(j => j.id === jobId);
  if (!job?.trace_id) throw new Error(`Job with id "${jobId}" not found in scheduler list`);
  await expect(this.page.locator(`[data-test="search-scheduler-table-${job.trace_id}-row"]`)).toBeVisible({ timeout: 15000 });
}

async queryJobSearch() {
  const queryEditorLocator = this.page.locator('[data-test="logs-search-bar-query-editor"]');
  await queryEditorLocator.waitFor({ state: 'visible', timeout: 10000 });
  await this.page.waitForTimeout(1000);
  await queryEditorLocator.click();
  await this.page.waitForTimeout(500);
  await this.page.keyboard.press(process.platform === "darwin" ? "Meta+A" : "Control+A");
  await this.page.waitForTimeout(300);
  const inputArea = queryEditorLocator.locator('.inputarea');
  await inputArea.waitFor({ state: 'visible', timeout: 5000 });
  await inputArea.fill('SELECT * FROM "e2e_automate"');
  await this.page.waitForTimeout(2000);
}



async clickJobID () {
  const { getOrgIdentifier } = require('../../playwright-tests/utils/cloud-auth.js');
  const orgId = getOrgIdentifier();

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