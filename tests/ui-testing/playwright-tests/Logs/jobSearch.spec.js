import { test, expect } from "../baseFixtures.js";
import { LoginPage } from '../../pages/generalPages/loginPage.js';
import { IngestionPage } from '../../pages/generalPages/ingestionPage.js';
import { JobSchedulerPage } from '../../pages/logsPages/jobScheduler.js';
import { LogsPage } from '../../pages/logsPages/logsPage.js';
import { LogsPageEP } from '../../pages/logsPages/logsPageEP.js';

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

    test("Create Job Search for schedule query", async ({ page }) => {

        await logsPage.navigateToLogs();
        await logsPageEP.selectStreamDropDown();
        await logsPage.selectStreamAndStreamTypeForLogs(stream);
        await logsPageEP.queryJobSearch();
        await logsPage.selectRunQuery();
        await logsPageEP.searchSchedulerDropdown();
        await logsPageEP.searchSchedulerCreate();
        await logsPageEP.searchSchedulerSubmit();
        await logsPageEP.validateAddJob();

    });


    test("Create Job Search for schedule query with invalid data", async ({ page }) => {

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

    test("Create and Delete Job Search for schedule query", async ({ page }) => {


        await page.goto(process.env["ZO_BASE_URL_SC_UI"] + "/web/logs?action=search_scheduler&org_identifier=default&type=search_scheduler_list");
        await page.waitForTimeout(10000);
        const jobId = await jobSchedulerPage.submitSearchJob();
        console.log(`Job ID: ${jobId}`);
        expect(jobId).not.toBeNull();
        const traceId = await jobSchedulerPage.getTraceIdByJobId(jobId);
        console.log(`Trace ID: ${traceId}`);
        await jobSchedulerPage.deleteJobSearch(traceId);


    });

    test("Create and restart Job Search for schedule query", async ({ page }) => {


        await page.goto(process.env["ZO_BASE_URL_SC_UI"] + "/web/logs?action=search_scheduler&org_identifier=default&type=search_scheduler_list");
        await page.waitForTimeout(10000);
        const jobId = await jobSchedulerPage.submitSearchJob();
        console.log(`Job ID: ${jobId}`);
        expect(jobId).not.toBeNull();
        const traceId = await jobSchedulerPage.getTraceIdByJobId(jobId);
        console.log(`Trace ID: ${traceId}`);
        await page.waitForTimeout(10000);
        await jobSchedulerPage.restartJobSearch(traceId);


    });

    test("Create and cancel Job Search for schedule query", async ({ page }) => {


        await page.goto(process.env["ZO_BASE_URL_SC_UI"] + "/web/logs?action=search_scheduler&org_identifier=default&type=search_scheduler_list");
        await page.waitForTimeout(10000);
        const jobId = await jobSchedulerPage.submitSearchJob();
        console.log(`Job ID: ${jobId}`);
        expect(jobId).not.toBeNull();
        const traceId = await jobSchedulerPage.getTraceIdByJobId(jobId);
        console.log(`Trace ID: ${traceId}`);
        await jobSchedulerPage.cancelJobSearch(traceId);


    });

    test("Create and explore Job Search for schedule query", async ({ page }) => {

        await page.goto(process.env["ZO_BASE_URL_SC_UI"] + "/web/logs?action=search_scheduler&org_identifier=default&type=search_scheduler_list");
        await page.waitForTimeout(10000);
        const jobId = await jobSchedulerPage.submitSearchJob();
        console.log(`Job ID: ${jobId}`);
        expect(jobId).not.toBeNull();
        const traceId = await jobSchedulerPage.getTraceIdByJobId(jobId);
        console.log(`Trace ID: ${traceId}`);
        await page.waitForTimeout(10000);
        await jobSchedulerPage.exploreJob(traceId);

    });



    test("Create and view Job Search for schedule query details", async ({ page }) => {

        await page.goto(process.env["ZO_BASE_URL_SC_UI"] + "/web/logs?action=search_scheduler&org_identifier=default&type=search_scheduler_list");
        await page.waitForTimeout(10000);
        const jobId = await jobSchedulerPage.submitSearchJob();
        console.log(`Job ID: ${jobId}`);
        expect(jobId).not.toBeNull();
        const traceId = await jobSchedulerPage.getTraceIdByJobId(jobId);
        console.log(`Trace ID: ${traceId}`);
        await jobSchedulerPage.viewJobDetails(traceId);

    });













});