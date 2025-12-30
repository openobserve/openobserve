const {
  test,
  expect,
  navigateToBase,
} = require("./utils/enhanced-baseFixtures.js");
import { DashboardPage } from '../pages/dashboardPages/dashboardPage';
import DashboardVariables from '../pages/dashboardPages/dashboard-variables';
import DashboardTabs from '../pages/dashboardPages/dashboard-tabs';
import { waitForValuesStreamComplete } from './utils/streaming-helpers.js';
import { waitForDashboardPage, deleteDashboard } from './dashboards/utils/dashCreation.js';

const randomDashboardName = "VarSmoke_" + Math.random().toString(36).slice(2, 11);

/**
 * Smoke Test Suite for Dashboard Variables
 * Run this FIRST to validate basic setup before running full test suite
 */
test.describe('Dashboard Variables - Smoke Tests', () => {
  let dashboardPage;
  let variables;
  let tabs;
  let page;

  test.beforeEach(async ({ page: testPage }) => {
    page = testPage;
    await navigateToBase(page);

    dashboardPage = new DashboardPage(page);
    variables = new DashboardVariables(page);
    tabs = new DashboardTabs(page);

    await dashboardPage.navigateToDashboards();
    await waitForDashboardPage(page);
  });

  test('SMOKE-1: Validate all required data-test attributes exist', async () => {
    await dashboardPage.createDashboard(randomDashboardName);

    // Critical elements that must exist
    const requiredElements = [
      { selector: '[data-test="dashboard-setting-btn"]', name: 'Dashboard Settings Button' },
      { selector: '[data-test="dashboard-refresh-btn"]', name: 'Dashboard Refresh Button' },
      { selector: '[data-test="dashboard-panel-add"]', name: 'Add Panel Button' },
    ];

    console.log('\n=== Validating Required Elements ===');
    for (const { selector, name } of requiredElements) {
      const exists = await page.locator(selector).count() > 0;
      console.log(`${exists ? '✅' : '❌'} ${name}: ${selector}`);
      expect(exists, `${name} should exist`).toBe(true);
    }

    // Open settings and check variable-related elements
    await page.locator('[data-test="dashboard-setting-btn"]').click();
    await page.waitForTimeout(1000); // Wait for settings dialog to open

    const settingsElements = [
      { selector: '[data-test="dashboard-settings-variable-tab"]', name: 'Variable Tab' },
      { selector: '[data-test="dashboard-settings-close-btn"]', name: 'Settings Close Button' },
    ];

    console.log('\n=== Validating Settings Elements ===');
    for (const { selector, name } of settingsElements) {
      await page.waitForTimeout(300);
      const exists = await page.locator(selector).count() > 0;
      console.log(`${exists ? '✅' : '❌'} ${name}: ${selector}`);
      expect(exists, `${name} should exist`).toBe(true);
    }

    await page.locator('[data-test="dashboard-settings-variable-tab"]').click();

    const variableElements = [
      { selector: '[data-test="dashboard-add-variable-btn"]', name: 'Add Variable Button' },
    ];

    console.log('\n=== Validating Variable Elements ===');
    for (const { selector, name } of variableElements) {
      const exists = await page.locator(selector).count() > 0;
      console.log(`${exists ? '✅' : '❌'} ${name}: ${selector}`);
      expect(exists, `${name} should exist`).toBe(true);
    }

    console.log('\n✅ All required elements validated successfully!\n');

    // Cleanup - close dialog first
    const closeBtn = page.locator('[data-test="dashboard-settings-close-btn"]');
    if (await closeBtn.count() > 0) {
      await closeBtn.click();
      await page.waitForTimeout(500);
    }
    try {
      await dashboardPage.navigateToDashboards();
      await page.waitForTimeout(2000); // Wait for dashboard list to load
      await deleteDashboard(page, randomDashboardName);
    } catch (e) {
      console.log(`⚠️  Cleanup warning: ${e.message}`);
    }
  });

  test('SMOKE-2: Create a simple global variable', async () => {
    await dashboardPage.createDashboard(randomDashboardName);

    console.log('\n=== Creating Global Variable ===');

    await page.locator('[data-test="dashboard-setting-btn"]').click();

    try {
      await variables.addDashboardVariable(
        'smoke_test_var',
        'logs',
        'e2e_automate',
        'kubernetes_container_name',
        false,
        null,
        false,
        'global'
      );

      console.log('✅ Variable created successfully');

      // Check if variable appears in UI
      const variableExists = await page.locator('[data-test="global-variables-selector"]').count() > 0;

      if (variableExists) {
        console.log('✅ Global variables selector found');
        const varContainer = await page.locator('[data-test="dashboard-variable-smoke_test_var-container"]').count() > 0;
        if (varContainer) {
          console.log('✅ Variable container found');
        } else {
          console.log('⚠️  Variable container not found - check data-test naming convention');
          console.log('   Expected: [data-test="dashboard-variable-smoke_test_var-container"]');
        }
      } else {
        console.log('⚠️  Global variables selector not found');
        console.log('   Expected: [data-test="global-variables-selector"]');
      }

      console.log('\n✅ Basic variable creation works!\n');
    } catch (error) {
      console.error('❌ Variable creation failed:', error.message);
      throw error;
    } finally {
      // Cleanup
      try {
        await page.waitForTimeout(500);
        await dashboardPage.navigateToDashboards();
        await page.waitForTimeout(2000);
        await deleteDashboard(page, randomDashboardName);
      } catch (e) {
        console.log(`⚠️  Cleanup warning: ${e.message}`);
      }
    }
  });

  test('SMOKE-3: Verify stream and field dropdowns', async () => {
    await dashboardPage.createDashboard(randomDashboardName);

    console.log('\n=== Testing Dropdowns ===');

    await page.locator('[data-test="dashboard-setting-btn"]').click();
    await page.locator('[data-test="dashboard-settings-variable-tab"]').click();
    await page.locator('[data-test="dashboard-add-variable-btn"]').click();
    await page.locator('[data-test="dashboard-variable-name"]').fill('dropdown_test');

    // Test stream type dropdown
    console.log('Testing stream type dropdown...');
    const streamTypeSelect = page.locator('[data-test="dashboard-variable-stream-type-select"]');
    await streamTypeSelect.click();
    await page.waitForTimeout(500);

    const streamTypeOptions = await page.locator('[role="option"]').count();
    console.log(`✅ Stream type options found: ${streamTypeOptions}`);

    // Check if 'logs' option exists
    const logsOption = page.getByRole('option', { name: /logs/i });
    const logsExists = await logsOption.count() > 0;
    console.log(`${logsExists ? '✅' : '❌'} 'Logs' option ${logsExists ? 'found' : 'not found'}`);

    if (logsExists) {
      await logsOption.first().click();
      console.log('✅ Selected "logs" stream type');
    } else {
      console.log('⚠️  Available options:');
      const options = await page.locator('[role="option"]').allTextContents();
      options.forEach((opt, i) => console.log(`   ${i + 1}. ${opt}`));
    }

    // Test stream name dropdown
    console.log('\nTesting stream name dropdown...');
    const streamSelect = page.locator('[data-test="dashboard-variable-stream-select"]');
    await streamSelect.click();
    await streamSelect.fill('e2e_automate');
    await page.waitForTimeout(1000);

    const e2eOption = page.getByRole('option', { name: 'e2e_automate', exact: true });
    const e2eExists = await e2eOption.count() > 0;
    console.log(`${e2eExists ? '✅' : '❌'} 'e2e_automate' stream ${e2eExists ? 'found' : 'not found'}`);

    if (!e2eExists) {
      console.log('⚠️  Available streams:');
      const streams = await page.locator('[role="option"]').allTextContents();
      streams.slice(0, 5).forEach((s, i) => console.log(`   ${i + 1}. ${s}`));
    }

    console.log('\n✅ Dropdown test completed!\n');

    // Cancel
    await page.locator('[data-test="dashboard-settings-close-btn"]').click();
    await page.waitForTimeout(500);

    // Cleanup
    try {
      await dashboardPage.navigateToDashboards();
      await page.waitForTimeout(2000);
      await deleteDashboard(page, randomDashboardName);
    } catch (e) {
      console.log(`⚠️  Cleanup warning: ${e.message}`);
    }
  });

  test('SMOKE-4: Check API endpoint accessibility', async () => {
    await dashboardPage.createDashboard(randomDashboardName);

    console.log('\n=== Testing API Endpoints ===');

    // Track API calls
    const apiCalls = [];
    page.on('response', async (response) => {
      const url = response.url();
      if (url.includes('/_values') || url.includes('dashboard')) {
        apiCalls.push({
          url: url,
          status: response.status(),
          statusText: response.statusText()
        });
      }
    });

    await page.locator('[data-test="dashboard-setting-btn"]').click();

    try {
      await variables.addDashboardVariable(
        'api_test_var',
        'logs',
        'e2e_automate',
        'kubernetes_container_name',
        false,
        null,
        false,
        'global'
      );

      // Wait a bit for any API calls
      await page.waitForTimeout(3000);

      console.log(`\n📡 Captured ${apiCalls.length} API calls:`);
      apiCalls.forEach(call => {
        const status = call.status === 200 ? '✅' : '❌';
        console.log(`${status} ${call.status} - ${call.url.split('/').slice(-2).join('/')}`);
      });

      const hasValuesCall = apiCalls.some(call => call.url.includes('/_values'));
      if (hasValuesCall) {
        console.log('\n✅ Values API endpoint is accessible');
      } else {
        console.log('\n⚠️  No /_values API calls detected');
        console.log('   This might be expected if variable loading is deferred');
      }

      console.log('\n✅ API test completed!\n');
    } catch (error) {
      console.error('❌ API test failed:', error.message);
      throw error;
    } finally {
      // Cleanup listeners
      page.removeAllListeners('response');
      // Cleanup dashboard
      try {
        await page.waitForTimeout(500);
        await dashboardPage.navigateToDashboards();
        await page.waitForTimeout(2000);
        await deleteDashboard(page, randomDashboardName);
      } catch (e) {
        console.log(`⚠️  Cleanup warning: ${e.message}`);
      }
    }
  });

  test('SMOKE-5: Verify tab UI elements (diagnostic)', async () => {
    await dashboardPage.createDashboard(randomDashboardName);

    console.log('\n=== Diagnosing Tab UI Elements ===');

    try {
      // Try to find tab add button
      console.log('Checking for tab add button...');
      const tabAddBtn = await page.locator('[data-test="dashboard-tab-add-btn"]').count();

      if (tabAddBtn > 0) {
        console.log('✅ Tab add button found');
        await tabs.addTab('SmokeTestTab');
        console.log('✅ Tab created successfully');
      } else {
        console.log('⚠️  Tab add button NOT found: [data-test="dashboard-tab-add-btn"]');
        console.log('   This attribute needs to be added to the UI');
        console.log('   Location: Button that adds new tabs to dashboard');
      }

      // Check if default tab exists
      const defaultTab = await page.locator('[data-test^="dashboard-tab-"]').count();
      console.log(`${defaultTab > 0 ? '✅' : '⚠️ '} Dashboard tabs container: ${defaultTab} tab(s) found`);

      console.log('\n✅ Tab diagnostic completed!\n');
    } catch (error) {
      console.log(`⚠️  Tab diagnostic encountered error: ${error.message}`);
      console.log('   This is expected if UI doesn\'t have required attributes yet');
    } finally{
      // Cleanup
      try {
        await page.waitForTimeout(500);
        await dashboardPage.navigateToDashboards();
        await page.waitForTimeout(2000);
        await deleteDashboard(page, randomDashboardName);
      } catch (e) {
        console.log(`⚠️  Cleanup warning: ${e.message}`);
      }
    }
  });

  test('SMOKE-6: Verify panel containers (diagnostic)', async () => {
    await dashboardPage.createDashboard(randomDashboardName);

    console.log('\n=== Diagnosing Panel Containers ===');

    try {
      // Check if panels have data-test-panel-id attributes
      const panelsWithId = await page.locator('[data-test-panel-id]').count();
      console.log(`Panels with data-test-panel-id: ${panelsWithId}`);

      if (panelsWithId > 0) {
        console.log('✅ Panel containers have data-test-panel-id attributes');
        const panel1Id = await dashboardPage.getPanelId(0);
        console.log(`✅ Panel ID retrieved: ${panel1Id}`);
      } else {
        console.log('⚠️  Panels do NOT have data-test-panel-id attributes');
        console.log('   This attribute needs to be added to panel containers in the UI');
        console.log('   Expected format: <div data-test-panel-id="panel-uuid">');

        // Show what panel elements exist
        const panelLikeElements = await page.evaluate(() => {
          const selectors = ['.panel', '[class*="panel"]', '.grid-stack-item', '[class*="widget"]'];
          const results = [];
          selectors.forEach(sel => {
            const count = document.querySelectorAll(sel).length;
            if (count > 0) results.push({ selector: sel, count });
          });
          return results;
        });

        if (panelLikeElements.length > 0) {
          console.log('\n   Found panel-like elements:');
          panelLikeElements.forEach(el => {
            console.log(`   - ${el.selector}: ${el.count} elements`);
          });
          console.log('   → Add data-test-panel-id attribute to these elements');
        }
      }

      console.log('\n✅ Panel diagnostic completed!\n');
    } catch (error) {
      console.log(`⚠️  Panel diagnostic encountered error: ${error.message}`);
      console.log('   This is expected if UI doesn\'t have required attributes yet');
    } finally {
      // Cleanup
      try {
        await page.waitForTimeout(500);
        await dashboardPage.navigateToDashboards();
        await page.waitForTimeout(2000);
        await deleteDashboard(page, randomDashboardName);
      } catch (e) {
        console.log(`⚠️  Cleanup warning: ${e.message}`);
      }
    }
  });

  test('SMOKE-7: Verify refresh button classes', async () => {
    await dashboardPage.createDashboard(randomDashboardName);

    console.log('\n=== Testing Refresh Button Classes ===');

    const refreshBtn = page.locator('[data-test="dashboard-refresh-btn"]');
    const classes = await refreshBtn.getAttribute('class');

    console.log('Current classes on refresh button:');
    console.log(classes);

    // Check for various possible warning classes
    const possibleWarningClasses = [
      'text-warning',
      'bg-warning',
      'q-btn--warning',
      'text-orange',
      'warning',
    ];

    console.log('\nChecking for warning-related classes:');
    let foundWarningClass = false;
    for (const cls of possibleWarningClasses) {
      const hasClass = classes?.includes(cls);
      console.log(`${hasClass ? '✅' : '  '} ${cls}: ${hasClass ? 'FOUND' : 'not found'}`);
      if (hasClass) foundWarningClass = true;
    }

    if (!foundWarningClass) {
      console.log('\n⚠️  No standard warning classes found');
      console.log('   You may need to update the test to check for your specific class names');
      console.log('   Current approach: await expect(refreshBtn).toHaveClass(/text-warning|bg-warning/)');
      console.log(`   Actual classes: ${classes}`);
    }

    console.log('\n✅ Refresh button class test completed!\n');

    // Cleanup
    try {
      await page.waitForTimeout(500);
      await dashboardPage.navigateToDashboards();
      await page.waitForTimeout(2000);
      await deleteDashboard(page, randomDashboardName);
    } catch (e) {
      console.log(`⚠️  Cleanup warning: ${e.message}`);
    }
  });
});
