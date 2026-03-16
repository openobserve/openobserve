const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const PageManager = require('../../pages/page-manager.js');
const { LogoManagementPage } = require('../../pages/generalPages/logoManagementPage.js');
const path = require('path');

// Function to generate a random 5-character alphabetic name
function generateRandomLogoName() {
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
    let randomName = '';
    for (let i = 0; i < 5; i++) {
        randomName += alphabet.charAt(Math.floor(Math.random() * alphabet.length));
    }
    return randomName;
}


test('Logo Upload on Management', { tag: '@enterprise' }, async ({ page }) => {
    testLogger.testStart('Logo Upload on Management', __filename);
    await navigateToBase(page);

    const pm = new PageManager(page);
    const logoManagementPage = new LogoManagementPage(page);

    const filePath = path.resolve(__dirname, '../attachment/imagesAuto.png');
    const logoName = generateRandomLogoName();
    testLogger.info(`Generated logo name: ${logoName}`);

    // Ingest test data
    await pm.ingestionPage.ingestion();

    await page.waitForTimeout(10000);

    // Perform a hard refresh
    await page.reload({ ignoreCache: true });

    await page.waitForTimeout(10000);

    // Navigate to _meta Organization Page
    await logoManagementPage.managementOrg('_meta');

    await logoManagementPage.navigateToManagement();

    await page.goto(process.env["ZO_BASE_URL"] + "/web/settings/general?org_identifier=_meta");

    await logoManagementPage.clickSaveSubmit();

    await logoManagementPage.updateCustomLogoText(logoName);

    testLogger.info(`Uploading light mode logo from path: ${filePath}`);
    await logoManagementPage.uploadLogo(filePath);

    await page.waitForTimeout(5000);

    // Upload dark mode logo
    testLogger.info(`Uploading dark mode logo from path: ${filePath}`);
    await logoManagementPage.uploadLogoDarkMode(filePath);

    await page.waitForTimeout(5000);

    testLogger.info('Logo upload test completed successfully');
});
