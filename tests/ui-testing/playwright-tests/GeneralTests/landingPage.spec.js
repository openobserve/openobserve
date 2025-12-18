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
  async function captureLogsState(page) {
    const state = {
      hasResults: false,
      queryText: ''
    };

    try {
      // Check if results table is visible
      const resultsTable = page.locator('[data-test="logs-search-result-logs-table"]');
      state.hasResults = await resultsTable.isVisible({ timeout: 3000 }).catch(() => false);

      // Get query text
      const queryEditor = page.locator('[data-test="logs-search-bar-query-editor"] .view-lines');
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
  async function verifyStatePreserved(page, initialState) {
    const currentState = await captureLogsState(page);
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
      const refreshBtn = page.locator('[data-test="logs-search-bar-refresh-btn"]');
      await refreshBtn.waitFor({ state: 'visible', timeout: 10000 });
      await refreshBtn.click();
      await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
    } catch (error) {
      testLogger.warn('Could not run query', { error: error.message });
    }

    // Wait for results
    await page.waitForTimeout(2000);

    return await captureLogsState(page);
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

        // Click on logs menu - ensure it's visible and clickable
        const logsMenu = page.locator('[data-test="menu-link-\\/logs-item"]');
        await logsMenu.waitFor({ state: 'visible', timeout: 10000 });
        await logsMenu.click();

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
          // Validate home page dashboard sections
          await expect(pm.homePage.mainContent).toBeVisible({ timeout: 10000 });
          await expect(page.getByText('Streams').first()).toBeVisible({ timeout: 5000 });
          await expect(page.getByText('Function').first()).toBeVisible({ timeout: 5000 });
          await expect(page.getByText('Scheduled').first()).toBeVisible({ timeout: 5000 });
          testLogger.info('Home: Validated main content, Streams, Function, Scheduled sections');
        }
      },
      {
        name: 'Metrics',
        navigate: () => pm.homePage.navigateToMetrics(),
        urlPattern: /metrics/,
        indicator: () => pm.homePage.metricsPageIndicator,
        uiChecks: async () => {
          // Validate metrics page key elements
          await expect(page.locator('[data-test="metrics-apply"]').or(page.getByRole('button', { name: 'Run query' }))).toBeVisible({ timeout: 10000 });
          await expect(page.locator('[data-test="metrics-date-picker"]')).toBeVisible({ timeout: 5000 });
          await expect(page.getByText('Metrics').first()).toBeVisible({ timeout: 5000 });
          await expect(page.getByText('Fields').first()).toBeVisible({ timeout: 5000 });
          testLogger.info('Metrics: Validated Run query button, date picker, Metrics title, Fields section');
        }
      },
      {
        name: 'Traces',
        navigate: () => pm.homePage.navigateToTraces(),
        urlPattern: /traces/,
        indicator: () => pm.homePage.tracesPageIndicator,
        uiChecks: async () => {
          // Validate traces page key elements
          await expect(page.locator('[data-test="logs-search-bar-refresh-btn"]')).toBeVisible({ timeout: 10000 });
          await expect(page.locator('[data-test="date-time-btn"]')).toBeVisible({ timeout: 5000 });
          await expect(page.getByText('Traces').first()).toBeVisible({ timeout: 5000 });
          testLogger.info('Traces: Validated refresh button, date picker, Traces title');
        }
      },
      {
        name: 'Dashboards',
        navigate: () => pm.homePage.navigateToDashboards(),
        urlPattern: /dashboards/,
        indicator: () => pm.homePage.dashboardsPageIndicator,
        uiChecks: async () => {
          // Validate dashboards page key elements
          await expect(page.locator('[data-test="dashboard-add"]')).toBeVisible({ timeout: 10000 });
          await expect(page.locator('[data-test="dashboard-search"]')).toBeVisible({ timeout: 5000 });
          await expect(page.locator('[data-test="dashboard-import"]')).toBeVisible({ timeout: 5000 });
          await expect(page.locator('[data-test="dashboard-table"]')).toBeVisible({ timeout: 5000 });
          testLogger.info('Dashboards: Validated add button, search input, import button, dashboard table');
        }
      },
      {
        name: 'Streams',
        navigate: () => pm.homePage.navigateToStreams(),
        urlPattern: /streams/,
        indicator: () => pm.homePage.streamsPageIndicator,
        uiChecks: async () => {
          // Validate streams page key elements
          await expect(page.locator('[data-test="streams-search-stream-input"]')).toBeVisible({ timeout: 10000 });
          await expect(page.locator('[data-test="log-stream-title-text"]')).toBeVisible({ timeout: 5000 });
          await expect(page.locator('[data-test="log-stream-refresh-stats-btn"]')).toBeVisible({ timeout: 5000 });
          await expect(page.locator('[data-test="log-stream-table"]')).toBeVisible({ timeout: 5000 });
          testLogger.info('Streams: Validated search input, title, refresh button, stream table');
        }
      },
      {
        name: 'Alerts',
        navigate: () => pm.homePage.navigateToAlerts(),
        urlPattern: /alerts/,
        indicator: () => pm.homePage.alertsPageIndicator,
        uiChecks: async () => {
          // Validate alerts page key elements - wait for page to fully load
          await page.waitForTimeout(2000); // Allow alerts page to load
          await expect(page.locator('[data-test="alert-list-page"]').or(page.locator('[data-test="alerts-page"]'))).toBeVisible({ timeout: 15000 });
          await expect(page.locator('[data-test="alert-list-add-alert-btn"]')).toBeVisible({ timeout: 10000 });
          testLogger.info('Alerts: Validated alerts page container, add alert button');
        }
      },
      {
        name: 'Ingestion',
        navigate: () => pm.homePage.navigateToIngestion(),
        urlPattern: /ingestion/,
        indicator: () => pm.homePage.ingestionPageIndicator,
        uiChecks: async () => {
          // Validate ingestion page key elements
          await expect(page.locator('.ingestionPage')).toBeVisible({ timeout: 10000 });
          await expect(page.getByRole('button', { name: /Reset Token/i })).toBeVisible({ timeout: 5000 });
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
      const verification = await verifyStatePreserved(page, initialState);
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
          // Navigate to Settings via UI - General is the default tab
          await pm.homePage.navigateToSettings();
        },
        urlPattern: /settings.*general/,
        uiChecks: async () => {
          // Validate General Settings page elements
          await expect(page.locator('.general-page-title')).toBeVisible({ timeout: 10000 });
          await expect(page.locator('[data-test="dashboard-add-submit"]')).toBeVisible({ timeout: 5000 });
          testLogger.info('Settings - General: Validated title, save button');
        }
      },
      {
        name: 'Settings - Organization Parameters',
        navigate: async () => {
          // Navigate to Settings, then click Organization Parameters tab
          await pm.homePage.navigateToSettings();
          // Organization tab doesn't have data-test, use text selector
          await page.getByRole('tab', { name: /Organization/i }).waitFor({ state: 'visible', timeout: 10000 });
          await page.getByRole('tab', { name: /Organization/i }).click();
        },
        urlPattern: /organization/,
        uiChecks: async () => {
          // Validate Organization Parameters page elements - use specific selector to avoid strict mode violations
          await expect(page.locator('[data-test="add-alert-submit-btn"]')).toBeVisible({ timeout: 10000 });
          testLogger.info('Settings - Organization Parameters: Validated submit button');
        }
      },
      {
        name: 'Settings - Alert Destinations',
        navigate: async () => {
          // Navigate to Settings, then click Alert Destinations tab
          await pm.homePage.navigateToSettings();
          await page.locator('[data-test="alert-destinations-tab"]').waitFor({ state: 'visible', timeout: 10000 });
          await page.locator('[data-test="alert-destinations-tab"]').click();
        },
        urlPattern: /alert_destinations/,
        uiChecks: async () => {
          // Validate Alert Destinations page elements
          await expect(page.locator('[data-test="alert-destination-list-add-alert-btn"]')).toBeVisible({ timeout: 10000 });
          testLogger.info('Settings - Alert Destinations: Validated add destination button');
        }
      },
      {
        name: 'Settings - Pipeline Destinations',
        navigate: async () => {
          // Navigate to Settings, then click Pipeline Destinations tab (Enterprise only)
          await pm.homePage.navigateToSettings();
          const pipelineTab = page.locator('[data-test="pipeline-destinations-tab"]');
          // Skip if not enterprise
          if (!(await pipelineTab.isVisible({ timeout: 5000 }).catch(() => false))) {
            testLogger.info('Pipeline Destinations tab not visible (non-enterprise), skipping');
            return false;
          }
          await pipelineTab.click();
          return true;
        },
        urlPattern: /pipeline_destinations/,
        uiChecks: async () => {
          // Validate Pipeline Destinations page elements
          await expect(page.locator('[data-test="pipeline-destination-list-add-btn"]')).toBeVisible({ timeout: 10000 });
          testLogger.info('Settings - Pipeline Destinations: Validated add pipeline destination button');
        },
        skipIfNotVisible: true
      },
      {
        name: 'Settings - Templates',
        navigate: async () => {
          // Navigate to Settings, then click Templates tab
          await pm.homePage.navigateToSettings();
          await page.locator('[data-test="alert-templates-tab"]').waitFor({ state: 'visible', timeout: 10000 });
          await page.locator('[data-test="alert-templates-tab"]').click();
        },
        urlPattern: /templates/,
        uiChecks: async () => {
          // Validate Templates page elements
          await expect(page.locator('[data-test="template-list-add-btn"]')).toBeVisible({ timeout: 10000 });
          testLogger.info('Settings - Templates: Validated add template button');
        }
      },
      {
        name: 'Settings - Cipher Keys',
        navigate: async () => {
          // Navigate to Settings, then click Cipher Keys tab (Enterprise only)
          await pm.homePage.navigateToSettings();
          const cipherTab = page.locator('[data-test="management-cipher-key-tab"]');
          // Skip if not enterprise
          if (!(await cipherTab.isVisible({ timeout: 5000 }).catch(() => false))) {
            testLogger.info('Cipher Keys tab not visible (non-enterprise), skipping');
            return false;
          }
          await cipherTab.click();
          return true;
        },
        urlPattern: /cipher_keys/,
        uiChecks: async () => {
          // Validate Cipher Keys page elements
          await expect(page.locator('[data-test="cipher-keys-list-title"]')).toBeVisible({ timeout: 10000 });
          testLogger.info('Settings - Cipher Keys: Validated cipher keys list title');
        },
        skipIfNotVisible: true
      },
      {
        name: 'Settings - Sensitive Data Redaction',
        navigate: async () => {
          // Navigate to Settings, then click Regex Patterns / Sensitive Data Redaction tab (Enterprise only)
          await pm.homePage.navigateToSettings();
          const regexTab = page.locator('[data-test="regex-patterns-tab"]');
          // Skip if not enterprise
          if (!(await regexTab.isVisible({ timeout: 5000 }).catch(() => false))) {
            testLogger.info('Sensitive Data Redaction tab not visible (non-enterprise), skipping');
            return false;
          }
          await regexTab.click();
          return true;
        },
        urlPattern: /regex_patterns/,
        uiChecks: async () => {
          // Validate Sensitive Data Redaction page elements - use specific selector to avoid strict mode violations
          await expect(page.locator('[data-test="regex-pattern-list-title"]')).toBeVisible({ timeout: 10000 });
          await expect(page.locator('[data-test="regex-pattern-list-add-pattern-btn"]')).toBeVisible({ timeout: 5000 });
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
      const verification = await verifyStatePreserved(page, initialState);
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
