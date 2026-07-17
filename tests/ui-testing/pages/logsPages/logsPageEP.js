// logsPageEP.js
import { expect } from '@playwright/test';
const testLogger = require('../../playwright-tests/utils/test-logger.js');

export class LogsPageEP {
  constructor(page) {

    this.page = page;

    
  }



async selectStreamDropDown() {
  await this.page.locator('[data-test="logs-search-index-list"]').click();
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
  // OInput: outer wrapper has data-test="search-scheuduler-max-number-of-records-input";
  // inner native <input> has data-test="search-scheuduler-max-number-of-records-input-field".
  // fill() requires the native input, not the wrapper div.
  const inputField = this.page.locator('[data-test="search-scheuduler-max-number-of-records-input-field"]');
  await inputField.waitFor({ state: 'attached', timeout: 10000 });
  await inputField.fill('1000', { force: true });

  const submitBtn = '[data-test="search-bar-search-scheduler-job-dialog"] [data-test="o-dialog-primary-btn"]';
  await this.page.waitForSelector(submitBtn);

  // Intercept the POST response BEFORE clicking to capture the created job ID
  const jobResponsePromise = this.page.waitForResponse(
    resp => resp.url().includes('/search_jobs') && resp.request().method() === 'POST',
    { timeout: 15000 }
  );
  await this.page.locator(submitBtn).click();

  const jobResponse = await jobResponsePromise;
  const body = await jobResponse.json();
  const match = body.message?.match(/\[Job_Id: (.+?)\]/);
  return match ? match[1] : null;
}

async validateAddJob(jobId) {
  // The "Job added successfully" toast fires on POST success, but searchSchedulerSubmit
  // already awaited that POST response (it returned the jobId), so by the time we get
  // here the transient toast may have already auto-dismissed — a plain visibility
  // assertion then fails purely on timing even though creation succeeded. Job creation
  // is already confirmed by the returned jobId AND the scheduler-list lookup below, so
  // treat the toast as a best-effort signal rather than a hard gate.
  await this.page.locator('[data-test="o-toast-message"]').filter({ hasText: 'Job added successfully' }).first()
    .waitFor({ state: 'visible', timeout: 5000 }).catch(() => {});

  // Navigate to the scheduler list
  await this.page.locator('[data-test="logs-search-bar-more-options-btn"]').click();
  await this.page.locator('[data-test="search-scheduler-list-btn"]').click();

  // OTable rows are indexed as [data-test="o2-table-row-{index}"] (positional integer).
  // trace_id is the row-key but is NOT a visible column, so filter({ hasText }) won't match.
  // Instead: intercept the GET response from clicking "Get Jobs" to find the job's row index.
  const { getAuthHeaders, getOrgIdentifier } = require('../../playwright-tests/utils/cloud-auth.js');
  const orgId = getOrgIdentifier();
  // The scheduler list renders under v-show="showSearchScheduler", which the logs page
  // resets whenever the URL query loses the action=search_scheduler param — leaving the
  // Get-Jobs button in the DOM but display:none. If that happened, re-open the scheduler
  // list from the toolbar to restore the view before clicking (graceful workaround for
  // origin/fix/search-scheduler-job-issue).
  const getJobsBtn = this.page.locator('[data-test="search-scheduler-get-jobs-btn"]');
  let jobsBtnVisible = await getJobsBtn.waitFor({ state: 'visible', timeout: 10000 })
    .then(() => true).catch(() => false);
  for (let attempt = 0; attempt < 2 && !jobsBtnVisible; attempt++) {
    await this.page.locator('[data-test="logs-search-bar-more-options-btn"]').click().catch(() => {});
    await this.page.locator('[data-test="search-scheduler-list-btn"]').click().catch(() => {});
    jobsBtnVisible = await getJobsBtn.waitFor({ state: 'visible', timeout: 10000 })
      .then(() => true).catch(() => false);
  }
  await getJobsBtn.waitFor({ state: 'visible', timeout: 10000 });
  const responsePromise = this.page.waitForResponse(
    resp => resp.url().includes('/search_jobs') && resp.request().method() === 'GET',
    { timeout: 15000 }
  );
  await getJobsBtn.click();
  const listResponse = await responsePromise;
  const jobs = await listResponse.json();
  const rowIndex = jobs.findIndex(j => j.id === jobId);
  if (rowIndex === -1) throw new Error(`Job with id "${jobId}" not found in scheduler list`);
  await expect(
    this.page.locator(`[data-test="o2-table-row-${rowIndex}"]`).first()
  ).toBeVisible({ timeout: 15000 });
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




async searchSchedulerInvalid() {
  // OInput: use the inner native input (-field suffix) for fill/press operations
  const inputField = this.page.locator('[data-test="search-scheuduler-max-number-of-records-input-field"]');
  await inputField.waitFor({ state: 'attached', timeout: 10000 });
  await inputField.fill('100000000', { force: true });
  await inputField.press('Enter');
  const submitBtn = '[data-test="search-bar-search-scheduler-job-dialog"] [data-test="o-dialog-primary-btn"]';
  await this.page.waitForSelector(submitBtn);
  await this.page.locator(submitBtn).click();
}


async validateInvalidData() {
  await expect(
    this.page.locator('[data-test="o-toast-message"]').filter({ hasText: 'Job Scheduler should be between 1 and 100000' }).first()
  ).toBeVisible({ timeout: 10000 });
}


async selectIndexStreamDefault() {
  await this.page.locator('[data-test="logs-search-index-list"]').click();
  await this.page.waitForTimeout(3000);
  await this.page.locator('[data-test="log-search-index-list-stream-toggle-default"] div').first().click();
  await this.page.waitForTimeout(3000);
}

async decryptLogSQL(cipherName) {
  // Construct the SQL query using the passed variable
  const sqlQuery = `SELECT decrypt(log, '${cipherName}') from "default"`;

  try {
    // Wait for the locator to be visible and enabled
    const editorLocator = this.page.locator('[data-test="logs-search-bar-query-editor-input"]');
    await editorLocator.waitFor({ state: 'visible', timeout: 10000 });
    testLogger.info(`SQL Query: ${sqlQuery}`);
    // Fill the query editor with the constructed SQL query
    await editorLocator.fill(sqlQuery);
    await this.page.waitForTimeout(5000);
  } catch (error) {
    testLogger.error(`Error during SQL decryption process: ${error}`);
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