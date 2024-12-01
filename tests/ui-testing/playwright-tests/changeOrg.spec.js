import { test, expect } from "./baseFixtures.js";
import { LoginPage } from '../pages/loginPage.js';
import { LogsPage } from '../pages/logsPage.js';
import { IngestionPage } from '../pages/ingestionPage.js';
import { HomePage } from "../pages/homePage.js";


test.describe("Change Organisation", () => {
    let loginPage, logsPage, ingestionPage, homePage;

    test.beforeEach(async ({ page }) => {
        loginPage = new LoginPage(page);
        ingestionPage = new IngestionPage(page);
        logsPage = new LogsPage(page);
        homePage = new HomePage(page);
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


    test("Run query after selecting two streams, selecting field and SQL Mode On", async ({ page }) => {

        await logsPage.navigateToLogs();
        await logsPage.selectIndexAndStreamJoin();
        await logsPage.kubernetesContainerName();
        await logsPage.enableSQLMode();
        await logsPage.selectRunQuery();
        await logsPage.signOut();

    });

    test("Run query after selecting two streams, SQL Mode On and entering join queries", async ({ page }) => {

        await logsPage.navigateToLogs();
        await logsPage.selectIndexAndStreamJoin();
        await logsPage.kubernetesContainerNameJoin();
        await logsPage.enableSQLMode();
        await logsPage.selectRunQuery();
        await logsPage.signOut();

    });

    test("Run query after selecting two streams, SQL Mode On and entering join limit", async ({ page }) => {

        await logsPage.navigateToLogs();
        await logsPage.selectIndexAndStreamJoin();
        await logsPage.kubernetesContainerNameJoinLimit();
        await logsPage.enableSQLMode();
        await logsPage.selectRunQuery();
        await logsPage.signOut();

    });

    test("Run query after selecting two streams, SQL Mode On and entering join like", async ({ page }) => {

        await logsPage.navigateToLogs();
        await logsPage.selectIndexAndStreamJoin();
        await logsPage.kubernetesContainerNameJoinLike();
        await logsPage.enableSQLMode();
        await logsPage.selectRunQuery();
        await logsPage.signOut();

    });

    test("Run query after selecting two streams, SQL Mode On and entering Left join queries", async ({ page }) => {

        await logsPage.navigateToLogs();
        await logsPage.selectIndexAndStreamJoin();
        await logsPage.kubernetesContainerNameLeftJoin();
        await logsPage.enableSQLMode();
        await logsPage.selectRunQuery();
        await logsPage.signOut();

    });

    test("Run query after selecting two streams, SQL Mode On and entering Right join queries", async ({ page }) => {

        await logsPage.navigateToLogs();
        await logsPage.selectIndexAndStreamJoin();
        await logsPage.kubernetesContainerNameRightJoin();
        await logsPage.enableSQLMode();
        await logsPage.selectRunQuery();
        await logsPage.signOut();

    });

    test("Run query after selecting two streams, SQL Mode On and entering Full join queries", async ({ page }) => {

        await logsPage.navigateToLogs();
        await logsPage.selectIndexAndStreamJoin();
        await logsPage.kubernetesContainerNameFullJoin();
        await logsPage.enableSQLMode();
        await logsPage.selectRunQuery();
        await logsPage.signOut();

    });
});
