import { test, expect } from "../baseFixtures";
import { LoginPage } from '../../pages/generalPages/loginPage';
import { PipelinesEP } from "../../pages/pipelinesPages/pipelinesEP";
import { IngestionPage } from '../../pages/generalPages/ingestionPage';
import { PipelineDestinations } from '../../pages/pipelinesPages/pipelineDestinations';

test.describe.configure({ mode: 'parallel' });

test.use({
  contextOptions: {
    slowMo: 1000
  }
});

test.describe("Pipeline Import", { tag: ['@enterprise', '@pipelines', '@pipelinesImport'] }, () => {
    let loginPage, pipelinesEP, ingestionPage, pipelineDestinations;

    test.beforeEach(async ({ page }) => {
        loginPage = new LoginPage(page);
        ingestionPage = new IngestionPage(page);
        pipelinesEP = new PipelinesEP(page);
        pipelineDestinations = new PipelineDestinations(page);
        await loginPage.gotoLoginPage();
        await loginPage.loginAsInternalUser();
        await loginPage.login(); // Login as root user
        await ingestionPage.ingestion();
        await ingestionPage.ingestionJoin();
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