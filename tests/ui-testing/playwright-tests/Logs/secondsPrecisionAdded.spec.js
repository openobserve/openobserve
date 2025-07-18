// Implementation test.spec.js
import { test, expect } from "../baseFixtures.js";
import PageManager from '../../pages/page-manager.js';

import { startTimeValue, endTimeValue } from '../../pages/commonActions.js';

test('Relative Seconds on Logs page', async ({ page }) => {
  // Create page manager instance
  const pageManager = new PageManager(page);
  
  // Step 1: Navigate to the application and login
  await pageManager.loginPage.gotoLoginPage();
  await pageManager.loginPage.loginAsInternalUser();
  await pageManager.loginPage.login();
  // Step 2: Navigate to Logs Page
 // await page.waitForTimeout(4000);  // Wait for login process 
  await pageManager.logsPage.navigateToLogs();
  // Step 3: Set the time to past 30 seconds and verify
  await pageManager.logsPage.setTimeToPast30Seconds();
  await pageManager.logsPage.verifyTimeSetTo30Seconds();
  await pageManager.logsPage.signOut();
});



