import { test, expect } from "../baseFixtures";
import { PipelinesEP } from "../../pages/pipelinesPages/pipelinesEP";
import { IngestionPage } from '../../pages/generalPages/ingestionPage';
import { PipelineDestinations } from '../../pages/pipelinesPages/pipelineDestinations';
import testLogger from '../utils/test-logger.js';
const path = require('path');
const { isCloudEnvironment } = require('../../pages/cloudPages/cloud-env.js');
const APICleanup = require('../../pages/apiCleanup.js');

test.describe.configure({ mode: 'parallel' });

const IMPORT_ORG = process.env["ORGNAME"] || "default";

// Fails once #16694 is fixed: that is the signal to delete this branch and its callers.
async function expectOrgIdBugAndCleanUp(pipelinesEP, apiCleanup, { pipelineName, functionName, destinationName }) {
    let failure;
    try {
        await pipelinesEP.expectImportBlockedByOrgId(IMPORT_ORG);
        expect((await apiCleanup.fetchPipelines()).map((p) => p.name)).not.toContain(pipelineName);
    } catch (error) {
        failure = error;
    }
    const destinationDeleted = await apiCleanup.deletePipelineDestination(destinationName);
    const functionDeleted = await apiCleanup.deleteFunctionInOrg(IMPORT_ORG, functionName);
    if (failure) throw failure;
    expect(destinationDeleted.code, `delete destination ${destinationName}`).toBe(200);
    expect(functionDeleted.code, `delete function ${functionName}`).toBe(200);
}

// Use stored authentication state from global setup instead of logging in each test
const authFile = path.join(__dirname, '../utils/auth/user.json');
test.use({
  storageState: authFile,
  contextOptions: {
    slowMo: 1000
  }
});

test.describe("Pipeline Import", { tag: ['@enterprise', '@pipelines', '@pipelinesImport'] }, () => {
    let pipelinesEP, ingestionPage, pipelineDestinations;

    test.beforeEach(async ({ page }, testInfo) => {
        testLogger.testStart(testInfo.title, testInfo.file);
        // Auth is handled via storageState - no login needed
        ingestionPage = new IngestionPage(page);
        pipelinesEP = new PipelinesEP(page);
        pipelineDestinations = new PipelineDestinations(page);

        // Ingest test data via API
        await ingestionPage.ingestion();
        await ingestionPage.ingestionJoin();

        // Navigate to base URL after data ingestion (required for storageState)
        await page.goto(`${process.env["ZO_BASE_URL"]}/web/?org_identifier=${process.env["ORGNAME"]}`);
        // Best-effort: a loaded ENT runner never lets this page idle, and every test navigates away from it at once
        await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    });

    test("Import RealTime Pipeline from URL, download and delete imported pipeline", async ({ page }) => {
        test.skip(isCloudEnvironment(), 'Pipeline import not functional on cloud — imported pipelines do not appear in list');

        const randomPipeline = `realurl${Math.floor(Math.random() * 1000)}`;
        const randomFirstFunction = `first${Math.floor(Math.random() * 1000)}`;
        const randomSecondFunction = `second${Math.floor(Math.random() * 1000)}`;


        await pipelinesEP.gotoPipelinesPageEP();
        await pipelinesEP.openFunctionStreamTab();
        await pipelinesEP.createFirstFunction(randomFirstFunction);
        await pipelinesEP.createSecondFunction(randomSecondFunction);
        await pipelinesEP.goToHomePage();
        await pipelinesEP.gotoPipelinesPageEP();
        await pipelinesEP.importPipeline();
        // Import JSON Pipeline
        await pipelinesEP.importPipelineJson('https://raw.githubusercontent.com/ShyamOOAI/pipelines/refs/heads/main/im_real_pipeline');
        await page.waitForTimeout(5000);
        await pipelinesEP.importJsonButtonPipeline();
        await pipelinesEP.fillPipelineDetails(randomPipeline, randomFirstFunction, randomSecondFunction);
        await pipelinesEP.importJsonButtonPipeline();
        // Wait for pipeline to appear in the list after import
        await pipelinesEP.waitForPipelineInList(randomPipeline);
        // Download Pipeline
        await pipelinesEP.downloadPipeline(randomPipeline);

        // Delete Pipeline
        await pipelinesEP.deletePipeline(randomPipeline);
        await page.waitForTimeout(2000);
        await pipelinesEP.validateTextMessage('Pipeline deleted successfully');

    });

    test("Validate Cancel on Import Pipeline", async ({ page }) => {
        await pipelinesEP.gotoPipelinesPageEP();
        await pipelinesEP.importPipeline();
        await pipelinesEP.cancelImportPipeline();
    });

    test("Validate JSON string is empty on Import Pipeline", async ({ page }) => {
        await pipelinesEP.gotoPipelinesPageEP();
        await pipelinesEP.importPipeline();
        await pipelinesEP.importJsonButtonPipeline();
        await page.waitForTimeout(1000);
        await pipelinesEP.validateTextMessage('JSON string is empty');
    });

    test("Import RealTime Pipeline from JSON file, download and delete imported pipeline", async ({ page }) => {
        test.skip(isCloudEnvironment(), 'Pipeline import not functional on cloud — imported pipelines do not appear in list');

        const randomPipeline = `realfile${Math.floor(Math.random() * 1000)}`;
        const randomFirstFunction = `first${Math.floor(Math.random() * 1000)}`;
        const randomSecondFunction = `second${Math.floor(Math.random() * 1000)}`;


        await pipelinesEP.gotoPipelinesPageEP();
        await pipelinesEP.openFunctionStreamTab();
        await pipelinesEP.createFirstFunction(randomFirstFunction);
        await pipelinesEP.createSecondFunction(randomSecondFunction);
        await pipelinesEP.goToHomePage();
        await pipelinesEP.gotoPipelinesPageEP();
        await pipelinesEP.importPipeline();
         //file name to be used for import
         const fileContentPathRealTimePipeline = "../test-data/pipelineRealTime.json";
         // Set the JSON file using page object method
        await pipelinesEP.setFileInput(fileContentPathRealTimePipeline);
        await page.waitForTimeout(5000);
        await pipelinesEP.importJsonButtonPipeline();
        await pipelinesEP.fillPipelineDetails(randomPipeline, randomFirstFunction, randomSecondFunction);
        await pipelinesEP.importJsonButtonPipeline();
        // Wait for pipeline to appear in the list after import
        await pipelinesEP.waitForPipelineInList(randomPipeline);
        // Download Pipeline
        await pipelinesEP.downloadPipeline(randomPipeline);

        // Delete Pipeline
        await pipelinesEP.deletePipeline(randomPipeline);
        await page.waitForTimeout(1000);
        await pipelinesEP.validateTextMessage('Pipeline deleted successfully');

    });

    test("Import Scheduled Pipeline from URL, download and delete imported pipeline", async ({ page }) => {
        test.skip(isCloudEnvironment(), 'Pipeline import not functional on cloud — imported pipelines do not appear in list');

        const randomPipeline = `scheurl${Math.floor(Math.random() * 1000)}`;
        const randomFirstFunction = `first${Math.floor(Math.random() * 1000)}`;
        const randomPipelineDestination = `destination${Math.floor(Math.random() * 1000)}`;
        
        await pipelineDestinations.navigateToManagement();
        await pipelineDestinations.navigateToPipelineDestinations();    
        await pipelineDestinations.addDestination(randomPipelineDestination, 'https://example.com');
        await pipelineDestinations.verifyDestinationAdded();
        await pipelinesEP.gotoPipelinesPageEP();
        await pipelinesEP.openFunctionStreamTab();
        await pipelinesEP.createFirstFunction(randomFirstFunction);
        await pipelinesEP.goToHomePage();
        await pipelinesEP.gotoPipelinesPageEP();
        await pipelinesEP.importPipeline();
        await pipelinesEP.importPipelineJson('https://raw.githubusercontent.com/ShyamOOAI/pipelines/refs/heads/main/scheduledPipeline');
        await page.waitForTimeout(5000);
        await pipelinesEP.importJsonButtonPipeline();

        await pipelinesEP.fillScheduledPipelineDetails(randomPipeline, randomFirstFunction, randomPipelineDestination);
        await pipelinesEP.importJsonButtonPipeline();
        // #16694: import keeps remote_stream nodes in the fixture's "default" org, so outside it the Organization Id error never clears.
        if (IMPORT_ORG !== "default") {
            await expectOrgIdBugAndCleanUp(pipelinesEP, new APICleanup(page), { pipelineName: randomPipeline, functionName: randomFirstFunction, destinationName: randomPipelineDestination });
            return;
        }
        // Wait for pipeline to appear in the list after import
        await pipelinesEP.waitForPipelineInList(randomPipeline);

        // Verify cron expression is displayed in the Frequency column (bug fix verification)
        await pipelinesEP.expectScheduledPipelineCronDisplayed(randomPipeline);

        await pipelinesEP.downloadPipeline(randomPipeline);
        await pipelinesEP.deletePipeline(randomPipeline);
        await page.waitForTimeout(1000);
        await pipelinesEP.validateTextMessage('Pipeline deleted successfully');

    });

    test("Import Scheduled Pipeline from JSON file, download and delete imported pipeline", async ({ page }) => {
        test.skip(isCloudEnvironment(), 'Pipeline import not functional on cloud — imported pipelines do not appear in list');

        const randomPipeline = `schefile${Math.floor(Math.random() * 1000)}`;
        const randomFirstFunction = `first${Math.floor(Math.random() * 1000)}`;
        const randomPipelineDestination = `destination${Math.floor(Math.random() * 1000)}`;
        
        await pipelineDestinations.navigateToManagement();
        await pipelineDestinations.navigateToPipelineDestinations();    
        await pipelineDestinations.addDestination(randomPipelineDestination, 'https://example.com');
        await pipelineDestinations.verifyDestinationAdded();
        await pipelinesEP.gotoPipelinesPageEP();
        await pipelinesEP.openFunctionStreamTab();
        await pipelinesEP.createFirstFunction(randomFirstFunction);
        await pipelinesEP.goToHomePage();
        await pipelinesEP.gotoPipelinesPageEP();
        await pipelinesEP.importPipeline();
        const fileContentPathScheduledPipeline = "../test-data/pipelineScheduled.json";
        await pipelinesEP.setFileInput(fileContentPathScheduledPipeline);
        await page.waitForTimeout(5000);
        await pipelinesEP.importJsonButtonPipeline();

        await pipelinesEP.fillScheduledPipelineDetails(randomPipeline, randomFirstFunction, randomPipelineDestination);
        await pipelinesEP.importJsonButtonPipeline();
        // #16694: import keeps remote_stream nodes in the fixture's "default" org, so outside it the Organization Id error never clears.
        if (IMPORT_ORG !== "default") {
            await expectOrgIdBugAndCleanUp(pipelinesEP, new APICleanup(page), { pipelineName: randomPipeline, functionName: randomFirstFunction, destinationName: randomPipelineDestination });
            return;
        }
        // Wait for pipeline to appear in the list after import
        await pipelinesEP.waitForPipelineInList(randomPipeline);

        // Verify cron expression is displayed in the Frequency column (bug fix verification)
        await pipelinesEP.expectScheduledPipelineCronDisplayed(randomPipeline);

        await pipelinesEP.downloadPipeline(randomPipeline);
        await pipelinesEP.deletePipeline(randomPipeline);
        await page.waitForTimeout(1000);
        await pipelinesEP.validateTextMessage('Pipeline deleted successfully');

    });

});