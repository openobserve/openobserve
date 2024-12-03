import { test, expect } from "./baseFixtures.js";
import { LoginPage } from '../pages/loginPage.js';
import { LogsPage } from '../pages/logsPage.js';
import { IngestionPage } from '../pages/ingestionPage.js';
import { HomePage } from "../pages/homePage.js";
import { MetricsPage } from "../pages/metricsPage.js";
import { TracesPage } from "../pages/tracesPage.js";
import { RumPage } from "../pages/rumPage.js";
import { PipelinesPage } from "../pages/pipelinesPage.js";


test.describe("Change Organisation", () => {
    let loginPage, logsPage, ingestionPage, homePage, metricsPage, tracesPage, rumPage, pipelinesPage;

    test.beforeEach(async ({ page }) => {
        loginPage = new LoginPage(page);
        ingestionPage = new IngestionPage(page);
        logsPage = new LogsPage(page);
        homePage = new HomePage(page);
        metricsPage = new MetricsPage(page);
        tracesPage = new TracesPage(page);
        rumPage = new RumPage(page);
        pipelinesPage = new PipelinesPage(page);
        await loginPage.gotoLoginPage();
        // await loginPage.loginAsInternalUser();
        await loginPage.login();
        await ingestionPage.ingestion();
        await ingestionPage.ingestionMultiOrg();
    });

    test("Home Page default validation", async ({ page }) => {
       
        await homePage.homePageValidation();
        await homePage.gotoHomePage();
        await homePage.homePageValidation();
    

    });

    test("Home Page change organisation validation", async ({ page }) => {
       
        await homePage.homePageDefaultMultiOrg();
        await homePage.homePageValidation();
        await homePage.homePageURLValidation();
        await homePage.gotoHomePage();
        await homePage.homePageValidation();
        await homePage.homePageURLValidation();
    
    });

    test("Logs Page default validation", async ({ page }) => {

        await logsPage.navigateToLogs();
        await logsPage.validateLogsPage();   
    });

    test("Logs Page change organisation validation", async ({ page }) => {

        await logsPage.navigateToLogs();
        await logsPage.logsPageDefaultMultiOrg();
        await page.waitForTimeout(5000); 
        await logsPage.validateLogsPage();
      
        await logsPage.logsPageURLValidation();
        await logsPage.navigateToLogs();
        await logsPage.validateLogsPage();
        await logsPage.logsPageURLValidation();
  
    });

    test("Metrics Page default validation", async ({ page }) => {

       
        await metricsPage.gotoMetricsPage();
        await metricsPage.metricsPageValidation(); 
        await metricsPage.metricsURLValidation(); 
    });

    test("Metrics Page change organisation validation", async ({ page }) => {

        await metricsPage.gotoMetricsPage();
        await page.waitForTimeout(5000); 
        await metricsPage.metricsPageDefaultMultiOrg();
        await page.waitForTimeout(5000); 
        await metricsPage.metricsPageValidation();
      
        await metricsPage.metricsPageURLValidation();
        await metricsPage.gotoMetricsPage();
        await metricsPage.metricsPageValidation();
        await metricsPage.metricsPageURLValidation();
  
    });

    test("Traces Page default validation", async ({ page }) => {

       
        await tracesPage.navigateToTraces();
        await tracesPage.validateTracesPage(); 
        await tracesPage.tracesURLValidation(); 
    });

    test("Traces Page change organisation validation", async ({ page }) => {

        await tracesPage.navigateToTraces();
        await page.waitForTimeout(5000); 
        await tracesPage.tracesPageDefaultMultiOrg();
        await page.waitForTimeout(5000); 
        await tracesPage.validateTracesPage();
      
        await tracesPage.tracesPageURLValidation();
        await tracesPage.navigateToTraces();
        await tracesPage.validateTracesPage();
        await tracesPage.tracesPageURLValidation();
  
    });

    test("RUM Page default validation", async ({ page }) => {

       
        await rumPage.gotoRumPage();
        await rumPage.rumURLValidation(); 
    });

    test("RUM Page change organisation validation", async ({ page }) => {

        await rumPage.gotoRumPage();
        await page.waitForTimeout(5000); 
        await rumPage.rumPageDefaultMultiOrg();
        await page.waitForTimeout(5000); 
        await rumPage.rumPageURLValidation();
        await rumPage.gotoRumPage();
        await rumPage.rumPageURLValidation();
  
    });

    
    test("Pipelines Page default validation", async ({ page }) => {

       
        await pipelinesPage.gotoPipelinesPage();
        await pipelinesPage.pipelinesURLValidation(); 
    });

    test("Pipelines Page change organisation validation", async ({ page }) => {

        await pipelinesPage.gotoPipelinesPage();
        await page.waitForTimeout(5000); 
        await pipelinesPage.pipelinesPageDefaultMultiOrg();
        await page.waitForTimeout(5000); 
        await pipelinesPage.pipelinesPageURLValidation();
        await pipelinesPage.gotoPipelinesPage();
        await pipelinesPage.pipelinesPageURLValidation();
  
    });
   

   

   

   

    
});
