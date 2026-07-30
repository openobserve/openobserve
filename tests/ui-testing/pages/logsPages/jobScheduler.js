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
      /**
       * Re-open the search-scheduler list view from scratch. The scheduler list is
       * rendered under `v-show="showSearchScheduler"` (logs Index.vue), and that flag is
       * driven purely by the `action=search_scheduler` URL query param. Navigating to the
       * scheduler-list URL re-sets the param → showSearchScheduler=true → the list (and
       * its Get-Jobs button) becomes visible again.
       */
      async _navigateToSchedulerList() {
        const base = process.env["ZO_BASE_URL_SC_UI"] || process.env["ZO_BASE_URL"];
        const orgId = getOrgIdentifier();
        await this.page.goto(
            `${base}/web/logs?action=search_scheduler&org_identifier=${orgId}&type=search_scheduler_list`,
        );
        await this.page.waitForLoadState('domcontentloaded');
      }

      /**
       * Re-open the scheduler list from the logs toolbar.
       *
       * The URL route above only works if the app still honours
       * `action=search_scheduler` when it boots; on a fresh load Index.vue's
       * updateUrlQueryParams can strip the param again before the list is shown, so a
       * reload can land on a page where the Get-Jobs button is present but
       * display:none and never recovers. The toolbar toggles `showSearchScheduler`
       * on the live component instead, with no reload for that race to happen in.
       *
       * Neither route is reliable alone — run 30552638159 burned all three URL-based
       * retries with the button still hidden ("25 x locator resolved to hidden"), so
       * _ensureSchedulerListOpen alternates between them.
       */
      async _openSchedulerListFromToolbar() {
        await this.page.locator('[data-test="logs-search-bar-more-options-btn"]')
            .click({ timeout: 10000 }).catch(() => {});
        await this.page.locator('[data-test="search-scheduler-list-btn"]')
            .click({ timeout: 10000 }).catch(() => {});
      }

      /**
       * Make the scheduler list actually visible, alternating recovery routes.
       * @returns {Promise<boolean>} whether the Get-Jobs button became visible
       */
      async _ensureSchedulerListOpen(perTryTimeout = 15000) {
        const getJobsBtn = this.page.locator('[data-test="search-scheduler-get-jobs-btn"]');
        const isVisible = async (timeout) => await getJobsBtn
            .waitFor({ state: 'visible', timeout })
            .then(() => true)
            .catch(() => false);

        if (await isVisible(perTryTimeout)) return true;

        // Toolbar first (cheap, no reload), then the URL route, then repeat.
        const routes = [
            () => this._openSchedulerListFromToolbar(),
            () => this._navigateToSchedulerList(),
            () => this._openSchedulerListFromToolbar(),
            () => this._navigateToSchedulerList(),
        ];
        for (let i = 0; i < routes.length; i++) {
            testLogger.warn(
                `_ensureSchedulerListOpen: Get-Jobs button hidden (scheduler view reset) — recovery ${i + 1}/${routes.length}`,
            );
            await routes[i]();
            if (await isVisible(perTryTimeout)) return true;
        }
        return false;
      }

      async _getJobRowIndex(trace_id, timeout = 15000) {
        // GRACEFUL WORKAROUND for an app-side flake (origin/fix/search-scheduler-job-issue):
        // the scheduler list lives under `v-show="showSearchScheduler"`, and Index.vue
        // resets that flag to false whenever the logs page rewrites the URL query WITHOUT
        // the `action=search_scheduler` param (updateUrlQueryParams strips it after a
        // search). The Get-Jobs button is then present in the DOM but display:none, and it
        // never recovers on its own — so waiting alone times out. Recover by re-navigating
        // to the scheduler-list URL (which restores the param → re-shows the list) and
        // retrying. Remove once the app preserves the scheduler view across URL updates.
        const getJobsBtn = this.page.locator('[data-test="search-scheduler-get-jobs-btn"]');
        if (!(await this._ensureSchedulerListOpen())) {
            throw new Error(
                'Scheduler list never became visible: [data-test="search-scheduler-get-jobs-btn"] stayed ' +
                'hidden after toolbar and URL recovery. The logs page dropped action=search_scheduler ' +
                'and did not restore showSearchScheduler.'
            );
        }
        const responsePromise = this.page.waitForResponse(
            resp => resp.url().includes('/search_jobs') && resp.request().method() === 'GET',
            { timeout }
        );
        await getJobsBtn.click();
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
    const restartBtn = await this._awaitEnabledRowButton(
        trace_id,
        'search-scheduler-restart-btn',
        'Restart',
    );
    await restartBtn.click();

    await expect(
        this.page.locator('[data-test="o-toast-message"]').filter({ hasText: 'Search Job has been restarted successfully' }).first()
    ).toBeVisible({ timeout: 10000 });
}


/**
 * Re-fetch the scheduler list until the named per-row action button for `trace_id`
 * is present AND enabled, then return its locator.
 *
 * Row action buttons are gated on the job's server-side status, so their enabled
 * state is a data condition, not a rendering one — clicking straight away just
 * parks Playwright on an auto-waiting click until the action timeout expires
 * (`84 x waiting for element to be visible, enabled and stable` in the CI log).
 * Re-fetching the list on each poll is what actually advances the state; a
 * `waitFor` on a single stale row never would.
 *
 * @param {string} trace_id
 * @param {string} buttonTestId  data-test of the row button
 * @param {string} label         human name used in the failure message
 * @param {number} [timeoutMs=180000]
 */
async _awaitEnabledRowButton(trace_id, buttonTestId, label, timeoutMs = 180000) {
    let button = null;
    // Track the last observed state so the failure says WHICH condition never held —
    // "the job never appeared in the list" and "the job appeared but its button stayed
    // disabled" have completely different causes, and a single generic message sends
    // the reader looking in the wrong place.
    let lastState = 'job not found in scheduler list';

    // Hand-rolled poll rather than expect.poll: its `message` option does not reach
    // the thrown error in this Playwright version (verified — neither the string nor
    // the function form appears in error.message), so the whole point of tracking
    // lastState would be lost and the failure would read as a bare
    // "expect(received).toBe(expected)".
    const deadline = Date.now() + timeoutMs;
    const intervals = [2000, 3000, 5000, 5000, 10000, 10000, 15000];
    let tick = 0;

    while (Date.now() < deadline) {
        const rowIndex = await this._getJobRowIndex(trace_id, 15000);
        if (rowIndex === -1) {
            lastState = 'job not found in scheduler list';
        } else {
            const row = this.page.locator(`[data-test="o2-table-row-${rowIndex}"]`);
            if (!(await row.isVisible({ timeout: 10000 }).catch(() => false))) {
                lastState = `job row ${rowIndex} never rendered`;
            } else {
                const candidate = row.locator(`[data-test="${buttonTestId}"]`);
                if (!(await candidate.isVisible({ timeout: 5000 }).catch(() => false))) {
                    lastState = `${label} button not present on the job row`;
                } else if (!(await candidate.isEnabled().catch(() => false))) {
                    lastState = `${label} button present but disabled — the job has not reached an actionable status`;
                } else {
                    button = candidate;
                    return button;
                }
            }
        }

        const wait = intervals[Math.min(tick++, intervals.length - 1)];
        if (Date.now() + wait >= deadline) break;
        await this.page.waitForTimeout(wait);
    }

    throw new Error(
        `${label} button for trace ID ${trace_id} never became actionable within ${timeoutMs}ms. ` +
        `Last observed: ${lastState}.`
    );
}

async cancelJobSearch(trace_id) {
    const cancelButton = await this._awaitEnabledRowButton(
        trace_id,
        'search-scheduler-cancel-btn',
        'Cancel',
    );
    await cancelButton.click();
    await this.page.locator('[data-test="confirm-dialog"] [data-test="o-dialog-primary-btn"]').click();

    await expect(
        this.page.locator('[data-test="o-toast-message"]').filter({ hasText: 'Search Job has been cancelled successfully' }).first()
    ).toBeVisible({ timeout: 10000 });
}

async exploreJob(trace_id) {
    // The explore button is disabled while the job is pending (status=0) or failed
    // (status=3), so this waits on the JOB reaching a completed state — not on a
    // fixed number of tries. The old 5 x 5s budget (~25s) was a bet on scheduler
    // latency that stopped holding once the alpha1 shards began running in
    // parallel: a job still pending at 25s hard-failed the test. Wait on the real
    // condition with a budget that covers a loaded backend instead.
    const exploreButton = await this._awaitEnabledRowButton(
        trace_id,
        'search-scheduler-explore-btn',
        'Explore',
    );
    await exploreButton.click();

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
