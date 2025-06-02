import { test, expect } from "./baseFixtures.js";
import { LoginPage } from '../pages/loginPage.js';
import { LogsPage } from '../pages/logsPage.js';
import { IngestionPage } from '../pages/ingestionPage.js';
import { HomePage } from "../pages/homePage.js";
import { MetricsPage } from "../pages/metricsPage.js";
import { TracesPage } from "../pages/tracesPage.js";
import { RumPage } from "../pages/rumPage.js";
import { PipelinesPage } from "../pages/pipelinesPage.js";
import { DashboardPage } from "../pages/dashboardPage.js";
import { StreamsPage } from "../pages/streamsPage.js";
import { ReportsPage } from "../pages/reportsPage.js";
import { AlertsPage } from "../pages/alertsPage.js";
import { DataPage } from "../pages/dataPage.js";
import { IamPage } from "../pages/iamPage.js";
import { ManagementPage } from "../pages/managementPage.js";
import { AboutPage } from "../pages/aboutPage.js";
import { CreateOrgPage } from "../pages/createOrgPage.js";


test.describe("Change Organisation", () => {
    let loginPage, logsPage, ingestionPage, homePage, metricsPage,
        tracesPage, rumPage, pipelinesPage, dashboardPage, streamsPage,
        reportsPage, alertsPage, dataPage, iamPage, managementPage, aboutPage, createOrgPage,
        multiOrgIdentifier;

    const newOrgName = `organisation${Math.floor(Math.random() * 10000)}`;
    test.beforeEach(async ({ page }) => {
        loginPage = new LoginPage(page);
        ingestionPage = new IngestionPage(page);
        logsPage = new LogsPage(page);
        homePage = new HomePage(page);
        metricsPage = new MetricsPage(page);
        tracesPage = new TracesPage(page);
        rumPage = new RumPage(page);
        pipelinesPage = new PipelinesPage(page);
        dashboardPage = new DashboardPage(page);
        streamsPage = new StreamsPage(page);
        reportsPage = new ReportsPage(page);
        alertsPage = new AlertsPage(page);
        dataPage = new DataPage(page);
        iamPage = new IamPage(page);
        managementPage = new ManagementPage(page);
        aboutPage = new AboutPage(page);
        createOrgPage = new CreateOrgPage(page);
        await loginPage.gotoLoginPage();
        await loginPage.loginAsInternalUser();
        await loginPage.login();
        await ingestionPage.ingestion();
        
    });

    test("Home Page default validation", async ({ page }) => {
        await page.waitForTimeout(1000);
        await page.reload();
        await page.waitForTimeout(5000);
        await homePage.homePageValidation();
        await homePage.gotoHomePage();
        await homePage.homePageValidation();
        await homePage.homePageDefaultOrg();
        await homePage.homePageURLValidationDefaultOrg();

    });

    test("Home Page change organisation validation", async ({ page }) => {
        multiOrgIdentifier = await createOrgPage.createOrg(newOrgName);
        await ingestionPage.ingestionMultiOrg(multiOrgIdentifier);
        await homePage.homePageOrg(newOrgName);
        await homePage.homePageValidation();
        await homePage.homePageURLValidation(newOrgName);
        await homePage.gotoHomePage();
        await homePage.homePageValidation();
        await homePage.homePageURLValidation(newOrgName);
        await homePage.homeURLContains(multiOrgIdentifier);
    });

    test("Logs Page default validation", async ({ page }) => {

        await logsPage.navigateToLogs();
        await logsPage.validateLogsPage();
        await homePage.homePageDefaultOrg();
        await homePage.homePageURLValidationDefaultOrg();

    });

    test("Logs Page change organisation validation", async ({ page }) => {
        multiOrgIdentifier = await createOrgPage.createOrg(newOrgName);
        await ingestionPage.ingestionMultiOrg(multiOrgIdentifier);
        await homePage.homePageOrg(newOrgName);
        await logsPage.navigateToLogs();
        await homePage.homeURLContains(multiOrgIdentifier);
     

    });

    test("Metrics Page default validation", async ({ page }) => {


        await metricsPage.gotoMetricsPage();
        await homePage.homePageDefaultOrg();
        await homePage.homePageURLValidationDefaultOrg();
        await metricsPage.metricsPageValidation();
        await metricsPage.metricsURLValidation();
    });

    test("Metrics Page change organisation validation", async ({ page }) => {

        multiOrgIdentifier = await createOrgPage.createOrg(newOrgName);
        await ingestionPage.ingestionMultiOrg(multiOrgIdentifier);
        await homePage.homePageOrg(newOrgName);
        await metricsPage.gotoMetricsPage();
        await homePage.homeURLContains(multiOrgIdentifier);

        
    });

    test("Traces Page default validation", async ({ page }) => {


        await tracesPage.navigateToTraces();
        await homePage.homePageDefaultOrg();
        await homePage.homePageURLValidationDefaultOrg();
        await tracesPage.validateTracesPage();
        await tracesPage.tracesURLValidation();
    });

    test("Traces Page change organisation validation", async ({ page }) => {

        multiOrgIdentifier = await createOrgPage.createOrg(newOrgName);
        await ingestionPage.ingestionMultiOrg(multiOrgIdentifier);
        await homePage.homePageOrg(newOrgName);
        await tracesPage.navigateToTraces();
        await homePage.homeURLContains(multiOrgIdentifier);

    });

    test("RUM Page default validation", async ({ page }) => {


        await rumPage.gotoRumPage();
        await homePage.homePageDefaultOrg();
        await homePage.homePageURLValidationDefaultOrg();
        await rumPage.rumURLValidation();
        await rumPage.rumURLValidation();
    });

    test("RUM Page change organisation validation", async ({ page }) => {

        multiOrgIdentifier = await createOrgPage.createOrg(newOrgName);
        await ingestionPage.ingestionMultiOrg(multiOrgIdentifier);
        await homePage.homePageOrg(newOrgName);
        await rumPage.gotoRumPage();
        await homePage.homeURLContains(multiOrgIdentifier);

    });


    test("Pipelines Page default validation", async ({ page }) => {


        await pipelinesPage.gotoPipelinesPage();
        await homePage.homePageDefaultOrg();
        await homePage.homePageURLValidationDefaultOrg();
        await pipelinesPage.pipelinesURLValidation();
        await pipelinesPage.pipelinesURLValidation();
    });

    test("Pipelines Page change organisation validation", async ({ page }) => {

        multiOrgIdentifier = await createOrgPage.createOrg(newOrgName);
        await ingestionPage.ingestionMultiOrg(multiOrgIdentifier);
        await homePage.homePageOrg(newOrgName);
        await pipelinesPage.gotoPipelinesPage();
        await homePage.homeURLContains(multiOrgIdentifier);

    });

    test("Dashboard Page default validation", async ({ page }) => {


        await dashboardPage.navigateToDashboards();
        await homePage.clickDefaultOrg();
        await homePage.homePageURLValidationDefaultOrg();
        await dashboardPage.dashboardURLValidation();
        
    });

    test("Dashboard Page change organisation validation", async ({ page }) => {

        multiOrgIdentifier = await createOrgPage.createOrg(newOrgName);
        await ingestionPage.ingestionMultiOrg(multiOrgIdentifier);
        await homePage.homePageOrg(newOrgName);
        await dashboardPage.navigateToDashboards();
        await homePage.homeURLContains(multiOrgIdentifier);

    });

    test("Streams Page default validation", async ({ page }) => {


        await streamsPage.gotoStreamsPage();
        await homePage.homePageDefaultOrg();
        await homePage.homePageURLValidationDefaultOrg();
        await streamsPage.streamsURLValidation();
        
    });

    test("Streams Page change organisation validation", async ({ page }) => {

        multiOrgIdentifier = await createOrgPage.createOrg(newOrgName);
        await ingestionPage.ingestionMultiOrg(multiOrgIdentifier);
        await homePage.homePageOrg(newOrgName);
        await streamsPage.gotoStreamsPage();
        await homePage.homeURLContains(multiOrgIdentifier);

    });

    test("Reports Page default validation", async ({ page }) => {


        await reportsPage.goToReports();
        await homePage.homePageDefaultOrg();
        await homePage.homePageURLValidationDefaultOrg();
        await reportsPage.reportsURLValidation();
        
    });

    test("Reports Page change organisation validation", async ({ page }) => {

        multiOrgIdentifier = await createOrgPage.createOrg(newOrgName);
        await ingestionPage.ingestionMultiOrg(multiOrgIdentifier);
        await homePage.homePageOrg(newOrgName);
        await reportsPage.goToReports();
        await homePage.homeURLContains(multiOrgIdentifier);

    });

    test("Alerts Page default validation", async ({ page }) => {


        await alertsPage.navigateToAlerts();
        await homePage.clickDefaultOrg();
        await page.waitForTimeout(5000);
        await homePage.homePageURLValidationDefaultOrg();
        await alertsPage.alertsURLValidation();
    });

    test("Alerts Page change organisation validation", async ({ page }) => {

        multiOrgIdentifier = await createOrgPage.createOrg(newOrgName);
        await ingestionPage.ingestionMultiOrg(multiOrgIdentifier);
        await homePage.homePageOrg(newOrgName);
        await alertsPage.navigateToAlerts();
        await homePage.homeURLContains(multiOrgIdentifier);

    });

    test("Data sources Page default validation", async ({ page }) => {


        await dataPage.gotoDataPage();
        await homePage.homePageDefaultOrg();
        await homePage.homePageURLValidationDefaultOrg();
        await dataPage.dataURLValidation();
    });

    test("Data sources Page change organisation validation", async ({ page }) => {

        multiOrgIdentifier = await createOrgPage.createOrg(newOrgName);
        await ingestionPage.ingestionMultiOrg(multiOrgIdentifier);
        await homePage.homePageOrg(newOrgName);
        await dataPage.gotoDataPage();
        await homePage.homeURLContains(multiOrgIdentifier);


    });

    test("IAM Page default validation", async ({ page }) => {


        await iamPage.gotoIamPage();
        await homePage.homePageDefaultOrg();
        await homePage.homePageURLValidationDefaultOrg();
        await iamPage.iamURLValidation();
    });

    test("IAM Page change organisation validation", async ({ page }) => {

        multiOrgIdentifier = await createOrgPage.createOrg(newOrgName);
        await ingestionPage.ingestionMultiOrg(multiOrgIdentifier);
        await homePage.homePageOrg(newOrgName);
        await iamPage.gotoIamPage();
        await homePage.homeURLContains(multiOrgIdentifier);

    });

    test("Management Page default validation", async ({ page }) => {


        await managementPage.goToManagement();
        await homePage.homePageDefaultOrg();
        await homePage.homePageURLValidationDefaultOrg();
        await managementPage.managementURLValidation();
    });

    test("Management Page change organisation validation", async ({ page }) => {
        
        multiOrgIdentifier = await createOrgPage.createOrg(newOrgName);
        await ingestionPage.ingestionMultiOrg(multiOrgIdentifier);
        await homePage.homePageOrg(newOrgName);
        await managementPage.goToManagement();
        await homePage.homeURLContains(multiOrgIdentifier);

    });

    test("About Page default validation", async ({ page }) => {

        await aboutPage.clickHelpMenu();
        await aboutPage.gotoAboutPage();
        await homePage.homePageDefaultOrg();
        await aboutPage.aboutURLValidation();
    });

    test("About Page change organisation validation", async ({ page }) => {

        multiOrgIdentifier = await createOrgPage.createOrg(newOrgName);
        await ingestionPage.ingestionMultiOrg(multiOrgIdentifier);
        await aboutPage.clickHelpMenu();
        await aboutPage.gotoAboutPage();
        await homePage.homePageOrg(newOrgName);
        await homePage.homeURLContains(multiOrgIdentifier);

    });



});
