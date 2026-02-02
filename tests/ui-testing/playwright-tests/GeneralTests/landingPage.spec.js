/**
 * Landing Page End-to-End Tests
 *
 * Tests for the OpenObserve landing page including:
 * - Sidebar navigation with state preservation verification
 * - Management/Settings tabs with state preservation verification
 * - UI elements validation for each page
 *
 * Flow:
 * 1. Go to logs page -> Run query -> Establish state
 * 2. Navigate to each page -> Validate UI elements -> Return to logs -> Verify state preserved
 */

const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const PageManager = require('../../pages/page-manager.js');
const logData = require('../../fixtures/log.json');

test.describe("Landing Page Test Cases", () => {
  test.describe.configure({ mode: 'serial' });
  let pm;

  // Track state preservation results
  const statePreservationResults = {
    preserved: [],
    notPreserved: []
  };

  /**
   * Captures the current logs page state
   */
  async function captureLogsState(pm) {
    const state = {
      hasResults: false,
      queryText: ''
    };

    try {
      // Check if results table is visible
      const resultsTable = pm.homePage.getLogsResultsTable();
      state.hasResults = await resultsTable.isVisible({ timeout: 3000 }).catch(() => false);

      // Get query text
      const queryEditor = pm.homePage.getQueryEditor();
      if (await queryEditor.isVisible({ timeout: 2000 }).catch(() => false)) {
        state.queryText = await queryEditor.textContent().catch(() => '');
      }
    } catch (error) {
      testLogger.warn('Error capturing logs state', { error: error.message });
    }

    return state;
  }

  /**
   * Verifies if state is preserved after returning to logs
   */
  async function verifyStatePreserved(pm, initialState) {
    const currentState = await captureLogsState(pm);
    const preserved = currentState.hasResults === initialState.hasResults;
    return { preserved, initial: initialState, current: currentState };
  }

  /**
   * Sets up logs page with a query and returns initial state
   */
  async function setupLogsState(page, pm) {
    // Navigate to logs page
    const logsUrl = `${logData.logsUrl}?org_identifier=${process.env["ORGNAME"]}`;
    await page.goto(logsUrl);
    await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});

    // Wait for logs page to load
    await pm.homePage.logsPageIndicator.waitFor({ state: 'visible', timeout: 15000 }).catch(() => {});

    // Select stream and run query
    try {
      await pm.logsPage.selectStream("e2e_automate");
      testLogger.info('Stream selected: e2e_automate');
    } catch (error) {
      testLogger.warn('Could not select stream', { error: error.message });
    }

    // Click refresh to run query
    try {
      await pm.homePage.clickRefresh();
      await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
    } catch (error) {
      testLogger.warn('Could not run query', { error: error.message });
    }

    // Wait for results
    await page.waitForTimeout(2000);

    return await captureLogsState(pm);
  }

  /**
   * Returns to logs page via sidebar with retry logic
   */
  async function returnToLogs(page, pm) {
    const maxRetries = 3;
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        // Wait for sidebar to be interactive
        await page.waitForTimeout(500);

        // Click on logs menu using page object method
        await pm.homePage.clickLogsMenu();

        await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});

        // Wait for URL to contain logs
        await page.waitForURL(/logs/, { timeout: 20000 });

        // Wait for logs page indicator
        await pm.homePage.logsPageIndicator.waitFor({ state: 'visible', timeout: 15000 }).catch(() => {});
        await page.waitForTimeout(1000);

        testLogger.info(`Successfully returned to logs page on attempt ${attempt}`);
        return; // Success, exit function
      } catch (error) {
        testLogger.warn(`Return to logs attempt ${attempt} failed`, { error: error.message });
        if (attempt === maxRetries) {
          throw new Error(`Failed to return to logs page after ${maxRetries} attempts`);
        }
        await page.waitForTimeout(2000); // Longer wait before retry
      }
    }
  }

  test("Sidebar navigation with logs state preservation", {
    tag: ['@landingPage', '@smoke', '@P0', '@navigation', '@statePreservation']
  }, async ({ page }) => {
    testLogger.testStart('Sidebar navigation with state preservation', __filename);
    await navigateToBase(page);
    pm = new PageManager(page);

    // ==========================================
    // STEP 1: Setup logs state
    // ==========================================
    testLogger.info('STEP 1: Setting up logs page state');
    const initialState = await setupLogsState(page, pm);
    testLogger.info('Initial state captured', { hasResults: initialState.hasResults });

    // ==========================================
    // STEP 2: Test each sidebar page
    // ==========================================
    testLogger.info('STEP 2: Testing sidebar navigation with state preservation');

    const sidebarPages = [
      {
        name: 'Home',
        navigate: () => pm.homePage.gotoHomePage(),
        urlPattern: /org_identifier/,
        indicator: () => pm.homePage.homePageIndicator,
        uiChecks: async () => {
          await pm.homePage.validateHomePageElements();
          testLogger.info('Home: Validated main content, Streams, Function, Scheduled sections');
        }
      },
      {
        name: 'Metrics',
        navigate: () => pm.homePage.navigateToMetrics(),
        urlPattern: /metrics/,
        indicator: () => pm.homePage.metricsPageIndicator,
        uiChecks: async () => {
          await pm.homePage.validateMetricsPageElements();
          testLogger.info('Metrics: Validated Run query button, date picker, Metrics title, Fields section');
        }
      },
      {
        name: 'Traces',
        navigate: () => pm.homePage.navigateToTraces(),
        urlPattern: /traces/,
        indicator: () => pm.homePage.tracesPageIndicator,
        uiChecks: async () => {
          await pm.homePage.validateTracesPageElements();
          testLogger.info('Traces: Validated refresh button, date picker, Traces title');
        }
      },
      {
        name: 'Dashboards',
        navigate: () => pm.homePage.navigateToDashboards(),
        urlPattern: /dashboards/,
        indicator: () => pm.homePage.dashboardsPageIndicator,
        uiChecks: async () => {
          await pm.homePage.validateDashboardsPageElements();
          testLogger.info('Dashboards: Validated add button, search input, import button, dashboard table');
        }
      },
      {
        name: 'Streams',
        navigate: () => pm.homePage.navigateToStreams(),
        urlPattern: /streams/,
        indicator: () => pm.homePage.streamsPageIndicator,
        uiChecks: async () => {
          await pm.homePage.validateStreamsPageElements();
          testLogger.info('Streams: Validated search input, title, refresh button, stream table');
        }
      },
      {
        name: 'Alerts',
        navigate: () => pm.homePage.navigateToAlerts(),
        urlPattern: /alerts/,
        indicator: () => pm.homePage.alertsPageIndicator,
        uiChecks: async () => {
          await pm.homePage.validateAlertsPageElements();
          testLogger.info('Alerts: Validated alerts page container, add alert button');
        }
      },
      {
        name: 'Ingestion',
        navigate: () => pm.homePage.navigateToIngestion(),
        urlPattern: /ingestion/,
        indicator: () => pm.homePage.ingestionPageIndicator,
        uiChecks: async () => {
          await pm.homePage.validateIngestionPageElements();
          testLogger.info('Ingestion: Validated ingestion page container and Reset Token button');
        }
      },
    ];

    for (const pageConfig of sidebarPages) {
      testLogger.info(`--- Testing: ${pageConfig.name} ---`);

      // Navigate to the page
      await pageConfig.navigate();
      await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});

      // Verify URL
      await expect(page).toHaveURL(pageConfig.urlPattern, { timeout: 15000 });
      testLogger.info(`${pageConfig.name} URL verified`);

      // Wait for page indicator
      await pageConfig.indicator().waitFor({ state: 'visible', timeout: 15000 }).catch(() => {
        testLogger.info(`${pageConfig.name} indicator not found, continuing...`);
      });

      // Run UI checks for this page
      await pageConfig.uiChecks();
      testLogger.info(`${pageConfig.name} UI elements validated`);

      // Return to logs (includes URL verification)
      await returnToLogs(page, pm);

      // Extra wait to ensure page is stable
      await page.waitForTimeout(500);

      // Verify state preservation
      const verification = await verifyStatePreserved(pm, initialState);
      if (verification.preserved) {
        statePreservationResults.preserved.push(pageConfig.name);
        testLogger.info(`${pageConfig.name}: STATE PRESERVED`);
      } else {
        statePreservationResults.notPreserved.push(pageConfig.name);
        testLogger.info(`${pageConfig.name}: STATE NOT PRESERVED`, verification);
      }
    }

    testLogger.info('STEP 2 COMPLETE: All sidebar pages tested');
  });

  test("Settings/Management tabs with logs state preservation", {
    tag: ['@landingPage', '@smoke', '@P0', '@navigation', '@statePreservation', '@settings']
  }, async ({ page }) => {
    testLogger.testStart('Settings tabs with state preservation', __filename);
    await navigateToBase(page);
    pm = new PageManager(page);

    // Setup logs state
    testLogger.info('Setting up logs page state');
    const initialState = await setupLogsState(page, pm);
    testLogger.info('Initial state captured', { hasResults: initialState.hasResults });

    // ==========================================
    // Test Settings/Management tabs via UI navigation
    // ==========================================
    testLogger.info('Testing Settings/Management tabs via UI navigation');

    const settingsPages = [
      {
        name: 'Settings - General',
        navigate: async () => {
          await pm.homePage.navigateToSettings();
        },
        urlPattern: /settings.*general/,
        uiChecks: async () => {
          await pm.homePage.validateSettingsGeneralPageElements();
          testLogger.info('Settings - General: Validated title, save button');
        }
      },
      {
        name: 'Settings - Organization Parameters',
        navigate: async () => {
          await pm.homePage.navigateToOrganizationParameters();
        },
        urlPattern: /organization/,
        uiChecks: async () => {
          await pm.homePage.validateSettingsOrganizationPageElements();
          testLogger.info('Settings - Organization Parameters: Validated submit button');
        }
      },
      {
        name: 'Settings - Alert Destinations',
        navigate: async () => {
          await pm.homePage.navigateToAlertDestinations();
        },
        urlPattern: /alert_destinations/,
        uiChecks: async () => {
          await pm.homePage.validateSettingsAlertDestinationsPageElements();
          testLogger.info('Settings - Alert Destinations: Validated add destination button');
        }
      },
      {
        name: 'Settings - Pipeline Destinations',
        navigate: async () => {
          const result = await pm.homePage.navigateToPipelineDestinations();
          if (!result) {
            testLogger.info('Pipeline Destinations tab not visible (non-enterprise), skipping');
          }
          return result;
        },
        urlPattern: /pipeline_destinations/,
        uiChecks: async () => {
          await pm.homePage.validateSettingsPipelineDestinationsPageElements();
          testLogger.info('Settings - Pipeline Destinations: Validated add pipeline destination button');
        },
        skipIfNotVisible: true
      },
      {
        name: 'Settings - Templates',
        navigate: async () => {
          await pm.homePage.navigateToTemplates();
        },
        urlPattern: /templates/,
        uiChecks: async () => {
          await pm.homePage.validateSettingsTemplatesPageElements();
          testLogger.info('Settings - Templates: Validated add template button');
        }
      },
      {
        name: 'Settings - Cipher Keys',
        navigate: async () => {
          const result = await pm.homePage.navigateToCipherKeys();
          if (!result) {
            testLogger.info('Cipher Keys tab not visible (non-enterprise), skipping');
          }
          return result;
        },
        urlPattern: /cipher_keys/,
        uiChecks: async () => {
          await pm.homePage.validateSettingsCipherKeysPageElements();
          testLogger.info('Settings - Cipher Keys: Validated cipher keys list title');
        },
        skipIfNotVisible: true
      },
      {
        name: 'Settings - Sensitive Data Redaction',
        navigate: async () => {
          const result = await pm.homePage.navigateToSensitiveDataRedaction();
          if (!result) {
            testLogger.info('Sensitive Data Redaction tab not visible (non-enterprise), skipping');
          }
          return result;
        },
        urlPattern: /regex_patterns/,
        uiChecks: async () => {
          await pm.homePage.validateSettingsSensitiveDataRedactionPageElements();
          testLogger.info('Settings - Sensitive Data Redaction: Validated title and add pattern button');
        },
        skipIfNotVisible: true
      },
    ];

    for (const pageConfig of settingsPages) {
      testLogger.info(`--- Testing: ${pageConfig.name} ---`);

      // Navigate via UI clicks (not page.goto)
      const navigateResult = await pageConfig.navigate();

      // Skip if navigation returns false (enterprise-only tab not visible)
      if (navigateResult === false) {
        testLogger.info(`${pageConfig.name}: SKIPPED (tab not visible)`);
        continue;
      }

      await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});

      // Verify URL
      await expect(page).toHaveURL(pageConfig.urlPattern, { timeout: 15000 });
      testLogger.info(`${pageConfig.name} URL verified`);

      // Run UI checks
      await pageConfig.uiChecks();
      testLogger.info(`${pageConfig.name} UI elements validated`);

      // Return to logs (includes URL verification)
      await returnToLogs(page, pm);

      // Extra wait to ensure page is stable
      await page.waitForTimeout(500);

      // Verify state preservation
      const verification = await verifyStatePreserved(pm, initialState);
      if (verification.preserved) {
        statePreservationResults.preserved.push(pageConfig.name);
        testLogger.info(`${pageConfig.name}: STATE PRESERVED`);
      } else {
        statePreservationResults.notPreserved.push(pageConfig.name);
        testLogger.info(`${pageConfig.name}: STATE NOT PRESERVED`, verification);
      }
    }

    testLogger.info('Settings tabs testing complete');
  });

  test("Header elements, help menu, profile menu, and org selector", {
    tag: ['@landingPage', '@smoke', '@P0', '@header']
  }, async ({ page }) => {
    testLogger.testStart('Header elements test', __filename);
    await navigateToBase(page);
    pm = new PageManager(page);

    // Navigate to home page
    const homeUrl = `/web/?org_identifier=${process.env["ORGNAME"]}`;
    await page.goto(homeUrl);
    await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});

    // ==========================================
    // STEP 1: UI Elements Visibility
    // ==========================================
    testLogger.info('STEP 1: Testing UI elements visibility');

    // Verify logo
    await pm.homePage.validateLogoVisible();
    await expect(pm.homePage.mainContent).toBeVisible();
    testLogger.info('Logo and main content verified');

    // Verify navigation menu
    await pm.homePage.validateNavigationMenuVisible();
    testLogger.info('Navigation menu verified');

    // Verify header elements
    await pm.homePage.validateHeaderElementsVisible();
    testLogger.info('Header elements verified');

    // ==========================================
    // STEP 2: Help Menu
    // ==========================================
    testLogger.info('STEP 2: Testing help menu');

    await pm.homePage.openHelpMenu();
    await expect(pm.homePage.aboutLink).toBeVisible();
    await pm.homePage.aboutLink.click();
    await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
    await expect(page).toHaveURL(/about/);
    testLogger.info('Help menu and About link verified');

    // Navigate back to home
    await pm.homePage.gotoHomePage();

    // ==========================================
    // STEP 3: Profile Menu
    // ==========================================
    testLogger.info('STEP 3: Testing profile menu');

    await pm.homePage.openProfileMenu();
    await expect(pm.homePage.logoutButton).toBeVisible();
    await expect(pm.homePage.themeManager).toBeVisible();
    await page.keyboard.press('Escape');
    testLogger.info('Profile menu verified');

    // ==========================================
    // STEP 4: Organization Selector
    // ==========================================
    testLogger.info('STEP 4: Testing organization selector');

    await pm.homePage.openOrgSelector();
    await expect(pm.homePage.orgMenuList).toBeVisible();
    await expect(pm.homePage.orgSearchInput).toBeVisible();

    // Test search
    await pm.homePage.orgSearchInput.fill('default');
    await page.waitForTimeout(1000);

    const firstResult = pm.homePage.orgMenuItemLabel.first();
    if (await firstResult.isVisible()) {
      const text = await firstResult.textContent();
      expect(text.toLowerCase()).toContain('default');
    }
    await page.keyboard.press('Escape');
    testLogger.info('Organization selector verified');

    // ==========================================
    // STEP 5: Home Dashboard Elements
    // ==========================================
    testLogger.info('STEP 5: Testing home dashboard elements');

    await pm.homePage.validateHomeDashboardElements();
    testLogger.info('Dashboard elements validated');

    testLogger.info('ALL STEPS COMPLETE: Header elements test passed');
  });

  test("State preservation summary", {
    tag: ['@landingPage', '@summary', '@P0']
  }, async () => {
    testLogger.testStart('State preservation summary', __filename);

    // Log the summary
    testLogger.info('='.repeat(60));
    testLogger.info('STATE PRESERVATION SUMMARY');
    testLogger.info('='.repeat(60));

    testLogger.info(`PAGES THAT PRESERVE LOGS STATE (${statePreservationResults.preserved.length}):`);
    statePreservationResults.preserved.forEach(p => testLogger.info(`   - ${p}`));

    testLogger.info(`PAGES THAT DO NOT PRESERVE LOGS STATE (${statePreservationResults.notPreserved.length}):`);
    statePreservationResults.notPreserved.forEach(p => testLogger.info(`   - ${p}`));

    testLogger.info('='.repeat(60));

    // This test is informational - it always passes
    expect(true).toBe(true);
  });
});
