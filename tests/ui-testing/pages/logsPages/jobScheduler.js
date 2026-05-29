import { expect } from '@playwright/test';
import testLogger from '../../playwright-tests/utils/test-logger.js';
const { getAuthHeaders, getOrgIdentifier } = require('../../playwright-tests/utils/cloud-auth.js');

export class JobSchedulerPage {
    constructor(page) {
        this.page = page;

    }


    async submitSearchJob() {
        const orgId = getOrgIdentifier();
        const url = `${process.env["ZO_BASE_URL"]}/api/${orgId}/search_jobs?type=logs&search_type=UI&use_cache=true`;
        const headers = getAuthHeaders();
       // Get current time and one minute ago
       const now = Date.now(); // Current time in milliseconds
       const oneMinuteAgo = now - 60 * 1000; // One minute ago in milliseconds
      
      // Define the request body
      const requestBody = {
          query: {
              sql: 'SELECT * FROM "e2e_automate"',
              start_time: oneMinuteAgo, // One minute ago
              end_time: now,
              from: 0,
              size: 1000,
              quick_mode: false,
              sql_mode: 'full',
          },
      };
      
        // Make the POST request
        const response = await this.page.request.post(url, {
            data: requestBody, // Add any necessary payload here
            headers: headers,
        });
      
        // Check if the response status is 200
        if (response.status() === 200) {
            const responseBody = await response.json();
            return this.extractJobId(responseBody.message);
        } else {
            throw new Error(`Failed to submit job. Status: ${response.status()}`);
        }
      }
      
      extractJobId(message) {
        // Use a regex to extract the Job ID from the message
        const jobIdMatch = message.match(/\[Job_Id: (.+?)\]/);
        return jobIdMatch ? jobIdMatch[1] : null;
      }
      
      async getTraceIdByJobId(jobId) {
        const orgId = getOrgIdentifier();
        const url = `${process.env["ZO_BASE_URL"]}/api/${orgId}/search_jobs?type=logs&search_type=UI&use_cache=true`;
        const headers = getAuthHeaders();
       
        // Make the GET request
        const response = await this.page.request.get(url, {
            headers: headers,
        });
      
        // Check if the response status is 200
        if (response.status() === 200) {
            const responseBody = await response.json();
            const job = responseBody.find(job => job.id === jobId);
            if (job) {
                testLogger.info(`Trace ID for job ID ${jobId}: ${job.trace_id}`);
                return job.trace_id; // Return the trace_id if needed
            } else {
                testLogger.error(`Job with ID ${jobId} not found.`);
                return null;
            }
        } else {
            const errorMessage = await response.text();
            throw new Error(`Failed to fetch jobs. Status: ${response.status()}, Message: ${errorMessage}`);
        }
      }
      


async deleteJobSearch(trace_id) {
      // OTable renders rows as [data-test="o2-table-row-{index}"], not by row-key.
      // Find the row by filtering on the visible trace_id text.
      const getRow = () =>
          this.page.locator('[data-test^="o2-table-row-"]').filter({ hasText: trace_id }).first();

      // Click the "Get Jobs" button
      await this.page.locator('[data-test="search-scheduler-get-jobs-btn"]').click();
      await getRow().waitFor({ state: 'visible', timeout: 15000 });

      // Click the delete button for the specified job row
      await getRow().locator('[data-test="search-scheduler-delete-btn"]').click();

      // Cancel the deletion (tests the cancel flow)
      await this.page.locator('[data-test="confirm-dialog"] [data-test="o-dialog-secondary-btn"]').click();

      // Click the delete button again and confirm
      await getRow().locator('[data-test="search-scheduler-delete-btn"]').click();
      await this.page.locator('[data-test="confirm-dialog"] [data-test="o-dialog-primary-btn"]').click();

      // Verify the success message
      await expect(
          this.page.locator('[data-test="o-toast-message"]').filter({ hasText: 'Search Job has been deleted successfully' }).first()
      ).toBeVisible({ timeout: 10000 });
  }

  async restartJobSearch(trace_id) {
    // Click the "Get Jobs" button
    await this.page.locator('[data-test="search-scheduler-get-jobs-btn"]').click();

    // OTable rows are [data-test="o2-table-row-{index}"] — find by trace_id text content
    const row = this.page.locator('[data-test^="o2-table-row-"]').filter({ hasText: trace_id }).first();
    try {
        await row.waitFor({ state: 'visible', timeout: 10000 });
    } catch (error) {
        testLogger.error(`Error: Unable to find job row for trace ID ${trace_id}.`, error);
        throw new Error(`Job row for trace ID ${trace_id} not found.`);
    }

    // Click the restart button for the specified job row
    await row.locator('[data-test="search-scheduler-restart-btn"]').click();

    // Verify the success message
    await expect(
        this.page.locator('[data-test="o-toast-message"]').filter({ hasText: 'Search Job has been restarted successfully' }).first()
    ).toBeVisible({ timeout: 10000 });
}


async cancelJobSearch(trace_id) {
    // Click the "Get Jobs" button
    await this.page.locator('[data-test="search-scheduler-get-jobs-btn"]').click();

    // OTable rows are [data-test="o2-table-row-{index}"] — find by trace_id text content
    const row = this.page.locator('[data-test^="o2-table-row-"]').filter({ hasText: trace_id }).first();
    await row.waitFor({ state: 'visible', timeout: 15000 });

    // Click the cancel button for the specified job row
    await row.locator('[data-test="search-scheduler-cancel-btn"]').click();

    // Confirm the cancellation
    await this.page.locator('[data-test="confirm-dialog"] [data-test="o-dialog-primary-btn"]').click();

    // Verify the success message
    await expect(
        this.page.locator('[data-test="o-toast-message"]').filter({ hasText: 'Search Job has been cancelled successfully' }).first()
    ).toBeVisible({ timeout: 10000 });
}     

async exploreJob(trace_id) {
    // OTable rows are [data-test="o2-table-row-{index}"] — find by trace_id text content
    const getExploreBtn = () =>
        this.page.locator('[data-test^="o2-table-row-"]').filter({ hasText: trace_id }).first()
            .locator('[data-test="search-scheduler-explore-btn"]');

    // Click the "Get Jobs" button
    await this.page.locator('[data-test="search-scheduler-get-jobs-btn"]').click();

    const row = this.page.locator('[data-test^="o2-table-row-"]').filter({ hasText: trace_id }).first();
    try {
        await row.waitFor({ state: 'visible', timeout: 10000 });
    } catch (error) {
        testLogger.error(`Error: Unable to find row for trace ID ${trace_id}.`, error);
        throw new Error(`Row for trace ID ${trace_id} not found.`);
    }

    // Retry clicking the explore button if it is disabled
    const maxRetries = 5;
    let attempts = 0;

    while (attempts < maxRetries) {
        const exploreButton = getExploreBtn();
        const isEnabled = await exploreButton.isEnabled();
        if (isEnabled) {
            await exploreButton.click();
            break;
        } else {
            testLogger.warn(`Explore button for trace ID ${trace_id} is not enabled. Retrying...`);
            attempts++;
            await this.page.waitForTimeout(5000);
            await this.page.locator('[data-test="search-scheduler-get-jobs-btn"]').click();
        }
    }

    if (attempts === maxRetries) {
        throw new Error(`Explore button for trace ID ${trace_id} remained disabled after ${maxRetries} attempts.`);
    }

    // Verify the success message
    await expect(
        this.page.locator('[data-test="o-toast-message"]').filter({ hasText: 'Search Job have been applied successfully' }).first()
    ).toBeVisible({ timeout: 10000 });
}


async viewJobDetails(trace_id) {
    // OTable rows are [data-test="o2-table-row-{index}"] — find by trace_id text content.
    // The expand button per row is [data-test="o2-table-expand-{index}"] (OTableExpandButton).
    const getJobsBtn = this.page.locator('[data-test="search-scheduler-get-jobs-btn"]');
    const row = this.page.locator('[data-test^="o2-table-row-"]').filter({ hasText: trace_id }).first();

    // Retry: newly created jobs may not appear immediately in the list.
    const maxRetries = 5;
    let rowFound = false;
    for (let attempt = 0; attempt < maxRetries; attempt++) {
        await getJobsBtn.click();
        try {
            await row.waitFor({ state: 'visible', timeout: 5000 });
            rowFound = true;
            break;
        } catch {
            testLogger.warn(`Row for trace ID ${trace_id} not found on attempt ${attempt + 1}/${maxRetries}, retrying...`);
            await this.page.waitForTimeout(2000);
        }
    }
    if (!rowFound) {
        throw new Error(`Row for trace ID ${trace_id} not found after ${maxRetries} attempts.`);
    }

    // Click the OTable expand button within this row to reveal expanded content
    const expandBtn = row.locator('[data-test^="o2-table-expand-"]');
    await expandBtn.click();

    // Wait for and click the More Details tab.
    // Multiple [data-test="tab-more_details"] may exist in DOM (one per expanded row),
    // so we scope to the first visible one.
    try {
        const visibleTab = this.page.locator('[data-test="tab-more_details"]:visible').first();
        await visibleTab.waitFor({ state: 'visible', timeout: 15000 });
        await visibleTab.click();
    } catch (error) {
        const underlyingMsg = error instanceof Error ? error.message : String(error);
        testLogger.error(`Error: Unable to find or click More Details tab for trace ID ${trace_id}: ${underlyingMsg}`);
        throw new Error(`More Details tab for trace ID ${trace_id} not found or not clickable.`);
    }

    // Verify the More Details tab content is visible (contains the trace_id in JSON output)
    await expect(
        this.page.locator('[data-test="expanded-list-tabs"]').first()
    ).toBeVisible({ timeout: 5000 });
}

   



  

}