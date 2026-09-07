const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const PageManager = require('../../pages/page-manager.js');
const logData = require('../../fixtures/log.json');
const { getOrgIdentifier } = require('../utils/cloud-auth.js');

const FIVE_MINUTES_MS = 300000;

// True when an alert/anomaly name appears in a folder's alert list. The v2 list
// API can expose the name at the top level or nested under `alert`.
const isNamed = (list, name) =>
    (Array.isArray(list) ? list : []).some((a) => a?.name === name || a?.alert?.name === name);

test.describe("Alerts & SLO Folder-scoped Creation", () => {
    test.describe.configure({ mode: 'parallel' });
    let pm;
    let testStreamName;

    test.beforeEach(async ({ page }, testInfo) => {
        testLogger.testStart(testInfo.title, testInfo.file);
        await navigateToBase(page);
        pm = new PageManager(page);

        // Unique per-test logs stream, created before navigation so the SPA's
        // stream-list fetch (alert wizard / import validation) already sees it.
        testStreamName = `alert_folder_creation_${pm.alertsPage.generateRandomString().toLowerCase()}`;
        await pm.commonActions.initializeAlertTestStream(testStreamName);

        await page.goto(`${logData.alertUrl}?org_identifier=${getOrgIdentifier()}`);
        await page.reload();
        await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
        testLogger.info('Test setup completed', { streamName: testStreamName });
    });

    test('should import alerts into a chosen folder', {
        tag: ['@alerts-folder-creation', '@alerts', '@all', '@P0', '@smoke'],
        timeout: FIVE_MINUTES_MS
    }, async ({ page }) => {
        test.slow();
        const randomValue = pm.alertsPage.generateRandomString().toLowerCase();
        const infra = await pm.alertsPage.ensureValidationInfrastructure(pm, randomValue);

        const folderName = `auto_${randomValue}`;
        await pm.alertsPage.createFolder(folderName, 'Folder-scoped import test');
        const folderId = await pm.alertsPage.resolveAlertFolderId(folderName);
        testLogger.info('Resolved target folder', { folderName, folderId });

        // Produce an exportable alert inside the target folder, then delete it so
        // the imported copy is unambiguous and its landing folder is under test.
        await pm.alertsPage.navigateToFolder(folderName);
        const alertName = await pm.alertsPage.createAlert(
            testStreamName, 'city', 'bangalore', infra.destinationName, randomValue
        );
        await pm.alertsPage.verifyAlertCreated(alertName);

        const download = await pm.alertsPage.exportAlerts();
        const downloadPath = `./alerts-folder-import-${randomValue}.json`;
        await download.saveAs(downloadPath);

        await pm.alertsPage.deleteAlertByRow(alertName);
        await page.waitForLoadState('domcontentloaded', { timeout: 10000 }).catch(() => {});

        // Import into the chosen (non-default) folder.
        await pm.alertsPage.importAlertsIntoFolder(downloadPath, folderName, alertName);

        // Folder-scoping oracle: listed under the chosen folder, absent from default.
        await expect.poll(async () => {
            const list = await pm.apiCleanup.fetchAlertsInFolder(folderId);
            return isNamed(list, alertName);
        }, { timeout: 30000, intervals: [2000, 3000, 5000] }).toBe(true);
        expect(isNamed(await pm.apiCleanup.fetchAlertsInFolder('default'), alertName)).toBe(false);

        await pm.alertsPage.deleteImportedAlert(alertName);
        await pm.alertsPage.cleanupDownloadedFile(downloadPath);
        await pm.alertsPage.deleteFolder(folderName);
        testLogger.info('Import-into-folder test completed', { folderName, alertName });
    });

    test('should create a regular alert in a chosen folder', {
        tag: ['@alerts-folder-creation', '@alerts', '@all', '@P0', '@smoke'],
        timeout: FIVE_MINUTES_MS
    }, async ({ page }) => {
        test.slow();
        const randomValue = pm.alertsPage.generateRandomString().toLowerCase();
        const infra = await pm.alertsPage.ensureValidationInfrastructure(pm, randomValue);

        const folderName = `auto_${randomValue}`;
        await pm.alertsPage.createFolder(folderName, 'Folder-scoped create test');
        const folderId = await pm.alertsPage.resolveAlertFolderId(folderName);

        // Creating while the list is scoped to the chosen folder routes the new alert there.
        await pm.alertsPage.navigateToFolder(folderName);
        const alertName = await pm.alertsPage.createAlert(
            testStreamName, 'city', 'bangalore', infra.destinationName, randomValue
        );
        await pm.alertsPage.verifyAlertCreated(alertName);

        await expect.poll(async () => {
            const list = await pm.apiCleanup.fetchAlertsInFolder(folderId);
            return isNamed(list, alertName);
        }, { timeout: 30000, intervals: [2000, 3000, 5000] }).toBe(true);
        expect(isNamed(await pm.apiCleanup.fetchAlertsInFolder('default'), alertName)).toBe(false);

        await pm.alertsPage.deleteAlertByRow(alertName);
        await pm.alertsPage.deleteFolder(folderName);
        testLogger.info('Regular-alert-folder test completed', { folderName, alertName });
    });

    test('should create an anomaly config in a chosen folder', {
        tag: ['@alerts-folder-creation', '@alerts', '@anomaly', '@all', '@P1'],
        timeout: FIVE_MINUTES_MS
    }, async ({ page }) => {
        test.slow();
        const randomValue = pm.alertsPage.generateRandomString().toLowerCase();
        const anomalyName = `Anomaly_${randomValue}`;

        // A destination is required so the Add alert/anomaly button is enabled.
        await pm.alertsPage.ensureValidationInfrastructure(pm, randomValue);

        const folderName = `auto_${randomValue}`;
        await pm.alertsPage.createFolder(folderName, 'Folder-scoped anomaly test');
        const folderId = await pm.alertsPage.resolveAlertFolderId(folderName);

        // Enter the anomaly tab, then explicitly choose the folder in the inline
        // picker before saving — the regression under test is the create request
        // silently dropping this folder and writing into `default`.
        await pm.anomalyDetectionPage.navigateToAnomalyTab();
        await pm.anomalyDetectionPage.clickAddAnomaly();
        await pm.alertsPage.selectAlertFormFolder(folderName);

        await pm.anomalyDetectionPage.fillBasicSetup(anomalyName, 'logs', testStreamName);
        await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
        await pm.anomalyDetectionPage.clickTab('Detection Config');
        await pm.anomalyDetectionPage.setDetectionResolution(5, 'm');
        await pm.anomalyDetectionPage.setCheckEvery(10, 'm');
        await pm.anomalyDetectionPage.setLookBackWindow(30, 'm');
        await pm.anomalyDetectionPage.setTrainingWindow(1);
        await pm.anomalyDetectionPage.disableAlerting();
        await pm.anomalyDetectionPage.clickSave();

        await pm.anomalyDetectionPage.expectAnomalyInList(anomalyName);

        await expect.poll(async () => {
            const list = await pm.apiCleanup.fetchAlertsInFolder(folderId);
            return isNamed(list, anomalyName);
        }, { timeout: 30000, intervals: [2000, 3000, 5000] }).toBe(true);
        expect(isNamed(await pm.apiCleanup.fetchAlertsInFolder('default'), anomalyName)).toBe(false);

        await pm.alertsPage.deleteAlertByRow(anomalyName);
        await pm.alertsPage.deleteFolder(folderName);
        testLogger.info('Anomaly-folder test completed', { folderName, anomalyName });
    });

    test('should default to the default folder when no folder is selected', {
        tag: ['@alerts-folder-creation', '@alerts', '@all', '@P2'],
        timeout: FIVE_MINUTES_MS
    }, async ({ page }) => {
        test.slow();
        const randomValue = pm.alertsPage.generateRandomString().toLowerCase();
        const infra = await pm.alertsPage.ensureValidationInfrastructure(pm, randomValue);

        // No folder is picked anywhere — creation must fall back to "default".
        const alertName = await pm.alertsPage.createAlert(
            testStreamName, 'city', 'bangalore', infra.destinationName, randomValue
        );
        await pm.alertsPage.verifyAlertCreated(alertName);

        await expect.poll(async () => {
            const list = await pm.apiCleanup.fetchAlertsInFolder('default');
            return isNamed(list, alertName);
        }, { timeout: 30000, intervals: [2000, 3000, 5000] }).toBe(true);

        await pm.alertsPage.deleteAlertByRow(alertName);
        testLogger.info('Default-folder test completed', { alertName });
    });
});
