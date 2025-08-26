const { chromium } = require('@playwright/test');
const path = require('path');
const fs = require('fs');
const logsdata = require("../../../test-data/logs_data.json");
const testLogger = require('./test-logger.js');

/**
 * Global setup for all tests - handles authentication and test data ingestion
 * This runs once before all tests start
 */
async function globalSetup() {
  testLogger.info('Starting global setup for all tests');
  
  // Create auth storage directory
  const authDir = path.join(__dirname, 'auth');
  if (!fs.existsSync(authDir)) {
    fs.mkdirSync(authDir, { recursive: true });
  }
  const authFile = path.join(authDir, 'user.json');
  
  // Launch browser and create context
  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: { width: 1500, height: 1024 }
  });
  const page = await context.newPage();
  
  try {
    testLogger.info('Performing global login authentication');
    console.log(`🔍 [CI DEBUG] Global setup: Starting login process`);
    console.log(`🔍 [CI DEBUG] Global setup: Environment CI=${process.env.CI}`);
    
    // Navigate to login page
    console.log(`🔍 [CI DEBUG] Global setup: Navigating to base URL: ${process.env["ZO_BASE_URL"]}`);
    await page.goto(process.env["ZO_BASE_URL"]);
    testLogger.debug('Navigated to base URL', { url: process.env["ZO_BASE_URL"] });
    
    await page.waitForLoadState('domcontentloaded');
    console.log(`🔍 [CI DEBUG] Global setup: Current URL after navigation: ${page.url()}`);
    
    // Handle internal user login if needed
    const internalUserButton = page.getByText('Login as internal user');
    if (await internalUserButton.isVisible()) {
      await internalUserButton.click();
      testLogger.debug('Clicked internal user login button');
    }
    
    await page.waitForLoadState('domcontentloaded');

    // Fill login credentials
    const userIdField = page.locator('[data-cy="login-user-id"]');
    const passwordField = page.locator('[data-cy="login-password"]');
    const signInButton = page.locator('[data-cy="login-sign-in"]');
    
    await userIdField.waitFor({ state: 'visible' });
    await userIdField.fill(process.env["ZO_ROOT_USER_EMAIL"]);
    
    await passwordField.waitFor({ state: 'visible' });
    await passwordField.fill(process.env["ZO_ROOT_USER_PASSWORD"]);
    
    await signInButton.waitFor({ state: 'visible' });
    await signInButton.click();
    
    testLogger.debug('Login credentials submitted');
    
    // Wait for login to complete - look for navigation or success indicators
    await page.waitForLoadState('networkidle', { timeout: 15000 });
    
    // Verify login success by checking for a known element
    await page.locator('[data-test="menu-link-\\/-item"]').waitFor({ 
      state: 'visible', 
      timeout: 10000 
    });
    
    testLogger.info('Global login authentication successful');
    
    // Save authentication state
    await context.storageState({ path: authFile });
    testLogger.info('Authentication state saved successfully', { authFile });
    
    // Perform global test data ingestion
    testLogger.info('Starting global test data ingestion');
    await performGlobalIngestion(page);
    testLogger.info('Global test data ingestion completed');
    
  } catch (error) {
    testLogger.error('Global setup failed', { error: error.message, stack: error.stack });
    throw error;
  } finally {
    await context.close();
    await browser.close();
    testLogger.debug('Browser closed after global setup');
  }
  
  testLogger.info('Global setup completed successfully - ready for test execution');
}

/**
 * Performs global test data ingestion
 * @param {import('@playwright/test').Page} page 
 */
async function performGlobalIngestion(page) {
  const orgId = process.env["ORGNAME"];
  const streamName = "e2e_automate";
  const basicAuthCredentials = Buffer.from(
    `${process.env["ZO_ROOT_USER_EMAIL"]}:${process.env["ZO_ROOT_USER_PASSWORD"]}`
  ).toString('base64');

  const headers = {
    "Authorization": `Basic ${basicAuthCredentials}`,
    "Content-Type": "application/json",
  };

  const response = await page.evaluate(async ({ url, headers, orgId, streamName, logsdata }) => {
    const fetchResponse = await fetch(`${url}/api/${orgId}/${streamName}/_json`, {
      method: 'POST',
      headers: headers,
      body: JSON.stringify(logsdata)
    });
    return {
      status: fetchResponse.status,
      data: await fetchResponse.json()
    };
  }, {
    url: process.env.INGESTION_URL,
    headers: headers,
    orgId: orgId,
    streamName: streamName,
    logsdata: logsdata
  });
  
  testLogger.debug('Data ingestion API response received', { 
    status: response.status, 
    orgId, 
    streamName 
  });
  
  if (response.status !== 200) {
    testLogger.error('Data ingestion failed', { 
      status: response.status, 
      response: response.data 
    });
    throw new Error(`Data ingestion failed with status: ${response.status}`);
  }
  
  testLogger.info('Global data ingestion successful', { 
    status: response.status, 
    orgId, 
    streamName 
  });
}

module.exports = globalSetup;