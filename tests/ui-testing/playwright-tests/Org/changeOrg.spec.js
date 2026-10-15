const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const PageManager = require('../../pages/page-manager.js');
const testLogger = require('../utils/test-logger.js');

test.describe.configure({ mode: "parallel" });

test.describe("Change Organisation", () => {
    let pm, multiOrgIdentifier;
    const timestamp = Date.now(); 
    const randomSuffix = Math.floor(Math.random() * 1000); 
    const newOrgName = `org${timestamp}${randomSuffix}`;

    test.beforeEach(async ({ page }, testInfo) => {
        // Initialize test setup
        testLogger.testStart(testInfo.title, testInfo.file);
        
        // Navigate to base URL with authentication
        await navigateToBase(page);
        pm = new PageManager(page);
        
        // Additional setup for changeOrg tests - ingestion
        await pm.ingestionPage.ingestion();
        
        testLogger.info('ChangeOrg test setup completed');
    });

    // Home Page Tests
    test("Home Page default validation", async ({ page }) => {
        testLogger.info('Testing home page default validation');
        
        await pm.changeOrgPage.validateHomePageDefault(pm);
        
        testLogger.info('Home page default validation completed');
    });

    test("Home Page change organisation validation", async ({ page }) => {
        testLogger.info('Testing home page organization change validation');
        
        multiOrgIdentifier = await pm.changeOrgPage.createOrgAndSetupIngestion(pm, newOrgName);
        await pm.changeOrgPage.validateHomePageWithOrg(pm, newOrgName, multiOrgIdentifier);
        
        testLogger.info('Home page organization change validation completed');
    });

    // Logs Page Tests
    test("Logs Page default validation", async ({ page }) => {
        testLogger.info('Testing logs page default validation');
        
        await pm.changeOrgPage.validateLogsPageDefault(pm);
        
        testLogger.info('Logs page default validation completed');
    });

    test("Logs Page change organisation validation", async ({ page }) => {
        testLogger.info('Testing logs page organization change validation');
        
        multiOrgIdentifier = await pm.changeOrgPage.createOrgAndSetupIngestion(pm, newOrgName);
        await pm.changeOrgPage.validateLogsPageWithOrg(pm, newOrgName, multiOrgIdentifier);
        
        testLogger.info('Logs page organization change validation completed');
    });

    // Metrics Page Tests
    test("Metrics Page default validation", async ({ page }) => {
        testLogger.info('Testing metrics page default validation');
        
        await pm.changeOrgPage.validateMetricsPageDefault(pm);
        
        testLogger.info('Metrics page default validation completed');
    });

    test("Metrics Page change organisation validation", async ({ page }) => {
        testLogger.info('Testing metrics page organization change validation');
        
        multiOrgIdentifier = await pm.changeOrgPage.createOrgAndSetupIngestion(pm, newOrgName);
        await pm.changeOrgPage.validateMetricsPageWithOrg(pm, newOrgName, multiOrgIdentifier);
        
        testLogger.info('Metrics page organization change validation completed');
    });

    // Traces Page Tests
    test("Traces Page default validation", async ({ page }) => {
        testLogger.info('Testing traces page default validation');
        
        await pm.changeOrgPage.validateTracesPageDefault(pm);
        
        testLogger.info('Traces page default validation completed');
    });

    test("Traces Page change organisation validation", async ({ page }) => {
        testLogger.info('Testing traces page organization change validation');
        
        multiOrgIdentifier = await pm.changeOrgPage.createOrgAndSetupIngestion(pm, newOrgName);
        await pm.changeOrgPage.validateTracesPageWithOrg(pm, newOrgName, multiOrgIdentifier);
        
        testLogger.info('Traces page organization change validation completed');
    });

    // RUM Page Tests
    test("RUM Page default validation", async ({ page }) => {
        testLogger.info('Testing RUM page default validation');
        
        await pm.changeOrgPage.validateRumPageDefault(pm);
        
        testLogger.info('RUM page default validation completed');
    });

    test("RUM Page change organisation validation", async ({ page }) => {
        testLogger.info('Testing RUM page organization change validation');
        
        multiOrgIdentifier = await pm.changeOrgPage.createOrgAndSetupIngestion(pm, newOrgName);
        await pm.changeOrgPage.validateRumPageWithOrg(pm, newOrgName, multiOrgIdentifier);
        
        testLogger.info('RUM page organization change validation completed');
    });

    // Pipelines Page Tests
    test("Pipelines Page default validation", async ({ page }) => {
        testLogger.info('Testing pipelines page default validation');
        
        await pm.changeOrgPage.validatePipelinesPageDefault(pm);
        
        testLogger.info('Pipelines page default validation completed');
    });

    test("Pipelines Page change organisation validation", async ({ page }) => {
        testLogger.info('Testing pipelines page organization change validation');
        
        multiOrgIdentifier = await pm.changeOrgPage.createOrgAndSetupIngestion(pm, newOrgName);
        await pm.changeOrgPage.validatePipelinesPageWithOrg(pm, newOrgName, multiOrgIdentifier);
        
        testLogger.info('Pipelines page organization change validation completed');
    });

    // Dashboard Page Tests
    test("Dashboard Page default validation", async ({ page }) => {
        testLogger.info('Testing dashboard page default validation');
        
        await pm.changeOrgPage.validateDashboardPageDefault(pm);
        
        testLogger.info('Dashboard page default validation completed');
    });

    test("Dashboard Page change organisation validation", async ({ page }) => {
        testLogger.info('Testing dashboard page organization change validation');
        
        multiOrgIdentifier = await pm.changeOrgPage.createOrgAndSetupIngestion(pm, newOrgName);
        await pm.changeOrgPage.validateDashboardPageWithOrg(pm, newOrgName, multiOrgIdentifier);
        
        testLogger.info('Dashboard page organization change validation completed');
    });

    // Streams Page Tests
    test("Streams Page default validation", async ({ page }) => {
        testLogger.info('Testing streams page default validation');
        
        await pm.changeOrgPage.validateStreamsPageDefault(pm);
        
        testLogger.info('Streams page default validation completed');
    });

    test("Streams Page change organisation validation", async ({ page }) => {
        testLogger.info('Testing streams page organization change validation');
        
        multiOrgIdentifier = await pm.changeOrgPage.createOrgAndSetupIngestion(pm, newOrgName);
        await pm.changeOrgPage.validateStreamsPageWithOrg(pm, newOrgName, multiOrgIdentifier);
        
        testLogger.info('Streams page organization change validation completed');
    });

    // Reports Page Tests
    test("Reports Page default validation", async ({ page }) => {
        testLogger.info('Testing reports page default validation');
        
        await pm.changeOrgPage.validateReportsPageDefault(pm);
        
        testLogger.info('Reports page default validation completed');
    });

    test("Reports Page change organisation validation", async ({ page }) => {
        testLogger.info('Testing reports page organization change validation');
        
        multiOrgIdentifier = await pm.changeOrgPage.createOrgAndSetupIngestion(pm, newOrgName);
        await pm.changeOrgPage.validateReportsPageWithOrg(pm, newOrgName, multiOrgIdentifier);
        
        testLogger.info('Reports page organization change validation completed');
    });

    // Alerts Page Tests
    test("Alerts Page default validation", async ({ page }) => {
        testLogger.info('Testing alerts page default validation');
        
        await pm.changeOrgPage.validateAlertsPageDefault(pm);
        
        testLogger.info('Alerts page default validation completed');
    });

    test("Alerts Page change organisation validation", async ({ page }) => {
        testLogger.info('Testing alerts page organization change validation');
        
        multiOrgIdentifier = await pm.changeOrgPage.createOrgAndSetupIngestion(pm, newOrgName);
        await pm.changeOrgPage.validateAlertsPageWithOrg(pm, newOrgName, multiOrgIdentifier);
        
        testLogger.info('Alerts page organization change validation completed');
    });

    // Data sources Page Tests
    test("Data sources Page default validation", async ({ page }) => {
        testLogger.info('Testing data sources page default validation');
        
        await pm.changeOrgPage.validateDataPageDefault(pm);
        
        testLogger.info('Data sources page default validation completed');
    });

    test("Data sources Page change organisation validation", async ({ page }) => {
        testLogger.info('Testing data sources page organization change validation');
        
        multiOrgIdentifier = await pm.changeOrgPage.createOrgAndSetupIngestion(pm, newOrgName);
        await pm.changeOrgPage.validateDataPageWithOrg(pm, newOrgName, multiOrgIdentifier);
        
        testLogger.info('Data sources page organization change validation completed');
    });

    // IAM Page Tests
    test("IAM Page default validation", async ({ page }) => {
        testLogger.info('Testing IAM page default validation');
        
        await pm.changeOrgPage.validateIamPageDefault(pm);
        
        testLogger.info('IAM page default validation completed');
    });

    test("IAM Page change organisation validation", async ({ page }) => {
        testLogger.info('Testing IAM page organization change validation');
        
        multiOrgIdentifier = await pm.changeOrgPage.createOrgAndSetupIngestion(pm, newOrgName);
        await pm.changeOrgPage.validateIamPageWithOrg(pm, newOrgName, multiOrgIdentifier);
        
        testLogger.info('IAM page organization change validation completed');
    });

    // Management Page Tests
    test("Management Page default validation", async ({ page }) => {
        testLogger.info('Testing management page default validation');
        
        await pm.changeOrgPage.validateManagementPageDefault(pm);
        
        testLogger.info('Management page default validation completed');
    });

    test("Management Page change organisation validation", async ({ page }) => {
        testLogger.info('Testing management page organization change validation');
        
        multiOrgIdentifier = await pm.changeOrgPage.createOrgAndSetupIngestion(pm, newOrgName);
        await pm.changeOrgPage.validateManagementPageWithOrg(pm, newOrgName, multiOrgIdentifier);
        
        testLogger.info('Management page organization change validation completed');
    });

    // About Page Tests
    test("About Page default validation", async ({ page }) => {
        testLogger.info('Testing about page default validation');
        
        await pm.changeOrgPage.validateAboutPageDefault(pm);
        
        testLogger.info('About page default validation completed');
    });

    test("About Page change organisation validation", async ({ page }) => {
        testLogger.info('Testing about page organization change validation');
        
        multiOrgIdentifier = await pm.changeOrgPage.createOrgAndSetupIngestion(pm, newOrgName);
        await pm.changeOrgPage.validateAboutPageWithOrg(pm, newOrgName, multiOrgIdentifier);
        
        testLogger.info('About page organization change validation completed');
    });
});