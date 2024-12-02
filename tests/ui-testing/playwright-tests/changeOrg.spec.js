import { test, expect } from "./baseFixtures.js";
import { LoginPage } from '../pages/loginPage.js';
import { LogsPage } from '../pages/logsPage.js';
import { IngestionPage } from '../pages/ingestionPage.js';
import { HomePage } from "../pages/homePage.js";
import { MetricsPage } from "../pages/metricsPage.js";


test.describe("Change Organisation", () => {
    let loginPage, logsPage, ingestionPage, homePage, metricsPage;

    test.beforeEach(async ({ page }) => {
        loginPage = new LoginPage(page);
        ingestionPage = new IngestionPage(page);
        logsPage = new LogsPage(page);
        homePage = new HomePage(page);
        metricsPage = new MetricsPage(page);
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

   
    

   

   

   

   

    
});
