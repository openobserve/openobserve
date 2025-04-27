import { test, expect } from "./baseFixtures";
import { LoginPage } from '../pages/loginPage';
import { PipelinesPage } from "../pages/pipelinesPage.js";
import { IngestionPage } from '../pages/ingestionPage';

test.describe.configure({ mode: 'parallel' });

test.describe("Pipeline Import", () => {
    let loginPage, pipelinesPage, ingestionPage;

    test.beforeEach(async ({ page }) => {
        loginPage = new LoginPage(page);
        ingestionPage = new IngestionPage(page);
        pipelinesPage = new PipelinesPage(page);
        await loginPage.gotoLoginPage();
        await loginPage.loginAsInternalUser();
        await loginPage.login(); // Login as root user
        await ingestionPage.ingestion();
        await ingestionPage.ingestionJoin();
    });

    test("Import RealTime Pipeline from URL, download and delete imported pipeline", async ({ page }) => {

        const randomPipeline = `pipeline${Math.floor(Math.random() * 100000)}`;
        const randomFirstFunction = `firstFunction${Math.floor(Math.random() * 100000)}`;
        const randomSecondFunction = `secondFunction${Math.floor(Math.random() * 100000)}`;


        await pipelinesPage.gotoPipelinesPage();
        await pipelinesPage.pipelinesURLValidation();
        await pipelinesPage.openFunctionStreamTab();
        await pipelinesPage.createFirstFunction(randomFirstFunction);
        await pipelinesPage.createSecondFunction(randomSecondFunction);
        await page.goto(process.env["ZO_BASE_URL"] + "/web/?org_identifier=default");
        await pipelinesPage.gotoPipelinesPage();
        await pipelinesPage.importPipeline();
        // Import JSON Pipeline
        await pipelinesPage.importPipelineJson('https://raw.githubusercontent.com/ShyamOOAI/pipelines/refs/heads/main/im_real_pipeline');
        await page.waitForTimeout(5000);
        await pipelinesPage.importJsonButtonPipeline();
        await pipelinesPage.fillPipelineDetails(randomPipeline, randomFirstFunction, randomSecondFunction);
        await pipelinesPage.importJsonButtonPipeline();
        await pipelinesPage.validateTextMessage('Pipelines(s) imported successfully');
        await page.waitForTimeout(5000);
        // Download Pipeline
        await pipelinesPage.downloadPipeline(randomPipeline);
        
        // Delete Pipeline
        await pipelinesPage.deletePipeline(randomPipeline);  
        await pipelinesPage.validateTextMessage('Pipeline deleted successfully');

    });

    test("Validate Cancel on Import Pipeline", async ({ page }) => {
        await pipelinesPage.gotoPipelinesPage();
        await pipelinesPage.pipelinesURLValidation();
        await pipelinesPage.importPipeline();
        await pipelinesPage.cancelImportPipeline();
    });

    test("Validate JSON string is empty on Import Pipeline", async ({ page }) => {
        await pipelinesPage.gotoPipelinesPage();
        await pipelinesPage.pipelinesURLValidation();
        await pipelinesPage.importPipeline();
        await pipelinesPage.importJsonButtonPipeline();
        await pipelinesPage.validateTextMessage('JSON string is empty');
    });

    test("Import RealTime Pipeline from JSON file, download and delete imported pipeline", async ({ page }) => {

        const randomPipeline = `pipeline${Math.floor(Math.random() * 100000)}`;
        const randomFirstFunction = `firstFunction${Math.floor(Math.random() * 100000)}`;
        const randomSecondFunction = `secondFunction${Math.floor(Math.random() * 100000)}`;


        await pipelinesPage.gotoPipelinesPage();
        await pipelinesPage.pipelinesURLValidation();
        await pipelinesPage.openFunctionStreamTab();
        await pipelinesPage.createFirstFunction(randomFirstFunction);
        await pipelinesPage.createSecondFunction(randomSecondFunction);
        await page.goto(process.env["ZO_BASE_URL"] + "/web/?org_identifier=default");
        await pipelinesPage.gotoPipelinesPage();
        await pipelinesPage.importPipeline();
         //file name to be used for import
         const fileContentPathRealTimePipeline = "../test-data/pipelineRealTime.json";
         // Locate the file input field and set the JSON file
         const inputFile = await page.locator('input[type="file"]');
         await inputFile.setInputFiles(fileContentPathRealTimePipeline);

        await page.waitForTimeout(5000);
        await pipelinesPage.importJsonButtonPipeline();
        await pipelinesPage.fillPipelineDetails(randomPipeline, randomFirstFunction, randomSecondFunction);
        await pipelinesPage.importJsonButtonPipeline();
        await pipelinesPage.validateTextMessage('Pipelines(s) imported successfully');
        await page.waitForTimeout(5000);
        // Download Pipeline
        await pipelinesPage.downloadPipeline(randomPipeline);
        
        // Delete Pipeline
        await pipelinesPage.deletePipeline(randomPipeline);  
        await pipelinesPage.validateTextMessage('Pipeline deleted successfully');

    });

});