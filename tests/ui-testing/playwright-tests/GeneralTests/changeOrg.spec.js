import { test, expect } from "../baseFixtures.js";
import PageManager from "../../pages/page-manager.js";

test.describe("Change Organisation", () => {
    let pageManager, multiOrgIdentifier;
    const timestamp = Date.now(); 
    const randomSuffix = Math.floor(Math.random() * 1000); 
    const newOrgName = `org${timestamp}${randomSuffix}`;

    test.beforeEach(async ({ page }) => {
        pageManager = new PageManager(page);
        await pageManager.loginPage.gotoLoginPage();
        await pageManager.loginPage.loginAsInternalUser();
        await pageManager.loginPage.login();
        await pageManager.ingestionPage.ingestion();
    });

    test("Home Page default validation", async ({ page }) => {
        await page.waitForTimeout(1000);
        await page.reload();
        await page.waitForTimeout(5000);
        await pageManager.homePage.homePageValidation();
        await pageManager.homePage.gotoHomePage();
        await pageManager.homePage.homePageValidation();
        await pageManager.homePage.homePageDefaultOrg();
        await pageManager.homePage.homePageURLValidationDefaultOrg();
    });

    test("Home Page change organisation validation", async ({ page }) => {
        multiOrgIdentifier = await pageManager.createOrgPage.createOrg(newOrgName);
        await pageManager.ingestionPage.ingestionMultiOrg(multiOrgIdentifier);
        await pageManager.homePage.homePageOrg(newOrgName);
        await pageManager.homePage.homePageValidation();
        await pageManager.homePage.homePageURLValidation(newOrgName);
        await pageManager.homePage.gotoHomePage();
        await pageManager.homePage.homePageValidation();
        await pageManager.homePage.homePageURLValidation(newOrgName);
        await pageManager.homePage.homeURLContains(multiOrgIdentifier);
    });

    test("Logs Page default validation", async ({ page }) => {
        await pageManager.logsPage.navigateToLogs();
        await pageManager.logsPage.validateLogsPage();
        await pageManager.homePage.homePageDefaultOrg();
        await pageManager.homePage.homePageURLValidationDefaultOrg();
    });

    test("Logs Page change organisation validation", async ({ page }) => {
        multiOrgIdentifier = await pageManager.createOrgPage.createOrg(newOrgName);
        await pageManager.ingestionPage.ingestionMultiOrg(multiOrgIdentifier);
        await pageManager.homePage.homePageOrg(newOrgName);
        await pageManager.logsPage.navigateToLogs(multiOrgIdentifier);
        await pageManager.homePage.homeURLContains(multiOrgIdentifier);
    });

    test("Metrics Page default validation", async ({ page }) => {
        await pageManager.metricsPage.gotoMetricsPage();
        await pageManager.homePage.homePageDefaultOrg();
        await pageManager.homePage.homePageURLValidationDefaultOrg();
        await pageManager.metricsPage.metricsPageValidation();
        await pageManager.metricsPage.metricsURLValidation();
    });

    test("Metrics Page change organisation validation", async ({ page }) => {
        multiOrgIdentifier = await pageManager.createOrgPage.createOrg(newOrgName);
        await pageManager.ingestionPage.ingestionMultiOrg(multiOrgIdentifier);
        await pageManager.homePage.homePageOrg(newOrgName);
        await pageManager.metricsPage.gotoMetricsPage();
        await pageManager.homePage.homeURLContains(multiOrgIdentifier);
    });

    test("Traces Page default validation", async ({ page }) => {
        await pageManager.tracesPage.navigateToTraces();
        await pageManager.tracesPage.tracesPageDefaultOrg();
        await pageManager.homePage.homePageURLValidationDefaultOrg();
        await pageManager.tracesPage.validateTracesPage();
        await pageManager.tracesPage.tracesURLValidation();
    });

    test("Traces Page change organisation validation", async ({ page }) => {
        multiOrgIdentifier = await pageManager.createOrgPage.createOrg(newOrgName);
        await pageManager.ingestionPage.ingestionMultiOrg(multiOrgIdentifier);
        await pageManager.homePage.homePageOrg(newOrgName);
        await pageManager.tracesPage.navigateToTraces();
        await pageManager.homePage.homeURLContains(multiOrgIdentifier);
    });

    test("RUM Page default validation", async ({ page }) => {
        await pageManager.rumPage.gotoRumPage();
        await pageManager.homePage.homePageDefaultOrg();
        await pageManager.homePage.homePageURLValidationDefaultOrg();
        await pageManager.rumPage.rumURLValidation();
        await pageManager.rumPage.rumURLValidation();
    });

    test("RUM Page change organisation validation", async ({ page }) => {
        multiOrgIdentifier = await pageManager.createOrgPage.createOrg(newOrgName);
        await pageManager.ingestionPage.ingestionMultiOrg(multiOrgIdentifier);
        await pageManager.homePage.homePageOrg(newOrgName);
        await pageManager.rumPage.gotoRumPage();
        await pageManager.homePage.homeURLContains(multiOrgIdentifier);
    });

    test("Pipelines Page default validation", async ({ page }) => {
        await pageManager.pipelinesPage.gotoPipelinesPage();
        await pageManager.homePage.homePageDefaultOrg();
        await pageManager.homePage.homePageURLValidationDefaultOrg();
        await pageManager.pipelinesPage.pipelinesURLValidation();
        await pageManager.pipelinesPage.pipelinesURLValidation();
    });

    test("Pipelines Page change organisation validation", async ({ page }) => {
        multiOrgIdentifier = await pageManager.createOrgPage.createOrg(newOrgName);
        await pageManager.ingestionPage.ingestionMultiOrg(multiOrgIdentifier);
        await pageManager.homePage.homePageOrg(newOrgName);
        await pageManager.pipelinesPage.gotoPipelinesPage();
        await pageManager.homePage.homeURLContains(multiOrgIdentifier);
    });

    test("Dashboard Page default validation", async ({ page }) => {
        await pageManager.dashboardPage.navigateToDashboards();
        await pageManager.homePage.clickDefaultOrg();
        await pageManager.homePage.homePageURLValidationDefaultOrg();
        await pageManager.dashboardPage.dashboardURLValidation();
    });

    test("Dashboard Page change organisation validation", async ({ page }) => {
        multiOrgIdentifier = await pageManager.createOrgPage.createOrg(newOrgName);
        await pageManager.ingestionPage.ingestionMultiOrg(multiOrgIdentifier);
        await pageManager.homePage.homePageOrg(newOrgName);
        await pageManager.dashboardPage.navigateToDashboards();
        await pageManager.homePage.homeURLContains(multiOrgIdentifier);
    });

    test("Streams Page default validation", async ({ page }) => {
        await pageManager.streamsPage.gotoStreamsPage();
        await pageManager.streamsPage.streamsPageDefaultOrg();
        await pageManager.homePage.homePageURLValidationDefaultOrg();
        await pageManager.streamsPage.streamsURLValidation();
    });

    test("Streams Page change organisation validation", async ({ page }) => {
        multiOrgIdentifier = await pageManager.createOrgPage.createOrg(newOrgName);
        await pageManager.ingestionPage.ingestionMultiOrg(multiOrgIdentifier);
        await pageManager.homePage.homePageOrg(newOrgName);
        await pageManager.streamsPage.gotoStreamsPage();
        await pageManager.homePage.homeURLContains(multiOrgIdentifier);
    });

    test("Reports Page default validation", async ({ page }) => {
        await pageManager.reportsPage.goToReports();
        await pageManager.homePage.homePageDefaultOrg();
        await pageManager.homePage.homePageURLValidationDefaultOrg();
        await pageManager.reportsPage.reportsURLValidation();
    });

    test("Reports Page change organisation validation", async ({ page }) => {
        multiOrgIdentifier = await pageManager.createOrgPage.createOrg(newOrgName);
        await pageManager.ingestionPage.ingestionMultiOrg(multiOrgIdentifier);
        await pageManager.homePage.homePageOrg(newOrgName);
        await pageManager.reportsPage.goToReports();
        await pageManager.homePage.homeURLContains(multiOrgIdentifier);
    });

    test("Alerts Page default validation", async ({ page }) => {
        await pageManager.commonActions.navigateToAlerts();
        await pageManager.homePage.clickDefaultOrg();
        await page.waitForTimeout(5000);
        await pageManager.homePage.homePageURLValidationDefaultOrg();
        await pageManager.alertsPage.alertsURLValidation();
    });

    test("Alerts Page change organisation validation", async ({ page }) => {
        multiOrgIdentifier = await pageManager.createOrgPage.createOrg(newOrgName);
        await pageManager.ingestionPage.ingestionMultiOrg(multiOrgIdentifier);
        await pageManager.homePage.homePageOrg(newOrgName);
        await pageManager.commonActions.navigateToAlerts();
        await pageManager.homePage.homeURLContains(multiOrgIdentifier);
    });

    test("Data sources Page default validation", async ({ page }) => {
        await pageManager.dataPage.gotoDataPage();
        await pageManager.homePage.homePageDefaultOrg();
        await pageManager.homePage.homePageURLValidationDefaultOrg();
        await pageManager.dataPage.dataURLValidation();
    });

    test("Data sources Page change organisation validation", async ({ page }) => {
        multiOrgIdentifier = await pageManager.createOrgPage.createOrg(newOrgName);
        await pageManager.ingestionPage.ingestionMultiOrg(multiOrgIdentifier);
        await pageManager.homePage.homePageOrg(newOrgName);
        await pageManager.dataPage.gotoDataPage();
        await pageManager.homePage.homeURLContains(multiOrgIdentifier);
    });

    test("IAM Page default validation", async ({ page }) => {
        await pageManager.iamPage.gotoIamPage();
        await pageManager.homePage.homePageDefaultOrg();
        await pageManager.homePage.homePageURLValidationDefaultOrg();
        await pageManager.iamPage.iamURLValidation();
    });

    test("IAM Page change organisation validation", async ({ page }) => {
        multiOrgIdentifier = await pageManager.createOrgPage.createOrg(newOrgName);
        await pageManager.ingestionPage.ingestionMultiOrg(multiOrgIdentifier);
        await pageManager.homePage.homePageOrg(newOrgName);
        await pageManager.iamPage.gotoIamPage();
        await pageManager.homePage.homeURLContains(multiOrgIdentifier);
    });

    test("Management Page default validation", async ({ page }) => {
        await pageManager.managementPage.goToManagement();
        await pageManager.homePage.homePageDefaultOrg();
        await pageManager.homePage.homePageURLValidationDefaultOrg();
        await pageManager.managementPage.managementURLValidation();
    });

    test("Management Page change organisation validation", async ({ page }) => {
        multiOrgIdentifier = await pageManager.createOrgPage.createOrg(newOrgName);
        await pageManager.ingestionPage.ingestionMultiOrg(multiOrgIdentifier);
        await pageManager.homePage.homePageOrg(newOrgName);
        await pageManager.managementPage.goToManagement();
        await pageManager.managementPage.managementURLValidation();
    });

    test("About Page default validation", async ({ page }) => {
        await pageManager.aboutPage.clickHelpMenu();
        await pageManager.aboutPage.gotoAboutPage();
        await pageManager.homePage.homePageDefaultOrg();
        await pageManager.aboutPage.aboutURLValidation();
    });

    test("About Page change organisation validation", async ({ page }) => {
        multiOrgIdentifier = await pageManager.createOrgPage.createOrg(newOrgName);
        await pageManager.ingestionPage.ingestionMultiOrg(multiOrgIdentifier);
        await pageManager.aboutPage.clickHelpMenu();
        await pageManager.aboutPage.gotoAboutPage();
        await pageManager.homePage.homePageOrg(newOrgName);
        await pageManager.homePage.homeURLContains(multiOrgIdentifier);
    });
});
