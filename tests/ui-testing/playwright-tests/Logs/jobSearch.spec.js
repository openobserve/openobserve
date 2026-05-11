import { test, expect } from "../baseFixtures.js";
import { LoginPage } from '../../pages/generalPages/loginPage.js';
import { IngestionPage } from '../../pages/generalPages/ingestionPage.js';
import { JobSchedulerPage } from '../../pages/logsPages/jobScheduler.js';
import { LogsPage } from '../../pages/logsPages/logsPage.js';
import { LogsPageEP } from '../../pages/logsPages/logsPageEP.js';
const { getOrgIdentifier } = require('../utils/cloud-auth.js');
const testLogger = require('../utils/test-logger.js');

test.describe.configure({ mode: 'parallel' });

test.describe("Job Search for schedule query", { tag: '@enterprise' }, () => {
    let loginPage, logsPage, ingestionPage, jobSchedulerPage, logsPageEP;
    const stream = "e2e_automate";
    test.beforeEach(async ({ page }) => {
        loginPage = new LoginPage(page);
        ingestionPage = new IngestionPage(page);
        logsPage = new LogsPage(page);
        logsPageEP = new LogsPageEP(page);
        jobSchedulerPage = new JobSchedulerPage(page, process.env["ZO_BASE_URL"]);
        await loginPage.gotoLoginPage();
        await loginPage.loginAsInternalUser();
        await loginPage.login(); // Login as root user
        await ingestionPage.ingestion();

    });

    test("Create Job Search for schedule query", { tag: ['@jobSearch', '@smoke', '@P0'] }, async ({ page }) => {

        await logsPage.navigateToLogs();
        await logsPageEP.selectStreamDropDown();
        await logsPage.selectStreamAndStreamTypeForLogs(stream);
        await logsPageEP.queryJobSearch();
        await logsPage.selectRunQuery();
        await logsPageEP.searchSchedulerDropdown();
        await logsPageEP.searchSchedulerCreate();
        const jobId = await logsPageEP.searchSchedulerSubmit();
        await logsPageEP.validateAddJob(jobId);

    });


    test("Create Job Search for schedule query with invalid data", { tag: ['@jobSearch', '@validation', '@P1'] }, async ({ page }) => {

        await logsPage.navigateToLogs();
        await logsPageEP.selectStreamDropDown();
        await logsPage.selectStreamAndStreamTypeForLogs(stream);
        await logsPageEP.queryJobSearch();
        await logsPage.selectRunQuery();
        await logsPageEP.searchSchedulerDropdown();
        await logsPageEP.searchSchedulerCreate();
        await logsPageEP.searchSchedulerInvalid();
        await logsPageEP.validateInvalidData();

    });

    test("Create and Delete Job Search for schedule query", { tag: ['@jobSearch', '@crud', '@P1'] }, async ({ page }) => {


        await page.goto((process.env["ZO_BASE_URL_SC_UI"] || process.env["ZO_BASE_URL"]) + `/web/logs?action=search_scheduler&org_identifier=${getOrgIdentifier()}&type=search_scheduler_list`);
        await page.waitForTimeout(10000);
        const jobId = await jobSchedulerPage.submitSearchJob();
        testLogger.info(`Job ID: ${jobId}`);
        expect(jobId).not.toBeNull();
        const traceId = await jobSchedulerPage.getTraceIdByJobId(jobId);
        testLogger.info(`Trace ID: ${traceId}`);
        await jobSchedulerPage.deleteJobSearch(traceId);


    });

    test("Create and restart Job Search for schedule query", { tag: ['@jobSearch', '@crud', '@P1'] }, async ({ page }) => {


        await page.goto((process.env["ZO_BASE_URL_SC_UI"] || process.env["ZO_BASE_URL"]) + `/web/logs?action=search_scheduler&org_identifier=${getOrgIdentifier()}&type=search_scheduler_list`);
        await page.waitForTimeout(10000);
        const jobId = await jobSchedulerPage.submitSearchJob();
        testLogger.info(`Job ID: ${jobId}`);
        expect(jobId).not.toBeNull();
        const traceId = await jobSchedulerPage.getTraceIdByJobId(jobId);
        testLogger.info(`Trace ID: ${traceId}`);
        await page.waitForTimeout(10000);
        await jobSchedulerPage.restartJobSearch(traceId);


    });

    test("Create and cancel Job Search for schedule query", { tag: ['@jobSearch', '@crud', '@P1'] }, async ({ page }) => {


        await page.goto((process.env["ZO_BASE_URL_SC_UI"] || process.env["ZO_BASE_URL"]) + `/web/logs?action=search_scheduler&org_identifier=${getOrgIdentifier()}&type=search_scheduler_list`);
        await page.waitForTimeout(10000);
        const jobId = await jobSchedulerPage.submitSearchJob();
        testLogger.info(`Job ID: ${jobId}`);
        expect(jobId).not.toBeNull();
        const traceId = await jobSchedulerPage.getTraceIdByJobId(jobId);
        testLogger.info(`Trace ID: ${traceId}`);
        await jobSchedulerPage.cancelJobSearch(traceId);


    });

    test("Create and explore Job Search for schedule query", { tag: ['@jobSearch', '@crud', '@P1'] }, async ({ page }) => {

        await page.goto((process.env["ZO_BASE_URL_SC_UI"] || process.env["ZO_BASE_URL"]) + `/web/logs?action=search_scheduler&org_identifier=${getOrgIdentifier()}&type=search_scheduler_list`);
        await page.waitForTimeout(10000);
        const jobId = await jobSchedulerPage.submitSearchJob();
        testLogger.info(`Job ID: ${jobId}`);
        expect(jobId).not.toBeNull();
        const traceId = await jobSchedulerPage.getTraceIdByJobId(jobId);
        testLogger.info(`Trace ID: ${traceId}`);
        await page.waitForTimeout(10000);
        await jobSchedulerPage.exploreJob(traceId);

    });



    test("Create and view Job Search for schedule query details", { tag: ['@jobSearch', '@crud', '@P1'] }, async ({ page }) => {

        await page.goto((process.env["ZO_BASE_URL_SC_UI"] || process.env["ZO_BASE_URL"]) + `/web/logs?action=search_scheduler&org_identifier=${getOrgIdentifier()}&type=search_scheduler_list`);
        await page.waitForTimeout(10000);
        const jobId = await jobSchedulerPage.submitSearchJob();
        testLogger.info(`Job ID: ${jobId}`);
        expect(jobId).not.toBeNull();
        const traceId = await jobSchedulerPage.getTraceIdByJobId(jobId);
        testLogger.info(`Trace ID: ${traceId}`);
        await jobSchedulerPage.viewJobDetails(traceId);

    });

    /**
     * Monaco Lazy Loading Test - PR #10146
     * Verifies that when exploring a scheduled job, the query is correctly
     * pre-filled in the Monaco editor after lazy loading.
     */
    test("Explore Job Search should pre-fill Monaco editor with scheduled query", {
        tag: ['@jobSearch', '@monacoLazyLoad', '@queryPrefill', '@scheduleSearch', '@P1']
    }, async ({ page }) => {

        // Step 1: Navigate to search scheduler list
        await page.goto((process.env["ZO_BASE_URL_SC_UI"] || process.env["ZO_BASE_URL"]) + `/web/logs?action=search_scheduler&org_identifier=${getOrgIdentifier()}&type=search_scheduler_list`);
        await page.waitForTimeout(10000);

        // Step 2: Submit a search job via API
        const jobId = await jobSchedulerPage.submitSearchJob();
        testLogger.info(`Job ID: ${jobId}`);
        expect(jobId).not.toBeNull();

        // Step 3: Get trace ID for the job
        const traceId = await jobSchedulerPage.getTraceIdByJobId(jobId);
        testLogger.info(`Trace ID: ${traceId}`);
        await page.waitForTimeout(10000);

        // Step 4: Click explore to navigate to logs with the job's query
        await jobSchedulerPage.exploreJob(traceId);

        // Step 5: Wait for Monaco editor to load (lazy loading)
        await logsPage.waitForQueryEditorVisible(30000);
        await page.waitForTimeout(2000);

        // Step 6: Verify Monaco editor contains the job's SQL query
        // The job query is: SELECT * FROM "e2e_automate"
        const editorContent = await logsPage.getQueryEditorText();
        testLogger.info(`Monaco editor content: ${editorContent}`);

        // Verify the query structure is present
        expect(editorContent).toContain('SELECT');
        expect(editorContent).toContain('e2e_automate');

        testLogger.info('Monaco editor pre-fill verification completed successfully');
    });











});