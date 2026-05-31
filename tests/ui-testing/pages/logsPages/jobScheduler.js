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
            data: requestBody,
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
                return job.trace_id;
            } else {
                testLogger.error(`Job with ID ${jobId} not found.`);
                return null;
            }
        } else {
            const errorMessage = await response.text();
            throw new Error(`Failed to fetch jobs. Status: ${response.status()}, Message: ${errorMessage}`);
        }
      }

      // OTable renders rows as [data-test="o2-table-row-{index}"] where index is
      // the positional integer, NOT the row-key (trace_id). The trace_id column is
      // not rendered in the table UI, so filter({ hasText: trace_id }) never matches.
      // Instead: register a waitForResponse listener BEFORE clicking Get Jobs, then
      // find the trace_id's position in the API response — that position equals the
      // row's data-test index.
      async _getJobRowIndex(trace_id, timeout = 15000) {
        const responsePromise = this.page.waitForResponse(
            resp => resp.url().includes('/search_jobs') && resp.request().method() === 'GET',
            { timeout }
        );
        await this.page.locator('[data-test="search-scheduler-get-jobs-btn"]').click();
        const response = await responsePromise;
        const jobs = await response.json();
        return jobs.findIndex(job => job.trace_id === trace_id);
    }


async deleteJobSearch(trace_id) {
      const rowIndex = await this._getJobRowIndex(trace_id);
      if (rowIndex === -1) throw new Error(`Job with trace ID ${trace_id} not found in scheduler list`);

      const row = this.page.locator(`[data-test="o2-table-row-${rowIndex}"]`);
      await row.waitFor({ state: 'visible', timeout: 15000 });

      // Click delete, cancel (tests the cancel flow), click delete again and confirm
      await row.locator('[data-test="search-scheduler-delete-btn"]').click();
      await this.page.locator('[data-test="confirm-dialog"] [data-test="o-dialog-secondary-btn"]').click();
      await row.locator('[data-test="search-scheduler-delete-btn"]').click();
      await this.page.locator('[data-test="confirm-dialog"] [data-test="o-dialog-primary-btn"]').click();

      await expect(
          this.page.locator('[data-test="o-toast-message"]').filter({ hasText: 'Search Job has been deleted successfully' }).first()
      ).toBeVisible({ timeout: 10000 });
  }

  async restartJobSearch(trace_id) {
    // Restart button is only enabled when status_code === 2 (completed) or 3 (failed).
    // Retry until the button becomes enabled.
    const maxRetries = 8;
    let clicked = false;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
        const rowIndex = await this._getJobRowIndex(trace_id, 15000);
        if (rowIndex === -1) throw new Error(`Job with trace ID ${trace_id} not found in scheduler list`);

        const row = this.page.locator(`[data-test="o2-table-row-${rowIndex}"]`);
        await row.waitFor({ state: 'visible', timeout: 10000 });

        const restartBtn = row.locator('[data-test="search-scheduler-restart-btn"]');
        const isEnabled = await restartBtn.isEnabled();
        if (isEnabled) {
            await restartBtn.click();
            clicked = true;
            break;
        }

        testLogger.warn(`Restart button for trace ID ${trace_id} is not enabled (attempt ${attempt + 1}/${maxRetries}). Retrying...`);
        if (attempt < maxRetries - 1) await this.page.waitForTimeout(5000);
    }

    if (!clicked) {
        throw new Error(`Restart button for trace ID ${trace_id} remained disabled after ${maxRetries} attempts.`);
    }

    await expect(
        this.page.locator('[data-test="o-toast-message"]').filter({ hasText: 'Search Job has been restarted successfully' }).first()
    ).toBeVisible({ timeout: 10000 });
}


async cancelJobSearch(trace_id) {
    const rowIndex = await this._getJobRowIndex(trace_id);
    if (rowIndex === -1) throw new Error(`Job with trace ID ${trace_id} not found in scheduler list`);

    const row = this.page.locator(`[data-test="o2-table-row-${rowIndex}"]`);
    await row.waitFor({ state: 'visible', timeout: 15000 });
    await row.locator('[data-test="search-scheduler-cancel-btn"]').click();
    await this.page.locator('[data-test="confirm-dialog"] [data-test="o-dialog-primary-btn"]').click();

    await expect(
        this.page.locator('[data-test="o-toast-message"]').filter({ hasText: 'Search Job has been cancelled successfully' }).first()
    ).toBeVisible({ timeout: 10000 });
}

async exploreJob(trace_id) {
    // The explore button is disabled while the job is pending (status=0) or failed (status=3).
    // Retry: each attempt re-fetches the list and checks whether the button is enabled.
    const maxRetries = 5;
    let clicked = false;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
        const rowIndex = await this._getJobRowIndex(trace_id, 15000);
        if (rowIndex === -1) throw new Error(`Job with trace ID ${trace_id} not found in scheduler list`);

        const row = this.page.locator(`[data-test="o2-table-row-${rowIndex}"]`);
        await row.waitFor({ state: 'visible', timeout: 10000 });

        const exploreButton = row.locator('[data-test="search-scheduler-explore-btn"]');
        const isEnabled = await exploreButton.isEnabled();
        if (isEnabled) {
            await exploreButton.click();
            clicked = true;
            break;
        }

        testLogger.warn(`Explore button for trace ID ${trace_id} is not enabled (attempt ${attempt + 1}/${maxRetries}).`);
        if (attempt < maxRetries - 1) await this.page.waitForTimeout(5000);
    }

    if (!clicked) {
        throw new Error(`Explore button for trace ID ${trace_id} remained disabled after ${maxRetries} attempts.`);
    }

    await expect(
        this.page.locator('[data-test="o-toast-message"]').filter({ hasText: 'Search Job have been applied successfully' }).first()
    ).toBeVisible({ timeout: 10000 });
}


async viewJobDetails(trace_id) {
    // OTableExpandButton renders as [data-test="o2-table-expand-{rowIndex}"]
    // where rowIndex matches the job's position in the GET /search_jobs response.
    const rowIndex = await this._getJobRowIndex(trace_id, 15000);
    if (rowIndex === -1) throw new Error(`Job with trace ID ${trace_id} not found in scheduler list`);

    const row = this.page.locator(`[data-test="o2-table-row-${rowIndex}"]`);
    await row.waitFor({ state: 'visible', timeout: 10000 });

    const expandBtn = this.page.locator(`[data-test="o2-table-expand-${rowIndex}"]`);
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
        testLogger.error(`Unable to click More Details tab for trace ID ${trace_id}: ${underlyingMsg}`);
        throw new Error(`More Details tab for trace ID ${trace_id} not found or not clickable.`);
    }

    await expect(
        this.page.locator('[data-test="expanded-list-tabs"]').first()
    ).toBeVisible({ timeout: 5000 });
}






}
