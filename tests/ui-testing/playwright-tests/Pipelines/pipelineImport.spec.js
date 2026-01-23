import { test, expect } from "../baseFixtures";
import { PipelinesEP } from "../../pages/pipelinesPages/pipelinesEP";
import { IngestionPage } from '../../pages/generalPages/ingestionPage';
import { PipelineDestinations } from '../../pages/pipelinesPages/pipelineDestinations';
const path = require('path');

test.describe.configure({ mode: 'parallel' });

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

    test.beforeEach(async ({ page }) => {
        // Auth is handled via storageState - no login needed
        ingestionPage = new IngestionPage(page);
        pipelinesEP = new PipelinesEP(page);
        pipelineDestinations = new PipelineDestinations(page);

        // Ingest test data via API
        await ingestionPage.ingestion();
        await ingestionPage.ingestionJoin();

        // Navigate to base URL after data ingestion (required for storageState)
        await page.goto(`${process.env["ZO_BASE_URL"]}/web/?org_identifier=${process.env["ORGNAME"]}`);
        await page.waitForLoadState('networkidle');
    });

    test("Import RealTime Pipeline from URL, download and delete imported pipeline", async ({ page }) => {

        const randomPipeline = `realurl${Math.floor(Math.random() * 1000)}`;
        const randomFirstFunction = `first${Math.floor(Math.random() * 1000)}`;
        const randomSecondFunction = `second${Math.floor(Math.random() * 1000)}`;


        await pipelinesEP.gotoPipelinesPageEP();
        await pipelinesEP.openFunctionStreamTab();
        await pipelinesEP.createFirstFunction(randomFirstFunction);
        await pipelinesEP.createSecondFunction(randomSecondFunction);
        await page.goto(process.env["ZO_BASE_URL"] + "/web/?org_identifier=default");
        await pipelinesEP.gotoPipelinesPageEP();
        await pipelinesEP.importPipeline();
        // Import JSON Pipeline
        await pipelinesEP.importPipelineJson('https://raw.githubusercontent.com/ShyamOOAI/pipelines/refs/heads/main/im_real_pipeline');
        await page.waitForTimeout(5000);
        await pipelinesEP.importJsonButtonPipeline();
        await pipelinesEP.fillPipelineDetails(randomPipeline, randomFirstFunction, randomSecondFunction);
        await pipelinesEP.importJsonButtonPipeline();
        await page.waitForTimeout(5000);
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

        const randomPipeline = `realfile${Math.floor(Math.random() * 1000)}`;
        const randomFirstFunction = `first${Math.floor(Math.random() * 1000)}`;
        const randomSecondFunction = `second${Math.floor(Math.random() * 1000)}`;


        await pipelinesEP.gotoPipelinesPageEP();
        await pipelinesEP.openFunctionStreamTab();
        await pipelinesEP.createFirstFunction(randomFirstFunction);
        await pipelinesEP.createSecondFunction(randomSecondFunction);
        await page.goto(process.env["ZO_BASE_URL"] + "/web/?org_identifier=default");
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
        await page.waitForTimeout(5000);
        // Download Pipeline
        await pipelinesEP.downloadPipeline(randomPipeline);
        
        // Delete Pipeline
        await pipelinesEP.deletePipeline(randomPipeline); 
        await page.waitForTimeout(1000);
        await pipelinesEP.validateTextMessage('Pipeline deleted successfully');

    });

    test("Import Scheduled Pipeline from URL, download and delete imported pipeline", async ({ page }) => {

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
        await page.goto(process.env["ZO_BASE_URL"] + "/web/?org_identifier=default");
        await pipelinesEP.gotoPipelinesPageEP();
        await pipelinesEP.importPipeline();
        await pipelinesEP.importPipelineJson('https://raw.githubusercontent.com/ShyamOOAI/pipelines/refs/heads/main/scheduledPipeline');   
        await page.waitForTimeout(5000);
        await pipelinesEP.importJsonButtonPipeline();

        await pipelinesEP.fillScheduledPipelineDetails(randomPipeline, randomFirstFunction, randomPipelineDestination);
        await pipelinesEP.importJsonButtonPipeline();
        await page.waitForTimeout(5000);
        await pipelinesEP.downloadPipeline(randomPipeline);
        await pipelinesEP.deletePipeline(randomPipeline);  
        await page.waitForTimeout(1000);
        await pipelinesEP.validateTextMessage('Pipeline deleted successfully');

    });

    test("Import Scheduled Pipeline from JSON file, download and delete imported pipeline", async ({ page }) => {

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
        await page.goto(process.env["ZO_BASE_URL"] + "/web/?org_identifier=default");
        await pipelinesEP.gotoPipelinesPageEP();
        await pipelinesEP.importPipeline();
        const fileContentPathScheduledPipeline = "../test-data/pipelineScheduled.json";
        await pipelinesEP.setFileInput(fileContentPathScheduledPipeline);
        await page.waitForTimeout(5000);
        await pipelinesEP.importJsonButtonPipeline();

        await pipelinesEP.fillScheduledPipelineDetails(randomPipeline, randomFirstFunction, randomPipelineDestination);
        await pipelinesEP.importJsonButtonPipeline();
        await page.waitForTimeout(5000);
        await pipelinesEP.downloadPipeline(randomPipeline);
        await pipelinesEP.deletePipeline(randomPipeline);  
        await page.waitForTimeout(1000);
        await pipelinesEP.validateTextMessage('Pipeline deleted successfully');

    });

});