import { expect } from '@playwright/test';
import testLogger from '../../playwright-tests/utils/test-logger.js';
// const { chromium } = require('playwright');

export class JobSchedulerPage {
    constructor(page) {
        this.page = page;
       
    }

 
    async submitSearchJob() {
        const orgId = process.env["ORGNAME"];
        const url = `${process.env["ZO_BASE_URL"]}/api/${orgId}/search_jobs?type=logs&search_type=UI&use_cache=true`;
        const basicAuthCredentials = Buffer.from(`${process.env["ZO_ROOT_USER_EMAIL"]}:${process.env["ZO_ROOT_USER_PASSWORD"]}`).toString('base64');
        
        const headers = {
          "Authorization": `Basic ${basicAuthCredentials}`,
          "Content-Type": "application/json",
        }
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
        const orgId = process.env["ORGNAME"];
        const url = `${process.env["ZO_BASE_URL"]}/api/${orgId}/search_jobs?type=logs&search_type=UI&use_cache=true`;
        const basicAuthCredentials = Buffer.from(`${process.env["ZO_ROOT_USER_EMAIL"]}:${process.env["ZO_ROOT_USER_PASSWORD"]}`).toString('base64');
        
        const headers = {
          "Authorization": `Basic ${basicAuthCredentials}`,
          "Content-Type": "application/json",
        }
       
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

      // Click the "Get Jobs" button
      await this.page.getByRole('button', { name: 'Get Jobs' }).click();

      // Click the delete button for the specified job row
      await this.page.waitForSelector(`[data-test="search-scheduler-table-${trace_id}-row"] [data-test="search-scheduler-delete-btn"]`);
      await this.page.locator(`[data-test="search-scheduler-table-${trace_id}-row"] [data-test="search-scheduler-delete-btn"]`).click();

      // Confirm the deletion
      await this.page.locator('[data-test="cancel-button"]').click();


      // Click the delete button for the specified job row
      await this.page.waitForSelector(`[data-test="search-scheduler-table-${trace_id}-row"] [data-test="search-scheduler-delete-btn"]`);
      await this.page.locator(`[data-test="search-scheduler-table-${trace_id}-row"] [data-test="search-scheduler-delete-btn"]`).click();

      // Confirm the deletion
      await this.page.locator('[data-test="confirm-button"]').click();

      // Verify the success message
      await expect(this.page.locator('#q-notify')).toContainText('Search Job has been deleted successfully');
  }

  async restartJobSearch(trace_id) {
    // Click the "Get Jobs" button
    await this.page.getByRole('button', { name: 'Get Jobs' }).click();

    // Build the selector for the job row using the trace_id
    const jobRowSelector = `[data-test="search-scheduler-table-${trace_id}-row"] [data-test="search-scheduler-restart-btn"]`;

    // Wait for the job row to be visible
    try {
        await this.page.waitForSelector(jobRowSelector, { timeout: 10000 }); // Adjust timeout as necessary
    } catch (error) {
        testLogger.error(`Error: Unable to find job row for trace ID ${trace_id}.`, error);
        throw new Error(`Job row for trace ID ${trace_id} not found.`);
    }

    // Click the restart button for the specified job row
    await this.page.locator(jobRowSelector).click();

    // Verify the success message
    await expect(this.page.locator('#q-notify')).toContainText('Search Job has been restarted successfully');
}


async cancelJobSearch(trace_id) {

    // Click the "Get Jobs" button
    await this.page.getByRole('button', { name: 'Get Jobs' }).click();

    // Click the cancel button for the specified job row
    await this.page.locator(`[data-test="search-scheduler-table-${trace_id}-row"] [data-test="search-scheduler-cancel-btn"]`).click();

    // Confirm the cancellation
    await this.page.locator('[data-test="confirm-button"]').click();

    // Verify the success message
    await expect(this.page.locator('#q-notify')).toContainText('Search Job has been cancelled successfully');   

}     

async exploreJob(trace_id) {
    // Click the "Get Jobs" button
    await this.page.getByRole('button', { name: 'Get Jobs' }).click();

    // Build the selector for the job row using the trace_id
    const exploreButtonSelector = `[data-test="search-scheduler-table-${trace_id}-row"] [data-test="search-scheduler-explore-btn"]`;

    // Wait for the explore button to be visible
    try {
        await this.page.waitForSelector(exploreButtonSelector, { timeout: 10000 });
    } catch (error) {
        testLogger.error(`Error: Unable to find explore button for trace ID ${trace_id}.`, error);
        throw new Error(`Explore button for trace ID ${trace_id} not found.`);
    }

    // Retry clicking the explore button if it is disabled
    const maxRetries = 5;
    let attempts = 0;

    while (attempts < maxRetries) {
        const exploreButton = this.page.locator(exploreButtonSelector);

        // Check if the button is enabled
        const isEnabled = await exploreButton.isEnabled();
        if (isEnabled) {
            await exploreButton.click();
            break; // Exit the loop if the button is clicked successfully
        } else {
            testLogger.warn(`Explore button for trace ID ${trace_id} is not enabled. Retrying...`);
            attempts++;
            await this.page.waitForTimeout(5000); // Wait before retrying
            await this.page.getByRole('button', { name: 'Get Jobs' }).click();
        }
    }

    if (attempts === maxRetries) {
        throw new Error(`Explore button for trace ID ${trace_id} remained disabled after ${maxRetries} attempts.`);
    }

    // Verify the success message
    await expect(this.page.locator('#q-notify')).toContainText('Search Job have been applied successfully');
}


async viewJobDetails(trace_id) {
      // Click the "Get Jobs" button
      await this.page.getByRole('button', { name: 'Get Jobs' }).click();
    // Build the selector for the expand button
    const expandButtonSelector = `[data-test="search-scheduler-table-${trace_id}-row"] [data-test="search-scheduler-expand-btn"]`;
    const moreDetailsTabSelector = '[data-test="tab-more_details"]';

    // Wait for the expand button to be visible and click it
    try {
        await this.page.waitForSelector(expandButtonSelector, { timeout: 10000 }); // Adjust timeout as necessary
        await this.page.locator(expandButtonSelector).click();
    } catch (error) {
        testLogger.error(`Error: Unable to find or click expand button for trace ID ${trace_id}.`, error);
        throw new Error(`Expand button for trace ID ${trace_id} not found or not clickable.`);
    }

    // Wait for the More Details tab to be visible and click it
    try {
        await this.page.getByRole('cell', { name: 'Query / Function More Details' }).locator(moreDetailsTabSelector).waitFor({ state: 'visible', timeout: 10000 });
        await this.page.getByRole('cell', { name: 'Query / Function More Details' }).locator(moreDetailsTabSelector).click();
    } catch (error) {
        testLogger.error(`Error: Unable to find or click More Details tab for trace ID ${trace_id}.`, error);
        throw new Error(`More Details tab for trace ID ${trace_id} not found or not clickable.`);
    }

    // Verify that the expected text is present in the textbox
    await expect(this.page.getByText(`"${trace_id}"`)).toBeVisible();
}

   



  

}