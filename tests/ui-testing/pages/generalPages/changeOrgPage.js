const { expect } = require('@playwright/test');

class ChangeOrgPage {
    constructor(page) {
        this.page = page;
    }

    // Home Page Methods
    async validateHomePageDefault(pageManager) {
        await this.page.waitForLoadState('domcontentloaded');
        await this.page.reload();
        await this.page.waitForLoadState('networkidle');
        await pageManager.homePage.homePageValidation();
        await pageManager.homePage.gotoHomePage();
        await pageManager.homePage.homePageValidation();
        await pageManager.homePage.homePageDefaultOrg();
        await pageManager.homePage.homePageURLValidationDefaultOrg();
    }

    async validateHomePageWithOrg(pageManager, newOrgName, multiOrgIdentifier) {
        await pageManager.homePage.homePageOrg(newOrgName);
        await pageManager.homePage.homePageValidation();
        await pageManager.homePage.homePageURLValidation(newOrgName);
        await pageManager.homePage.gotoHomePage();
        await pageManager.homePage.homePageValidation();
        await pageManager.homePage.homePageURLValidation(newOrgName);
        await pageManager.homePage.homeURLContains(multiOrgIdentifier);
    }

    // Logs Page Methods
    async validateLogsPageDefault(pageManager) {
        await pageManager.logsPage.navigateToLogs();
        await pageManager.logsPage.validateLogsPage();
        await pageManager.homePage.homePageDefaultOrg();
        await pageManager.homePage.homePageURLValidationDefaultOrg();
    }

    async validateLogsPageWithOrg(pageManager, newOrgName, multiOrgIdentifier) {
        await pageManager.homePage.homePageOrg(newOrgName);
        await pageManager.logsPage.navigateToLogs(multiOrgIdentifier);
        await pageManager.homePage.homeURLContains(multiOrgIdentifier);
    }

    // Metrics Page Methods
    async validateMetricsPageDefault(pageManager) {
        await pageManager.metricsPage.gotoMetricsPage();
        await pageManager.homePage.homePageDefaultOrg();
        await pageManager.homePage.homePageURLValidationDefaultOrg();
        await pageManager.metricsPage.metricsPageValidation();
        await pageManager.metricsPage.metricsURLValidation();
    }

    async validateMetricsPageWithOrg(pageManager, newOrgName, multiOrgIdentifier) {
        await pageManager.homePage.homePageOrg(newOrgName);
        await pageManager.metricsPage.gotoMetricsPage();
        await pageManager.homePage.homeURLContains(multiOrgIdentifier);
    }

    // Traces Page Methods
    async validateTracesPageDefault(pageManager) {
        await pageManager.tracesPage.navigateToTraces();
        await pageManager.tracesPage.tracesPageDefaultOrg();
        await pageManager.homePage.homePageURLValidationDefaultOrg();
        await pageManager.tracesPage.validateTracesPage();
        await pageManager.tracesPage.tracesURLValidation();
    }

    async validateTracesPageWithOrg(pageManager, newOrgName, multiOrgIdentifier) {
        await pageManager.homePage.homePageOrg(newOrgName);
        await pageManager.tracesPage.navigateToTraces();
        await pageManager.homePage.homeURLContains(multiOrgIdentifier);
    }

    // RUM Page Methods
    async validateRumPageDefault(pageManager) {
        await pageManager.rumPage.gotoRumPage();
        await pageManager.homePage.homePageDefaultOrg();
        await pageManager.homePage.homePageURLValidationDefaultOrg();
        await pageManager.rumPage.rumURLValidation();
    }

    async validateRumPageWithOrg(pageManager, newOrgName, multiOrgIdentifier) {
        await pageManager.homePage.homePageOrg(newOrgName);
        await pageManager.rumPage.gotoRumPage();
        await pageManager.homePage.homeURLContains(multiOrgIdentifier);
    }

    // Pipelines Page Methods
    async validatePipelinesPageDefault(pageManager) {
        await pageManager.pipelinesPage.gotoPipelinesPage();
        await pageManager.homePage.homePageDefaultOrg();
        await pageManager.homePage.homePageURLValidationDefaultOrg();
        await pageManager.pipelinesPage.pipelinesURLValidation();
    }

    async validatePipelinesPageWithOrg(pageManager, newOrgName, multiOrgIdentifier) {
        await pageManager.homePage.homePageOrg(newOrgName);
        await pageManager.pipelinesPage.gotoPipelinesPage();
        await pageManager.homePage.homeURLContains(multiOrgIdentifier);
    }

    // Dashboard Page Methods
    async validateDashboardPageDefault(pageManager) {
        await pageManager.dashboardPage.navigateToDashboards();
        await pageManager.homePage.clickDefaultOrg();
        await pageManager.homePage.homePageURLValidationDefaultOrg();
        await pageManager.dashboardPage.dashboardURLValidation();
    }

    async validateDashboardPageWithOrg(pageManager, newOrgName, multiOrgIdentifier) {
        await pageManager.homePage.homePageOrg(newOrgName);
        await pageManager.dashboardPage.navigateToDashboards();
        await pageManager.homePage.homeURLContains(multiOrgIdentifier);
    }

    // Streams Page Methods
    async validateStreamsPageDefault(pageManager) {
        await pageManager.streamsPage.gotoStreamsPage();
        await pageManager.streamsPage.streamsPageDefaultOrg();
        await pageManager.homePage.homePageURLValidationDefaultOrg();
        await pageManager.streamsPage.streamsURLValidation();
    }

    async validateStreamsPageWithOrg(pageManager, newOrgName, multiOrgIdentifier) {
        await pageManager.homePage.homePageOrg(newOrgName);
        await pageManager.streamsPage.gotoStreamsPage();
        await pageManager.homePage.homeURLContains(multiOrgIdentifier);
    }

    // Reports Page Methods
    async validateReportsPageDefault(pageManager) {
        await pageManager.reportsPage.goToReports();
        await pageManager.homePage.homePageDefaultOrg();
        await pageManager.homePage.homePageURLValidationDefaultOrg();
        await pageManager.reportsPage.reportsURLValidation();
    }

    async validateReportsPageWithOrg(pageManager, newOrgName, multiOrgIdentifier) {
        await pageManager.homePage.homePageOrg(newOrgName);
        await pageManager.reportsPage.goToReports();
        await pageManager.homePage.homeURLContains(multiOrgIdentifier);
    }

    // Alerts Page Methods
    async validateAlertsPageDefault(pageManager) {
        await pageManager.commonActions.navigateToAlerts();
        await pageManager.homePage.clickDefaultOrg();
        await this.page.waitForLoadState('networkidle');
        await pageManager.homePage.homePageURLValidationDefaultOrg();
        await pageManager.alertsPage.alertsURLValidation();
    }

    async validateAlertsPageWithOrg(pageManager, newOrgName, multiOrgIdentifier) {
        await pageManager.homePage.homePageOrg(newOrgName);
        await pageManager.commonActions.navigateToAlerts();
        await pageManager.homePage.homeURLContains(multiOrgIdentifier);
    }

    // Data sources Page Methods
    async validateDataPageDefault(pageManager) {
        await pageManager.dataPage.gotoDataPage();
        await pageManager.homePage.homePageDefaultOrg();
        await pageManager.homePage.homePageURLValidationDefaultOrg();
        await pageManager.dataPage.dataURLValidation();
    }

    async validateDataPageWithOrg(pageManager, newOrgName, multiOrgIdentifier) {
        await pageManager.homePage.homePageOrg(newOrgName);
        await pageManager.dataPage.gotoDataPage();
        await pageManager.homePage.homeURLContains(multiOrgIdentifier);
    }

    // IAM Page Methods
    async validateIamPageDefault(pageManager) {
        await pageManager.iamPage.gotoIamPage();
        await pageManager.homePage.homePageDefaultOrg();
        await pageManager.homePage.homePageURLValidationDefaultOrg();
        await pageManager.iamPage.iamURLValidation();
    }

    async validateIamPageWithOrg(pageManager, newOrgName, multiOrgIdentifier) {
        await pageManager.homePage.homePageOrg(newOrgName);
        await pageManager.iamPage.gotoIamPage();
        await pageManager.homePage.homeURLContains(multiOrgIdentifier);
    }

    // Management Page Methods
    async validateManagementPageDefault(pageManager) {
        await pageManager.managementPage.goToManagement();
        await pageManager.homePage.homePageDefaultOrg();
        await pageManager.homePage.homePageURLValidationDefaultOrg();
        await pageManager.managementPage.managementURLValidation();
    }

    async validateManagementPageWithOrg(pageManager, newOrgName, multiOrgIdentifier) {
        await pageManager.homePage.homePageOrg(newOrgName);
        await pageManager.managementPage.goToManagement();
        await pageManager.managementPage.managementURLValidation();
    }

    // About Page Methods
    async validateAboutPageDefault(pageManager) {
        await pageManager.aboutPage.clickHelpMenu();
        await pageManager.aboutPage.gotoAboutPage();
        await pageManager.homePage.homePageDefaultOrg();
        await pageManager.aboutPage.aboutURLValidation();
    }

    async validateAboutPageWithOrg(pageManager, newOrgName, multiOrgIdentifier) {
        await pageManager.aboutPage.clickHelpMenu();
        await pageManager.aboutPage.gotoAboutPage();
        await pageManager.homePage.homePageOrg(newOrgName);
        await pageManager.homePage.homeURLContains(multiOrgIdentifier);
    }

    // Helper method to create org and setup ingestion
    async createOrgAndSetupIngestion(pageManager, orgName) {
        const multiOrgIdentifier = await pageManager.createOrgPage.createOrg(orgName);
        await pageManager.ingestionPage.ingestionMultiOrg(multiOrgIdentifier);
        return multiOrgIdentifier;
    }
}

module.exports = { ChangeOrgPage };