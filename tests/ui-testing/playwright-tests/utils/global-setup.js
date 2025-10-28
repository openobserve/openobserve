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
    
    // Navigate to login page
    await page.goto(process.env["ZO_BASE_URL"]);
    testLogger.debug('Navigated to base URL', { url: process.env["ZO_BASE_URL"] });

    await page.waitForLoadState('domcontentloaded');

    // Debug: Log current URL and page title
    const currentUrl = page.url();
    const pageTitle = await page.title();
    testLogger.debug('Page loaded', { currentUrl, pageTitle });

    // Handle internal user login if needed
    const internalUserButton = page.getByText('Login as internal user');
    if (await internalUserButton.isVisible()) {
      await internalUserButton.click();
      testLogger.debug('Clicked internal user login button');
      await page.waitForLoadState('domcontentloaded');
    }

    // Fill login credentials
    const userIdField = page.locator('[data-cy="login-user-id"]');
    const passwordField = page.locator('[data-cy="login-password"]');
    const signInButton = page.locator('[data-cy="login-sign-in"]');

    // Debug: Check if login fields exist
    testLogger.debug('Waiting for login fields to appear...');
    try {
      await userIdField.waitFor({ state: 'visible', timeout: 10000 });
    } catch (e) {
      // Take screenshot and log page content for debugging
      await page.screenshot({ path: path.join(__dirname, 'debug-login-page.png') });
      const bodyText = await page.locator('body').textContent();
      testLogger.error('Login field not found', {
        url: page.url(),
        bodyPreview: bodyText?.substring(0, 500)
      });
      throw new Error(`Login page did not load correctly. Current URL: ${page.url()}`);
    }
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
    // Remove trailing slash from URL if present
    const baseUrl = url.endsWith('/') ? url.slice(0, -1) : url;
    const fetchResponse = await fetch(`${baseUrl}/api/${orgId}/${streamName}/_json`, {
      method: 'POST',
      headers: headers,
      body: JSON.stringify(logsdata)
    });

    // Try to parse JSON, but handle cases where response is empty or not JSON
    let data = null;
    const contentType = fetchResponse.headers.get('content-type');
    if (contentType && contentType.includes('application/json')) {
      try {
        const text = await fetchResponse.text();
        data = text ? JSON.parse(text) : null;
      } catch (e) {
        data = { error: 'Failed to parse JSON response', text: await fetchResponse.text() };
      }
    } else {
      data = { text: await fetchResponse.text() };
    }

    return {
      status: fetchResponse.status,
      data: data
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
    streamName,
    data: response.data
  });

  if (response.status !== 200) {
    testLogger.error('Data ingestion failed', {
      status: response.status,
      response: response.data,
      url: `${process.env.INGESTION_URL}/api/${orgId}/${streamName}/_json`,
      orgId,
      streamName
    });
    throw new Error(`Data ingestion failed with status: ${response.status}. Response: ${JSON.stringify(response.data)}`);
  }

  testLogger.info('Global data ingestion successful', {
    status: response.status,
    orgId,
    streamName,
    responseData: response.data
  });
}

module.exports = globalSetup;