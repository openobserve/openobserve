const { chromium } = require('playwright');
const dotenv = require('dotenv');
const path = require('path');
dotenv.config({ path: '../.env' });

const BASE_URL = process.env.ZO_BASE_URL;
const USER = process.env.ZO_ROOT_USER_EMAIL;
const PASS = process.env.ZO_ROOT_USER_PASSWORD;
const DASHBOARD_PATH = path.resolve('./poc-test-results-dashboard.json');

async function importDashboardViaUI() {
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    console.log('🚀 Starting dashboard import via UI...');
    console.log('📊 Dashboard file:', DASHBOARD_PATH);
    console.log('🌐 URL:', BASE_URL);

    // Navigate to the base URL (same as existing tests)
    console.log('🔐 Logging in...');
    await page.goto(BASE_URL, { waitUntil: "networkidle" });
    
    // Check if "Login as internal user" is visible and click it
    if (await page.getByText('Login as internal user').isVisible()) {
      await page.getByText('Login as internal user').click();
    }
    
    // Wait for login form and fill credentials
    await page.waitForSelector('[data-test="login-user-id"]', { timeout: 10000 });
    await page.locator('[data-test="login-user-id"]').fill(USER);
    
    const waitForLogin = page.waitForResponse(
      (response) =>
        response.url().includes("/auth/login") && response.status() === 200
    );
    
    await page.locator('[data-test="login-password"]').fill(PASS);
    await page.locator('[data-cy="login-sign-in"]').click();
    
    await waitForLogin;
    
    // Wait for redirect to web interface
    await page.waitForURL(BASE_URL + "/web/", {
      waitUntil: "networkidle",
    });
    
    // Select organization
    await page.locator('[data-test="navbar-organizations-select"]')
      .getByText("arrow_drop_down")
      .click();
    await page.getByRole("option", { name: "default", exact: true }).click();
    
    await page.waitForTimeout(2000);

    // Navigate to dashboards
    console.log('📋 Navigating to dashboards...');
    await page.locator('[data-test="menu-link-\\/dashboards-item"]').click();
    await page.waitForTimeout(2000);

    // Click import button
    console.log('📥 Clicking import button...');
    await page.locator('[data-test="dashboard-import"]').click();
    await page.waitForTimeout(1000);

    // Upload the dashboard file
    console.log('📁 Uploading dashboard file...');
    const fileInput = page.locator('input[type="file"]');
    await fileInput.setInputFiles(DASHBOARD_PATH);
    await page.waitForTimeout(2000);

    // Click import
    console.log('✅ Clicking import...');
    await page.getByRole("button", { name: "Import" }).click();
    await page.waitForTimeout(3000);

    // Check if import was successful
    const dashboardTitle = await page.locator('text="POC Test Status Pie Chart"');
    if (await dashboardTitle.isVisible()) {
      console.log('🎉 Dashboard imported successfully!');
      console.log(`📊 You can view it at: ${BASE_URL}/default/dashboards`);
    } else {
      console.log('❌ Dashboard import may have failed');
    }

    await page.waitForTimeout(5000); // Keep browser open for 5 seconds to see the result

  } catch (error) {
    console.error('❌ Error during import:', error);
  } finally {
    await browser.close();
  }
}

importDashboardViaUI(); 